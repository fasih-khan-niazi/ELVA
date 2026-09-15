import express from 'express';
import { createAgent, getAgents, getAgentById, updateAgent, deleteAgent, getTemplates, generateAgentConfig, configureChatEmbed } from '../controllers/agentController';
import { protect } from '../middleware/authMiddleware';
import { requireActiveAccount } from '../middleware/activeAccountMiddleware';
import { checkAgentLimit, checkVoiceEnabled, requireActiveSubscription } from '../middleware/subscriptionMiddleware';

const router = express.Router();

router.use(protect);
router.use(requireActiveAccount);
router.use(requireActiveSubscription);

// Templates & AI config generation (no agent limit check needed)
router.get('/templates', getTemplates);
router.post('/generate-config', generateAgentConfig);

// Check agent limit and voice feature before creating
router.post('/', checkAgentLimit, async (req, res, next) => {
    // If creating a voice agent, check if voice is enabled for the plan
    if (req.body.type === 'voice') {
        return checkVoiceEnabled(req, res, next);
    }
    next();
}, createAgent);

router.get('/', getAgents);
router.post('/:agentId/chat-embed', configureChatEmbed);
router.get('/:agentId', getAgentById);
router.put('/:agentId', updateAgent);
router.delete('/:agentId', deleteAgent);

export default router;
