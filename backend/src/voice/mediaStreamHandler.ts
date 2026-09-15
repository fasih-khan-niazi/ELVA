/**
 * Twilio Media Streams handler — real-time voice pipeline.
 *
 *   Caller ↔ Twilio ↔ WebSocket ↔ Deepgram STT + Azure TTS + AI /chat/stream
 *
 * Per-turn latency target: ~800ms – 1.8s (PKR / South Asia, Azure centralindia).
 */

import WebSocket from 'ws';
import { DeepgramSession } from './deepgramStreamService';
import { generateTtsMulawBuffer } from './azureTtsService';
import { DEFAULT_AZURE_VOICE } from './azureVoices';
import {
    processVoiceTurnStreaming,
    clearLastTurn,
    checkAiHealth,
    persistErrorTurn,
    syncVoiceTurnSpokenText,
} from './voiceOrchestrator';
import { resolveAgentById, ResolvedVoiceAgent } from './voiceResolver';
import { VoiceSession, VoiceTurn } from './voiceModels';
import {
    EXIT_INTENTS,
    TRANSFER_INTENTS,
    MAX_SILENCE_RETRIES,
    MAX_ERROR_RETRIES,
    DEFAULT_TRANSFER_NUMBER,
    MSG_GOODBYE,
    MSG_SILENCE_RETRY,
    MSG_AI_UNAVAILABLE,
    MSG_ERROR_LIMIT,
} from './voiceLifecycle';
import { mergeExitIntentFromTranscript } from './voiceClosingPhrases';
import { synthesisedClosingLine } from './voiceClosingService';
import { evaluatePreTurnShortcuts } from './voiceTurnEngine';
import { pickVoiceFiller } from './voiceFillerService';
import { transferActiveCall } from './voiceTransferService';
import {
    loadOutboundSessionBundle,
    resolveOutboundTurnAction,
    finalizeOutboundOnMaxTurns,
    finalizeOutboundOnAiFailure,
    finalizeOutboundOnSilenceTimeout,
    OutboundSessionBundle,
} from './outboundCallOutcomeService';
import { terminalLog } from '../utils/terminalLog';
import { warmAiVoiceSession } from './voiceSessionWarm';
import { validateMediaStreamToken } from '../utils/streamToken';

type CallType = 'inbound' | 'outbound' | 'browser';

interface StreamMeta {
    callSid: string;
    streamSid: string;
    type: CallType;
}

/** 20 ms of mulaw 8 kHz audio per chunk — improves time-to-first-byte. */
const MULAW_CHUNK_BYTES = 160;

class MediaCallSession {
    private deepgram: DeepgramSession | null = null;
    private streamSid = '';
    private cachedResolved: ResolvedVoiceAgent | null = null;
    private outboundBundle: OutboundSessionBundle | null = null;
    private isProcessingTurn = false;
    private isSpeaking = false;
    private isClosing = false;
    private silenceRetries = 0;
    private playbackTimer: ReturnType<typeof setTimeout> | null = null;
    private silenceTimer: ReturnType<typeof setTimeout> | null = null;
    private agentVoiceId = '';
    private agentLanguage = 'en-US';
    private speakGeneration = 0;
    private turnGeneration = 0;
    private turnAbortController: AbortController | null = null;
    private audioPackets = 0;
    private sttReady = false;
    private pendingTranscript = '';
    private pendingTranscriptTimer: ReturnType<typeof setTimeout> | null = null;
    private deferTranscriptUntilIdle = false;
    private skipRemainingSentences = false;
    private reviewConfirmLine = 'Say yes to place your order.';
    private reviewTurnActive = false;
    private deepgramFinalAt = 0;
    private lastUserSpeechAt = 0;
    private ttsChainActive = false;
    private pipelineTurnId = 0;
    private lastFlushedTranscript = '';
    private lastFlushedAt = 0;
    private lastProcessedTranscript = '';
    private lastProcessedAt = 0;
    private currentTurnTtsFirstByteMs: number | undefined;
    private ttsPrefetch = new Map<string, Promise<Buffer>>();

    private static readonly UTTERANCE_DEBOUNCE_MS = parseInt(
        process.env.VOICE_UTTERANCE_DEBOUNCE_MS || '900',
        10,
    );
    private static readonly UTTERANCE_DEBOUNCE_PHONE_MS = parseInt(
        process.env.VOICE_UTTERANCE_DEBOUNCE_PHONE_MS || '3500',
        10,
    );
    private static readonly UTTERANCE_DEBOUNCE_INCOMPLETE_EXTRA_MS = parseInt(
        process.env.VOICE_UTTERANCE_DEBOUNCE_INCOMPLETE_EXTRA_MS || '1200',
        10,
    );
    private static readonly SILENCE_PROMPT_MS = parseInt(
        process.env.VOICE_SILENCE_PROMPT_MS || '12000',
        10,
    );
    private static readonly FAST_ACK =
        /^(yes|no|yeah|yep|yup|nope|nah|ok|okay|sure|skip|takeaway|delivery|dine-in|correct|right|one|two|three|four|five|six|seven|eight|nine|ten)\.?$/i;

    private static readonly HEARING_CHECK =
        /^(hello|hey|hi|yo)\??$/i;

    private static isHearingCheckPhrase(text: string): boolean {
        const t = text.trim().toLowerCase();
        if (!t) return false;
        if (MediaCallSession.HEARING_CHECK.test(t)) return true;
        if (/can you hear me|are you there|can you hear|do you hear me/i.test(t)) return true;
        if (/i can'?t hear you|hello\?? can you hear/i.test(t)) return true;
        return false;
    }

    constructor(
        private readonly ws: WebSocket,
        private readonly meta: StreamMeta,
    ) {}

    async start(streamSid: string, callSid: string): Promise<void> {
        this.streamSid = streamSid;

        const session = await VoiceSession.findOne({ callSid });
        if (!session) {
            terminalLog.err('STREAM', `No session found for callSid ${callSid}`);
            this.safeClose();
            return;
        }

        const resolved = await resolveAgentById(
            String(session.agentId),
            String(session.tenantId),
        );
        if (!resolved) {
            terminalLog.err('STREAM', `Could not resolve agent for session ${callSid}`);
            this.safeClose();
            return;
        }

        this.cachedResolved = resolved;
        this.agentVoiceId = resolved.ttsVoice || '';
        this.agentLanguage = resolved.language || 'en-US';

        if (this.meta.type === 'outbound') {
            this.outboundBundle = await loadOutboundSessionBundle(callSid, resolved);
        }

        const aiHealthy = await checkAiHealth();
        if (!aiHealthy) {
            await this.speakText(MSG_AI_UNAVAILABLE, this.agentLanguage, this.agentVoiceId);
            session.endReason = 'ai_unavailable';
            session.status = 'completed';
            session.endedAt = new Date();
            await session.save();
            this.safeClose();
            return;
        }

        void warmAiVoiceSession(callSid, String(session.agentId), String(session.tenantId));

        this.deepgram = new DeepgramSession({
            language: this.agentLanguage,
            currency: resolved.currency,
            onTranscript: (text) => {
                this.deepgramFinalAt = Date.now();
                this.lastUserSpeechAt = Date.now();
                this.resetSilenceTimer();
                this.enqueueTranscript(text);
            },
            onInterimTranscript: (text) => this.handleInterimBargeIn(text),
            onError: (err) => terminalLog.err('DEEPGRAM', err?.message || 'unknown'),
            onReady: () => {
                this.sttReady = true;
                terminalLog.ok('DEEPGRAM', 'STT connected — listening');
            },
        });

        const greeting = (this.meta.type === 'outbound' && (session as any).openingScript)
            ? (session as any).openingScript
            : (resolved.firstMessage || 'Hello, how can I help you today?');

        terminalLog.voice('STREAM', `Greeting (${this.meta.type}) → ${greeting.slice(0, 60)}…`);

        const deepgramReadyPromise = this.deepgram.waitForReady(12_000);
        await this.speakText(greeting, this.agentLanguage, this.agentVoiceId);

        const sttOk = await deepgramReadyPromise;
        if (!sttOk) {
            terminalLog.err('STREAM', 'Deepgram STT unavailable — ending call');
            await this.speakText(
                'I am having trouble hearing you due to a connection issue. Please try again in a moment.',
                this.agentLanguage,
                this.agentVoiceId,
            );
            this.safeClose();
            return;
        }
        this.sttReady = true;
        this.resetSilenceTimer();
    }

    handleAudio(payload: string): void {
        if (this.isClosing || !this.deepgram) return;
        const buffer = Buffer.from(payload, 'base64');
        this.audioPackets += 1;
        if (this.audioPackets === 1) {
            terminalLog.voice('STREAM', `First audio packet (${buffer.length}B, ${this.meta.type})`);
        }
        this.deepgram.sendAudio(buffer);
    }

    private handleInterimBargeIn(text: string): void {
        const trimmed = text.trim();
        if (!trimmed || trimmed.length < 4) return;

        // Only barge-in while agent audio is actually playing — not on every interim STT tick.
        if (!this.isSpeaking) return;

        if (this.reviewTurnActive && !this.skipRemainingSentences) {
            this.skipRemainingSentences = true;
            this.cancelSpeaking();
            void this.speakText(this.reviewConfirmLine, this.agentLanguage, this.agentVoiceId);
            return;
        }

        this.skipRemainingSentences = true;
        this.abortActiveTurn('interim');
    }

    private abortActiveTurn(reason: string): void {
        this.turnAbortController?.abort();
        this.turnAbortController = null;
        this.interruptAgentSpeech();
        // LLM is done — free STT so deferred caller speech can flush immediately.
        this.isProcessingTurn = false;
        this.flushDeferredTranscriptIfAny();
        if (this.pendingTranscript && !this.isClosing) {
            this.scheduleUtteranceFlush();
        }
        terminalLog.voice('STREAM', `Barge-in (${reason})`);
    }

    private isTurnCurrent(turnId: number): boolean {
        return turnId === this.turnGeneration && !this.isClosing;
    }

    /** Block new LLM turns only — STT continues during TTS for barge-in. */
    private isLlmTurnLocked(): boolean {
        return this.isProcessingTurn;
    }

    private resetSilenceTimer(): void {
        if (this.silenceTimer) clearTimeout(this.silenceTimer);
        if (this.isClosing) return;
        this.silenceTimer = setTimeout(() => void this.onSilenceTimeout(), MediaCallSession.SILENCE_PROMPT_MS);
    }

    private async onSilenceTimeout(): Promise<void> {
        if (this.isClosing || this.isProcessingTurn || this.isSpeaking || this.pendingTranscript) return;

        const session = await VoiceSession.findOne({ callSid: this.meta.callSid });
        if (!session || !this.cachedResolved) return;

        this.silenceRetries += 1;
        session.silenceRetries = this.silenceRetries;
        await session.save();

        if (this.silenceRetries >= MAX_SILENCE_RETRIES) {
            session.endReason = 'silence_timeout';
            session.status = 'completed';
            session.endedAt = new Date();
            await session.save();
            if (this.outboundBundle) {
                await finalizeOutboundOnSilenceTimeout(session, this.outboundBundle);
            }
            await this.speakText(MSG_GOODBYE, this.agentLanguage, this.agentVoiceId);
            this.safeClose();
            return;
        }

        await this.speakText(MSG_SILENCE_RETRY, this.agentLanguage, this.agentVoiceId);
        this.resetSilenceTimer();
    }

    private static looksIncompleteUtterance(text: string): boolean {
        const t = text.trim().toLowerCase();
        if (!t) return false;
        if (MediaCallSession.isHearingCheckPhrase(t)) return false;
        // "Do you have any sweets" — STT often splits trailing words ("on") into the next turn.
        if (/\bdo you have any \w+\.?\s*$/i.test(t)) return true;
        // "Can you tell me about the" / "Can I buy an apartment" — wait for the object.
        if (/\b(tell me about|about the|about your|can you tell me about|can i buy an?)\s+\w*\s*$/i.test(t)) {
            return true;
        }
        if (/^what is\s*$/i.test(t)) return true;
        if (/^what is\s+\w+\.?\s*$/i.test(t) && t.split(/\s+/).length <= 3) return true;
        if (/\b(is your|are your|was your|your|my|the|a|an|it|its|our)\s*$/.test(t)) return true;
        if (/\b(barbecue|platter|soup|pizza|burger|item|special|dish)\s+(is|are|was)\s*$/.test(t)) return true;
        if (/^(and|for|the|hot|sour|with|a|an|i|can|could|would|place)\s+\w+\.?$/.test(t) && t.split(/\s+/).length <= 8) return true;
        if (/\b(for the|for a|order for|place an order for|like to order for|can i place)\s+\w*\s*$/.test(t)) return true;
        if (/\b(hot|sour|and|the|mixed|bbq|with|top|selling)\s*$/.test(t)) return true;
        if (!/[.?!…]$/.test(t) && t.split(/\s+/).length >= 4) return true;
        if (/^(top|and|for|the|it|order|would|like|place|can|who|what|also|tell)\b/i.test(t) && t.split(/\s+/).length <= 14) return true;
        if (/\?\s*$/.test(t) && t.split(/\s+/).length <= 8) return true;
        return false;
    }

    private looksLikeContinuationFragment(text: string): boolean {
        const t = text.trim().toLowerCase();
        if (!t || t.length > 120) return false;
        if (/^(top|and|for|the|item|selling|soup|it|order|i would|can i|please|also|who|what|tell)\b/.test(t)) return true;
        if (/^(can you|could you|would you|and who|and what)\b/.test(t)) return true;
        return MediaCallSession.looksIncompleteUtterance(t);
    }

    private shouldCoalesceWithPreviousUtterance(text: string): boolean {
        if (!this.lastFlushedTranscript) return false;
        const elapsed = Date.now() - this.lastFlushedAt;
        if (elapsed > 8000) return false;

        const continuation = this.looksLikeContinuationFragment(text);
        const incomplete = MediaCallSession.looksIncompleteUtterance(this.lastFlushedTranscript);

        if (this.isLlmTurnLocked() && (incomplete || continuation)) return true;
        if (elapsed <= 2000 && incomplete) return true;
        if (elapsed <= 4000 && continuation) return true;
        if (elapsed <= 8000 && /\?\s*$/.test(this.lastFlushedTranscript.trim()) && continuation) return true;
        return false;
    }

    private static readonly AGENT_ECHO_PATTERNS = [
        /place order when you(?:'re| are) ready/i,
        /anything else.*place order/i,
        /say yes to place your order/i,
        /your cart is empty/i,
        // Do NOT block the caller asking "what's on the menu?" — only agent monologue echoes.
        /^here(?:'s| is) (?:our |the )?menu\b/i,
        /^on our menu we have\b/i,
    ];

    private isAgentEchoTranscript(text: string): boolean {
        const t = text.trim();
        return t.length > 0 && MediaCallSession.AGENT_ECHO_PATTERNS.some((re) => re.test(t));
    }

    /** Drop STT noise / clause fragments that should not become their own turn. */
    private static shouldIgnoreSttFragment(text: string): boolean {
        const t = text.trim().replace(/[.?!…]+$/g, '').toLowerCase();
        if (!t) return true;
        const words = t.split(/\s+/).filter(Boolean);
        if (words.length === 1) {
            if (t.length <= 3) return true;
            const noise = new Set([
                'on', 'in', 'at', 'or', 'an', 'a', 'the', 'it', 'and', 'so', 'ok', 'okay', 'um', 'uh',
            ]);
            if (noise.has(t)) return true;
        }
        if (words.length <= 2 && /^(what is|tell me|about the|can you)$/i.test(t)) return true;
        return false;
    }

    private isDuplicateTranscript(text: string): boolean {
        const norm = text.trim().toLowerCase().replace(/\s+/g, ' ');
        const prev = this.lastProcessedTranscript.trim().toLowerCase().replace(/\s+/g, ' ');
        if (!norm || !prev) return false;
        const elapsed = Date.now() - this.lastProcessedAt;
        const orderLike = /\b(order|place|barbecue|bbq|platter|pizza|burger)\b/i.test(norm);
        const dedupeWindowMs = orderLike ? 8000 : 5000;
        if (norm === prev && elapsed < dedupeWindowMs) return true;
        if (elapsed < (orderLike ? 5000 : 3000) && norm.length >= 8 && (prev.includes(norm) || norm.includes(prev))) return true;
        return false;
    }

    private static looksLikePhoneFragment(text: string): boolean {
        const t = text.trim().toLowerCase();
        if (!t || t.length > 80) return false;
        if (/\b(triple|double|zero|oh)\b/.test(t)) return true;
        if (/\b(one|two|three|four|five|six|seven|eight|nine)\b/.test(t)) return true;
        const digits = t.replace(/\D/g, '');
        return digits.length >= 1 && digits.length <= 10;
    }

    private scheduleUtteranceFlush(): void {
        if (this.pendingTranscriptTimer) clearTimeout(this.pendingTranscriptTimer);

        const pending = this.pendingTranscript;
        let debounceMs = MediaCallSession.looksLikePhoneFragment(pending)
            ? MediaCallSession.UTTERANCE_DEBOUNCE_PHONE_MS
            : MediaCallSession.looksIncompleteUtterance(pending)
                ? MediaCallSession.UTTERANCE_DEBOUNCE_MS + MediaCallSession.UTTERANCE_DEBOUNCE_INCOMPLETE_EXTRA_MS
                : MediaCallSession.UTTERANCE_DEBOUNCE_MS;

        if (MediaCallSession.isHearingCheckPhrase(pending)) {
            debounceMs = 250;
        }

        this.pendingTranscriptTimer = setTimeout(() => {
            const full = this.pendingTranscript;
            this.pendingTranscript = '';
            this.pendingTranscriptTimer = null;
            this.deferTranscriptUntilIdle = false;
            if (!full || this.isClosing) return;
            if (this.isLlmTurnLocked()) {
                this.pendingTranscript = full;
                this.deferTranscriptUntilIdle = true;
                return;
            }
            terminalLog.dim(`Utterance ready (${full.length} chars): "${full.slice(0, 72)}${full.length > 72 ? '…' : ''}"`);
            void this.onTranscript(full);
        }, debounceMs);
    }

    private releaseAgentAndFlushStt(): void {
        this.isProcessingTurn = false;
        this.turnAbortController = null;
        this.ttsChainActive = false;
        this.flushDeferredTranscriptIfAny();
        if (this.pendingTranscript && !this.isClosing && !this.isLlmTurnLocked()) {
            this.scheduleUtteranceFlush();
        }
        this.resetSilenceTimer();
    }

    private flushDeferredTranscriptIfAny(): void {
        if (!this.deferTranscriptUntilIdle || !this.pendingTranscript || this.isClosing) return;
        this.deferTranscriptUntilIdle = false;
        this.scheduleUtteranceFlush();
    }

    private enqueueTranscript(text: string): void {
        const trimmed = text.trim();
        if (!trimmed || this.isClosing) return;

        if (MediaCallSession.FAST_ACK.test(trimmed)) {
            this.flushPendingUtterance(true);
            void this.onTranscript(trimmed);
            return;
        }

        if (MediaCallSession.isHearingCheckPhrase(trimmed)) {
            this.flushPendingUtterance(true);
            void this.onTranscript(trimmed);
            return;
        }

        this.pendingTranscript = this.pendingTranscript
            ? `${this.pendingTranscript} ${trimmed}`.replace(/\s+/g, ' ').trim()
            : trimmed;

        if (this.isLlmTurnLocked()) {
            this.deferTranscriptUntilIdle = true;
            if (this.pendingTranscriptTimer) {
                clearTimeout(this.pendingTranscriptTimer);
                this.pendingTranscriptTimer = null;
            }
            return;
        }

        this.scheduleUtteranceFlush();
    }

    private flushPendingUtterance(discard: boolean): void {
        if (this.pendingTranscriptTimer) {
            clearTimeout(this.pendingTranscriptTimer);
            this.pendingTranscriptTimer = null;
        }
        if (!discard && this.pendingTranscript && !this.isClosing) {
            void this.onTranscript(this.pendingTranscript);
        }
        this.pendingTranscript = '';
    }

    private activeResolved(): ResolvedVoiceAgent | null {
        if (this.outboundBundle) return this.outboundBundle.outboundResolved;
        return this.cachedResolved;
    }

    private async onTranscript(text: string): Promise<void> {
        if (!text.trim() || this.isClosing) return;

        if (MediaCallSession.shouldIgnoreSttFragment(text)) {
            terminalLog.dim(`Ignored STT fragment: "${text.trim()}"`);
            return;
        }

        if (this.isAgentEchoTranscript(text)) {
            terminalLog.dim(`Skipped agent-echo STT: "${text.slice(0, 48)}"`);
            return;
        }

        if (this.shouldCoalesceWithPreviousUtterance(text)) {
            text = `${this.lastFlushedTranscript} ${text.trim()}`.replace(/\s+/g, ' ').trim();
            terminalLog.dim(`Coalesced utterance (${text.length} chars)`);
        }

        if (this.isDuplicateTranscript(text)) {
            terminalLog.dim(`Skipped duplicate STT: "${text.slice(0, 48)}"`);
            return;
        }

        if (this.isLlmTurnLocked()) {
            if (this.isSpeaking || this.ttsChainActive) {
                this.interruptAgentSpeech();
            }
            this.pendingTranscript = this.pendingTranscript
                ? `${this.pendingTranscript} ${text.trim()}`.replace(/\s+/g, ' ').trim()
                : text.trim();
            this.deferTranscriptUntilIdle = true;
            return;
        }

        // Claim turn id before interrupt so stale speakChain callbacks fail isTurnCurrent.
        const turnId = ++this.turnGeneration;
        this.pipelineTurnId = turnId;

        if (this.isSpeaking || this.ttsChainActive) {
            this.interruptAgentSpeech();
        }

        this.isProcessingTurn = true;
        this.ttsChainActive = true;
        this.lastFlushedTranscript = text.trim();
        this.lastFlushedAt = Date.now();
        this.lastProcessedTranscript = text.trim();
        this.lastProcessedAt = Date.now();
        this.turnAbortController = new AbortController();
        this.silenceRetries = 0;
        this.currentTurnTtsFirstByteMs = undefined;

        const debounceCompleteAt = Date.now();
        const deepgramFinalAt = this.deepgramFinalAt || debounceCompleteAt;

        let speakChain = Promise.resolve();

        try {
            const session = await VoiceSession.findOne({ callSid: this.meta.callSid });
            const resolved = this.activeResolved();
            if (!session || !resolved || !this.isTurnCurrent(turnId)) return;

            const shortcut = evaluatePreTurnShortcuts(this.meta.callSid, text, session, resolved);
            if (shortcut.handled) {
                if (shortcut.endCall) {
                    session.endReason = shortcut.endReason || 'max_turns';
                    session.status = 'completed';
                    session.endedAt = new Date();
                    await session.save();
                    if (this.outboundBundle && shortcut.endReason === 'max_turns') {
                        await finalizeOutboundOnMaxTurns(session, this.outboundBundle);
                    }
                }
                await this.speakText(shortcut.reply, resolved.language, resolved.ttsVoice);
                if (shortcut.endCall) this.safeClose();
                return;
            }

            const speechForTurn = shortcut.speechForTurn;
            const filler = pickVoiceFiller(speechForTurn);
            if (filler) {
                void this.speakTextForTurn(turnId, filler, resolved.language, resolved.ttsVoice);
            }

            let streamSentenceIdx = 0;
            const spokenParts: string[] = [];
            this.skipRemainingSentences = false;
            this.reviewTurnActive = false;

            const result = await processVoiceTurnStreaming(
                {
                    callSid: this.meta.callSid,
                    speechResult: speechForTurn,
                    session,
                    resolved,
                    campaignMode: this.meta.type === 'outbound',
                },
                {
                    deepgramFinalAt,
                    debounceCompleteAt,
                    onTtsFirstByte: (ms) => {
                        this.currentTurnTtsFirstByteMs = ms;
                    },
                    onSentence: (sentenceText) => {
                        if (!this.isTurnCurrent(turnId)) return;
                        streamSentenceIdx += 1;
                        if (this.skipRemainingSentences && streamSentenceIdx > 1) return;

                        this.ttsPrefetch.set(
                            sentenceText,
                            generateTtsMulawBuffer(
                                sentenceText,
                                resolved.language,
                                resolved.ttsVoice || this.agentVoiceId,
                            ),
                        );

                        speakChain = speakChain.then(async () => {
                            if (!this.isTurnCurrent(turnId)) return;
                            if (this.skipRemainingSentences && streamSentenceIdx > 1) return;
                            const spoke = await this.speakTextForTurn(
                                turnId,
                                sentenceText,
                                resolved.language,
                                resolved.ttsVoice,
                                sentenceText,
                            );
                            if (spoke) spokenParts.push(sentenceText);
                        });
                    },
                },
                { abortSignal: this.turnAbortController?.signal },
            );

            // LLM finished — release STT lock; remaining TTS plays via speakChain without blocking new turns.
            this.isProcessingTurn = false;
            this.turnAbortController = null;

            if (!this.isTurnCurrent(turnId)) return;

            if (session.errorRetries > 0) {
                session.errorRetries = 0;
                await session.save();
            }

            const mergedIntent = mergeExitIntentFromTranscript(text, result.intent);
            const intent = (mergedIntent || result.intent || '').toLowerCase();

            if (result.orderDetailStep === 'review') {
                this.reviewTurnActive = true;
                if (result.reviewConfirmLine) this.reviewConfirmLine = result.reviewConfirmLine;
            } else {
                this.reviewTurnActive = false;
            }

            if (this.meta.type === 'outbound' && this.outboundBundle) {
                const action = await resolveOutboundTurnAction(
                    text,
                    result,
                    session,
                    resolved,
                    this.outboundBundle,
                );
                await speakChain.catch(() => {});

                if (action.type === 'transfer') {
                    session.endReason = 'transfer';
                    session.status = 'completed';
                    session.endedAt = new Date();
                    await session.save();
                    await transferActiveCall(this.meta.callSid, action.transferTo);
                    this.safeClose();
                    return;
                }

                if (action.type === 'close') {
                    session.endReason = action.endReason;
                    session.status = 'completed';
                    session.endedAt = new Date();
                    await session.save();
                    await this.speakText(action.closingText, resolved.language, resolved.ttsVoice);
                    this.safeClose();
                    return;
                }
            }

            if (intent && TRANSFER_INTENTS.has(intent)) {
                const transferTo = resolved.transferNumber || DEFAULT_TRANSFER_NUMBER;
                await speakChain.catch(() => {});
                if (transferTo && this.isTurnCurrent(turnId)) {
                    session.endReason = 'transfer';
                    await session.save();
                    await transferActiveCall(this.meta.callSid, transferTo);
                    this.safeClose();
                    return;
                }
            }

            if (intent && EXIT_INTENTS.has(intent)) {
                session.endReason = 'goodbye';
                session.status = 'completed';
                session.endedAt = new Date();
                await session.save();
                const closingLine = synthesisedClosingLine(
                    result.intent,
                    mergedIntent ?? result.intent,
                    result.aiText,
                    resolved.businessName || '',
                    'inbound',
                );
                await speakChain.catch(() => {});
                await this.speakText(closingLine, resolved.language, resolved.ttsVoice);
                this.safeClose();
                return;
            }

            await speakChain.catch((err: unknown) => {
                if (this.isTurnCurrent(turnId)) {
                    const msg = err instanceof Error ? err.message : String(err);
                    terminalLog.dim(`Speak chain: ${msg}`);
                }
            });

            if (this.isTurnCurrent(turnId) && spokenParts.length > 0) {
                void syncVoiceTurnSpokenText(this.meta.callSid, result.turnIndex, spokenParts).catch(
                    (err: unknown) => {
                        const msg = err instanceof Error ? err.message : String(err);
                        terminalLog.dim(`Spoken sync failed: ${msg}`);
                    },
                );
            }
        } catch (err: unknown) {
            if (!this.isTurnCurrent(turnId)) return;
            const e = err as { name?: string; message?: string };
            if (e?.name === 'AbortError' || /aborted/i.test(e?.message || '')) {
                terminalLog.dim('Turn aborted — caller interrupted');
                this.isProcessingTurn = false;
                this.flushDeferredTranscriptIfAny();
                return;
            }

            const msg = e?.message || 'unknown';
            terminalLog.err('STREAM', `Turn error: ${msg}`);

            const session = await VoiceSession.findOne({ callSid: this.meta.callSid });
            if (session) {
                session.errorRetries = (session.errorRetries || 0) + 1;
                await session.save();
                await persistErrorTurn(
                    session,
                    this.meta.callSid,
                    text,
                    undefined,
                    Date.now() - debounceCompleteAt,
                    msg,
                );

                if (session.errorRetries >= MAX_ERROR_RETRIES) {
                    if (this.outboundBundle) {
                        await finalizeOutboundOnAiFailure(session, this.outboundBundle);
                    }
                    session.endReason = 'error_limit';
                    session.status = 'failed';
                    session.endedAt = new Date();
                    await session.save();
                    await this.speakText(MSG_ERROR_LIMIT, this.agentLanguage, this.agentVoiceId);
                    this.safeClose();
                    return;
                }
            }

            const spoken = /timeout|aborted/i.test(msg)
                ? 'Sorry, that took too long. Could you ask again in a shorter way?'
                : 'I\'m sorry, I had trouble with that. Could you say it again?';
            await this.speakText(spoken, this.agentLanguage, this.agentVoiceId).catch(() => {});
        } finally {
            this.ttsPrefetch.clear();
            if (turnId === this.pipelineTurnId && !this.isClosing) {
                this.pipelineTurnId = 0;
                this.releaseAgentAndFlushStt();
            }
        }
    }

    /** Stop Twilio playback and invalidate queued speakChain / prefetch work. */
    private interruptAgentSpeech(): void {
        this.skipRemainingSentences = true;
        this.speakGeneration += 1;
        this.ttsPrefetch.clear();
        this.sendClear();
        if (this.playbackTimer) {
            clearTimeout(this.playbackTimer);
            this.playbackTimer = null;
        }
        this.isSpeaking = false;
    }

    private cancelSpeaking(): void {
        this.interruptAgentSpeech();
    }

    private async speakTextForTurn(
        turnId: number,
        text: string,
        language?: string,
        voiceId?: string,
        prefetchKey?: string,
    ): Promise<boolean> {
        if (!this.isTurnCurrent(turnId)) return false;
        return this.speakText(text, language, voiceId, prefetchKey, turnId);
    }

    private async speakText(
        text: string,
        language?: string,
        voiceId?: string,
        prefetchKey?: string,
        ownerTurnId?: number,
    ): Promise<boolean> {
        if (this.isClosing || !this.ws || this.ws.readyState !== WebSocket.OPEN) return false;
        if (ownerTurnId != null && !this.isTurnCurrent(ownerTurnId)) return false;
        const gen = this.speakGeneration;
        const resolvedVoice = voiceId || this.agentVoiceId || undefined;
        const lang = language || this.agentLanguage;

        try {
            this.isSpeaking = true;
            let audioBuffer: Buffer;

            const prefetched = prefetchKey ? this.ttsPrefetch.get(prefetchKey) : undefined;
            if (prefetched) {
                try {
                    audioBuffer = await prefetched;
                    this.ttsPrefetch.delete(prefetchKey!);
                } catch {
                    audioBuffer = await generateTtsMulawBuffer(text, lang, resolvedVoice);
                }
            } else {
                try {
                    audioBuffer = await generateTtsMulawBuffer(text, lang, resolvedVoice);
                } catch (firstErr: unknown) {
                    if (resolvedVoice && resolvedVoice !== DEFAULT_AZURE_VOICE) {
                        terminalLog.warn('STREAM', `TTS retry with ${DEFAULT_AZURE_VOICE}`);
                        audioBuffer = await generateTtsMulawBuffer(text, lang, DEFAULT_AZURE_VOICE);
                    } else {
                        throw firstErr;
                    }
                }
            }

            if (this.isClosing || gen !== this.speakGeneration) return false;
            if (ownerTurnId != null && !this.isTurnCurrent(ownerTurnId)) return false;

            const ttsStart = Date.now();
            this.sendAudioPayloadChunked(audioBuffer);
            if (this.currentTurnTtsFirstByteMs == null && this.isProcessingTurn) {
                this.currentTurnTtsFirstByteMs = Date.now() - ttsStart;
            }

            const durationMs = Math.ceil((audioBuffer.length / 8000) * 1000);
            terminalLog.dim(`TTS ${audioBuffer.length}B (~${durationMs}ms)`);
            await new Promise<void>((resolve) => {
                this.playbackTimer = setTimeout(() => {
                    this.playbackTimer = null;
                    resolve();
                }, durationMs);
            });
            return (
                gen === this.speakGeneration
                && !this.isClosing
                && (ownerTurnId == null || this.isTurnCurrent(ownerTurnId))
            );
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            terminalLog.err('STREAM', `TTS error: ${msg}`);
            return false;
        } finally {
            if (this.playbackTimer) {
                clearTimeout(this.playbackTimer);
                this.playbackTimer = null;
            }
            this.isSpeaking = false;
            this.flushDeferredTranscriptIfAny();
        }
    }

    private sendAudioPayloadChunked(buffer: Buffer): void {
        for (let offset = 0; offset < buffer.length; offset += MULAW_CHUNK_BYTES) {
            this.sendAudioPayload(buffer.subarray(offset, offset + MULAW_CHUNK_BYTES));
        }
    }

    private sendAudioPayload(buffer: Buffer): void {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
        this.ws.send(JSON.stringify({
            event: 'media',
            streamSid: this.streamSid,
            media: { payload: buffer.toString('base64') },
        }));
    }

    private sendClear(): void {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
        this.ws.send(JSON.stringify({ event: 'clear', streamSid: this.streamSid }));
    }

    safeClose(): void {
        if (this.isClosing) return;
        this.isClosing = true;
        this.turnGeneration += 1;
        this.turnAbortController?.abort();
        this.turnAbortController = null;
        this.isProcessingTurn = false;
        this.isSpeaking = false;
        this.speakGeneration += 1;
        if (this.pendingTranscriptTimer) clearTimeout(this.pendingTranscriptTimer);
        if (this.silenceTimer) clearTimeout(this.silenceTimer);
        this.pendingTranscript = '';
        this.flushPendingUtterance(true);
        this.ttsPrefetch.clear();
        clearLastTurn(this.meta.callSid);
        this.deepgram?.close();
        terminalLog.voice('STREAM', `Session closed ${this.meta.callSid}`);
        if (this.ws.readyState === WebSocket.OPEN) {
            this.ws.close(1000, 'session ended');
        }
        void this.logPostCallSummary();
    }

    private async logPostCallSummary(): Promise<void> {
        try {
            const session = await VoiceSession.findOne({ callSid: this.meta.callSid });
            const turnCount = await VoiceTurn.countDocuments({ callSid: this.meta.callSid });
            terminalLog.voice(
                'CALL-END',
                `callSid=${this.meta.callSid.slice(0, 12)}… turns=${turnCount} status=${session?.status || '?'}`,
            );
        } catch {
            /* non-fatal */
        }
    }
}

const _activeSessions = new Map<string, MediaCallSession>();

export function handleMediaStreamConnection(
    ws: WebSocket,
    callSid: string,
    type: CallType = 'inbound',
    streamToken: string = '',
): void {
    terminalLog.voice('STREAM', `WebSocket connected (${type}${callSid ? ` · ${callSid.slice(0, 10)}…` : ''})`);

    const meta: StreamMeta = { callSid, streamSid: '', type };
    const session = new MediaCallSession(ws, meta);
    let authorized = false;

    ws.on('message', async (rawData: Buffer) => {
        try {
            const msg = JSON.parse(rawData.toString());
            switch (msg.event) {
                case 'connected':
                    terminalLog.dim('Twilio media stream connected');
                    break;
                case 'start': {
                    const streamSid: string = msg.start?.streamSid || '';
                    const custom = (msg.start?.customParameters || {}) as Record<string, string>;
                    const actualCallSid: string =
                        msg.start?.callSid || custom.callSid || callSid;
                    const token = streamToken || custom.token || '';
                    const streamType = (custom.type || type) as CallType;

                    if (!authorized) {
                        const ok = await validateMediaStreamToken(actualCallSid, token);
                        if (!ok) {
                            terminalLog.err(
                                'STREAM',
                                `Rejected — invalid token for ${actualCallSid.slice(0, 10) || 'unknown'}…`,
                            );
                            ws.close(4401, 'Unauthorized');
                            return;
                        }
                        authorized = true;
                        meta.type = streamType;
                    }

                    meta.callSid = actualCallSid;
                    meta.streamSid = streamSid;
                    _activeSessions.set(actualCallSid, session);
                    await session.start(streamSid, actualCallSid);
                    break;
                }
                case 'media': {
                    if (!authorized) break;
                    const track = msg.media?.track as string | undefined;
                    if (track && track !== 'inbound') break;
                    if (msg.media?.payload) session.handleAudio(msg.media.payload);
                    break;
                }
                case 'stop':
                    session.safeClose();
                    _activeSessions.delete(meta.callSid);
                    break;
            }
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            terminalLog.err('STREAM', `Message error: ${msg}`);
        }
    });

    ws.on('close', () => {
        session.safeClose();
        _activeSessions.delete(meta.callSid);
    });

    ws.on('error', (err: Error) => {
        terminalLog.err('STREAM', `WebSocket error: ${err.message}`);
        session.safeClose();
        _activeSessions.delete(meta.callSid);
    });
}
