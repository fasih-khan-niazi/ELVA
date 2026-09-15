import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { PageBackNav } from '../components/PageBackNav';
import { AnalyticsPageSkeleton } from '../components/skeletons';
import AnimatedPage from '../components/AnimatedPage';
import {
    BarChart3, TrendingUp, Users, ShoppingBag,
    Package, RefreshCw, Loader2, ArrowUpRight,
    FileText, Download, LayoutDashboard,
    Phone, CheckCircle2, XCircle, Timer, Wifi, PhoneCall,
} from 'lucide-react';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3000';

// --- Types --------------------------------------------------------------------

interface AgentInfo {
    id: string;
    name: string;
    type: 'chat' | 'voice';
    callDirection?: 'inbound' | 'outbound';
    createdAt: string;
}

interface TimelineEntry {
    date: string;
    orders?: number;
    leads?: number;
}

interface TopItem {
    name: string;
    count: number;
}

interface AnalyticsData {
    agent: AgentInfo;
    range: number;
    orders: {
        total: number;
        inRange: number;
        today: number;
        thisWeek: number;
        byStatus: Record<string, number>;
        byChannel: Record<string, number>;
        topItems: TopItem[];
        timeline: TimelineEntry[];
    };
    leads: {
        total: number;
        inRange: number;
        today: number;
        byStatus: Record<string, number>;
        bySource: Record<string, number>;
        avgScore: number;
        conversionRate: number;
        timeline: TimelineEntry[];
    };
    catalog: { total: number; active: number };
    documents: number;
}

interface VoiceSessionMin {
    status: string;
    durationSec?: number;
    totalLatencyMs: number;
    turnCount: number;
    startedAt: string;
}

interface CallStats {
    total: number;
    completed: number;
    failed: number;
    canceled: number;
    avgDurationSec: number;
    totalDurationSec: number;
    avgLatencyMs: number;
    connectionRate: number;
    callTimeline: { date: string; calls: number }[];
}

const RANGE_OPTIONS = [
    { label: '7 days', value: 7 },
    { label: '30 days', value: 30 },
    { label: '90 days', value: 90 },
];

function formatDuration(sec: number): string {
    if (!sec) return '0s';
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = Math.round(sec % 60);
    if (h > 0) return `${h}h ${m}m`;
    if (m > 0) return `${m}m ${s}s`;
    return `${s}s`;
}

// --- Main Component -----------------------------------------------------------

export default function AnalyticsPage() {
    const { token, user } = useAuth();
    const isWorkspaceAdmin = user?.role === 'business_admin';
    const { agentId } = useParams<{ agentId: string }>();
    const navigate = useNavigate();

    const [data, setData] = useState<AnalyticsData | null>(null);
    const [loading, setLoading] = useState(true);
    const [range, setRange] = useState(30);
    const [agentMeta, setAgentMeta] = useState<AgentInfo | null>(null);
    const [callStats, setCallStats] = useState<CallStats | null>(null);
    const [callStatsLoading, setCallStatsLoading] = useState(false);
    // Track whether the agent type has been determined (to avoid flicker)
    const [agentTypeResolved, setAgentTypeResolved] = useState(false);

    const isOutbound = agentMeta?.callDirection === 'outbound' && agentMeta?.type === 'voice';

    /* -- Step 1: Resolve agent metadata first -- */
    useEffect(() => {
        if (!agentId || !token) return;
        fetch(`${API_BASE}/api/agents/${agentId}`, {
            headers: { Authorization: `Bearer ${token}` },
        })
            .then(r => r.ok ? r.json() : null)
            .then(d => {
                if (d) setAgentMeta(d);
                setAgentTypeResolved(true);
            })
            .catch(() => setAgentTypeResolved(true));
    }, [agentId, token]);

    /* -- Step 2a: Outbound path - fetch voice call stats -- */
    const fetchCallStats = useCallback(async () => {
        if (!agentId || !token) return;
        setCallStatsLoading(true);
        try {
            const params = new URLSearchParams({ agentId, limit: '200', sort: '-startedAt' });
            const res = await fetch(`${API_BASE}/api/voice-admin/sessions?${params}`, {
                headers: { Authorization: `Bearer ${token}` },
            });
            if (!res.ok) return;
            const d = await res.json();
            const sessions: VoiceSessionMin[] = d.sessions || [];
            const total: number = d.total || sessions.length;

            const completed = sessions.filter(s => s.status === 'completed').length;
            const failed = sessions.filter(s => s.status === 'failed').length;
            const canceled = sessions.filter(s => s.status === 'canceled').length;
            const totalDurationSec = sessions.reduce((sum, s) => sum + (s.durationSec || 0), 0);
            const avgDurationSec = sessions.length > 0 ? Math.round(totalDurationSec / sessions.length) : 0;
            const totalLatencyMs = sessions.reduce((sum, s) => sum + (s.totalLatencyMs || 0), 0);
            const totalTurns = sessions.reduce((sum, s) => sum + (s.turnCount || 0), 0);
            const avgLatencyMs = totalTurns > 0 ? Math.round(totalLatencyMs / totalTurns) : 0;
            const connectionRate = total > 0 ? Math.round((completed / total) * 100) : 0;

            const byDate: Record<string, number> = {};
            sessions.forEach(s => {
                const date = s.startedAt.slice(0, 10);
                byDate[date] = (byDate[date] || 0) + 1;
            });
            const callTimeline = Object.entries(byDate)
                .sort(([a], [b]) => a.localeCompare(b))
                .map(([date, calls]) => ({ date, calls }));

            setCallStats({ total, completed, failed, canceled, avgDurationSec, totalDurationSec, avgLatencyMs, connectionRate, callTimeline });
        } catch (err) {
            console.error('Error fetching call stats:', err);
        } finally {
            setCallStatsLoading(false);
        }
    }, [agentId, token]);

    /* -- Step 2b: Standard path - fetch orders/leads analytics -- */
    const fetchAnalytics = useCallback(async () => {
        if (!data) setLoading(true);
        try {
            const res = await fetch(`${API_BASE}/api/analytics/${agentId}?range=${range}`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (res.status === 403) { navigate('/subscription'); return; }
            if (res.ok) setData(await res.json());
        } catch (err) {
            console.error('Error fetching analytics:', err);
        } finally {
            setLoading(false);
        }
    }, [agentId, token, range, navigate]);

    /* -- Step 3: Once agent type is known, take the right path -- */
    useEffect(() => {
        if (!agentTypeResolved) return;
        if (isOutbound) {
            setLoading(false); // Outbound agents don't use analytics
            fetchCallStats();
        } else {
            fetchAnalytics();
        }
        // Only re-run when type is first resolved or range changes
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [agentTypeResolved, isOutbound, range]);

    /* -- CSV export -- */
    const exportCSV = () => {
        if (isOutbound && callStats) {
            const lines = [
                'ELVA Outbound Call Analytics Report',
                `Agent,${agentMeta?.name ?? agentId}`,
                `Exported,${new Date().toISOString()}`,
                '',
                '--- CALL PERFORMANCE ---',
                'Metric,Value',
                `Total Calls,${callStats.total}`,
                `Connected (Completed),${callStats.completed}`,
                `Failed,${callStats.failed}`,
                `Canceled,${callStats.canceled}`,
                `Connection Rate,${callStats.connectionRate}%`,
                `Avg Duration,${formatDuration(callStats.avgDurationSec)}`,
                `Total Duration,${formatDuration(callStats.totalDurationSec)}`,
                `Avg AI Latency,${(callStats.avgLatencyMs / 1000).toFixed(2)}s`,
                '',
                '--- CALLS OVER TIME ---',
                'Date,Calls',
                ...callStats.callTimeline.map(e => `${e.date},${e.calls}`),
            ];
            downloadBlob('?' + lines.join('\n'), `call_analytics_${agentMeta?.name ?? agentId}_${new Date().toISOString().slice(0, 10)}.csv`);
            return;
        }
        if (!data) return;
        const { orders, leads } = data;
        const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
        const lines: string[] = [
            'ELVA Analytics Report',
            `Agent,${esc(data.agent.name)}`,
            `Date Range,Last ${range} days`,
            `Exported,${new Date().toISOString()}`,
            '',
            '--- KEY METRICS ---',
            'Metric,Value',
            `Total Orders,${orders.total}`,
            `Orders Today,${orders.today}`,
            `Orders In Range,${orders.inRange}`,
            `Total Leads,${leads.total}`,
            `Leads Today,${leads.today}`,
            `Avg Lead Score,${leads.avgScore}`,
            `Conversion Rate (%),${leads.conversionRate}`,
            '',
            '--- ORDER STATUS ---',
            'Status,Count',
            ...Object.entries(orders.byStatus).map(([s, c]) => `${s},${c}`),
            '',
            '--- TOP ITEMS (BY QTY) ---',
            'Rank,Item,Qty Sold',
            ...orders.topItems.map((item, i) => `${i + 1},${esc(item.name)},${item.count}`),
        ];
        downloadBlob('?' + lines.join('\n'), `analytics_${data.agent.name.replace(/[^a-z0-9]/gi, '_')}_${new Date().toISOString().slice(0, 10)}.csv`);
    };

    function downloadBlob(content: string, filename: string) {
        const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);
    }

    /* -- Loading state -- */
    if (loading && !data) {
        return <AnalyticsPageSkeleton />;
    }

    const agentName = agentMeta?.name ?? data?.agent.name ?? 'Agent';

    return (
        <AnimatedPage className="bg-slate-50 min-h-full pb-12">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
                <PageBackNav to="/dashboard" label="Back to Dashboard" />

                {/* Admin global banner */}
                {isWorkspaceAdmin && !isOutbound && (
                    <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-ocean-sky/60 bg-ocean-powder/50 px-4 py-3 text-sm text-ocean-deep">
                        <span>Revenue and full workspace totals live in <strong className="text-ocean-navy">Global analytics</strong>.</span>
                        <button
                            type="button"
                            onClick={() => navigate('/global-analytics')}
                            className="inline-flex items-center gap-2 rounded-lg bg-ocean-deep px-3 py-1.5 text-white font-medium hover:brightness-110"
                        >
                            <LayoutDashboard className="h-4 w-4" />
                            Open Global analytics
                        </button>
                    </div>
                )}

                {/* Page header */}
                <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between mb-8">
                    <div>
                        <h1 className="text-2xl font-bold text-ocean-navy flex items-center gap-2">
                            <BarChart3 className="h-7 w-7 text-ocean-deep" />
                            Analytics
                        </h1>
                        <p className="text-ocean-deep/70 mt-0.5 text-sm">{agentName}</p>
                    </div>
                    <div className="flex flex-wrap items-center gap-3">
                        {!isOutbound && (
                            <div className="flex bg-white border border-ocean-ice rounded-lg overflow-hidden">
                                {RANGE_OPTIONS.map((opt) => (
                                    <button
                                        key={opt.value}
                                        onClick={() => setRange(opt.value)}
                                        className={`px-3 py-1.5 text-sm font-medium transition-all ${range === opt.value ? 'bg-ocean-deep text-white' : 'text-ocean-deep/90 hover:bg-ocean-powder'}`}
                                    >
                                        {opt.label}
                                    </button>
                                ))}
                            </div>
                        )}
                        <button
                            onClick={exportCSV}
                            className="flex items-center px-3 py-1.5 bg-white border border-ocean-ice rounded-lg hover:bg-ocean-powder text-sm font-medium text-ocean-deep"
                        >
                            <Download className="h-4 w-4 mr-1.5 text-ocean-deep" /> CSV
                        </button>
                        <button
                            onClick={() => isOutbound ? fetchCallStats() : fetchAnalytics()}
                            className="flex items-center px-4 py-2 bg-white border border-ocean-ice rounded-lg hover:bg-ocean-powder text-sm font-medium text-ocean-deep"
                        >
                            <RefreshCw className={`h-4 w-4 mr-1.5 ${(loading || callStatsLoading) ? 'animate-spin' : ''}`} /> Refresh
                        </button>
                    </div>
                </div>

                {/* -- OUTBOUND VOICE ANALYTICS -------------------------------- */}
                {isOutbound ? (
                    <OutboundAnalytics
                        stats={callStats}
                        loading={callStatsLoading}
                        agentId={agentId!}
                        navigate={navigate}
                    />
                ) : (
                    /* -- STANDARD CHAT / INBOUND ANALYTICS ------------------- */
                    data ? (
                        <StandardAnalytics
                            data={data}
                            range={range}
                            agentId={agentId!}
                            navigate={navigate}
                        />
                    ) : (
                        <p className="text-center py-20 text-ocean-deep/60">No analytics data available.</p>
                    )
                )}
            </div>
        </AnimatedPage>
    );
}

// --- Outbound Call Performance Analytics -------------------------------------

function OutboundAnalytics({ stats, loading, agentId, navigate }: {
    stats: CallStats | null;
    loading: boolean;
    agentId: string;
    navigate: (to: string) => void;
}) {
    if (loading || !stats) {
        return (
            <div className="flex items-center justify-center py-20">
                <Loader2 className="h-8 w-8 animate-spin text-ocean-deep" />
            </div>
        );
    }

    const latencyColor = stats.avgLatencyMs > 3000 ? 'text-red-500' : stats.avgLatencyMs > 1500 ? 'text-amber-500' : 'text-green-600';
    const rateColor = stats.connectionRate >= 70 ? 'text-green-600' : stats.connectionRate >= 40 ? 'text-amber-500' : 'text-red-500';

    return (
        <div className="space-y-6">
            {/* KPI cards */}
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
                <KPICard
                    title="Total Calls"
                    value={stats.total}
                    icon={<PhoneCall className="h-5 w-5" />}
                    accent="ocean"
                />
                <KPICard
                    title="Connected"
                    value={stats.completed}
                    icon={<CheckCircle2 className="h-5 w-5" />}
                    accent="green"
                    subtitle={`${stats.connectionRate}% rate`}
                />
                <KPICard
                    title="Connection Rate"
                    value={`${stats.connectionRate}%`}
                    icon={<TrendingUp className="h-5 w-5" />}
                    accent={stats.connectionRate >= 70 ? 'green' : stats.connectionRate >= 40 ? 'amber' : 'red'}
                    valueClassName={rateColor}
                />
                <KPICard
                    title="Avg Duration"
                    value={formatDuration(stats.avgDurationSec)}
                    icon={<Timer className="h-5 w-5" />}
                    accent="ocean"
                    subtitle={`${formatDuration(stats.totalDurationSec)} total`}
                />
                <KPICard
                    title="Avg AI Latency"
                    value={`${(stats.avgLatencyMs / 1000).toFixed(2)}s`}
                    icon={<Wifi className="h-5 w-5" />}
                    accent={stats.avgLatencyMs > 3000 ? 'red' : stats.avgLatencyMs > 1500 ? 'amber' : 'green'}
                    valueClassName={latencyColor}
                    subtitle={stats.avgLatencyMs <= 1500 ? 'Good' : stats.avgLatencyMs <= 3000 ? 'Acceptable' : 'Needs attention'}
                />
                <KPICard
                    title="Failed / Canceled"
                    value={stats.failed + stats.canceled}
                    icon={<XCircle className="h-5 w-5" />}
                    accent="red"
                    subtitle={`${stats.failed} failed ? ${stats.canceled} canceled`}
                />
            </div>

            {/* Latency health note */}
            <div className={`flex items-start gap-3 px-4 py-3 rounded-xl border text-sm ${
                stats.avgLatencyMs <= 1500
                    ? 'bg-green-50 border-green-200 text-green-800'
                    : stats.avgLatencyMs <= 3000
                    ? 'bg-amber-50 border-amber-200 text-amber-800'
                    : 'bg-red-50 border-red-200 text-red-800'
            }`}>
                <Wifi className="h-4 w-4 mt-0.5 shrink-0" />
                <span>
                    <strong>Agent response latency:</strong>{' '}
                    {stats.avgLatencyMs <= 1500
                        ? 'Excellent - your agent is responding quickly and delivering a smooth caller experience.'
                        : stats.avgLatencyMs <= 3000
                        ? 'Acceptable - response times are within range, but consider optimizing your agent prompts to improve speed.'
                        : 'High latency detected - callers may experience noticeable pauses. Review your agent configuration and integrations.'}
                </span>
            </div>

            {/* Calls over time chart */}
            <CallTimelineChart data={stats.callTimeline} />

            {/* Quick links */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <QuickLink
                    title="View Call History"
                    subtitle="See individual call transcripts and session details"
                    icon={<Phone className="h-6 w-6" />}
                    color="blue"
                    onClick={() => navigate(`/voice-history/${agentId}`)}
                />
                <QuickLink
                    title="Edit Agent"
                    subtitle="Configure settings, prompts & phone numbers"
                    icon={<FileText className="h-6 w-6" />}
                    color="purple"
                    onClick={() => navigate(`/agents/${agentId}/edit`)}
                />
            </div>
        </div>
    );
}

// --- Calls Over Time Chart ----------------------------------------------------

function CallTimelineChart({ data }: { data: { date: string; calls: number }[] }) {
    if (!data.length) {
        return (
            <div className="bg-white rounded-xl border border-ocean-ice p-6 shadow-sm">
                <h3 className="text-sm font-semibold text-ocean-deep mb-4">Calls Over Time</h3>
                <p className="text-sm text-ocean-deep/60 text-center py-8">No call data for this period</p>
            </div>
        );
    }
    const maxVal = Math.max(...data.map(d => d.calls), 1);
    return (
        <div className="bg-white rounded-xl border border-ocean-ice p-6 shadow-sm">
            <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-semibold text-ocean-deep">Calls Over Time</h3>
                <span className="text-xs text-ocean-deep/60 flex items-center gap-1">
                    <div className="w-2 h-2 rounded-full bg-ocean-bright" /> Calls
                </span>
            </div>
            <div className="flex items-end gap-1 h-40">
                {data.map((entry, idx) => {
                    const height = Math.max((entry.calls / maxVal) * 100, 2);
                    const dateLabel = entry.date.slice(5);
                    return (
                        <div key={idx} className="flex-1 flex flex-col items-center gap-1 group relative">
                            <div className="absolute bottom-full mb-2 hidden group-hover:block bg-gray-900 text-white text-xs rounded-lg px-2 py-1 whitespace-nowrap z-10">
                                <div>{entry.date}</div>
                                <div className="font-semibold">{entry.calls} calls</div>
                            </div>
                            <div
                                className="w-full rounded-t bg-ocean-bright opacity-80 hover:opacity-100 transition-all cursor-pointer"
                                style={{ height: `${height}%`, minHeight: '2px' }}
                            />
                            {data.length <= 14 && (
                                <span className="text-[9px] text-ocean-deep/60 -rotate-45 origin-top-left translate-y-1">{dateLabel}</span>
                            )}
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

// --- Standard (Chat/Inbound) Analytics ---------------------------------------

function StandardAnalytics({ data, range, agentId, navigate }: {
    data: AnalyticsData;
    range: number;
    agentId: string;
    navigate: (to: string) => void;
}) {
    const { orders, leads } = data;

    const exportPDF = () => {
        const win = window.open('', '_blank', 'width=960,height=750');
        if (!win) return;
        const topItemsRows = orders.topItems.map((item, i) => `
            <tr><td>${i + 1}</td><td>${item.name}</td><td>${item.count}</td></tr>`).join('');
        const statusRow = (d: Record<string, number>, total: number) =>
            Object.entries(d).map(([s, c]) =>
                `<tr><td style="text-transform:capitalize">${s}</td><td>${c}</td><td>${total > 0 ? ((c / total) * 100).toFixed(1) : 0}%</td></tr>`
            ).join('');
        const html = `<!DOCTYPE html><html><head><title>Analytics: ${data.agent.name}</title>
        <style>
            *{box-sizing:border-box}body{font-family:Arial,sans-serif;margin:28px;color:#111;font-size:13px}
            h1{color:#023e8a;font-size:22px;margin:0 0 4px}.meta{color:#6b7280;font-size:12px;margin-bottom:20px}
            h2{font-size:13px;text-transform:uppercase;letter-spacing:1px;color:#374151;margin:20px 0 8px;border-bottom:1px solid #e5e7eb;padding-bottom:4px}
            .kpi{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:8px}
            .kpi-card{border:1px solid #e5e7eb;border-radius:8px;padding:12px 16px}
            .kv{font-size:24px;font-weight:700;color:#023e8a}.kl{font-size:11px;color:#6b7280;margin-top:3px}
            .two-col{display:grid;grid-template-columns:1fr 1fr;gap:20px}
            table{width:100%;border-collapse:collapse;font-size:12px}
            th{background:#f3f4f6;padding:7px 8px;text-align:left;color:#374151}
            td{padding:7px 8px;border-bottom:1px solid #f3f4f6}tr:nth-child(even) td{background:#fafafa}
            @media print{body{margin:0}button{display:none}}
        </style></head><body>
        <h1>Analytics Report</h1>
        <div class="meta"><strong>${data.agent.name}</strong> &nbsp;?&nbsp; Last ${range} days &nbsp;?&nbsp; Exported ${new Date().toLocaleString()}</div>
        <h2>Key Metrics</h2>
        <div class="kpi">
            <div class="kpi-card"><div class="kv">${orders.total}</div><div class="kl">Total Orders (${orders.today} today)</div></div>
            <div class="kpi-card"><div class="kv">${orders.inRange}</div><div class="kl">Orders in selected range</div></div>
            <div class="kpi-card"><div class="kv">${leads.total}</div><div class="kl">Total Leads (${leads.today} today)</div></div>
            <div class="kpi-card"><div class="kv">${leads.conversionRate}%</div><div class="kl">Conversion Rate</div></div>
            <div class="kpi-card"><div class="kv">${leads.avgScore}</div><div class="kl">Avg Lead Score</div></div>
        </div>
        <div class="two-col">
            <div><h2>Order Status</h2>
            <table><thead><tr><th>Status</th><th>Count</th><th>%</th></tr></thead>
            <tbody>${statusRow(orders.byStatus, orders.total)}</tbody></table></div>
            <div><h2>Lead Pipeline</h2>
            <table><thead><tr><th>Status</th><th>Count</th><th>%</th></tr></thead>
            <tbody>${statusRow(leads.byStatus, leads.total)}</tbody></table></div>
        </div>
        ${orders.topItems.length > 0 ? `
        <h2>Top items (by quantity)</h2>
        <table><thead><tr><th>#</th><th>Item</th><th>Qty Sold</th></tr></thead>
        <tbody>${topItemsRows}</tbody></table>` : ''}
        <script>window.onload=()=>window.print()</script>
        </body></html>`;
        win.document.write(html);
        win.document.close();
    };

    return (
        <div className="space-y-6">
            {/* PDF export button (only for standard) */}
            <div className="flex justify-end -mt-4">
                <button
                    onClick={exportPDF}
                    className="flex items-center px-3 py-1.5 bg-white border border-ocean-ice rounded-lg hover:bg-ocean-powder text-sm font-medium text-ocean-deep"
                >
                    <FileText className="h-4 w-4 mr-1.5 text-rose-500" /> PDF
                </button>
            </div>

            {/* KPI cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <KPICard
                    title="Total Orders"
                    value={orders.total}
                    subtitle={`${orders.today} today ? ${orders.thisWeek} this week`}
                    icon={<ShoppingBag className="h-5 w-5" />}
                    accent="blue"
                />
                <KPICard
                    title="Orders in Range"
                    value={orders.inRange}
                    subtitle={`Last ${range} days`}
                    icon={<TrendingUp className="h-5 w-5" />}
                    accent="ocean"
                />
                <KPICard
                    title="Unique Clients"
                    value={leads.total}
                    subtitle={`${leads.today} today ? ${leads.conversionRate}% converted`}
                    icon={<Users className="h-5 w-5" />}
                    accent="green"
                />
                <KPICard
                    title="Avg Lead Score"
                    value={leads.avgScore}
                    subtitle="across all leads"
                    icon={<Users className="h-5 w-5" />}
                    accent="purple"
                />
            </div>

            {/* Activity Charts */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <TimelineChart title="Orders" data={orders.timeline} valueKey="orders" color="blue" />
                <TimelineChart title="Leads" data={leads.timeline} valueKey="leads" color="emerald" />
            </div>

            {/* Top Selling Items */}
            {orders.topItems.length > 0 && (
                <div className="bg-white rounded-xl border border-ocean-ice p-6 shadow-sm">
                    <h3 className="text-sm font-semibold text-ocean-deep mb-4 flex items-center gap-2">
                        <Package className="h-5 w-5 text-amber-600" /> Top items by quantity (last {range} days)
                    </h3>
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="border-b border-ocean-ice/80">
                                    <th className="text-left py-2 text-ocean-deep/80 font-medium">#</th>
                                    <th className="text-left py-2 text-ocean-deep/80 font-medium">Item</th>
                                    <th className="text-right py-2 text-ocean-deep/80 font-medium">Qty Sold</th>
                                </tr>
                            </thead>
                            <tbody>
                                {orders.topItems.map((item, idx) => {
                                    const maxCount = orders.topItems[0]?.count || 1;
                                    const barWidth = (item.count / maxCount) * 100;
                                    return (
                                        <tr key={idx} className="border-b border-ocean-powder hover:bg-ocean-powder/80">
                                            <td className="py-3 text-ocean-deep/60">{idx + 1}</td>
                                            <td className="py-3 font-medium text-ocean-navy">
                                                <div className="relative">
                                                    <div className="absolute inset-y-0 left-0 bg-ocean-powder rounded" style={{ width: `${barWidth}%` }} />
                                                    <span className="relative z-10 pl-2">{item.name}</span>
                                                </div>
                                            </td>
                                            <td className="py-3 text-right text-ocean-deep font-semibold">{item.count}</td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {/* Quick links */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <QuickLink
                    title="View Orders"
                    subtitle={`${orders.total} total orders`}
                    icon={<ShoppingBag className="h-6 w-6" />}
                    color="blue"
                    onClick={() => navigate(`/orders/${agentId}`)}
                />
                <QuickLink
                    title="View Leads"
                    subtitle={`${leads.total} total leads`}
                    icon={<Users className="h-6 w-6" />}
                    color="emerald"
                    onClick={() => navigate(`/leads/${agentId}`)}
                />
                <QuickLink
                    title="Edit Agent"
                    subtitle="Configure settings & catalog"
                    icon={<FileText className="h-6 w-6" />}
                    color="purple"
                    onClick={() => navigate(`/agents/${agentId}/edit`)}
                />
            </div>
        </div>
    );
}

// --- Shared sub-components ----------------------------------------------------

type Accent = 'ocean' | 'blue' | 'green' | 'purple' | 'amber' | 'red';

const ACCENT_CLASSES: Record<Accent, string> = {
    ocean:  'bg-ocean-bright/20 text-ocean-deep',
    blue:   'bg-blue-100 text-blue-600',
    green:  'bg-green-100 text-green-600',
    purple: 'bg-violet-100 text-violet-600',
    amber:  'bg-amber-100 text-amber-600',
    red:    'bg-red-100 text-red-500',
};

function KPICard({ title, value, subtitle, icon, accent, valueClassName }: {
    title: string;
    value: string | number;
    subtitle?: string;
    icon: React.ReactNode;
    accent: Accent;
    valueClassName?: string;
}) {
    return (
        <div className="bg-white rounded-xl border border-ocean-ice/80 p-4 shadow-sm">
            <div className={`inline-flex p-2 rounded-lg mb-3 ${ACCENT_CLASSES[accent]}`}>
                {icon}
            </div>
            <p className="text-xs text-ocean-deep/70">{title}</p>
            <p className={`text-2xl font-bold mt-0.5 ${valueClassName ?? 'text-ocean-navy'}`}>{value}</p>
            {subtitle && <p className="text-xs text-ocean-deep/55 mt-0.5">{subtitle}</p>}
        </div>
    );
}

function TimelineChart({ title, data, valueKey, color }: {
    title: string;
    data: TimelineEntry[];
    valueKey: string;
    color: string;
}) {
    if (!data.length) {
        return (
            <div className="bg-white rounded-xl border border-ocean-ice p-6 shadow-sm">
                <h3 className="text-sm font-semibold text-ocean-deep mb-4">{title} Over Time</h3>
                <p className="text-sm text-ocean-deep/60 text-center py-8">No data for this period</p>
            </div>
        );
    }
    const values = data.map(d => (d as Record<string, number>)[valueKey] || 0);
    const maxValue = Math.max(...values, 1);
    const colorMap: Record<string, string> = {
        blue: 'bg-blue-400', emerald: 'bg-emerald-400', purple: 'bg-purple-400', amber: 'bg-amber-400',
    };
    const barColor = colorMap[color] || 'bg-ocean-bright';

    return (
        <div className="bg-white rounded-xl border border-ocean-ice p-6 shadow-sm">
            <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-semibold text-ocean-deep">{title} Over Time</h3>
                <span className="text-xs text-ocean-deep/60 flex items-center gap-1">
                    <div className={`w-2 h-2 rounded-full ${barColor}`} /> {title}
                </span>
            </div>
            <div className="flex items-end gap-1 h-40">
                {data.map((entry, idx) => {
                    const val = (entry as Record<string, number>)[valueKey] || 0;
                    const height = Math.max((val / maxValue) * 100, 2);
                    const dateLabel = entry.date.slice(5);
                    return (
                        <div key={idx} className="flex-1 flex flex-col items-center gap-1 group relative">
                            <div className="absolute bottom-full mb-2 hidden group-hover:block bg-gray-900 text-white text-xs rounded-lg px-2 py-1 whitespace-nowrap z-10">
                                <div>{entry.date}</div>
                                <div className="font-semibold">{val} {title.toLowerCase()}</div>
                            </div>
                            <div
                                className={`w-full rounded-t ${barColor} opacity-80 hover:opacity-100 transition-all cursor-pointer`}
                                style={{ height: `${height}%`, minHeight: '2px' }}
                            />
                            {data.length <= 14 && (
                                <span className="text-[9px] text-ocean-deep/60 -rotate-45 origin-top-left translate-y-1">{dateLabel}</span>
                            )}
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

function QuickLink({ title, subtitle, icon, color, onClick }: {
    title: string; subtitle: string; icon: React.ReactNode; color: string; onClick: () => void;
}) {
    const gradientMap: Record<string, string> = {
        blue: 'bg-blue-100 text-blue-600',
        emerald: 'bg-emerald-100 text-emerald-600',
        purple: 'bg-violet-100 text-violet-600',
    };
    return (
        <button
            type="button"
            onClick={onClick}
            className="group flex items-center gap-4 bg-white rounded-xl border border-ocean-ice p-5 shadow-sm hover:shadow-md transition-all text-left w-full"
        >
            <div className={`p-3 rounded-xl shrink-0 ${gradientMap[color] || 'bg-ocean-powder text-ocean-deep'}`}>
                {icon}
            </div>
            <div className="flex-1 min-w-0">
                <p className="font-semibold text-ocean-navy">{title}</p>
                <p className="text-xs text-ocean-deep/70 mt-0.5">{subtitle}</p>
            </div>
            <ArrowUpRight className="h-4 w-4 text-ocean-deep/50 group-hover:text-ocean-deep transition-colors shrink-0" />
        </button>
    );
}
