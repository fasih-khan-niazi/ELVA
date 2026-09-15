/**
 * voiceResponseGuard.ts
 *
 * Post-processes AI responses before they reach TTS / TwiML rendering.
 *
 * Responsibilities:
 *   1. Truncate overly long responses so callers aren't stuck listening
 *      to a wall of text.
 *   2. Sanitise residual markdown / formatting the LLM might slip in
 *      despite the voice prompt adapter.
 *   3. Provide a "repeat last" helper that rephrases the previous turn
 *      slightly so it doesn't sound like a broken record.
 */

// ─── Configuration ────────────────────────────────────────────────────────

/** Hard ceiling on response character length.  Anything beyond is truncated. */
export const VOICE_HARD_MAX_CHARS = parseInt(
    process.env.VOICE_HARD_MAX_CHARS || '350',
    10,
);

/** Hard ceiling on sentence count. */
export const VOICE_HARD_MAX_SENTENCES = parseInt(
    process.env.VOICE_HARD_MAX_SENTENCES || '5',
    10,
);

// ─── Sentence splitter ────────────────────────────────────────────────────

/**
 * Split text into sentences.  Handles common abbreviations (Mr., Dr., etc.)
 * to avoid false splits.
 */
function splitSentences(text: string): string[] {
    // Protect common abbreviations
    const safeguarded = text
        .replace(/\b(Mr|Mrs|Ms|Dr|Prof|Sr|Jr|St|vs|etc|Inc|Ltd|Corp)\./gi, '$1\u2024')
        .replace(/\b([A-Z])\./g, '$1\u2024');                // single-letter initials

    const raw = safeguarded.split(/(?<=[.!?])\s+/);

    // Restore dots
    return raw.map((s) => s.replace(/\u2024/g, '.').trim()).filter(Boolean);
}

// ─── Public API ───────────────────────────────────────────────────────────

/**
 * Guard an AI response for voice delivery.
 *
 * - Strips residual markdown formatting
 * - Truncates to sentence/char limits
 * - Ensures a trailing sentence-ending punctuation
 *
 * @returns The cleaned, voice-safe response string.
 */
export function guardVoiceResponse(raw: string): string {
    let text = raw;

    // ── Strip markdown artifacts ──────────────────────────────────────────
    // Bold / italic
    text = text.replace(/\*{1,3}(.*?)\*{1,3}/g, '$1');
    text = text.replace(/_{1,3}(.*?)_{1,3}/g, '$1');

    // Headings
    text = text.replace(/^#{1,6}\s+/gm, '');

    // Links  [text](url) → text
    text = text.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');

    // Inline code
    text = text.replace(/`([^`]+)`/g, '$1');

    // Code blocks
    text = text.replace(/```[\s\S]*?```/g, '');

    // Bullet / numbered list markers
    text = text.replace(/^ *[-*+•]\s+/gm, '');
    text = text.replace(/^ *\d+[.)]\s+/gm, '');

    // Horizontal rules
    text = text.replace(/^[-*_]{3,}$/gm, '');

    // Collapse whitespace
    text = text.replace(/\n{2,}/g, ' ').replace(/\n/g, ' ').replace(/\s{2,}/g, ' ').trim();

    // ── Sentence truncation ───────────────────────────────────────────────
    const sentences = splitSentences(text);

    if (sentences.length > VOICE_HARD_MAX_SENTENCES) {
        text = sentences.slice(0, VOICE_HARD_MAX_SENTENCES).join(' ');
    }

    // ── Character truncation (find the last sentence boundary ≤ limit) ───
    if (text.length > VOICE_HARD_MAX_CHARS) {
        const truncSentences = splitSentences(text);
        let built = '';
        for (const s of truncSentences) {
            const candidate = built ? `${built} ${s}` : s;
            if (candidate.length > VOICE_HARD_MAX_CHARS) break;
            built = candidate;
        }
        // If even the first sentence exceeds the limit, hard-cut with ellipsis
        text = built || text.slice(0, VOICE_HARD_MAX_CHARS - 1) + '…';
    }

    // ── Ensure trailing punctuation ───────────────────────────────────────
    if (text && !/[.!?…]$/.test(text)) {
        text += '.';
    }

    return text;
}

/**
 * Build a "repeat" response: the previous AI text rephrased slightly.
 *
 * For now this is a simple prefix + the original text.  In future this
 * could call the LLM with a rephrase instruction, but that adds latency.
 */
export function buildRepeatResponse(previousAiText: string): string {
    // Clean the previous response through the same guard
    const cleaned = guardVoiceResponse(previousAiText);
    return `Sure, let me say that again. ${cleaned}`;
}

/**
 * Build a "clarify" response that offers a simpler explanation.
 */
export function buildClarifyPreamble(): string {
    return 'Let me put that more simply.';
}

/**
 * Check whether the AI response is suspiciously empty / garbage.
 */
export function isEmptyOrGarbage(text: string): boolean {
    if (!text) return true;
    const stripped = text.replace(/\s+/g, '');
    return stripped.length < 3;
}

/** Block spoken order/fact hallucinations when cart is empty or not yet submitted. */
export function guardVoiceOrderFacts(
    text: string,
    opts?: { orderSubmitted?: boolean; hasItems?: boolean },
): string {
    if (!text?.trim()) return text;
    const submitted = opts?.orderSubmitted === true;
    const hasItems = opts?.hasItems === true;

    const orderConfirmRe =
        /\b(order(?:'s|\s+is)?\s+(?:confirmed|placed|submitted|being\s+processed|on\s+its\s+way)|(?:confirmed|placed)\s+your\s+order)\b/i;
    const fakeTimingRe = /\b(?:ready|prepared|delivered|arrive)\s+in\s+\d+\s*(?:minutes|mins|hours)\b/i;

    if (!submitted && (orderConfirmRe.test(text) || fakeTimingRe.test(text))) {
        if (!hasItems) {
            return 'I do not have any items in your order yet. Tell me what you would like.';
        }
        return 'I am still working on your order details. Let me know when you are ready to continue.';
    }
    return text;
}
