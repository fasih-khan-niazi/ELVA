import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';

function devInsecureBypassAllowed(): boolean {
    return (
        process.env.NODE_ENV !== 'production' &&
        process.env.ELVA_DEV_INSECURE === '1'
    );
}

/** Compare bearer / header secret to INTERNAL_API_SECRET (timing-safe when lengths match). */
export function requireInternalApiSecret(req: Request, res: Response, next: NextFunction): void {
    const configuredRaw = process.env.INTERNAL_API_SECRET?.trim();

    if (!configuredRaw || configuredRaw.length === 0) {
        if (devInsecureBypassAllowed()) {
            console.warn(
                '[internal-api] ELVA_DEV_INSECURE=1 — internal routes accept any caller (local dev only)',
            );
            next();
            return;
        }
        console.error('[internal-api] INTERNAL_API_SECRET must be set');
        res.status(503).json({
            message:
                'Internal integrations are not configured. Set INTERNAL_API_SECRET in backend/.env (must match ai_service/.env).',
        });
        return;
    }

    const header = req.headers['x-internal-secret'];
    const fromHeader =
        typeof header === 'string' ? header.trim() : Array.isArray(header) ? header[0]?.trim() : '';
    const auth = req.headers.authorization;
    const bearer =
        typeof auth === 'string' && auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
    const provided = fromHeader || bearer;

    if (!provided || provided.length !== configuredRaw.length) {
        console.warn(
            '[internal-api] 401 — INTERNAL_API_SECRET length mismatch or missing X-Internal-Secret/Bearer',
        );
        res.status(401).json({ message: 'Unauthorized' });
        return;
    }

    try {
        const a = Buffer.from(provided, 'utf8');
        const b = Buffer.from(configuredRaw, 'utf8');
        if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
            console.warn(
                '[internal-api] 401 — INTERNAL_API_SECRET value mismatch ' +
                    '(ensure ai_service .env matches backend INTERNAL_API_SECRET)',
            );
            res.status(401).json({ message: 'Unauthorized' });
            return;
        }
    } catch {
        res.status(401).json({ message: 'Unauthorized' });
        return;
    }

    next();
}
