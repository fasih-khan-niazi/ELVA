import { Response, NextFunction } from 'express';
import { AuthRequest } from './authMiddleware';
import { Tenant, User } from '../models';

/** Routes an unverified local user may still call (profile refresh, billing onboarding, logout). */
const EMAIL_VERIFY_EXEMPT_PATHS = [
    '/api/user/me',
    '/api/user/logout-audit',
    '/api/subscription/current',
    '/api/subscription/select-free',
    '/api/subscription/create-checkout',
    '/api/subscription/verify-checkout',
    '/api/subscription/create-portal',
    '/api/subscription/cancel',
];

function isEmailVerificationExempt(req: AuthRequest): boolean {
    const path = (req.originalUrl || req.url || '').split('?')[0];
    return EMAIL_VERIFY_EXEMPT_PATHS.some((allowed) => path === allowed || path.endsWith(allowed));
}

/** After `protect`: verify user exists, is active; for tenant routes, JWT tenant matches and workspace access not paused. */
export const requireActiveAccount = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction,
): Promise<void> => {
    try {
        const auth = req.user;
        if (!auth?.userId) {
            res.status(401).json({ message: 'Not authorized' });
            return;
        }

        const user = await User.findById(auth.userId).select(
            'accountStatus tenantId role email emailVerified authProvider',
        );
        if (!user) {
            res.status(401).json({ message: 'Not authorized' });
            return;
        }

        if (user.accountStatus === 'suspended') {
            res.status(403).json({ message: 'This account has been suspended.' });
            return;
        }

        if (user.role === 'platform_admin') {
            next();
            return;
        }

        if (
            !user.emailVerified &&
            user.authProvider !== 'google' &&
            !isEmailVerificationExempt(req)
        ) {
            res.status(403).json({
                message: 'Please verify your email to continue. Check your inbox for a verification link.',
                code: 'EMAIL_NOT_VERIFIED',
            });
            return;
        }

        if (!user.tenantId || user.tenantId.toString() !== auth.tenantId?.toString()) {
            res.status(403).json({ message: 'Session mismatch. Please sign in again.' });
            return;
        }

        const tenantDoc = await Tenant.findById(user.tenantId).select('accessSuspendedUntil');

        const until = tenantDoc?.accessSuspendedUntil;
        if (until && until.getTime() > Date.now()) {
            res.status(403).json({
                message: 'This workspace access is temporarily suspended.',
            });
            return;
        }

        next();
    } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : 'Server error';
        console.error('[requireActiveAccount]', msg);
        res.status(500).json({ message: 'Server error' });
    }
};
