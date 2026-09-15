import { Router } from 'express';

import { protect } from '../middleware/authMiddleware';

import { requireActiveAccount } from '../middleware/activeAccountMiddleware';

import { requireActiveSubscription, requireAnalyticsEnabled } from '../middleware/subscriptionMiddleware';

import { requireBusinessAdmin } from '../middleware/businessAdminMiddleware';

import { getAgentAnalytics, getTenantOverview, getChatTenantMetrics } from '../controllers/analyticsController';



const router = Router();



router.use(protect);

router.use(requireActiveAccount);

router.use(requireActiveSubscription);

router.use(requireAnalyticsEnabled);



// Tenant-wide executive overview - workspace admins only

router.get('/overview', requireBusinessAdmin, getTenantOverview);



// Chat operational metrics (all chat agents)

router.get('/chat-metrics', getChatTenantMetrics);



// Per-agent activity analytics (must be after static paths)

router.get('/:agentId', getAgentAnalytics);



export default router;

