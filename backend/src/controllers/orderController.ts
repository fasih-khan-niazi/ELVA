import { Request, Response } from 'express';
import { AuthRequest } from '../middleware/authMiddleware';
import { canViewTenantFinancialRollups } from '../middleware/businessAdminMiddleware';
import { Order, Agent, CatalogItem } from '../models';
import { fire } from '../services/connectorService';

// POST /api/orders - create a new order (called by AI service or frontend)
export const createOrder = async (req: Request, res: Response) => {
    try {
        const tenantId = (req as any).user?.tenantId;
        const { agentId, sessionId, channel, currency, items, customerName, customerPhone, customerEmail, customerAddress, notes } = req.body;

        if (!agentId || !items || !items.length) {
            return res.status(400).json({ message: 'agentId and items are required' });
        }

        // Verify agent belongs to tenant
        const agent = await Agent.findOne({ _id: agentId, tenantId });
        if (!agent) {
            return res.status(404).json({ message: 'Agent not found' });
        }

        // Currency precedence: explicit body value → agent's configured currency → schema default (PKR)
        const orderCurrency = (currency || agent.currency || 'PKR').toUpperCase();

        const order = await Order.create({
            agentId,
            tenantId,
            sessionId: sessionId || `order_${Date.now()}`,
            channel: channel || 'chat',
            currency: orderCurrency,
            items,
            customerName,
            customerPhone,
            customerEmail,
            customerAddress,
            notes,
        });

        fire({ eventType: 'order.created', agentId, tenantId, data: order }).catch((err) =>
            console.error('[connector] order.created fire failed:', err?.message ?? err)
        );

        return res.status(201).json(order);
    } catch (err: any) {
        console.error('Error creating order:', err);
        return res.status(500).json({ message: 'Server error' });
    }
};

// GET /api/orders/:agentId - list orders for an agent
export const getOrders = async (req: Request, res: Response) => {
    try {
        const tenantId = (req as any).user?.tenantId;
        const { agentId } = req.params;
        const { status, limit = '50', page = '1' } = req.query;

        // Verify agent belongs to tenant
        const agent = await Agent.findOne({ _id: agentId, tenantId });
        if (!agent) {
            return res.status(404).json({ message: 'Agent not found' });
        }

        const filter: any = { agentId, tenantId };
        if (status && status !== 'all') {
            filter.status = status;
        }

        const pageNum = Math.max(1, parseInt(page as string, 10) || 1);
        const limitNum = Math.min(100, Math.max(1, parseInt(limit as string, 10) || 50));
        const skip = (pageNum - 1) * limitNum;

        const [orders, total] = await Promise.all([
            Order.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limitNum),
            Order.countDocuments(filter),
        ]);

        return res.json({
            orders,
            pagination: { page: pageNum, limit: limitNum, total, pages: Math.ceil(total / limitNum) }
        });
    } catch (err: any) {
        console.error('Error fetching orders:', err);
        return res.status(500).json({ message: 'Server error' });
    }
};

// GET /api/orders/:agentId/:orderId - get single order
export const getOrderById = async (req: Request, res: Response) => {
    try {
        const tenantId = (req as any).user?.tenantId;
        const { agentId, orderId } = req.params;

        const order = await Order.findOne({ _id: orderId, agentId, tenantId });
        if (!order) {
            return res.status(404).json({ message: 'Order not found' });
        }

        return res.json(order);
    } catch (err: any) {
        console.error('Error fetching order:', err);
        return res.status(500).json({ message: 'Server error' });
    }
};

// Ordered workflow — each step must follow the previous one (except cancelled, which is always allowed).
const STATUS_FLOW = ['pending', 'confirmed', 'preparing', 'ready', 'completed'] as const;

function isValidTransition(from: string, to: string): boolean {
    if (to === 'cancelled') return from !== 'completed'; // can cancel any non-completed order
    const fromIdx = STATUS_FLOW.indexOf(from as any);
    const toIdx = STATUS_FLOW.indexOf(to as any);
    return toIdx === fromIdx + 1; // must advance exactly one step
}

// PUT /api/orders/:agentId/:orderId/status - update order status
export const updateOrderStatus = async (req: Request, res: Response) => {
    try {
        const tenantId = (req as any).user?.tenantId;
        const { agentId, orderId } = req.params;
        const { status } = req.body;

        const validStatuses = [...STATUS_FLOW, 'cancelled'];
        if (!validStatuses.includes(status)) {
            return res.status(400).json({ message: `Invalid status. Use: ${validStatuses.join(', ')}` });
        }

        const order = await Order.findOne({ _id: orderId, agentId, tenantId });
        if (!order) {
            return res.status(404).json({ message: 'Order not found' });
        }

        if (order.status === 'cancelled') {
            return res.status(400).json({ message: 'Cancelled orders cannot be updated.' });
        }
        if (order.status === status) {
            return res.json(order); // idempotent — no-op
        }
        if (!isValidTransition(order.status, status)) {
            return res.status(400).json({
                message: `Cannot move order from '${order.status}' to '${status}'. Orders must follow the workflow: ${STATUS_FLOW.join(' → ')}, or be cancelled.`,
            });
        }

        order.status = status;
        await order.save();

        return res.json(order);
    } catch (err: any) {
        console.error('Error updating order status:', err);
        return res.status(500).json({ message: 'Server error' });
    }
};

// GET /api/orders/export/:agentId - export all orders as CSV
export const exportOrdersCSV = async (req: Request, res: Response) => {
    try {
        const tenantId = (req as any).user?.tenantId;
        const { agentId } = req.params;

        const agent = await Agent.findOne({ _id: agentId, tenantId });
        if (!agent) return res.status(404).json({ message: 'Agent not found' });

        const orders = await Order.find({ agentId, tenantId }).sort({ createdAt: -1 }).lean();

        const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
        const headers = ['Order ID', 'Status', 'Channel', 'Customer Name', 'Customer Phone', 'Customer Email', 'Customer Address', 'Items', 'Item Count', 'Subtotal', 'Tax', 'Total', 'Notes', 'Created At'];
        const rows = (orders as any[]).map(o => {
            const itemsSummary = (o.items || []).map((i: any) => `${i.name} x${i.quantity} @ ${i.price}`).join('; ');
            const itemCount = (o.items || []).reduce((sum: number, i: any) => sum + (i.quantity || 1), 0);
            return [
                esc(String(o._id).slice(-8).toUpperCase()),
                esc(o.status), esc(o.channel),
                esc(o.customerName), esc(o.customerPhone),
                esc(o.customerEmail), esc(o.customerAddress),
                esc(itemsSummary), esc(itemCount),
                esc((o.subtotal ?? 0).toFixed(2)),
                esc((o.tax ?? 0).toFixed(2)),
                esc((o.total ?? 0).toFixed(2)),
                esc(o.notes),
                esc(new Date(o.createdAt).toISOString()),
            ].join(',');
        });

        const csv = [headers.map(esc).join(','), ...rows].join('\n');
        const date = new Date().toISOString().slice(0, 10);

        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="orders_${date}.csv"`);
        return res.send('﻿' + csv);
    } catch (err: any) {
        console.error('Error exporting orders CSV:', err);
        return res.status(500).json({ message: 'Server error' });
    }
};

// GET /api/orders/stats/:agentId - order statistics
export const getOrderStats = async (req: Request, res: Response) => {
    try {
        const tenantId = (req as any).user?.tenantId;
        const { agentId } = req.params;

        const agent = await Agent.findOne({ _id: agentId, tenantId });
        if (!agent) {
            return res.status(404).json({ message: 'Agent not found' });
        }

        const now = new Date();
        const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const weekStart = new Date(todayStart);
        weekStart.setDate(weekStart.getDate() - 7);

        const role = (req as AuthRequest).user?.role;
        const showFinancial = canViewTenantFinancialRollups(role);

        const [totalOrders, todayOrders, weekOrders, statusCounts, revenueResult] = await Promise.all([
            Order.countDocuments({ agentId, tenantId }),
            Order.countDocuments({ agentId, tenantId, createdAt: { $gte: todayStart } }),
            Order.countDocuments({ agentId, tenantId, createdAt: { $gte: weekStart } }),
            Order.aggregate([
                { $match: { agentId: agent._id, tenantId: agent.tenantId } },
                { $group: { _id: '$status', count: { $sum: 1 } } }
            ]),
            showFinancial
                ? Order.aggregate([
                    { $match: { agentId: agent._id, tenantId: agent.tenantId, status: { $nin: ['cancelled'] } } },
                    { $group: { _id: null, totalRevenue: { $sum: '$total' }, avgOrder: { $avg: '$total' } } }
                ])
                : Promise.resolve([] as { totalRevenue?: number; avgOrder?: number }[]),
        ]);

        const byStatus: Record<string, number> = {};
        for (const s of statusCounts) {
            byStatus[s._id] = s.count;
        }

        if (!showFinancial) {
            return res.json({
                totalOrders,
                todayOrders,
                weekOrders,
                byStatus,
            });
        }

        const revenue = revenueResult[0] || { totalRevenue: 0, avgOrder: 0 };

        return res.json({
            totalOrders,
            todayOrders,
            weekOrders,
            byStatus,
            totalRevenue: revenue.totalRevenue,
            avgOrderValue: Math.round(revenue.avgOrder * 100) / 100,
        });
    } catch (err: any) {
        console.error('Error fetching order stats:', err);
        return res.status(500).json({ message: 'Server error' });
    }
};
