import { Router } from 'express';
import { protect } from '../middleware/authMiddleware';
import { requireActiveAccount } from '../middleware/activeAccountMiddleware';
import { requireActiveSubscription } from '../middleware/subscriptionMiddleware';
import {
    createOrder,
    getOrders,
    getOrderById,
    updateOrderStatus,
    getOrderStats,
    exportOrdersCSV,
} from '../controllers/orderController';

const router = Router();

// All order routes require auth + subscription
router.use(protect);
router.use(requireActiveAccount);
router.use(requireActiveSubscription);

// Create order
router.post('/', createOrder);

// Stats and export must be before /:agentId to avoid route conflict
router.get('/stats/:agentId', getOrderStats);
router.get('/export/:agentId', exportOrdersCSV);

// List orders for an agent
router.get('/:agentId', getOrders);

// Get single order
router.get('/:agentId/:orderId', getOrderById);

// Update order status
router.put('/:agentId/:orderId/status', updateOrderStatus);

export default router;
