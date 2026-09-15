import mongoose, { Document, Schema } from 'mongoose';

export interface IInvite extends Document {
    tenantId: mongoose.Types.ObjectId;
    email: string;
    tokenHash: string;
    expiresAt: Date;
    invitedBy?: mongoose.Types.ObjectId;
    consumedAt?: Date | null;
    revokedAt?: Date | null;
    createdAt: Date;
}

const InviteSchema = new Schema<IInvite>({
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
    email: { type: String, required: true, lowercase: true, trim: true },
    tokenHash: { type: String, required: true, unique: true },
    expiresAt: { type: Date, required: true },
    invitedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    consumedAt: { type: Date, default: null },
    revokedAt: { type: Date, default: null },
    createdAt: { type: Date, default: Date.now },
});

InviteSchema.index({ tenantId: 1, email: 1 });
InviteSchema.index({ expiresAt: 1 });

export const Invite = mongoose.model<IInvite>('Invite', InviteSchema);
