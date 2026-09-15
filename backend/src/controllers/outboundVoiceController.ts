import { Request, Response } from 'express';
import { OutboundContact } from '../models/outboundContactModel';
import { Campaign } from '../models/campaignModel';
import { updateCampaignStats } from '../voice/outboundDialer';
import { resolveAgentById } from '../voice/voiceResolver';
import { getOrCreateSession } from '../voice/voiceOrchestrator';
import { VoiceSession } from '../voice/voiceModels';
import { buildGoodbyeTwiml, buildMediaStreamTwiml } from '../voice/twimlService';
import { USE_MEDIA_STREAMS } from '../voice/voicePipelineConfig';
import { buildVoicemailTwiml } from '../voice/ttsService';
import { finalizeOutboundContact } from '../voice/outboundCallOutcomeService';
import {
    buildOutboundInterpolationContext,
    interpolateOutboundCampaignText,
} from '../utils/campaignCopyInterpolation';
import { terminalLog } from '../utils/terminalLog';
import { ensureSessionStreamToken } from '../utils/streamToken';

function twimlResponse(res: Response, xml: string): void {
    res.type('text/xml');
    res.send(xml);
}

async function bumpAbVariantStats(
    contact: InstanceType<typeof OutboundContact>,
    campaign: InstanceType<typeof Campaign> | undefined,
    newStatus: InstanceType<typeof OutboundContact>['status'],
): Promise<void> {
    if (!campaign?.abTest?.enabled || contact.abVariant !== 'B') return;

    const inc: Record<string, number> = {};
    if (newStatus === 'interested') inc['abTest.variantBStats.interested'] = 1;
    else if (newStatus === 'not_interested') inc['abTest.variantBStats.notInterested'] = 1;
    else if (newStatus === 'no_answer') inc['abTest.variantBStats.noAnswer'] = 1;
    else if (newStatus === 'voicemail') inc['abTest.variantBStats.voicemail'] = 1;

    if (Object.keys(inc).length) {
        await Campaign.updateOne({ _id: campaign._id }, { $inc: inc });
    }
}

// ─── POST /api/voice/outbound/answered ────────────────────────────────────────
export async function handleOutboundAnswered(req: Request, res: Response): Promise<void> {
    try {
        const callSid: string = req.body.CallSid || '';
        const toNumber: string = req.body.To || '';
        const answeredBy: string = (req.body.AnsweredBy || '').toLowerCase();

        terminalLog.voice('OUTBOUND', `Answered ${callSid.slice(0, 10)}… → ${toNumber}`);

        const contact = await OutboundContact.findOne({ callSid });
        if (!contact) {
            twimlResponse(res, buildGoodbyeTwiml('Thank you for your time. Goodbye!'));
            return;
        }

        const campaign = await Campaign.findById(contact.campaignId);
        if (!campaign) {
            twimlResponse(res, buildGoodbyeTwiml('Thank you. Goodbye!'));
            return;
        }

        const resolved = await resolveAgentById(
            campaign.agentId.toString(),
            campaign.tenantId.toString(),
        );
        if (!resolved) {
            twimlResponse(res, buildGoodbyeTwiml('Thank you. Goodbye!'));
            return;
        }

        if (answeredBy.startsWith('machine') && answeredBy !== 'unknown') {
            const repName = resolved.persona?.name || resolved.agentName;
            const bizName = resolved.businessName || 'our team';
            const fallbackText = campaign.openingScript
                ? `Hi, this is ${repName} from ${bizName}. Sorry I missed you. Please give us a call back when you have a moment. Thank you!`
                : resolved.firstMessage ||
                  `Hi, this is ${repName} from ${bizName}. Please give us a call back when you have a moment. Thank you!`;

            const voicemailDropUrl = (resolved as any).voicemailDropUrl || '';
            contact.status = 'voicemail';
            contact.disposition = 'voicemail_dropped';
            await contact.save();
            await bumpAbVariantStats(contact, campaign, 'voicemail');
            await updateCampaignStats(contact.campaignId.toString());

            twimlResponse(res, buildVoicemailTwiml(voicemailDropUrl, fallbackText));
            return;
        }

        const session = await getOrCreateSession(
            callSid,
            resolved,
            toNumber,
            `outbound:${campaign.agentId.toString()}`,
            'phone',
        );

        await Campaign.updateOne({ _id: campaign._id }, { $inc: { 'stats.connectedCalls': 1 } });
        if (contact.abVariant === 'B' && campaign.abTest?.enabled) {
            await Campaign.updateOne(
                { _id: campaign._id },
                { $inc: { 'abTest.variantBStats.connectedCalls': 1 } },
            );
        }

        const ictx = buildOutboundInterpolationContext(campaign, contact, resolved);
        let opening = (() => {
            const useB =
                contact.abVariant === 'B' &&
                campaign.abTest?.enabled &&
                (campaign.abTest?.variantBScript || '').trim();
            if (useB) {
                return interpolateOutboundCampaignText(campaign.abTest!.variantBScript, ictx);
            }
            return campaign.openingScript
                ? interpolateOutboundCampaignText(campaign.openingScript, ictx)
                : resolved.firstMessage ||
                  interpolateOutboundCampaignText(
                      `Hi {firstName}, this is {agentName} with {businessName}. ` +
                          `I know I caught you unannounced - do you have a quick minute?`,
                      ictx,
                  );
        })();

        if (campaign.recordingEnabled && campaign.consentDisclosure) {
            opening = `${campaign.consentDisclosure} ${opening}`;
        }

        if (!USE_MEDIA_STREAMS) {
            twimlResponse(res, buildGoodbyeTwiml('Voice service is temporarily unavailable.'));
            return;
        }

        await VoiceSession.updateOne({ callSid }, { $set: { openingScript: opening } });
        const streamToken = session.streamToken || (await ensureSessionStreamToken(callSid)) || '';
        twimlResponse(res, buildMediaStreamTwiml(callSid, 'outbound', streamToken));
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        terminalLog.err('OUTBOUND', `Answered fatal: ${msg}`);
        twimlResponse(res, buildGoodbyeTwiml('We are experiencing technical difficulties. Thank you for your time.'));
    }
}

// ─── POST /api/voice/outbound/recording ───────────────────────────────────────
export async function handleOutboundRecording(req: Request, res: Response): Promise<void> {
    try {
        const callSid: string = req.body.CallSid || '';
        const recordingUrl: string = req.body.RecordingUrl || '';
        if (!callSid || !recordingUrl) {
            res.sendStatus(200);
            return;
        }
        const contact = await OutboundContact.findOne({ callSid });
        if (contact) {
            const existingTags = new Set(contact.tags || []);
            existingTags.add(`recording:${recordingUrl}.mp3`);
            contact.tags = Array.from(existingTags).slice(0, 20);
            await contact.save();
        }
        res.sendStatus(200);
    } catch {
        res.sendStatus(200);
    }
}

// ─── POST /api/voice/outbound/amd-result ──────────────────────────────────────
export async function handleOutboundAmdResult(req: Request, res: Response): Promise<void> {
    try {
        const callSid: string = req.body.CallSid || '';
        const answeredBy: string = (req.body.AnsweredBy || '').toLowerCase();

        if (callSid && answeredBy.startsWith('machine')) {
            const contact = await OutboundContact.findOne({ callSid });
            if (contact && contact.status === 'calling') {
                contact.status = 'voicemail';
                contact.disposition = 'voicemail_dropped';
                await contact.save();
                await updateCampaignStats(contact.campaignId.toString());
            }
        }

        res.sendStatus(200);
    } catch {
        res.sendStatus(200);
    }
}

// ─── POST /api/voice/outbound/status-callback ─────────────────────────────────
export async function handleOutboundStatusCallback(req: Request, res: Response): Promise<void> {
    try {
        const callSid: string = req.body.CallSid || '';
        const callStatus: string = (req.body.CallStatus || '').toLowerCase();
        const callDuration: number = parseInt(req.body.CallDuration || '0', 10);

        const contact = await OutboundContact.findOne({ callSid });
        if (!contact) {
            res.sendStatus(200);
            return;
        }

        let dirty = false;

        if (callStatus === 'no-answer' || callStatus === 'busy') {
            if (contact.status === 'calling') {
                contact.status = 'no_answer';
                contact.disposition = 'no_contact';
                dirty = true;
            }
        } else if (callStatus === 'failed') {
            if (contact.status === 'calling') {
                contact.status = 'failed';
                contact.disposition = 'technical_failure';
                dirty = true;
            }
        } else if (callStatus === 'completed') {
            if (contact.status === 'calling') {
                const session = await VoiceSession.findOne({ callSid });
                if (session) {
                    const camp = await Campaign.findById(contact.campaignId);
                    await finalizeOutboundContact(
                        contact,
                        session,
                        'not_interested',
                        undefined,
                        'hung_up',
                        undefined,
                        camp || undefined,
                    );
                } else {
                    contact.status = 'not_interested';
                    contact.disposition = 'hung_up';
                    dirty = true;
                }
            }
            if (callDuration > 0 && contact.callDurationSec !== callDuration) {
                contact.callDurationSec = callDuration;
                dirty = true;
                await Campaign.updateOne(
                    { _id: contact.campaignId },
                    { $inc: { 'stats.totalCallDurationSec': callDuration } },
                );
            }
        }

        if (dirty) await contact.save();
        await updateCampaignStats(String(contact.campaignId));
        res.sendStatus(200);
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        terminalLog.err('OUTBOUND', `Status callback: ${msg}`);
        res.sendStatus(200);
    }
}
