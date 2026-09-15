import { Response, NextFunction, Request, ErrorRequestHandler } from 'express';
import rateLimit from 'express-rate-limit';

/** Broad API rate limit — skips webhooks and health probes. */
export const globalApiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 600,
    standardHeaders: true,
    legacyHeaders: false,
    skip: (req) => {
        const path = req.path || '';
        if (path === '/health') return true;
        if (path.startsWith('/api/subscription/webhook')) return true;
        if (path.startsWith('/api/slack/interactions')) return true;
        if (path.startsWith('/api/voice')) return true;
        if (path.startsWith('/api/public')) return true;
        return false;
    },
    message: { message: 'Too many requests — please try again shortly.' },
});

export function notFoundHandler(_req: Request, res: Response): void {
    res.status(404).json({ message: 'Not found' });
}

export const globalErrorHandler: ErrorRequestHandler = (err, _req, res, next) => {
    if (res.headersSent) {
        next(err);
        return;
    }
    console.error('[error-handler]', err);
    res.status(500).json({ message: 'Internal server error' });
};
