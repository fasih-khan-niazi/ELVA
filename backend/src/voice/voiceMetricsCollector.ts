/**
 * voiceMetricsCollector.ts - In-memory real-time voice metrics
 *
 * Collects per-turn and per-call metrics in a ring buffer of time-bucketed
 * windows.  Provides aggregated snapshots for the analytics dashboard:
 *   • Latency percentiles (p50, p90, p99)
 *   • SLO compliance rate
 *   • Call volume / active calls
 *   • Error rate
 *   • Channel breakdown (phone vs web)
 *
 * No external dependency - data lives in process memory and is
 * automatically pruned after RETENTION_MINUTES.
 */

import { VOICE_MVP_KPI_TARGETS } from './voiceContract';
import { voiceLog } from './voiceLogger';

const log = voiceLog('metrics-collector');

// ─── Configuration ────────────────────────────────────────────────────────

const BUCKET_SIZE_MS = 60_000;  // 1-minute buckets
const RETENTION_MINUTES = Number(process.env.VOICE_METRICS_RETENTION_MIN) || 60;
const MAX_BUCKETS = RETENTION_MINUTES;

// ─── Data structures ──────────────────────────────────────────────────────

interface TurnSample {
    latencyMs: number;
    sloOk: boolean;
    isError: boolean;
    channel: 'phone' | 'web';
}

interface MetricsBucket {
    /** Unix ms of the minute this bucket represents */
    minuteTs: number;
    /** Individual turn latencies (for percentile calculation) */
    latencies: number[];
    /** Counts */
    totalTurns: number;
    sloOkTurns: number;
    errorTurns: number;
    phoneTurns: number;
    webTurns: number;
    /** Call-level counters */
    callsStarted: number;
    callsEnded: number;
}

interface CallEndSample {
    durationSec: number;
    turnCount: number;
    endReason: string;
    channel: 'phone' | 'web';
}

// ─── Ring buffer of buckets ───────────────────────────────────────────────

const _buckets: MetricsBucket[] = [];
let _activeCalls = 0;

function bucketKey(now?: number): number {
    const t = now || Date.now();
    return Math.floor(t / BUCKET_SIZE_MS) * BUCKET_SIZE_MS;
}

function ensureBucket(ts?: number): MetricsBucket {
    const key = bucketKey(ts);
    let bucket = _buckets.find((b) => b.minuteTs === key);
    if (!bucket) {
        bucket = {
            minuteTs: key,
            latencies: [],
            totalTurns: 0,
            sloOkTurns: 0,
            errorTurns: 0,
            phoneTurns: 0,
            webTurns: 0,
            callsStarted: 0,
            callsEnded: 0,
        };
        _buckets.push(bucket);
        // Prune old buckets
        const cutoff = Date.now() - RETENTION_MINUTES * 60_000;
        while (_buckets.length > 0 && _buckets[0].minuteTs < cutoff) {
            _buckets.shift();
        }
        // Hard cap
        while (_buckets.length > MAX_BUCKETS) {
            _buckets.shift();
        }
    }
    return bucket;
}

// ─── Recording API (called from orchestrator / controller) ────────────────

/**
 * Record a single voice turn's metrics.
 */
export function recordTurn(sample: TurnSample): void {
    const bucket = ensureBucket();
    bucket.latencies.push(sample.latencyMs);
    bucket.totalTurns += 1;
    if (sample.sloOk) bucket.sloOkTurns += 1;
    if (sample.isError) bucket.errorTurns += 1;
    if (sample.channel === 'web') bucket.webTurns += 1;
    else bucket.phoneTurns += 1;
}

/** Record that a new call started. */
export function recordCallStart(channel: 'phone' | 'web' = 'phone'): void {
    _activeCalls += 1;
    const bucket = ensureBucket();
    bucket.callsStarted += 1;
    log.debug('call-started', { detail: { channel, activeCalls: _activeCalls } });
}

/** Record that a call ended. */
export function recordCallEnd(sample: CallEndSample): void {
    _activeCalls = Math.max(0, _activeCalls - 1);
    const bucket = ensureBucket();
    bucket.callsEnded += 1;
    log.debug('call-ended', {
        detail: {
            channel: sample.channel,
            durationSec: sample.durationSec,
            turnCount: sample.turnCount,
            endReason: sample.endReason,
            activeCalls: _activeCalls,
        },
    });
}

// ─── Query API (called from admin controller) ─────────────────────────────

function percentile(sorted: number[], p: number): number {
    if (sorted.length === 0) return 0;
    const idx = Math.ceil((p / 100) * sorted.length) - 1;
    return sorted[Math.max(0, idx)];
}

export interface MetricsSnapshot {
    /** Rolling window length in minutes. `0` when `isLifetime` is true. */
    windowMinutes: number;
    /** When true, totals cover all stored history for the tenant (see fromTs/toTs). */
    isLifetime?: boolean;
    fromTs: string;
    toTs: string;

    /** Turn-level aggregates */
    totalTurns: number;
    sloCompliance: number;       // 0..1
    errorRate: number;           // 0..1

    /** Latency percentiles (ms) */
    latencyP50: number;
    latencyP90: number;
    latencyP99: number;
    latencyAvg: number;
    /** Best- and worst-case latency seen in the window (ms). Useful to spot
     *  cold-start spikes that the percentiles smooth out. */
    latencyMin: number;
    latencyMax: number;

    /** Call volume */
    activeCalls: number;
    callsStarted: number;
    callsEnded: number;

    /** Channel split */
    phoneTurns: number;
    webTurns: number;

    /** KPI targets for comparison */
    kpiTargets: typeof VOICE_MVP_KPI_TARGETS;

    /** Per-minute time series (for charts) */
    timeSeries: Array<{
        ts: string;
        turns: number;
        avgLatency: number;
        errorCount: number;
        sloOk: number;
        callsStarted: number;
        callsEnded: number;
    }>;
}

/**
 * Get an aggregated metrics snapshot for the last N minutes.
 * @param windowMinutes Defaults to full retention window.
 */
export function getMetricsSnapshot(windowMinutes?: number): MetricsSnapshot {
    const window = windowMinutes || RETENTION_MINUTES;
    const now = Date.now();
    const cutoff = now - window * 60_000;

    const relevantBuckets = _buckets.filter((b) => b.minuteTs >= cutoff);

    // Flatten all latencies
    const allLatencies: number[] = [];
    let totalTurns = 0;
    let sloOkTurns = 0;
    let errorTurns = 0;
    let phoneTurns = 0;
    let webTurns = 0;
    let callsStarted = 0;
    let callsEnded = 0;

    for (const b of relevantBuckets) {
        allLatencies.push(...b.latencies);
        totalTurns += b.totalTurns;
        sloOkTurns += b.sloOkTurns;
        errorTurns += b.errorTurns;
        phoneTurns += b.phoneTurns;
        webTurns += b.webTurns;
        callsStarted += b.callsStarted;
        callsEnded += b.callsEnded;
    }

    allLatencies.sort((a, b) => a - b);

    const avg =
        allLatencies.length > 0
            ? Math.round(allLatencies.reduce((s, v) => s + v, 0) / allLatencies.length)
            : 0;

    const timeSeries = relevantBuckets.map((b) => {
        const bAvg =
            b.latencies.length > 0
                ? Math.round(b.latencies.reduce((s, v) => s + v, 0) / b.latencies.length)
                : 0;
        return {
            ts: new Date(b.minuteTs).toISOString(),
            turns: b.totalTurns,
            avgLatency: bAvg,
            errorCount: b.errorTurns,
            sloOk: b.sloOkTurns,
            callsStarted: b.callsStarted,
            callsEnded: b.callsEnded,
        };
    });

    const latencyMin = allLatencies.length > 0 ? allLatencies[0] : 0;
    const latencyMax = allLatencies.length > 0 ? allLatencies[allLatencies.length - 1] : 0;

    return {
        windowMinutes: window,
        fromTs: new Date(cutoff).toISOString(),
        toTs: new Date(now).toISOString(),
        totalTurns,
        sloCompliance: totalTurns > 0 ? sloOkTurns / totalTurns : 1,
        errorRate: totalTurns > 0 ? errorTurns / totalTurns : 0,
        latencyP50: percentile(allLatencies, 50),
        latencyP90: percentile(allLatencies, 90),
        latencyP99: percentile(allLatencies, 99),
        latencyAvg: avg,
        latencyMin,
        latencyMax,
        activeCalls: _activeCalls,
        callsStarted,
        callsEnded,
        phoneTurns,
        webTurns,
        kpiTargets: VOICE_MVP_KPI_TARGETS,
        timeSeries,
    };
}

/**
 * Get a quick health summary for alerting.
 */
export interface AlertStatus {
    healthy: boolean;
    warnings: string[];
    critical: string[];
}

/**
 * Evaluate SLO/error/latency alerts from any metrics snapshot (in-memory or DB-backed).
 */
export function evaluateAlertsFromSnapshot(
    snap: MetricsSnapshot,
    windowMinutes: number | null,
): AlertStatus {
    const warnings: string[] = [];
    const critical: string[] = [];
    const scope =
        windowMinutes === null || snap.isLifetime ? 'over all recorded time' : `in the last ${windowMinutes} minutes`;

    // SLO compliance check
    if (snap.totalTurns > 0 && snap.sloCompliance < 0.95) {
        warnings.push(
            `SLO compliance ${(snap.sloCompliance * 100).toFixed(1)}% is below 95% ${scope}`,
        );
    }
    if (snap.totalTurns > 0 && snap.sloCompliance < 0.80) {
        critical.push(
            `SLO compliance ${(snap.sloCompliance * 100).toFixed(1)}% is critically low (< 80%) ${scope}`,
        );
    }

    // Error rate check
    if (snap.totalTurns > 0 && snap.errorRate > 0.10) {
        warnings.push(
            `Error rate ${(snap.errorRate * 100).toFixed(1)}% exceeds 10% threshold ${scope}`,
        );
    }
    if (snap.totalTurns > 0 && snap.errorRate > 0.25) {
        critical.push(
            `Error rate ${(snap.errorRate * 100).toFixed(1)}% is critically high (> 25%) ${scope}`,
        );
    }

    // Latency check - only meaningful when we have measured turns
    if (snap.totalTurns > 0 && snap.latencyP90 > VOICE_MVP_KPI_TARGETS.maxTurnLatencyMs) {
        warnings.push(
            `P90 latency ${snap.latencyP90}ms exceeds target ${VOICE_MVP_KPI_TARGETS.maxTurnLatencyMs}ms`,
        );
    }
    if (snap.totalTurns > 0 && snap.latencyP99 > VOICE_MVP_KPI_TARGETS.maxTurnLatencyMs * 2) {
        critical.push(
            `P99 latency ${snap.latencyP99}ms exceeds 2x target (${VOICE_MVP_KPI_TARGETS.maxTurnLatencyMs * 2}ms)`,
        );
    }

    return {
        healthy: critical.length === 0 && warnings.length === 0,
        warnings,
        critical,
    };
}

export function getAlertStatus(windowMinutes: number = 5): AlertStatus {
    return evaluateAlertsFromSnapshot(getMetricsSnapshot(windowMinutes), windowMinutes);
}
