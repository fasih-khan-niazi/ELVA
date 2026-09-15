/**
 * Single place for JWT sign/verify secret.
 * Production: `requireEnv` (loaded from app.ts) exits if JWT_SECRET is missing or weak.
 */
export function getJwtSecret(): string {
    const j = process.env.JWT_SECRET?.trim();
    if (process.env.NODE_ENV === 'production') {
        if (!j) {
            throw new Error('[jwt] JWT_SECRET missing after requireEnv (misconfiguration)');
        }
        return j;
    }
    return j && j.length > 0 ? j : 'secret';
}
