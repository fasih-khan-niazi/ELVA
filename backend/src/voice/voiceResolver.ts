import { VoiceEndpoint, IVoiceEndpoint } from './voiceModels';
import { Agent } from '../models';
import { voiceLog } from './voiceLogger';
import { normalizeVoiceLocale } from './voiceLanguage';
import { resolveAzureVoice } from './azureVoices';
import { GATHER_TIMEOUT_SEC } from './voiceLifecycle';
import { resolveWorkspaceCurrency } from '../utils/workspaceCurrency';

const log = voiceLog('resolver');

function resolveGatherTimeoutSec(agent: { responseConfig?: { gatherTimeoutSec?: number } } | null): number {
    const raw = agent?.responseConfig?.gatherTimeoutSec;
    const n = Number(raw);
    const base = Number.isFinite(n) ? n : GATHER_TIMEOUT_SEC;
    return Math.min(12, Math.max(2, Math.round(base)));
}

export interface ResolvedVoiceAgent {
    tenantId: string;
    agentId: string;
    /** Dashboard label — not spoken by the agent. */
    agentName: string;
    /** Persona / speaking identity used in voice replies. */
    speakingName: string;
    businessName: string;
    language: string;
    endpointId: string;
    prompt: string;
    tone: string;
    persona: { name: string; summary: string; speakingStyle: string };
    objectives: string[];
    capabilities: string[];
    guardrails: string;
    memoryConfig: { shortTermWindow: number; longTermEnabled: boolean };
    responseConfig: { temperature: number; maxTurns: number; fallbackMessage: string };
    firstMessage: string;
    sttProvider: string;
    ttsProvider: string;
    ttsVoice: string;
    ttsVoiceProvider: string;
    currency: string;
    callDirection: 'inbound' | 'outbound';
    transferNumber: string;
    outboundCallerId: string;
    voicemailDropUrl: string;
    /** Twilio <Gather> seconds of silence before end-of-input (clamped 2–12). */
    gatherTimeoutSec: number;
}

async function buildResolvedFromAgent(
    agent: {
        _id: { toString(): string };
        tenantId: { toString(): string };
        name: string;
        businessName?: string;
        prompt?: string;
        tone?: string;
        persona?: { name?: string; summary?: string; speakingStyle?: string };
        objectives?: string[];
        capabilities?: string[];
        guardrails?: string;
        memoryConfig?: { shortTermWindow?: number; longTermEnabled?: boolean };
        responseConfig?: {
            temperature?: number;
            maxTurns?: number;
            fallbackMessage?: string;
            gatherTimeoutSec?: number;
        };
        firstMessage?: string;
        sttProvider?: string;
        ttsProvider?: string;
        ttsVoice?: string;
        currency?: string;
        callDirection?: string;
        transferNumber?: string;
        outboundCallerId?: string;
        voicemailDropUrl?: string;
        ttsVoiceProvider?: string;
        language?: string;
    },
    opts: { endpointId: string; language: string },
): Promise<ResolvedVoiceAgent> {
    const tenantId = agent.tenantId.toString();
    const currency = await resolveWorkspaceCurrency(tenantId, agent.currency || 'USD');
    const speakingName = (agent.persona?.name || '').trim() || agent.name;

    return {
        tenantId,
        agentId: agent._id.toString(),
        agentName: agent.name,
        speakingName,
        businessName: agent.businessName || '',
        language: opts.language,
        endpointId: opts.endpointId,
        prompt: agent.prompt || '',
        tone: agent.tone || 'professional',
        persona: {
            name: speakingName,
            summary: agent.persona?.summary || '',
            speakingStyle: agent.persona?.speakingStyle || agent.tone || '',
        },
        objectives: agent.objectives || [],
        capabilities: agent.capabilities || [],
        guardrails: agent.guardrails || '',
        memoryConfig: {
            shortTermWindow: Math.max(6, agent.memoryConfig?.shortTermWindow ?? 6),
            longTermEnabled: agent.memoryConfig?.longTermEnabled ?? false,
        },
        responseConfig: {
            temperature: agent.responseConfig?.temperature ?? 0.35,
            maxTurns: Math.max(30, agent.responseConfig?.maxTurns ?? 30),
            fallbackMessage:
                agent.responseConfig?.fallbackMessage ||
                'I am going to connect you with one of my teammates for more help.',
        },
        firstMessage: agent.firstMessage || 'Hello! How can I help you today?',
        sttProvider: agent.sttProvider || 'twilio',
        ttsProvider: agent.ttsProvider || 'twilio',
        ttsVoice: resolveAzureVoice(agent.ttsVoice, opts.language),
        ttsVoiceProvider: agent.ttsVoiceProvider || 'twilio',
        currency,
        callDirection: (agent.callDirection as 'inbound' | 'outbound') || 'inbound',
        transferNumber: agent.transferNumber || '',
        outboundCallerId: agent.outboundCallerId || '',
        voicemailDropUrl: agent.voicemailDropUrl || '',
        gatherTimeoutSec: resolveGatherTimeoutSec(agent),
    };
}

/**
 * Resolve a Twilio "To" number to the tenant + agent that owns it.
 * Returns null if no active mapping exists.
 */
export async function resolveAgentByPhone(
    toNumber: string,
): Promise<ResolvedVoiceAgent | null> {
    if (!toNumber) return null;

    // Normalize: strip any whitespace
    const normalized = toNumber.replace(/\s+/g, '');

    const endpoint: IVoiceEndpoint | null = await VoiceEndpoint.findOne({
        phoneNumber: normalized,
        isActive: true,
    });

    if (!endpoint) {
        log.debug('no-endpoint', { detail: { phoneNumber: normalized } });
        return null;
    }

    const agent = await Agent.findById(endpoint.agentId);
    if (!agent) {
        log.warn('agent-missing', { detail: { agentId: endpoint.agentId.toString(), phoneNumber: normalized } });
        return null;
    }

    // Tenant safety: agent must belong to the endpoint's tenant
    if (agent.tenantId.toString() !== endpoint.tenantId.toString()) {
        log.error('tenant-mismatch', {
            detail: { endpointTenant: endpoint.tenantId.toString(), agentTenant: agent.tenantId.toString() },
        });
        return null;
    }

    const language = normalizeVoiceLocale(
        endpoint.language || agent.language,
        agent.ttsVoice,
    );

    return buildResolvedFromAgent(agent, {
        endpointId: endpoint._id.toString(),
        language,
    });
}

/**
 * Resolve an agent directly by its Mongo _id (for browser-based calls).
 * Returns null if the agent doesn't exist or does not belong to the given tenant.
 */
export async function resolveAgentById(
    agentId: string,
    tenantId: string,
): Promise<ResolvedVoiceAgent | null> {
    const agent = await Agent.findById(agentId);
    if (!agent) {
        log.debug('agent-not-found', { agentId });
        return null;
    }

    if (agent.tenantId.toString() !== tenantId) {
        log.error('tenant-mismatch', {
            tenantId,
            agentId,
            detail: { agentTenant: agent.tenantId.toString() },
        });
        return null;
    }

    if (agent.type !== 'voice') {
        log.debug('not-voice-agent', { agentId });
        return null;
    }

    const language = normalizeVoiceLocale(agent.language, agent.ttsVoice);

    return buildResolvedFromAgent(agent, { endpointId: '', language });
}
