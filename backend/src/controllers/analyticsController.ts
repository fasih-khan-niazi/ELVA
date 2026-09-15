import { Request, Response } from 'express';
import mongoose from 'mongoose';
import {
    Agent,
    Order,
    Lead,
    DocumentModel,
    Subscription,
    CatalogItem,
    ChatSession,
    Tenant,
    PLAN_LIMITS,
    PlanType,
} from '../models';
import { parseVoiceMetricsWindow } from './voiceAdminController';

// Per-agent analytics: activity & pipeline only (revenue rollups live in Global analytics for admins).
export const getAgentAnalytics = async (req: Request, res: Response) => {
    try {
        const { agentId } = req.params;
        const tenantId = (req as any).user?.tenantId;
        const { range = '30' } = req.query; // days

        const agent = await Agent.findOne({ _id: agentId, tenantId });
        if (!agent) {
            return res.status(404).json({ message: 'Agent not found' });
        }

        const days = parseInt(range as string, 10) || 30;
        const rangeStart = new Date();
        rangeStart.setDate(rangeStart.getDate() - days);

        const now = new Date();
        const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const weekStart = new Date(todayStart);
        weekStart.setDate(weekStart.getDate() - 7);

        // --- Orders Analytics (no aggregate revenue - see GET /api/analytics/overview) ---
        const [
            totalOrders,
            ordersInRange,
            ordersToday,
            ordersThisWeek,
            ordersByStatus,
            ordersByChannel,
            topItemsAgg,
            orderTimeline,
        ] = await Promise.all([
            Order.countDocuments({ agentId, tenantId }),
            Order.countDocuments({ agentId, tenantId, createdAt: { $gte: rangeStart } }),
            Order.countDocuments({ agentId, tenantId, createdAt: { $gte: todayStart } }),
            Order.countDocuments({ agentId, tenantId, createdAt: { $gte: weekStart } }),
            Order.aggregate([
                { $match: { agentId: agent._id, tenantId: agent.tenantId } },
                { $group: { _id: '$status', count: { $sum: 1 } } }
            ]),
            Order.aggregate([
                { $match: { agentId: agent._id, tenantId: agent.tenantId, createdAt: { $gte: rangeStart } } },
                { $group: { _id: '$channel', count: { $sum: 1 } } }
            ]),
            Order.aggregate([
                { $match: { agentId: agent._id, tenantId: agent.tenantId, createdAt: { $gte: rangeStart } } },
                { $unwind: '$items' },
                { $group: { _id: '$items.name', count: { $sum: '$items.quantity' } } },
                { $sort: { count: -1 } },
                { $limit: 10 }
            ]),
            Order.aggregate([
                { $match: { agentId: agent._id, tenantId: agent.tenantId, createdAt: { $gte: rangeStart } } },
                {
                    $group: {
                        _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
                        count: { $sum: 1 },
                    }
                },
                { $sort: { _id: 1 } }
            ]),
        ]);

        const orderStatusMap: Record<string, number> = {};
        ordersByStatus.forEach((s: any) => { orderStatusMap[s._id] = s.count; });

        const channelMap: Record<string, number> = {};
        ordersByChannel.forEach((c: any) => { channelMap[c._id] = c.count; });

        // --- Leads Analytics ---
        const [
            totalLeads,
            leadsInRange,
            leadsToday,
            leadsByStatus,
            leadsBySource,
            avgScoreAgg,
            leadTimeline,
        ] = await Promise.all([
            Lead.countDocuments({ agentId, tenantId }),
            Lead.countDocuments({ agentId, tenantId, createdAt: { $gte: rangeStart } }),
            Lead.countDocuments({ agentId, tenantId, createdAt: { $gte: todayStart } }),
            Lead.aggregate([
                { $match: { agentId: agent._id, tenantId: agent.tenantId } },
                { $group: { _id: '$status', count: { $sum: 1 } } }
            ]),
            Lead.aggregate([
                { $match: { agentId: agent._id, tenantId: agent.tenantId } },
                { $group: { _id: '$source', count: { $sum: 1 } } }
            ]),
            Lead.aggregate([
                { $match: { agentId: agent._id, tenantId: agent.tenantId } },
                { $group: { _id: null, avg: { $avg: '$score' } } }
            ]),
            Lead.aggregate([
                { $match: { agentId: agent._id, tenantId: agent.tenantId, createdAt: { $gte: rangeStart } } },
                {
                    $group: {
                        _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
                        count: { $sum: 1 }
                    }
                },
                { $sort: { _id: 1 } }
            ]),
        ]);

        const leadStatusMap: Record<string, number> = {};
        leadsByStatus.forEach((s: any) => { leadStatusMap[s._id] = s.count; });

        const leadSourceMap: Record<string, number> = {};
        leadsBySource.forEach((s: any) => { leadSourceMap[s._id] = s.count; });

        const conversionRate = totalLeads > 0
            ? ((leadStatusMap['converted'] || 0) / totalLeads * 100)
            : 0;

        // --- Catalog ---
        const [totalCatalogItems, activeCatalogItems] = await Promise.all([
            CatalogItem.countDocuments({ agentId, tenantId }),
            CatalogItem.countDocuments({ agentId, tenantId, available: true }),
        ]);

        // --- Documents ---
        const totalDocuments = await DocumentModel.countDocuments({ agentId, tenantId });

        return res.json({
            agent: {
                id: agent._id,
                name: agent.name,
                type: agent.type,
                createdAt: agent.createdAt,
            },
            range: days,
            orders: {
                total: totalOrders,
                inRange: ordersInRange,
                today: ordersToday,
                thisWeek: ordersThisWeek,
                byStatus: orderStatusMap,
                byChannel: channelMap,
                topItems: topItemsAgg.map((i: any) => ({ name: i._id, count: i.count })),
                timeline: orderTimeline.map((d: any) => ({ date: d._id, orders: d.count })),
            },
            leads: {
                total: totalLeads,
                inRange: leadsInRange,
                today: leadsToday,
                byStatus: leadStatusMap,
                bySource: leadSourceMap,
                avgScore: avgScoreAgg[0]?.avg ? Math.round(avgScoreAgg[0].avg) : 0,
                conversionRate: parseFloat(conversionRate.toFixed(1)),
                timeline: leadTimeline.map((d: any) => ({ date: d._id, leads: d.count })),
            },
            catalog: {
                total: totalCatalogItems,
                active: activeCatalogItems,
            },
            documents: totalDocuments,
        });
    } catch (err: any) {
        console.error('Error fetching agent analytics:', err);
        return res.status(500).json({ message: 'Server error' });
    }
};

// Tenant-wide executive overview (workspace admins only) - revenue & per-agent rollups for the selected period.
export const getTenantOverview = async (req: Request, res: Response) => {
    try {
        const tenantId = (req as any).user?.tenantId;
        const tenantObjId = new mongoose.Types.ObjectId(tenantId);
        const { range = '30' } = req.query;
        const rawDays = parseInt(String(range), 10);
        const days = Number.isFinite(rawDays) ? Math.min(Math.max(rawDays, 1), 366) : 30;
        const rangeStart = new Date();
        rangeStart.setDate(rangeStart.getDate() - days);

        const now = new Date();
        const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());

        const [
            agents,
            subscription,
            tenantLean,
            totalOrdersAllTime,
            ordersToday,
            ordersInRange,
            totalRevenueAllTimeAgg,
            revenueInRangeAgg,
            totalLeadsAllTime,
            leadsToday,
            leadsInRange,
            totalDocs,
            ordersByAgentInRange,
            leadsByAgentInRange,
        ] = await Promise.all([
            Agent.find({ tenantId }).select('_id name type createdAt'),
            Subscription.findOne({ tenantId }),
            Tenant.findById(tenantObjId).select('reportingCurrency ledgerCurrency').lean(),
            Order.countDocuments({ tenantId }),
            Order.countDocuments({ tenantId, createdAt: { $gte: todayStart } }),
            Order.countDocuments({ tenantId, createdAt: { $gte: rangeStart } }),
            Order.aggregate([
                { $match: { tenantId: tenantObjId, status: { $nin: ['cancelled'] } } },
                { $group: { _id: null, total: { $sum: '$total' } } }
            ]),
            Order.aggregate([
                {
                    $match: {
                        tenantId: tenantObjId,
                        status: { $nin: ['cancelled'] },
                        createdAt: { $gte: rangeStart },
                    },
                },
                { $group: { _id: null, total: { $sum: '$total' } } }
            ]),
            Lead.countDocuments({ tenantId }),
            Lead.countDocuments({ tenantId, createdAt: { $gte: todayStart } }),
            Lead.countDocuments({ tenantId, createdAt: { $gte: rangeStart } }),
            DocumentModel.countDocuments({ tenantId }),
            Order.aggregate([
                {
                    $match: {
                        tenantId: tenantObjId,
                        createdAt: { $gte: rangeStart },
                    },
                },
                { $group: { _id: '$agentId', count: { $sum: 1 }, revenue: { $sum: '$total' } } },
                { $sort: { revenue: -1 } }
            ]),
            Lead.aggregate([
                { $match: { tenantId: tenantObjId, createdAt: { $gte: rangeStart } } },
                { $group: { _id: '$agentId', count: { $sum: 1 } } },
                { $sort: { count: -1 } }
            ]),
        ]);

        const agentPerformance = agents.map(a => {
            const ordersData = ordersByAgentInRange.find((o: any) => o._id?.toString() === a._id.toString());
            const leadsData = leadsByAgentInRange.find((l: any) => l._id?.toString() === a._id.toString());
            return {
                id: a._id,
                name: a.name,
                type: a.type,
                orders: ordersData?.count || 0,
                revenue: ordersData?.revenue || 0,
                leads: leadsData?.count || 0,
            };
        });

        const ledger =
            ((tenantLean as { ledgerCurrency?: string } | null)?.ledgerCurrency as string | undefined) || 'PKR';
        const reporting =
            ((tenantLean as { reportingCurrency?: string } | null)?.reportingCurrency as string | undefined) ||
            'PKR';

        return res.json({
            summary: {
                totalAgents: agents.length,
                chatAgents: agents.filter(a => a.type === 'chat').length,
                voiceAgents: agents.filter(a => a.type === 'voice').length,
                totalOrdersAllTime,
                ordersToday,
                ordersInRange,
                totalRevenueAllTime: totalRevenueAllTimeAgg[0]?.total || 0,
                revenueInRange: revenueInRangeAgg[0]?.total || 0,
                totalLeadsAllTime,
                leadsToday,
                leadsInRange,
                totalDocuments: totalDocs,
            },
            subscription: subscription ? {
                plan: subscription.plan,
                status: subscription.status,
                messagesUsed: subscription.messagesUsedThisMonth,
                messagesQuota: PLAN_LIMITS[subscription.plan as PlanType]?.maxMessagesPerMonth ?? null,
            } : null,
            workspace: {
                reportingCurrency: reporting,
                ledgerCurrency: ledger,
            },
            agentPerformance,
            range: days,
        });
    } catch (err: any) {
        console.error('Error fetching tenant overview:', err);
        return res.status(500).json({ message: 'Server error' });
    }
};

/** Chat operational metrics for the tenant (all chat agents). `window` = minutes or `lifetime`, same as voice-admin. */
export const getChatTenantMetrics = async (req: Request, res: Response) => {
    try {
        const tenantId = (req as any).user?.tenantId;
        if (!tenantId) {
            return res.status(400).json({ message: 'Tenant ID not found' });
        }
        const tenantObjId = new mongoose.Types.ObjectId(tenantId);
        const windowParam = parseVoiceMetricsWindow(req.query.window);
        const now = new Date();
        const fromTs = windowParam === null ? new Date(0) : new Date(now.getTime() - windowParam * 60_000);

        const chatAgentIds = await Agent.find({ tenantId, type: 'chat' }).distinct('_id');
        if (!chatAgentIds.length) {
            return res.json({
                windowMinutes: windowParam,
                isLifetime: windowParam === null,
                fromTs: fromTs.toISOString(),
                toTs: now.toISOString(),
                chatAgents: 0,
                sessions: 0,
                messages: 0,
                assistantTurnsWithLatency: 0,
                latencyMs: null,
                timeSeries: [],
                sessionsBySource: { dashboard: 0, embed: 0, api: 0 },
            });
        }

        const matchSessions = {
            tenantId: tenantObjId,
            agentId: { $in: chatAgentIds },
            updatedAt: { $gte: fromTs },
        };

        const [sessionAgg, latencyAgg, dailySeries, sourceAgg] = await Promise.all([
            ChatSession.aggregate([
                { $match: matchSessions },
                {
                    $group: {
                        _id: null,
                        sessions: { $sum: 1 },
                        messages: { $sum: '$messageCount' },
                    },
                },
            ]),
            ChatSession.aggregate([
                { $match: matchSessions },
                { $unwind: '$messages' },
                {
                    $match: {
                        'messages.role': 'assistant',
                        'messages.latencyMs': { $exists: true, $gt: 0 },
                    },
                },
                {
                    $group: {
                        _id: null,
                        n: { $sum: 1 },
                        avg: { $avg: '$messages.latencyMs' },
                        min: { $min: '$messages.latencyMs' },
                        max: { $max: '$messages.latencyMs' },
                    },
                },
            ]),
            ChatSession.aggregate([
                { $match: matchSessions },
                {
                    $group: {
                        _id: { $dateToString: { format: '%Y-%m-%d', date: '$updatedAt' } },
                        sessions: { $sum: 1 },
                        messages: { $sum: '$messageCount' },
                    },
                },
                { $sort: { _id: 1 } },
            ]),
            ChatSession.aggregate([
                { $match: matchSessions },
                { $addFields: { src: { $ifNull: ['$source', 'dashboard'] } } },
                {
                    $group: {
                        _id: '$src',
                        sessions: { $sum: 1 },
                    },
                },
            ]),
        ]);

        const s = sessionAgg[0] || { sessions: 0, messages: 0 };
        const L = latencyAgg[0];
        const latencyMs = L && L.n > 0
            ? { avg: Math.round(L.avg), min: L.min, max: L.max }
            : null;

        const sessionsBySource: Record<string, number> = { dashboard: 0, embed: 0, api: 0 };
        for (const row of sourceAgg) {
            const k = String(row._id || 'dashboard');
            sessionsBySource[k] = (sessionsBySource[k] || 0) + row.sessions;
        }

        return res.json({
            windowMinutes: windowParam,
            isLifetime: windowParam === null,
            fromTs: fromTs.toISOString(),
            toTs: now.toISOString(),
            chatAgents: chatAgentIds.length,
            sessions: s.sessions,
            messages: s.messages,
            assistantTurnsWithLatency: L?.n || 0,
            latencyMs,
            timeSeries: dailySeries.map((d: any) => ({
                ts: d._id,
                sessions: d.sessions,
                messages: d.messages,
            })),
            sessionsBySource,
        });
    } catch (err: any) {
        console.error('Error fetching chat tenant metrics:', err);
        return res.status(500).json({ message: 'Server error' });
    }
};
