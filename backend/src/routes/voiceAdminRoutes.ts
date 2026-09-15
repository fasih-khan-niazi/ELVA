import { Router } from 'express';
import { protect } from '../middleware/authMiddleware';
import { requireActiveAccount } from '../middleware/activeAccountMiddleware';
import { requireActiveSubscription, requireAnalyticsEnabled } from '../middleware/subscriptionMiddleware';
import {
    listSessions,
    getSession,
    listTurns,
    trashSession,
    restoreSession,
    deleteSessionPermanent,
    listEndpoints,
    createEndpoint,
    deleteEndpoint,
    updateEndpoint,
    listAuditLogs,
    getVoiceStats,
    getRealtimeMetrics,
    getAlerts,
    getLatencyHeatmap,
    getLatencyWaterfall,
} from '../controllers/voiceAdminController';

const router = Router();

// All voice-admin routes require auth + analytics-capable plan
router.use(protect);
router.use(requireActiveAccount);
router.use(requireActiveSubscription);
router.use(requireAnalyticsEnabled);

// ─── Stats ────────────────────────────────────────────────────────────────
router.get('/stats', getVoiceStats);

// ─── Real-time observability ──────────────────────────────────────────────
router.get('/metrics', getRealtimeMetrics);
router.get('/alerts', getAlerts);
router.get('/latency-heatmap', getLatencyHeatmap);
router.get('/latency-waterfall', getLatencyWaterfall);

// ─── Sessions ─────────────────────────────────────────────────────────────
router.get('/sessions', listSessions);
router.get('/sessions/:callSid', getSession);
router.get('/sessions/:callSid/turns', listTurns);
router.post('/sessions/:callSid/trash', trashSession);
router.post('/sessions/:callSid/restore', restoreSession);
router.delete('/sessions/:callSid', deleteSessionPermanent);

// ─── Endpoints (phone → agent mapping) ───────────────────────────────────
router.get('/endpoints', listEndpoints);
router.post('/endpoints', createEndpoint);
router.patch('/endpoints/:id', updateEndpoint);
router.delete('/endpoints/:id', deleteEndpoint);

// ─── Audit logs ───────────────────────────────────────────────────────────
router.get('/audit-logs', listAuditLogs);

export default router;
