/**
 * Twilio TTS helpers — all speech uses Twilio's native `<Say>` (Polly) unless
 * an explicit audio URL is provided (e.g. voicemail drop).
 */

import twilio from 'twilio';

export function getCachedAudio(_audioId: string): null {
    return null;
}

/**
 * Voicemail drop: play remote audio when URL is set; otherwise Twilio TTS.
 */
export function buildVoicemailTwiml(
    voicemailDropUrl: string,
    fallbackText: string,
    options: { language?: string } = {},
): string {
    const twimlObj = new twilio.twiml.VoiceResponse();
    const trimmed = (voicemailDropUrl || '').trim();
    if (trimmed.startsWith('http')) {
        twimlObj.play(trimmed);
    } else {
        twimlObj.say(
            {
                language: (options.language || 'en-US') as any,
            },
            fallbackText,
        );
    }
    return twimlObj.toString();
}
