/** Human-readable single-line details for audit metadata (UI + PDF). */
export function formatAuditMetadata(meta: Record<string, unknown> | undefined | null): string {
    if (!meta || typeof meta !== 'object') return '';
    const keys = Object.keys(meta);
    if (keys.length === 0) return '';
    return keys
        .map((k) => {
            const v = meta[k];
            const s = v !== null && typeof v === 'object' ? JSON.stringify(v) : String(v);
            return `${k}: ${s}`;
        })
        .join(' · ');
}
