/**
 * VoiceLifecycleConfig - centralised guardrails and tuning knobs
 * that govern a voice call's behaviour from ring to hangup.
 *
 * Every constant can be overridden per-agent via the agent document's
 * `responseConfig` / `voiceConfig` fields, but these defaults are the
 * production-safe baselines.
 */

// ─── Environment-overridable defaults ─────────────────────────────────────

function envInt(key: string, fallback: number): number {
    const v = process.env[key];
    return v ? Math.max(Number(v), 0) : fallback;
}

// ─── Turn / silence limits ────────────────────────────────────────────────

/** Max consecutive empty-speech (no input) retries before auto-hangup. */
export const MAX_SILENCE_RETRIES = envInt('VOICE_MAX_SILENCE_RETRIES', 5);

/** Max total turn exchanges before the bot closes the call. */
export const MAX_TURNS_PER_CALL = envInt('VOICE_MAX_TURNS', 50);

/** Max consecutive AI errors before the call is terminated. */
export const MAX_ERROR_RETRIES = envInt('VOICE_MAX_ERROR_RETRIES', 5);

// ─── Timeout tuning ──────────────────────────────────────────────────────

/** Seconds of silence before Twilio fires no-input (Gather timeout). */
/** Default 5s — 3s was too aggressive for PKR numbers, spelled emails, and street addresses. */
export const GATHER_TIMEOUT_SEC = envInt('VOICE_GATHER_TIMEOUT_SEC', 5);

/** Max seconds to wait for the AI service to respond (full turn). */
export const AI_TIMEOUT_MS = envInt('VOICE_AI_TIMEOUT_MS', 25_000);

/** Max ms to wait for the first spoken sentence from the AI stream. */
export const AI_FIRST_SENTENCE_MS = envInt('VOICE_AI_FIRST_SENTENCE_MS', 18_000);

// ─── Transfer / fallback ─────────────────────────────────────────────────

/** Phone number to transfer to when human handoff is triggered. */
export const DEFAULT_TRANSFER_NUMBER = process.env.VOICE_TRANSFER_NUMBER || '';

// ─── Closing messages ─────────────────────────────────────────────────────

export const MSG_GOODBYE =
    'Thank you for calling. Goodbye!';

export const MSG_MAX_TURNS_REACHED =
    'We have reached the maximum number of exchanges for this call. ' +
    'Please call back if you need further assistance. Goodbye!';

export const MSG_SILENCE_TIMEOUT =
    'I have not heard from you in a while. ' +
    'If you need further help, please call back. Goodbye!';

export const MSG_ERROR_LIMIT =
    'I am experiencing technical difficulties. ' +
    'Please try calling again later. Goodbye!';

export const MSG_TRANSFER =
    'Let me connect you with a team member who can help further. Please hold.';

export const MSG_SILENCE_RETRY =
    'I did not hear anything. Could you please repeat that?';

// ─── Intent-based exit detection ──────────────────────────────────────────

/**
 * If the AI or classifier returns one of these intents,
 * the call should be gracefully closed after the final message.
 */
export const EXIT_INTENTS: ReadonlySet<string> = new Set([
    'closing',
    'goodbye',
    'farewell',
    'end_call',
    'end_conversation',
    'hangup',
    'sign_off',
    'not_interested',
]);

// ─── Outbound-specific intents ───────────────────────────────────────────

export const CALLBACK_INTENTS: ReadonlySet<string> = new Set([
    'callback',
    'call_back_later',
]);

export const DNC_INTENTS: ReadonlySet<string> = new Set([
    'do_not_call',
    'dnc',
    'remove_from_list',
]);

export const WRONG_NUMBER_INTENTS: ReadonlySet<string> = new Set([
    'wrong_number',
]);

export const GATEKEEPER_INTENTS: ReadonlySet<string> = new Set([
    'gatekeeper',
]);

export const INTERESTED_INTENTS: ReadonlySet<string> = new Set([
    'interested',
    'qualified_interest',
    'meeting_booked',
]);

/**
 * If the AI or classifier returns this intent, the call should
 * be transferred to a human agent.
 */
export const TRANSFER_INTENTS: ReadonlySet<string> = new Set([
    'transfer',
    'human_handoff',
    'escalate',
]);

/**
 * Intents where the caller wants the last response repeated or clarified.
 * Handled locally without a new AI call for speed.
 */
export const REPEAT_INTENTS: ReadonlySet<string> = new Set([
    'repeat',
    'say_again',
]);

export const CLARIFY_INTENTS: ReadonlySet<string> = new Set([
    'clarify',
    'explain_more',
    'slow_down',
]);

// ─── Repeat / clarify messages ────────────────────────────────────────────

export const MSG_NOTHING_TO_REPEAT =
    'I haven\'t said anything yet. How can I help you?';

export const MSG_AI_UNAVAILABLE =
    'I\'m sorry, our system is temporarily unavailable. ' +
    'Please try calling again in a few minutes. Goodbye!';
