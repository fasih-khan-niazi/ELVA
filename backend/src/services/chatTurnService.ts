import axios from 'axios';
import { ChatSession, IAgent } from '../models';
import { getAiServiceSecretHeaders } from '../utils/aiServiceSecret';

import { resolveWorkspaceCurrency } from '../utils/workspaceCurrency';

const AI_SERVICE_URL = process.env.AI_SERVICE_URL || 'http://localhost:8000';

export type ChatSessionSource = 'dashboard' | 'embed' | 'api';

export interface ExecuteChatTurnResult {
    response: string;
    context?: unknown;
    reasoning?: unknown;
    plan?: unknown;
    intent?: unknown;
    citations?: unknown;
    retrievalMetrics?: unknown;
    orderEvent?: unknown;
    orderState?: unknown;
    leadEvent?: unknown;
    leadState?: unknown;
    latencyMs: number;
    timings?: unknown;
    agent: { id: unknown; name: string; type: string };
}

/** One user message + assistant reply, AI call + ChatSession persistence (matches authenticated /api/chat/message). */
export async function executeChatMessageTurn(input: {
    tenantId: string;
    agent: IAgent;
    agentId: string;
    message: string;
    sessionId: string;
    sessionSource: ChatSessionSource;
}): Promise<
    | { ok: true; data: ExecuteChatTurnResult }
    | { ok: false; status: number; message: string; aiUnavailable?: boolean }
> {
    const { tenantId, agent, agentId, message, sessionId, sessionSource } = input;

    const botCharacterName = (agent.persona?.name?.trim()) || agent.name;
    const currency = await resolveWorkspaceCurrency(tenantId, agent.currency || 'USD');
    const aiStartedAt = Date.now();

    try {
        const aiResponse = await axios.post(
            `${AI_SERVICE_URL}/chat`,
            {
                query: message,
                tenant_id: tenantId,
                agent_id: agentId,
                session_id: sessionId,
                system_prompt: agent.prompt,
                agent_name: botCharacterName,
                business_name: agent.businessName || '',
                tone: agent.tone,
                persona: agent.persona,
                objectives: agent.objectives,
                capabilities: agent.capabilities,
                guardrails: agent.guardrails,
                memoryConfig: agent.memoryConfig,
                responseConfig: agent.responseConfig,
                channel: 'chat',
                currency,
                first_message: agent.firstMessage || '',
            },
            { timeout: 120000, headers: getAiServiceSecretHeaders() },
        );

        const aiData = aiResponse.data;
        const aiText: string = aiData.response;
        const latencyMs = Date.now() - aiStartedAt;

        try {
            const existing = await ChatSession.findOne({ sessionId });
            if (!existing) {
                await ChatSession.create({
                    sessionId,
                    agentId,
                    tenantId,
                    title: message.slice(0, 60).trim() || 'New Conversation',
                    messages: [
                        { role: 'user', content: message, timestamp: new Date() },
                        { role: 'assistant', content: aiText, timestamp: new Date(), latencyMs },
                    ],
                    messageCount: 2,
                    source: sessionSource,
                });
            } else {
                await ChatSession.findOneAndUpdate(
                    { sessionId },
                    {
                        $push: {
                            messages: {
                                $each: [
                                    { role: 'user', content: message, timestamp: new Date() },
                                    {
                                        role: 'assistant',
                                        content: aiText,
                                        timestamp: new Date(),
                                        latencyMs,
                                    },
                                ],
                            },
                        },
                        $inc: { messageCount: 2 },
                        $set: { updatedAt: new Date() },
                    },
                );
            }
        } catch (sessionErr) {
            console.error('[CHAT] Session persistence error:', sessionErr);
        }

        return {
            ok: true,
            data: {
                response: aiText,
                context: aiData.context,
                reasoning: aiData.reasoning,
                plan: aiData.plan,
                intent: aiData.intent,
                citations: aiData.citations,
                retrievalMetrics: aiData.retrievalMetrics,
                orderEvent: aiData.orderEvent ?? null,
                orderState: aiData.orderState ?? null,
                leadEvent: aiData.leadEvent ?? null,
                leadState: aiData.leadState ?? null,
                latencyMs,
                timings: aiData.timings ?? null,
                agent: {
                    id: agent._id,
                    name: agent.name,
                    type: agent.type,
                },
            },
        };
    } catch (aiError: any) {
        console.error('[CHAT] AI service error:', aiError.message);
        if (aiError.code === 'ECONNREFUSED') {
            return { ok: false, status: 503, message: 'AI service is not available.', aiUnavailable: true };
        }
        return { ok: false, status: 500, message: aiError.message || 'AI error' };
    }
}
