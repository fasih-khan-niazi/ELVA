import { Response } from 'express';
import mongoose from 'mongoose';
import { AuthRequest } from '../middleware/authMiddleware';
import { User } from '../models';
import { getTenantSeatSnapshot } from '../utils/seatLimits';
import { recordWorkspaceAudit } from '../services/auditService';

export const listMembers = async (req: AuthRequest, res: Response) => {
    try {
        const tenantId = req.user!.tenantId!;

        const members = await User.find({
            tenantId,
            role: { $ne: 'platform_admin' },
        })
            .select('email name role profilePicture authProvider accountStatus createdAt')
            .sort({ createdAt: 1 })
            .lean();

        const count = await User.countDocuments({ tenantId, role: 'business_admin' });

        const tid = new mongoose.Types.ObjectId(tenantId);
        const seats = await getTenantSeatSnapshot(tid);

        res.json({
            tenantId,
            adminsCount: count,
            seats,
            members: members.map((u) => ({
                id: u._id,
                email: u.email,
                name: u.name ?? null,
                role: u.role,
                profilePicture: u.profilePicture ?? null,
                authProvider: u.authProvider ?? 'local',
                accountStatus: u.accountStatus,
                createdAt: u.createdAt,
            })),
        });
    } catch (error: any) {
        console.error('[listMembers]', error);
        res.status(500).json({ message: error.message });
    }
};

export const removeMember = async (req: AuthRequest, res: Response) => {
    try {
        const tenantId = req.user!.tenantId!;
        const memberId = req.params.userId;
        const requesterId = req.user!.userId;

        if (!mongoose.Types.ObjectId.isValid(memberId)) {
            return res.status(400).json({ message: 'Invalid user id.' });
        }

        const target = await User.findOne({ _id: memberId, tenantId });
        if (!target) {
            return res.status(404).json({ message: 'Team member not found.' });
        }

        if (target._id.equals(requesterId)) {
            return res.status(400).json({
                message: 'You cannot remove yourself. Transfer admin first or delete the organization separately.',
            });
        }

        if (target.role === 'business_admin') {
            const adminCount = await User.countDocuments({ tenantId, role: 'business_admin' });
            if (adminCount <= 1) {
                return res.status(400).json({
                    message: 'Cannot remove the last organization admin.',
                });
            }
        }

        await User.deleteOne({ _id: target._id });

        recordWorkspaceAudit(req, {
            tenantId,
            actorId: requesterId,
            action: 'member.remove',
            targetType: 'user',
            targetId: memberId,
            metadata: { email: target.email, role: target.role },
        });

        res.json({ message: 'Member removed.', id: memberId });
    } catch (error: any) {
        console.error('[removeMember]', error);
        res.status(500).json({ message: error.message });
    }
};

export const suspendMember = async (req: AuthRequest, res: Response) => {
    try {
        const tenantId = req.user!.tenantId!;
        const memberId = req.params.userId;
        const requesterId = req.user!.userId;

        if (!mongoose.Types.ObjectId.isValid(memberId)) {
            return res.status(400).json({ message: 'Invalid user id.' });
        }

        const target = await User.findOne({ _id: memberId, tenantId });
        if (!target) {
            return res.status(404).json({ message: 'Team member not found.' });
        }

        if (target._id.equals(requesterId)) {
            return res.status(400).json({ message: 'You cannot suspend your own account.' });
        }

        if (target.role === 'business_admin') {
            const adminCount = await User.countDocuments({ tenantId, role: 'business_admin' });
            if (adminCount <= 1) {
                return res.status(400).json({ message: 'Cannot suspend the last organization admin.' });
            }
        }

        if (target.accountStatus === 'suspended') {
            return res.status(400).json({ message: 'This account is already suspended.' });
        }

        target.accountStatus = 'suspended';
        await target.save();

        recordWorkspaceAudit(req, {
            tenantId,
            actorId: requesterId,
            action: 'member.suspend',
            targetType: 'user',
            targetId: memberId,
            metadata: { email: target.email, role: target.role },
        });

        res.json({ message: 'Member suspended.', id: memberId });
    } catch (error: any) {
        console.error('[suspendMember]', error);
        res.status(500).json({ message: error.message });
    }
};

export const resumeMember = async (req: AuthRequest, res: Response) => {
    try {
        const tenantId = req.user!.tenantId!;
        const memberId = req.params.userId;
        const requesterId = req.user!.userId;

        if (!mongoose.Types.ObjectId.isValid(memberId)) {
            return res.status(400).json({ message: 'Invalid user id.' });
        }

        const target = await User.findOne({ _id: memberId, tenantId });
        if (!target) {
            return res.status(404).json({ message: 'Team member not found.' });
        }

        if (target.accountStatus !== 'suspended') {
            return res.status(400).json({ message: 'This account is not suspended.' });
        }

        target.accountStatus = 'active';
        await target.save();

        recordWorkspaceAudit(req, {
            tenantId,
            actorId: requesterId,
            action: 'member.resume',
            targetType: 'user',
            targetId: memberId,
            metadata: { email: target.email, role: target.role },
        });

        res.json({ message: 'Member reactivated.', id: memberId });
    } catch (error: any) {
        console.error('[resumeMember]', error);
        res.status(500).json({ message: error.message });
    }
};
