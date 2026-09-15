/**
 * Lightweight STT post-corrections for common Deepgram mis-hearings on voice calls.
 * Applied before the transcript is sent to the AI service.
 */

const PHRASE_FIXES: Array<[RegExp, string]> = [
    [/\bthree foods\b/gi, 'Niazi Foods'],
    [/\bniyadhi foods?\b/gi, 'Niazi Foods'],
    [/\bniyazi foods?\b/gi, 'Niazi Foods'],
    [/\bsuits\b/gi, 'sweets'],
    [/\bwhat do you like, sir\b/gi, ''],
    [/\bfor the menu\b/gi, 'on the menu'],
    [/\bcash on the delivery\b/gi, 'cash on delivery'],
    [/\bcash upon delivery\b/gi, 'cash on delivery'],
];

/** Spoken quantities before menu items — helps order_add token matching. */
const WORD_QTY_FIXES: Array<[RegExp, string]> = [
    [/\bone\b(?=\s+(?:chicken|soup|fries|burger|pizza|roll|biryani|karahi|tikka|platter|sweet|pack|order))/gi, '1'],
    [/\btwo\b(?=\s+(?:chicken|soup|fries|burger|pizza|roll|biryani|karahi|tikka|platter|sweet|pack|order))/gi, '2'],
    [/\bthree\b(?=\s+(?:chicken|soup|fries|burger|pizza|roll|biryani|karahi|tikka|platter|sweet|pack|order))/gi, '3'],
    [/\bfour\b(?=\s+(?:chicken|soup|fries|burger|pizza|roll|biryani|karahi|tikka|platter|sweet|pack|order))/gi, '4'],
    [/\bfive\b(?=\s+(?:chicken|soup|fries|burger|pizza|roll|biryani|karahi|tikka|platter|sweet|pack|order))/gi, '5'],
];

const PKR_CURRENCY_FIXES: Array<[RegExp, string]> = [
    [/\$(\d{3,}(?:\.\d{1,2})?)\b/g, 'Rs $1'],
    [/(\d{3,}(?:\.\d{1,2})?)\s+dollars?\b/gi, 'Rs $1'],
];

export function normalizeVoiceStt(text: string, currency?: string): string {
    let out = text.trim();
    if (!out) return out;
    for (const [pattern, replacement] of PHRASE_FIXES) {
        out = out.replace(pattern, replacement);
    }
    for (const [pattern, replacement] of WORD_QTY_FIXES) {
        out = out.replace(pattern, replacement);
    }
    if (currency === 'PKR') {
        for (const [pattern, replacement] of PKR_CURRENCY_FIXES) {
            out = out.replace(pattern, replacement);
        }
    }
    return out.replace(/\s+/g, ' ').trim();
}

/** Comma-separated keyword boosts for Deepgram (nova-2): "Niazi:2,sweets:1". Optional. */
export function parseDeepgramKeywords(): string | undefined {
    const raw = process.env.DEEPGRAM_KEYWORDS?.trim();
    if (raw) return raw;
    return undefined;
}

/** @deprecated keyterm is nova-3+ only; use parseDeepgramKeywords for nova-2. */
export function parseDeepgramKeyterms(): string[] {
    const raw = process.env.DEEPGRAM_KEYTERMS?.trim();
    if (!raw) return [];
    return raw.split(',').map((s) => s.trim()).filter(Boolean);
}
