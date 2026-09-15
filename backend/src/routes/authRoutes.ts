import express from 'express';

import {

    signup,

    login,

    googleAuth,

    forgotPassword,

    resetPassword,

    verifyEmail,

    resendVerification,

    getSession,

    logout,

} from '../controllers/authController';

import { previewInvite, acceptInvite } from '../controllers/inviteAcceptController';

import { authRoutesLimiter } from '../middleware/authRateLimit';

import { protect } from '../middleware/authMiddleware';



const router = express.Router();



router.use(authRoutesLimiter);



router.post('/signup', signup);

router.post('/login', login);

router.post('/google', googleAuth);

router.get('/session', protect, getSession);

router.post('/logout', logout);

router.get('/invite/:token', previewInvite);

router.post('/invite/accept', acceptInvite);

router.post('/forgot-password', forgotPassword);

router.post('/reset-password', resetPassword);

router.post('/verify-email', verifyEmail);

router.post('/resend-verification', resendVerification);



export default router;

