import axios from 'axios';
import { VoiceSession, VoiceTurn, IVoiceSession } from './voiceModels';
import { resolveAgentByPhone, resolveAgentById, ResolvedVoiceAgent } from './voiceResolver';
import { calculateTurnLatencyMs, isWithinTurnLatencySlo } from './voiceMetrics';
import {
    VOICE_MVP_CONTRACT,
    VoiceInboundPayload,
    VoiceTurnOutcome,
} from './voiceContract';
import { buildVoiceSystemPrompt, extractOutboundSignals } from './voicePromptAdapter';
import { guardVoiceResponse, isEmptyOrGarbage } from './voiceResponseGuard';
import { AI_TIMEOUT_MS, AI_FIRST_SENTENCE_MS } from './voiceLifecycle';
import { voiceLog } from './voiceLogger';
import { recordTurn, recordCallStart, recordCallEnd } from './voiceMetricsCollector';
import { getAiServiceSecretHeaders } from '../utils/aiServiceSecret';
import { terminalLog } from '../utils/terminalLog';
import { generateStreamToken } from '../utils/streamToken';

const log = voiceLog('orchestrator');
const AI_SERVICE_URL = process.env.AI_SERVICE_URL || 'http://localhost:8000';

// ─── AI health check ──────────────────────────────────────────────────────

let _aiHealthy = true;
let _lastHealthCheck = 0;
const HEALTH_CHECK_INTERVAL_MS = 30_000; // 30 s

/**
 * Lightweight health probe - called before each voice turn.
 * Caches result for HEALTH_CHECK_INTERVAL_MS to avoid hammering.
 */
export async function checkAiHealth(): Promise<boolean> {
    const now = Date.now();
    if (now - _lastHealthCheck < HEALTH_CHECK_INTERVAL_MS) return _aiHealthy;

    try {
        const resp = await axios.get(`${AI_SERVICE_URL}/`, { timeout: 3000 });
        _aiHealthy = resp.status === 200;
    } catch {
        _aiHealthy = false;
    }
    _lastHealthCheck = now;
    log.debug('ai-health-check', { detail: { healthy: _aiHealthy } });
    return _aiHealthy;
}

/** Expose for admin dashboard. */
export function getAiHealthStatus(): { healthy: boolean; checkedAt: number } {
    return { healthy: _aiHealthy, checkedAt: _lastHealthCheck };
}

// ─── Last-turn cache (for "repeat" requests) ─────────────────────────────

const _lastTurnCache = new Map<string, string>(); // callSid → last AI text

export function cacheLastTurn(callSid: string, aiText: string): void {
    _lastTurnCache.set(callSid, aiText);
}

export function getLastTurn(callSid: string): string | undefined {
    return _lastTurnCache.get(callSid);
}

export function clearLastTurn(callSid: string): void {
    _lastTurnCache.delete(callSid);
}

// ─── Session management ───────────────────────────────────────────────────

export async function getOrCreateSession(
    callSid: string,
    resolved: ResolvedVoiceAgent,
    from: string,
    to: string,
    channel: 'phone' | 'web' = 'phone',
): Promise<IVoiceSession> {
    let session = await VoiceSession.findOne({ callSid });
    if (!session) {
        session = await VoiceSession.create({
            callSid,
            tenantId: resolved.tenantId,
            agentId: resolved.agentId,
            endpointId: resolved.endpointId || undefined,
            channel,
            // For inbound: `from` is the caller, `to` is the business number.
            // For outbound, the backend passes callee as `from` and a synthetic
            // route id as `to` so `session.from` still yields a phone-like value
            // for PKR pre-seed / caller id — not an accident.
            from,
            to,
            status: 'in-progress',
            turnCount: 0,
            totalLatencyMs: 0,
            streamToken: generateStreamToken(),
        });
        log.info('session-created', { callSid, agentId: resolved.agentId, channel, tenantId: resolved.tenantId });
        recordCallStart(channel);
    } else if (!session.streamToken) {
        session.streamToken = generateStreamToken();
        await session.save();
    }
    return session;
}

// ─── Agent resolution ─────────────────────────────────────────────────────

export { resolveAgentByPhone, resolveAgentById, ResolvedVoiceAgent };

// ─── AI turn processing ───────────────────────────────────────────────────

export interface TurnInput {
    callSid: string;
    speechResult: string;
    confidence?: number;
    session: IVoiceSession;
    resolved: ResolvedVoiceAgent;
    campaignMode?: boolean;
}

export interface TurnResult {
    aiText: string;
    intent?: string;
    turnIndex: number;
    turnLatencyMs: number;
    sloOk: boolean;
    callbackWhen?: string;
    bant?: { budget: number; authority: number; need: number; timeline: number };
    orderDetailStep?: string;
    reviewConfirmLine?: string;
    orderSnapshot?: Record<string, unknown>;
}

export interface StreamSentenceMeta {
    index: number;
    firstSentenceMs?: number;
}

export interface VoiceStreamCallbacks {
    onSentence: (text: string, meta: StreamSentenceMeta) => void | Promise<void>;
    /** Timestamp when Deepgram emitted the final transcript (before debounce). */
    deepgramFinalAt?: number;
    /** Timestamp when utterance debounce completed and LLM was invoked. */
    debounceCompleteAt?: number;
    onTtsFirstByte?: (msFromDebounce: number) => void;
}

export interface VoiceStreamOptions {
    abortSignal?: AbortSignal;
}

function mergeAbortSignals(...signals: AbortSignal[]): AbortSignal {
    const controller = new AbortController();
    const onAbort = () => controller.abort();
    for (const signal of signals) {
        if (signal.aborted) {
            controller.abort();
            return controller.signal;
        }
        signal.addEventListener('abort', onAbort, { once: true });
    }
    return controller.signal;
}

function parseSseBlocks(buffer: string): { events: Array<{ event: string; data: string }>; rest: string } {
    const events: Array<{ event: string; data: string }> = [];
    const parts = buffer.split('\n\n');
    const rest = parts.pop() ?? '';
    for (const block of parts) {
        if (!block.trim()) continue;
        let event = 'message';
        let data = '';
        for (const line of block.split('\n')) {
            if (line.startsWith('event:')) event = line.slice(6).trim();
            if (line.startsWith('data:')) data += line.slice(5).trim();
        }
        if (data) events.push({ event, data });
    }
    return { events, rest };
}

async function readStreamChunk(
    reader: ReadableStreamDefaultReader<Uint8Array>,
    deadlineMs: number,
    abortSignal?: AbortSignal,
): Promise<ReadableStreamReadResult<Uint8Array>> {
    if (abortSignal?.aborted) {
        const err = new Error('Turn aborted');
        err.name = 'AbortError';
        throw err;
    }
    if (deadlineMs <= 0) {
        throw new Error('AI stream timeout — no response in time');
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    let onAbort: (() => void) | undefined;
    try {
        return await Promise.race([
            reader.read(),
            new Promise<never>((_, reject) => {
                timer = setTimeout(
                    () => reject(new Error('AI stream timeout — waiting for response')),
                    deadlineMs,
                );
            }),
            ...(abortSignal
                ? [new Promise<never>((_, reject) => {
                    onAbort = () => {
                        const err = new Error('Turn aborted');
                        err.name = 'AbortError';
                        reject(err);
                    };
                    abortSignal.addEventListener('abort', onAbort, { once: true });
                })]
                : []),
        ]);
    } finally {
        if (timer) clearTimeout(timer);
        if (abortSignal && onAbort) abortSignal.removeEventListener('abort', onAbort);
    }
}

function buildVoiceChatPayload(input: TurnInput, resolved: ResolvedVoiceAgent, campaignMode?: boolean) {
    const voicePrompt = campaignMode
        ? (resolved.prompt || '')
        : buildVoiceSystemPrompt(resolved);
    return {
        query: input.speechResult,
        tenant_id: resolved.tenantId,
        agent_id: resolved.agentId,
        session_id: input.callSid,
        system_prompt: voicePrompt,
        agent_name: resolved.speakingName,
        business_name: resolved.businessName,
        tone: resolved.tone,
        persona: resolved.persona,
        objectives: resolved.objectives,
        capabilities: resolved.capabilities,
        guardrails: resolved.guardrails,
        memoryConfig: resolved.memoryConfig,
        responseConfig: resolved.responseConfig,
        channel: 'voice',
        caller_phone: input.session.from || '',
        currency: resolved.currency || 'USD',
        campaign_mode: campaignMode === true,
    };
}

/** Overwrite persisted turn text with what was actually spoken (post-TTS sync). */
export async function syncVoiceTurnSpokenText(
    callSid: string,
    turnIndex: number,
    spokenParts: string[],
): Promise<void> {
    if (!spokenParts.length || turnIndex < 1) return;
    const spoken = guardVoiceResponse(spokenParts.join(' '));
    if (!spoken.trim()) return;
    await VoiceTurn.findOneAndUpdate({ callSid, turnIndex }, { aiResponse: spoken });
    cacheLastTurn(callSid, spoken);
}

async function persistSuccessfulTurn(
    input: TurnInput,
    aiText: string,
    intent: string | undefined,
    turnLatencyMs: number,
    sloOk: boolean,
    extra?: {
        firstAudioMs?: number;
        orderSnapshot?: Record<string, unknown>;
        sttDebounceMs?: number;
        llmFirstSentenceMs?: number;
        ttsFirstByteMs?: number;
    },
): Promise<TurnResult> {
    const { callSid, speechResult, confidence, session } = input;
    const newTurnIndex = session.turnCount + 1;
    cacheLastTurn(callSid, aiText);

    await VoiceTurn.create({
        sessionId: session._id,
        callSid,
        turnIndex: newTurnIndex,
        inputTranscript: speechResult,
        inputConfidence: confidence,
        aiResponse: aiText,
        intent,
        latencyMs: turnLatencyMs,
        sloOk,
        ...(extra?.firstAudioMs != null ? { firstAudioMs: extra.firstAudioMs } : {}),
        ...(extra?.sttDebounceMs != null ? { sttDebounceMs: extra.sttDebounceMs } : {}),
        ...(extra?.llmFirstSentenceMs != null ? { llmFirstSentenceMs: extra.llmFirstSentenceMs } : {}),
        ...(extra?.ttsFirstByteMs != null ? { ttsFirstByteMs: extra.ttsFirstByteMs } : {}),
    });

    session.turnCount = newTurnIndex;
    session.totalLatencyMs += turnLatencyMs;
    if (extra?.orderSnapshot) {
        (session as any).orderSnapshot = extra.orderSnapshot;
    }
    await session.save();

    recordTurn({
        latencyMs: turnLatencyMs,
        sloOk,
        isError: false,
        channel: session.channel as 'phone' | 'web',
    });

    return {
        aiText,
        intent,
        turnIndex: newTurnIndex,
        turnLatencyMs,
        sloOk,
    };
}

export async function processVoiceTurnStreaming(
    input: TurnInput,
    callbacks: VoiceStreamCallbacks,
    opts?: VoiceStreamOptions,
): Promise<TurnResult> {
    const debounceCompleteAt = callbacks.debounceCompleteAt ?? Date.now();
    const receivedAt = debounceCompleteAt;
    const sttDebounceMs =
        callbacks.deepgramFinalAt != null
            ? Math.max(0, debounceCompleteAt - callbacks.deepgramFinalAt)
            : undefined;
    const { callSid, speechResult, confidence, session, resolved, campaignMode } = input;
    const abortSignal = opts?.abortSignal;

    const payload = buildVoiceChatPayload(input, resolved, campaignMode);
    const headers = {
        'Content-Type': 'application/json',
        ...getAiServiceSecretHeaders(),
    };

    terminalLog.voice('AI', `Stream turn → "${speechResult.slice(0, 50)}${speechResult.length > 50 ? '…' : ''}"`);

    const timeoutSignal = AbortSignal.timeout(AI_TIMEOUT_MS + 5_000);
    const combinedSignal = abortSignal
        ? mergeAbortSignals(timeoutSignal, abortSignal)
        : timeoutSignal;

    const resp = await fetch(`${AI_SERVICE_URL}/chat/stream`, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        signal: combinedSignal,
    });

    if (!resp.ok || !resp.body) {
        throw new Error(`Stream chat failed: HTTP ${resp.status}`);
    }

    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let sseBuffer = '';
    let donePayload: any = null;
    let sentenceIndex = 0;
    let firstAudioMs: number | undefined;
    let gotFirstSentence = false;
    let ttsFirstByteMs: number | undefined;
    let llmFirstSentenceMs: number | undefined;

    while (true) {
        const elapsed = Date.now() - receivedAt;
        const deadline = gotFirstSentence
            ? AI_TIMEOUT_MS - elapsed
            : AI_FIRST_SENTENCE_MS - elapsed;

        const { done, value } = await readStreamChunk(reader, deadline, combinedSignal);
        if (done) break;
        sseBuffer += decoder.decode(value, { stream: true });
        const parsed = parseSseBlocks(sseBuffer);
        sseBuffer = parsed.rest;

        for (const evt of parsed.events) {
            if (evt.event === 'started') {
                terminalLog.dim('AI stream connected');
                continue;
            }
            if (evt.event === 'sentence') {
                const { text } = JSON.parse(evt.data);
                if (!text?.trim()) continue;
                const meta: StreamSentenceMeta = {
                    index: sentenceIndex,
                    firstSentenceMs: sentenceIndex === 0 ? Date.now() - receivedAt : undefined,
                };
                if (sentenceIndex === 0) {
                    firstAudioMs = meta.firstSentenceMs;
                    llmFirstSentenceMs = meta.firstSentenceMs;
                    gotFirstSentence = true;
                    terminalLog.voice('STREAM', `First sentence at ${firstAudioMs}ms`);
                }
                void Promise.resolve(callbacks.onSentence(text.trim(), meta)).then(() => {
                    if (sentenceIndex === 0 && callbacks.onTtsFirstByte && ttsFirstByteMs == null) {
                        ttsFirstByteMs = Date.now() - debounceCompleteAt - (firstAudioMs || 0);
                        callbacks.onTtsFirstByte(ttsFirstByteMs);
                    }
                });
                sentenceIndex += 1;
            } else if (evt.event === 'done') {
                donePayload = JSON.parse(evt.data);
            } else if (evt.event === 'error') {
                const err = JSON.parse(evt.data);
                throw new Error(err.message || 'Stream error');
            }
        }
    }

    if (!gotFirstSentence) {
        throw new Error('AI stream ended without a spoken response');
    }

    const aiRespondedAt = Date.now();
    const turnLatencyMs = calculateTurnLatencyMs({ receivedAt, aiRespondedAt });
    const sloOk = isWithinTurnLatencySlo(turnLatencyMs);

    let aiText: string = donePayload?.response || '';
    let intent: string | undefined = donePayload?.intent;
    const signals = extractOutboundSignals(aiText);
    aiText = signals.cleanText;
    if (signals.intent && !intent) intent = signals.intent;
    aiText = guardVoiceResponse(aiText);
    if (isEmptyOrGarbage(aiText)) {
        aiText = resolved.responseConfig?.fallbackMessage
            || 'I\'m sorry, I wasn\'t able to find an answer. Could you rephrase your question?';
    }

    const result: TurnResult = {
        aiText,
        intent,
        turnIndex: session.turnCount + 1,
        turnLatencyMs,
        sloOk,
        callbackWhen: signals.callbackWhen,
        bant: signals.bant,
        orderDetailStep: donePayload?.orderDetailStep as string | undefined,
        reviewConfirmLine: donePayload?.reviewConfirmLine as string | undefined,
        orderSnapshot: donePayload?.orderState as Record<string, unknown> | undefined,
    };

    void persistSuccessfulTurn(
        input,
        aiText,
        intent,
        turnLatencyMs,
        sloOk,
        {
            firstAudioMs,
            orderSnapshot: donePayload?.orderState as Record<string, unknown> | undefined,
            sttDebounceMs,
            llmFirstSentenceMs,
            ttsFirstByteMs,
        },
    ).catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        terminalLog.err('ORCHESTRATOR', `Persist turn failed: ${msg}`);
    });

    terminalLog.voice('TURN', `${callSid.slice(0, 10)}… ${turnLatencyMs}ms · ${sentenceIndex} sentences · SLO ${sloOk ? 'OK' : 'slow'}${firstAudioMs != null ? ` · first audio ${firstAudioMs}ms` : ''}${sttDebounceMs != null ? ` · debounce ${sttDebounceMs}ms` : ''}`);

    return result;
}

export async function processVoiceTurn(input: TurnInput): Promise<TurnResult> {
    const receivedAt = Date.now();
    const { callSid, speechResult, confidence, session, resolved, campaignMode } = input;

    const aiResponse = await axios.post(
        `${AI_SERVICE_URL}/chat`,
        buildVoiceChatPayload(input, resolved, campaignMode),
        { timeout: AI_TIMEOUT_MS, headers: getAiServiceSecretHeaders() },
    );

    const aiRespondedAt = Date.now();
    const turnLatencyMs = calculateTurnLatencyMs({ receivedAt, aiRespondedAt });
    const sloOk = isWithinTurnLatencySlo(turnLatencyMs);

    let aiText: string = aiResponse.data.response || 'I could not generate a response.';
    let intent: string | undefined = aiResponse.data.intent;

    const signals = extractOutboundSignals(aiText);
    aiText = signals.cleanText;
    if (signals.intent && !intent) intent = signals.intent;
    const callbackWhen = signals.callbackWhen;
    const bant = signals.bant;

    aiText = guardVoiceResponse(aiText);

    if (isEmptyOrGarbage(aiText)) {
        aiText = resolved.responseConfig?.fallbackMessage
            || 'I\'m sorry, I wasn\'t able to find an answer. Could you rephrase your question?';
    }

    const result = await persistSuccessfulTurn(input, aiText, intent, turnLatencyMs, sloOk);

    const turnOutcome: VoiceTurnOutcome = {
        callSid,
        tenantId: resolved.tenantId,
        agentId: resolved.agentId,
        inputTranscript: speechResult,
        inputConfidence: confidence,
        aiResponse: aiText,
        createdAtIso: new Date().toISOString(),
    };

    terminalLog.voice('TURN', `${callSid.slice(0, 10)}… ${turnLatencyMs}ms · SLO ${sloOk ? 'OK' : 'slow'}${intent ? ` · ${intent}` : ''}`);

    log.info('turn-processed', {
        callSid,
        tenantId: resolved.tenantId,
        agentId: resolved.agentId,
        latencyMs: turnLatencyMs,
        sloOk,
        turnIndex: result.turnIndex,
        detail: { intent, confidence },
    });

    return { ...result, callbackWhen, bant };
}

// ─── Error turn persistence ───────────────────────────────────────────────

export async function persistErrorTurn(
    session: IVoiceSession,
    callSid: string,
    speechResult: string,
    confidence: number | undefined,
    latencyMs: number,
    error: string,
): Promise<void> {
    await VoiceTurn.create({
        sessionId: session._id,
        callSid,
        turnIndex: session.turnCount + 1,
        inputTranscript: speechResult,
        inputConfidence: confidence,
        aiResponse: error || 'Error processing request',
        latencyMs,
        sloOk: false,
        error,
    });
    session.turnCount += 1;
    await session.save();

    log.warn('error-turn', {
        callSid,
        latencyMs,
        error,
    });
    recordTurn({
        latencyMs,
        sloOk: false,
        isError: true,
        channel: session.channel as 'phone' | 'web',
    });
}

// ─── Status callback handling ─────────────────────────────────────────────

export async function handleStatusCallback(
    payload: VoiceInboundPayload & { CallDuration?: string },
): Promise<void> {
    const { CallSid: callSid, CallStatus: status, CallDuration } = payload;

    if (!callSid) return;

    const session = await VoiceSession.findOne({ callSid });
    if (!session) return;

    const validStatuses = [
        'initiated', 'ringing', 'in-progress',
        'completed', 'failed', 'busy', 'no-answer', 'canceled',
    ];

    if (status && validStatuses.includes(status)) {
        session.status = status as typeof session.status;
    }

    const terminalStatuses = ['completed', 'failed', 'busy', 'no-answer', 'canceled'];
    if (terminalStatuses.includes(status || '')) {
        session.endedAt = new Date();
        if (CallDuration) {
            session.durationSec = parseInt(CallDuration, 10) || 0;
        }
        // If no endReason was already set by the controller (goodbye / max_turns / etc.),
        // the caller hung up or the call ended externally.
        if (!session.endReason) {
            session.endReason = status === 'completed' ? 'caller_hangup' : 'unknown';
        }

        // Clean up last-turn cache for this call
        clearLastTurn(callSid);
    }

    await session.save();

    log.info('status-updated', {
        callSid,
        detail: {
            status: session.status,
            endReason: session.endReason,
            turnCount: session.turnCount,
            durationSec: session.durationSec,
        },
    });

    // Record call end in metrics if terminal
    const terminalCheck = ['completed', 'failed', 'busy', 'no-answer', 'canceled'];
    if (terminalCheck.includes(session.status)) {
        recordCallEnd({
            durationSec: session.durationSec || 0,
            turnCount: session.turnCount,
            endReason: session.endReason || 'unknown',
            channel: session.channel as 'phone' | 'web',
        });
    }
}
