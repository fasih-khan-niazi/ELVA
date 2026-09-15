import mongoose, { Document, Schema } from 'mongoose';
import { attachVoiceSessionCallConnectorHook } from './voiceCallConnectorDispatch';

// ---------------------------------------------------------------------------
// VoiceEndpoint - maps a Twilio phone number to a tenant + agent
// ---------------------------------------------------------------------------
export interface IVoiceEndpoint extends Document {
    tenantId: mongoose.Types.ObjectId;
    agentId: mongoose.Types.ObjectId;
    phoneNumber: string;          // E.164 format, e.g. "+14155551234"
    label: string;                // friendly name shown in dashboard
    language: string;             // BCP-47, e.g. "en-US"
    isActive: boolean;
    createdAt: Date;
    updatedAt: Date;
}

const VoiceEndpointSchema = new Schema<IVoiceEndpoint>({
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true },
    agentId: { type: Schema.Types.ObjectId, ref: 'Agent', required: true },
    phoneNumber: { type: String, required: true, unique: true, index: true },
    label: { type: String, default: '' },
    language: { type: String, default: 'en-US' },
    isActive: { type: Boolean, default: true },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now },
});

VoiceEndpointSchema.pre('save', function () {
    this.updatedAt = new Date();
});

export const VoiceEndpoint = mongoose.model<IVoiceEndpoint>(
    'VoiceEndpoint',
    VoiceEndpointSchema,
);

// ---------------------------------------------------------------------------
// VoiceSession - one per phone call (keyed by Twilio CallSid)
// ---------------------------------------------------------------------------
export type VoiceSessionStatus =
    | 'initiated'
    | 'ringing'
    | 'in-progress'
    | 'completed'
    | 'failed'
    | 'busy'
    | 'no-answer'
    | 'canceled';

export interface IVoiceSession extends Document {
    callSid: string;
    tenantId: mongoose.Types.ObjectId;
    agentId: mongoose.Types.ObjectId;
    endpointId?: mongoose.Types.ObjectId;
    channel: 'phone' | 'web';
    from: string;
    to: string;
    status: VoiceSessionStatus;
    turnCount: number;
    totalLatencyMs: number;
    silenceRetries: number;
    errorRetries: number;
    endReason?: 'goodbye' | 'max_turns' | 'silence_timeout' | 'error_limit' | 'transfer' | 'caller_hangup' | 'ai_unavailable' | 'unknown';
    startedAt: Date;
    endedAt?: Date;
    durationSec?: number;
    /** Set once Connected Apps (`calls` source) have been triggered for this session. */
    callConnectorsFiredAt?: Date;
    /** Outbound only — the interpolated opening line stored before Media Streams connect. */
    openingScript?: string;
    /** Latest in-call order snapshot for browser test UI. */
    orderSnapshot?: Record<string, unknown>;
    /** When set, session is in trash and excluded from active stats. */
    trashedAt?: Date;
    /** Single-use secret in TwiML stream URL; validated on WebSocket connect. */
    streamToken?: string;
    createdAt: Date;
    updatedAt: Date;
}

const VoiceSessionSchema = new Schema<IVoiceSession>({
    callSid: { type: String, required: true, unique: true, index: true },
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true },
    agentId: { type: Schema.Types.ObjectId, ref: 'Agent', required: true },
    endpointId: { type: Schema.Types.ObjectId, ref: 'VoiceEndpoint' },
    channel: { type: String, enum: ['phone', 'web'], default: 'phone' },
    from: { type: String, default: '' },
    to: { type: String, default: '' },
    status: {
        type: String,
        enum: [
            'initiated', 'ringing', 'in-progress',
            'completed', 'failed', 'busy', 'no-answer', 'canceled',
        ],
        default: 'initiated',
    },
    turnCount: { type: Number, default: 0 },
    totalLatencyMs: { type: Number, default: 0 },
    silenceRetries: { type: Number, default: 0 },
    errorRetries: { type: Number, default: 0 },
    endReason: {
        type: String,
        enum: ['goodbye', 'max_turns', 'silence_timeout', 'error_limit', 'transfer', 'caller_hangup', 'ai_unavailable', 'unknown'],
    },
    startedAt: { type: Date, default: Date.now },
    endedAt: { type: Date },
    durationSec: { type: Number },
    callConnectorsFiredAt: { type: Date },
    openingScript: { type: String },
    orderSnapshot: { type: Schema.Types.Mixed },
    trashedAt: { type: Date, default: null, index: true },
    streamToken: { type: String },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now },
});

VoiceSessionSchema.pre('save', function () {
    this.updatedAt = new Date();
});

attachVoiceSessionCallConnectorHook(VoiceSessionSchema);

export const VoiceSession = mongoose.model<IVoiceSession>(
    'VoiceSession',
    VoiceSessionSchema,
);

// ---------------------------------------------------------------------------
// VoiceTurn - one per speech-response exchange within a session
// ---------------------------------------------------------------------------
export interface IVoiceTurn extends Document {
    sessionId: mongoose.Types.ObjectId;
    callSid: string;
    turnIndex: number;
    inputTranscript: string;
    inputConfidence?: number;
    aiResponse: string;
    intent?: string;
    latencyMs: number;
    firstAudioMs?: number;
    /** Ms from Deepgram final to debounce complete (STT stage). */
    sttDebounceMs?: number;
    /** Ms from debounce complete to first LLM sentence token. */
    llmFirstSentenceMs?: number;
    /** Ms from first sentence to first TTS byte sent. */
    ttsFirstByteMs?: number;
    sloOk: boolean;
    error?: string;
    createdAt: Date;
}

const VoiceTurnSchema = new Schema<IVoiceTurn>({
    sessionId: { type: Schema.Types.ObjectId, ref: 'VoiceSession', required: true },
    callSid: { type: String, required: true, index: true },
    turnIndex: { type: Number, required: true },
    inputTranscript: { type: String, required: true },
    inputConfidence: { type: Number },
    aiResponse: { type: String, required: true },
    intent: { type: String },
    latencyMs: { type: Number, default: 0 },
    firstAudioMs: { type: Number },
    sttDebounceMs: { type: Number },
    llmFirstSentenceMs: { type: Number },
    ttsFirstByteMs: { type: Number },
    sloOk: { type: Boolean, default: true },
    error: { type: String },
    createdAt: { type: Date, default: Date.now },
});

VoiceTurnSchema.index({ sessionId: 1, turnIndex: 1 });

export const VoiceTurn = mongoose.model<IVoiceTurn>(
    'VoiceTurn',
    VoiceTurnSchema,
);
