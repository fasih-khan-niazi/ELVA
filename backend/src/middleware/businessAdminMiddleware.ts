import { Response, NextFunction } from 'express';
import { AuthRequest } from './authMiddleware';

/** Workspace owners / solo admins - full financial & tenant-wide executive data. */
export function canViewTenantFinancialRollups(role: string | undefined): boolean {
    return role === 'business_admin';
}

export const requireBusinessAdmin = (
    req: AuthRequest,
    res: Response,
    next: NextFunction,
) => {
    if (!canViewTenantFinancialRollups(req.user?.role)) {
        return res.status(403).json({
            message: 'Only workspace administrators can access this resource.',
        });
    }
    next();
};
