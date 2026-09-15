import { Response } from 'express';
import mongoose from 'mongoose';
import { AuthRequest } from '../middleware/authMiddleware';
import { User } from '../models';
import { WorkspaceAuditLog } from '../models/WorkspaceAuditLog';

export const listWorkspaceAudit = async (req: AuthRequest, res: Response) => {
    try {
        const tenantId = req.user!.tenantId;
        if (!tenantId || !mongoose.Types.ObjectId.isValid(tenantId)) {
            return res.status(400).json({ message: 'Invalid workspace.' });
        }

        const userId = typeof req.query.userId === 'string' ? req.query.userId.trim() : '';
        const limit = Math.min(Math.max(parseInt(String(req.query.limit || '80'), 10) || 80, 1), 500);

        const match: Record<string, unknown> = {
            tenantId: new mongoose.Types.ObjectId(tenantId),
        };
        if (userId && mongoose.Types.ObjectId.isValid(userId)) {
            match.actorId = new mongoose.Types.ObjectId(userId);
        }

        const rows = await WorkspaceAuditLog.find(match).sort({ createdAt: -1 }).limit(limit).lean();

        const actorIds = [...new Set(rows.map((r) => String(r.actorId)))];
        const actors = await User.find({ _id: { $in: actorIds } })
            .select('email name')
            .lean();
        const byId = new Map(actors.map((a) => [String(a._id), a]));

        res.json({
            entries: rows.map((r) => ({
                id: String(r._id),
                action: r.action,
                targetType: r.targetType,
                targetId: r.targetId,
                metadata: r.metadata,
                createdAt: r.createdAt,
                actorId: String(r.actorId),
                actorEmail: byId.get(String(r.actorId))?.email ?? null,
                actorName: byId.get(String(r.actorId))?.name ?? null,
            })),
        });
    } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : 'Server error';
        console.error('[listWorkspaceAudit]', msg);
        res.status(500).json({ message: msg });
    }
};
