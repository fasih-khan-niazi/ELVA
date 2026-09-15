import mongoose, { Document, Schema } from 'mongoose';

export type OutboundContactStatus =
    | 'pending'
    | 'calling'
    | 'interested'
    | 'not_interested'
    | 'no_answer'
    | 'voicemail'
    | 'failed'
    | 'callback'
    | 'dnc'
    | 'wrong_number';

/**
 * Fine-grained disposition code. Richer than `status` - used for call-center
 * style reporting. `status` drives the dialer state machine; `disposition`
 * records the final outcome of the conversation.
 */
export type CallDisposition =
    | 'no_contact'            // never reached
    | 'voicemail_dropped'     // left voicemail
    | 'voicemail_no_drop'     // detected but did not leave message
    | 'gatekeeper'            // receptionist, not decision maker
    | 'wrong_number'          // person said wrong number
    | 'dnc_requested'         // contact asked to be removed
    | 'not_interested'        // declined after pitch
    | 'objection_unresolved'  // pushed back, we could not resolve
    | 'callback_requested'    // contact wants us to call back
    | 'qualified_interest'    // BANT qualified, lead created
    | 'meeting_booked'        // explicit appointment set
    | 'transferred'           // warm transfer completed
    | 'hung_up'               // caller hung up mid-call
    | 'technical_failure';    // AI or network error

export interface IBantScore {
    budget: number;      // 0-5
    authority: number;   // 0-5
    need: number;        // 0-5
    timeline: number;    // 0-5
}

export interface IOutboundContact extends Document {
    campaignId: mongoose.Types.ObjectId;
    tenantId: mongoose.Types.ObjectId;
    agentId: mongoose.Types.ObjectId;
    phone: string;
    name: string;
    email: string;
    company: string;
    title: string;
    timezoneOffsetMinutes?: number;
    customFields: Record<string, string>;

    /** A/B script arm assigned when the contact is dialed (stable per contact). */
    abVariant: 'A' | 'B';

    status: OutboundContactStatus;
    disposition?: CallDisposition;
    attemptCount: number;
    lastAttemptAt?: Date;
    callSid?: string;
    callDurationSec?: number;

    aiSummary?: string;         // short call summary
    leadScore?: number;         // 0-100 composite score
    bant?: IBantScore;
    tags: string[];

    callbackAt?: Date;          // scheduled callback time
    callbackReason?: string;    // why they asked to be called back
    dnc: boolean;               // explicit do-not-call flag
    notes?: string;             // operator notes

    linkedLeadId?: mongoose.Types.ObjectId;
    createdAt: Date;
    updatedAt: Date;
}

const OutboundContactSchema = new Schema<IOutboundContact>({
    campaignId: { type: Schema.Types.ObjectId, ref: 'Campaign', required: true, index: true },
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
    agentId: { type: Schema.Types.ObjectId, ref: 'Agent', required: true },
    phone: { type: String, required: true, index: true },
    name: { type: String, default: '' },
    email: { type: String, default: '' },
    company: { type: String, default: '' },
    title: { type: String, default: '' },
    timezoneOffsetMinutes: { type: Number },
    customFields: { type: Schema.Types.Mixed, default: {} },

    abVariant: { type: String, enum: ['A', 'B'], default: 'A', index: true },

    status: {
        type: String,
        enum: [
            'pending', 'calling', 'interested', 'not_interested',
            'no_answer', 'voicemail', 'failed',
            'callback', 'dnc', 'wrong_number',
        ],
        default: 'pending',
    },
    disposition: {
        type: String,
        enum: [
            'no_contact', 'voicemail_dropped', 'voicemail_no_drop',
            'gatekeeper', 'wrong_number', 'dnc_requested',
            'not_interested', 'objection_unresolved', 'callback_requested',
            'qualified_interest', 'meeting_booked', 'transferred',
            'hung_up', 'technical_failure',
        ],
    },
    attemptCount: { type: Number, default: 0 },
    lastAttemptAt: { type: Date },
    callSid: { type: String, index: true, sparse: true },
    callDurationSec: { type: Number },

    aiSummary: { type: String },
    leadScore: { type: Number, min: 0, max: 100 },
    bant: {
        budget: { type: Number, min: 0, max: 5, default: 0 },
        authority: { type: Number, min: 0, max: 5, default: 0 },
        need: { type: Number, min: 0, max: 5, default: 0 },
        timeline: { type: Number, min: 0, max: 5, default: 0 },
    },
    tags: { type: [String], default: [] },

    callbackAt: { type: Date, index: true, sparse: true },
    callbackReason: { type: String },
    dnc: { type: Boolean, default: false, index: true },
    notes: { type: String },

    linkedLeadId: { type: Schema.Types.ObjectId, ref: 'Lead' },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now },
});

OutboundContactSchema.pre('save', function () {
    this.updatedAt = new Date();
});

OutboundContactSchema.index({ campaignId: 1, status: 1 });
OutboundContactSchema.index({ tenantId: 1, status: 1 });
OutboundContactSchema.index({ campaignId: 1, leadScore: -1 });
OutboundContactSchema.index({ tenantId: 1, dnc: 1, phone: 1 });

export const OutboundContact = mongoose.model<IOutboundContact>(
    'OutboundContact',
    OutboundContactSchema,
);
