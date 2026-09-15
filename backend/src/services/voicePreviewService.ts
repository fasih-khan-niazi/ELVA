import { VoicePreviewSample } from '../models';
import { AZURE_NEURAL_VOICES } from '../voice/azureVoices';
import { generateTtsMp3Buffer, isAzureTtsConfigured } from '../voice/azureTtsService';
import { terminalLog } from '../utils/terminalLog';

/** English SSML locale for preview — voice ID supplies accent, text stays English. */
export function previewSpeechLocale(voiceId: string, metaLocale: string): string {
    if (/^(ur|ar|hi)-/i.test(voiceId)) {
        return 'en-US';
    }
    return metaLocale;
}

/** Bump when preview wording or TTS locale logic changes — forces DB sample refresh. */
export const PREVIEW_SAMPLE_VERSION = 3;

/** Generic one-line preview per voice — first name taken from Azure label. */
export function buildVoicePreviewText(label: string, locale: string): string {
    const firstName = label.split('(')[0].trim().split(/\s+/)[0] || 'your agent';
    const loc = locale.toLowerCase();
    if (loc.startsWith('ur')) {
        return `Assalam o Alaikum, my name is ${firstName}, and this is my voice.`;
    }
    if (loc.startsWith('ar') || loc.startsWith('hi')) {
        return `Hello, my name is ${firstName}, and this is my voice.`;
    }
    return `Hi there! This is ${firstName} speaking. This is how I'll sound on your phone calls.`;
}

function isPreviewSampleCurrent(
    hit: { previewText?: string; sampleVersion?: number } | null | undefined,
    expectedText: string,
): boolean {
    return !!hit?.previewText
        && hit.previewText === expectedText
        && (hit.sampleVersion ?? 0) >= PREVIEW_SAMPLE_VERSION;
}

export async function ensureVoicePreviewSample(voiceId: string): Promise<IVoicePreviewDoc | null> {
    const meta = AZURE_NEURAL_VOICES.find((v) => v.id === voiceId);
    if (!meta) {
        return null;
    }

    const previewText = buildVoicePreviewText(meta.label, meta.locale);
    const existing = await VoicePreviewSample.findOne({ voiceId }).lean();
    if (existing?.audioBase64 && isPreviewSampleCurrent(existing, previewText)) {
        return existing as IVoicePreviewDoc;
    }

    if (!isAzureTtsConfigured()) {
        return null;
    }

    try {
        const speechLocale = previewSpeechLocale(voiceId, meta.locale);
        const buffer = await generateTtsMp3Buffer(previewText, speechLocale, voiceId);
        const audioBase64 = buffer.toString('base64');
        const doc = await VoicePreviewSample.findOneAndUpdate(
            { voiceId },
            {
                voiceId,
                label: meta.label,
                previewText,
                audioBase64,
                mimeType: 'audio/mpeg',
                byteLength: buffer.length,
                sampleVersion: PREVIEW_SAMPLE_VERSION,
                updatedAt: new Date(),
            },
            { upsert: true, new: true },
        ).lean();
        terminalLog.ok('VOICE-PREVIEW', `Cached sample for ${voiceId}`);
        return doc as IVoicePreviewDoc;
    } catch (err: any) {
        terminalLog.warn('VOICE-PREVIEW', `Failed to generate ${voiceId}: ${err?.message}`);
        return null;
    }
}

export interface IVoicePreviewDoc {
    voiceId: string;
    label: string;
    previewText: string;
    audioBase64: string;
    mimeType: string;
    byteLength: number;
}

export async function getVoicePreviewAudio(voiceId: string): Promise<Buffer | null> {
    const doc = await ensureVoicePreviewSample(voiceId);
    if (!doc?.audioBase64) return null;
    return Buffer.from(doc.audioBase64, 'base64');
}

/** Regenerate stale or missing samples on startup. */
export async function seedVoicePreviewSamples(): Promise<void> {
    if (!isAzureTtsConfigured()) {
        terminalLog.dim('Voice preview seed skipped — Azure not configured');
        return;
    }

    const stale: string[] = [];
    for (const v of AZURE_NEURAL_VOICES) {
        const hit = await VoicePreviewSample.findOne({ voiceId: v.id }).lean();
        const expected = buildVoicePreviewText(v.label, v.locale);
        if (!isPreviewSampleCurrent(hit, expected)) {
            stale.push(v.id);
        }
    }

    if (stale.length === 0) {
        terminalLog.dim(`Voice preview samples: ${AZURE_NEURAL_VOICES.length} up to date`);
        return;
    }

    terminalLog.info('VOICE-PREVIEW', `Refreshing ${stale.length} sample(s)…`);
    for (const voiceId of stale) {
        await ensureVoicePreviewSample(voiceId);
        await new Promise((r) => setTimeout(r, 300));
    }
}
