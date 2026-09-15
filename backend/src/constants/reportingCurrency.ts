/**
 * Workspace ISO currency codes.
 * `reportingCurrency` on Tenant = tenant-wide display (business admins).
 * `ledgerCurrency` = interpretation of stored order totals for analytics.
 */
export const REPORTING_CURRENCY_CODES = [
    'USD',
    'PKR',
    'EUR',
    'GBP',
    'INR',
    'AED',
    'SAR',
    'CAD',
    'AUD',
] as const;

export type ReportingCurrencyCode = (typeof REPORTING_CURRENCY_CODES)[number];

export function parseReportingCurrency(raw: unknown): ReportingCurrencyCode | null {
    if (typeof raw !== 'string') return null;
    const code = raw.trim().toUpperCase();
    return (REPORTING_CURRENCY_CODES as readonly string[]).includes(code)
        ? (code as ReportingCurrencyCode)
        : null;
}
