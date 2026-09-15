/**
 * VoiceAnalytics.tsx - Real-time voice observability dashboard
 *
 * Fetches live metrics from /api/voice-admin/metrics and /api/voice-admin/alerts
 * and renders KPI cards, latency chart, SLO gauge, call volume, and alert banner.
 */

import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import {
    Activity,
    AlertTriangle,
    CheckCircle,
    Clock,
    PhoneCall,
    PhoneOff,
    TrendingUp,
    Zap,
    RefreshCw,
    Globe,
    XCircle,
} from 'lucide-react';
import { PageBackNav } from '../components/PageBackNav';
import { VoiceAnalyticsSkeleton } from '../components/skeletons';
import AnimatedPage from '../components/AnimatedPage';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3000';

// ─── Types ────────────────────────────────────────────────────────────────

interface MetricsSnapshot {
    windowMinutes: number;
    isLifetime?: boolean;
    fromTs: string;
    toTs: string;
    totalTurns: number;
    sloCompliance: number;
    errorRate: number;
    latencyP50: number;
    latencyP90: number;
    latencyP99: number;
    latencyAvg: number;
    latencyMin?: number;
    latencyMax?: number;
    activeCalls: number;
    callsStarted: number;
    callsEnded: number;
    phoneTurns: number;
    webTurns: number;
    kpiTargets: {
        maxFirstResponseMs: number;
        maxTurnLatencyMs: number;
        minCallCompletionRate: number;
        maxVoiceFallbackRate: number;
    };
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

interface AlertStatus {
    healthy: boolean;
    warnings: string[];
    critical: string[];
    aiService: {
        healthy: boolean;
        lastCheckedAt: string | null;
    };
}

interface VoiceStats {
    totalSessions: number;
    activeSessions: number;
    completedSessions: number;
    failedSessions: number;
    totalEndpoints: number;
    totalTurns: number;
    avgTurnLatencyMs: number;
    endReasons: Record<string, number>;
}

// ─── Component ────────────────────────────────────────────────────────────

export default function VoiceAnalytics() {
    const { token } = useAuth();
    const navigate = useNavigate();
    const [metrics, setMetrics] = useState<MetricsSnapshot | null>(null);
    const [alerts, setAlerts] = useState<AlertStatus | null>(null);
    const [stats, setStats] = useState<VoiceStats | null>(null);
    const [loading, setLoading] = useState(true);
    const [lastRefresh, setLastRefresh] = useState<Date>(new Date());
    const [autoRefresh, setAutoRefresh] = useState(true);
    const [timeWindow, setTimeWindow] = useState('1440');

    const headers = { Authorization: `Bearer ${token}` };

    const fetchAll = useCallback(async () => {
        try {
            const w = encodeURIComponent(timeWindow);
            const [metricsRes, alertsRes, statsRes] = await Promise.all([
                fetch(`${API_BASE}/api/voice-admin/metrics?window=${w}`, { headers }),
                fetch(`${API_BASE}/api/voice-admin/alerts?window=${w}`, { headers }),
                fetch(`${API_BASE}/api/voice-admin/stats`, { headers }),
            ]);

            if (metricsRes.status === 403 || alertsRes.status === 403 || statsRes.status === 403) {
                navigate('/subscription', { replace: true });
                return;
            }

            if (metricsRes.ok) setMetrics(await metricsRes.json());
            if (alertsRes.ok) setAlerts(await alertsRes.json());
            if (statsRes.ok) setStats(await statsRes.json());

            setLastRefresh(new Date());
        } catch (err) {
            console.error('Failed to fetch analytics', err);
        } finally {
            setLoading(false);
        }
    }, [token, timeWindow, navigate]);

    useEffect(() => {
        fetchAll();
    }, [fetchAll]);

    // Auto-refresh every 15 seconds
    useEffect(() => {
        if (!autoRefresh) return;
        const interval = setInterval(fetchAll, 15_000);
        return () => clearInterval(interval);
    }, [autoRefresh, fetchAll]);

    if (loading && !metrics) {
        return <VoiceAnalyticsSkeleton />;
    }

    const hasTurnMetrics = Boolean(metrics && metrics.totalTurns > 0);
    const sloPercent = hasTurnMetrics ? Math.round(metrics!.sloCompliance * 100) : null;
    const errorPercent = hasTurnMetrics ? (metrics!.errorRate * 100).toFixed(1) : null;
    const volumeSeries =
        metrics?.timeSeries.filter(
            (p) => p.turns > 0 || p.callsStarted > 0 || p.callsEnded > 0 || p.errorCount > 0,
        ) ?? [];

    return (
        <AnimatedPage className="bg-white pb-12 py-8 px-4 sm:px-6 lg:px-8">
            <div className="max-w-7xl mx-auto space-y-6">
                <PageBackNav to="/dashboard" label="Back to Dashboard" />

                {/* Header */}
                <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                        <h1 className="text-2xl font-bold text-ocean-navy">Voice Analytics</h1>
                        <p className="text-sm text-ocean-deep/80">
                            {metrics?.isLifetime ? (
                                <>
                                    All stored history for your tenant
                                    {' · '}
                                </>
                            ) : metrics?.fromTs && metrics?.toTs ? (
                                <>
                                    {`Range ${new Date(metrics.fromTs).toLocaleString()} - ${new Date(metrics.toTs).toLocaleString()}`}
                                    {' · '}
                                </>
                            ) : null}
                            Last refreshed {lastRefresh.toLocaleTimeString()}
                        </p>
                    </div>
                    <div className="flex shrink-0 flex-wrap items-center gap-3">
                        {/* Window selector */}
                        <select
                            value={timeWindow}
                            onChange={(e) => setTimeWindow(e.target.value)}
                            className="text-sm border border-ocean-ice rounded-lg px-3 py-1.5 max-w-[11rem] sm:max-w-none"
                        >
                            <option value="60">1 hour</option>
                            <option value="360">6 hours</option>
                            <option value="1440">24 hours</option>
                            <option value="10080">1 week</option>
                            <option value="43200">1 month</option>
                            <option value="129600">3 months</option>
                            <option value="259200">6 months</option>
                            <option value="525600">1 year</option>
                            <option value="lifetime">Lifetime</option>
                        </select>
                        {/* Auto-refresh toggle */}
                        <button
                            onClick={() => setAutoRefresh(!autoRefresh)}
                            className={`flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg border transition-colors ${
                                autoRefresh
                                    ? 'border-green-200 bg-green-50 text-green-700'
                                    : 'border-ocean-ice bg-white text-ocean-deep/90'
                            }`}
                        >
                            <RefreshCw className={`h-3.5 w-3.5 ${autoRefresh ? 'animate-spin' : ''}`} />
                            {autoRefresh ? 'Live' : 'Paused'}
                        </button>
                        <button
                            onClick={fetchAll}
                            className="p-2 hover:bg-ocean-mist/50 rounded-lg transition-colors"
                            title="Refresh now"
                        >
                            <RefreshCw className="h-4 w-4 text-ocean-deep/90" />
                        </button>
                    </div>
                </div>

                {/* Alert Banner */}
                {alerts && !alerts.healthy && (
                    <div className={`rounded-xl border p-4 ${
                        alerts.critical.length > 0
                            ? 'bg-red-50 border-red-200'
                            : 'bg-amber-50 border-amber-200'
                    }`}>
                        <div className="flex items-start gap-3">
                            <AlertTriangle className={`h-5 w-5 mt-0.5 ${
                                alerts.critical.length > 0 ? 'text-red-500' : 'text-amber-500'
                            }`} />
                            <div>
                                <h3 className={`font-semibold text-sm ${
                                    alerts.critical.length > 0 ? 'text-red-800' : 'text-amber-800'
                                }`}>
                                    {alerts.critical.length > 0 ? 'Critical Alerts' : 'Warnings'}
                                </h3>
                                <ul className="mt-1 text-xs space-y-0.5">
                                    {alerts.critical.map((c, i) => (
                                        <li key={`c-${i}`} className="text-red-700">{c}</li>
                                    ))}
                                    {alerts.warnings.map((w, i) => (
                                        <li key={`w-${i}`} className="text-amber-700">{w}</li>
                                    ))}
                                </ul>
                            </div>
                        </div>
                    </div>
                )}

                {/* AI Service Status */}
                {alerts && (
                    <div className={`flex items-center gap-2 text-xs px-3 py-2 rounded-lg ${
                        alerts.aiService.healthy
                            ? 'bg-green-50 text-green-700'
                            : 'bg-red-50 text-red-700'
                    }`}>
                        {alerts.aiService.healthy
                            ? <CheckCircle className="h-3.5 w-3.5" />
                            : <XCircle className="h-3.5 w-3.5" />}
                        AI Service: {alerts.aiService.healthy ? 'Healthy' : 'Unhealthy'}
                        {alerts.aiService.lastCheckedAt && (
                            <span className="text-[10px] opacity-70 ml-1">
                                (checked {new Date(alerts.aiService.lastCheckedAt).toLocaleTimeString()})
                            </span>
                        )}
                    </div>
                )}

                {/* KPI Cards */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <KpiCard
                        title="Active Calls"
                        value={metrics?.activeCalls ?? 0}
                        icon={<PhoneCall className="h-5 w-5" />}
                        gradient="from-ocean-sky to-ocean-bright"
                    />
                    <KpiCard
                        title="Total Turns"
                        value={metrics?.totalTurns ?? 0}
                        icon={<Activity className="h-5 w-5" />}
                        gradient="from-ocean-bright to-ocean-rich"
                        subtitle={`${metrics?.phoneTurns ?? 0} phone · ${metrics?.webTurns ?? 0} web`}
                    />
                    <KpiCard
                        title="SLO Compliance"
                        value={sloPercent === null ? '-' : `${sloPercent}%`}
                        icon={<CheckCircle className="h-5 w-5" />}
                        gradient={
                            sloPercent === null
                                ? 'from-slate-400 to-slate-500'
                                : sloPercent >= 95
                                  ? 'from-ocean-sky to-ocean-bright'
                                  : sloPercent >= 80
                                    ? 'from-amber-500 to-orange-500'
                                    : 'from-red-500 to-pink-500'
                        }
                        subtitle={`Target: ≤ ${((metrics?.kpiTargets.maxTurnLatencyMs ?? 4500) / 1000).toFixed(1)}s`}
                    />
                    <KpiCard
                        title="Error Rate"
                        value={errorPercent === null ? '-' : `${errorPercent}%`}
                        icon={<AlertTriangle className="h-5 w-5" />}
                        gradient={
                            errorPercent === null
                                ? 'from-slate-400 to-slate-500'
                                : Number(errorPercent) < 5
                                  ? 'from-ocean-sky to-ocean-bright'
                                  : Number(errorPercent) < 15
                                    ? 'from-amber-500 to-orange-500'
                                    : 'from-red-500 to-pink-500'
                        }
                    />
                </div>

                {/* Latency Stats Row */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <LatencyCard label="P50 Latency" value={metrics?.latencyP50 ?? 0} target={metrics?.kpiTargets.maxTurnLatencyMs ?? 4500} hasData={hasTurnMetrics} />
                    <LatencyCard label="P90 Latency" value={metrics?.latencyP90 ?? 0} target={metrics?.kpiTargets.maxTurnLatencyMs ?? 4500} hasData={hasTurnMetrics} />
                    <LatencyCard label="P99 Latency" value={metrics?.latencyP99 ?? 0} target={(metrics?.kpiTargets.maxTurnLatencyMs ?? 4500) * 2} hasData={hasTurnMetrics} />
                    <LatencyCard label="Avg Latency" value={metrics?.latencyAvg ?? 0} target={metrics?.kpiTargets.maxTurnLatencyMs ?? 4500} hasData={hasTurnMetrics} />
                </div>

                {/* Best/worst case latency - exposes cold-start spikes that percentiles smooth out */}
                <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                    <LatencyCard label="Min Latency" value={metrics?.latencyMin ?? 0} target={metrics?.kpiTargets.maxTurnLatencyMs ?? 4500} hasData={hasTurnMetrics} />
                    <LatencyCard label="Max Latency" value={metrics?.latencyMax ?? 0} target={metrics?.kpiTargets.maxTurnLatencyMs ?? 4500} hasData={hasTurnMetrics} />
                    <div className="bg-white rounded-2xl shadow-sm border border-ocean-ice/80 p-4 flex flex-col justify-between">
                        <span className="text-xs uppercase tracking-wide text-ocean-deep/80">SLO Target</span>
                        <div>
                            <p className="text-2xl font-bold text-ocean-navy">
                                {((metrics?.kpiTargets.maxTurnLatencyMs ?? 4500) / 1000).toFixed(1)}s
                            </p>
                            <p className="text-xs text-ocean-deep/80 mt-1">
                                Per-turn end-to-end ceiling. Includes STT &rarr; AI &rarr; TTS round-trip on the server.
                            </p>
                        </div>
                    </div>
                </div>

                {/* Time Series Chart (text-based bars) */}
                {metrics && (
                    <div className="bg-white rounded-2xl shadow-sm border border-ocean-ice/80 p-6">
                        <h3 className="font-semibold text-ocean-navy mb-4 flex items-center gap-2">
                            <TrendingUp className="h-4 w-4 text-ocean-rich" />
                            Turn Volume & Latency (per minute)
                        </h3>
                        {volumeSeries.length === 0 ? (
                            <p className="text-sm text-ocean-deep/70">
                                No turns or call volume in this window. Place a voice call or widen the time range -
                                totals below reflect all-time session stats where applicable.
                            </p>
                        ) : (
                            <div className="space-y-1.5 max-h-80 overflow-y-auto">
                                {volumeSeries.map((point, idx) => {
                                    const maxTurns = Math.max(...volumeSeries.map((p) => p.turns), 1);
                                    const barWidth = Math.max((point.turns / maxTurns) * 100, 2);
                                    const isOverSlo = point.turns > 0 && point.avgLatency > metrics.kpiTargets.maxTurnLatencyMs;
                                    const time = new Date(point.ts).toLocaleTimeString([], {
                                        hour: '2-digit',
                                        minute: '2-digit',
                                    });

                                    return (
                                        <div key={idx} className="flex items-center gap-3 text-xs">
                                            <span className="w-14 text-ocean-deep/80 text-right shrink-0">{time}</span>
                                            <div className="flex-1 relative h-5">
                                                <div
                                                    className={`h-full rounded transition-all ${
                                                        isOverSlo ? 'bg-red-200' : 'bg-ocean-ice'
                                                    }`}
                                                    style={{ width: `${barWidth}%` }}
                                                />
                                                <span className="absolute left-2 top-0.5 text-[10px] text-ocean-deep">
                                                    {point.turns} turns
                                                    {point.turns > 0 && ` · ${(point.avgLatency / 1000).toFixed(1)}s`}
                                                    {point.errorCount > 0 && ` · ${point.errorCount} err`}
                                                </span>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                )}

                {/* Historical Stats (from DB) */}
                {stats && (
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        <StatCard title="Total Sessions" value={stats.totalSessions} icon={<PhoneCall className="h-4 w-4" />} />
                        <StatCard title="Completed" value={stats.completedSessions} icon={<CheckCircle className="h-4 w-4 text-ocean-bright" />} />
                        <StatCard title="Failed" value={stats.failedSessions} icon={<PhoneOff className="h-4 w-4 text-red-500" />} />
                        <StatCard title="Endpoints" value={stats.totalEndpoints} icon={<Globe className="h-4 w-4 text-ocean-rich" />} />
                    </div>
                )}

                {/* End reason breakdown */}
                {stats && stats.endReasons && Object.keys(stats.endReasons).length > 0 && (
                    <div className="bg-white rounded-2xl shadow-sm border border-ocean-ice/80 p-6">
                        <h3 className="font-semibold text-ocean-navy mb-4 flex items-center gap-2">
                            <Zap className="h-4 w-4 text-ocean-rich" />
                            Call End Reasons
                        </h3>
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                            {Object.entries(stats.endReasons).map(([reason, count]) => (
                                <div key={reason} className="flex items-center justify-between bg-ocean-powder rounded-lg px-3 py-2">
                                    <span className="text-xs text-ocean-deep/90 capitalize">{reason.replace(/_/g, ' ')}</span>
                                    <span className="text-sm font-bold text-ocean-navy">{count}</span>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

            </div>
        </AnimatedPage>
    );
}

// ─── Sub-components ───────────────────────────────────────────────────────

function KpiCard({ title, value, icon, gradient, subtitle }: {
    title: string;
    value: string | number;
    icon: React.ReactNode;
    gradient: string;
    subtitle?: string;
}) {
    return (
        <div className="group relative bg-white rounded-2xl shadow-sm border border-ocean-ice/80 p-5 hover:shadow-lg transition-all">
            <div className={`absolute -inset-0.5 bg-gradient-to-r ${gradient} rounded-2xl opacity-0 group-hover:opacity-20 blur transition-opacity`} />
            <div className="relative">
                <div className="flex items-center justify-between mb-3">
                    <div className={`p-2 rounded-lg bg-gradient-to-r ${gradient} text-white`}>
                        {icon}
                    </div>
                </div>
                <p className="text-xs text-ocean-deep/80 mb-1">{title}</p>
                <p className="text-2xl font-bold text-ocean-navy">{value}</p>
                {subtitle && <p className="text-[10px] text-ocean-deep/60 mt-1">{subtitle}</p>}
            </div>
        </div>
    );
}

function LatencyCard({
    label,
    value,
    target,
    hasData,
}: {
    label: string;
    value: number;
    target: number;
    hasData: boolean;
}) {
    const ok = !hasData || value <= target;
    return (
        <div className={`rounded-xl border p-4 ${ok ? 'bg-white border-ocean-ice/80' : 'bg-red-50 border-red-100'}`}>
            <div className="flex items-center gap-2 mb-1">
                <Clock className={`h-3.5 w-3.5 ${ok ? 'text-ocean-deep/60' : 'text-red-500'}`} />
                <span className="text-xs text-ocean-deep/80">{label}</span>
            </div>
            <p className={`text-xl font-bold ${!hasData ? 'text-ocean-deep/50' : ok ? 'text-ocean-navy' : 'text-red-600'}`}>
                {!hasData ? '-' : `${(value / 1000).toFixed(1)}s`}
            </p>
            <p className="text-[10px] text-ocean-deep/60">target ≤ {(target / 1000).toFixed(1)}s</p>
        </div>
    );
}

function StatCard({ title, value, icon }: { title: string; value: number; icon: React.ReactNode }) {
    return (
        <div className="bg-white rounded-xl border border-ocean-ice/80 p-4 flex items-center gap-3">
            <div className="p-2 bg-ocean-mist/50 rounded-lg">{icon}</div>
            <div>
                <p className="text-xs text-ocean-deep/80">{title}</p>
                <p className="text-lg font-bold text-ocean-navy">{value.toLocaleString()}</p>
            </div>
        </div>
    );
}
