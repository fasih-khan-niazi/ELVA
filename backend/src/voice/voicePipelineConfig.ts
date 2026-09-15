/**
 * Single source of truth for the active voice pipeline.
 *
 * Production: Media Streams only (Deepgram STT + Azure TTS over WebSocket).
 */

export const USE_MEDIA_STREAMS = process.env.ENABLE_MEDIA_STREAMS !== 'false';

/** Browser WebRTC test calls use the same Media Streams pipeline as phone. */
export const USE_BROWSER_MEDIA_STREAMS = process.env.ENABLE_BROWSER_MEDIA_STREAMS !== 'false';

export function resolveStreamCallType(isBrowserCall: boolean): 'browser' | 'inbound' {
    return isBrowserCall ? 'browser' : 'inbound';
}

export function shouldUseMediaStreams(isBrowserCall: boolean): boolean {
    if (!USE_MEDIA_STREAMS) return false;
    if (isBrowserCall && !USE_BROWSER_MEDIA_STREAMS) return false;
    return true;
}

/** Fail fast at startup when Media Streams is disabled. */
export function assertMediaStreamsEnabled(): void {
    if (!USE_MEDIA_STREAMS) {
        throw new Error(
            'ENABLE_MEDIA_STREAMS must be true — legacy TwiML Gather pipeline has been removed.',
        );
    }
}
