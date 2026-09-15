/**
 * Background startup probes — logs status internally, never requires user action.
 */

import axios from 'axios';
import { terminalLog } from '../utils/terminalLog';
import { isAzureTtsConfigured } from './azureTtsService';
import { checkDeepgramReachable } from './deepgramHealth';
import { warmupDnsHosts } from '../utils/dnsWarmup';
import { USE_MEDIA_STREAMS, USE_BROWSER_MEDIA_STREAMS } from './voicePipelineConfig';
import { reapStaleVoiceSessions } from './voiceConcurrencyGuard';

const AI_SERVICE_URL = process.env.AI_SERVICE_URL || 'http://localhost:8000';

export async function runVoiceStartupProbe(): Promise<void> {
    terminalLog.banner('ELVA Voice Pipeline');

    await warmupDnsHosts();
    await reapStaleVoiceSessions();

    terminalLog.row(
        'Mode',
        USE_MEDIA_STREAMS ? 'Media Streams (Deepgram + Azure)' : 'DISABLED — set ENABLE_MEDIA_STREAMS=true',
        USE_MEDIA_STREAMS,
    );
    terminalLog.row(
        'Browser WebRTC',
        USE_BROWSER_MEDIA_STREAMS && USE_MEDIA_STREAMS ? 'Media Streams (same as PSTN)' : 'Disabled',
        USE_BROWSER_MEDIA_STREAMS && USE_MEDIA_STREAMS,
    );

    const azureOk = isAzureTtsConfigured();
    terminalLog.row(
        'Azure TTS',
        azureOk ? `${process.env.AZURE_TTS_VOICE || 'Jenny'} @ ${process.env.AZURE_SPEECH_REGION || '?'}` : 'Not configured',
        azureOk,
    );

    const deepgramOk = await checkDeepgramReachable(true);
    terminalLog.row('Deepgram STT', deepgramOk ? 'nova-2 ready' : 'Unreachable (will retry per call)', deepgramOk);

    let aiOk = false;
    try {
        const resp = await axios.get(`${AI_SERVICE_URL}/health/voice`, { timeout: 5_000 });
        aiOk = resp.status === 200;
        const supa = resp.data?.supabase?.reachable;
        terminalLog.row('AI service', AI_SERVICE_URL, aiOk);
        if (supa !== undefined) {
            terminalLog.row('Supabase (via AI)', supa ? 'Connected' : 'Unreachable', supa);
        }
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        terminalLog.row('AI service', `${AI_SERVICE_URL} — ${msg}`, false);
    }

    terminalLog.row('WebSocket', USE_MEDIA_STREAMS ? '/api/voice/stream' : 'disabled', USE_MEDIA_STREAMS);

    if (USE_MEDIA_STREAMS && !deepgramOk) {
        terminalLog.warn('VOICE', 'Deepgram unreachable at startup — each call will retry.');
        scheduleDeepgramRecheck();
    }
    if (!aiOk) {
        terminalLog.warn('VOICE', 'AI service not reachable — start ai_service on port 8000.');
    }

    terminalLog.dim('');
}

function scheduleDeepgramRecheck(): void {
    const delays = [15_000, 45_000, 120_000];
    for (const delay of delays) {
        setTimeout(async () => {
            const ok = await checkDeepgramReachable(true);
            if (ok) terminalLog.ok('VOICE', 'Deepgram STT is now reachable');
        }, delay);
    }
}
