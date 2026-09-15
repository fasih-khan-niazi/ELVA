/**
 * Curated Azure Neural voices for ELVA voice agents.
 * All available on Azure Speech F0 (free) tier.
 */

export interface AzureVoiceOption {
    id: string;
    label: string;
    language: string;
    gender: 'female' | 'male';
    locale: string;
    sampleText?: string;
}

export const AZURE_NEURAL_VOICES: AzureVoiceOption[] = [
    { id: 'en-US-JennyNeural', label: 'Jenny (US, Female)', language: 'English (US)', gender: 'female', locale: 'en-US' },
    { id: 'en-US-GuyNeural', label: 'Guy (US, Male)', language: 'English (US)', gender: 'male', locale: 'en-US' },
    { id: 'en-US-AriaNeural', label: 'Aria (US, Female)', language: 'English (US)', gender: 'female', locale: 'en-US' },
    { id: 'en-US-DavisNeural', label: 'Davis (US, Male)', language: 'English (US)', gender: 'male', locale: 'en-US' },
    { id: 'en-US-AmberNeural', label: 'Amber (US, Female)', language: 'English (US)', gender: 'female', locale: 'en-US' },
    { id: 'en-IN-NeerjaNeural', label: 'Neerja (India, Female)', language: 'English (India)', gender: 'female', locale: 'en-IN' },
    { id: 'en-IN-PrabhatNeural', label: 'Prabhat (India, Male)', language: 'English (India)', gender: 'male', locale: 'en-IN' },
    { id: 'en-GB-SoniaNeural', label: 'Sonia (UK, Female)', language: 'English (UK)', gender: 'female', locale: 'en-GB' },
    { id: 'en-GB-RyanNeural', label: 'Ryan (UK, Male)', language: 'English (UK)', gender: 'male', locale: 'en-GB' },
    { id: 'hi-IN-SwaraNeural', label: 'Swara (Hindi, Female)', language: 'Hindi (India)', gender: 'female', locale: 'hi-IN' },
];

export const DEFAULT_AZURE_VOICE = 'en-US-JennyNeural';

/** Retired voices — existing agents fall back to the default English voice. */
const RETIRED_VOICE_MAP: Record<string, string> = {
    'ur-PK-UzmaNeural': DEFAULT_AZURE_VOICE,
    'ur-PK-AsadNeural': DEFAULT_AZURE_VOICE,
    'ar-SA-ZariyahNeural': DEFAULT_AZURE_VOICE,
};

/** Twilio / Google voice IDs stored on legacy agents → Azure Neural equivalents. */
const LEGACY_VOICE_MAP: Record<string, string> = {
    'en-US-Neural2-F': 'en-US-JennyNeural',
    'en-US-Neural2-C': 'en-US-AriaNeural',
    'en-US-Neural2-D': 'en-US-DavisNeural',
    'en-US-Neural2-A': 'en-US-JennyNeural',
    'en-US-Neural2-E': 'en-US-AriaNeural',
    'en-US-Neural2-G': 'en-US-GuyNeural',
    'en-US-Neural2-H': 'en-US-GuyNeural',
    'en-US-Neural2-I': 'en-US-JennyNeural',
    'en-US-Neural2-J': 'en-US-GuyNeural',
    'en-US-Neural2-M': 'en-US-GuyNeural',
    'en-US-Standard-B': 'en-US-GuyNeural',
    'en-US-Standard-C': 'en-US-AriaNeural',
    'en-US-Standard-D': 'en-US-DavisNeural',
    'en-US-Standard-E': 'en-US-JennyNeural',
    'en-US-Standard-F': 'en-US-JennyNeural',
    'en-US-Wavenet-D': 'en-US-DavisNeural',
    'en-US-Wavenet-F': 'en-US-JennyNeural',
};

/** Azure neural voices end with ``Neural`` — not ``Neural2-F`` etc. */
const AZURE_NEURAL_VOICE_RE = /^[a-z]{2}-[A-Z]{2}-[A-Za-z]+Neural$/;

export function resolveAzureVoice(voiceId?: string, language?: string): string {
    const v = (voiceId || '').trim();
    if (v && RETIRED_VOICE_MAP[v]) return RETIRED_VOICE_MAP[v];
    if (v && LEGACY_VOICE_MAP[v]) return LEGACY_VOICE_MAP[v];
    if (v && AZURE_NEURAL_VOICES.some((o) => o.id === v)) return v;
    if (v && AZURE_NEURAL_VOICE_RE.test(v)) return v;

    const lang = (language || 'en').toLowerCase();
    const match = AZURE_NEURAL_VOICES.find((o) => o.locale.toLowerCase().startsWith(lang));
    return match?.id || process.env.AZURE_TTS_VOICE || DEFAULT_AZURE_VOICE;
}

export function voiceLocaleFromId(voiceId: string): string {
    const found = AZURE_NEURAL_VOICES.find((o) => o.id === voiceId);
    if (found) return found.locale;
    const m = voiceId.match(/^([a-z]{2}-[A-Za-z]{2})/);
    return m ? m[1] : 'en-US';
}
