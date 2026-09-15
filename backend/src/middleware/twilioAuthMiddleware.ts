import { Request, Response, NextFunction } from 'express';
import twilio from 'twilio';

/**
 * Middleware that validates the X-Twilio-Signature header on incoming
 * webhook requests.  Rejects requests that are not authentically
 * from Twilio.
 *
 * ── Secret rotation support ──────────────────────────────────────────
 * During a Twilio auth-token rotation window both the old and new
 * tokens must be accepted simultaneously.  Configure via:
 *
 *   TWILIO_AUTH_TOKEN=primary_token
 *   TWILIO_AUTH_TOKENS=primary_token,old_token   (comma-separated)
 *
 * If TWILIO_AUTH_TOKENS is set it takes precedence: the signature is
 * validated against each token in order and succeeds if *any* match.
 * Once the rotation is complete, remove the old token from the list.
 *
 * ── Dev mode ─────────────────────────────────────────────────────────
 * Set TWILIO_SKIP_VALIDATION=true to bypass signature checking
 * (never do this in production).
 */

// ─── Token resolution ─────────────────────────────────────────────────────

function getAuthTokens(): string[] {
    // Prefer the multi-token env var (supports rotation)
    const multi = process.env.TWILIO_AUTH_TOKENS;
    if (multi) {
        return multi
            .split(',')
            .map((t) => t.trim())
            .filter(Boolean);
    }

    // Fall back to single token
    const single = process.env.TWILIO_AUTH_TOKEN;
    return single ? [single.trim()] : [];
}

// ─── Middleware ────────────────────────────────────────────────────────────

export function validateTwilioSignature(
    req: Request,
    res: Response,
    next: NextFunction,
): void {
    // Allow skipping in dev / local testing
    if (process.env.TWILIO_SKIP_VALIDATION === 'true') {
        return next();
    }

    const tokens = getAuthTokens();
    if (tokens.length === 0) {
        console.error('[TWILIO-AUTH] No auth tokens configured - rejecting request');
        res.status(500).json({ message: 'Server misconfiguration: missing Twilio auth token' });
        return;
    }

    // Build the full URL that Twilio used to call us.
    // If behind a reverse proxy (ngrok, load balancer) the
    // X-Forwarded-Proto / X-Forwarded-Host headers are used.
    const protocol =
        (req.headers['x-forwarded-proto'] as string) || req.protocol || 'https';
    const host =
        (req.headers['x-forwarded-host'] as string) || req.headers.host || '';
    const url = `${protocol}://${host}${req.originalUrl}`;

    const signature = req.headers['x-twilio-signature'] as string | undefined;

    if (!signature) {
        console.warn('[TWILIO-AUTH] Missing X-Twilio-Signature header');
        res.status(403).json({ message: 'Forbidden: missing Twilio signature' });
        return;
    }

    // req.body has been parsed as url-encoded by express
    const params = req.body || {};

    // Try each configured token - succeed on first match
    const isValid = tokens.some((token) =>
        twilio.validateRequest(token, signature, url, params),
    );

    if (!isValid) {
        console.warn('[TWILIO-AUTH] Invalid Twilio signature', {
            url,
            tokensChecked: tokens.length,
        });
        res.status(403).json({ message: 'Forbidden: invalid Twilio signature' });
        return;
    }

    next();
}
