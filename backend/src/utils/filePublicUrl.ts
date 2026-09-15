/** Public URL prefix for files served under `/uploads` (backend origin). */
export function filePublicUrl(relativeUploadPath: string): string {
    const rel = relativeUploadPath.startsWith('/') ? relativeUploadPath : `/${relativeUploadPath}`;
    const base = (process.env.BASE_URL || `http://localhost:${process.env.PORT || 3000}`).replace(/\/$/, '');
    return `${base}${rel}`;
}
