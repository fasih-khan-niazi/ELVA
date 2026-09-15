import { Response } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import Stripe from 'stripe';
import axios from 'axios';
import mongoose from 'mongoose';
import { AuthRequest } from '../middleware/authMiddleware';
import {
    Agent,
    PLAN_LIMITS,
    Subscription,
    Tenant,
    User,
} from '../models';
import { TERMS_VERSION } from '../constants/legal';
import { signAuthToken } from '../utils/signUserJwt';

const stripeSecret = process.env.STRIPE_SECRET_KEY || '';
const stripe = stripeSecret
    ? new Stripe(stripeSecret, { apiVersion: '2023-10-16' })
    : null;

const AI_SERVICE_ORIGIN =
    process.env.AI_SERVICE_URL?.trim() ||
    process.env.AI_SERVICE_BASE?.trim() ||
    'http://127.0.0.1:8000';

/** Matches provisioned ELVA Ops exploration tenants (flag or legacy name). */
function sandboxTenantPredicate(): { $or: Record<string, unknown>[] } {
    return {
        $or: [
            { platformExplorationSandbox: true },
            { name: { $regex: '^ELVA Ops Sandbox', $options: 'i' } },
        ],
    };
}

/** Tenants included in platform aggregates and workspace admin table. */
function realWorkspaceTenantPredicate(): { $nor: Record<string, unknown>[] } {
    return {
        $nor: [
            { platformExplorationSandbox: true },
            { name: { $regex: '^ELVA Ops Sandbox', $options: 'i' } },
        ],
    };
}

async function sandboxTenantIds(): Promise<mongoose.Types.ObjectId[]> {
    const rows = await Tenant.find(sandboxTenantPredicate()).select('_id').lean();
    return rows.map((r) => r._id as mongoose.Types.ObjectId);
}

async function pingAiService(): Promise<boolean> {
    try {
        const url = `${AI_SERVICE_ORIGIN.replace(/\/$/, '')}/health`;
        const r = await axios.get(url, { timeout: 2500 });
        return r.status < 500;
    } catch {
        return false;
    }
}

export async function platformHealth(_req: AuthRequest, res: Response): Promise<void> {
    const mongoConnected = mongoose.connection.readyState === 1;
    const aiUp = await pingAiService();
    const stripeConfigured = Boolean(stripeSecret);

    let stripeReachable = false;
    if (stripe) {
        try {
            await stripe.balance.retrieve();
            stripeReachable = true;
        } catch {
            stripeReachable = false;
        }
    }

    const emailOutbound = Boolean(
        process.env.SENDGRID_API_KEY && process.env.SENDGRID_FROM_EMAIL,
    );

    res.json({
        status: mongoConnected ? 'ok' : 'degraded',
        mongo: mongoConnected ? 'connected' : 'disconnected',
        aiServiceHttp: aiUp ? 'reachable' : 'unreachable',
        stripe: {
            configured: stripeConfigured,
            apiReachable: stripeReachable || !stripeConfigured,
        },
        emailOutbound: emailOutbound ? 'configured' : 'not_configured',
        aiServiceOrigin: AI_SERVICE_ORIGIN,
        timestamp: new Date().toISOString(),
    });
}

function estimatedMonthlyRecurringUsd(plan: keyof typeof PLAN_LIMITS): number {
    return PLAN_LIMITS[plan]?.price ?? 0;
}

/** Cross-tenant summary for platform dashboard. Revenue is indicative (plan list prices × active paid workspaces), not Stripe cash accounting. */
export async function platformOverview(_req: AuthRequest, res: Response): Promise<void> {
    const excl = await sandboxTenantIds();
    const tenantQuery = excl.length ? { _id: { $nin: excl } } : {};

    const totalTenants = await Tenant.countDocuments(tenantQuery);

    const userQuery: Record<string, unknown> = {
        role: { $ne: 'platform_admin' },
    };
    if (excl.length) {
        userQuery.tenantId = { $nin: excl };
    }
    const totalUsers = await User.countDocuments(userQuery);

    const agentQuery = excl.length ? { tenantId: { $nin: excl } } : {};
    const totalAgents = await Agent.countDocuments(agentQuery);

    const platformAdmins = await User.countDocuments({ role: 'platform_admin' });

    const subFind = excl.length ? { tenantId: { $nin: excl } } : {};
    const subs = await Subscription.find(subFind).select('plan status').lean();

    let activePaidSubs = 0;
    let approxMrrUsd = 0;
    let freeSubs = 0;
    let canceledSubs = 0;

    for (const s of subs) {
        if (s.status === 'canceled') {
            canceledSubs += 1;
            continue;
        }
        if (s.plan === 'free') {
            freeSubs += 1;
            continue;
        }
        activePaidSubs += 1;
        approxMrrUsd += estimatedMonthlyRecurringUsd(s.plan as keyof typeof PLAN_LIMITS);
    }

    res.json({
        totals: {
            tenants: totalTenants,
            workspaceUsers: totalUsers,
            agents: totalAgents,
            platformAdmins,
            subscriptions: subs.length,
        },
        subscriptionBreakdown: {
            freeEstimate: freeSubs,
            paidApprox: activePaidSubs,
            canceled: canceledSubs,
            approximateMRRUsdAcrossPlans: Number(approxMrrUsd.toFixed(2)),
        },
        assumptions:
            'MRR approximation uses static plan prices from PLAN_LIMITS × active paid rows; not Stripe invoiced totals. Exploration sandboxes are excluded from counts.',
    });
}

export async function platformListTenants(req: AuthRequest, res: Response): Promise<void> {
    try {
        const rawLimit = req.query.limit;
        const limit = Math.min(Number(rawLimit) || 75, 200);
        const tenants = await Tenant.find(realWorkspaceTenantPredicate())
            .sort({ createdAt: -1 })
            .limit(limit)
            .lean();

        const out = [];

        for (const t of tenants) {
            const tid = String(t._id);
            const [memberCount, sub] = await Promise.all([
                User.countDocuments({ tenantId: t._id, role: { $ne: 'platform_admin' } }),
                Subscription.findOne({ tenantId: t._id }).lean(),
            ]);

            const suspendedUntilRaw = (
                t as { accessSuspendedUntil?: Date | string }
            ).accessSuspendedUntil;
            const suspendedUntil =
                suspendedUntilRaw != null ? new Date(suspendedUntilRaw) : undefined;

            out.push({
                id: tid,
                name: t.name,
                plan: t.plan,
                registrationType: t.registrationType,
                stripeCustomerId: t.stripeCustomerId,
                reportingCurrency: t.reportingCurrency || 'USD',
                createdAt: t.createdAt,
                memberCount,
                accessSuspendedUntil: suspendedUntil ?? null,
                subscription: sub
                    ? {
                          plan: sub.plan,
                          status: sub.status,
                          stripeSubscriptionId: sub.stripeSubscriptionId,
                          cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
                          currentPeriodEnd: sub.currentPeriodEnd,
                      }
                    : null,
            });
        }

        res.json({ tenants: out });
    } catch (e: unknown) {
        console.error('[platformListTenants]', e);
        res.status(500).json({ message: 'Failed to load tenants.' });
    }
}

export async function suspendTenantAccess(req: AuthRequest, res: Response): Promise<void> {
    try {
        const { tenantId } = req.params;
        const rawUntil =
            typeof req.body?.accessSuspendedUntil === 'string'
                ? req.body.accessSuspendedUntil
                : null;

        if (!tenantId || !mongoose.isValidObjectId(tenantId)) {
            res.status(400).json({ message: 'Invalid tenant.' });
            return;
        }

        let untilDate: Date | null = null;
        if (!rawUntil) {
            untilDate = null;
        } else {
            untilDate = new Date(rawUntil);
            if (Number.isNaN(untilDate.getTime())) {
                res.status(400).json({ message: 'Invalid accessSuspendedUntil ISO date.' });
                return;
            }
            if (untilDate.getTime() <= Date.now()) {
                res.status(400).json({ message: 'Suspension end must be in the future.' });
                return;
            }
        }

        const updated = untilDate
            ? await Tenant.findByIdAndUpdate(
                  tenantId,
                  { accessSuspendedUntil: untilDate },
                  { new: true },
              ).select('_id accessSuspendedUntil')
            : await Tenant.findByIdAndUpdate(
                  tenantId,
                  { $unset: { accessSuspendedUntil: 1 } },
                  { new: true },
              ).select('_id accessSuspendedUntil');

        if (!updated) {
            res.status(404).json({ message: 'Tenant not found.' });
            return;
        }

        res.json({
            message: untilDate
                ? 'Workspace login suspension scheduled.'
                : 'Workspace login suspension lifted.',
            tenantId: String(updated._id),
            accessSuspendedUntil: updated.accessSuspendedUntil ?? null,
        });
    } catch (e: unknown) {
        console.error('[suspendTenantAccess]', e);
        res.status(500).json({ message: 'Could not update tenant.' });
    }
}

export async function cancelTenantSubscriptionNow(req: AuthRequest, res: Response): Promise<void> {
    try {
        const { tenantId } = req.params;
        if (!tenantId || !mongoose.isValidObjectId(tenantId)) {
            res.status(400).json({ message: 'Invalid tenant.' });
            return;
        }

        if (!stripe) {
            res.status(503).json({ message: 'Stripe is not configured on this deployment.' });
            return;
        }

        const subscription = await Subscription.findOne({
            tenantId,
        }).lean();

        if (!subscription?.stripeSubscriptionId) {
            res.status(400).json({ message: 'No Stripe subscription tied to this workspace.' });
            return;
        }

        await stripe.subscriptions.cancel(subscription.stripeSubscriptionId);
        await Subscription.updateOne(
            { _id: subscription._id },
            {
                $set: {
                    status: 'canceled',
                    plan: 'free',
                    cancelAtPeriodEnd: false,
                    stripeSubscriptionId: null,
                    stripePriceId: null,
                },
            },
        );

        await Tenant.findByIdAndUpdate(tenantId, { plan: 'free' });

        res.json({ message: 'Stripe subscription canceled immediately; workspace placed on Free plan.', tenantId });
    } catch (e: unknown) {
        console.error('[cancelTenantSubscriptionNow]', e);
        const msg = e instanceof Error ? e.message : 'Stripe error';
        res.status(500).json({ message: msg });
    }
}

interface CreateTenantBody {
    registrationType?: 'solo' | 'company';
    organizationName?: string;
    adminEmail?: string;
    adminName?: string;
}

export async function platformCreateTenant(req: AuthRequest, res: Response): Promise<void> {
    try {
        const body = req.body as CreateTenantBody;
        const regType = body.registrationType;
        let orgName =
            typeof body.organizationName === 'string' ? body.organizationName.trim() : '';
        const adminEmailNorm = String(body.adminEmail || '')
            .trim()
            .toLowerCase();

        const adminDisplayName =
            typeof body.adminName === 'string' && body.adminName.trim()
                ? body.adminName.trim()
                : adminEmailNorm.split('@')[0];

        if (!regType || (regType !== 'solo' && regType !== 'company')) {
            res.status(400).json({ message: 'registrationType must be solo or company.' });
            return;
        }
        if (!adminEmailNorm || !adminEmailNorm.includes('@')) {
            res.status(400).json({ message: 'adminEmail required.' });
            return;
        }
        if (regType === 'company' && !orgName) {
            res.status(400).json({
                message: 'organizationName required for company workspace.',
            });
            return;
        }
        if (regType === 'solo' && !orgName) {
            orgName = adminDisplayName;
        }

        const existingUser = await User.findOne({ email: adminEmailNorm });
        if (existingUser) {
            res.status(409).json({ message: 'A user with this email already exists.' });
            return;
        }

        const plaintextPassword =
            crypto.randomBytes(28).toString('base64url').slice(0, 42) +
            `$Aa2${crypto.randomBytes(6).toString('hex')}Z`;
        const passwordHash = await bcrypt.hash(plaintextPassword, 12);

        const tenant = await Tenant.create({
            name: orgName,
            registrationType: regType,
        });

        await User.create({
            email: adminEmailNorm,
            passwordHash,
            role: 'business_admin',
            tenantId: tenant._id,
            authProvider: 'local',
            name: adminDisplayName,
            accountStatus: 'active',
            termsAcceptedAt: new Date(),
            termsVersionAccepted: TERMS_VERSION,
        });

        await Subscription.create({
            tenantId: tenant._id,
            plan: 'free',
            status: 'active',
        });

        res.status(201).json({
            message: 'Workspace created.',
            tenant: {
                id: String(tenant._id),
                name: tenant.name,
                registrationType: regType,
            },
            workspaceAdminEmail: adminEmailNorm,
            oneTimePasswordPlaintextShowOnceOnly: plaintextPassword,
        });
    } catch (e: unknown) {
        console.error('[platformCreateTenant]', e);
        res.status(500).json({ message: 'Failed to create workspace.' });
    }
}

/**
 * Provision (once) or reuse sandbox workspace and return a normal tenant JWT for the sandbox business_admin.
 */
export async function platformStartSandboxExploration(req: AuthRequest, res: Response): Promise<void> {
    try {
        const platformUserId = req.user!.userId;
        const operator = await User.findById(platformUserId).select(
            '_id email role sandboxWorkspaceUserId accountStatus',
        );
        if (!operator || operator.role !== 'platform_admin') {
            res.status(403).json({ message: 'Operators only.' });
            return;
        }

        let sandboxUserDoc =
            operator.sandboxWorkspaceUserId != null
                ? await User.findById(operator.sandboxWorkspaceUserId)
                : null;

        if (!sandboxUserDoc) {
            let internalPrefix =
                typeof operator.email === 'string'
                    ? `ops.explorer.${operator._id}.${operator.email.replace(/[^a-z0-9@._+-]/gi, '')}`
                    : `ops.explorer.${operator._id}`;
            internalPrefix = internalPrefix.slice(0, 200);
            let uniqueEmail = `${internalPrefix}@sandbox.invalid`;

            while (await User.findOne({ email: uniqueEmail })) {
                uniqueEmail = `${String(operator._id)}.${crypto.randomBytes(10).toString('hex')}@sandbox.invalid`;
            }

            const sandboxTenant = await Tenant.create({
                name:
                    typeof operator.email === 'string'
                        ? `ELVA Ops Sandbox (${operator.email.split('@')[0].slice(0, 42)})`
                        : 'ELVA Ops Sandbox',
                plan: 'pro',
                registrationType: 'solo',
                platformExplorationSandbox: true,
            });

            const randomPw = crypto.randomBytes(32).toString('hex');

            sandboxUserDoc = await User.create({
                email: uniqueEmail,
                passwordHash: await bcrypt.hash(randomPw, 12),
                role: 'business_admin',
                tenantId: sandboxTenant._id,
                authProvider: 'local',
                accountStatus: 'active',
                termsAcceptedAt: new Date(),
                termsVersionAccepted: TERMS_VERSION,
                name: 'ELVA Sandbox Admin',
            });

            await Subscription.create({
                tenantId: sandboxTenant._id,
                plan: 'pro',
                status: 'active',
            });

            operator.sandboxWorkspaceUserId =
                sandboxUserDoc._id as mongoose.Types.ObjectId;
            await operator.save();
        } else {
            const tid = sandboxUserDoc.tenantId;
            if (tid) {
                await Tenant.updateOne(
                    { _id: tid },
                    {
                        $set: {
                            platformExplorationSandbox: true,
                            plan: 'pro',
                        },
                    },
                );
                const existingSub = await Subscription.findOne({ tenantId: tid });
                if (existingSub) {
                    await Subscription.updateOne(
                        { _id: existingSub._id },
                        { $set: { plan: 'pro', status: 'active' } },
                    );
                } else {
                    await Subscription.create({
                        tenantId: tid,
                        plan: 'pro',
                        status: 'active',
                    });
                }
            }
        }

        const { token: sandboxToken } = signAuthToken({
            userId: sandboxUserDoc!._id,
            tenantId: sandboxUserDoc!.tenantId ?? undefined,
            role: sandboxUserDoc!.role,
            expiresIn: '1d',
        });

        res.json({
            token: sandboxToken,
            user: {
                id: sandboxUserDoc!._id,
                email: sandboxUserDoc!.email,
                role: sandboxUserDoc!.role,
                tenantId: sandboxUserDoc!.tenantId ? String(sandboxUserDoc!.tenantId) : null,
                name: sandboxUserDoc!.name ?? null,
                profilePicture: sandboxUserDoc!.profilePicture ?? null,
                authProvider: sandboxUserDoc!.authProvider ?? 'local',
                accountStatus: sandboxUserDoc!.accountStatus,
            },
            message:
                'Use this workspace session to explore the product. Keep your operator JWT offline to return to /platform afterward.',
        });
    } catch (e: unknown) {
        console.error('[platformStartSandboxExploration]', e);
        res.status(500).json({ message: 'Could not create sandbox exploration session.' });
    }
}
