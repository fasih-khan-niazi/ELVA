import mongoose, { Document, Schema } from 'mongoose';

export interface IUserSession extends Document {
    userId: mongoose.Types.ObjectId;
    sessionId: string;
    /** User-Agent string trimmed to 512 chars. */
    userAgent: string;
    /** IP address at login time. */
    ipAddress: string;
    /** Rough device/browser label derived from User-Agent for display. */
    deviceLabel: string;
    createdAt: Date;
    lastSeenAt: Date;
    /** When the underlying JWT expires. */
    expiresAt: Date;
    /** Manually revoked sessions are soft-deleted here. */
    revokedAt: Date | null;
}

const UserSessionSchema = new Schema<IUserSession>({
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    sessionId: { type: String, required: true, unique: true },
    userAgent: { type: String, default: '' },
    ipAddress: { type: String, default: '' },
    deviceLabel: { type: String, default: 'Unknown device' },
    lastSeenAt: { type: Date, default: Date.now },
    expiresAt: { type: Date, required: true },
    revokedAt: { type: Date, default: null },
    createdAt: { type: Date, default: Date.now },
});

// Auto-remove sessions 7 days after they expire.
UserSessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 7 * 86_400 });
UserSessionSchema.index({ userId: 1, revokedAt: 1 });

export const UserSession = mongoose.model<IUserSession>('UserSession', UserSessionSchema);
