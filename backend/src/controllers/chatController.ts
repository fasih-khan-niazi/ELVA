import { Response } from 'express';
import { Agent, ChatSession } from '../models';
import { AuthRequest } from '../middleware/authMiddleware';
import { executeChatMessageTurn } from '../services/chatTurnService';
import { consumeMessageForTenant } from '../services/messageQuotaService';

interface ChatRequest {
    agentId: string;
    message: string;
    sessionId?: string;
}

export const sendMessage = async (req: AuthRequest, res: Response) => {
    try {
        console.log('======= CHAT MESSAGE REQUEST =======');
        console.log('Timestamp:', new Date().toISOString());
        console.log('User ID:', req.user?.userId);
        console.log('Tenant ID:', req.user?.tenantId);

        const { agentId, message, sessionId } = req.body as ChatRequest;
        const tenantId = req.user?.tenantId;

        if (!tenantId) {
            return res.status(400).json({ message: 'Tenant ID not found' });
        }
        if (!agentId || !message) {
            return res.status(400).json({ message: 'Agent ID and message are required' });
        }

        const agent = await Agent.findById(agentId);
        if (!agent) {
            return res.status(404).json({ message: 'Agent not found' });
        }
        if (agent.tenantId.toString() !== tenantId) {
            return res.status(403).json({ message: 'Unauthorized access to agent' });
        }

        const resolvedSessionId = sessionId || `session_${Date.now()}`;

        const turn = await executeChatMessageTurn({
            tenantId,
            agent,
            agentId,
            message,
            sessionId: resolvedSessionId,
            sessionSource: 'dashboard',
        });

        if (!turn.ok) {
            if (turn.aiUnavailable) {
                return res.status(503).json({ message: turn.message });
            }
            return res.status(turn.status).json({ message: turn.message });
        }

        const d = turn.data;
        await consumeMessageForTenant(tenantId);
        return res.json({
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
    } catch (error: any) {
        console.error('[CHAT] Error:', error);
        return res.status(500).json({ message: 'Error processing chat message', error: error.message });
    }
};

export const getSessions = async (req: AuthRequest, res: Response) => {
    try {
        const { agentId } = req.params;
        const tenantId = req.user?.tenantId;

        if (!tenantId) return res.status(400).json({ message: 'Tenant ID not found' });

        const agent = await Agent.findById(agentId);
        if (!agent || agent.tenantId.toString() !== tenantId) {
            return res.status(404).json({ message: 'Agent not found' });
        }

        const sessions = await ChatSession.find({ agentId, tenantId })
            .select('sessionId title messageCount createdAt updatedAt source')
            .sort({ updatedAt: -1 })
            .limit(50)
            .lean();

        return res.json(sessions);
    } catch (error: any) {
        console.error('[CHAT] getSessions error:', error);
        return res.status(500).json({ message: 'Error fetching sessions' });
    }
};

export const getSessionMessages = async (req: AuthRequest, res: Response) => {
    try {
        const { agentId, sessionId } = req.params;
        const tenantId = req.user?.tenantId;

        if (!tenantId) return res.status(400).json({ message: 'Tenant ID not found' });

        const session = await ChatSession.findOne({ sessionId, agentId, tenantId }).lean();
        if (!session) return res.status(404).json({ message: 'Session not found' });

        return res.json(session);
    } catch (error: any) {
        console.error('[CHAT] getSessionMessages error:', error);
        return res.status(500).json({ message: 'Error fetching session messages' });
    }
};
