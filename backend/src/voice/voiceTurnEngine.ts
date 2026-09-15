import { IVoiceSession } from './voiceModels';
import { ResolvedVoiceAgent } from './voiceResolver';
import { getLastTurn } from './voiceOrchestrator';
import {
    MAX_TURNS_PER_CALL,
    MSG_GOODBYE,
    MSG_NOTHING_TO_REPEAT,
} from './voiceLifecycle';
import { isRepeatRequest, isClarifyRequest } from './voicePromptAdapter';
import { buildRepeatResponse, buildClarifyPreamble } from './voiceResponseGuard';

export type PreTurnShortcutResult =
    | {
        handled: true;
        reply: string;
        endCall?: boolean;
        endReason?: IVoiceSession['endReason'];
    }
    | {
        handled: false;
        speechForTurn: string;
    };

/**
 * Max-turn guard, repeat/clarify shortcuts — shared across Media Streams handler.
 */
export function evaluatePreTurnShortcuts(
    callSid: string,
    transcript: string,
    session: IVoiceSession,
    resolved: ResolvedVoiceAgent,
): PreTurnShortcutResult {
    const effectiveMaxTurns = resolved.responseConfig?.maxTurns || MAX_TURNS_PER_CALL;
    if (session.turnCount >= effectiveMaxTurns) {
        return {
            handled: true,
            reply: MSG_GOODBYE,
            endCall: true,
            endReason: 'max_turns',
        };
    }

    if (isRepeatRequest(transcript)) {
        const last = getLastTurn(callSid);
        return {
            handled: true,
            reply: last ? buildRepeatResponse(last) : MSG_NOTHING_TO_REPEAT,
        };
    }

    let speechForTurn = transcript;
    if (isClarifyRequest(transcript)) {
        const last = getLastTurn(callSid);
        if (last) {
            speechForTurn = `${buildClarifyPreamble()} ${transcript}`.trim();
        }
    }

    return { handled: false, speechForTurn };
}
