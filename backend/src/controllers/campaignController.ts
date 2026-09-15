import { Response } from 'express';
import mongoose from 'mongoose';
import axios from 'axios';
import { Agent } from '../models';
import { Campaign } from '../models/campaignModel';
import { OutboundContact } from '../models/outboundContactModel';
import { VoiceSession, VoiceTurn } from '../voice/voiceModels';
import { AuthRequest } from '../middleware/authMiddleware';
import { parseCsvBuffer } from '../utils/csvParser';
import { startDialer, stopDialer, isDialerActive, updateCampaignStats } from '../voice/outboundDialer';
import { isWithinCallingHours } from '../voice/callAnalysisService';
import { CAMPAIGN_TEMPLATES, getCampaignTemplateById } from '../data/campaignTemplates';
import { getAiServiceSecretHeaders } from '../utils/aiServiceSecret';

const AI_SERVICE_URL = process.env.AI_SERVICE_URL || 'http://localhost:8000';

// ─── Get Campaign Templates ───────────────────────────────────────────────────
export const getCampaignTemplates = async (_req: AuthRequest, res: Response) => {
    res.json(CAMPAIGN_TEMPLATES.map(t => ({
        id: t.id,
        name: t.name,
        category: t.category,
        description: t.description,
        icon: t.icon,
        goal: t.goal,
        targetPersona: t.targetPersona,
        tags: t.tags,
    })));
};

// ─── Get Single Template Detail ───────────────────────────────────────────────
export const getCampaignTemplateDetail = async (req: AuthRequest, res: Response) => {
    const template = getCampaignTemplateById(req.params.templateId);
    if (!template) return res.status(404).json({ message: 'Template not found' });
    res.json(template);
};

// ─── AI-Generate Campaign Config ─────────────────────────────────────────────
export const generateCampaignConfig = async (req: AuthRequest, res: Response) => {
    const { prompt } = req.body;
    if (!prompt || typeof prompt !== 'string' || prompt.trim().length < 10) {
        return res.status(400).json({ message: 'prompt is required (min 10 characters)' });
    }
    try {
        const { data } = await axios.post(`${AI_SERVICE_URL}/generate-campaign`, {
            prompt: prompt.trim(),
            tenant_id: req.user?.tenantId,
        }, { timeout: 30_000, headers: getAiServiceSecretHeaders() });
        res.json(data);
    } catch (err: any) {
        const detail = err?.response?.data?.detail || err?.message || 'AI generation failed';
        console.error('[CAMPAIGN][GENERATE]', detail);
        res.status(500).json({ message: detail });
    }
};

// ─── Update Contact Filters / Targeting ──────────────────────────────────────
export const updateCampaignFilters = async (req: AuthRequest, res: Response) => {
    try {
        const tenantId = req.user?.tenantId;
        const { id } = req.params;
        const { contactFilters, scheduledStartAt } = req.body;

        const campaign = await Campaign.findOne({ _id: id, tenantId });
        if (!campaign) return res.status(404).json({ message: 'Campaign not found' });
        if (campaign.status === 'running') {
            return res.status(400).json({ message: 'Pause the campaign before changing filters' });
        }

        if (contactFilters && typeof contactFilters === 'object') {
            campaign.contactFilters = {
                tags: Array.isArray(contactFilters.tags) ? contactFilters.tags.map(String).slice(0, 20) : [],
                cities: Array.isArray(contactFilters.cities) ? contactFilters.cities.map(String).slice(0, 20) : [],
                companies: Array.isArray(contactFilters.companies) ? contactFilters.companies.map(String).slice(0, 20) : [],
                statuses: Array.isArray(contactFilters.statuses) ? contactFilters.statuses.map(String) : [],
                minLeadScore: typeof contactFilters.minLeadScore === 'number' ? contactFilters.minLeadScore : undefined,
                maxLeadScore: typeof contactFilters.maxLeadScore === 'number' ? contactFilters.maxLeadScore : undefined,
            };
        }

        if (scheduledStartAt !== undefined) {
            if (scheduledStartAt === null) {
                campaign.scheduledStartAt = undefined;
                if (campaign.status === 'scheduled') campaign.status = 'draft';
            } else {
                const d = new Date(scheduledStartAt);
                if (!isNaN(d.getTime())) {
                    campaign.scheduledStartAt = d;
                    if (campaign.status === 'draft') campaign.status = 'scheduled';
                }
            }
        }

        await campaign.save();
        res.json(campaign);
    } catch (err: any) {
        console.error('[CAMPAIGN][FILTERS]', err?.message);
        res.status(500).json({ message: 'Error updating filters' });
    }
};

// ─── Update A/B Test Config ───────────────────────────────────────────────────
export const updateAbTest = async (req: AuthRequest, res: Response) => {
    try {
        const tenantId = req.user?.tenantId;
        const { id } = req.params;
        const { enabled, variantBScript } = req.body;

        const campaign = await Campaign.findOne({ _id: id, tenantId });
        if (!campaign) return res.status(404).json({ message: 'Campaign not found' });

        if (enabled !== undefined) campaign.abTest.enabled = !!enabled;
        if (variantBScript !== undefined) campaign.abTest.variantBScript = String(variantBScript);

        await campaign.save();
        res.json(campaign);
    } catch (err: any) {
        console.error('[CAMPAIGN][AB-TEST]', err?.message);
        res.status(500).json({ message: 'Error updating A/B test' });
    }
};

// ─── Create Campaign ──────────────────────────────────────────────────────────
export const createCampaign = async (req: AuthRequest, res: Response) => {
    try {
        const tenantId = req.user?.tenantId;
        const {
            agentId, name, description,
            maxConcurrentCalls, retryAttempts, retryDelayMinutes,
            goal, offer, valueProps, targetPersona, painPoints,
            openingScript, qualifyingQuestions, objectionHandlers,
            callingHours, recordingEnabled, consentDisclosure, honorDnc,
        } = req.body;

        if (!agentId || !name) {
            return res.status(400).json({ message: 'agentId and name are required' });
        }

        const agent = await Agent.findOne({ _id: agentId, tenantId });
        if (!agent) return res.status(404).json({ message: 'Agent not found' });
        if (agent.type !== 'voice') return res.status(400).json({ message: 'Agent must be a voice agent' });
        if ((agent as any).callDirection !== 'outbound') {
            return res.status(400).json({ message: 'Agent must be configured as an outbound agent' });
        }

        const outboundCallerId = String((agent as any).outboundCallerId || '').trim();
        if (!outboundCallerId) {
            return res.status(400).json({
                message:
                    'This outbound agent is missing Caller ID (outbound From number). Edit the agent and set '
                    + 'Outbound Caller ID to your Twilio number in E.164 format (e.g. +15551234567), then retry.',
            });
        }

        const campaign = await Campaign.create({
            tenantId,
            agentId,
            name,
            description: description || '',
            callerIdNumber: outboundCallerId,
            maxConcurrentCalls: maxConcurrentCalls ?? 3,
            retryAttempts: retryAttempts ?? 2,
            retryDelayMinutes: retryDelayMinutes ?? 60,
            ...(goal ? { goal } : {}),
            ...(offer !== undefined ? { offer } : {}),
            ...(Array.isArray(valueProps) ? { valueProps } : {}),
            ...(targetPersona !== undefined ? { targetPersona } : {}),
            ...(Array.isArray(painPoints) ? { painPoints } : {}),
            ...(openingScript !== undefined ? { openingScript } : {}),
            ...(Array.isArray(qualifyingQuestions) ? { qualifyingQuestions } : {}),
            ...(Array.isArray(objectionHandlers) ? { objectionHandlers } : {}),
            ...(callingHours ? { callingHours } : {}),
            ...(recordingEnabled !== undefined ? { recordingEnabled } : {}),
            ...(consentDisclosure !== undefined ? { consentDisclosure } : {}),
            ...(honorDnc !== undefined ? { honorDnc } : {}),
        });

        res.status(201).json(campaign);
    } catch (err: any) {
        console.error('[CAMPAIGN][CREATE]', err?.message);
        res.status(500).json({ message: 'Error creating campaign' });
    }
};

// ─── List Campaigns ───────────────────────────────────────────────────────────
export const getCampaigns = async (req: AuthRequest, res: Response) => {
    try {
        const tenantId = req.user?.tenantId;
        const { status, agentId } = req.query;

        const filter: Record<string, unknown> = { tenantId };
        if (status) filter.status = status;
        if (agentId) filter.agentId = agentId;

        const campaigns = await Campaign.find(filter)
            .populate('agentId', 'name callDirection outboundCallerId')
            .sort({ createdAt: -1 });

        res.json(campaigns);
    } catch (err: any) {
        console.error('[CAMPAIGN][LIST]', err?.message);
        res.status(500).json({ message: 'Error fetching campaigns' });
    }
};

// ─── Get Campaign by ID ───────────────────────────────────────────────────────
export const getCampaignById = async (req: AuthRequest, res: Response) => {
    try {
        const tenantId = req.user?.tenantId;
        const { id } = req.params;

        const campaign = await Campaign.findOne({ _id: id, tenantId })
            .populate('agentId', 'name callDirection outboundCallerId transferNumber businessName');

        if (!campaign) return res.status(404).json({ message: 'Campaign not found' });

        const callingAllowed = isWithinCallingHours(campaign.callingHours);

        res.json({
            ...campaign.toObject(),
            dialerActive: isDialerActive(String(campaign._id)),
            callingAllowed,
        });
    } catch (err: any) {
        console.error('[CAMPAIGN][GET]', err?.message);
        res.status(500).json({ message: 'Error fetching campaign' });
    }
};

// ─── Update Campaign (general fields only, not script) ────────────────────────
export const updateCampaign = async (req: AuthRequest, res: Response) => {
    try {
        const tenantId = req.user?.tenantId;
        const { id } = req.params;
        const { name, description, maxConcurrentCalls, retryAttempts, retryDelayMinutes } = req.body;

        const campaign = await Campaign.findOne({ _id: id, tenantId });
        if (!campaign) return res.status(404).json({ message: 'Campaign not found' });
        if (campaign.status === 'running') {
            return res.status(400).json({ message: 'Pause the campaign before editing it' });
        }

        if (name !== undefined) campaign.name = name;
        if (description !== undefined) campaign.description = description;
        if (maxConcurrentCalls !== undefined) campaign.maxConcurrentCalls = maxConcurrentCalls;
        if (retryAttempts !== undefined) campaign.retryAttempts = retryAttempts;
        if (retryDelayMinutes !== undefined) campaign.retryDelayMinutes = retryDelayMinutes;
        await campaign.save();

        res.json(campaign);
    } catch (err: any) {
        console.error('[CAMPAIGN][UPDATE]', err?.message);
        res.status(500).json({ message: 'Error updating campaign' });
    }
};

// ─── Update Campaign Script / Playbook ───────────────────────────────────────
export const updateCampaignScript = async (req: AuthRequest, res: Response) => {
    try {
        const tenantId = req.user?.tenantId;
        const { id } = req.params;
        const {
            goal, offer, valueProps, targetPersona, painPoints,
            openingScript, qualifyingQuestions, objectionHandlers,
            callingHours, recordingEnabled, consentDisclosure, honorDnc,
        } = req.body;

        const campaign = await Campaign.findOne({ _id: id, tenantId });
        if (!campaign) return res.status(404).json({ message: 'Campaign not found' });

        if (goal !== undefined) campaign.goal = goal;
        if (offer !== undefined) campaign.offer = offer;
        if (Array.isArray(valueProps)) campaign.valueProps = valueProps.map(String).slice(0, 8);
        if (targetPersona !== undefined) campaign.targetPersona = targetPersona;
        if (Array.isArray(painPoints)) campaign.painPoints = painPoints.map(String).slice(0, 8);
        if (openingScript !== undefined) campaign.openingScript = openingScript;
        if (Array.isArray(qualifyingQuestions)) {
            campaign.qualifyingQuestions = qualifyingQuestions.map(String).filter(q => q.trim()).slice(0, 10);
        }
        if (Array.isArray(objectionHandlers)) {
            campaign.objectionHandlers = objectionHandlers
                .filter((o: any) => o?.objection && o?.response)
                .map((o: any) => ({ objection: String(o.objection), response: String(o.response) }))
                .slice(0, 15);
        }
        if (callingHours) {
            campaign.callingHours = {
                startHour: typeof callingHours.startHour === 'number' ? callingHours.startHour : campaign.callingHours.startHour,
                endHour: typeof callingHours.endHour === 'number' ? callingHours.endHour : campaign.callingHours.endHour,
                daysOfWeek: Array.isArray(callingHours.daysOfWeek) ? callingHours.daysOfWeek.map(Number) : campaign.callingHours.daysOfWeek,
                timezoneOffsetMinutes: typeof callingHours.timezoneOffsetMinutes === 'number' ? callingHours.timezoneOffsetMinutes : campaign.callingHours.timezoneOffsetMinutes,
            };
        }
        if (recordingEnabled !== undefined) campaign.recordingEnabled = !!recordingEnabled;
        if (consentDisclosure !== undefined) campaign.consentDisclosure = consentDisclosure;
        if (honorDnc !== undefined) campaign.honorDnc = !!honorDnc;

        await campaign.save();
        res.json(campaign);
    } catch (err: any) {
        console.error('[CAMPAIGN][SCRIPT]', err?.message);
        res.status(500).json({ message: 'Error updating campaign script' });
    }
};

// ─── Delete Campaign ──────────────────────────────────────────────────────────
export const deleteCampaign = async (req: AuthRequest, res: Response) => {
    try {
        const tenantId = req.user?.tenantId;
        const { id } = req.params;

        const campaign = await Campaign.findOne({ _id: id, tenantId });
        if (!campaign) return res.status(404).json({ message: 'Campaign not found' });
        if (campaign.status === 'running') {
            return res.status(400).json({ message: 'Stop the campaign before deleting it' });
        }

        await OutboundContact.deleteMany({ campaignId: id });
        await campaign.deleteOne();

        res.json({ message: 'Campaign deleted' });
    } catch (err: any) {
        console.error('[CAMPAIGN][DELETE]', err?.message);
        res.status(500).json({ message: 'Error deleting campaign' });
    }
};

// ─── Start Campaign ───────────────────────────────────────────────────────────
export const startCampaign = async (req: AuthRequest, res: Response) => {
    try {
        const tenantId = req.user?.tenantId;
        const { id } = req.params;

        const campaign = await Campaign.findOne({ _id: id, tenantId });
        if (!campaign) return res.status(404).json({ message: 'Campaign not found' });
        if (!['draft', 'paused'].includes(campaign.status)) {
            return res.status(400).json({ message: `Cannot start a campaign in '${campaign.status}' status` });
        }

        const dialable = await OutboundContact.countDocuments({
            campaignId: id,
            dnc: { $ne: true },
            $or: [
                { status: 'pending' },
                { status: 'callback' },
                { status: 'no_answer', attemptCount: { $lt: campaign.retryAttempts + 1 } },
            ],
        });
        if (dialable === 0) {
            return res.status(400).json({ message: 'No contacts available to dial. Upload contacts first.' });
        }

        let cid = String(campaign.callerIdNumber || '').trim();
        if (!cid) {
            const ag = await Agent.findById(campaign.agentId);
            cid = String((ag as any)?.outboundCallerId || '').trim();
            if (cid) {
                campaign.callerIdNumber = cid;
                await campaign.save();
            }
        }
        if (!cid) {
            return res.status(400).json({
                message:
                    'Campaign has no Caller ID. Set Outbound Caller ID on the outbound voice agent '
                    + '(or recreate the campaign) using your Twilio number in E.164 format.',
            });
        }

        campaign.status = 'running';
        await campaign.save();

        startDialer(id).catch(err => console.error('[CAMPAIGN][DIALER-ERROR]', err?.message));

        res.json({ message: 'Campaign started', campaign });
    } catch (err: any) {
        console.error('[CAMPAIGN][START]', err?.message);
        res.status(500).json({ message: 'Error starting campaign' });
    }
};

// ─── Pause Campaign ───────────────────────────────────────────────────────────
export const pauseCampaign = async (req: AuthRequest, res: Response) => {
    try {
        const tenantId = req.user?.tenantId;
        const { id } = req.params;

        const campaign = await Campaign.findOne({ _id: id, tenantId });
        if (!campaign) return res.status(404).json({ message: 'Campaign not found' });
        if (campaign.status !== 'running') {
            return res.status(400).json({ message: 'Campaign is not running' });
        }

        campaign.status = 'paused';
        await campaign.save();
        stopDialer(id);

        res.json({ message: 'Campaign paused', campaign });
    } catch (err: any) {
        console.error('[CAMPAIGN][PAUSE]', err?.message);
        res.status(500).json({ message: 'Error pausing campaign' });
    }
};

// ─── Stop Campaign ────────────────────────────────────────────────────────────
export const stopCampaign = async (req: AuthRequest, res: Response) => {
    try {
        const tenantId = req.user?.tenantId;
        const { id } = req.params;

        const campaign = await Campaign.findOne({ _id: id, tenantId });
        if (!campaign) return res.status(404).json({ message: 'Campaign not found' });
        if (campaign.status === 'completed') {
            return res.status(400).json({ message: 'Campaign is already completed' });
        }

        campaign.status = 'stopped';
        await campaign.save();
        stopDialer(id);

        res.json({ message: 'Campaign stopped', campaign });
    } catch (err: any) {
        console.error('[CAMPAIGN][STOP]', err?.message);
        res.status(500).json({ message: 'Error stopping campaign' });
    }
};

// ─── Upload Contacts CSV ──────────────────────────────────────────────────────
export const uploadContacts = async (req: AuthRequest, res: Response) => {
    try {
        const tenantId = req.user?.tenantId;
        const { id } = req.params;

        if (!req.file) return res.status(400).json({ message: 'CSV file is required' });

        const campaign = await Campaign.findOne({ _id: id, tenantId });
        if (!campaign) return res.status(404).json({ message: 'Campaign not found' });
        if (campaign.status === 'running') {
            return res.status(400).json({ message: 'Pause the campaign before uploading new contacts' });
        }

        const { valid, rejected } = parseCsvBuffer(req.file.buffer);

        let inserted = 0;
        let skippedDuplicate = 0;
        let skippedDnc = 0;

        if (valid.length > 0) {
            // Build a set of existing phones in this campaign to avoid dupes
            const existingPhones = new Set(
                (await OutboundContact.find({ campaignId: id }).select('phone').lean())
                    .map(c => c.phone)
            );

            // Tenant-wide DNC phones
            const dncPhones = new Set(
                (await OutboundContact.find({ tenantId, dnc: true }).select('phone').lean())
                    .map(c => c.phone)
            );

            const fresh = [];
            for (const c of valid) {
                if (existingPhones.has(c.phone)) { skippedDuplicate++; continue; }
                if (campaign.honorDnc && dncPhones.has(c.phone)) { skippedDnc++; continue; }
                fresh.push({
                    campaignId: new mongoose.Types.ObjectId(id),
                    tenantId: new mongoose.Types.ObjectId(tenantId as string),
                    agentId: campaign.agentId,
                    phone: c.phone,
                    name: c.name,
                    email: c.email,
                    company: c.company,
                    title: c.title || '',
                    customFields: c.customFields && Object.keys(c.customFields).length ? c.customFields : {},
                    status: 'pending' as const,
                });
            }

            if (fresh.length) {
                await OutboundContact.insertMany(fresh, { ordered: false });
                inserted = fresh.length;
            }
        }

        campaign.totalContacts = await OutboundContact.countDocuments({ campaignId: id });
        campaign.stats.pending = await OutboundContact.countDocuments({ campaignId: id, status: 'pending' });
        await campaign.save();

        res.json({
            message: `Imported ${inserted} contacts`,
            imported: inserted,
            rejected: rejected.length,
            skippedDuplicate,
            skippedDnc,
            rejectedDetails: rejected.slice(0, 20),
        });
    } catch (err: any) {
        console.error('[CAMPAIGN][UPLOAD]', err?.message);
        res.status(500).json({ message: 'Error uploading contacts' });
    }
};

// ─── Get Contacts ─────────────────────────────────────────────────────────────
export const getContacts = async (req: AuthRequest, res: Response) => {
    try {
        const tenantId = req.user?.tenantId;
        const { id } = req.params;
        const { status, page = '1', limit = '50', q, sort = 'createdAt' } = req.query;

        const campaign = await Campaign.findOne({ _id: id, tenantId });
        if (!campaign) return res.status(404).json({ message: 'Campaign not found' });

        const filter: Record<string, unknown> = { campaignId: id };
        if (status) filter.status = status;
        if (q && typeof q === 'string' && q.trim()) {
            filter.$or = [
                { name: { $regex: q, $options: 'i' } },
                { phone: { $regex: q, $options: 'i' } },
                { email: { $regex: q, $options: 'i' } },
                { company: { $regex: q, $options: 'i' } },
            ];
        }

        const sortMap: Record<string, Record<string, 1 | -1>> = {
            createdAt: { createdAt: 1 },
            score: { leadScore: -1, lastAttemptAt: -1 },
            duration: { callDurationSec: -1 },
            attempts: { attemptCount: -1 },
        };
        const sortBy = sortMap[String(sort)] || sortMap.createdAt;

        const skip = (parseInt(page as string) - 1) * parseInt(limit as string);
        const [contacts, total] = await Promise.all([
            OutboundContact.find(filter)
                .sort(sortBy)
                .skip(skip)
                .limit(parseInt(limit as string)),
            OutboundContact.countDocuments(filter),
        ]);

        res.json({ contacts, total, page: parseInt(page as string), limit: parseInt(limit as string) });
    } catch (err: any) {
        console.error('[CAMPAIGN][CONTACTS]', err?.message);
        res.status(500).json({ message: 'Error fetching contacts' });
    }
};

// ─── Update Single Contact (DNC, callback, notes, tags) ──────────────────────
export const updateContact = async (req: AuthRequest, res: Response) => {
    try {
        const tenantId = req.user?.tenantId;
        const { id, contactId } = req.params;
        const { dnc, notes, tags, callbackAt, callbackReason, status, name, company, email } = req.body;

        const campaign = await Campaign.findOne({ _id: id, tenantId });
        if (!campaign) return res.status(404).json({ message: 'Campaign not found' });

        const contact = await OutboundContact.findOne({ _id: contactId, campaignId: id });
        if (!contact) return res.status(404).json({ message: 'Contact not found' });

        if (dnc !== undefined) {
            contact.dnc = !!dnc;
            if (dnc) {
                contact.status = 'dnc';
                contact.disposition = 'dnc_requested';
            }
        }
        if (notes !== undefined) contact.notes = String(notes).slice(0, 2000);
        if (Array.isArray(tags)) contact.tags = tags.map(String).slice(0, 20);
        if (callbackAt) {
            const d = new Date(callbackAt);
            if (!isNaN(d.getTime())) {
                contact.callbackAt = d;
                if (contact.status !== 'dnc') contact.status = 'callback';
            }
        }
        if (callbackReason !== undefined) contact.callbackReason = String(callbackReason).slice(0, 500);
        if (status && ['pending', 'callback', 'dnc'].includes(status)) {
            contact.status = status;
        }
        if (name !== undefined) contact.name = name;
        if (company !== undefined) contact.company = company;
        if (email !== undefined) contact.email = email;

        await contact.save();
        await updateCampaignStats(String(id));

        res.json(contact);
    } catch (err: any) {
        console.error('[CAMPAIGN][CONTACT-UPDATE]', err?.message);
        res.status(500).json({ message: 'Error updating contact' });
    }
};

// ─── Get Contact Detail (transcript + analysis) ──────────────────────────────
export const getContactDetail = async (req: AuthRequest, res: Response) => {
    try {
        const tenantId = req.user?.tenantId;
        const { id, contactId } = req.params;

        const campaign = await Campaign.findOne({ _id: id, tenantId });
        if (!campaign) return res.status(404).json({ message: 'Campaign not found' });

        const contact = await OutboundContact.findOne({ _id: contactId, campaignId: id });
        if (!contact) return res.status(404).json({ message: 'Contact not found' });

        let turns: any[] = [];
        if (contact.callSid) {
            const session = await VoiceSession.findOne({ callSid: contact.callSid });
            if (session) {
                turns = await VoiceTurn.find({ sessionId: session._id })
                    .sort({ turnIndex: 1 })
                    .select('turnIndex inputTranscript aiResponse intent latencyMs createdAt')
                    .lean();
            }
        }

        res.json({ contact, turns });
    } catch (err: any) {
        console.error('[CAMPAIGN][CONTACT-DETAIL]', err?.message);
        res.status(500).json({ message: 'Error fetching contact detail' });
    }
};

// ─── Get KPIs ────────────────────────────────────────────────────────────────
export const getCampaignKpis = async (req: AuthRequest, res: Response) => {
    try {
        const tenantId = req.user?.tenantId;
        const { id } = req.params;

        const campaign = await Campaign.findOne({ _id: id, tenantId });
        if (!campaign) return res.status(404).json({ message: 'Campaign not found' });

        const s = campaign.stats;
        const totalCalled = s.interested + s.notInterested + s.noAnswer + s.voicemail + s.failed + s.callback + s.dnc + s.wrongNumber;
        const connected = s.connectedCalls || (s.interested + s.notInterested + s.callback);
        const conversions = s.interested;

        const connectRate = totalCalled > 0 ? (connected / totalCalled) * 100 : 0;
        const conversionRate = connected > 0 ? (conversions / connected) * 100 : 0;
        const overallConversion = totalCalled > 0 ? (conversions / totalCalled) * 100 : 0;
        const avgDurationSec = connected > 0 ? (s.totalCallDurationSec || 0) / connected : 0;

        // Average lead score on qualified leads
        const scoreAgg = await OutboundContact.aggregate([
            { $match: { campaignId: campaign._id, status: 'interested', leadScore: { $ne: null } } },
            { $group: { _id: null, avgScore: { $avg: '$leadScore' }, maxScore: { $max: '$leadScore' } } },
        ]);
        const avgLeadScore = scoreAgg[0]?.avgScore || 0;
        const maxLeadScore = scoreAgg[0]?.maxScore || 0;

        // Disposition breakdown
        const dispoAgg = await OutboundContact.aggregate([
            { $match: { campaignId: campaign._id, disposition: { $ne: null } } },
            { $group: { _id: '$disposition', count: { $sum: 1 } } },
        ]);
        const dispositions: Record<string, number> = {};
        for (const d of dispoAgg) dispositions[d._id] = d.count;

        res.json({
            totalContacts: campaign.totalContacts,
            totalCalled,
            connected,
            conversions,
            connectRate: Number(connectRate.toFixed(1)),
            conversionRate: Number(conversionRate.toFixed(1)),
            overallConversion: Number(overallConversion.toFixed(1)),
            avgDurationSec: Math.round(avgDurationSec),
            totalCallDurationSec: s.totalCallDurationSec || 0,
            avgLeadScore: Math.round(avgLeadScore),
            maxLeadScore,
            dispositions,
            stats: s,
        });
    } catch (err: any) {
        console.error('[CAMPAIGN][KPI]', err?.message);
        res.status(500).json({ message: 'Error fetching KPIs' });
    }
};

// ─── Hot Leads ───────────────────────────────────────────────────────────────
export const getHotLeads = async (req: AuthRequest, res: Response) => {
    try {
        const tenantId = req.user?.tenantId;
        const { id } = req.params;
        const limit = Math.min(parseInt((req.query.limit as string) || '20', 10), 100);

        const campaign = await Campaign.findOne({ _id: id, tenantId });
        if (!campaign) return res.status(404).json({ message: 'Campaign not found' });

        const contacts = await OutboundContact.find({
            campaignId: id,
            status: 'interested',
        })
            .sort({ leadScore: -1, lastAttemptAt: -1 })
            .limit(limit);

        res.json(contacts);
    } catch (err: any) {
        console.error('[CAMPAIGN][HOT-LEADS]', err?.message);
        res.status(500).json({ message: 'Error fetching hot leads' });
    }
};

// ─── Upcoming Callbacks ──────────────────────────────────────────────────────
export const getCallbacks = async (req: AuthRequest, res: Response) => {
    try {
        const tenantId = req.user?.tenantId;
        const { id } = req.params;

        const campaign = await Campaign.findOne({ _id: id, tenantId });
        if (!campaign) return res.status(404).json({ message: 'Campaign not found' });

        const contacts = await OutboundContact.find({
            campaignId: id,
            status: 'callback',
            callbackAt: { $ne: null },
        })
            .sort({ callbackAt: 1 })
            .limit(100);

        res.json(contacts);
    } catch (err: any) {
        console.error('[CAMPAIGN][CALLBACKS]', err?.message);
        res.status(500).json({ message: 'Error fetching callbacks' });
    }
};

// ─── Tenant-wide Do-Not-Call list ────────────────────────────────────────────
export const getTenantDnc = async (req: AuthRequest, res: Response) => {
    try {
        const tenantId = req.user?.tenantId;
        const dncContacts = await OutboundContact.aggregate([
            { $match: { tenantId: new mongoose.Types.ObjectId(tenantId as string), dnc: true } },
            {
                $group: {
                    _id: '$phone',
                    name: { $first: '$name' },
                    company: { $first: '$company' },
                    addedAt: { $max: '$updatedAt' },
                    campaignCount: { $sum: 1 },
                },
            },
            { $sort: { addedAt: -1 } },
            { $limit: 500 },
        ]);
        res.json(dncContacts.map(d => ({
            phone: d._id,
            name: d.name,
            company: d.company,
            addedAt: d.addedAt,
            campaignCount: d.campaignCount,
        })));
    } catch (err: any) {
        console.error('[CAMPAIGN][DNC-LIST]', err?.message);
        res.status(500).json({ message: 'Error fetching DNC list' });
    }
};

export const addTenantDnc = async (req: AuthRequest, res: Response) => {
    try {
        const tenantId = req.user?.tenantId;
        const { phone, name, company } = req.body;
        if (!phone) return res.status(400).json({ message: 'phone is required' });

        const normalized = String(phone).replace(/[\s\-().]/g, '');
        if (!/^\+?\d{10,15}$/.test(normalized)) {
            return res.status(400).json({ message: 'invalid phone number' });
        }
        const phoneE164 = normalized.startsWith('+') ? normalized : `+${normalized}`;

        // Mark DNC across all campaigns for this tenant
        await OutboundContact.updateMany(
            { tenantId, phone: phoneE164 },
            { $set: { dnc: true, status: 'dnc', disposition: 'dnc_requested' } },
        );

        // If no contact exists yet, create a placeholder so future imports skip it
        const exists = await OutboundContact.findOne({ tenantId, phone: phoneE164, dnc: true });
        if (!exists) {
            // Pick any campaign to attach the placeholder to (DNC list lookup uses tenantId+phone+dnc)
            const anyCampaign = await Campaign.findOne({ tenantId });
            if (anyCampaign) {
                await OutboundContact.create({
                    campaignId: anyCampaign._id,
                    tenantId,
                    agentId: anyCampaign.agentId,
                    phone: phoneE164,
                    name: name || '',
                    company: company || '',
                    status: 'dnc',
                    dnc: true,
                    disposition: 'dnc_requested',
                });
            }
        }

        res.json({ message: 'Added to DNC list', phone: phoneE164 });
    } catch (err: any) {
        console.error('[CAMPAIGN][DNC-ADD]', err?.message);
        res.status(500).json({ message: 'Error adding to DNC list' });
    }
};

export const removeTenantDnc = async (req: AuthRequest, res: Response) => {
    try {
        const tenantId = req.user?.tenantId;
        const { phone } = req.params;
        if (!phone) return res.status(400).json({ message: 'phone required' });

        await OutboundContact.updateMany(
            { tenantId, phone },
            { $set: { dnc: false } },
        );
        res.json({ message: 'Removed from DNC list' });
    } catch (err: any) {
        console.error('[CAMPAIGN][DNC-REMOVE]', err?.message);
        res.status(500).json({ message: 'Error removing from DNC list' });
    }
};

// ─── Export ALL contacts for a campaign as CSV ────────────────────────────────
export const exportAllContacts = async (req: AuthRequest, res: Response) => {
    try {
        const tenantId = req.user?.tenantId;
        const { id } = req.params;

        const campaign = await Campaign.findOne({ _id: id, tenantId });
        if (!campaign) return res.status(404).json({ message: 'Campaign not found' });

        const contacts = await OutboundContact.find({ campaignId: id }).sort({ leadScore: -1, createdAt: -1 }).lean();

        const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
        const headers = [
            'Name', 'Company', 'Title', 'Phone', 'Email',
            'Status', 'Disposition', 'Lead Score',
            'BANT Budget', 'BANT Authority', 'BANT Need', 'BANT Timeline',
            'Attempts', 'Call Duration (s)', 'Last Attempted',
            'AI Summary', 'Tags', 'Notes', 'DNC',
        ];
        const rows = (contacts as any[]).map(c => [
            esc(c.name), esc(c.company), esc(c.title),
            esc(c.phone), esc(c.email), esc(c.status),
            esc(c.disposition || ''), esc(c.leadScore ?? ''),
            esc(c.bant?.budget ?? ''), esc(c.bant?.authority ?? ''),
            esc(c.bant?.need ?? ''), esc(c.bant?.timeline ?? ''),
            esc(c.attemptCount ?? 0), esc(c.callDurationSec ?? 0),
            esc(c.lastAttemptAt ? new Date(c.lastAttemptAt).toISOString() : ''),
            esc(c.aiSummary || ''), esc((c.tags || []).join('; ')), esc(c.notes || ''),
            esc(c.dnc ? 'Yes' : 'No'),
        ].join(','));

        const csv = [headers.map(esc).join(','), ...rows].join('\n');
        const safeName = campaign.name.replace(/[^a-z0-9]/gi, '_');
        const date = new Date().toISOString().slice(0, 10);

        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="${safeName}_contacts_${date}.csv"`);
        return res.send('﻿' + csv);
    } catch (err: any) {
        console.error('[CAMPAIGN][EXPORT-ALL]', err?.message);
        return res.status(500).json({ message: 'Error exporting contacts' });
    }
};

// ─── Export leads (qualified-interest contacts) as CSV ───────────────────────
export const exportLeads = async (req: AuthRequest, res: Response) => {
    try {
        const tenantId = req.user?.tenantId;
        const { id } = req.params;

        const campaign = await Campaign.findOne({ _id: id, tenantId });
        if (!campaign) return res.status(404).json({ message: 'Campaign not found' });

        const contacts = await OutboundContact.find({
            campaignId: id,
            status: { $in: ['interested', 'callback'] },
        }).sort({ leadScore: -1 });

        const headers = ['Name', 'Company', 'Title', 'Phone', 'Email', 'Status', 'Disposition', 'Lead Score', 'Duration(s)', 'Summary'];
        const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
        const rows = contacts.map(c => [
            esc(c.name), esc(c.company), esc(c.title), esc(c.phone), esc(c.email),
            esc(c.status), esc(c.disposition || ''), esc(c.leadScore ?? ''),
            esc(c.callDurationSec ?? ''), esc(c.aiSummary || ''),
        ].join(','));
        const csv = [headers.map(esc).join(','), ...rows].join('\n');

        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename="${campaign.name.replace(/[^a-z0-9]/gi, '_')}_leads.csv"`);
        res.send(csv);
    } catch (err: any) {
        console.error('[CAMPAIGN][EXPORT]', err?.message);
        res.status(500).json({ message: 'Error exporting leads' });
    }
};
