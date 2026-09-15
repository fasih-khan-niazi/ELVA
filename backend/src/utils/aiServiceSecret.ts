/**
 * Optional shared secret between Node backend and ai_service.
 * When AI_SERVICE_SECRET is set in both places, every business endpoint on
 * FastAPI requires header `x-elva-ai-service-secret` (GET / and /health stay open for probes).
 */

export const AI_SERVICE_SECRET_HEADER = 'x-elva-ai-service-secret';

/** Headers to merge onto axios/fetch requests to ai_service (empty object if unset). */
export function getAiServiceSecretHeaders(): Record<string, string> {
    const secret = process.env.AI_SERVICE_SECRET?.trim();
    if (!secret) return {};
    return { [AI_SERVICE_SECRET_HEADER]: secret };
}
