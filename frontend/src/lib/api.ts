/**
 * Central API client — HttpOnly cookie sessions with optional Bearer override
 * (saved-account switching). In dev, Vite proxies /api to the backend.
 */

export const API_BASE =
    import.meta.env.VITE_API_URL ??
    (import.meta.env.DEV ? '' : 'http://localhost:3000');

type ApiFetchOptions = RequestInit & {
    /** When set, sends Authorization Bearer instead of relying on cookie only. */
    token?: string | null;
    /** Skip global 401 handler (login/signup flows). */
    skipAuthRedirect?: boolean;
};

let unauthorizedHandler: (() => void) | null = null;

export function setUnauthorizedHandler(handler: (() => void) | null): void {
    unauthorizedHandler = handler;
}

export function buildAuthHeaders(token?: string | null): HeadersInit {
    const headers: Record<string, string> = {};
    if (token) {
        headers.Authorization = `Bearer ${token}`;
    }
    return headers;
}

export async function apiFetch(path: string, options: ApiFetchOptions = {}): Promise<Response> {
    const { token, skipAuthRedirect, headers: initHeaders, ...rest } = options;
    const url = path.startsWith('http') ? path : `${API_BASE}${path.startsWith('/') ? path : `/${path}`}`;

    const headers = new Headers(initHeaders);
    if (token) {
        headers.set('Authorization', `Bearer ${token}`);
    }
    if (!headers.has('Content-Type') && rest.body && !(rest.body instanceof FormData)) {
        headers.set('Content-Type', 'application/json');
    }

    const response = await fetch(url, {
        ...rest,
        headers,
        credentials: 'include',
    });

    if (response.status === 401 && !skipAuthRedirect && unauthorizedHandler) {
        unauthorizedHandler();
    }

    return response;
}

export async function apiJson<T = unknown>(
    path: string,
    options: ApiFetchOptions = {},
): Promise<{ ok: boolean; status: number; data: T | null }> {
    const res = await apiFetch(path, options);
    let data: T | null = null;
    try {
        data = (await res.json()) as T;
    } catch {
        data = null;
    }
    return { ok: res.ok, status: res.status, data };
}

export { parseApiErrorMessage } from './apiError';
