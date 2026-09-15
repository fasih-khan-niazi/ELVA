import { Response } from 'express';
import { AuthRequest } from '../middleware/authMiddleware';
import { Tenant, Subscription, User } from '../models';

import { recordWorkspaceAudit } from '../services/auditService';

export const getProfile = async (req: AuthRequest, res: Response) => {
    try {
        const uid = req.user!.userId;
        const tenantId = req.user!.tenantId;

        const user = await User.findById(uid)
            .select('-passwordHash')
            .lean();

        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }

        let tenant = null as null | {
            id: string;
            name: string;
            plan: string;
            registrationType?: 'solo' | 'company';
            allowedEmailDomain?: string | null;
            currency: string;
            createdAt: Date;
        };

        let subscription = null;

        if (tenantId && user.role !== 'platform_admin') {
            const t = await Tenant.findById(tenantId).lean();
            if (t) {
                tenant = {
                    id: String(t._id),
                    name: t.name,
                    plan: t.plan,
                    registrationType: t.registrationType,
                    allowedEmailDomain: t.allowedEmailDomain ?? null,
                    // Use reportingCurrency as the single workspace currency.
                    // GlobalAnalytics keeps ledger=reporting in sync when the user saves.
                    currency: t.reportingCurrency || 'PKR',
                    createdAt: t.createdAt,
                };
            }
            const sub = await Subscription.findOne({ tenantId }).lean();
            if (sub) {
                subscription = {
                    plan: sub.plan,
                    status: sub.status,
                    currentPeriodEnd: sub.currentPeriodEnd,
                };
            }
        }

        res.json({
            user: {
                id: user._id,
                email: user.email,
                name: user.name ?? null,
                role: user.role,
                tenantId: user.tenantId ?? null,
                profilePicture: user.profilePicture ?? null,
                authProvider: user.authProvider ?? 'local',
                accountStatus: user.accountStatus,
                emailVerified: user.emailVerified ?? true,
                createdAt: user.createdAt,
            },
            tenant,
            subscription,
        });
    } catch (error: any) {
        console.error('[getProfile]', error);
        res.status(500).json({ message: error.message });
    }
};

export const updateProfile = async (req: AuthRequest, res: Response) => {
    try {
        const uid = req.user!.userId;
        const { name } = req.body as { name?: string };

        const user = await User.findById(uid);
        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }

        if (typeof name === 'string') {
            const trimmed = name.trim();
            if (trimmed.length > 120) {
                return res.status(400).json({ message: 'Display name must be at most 120 characters.' });
            }
            const nextName = trimmed === '' ? undefined : trimmed;
            const prevName = user.name ?? null;
            user.name = nextName;
            await user.save();

            const tid = user.tenantId ? String(user.tenantId) : null;
            if (tid && user.role !== 'platform_admin' && prevName !== (nextName ?? null)) {
                recordWorkspaceAudit(req, {
                    tenantId: tid,
                    actorId: uid,
                    action: 'profile.update',
                    targetType: 'user',
                    targetId: String(user._id),
                    metadata: { field: 'name' },
                });
            }
        }

        const tokenSafe = await User.findById(uid).select('-passwordHash').lean();
        res.json({
            user: {
                id: tokenSafe!._id,
                email: tokenSafe!.email,
                name: tokenSafe!.name ?? null,
                role: tokenSafe!.role,
                tenantId: tokenSafe!.tenantId ?? null,
                profilePicture: tokenSafe!.profilePicture ?? null,
                authProvider: tokenSafe!.authProvider ?? 'local',
                accountStatus: tokenSafe!.accountStatus,
                emailVerified: tokenSafe!.emailVerified ?? true,
                createdAt: tokenSafe!.createdAt,
            },
        });
    } catch (error: any) {
        console.error('[updateProfile]', error);
        res.status(500).json({ message: error.message });
    }
};

/** Called by the client before clearing JWT so we can attribute auth.logout to this user. */
export const postLogoutAudit = async (req: AuthRequest, res: Response) => {
    try {
        const tenantId = req.user!.tenantId;
        const actorId = req.user!.userId;
        if (tenantId && req.user!.role !== 'platform_admin') {
            recordWorkspaceAudit(req, {
                tenantId,
                actorId,
                action: 'auth.logout',
            });
        }
        res.json({ ok: true });
    } catch (error: any) {
        console.error('[postLogoutAudit]', error);
        res.status(500).json({ message: error.message });
    }
};
