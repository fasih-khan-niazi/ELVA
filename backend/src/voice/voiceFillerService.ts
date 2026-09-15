/**
 * Short acknowledgment clips played while the LLM is thinking.
 * Enabled by default (VOICE_FILLERS_ENABLED !== 'false').
 */

const ENABLED = process.env.VOICE_FILLERS_ENABLED !== 'false';

/** Order-flow acks — filler would feel redundant. */
const SKIP_FILLER =
    /^(yes|no|yeah|yep|yup|nope|nah|ok|okay|sure|skip|correct|right|one|two|three|four|five|six|seven|eight|nine|ten)\.?$/i;

/** Questions benefit from a brief ack before the answer streams. */
const QUESTION =
    /\?|^(what|where|when|who|why|how|can you|could you|do you|is there|are there|tell me|i want|i'd like|i would like)\b/i;

/** Menu / catalog lookups — user expects a moment to "check". */
const MENU_OR_ORDER =
    /\b(menu|order|price|cost|available|special|dish|item|platter|delivery|takeaway|dine)\b/i;

const GENERAL_FILLERS = ['Got it.', 'Sure.', 'One moment.'];
const QUESTION_FILLERS = ['Good question.', 'Let me check.', 'One moment.'];
const MENU_FILLERS = ['Let me look that up.', 'One moment.', 'Sure, let me check.'];

let fillerIndex = 0;

function pickFrom(pool: string[]): string {
    const line = pool[fillerIndex % pool.length];
    fillerIndex += 1;
    return line;
}

/**
 * Returns a short filler line, or null when filler would hurt UX.
 */
export function pickVoiceFiller(transcript: string): string | null {
    if (!ENABLED) return null;

    const t = transcript.trim();
    if (!t || t.length < 4) return null;
    if (SKIP_FILLER.test(t)) return null;

    if (MENU_OR_ORDER.test(t)) return pickFrom(MENU_FILLERS);
    if (QUESTION.test(t)) return pickFrom(QUESTION_FILLERS);
    if (t.split(/\s+/).length >= 6) return pickFrom(GENERAL_FILLERS);

    return null;
}
