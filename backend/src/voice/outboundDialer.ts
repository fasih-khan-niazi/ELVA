import twilio from 'twilio';
import { Campaign } from '../models/campaignModel';
import { OutboundContact } from '../models/outboundContactModel';
import { isWithinCallingHours } from './callAnalysisService';

const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID || '';
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN || '';
const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';

// Map of active dialer loops by campaignId string
const _activeDialers = new Map<string, boolean>();

const POLL_INTERVAL_MS = 8_000;

/** FNV-1a — deterministic A/B split per contact id */
function abVariantForContact(contactId: string): 'A' | 'B' {
    let h = 2166136261;
    for (let i = 0; i < contactId.length; i++) {
        h ^= contactId.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    return (h >>> 0) % 2 === 0 ? 'A' : 'B';
}

/** AND these predicates onto outbound dialer batches when contactFilters is set. */
function contactFiltersMatch(
    campaign: InstanceType<typeof Campaign>,
): Record<string, unknown> {
    const f = campaign.contactFilters;
    if (!f) return {};

    const parts: Record<string, unknown>[] = [];

    if (f.tags?.length) {
        parts.push({ tags: { $in: f.tags } });
    }
    if (f.companies?.length) {
        parts.push({ company: { $in: f.companies } });
    }
    if (f.cities?.length) {
        parts.push({ 'customFields.city': { $in: f.cities } });
    }
    const scoreCond: Record<string, number> = {};
    if (f.minLeadScore != null) scoreCond.$gte = f.minLeadScore;
    if (f.maxLeadScore != null) scoreCond.$lte = f.maxLeadScore;
    if (Object.keys(scoreCond).length) {
        parts.push({ leadScore: scoreCond });
    }
    if (f.statuses?.length) {
        parts.push({ status: { $in: f.statuses } });
    }

    if (parts.length === 0) return {};
    return parts.length === 1 ? (parts[0] as Record<string, unknown>) : { $and: parts };
}

function getTwilioClient() {
    if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN) {
        throw new Error('Twilio credentials not configured');
    }
    return twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);
}

async function dialContact(
    contact: InstanceType<typeof OutboundContact>,
    campaign: InstanceType<typeof Campaign>,
    callerIdNumber: string,
    recordingEnabled: boolean,
): Promise<void> {
    const client = getTwilioClient();

    if (campaign.abTest?.enabled && (campaign.abTest.variantBScript || '').trim()) {
        contact.abVariant = abVariantForContact(String(contact._id));
    } else {
        contact.abVariant = 'A';
    }

    const answeredUrl = `${BASE_URL}/api/voice/outbound/answered`;
    const statusCallbackUrl = `${BASE_URL}/api/voice/outbound/status-callback`;

    const call = await client.calls.create({
        to: contact.phone,
        from: callerIdNumber,
        url: answeredUrl,
        statusCallback: statusCallbackUrl,
        statusCallbackEvent: ['initiated', 'answered', 'completed'],
        statusCallbackMethod: 'POST',
        method: 'POST',
        // 'Enable' detects machines in ~1-2s; asyncAmd fires /answered immediately
        // for humans (AnsweredBy='unknown') so the agent speaks with no delay.
        machineDetection: 'Enable',
        machineDetectionTimeout: 4,
        asyncAmd: 'true',
        asyncAmdStatusCallback: `${BASE_URL}/api/voice/outbound/amd-result`,
        asyncAmdStatusCallbackMethod: 'POST',
        ...(recordingEnabled ? {
            record: true,
            recordingStatusCallback: `${BASE_URL}/api/voice/outbound/recording`,
            recordingStatusCallbackEvent: ['completed'],
        } : {}),
    });

    contact.callSid = call.sid;
    contact.status = 'calling';
    contact.attemptCount += 1;
    contact.lastAttemptAt = new Date();
    await contact.save();

    console.log('[DIALER] Dialed', contact.phone, '→ CallSid:', call.sid);
}

export async function startDialer(campaignId: string): Promise<void> {
    if (_activeDialers.get(campaignId)) return;
    _activeDialers.set(campaignId, true);

    console.log('[DIALER] Starting for campaign', campaignId);

    while (_activeDialers.get(campaignId)) {
        const campaign = await Campaign.findById(campaignId);
        if (!campaign || campaign.status !== 'running') {
            console.log('[DIALER] Campaign not running, stopping dialer', campaignId);
            break;
        }

        const callerIdNumber = campaign.callerIdNumber;
        if (!callerIdNumber) {
            console.error('[DIALER] No caller ID number on campaign', campaignId);
            break;
        }

        // ── Calling-hours compliance ────────────────────────────────────
        const hoursCheck = isWithinCallingHours(campaign.callingHours);
        if (!hoursCheck.allowed) {
            console.log('[DIALER] Outside calling hours, waiting...', { campaignId, reason: hoursCheck.reason });
            await new Promise<void>(resolve => setTimeout(resolve, 60_000));
            continue;
        }

        const inFlight = await OutboundContact.countDocuments({ campaignId, status: 'calling' });
        const slots = campaign.maxConcurrentCalls - inFlight;

        const filterExtra = contactFiltersMatch(campaign);

        if (slots > 0) {
            const now = new Date();
            const retryThreshold = new Date(now.getTime() - campaign.retryDelayMinutes * 60_000);

            const orClause = [
                { status: 'pending' },
                {
                    status: 'no_answer',
                    attemptCount: { $lt: campaign.retryAttempts + 1 },
                    lastAttemptAt: { $lte: retryThreshold },
                },
                {
                    status: 'callback',
                    callbackAt: { $lte: now },
                },
            ];
            const baseBatch: Record<string, unknown> = {
                campaignId,
                dnc: { $ne: true },
                $or: orClause,
            };
            const batchQuery =
                Object.keys(filterExtra).length > 0
                    ? { $and: [baseBatch, filterExtra] }
                    : baseBatch;

            const batch = await OutboundContact.find(batchQuery as any)
                .limit(slots)
                .sort({ callbackAt: 1, createdAt: 1 });

            for (const contact of batch) {
                // Final DNC check (tenant-level): another contact with same phone + dnc=true
                if (campaign.honorDnc && contact.phone) {
                    const dnc = await OutboundContact.findOne({
                        tenantId: campaign.tenantId,
                        phone: contact.phone,
                        dnc: true,
                    });
                    if (dnc) {
                        contact.status = 'dnc';
                        contact.dnc = true;
                        contact.disposition = 'dnc_requested';
                        await contact.save();
                        await updateCampaignStats(campaignId);
                        continue;
                    }
                }

                try {
                    await dialContact(contact, campaign, callerIdNumber, campaign.recordingEnabled);
                } catch (err: any) {
                    console.error('[DIALER] Failed to dial', contact.phone, err?.message);
                    contact.status = 'failed';
                    contact.disposition = 'technical_failure';
                    await contact.save();
                    await updateCampaignStats(campaignId);
                }
            }

            // Completion check - campaign is done when no pending/calling/retryable
            const baseRemaining: Record<string, unknown> = {
                campaignId,
                dnc: { $ne: true },
                $or: [
                    { status: 'pending' },
                    { status: 'calling' },
                    {
                        status: 'no_answer',
                        attemptCount: { $lt: campaign.retryAttempts + 1 },
                    },
                    { status: 'callback' },
                ],
            };
            const remainingQuery =
                Object.keys(filterExtra).length > 0
                    ? { $and: [baseRemaining, filterExtra] }
                    : baseRemaining;

            const remaining = await OutboundContact.countDocuments(remainingQuery as any);

            if (remaining === 0) {
                campaign.status = 'completed';
                await campaign.save();
                console.log('[DIALER] Campaign completed', campaignId);
                break;
            }
        }

        await new Promise<void>(resolve => setTimeout(resolve, POLL_INTERVAL_MS));
    }

    _activeDialers.delete(campaignId);
    console.log('[DIALER] Stopped for campaign', campaignId);
}

export function stopDialer(campaignId: string): void {
    _activeDialers.delete(campaignId);
}

export function isDialerActive(campaignId: string): boolean {
    return !!_activeDialers.get(campaignId);
}

export async function updateCampaignStats(campaignId: string): Promise<void> {
    const [
        pending, calling, interested, notInterested, noAnswer,
        voicemail, failed, callback, dnc, wrongNumber,
    ] = await Promise.all([
        OutboundContact.countDocuments({ campaignId, status: 'pending' }),
        OutboundContact.countDocuments({ campaignId, status: 'calling' }),
        OutboundContact.countDocuments({ campaignId, status: 'interested' }),
        OutboundContact.countDocuments({ campaignId, status: 'not_interested' }),
        OutboundContact.countDocuments({ campaignId, status: 'no_answer' }),
        OutboundContact.countDocuments({ campaignId, status: 'voicemail' }),
        OutboundContact.countDocuments({ campaignId, status: 'failed' }),
        OutboundContact.countDocuments({ campaignId, status: 'callback' }),
        OutboundContact.countDocuments({ campaignId, status: 'dnc' }),
        OutboundContact.countDocuments({ campaignId, status: 'wrong_number' }),
    ]);

    await Campaign.findByIdAndUpdate(campaignId, {
        'stats.pending': pending,
        'stats.calling': calling,
        'stats.interested': interested,
        'stats.notInterested': notInterested,
        'stats.noAnswer': noAnswer,
        'stats.voicemail': voicemail,
        'stats.failed': failed,
        'stats.callback': callback,
        'stats.dnc': dnc,
        'stats.wrongNumber': wrongNumber,
    });
}
