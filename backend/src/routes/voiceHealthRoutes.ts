import { Router } from 'express';
import { getVoiceHealth } from '../controllers/voiceHealthController';

const router = Router();

router.get('/health', getVoiceHealth);

export default router;
