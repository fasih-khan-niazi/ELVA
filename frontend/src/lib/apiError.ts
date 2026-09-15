import type { ToastContextType } from '@/components/Toast';

const DEFAULT_MESSAGES: Record<number, string> = {
    400: 'Invalid request',
    401: 'Please sign in again',
    403: 'You do not have permission to do that',
    404: 'Not found',
    409: 'This action conflicts with existing data',
    422: 'Could not process your request',
    429: 'Too many requests — try again shortly',
    500: 'Something went wrong on our end',
    503: 'Service temporarily unavailable',
};

export async function parseApiErrorMessage(
    res: Response,
    fallback = 'Request failed',
): Promise<string> {
    try {
        const data = (await res.json()) as { message?: string; error?: string };
        return data.message || data.error || DEFAULT_MESSAGES[res.status] || fallback;
    } catch {
        return DEFAULT_MESSAGES[res.status] || fallback;
    }
}

export async function handleApiError(
    res: Response,
    toast: Pick<ToastContextType, 'error'>,
    options?: { title?: string; fallback?: string; silent?: boolean },
): Promise<string> {
    const message = await parseApiErrorMessage(res, options?.fallback);
    if (!options?.silent) {
        toast.error(options?.title ?? 'Request failed', message);
    }
    return message;
}

export function handleNetworkError(
    toast: Pick<ToastContextType, 'error'>,
    options?: { title?: string; message?: string },
): void {
    toast.error(
        options?.title ?? 'Connection error',
        options?.message ?? 'Could not reach the server. Check your connection and try again.',
    );
}

/** Copy text to clipboard and show a success toast */
export async function copyWithToast(
    text: string,
    toast: Pick<ToastContextType, 'success' | 'error'>,
    label = 'Copied to clipboard',
): Promise<boolean> {
    try {
        await navigator.clipboard.writeText(text);
        toast.success(label);
        return true;
    } catch {
        toast.error('Copy failed', 'Could not copy to clipboard');
        return false;
    }
}
