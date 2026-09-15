import { Router } from 'express';
import { validateTwilioSignature } from '../middleware/twilioAuthMiddleware';
import { webhookIdempotency } from '../middleware/webhookIdempotency';
import { webhookAuditLogger } from '../middleware/webhookAuditLog';
import {
    handleIncoming,
    handleStatusCallbackEndpoint,
} from '../controllers/voiceController';

const router = Router();

router.use(validateTwilioSignature);
router.use(webhookAuditLogger);
router.use(webhookIdempotency);

router.post('/incoming', handleIncoming);
router.post('/status-callback', handleStatusCallbackEndpoint);

export default router;
