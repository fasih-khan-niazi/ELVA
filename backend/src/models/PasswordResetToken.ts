import mongoose, { Document, Schema } from 'mongoose';

export interface IPasswordResetToken extends Document {
    userId: mongoose.Types.ObjectId;
    tokenHash: string;
    expiresAt: Date;
    usedAt: Date | null;
    createdAt: Date;
}

const PasswordResetTokenSchema = new Schema<IPasswordResetToken>({
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    tokenHash: { type: String, required: true, unique: true },
    expiresAt: { type: Date, required: true },
    usedAt: { type: Date, default: null },
    createdAt: { type: Date, default: Date.now },
});

// MongoDB TTL index automatically removes expired tokens after 24 h beyond expiry.
PasswordResetTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 86_400 });

export const PasswordResetToken = mongoose.model<IPasswordResetToken>(
    'PasswordResetToken',
    PasswordResetTokenSchema,
);
