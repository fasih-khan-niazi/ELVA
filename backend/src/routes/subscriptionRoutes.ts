import { Router, raw } from 'express';
import { protect } from '../middleware/authMiddleware';
import { requireActiveAccount } from '../middleware/activeAccountMiddleware';
import { requireBusinessAdmin } from '../middleware/businessAdminMiddleware';
import {
    getPlans,
    getCurrentSubscription,
    selectFreePlan,
    createCheckoutSession,
    verifyCheckoutSession,
    createPortalSession,
    cancelSubscription,
    handleStripeWebhook
} from '../controllers/subscriptionController';

const router = Router();

// Public route - get available plans
router.get('/plans', getPlans);

// Protected routes
router.get('/current', protect, requireActiveAccount, getCurrentSubscription);
router.post('/select-free', protect, requireActiveAccount, requireBusinessAdmin, selectFreePlan);
router.post('/create-checkout', protect, requireActiveAccount, requireBusinessAdmin, createCheckoutSession);
router.post('/verify-checkout', protect, requireActiveAccount, requireBusinessAdmin, verifyCheckoutSession);
router.post('/create-portal', protect, requireActiveAccount, requireBusinessAdmin, createPortalSession);
router.post('/cancel', protect, requireActiveAccount, requireBusinessAdmin, cancelSubscription);

// Stripe webhook (needs raw body)
router.post('/webhook', raw({ type: 'application/json' }), handleStripeWebhook as any);

export default router;
