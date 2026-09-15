import { Request, Response } from 'express';
import { AuthRequest } from '../middleware/authMiddleware';

import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { User, Tenant } from '../models';
import { PasswordResetToken } from '../models/PasswordResetToken';
import { EmailVerificationToken } from '../models/EmailVerificationToken';
import { UserSession } from '../models/UserSession';
import mongoose from 'mongoose';

function getDeviceLabel(ua: string): string {
    if (!ua) return 'Unknown device';
    let device = 'Unknown device';
    if (/iPhone/i.test(ua)) device = 'iPhone';
    else if (/iPad/i.test(ua)) device = 'iPad';
    else if (/Android/i.test(ua)) device = 'Android';
    else if (/Windows/i.test(ua)) device = 'Windows PC';
    else if (/Macintosh/i.test(ua)) device = 'Mac';
    else if (/Linux/i.test(ua)) device = 'Linux PC';
    let browser = '';
    if (/Edg\//i.test(ua)) browser = 'Edge';
    else if (/Chrome/i.test(ua)) browser = 'Chrome';
    else if (/Firefox/i.test(ua)) browser = 'Firefox';
    else if (/Safari/i.test(ua)) browser = 'Safari';
    return browser ? `${browser} on ${device}` : device;
}

/**
 * Upsert a session for this device: revoke any existing active sessions with the
 * same User-Agent before creating a fresh one. This ensures there is always at
 * most ONE active session record per device, no matter how many times the user
 * logs in and out.
 */
async function createUserSession(
    req: Request,
    userId: mongoose.Types.ObjectId,
    sessionId: string,
    ttlMs: number,
): Promise<void> {
    const ua = (req.headers['user-agent'] || '').slice(0, 512);
    const ip = (
        (req.headers['x-forwarded-for'] as string) || req.socket?.remoteAddress || ''
    )
        .split(',')[0]
        .trim()
        .slice(0, 64);

    // Revoke every existing non-revoked session from the same device (same UA).
    // This prevents duplicate entries for the same browser/device.
    if (ua) {
        await UserSession.updateMany(
            { userId, userAgent: ua, revokedAt: null },
            { revokedAt: new Date() },
        ).catch(err => console.warn('[session] revoke-existing failed:', err));
    }

    await UserSession.create({
        userId,
        sessionId,
        userAgent: ua,
        ipAddress: ip,
        deviceLabel: getDeviceLabel(ua),
        expiresAt: new Date(Date.now() + ttlMs),
    }).catch(err => console.warn('[session] create failed:', err));
}

import { OAuth2Client } from 'google-auth-library';

import { TERMS_VERSION } from '../constants/legal';
import {
    COMPANY_REQUIRES_WORK_EMAIL_MESSAGE,
    isConsumerEmailDomain,
} from '../utils/workEmailPolicy';
import { recordWorkspaceAudit } from '../services/auditService';
import { validateStrongPassword } from '../utils/passwordPolicy';
import { signAuthToken } from '../utils/signUserJwt';
import { setAuthCookie, clearAuthCookie } from '../utils/authCookie';
import { sendEmail } from '../services/emailService';


const googleOauth2Client = new OAuth2Client();

// Verifies Google Sign-In ID token (JWT) via Google's certs - not the legacy tokeninfo endpoint.
const verifyGoogleCredential = async (
    credential: string,
): Promise<{ sub: string; email: string; name?: string; picture?: string } | null> => {
    const fromEnv = process.env.GOOGLE_CLIENT_ID?.trim() ?? '';

    if (!fromEnv) {
        console.error(
            '[googleAuth] Set GOOGLE_CLIENT_ID in backend .env so ID tokens can be verified (audience check).',
        );
        return null;
    }

    try {
        const ticket = await googleOauth2Client.verifyIdToken({
            idToken: credential,
            audience: fromEnv,
        });
        const payload = ticket.getPayload();
        if (!payload?.sub || !payload.email) return null;
        if (payload.email_verified === false) return null;

        return {
            sub: payload.sub,
            email: payload.email,
            name: payload.name,
            picture: payload.picture,
        };
    } catch (error) {
        console.error('Google token verification failed:', error);
        return null;
    }
};



export const googleAuth = async (req: Request, res: Response) => {

    try {

        let isNewGoogleRegistration = false;

        const {

            credential,

            clientId,

            acceptTerms,

            termsVersion,

            registrationType,

            organizationName,

        } = req.body as Record<string, unknown>;



        if (!credential || typeof credential !== 'string') {

            return res.status(400).json({ message: 'Google credential is required' });

        }



        const googleUser = await verifyGoogleCredential(credential);



        if (!googleUser) {

            return res.status(401).json({ message: 'Invalid Google token' });

        }



        const emailNorm = String(googleUser.email)
            .trim()
            .toLowerCase();
        if (!emailNorm || !emailNorm.includes('@')) {
            return res.status(400).json({ message: 'Google account email is missing or invalid.' });
        }

        const { name, picture, sub: googleId } = googleUser;



        let user = await User.findOne({ email: emailNorm });

        let tenant;



        if (user) {

            if (user.accountStatus === 'suspended') {

                return res.status(403).json({ message: 'This account has been suspended.' });

            }



            tenant = await Tenant.findById(user.tenantId);

            if (user.tenantId && user.role !== 'platform_admin') {
                const until = tenant?.accessSuspendedUntil;
                if (until && until.getTime() > Date.now()) {
                    return res.status(403).json({
                        message: 'This workspace access is temporarily suspended.',
                    });
                }
            }



            if (!user.googleId) {

                user.googleId = googleId;

                user.profilePicture = picture;

                await user.save();

            }

            if (name && !user.name) {

                user.name = name;

                await user.save();

            }

        } else {

            isNewGoogleRegistration = true;

            if (!acceptTerms || termsVersion !== TERMS_VERSION) {

                return res.status(400).json({

                    message: 'You must accept the Terms of Service to create an account.',

                });

            }



            const regType =

                registrationType === 'solo' || registrationType === 'company' ? registrationType : null;

            if (!regType) {

                return res.status(400).json({ message: 'registrationType solo or company is required.' });

            }



            let tenantName =

                typeof organizationName === 'string' ? organizationName.trim() : '';

            if (regType === 'company' && !tenantName) {

                return res.status(400).json({ message: 'Company / workspace display name is required.' });

            }

            if (!tenantName) tenantName = (name as string)?.trim?.() || emailNorm.split('@')[0];

            if (regType === 'company' && isConsumerEmailDomain(emailNorm)) {
                return res.status(400).json({ message: COMPANY_REQUIRES_WORK_EMAIL_MESSAGE });
            }

            tenant = await Tenant.create({

                name: tenantName,

                registrationType: regType,

            });



            user = await User.create({

                email: emailNorm,

                passwordHash: '',

                role: 'business_admin',

                tenantId: tenant._id,

                googleId,

                profilePicture: picture,

                authProvider: 'google',

                name: (name as string) || undefined,

                accountStatus: 'active',

                termsAcceptedAt: new Date(),

                termsVersionAccepted: TERMS_VERSION,

            });

        }



        const { token, sessionId: googleSessionId } = signAuthToken({
            userId: user._id,
            tenantId: user.tenantId ?? undefined,
            role: user.role,
            workspaceName: tenant?.name ?? undefined,
        });

        void createUserSession(req, new mongoose.Types.ObjectId(String(user._id)), googleSessionId, 24 * 60 * 60 * 1000);

        if (user.tenantId && user.role !== 'platform_admin') {

            recordWorkspaceAudit(req, {

                tenantId: String(user.tenantId),

                actorId: String(user._id),

                action: isNewGoogleRegistration ? 'auth.signup' : 'auth.login',

                metadata: { authProvider: 'google' },

            });

        }



        setAuthCookie(res, token, user.role);

        res.json({

            token,

            user: {

                id: user._id,

                email: user.email,

                role: user.role,

                tenantId: user.tenantId ?? null,

                name: user.name ?? null,

                profilePicture: user.profilePicture,

                authProvider: user.authProvider || 'google',

                accountStatus: user.accountStatus,

                workspaceName: tenant?.name ?? null,

                emailVerified: user.emailVerified ?? true,

            },

        });

    } catch (error: any) {

        console.error('Google auth error:', error);

        res.status(500).json({ message: error.message });

    }

};



export const signup = async (req: Request, res: Response) => {

    try {

        const {

            email,

            password,

            companyName,

            registrationType,

            acceptTerms,

            termsVersion,

        } = req.body as Record<string, unknown>;



        if (!acceptTerms || termsVersion !== TERMS_VERSION) {

            return res.status(400).json({

                message: 'You must accept the Terms of Service to register.',

            });

        }



        const regType =

            registrationType === 'solo' || registrationType === 'company' ? registrationType : null;

        if (!regType) {

            return res.status(400).json({ message: 'registrationType solo or company is required.' });

        }



        const emailStr = typeof email === 'string' ? email.trim().toLowerCase() : '';

        const passStr = typeof password === 'string' ? password : '';

        const nameStr = typeof companyName === 'string' ? companyName.trim() : '';



        if (!emailStr || !emailStr.includes('@')) {

            return res.status(400).json({ message: 'Valid email required.' });

        }

        const passCheck = validateStrongPassword(passStr);

        if (!passCheck.ok) {

            return res.status(400).json({ message: passCheck.message || 'Invalid password.' });

        }

        if (regType === 'company' && !nameStr) {

            return res.status(400).json({ message: 'Company / workspace name is required.' });

        }

        if (regType === 'company' && isConsumerEmailDomain(emailStr)) {

            return res.status(400).json({ message: COMPANY_REQUIRES_WORK_EMAIL_MESSAGE });

        }



        const displayName = nameStr || emailStr.split('@')[0];



        const existingUser = await User.findOne({ email: emailStr });

        if (existingUser) {

            return res.status(400).json({
                message: 'An account with this email already exists. Please sign in instead.',
            });

        }



        const tenant = await Tenant.create({

            name: displayName,

            registrationType: regType,

        });



        const salt = await bcrypt.genSalt(10);

        const passwordHash = await bcrypt.hash(passStr, salt);



        const user = await User.create({

            email: emailStr,

            passwordHash,

            role: 'business_admin',

            tenantId: tenant._id,

            authProvider: 'local',

            accountStatus: 'active',

            emailVerified: false,

            termsAcceptedAt: new Date(),

            termsVersionAccepted: TERMS_VERSION,

        });



        recordWorkspaceAudit(req, {

            tenantId: String(user.tenantId),

            actorId: String(user._id),

            action: 'auth.signup',

            metadata: { registrationType: regType },

        });

        // Fire-and-forget verification email; don't block signup if email fails.
        void sendEmailVerification(new mongoose.Types.ObjectId(String(user._id)), emailStr, user.name).catch(err =>
            console.warn('[signup] verification email failed:', err),
        );

        const { token, sessionId: signupSessionId } = signAuthToken({
            userId: user._id,
            tenantId: user.tenantId ?? undefined,
            role: user.role,
            workspaceName: tenant.name,
        });

        void createUserSession(req, new mongoose.Types.ObjectId(String(user._id)), signupSessionId, 24 * 60 * 60 * 1000);



        setAuthCookie(res, token, user.role);

        res.status(201).json({

            token,

            user: {

                id: user._id,

                email: user.email,

                role: user.role,

                tenantId: tenant._id,

                name: user.name ?? null,

                profilePicture: user.profilePicture ?? null,

                authProvider: user.authProvider ?? 'local',

                accountStatus: user.accountStatus,

                emailVerified: false,

                workspaceName: tenant.name,

            },

        });

    } catch (error: any) {

        res.status(500).json({ message: error.message });

    }

};



export const login = async (req: Request, res: Response) => {

    try {

        const { email: rawEmail, password } = req.body;
        const email = typeof rawEmail === 'string' ? rawEmail.trim().toLowerCase() : '';



        const user = await User.findOne({ email });

        if (!user) {

            return res.status(400).json({ message: 'Invalid credentials' });

        }



        const isMatch = await bcrypt.compare(password, user.passwordHash);

        if (!isMatch) {

            return res.status(400).json({ message: 'Invalid credentials' });

        }



        let workspaceName: string | null = null;
        if (user.tenantId && user.role !== 'platform_admin') {

            const tn = await Tenant.findById(user.tenantId).select('accessSuspendedUntil name');

            const until = tn?.accessSuspendedUntil;

            if (until && until.getTime() > Date.now()) {

                return res.status(403).json({

                    message: 'This workspace access is temporarily suspended.',

                });

            }

            workspaceName = tn?.name ?? null;

        }



        if (user.accountStatus === 'suspended') {

            return res.status(403).json({ message: 'This account has been suspended.' });

        }

        if (!user.emailVerified && user.authProvider !== 'google') {
            return res.status(403).json({
                message: 'Please verify your email before signing in. Check your inbox for a verification link.',
                code: 'EMAIL_NOT_VERIFIED',
            });
        }



        if (user.tenantId && user.role !== 'platform_admin') {

            recordWorkspaceAudit(req, {

                tenantId: String(user.tenantId),

                actorId: String(user._id),

                action: 'auth.login',

                metadata: { authProvider: user.authProvider ?? 'local' },

            });

        }



        const { token, sessionId: loginSessionId } = signAuthToken({

            userId: user._id,

            tenantId: user.tenantId ?? undefined,

            role: user.role,

            workspaceName: workspaceName ?? undefined,

        });

        void createUserSession(req, new mongoose.Types.ObjectId(String(user._id)), loginSessionId, 24 * 60 * 60 * 1000);



        setAuthCookie(res, token, user.role);

        res.json({

            token,

            user: {

                id: user._id,

                email: user.email,

                role: user.role,

                tenantId: user.tenantId ?? null,

                name: user.name ?? null,

                profilePicture: user.profilePicture ?? null,

                authProvider: user.authProvider ?? 'local',

                accountStatus: user.accountStatus,

                emailVerified: user.emailVerified ?? true,

                workspaceName,

            },

        });

    } catch (error: any) {

        res.status(500).json({ message: error.message });

    }

};



// --- Forgot Password ----------------------------------------------------------

const RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour

export const forgotPassword = async (req: Request, res: Response) => {
    try {
        const { email } = req.body;
        const emailNorm = typeof email === 'string' ? email.trim().toLowerCase() : '';
        if (!emailNorm || !emailNorm.includes('@')) {
            return res.status(400).json({ message: 'A valid email address is required.' });
        }

        const SAFE_RESPONSE = {
            message: 'If that email is registered, you will receive a password reset link shortly.',
        };

        const user = await User.findOne({ email: emailNorm }).lean();
        if (!user) return res.json(SAFE_RESPONSE);

        if (user.authProvider === 'google' && !user.passwordHash) {
            return res.json(SAFE_RESPONSE);
        }

        await PasswordResetToken.deleteMany({ userId: user._id, usedAt: null });

        const rawToken = crypto.randomBytes(32).toString('base64url');
        const tokenHash = crypto.createHash('sha256').update(rawToken, 'utf8').digest('hex');
        const expiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MS);

        await PasswordResetToken.create({ userId: user._id, tokenHash, expiresAt });

        const base = (process.env.FRONTEND_URL || 'http://localhost:5173').replace(/\/$/, '');
        const resetUrl = `${base}/reset-password/${rawToken}`;

        await sendEmail({
            to: [emailNorm],
            subject: 'Reset your ELVA password',
            html: `
                <p>Hi${user.name ? ` ${user.name}` : ''},</p>
                <p>We received a request to reset the password for your ELVA account.</p>
                <p><a href="${resetUrl}" style="display:inline-block;padding:10px 20px;background:#1e3a5f;color:#fff;border-radius:6px;text-decoration:none;font-weight:600;">Reset my password</a></p>
                <p>This link expires in 1 hour and can only be used once. If you did not request a reset, you can safely ignore this email.</p>
                <p style="font-size:12px;color:#888;">Or copy this link: ${resetUrl}</p>
            `,
            fromName: 'ELVA',
            categories: ['elva-password-reset'],
        });

        return res.json(SAFE_RESPONSE);
    } catch (error) {
        console.error('[forgotPassword]', error);
        return res.status(500).json({ message: 'Something went wrong. Please try again.' });
    }
};

// --- Reset Password -----------------------------------------------------------

export const resetPassword = async (req: Request, res: Response) => {
    try {
        const { token: rawToken, password } = req.body;

        if (!rawToken || typeof rawToken !== 'string' || rawToken.length < 20) {
            return res.status(400).json({ message: 'Invalid or missing reset token.' });
        }

        const passCheck = validateStrongPassword(typeof password === 'string' ? password : '');
        if (!passCheck.ok) {
            return res.status(400).json({ message: passCheck.message || 'Password does not meet requirements.' });
        }

        const tokenHash = crypto.createHash('sha256').update(rawToken.trim(), 'utf8').digest('hex');

        const record = await PasswordResetToken.findOne({
            tokenHash,
            usedAt: null,
            expiresAt: { $gt: new Date() },
        });

        if (!record) {
            return res.status(400).json({ message: 'This reset link is invalid or has expired. Please request a new one.' });
        }

        const user = await User.findById(record.userId);
        if (!user) {
            return res.status(404).json({ message: 'User account not found.' });
        }

        const salt = await bcrypt.genSalt(10);
        user.passwordHash = await bcrypt.hash(password, salt);
        await user.save();

        record.usedAt = new Date();
        await record.save();

        // Revoke all active sessions so any stolen JWT becomes invalid immediately.
        await UserSession.updateMany(
            { userId: record.userId, revokedAt: null },
            { revokedAt: new Date() },
        ).catch(err => console.warn('[resetPassword] session revoke failed:', err));

        return res.json({ message: 'Password reset successfully. You can now sign in with your new password.' });
    } catch (error) {
        console.error('[resetPassword]', error);
        return res.status(500).json({ message: 'Something went wrong. Please try again.' });
    }
};

// --- Email Verification -------------------------------------------------------

const EMAIL_VERIFY_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

async function sendEmailVerification(userId: mongoose.Types.ObjectId, emailNorm: string, name?: string | null) {
    await EmailVerificationToken.deleteMany({ userId, usedAt: null });
    const rawToken = crypto.randomBytes(32).toString('base64url');
    const tokenHash = crypto.createHash('sha256').update(rawToken, 'utf8').digest('hex');
    const expiresAt = new Date(Date.now() + EMAIL_VERIFY_TTL_MS);
    await EmailVerificationToken.create({ userId, tokenHash, expiresAt });
    const base = (process.env.FRONTEND_URL || 'http://localhost:5173').replace(/\/$/, '');
    const verifyUrl = `${base}/verify-email/${rawToken}`;
    await sendEmail({
        to: [emailNorm],
        subject: 'Verify your ELVA email address',
        html: `
            <p>Hi${name ? ` ${name}` : ''},</p>
            <p>Welcome to ELVA! Please verify your email address to unlock all features.</p>
            <p><a href="${verifyUrl}" style="display:inline-block;padding:10px 20px;background:#1e3a5f;color:#fff;border-radius:6px;text-decoration:none;font-weight:600;">Verify my email</a></p>
            <p>This link expires in 24 hours.</p>
            <p style="font-size:12px;color:#888;">Or copy this link: ${verifyUrl}</p>
        `,
        fromName: 'ELVA',
        categories: ['elva-email-verification'],
    });
}

export const verifyEmail = async (req: Request, res: Response) => {
    try {
        const { token: rawToken } = req.body as { token?: string };
        if (!rawToken || typeof rawToken !== 'string' || rawToken.length < 20) {
            return res.status(400).json({ message: 'Invalid or missing verification token.' });
        }

        const tokenHash = crypto.createHash('sha256').update(rawToken.trim(), 'utf8').digest('hex');
        const record = await EmailVerificationToken.findOne({
            tokenHash,
            usedAt: null,
            expiresAt: { $gt: new Date() },
        });

        if (!record) {
            return res.status(400).json({ message: 'This verification link is invalid or has expired. Please request a new one.' });
        }

        await User.findByIdAndUpdate(record.userId, { emailVerified: true });
        record.usedAt = new Date();
        await record.save();

        return res.json({ message: 'Email verified successfully.' });
    } catch (error: any) {
        console.error('[verifyEmail]', error);
        return res.status(500).json({ message: 'Something went wrong. Please try again.' });
    }
};

export const resendVerification = async (req: Request, res: Response) => {
    try {
        const { email } = req.body as { email?: string };
        const emailNorm = typeof email === 'string' ? email.trim().toLowerCase() : '';
        if (!emailNorm || !emailNorm.includes('@')) {
            return res.status(400).json({ message: 'A valid email address is required.' });
        }

        const SAFE = { message: 'If your account exists and the email is unverified, a new link has been sent.' };

        const user = await User.findOne({ email: emailNorm }).lean();
        if (!user || user.emailVerified) return res.json(SAFE);

        await sendEmailVerification(new mongoose.Types.ObjectId(String(user._id)), emailNorm, user.name);
        return res.json(SAFE);
    } catch (error: any) {
        console.error('[resendVerification]', error);
        return res.status(500).json({ message: 'Something went wrong. Please try again.' });
    }
};

/** GET /api/auth/session — restore client session from HttpOnly cookie or Bearer token. */
export const getSession = async (req: AuthRequest, res: Response) => {
    try {
        const auth = req.user;
        if (!auth?.userId) {
            return res.status(401).json({ message: 'Not authorized' });
        }

        const user = await User.findById(auth.userId).lean();
        if (!user) {
            return res.status(401).json({ message: 'Account no longer exists.' });
        }

        let workspaceName: string | null = null;
        if (user.tenantId && user.role !== 'platform_admin') {
            const tn = await Tenant.findById(user.tenantId).select('name').lean();
            workspaceName = tn?.name ?? null;
        }

        return res.json({
            user: {
                id: user._id,
                email: user.email,
                role: user.role,
                tenantId: user.tenantId ?? null,
                name: user.name ?? null,
                profilePicture: user.profilePicture ?? null,
                authProvider: user.authProvider ?? 'local',
                accountStatus: user.accountStatus,
                emailVerified: user.emailVerified ?? true,
                workspaceName,
            },
        });
    } catch (error: unknown) {
        console.error('[getSession]', error);
        return res.status(500).json({ message: 'Server error' });
    }
};

/** POST /api/auth/logout — clear HttpOnly cookie (no auth required). */
export const logout = async (_req: Request, res: Response) => {
    clearAuthCookie(res);
    return res.json({ message: 'Signed out' });
};
