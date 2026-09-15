import mongoose, { Schema } from 'mongoose';
import { fire } from '../services/connectorService';

const TERMINAL_STATUSES = new Set([
    'completed',
    'failed',
    'busy',
    'no-answer',
    'canceled',
]);

type ClaimedCallSession = {
    _id: mongoose.Types.ObjectId;
    tenantId: mongoose.Types.ObjectId;
    agentId: mongoose.Types.ObjectId;
    from?: string;
    durationSec?: number;
    endReason?: string;
    status: string;
    turnCount?: number;
};

type LastTurnSnippet = { aiResponse?: string; intent?: string } | null;

/**
 * Runs Connected Apps for trigger source `calls` / event `created` once per voice session.
 * Uses `callConnectorsFiredAt` + findOneAndUpdate so both Twilio status callbacks and
 * in-app hangup paths can safely attempt dispatch without duplicate emails/webhooks.
 */
export async function dispatchCallConnectorsForSessionIfNeeded(
    sessionId: mongoose.Types.ObjectId,
): Promise<void> {
    const VoiceSession = mongoose.model('VoiceSession');
    const VoiceTurn = mongoose.model('VoiceTurn');

    const claimed = (await VoiceSession.findOneAndUpdate(
        {
            _id: sessionId,
            callConnectorsFiredAt: { $exists: false },
            endedAt: { $exists: true, $ne: null },
            status: { $in: [...TERMINAL_STATUSES] },
        },
        { $set: { callConnectorsFiredAt: new Date() } },
        { new: true },
    )
        .select('tenantId agentId from durationSec endReason status turnCount')
        .lean()) as ClaimedCallSession | null;

    if (!claimed) return;

    const lastTurn = (await VoiceTurn.findOne({ sessionId })
        .sort({ turnIndex: -1 })
        .select('aiResponse intent')
        .lean()) as LastTurnSnippet;

    const summaryParts: string[] = [];
    if (lastTurn?.intent) summaryParts.push(`Last intent: ${lastTurn.intent}`);
    if (lastTurn?.aiResponse) {
        const raw = lastTurn.aiResponse;
        const snippet = raw.slice(0, 400);
        summaryParts.push(snippet.length < raw.length ? `${snippet}…` : snippet);
    }
    const summary =
        summaryParts.join('\n') ||
        `Call ended (${String(claimed.endReason || claimed.status)}), ${claimed.turnCount ?? 0} turn(s)`;

    const data = {
        _id: claimed._id,
        duration: claimed.durationSec != null ? String(claimed.durationSec) : '',
        from: claimed.from || '',
        outcome: claimed.endReason || claimed.status,
        sentiment: '',
        summary,
    };

    await fire({
        eventType: 'call.completed',
        agentId: String(claimed.agentId),
        tenantId: String(claimed.tenantId),
        data,
    });
}

export function attachVoiceSessionCallConnectorHook(schema: Schema): void {
    schema.post('save', function (doc: mongoose.Document) {
        if (!doc.get('endedAt')) return;
        const status = doc.get('status') as string | undefined;
        if (!status || !TERMINAL_STATUSES.has(status)) return;
        const id = doc._id as mongoose.Types.ObjectId;
        setImmediate(() => {
            dispatchCallConnectorsForSessionIfNeeded(id).catch((err) => {
                console.error('[VoiceSession] call connector dispatch:', err);
            });
        });
    });
}
