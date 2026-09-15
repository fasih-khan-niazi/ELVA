/** Format a monetary amount using ISO currency code (workspace/agent currency). */
export function formatMoney(amount: number, currencyCode = 'PKR'): string {
    try {
        return new Intl.NumberFormat(undefined, {
            style: 'currency',
            currency: currencyCode.toUpperCase(),
            minimumFractionDigits: 0,
            maximumFractionDigits: 2,
        }).format(amount);
    } catch {
        return `${currencyCode.toUpperCase()} ${amount.toFixed(2)}`;
    }
}
