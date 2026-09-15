import { Router } from 'express';
import { protect } from '../middleware/authMiddleware';
import { requireActiveAccount } from '../middleware/activeAccountMiddleware';
import { requireActiveSubscription } from '../middleware/subscriptionMiddleware';
import {
    createLead, getLeads, getLeadById,
    updateLeadStatus, updateLead, deleteLead, getLeadStats, exportLeadsCSV
} from '../controllers/leadController';

const router = Router();

router.use(protect);
router.use(requireActiveAccount);
router.use(requireActiveSubscription);

// Stats and export must come before :agentId to avoid route conflict
router.get('/stats/:agentId', getLeadStats);
router.get('/export/:agentId', exportLeadsCSV);

router.post('/', createLead);
router.get('/:agentId', getLeads);
router.get('/:agentId/:leadId', getLeadById);
router.put('/:agentId/:leadId/status', updateLeadStatus);
router.put('/:agentId/:leadId', updateLead);
router.delete('/:agentId/:leadId', deleteLead);

export default router;
