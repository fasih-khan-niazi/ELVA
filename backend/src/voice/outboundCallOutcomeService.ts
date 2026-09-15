import mongoose from 'mongoose';
import { OutboundContact, CallDisposition } from '../models/outboundContactModel';
import { Campaign } from '../models/campaignModel';
import { Lead } from '../models';
import { updateCampaignStats } from './outboundDialer';
import { IVoiceSession } from './voiceModels';
import { ResolvedVoiceAgent } from './voiceResolver';
import { TurnResult } from './voiceOrchestrator';
import {
    buildOutboundCallPrompt,
} from './voicePromptAdapter';
import {
    buildOutboundInterpolationContext,
    interpolateOutboundCampaignText,
    interpolateOutboundCopyArray,
    interpolateOutboundObjections,
} from '../utils/campaignCopyInterpolation';
import {
    EXIT_INTENTS,
    TRANSFER_INTENTS,
    CALLBACK_INTENTS,
    DNC_INTENTS,
    WRONG_NUMBER_INTENTS,
    GATEKEEPER_INTENTS,
    INTERESTED_INTENTS,
    DEFAULT_TRANSFER_NUMBER,
    MSG_TRANSFER,
} from './voiceLifecycle';
import { mergeExitIntentFromTranscript } from './voiceClosingPhrases';
import { synthesisedClosingLine } from './voiceClosingService';
import {
    analyzeOutboundCall,
    parseCallbackTime,
} from './callAnalysisService';
import { terminalLog } from '../utils/terminalLog';

export type OutboundTurnAction =
    | { type: 'continue' }
    | { type: 'close'; closingText: string; endReason: IVoiceSession['endReason'] }
    | { type: 'transfer'; transferTo: string; closingText?: string };

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

export async function finalizeOutboundContact(
    contact: InstanceType<typeof OutboundContact>,
    session: IVoiceSession,
    newStatus: InstanceType<typeof OutboundContact>['status'],
    forcedDisposition: CallDisposition | undefined,
    baseIntent: string | undefined,
    callbackPhrase?: string,
    campaign?: InstanceType<typeof Campaign>,
): Promise<void> {
    contact.status = newStatus;
    if (callbackPhrase) {
        const when = parseCallbackTime(callbackPhrase);
        if (when) {
            contact.callbackAt = when;
            contact.callbackReason = callbackPhrase.slice(0, 200);
        }
    }

    if (session.turnCount > 0) {
        try {
            const analysis = await analyzeOutboundCall(String(session._id), {
                baseIntent,
                campaignGoal: campaign?.goal,
                contactName: contact.name,
            });
            contact.aiSummary = analysis.summary;
            contact.leadScore = analysis.leadScore;
            contact.bant = analysis.bant;
            contact.disposition = forcedDisposition || analysis.disposition;
            if (analysis.tags?.length) {
                const merged = new Set([...(contact.tags || []), ...analysis.tags]);
                contact.tags = Array.from(merged).slice(0, 20);
            }
        } catch {
            contact.disposition = forcedDisposition || 'hung_up';
        }
    } else {
        contact.disposition = forcedDisposition || 'no_contact';
    }

    await contact.save();
    await bumpAbVariantStats(contact, campaign, newStatus);
    await updateCampaignStats(String(contact.campaignId));
}

async function createLeadForInterested(
    contact: InstanceType<typeof OutboundContact>,
    session: IVoiceSession,
    callSid: string,
    aiText: string,
): Promise<void> {
    try {
        const lead = await Lead.create({
            agentId: session.agentId,
            tenantId: session.tenantId,
            sessionId: callSid,
            channel: 'phone',
            name: contact.name || '',
            email: contact.email || '',
            phone: contact.phone,
            company: contact.company || '',
            interest: (contact.aiSummary || aiText).slice(0, 500),
            source: 'outbound',
            campaignId: contact.campaignId,
            tags: ['outbound', 'interested', ...(contact.tags || [])],
            notes: contact.leadScore ? `Lead score: ${contact.leadScore}` : undefined,
        });
        contact.linkedLeadId = lead._id as mongoose.Types.ObjectId;
        await contact.save();
        terminalLog.voice('OUTBOUND', `Lead created ${String(lead._id)} score=${contact.leadScore ?? 'n/a'}`);
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        terminalLog.err('OUTBOUND', `Lead create failed: ${msg}`);
    }
}

export async function buildOutboundPromptContext(
    campaign: InstanceType<typeof Campaign>,
    contact: InstanceType<typeof OutboundContact> | null,
    resolvedAgent: ResolvedVoiceAgent,
): Promise<Parameters<typeof buildOutboundCallPrompt>[1]> {
    const ictx = buildOutboundInterpolationContext(campaign, contact, resolvedAgent);
    const offerText = interpolateOutboundCampaignText(campaign.offer || '', ictx).trim();

    let contactExtraCsv: Record<string, string> | undefined;
    if (contact?.customFields && typeof contact.customFields === 'object') {
        contactExtraCsv = {};
        for (const [k, v] of Object.entries(contact.customFields as Record<string, unknown>)) {
            const s = v != null ? String(v).trim() : '';
            if (s) contactExtraCsv[k] = s;
        }
        if (Object.keys(contactExtraCsv).length === 0) contactExtraCsv = undefined;
    }

    return {
        name: contact?.name || undefined,
        company: contact?.company || undefined,
        title: contact?.title || undefined,
        contactExtraCsv,
        goal: campaign.goal,
        offer: offerText || undefined,
        valueProps: campaign.valueProps,
        targetPersona: campaign.targetPersona,
        painPoints: campaign.painPoints,
        qualifyingQuestions: interpolateOutboundCopyArray(campaign.qualifyingQuestions || [], ictx),
        objectionHandlers: interpolateOutboundObjections(campaign.objectionHandlers || [], ictx),
        consentDisclosure: campaign.consentDisclosure,
        recordingEnabled: campaign.recordingEnabled,
        attemptNumber: contact?.attemptCount || 1,
    };
}

export interface OutboundSessionBundle {
    contact: InstanceType<typeof OutboundContact>;
    campaign: InstanceType<typeof Campaign>;
    outboundResolved: ResolvedVoiceAgent;
}

export async function loadOutboundSessionBundle(
    callSid: string,
    baseResolved: ResolvedVoiceAgent,
): Promise<OutboundSessionBundle | null> {
    const contact = await OutboundContact.findOne({ callSid });
    if (!contact) return null;

    const campaign = await Campaign.findById(contact.campaignId);
    if (!campaign) return null;

    const ctx = await buildOutboundPromptContext(campaign, contact, baseResolved);
    const outboundResolved: ResolvedVoiceAgent = {
        ...baseResolved,
        prompt: buildOutboundCallPrompt(baseResolved.prompt, ctx),
    };

    return { contact, campaign, outboundResolved };
}

/**
 * Apply outbound disposition rules after an AI turn (Media Streams path).
 */
export async function resolveOutboundTurnAction(
    speechResult: string,
    result: TurnResult,
    session: IVoiceSession,
    resolved: ResolvedVoiceAgent,
    bundle: OutboundSessionBundle,
): Promise<OutboundTurnAction> {
    const { contact, campaign } = bundle;
    const mergedExit = mergeExitIntentFromTranscript(speechResult, result.intent);
    const intent = (mergedExit || result.intent || '').toLowerCase();

    if (intent && DNC_INTENTS.has(intent)) {
        contact.dnc = true;
        await finalizeOutboundContact(contact, session, 'dnc', 'dnc_requested', intent, undefined, campaign);
        return {
            type: 'close',
            closingText: result.aiText || 'Understood, I will remove you from our list. Have a great day!',
            endReason: 'goodbye',
        };
    }

    if (intent && WRONG_NUMBER_INTENTS.has(intent)) {
        await finalizeOutboundContact(contact, session, 'wrong_number', 'wrong_number', intent, undefined, campaign);
        return {
            type: 'close',
            closingText: result.aiText || 'Apologies for the interruption — have a great day!',
            endReason: 'goodbye',
        };
    }

    if (intent && GATEKEEPER_INTENTS.has(intent)) {
        await finalizeOutboundContact(contact, session, 'no_answer', 'gatekeeper', intent, undefined, campaign);
        return {
            type: 'close',
            closingText: result.aiText || 'Thank you — I will try back later.',
            endReason: 'goodbye',
        };
    }

    if (intent && CALLBACK_INTENTS.has(intent)) {
        await finalizeOutboundContact(
            contact,
            session,
            'callback',
            'callback_requested',
            intent,
            result.callbackWhen,
            campaign,
        );
        return {
            type: 'close',
            closingText: result.aiText || 'No problem, I will call you back then. Talk soon!',
            endReason: 'goodbye',
        };
    }

    const isInterested = intent && (INTERESTED_INTENTS.has(intent) || TRANSFER_INTENTS.has(intent));
    if (isInterested) {
        const forced: CallDisposition = TRANSFER_INTENTS.has(intent)
            ? 'transferred'
            : 'qualified_interest';
        await finalizeOutboundContact(contact, session, 'interested', forced, intent, undefined, campaign);
        await createLeadForInterested(contact, session, session.callSid, result.aiText);

        const transferTo = resolved.transferNumber || DEFAULT_TRANSFER_NUMBER;
        if (transferTo) {
            return { type: 'transfer', transferTo, closingText: MSG_TRANSFER };
        }
        return {
            type: 'close',
            closingText: result.aiText || 'Great — we will follow up very soon. Thank you!',
            endReason: 'transfer',
        };
    }

    if (intent && EXIT_INTENTS.has(intent)) {
        if (contact.status === 'calling') {
            await finalizeOutboundContact(contact, session, 'not_interested', 'not_interested', intent, undefined, campaign);
        }
        const closingLine = synthesisedClosingLine(
            result.intent,
            mergedExit ?? result.intent,
            result.aiText,
            resolved.businessName || '',
            'outbound',
        );
        return { type: 'close', closingText: closingLine, endReason: 'goodbye' };
    }

    return { type: 'continue' };
}

export async function finalizeOutboundOnMaxTurns(
    session: IVoiceSession,
    bundle: OutboundSessionBundle,
): Promise<void> {
    if (bundle.contact.status === 'calling') {
        await finalizeOutboundContact(
            bundle.contact,
            session,
            'not_interested',
            'objection_unresolved',
            undefined,
            undefined,
            bundle.campaign,
        );
    }
}

export async function finalizeOutboundOnSilenceTimeout(
    session: IVoiceSession,
    bundle: OutboundSessionBundle,
): Promise<void> {
    await finalizeOutboundContact(
        bundle.contact,
        session,
        'no_answer',
        'no_contact',
        undefined,
        undefined,
        bundle.campaign,
    );
}

export async function finalizeOutboundOnAiFailure(
    session: IVoiceSession,
    bundle: OutboundSessionBundle,
): Promise<void> {
    if (bundle.contact.status === 'calling') {
        await finalizeOutboundContact(
            bundle.contact,
            session,
            'failed',
            'technical_failure',
            undefined,
            undefined,
            bundle.campaign,
        );
    }
}
