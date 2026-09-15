import { Response } from 'express';
import { VoiceSession, VoiceTurn, VoiceEndpoint } from '../voice/voiceModels';
import { Order, Lead } from '../models';
import { WebhookAuditLog } from '../middleware/webhookAuditLog';
import { idempotencyCacheSize } from '../middleware/webhookIdempotency';
import { AuthRequest } from '../middleware/authMiddleware';
import { evaluateAlertsFromSnapshot } from '../voice/voiceMetricsCollector';
import { buildTenantMetricsSnapshot } from '../voice/voiceMetricsDbSnapshot';
import { getAiHealthStatus } from '../voice/voiceOrchestrator';

/**
 * REST endpoints for the dashboard to query voice sessions, turns,
 * endpoints, and audit logs.  All endpoints are JWT-protected and
 * scoped to the requesting user's tenantId.
 */

// ─── Helper ───────────────────────────────────────────────────────────────

function tenantId(req: AuthRequest): string {
    return req.user?.tenantId || '';
}

/** Query `window`: positive minutes or the string `lifetime`. Default 60 (1 hour). */
export function parseVoiceMetricsWindow(raw: unknown): number | null {
    if (typeof raw === 'string' && raw.trim().toLowerCase() === 'lifetime') return null;
    const n = Number(raw);
    if (!Number.isFinite(n) || n <= 0) return 60;
    return Math.floor(n);
}

/** Query clause for sessions not in trash. */
function notTrashedFilter(): Record<string, unknown> {
    return { $or: [{ trashedAt: null }, { trashedAt: { $exists: false } }] };
}

function sessionDurationSec(session: {
    durationSec?: number;
    startedAt?: Date;
    endedAt?: Date;
}): number {
    if (session.durationSec != null && session.durationSec > 0) return session.durationSec;
    if (session.startedAt && session.endedAt) {
        const diff = Math.round(
            (new Date(session.endedAt).getTime() - new Date(session.startedAt).getTime()) / 1000,
        );
        return diff > 0 ? diff : 0;
    }
    return 0;
}

/** Active (non-trashed) sessions filter for an agent. */
function activeAgentFilter(tenantId: string, agentId: string): Record<string, unknown> {
    return {
        tenantId,
        agentId,
        $and: [
            { $or: [{ trashedAt: null }, { trashedAt: { $exists: false } }] },
        ],
    };
}

async function computeAgentSessionStats(tenantId: string, agentId: string) {
    const base = activeAgentFilter(tenantId, agentId);

    const [totalCalls, completedCount, failedCount, sessions, statusAgg] = await Promise.all([
        VoiceSession.countDocuments(base),
        VoiceSession.countDocuments({ ...base, status: 'completed' }),
        VoiceSession.countDocuments({ ...base, status: { $in: ['failed', 'busy', 'no-answer'] } }),
        VoiceSession.find(base)
            .select('durationSec startedAt endedAt turnCount')
            .lean(),
        VoiceSession.aggregate([
            { $match: base },
            { $group: { _id: '$status', count: { $sum: 1 } } },
        ]),
    ]);

    let totalDurationSec = 0;
    let totalTurns = 0;
    for (const s of sessions) {
        totalDurationSec += sessionDurationSec(s);
        totalTurns += s.turnCount || 0;
    }

    const statusBreakdown: Record<string, number> = {};
    for (const row of statusAgg) {
        if (row._id) statusBreakdown[String(row._id)] = row.count;
    }
    const otherCount = Math.max(0, totalCalls - completedCount - failedCount);

    return {
        totalCalls,
        completedCount,
        failedCount,
        otherCount,
        statusBreakdown,
        totalDurationSec,
        avgDurationSec: totalCalls > 0 ? Math.round(totalDurationSec / totalCalls) : 0,
        totalTurns,
    };
}

// ─── GET /api/voice-admin/sessions ────────────────────────────────────────

export async function listSessions(req: AuthRequest, res: Response): Promise<void> {
    const tid = tenantId(req);
    if (!tid) { res.status(401).json({ message: 'Unauthorized' }); return; }

    const {
        status,
        agentId,
        trashed,
        limit = '25',
        offset = '0',
        sort = '-startedAt',
    } = req.query as Record<string, string>;

    const showTrashed = trashed === 'true';
    const filter: Record<string, unknown> = { tenantId: tid };
    if (status) filter.status = status;
    if (agentId) filter.agentId = agentId;
    if (showTrashed) {
        filter.trashedAt = { $ne: null, $exists: true };
    } else {
        Object.assign(filter, notTrashedFilter());
    }

    const [sessions, total, stats, trashTotal] = await Promise.all([
        VoiceSession.find(filter)
            .sort(sort)
            .skip(Number(offset))
            .limit(Math.min(Number(limit), 100))
            .select('-__v')
            .lean(),
        VoiceSession.countDocuments(filter),
        agentId && !showTrashed ? computeAgentSessionStats(tid, agentId) : null,
        agentId
            ? VoiceSession.countDocuments({
                tenantId: tid,
                agentId,
                trashedAt: { $ne: null, $exists: true },
            })
            : null,
    ]);

    res.json({
        sessions,
        total,
        trashTotal: trashTotal ?? 0,
        stats,
        limit: Number(limit),
        offset: Number(offset),
    });
}

// ─── GET /api/voice-admin/sessions/:callSid ───────────────────────────────

export async function getSession(req: AuthRequest, res: Response): Promise<void> {
    const tid = tenantId(req);
    if (!tid) { res.status(401).json({ message: 'Unauthorized' }); return; }

    const session = await VoiceSession.findOne({
        callSid: req.params.callSid,
        tenantId: tid,
    })
        .select('-__v')
        .lean();

    if (!session) { res.status(404).json({ message: 'Session not found' }); return; }

    res.json(session);
}

// ─── GET /api/voice-admin/sessions/:callSid/turns ─────────────────────────

export async function listTurns(req: AuthRequest, res: Response): Promise<void> {
    const tid = tenantId(req);
    if (!tid) { res.status(401).json({ message: 'Unauthorized' }); return; }

    // First verify the session belongs to this tenant
    const session = await VoiceSession.findOne({
        callSid: req.params.callSid,
        tenantId: tid,
    }).lean();

    if (!session) { res.status(404).json({ message: 'Session not found' }); return; }

    const turns = await VoiceTurn.find({ callSid: req.params.callSid })
        .sort('turnIndex')
        .select('-__v')
        .lean();

    const [order, lead] = await Promise.all([
        Order.findOne({ sessionId: req.params.callSid, tenantId: tid }).lean(),
        Lead.findOne({ sessionId: req.params.callSid, tenantId: tid }).lean(),
    ]);

    res.json({
        turns,
        total: turns.length,
        exportContext: {
            orderSnapshot: session.orderSnapshot || null,
            order: order || null,
            lead: lead || null,
        },
    });
}

// ─── POST /api/voice-admin/sessions/:callSid/trash ────────────────────────

export async function trashSession(req: AuthRequest, res: Response): Promise<void> {
    const tid = tenantId(req);
    if (!tid) { res.status(401).json({ message: 'Unauthorized' }); return; }

    const session = await VoiceSession.findOneAndUpdate(
        {
            callSid: req.params.callSid,
            tenantId: tid,
            ...notTrashedFilter(),
        },
        { trashedAt: new Date() },
        { new: true },
    ).select('-__v').lean();

    if (!session) {
        res.status(404).json({ message: 'Session not found or already in trash' });
        return;
    }

    const stats = await computeAgentSessionStats(tid, String(session.agentId));
    res.json({ message: 'Call moved to trash', session, stats });
}

// ─── POST /api/voice-admin/sessions/:callSid/restore ──────────────────────

export async function restoreSession(req: AuthRequest, res: Response): Promise<void> {
    const tid = tenantId(req);
    if (!tid) { res.status(401).json({ message: 'Unauthorized' }); return; }

    const session = await VoiceSession.findOneAndUpdate(
        {
            callSid: req.params.callSid,
            tenantId: tid,
            trashedAt: { $ne: null, $exists: true },
        },
        { $unset: { trashedAt: 1 } },
        { new: true },
    ).select('-__v').lean();

    if (!session) {
        res.status(404).json({ message: 'Trashed session not found' });
        return;
    }

    const stats = await computeAgentSessionStats(tid, String(session.agentId));
    res.json({ message: 'Call restored from trash', session, stats });
}

// ─── DELETE /api/voice-admin/sessions/:callSid ────────────────────────────

export async function deleteSessionPermanent(req: AuthRequest, res: Response): Promise<void> {
    const tid = tenantId(req);
    if (!tid) { res.status(401).json({ message: 'Unauthorized' }); return; }

    const session = await VoiceSession.findOne({
        callSid: req.params.callSid,
        tenantId: tid,
        trashedAt: { $ne: null, $exists: true },
    });

    if (!session) {
        res.status(404).json({ message: 'Trashed session not found' });
        return;
    }

    await Promise.all([
        VoiceTurn.deleteMany({ callSid: req.params.callSid }),
        VoiceSession.deleteOne({ _id: session._id }),
    ]);

    res.json({ message: 'Call permanently deleted' });
}

// ─── GET /api/voice-admin/endpoints ───────────────────────────────────────

export async function listEndpoints(req: AuthRequest, res: Response): Promise<void> {
    const tid = tenantId(req);
    if (!tid) { res.status(401).json({ message: 'Unauthorized' }); return; }

    const endpoints = await VoiceEndpoint.find({ tenantId: tid })
        .sort('-createdAt')
        .select('-__v')
        .lean();

    res.json({ endpoints, total: endpoints.length });
}

// ─── POST /api/voice-admin/endpoints ──────────────────────────────────────

export async function createEndpoint(req: AuthRequest, res: Response): Promise<void> {
    const tid = tenantId(req);
    if (!tid) { res.status(401).json({ message: 'Unauthorized' }); return; }

    const { agentId, phoneNumber, label, language } = req.body;

    if (!agentId || !phoneNumber) {
        res.status(400).json({ message: 'agentId and phoneNumber are required' });
        return;
    }

    // Check for duplicates
    const existing = await VoiceEndpoint.findOne({ phoneNumber });
    if (existing) {
        res.status(409).json({ message: 'Phone number is already mapped to an agent' });
        return;
    }

    const endpoint = await VoiceEndpoint.create({
        tenantId: tid,
        agentId,
        phoneNumber,
        label: label || '',
        language: language || 'en-US',
        isActive: true,
    });

    res.status(201).json(endpoint.toObject());
}

// ─── DELETE /api/voice-admin/endpoints/:id ────────────────────────────────

export async function deleteEndpoint(req: AuthRequest, res: Response): Promise<void> {
    const tid = tenantId(req);
    if (!tid) { res.status(401).json({ message: 'Unauthorized' }); return; }

    const endpoint = await VoiceEndpoint.findOneAndDelete({
        _id: req.params.id,
        tenantId: tid,
    });

    if (!endpoint) { res.status(404).json({ message: 'Endpoint not found' }); return; }

    res.json({ message: 'Endpoint deleted', id: req.params.id });
}

// ─── PATCH /api/voice-admin/endpoints/:id ─────────────────────────────────

export async function updateEndpoint(req: AuthRequest, res: Response): Promise<void> {
    const tid = tenantId(req);
    if (!tid) { res.status(401).json({ message: 'Unauthorized' }); return; }

    const allowed = ['label', 'language', 'isActive', 'agentId'];
    const updates: Record<string, any> = {};
    for (const key of allowed) {
        if (req.body[key] !== undefined) updates[key] = req.body[key];
    }

    const endpoint = await VoiceEndpoint.findOneAndUpdate(
        { _id: req.params.id, tenantId: tid },
        { $set: updates },
        { new: true },
    );

    if (!endpoint) { res.status(404).json({ message: 'Endpoint not found' }); return; }

    res.json(endpoint.toObject());
}

// ─── GET /api/voice-admin/audit-logs ──────────────────────────────────────

export async function listAuditLogs(req: AuthRequest, res: Response): Promise<void> {
    const tid = tenantId(req);
    if (!tid) { res.status(401).json({ message: 'Unauthorized' }); return; }

    const { callSid, limit = '50', offset = '0' } = req.query as Record<string, string>;

    // Audit logs aren't tenant-scoped by design (they're raw webhook records).
    // To scope them, we first get this tenant's callSids.
    const filter: Record<string, any> = {};
    if (callSid) {
        // Verify session belongs to tenant
        const session = await VoiceSession.findOne({ callSid, tenantId: tid }).lean();
        if (!session) { res.status(404).json({ message: 'Session not found' }); return; }
        filter.callSid = callSid;
    } else {
        // Get all this tenant's callSids to scope audit logs
        const sessions = await VoiceSession.find({ tenantId: tid })
            .select('callSid')
            .limit(500)
            .lean();
        const sids = sessions.map((s) => s.callSid);
        if (sids.length === 0) { res.json({ logs: [], total: 0 }); return; }
        filter.callSid = { $in: sids };
    }

    const [logs, total] = await Promise.all([
        WebhookAuditLog.find(filter)
            .sort('-receivedAt')
            .skip(Number(offset))
            .limit(Math.min(Number(limit), 200))
            .select('-__v')
            .lean(),
        WebhookAuditLog.countDocuments(filter),
    ]);

    res.json({ logs, total, limit: Number(limit), offset: Number(offset) });
}

// ─── GET /api/voice-admin/stats ───────────────────────────────────────────

export async function getVoiceStats(req: AuthRequest, res: Response): Promise<void> {
    const tid = tenantId(req);
    if (!tid) { res.status(401).json({ message: 'Unauthorized' }); return; }

    const [
        totalSessions,
        activeSessions,
        completedSessions,
        failedSessions,
        totalEndpoints,
    ] = await Promise.all([
        VoiceSession.countDocuments({ tenantId: tid }),
        VoiceSession.countDocuments({ tenantId: tid, status: 'in-progress' }),
        VoiceSession.countDocuments({ tenantId: tid, status: 'completed' }),
        VoiceSession.countDocuments({ tenantId: tid, status: { $in: ['failed', 'busy', 'no-answer'] } }),
        VoiceEndpoint.countDocuments({ tenantId: tid }),
    ]);

    // Average latency for completed sessions
    const latencyAgg = await VoiceSession.aggregate([
        { $match: { tenantId: tid, turnCount: { $gt: 0 } } },
        {
            $group: {
                _id: null,
                avgLatency: { $avg: { $divide: ['$totalLatencyMs', '$turnCount'] } },
                totalTurns: { $sum: '$turnCount' },
            },
        },
    ]);

    const avgTurnLatencyMs = latencyAgg[0]?.avgLatency || 0;
    const totalTurns = latencyAgg[0]?.totalTurns || 0;

    // End reason distribution
    const endReasonAgg = await VoiceSession.aggregate([
        { $match: { tenantId: tid, endReason: { $exists: true, $ne: null } } },
        { $group: { _id: '$endReason', count: { $sum: 1 } } },
    ]);
    const endReasons: Record<string, number> = {};
    for (const r of endReasonAgg) {
        endReasons[r._id] = r.count;
    }

    res.json({
        totalSessions,
        activeSessions,
        completedSessions,
        failedSessions,
        totalEndpoints,
        totalTurns,
        avgTurnLatencyMs: Math.round(avgTurnLatencyMs),
        endReasons,
        idempotencyCacheSize: idempotencyCacheSize(),
    });
}

// ─── GET /api/voice-admin/metrics ─────────────────────────────────────────

/**
 * Tenant-scoped metrics from MongoDB (turns + sessions) for latency percentiles,
 * SLO, error rates, and per-minute time series in the requested window.
 */
export async function getRealtimeMetrics(req: AuthRequest, res: Response): Promise<void> {
    const tid = tenantId(req);
    if (!tid) { res.status(401).json({ message: 'Unauthorized' }); return; }

    const windowParam = parseVoiceMetricsWindow(req.query.window);
    const snapshot = await buildTenantMetricsSnapshot(tid, windowParam);

    res.json(snapshot);
}

// ─── GET /api/voice-admin/alerts ──────────────────────────────────────────

/**
 * Alert status - checks recent metrics against SLO/error thresholds.
 */
export async function getAlerts(req: AuthRequest, res: Response): Promise<void> {
    const tid = tenantId(req);
    if (!tid) { res.status(401).json({ message: 'Unauthorized' }); return; }

    const windowParam = parseVoiceMetricsWindow(req.query.window);
    const snap = await buildTenantMetricsSnapshot(tid, windowParam);
    const alerts = evaluateAlertsFromSnapshot(snap, windowParam);
    const aiHealth = getAiHealthStatus();

    res.json({
        ...alerts,
        aiService: {
            healthy: aiHealth.healthy,
            lastCheckedAt: aiHealth.checkedAt ? new Date(aiHealth.checkedAt).toISOString() : null,
        },
    });
}

// ─── GET /api/voice-admin/latency-heatmap ─────────────────────────────────

/**
 * Returns per-turn latency data bucketed by hour for heatmap visualisation.
 * Query params: days (default 7, max 30)
 */
export async function getLatencyHeatmap(req: AuthRequest, res: Response): Promise<void> {
    const tid = tenantId(req);
    if (!tid) { res.status(401).json({ message: 'Unauthorized' }); return; }

    const days = Math.min(Number(req.query.days) || 7, 30);
    const since = new Date(Date.now() - days * 86_400_000);

    // Get tenant sessions first to scope turns
    const sessions = await VoiceSession.find({ tenantId: tid, startedAt: { $gte: since } })
        .select('callSid')
        .lean();
    const sids = sessions.map((s) => s.callSid);

    if (sids.length === 0) {
        res.json({ heatmap: [], days });
        return;
    }

    const pipeline = [
        { $match: { callSid: { $in: sids } } },
        {
            $group: {
                _id: {
                    hour: { $hour: '$createdAt' },
                    dayOfWeek: { $dayOfWeek: '$createdAt' },
                },
                avgLatency: { $avg: '$latencyMs' },
                count: { $sum: 1 },
                sloOkCount: { $sum: { $cond: ['$sloOk', 1, 0] } },
            },
        },
        { $sort: { '_id.dayOfWeek': 1 as 1, '_id.hour': 1 as 1 } },
    ];

    const heatmap = await VoiceTurn.aggregate(pipeline);

    res.json({
        heatmap: heatmap.map((h: any) => ({
            dayOfWeek: h._id.dayOfWeek,
            hour: h._id.hour,
            avgLatency: Math.round(h.avgLatency),
            count: h.count,
            sloCompliance: h.count > 0 ? h.sloOkCount / h.count : 1,
        })),
        days,
    });
}

// ─── GET /api/voice-admin/latency-waterfall ───────────────────────────────

/** Per-stage latency averages for voice turns (STT debounce → LLM → TTS). */
export async function getLatencyWaterfall(req: AuthRequest, res: Response): Promise<void> {
    const tid = tenantId(req);
    if (!tid) { res.status(401).json({ message: 'Unauthorized' }); return; }

    const windowParam = parseVoiceMetricsWindow(req.query.window);
    const since = windowParam
        ? new Date(Date.now() - windowParam * 60_000)
        : new Date(0);

    const sessions = await VoiceSession.find({ tenantId: tid, startedAt: { $gte: since } })
        .select('callSid')
        .lean();
    const sids = sessions.map((s) => s.callSid);

    if (sids.length === 0) {
        res.json({
            windowMinutes: windowParam,
            turnCount: 0,
            stages: {},
        });
        return;
    }

    const [agg] = await VoiceTurn.aggregate([
        { $match: { callSid: { $in: sids } } },
        {
            $group: {
                _id: null,
                turnCount: { $sum: 1 },
                avgTotalMs: { $avg: '$latencyMs' },
                avgFirstAudioMs: { $avg: '$firstAudioMs' },
                avgSttDebounceMs: { $avg: '$sttDebounceMs' },
                avgLlmFirstSentenceMs: { $avg: '$llmFirstSentenceMs' },
                avgTtsFirstByteMs: { $avg: '$ttsFirstByteMs' },
                sloOkCount: { $sum: { $cond: ['$sloOk', 1, 0] } },
            },
        },
    ]);

    const turnCount = agg?.turnCount || 0;
    res.json({
        windowMinutes: windowParam,
        turnCount,
        sloCompliance: turnCount > 0 ? (agg.sloOkCount || 0) / turnCount : 1,
        stages: {
            sttDebounceMs: Math.round(agg?.avgSttDebounceMs || 0),
            llmFirstSentenceMs: Math.round(agg?.avgLlmFirstSentenceMs || 0),
            ttsFirstByteMs: Math.round(agg?.avgTtsFirstByteMs || 0),
            firstAudioMs: Math.round(agg?.avgFirstAudioMs || 0),
            totalTurnMs: Math.round(agg?.avgTotalMs || 0),
        },
    });
}
