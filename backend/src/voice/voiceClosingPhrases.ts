/**
 * Heuristic call-ending detection for Twilio speech transcripts.
 * Used as a safety net when the classifier returns question/acknowledgement
 * but the user clearly wanted to hang up (mirrors ai_service _is_closing_statement).
 */

import { EXIT_INTENTS } from './voiceLifecycle';

function normalise(raw: string): string {
    return raw
        .toLowerCase()
        .replace(/[,.?!;:]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

const EXACT = new Set([
    'bye',
    'goodbye',
    'bye bye',
    'no thanks',
    'no thank you',
    'that\'s all',
    'thats all',
    'that is all',
    'that\'s it',
    'thats it',
    'nothing else',
    'nothing more',
    'i\'m good',
    'im good',
    'we\'re done',
    'were done',
    'all done',
    'end the call',
    'hang up',
    'cheers',
]);

const SUBSTRINGS = [
    'that\'s it',
    'thats it',
    'that is it',
    'end the call',
    'end call',
    'hang up',
    'hangup',
    'disconnect',
    'close the call',
    'thanks for calling',
    'thank you for calling',
    'have a great day',
    'have a good day',
    'take care',
    'talk later',
    'see you later',
    'we\'re all set',
    'were all set',
    'i\'m all set',
    'im all set',
    'gotta go',
    'have to go',
    'need to run',
    'appreciate your help',
    'thanks for your help',
];

/** If classifier missed closing, upgrade to a hangup-eligible intent for voice. */
export function mergeExitIntentFromTranscript(
    speech: string | undefined,
    intent: string | undefined,
): string | undefined {
    if (!speech) return intent;
    if (intent && EXIT_INTENTS.has(intent)) return intent;
    if (!isLikelyCallEndingTranscript(speech)) return intent;
    return 'closing';
}

export function isLikelyCallEndingTranscript(raw: string): boolean {
    const clean = normalise(raw);
    if (!clean) return false;
    const words = clean.split(' ');
    if (words.length > 14) return false;
    if (clean.startsWith('is that it') || clean.startsWith('was that it')) return false;
    if (EXACT.has(clean)) return true;
    if (SUBSTRINGS.some((s) => clean.includes(s))) return true;
    if (words.length <= 4 && (clean === 'thanks' || clean === 'thank you' || clean.startsWith('thanks ') || clean.endsWith(' thanks'))) {
        return true;
    }
    return false;
}
