import mongoose, { Document, Schema } from 'mongoose';

export interface ISlackWorkspace extends Document {
    tenantId: mongoose.Types.ObjectId;
    workspaceId: string;
    workspaceName: string;
    workspaceIcon?: string;
    botToken: string;
    botUserId: string;
    scope: string;
    installedAt: Date;
    updatedAt: Date;
}

const SlackWorkspaceSchema = new Schema<ISlackWorkspace>({
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
    workspaceId: { type: String, required: true },
    workspaceName: { type: String, required: true },
    workspaceIcon: String,
    botToken: { type: String, required: true },
    botUserId: { type: String, required: true },
    scope: { type: String, required: true },
    installedAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now },
});

SlackWorkspaceSchema.index({ tenantId: 1, workspaceId: 1 }, { unique: true });
SlackWorkspaceSchema.pre('save', function () { this.updatedAt = new Date(); });

export const SlackWorkspace = mongoose.model<ISlackWorkspace>('SlackWorkspace', SlackWorkspaceSchema);
