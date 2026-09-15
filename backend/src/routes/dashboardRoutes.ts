import { Router, Response } from 'express';
import { protect, AuthRequest } from '../middleware/authMiddleware';
import { requireActiveAccount } from '../middleware/activeAccountMiddleware';
import { Agent, DocumentModel, Order, Lead } from '../models';

const router = Router();

// Get Dashboard Stats
router.get('/stats', protect, requireActiveAccount, async (req: AuthRequest, res: Response) => {
    try {
        const { tenantId } = req.user!;

        const totalAgents = await Agent.countDocuments({ tenantId });
        const totalDocuments = await DocumentModel.countDocuments({ tenantId });

        res.json({
            totalAgents,
            totalCalls: 0,
            totalDocuments
        });
    } catch (error) {
        console.error('Error fetching stats:', error);
        res.status(500).json({ error: 'Failed to fetch stats' });
    }
});

// Get notification counts (pending orders + new leads) for all agents
router.get('/notifications', protect, requireActiveAccount, async (req: AuthRequest, res: Response) => {
    try {
        const { tenantId } = req.user!;

        // Count pending orders per agent
        const orderCounts = await Order.aggregate([
            { $match: { tenantId: tenantId as any, status: 'pending' } },
            { $group: { _id: '$agentId', count: { $sum: 1 } } }
        ]);

        // Count new leads per agent
        const leadCounts = await Lead.aggregate([
            { $match: { tenantId: tenantId as any, status: 'new' } },
            { $group: { _id: '$agentId', count: { $sum: 1 } } }
        ]);

        const notifications: Record<string, { orders: number; leads: number }> = {};

        for (const o of orderCounts) {
            const id = o._id.toString();
            if (!notifications[id]) notifications[id] = { orders: 0, leads: 0 };
            notifications[id].orders = o.count;
        }
        for (const l of leadCounts) {
            const id = l._id.toString();
            if (!notifications[id]) notifications[id] = { orders: 0, leads: 0 };
            notifications[id].leads = l.count;
        }

        res.json(notifications);
    } catch (error) {
        console.error('Error fetching notifications:', error);
        res.status(500).json({ error: 'Failed to fetch notifications' });
    }
});

export default router;
