import { Router } from 'express';
import { protect } from '../middleware/authMiddleware';
import { requireActiveAccount } from '../middleware/activeAccountMiddleware';
import {
    getPreviewSampleAudio,
    listAzureVoices,
    previewTts,
    seedPreviewSamples,
} from '../controllers/voiceUtilityController';

const router = Router();

router.use(protect);
router.use(requireActiveAccount);

router.get('/azure-voices', listAzureVoices);
router.get('/preview-samples/:voiceId/audio', getPreviewSampleAudio);
router.post('/preview-samples/seed', seedPreviewSamples);
router.post('/preview-tts', previewTts);

export default router;
