import rateLimit from 'express-rate-limit';

/**
 * Applies to `/api/auth/*` — curbs credential-stuffing and signup spam.
 * 15 attempts per IP per 15-minute window is generous for normal use but
 * blocks automated attacks.
 */
export const authRoutesLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 15,
    standardHeaders: true,
    legacyHeaders: false,
    message: { message: 'Too many login attempts from this IP. Please wait 15 minutes and try again.' },
    skipSuccessfulRequests: true,
});
