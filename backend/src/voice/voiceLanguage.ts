/**
 * Normalize language tags for Twilio <Gather>/<Say> and Google STT/TTS.
 * The dashboard may send short codes (e.g. "en"); Google voice names embed BCP-47 (e.g. en-US-Neural2-F).
 */

const SHORT_LOCALE: Record<string, string> = {
    en: 'en-US',
    es: 'es-US',
    fr: 'fr-FR',
    de: 'de-DE',
};

export function normalizeVoiceLocale(
    agentLanguage: string | undefined,
    ttsVoice?: string | undefined,
): string {
    const voice = (ttsVoice || '').trim();
    const fromVoice = voice.match(/^([a-z]{2})-([A-Za-z]{2})/);
    if (fromVoice) {
        return `${fromVoice[1].toLowerCase()}-${fromVoice[2].toUpperCase()}`;
    }

    const raw = (agentLanguage || 'en-US').trim();
    if (/^[a-z]{2}-[A-Za-z]{2}/.test(raw)) {
        const [a, b] = raw.split('-');
        return `${a.toLowerCase()}-${b!.length === 2 ? b.toUpperCase() : b}`;
    }

    const short = raw.toLowerCase().slice(0, 2);
    if (short.length === 2 && SHORT_LOCALE[short]) {
        return SHORT_LOCALE[short];
    }

    return 'en-US';
}
