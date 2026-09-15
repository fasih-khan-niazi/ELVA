import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { getJwtSecret } from '../config/jwtSecret';
import { User } from '../models';
import { UserSession } from '../models/UserSession';
import { readAuthTokenFromRequest } from '../utils/authCookie';

export interface AuthRequest extends Request {
    user?: {
        userId: string;
        tenantId?: string;
        role: string;
        sessionId?: string;
    };
}

export const protect = async (req: AuthRequest, res: Response, next: NextFunction) => {
    const token = readAuthTokenFromRequest(req);
    if (!token) {
        return res.status(401).json({ message: 'Not authorized, no token' });
    }

    try {
        const decoded = jwt.verify(token, getJwtSecret()) as AuthRequest['user'] & {
            userId: string;
        };

        const dbUser = await User.findById(decoded.userId).select('accountStatus').lean();
        if (!dbUser) {
            return res.status(401).json({ message: 'Account no longer exists. Please sign in again.' });
        }
        if (dbUser.accountStatus === 'suspended') {
            return res.status(403).json({ message: 'Your account has been suspended. Contact your workspace admin.' });
        }

        if (decoded.sessionId) {
            const session = await UserSession.findOne({
                sessionId: decoded.sessionId,
                userId: decoded.userId,
            }).lean();

            if (session) {
                if (session.revokedAt) {
                    return res.status(401).json({ message: 'This session has been revoked. Please sign in again.' });
                }
                if (session.expiresAt < new Date()) {
                    return res.status(401).json({ message: 'Session expired. Please sign in again.' });
                }
            }

            void UserSession.updateOne(
                { sessionId: decoded.sessionId, userId: decoded.userId },
                { lastSeenAt: new Date() },
            ).catch(() => {});
        }

        req.user = decoded;
        return next();
    } catch {
        return res.status(401).json({ message: 'Not authorized, token failed' });
    }
};
