import mongoose from 'mongoose';
import { User, Subscription, Tenant, PlanType } from '../models';
import { Invite } from '../models/Invite';
import { PLAN_LIMITS } from '../models';

/** -1 means unlimited teammate seats */
export function maxSeatsForPlan(plan: PlanType): number {
    return PLAN_LIMITS[plan]?.maxSeats ?? 1;
}

export async function countTenantUsers(tenantId: mongoose.Types.ObjectId | string): Promise<number> {
    return User.countDocuments({
        tenantId,
        role: { $in: ['business_admin', 'member'] },
        accountStatus: 'active',
    });
}

/** Plan seat usage: active workspace users + outstanding (non-revoked, non-expired) invites. */
export async function getTenantSeatSnapshot(
    tenantId: mongoose.Types.ObjectId | string,
): Promise<{ plan: PlanType; limit: number; used: number; pending: number }> {
    const tid =
        typeof tenantId === 'string' ? new mongoose.Types.ObjectId(tenantId) : tenantId;

    const sub = await Subscription.findOne({ tenantId: tid }).lean();
    const tenant = await Tenant.findById(tid).select('plan').lean();
    const plan = (sub?.plan || tenant?.plan || 'free') as PlanType;
    const limit = maxSeatsForPlan(plan);
    const used = await countTenantUsers(tid);
    const now = new Date();
    const pending = await Invite.countDocuments({
        tenantId: tid,
        consumedAt: null,
        revokedAt: null,
        expiresAt: { $gt: now },
    });
    return { plan, limit, used, pending };
}
