import { Router, Response } from 'express';
import { protect, AuthRequest } from '../middleware/authMiddleware';
import { requireActiveAccount } from '../middleware/activeAccountMiddleware';
import { checkDocumentLimit, checkDocumentSize, requireActiveSubscription } from '../middleware/subscriptionMiddleware';
import multer from 'multer';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import fs from 'fs';
import { DocumentModel, Subscription, PLAN_LIMITS, PlanType } from '../models';
import axios from 'axios';
import FormData from 'form-data';
import { recordWorkspaceAudit } from '../services/auditService';
import { getAiServiceSecretHeaders } from '../utils/aiServiceSecret';
import { terminalLog } from '../utils/terminalLog';

dotenv.config();

const router = Router();
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

let supabase: any;
if (supabaseUrl && supabaseKey && supabaseUrl.startsWith('http')) {
    supabase = createClient(supabaseUrl, supabaseKey);
    // Verify the connection is actually reachable (non-blocking)
    supabase.storage.listBuckets().then((r: any) => {
        if (r.error) {
            terminalLog.warn('Supabase', `Storage unreachable (${r.error.message}) — will retry on upload`);
        } else {
            terminalLog.ok('Supabase', 'Storage ready for document uploads');
        }
    }).catch((e: any) => {
        terminalLog.warn('Supabase', `Storage ping failed (${e?.message}) — will retry on upload`);
    });
} else {
    terminalLog.warn('Supabase', 'Credentials missing — uploads disabled');
}

// Multer: accept up to 50 files per request
const upload = multer({ dest: 'uploads/' });

// GET /api/upload/remaining - returns remaining monthly document quota
router.get('/remaining', protect, requireActiveAccount, requireActiveSubscription, async (req: AuthRequest, res: Response) => {
    try {
        const tenantId = req.user!.tenantId!;
        let subscription = await Subscription.findOne({ tenantId });
        const plan = subscription?.plan || 'free';
        const limits = PLAN_LIMITS[plan as PlanType];

        if (limits.maxDocuments === -1) {
            return res.json({ remaining: -1, used: 0, limit: -1 });
        }

        // Reset monthly counter if new month
        if (subscription) {
            const now = new Date();
            const lastReset = new Date(subscription.lastDocumentCountReset || subscription.createdAt);
            if (now.getMonth() !== lastReset.getMonth() || now.getFullYear() !== lastReset.getFullYear()) {
                subscription.documentsUploadedThisMonth = 0;
                subscription.lastDocumentCountReset = now;
                await subscription.save();
            }
        }

        const used = subscription?.documentsUploadedThisMonth ?? 0;
        const remaining = limits.maxDocuments - used;
        const resetsAt = (() => {
            const n = new Date();
            return new Date(n.getFullYear(), n.getMonth() + 1, 1);
        })();

        return res.json({ remaining, used, limit: limits.maxDocuments, resetsAt });
    } catch (error) {
        console.error('Error fetching remaining quota:', error);
        res.status(500).json({ error: 'Failed to fetch quota' });
    }
});

// POST /api/upload/pdf - upload one or more files (field name: "files")
router.post(
    '/pdf',
    protect,
    requireActiveAccount,
    requireActiveSubscription,
    upload.array('files', 50),
    checkDocumentLimit,
    checkDocumentSize,
    async (req: AuthRequest, res: Response) => {
        const files = (req as any).files as Express.Multer.File[] | undefined;
        if (!files || files.length === 0) {
            return res.status(400).json({ error: 'No files uploaded' });
        }

        if (!supabase) {
            // Clean up temp files
            files.forEach(f => { if (fs.existsSync(f.path)) fs.unlinkSync(f.path); });
            return res.status(503).json({ error: 'Storage service not configured' });
        }

        const tenantId = req.user!.tenantId!;
        const { agentId } = req.body;

        const uploadedDocs: any[] = [];
        const failedFiles: string[] = [];

        for (const file of files) {
            const tempPath = file.path;
            const originalName = file.originalname;

            try {
                const fileContent = fs.readFileSync(tempPath);
                const storagePath = agentId
                    ? `${tenantId}/${agentId}/${Date.now()}_${originalName}`
                    : `${tenantId}/${Date.now()}_${originalName}`;

                const { error: storageError } = await supabase
                    .storage
                    .from('documents')
                    .upload(storagePath, fileContent, {
                        contentType: file.mimetype || 'application/pdf'
                    });

                if (storageError) throw storageError;

                // Save metadata to MongoDB
                const doc = await DocumentModel.create({
                    tenantId,
                    agentId: agentId || undefined,
                    filename: originalName,
                    filePath: storagePath,
                    contentType: file.mimetype || 'application/pdf',
                    fileSize: file.size
                });

                // Trigger AI ingestion asynchronously - pass document_id so chunks can be deleted precisely later
                const aiForm = new FormData();
                aiForm.append('file', fileContent, originalName);
                aiForm.append('tenant_id', tenantId);
                if (agentId) aiForm.append('agent_id', agentId);
                aiForm.append('document_id', doc._id.toString());

                const aiServiceUrl = process.env.AI_SERVICE_URL || 'http://localhost:8000';
                axios.post(`${aiServiceUrl}/ingest`, aiForm, {
                    headers: { ...aiForm.getHeaders(), ...getAiServiceSecretHeaders() },
                    timeout: 60000
                }).catch((err: any) => {
                    const detail = err.response?.data || err.message;
                    console.error(`[UPLOAD] Ingestion failed for doc ${doc._id} (${originalName}):`, detail);
                    console.error('[UPLOAD] Ensure the AI service is running and Ollama has nomic-embed-text pulled.');
                });

                uploadedDocs.push(doc);
            } catch (err: any) {
                console.error(`Failed to upload ${originalName}:`, err.message || err);
                failedFiles.push(originalName);
            } finally {
                if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
            }
        }

        // Increment monthly counter by number of successful uploads
        if (uploadedDocs.length > 0) {
            await Subscription.findOneAndUpdate(
                { tenantId },
                { $inc: { documentsUploadedThisMonth: uploadedDocs.length } }
            );
            const actorId = req.user!.userId;
            recordWorkspaceAudit(req, {
                tenantId,
                actorId,
                action: 'document.upload',
                metadata: {
                    fileCount: uploadedDocs.length,
                    agentId: agentId ? String(agentId) : undefined,
                    filenames: uploadedDocs.map((d: { filename?: string }) => d.filename).filter(Boolean),
                },
            });
        }

        const message = failedFiles.length > 0
            ? `Uploaded ${uploadedDocs.length} file(s) successfully. Failed: ${failedFiles.join(', ')}`
            : `Uploaded ${uploadedDocs.length} file(s) successfully`;

        res.json({ message, documents: uploadedDocs, failed: failedFiles });
    }
);

export default router;
