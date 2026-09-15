/**
 * STT configuration — Deepgram (Media Streams) with legacy confidence thresholds
 * retained for analytics compatibility.
 */

function envFloat(key: string, fallback: number): number {
    const v = process.env[key];
    if (!v) return fallback;
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : fallback;
}

/** Minimum confidence to accept a transcript (legacy Gather path removed). */
export const STT_MIN_CONFIDENCE = envFloat('VOICE_STT_MIN_CONFIDENCE', 0.48);

export const STT_LOW_CONFIDENCE_WARN = envFloat('VOICE_STT_LOW_CONFIDENCE_WARN', 0.70);

export const MSG_LOW_CONFIDENCE =
    'Sorry, I did not quite catch that. Could you say it once more, a little slower and closer to the phone?';
