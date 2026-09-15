import { EXIT_INTENTS, MSG_GOODBYE } from './voiceLifecycle';

export type ClosingMode = 'inbound' | 'outbound';

/**
 * When the user says goodbye but the LLM didn't classify exit, upgrade the spoken closing.
 */
export function synthesisedClosingLine(
    rawIntent: string | undefined,
    effectiveIntent: string | undefined,
    aiText: string,
    businessName: string,
    mode: ClosingMode = 'inbound',
): string {
    const upgraded =
        effectiveIntent &&
        EXIT_INTENTS.has(effectiveIntent) &&
        rawIntent &&
        !EXIT_INTENTS.has(rawIntent);

    if (!upgraded) return aiText;

    const name = (businessName || '').trim();
    if (mode === 'outbound') {
        return name ? `Thanks for your time — ${name}. Goodbye!` : MSG_GOODBYE;
    }
    return name ? `Thanks for calling ${name}. Goodbye!` : MSG_GOODBYE;
}
