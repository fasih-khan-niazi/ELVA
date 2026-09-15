import { Request, Response } from 'express';
import { VoiceInboundPayload } from '../voice/voiceContract';
import {
    getOrCreateSession,
    resolveAgentByPhone,
    resolveAgentById,
    handleStatusCallback,
} from '../voice/voiceOrchestrator';
import { buildRejectTwiml, buildMediaStreamTwiml } from '../voice/twimlService';
import {
    shouldUseMediaStreams,
    resolveStreamCallType,
    USE_MEDIA_STREAMS,
} from '../voice/voicePipelineConfig';
import { terminalLog } from '../utils/terminalLog';
import { writeAuditLog } from '../middleware/webhookAuditLog';
import { canAcceptVoiceCall } from '../voice/voiceConcurrencyGuard';

function twimlResponse(res: Response, xml: string): void {
    res.type('text/xml');
    res.send(xml);
}

// ─── POST /api/voice/incoming ─────────────────────────────────────────────
export async function handleIncoming(req: Request, res: Response): Promise<void> {
    try {
        const payload = req.body as VoiceInboundPayload;
        const callSid = payload.CallSid || '';
        const toNumber = payload.To || '';
        const fromNumber = payload.From || '';

        const browserAgentId: string = (req.body as any).agentId || '';
        const browserTenantId: string = (req.body as any).tenantId || '';

        terminalLog.voice('INCOMING', `${callSid.slice(0, 10)}… from ${fromNumber || 'browser'} → ${toNumber || browserAgentId}`);

        let resolved = null;
        let isBrowserCall = false;

        if (browserAgentId && browserTenantId) {
            isBrowserCall = true;
            resolved = await resolveAgentById(browserAgentId, browserTenantId);
        } else {
            resolved = await resolveAgentByPhone(toNumber);
        }

        if (!resolved) {
            writeAuditLog(req, 'error', 'No agent mapped to number').catch(() => {});
            twimlResponse(
                res,
                buildRejectTwiml('Sorry, this number is not currently configured for AI support. Goodbye.'),
            );
            return;
        }

        const concurrency = await canAcceptVoiceCall(resolved.tenantId, callSid);
        if (!concurrency.allowed) {
            writeAuditLog(req, 'error', concurrency.reason || 'Voice concurrency limit').catch(() => {});
            twimlResponse(
                res,
                buildRejectTwiml(concurrency.reason || 'All voice lines are busy. Please try again shortly.'),
            );
            return;
        }

        if (!USE_MEDIA_STREAMS || !shouldUseMediaStreams(isBrowserCall)) {
            terminalLog.err('INCOMING', 'Media Streams disabled — cannot handle call');
            twimlResponse(
                res,
                buildRejectTwiml('Voice service is temporarily unavailable. Please try again shortly.'),
            );
            return;
        }

        const sessionTo = isBrowserCall ? `agent:${browserAgentId}` : toNumber;
        const channel: 'phone' | 'web' = isBrowserCall ? 'web' : 'phone';
        const session = await getOrCreateSession(callSid, resolved, fromNumber, sessionTo, channel);

        writeAuditLog(req, 'success').catch(() => {});

        const streamType = resolveStreamCallType(isBrowserCall);
        terminalLog.voice('INCOMING', `${isBrowserCall ? 'Browser' : 'Phone'} → Media Streams (${streamType})`);
        twimlResponse(res, buildMediaStreamTwiml(callSid, streamType, session.streamToken || ''));
    } catch (outerErr: unknown) {
        const msg = outerErr instanceof Error ? outerErr.message : String(outerErr);
        terminalLog.err('INCOMING', msg || 'fatal error');
        twimlResponse(
            res,
            buildRejectTwiml('We are experiencing technical difficulties. Please try again later.'),
        );
    }
}

// ─── POST /api/voice/status-callback ──────────────────────────────────────
export async function handleStatusCallbackEndpoint(
    req: Request,
    res: Response,
): Promise<void> {
    const payload = req.body as VoiceInboundPayload & { CallDuration?: string };
    terminalLog.dim(`[VOICE][STATUS] ${payload.CallSid} · ${payload.CallStatus}`);

    try {
        await handleStatusCallback(payload);
        writeAuditLog(req, 'success').catch(() => {});
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        terminalLog.err('VOICE', `Status callback error: ${msg}`);
        writeAuditLog(req, 'error', msg).catch(() => {});
    }

    res.sendStatus(200);
}
