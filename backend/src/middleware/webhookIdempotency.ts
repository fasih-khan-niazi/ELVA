import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';

/**
 * Twilio retries webhook POST requests if it doesn't receive a timely
 * 200 response.  Without idempotency protection the same speech turn
 * or status event can be processed more than once, leading to duplicate
 * VoiceTurn documents and double-counted metrics.
 *
 * This middleware keeps a short-lived in-memory cache of recently
 * processed webhook keys.  On a duplicate delivery, the cached TwiML
 * response (or empty 200) is replayed immediately - no DB writes,
 * no AI calls.
 *
 * The key formula depends on the webhook path:
 *   /incoming        → CallSid
 *   /process         → CallSid + sha256(SpeechResult)
 *   /status-callback → CallSid + CallStatus
 *
 * TTL is configurable via WEBHOOK_IDEMPOTENCY_TTL_MS (default 120 s).
 */

// ─── Config ───────────────────────────────────────────────────────────────

const DEFAULT_TTL_MS = 15_000; // 15 seconds - Twilio retries within ~5s
const CLEANUP_INTERVAL_MS = 60_000; // sweep every minute

function ttlMs(): number {
    const env = process.env.WEBHOOK_IDEMPOTENCY_TTL_MS;
    return env ? Math.max(Number(env), 5_000) : DEFAULT_TTL_MS;
}

// ─── Cache store ──────────────────────────────────────────────────────────

interface CachedEntry {
    body: string;        // TwiML XML or empty string
    contentType: string; // original content-type
    statusCode: number;
    expiresAt: number;   // Date.now() + TTL
}

const cache = new Map<string, CachedEntry>();

// Periodic cleanup so the map doesn't grow unbounded
setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of cache) {
        if (entry.expiresAt <= now) cache.delete(key);
    }
}, CLEANUP_INTERVAL_MS).unref(); // unref so it doesn't block process exit

// ─── Key derivation ──────────────────────────────────────────────────────

function deriveKey(req: Request): string | null {
    const callSid: string | undefined = req.body?.CallSid;
    if (!callSid) return null; // cannot build a key - skip guard

    const path = req.path; // e.g. "/incoming", "/process", "/status-callback"

    if (path.includes('process')) {
        const speech: string = req.body?.SpeechResult || '';
        // Empty speech = silence/redirect fallback - these repeat by design
        // and must NOT be cached, otherwise the silence handler gets stuck
        // replaying the same response and the caller never gets past it.
        if (!speech) return null;
        const speechHash = crypto
            .createHash('sha256')
            .update(speech)
            .digest('hex')
            .slice(0, 12);
        return `process:${callSid}:${speechHash}`;
    }

    if (path.includes('status-callback')) {
        const status: string = req.body?.CallStatus || 'unknown';
        return `status:${callSid}:${status}`;
    }

    // /incoming - a call only arrives once per CallSid
    return `incoming:${callSid}`;
}

// ─── Write helper (called after response is sent) ─────────────────────────

function captureResponse(key: string, res: Response): void {
    const originalSend = res.send.bind(res);

    res.send = function (body?: any): Response {
        // Store a copy so replays are fast
        cache.set(key, {
            body: typeof body === 'string' ? body : String(body ?? ''),
            contentType: (res.getHeader('content-type') as string) || 'text/xml',
            statusCode: res.statusCode || 200,
            expiresAt: Date.now() + ttlMs(),
        });
        return originalSend(body);
    };
}

// ─── Middleware ────────────────────────────────────────────────────────────

export function webhookIdempotency(
    req: Request,
    res: Response,
    next: NextFunction,
): void {
    const key = deriveKey(req);

    if (!key) {
        // Cannot compute a key - let the request through
        return next();
    }

    const cached = cache.get(key);
    if (cached && cached.expiresAt > Date.now()) {
        console.log('[IDEMPOTENCY] Replay cached response', { key });
        res.status(cached.statusCode).type(cached.contentType).send(cached.body);
        return;
    }

    // First time seeing this key - intercept res.send to cache the result
    captureResponse(key, res);
    next();
}

// ─── Test / debug helpers ─────────────────────────────────────────────────

/** Returns the current cache size (for monitoring / health endpoint). */
export function idempotencyCacheSize(): number {
    return cache.size;
}
