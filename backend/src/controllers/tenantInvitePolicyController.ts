import { Response } from 'express';
import { AuthRequest } from '../middleware/authMiddleware';
import { Tenant, User } from '../models';
import { isConsumerEmailDomain } from '../utils/workEmailPolicy';
import { recordWorkspaceAudit } from '../services/auditService';

function adminEmailDomain(adminEmail: string): string | null {
    const norm = adminEmail.trim().toLowerCase();
    const at = norm.lastIndexOf('@');
    if (at <= 0 || at === norm.length - 1) return null;
    return norm.slice(at + 1);
}

/**
 * PATCH body: `{ restrictInvitesToWorkDomain: boolean }`
 * When true: set `tenant.allowedEmailDomain` to the requesting admin's domain (same as their sign-in email).
 * When false: clear domain restriction - invites allowed to any address (invite link still secret).
 */
export const patchInviteDomainPolicy = async (req: AuthRequest, res: Response) => {
    try {
        const tenant = await Tenant.findById(req.user!.tenantId);

        if (!tenant) {
            return res.status(404).json({ message: 'Workspace not found.' });
        }

        if (tenant.registrationType === 'solo') {
            return res.status(403).json({
                message: 'Invite domain policy applies to company workspaces only.',
            });
        }

        const { restrictInvitesToWorkDomain } = req.body as { restrictInvitesToWorkDomain?: unknown };

        if (typeof restrictInvitesToWorkDomain !== 'boolean') {
            return res.status(400).json({ message: 'restrictInvitesToWorkDomain (boolean) is required.' });
        }

        const admin = await User.findById(req.user!.userId).select('email').lean();
        const adminEmail = admin?.email ?? '';
        const domain = adminEmailDomain(adminEmail);

        if (!domain) {
            return res.status(400).json({ message: 'Could not determine your email domain.' });
        }

        if (restrictInvitesToWorkDomain) {
            const norm = adminEmail.trim().toLowerCase();
            if (isConsumerEmailDomain(norm)) {
                return res.status(400).json({
                    message:
                        'Higher-security mode requires your admin login to use a company email domain (not a personal provider such as Gmail).',
                });
            }

            tenant.allowedEmailDomain = domain;
            await tenant.save();

            recordWorkspaceAudit(req, {
                tenantId: String(tenant._id),
                actorId: req.user!.userId,
                action: 'workspace.invite_policy',
                targetType: 'tenant',
                targetId: String(tenant._id),
                metadata: { restrictInvitesToWorkDomain: true, allowedEmailDomain: domain },
            });

            return res.json({
                allowedEmailDomain: tenant.allowedEmailDomain,
                restrictInvitesToWorkDomain: true,
            });
        }

        await Tenant.collection.updateOne(
            { _id: tenant._id },
            { $unset: { allowedEmailDomain: 1 as never } },
        );

        const fresh = await Tenant.findById(tenant._id).lean();

        recordWorkspaceAudit(req, {
            tenantId: String(tenant._id),
            actorId: req.user!.userId,
            action: 'workspace.invite_policy',
            targetType: 'tenant',
            targetId: String(tenant._id),
            metadata: { restrictInvitesToWorkDomain: false },
        });

        res.json({
            allowedEmailDomain: fresh?.allowedEmailDomain ?? null,
            restrictInvitesToWorkDomain: false,
        });
    } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : 'Server error';
        console.error('[patchInviteDomainPolicy]', msg);
        res.status(500).json({ message: msg });
    }
};
