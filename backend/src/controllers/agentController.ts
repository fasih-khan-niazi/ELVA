import { Response } from 'express';
import { Agent, DocumentModel, CatalogItem, Order, Lead } from '../models';
import { Campaign } from '../models/campaignModel';
import { OutboundContact } from '../models/outboundContactModel';
import { AuthRequest } from '../middleware/authMiddleware';
import { createClient } from '@supabase/supabase-js';
import { VoiceEndpoint, VoiceSession, VoiceTurn } from '../voice/voiceModels';
import axios from 'axios';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { agentTemplates, getTemplatesByType } from '../data/agentTemplates';
import { recordWorkspaceAudit } from '../services/auditService';
import { getAiServiceSecretHeaders } from '../utils/aiServiceSecret';

const AI_SERVICE_URL = process.env.AI_SERVICE_URL || 'http://localhost:8000';

/** Outbound voice agents must carry a plausible From number before campaigns can dial. */
function validateOutboundCallerIdValue(raw: unknown): string | null {
    const trimmed = String(raw ?? '').trim();
    if (!trimmed) {
        return 'Outbound Caller ID is required (your Twilio number in E.164, e.g. +15551234567).';
    }
    const digits = trimmed.replace(/\D/g, '');
    if (digits.length < 10 || digits.length > 15) {
        return 'Outbound Caller ID must be 10–15 digits (include country code, e.g. +1 for US).';
    }
    return null;
}

export const createAgent = async (req: AuthRequest, res: Response) => {
    try {
        console.log('======= CREATE AGENT REQUEST =======');
        console.log('Timestamp:', new Date().toISOString());
        console.log('User ID:', req.user?.userId);
        console.log('Tenant ID:', req.user?.tenantId);
        console.log('Request body:', req.body);

        const {
            name,
            businessName,
            type,
            prompt,
            voiceId,
            tone,
            language,
            firstMessage,
            persona,
            objectives,
            capabilities,
            guardrails,
            memoryConfig,
            responseConfig,
            currency,
            // Voice-specific fields
            phoneNumber,
            sttProvider,
            ttsProvider,
            ttsVoice,
            // Outbound calling fields
            callDirection,
            outboundCallerId,
            transferNumber,
        } = req.body;
        const tenantId = req.user?.tenantId;

        if (!tenantId) {
            console.error('Tenant ID not found in request');
            return res.status(400).json({ message: 'Tenant ID not found' });
        }

        const isOutbound = type === 'voice' && callDirection === 'outbound';

        if (isOutbound) {
            const cidErr = validateOutboundCallerIdValue(outboundCallerId);
            if (cidErr) return res.status(400).json({ message: cidErr });
        }

        // Validate phone number for inbound voice agents
        if (type === 'voice' && phoneNumber && !isOutbound) {
            const normalizedPhone = phoneNumber.replace(/\s+/g, '');
            const existing = await VoiceEndpoint.findOne({ phoneNumber: normalizedPhone });
            if (existing) {
                return res.status(400).json({
                    message: `Phone number ${normalizedPhone} is already assigned to another agent.`,
                });
            }
        }

        const newAgent = new Agent({
            name,
            businessName: businessName || '',
            type,
            prompt,
            voiceId: type === 'voice' ? voiceId : undefined,
            tone,
            language,
            firstMessage,
            persona: {
                name: persona?.name || name,
                summary: persona?.summary || '',
                speakingStyle: persona?.speakingStyle || tone
            },
            objectives: Array.isArray(objectives) ? objectives : [],
            capabilities: Array.isArray(capabilities) ? capabilities : [],
            guardrails: guardrails || '',
            memoryConfig: {
                shortTermWindow: memoryConfig?.shortTermWindow ?? 6,
                longTermEnabled: memoryConfig?.longTermEnabled ?? false
            },
            responseConfig: {
                temperature: responseConfig?.temperature ?? 0.35,
                maxTurns: responseConfig?.maxTurns ?? 30,
                fallbackMessage:
                    responseConfig?.fallbackMessage ||
                    'I am going to connect you with one of my teammates for more help.'
            },
            currency: currency || 'USD',
            // Voice-specific fields
            phoneNumber: type === 'voice' ? (phoneNumber || '') : '',
            sttProvider: type === 'voice' ? (sttProvider || 'twilio') : 'twilio',
            ttsProvider: type === 'voice' ? (ttsProvider || 'twilio') : 'twilio',
            ttsVoice: type === 'voice' ? (ttsVoice || 'en-US-Neural2-F') : 'en-US-Neural2-F',
            // Outbound calling
            callDirection: type === 'voice' ? (callDirection || 'inbound') : 'inbound',
            outboundCallerId: isOutbound ? (outboundCallerId || '') : '',
            transferNumber: type === 'voice' ? (transferNumber || '') : '',
            tenantId
        });

        console.log('Saving agent to database...');
        await newAgent.save();
        console.log('Agent created successfully:', { id: newAgent._id, name: newAgent.name, type: newAgent.type });

        recordWorkspaceAudit(req, {
            tenantId,
            actorId: req.user!.userId,
            action: 'agent.create',
            targetType: 'agent',
            targetId: String(newAgent._id),
            metadata: { name: newAgent.name, type: newAgent.type },
        });

        // Auto-create VoiceEndpoint for inbound voice agents with a phone number
        if (type === 'voice' && phoneNumber && !isOutbound) {
            const normalizedPhone = phoneNumber.replace(/\s+/g, '');
            try {
                await VoiceEndpoint.create({
                    tenantId,
                    agentId: newAgent._id,
                    phoneNumber: normalizedPhone,
                    label: `${name} - ${normalizedPhone}`,
                    language: language || 'en-US',
                    isActive: true,
                });
                console.log('[VOICE] Endpoint created:', normalizedPhone, '→', newAgent._id);
            } catch (epErr: any) {
                console.error('[VOICE] Failed to create endpoint:', epErr?.message);
                // Don't fail the agent creation - endpoint can be added manually
            }
        }

        res.status(201).json(newAgent);
    } catch (error) {
        console.error('======= ERROR CREATING AGENT =======');
        console.error('Error details:', error);
        console.error('Error stack:', error instanceof Error ? error.stack : 'No stack trace');
        res.status(500).json({ message: 'Error creating agent' });
    }
};

export const getAgents = async (req: AuthRequest, res: Response) => {
    try {
        console.log('GET AGENTS REQUEST - Tenant ID:', req.user?.tenantId);
        const tenantId = req.user?.tenantId;
        if (!tenantId) {
            console.error('Tenant ID not found in get agents request');
            return res.status(400).json({ message: 'Tenant ID not found' });
        }

        const agents = await Agent.find({ tenantId }).sort({ createdAt: -1 });
        console.log(`Found ${agents.length} agents for tenant ${tenantId}`);
        res.json(agents);
    } catch (error) {
        console.error('Error fetching agents:', error);
        res.status(500).json({ message: 'Error fetching agents' });
    }
};

export const getAgentById = async (req: AuthRequest, res: Response) => {
    try {
        const { agentId } = req.params;
        const tenantId = req.user?.tenantId;

        console.log('GET AGENT BY ID:', agentId, 'Tenant:', tenantId);

        const agent = await Agent.findById(agentId);

        if (!agent) {
            return res.status(404).json({ message: 'Agent not found' });
        }

        // Verify ownership
        if (agent.tenantId.toString() !== tenantId) {
            return res.status(403).json({ message: 'Unauthorized access to agent' });
        }

        res.json(agent);
    } catch (error) {
        console.error('Error fetching agent:', error);
        res.status(500).json({ message: 'Error fetching agent' });
    }
};

export const updateAgent = async (req: AuthRequest, res: Response) => {
    try {
        const { agentId } = req.params;
        const tenantId = req.user?.tenantId;
        const updates = req.body;

        console.log('UPDATE AGENT:', agentId, 'Updates:', updates);

        // Knowledge summary must be saved via POST /api/documents/agent/:id/knowledge-summary
        // so Mongo and the vector store stay in sync.
        if ('knowledgeSummary' in updates) delete (updates as any).knowledgeSummary;

        const agent = await Agent.findById(agentId);

        if (!agent) {
            return res.status(404).json({ message: 'Agent not found' });
        }

        // Verify ownership
        if (agent.tenantId.toString() !== tenantId) {
            return res.status(403).json({ message: 'Unauthorized access to agent' });
        }

        if (updates.persona) {
            updates.persona = {
                name: updates.persona.name || agent.persona?.name || agent.name,
                summary: updates.persona.summary ?? agent.persona?.summary ?? '',
                speakingStyle: updates.persona.speakingStyle || agent.persona?.speakingStyle || agent.tone
            };
        }

        if (updates.objectives && !Array.isArray(updates.objectives)) {
            updates.objectives = []; // enforce array type to avoid schema conflicts
        }

        if (updates.capabilities && !Array.isArray(updates.capabilities)) {
            updates.capabilities = [];
        }

        const nextType = updates.type !== undefined ? updates.type : agent.type;
        const nextDir =
            nextType === 'voice'
                ? (updates.callDirection !== undefined ? updates.callDirection : agent.callDirection)
                : 'inbound';
        const nextOutbound =
            updates.outboundCallerId !== undefined ? updates.outboundCallerId : agent.outboundCallerId;
        if (nextType === 'voice' && nextDir === 'outbound') {
            const cidErr = validateOutboundCallerIdValue(nextOutbound);
            if (cidErr) return res.status(400).json({ message: cidErr });
        }

        if (updates.memoryConfig) {
            updates.memoryConfig = {
                shortTermWindow:
                    typeof updates.memoryConfig.shortTermWindow === 'number'
                        ? updates.memoryConfig.shortTermWindow
                        : agent.memoryConfig.shortTermWindow,
                longTermEnabled:
                    typeof updates.memoryConfig.longTermEnabled === 'boolean'
                        ? updates.memoryConfig.longTermEnabled
                        : agent.memoryConfig.longTermEnabled
            };
        }

        if (updates.responseConfig) {
            updates.responseConfig = {
                temperature:
                    typeof updates.responseConfig.temperature === 'number'
                        ? updates.responseConfig.temperature
                        : agent.responseConfig.temperature,
                maxTurns:
                    typeof updates.responseConfig.maxTurns === 'number'
                        ? updates.responseConfig.maxTurns
                        : agent.responseConfig.maxTurns,
                fallbackMessage:
                    updates.responseConfig.fallbackMessage || agent.responseConfig.fallbackMessage
            };
        }

        for (const k of ['chatEmbedKeyId', 'chatEmbedSecretHash', 'chatEmbedPublished', 'chatEmbedAllowedOrigins'] as const) {
            delete (updates as any)[k];
        }

        // ── Voice-specific field sync ─────────────────────────────────────
        if (agent.type === 'voice' && updates.phoneNumber !== undefined) {
            const newPhone = (updates.phoneNumber || '').replace(/\s+/g, '');
            const oldPhone = (agent.phoneNumber || '').replace(/\s+/g, '');

            if (newPhone && newPhone !== oldPhone) {
                // Check if the new number is already taken
                const conflict = await VoiceEndpoint.findOne({
                    phoneNumber: newPhone,
                    agentId: { $ne: agent._id },
                });
                if (conflict) {
                    return res.status(400).json({
                        message: `Phone number ${newPhone} is already assigned to another agent.`,
                    });
                }

                // Update or create the endpoint
                await VoiceEndpoint.findOneAndUpdate(
                    { agentId: agent._id },
                    {
                        phoneNumber: newPhone,
                        label: `${updates.name || agent.name} - ${newPhone}`,
                        language: updates.language || agent.language || 'en-US',
                        tenantId,
                        isActive: true,
                    },
                    { upsert: true, new: true },
                );
                console.log('[VOICE] Endpoint updated:', newPhone);
            } else if (!newPhone && oldPhone) {
                // Phone number removed - delete endpoint
                await VoiceEndpoint.deleteMany({ agentId: agent._id });
                console.log('[VOICE] Endpoint removed for agent', agent._id);
            }
        }

        // Update agent
        Object.assign(agent, updates);
        await agent.save();

        recordWorkspaceAudit(req, {
            tenantId: tenantId!,
            actorId: req.user!.userId,
            action: 'agent.update',
            targetType: 'agent',
            targetId: String(agent._id),
            metadata: {
                name: agent.name,
                type: agent.type,
                fields: Object.keys(updates).filter((k) => k !== 'knowledgeSummary').slice(0, 24),
            },
        });

        console.log('Agent updated successfully');
        res.json(agent);
    } catch (error) {
        console.error('Error updating agent:', error);
        res.status(500).json({ message: 'Error updating agent' });
    }
};

export const getTemplates = async (req: AuthRequest, res: Response) => {
    try {
        const { type, callDirection } = req.query as { type?: string; callDirection?: string };
        if (type === 'chat' || type === 'voice') {
            const filtered = getTemplatesByType(
                type,
                type === 'voice' ? (callDirection as 'inbound' | 'outbound' | undefined) : undefined
            );
            return res.json(filtered);
        }
        res.json(agentTemplates);
    } catch (error) {
        res.status(500).json({ message: 'Error fetching templates' });
    }
};

export const configureChatEmbed = async (req: AuthRequest, res: Response) => {
    try {
        const { agentId } = req.params;
        const tenantId = req.user?.tenantId;
        const { published, allowedOrigins, rotateKey } = req.body as {
            published?: boolean;
            allowedOrigins?: string[];
            rotateKey?: boolean;
        };

        if (!tenantId) {
            return res.status(400).json({ message: 'Tenant ID not found' });
        }

        const agent = await Agent.findById(agentId).select('+chatEmbedSecretHash');
        if (!agent || agent.tenantId.toString() !== tenantId) {
            return res.status(404).json({ message: 'Agent not found' });
        }
        if (agent.type !== 'chat') {
            return res.status(400).json({ message: 'Only chat agents support website embed' });
        }

        if (typeof published === 'boolean') {
            agent.chatEmbedPublished = published;
        }
        if (Array.isArray(allowedOrigins)) {
            agent.chatEmbedAllowedOrigins = allowedOrigins
                .map((s) => String(s).trim())
                .filter(Boolean)
                .slice(0, 30);
        }

        const shouldGenerate =
            rotateKey === true || (agent.chatEmbedPublished === true && !agent.chatEmbedKeyId);

        let embedToken: string | null = null;
        if (shouldGenerate) {
            const keyId = crypto.randomBytes(12).toString('hex');
            const secret = crypto.randomBytes(24).toString('base64url');
            const hash = await bcrypt.hash(secret, 10);
            agent.chatEmbedKeyId = keyId;
            agent.chatEmbedSecretHash = hash;
            embedToken = `${keyId}.${secret}`;
        }

        await agent.save();

        const rawBase =
            process.env.BASE_URL?.trim() || `http://localhost:${process.env.PORT || 3000}`;
        const baseUrl = rawBase.replace(/\/$/, '');

        recordWorkspaceAudit(req, {
            tenantId,
            actorId: req.user!.userId,
            action: 'agent.chat_embed',
            targetType: 'agent',
            targetId: String(agent._id),
            metadata: {
                published: agent.chatEmbedPublished,
                tokenIssued: Boolean(embedToken),
            },
        });

        res.json({
            chatEmbedPublished: agent.chatEmbedPublished,
            chatEmbedKeyId: agent.chatEmbedKeyId,
            chatEmbedAllowedOrigins: agent.chatEmbedAllowedOrigins,
            embedToken,
            embedSnippet:
                embedToken != null
                    ? `<script src="${baseUrl}/embed/elva-chat.js" data-api-base="${baseUrl}" data-elva-key="${embedToken}" async></script>`
                    : null,
            apiHint: {
                config: 'GET /api/public/chat/config — header Authorization: Bearer {token}',
                message:
                    'POST /api/public/chat/message — same Bearer, body { message, sessionId?, client?: "embed"|"api" }',
            },
        });
    } catch (error: any) {
        console.error('[configureChatEmbed]', error);
        res.status(500).json({ message: 'Error saving embed settings' });
    }
};

export const generateAgentConfig = async (req: AuthRequest, res: Response) => {
    try {
        const { businessDescription, agentType, callDirection } = req.body;
        if (!businessDescription || !agentType) {
            return res.status(400).json({ message: 'businessDescription and agentType are required' });
        }

        const aiResponse = await axios.post(
            `${AI_SERVICE_URL.replace(/\/$/, '')}/generate-agent-config`,
            { business_description: businessDescription, agent_type: agentType, call_direction: callDirection || 'inbound' },
            { timeout: 45000, headers: getAiServiceSecretHeaders() }
        );
        res.json(aiResponse.data);
    } catch (error: any) {
        console.error('[generateAgentConfig] Error:', error.message);
        if (error.code === 'ECONNREFUSED') {
            return res.status(503).json({ message: 'AI service is not available.' });
        }
        res.status(500).json({ message: 'Error generating agent config' });
    }
};

export const deleteAgent = async (req: AuthRequest, res: Response) => {
    try {
        const { agentId } = req.params;
        const tenantId = req.user?.tenantId;

        console.log('======= DELETE AGENT REQUEST =======');
        console.log('Agent ID:', agentId, 'Tenant ID:', tenantId);

        const agent = await Agent.findById(agentId);

        if (!agent) {
            return res.status(404).json({ message: 'Agent not found' });
        }

        // Verify ownership
        if (agent.tenantId.toString() !== tenantId) {
            return res.status(403).json({ message: 'Unauthorized access to agent' });
        }

        const agentName = agent.name;
        const agentType = agent.type;

        // Find associated documents
        const documents = await DocumentModel.find({ agentId: agentId });
        console.log(`Found ${documents.length} documents to delete`);

        const supabaseUrl = process.env.SUPABASE_URL;
        const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

        if (supabaseUrl && supabaseKey) {
            const supabase = createClient(supabaseUrl, supabaseKey);

            // 1. Delete files from Supabase storage
            if (documents.length > 0) {
                const filePaths = documents.map(doc => doc.filePath);
                try {
                    const { error } = await supabase.storage.from('documents').remove(filePaths);
                    if (error) {
                        console.error('Error deleting files from Supabase storage:', error);
                    } else {
                        console.log('Deleted files from Supabase storage:', filePaths.length);
                    }
                } catch (err) {
                    console.error('Error deleting from Supabase storage:', err);
                }
            }

            // 2. Delete vector embeddings from Supabase 'document_chunks' table
            // These are the RAG chunks stored with agent_id in metadata
            try {
                const { data, error } = await supabase
                    .from('document_chunks')
                    .delete()
                    .filter('metadata->>agent_id', 'eq', agentId);
                
                if (error) {
                    console.error('Error deleting vectors from Supabase:', error);
                } else {
                    console.log('Deleted vector embeddings for agent from Supabase');
                }
            } catch (err) {
                console.error('Error deleting vectors:', err);
            }
        }

        // 3. Delete document records from MongoDB
        await DocumentModel.deleteMany({ agentId: agentId });
        console.log('Deleted document records from MongoDB');

        // 3.5 Delete voice-related data
        if (agent.type === 'voice') {
            const sessions = await VoiceSession.find({ agentId: agentId }, { _id: 1 });
            if (sessions.length > 0) {
                const sessionIds = sessions.map(s => s._id);
                const turnDel = await VoiceTurn.deleteMany({ sessionId: { $in: sessionIds } });
                console.log(`Deleted ${turnDel.deletedCount} voice turn(s)`);
            }
            const sessDel = await VoiceSession.deleteMany({ agentId: agentId });
            console.log(`Deleted ${sessDel.deletedCount} voice session(s)`);
            const epDel = await VoiceEndpoint.deleteMany({ agentId: agentId });
            console.log(`Deleted ${epDel.deletedCount} voice endpoint(s)`);
        }

        // 3.6 Delete catalog items, orders, and leads
        const catDel = await CatalogItem.deleteMany({ agentId: agentId });
        console.log(`Deleted ${catDel.deletedCount} catalog item(s)`);
        const ordDel = await Order.deleteMany({ agentId: agentId });
        console.log(`Deleted ${ordDel.deletedCount} order(s)`);
        const leadDel = await Lead.deleteMany({ agentId: agentId });
        console.log(`Deleted ${leadDel.deletedCount} lead(s)`);

        // 3.7 Delete campaigns and outbound contacts
        const campaigns = await Campaign.find({ agentId: agentId }, { _id: 1 });
        if (campaigns.length > 0) {
            const campaignIds = campaigns.map(c => c._id);
            const ocDel = await OutboundContact.deleteMany({ campaignId: { $in: campaignIds } });
            console.log(`Deleted ${ocDel.deletedCount} outbound contact(s)`);
        }
        const campDel = await Campaign.deleteMany({ agentId: agentId });
        console.log(`Deleted ${campDel.deletedCount} campaign(s)`);

        // 4. Delete the agent itself
        await Agent.findByIdAndDelete(agentId);
        console.log('Agent deleted successfully');

        recordWorkspaceAudit(req, {
            tenantId: tenantId!,
            actorId: req.user!.userId,
            action: 'agent.delete',
            targetType: 'agent',
            targetId: agentId,
            metadata: { name: agentName, type: agentType },
        });

        res.json({
            message: 'Agent and all associated data deleted successfully',
            deletedDocuments: documents.length
        });
    } catch (error) {
        console.error('======= ERROR DELETING AGENT =======');
        console.error('Error details:', error);
        res.status(500).json({ message: 'Error deleting agent' });
    }
};
