import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import { Invite } from '../models/Invite';
import { User, Tenant, Subscription } from '../models';
import { TERMS_VERSION } from '../constants/legal';
import { hashInviteToken, blurInviteEmail } from '../utils/inviteToken';
import { countTenantUsers, maxSeatsForPlan } from '../utils/seatLimits';
import { PlanType } from '../models';
import { recordWorkspaceAudit } from '../services/auditService';
import { validateStrongPassword } from '../utils/passwordPolicy';
import { getJwtSecret } from '../config/jwtSecret';

export const previewInvite = async (req: Request, res: Response) => {
    try {
        const raw = req.params.token;
        if (!raw || raw.length < 16) {
            return res.status(400).json({ message: 'Invalid invite link.' });
        }
        const tokenHash = hashInviteToken(decodeURIComponent(raw));
        const inv = await Invite.findOne({
            tokenHash,
            revokedAt: null,
            consumedAt: null,
            expiresAt: { $gt: new Date() },
        }).lean();

        if (!inv) {
            return res.status(404).json({ message: 'This invite is invalid or has expired.' });
        }

        res.json({
            emailMask: blurInviteEmail(inv.email),
            workspaceId: inv.tenantId,
            termsVersion: TERMS_VERSION,
        });
    } catch (e: any) {
        console.error('[previewInvite]', e);
        res.status(500).json({ message: e.message });
    }
};

export const acceptInvite = async (req: Request, res: Response) => {
    try {
        const { token: rawBody, password, acceptTerms, termsVersion } = req.body as {
            token?: string;
            password?: string;
            acceptTerms?: boolean;
            termsVersion?: string;
        };

        const raw = rawBody || req.params.token;
        if (!raw || typeof raw !== 'string' || raw.length < 16) {
            return res.status(400).json({ message: 'Invalid invite token.' });
        }
        const plainPassword = typeof password === 'string' ? password : '';
        const passCheck = validateStrongPassword(plainPassword);
        if (!passCheck.ok) {
            return res.status(400).json({ message: passCheck.message || 'Password does not meet requirements.' });
        }
        if (!acceptTerms || termsVersion !== TERMS_VERSION) {
            return res.status(400).json({
                message: 'You must accept the current Terms of Service.',
            });
        }

        const tokenHash = hashInviteToken(raw.trim());
        const inv = await Invite.findOne({
            tokenHash,
            revokedAt: null,
            consumedAt: null,
            expiresAt: { $gt: new Date() },
        });

        if (!inv) {
            return res.status(404).json({ message: 'This invite is invalid or has expired.' });
        }

        const tenantId = inv.tenantId as mongoose.Types.ObjectId;
        const sub = await Subscription.findOne({ tenantId }).lean();
        const tenant = await Tenant.findById(tenantId).select('plan allowedEmailDomain').lean();
        const plan = (sub?.plan || tenant?.plan || 'free') as PlanType;
        const limit = maxSeatsForPlan(plan);
        const used = await countTenantUsers(tenantId);

        if (limit !== -1 && used >= limit) {
            return res.status(403).json({
                message:
                    'This workspace no longer has an available seat. Ask your admin to upgrade the plan.',
            });
        }

        const emailNorm = inv.email.toLowerCase().trim();
        if (tenant?.allowedEmailDomain) {
            const dom = tenant.allowedEmailDomain.replace(/^@/, '');
            const suff = emailNorm.slice(emailNorm.indexOf('@') + 1);
            if (suff !== dom) {
                return res.status(400).json({
                    message: `This workspace only accepts @${dom} addresses.`,
                });
            }
        }

        const dupMember = await User.findOne({ email: emailNorm, tenantId });
        if (dupMember) {
            return res.status(409).json({ message: 'You already belong to this workspace.' });
        }

        const cross = await User.findOne({
            email: emailNorm,
            tenantId: { $exists: true, $nin: [null, tenantId] },
        });
        if (cross) {
            return res.status(409).json({
                message: 'This email is already registered with another workspace.',
            });
        }

        const salt = await bcrypt.genSalt(10);
        const passwordHash = await bcrypt.hash(plainPassword, salt);

        const user = await User.create({
            email: emailNorm,
            passwordHash,
            role: 'member',
            tenantId,
            authProvider: 'local',
            accountStatus: 'active',
            termsAcceptedAt: new Date(),
            termsVersionAccepted: TERMS_VERSION,
        });

        inv.consumedAt = new Date();
        await inv.save();

        recordWorkspaceAudit(req, {
            tenantId: String(tenantId),
            actorId: String(user._id),
            action: 'member.join',
            metadata: { via: 'invite', email: emailNorm },
        });

        const jwtToken = jwt.sign(
            { userId: user._id, tenantId: user.tenantId, role: user.role },
            getJwtSecret(),
            { expiresIn: '1d' },
        );

        res.status(201).json({
            token: jwtToken,
            user: {
                id: user._id,
                email: user.email,
                role: user.role,
                tenantId: user.tenantId,
                name: user.name ?? null,
                profilePicture: user.profilePicture ?? null,
                authProvider: 'local',
                accountStatus: user.accountStatus,
            },
        });
    } catch (e: any) {
        console.error('[acceptInvite]', e);
        res.status(500).json({ message: e.message });
    }
};
