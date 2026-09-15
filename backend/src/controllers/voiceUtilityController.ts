import { Response } from 'express';

import { AuthRequest } from '../middleware/authMiddleware';

import { AZURE_NEURAL_VOICES } from '../voice/azureVoices';

import { generateTtsMp3Buffer, isAzureTtsConfigured } from '../voice/azureTtsService';

import {

    ensureVoicePreviewSample,

    getVoicePreviewAudio,

    seedVoicePreviewSamples,

} from '../services/voicePreviewService';

import { VoicePreviewSample } from '../models';



const PREVIEW_TEXT = 'Hello! This is a preview of how your agent will sound on phone calls.';



/** GET /api/voice/util/azure-voices */

export async function listAzureVoices(_req: AuthRequest, res: Response): Promise<void> {

    const cached = await VoicePreviewSample.find().select('voiceId previewText byteLength').lean();

    const cacheMap = new Map(cached.map((c) => [c.voiceId, c]));



    res.json({

        configured: isAzureTtsConfigured(),

        voices: AZURE_NEURAL_VOICES.map((v) => ({

            ...v,

            previewText: cacheMap.get(v.id)?.previewText,

            previewReady: !!cacheMap.get(v.id)?.byteLength,

        })),

        defaultVoice: process.env.AZURE_TTS_VOICE || 'en-US-JennyNeural',

    });

}



/** GET /api/voice/util/preview-samples/:voiceId/audio */

export async function getPreviewSampleAudio(req: AuthRequest, res: Response): Promise<void> {

    try {

        const voiceId = String(req.params.voiceId || '').trim();

        if (!voiceId) {

            res.status(400).json({ message: 'voiceId is required' });

            return;

        }



        if (!AZURE_NEURAL_VOICES.some((v) => v.id === voiceId)) {

            res.status(404).json({ message: 'Unknown voice' });

            return;

        }



        let buffer = await getVoicePreviewAudio(voiceId);

        if (!buffer && isAzureTtsConfigured()) {

            await ensureVoicePreviewSample(voiceId);

            buffer = await getVoicePreviewAudio(voiceId);

        }



        if (!buffer) {

            res.status(503).json({ message: 'Voice preview not available. Check Azure Speech configuration.' });

            return;

        }



        res.setHeader('Content-Type', 'audio/mpeg');

        res.setHeader('Cache-Control', 'public, max-age=86400');

        res.send(buffer);

    } catch (err: any) {

        console.error('[VOICE-PREVIEW-AUDIO]', err?.message);

        res.status(500).json({ message: err?.message || 'Preview failed' });

    }

}



/** POST /api/voice/util/preview-samples/seed */

export async function seedPreviewSamples(_req: AuthRequest, res: Response): Promise<void> {

    if (!isAzureTtsConfigured()) {

        res.status(503).json({ message: 'Azure Speech is not configured.' });

        return;

    }

    await seedVoicePreviewSamples();

    res.json({ message: 'Voice preview samples refreshed' });

}



/** POST /api/voice/util/preview-tts  body: { voiceId, text? } */

export async function previewTts(req: AuthRequest, res: Response): Promise<void> {

    try {

        if (!isAzureTtsConfigured()) {

            res.status(503).json({ message: 'Azure Speech is not configured on the server.' });

            return;

        }

        const voiceId = String(req.body?.voiceId || '').trim();

        const customText = req.body?.text ? String(req.body.text).trim().slice(0, 280) : '';

        if (!voiceId) {

            res.status(400).json({ message: 'voiceId is required' });

            return;

        }



        if (!customText) {

            const cached = await getVoicePreviewAudio(voiceId);

            if (cached) {

                res.setHeader('Content-Type', 'audio/mpeg');

                res.send(cached);

                return;

            }

            await ensureVoicePreviewSample(voiceId);

            const seeded = await getVoicePreviewAudio(voiceId);

            if (seeded) {

                res.setHeader('Content-Type', 'audio/mpeg');

                res.send(seeded);

                return;

            }

        }



        const buffer = await generateTtsMp3Buffer(customText || PREVIEW_TEXT, undefined, voiceId);

        res.setHeader('Content-Type', 'audio/mpeg');

        res.send(buffer);

    } catch (err: any) {

        console.error('[VOICE-PREVIEW]', err?.message);

        res.status(500).json({ message: err?.message || 'Preview failed' });

    }

}


