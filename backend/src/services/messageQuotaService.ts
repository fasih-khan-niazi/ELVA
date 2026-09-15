import { Subscription, PLAN_LIMITS, PlanType } from '../models';

export type MessageQuotaResult =
    | { ok: true; subscription: InstanceType<typeof Subscription> }
    | { ok: false; status: number; body: Record<string, unknown> };

async function loadSubscriptionForTenant(tenantId: string) {
    let subscription = await Subscription.findOne({ tenantId });
    if (!subscription) {
        subscription = await Subscription.create({
            tenantId,
            plan: 'free',
            status: 'active',
        });
    }

    const now = new Date();
    const lastReset = new Date(subscription.lastMessageCountReset);
    if (now.getMonth() !== lastReset.getMonth() || now.getFullYear() !== lastReset.getFullYear()) {
        subscription.messagesUsedThisMonth = 0;
        subscription.lastMessageCountReset = now;
        await subscription.save();
    }

    return subscription;
}

/** Check monthly message quota without consuming. */
export async function checkMessageQuotaForTenant(tenantId: string): Promise<MessageQuotaResult> {
    const subscription = await loadSubscriptionForTenant(tenantId);
    const limits = PLAN_LIMITS[subscription.plan as PlanType];

    if (limits.maxMessagesPerMonth === -1) {
        return { ok: true, subscription };
    }

    if (subscription.messagesUsedThisMonth >= limits.maxMessagesPerMonth) {
        const now = new Date();
        return {
            ok: false,
            status: 403,
            body: {
                message: 'Monthly message limit reached',
                error: 'MESSAGE_LIMIT_REACHED',
                limit: limits.maxMessagesPerMonth,
                used: subscription.messagesUsedThisMonth,
                resetsAt: new Date(now.getFullYear(), now.getMonth() + 1, 1),
                upgrade: true,
            },
        };
    }

    return { ok: true, subscription };
}

/** Increment message usage after a successful AI turn. */
export async function consumeMessageForTenant(tenantId: string): Promise<boolean> {
    const subscription = await loadSubscriptionForTenant(tenantId);
    const limits = PLAN_LIMITS[subscription.plan as PlanType];

    if (limits.maxMessagesPerMonth !== -1) {
        if (subscription.messagesUsedThisMonth >= limits.maxMessagesPerMonth) {
            return false;
        }
    }

    subscription.messagesUsedThisMonth += 1;
    await subscription.save();
    return true;
}

/** @deprecated Use checkMessageQuotaForTenant + consumeMessageForTenant after success. */
export async function tryConsumeMessageForTenant(
    tenantId: string,
): Promise<{ ok: true } | { ok: false; status: number; body: Record<string, unknown> }> {
    const check = await checkMessageQuotaForTenant(tenantId);
    if (!check.ok) return check;
    await consumeMessageForTenant(tenantId);
    return { ok: true };
}
