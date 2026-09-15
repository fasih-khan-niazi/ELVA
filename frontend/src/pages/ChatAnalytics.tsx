/**
 * Tenant-wide chat operational metrics (all chat agents).
 */
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { PageBackNav } from '../components/PageBackNav';
import { ChatAnalyticsSkeleton } from '../components/skeletons';
import AnimatedPage from '../components/AnimatedPage';
import {
    Activity,
    CheckCircle,
    Clock,
    Loader2,
    MessageSquare,
    RefreshCw,
    TrendingUp,
    XCircle,
    Zap,
} from 'lucide-react';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3000';

interface ChatMetrics {
    windowMinutes: number | null;
    isLifetime: boolean;
    fromTs: string;
    toTs: string;
    chatAgents: number;
    sessions: number;
    messages: number;
    assistantTurnsWithLatency: number;
    latencyMs: { avg: number; min: number; max: number } | null;
    timeSeries: Array<{ ts: string; sessions: number; messages: number }>;
    sessionsBySource?: { dashboard?: number; embed?: number; api?: number } & Record<string, number>;
}

interface AiServiceStatus {
    healthy: boolean;
    lastCheckedAt: string | null;
}

export default function ChatAnalytics() {
    const { token } = useAuth();
    const navigate = useNavigate();
    const [metrics, setMetrics] = useState<ChatMetrics | null>(null);
    const [aiService, setAiService] = useState<AiServiceStatus | null>(null);
    const [loading, setLoading] = useState(true);
    const [timeWindow, setTimeWindow] = useState('1440');
    const [autoRefresh, setAutoRefresh] = useState(true);

    const fetchMetrics = useCallback(async () => {
        try {
            const w = encodeURIComponent(timeWindow);
            const headers = { Authorization: `Bearer ${token}` };
            const [res, alertsRes] = await Promise.all([
                fetch(`${API_BASE}/api/analytics/chat-metrics?window=${w}`, { headers }),
                fetch(`${API_BASE}/api/voice-admin/alerts?window=${w}`, { headers }),
            ]);
            if (res.status === 403) {
                navigate('/subscription', { replace: true });
                return;
            }
            if (res.ok) setMetrics(await res.json());
            if (alertsRes.ok) {
                const a = await alertsRes.json();
                setAiService(a?.aiService ?? null);
            }
        } catch (e) {
            console.error('Chat metrics fetch error', e);
        } finally {
            setLoading(false);
        }
    }, [token, timeWindow, navigate]);

    useEffect(() => {
        setLoading(true);
        fetchMetrics();
    }, [fetchMetrics]);

    useEffect(() => {
        if (!autoRefresh) return;
        const t = setInterval(fetchMetrics, 20_000);
        return () => clearInterval(t);
    }, [autoRefresh, fetchMetrics]);

    if (loading && !metrics) {
        return <ChatAnalyticsSkeleton />;
    }

    const hasLatency = Boolean(metrics?.latencyMs && metrics.assistantTurnsWithLatency > 0);
    const series = metrics?.timeSeries.filter((p) => p.sessions > 0 || p.messages > 0) ?? [];
    const maxBar = Math.max(...series.map((p) => p.messages), 1);

    return (
        <AnimatedPage className="bg-white pb-12 py-8 px-4 sm:px-6 lg:px-8">
            <div className="max-w-7xl mx-auto space-y-6">
                <PageBackNav to="/dashboard" label="Back to Dashboard" />

                <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                        <h1 className="text-2xl font-bold text-ocean-navy flex items-center gap-2">
                            <MessageSquare className="h-7 w-7 text-ocean-rich" />
                            Chat analytics
                        </h1>
                        <p className="text-sm text-ocean-deep/80 mt-1">
                            {metrics?.isLifetime
                                ? 'All stored chat sessions for your workspace'
                                : metrics?.fromTs && metrics?.toTs
                                  ? `${new Date(metrics.fromTs).toLocaleString()} - ${new Date(metrics.toTs).toLocaleString()}`
                                  : 'Live metrics'}{' '}
                            · all chat agents combined
                        </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-3">
                        <select
                            value={timeWindow}
                            onChange={(e) => setTimeWindow(e.target.value)}
                            className="text-sm border border-ocean-ice rounded-lg px-3 py-1.5 max-w-[11rem] sm:max-w-none bg-white"
                        >
                            <option value="60">1 hour</option>
                            <option value="360">6 hours</option>
                            <option value="1440">24 hours</option>
                            <option value="10080">1 week</option>
                            <option value="43200">1 month</option>
                            <option value="259200">6 months</option>
                            <option value="525600">1 year</option>
                            <option value="lifetime">Lifetime</option>
                        </select>
                        <button
                            type="button"
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
                            type="button"
                            onClick={() => {
                                setLoading(true);
                                fetchMetrics();
                            }}
                            className="p-2 hover:bg-ocean-mist/50 rounded-lg transition-colors border border-transparent hover:border-ocean-ice"
                            title="Refresh now"
                        >
                            <RefreshCw className="h-4 w-4 text-ocean-deep/90" />
                        </button>
                    </div>
                </div>

                {/* AI Service Status */}
                {aiService && (
                    <div className={`flex items-center gap-2 text-xs px-3 py-2 rounded-lg w-fit ${
                        aiService.healthy
                            ? 'bg-green-50 text-green-700'
                            : 'bg-red-50 text-red-700'
                    }`}>
                        {aiService.healthy
                            ? <CheckCircle className="h-3.5 w-3.5" />
                            : <XCircle className="h-3.5 w-3.5" />}
                        AI Service: {aiService.healthy ? 'Healthy' : 'Unhealthy'}
                        {aiService.lastCheckedAt && (
                            <span className="text-[10px] opacity-70 ml-1">
                                (checked {new Date(aiService.lastCheckedAt).toLocaleTimeString()})
                            </span>
                        )}
                    </div>
                )}

                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <Card
                        title="Chat agents"
                        value={metrics?.chatAgents ?? 0}
                        icon={<MessageSquare className="h-5 w-5" />}
                        gradient="from-ocean-sky to-ocean-bright"
                    />
                    <Card
                        title="Sessions (window)"
                        value={metrics?.sessions ?? 0}
                        subtitle="touched in range"
                        icon={<Activity className="h-5 w-5" />}
                        gradient="from-ocean-bright to-ocean-rich"
                    />
                    <Card
                        title="Messages (window)"
                        value={metrics?.messages ?? 0}
                        icon={<Zap className="h-5 w-5" />}
                        gradient="from-ocean-rich to-ocean-deep"
                    />
                    <Card
                        title="Assistant turns (lat.)"
                        value={metrics?.assistantTurnsWithLatency ?? 0}
                        subtitle="with latency recorded"
                        icon={<TrendingUp className="h-5 w-5" />}
                        gradient="from-ocean-deep to-ocean-navy"
                    />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <LatencyBox label="Avg latency" ms={hasLatency ? metrics!.latencyMs!.avg : null} />
                    <LatencyBox label="Min latency" ms={hasLatency ? metrics!.latencyMs!.min : null} />
                    <LatencyBox label="Max latency" ms={hasLatency ? metrics!.latencyMs!.max : null} />
                </div>

                {metrics?.sessionsBySource && (
                    <div className="bg-white rounded-2xl border border-ocean-ice/80 p-5 shadow-sm">
                        <h3 className="font-semibold text-ocean-navy mb-3">Sessions by channel</h3>
                        <div className="flex flex-wrap gap-6 text-sm text-ocean-deep">
                            <span>
                                <strong className="text-ocean-navy">ELVA dashboard</strong>:{' '}
                                {metrics.sessionsBySource.dashboard ?? 0}
                            </span>
                            <span>
                                <strong className="text-ocean-navy">Website embed</strong>:{' '}
                                {metrics.sessionsBySource.embed ?? 0}
                            </span>
                            <span>
                                <strong className="text-ocean-navy">Public API</strong>:{' '}
                                {metrics.sessionsBySource.api ?? 0}
                            </span>
                        </div>
                    </div>
                )}

                <div className="bg-white rounded-2xl border border-ocean-ice/80 p-6 shadow-sm">
                    <h3 className="font-semibold text-ocean-navy mb-4 flex items-center gap-2">
                        <TrendingUp className="h-4 w-4 text-ocean-rich" />
                        Activity by day (sessions · messages)
                    </h3>
                    {series.length === 0 ? (
                        <p className="text-sm text-ocean-deep/70">
                            No chat activity in this window. Open the chat widget or widen the range.
                        </p>
                    ) : (
                        <div className="space-y-1.5 max-h-80 overflow-y-auto">
                            {series.map((point) => {
                                const barWidth = Math.max((point.messages / maxBar) * 100, 2);
                                return (
                                    <div key={point.ts} className="flex items-center gap-3 text-xs">
                                        <span className="w-24 text-ocean-deep/80 shrink-0">{point.ts}</span>
                                        <div className="flex-1 relative h-5">
                                            <div
                                                className="h-full rounded bg-ocean-ice transition-all"
                                                style={{ width: `${barWidth}%` }}
                                            />
                                            <span className="absolute left-2 top-0.5 text-[10px] text-ocean-deep">
                                                {point.sessions} sess · {point.messages} msg
                                            </span>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>
            </div>
        </AnimatedPage>
    );
}

function Card({
    title,
    value,
    subtitle,
    icon,
    gradient,
}: {
    title: string;
    value: number;
    subtitle?: string;
    icon: React.ReactNode;
    gradient: string;
}) {
    return (
        <div className="group relative bg-white rounded-2xl shadow-sm border border-ocean-ice/80 p-5">
            <div className={`inline-flex p-2 rounded-lg bg-gradient-to-r ${gradient} text-white mb-3`}>{icon}</div>
            <p className="text-xs text-ocean-deep/80">{title}</p>
            <p className="text-2xl font-bold text-ocean-navy">{value.toLocaleString()}</p>
            {subtitle && <p className="text-[10px] text-ocean-deep/60 mt-1">{subtitle}</p>}
        </div>
    );
}

function LatencyBox({ label, ms }: { label: string; ms: number | null }) {
    return (
        <div className="rounded-xl border border-ocean-ice/80 bg-white p-4 flex items-center gap-2">
            <Clock className="h-4 w-4 text-ocean-deep/60 shrink-0" />
            <div>
                <p className="text-xs text-ocean-deep/80">{label}</p>
                <p className="text-lg font-bold text-ocean-navy">
                    {ms == null ? '-' : `${(ms / 1000).toFixed(2)}s`}
                </p>
            </div>
        </div>
    );
}
