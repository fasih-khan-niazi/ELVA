import { Router } from 'express';
import { protect } from '../middleware/authMiddleware';
import { verifyPlatformOperator } from '../middleware/platformAdminMiddleware';
import {
    platformHealth,
    platformOverview,
    platformListTenants,
    suspendTenantAccess,
    cancelTenantSubscriptionNow,
    platformCreateTenant,
    platformStartSandboxExploration,
} from '../controllers/platformController';

const router = Router();
const plat = [protect, verifyPlatformOperator];

router.get('/health', plat, platformHealth);
router.get('/overview', plat, platformOverview);
router.get('/tenants', plat, platformListTenants);
router.patch('/tenants/:tenantId/access-suspension', plat, suspendTenantAccess);
router.post('/tenants/:tenantId/subscription/cancel-now', plat, cancelTenantSubscriptionNow);
router.post('/workspaces/create', plat, platformCreateTenant);
router.post('/exploration/sandbox/session', plat, platformStartSandboxExploration);

export default router;
