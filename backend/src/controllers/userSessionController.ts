import { Response } from 'express';
import { AuthRequest } from '../middleware/authMiddleware';
import { UserSession } from '../models/UserSession';

/** GET /api/user/sessions — list all active sessions for the current user.
 *  Results are deduplicated by User-Agent so that a single device always appears
 *  as one entry regardless of how many login/logout cycles have occurred. */
export const listSessions = async (req: AuthRequest, res: Response) => {
    try {
        const userId = req.user!.userId;
        const currentSessionId = (req.user as any).sessionId as string | undefined;

        const sessions = await UserSession.find({
            userId,
            revokedAt: null,
            expiresAt: { $gt: new Date() },
        })
            .sort({ lastSeenAt: -1 })
            .lean();

        // Deduplicate by userAgent — keep only the most recently seen session per
        // unique device. This gracefully handles any existing duplicate records that
        // were created before the "revoke-on-login" logic was in place.
        const deviceMap = new Map<string, (typeof sessions)[0]>();
        for (const s of sessions) {
            const key = s.userAgent || s.sessionId; // fall back to sessionId if UA is empty
            if (!deviceMap.has(key)) {
                deviceMap.set(key, s); // already sorted by lastSeenAt desc → first is newest
            }
        }
        const dedupedSessions = [...deviceMap.values()];

        res.json({
            sessions: dedupedSessions.map(s => ({
                id: s.sessionId,
                deviceLabel: s.deviceLabel,
                ipAddress: s.ipAddress,
                createdAt: s.createdAt,
                lastSeenAt: s.lastSeenAt,
                expiresAt: s.expiresAt,
                isCurrent: s.sessionId === currentSessionId,
            })),
        });
    } catch (error: any) {
        console.error('[listSessions]', error);
        res.status(500).json({ message: error.message });
    }
};

/** DELETE /api/user/sessions/:sessionId — revoke a specific session. */
export const revokeSession = async (req: AuthRequest, res: Response) => {
    try {
        const userId = req.user!.userId;
        const { sessionId } = req.params;

        const session = await UserSession.findOne({ sessionId, userId });
        if (!session) {
            return res.status(404).json({ message: 'Session not found.' });
        }

        session.revokedAt = new Date();
        await session.save();

        res.json({ message: 'Session revoked.' });
    } catch (error: any) {
        console.error('[revokeSession]', error);
        res.status(500).json({ message: error.message });
    }
};

/** DELETE /api/user/sessions — revoke all sessions except the current one. */
export const revokeAllOtherSessions = async (req: AuthRequest, res: Response) => {
    try {
        const userId = req.user!.userId;
        const currentSessionId = (req.user as any).sessionId as string | undefined;

        await UserSession.updateMany(
            {
                userId,
                revokedAt: null,
                ...(currentSessionId ? { sessionId: { $ne: currentSessionId } } : {}),
            },
            { revokedAt: new Date() },
        );

        res.json({ message: 'All other sessions have been revoked.' });
    } catch (error: any) {
        console.error('[revokeAllOtherSessions]', error);
        res.status(500).json({ message: error.message });
    }
};
