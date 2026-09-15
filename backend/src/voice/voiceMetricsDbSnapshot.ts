/**
 * Tenant-scoped metrics snapshot from MongoDB (VoiceTurn + VoiceSession).
 */

import mongoose from 'mongoose';
import { VoiceSession, VoiceTurn } from './voiceModels';
import { VOICE_MVP_KPI_TARGETS } from './voiceContract';
import type { MetricsSnapshot } from './voiceMetricsCollector';

function percentile(sorted: number[], p: number): number {
    if (sorted.length === 0) return 0;
    const idx = Math.ceil((p / 100) * sorted.length) - 1;
    return sorted[Math.max(0, idx)];
}

function floorTs(ts: number, bucketMs: number): number {
    return Math.floor(ts / bucketMs) * bucketMs;
}

/** Chart bucket size (ms) - avoid minute-by-minute series for long windows. */
function bucketMsForWindow(windowMinutes: number | null): number {
    if (windowMinutes === null) return 7 * 24 * 60 * 60 * 1000; // lifetime: weekly buckets
    const w = windowMinutes;
    if (w <= 24 * 60) return 60_000;
    if (w <= 7 * 24 * 60) return 3600_000;
    if (w <= 30 * 24 * 60) return 6 * 3600_000;
    return 86400_000;
}

function emptyTenantSnapshot(
    windowRollingMinutes: number,
    lifetime: boolean,
): MetricsSnapshot {
    const now = Date.now();
    const nowDate = new Date(now);
    return {
        windowMinutes: lifetime ? 0 : windowRollingMinutes,
        isLifetime: lifetime ? true : undefined,
        fromTs: lifetime ? nowDate.toISOString() : new Date(now - windowRollingMinutes * 60_000).toISOString(),
        toTs: nowDate.toISOString(),
        totalTurns: 0,
        sloCompliance: 0,
        errorRate: 0,
        latencyP50: 0,
        latencyP90: 0,
        latencyP99: 0,
        latencyAvg: 0,
        latencyMin: 0,
        latencyMax: 0,
        activeCalls: 0,
        callsStarted: 0,
        callsEnded: 0,
        phoneTurns: 0,
        webTurns: 0,
        kpiTargets: VOICE_MVP_KPI_TARGETS,
        timeSeries: [],
    };
}

interface TurnRow {
    latencyMs: number;
    sloOk: boolean;
    error?: string | null;
    createdAt: Date;
    channel: 'phone' | 'web';
}

/**
 * Aggregate metrics for a tenant - rolling window in minutes, or null for lifetime.
 */
export async function buildTenantMetricsSnapshot(
    tenantId: string,
    windowMinutes: number | null,
): Promise<MetricsSnapshot> {
    const lifetime = windowMinutes === null;

    if (!tenantId || !mongoose.Types.ObjectId.isValid(tenantId)) {
        return emptyTenantSnapshot(lifetime ? 0 : (windowMinutes ?? 60), lifetime);
    }

    const oid = new mongoose.Types.ObjectId(tenantId);
    const now = Date.now();
    const nowDate = new Date(now);
    let windowLabelMinutes = lifetime ? 0 : Math.floor(windowMinutes as number);

    let sinceTime: Date;
    if (lifetime) {
        sinceTime = new Date(0);
    } else {
        sinceTime = new Date(now - windowLabelMinutes * 60_000);
    }

    const sids = await VoiceSession.distinct('callSid', { tenantId: oid });
    if (sids.length === 0) {
        return {
            ...emptyTenantSnapshot(windowLabelMinutes, lifetime),
            fromTs: lifetime ? nowDate.toISOString() : sinceTime.toISOString(),
            toTs: nowDate.toISOString(),
        };
    }

    const turnQuery: Record<string, unknown> = { callSid: { $in: sids } };
    if (!lifetime) turnQuery.createdAt = { $gte: sinceTime };

    const rawTurns = await VoiceTurn.find(turnQuery)
        .select('latencyMs sloOk error createdAt callSid')
        .lean();

    const sessionsForChannel = await VoiceSession.find({ tenantId: oid })
        .select('callSid channel')
        .lean();
    const channelBySid = new Map<string, 'phone' | 'web'>();
    for (const s of sessionsForChannel) {
        channelBySid.set(s.callSid, (s.channel as 'phone' | 'web') || 'phone');
    }

    const turnRows: TurnRow[] = rawTurns.map((t) => ({
        latencyMs: t.latencyMs ?? 0,
        sloOk: Boolean(t.sloOk),
        error: t.error,
        createdAt: t.createdAt instanceof Date ? t.createdAt : new Date(t.createdAt),
        channel: channelBySid.get(t.callSid) || 'phone',
    }));

    const allLatencies: number[] = turnRows.map((r) => r.latencyMs).sort((a, b) => a - b);
    const totalTurns = turnRows.length;
    const sloOkTurns = turnRows.filter((r) => r.sloOk).length;
    const errorTurns = turnRows.filter((r) => r.error && String(r.error).trim().length > 0).length;
    let phoneTurns = 0;
    let webTurns = 0;
    for (const r of turnRows) {
        if (r.channel === 'web') webTurns += 1;
        else phoneTurns += 1;
    }

    const sessionFilter: Record<string, unknown> = { tenantId: oid };
    if (!lifetime) {
        sessionFilter.$or = [{ startedAt: { $gte: sinceTime } }, { endedAt: { $gte: sinceTime } }];
    }

    const [activeCalls, callsStartedCount, callsEndedCount, sessionsForSeries] = await Promise.all([
        VoiceSession.countDocuments({ tenantId: oid, status: 'in-progress' }),
        lifetime
            ? VoiceSession.countDocuments({ tenantId: oid })
            : VoiceSession.countDocuments({ tenantId: oid, startedAt: { $gte: sinceTime } }),
        lifetime
            ? VoiceSession.countDocuments({ tenantId: oid, endedAt: { $exists: true, $ne: null } })
            : VoiceSession.countDocuments({ tenantId: oid, endedAt: { $gte: sinceTime } }),
        VoiceSession.find(sessionFilter).select('startedAt endedAt').lean(),
    ]);

    const cutoffMs = lifetime ? 0 : sinceTime.getTime();
    let seriesStartMs = cutoffMs;

    const bucketMs = bucketMsForWindow(lifetime ? null : windowMinutes ?? null);

    if (totalTurns > 0) {
        const earliestTurn = Math.min(...turnRows.map((r) => r.createdAt.getTime()));
        seriesStartMs = lifetime ? earliestTurn : Math.max(seriesStartMs, Math.min(earliestTurn, now));
    }

    const buckets = new Map<
        number,
        {
            latencies: number[];
            totalTurns: number;
            sloOkTurns: number;
            errorTurns: number;
            callsStarted: number;
            callsEnded: number;
        }
    >();

    const seriesEnd = floorTs(now, bucketMs);
    let tk = floorTs(seriesStartMs, bucketMs);

    const maxBuckets = 600;
    let bCount = 0;
    while (tk <= seriesEnd && bCount < maxBuckets) {
        buckets.set(tk, {
            latencies: [],
            totalTurns: 0,
            sloOkTurns: 0,
            errorTurns: 0,
            callsStarted: 0,
            callsEnded: 0,
        });
        tk += bucketMs;
        bCount += 1;
    }

    for (const r of turnRows) {
        const tms = r.createdAt.getTime();
        const mk = floorTs(tms, bucketMs);
        const b = buckets.get(mk);
        if (!b) continue;
        b.latencies.push(r.latencyMs);
        b.totalTurns += 1;
        if (r.sloOk) b.sloOkTurns += 1;
        if (r.error && String(r.error).trim().length > 0) b.errorTurns += 1;
    }

    for (const s of sessionsForSeries) {
        const sta = s.startedAt instanceof Date ? s.startedAt.getTime() : new Date(s.startedAt).getTime();
        if (lifetime || sta >= cutoffMs) {
            const bk = floorTs(sta, bucketMs);
            const bb = buckets.get(bk);
            if (bb) bb.callsStarted += 1;
        }
        if (s.endedAt) {
            const en = s.endedAt instanceof Date ? s.endedAt.getTime() : new Date(s.endedAt).getTime();
            if (lifetime || en >= cutoffMs) {
                const bk = floorTs(en, bucketMs);
                const eb = buckets.get(bk);
                if (eb) eb.callsEnded += 1;
            }
        }
    }

    let fromTsIso: string;
    if (lifetime) {
        let minEvt = now;
        for (const r of turnRows) {
            minEvt = Math.min(minEvt, r.createdAt.getTime());
        }
        for (const s of sessionsForSeries) {
            const st = s.startedAt instanceof Date ? s.startedAt.getTime() : new Date(s.startedAt).getTime();
            minEvt = Math.min(minEvt, st);
        }
        fromTsIso =
            totalTurns > 0 || sessionsForSeries.length > 0
                ? new Date(minEvt === now ? 0 : minEvt).toISOString()
                : nowDate.toISOString();
    } else {
        fromTsIso = sinceTime.toISOString();
    }

    const timeSeries = [...buckets.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([minuteTs, b]) => {
            const bAvg =
                b.latencies.length > 0
                    ? Math.round(b.latencies.reduce((sx, v) => sx + v, 0) / b.latencies.length)
                    : 0;
            return {
                ts: new Date(minuteTs).toISOString(),
                turns: b.totalTurns,
                avgLatency: bAvg,
                errorCount: b.errorTurns,
                sloOk: b.sloOkTurns,
                callsStarted: b.callsStarted,
                callsEnded: b.callsEnded,
            };
        });

    const avg =
        allLatencies.length > 0
            ? Math.round(allLatencies.reduce((sx, v) => sx + v, 0) / allLatencies.length)
            : 0;

    return {
        windowMinutes: lifetime ? 0 : windowLabelMinutes,
        isLifetime: lifetime ? true : undefined,
        fromTs: fromTsIso,
        toTs: nowDate.toISOString(),
        totalTurns,
        sloCompliance: totalTurns > 0 ? sloOkTurns / totalTurns : 0,
        errorRate: totalTurns > 0 ? errorTurns / totalTurns : 0,
        latencyP50: percentile(allLatencies, 50),
        latencyP90: percentile(allLatencies, 90),
        latencyP99: percentile(allLatencies, 99),
        latencyAvg: avg,
        latencyMin: allLatencies.length > 0 ? allLatencies[0] : 0,
        latencyMax: allLatencies.length > 0 ? allLatencies[allLatencies.length - 1] : 0,
        activeCalls,
        callsStarted: callsStartedCount,
        callsEnded: callsEndedCount,
        phoneTurns,
        webTurns,
        kpiTargets: VOICE_MVP_KPI_TARGETS,
        timeSeries,
    };
}
