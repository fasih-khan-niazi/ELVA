import { Response, NextFunction } from 'express';
import { AuthRequest } from './authMiddleware';
import { User } from '../models';

/** JWT claim must be platform_admin; verifies DB row still matches (defense against stale token). */
export const verifyPlatformOperator = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction,
): Promise<void> => {
    try {
        const id = req.user?.userId;
        if (!id) {
            res.status(401).json({ message: 'Not authorized' });
            return;
        }

        const u = await User.findById(id).select('role accountStatus');
        if (!u || u.role !== 'platform_admin') {
            res.status(403).json({ message: 'Platform operators only.' });
            return;
        }

        if (u.accountStatus === 'suspended') {
            res.status(403).json({ message: 'This account has been suspended.' });
            return;
        }

        next();
    } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : 'Server error';
        console.error('[verifyPlatformOperator]', msg);
        res.status(500).json({ message: 'Server error' });
    }
};
