import { VoiceSession } from './voiceModels';
import { PLAN_LIMITS, PlanType } from '../models';
import { Tenant } from '../models';
import { terminalLog } from '../utils/terminalLog';
import { isDbConnected } from '../config/db';

const DEFAULT_MAX_CONCURRENT: Record<PlanType, number> = {
    free: 0,
    starter: 0,
    pro: 3,
    enterprise: 10,
};

/** Sessions stuck in-progress longer than this are not counted as active. */
const STALE_IN_PROGRESS_MS = parseInt(
    process.env.VOICE_STALE_SESSION_MS || String(15 * 60 * 1000),
    10,
);

function planConcurrentLimit(plan: PlanType): number {
    const envKey = `VOICE_MAX_CONCURRENT_${plan.toUpperCase()}`;
    const envVal = process.env[envKey];
    if (envVal != null && envVal !== '') {
        const n = parseInt(envVal, 10);
        if (Number.isFinite(n) && n >= 0) return n;
    }
    return DEFAULT_MAX_CONCURRENT[plan] ?? 1;
}

/** Mark ancient in-progress rows as completed so they do not block new calls. */
export async function reapStaleVoiceSessions(tenantId?: string): Promise<number> {
    if (!isDbConnected()) {
        return 0;
    }

    try {
        const cutoff = new Date(Date.now() - STALE_IN_PROGRESS_MS);
        const filter: Record<string, unknown> = {
            status: 'in-progress',
            updatedAt: { $lt: cutoff },
        };
        if (tenantId) filter.tenantId = tenantId;

        const result = await VoiceSession.updateMany(filter, {
            $set: {
                status: 'completed',
                endReason: 'unknown',
                endedAt: new Date(),
            },
        });

        const n = result.modifiedCount || 0;
        if (n > 0) {
            terminalLog.dim(`Reaped ${n} stale in-progress voice session(s)`);
        }
        return n;
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        terminalLog.warn('Voice', `Could not reap stale sessions: ${msg}`);
        return 0;
    }
}

export async function countActiveVoiceCalls(
    tenantId: string,
    excludeCallSid?: string,
): Promise<number> {
    await reapStaleVoiceSessions(tenantId);

    const cutoff = new Date(Date.now() - STALE_IN_PROGRESS_MS);
    const filter: Record<string, unknown> = {
        tenantId,
        status: 'in-progress',
        updatedAt: { $gte: cutoff },
    };
    if (excludeCallSid) {
        filter.callSid = { $ne: excludeCallSid };
    }

    return VoiceSession.countDocuments(filter);
}

export async function canAcceptVoiceCall(
    tenantId: string,
    excludeCallSid?: string,
): Promise<{
    allowed: boolean;
    active: number;
    limit: number;
    reason?: string;
}> {
    const tenant = await Tenant.findById(tenantId).select('plan').lean();
    const plan = (tenant?.plan as PlanType) || 'free';
    const limits = PLAN_LIMITS[plan] || PLAN_LIMITS.free;

    if (!limits.voiceEnabled) {
        return { allowed: false, active: 0, limit: 0, reason: 'Voice not enabled on your plan.' };
    }

    const limit = planConcurrentLimit(plan);
    if (limit <= 0) {
        return { allowed: false, active: 0, limit: 0, reason: 'Voice concurrent limit is zero.' };
    }

    const active = await countActiveVoiceCalls(tenantId, excludeCallSid);
    if (active >= limit) {
        terminalLog.warn(
            'VOICE',
            `Concurrency block tenant=${tenantId.slice(0, 8)}… active=${active} limit=${limit}`,
        );
        return {
            allowed: false,
            active,
            limit,
            reason: `Maximum ${limit} simultaneous voice calls reached. Please try again shortly.`,
        };
    }

    return { allowed: true, active, limit };
}
