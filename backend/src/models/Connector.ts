import mongoose, { Document, Schema } from 'mongoose';

export interface IConnectorCondition {
    field: string;
    operator: 'gt' | 'lt' | 'eq' | 'gte' | 'lte' | 'contains';
    value: string | number;
}

export interface IConnector extends Document {
    tenantId: mongoose.Types.ObjectId;
    agentId: mongoose.Types.ObjectId;
    name: string;
    status: 'active' | 'paused' | 'failed';
    trigger: {
        source: 'orders' | 'leads' | 'calls';
        event: 'created' | 'status_changed';
        conditions: IConnectorCondition[];
    };
    destination: {
        type: 'slack' | 'email' | 'webhook' | 'whatsapp';
        slack?: {
            webhookUrl?: string;
            channelLabel?: string;
            workspaceId?: string;
            channelId?: string;
            channelName?: string;
            twoWayEnabled?: boolean;
        };
        email?: { recipients: string[]; fromName?: string };
        webhook?: { url: string; secret?: string; headers?: Map<string, string> };
        whatsapp?: { phoneNumberId: string; accessToken: string; recipientPhone: string };
    };
    deliveryMode: 'instant' | 'hourly_digest' | 'daily_digest';
    templateId?: mongoose.Types.ObjectId;
    customTemplate?: { subject?: string; body: string };
    stats: { sent: number; failed: number; lastFiredAt?: Date };
    failureAlert: boolean;
    createdAt: Date;
    updatedAt: Date;
}

const ConnectorSchema = new Schema<IConnector>({
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
    agentId: { type: Schema.Types.ObjectId, ref: 'Agent', required: true, index: true },
    name: { type: String, required: true },
    status: { type: String, enum: ['active', 'paused', 'failed'], default: 'active' },
    trigger: {
        source: { type: String, enum: ['orders', 'leads', 'calls'], required: true },
        event: { type: String, enum: ['created', 'status_changed'], required: true },
        conditions: [{
            field: { type: String, required: true },
            operator: { type: String, enum: ['gt', 'lt', 'eq', 'gte', 'lte', 'contains'], required: true },
            value: { type: Schema.Types.Mixed, required: true },
            _id: false,
        }],
    },
    destination: {
        type: { type: String, enum: ['slack', 'email', 'webhook', 'whatsapp'], required: true },
        slack: {
            webhookUrl: String,
            channelLabel: String,
            workspaceId: String,
            channelId: String,
            channelName: String,
            twoWayEnabled: { type: Boolean, default: false },
        },
        email: { recipients: [String], fromName: String },
        webhook: { url: String, secret: String, headers: { type: Map, of: String } },
        whatsapp: { phoneNumberId: String, accessToken: String, recipientPhone: String },
    },
    deliveryMode: { type: String, enum: ['instant', 'hourly_digest', 'daily_digest'], default: 'instant' },
    templateId: { type: Schema.Types.ObjectId, ref: 'ConnectorTemplate' },
    customTemplate: { subject: String, body: String },
    stats: {
        sent: { type: Number, default: 0 },
        failed: { type: Number, default: 0 },
        lastFiredAt: Date,
    },
    failureAlert: { type: Boolean, default: false },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now },
});

ConnectorSchema.pre('save', function () { this.updatedAt = new Date(); });
ConnectorSchema.index({ tenantId: 1, agentId: 1 });

export const Connector = mongoose.model<IConnector>('Connector', ConnectorSchema);

// --- Connector Template ---
export interface IConnectorTemplate extends Document {
    name: string;
    description: string;
    source: 'orders' | 'leads' | 'calls' | 'digest';
    event: string;
    channel: 'slack' | 'email' | 'webhook' | 'whatsapp' | 'any';
    subject?: string;
    body: string;
    isBuiltIn: boolean;
    previewData: Record<string, any>;
    createdAt: Date;
}

const ConnectorTemplateSchema = new Schema<IConnectorTemplate>({
    name: { type: String, required: true },
    description: { type: String, default: '' },
    source: { type: String, enum: ['orders', 'leads', 'calls', 'digest'], required: true },
    event: { type: String, required: true },
    channel: { type: String, enum: ['slack', 'email', 'webhook', 'whatsapp', 'any'], required: true },
    subject: String,
    body: { type: String, required: true },
    isBuiltIn: { type: Boolean, default: false },
    previewData: { type: Schema.Types.Mixed, default: {} },
    createdAt: { type: Date, default: Date.now },
});

export const ConnectorTemplate = mongoose.model<IConnectorTemplate>('ConnectorTemplate', ConnectorTemplateSchema);

// --- Connector Log ---
export interface IConnectorLog extends Document {
    connectorId: mongoose.Types.ObjectId;
    tenantId: mongoose.Types.ObjectId;
    agentId: mongoose.Types.ObjectId;
    triggeredAt: Date;
    deliveredAt?: Date;
    status: 'delivered' | 'failed' | 'retrying' | 'queued';
    attempt: number;
    errorMessage?: string;
    eventType: string;
    payload: Record<string, any>;
    createdAt: Date;
}

const ConnectorLogSchema = new Schema<IConnectorLog>({
    connectorId: { type: Schema.Types.ObjectId, ref: 'Connector', required: true, index: true },
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
    agentId: { type: Schema.Types.ObjectId, ref: 'Agent', required: true },
    triggeredAt: { type: Date, default: Date.now },
    deliveredAt: Date,
    status: { type: String, enum: ['delivered', 'failed', 'retrying', 'queued'], default: 'retrying' },
    attempt: { type: Number, default: 1 },
    errorMessage: String,
    eventType: { type: String, required: true },
    payload: { type: Schema.Types.Mixed, default: {} },
    createdAt: { type: Date, default: Date.now },
});

ConnectorLogSchema.index({ connectorId: 1, createdAt: -1 });

export const ConnectorLog = mongoose.model<IConnectorLog>('ConnectorLog', ConnectorLogSchema);
