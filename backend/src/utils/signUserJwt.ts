import jwt from 'jsonwebtoken';
import type { SignOptions } from 'jsonwebtoken';
import type { Types } from 'mongoose';
import crypto from 'crypto';
import { getJwtSecret } from '../config/jwtSecret';

export type JwtUserPayload = {
    userId: string;
    role: string;
    tenantId?: string;
    workspaceName?: string;
    /** Unique session identifier — used by the session-management feature. */
    sessionId?: string;
};

/** Default session length for workspace users; operators get a longer browser session. */
const DEFAULT_JWT_TTL = '1d';
const PLATFORM_OPERATOR_JWT_TTL = '7d';

/** Sign auth token; omit tenantId / workspaceName when absent (platform_admin). */
export function signAuthToken(fields: {
    userId: string | Types.ObjectId;
    role: string;
    tenantId?: Types.ObjectId | string | null;
    workspaceName?: string | null;
    /** Override default TTL (e.g. sandbox session). */
    expiresIn?: string;
    /** Pre-generated session ID. One is auto-generated if omitted. */
    sessionId?: string;
}): { token: string; sessionId: string } {
    const sessionId = fields.sessionId || crypto.randomBytes(16).toString('hex');
    const payload: JwtUserPayload = {
        userId: String(fields.userId),
        role: fields.role,
        sessionId,
    };
    if (fields.tenantId) {
        payload.tenantId = String(fields.tenantId);
    }
    if (fields.workspaceName) {
        payload.workspaceName = fields.workspaceName;
    }

    const ttl: SignOptions['expiresIn'] =
        fields.expiresIn != null && fields.expiresIn !== ''
            ? (fields.expiresIn as SignOptions['expiresIn'])
            : fields.role === 'platform_admin'
              ? PLATFORM_OPERATOR_JWT_TTL
              : DEFAULT_JWT_TTL;

    const token = jwt.sign(payload, getJwtSecret(), { expiresIn: ttl });
    return { token, sessionId };
}
