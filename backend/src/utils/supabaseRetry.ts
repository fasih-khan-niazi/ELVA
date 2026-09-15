/**
 * Retry wrapper for transient Supabase / network failures (DNS blips, EAI_AGAIN).
 */

const RETRYABLE = /EAI_AGAIN|ENOTFOUND|ETIMEDOUT|ECONNRESET|fetch failed|timeout|502|503|504/i;

export function isRetryableNetworkError(message: string): boolean {
    return RETRYABLE.test(message || '');
}

export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function withRetry<T>(
    label: string,
    fn: () => Promise<T>,
    retries = 3,
    baseDelayMs = 400,
): Promise<T> {
    let lastErr: unknown;
    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            return await fn();
        } catch (err: any) {
            lastErr = err;
            const msg = err?.message || String(err);
            if (attempt < retries && isRetryableNetworkError(msg)) {
                console.warn(`[${label}] Attempt ${attempt} failed (${msg}), retrying…`);
                await sleep(baseDelayMs * attempt);
                continue;
            }
            throw err;
        }
    }
    throw lastErr;
}

/** User-facing message — no internal infra details. */
export const STORAGE_UNAVAILABLE_MESSAGE =
    'Document storage is temporarily unavailable. Please wait a moment and try again. ' +
    'If this continues, refresh the page or restart the backend service.';
