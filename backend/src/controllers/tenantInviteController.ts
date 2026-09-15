import { Response } from 'express';
import { AuthRequest } from '../middleware/authMiddleware';
import { Invite } from '../models/Invite';
import { Tenant, User } from '../models';
import mongoose from 'mongoose';
import { createRawInviteToken, hashInviteToken } from '../utils/inviteToken';
import { sendEmail } from '../services/emailService';
import { getTenantSeatSnapshot } from '../utils/seatLimits';
import { recordWorkspaceAudit } from '../services/auditService';

const INVITE_TTL_MS = 48 * 60 * 60 * 1000; // 48 hours — single-use, short-lived for security

export const listInvites = async (req: AuthRequest, res: Response) => {
    try {
        const tenantId = req.user!.tenantId!;
        const now = new Date();
        const rows = await Invite.find({
            tenantId,
            consumedAt: null,
            revokedAt: null,
            expiresAt: { $gt: now },
        })
            .sort({ createdAt: -1 })
            .lean();

        res.json({
            invites: rows.map((r) => ({
                id: r._id,
                email: r.email,
                expiresAt: r.expiresAt,
                createdAt: r.createdAt,
            })),
        });
    } catch (e: any) {
        console.error('[listInvites]', e);
        res.status(500).json({ message: e.message });
    }
};

export const createInvite = async (req: AuthRequest, res: Response) => {
    try {
        const tenantId = new mongoose.Types.ObjectId(req.user!.tenantId!)
        const { email } = req.body as { email?: string };
        const trimmedEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';
        if (!trimmedEmail || !trimmedEmail.includes('@')) {
            return res.status(400).json({ message: 'Valid email required.' });
        }

        const tenant = await Tenant.findById(tenantId);
        if (!tenant) {
            return res.status(404).json({ message: 'Workspace not found.' });
        }

        if (tenant.registrationType === 'solo') {
            return res.status(403).json({
                message:
                    'Individual accounts cannot invite teammates. Create a new workspace with Company / team registration to add collaborators.',
            });
        }

        if (tenant.allowedEmailDomain) {
            const dom = tenant.allowedEmailDomain.replace(/^@/, '');
            const suff = trimmedEmail.slice(trimmedEmail.indexOf('@') + 1);
            if (suff !== dom) {
                return res.status(400).json({
                    message: `Invites must use an @${dom} email for this workspace.`,
                });
            }
        }

        const existingMember = await User.findOne({
            email: trimmedEmail,
            tenantId,
            role: { $in: ['business_admin', 'member'] },
        });
        if (existingMember) {
            return res.status(409).json({ message: 'This person already belongs to your workspace.' });
        }

        const otherUser = await User.findOne({
            email: trimmedEmail,
            tenantId: { $exists: true, $nin: [null, tenantId] },
        });
        if (otherUser) {
            return res.status(409).json({
                message: 'This email is already registered under another workspace.',
            });
        }

        const { limit, used, pending } = await getTenantSeatSnapshot(tenantId);
        if (limit !== -1 && used + pending >= limit) {
            return res.status(403).json({
                message:
                    'No available seats under your plan. Upgrade for more teammate seats or wait for invites to expire.',
            });
        }

        await Invite.updateMany(
            {
                tenantId,
                email: trimmedEmail,
                consumedAt: null,
                revokedAt: null,
            },
            { revokedAt: new Date() },
        );

        const raw = createRawInviteToken();
        const tokenHash = hashInviteToken(raw);
        const expiresAt = new Date(Date.now() + INVITE_TTL_MS);

        await Invite.create({
            tenantId,
            email: trimmedEmail,
            tokenHash,
            expiresAt,
            invitedBy: new mongoose.Types.ObjectId(req.user!.userId),
        });

        const base = (process.env.FRONTEND_URL || 'http://localhost:5173').replace(/\/$/, '');
        const inviteUrl = `${base}/invite/${raw}`;

        const { sent } = await sendEmail({
            to: [trimmedEmail],
            subject: 'You are invited to an ELVA workspace',
            html: `
        <p>You have been invited to join <strong>${escapeHtml(tenant.name)}</strong> on ELVA.</p>
        <p><a href="${inviteUrl}">Accept invite and create your password</a></p>
        <p>This link expires in 48 hours. If you did not expect this, you can ignore this email.</p>
      `,
            fromName: 'ELVA',
            categories: ['elva-invite'],
        });

        if (!sent) {
            console.warn('[invite] Email not delivered (check SendGrid). Invite URL:', inviteUrl);
        }

        recordWorkspaceAudit(req, {
            tenantId: String(tenantId),
            actorId: req.user!.userId,
            action: 'invite.send',
            metadata: { email: trimmedEmail },
        });

        res.status(201).json({
            message: sent
                ? 'Invite sent.'
                : 'Invite created but email could not be sent. Configure SENDGRID_* or share the invite link manually.',
            emailSent: sent,
            inviteUrl: sent ? undefined : inviteUrl,
        });
    } catch (e: any) {
        console.error('[createInvite]', e);
        res.status(500).json({ message: e.message });
    }
};

function escapeHtml(s: string) {
    return s.replace(/[&<>"']/g, (c) =>
        ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string),
    );
}

export const revokeInvite = async (req: AuthRequest, res: Response) => {
    try {
        const tenantId = req.user!.tenantId!;
        const inviteId = req.params.inviteId;
        if (!mongoose.Types.ObjectId.isValid(inviteId)) {
            return res.status(400).json({ message: 'Invalid invite.' });
        }
        const inv = await Invite.findOne({
            _id: inviteId,
            tenantId,
            consumedAt: null,
            revokedAt: null,
        });
        if (!inv) {
            return res.status(404).json({ message: 'Invite not found.' });
        }
        inv.revokedAt = new Date();
        await inv.save();

        recordWorkspaceAudit(req, {
            tenantId,
            actorId: req.user!.userId,
            action: 'invite.revoke',
            targetType: 'invite',
            targetId: inviteId,
            metadata: { email: inv.email },
        });

        res.json({ message: 'Invite cancelled.' });
    } catch (e: any) {
        console.error('[revokeInvite]', e);
        res.status(500).json({ message: e.message });
    }
};
