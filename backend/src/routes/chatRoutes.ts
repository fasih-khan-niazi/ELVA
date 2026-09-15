import express from 'express';
import { sendMessage, getSessions, getSessionMessages } from '../controllers/chatController';
import { protect } from '../middleware/authMiddleware';
import { requireActiveAccount } from '../middleware/activeAccountMiddleware';
import { checkMessageLimit, requireActiveSubscription } from '../middleware/subscriptionMiddleware';

const router = express.Router();

// All chat routes require authentication
router.use(protect);
router.use(requireActiveAccount);
router.use(requireActiveSubscription);

// Send message to agent - check message limit
router.post('/message', checkMessageLimit, sendMessage);

// Chat history: list sessions for an agent
router.get('/sessions/:agentId', getSessions);

// Chat history: get all messages for a specific session
router.get('/sessions/:agentId/:sessionId', getSessionMessages);

export default router;
