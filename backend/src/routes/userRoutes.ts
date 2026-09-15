import { Router } from 'express';
import path from 'path';
import fs from 'fs';
import multer from 'multer';
import { protect, AuthRequest } from '../middleware/authMiddleware';
import { requireActiveAccount } from '../middleware/activeAccountMiddleware';
import { getProfile, updateProfile, postLogoutAudit } from '../controllers/userProfileController';
import { uploadProfileAvatar } from '../controllers/userAvatarController';
import { listSessions, revokeSession, revokeAllOtherSessions } from '../controllers/userSessionController';

const AVATAR_MAX_BYTES = 2 * 1024 * 1024; // 2 MB — industry standard for profile photos
const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp']);

const avatarUpload = multer({
    storage: multer.diskStorage({
        destination: (_req, _file, cb) => {
            const dest = path.join(process.cwd(), 'uploads', 'avatars');
            fs.mkdirSync(dest, { recursive: true });
            cb(null, dest);
        },
        filename: (req: AuthRequest, file, cb) => {
            const uid = req.user!.userId;
            const ext =
                file.mimetype === 'image/png' ? '.png' : file.mimetype === 'image/webp' ? '.webp' : '.jpg';
            cb(null, `${uid}${ext}`);
        },
    }),
    limits: { fileSize: AVATAR_MAX_BYTES },
    fileFilter: (_req, file, cb) => {
        if (ALLOWED_MIME.has(file.mimetype)) cb(null, true);
        else cb(new Error('Only JPEG, PNG, or WebP images are allowed.'));
    },
});

const router = Router();

router.get('/me', protect, requireActiveAccount, getProfile);
router.post('/logout-audit', protect, requireActiveAccount, postLogoutAudit);
router.patch('/me', protect, requireActiveAccount, updateProfile);

router.post('/me/avatar', protect, requireActiveAccount, (req, res, next) => {
    avatarUpload.single('avatar')(req, res, (err) => {
        if (err) {
            if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
                return res.status(400).json({ message: 'Image must be 2 MB or smaller (use a compressed JPG/PNG/WebP).' });
            }
            const msg = err instanceof Error ? err.message : 'Upload error';
            return res.status(400).json({ message: msg });
        }
        next();
    });
}, uploadProfileAvatar);

router.get('/sessions', protect, requireActiveAccount, listSessions);
router.delete('/sessions/:sessionId', protect, requireActiveAccount, revokeSession);
router.delete('/sessions', protect, requireActiveAccount, revokeAllOtherSessions);

export default router;
