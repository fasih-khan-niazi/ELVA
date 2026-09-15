import mongoose, { Document, Schema } from 'mongoose';

export type WorkspaceAuditAction =
    | 'auth.login'
    | 'auth.signup'
    | 'auth.logout'
    | 'auth.password_set'
    | 'agent.create'
    | 'agent.update'
    | 'agent.delete'
    | 'agent.chat_embed'
    | 'member.remove'
    | 'member.suspend'
    | 'member.resume'
    | 'member.join'
    | 'invite.send'
    | 'invite.revoke'
    | 'workspace.update'
    | 'workspace.invite_policy'
    | 'document.upload'
    | 'document.delete'
    | 'document.reingest'
    | 'knowledge.summary_update'
    | 'connector.create'
    | 'connector.update'
    | 'connector.delete'
    | 'profile.update'
    | 'profile.avatar_update'
    | 'subscription.select_free'
    | 'subscription.checkout_started';

export interface IWorkspaceAuditLog extends Document {
    tenantId: mongoose.Types.ObjectId;
    actorId: mongoose.Types.ObjectId;
    action: WorkspaceAuditAction;
    targetType?: string;
    targetId?: string;
    metadata?: Record<string, unknown>;
    ip?: string;
    userAgent?: string;
    createdAt: Date;
}

const WorkspaceAuditLogSchema = new Schema<IWorkspaceAuditLog>(
    {
        tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
        actorId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
        action: { type: String, required: true, index: true },
        targetType: { type: String },
        targetId: { type: String },
        metadata: { type: Schema.Types.Mixed },
        ip: { type: String },
        userAgent: { type: String },
    },
    { timestamps: { createdAt: true, updatedAt: false } },
);

WorkspaceAuditLogSchema.index({ tenantId: 1, createdAt: -1 });
WorkspaceAuditLogSchema.index({ tenantId: 1, actorId: 1, createdAt: -1 });

export const WorkspaceAuditLog = mongoose.model<IWorkspaceAuditLog>(
    'WorkspaceAuditLog',
    WorkspaceAuditLogSchema,
);
