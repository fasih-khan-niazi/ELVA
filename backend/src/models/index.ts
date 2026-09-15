import mongoose, { Document, Schema } from 'mongoose';

// --- Subscription Plan Limits ---
export const PLAN_LIMITS = {
    free: {
        maxAgents: 1,
        maxDocuments: 3,
        /** Monthly cap on knowledge summary text (chars), separate from PDF upload quota. */
        maxKnowledgeSummaryChars: 2_000,
        maxMessagesPerMonth: 100,
        maxDocumentSizeMB: 5,
        voiceEnabled: false,
        analyticsEnabled: false,
        connectorsEnabled: false,
        maxConnectors: 0,
        prioritySupport: false,
        /** Workspace seats (admin + teammates). Solo = 1. */
        maxSeats: 1,
        price: 0
    },
    starter: {
        maxAgents: 3,
        maxDocuments: 10,
        maxKnowledgeSummaryChars: 8_000,
        maxMessagesPerMonth: 1000,
        maxDocumentSizeMB: 10,
        voiceEnabled: false,
        analyticsEnabled: true,
        connectorsEnabled: true,
        maxConnectors: 3,
        prioritySupport: false,
        /** Admin + teammates (total workspace members). */
        maxSeats: 3,
        price: 20
    },
    pro: {
        maxAgents: 10,
        maxDocuments: 50,
        maxKnowledgeSummaryChars: 20_000,
        maxMessagesPerMonth: 10000,
        maxDocumentSizeMB: 25,
        voiceEnabled: true,
        analyticsEnabled: true,
        connectorsEnabled: true,
        maxConnectors: 10,
        prioritySupport: false,
        maxSeats: 5,
        price: 100
    },
    enterprise: {
        maxAgents: 50,
        maxDocuments: -1,
        maxKnowledgeSummaryChars: 100_000,
        maxMessagesPerMonth: -1,
        maxDocumentSizeMB: 100,
        voiceEnabled: true,
        analyticsEnabled: true,
        connectorsEnabled: true,
        maxConnectors: -1, // unlimited
        prioritySupport: true,
        /** Unlimited; sales may set a contracted cap separately. */
        maxSeats: -1,
        price: 750
    }
};

export type PlanType = keyof typeof PLAN_LIMITS;

// --- Subscription Model ---
export interface ISubscription extends Document {
    tenantId: mongoose.Types.ObjectId;
    plan: PlanType;
    status: 'active' | 'canceled' | 'past_due' | 'trialing' | 'incomplete';
    stripeCustomerId?: string;
    stripeSubscriptionId?: string;
    stripePriceId?: string;
    currentPeriodStart: Date;
    currentPeriodEnd: Date;
    cancelAtPeriodEnd: boolean;
    messagesUsedThisMonth: number;
    lastMessageCountReset: Date;
    documentsUploadedThisMonth: number;
    lastDocumentCountReset: Date;
    createdAt: Date;
    updatedAt: Date;
}

const SubscriptionSchema = new Schema<ISubscription>({
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true, unique: true },
    plan: { type: String, enum: ['free', 'starter', 'pro', 'enterprise'], default: 'free' },
    status: { type: String, enum: ['active', 'canceled', 'past_due', 'trialing', 'incomplete'], default: 'active' },
    stripeCustomerId: { type: String },
    stripeSubscriptionId: { type: String },
    stripePriceId: { type: String },
    currentPeriodStart: { type: Date, default: Date.now },
    currentPeriodEnd: { type: Date, default: () => new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) },
    cancelAtPeriodEnd: { type: Boolean, default: false },
    messagesUsedThisMonth: { type: Number, default: 0 },
    lastMessageCountReset: { type: Date, default: Date.now },
    documentsUploadedThisMonth: { type: Number, default: 0 },
    lastDocumentCountReset: { type: Date, default: Date.now },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
});

SubscriptionSchema.pre('save', function() {
    this.updatedAt = new Date();
});

export const Subscription = mongoose.model<ISubscription>('Subscription', SubscriptionSchema);

// --- Tenant Model ---
export interface ITenant extends Document {
    name: string;
    plan: PlanType;
    stripeCustomerId?: string;
    registrationType?: 'solo' | 'company';
    /** Phase 2+: optional enforced domain suffix e.g. "acme.com" for teammate invites */
    allowedEmailDomain?: string;
    /** ISO code for how monetary totals are shown tenant-wide (workspace admins set via Global analytics / PATCH workspace). */
    reportingCurrency: string;
    /** ISO code for how raw order totals in the database are interpreted (catalog/agent pricing lives in this unit). */
    ledgerCurrency: string;
    /** When set and in the future, tenant members cannot sign in until it passes (platform-managed). */
    accessSuspendedUntil?: Date;
    /** ELVA Ops JWT exploration workspace; hidden from platform aggregates and workspace table. */
    platformExplorationSandbox?: boolean;
    createdAt: Date;
}

const TenantSchema = new Schema<ITenant>({
    name: { type: String, required: true },
    plan: { type: String, enum: ['free', 'starter', 'pro', 'enterprise'], default: 'free' },
    stripeCustomerId: { type: String },
    registrationType: { type: String, enum: ['solo', 'company'] },
    allowedEmailDomain: { type: String, trim: true, lowercase: true },
    reportingCurrency: {
        type: String,
        default: 'PKR',
        uppercase: true,
        trim: true,
        enum: ['USD', 'PKR', 'EUR', 'GBP', 'INR', 'AED', 'SAR', 'CAD', 'AUD'],
    },
    ledgerCurrency: {
        type: String,
        default: 'PKR',
        uppercase: true,
        trim: true,
        enum: ['USD', 'PKR', 'EUR', 'GBP', 'INR', 'AED', 'SAR', 'CAD', 'AUD'],
    },
    accessSuspendedUntil: { type: Date },
    platformExplorationSandbox: { type: Boolean, default: false },
    createdAt: { type: Date, default: Date.now },
});

export const Tenant = mongoose.model<ITenant>('Tenant', TenantSchema);

// --- User Model ---
export interface IUser extends Document {
    email: string;
    passwordHash: string;
    /** platform_admin = ELVA operators (no tenant). business_admin = org owner/admin. member = teammate. */
    role: 'platform_admin' | 'business_admin' | 'member';
    tenantId?: mongoose.Types.ObjectId;
    googleId?: string;
    profilePicture?: string;
    name?: string;
    authProvider?: 'local' | 'google';
    accountStatus: 'active' | 'suspended';
    /** true = email confirmed. Google users are always verified. Invite-accepted users are verified on acceptance. */
    emailVerified: boolean;
    termsAcceptedAt?: Date;
    termsVersionAccepted?: string;
    /** Reused sandbox `business_admin` user for ELVA Ops exploration workspace (platform_admin only). */
    sandboxWorkspaceUserId?: mongoose.Types.ObjectId;
    createdAt: Date;
}

const UserSchema = new Schema<IUser>({
    email: { type: String, required: true, unique: true },
    passwordHash: { type: String, default: '' },
    role: {
        type: String,
        enum: ['platform_admin', 'business_admin', 'member'],
        default: 'business_admin',
    },
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant' },
    googleId: { type: String },
    profilePicture: { type: String },
    name: { type: String },
    authProvider: { type: String, enum: ['local', 'google'], default: 'local' },
    accountStatus: { type: String, enum: ['active', 'suspended'], default: 'active' },
    emailVerified: { type: Boolean, default: true },
    termsAcceptedAt: { type: Date },
    termsVersionAccepted: { type: String },
    sandboxWorkspaceUserId: { type: Schema.Types.ObjectId, ref: 'User' },
    createdAt: { type: Date, default: Date.now },
});

export const User = mongoose.model<IUser>('User', UserSchema);

// --- Agent Model ---
export interface IAgent extends Document {
    name: string;
    businessName: string;
    tenantId: mongoose.Types.ObjectId;
    type: 'chat' | 'voice';
    voiceId: string;
    prompt: string;
    tone: string;
    language: string;
    currency: string;
    firstMessage: string;
    isActive: boolean;
    persona: {
        name: string;
        summary: string;
        speakingStyle: string;
    };
    objectives: string[];
    capabilities: string[];
    guardrails: string;
    memoryConfig: {
        shortTermWindow: number;
        longTermEnabled: boolean;
    };
    responseConfig: {
        temperature: number;
        maxTurns: number;
        fallbackMessage: string;
        /** Optional: Twilio gather silence timeout seconds (2–12), default from env / platform. */
        gatherTimeoutSec?: number;
    };
    // Voice-specific configuration
    phoneNumber: string;
    sttProvider: 'twilio' | 'google';
    ttsProvider: 'twilio' | 'google' | 'elevenlabs';
    ttsVoice: string;
    ttsVoiceProvider: 'twilio' | 'elevenlabs';
    // Outbound calling
    callDirection: 'inbound' | 'outbound';
    outboundCallerId: string;
    transferNumber: string;
    voicemailDropUrl: string;
    /** Free-form knowledge the tenant edits; embedded in RAG alongside PDF chunks. */
    knowledgeSummary: string;
    /** Public website embed (chat agents only). */
    chatEmbedPublished: boolean;
    /** Unique public id for embed (lookup). */
    chatEmbedKeyId?: string;
    /** bcrypt hash of embed secret; never returned to clients. */
    chatEmbedSecretHash?: string;
    /** Allowed parent origins for browser embed, e.g. https://store.com — empty = any origin (see docs). */
    chatEmbedAllowedOrigins: string[];
    createdAt: Date;
}

const AgentSchema = new Schema<IAgent>({
    name: { type: String, required: true },
    businessName: { type: String, default: '' },
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true },
    type: { type: String, enum: ['chat', 'voice'], default: 'chat' },
    voiceId: { type: String, default: 'default' },
    prompt: { type: String, default: '' },
    tone: { type: String, default: 'professional' },
    language: { type: String, default: 'en' },
    currency: { type: String, default: 'USD' },
    firstMessage: { type: String, default: '' },
    isActive: { type: Boolean, default: true },
    persona: {
        name: { type: String, default: '' },
        summary: { type: String, default: '' },
        speakingStyle: { type: String, default: '' }
    },
    objectives: { type: [String], default: [] },
    capabilities: { type: [String], default: [] },
    guardrails: { type: String, default: '' },
    memoryConfig: {
        // 6 dialogue turns (12 messages) is the production sweet-spot:
        // enough context for follow-ups without bloating the prompt for voice.
        shortTermWindow: { type: Number, default: 6 },
        longTermEnabled: { type: Boolean, default: false }
    },
    responseConfig: {
        temperature: { type: Number, default: 0.35 },
        // 30 lets a real conversation (lead-qual + order + small-talk) finish
        // without hitting the cap. Old default of 4 was effectively a hangup.
        maxTurns: { type: Number, default: 30 },
        fallbackMessage: {
            type: String,
            default: 'I am going to connect you with one of my teammates for more help.'
        },
        gatherTimeoutSec: { type: Number, required: false },
    },
    // Voice-specific configuration
    phoneNumber: { type: String, default: '' },
    sttProvider: { type: String, enum: ['twilio', 'google'], default: 'twilio' },
    ttsProvider: { type: String, enum: ['twilio', 'google', 'elevenlabs'], default: 'twilio' },
    ttsVoice: { type: String, default: 'en-US-Neural2-F' },
    ttsVoiceProvider: { type: String, enum: ['twilio', 'elevenlabs'], default: 'twilio' },
    // Outbound calling
    callDirection: { type: String, enum: ['inbound', 'outbound'], default: 'inbound' },
    outboundCallerId: { type: String, default: '' },
    transferNumber: { type: String, default: '' },
    voicemailDropUrl: { type: String, default: '' },
    knowledgeSummary: { type: String, default: '' },
    chatEmbedPublished: { type: Boolean, default: false },
    chatEmbedKeyId: { type: String, sparse: true, unique: true },
    chatEmbedSecretHash: { type: String, select: false },
    chatEmbedAllowedOrigins: { type: [String], default: [] },
    createdAt: { type: Date, default: Date.now },
});

export const Agent = mongoose.model<IAgent>('Agent', AgentSchema);

// --- Document Model ---
export interface IDocument extends Document {
    tenantId: mongoose.Types.ObjectId;
    agentId?: mongoose.Types.ObjectId;
    filename: string;
    filePath: string;
    contentType: string;
    fileSize: number;
    createdAt: Date;
}

const DocumentSchema = new Schema<IDocument>({
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true },
    agentId: { type: Schema.Types.ObjectId, ref: 'Agent', required: false },
    filename: { type: String, required: true },
    filePath: { type: String, required: true },
    contentType: { type: String, required: true },
    fileSize: { type: Number, required: true },
    createdAt: { type: Date, default: Date.now },
});

export const DocumentModel = mongoose.model<IDocument>('Document', DocumentSchema);

// --- Catalog Item Model ---
export interface ICatalogItem extends Document {
    agentId: mongoose.Types.ObjectId;
    tenantId: mongoose.Types.ObjectId;
    name: string;
    description: string;
    price: number;
    category: string;
    imageUrl?: string;
    available: boolean;
    options?: Array<{
        name: string;
        choices: string[];
    }>;
    createdAt: Date;
    updatedAt: Date;
}

const CatalogItemSchema = new Schema<ICatalogItem>({
    agentId: { type: Schema.Types.ObjectId, ref: 'Agent', required: true, index: true },
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
    name: { type: String, required: true },
    description: { type: String, default: '' },
    price: { type: Number, required: true },
    category: { type: String, default: 'General' },
    imageUrl: { type: String },
    available: { type: Boolean, default: true },
    options: [{
        name: { type: String },
        choices: [{ type: String }]
    }],
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now },
});

CatalogItemSchema.pre('save', function() {
    this.updatedAt = new Date();
});

export const CatalogItem = mongoose.model<ICatalogItem>('CatalogItem', CatalogItemSchema);

// --- Order Model ---
export interface IOrderItem {
    catalogItemId?: mongoose.Types.ObjectId;
    name: string;
    price: number;
    quantity: number;
    options?: Array<{ name: string; choice: string }>;
    notes?: string;
}

export interface IOrder extends Document {
    agentId: mongoose.Types.ObjectId;
    tenantId: mongoose.Types.ObjectId;
    sessionId: string;
    channel: 'chat' | 'voice';
    /** ISO currency code the order amounts are denominated in (matches agent.currency at order time). */
    currency: string;
    status: 'pending' | 'confirmed' | 'preparing' | 'ready' | 'completed' | 'cancelled';
    items: IOrderItem[];
    subtotal: number;
    tax: number;
    total: number;
    orderType?: 'delivery' | 'takeaway' | 'dine-in';
    paymentMethod?: string;
    customerName?: string;
    customerPhone?: string;
    customerEmail?: string;
    customerAddress?: string;
    notes?: string;
    createdAt: Date;
    updatedAt: Date;
}

const OrderItemSchema = new Schema({
    catalogItemId: { type: Schema.Types.ObjectId, ref: 'CatalogItem' },
    name: { type: String, required: true },
    price: { type: Number, required: true },
    quantity: { type: Number, required: true, default: 1 },
    options: [{
        name: { type: String },
        choice: { type: String }
    }],
    notes: { type: String }
}, { _id: false });

const OrderSchema = new Schema<IOrder>({
    agentId: { type: Schema.Types.ObjectId, ref: 'Agent', required: true, index: true },
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
    sessionId: { type: String, required: true },
    channel: { type: String, enum: ['chat', 'voice'], default: 'chat' },
    status: {
        type: String,
        enum: ['pending', 'confirmed', 'preparing', 'ready', 'completed', 'cancelled'],
        default: 'pending'
    },
    currency: { type: String, default: 'PKR', uppercase: true, trim: true },
    items: [OrderItemSchema],
    subtotal: { type: Number, default: 0 },
    tax: { type: Number, default: 0 },
    total: { type: Number, default: 0 },
    orderType: { type: String, enum: ['delivery', 'takeaway', 'dine-in'] },
    paymentMethod: { type: String },
    customerName: { type: String },
    customerPhone: { type: String },
    customerEmail: { type: String },
    customerAddress: { type: String },
    notes: { type: String },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now },
});

OrderSchema.pre('save', function() {
    this.updatedAt = new Date();
    // Auto-calculate totals
    this.subtotal = this.items.reduce((sum, item) => sum + (item.price * item.quantity), 0);
    this.total = this.subtotal + (this.tax || 0);
});

OrderSchema.index({ agentId: 1, createdAt: -1 });
OrderSchema.index({ tenantId: 1, status: 1 });
// Covers analytics revenue aggregations: filter tenantId + status + sort/range by date.
OrderSchema.index({ tenantId: 1, status: 1, createdAt: -1 });
// Covers per-agent revenue rollups.
OrderSchema.index({ agentId: 1, status: 1, createdAt: -1 });

export const Order = mongoose.model<IOrder>('Order', OrderSchema);

// --- Lead Model ---
export interface ILead extends Document {
    agentId: mongoose.Types.ObjectId;
    tenantId: mongoose.Types.ObjectId;
    sessionId: string;
    channel: 'chat' | 'voice';
    status: 'new' | 'contacted' | 'qualified' | 'converted' | 'lost';
    score: number; // 0-100
    name?: string;
    email?: string;
    phone?: string;
    company?: string;
    interest: string;
    notes?: string;
    source: 'auto' | 'manual' | 'outbound'; // auto = AI-detected, manual = user-created, outbound = from campaign
    campaignId?: mongoose.Types.ObjectId;
    tags: string[];
    lastActivity: Date;
    createdAt: Date;
    updatedAt: Date;
}

const LeadSchema = new Schema<ILead>({
    agentId: { type: Schema.Types.ObjectId, ref: 'Agent', required: true, index: true },
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
    sessionId: { type: String, required: true },
    channel: { type: String, enum: ['chat', 'voice'], default: 'chat' },
    status: {
        type: String,
        enum: ['new', 'contacted', 'qualified', 'converted', 'lost'],
        default: 'new'
    },
    score: { type: Number, default: 0, min: 0, max: 100 },
    name: { type: String },
    email: { type: String },
    phone: { type: String },
    company: { type: String },
    interest: { type: String, default: '' },
    notes: { type: String },
    source: { type: String, enum: ['auto', 'manual', 'outbound'], default: 'auto' },
    campaignId: { type: Schema.Types.ObjectId, ref: 'Campaign' },
    tags: [{ type: String }],
    lastActivity: { type: Date, default: Date.now },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now },
});

LeadSchema.pre('save', function() {
    this.updatedAt = new Date();
    // Auto-calculate score based on available info
    if (
        this.isModified('name') || this.isModified('email') ||
        this.isModified('phone') || this.isModified('interest') ||
        this.isModified('company') || this.isModified('tags')
    ) {
        let score = 10; // base score for having a lead
        if (this.name) score += 20;
        if (this.email) score += 25;
        if (this.phone) score += 20;
        if (this.company) score += 10;
        if (this.interest && this.interest.length > 10) score += 15;
        // Order placer = high-intent lead, guarantee minimum score of 70
        if (this.tags?.includes('order_placed')) score = Math.max(score, 70);
        this.score = Math.min(score, 100);
    }
});

LeadSchema.index({ agentId: 1, createdAt: -1 });
LeadSchema.index({ tenantId: 1, status: 1 });
LeadSchema.index({ email: 1, tenantId: 1 });

export const Lead = mongoose.model<ILead>('Lead', LeadSchema);

// ─── ChatSession ──────────────────────────────────────────────────────────

export interface IChatMessage {
    role: 'user' | 'assistant';
    content: string;
    timestamp: Date;
    // End-to-end latency in milliseconds (assistant turns only).
    // Captured in chatController so analytics and the UI badge use the
    // exact same number - no client-side guesswork.
    latencyMs?: number;
}

export interface IChatSession extends mongoose.Document {
    sessionId: string;
    agentId: mongoose.Types.ObjectId;
    tenantId: mongoose.Types.ObjectId;
    /** Where the session started: ELVA dashboard, website widget, or public HTTP API. */
    source: 'dashboard' | 'embed' | 'api';
    title: string;
    messages: IChatMessage[];
    messageCount: number;
    createdAt: Date;
    updatedAt: Date;
}

const ChatMessageSchema = new mongoose.Schema<IChatMessage>({
    role: { type: String, enum: ['user', 'assistant'], required: true },
    content: { type: String, required: true },
    timestamp: { type: Date, default: Date.now },
    latencyMs: { type: Number },
}, { _id: false });

const ChatSessionSchema = new mongoose.Schema<IChatSession>({
    sessionId: { type: String, required: true, unique: true },
    agentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Agent', required: true },
    tenantId: { type: mongoose.Schema.Types.ObjectId, required: true },
    source: {
        type: String,
        enum: ['dashboard', 'embed', 'api'],
        default: 'dashboard',
    },
    title: { type: String, default: 'New Conversation' },
    messages: { type: [ChatMessageSchema], default: [] },
    messageCount: { type: Number, default: 0 },
}, { timestamps: true });

ChatSessionSchema.index({ agentId: 1, updatedAt: -1 });
ChatSessionSchema.index({ tenantId: 1, updatedAt: -1 });

export const ChatSession = mongoose.model<IChatSession>('ChatSession', ChatSessionSchema);

// --- Voice preview samples (cached Azure TTS clips for agent voice picker) ---
export interface IVoicePreviewSample extends Document {
    voiceId: string;
    label: string;
    previewText: string;
    audioBase64: string;
    mimeType: string;
    byteLength: number;
    sampleVersion?: number;
    updatedAt: Date;
}

const VoicePreviewSampleSchema = new Schema<IVoicePreviewSample>({
    voiceId: { type: String, required: true, unique: true, index: true },
    label: { type: String, required: true },
    previewText: { type: String, required: true },
    audioBase64: { type: String, required: true },
    mimeType: { type: String, default: 'audio/mpeg' },
    byteLength: { type: Number, default: 0 },
    sampleVersion: { type: Number, default: 0 },
    updatedAt: { type: Date, default: Date.now },
});

export const VoicePreviewSample = mongoose.model<IVoicePreviewSample>(
    'VoicePreviewSample',
    VoicePreviewSampleSchema,
);
