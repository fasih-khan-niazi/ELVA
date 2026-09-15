import { Response } from 'express';
import path from 'path';
import fs from 'fs';
import { AuthRequest } from '../middleware/authMiddleware';
import { User } from '../models';
import { filePublicUrl } from '../utils/filePublicUrl';
import { recordWorkspaceAudit } from '../services/auditService';

type MulterLocals = AuthRequest & { file?: Express.Multer.File };

/** Remove previous on-disk avatars for this user; keep `keepBasename` (the file multer just wrote). */
function removeStaleAvatarFiles(userId: string, keepBasename: string) {
    const dir = path.join(process.cwd(), 'uploads', 'avatars');
    if (!fs.existsSync(dir)) return;
    const prefix = `${userId}.`;
    for (const f of fs.readdirSync(dir)) {
        if (f === keepBasename) continue;
        if (!f.startsWith(prefix)) continue;
        try {
            fs.unlinkSync(path.join(dir, f));
        } catch {
            /* ignore */
        }
    }
}

export const uploadProfileAvatar = async (req: AuthRequest, res: Response) => {
    try {
        const file = (req as MulterLocals).file;
        if (!file) {
            return res.status(400).json({ message: 'No image file (field name: avatar).' });
        }

        const uid = req.user!.userId;
        const user = await User.findById(uid);
        if (!user) {
            if (fs.existsSync(file.path)) fs.unlinkSync(file.path);
            return res.status(404).json({ message: 'User not found.' });
        }

        if (!fs.existsSync(file.path)) {
            return res.status(400).json({ message: 'Upload failed.' });
        }

        const finalName = path.basename(file.path);
        removeStaleAvatarFiles(String(uid), finalName);
        const publicPath = `/uploads/avatars/${finalName}`;
        user.profilePicture = filePublicUrl(publicPath);
        await user.save();

        const tid = user.tenantId ? String(user.tenantId) : null;
        if (tid && user.role !== 'platform_admin') {
            recordWorkspaceAudit(req, {
                tenantId: tid,
                actorId: String(uid),
                action: 'profile.avatar_update',
                targetType: 'user',
                targetId: String(user._id),
            });
        }

        const tokenSafe = await User.findById(uid).select('-passwordHash').lean();
        res.json({
            profilePicture: user.profilePicture,
            user: {
                id: tokenSafe!._id,
                email: tokenSafe!.email,
                name: tokenSafe!.name ?? null,
                role: tokenSafe!.role,
                tenantId: tokenSafe!.tenantId ?? null,
                profilePicture: tokenSafe!.profilePicture ?? null,
                authProvider: tokenSafe!.authProvider ?? 'local',
                accountStatus: tokenSafe!.accountStatus,
                createdAt: tokenSafe!.createdAt,
            },
        });
    } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : 'Server error';
        console.error('[uploadProfileAvatar]', msg);
        res.status(500).json({ message: msg });
    }
};
