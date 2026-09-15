import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { Agent, Tenant, Subscription } from '../models';
import { executeChatMessageTurn } from '../services/chatTurnService';
import { checkMessageQuotaForTenant, consumeMessageForTenant } from '../services/messageQuotaService';

function parseEmbedBearer(req: Request): { keyId: string; secret: string } | null {
    const auth = req.headers.authorization;
    if (!auth?.startsWith('Bearer ')) return null;
    const raw = auth.slice(7).trim();
    const dot = raw.indexOf('.');
    if (dot <= 0 || dot === raw.length - 1) return null;
    return { keyId: raw.slice(0, dot), secret: raw.slice(dot + 1) };
}

function normalizeOriginUrl(s: string): string {
    try {
        const u = new URL(s);
        return `${u.protocol}//${u.host}`;
    } catch {
        return s.trim().replace(/\/$/, '');
    }
}

function originAllowed(agent: {
    chatEmbedAllowedOrigins?: string[];
}, req: Request): boolean {
    const list = agent.chatEmbedAllowedOrigins || [];
    if (list.length === 0) return true;
    const origin = req.get('Origin');
    if (!origin) return true;
    const norm = normalizeOriginUrl(origin);
    return list.some((o) => normalizeOriginUrl(o) === norm);
}

async function loadSubscriptionGate(tenantId: string): Promise<{ ok: true } | { ok: false; status: number; body: object }> {
    const sub = await Subscription.findOne({ tenantId });
    if (sub?.status === 'past_due') {
        return {
            ok: false,
            status: 402,
            body: {
                message: 'This workspace subscription is past due. Chat is temporarily unavailable.',
                error: 'SUBSCRIPTION_PAST_DUE',
            },
        };
    }
    return { ok: true };
}

/**
 * GET /api/public/chat/config
 * Authorization: Bearer {keyId}.{secret}
 * Safe display fields for the embed widget (no KB secrets).
 */
export async function getPublicChatConfig(req: Request, res: Response): Promise<void> {
    try {
        const parsed = parseEmbedBearer(req);
        if (!parsed) {
            res.status(401).json({ message: 'Missing or invalid Authorization Bearer token' });
            return;
        }

        const agent = await Agent.findOne({ chatEmbedKeyId: parsed.keyId }).select(
            '+chatEmbedSecretHash chatEmbedPublished type tenantId name businessName firstMessage chatEmbedAllowedOrigins',
        );

        if (!agent || agent.type !== 'chat' || !agent.chatEmbedPublished) {
            res.status(404).json({ message: 'Agent not available' });
            return;
        }

        if (!agent.chatEmbedSecretHash || !bcrypt.compareSync(parsed.secret, agent.chatEmbedSecretHash)) {
            res.status(401).json({ message: 'Invalid credentials' });
            return;
        }

        if (!originAllowed(agent, req)) {
            res.status(403).json({ message: 'Origin not allowed for this embed' });
            return;
        }

        const tenant = await Tenant.findById(agent.tenantId);
        if (tenant?.accessSuspendedUntil && tenant.accessSuspendedUntil > new Date()) {
            res.status(403).json({ message: 'Workspace temporarily unavailable' });
            return;
        }

        res.json({
            agentName: agent.name,
            businessName: agent.businessName || '',
            firstMessage: agent.firstMessage || '',
        });
    } catch (e: any) {
        console.error('[PUBLIC-CHAT][config]', e?.message);
        res.status(500).json({ message: 'Server error' });
    }
}

/**
 * POST /api/public/chat/message
 * Body: { message: string, sessionId?: string, client?: 'embed' | 'api' }
 * Authorization: Bearer {keyId}.{secret}
 */
export async function postPublicChatMessage(req: Request, res: Response): Promise<void> {
    try {
        const parsed = parseEmbedBearer(req);
        if (!parsed) {
            res.status(401).json({ message: 'Missing or invalid Authorization Bearer token' });
            return;
        }

        const { message, sessionId: bodySid, client } = req.body as {
            message?: string;
            sessionId?: string;
            client?: 'embed' | 'api';
        };

        if (!message || typeof message !== 'string' || !message.trim()) {
            res.status(400).json({ message: 'message is required' });
            return;
        }

        const agent = await Agent.findOne({ chatEmbedKeyId: parsed.keyId }).select(
            '+chatEmbedSecretHash chatEmbedPublished type tenantId chatEmbedAllowedOrigins',
        );

        if (!agent || agent.type !== 'chat' || !agent.chatEmbedPublished) {
            res.status(404).json({ message: 'Agent not available' });
            return;
        }

        if (!agent.chatEmbedSecretHash || !bcrypt.compareSync(parsed.secret, agent.chatEmbedSecretHash)) {
            res.status(401).json({ message: 'Invalid credentials' });
            return;
        }

        if (!originAllowed(agent, req)) {
            res.status(403).json({ message: 'Origin not allowed for this embed' });
            return;
        }

        const tenantId = agent.tenantId.toString();

        const tenant = await Tenant.findById(agent.tenantId);
        if (tenant?.accessSuspendedUntil && tenant.accessSuspendedUntil > new Date()) {
            res.status(403).json({ message: 'Workspace temporarily unavailable' });
            return;
        }

        const subGate = await loadSubscriptionGate(tenantId);
        if (!subGate.ok) {
            res.status(subGate.status).json(subGate.body);
            return;
        }

        const quota = await checkMessageQuotaForTenant(tenantId);
        if (!quota.ok) {
            res.status(quota.status).json(quota.body);
            return;
        }

        const agentId = String(agent._id);
        const resolvedSessionId =
            bodySid && typeof bodySid === 'string' && bodySid.trim()
                ? bodySid.trim()
                : `session_pub_${agentId}_${Date.now()}`;

        const sessionSource = client === 'api' ? 'api' : 'embed';

        const turn = await executeChatMessageTurn({
            tenantId,
            agent,
            agentId,
            message: message.trim(),
            sessionId: resolvedSessionId,
            sessionSource,
        });

        if (!turn.ok) {
            if (turn.aiUnavailable) {
                res.status(503).json({ message: turn.message });
                return;
            }
            res.status(turn.status).json({ message: turn.message });
            return;
        }

        const d = turn.data;
        await consumeMessageForTenant(tenantId);
        res.json({
            sessionId: resolvedSessionId,
            response: d.response,
            context: d.context,
            reasoning: d.reasoning,
            plan: d.plan,
            intent: d.intent,
            citations: d.citations,
            retrievalMetrics: d.retrievalMetrics,
            orderEvent: d.orderEvent ?? null,
            orderState: d.orderState ?? null,
            leadEvent: d.leadEvent ?? null,
            leadState: d.leadState ?? null,
            latencyMs: d.latencyMs,
            timings: d.timings ?? null,
            agent: d.agent,
        });
    } catch (e: any) {
        console.error('[PUBLIC-CHAT][message]', e?.message);
        res.status(500).json({ message: 'Error processing message' });
    }
}
