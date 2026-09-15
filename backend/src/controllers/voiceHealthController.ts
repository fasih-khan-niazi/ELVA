import { Request, Response } from 'express';
import axios from 'axios';
import { isAzureTtsConfigured } from '../voice/azureTtsService';
import { getAiHealthStatus } from '../voice/voiceOrchestrator';
import { checkDeepgramReachable } from '../voice/deepgramHealth';

const AI_SERVICE_URL = process.env.AI_SERVICE_URL || 'http://localhost:8000';

/**
 * GET /api/voice/health
 * Public probe — no Twilio signature (mounted outside voiceRoutes).
 */
export async function getVoiceHealth(_req: Request, res: Response): Promise<void> {
    const mediaStreams = process.env.ENABLE_MEDIA_STREAMS === 'true';
    const browserMediaStreams = process.env.ENABLE_BROWSER_MEDIA_STREAMS === 'true';
    const voiceStreaming = process.env.ENABLE_VOICE_STREAMING !== 'false';
    const deepgramConfigured = !!(process.env.DEEPGRAM_API_KEY || '').trim();
    const deepgramReachable = deepgramConfigured ? await checkDeepgramReachable(true) : false;
    const azureConfigured = isAzureTtsConfigured();
    const aiHealth = getAiHealthStatus();

    let aiService: Record<string, unknown> = { reachable: false };
    try {
        const resp = await axios.get(`${AI_SERVICE_URL}/health/voice`, { timeout: 4000 });
        aiService = { reachable: true, ...resp.data };
    } catch (err: any) {
        aiService = { reachable: false, error: err?.message || 'unreachable' };
    }

    const ok =
        azureConfigured
        && deepgramConfigured
        && deepgramReachable
        && mediaStreams
        && (aiService.reachable === true);

    res.json({
        status: ok ? 'ok' : 'degraded',
        timestamp: new Date().toISOString(),
        pipeline: {
            mediaStreams,
            browserMediaStreams,
            voiceStreaming,
            deepgramConfigured,
            deepgramReachable,
            azureConfigured,
            azureRegion: process.env.AZURE_SPEECH_REGION || null,
            defaultVoice: process.env.AZURE_TTS_VOICE || 'en-US-JennyNeural',
        },
        aiOrchestrator: aiHealth,
        aiService,
    });
}
