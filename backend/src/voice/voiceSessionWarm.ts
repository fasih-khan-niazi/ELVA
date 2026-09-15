/**
 * Prefetch agent catalog into AI session at call start (MenuIndex warm-up).
 */
import axios from 'axios';
import { getAiServiceSecretHeaders } from '../utils/aiServiceSecret';

const AI_SERVICE_URL = process.env.AI_SERVICE_URL || 'http://localhost:8000';

export async function warmAiVoiceSession(
    sessionId: string,
    agentId: string,
    tenantId: string,
): Promise<void> {
    try {
        await axios.post(
            `${AI_SERVICE_URL}/voice/warm-session`,
            {
                session_id: sessionId,
                agent_id: agentId,
                tenant_id: tenantId,
            },
            {
                timeout: 6000,
                headers: getAiServiceSecretHeaders(),
            },
        );
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`[VOICE][WARM] Menu prefetch failed for ${sessionId.slice(0, 10)}…: ${msg}`);
    }
}
