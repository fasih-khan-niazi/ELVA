import { Response } from 'express';
import { AuthRequest } from '../middleware/authMiddleware';
import { DocumentModel, Agent, Subscription, PLAN_LIMITS, PlanType } from '../models';
import { createClient } from '@supabase/supabase-js';
import axios from 'axios';
import FormData from 'form-data';
import dotenv from 'dotenv';
import { recordWorkspaceAudit } from '../services/auditService';
import { getAiServiceSecretHeaders } from '../utils/aiServiceSecret';
import { withRetry, STORAGE_UNAVAILABLE_MESSAGE } from '../utils/supabaseRetry';

dotenv.config();

const KNOWLEDGE_SUMMARY_VECTOR_SOURCE = 'agent_knowledge_summary';

async function getKnowledgeSummaryCharLimit(tenantId: string): Promise<number> {
    const sub = await Subscription.findOne({ tenantId });
    const plan = (sub?.plan as PlanType) || 'free';
    return PLAN_LIMITS[plan].maxKnowledgeSummaryChars;
}

const getSupabase = () => {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) throw new Error('Supabase not configured');
    return createClient(url, key);
};

// GET /api/documents/agent/:agentId
export const getAgentDocuments = async (req: AuthRequest, res: Response) => {
    try {
        const { agentId } = req.params;
        const tenantId = req.user?.tenantId;

        if (!tenantId) return res.status(400).json({ message: 'Tenant ID not found' });

        const agent = await Agent.findOne({ _id: agentId, tenantId });
        if (!agent) return res.status(404).json({ message: 'Agent not found' });

        const documents = await DocumentModel.find({ agentId, tenantId }).sort({ createdAt: -1 });

        const knowledgeSummaryMaxChars = await getKnowledgeSummaryCharLimit(String(tenantId));

        res.json({
            documents,
            agentName: agent.name,
            agentType: agent.type,
            knowledgeSummary: agent.knowledgeSummary ?? '',
            knowledgeSummaryMaxChars,
        });
    } catch (error) {
        console.error('Error fetching agent documents:', error);
        res.status(500).json({ message: 'Error fetching documents' });
    }
};

// DELETE /api/documents/:documentId
// Deletes from Supabase Storage, vector DB, and MongoDB.
// Monthly quota is NOT restored - quota tracks consumption, not current storage.
export const deleteDocument = async (req: AuthRequest, res: Response) => {
    try {
        const { documentId } = req.params;
        const tenantId = req.user?.tenantId;

        if (!tenantId) return res.status(400).json({ message: 'Tenant ID not found' });

        const doc = await DocumentModel.findOne({ _id: documentId, tenantId });
        if (!doc) return res.status(404).json({ message: 'Document not found' });

        try {
            const supabase = getSupabase();

            // 1. Delete the PDF from Supabase Storage
            const { error: storageError } = await supabase
                .storage
                .from('documents')
                .remove([doc.filePath]);

            if (storageError) {
                console.error('Error deleting from Supabase storage:', storageError);
            }

            // 2. Delete vector chunks that were tagged with this document_id during ingestion
            const { error: vectorError } = await supabase
                .from('document_chunks')
                .delete()
                .filter('metadata->>document_id', 'eq', documentId);

            if (vectorError) {
                console.error('Error deleting vector chunks from Supabase:', vectorError);
            }
        } catch (supabaseErr) {
            // Non-blocking - still remove MongoDB record even if Supabase cleanup fails
            console.error('Supabase cleanup error (non-blocking):', supabaseErr);
        }

        // 3. Delete the MongoDB metadata record
        await DocumentModel.deleteOne({ _id: documentId, tenantId });

        recordWorkspaceAudit(req, {
            tenantId,
            actorId: req.user!.userId,
            action: 'document.delete',
            targetType: 'document',
            targetId: documentId,
            metadata: { filename: doc.filename, agentId: doc.agentId ? String(doc.agentId) : undefined },
        });

        res.json({ message: 'Document deleted successfully' });
    } catch (error) {
        console.error('Error deleting document:', error);
        res.status(500).json({ message: 'Error deleting document' });
    }
};

// POST /api/documents/agent/:agentId/knowledge-summary
// Persists editable summary text and (re)embeds it for RAG alongside PDF chunks.
export const saveAgentKnowledgeSummary = async (req: AuthRequest, res: Response) => {
    try {
        const { agentId } = req.params;
        const tenantId = req.user?.tenantId;
        const summary = typeof req.body?.summary === 'string' ? req.body.summary : '';

        if (!tenantId) return res.status(400).json({ message: 'Tenant ID not found' });

        const agent = await Agent.findOne({ _id: agentId, tenantId });
        if (!agent) return res.status(404).json({ message: 'Agent not found' });

        const maxChars = await getKnowledgeSummaryCharLimit(String(tenantId));
        if (summary.length > maxChars) {
            return res.status(400).json({
                message: `Knowledge summary must be at most ${maxChars.toLocaleString()} characters for your plan.`,
            });
        }

        agent.knowledgeSummary = summary;
        await agent.save();

        const aiServiceUrl = process.env.AI_SERVICE_URL || 'http://localhost:8000';
        try {
            await axios.post(
                `${aiServiceUrl}/ingest-text`,
                {
                    tenant_id: tenantId,
                    agent_id: agentId,
                    text: summary,
                    source: KNOWLEDGE_SUMMARY_VECTOR_SOURCE,
                },
                { timeout: 120_000, headers: getAiServiceSecretHeaders() }
            );
        } catch (aiErr: any) {
            console.error('[KNOWLEDGE_SUMMARY] AI sync failed:', aiErr?.message);
            return res.status(503).json({
                message: 'Summary was saved but embedding sync failed. Try Re-sync shortly.',
                knowledgeSummary: summary,
            });
        }

        recordWorkspaceAudit(req, {
            tenantId,
            actorId: req.user!.userId,
            action: 'knowledge.summary_update',
            targetType: 'agent',
            targetId: agentId,
            metadata: { charCount: summary.length },
        });

        res.json({ message: 'Knowledge summary saved and synced.', knowledgeSummary: summary });
    } catch (error) {
        console.error('Error saving knowledge summary:', error);
        res.status(500).json({ message: 'Error saving knowledge summary' });
    }
};

// GET /api/documents/:documentId/view - short-lived signed URL to open the file (e.g. PDF in browser).
export const getDocumentViewUrl = async (req: AuthRequest, res: Response) => {
    try {
        const { documentId } = req.params;
        const tenantId = req.user?.tenantId;

        if (!tenantId) return res.status(400).json({ message: 'Tenant ID not found' });

        const doc = await DocumentModel.findOne({ _id: documentId, tenantId });
        if (!doc) return res.status(404).json({ message: 'Document not found' });

        const supabase = getSupabase();
        const { data, error } = await supabase.storage
            .from('documents')
            .createSignedUrl(doc.filePath, 3600);

        if (error || !data?.signedUrl) {
            console.error('[DOCUMENT_VIEW] Signed URL error:', error?.message);
            return res.status(500).json({ message: 'Could not create document link' });
        }

        res.json({
            url: data.signedUrl,
            filename: doc.filename,
            contentType: doc.contentType || 'application/pdf',
        });
    } catch (error) {
        console.error('Error creating document view URL:', error);
        res.status(500).json({ message: 'Error creating document link' });
    }
};

// POST /api/documents/agent/:agentId/reingest
// Re-downloads every document for an agent from Supabase Storage and
// re-sends each to the AI service for embedding. Fixes agents whose
// documents were uploaded before the KB pipeline was repaired.
export const reingestAgentDocuments = async (req: AuthRequest, res: Response) => {
    const { agentId } = req.params;
    const tenantId = req.user?.tenantId;
    if (!tenantId) return res.status(400).json({ message: 'Tenant ID not found' });

    const agent = await Agent.findOne({ _id: agentId, tenantId });
    if (!agent) return res.status(404).json({ message: 'Agent not found' });

    const documents = await DocumentModel.find({ agentId, tenantId });

    const aiServiceUrl = process.env.AI_SERVICE_URL || 'http://localhost:8000';
    let reingested = 0;
    let failed = 0;

    if (documents.length > 0) {
        const supabase = getSupabase();

        // Quick connectivity check before attempting all downloads (with retries)
        try {
            await withRetry('REINGEST-PING', async () => {
                const { error: pingErr } = await supabase.storage.listBuckets();
                if (pingErr) throw new Error(pingErr.message);
            });
        } catch (pingErr: any) {
            console.error('[REINGEST] Supabase Storage unreachable:', pingErr?.message || pingErr);
            return res.status(503).json({
                message: STORAGE_UNAVAILABLE_MESSAGE,
                reingested: 0,
                failed: documents.length,
                summarySyncOk: false,
            });
        }

        for (const doc of documents) {
            try {
                // Download file bytes from Supabase Storage
                const fileData = await withRetry(`REINGEST-DL:${doc.filename}`, async () => {
                    const { data, error: dlErr } = await supabase
                        .storage
                        .from('documents')
                        .download(doc.filePath);
                    if (dlErr || !data) throw new Error(dlErr?.message || 'Download failed');
                    return data;
                });

                const buffer = Buffer.from(await fileData.arrayBuffer());
                const form = new FormData();
                form.append('file', buffer, { filename: doc.filename, contentType: doc.contentType });
                form.append('tenant_id', tenantId);
                form.append('agent_id', agentId);
                form.append('document_id', doc._id.toString());

                await axios.post(`${aiServiceUrl}/ingest`, form, {
                    headers: { ...form.getHeaders(), ...getAiServiceSecretHeaders() },
                    timeout: 300_000,
                });

                console.log(`[REINGEST] OK: ${doc.filename}`);
                reingested++;
            } catch (err: any) {
                console.error(`[REINGEST] Failed for ${doc.filename}:`, err.message);
                failed++;
            }
        }
    }

    // Re-embed manual knowledge summary (or clear vectors if empty)
    let summarySyncOk = true;
    try {
        await axios.post(
            `${aiServiceUrl}/ingest-text`,
            {
                tenant_id: tenantId,
                agent_id: agentId,
                text: agent.knowledgeSummary || '',
                source: KNOWLEDGE_SUMMARY_VECTOR_SOURCE,
            },
            { timeout: 300_000, headers: getAiServiceSecretHeaders() }
        );
    } catch (e: any) {
        summarySyncOk = false;
        console.error('[REINGEST] Knowledge summary vector sync failed:', e?.message);
    }

    const docPart =
        documents.length === 0
            ? ''
            : `Documents: ${reingested} re-embedded, ${failed} failed. `;
    const summaryPart = summarySyncOk ? 'Knowledge summary synced.' : 'Knowledge summary sync failed.';

    recordWorkspaceAudit(req, {
        tenantId,
        actorId: req.user!.userId,
        action: 'document.reingest',
        targetType: 'agent',
        targetId: agentId,
        metadata: {
            documentCount: documents.length,
            reingested,
            failed,
            summarySyncOk,
        },
    });

    res.json({
        message: `${docPart}${summaryPart}`.trim(),
        reingested,
        failed,
        summarySyncOk,
    });
};
