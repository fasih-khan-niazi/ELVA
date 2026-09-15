/**
 * Azure Cognitive Services TTS — REST API wrapper.
 *
 * Converts text → MP3 audio via Azure Neural TTS (~150-300ms TTFB),
 * saves to a temp file served by Express, and schedules auto-cleanup.
 * Falls back to Twilio <Say> if the key is absent or the call fails.
 *
 * Configure via environment:
 *   AZURE_SPEECH_KEY     — Resource key from Azure portal
 *   AZURE_SPEECH_REGION  — e.g. centralindia, eastus
 *   AZURE_TTS_VOICE      — e.g. en-US-JennyNeural (default)
 */

import axios from 'axios';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { resolveAzureVoice, voiceLocaleFromId, DEFAULT_AZURE_VOICE } from './azureVoices';
import { terminalLog } from '../utils/terminalLog';
import { getCachedTtsBuffer, setCachedTtsBuffer } from './ttsCacheService';
import { ipv4HttpsAgent } from '../utils/networkAgents';

const AZURE_SPEECH_KEY = process.env.AZURE_SPEECH_KEY || '';
const AZURE_SPEECH_REGION = process.env.AZURE_SPEECH_REGION || 'centralindia';
const AZURE_TTS_VOICE = process.env.AZURE_TTS_VOICE || 'en-US-JennyNeural';
const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';

// Keep temp files alive long enough for Twilio to fetch + play them.
// 2 minutes is generous; a typical voice turn is <30s total.
const TEMP_FILE_TTL_MS = 120_000;

// ── Temp audio directory ──────────────────────────────────────────────────

export const TEMP_AUDIO_DIR = path.join(process.cwd(), 'temp_audio');

// Create on module load — runs once at server startup.
if (!fs.existsSync(TEMP_AUDIO_DIR)) {
    fs.mkdirSync(TEMP_AUDIO_DIR, { recursive: true });
    terminalLog.dim(`Azure TTS temp dir: ${TEMP_AUDIO_DIR}`);
}

// ── Voice resolution ────────────────────────────────────────────────────────

function pickVoice(language?: string, voiceId?: string): { voice: string; lang: string } {
    const voice = resolveAzureVoice(voiceId, language);
    const lang = (language || '').trim() || voiceLocaleFromId(voice);
    return { voice, lang };
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function postAzureSpeech(
    ssml: string,
    outputFormat: string,
    retries = 3,
): Promise<ArrayBuffer> {
    const endpoint = `https://${AZURE_SPEECH_REGION}.tts.speech.microsoft.com/cognitiveservices/v1`;
    let lastErr: unknown;

    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            const response = await axios.post(endpoint, ssml, {
                headers: {
                    'Ocp-Apim-Subscription-Key': AZURE_SPEECH_KEY,
                    'Content-Type': 'application/ssml+xml',
                    'X-Microsoft-OutputFormat': outputFormat,
                    'User-Agent': 'elva-voice/1.0',
                },
                responseType: 'arraybuffer',
                timeout: 8_000,
                httpsAgent: ipv4HttpsAgent,
            });
            return response.data as ArrayBuffer;
        } catch (err: any) {
            lastErr = err;
            const msg = err?.message || String(err);
            const retryable = /EAI_AGAIN|ENOTFOUND|ETIMEDOUT|ECONNRESET|timeout/i.test(msg)
                || err?.response?.status === 429
                || err?.response?.status >= 500;
            if (attempt < retries && retryable) {
                terminalLog.warn('AZURE-TTS', `Attempt ${attempt} failed (${msg}) — retrying`);
                await sleep(400 * attempt);
                continue;
            }
            throw err;
        }
    }
    throw lastErr;
}

// ── SSML builder ──────────────────────────────────────────────────────────

function escapeXml(text: string): string {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}

function buildSsml(text: string, voice: string, speechLanguage: string): string {
    const voiceLocale = voiceLocaleFromId(voice);
    const speechLang = speechLanguage.split('-')[0].toLowerCase();
    const voiceLang = voiceLocale.split('-')[0].toLowerCase();
    const inner =
        speechLang !== voiceLang
            ? `<lang xml:lang='${speechLanguage}'>${escapeXml(text)}</lang>`
            : escapeXml(text);
    return `<speak version='1.0' xml:lang='${speechLanguage}'><voice name='${voice}'>${inner}</voice></speak>`;
}

// ── Main export ───────────────────────────────────────────────────────────

/**
 * Generate TTS audio with Azure Neural voices, save to a temp file,
 * and return the public URL that Twilio can play via <Play>.
 *
 * Throws if Azure is not configured or the API call fails — callers
 * should catch and fall back to Twilio <Say>.
 */
export async function generateTtsUrl(text: string, language?: string, voiceId?: string): Promise<string> {
    if (!AZURE_SPEECH_KEY) {
        throw new Error('AZURE_SPEECH_KEY not configured');
    }

    const started = Date.now();
    let { voice, lang } = pickVoice(language, voiceId);
    let ssml = buildSsml(text, voice, lang);

    let audioData: ArrayBuffer;
    try {
        audioData = await postAzureSpeech(ssml, 'audio-24khz-48kbitrate-mono-mp3');
    } catch (err: any) {
        if (voice !== DEFAULT_AZURE_VOICE && (err?.response?.status === 400 || err?.response?.status === 404)) {
            terminalLog.warn('AZURE-TTS', `Voice ${voice} rejected — falling back to ${DEFAULT_AZURE_VOICE}`);
            voice = DEFAULT_AZURE_VOICE;
            lang = voiceLocaleFromId(voice);
            ssml = buildSsml(text, voice, lang);
            audioData = await postAzureSpeech(ssml, 'audio-24khz-48kbitrate-mono-mp3');
        } else {
            throw err;
        }
    }

    const filename = `tts_${crypto.randomUUID()}.mp3`;
    const filePath = path.join(TEMP_AUDIO_DIR, filename);
    fs.writeFileSync(filePath, Buffer.from(audioData));

    // Auto-delete after TTL
    setTimeout(() => {
        try {
            if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
        } catch { /* ignore cleanup errors */ }
    }, TEMP_FILE_TTL_MS);

    const publicUrl = `${BASE_URL}/api/audio/temp/${filename}`;
    terminalLog.dim(`Azure TTS ${voice} · ${Date.now() - started}ms · ${audioData.byteLength}B → ${filename}`);
    return publicUrl;
}

export function isAzureTtsConfigured(): boolean {
    return !!(process.env.AZURE_SPEECH_KEY && process.env.AZURE_SPEECH_REGION);
}

/** MP3 buffer for in-app playback (voice picker previews, etc.). */
export async function generateTtsMp3Buffer(
    text: string,
    language?: string,
    voiceId?: string,
): Promise<Buffer> {
    if (!AZURE_SPEECH_KEY) {
        throw new Error('AZURE_SPEECH_KEY not configured');
    }

    let { voice, lang } = pickVoice(language, voiceId);
    let ssml = buildSsml(text, voice, lang);

    let audioData: ArrayBuffer;
    try {
        audioData = await postAzureSpeech(ssml, 'audio-24khz-48kbitrate-mono-mp3');
    } catch (err: any) {
        if (voice !== DEFAULT_AZURE_VOICE && (err?.response?.status === 400 || err?.response?.status === 404)) {
            voice = DEFAULT_AZURE_VOICE;
            lang = voiceLocaleFromId(voice);
            ssml = buildSsml(text, voice, lang);
            audioData = await postAzureSpeech(ssml, 'audio-24khz-48kbitrate-mono-mp3');
        } else {
            throw err;
        }
    }

    return Buffer.from(audioData);
}

/**
 * Generate TTS audio as raw mulaw 8kHz buffer — used by the Media Streams
 * pipeline to send audio directly over the Twilio WebSocket.
 * No file is written; the buffer is returned in memory.
 */
export async function generateTtsMulawBuffer(text: string, language?: string, voiceId?: string): Promise<Buffer> {
    if (!AZURE_SPEECH_KEY) {
        throw new Error('AZURE_SPEECH_KEY not configured');
    }

    const cached = getCachedTtsBuffer(text, language, voiceId);
    if (cached) {
        terminalLog.dim(`Azure mulaw cache hit · ${cached.length}B`);
        return cached;
    }

    const started = Date.now();
    let { voice, lang } = pickVoice(language, voiceId);
    let ssml = buildSsml(text, voice, lang);

    let audioData: ArrayBuffer;
    try {
        audioData = await postAzureSpeech(ssml, 'raw-8khz-8bit-mono-mulaw');
    } catch (err: any) {
        if (voice !== DEFAULT_AZURE_VOICE && (err?.response?.status === 400 || err?.response?.status === 404)) {
            terminalLog.warn('AZURE-TTS', `Voice ${voice} rejected — falling back to ${DEFAULT_AZURE_VOICE}`);
            voice = DEFAULT_AZURE_VOICE;
            lang = voiceLocaleFromId(voice);
            ssml = buildSsml(text, voice, lang);
            audioData = await postAzureSpeech(ssml, 'raw-8khz-8bit-mono-mulaw');
        } else {
            throw err;
        }
    }

    const buffer = Buffer.from(audioData);
    setCachedTtsBuffer(text, buffer, language, voiceId);
    terminalLog.dim(`Azure mulaw ${voice} · ${Date.now() - started}ms · ${buffer.length}B`);
    return buffer;
}
