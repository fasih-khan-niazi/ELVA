import express from 'express';
import { protect } from '../middleware/authMiddleware';
import { requireActiveAccount } from '../middleware/activeAccountMiddleware';
import { requireActiveSubscription } from '../middleware/subscriptionMiddleware';
import {
    getAgentDocuments,
    deleteDocument,
    reingestAgentDocuments,
    saveAgentKnowledgeSummary,
    getDocumentViewUrl,
} from '../controllers/documentController';

const router = express.Router();

router.use(protect);
router.use(requireActiveAccount);
router.use(requireActiveSubscription);

router.get('/agent/:agentId', getAgentDocuments);
router.post('/agent/:agentId/knowledge-summary', saveAgentKnowledgeSummary);
router.post('/agent/:agentId/reingest', reingestAgentDocuments);
router.get('/:documentId/view', getDocumentViewUrl);
router.delete('/:documentId', deleteDocument);

export default router;
