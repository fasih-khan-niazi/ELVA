/**
 * browserVoiceController.ts - HTTP handlers for browser-based voice
 *
 * GET  /api/voice/browser/token/:agentId - issue Twilio Access Token
 * POST /api/voice/browser/connect        - TwiML App webhook (called by Twilio
 *                                           when browser client connects)
 */

import { Request, Response } from 'express';
import { AuthRequest } from '../middleware/authMiddleware';
import { generateAccessToken } from '../voice/browserVoiceService';
import { resolveAgentById } from '../voice/voiceResolver';
import { getOrCreateSession } from '../voice/voiceOrchestrator';
import { VoiceSession, VoiceTurn } from '../voice/voiceModels';
import { buildMediaStreamTwiml, buildRejectTwiml } from '../voice/twimlService';
import { shouldUseMediaStreams, USE_MEDIA_STREAMS } from '../voice/voicePipelineConfig';
import { resolveWorkspaceCurrency } from '../utils/workspaceCurrency';
import { canAcceptVoiceCall } from '../voice/voiceConcurrencyGuard';

// ─── GET /api/voice/browser/token/:agentId ────────────────────────────────

/**
 * Issue a short-lived Twilio access token so the browser can connect via
 * Twilio Client JS SDK. Requires JWT auth (the `protect` middleware).
 */
export async function handleBrowserToken(req: AuthRequest, res: Response): Promise<void> {
    try {
        const userId = req.user?.userId || 'unknown';
        const tenantId = req.user?.tenantId;
        const { agentId } = req.params;

        if (!agentId) {
            res.status(400).json({ error: 'agentId is required' });
            return;
        }
        if (!tenantId) {
            res.status(401).json({ error: 'Tenant not found on token' });
            return;
        }

        const resolved = await resolveAgentById(agentId, tenantId);
        if (!resolved) {
            res.status(404).json({ error: 'Voice agent not found or does not belong to your tenant' });
            return;
        }

        const token = generateAccessToken(userId);
        const currency = await resolveWorkspaceCurrency(tenantId, resolved.currency);

        res.json({
            token,
            identity: `elva_user_${userId}`,
            agentId: resolved.agentId,
            agentName: resolved.agentName,
            speakingName: resolved.speakingName,
            personaName: resolved.speakingName,
            currency,
        });
    } catch (err: any) {
        console.error('[BROWSER-VOICE][TOKEN-ERROR]', err?.message || err);
        res.status(500).json({ error: err?.message || 'Failed to generate voice token' });
    }
}

// ─── POST /api/voice/browser/connect ──────────────────────────────────────

/**
 * TwiML App webhook - Twilio calls this URL when a Twilio Device.connect()
 * fires from the browser.
 */
export async function handleBrowserConnect(req: Request, res: Response): Promise<void> {
    try {
        const callSid = req.body.CallSid || `browser_${Date.now()}`;
        const agentId = req.body.agentId || '';
        const tenantId = req.body.tenantId || '';

        console.log('[BROWSER-VOICE][CONNECT]', { callSid, agentId, tenantId });

        if (!agentId || !tenantId) {
            res.type('text/xml');
            res.send('<Response><Say>Missing agent or tenant information.</Say><Hangup/></Response>');
            return;
        }

        const resolved = await resolveAgentById(agentId, tenantId);
        if (!resolved) {
            res.type('text/xml');
            res.send('<Response><Say>Agent not found. Goodbye.</Say><Hangup/></Response>');
            return;
        }

        const concurrency = await canAcceptVoiceCall(tenantId, callSid);
        if (!concurrency.allowed) {
            res.type('text/xml');
            res.send(buildRejectTwiml(concurrency.reason || 'All voice lines are busy. Please try again shortly.'));
            return;
        }

        const session = await getOrCreateSession(callSid, resolved, 'browser', 'agent:' + agentId, 'web');

        if (!USE_MEDIA_STREAMS || !shouldUseMediaStreams(true)) {
            res.type('text/xml');
            res.send(buildRejectTwiml('Voice test is temporarily unavailable. Please try again shortly.'));
            return;
        }

        res.type('text/xml');
        res.send(buildMediaStreamTwiml(callSid, 'browser', session.streamToken || ''));
    } catch (err: any) {
        console.error('[BROWSER-VOICE][CONNECT-ERROR]', err?.message || err);
        res.type('text/xml');
        res.send('<Response><Say>An error occurred. Please try again.</Say><Hangup/></Response>');
    }
}

// ─── GET /api/voice/browser/calls/:callSid/live ───────────────────────────

/** Live turns + order snapshot for the browser test-call modal. */
export async function handleBrowserCallLive(req: AuthRequest, res: Response): Promise<void> {
    try {
        const tenantId = req.user?.tenantId;
        const { callSid } = req.params;
        if (!tenantId || !callSid) {
            res.status(400).json({ error: 'Missing tenant or callSid' });
            return;
        }

        const session = await VoiceSession.findOne({ callSid, tenantId, channel: 'web' }).lean();
        if (!session) {
            res.status(404).json({ error: 'Call session not found' });
            return;
        }

        const turns = await VoiceTurn.find({ callSid })
            .sort('turnIndex')
            .select('turnIndex inputTranscript aiResponse intent createdAt')
            .lean();

        const lastTurn = turns.length > 0 ? turns[turns.length - 1] : null;
        const currency = await resolveWorkspaceCurrency(tenantId);

        res.json({
            callSid,
            status: session.status,
            turnCount: session.turnCount ?? turns.length,
            lastTurnIndex: lastTurn?.turnIndex ?? -1,
            updatedAt: lastTurn?.createdAt ?? session.updatedAt ?? session.startedAt,
            currency,
            turns,
            orderSnapshot: session.orderSnapshot ?? null,
        });
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Failed to load call live data';
        console.error('[BROWSER-VOICE][LIVE-ERROR]', msg);
        res.status(500).json({ error: msg });
    }
}
