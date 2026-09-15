import mongoose, { Document, Schema } from 'mongoose';

export interface IEmailVerificationToken extends Document {
    userId: mongoose.Types.ObjectId;
    tokenHash: string;
    expiresAt: Date;
    usedAt: Date | null;
    createdAt: Date;
}

const EmailVerificationTokenSchema = new Schema<IEmailVerificationToken>({
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    tokenHash: { type: String, required: true, unique: true },
    expiresAt: { type: Date, required: true },
    usedAt: { type: Date, default: null },
    createdAt: { type: Date, default: Date.now },
});

// TTL index automatically removes tokens 24 h after they expire.
EmailVerificationTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 86_400 });

export const EmailVerificationToken = mongoose.model<IEmailVerificationToken>(
    'EmailVerificationToken',
    EmailVerificationTokenSchema,
);
