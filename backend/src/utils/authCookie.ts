import type { Response, Request } from 'express';

export const AUTH_COOKIE_NAME = 'elva_token';

const ONE_DAY_SEC = 24 * 60 * 60;
const PLATFORM_TTL_SEC = 7 * ONE_DAY_SEC;

function cookieMaxAgeSec(role: string): number {
    return role === 'platform_admin' ? PLATFORM_TTL_SEC : ONE_DAY_SEC;
}

function isProduction(): boolean {
    return process.env.NODE_ENV === 'production';
}

/** Set HttpOnly session cookie after successful authentication. */
export function setAuthCookie(res: Response, token: string, role: string): void {
    res.cookie(AUTH_COOKIE_NAME, token, {
        httpOnly: true,
        secure: isProduction(),
        sameSite: isProduction() ? 'strict' : 'lax',
        maxAge: cookieMaxAgeSec(role) * 1000,
        path: '/',
    });
}

export function clearAuthCookie(res: Response): void {
    res.clearCookie(AUTH_COOKIE_NAME, {
        httpOnly: true,
        secure: isProduction(),
        sameSite: isProduction() ? 'strict' : 'lax',
        path: '/',
    });
}

export function readAuthTokenFromRequest(req: Request): string | null {
    const bearer = req.headers.authorization;
    if (typeof bearer === 'string' && bearer.startsWith('Bearer ')) {
        const token = bearer.slice(7).trim();
        if (token) return token;
    }

    const fromParsed = (req as Request & { cookies?: Record<string, string> }).cookies?.[
        AUTH_COOKIE_NAME
    ];
    if (typeof fromParsed === 'string' && fromParsed.trim()) {
        return fromParsed.trim();
    }

    return null;
}
