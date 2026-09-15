export const VOICE_MVP_VERSION = 'v1-turn-based';

export type VoiceMvpChannel = 'phone' | 'web';
export type VoiceMvpStage = 'mvp' | 'phase2';

export interface VoiceMvpContract {
    version: string;
    stage: VoiceMvpStage;
    channels: VoiceMvpChannel[];
    supportedInput: Array<'speech'>;
    supportedOutput: Array<'tts'>;
    loop: 'turn-based';
    notes: string[];
}

export const VOICE_MVP_CONTRACT: VoiceMvpContract = {
    version: VOICE_MVP_VERSION,
    stage: 'phase2',
    channels: ['phone', 'web'],
    supportedInput: ['speech'],
    supportedOutput: ['tts'],
    loop: 'turn-based',
    notes: [
        'Caller speech is transcribed in real time by Deepgram over Twilio Media Streams.',
        'Agent responses use Azure Neural TTS (mulaw) streamed back over the same WebSocket.',
        'LLM turns use AI service /chat/stream with sentence-level TTS pipelining.',
        'Browser test calls (Twilio Voice SDK) use the same Media Streams pipeline as PSTN.',
        'Optimized for South Asia latency (Azure centralindia + regional Deepgram).',
    ],
};

export interface VoiceMvpKpiTargets {
    maxFirstResponseMs: number;
    maxTurnLatencyMs: number;
    minCallCompletionRate: number;
    maxVoiceFallbackRate: number;
}

export const VOICE_MVP_KPI_TARGETS: VoiceMvpKpiTargets = {
    maxFirstResponseMs: 2000,
    maxTurnLatencyMs: 3500,
    minCallCompletionRate: 0.85,
    maxVoiceFallbackRate: 0.07,
};

export interface VoiceInboundPayload {
    CallSid?: string;
    From?: string;
    To?: string;
    CallStatus?: string;
    SpeechResult?: string;
    Confidence?: string;
    // Recording callback fields (used with Google STT flow)
    RecordingUrl?: string;
    RecordingSid?: string;
    RecordingDuration?: string;
    RecordingStatus?: string;
}

export interface VoiceTurnOutcome {
    callSid: string;
    tenantId?: string;
    agentId?: string;
    inputTranscript: string;
    inputConfidence?: number;
    aiResponse: string;
    createdAtIso: string;
}
