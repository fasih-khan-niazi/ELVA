import crypto from 'crypto';
import { VoiceSession } from '../voice/voiceModels';

/** One-time secret embedded in TwiML stream URL; validated on WebSocket connect. */
export function generateStreamToken(): string {
    return crypto.randomBytes(32).toString('hex');
}

export async function ensureSessionStreamToken(callSid: string): Promise<string | null> {
    const session = await VoiceSession.findOne({ callSid }).select('streamToken');
    if (!session) return null;
    if (session.streamToken) return session.streamToken;
    session.streamToken = generateStreamToken();
    await session.save();
    return session.streamToken;
}

/** Reject connections that do not present the token issued when the call session was created. */
export async function validateMediaStreamToken(callSid: string, token: string): Promise<boolean> {
    if (!callSid || !token) return false;

    const session = await VoiceSession.findOne({ callSid }).select('streamToken status').lean();
    if (!session?.streamToken) return false;

    const activeStatuses = new Set(['initiated', 'ringing', 'in-progress']);
    if (!activeStatuses.has(session.status)) return false;

    try {
        const a = Buffer.from(token, 'utf8');
        const b = Buffer.from(session.streamToken, 'utf8');
        return a.length === b.length && crypto.timingSafeEqual(a, b);
    } catch {
        return false;
    }
}
