import mongoose, { Document, Schema } from 'mongoose';

export interface ICampaignStats {
    pending: number;
    calling: number;
    interested: number;
    notInterested: number;
    noAnswer: number;
    voicemail: number;
    failed: number;
    callback: number;
    dnc: number;
    wrongNumber: number;
    totalCallDurationSec: number;
    connectedCalls: number; // calls that had a human conversation
}

export interface IObjectionHandler {
    objection: string;   // e.g. "Not interested"
    response: string;    // suggested rebuttal
}

export interface ICallingHours {
    startHour: number;       // 0-23, local business hour window start
    endHour: number;         // 0-23, inclusive exclusive → call allowed if hour < endHour
    daysOfWeek: number[];    // 0=Sun, 6=Sat; default Mon-Fri
    timezoneOffsetMinutes: number; // UTC offset of the *tenant's* calling window (e.g. 0 for UTC, -300 for EST)
}

export type CampaignGoal = 'book_meeting' | 'qualify_lead' | 'transfer_to_human' | 'nurture' | 'sell_direct';
export type CampaignCreationMethod = 'ai' | 'template' | 'manual';

export interface IContactFilters {
    tags?: string[];
    minLeadScore?: number;
    maxLeadScore?: number;
    cities?: string[];
    companies?: string[];
    statuses?: string[];
}

export interface IAbTestVariant {
    enabled: boolean;
    variantBScript: string;
    variantBStats: {
        interested: number;
        notInterested: number;
        noAnswer: number;
        voicemail: number;
        connectedCalls: number;
    };
}

export interface ICampaign extends Document {
    tenantId: mongoose.Types.ObjectId;
    agentId: mongoose.Types.ObjectId;
    name: string;
    description: string;
    status: 'draft' | 'running' | 'paused' | 'completed' | 'stopped' | 'scheduled';
    callerIdNumber: string;
    maxConcurrentCalls: number;
    retryAttempts: number;
    retryDelayMinutes: number;
    totalContacts: number;
    stats: ICampaignStats;

    // ─── Creation metadata ────────────────────────────────────────────
    creationMethod: CampaignCreationMethod;
    templateId?: string;
    scheduledStartAt?: Date;

    // ─── Campaign goal & offer ─────────────────────────────────────────
    goal: CampaignGoal;
    offer: string;
    valueProps: string[];
    targetPersona: string;
    painPoints: string[];

    // ─── Cold-call playbook ───────────────────────────────────────────
    openingScript: string;
    qualifyingQuestions: string[];
    objectionHandlers: IObjectionHandler[];

    // ─── Contact targeting / segmentation ────────────────────────────
    contactFilters: IContactFilters;

    // ─── A/B Script Testing ───────────────────────────────────────────
    abTest: IAbTestVariant;

    // ─── Compliance ──────────────────────────────────────────────────
    callingHours: ICallingHours;
    recordingEnabled: boolean;
    consentDisclosure: string;
    honorDnc: boolean;

    createdAt: Date;
    updatedAt: Date;
}

const CampaignSchema = new Schema<ICampaign>({
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
    agentId: { type: Schema.Types.ObjectId, ref: 'Agent', required: true, index: true },
    name: { type: String, required: true },
    description: { type: String, default: '' },
    status: {
        type: String,
        enum: ['draft', 'running', 'paused', 'completed', 'stopped', 'scheduled'],
        default: 'draft',
    },
    creationMethod: {
        type: String,
        enum: ['ai', 'template', 'manual'],
        default: 'manual',
    },
    templateId: { type: String, default: '' },
    scheduledStartAt: { type: Date, default: null },
    callerIdNumber: { type: String, default: '' },
    maxConcurrentCalls: { type: Number, default: 1, min: 1, max: 10 },
    retryAttempts: { type: Number, default: 2, min: 0, max: 5 },
    retryDelayMinutes: { type: Number, default: 60, min: 5 },
    totalContacts: { type: Number, default: 0 },
    stats: {
        pending: { type: Number, default: 0 },
        calling: { type: Number, default: 0 },
        interested: { type: Number, default: 0 },
        notInterested: { type: Number, default: 0 },
        noAnswer: { type: Number, default: 0 },
        voicemail: { type: Number, default: 0 },
        failed: { type: Number, default: 0 },
        callback: { type: Number, default: 0 },
        dnc: { type: Number, default: 0 },
        wrongNumber: { type: Number, default: 0 },
        totalCallDurationSec: { type: Number, default: 0 },
        connectedCalls: { type: Number, default: 0 },
    },

    goal: {
        type: String,
        enum: ['book_meeting', 'qualify_lead', 'transfer_to_human', 'nurture', 'sell_direct'],
        default: 'qualify_lead',
    },
    offer: { type: String, default: '' },
    valueProps: { type: [String], default: [] },
    targetPersona: { type: String, default: '' },
    painPoints: { type: [String], default: [] },

    openingScript: { type: String, default: '' },
    qualifyingQuestions: {
        type: [String],
        default: [
            'What challenges are you currently facing in this area?',
            'Who typically makes decisions about this at your company?',
            'Do you have a budget allocated for solving this?',
            'When are you looking to address this?',
        ],
    },
    objectionHandlers: {
        type: [
            {
                _id: false,
                objection: { type: String, required: true },
                response: { type: String, required: true },
            },
        ],
        default: [
            { objection: "I'm not interested", response: "I completely understand. Many of our best clients felt the same way before seeing how {offer} saved them significant time. Could I ask what your biggest challenge is right now?" },
            { objection: "I'm too busy right now", response: "I appreciate that - I'll be brief. I'm calling because {valueProp}. Would a 10-minute conversation later this week make sense?" },
            { objection: "Just send me an email", response: "Happy to do that. So I send you the most relevant information, could I ask one quick question about your current setup?" },
            { objection: "We already have a solution", response: "That's great to hear. Out of curiosity, what do you like most about it - and is there anything you wish it did better?" },
            { objection: "How did you get my number?", response: "Good question. You showed up in our research as someone who may benefit from {offer}. If this isn't relevant, I'm happy to remove you from our list." },
        ],
    },

    callingHours: {
        startHour: { type: Number, default: 9, min: 0, max: 23 },
        endHour: { type: Number, default: 18, min: 0, max: 24 },
        daysOfWeek: { type: [Number], default: [1, 2, 3, 4, 5] },
        timezoneOffsetMinutes: { type: Number, default: 0 },
    },

    contactFilters: {
        _id: false,
        tags: { type: [String], default: [] },
        minLeadScore: { type: Number, default: null },
        maxLeadScore: { type: Number, default: null },
        cities: { type: [String], default: [] },
        companies: { type: [String], default: [] },
        statuses: { type: [String], default: [] },
    },

    abTest: {
        _id: false,
        enabled: { type: Boolean, default: false },
        variantBScript: { type: String, default: '' },
        variantBStats: {
            _id: false,
            interested: { type: Number, default: 0 },
            notInterested: { type: Number, default: 0 },
            noAnswer: { type: Number, default: 0 },
            voicemail: { type: Number, default: 0 },
            connectedCalls: { type: Number, default: 0 },
        },
    },

    recordingEnabled: { type: Boolean, default: false },
    consentDisclosure: {
        type: String,
        default: '',
    },
    honorDnc: { type: Boolean, default: true },

    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now },
});

CampaignSchema.pre('save', function () {
    this.updatedAt = new Date();
});

CampaignSchema.index({ tenantId: 1, status: 1 });

export const Campaign = mongoose.model<ICampaign>('Campaign', CampaignSchema);
