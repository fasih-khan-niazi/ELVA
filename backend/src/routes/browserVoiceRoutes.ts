import { Router } from 'express';
import { protect } from '../middleware/authMiddleware';
import { requireActiveAccount } from '../middleware/activeAccountMiddleware';
import { validateTwilioSignature } from '../middleware/twilioAuthMiddleware';
import {
    handleBrowserToken,
    handleBrowserConnect,
    handleBrowserCallLive,
} from '../controllers/browserVoiceController';

const router = Router();

// ─── Authenticated: browser user requests an access token ─────────────────
router.get('/token/:agentId', protect, requireActiveAccount, handleBrowserToken);
router.get('/calls/:callSid/live', protect, requireActiveAccount, handleBrowserCallLive);

// ─── TwiML App webhook: Twilio calls this when browser connects ───────────
// Same X-Twilio-Signature validation as PSTN voice routes (or TWILIO_SKIP_VALIDATION in dev).
router.post('/connect', validateTwilioSignature, handleBrowserConnect);

export default router;
