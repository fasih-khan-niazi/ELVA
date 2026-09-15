import { Router } from 'express';
import { validateTwilioSignature } from '../middleware/twilioAuthMiddleware';
import {
    handleOutboundAnswered,
    handleOutboundStatusCallback,
    handleOutboundRecording,
    handleOutboundAmdResult,
} from '../controllers/outboundVoiceController';

const router = Router();

router.use(validateTwilioSignature);

router.post('/answered', handleOutboundAnswered);
router.post('/status-callback', handleOutboundStatusCallback);
router.post('/recording', handleOutboundRecording);
router.post('/amd-result', handleOutboundAmdResult);

export default router;
