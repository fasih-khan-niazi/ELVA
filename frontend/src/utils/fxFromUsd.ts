/**
 * Live FX rates via exchangerate-api.com (free tier).
 * VITE_FX_API_KEY must be set in .env
 */
const API_KEY = import.meta.env.VITE_FX_API_KEY || '';
const BASE_URL = 'https://v6.exchangerate-api.com/v6';

export type RatesMap = Record<string, number>;

/**
 * Fetch conversion rates with `baseCurrency` as the base.
 * Result: { USD: 1, PKR: 278.5, EUR: 0.92, ... } when base = USD.
 * Aborts after 7 seconds to avoid hanging the UI.
 */
export async function fetchRatesFrom(baseCurrency: string, timeoutMs = 7000): Promise<RatesMap> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const res = await fetch(`${BASE_URL}/${API_KEY}/latest/${baseCurrency.toUpperCase()}`, {
            signal: controller.signal,
        });
        if (!res.ok) throw new Error(`FX HTTP ${res.status}`);
        const data = (await res.json()) as { result: string; conversion_rates?: RatesMap; 'error-type'?: string };
        if (data.result !== 'success') throw new Error(`FX error: ${data['error-type'] ?? 'unknown'}`);
        return data.conversion_rates!;
    } finally {
        clearTimeout(timer);
    }
}

/**
 * Convert `amount` (in `baseCurrency`) to `targetCurrency` using rates fetched
 * from `fetchRatesFrom(baseCurrency)`.
 */
export function convertAmount(
    amount: number,
    targetCurrency: string,
    rates: RatesMap,
): number | null {
    const rate = rates[targetCurrency.toUpperCase()];
    if (rate == null || !Number.isFinite(rate) || rate === 0) return null;
    return amount * rate;
}
