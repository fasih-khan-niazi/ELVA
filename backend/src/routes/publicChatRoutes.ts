import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { getPublicChatConfig, postPublicChatMessage } from '../controllers/publicChatController';

const router = Router();

const publicChatLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 120,
    standardHeaders: true,
    legacyHeaders: false,
    message: { message: 'Too many requests. Please try again shortly.' },
});

router.use(publicChatLimiter);

router.get('/chat/config', getPublicChatConfig);
router.post('/chat/message', postPublicChatMessage);

export default router;
