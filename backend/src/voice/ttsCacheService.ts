import { createHash } from 'crypto';

interface CacheEntry {
    buffer: Buffer;
    expiresAt: number;
}

const TTL_MS = parseInt(process.env.VOICE_TTS_CACHE_TTL_MS || '300000', 10);
const MAX_ENTRIES = parseInt(process.env.VOICE_TTS_CACHE_MAX || '64', 10);
const cache = new Map<string, CacheEntry>();

function cacheKey(text: string, language?: string, voiceId?: string): string {
    const raw = `${(language || 'en-US').toLowerCase()}|${voiceId || 'default'}|${text.trim()}`;
    return createHash('sha256').update(raw).digest('hex').slice(0, 32);
}

export function getCachedTtsBuffer(
    text: string,
    language?: string,
    voiceId?: string,
): Buffer | null {
    const key = cacheKey(text, language, voiceId);
    const hit = cache.get(key);
    if (!hit) return null;
    if (Date.now() > hit.expiresAt) {
        cache.delete(key);
        return null;
    }
    return hit.buffer;
}

export function setCachedTtsBuffer(
    text: string,
    buffer: Buffer,
    language?: string,
    voiceId?: string,
): void {
    if (cache.size >= MAX_ENTRIES) {
        const oldest = cache.keys().next().value;
        if (oldest) cache.delete(oldest);
    }
    cache.set(cacheKey(text, language, voiceId), {
        buffer,
        expiresAt: Date.now() + TTL_MS,
    });
}

/** Back-compat alias used by ttsService. */
export function getCachedAudio(audioId: string): Buffer | null {
    const hit = cache.get(audioId);
    if (!hit || Date.now() > hit.expiresAt) return null;
    return hit.buffer;
}
