/**
 * Workspace executive analytics (business admins only) - revenue, orders, per-agent performance.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { PageBackNav } from '../components/PageBackNav';
import { GlobalAnalyticsSkeleton } from '../components/skeletons';
import AnimatedPage from '../components/AnimatedPage';
import {
    BarChart3,
    Bot,
    CheckCircle,
    DollarSign,
    LayoutDashboard,
    Loader2,
    MessageSquare,
    Mic,
    RefreshCw,
    ShoppingBag,
    TrendingUp,
    Users,
    XCircle,
    Zap,
} from 'lucide-react';
import { convertAmount, fetchRatesFrom, type RatesMap } from '../utils/fxFromUsd';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3000';
const DISPLAY_CURRENCY_KEY = 'elva_display_currency';
/** Tracks the last workspace reporting currency we saw - if it changes we must reset the display pref. */
const LAST_WS_CURRENCY_KEY = 'elva_last_ws_currency';

interface AgentPerfRow {
    id: string;
    name: string;
    type: 'chat' | 'voice';
    orders: number;
    revenue: number;
    leads: number;
}

interface OverviewData {
    summary: {
        totalAgents: number;
        chatAgents: number;
        voiceAgents: number;
        totalOrdersAllTime: number;
        ordersToday: number;
        ordersInRange: number;
        totalRevenueAllTime: number;
        revenueInRange: number;
        totalLeadsAllTime: number;
        leadsToday: number;
        leadsInRange: number;
        totalDocuments: number;
    };
    subscription: {
        plan: string;
        status: string;
        messagesUsed: number;
        messagesQuota?: number | null;
    } | null;
    workspace?: {
        reportingCurrency: string;
        ledgerCurrency: string;
    };
    agentPerformance: AgentPerfRow[];
    range: number;
}

const CURRENCY_OPTIONS = [
    'PKR', 'USD', 'EUR', 'GBP', 'INR', 'AED', 'SAR', 'CAD', 'AUD',
] as const;

const RANGE_OPTIONS: { label: string; value: number }[] = [
    { label: 'Last 7 days', value: 7 },
    { label: 'Last 30 days', value: 30 },
    { label: 'Last 90 days', value: 90 },
    { label: 'Last 6 months (180 days)', value: 180 },
    { label: 'Last year (365 days)', value: 365 },
];

function formatMoney(n: number, currencyCode: string) {
    try {
        return new Intl.NumberFormat(undefined, {
            style: 'currency',
            currency: currencyCode,
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
        }).format(n);
    } catch {
        return `${currencyCode} ${n.toFixed(2)}`;
    }
}

export default function GlobalAnalytics() {
    const { token, user } = useAuth();
    const navigate = useNavigate();
    const [data, setData] = useState<OverviewData | null>(null);
    const [loading, setLoading] = useState(true);
    const [aiService, setAiService] = useState<{ healthy: boolean; lastCheckedAt: string | null } | null>(null);
    const [range, setRange] = useState(30);
    const [autoRefresh, setAutoRefresh] = useState(true);

    // displayCurrency persists in localStorage so other pages (e.g. OrdersPage) respect it too.
    const [displayCurrency, setDisplayCurrency] = useState<string>(
        () => localStorage.getItem(DISPLAY_CURRENCY_KEY) || 'PKR',
    );
    // dataCurrency = the currency the raw DB amounts are actually stored in.
    // This is the LAST KNOWN workspace currency, not necessarily the current one.
    // When a workspace admin changes reportingCurrency, existing DB values are NOT converted
    // by the backend, so we must keep using the old currency as the conversion base.
    const [dataCurrency, setDataCurrency] = useState<string>(
        () => localStorage.getItem(LAST_WS_CURRENCY_KEY) || localStorage.getItem(DISPLAY_CURRENCY_KEY) || 'PKR',
    );
    const [fxRates, setFxRates] = useState<RatesMap | null>(null);
    const [fxStatus, setFxStatus] = useState<'idle' | 'loading' | 'ok' | 'error'>('idle');

    // True until first successful load - after that, refreshes run silently (no skeleton).
    const silentRefreshRef = useRef(false);

    // Detects workspace currency changes made by an admin in Profile/Settings.
    // If the workspace's reportingCurrency changes we MUST reset the display currency to match,
    // because existing DB amounts are still denominated in the OLD currency - applying an FX conversion
    // on top of them would produce wildly incorrect numbers.
    const [wsCurrencyMismatchWarn, setWsCurrencyMismatchWarn] = useState(false);

    const fetchOverview = useCallback(async () => {
        if (!silentRefreshRef.current) {
            setLoading(true);
        }
        try {
            const headers = { Authorization: `Bearer ${token}` };
            const [res, alertsRes] = await Promise.all([
                fetch(`${API_BASE}/api/analytics/overview?range=${range}`, { headers }),
                fetch(`${API_BASE}/api/voice-admin/alerts`, { headers }),
            ]);
            if (res.status === 403) { navigate('/dashboard', { replace: true }); return; }
            if (res.status === 401) { navigate('/login', { replace: true }); return; }
            if (res.ok) {
                const payload = (await res.json()) as OverviewData;
                setData(payload);
                silentRefreshRef.current = true;
                // On first load, default displayCurrency to workspace currency only if user hasn't set a preference.
                if (!localStorage.getItem(DISPLAY_CURRENCY_KEY)) {
                    const wc = payload.workspace?.reportingCurrency || 'PKR';
                    setDisplayCurrency(wc);
                    localStorage.setItem(DISPLAY_CURRENCY_KEY, wc);
                }
            }
            if (alertsRes.ok) {
                const a = await alertsRes.json();
                setAiService(a?.aiService ?? null);
            }
        } catch (e) {
            console.error('Global analytics fetch error', e);
        } finally {
            setLoading(false);
        }
    }, [token, range, navigate]);

    // Workspace currency stored in DB - read-only here; change it in Profile/Settings.
    const workspaceCurrency = data?.workspace?.reportingCurrency || 'PKR';

    // Sync: detect if workspace currency was changed externally (e.g., via Profile page).
    // IMPORTANT: the backend does NOT convert historical amounts when reportingCurrency changes.
    // So raw DB values are still in the OLD currency. We keep dataCurrency = old currency
    // so all FX math stays correct. displayCurrency is NOT reset; user keeps their preference.
    useEffect(() => {
        if (!data) return;
        const wc = (data.workspace?.reportingCurrency || 'PKR').toUpperCase();
        const lastSeen = (localStorage.getItem(LAST_WS_CURRENCY_KEY) || '').toUpperCase();

        if (lastSeen && lastSeen !== wc) {
            // Workspace currency label changed but raw amounts are still in `lastSeen` currency.
            // Keep dataCurrency = lastSeen so conversion base stays correct.
            // dataCurrency state was initialized from LAST_WS_CURRENCY_KEY so it's already correct.
            setWsCurrencyMismatchWarn(true);
        }

        if (!lastSeen) {
            // First visit ever - initialize both dataCurrency and displayCurrency from workspace setting
            setDataCurrency(wc);
            if (!localStorage.getItem(DISPLAY_CURRENCY_KEY)) {
                setDisplayCurrency(wc);
                localStorage.setItem(DISPLAY_CURRENCY_KEY, wc);
            }
        }
        // Always update the tracker so next session picks up the current API value
        localStorage.setItem(LAST_WS_CURRENCY_KEY, wc);
    }, [data]);

    const handleDisplayCurrencyChange = (code: string) => {
        setDisplayCurrency(code);
        localStorage.setItem(DISPLAY_CURRENCY_KEY, code);
    };

    // Fetch FX rates whenever the conversion pair changes.
    // Base = dataCurrency (currency amounts are ACTUALLY stored in).
    // Target = displayCurrency (what user wants to see).
    useEffect(() => {
        if (dataCurrency.toUpperCase() === displayCurrency.toUpperCase()) {
            setFxRates(null);
            setFxStatus('idle');
            return;
        }
        let cancelled = false;
        setFxStatus('loading');
        fetchRatesFrom(dataCurrency)
            .then((rates) => {
                if (!cancelled) { setFxRates(rates); setFxStatus('ok'); }
            })
            .catch(() => {
                if (!cancelled) { setFxRates(null); setFxStatus('error'); }
            });
        return () => { cancelled = true; };
    }, [dataCurrency, displayCurrency]);


    useEffect(() => {
        if (user?.role && user.role !== 'business_admin') {
            navigate('/dashboard', { replace: true });
            return;
        }
        fetchOverview();
    }, [fetchOverview, user?.role, navigate]);

    useEffect(() => {
        if (!autoRefresh) return;
        const t = setInterval(fetchOverview, 60_000);
        return () => clearInterval(t);
    }, [autoRefresh, fetchOverview]);

    /**
     * Format a stored amount for display.
     * Amounts are stored in `dataCurrency` (the workspace currency at time of recording).
     * When displayCurrency differs, live FX rates convert dataCurrency -> displayCurrency.
     */
    const displayRevenue = (amount: number): { text: string; footnote?: string } => {
        const base = dataCurrency.toUpperCase();   // what the raw number is denominated in
        const show = displayCurrency.toUpperCase(); // what the user wants to see

        if (base === show) {
            return { text: formatMoney(amount, base) };
        }

        if (fxStatus === 'loading') {
            return { text: formatMoney(amount, base), footnote: `Loading ${show} rates...` };
        }

        if (fxStatus === 'error' || !fxRates) {
            return { text: formatMoney(amount, base), footnote: `Showing ${base} (rates unavailable)` };
        }

        const converted = convertAmount(amount, show, fxRates);
        if (converted == null) {
            return { text: formatMoney(amount, base), footnote: `Showing ${base} (rate unavailable)` };
        }

        return { text: formatMoney(converted, show) };
    };

    if (loading && !data) {
        return <GlobalAnalyticsSkeleton />;
    }

    if (!data) {
        return (
            <div className="max-w-7xl mx-auto px-4 py-16 text-center text-ocean-deep">
                <p>Could not load workspace analytics.</p>
                <button type="button" onClick={() => navigate('/dashboard')} className="mt-4 text-ocean-sky underline">
                    Back to dashboard
                </button>
            </div>
        );
    }

    const { summary, agentPerformance, subscription } = data;
    const rangeMeta = RANGE_OPTIONS.find((o) => o.value === range);
    const periodSubtitle = rangeMeta?.label ?? `Last ${range} days`;

    return (
        <AnimatedPage className="bg-white pb-12 py-8 px-4 sm:px-6 lg:px-8">
            <div className="max-w-7xl mx-auto space-y-6">
                <PageBackNav to="/dashboard" label="Back to Dashboard" />

                {wsCurrencyMismatchWarn && (
                    <div className="flex items-center gap-3 p-3.5 rounded-xl border border-amber-200 bg-amber-50 text-amber-800 text-sm">
                        <span className="shrink-0 text-amber-500">&#9888;</span>
                        <p className="flex-1">
                            <span className="font-semibold">Workspace currency was changed.</span>
                            {' '}Existing amounts are still shown in <strong>{dataCurrency}</strong>. Switch the display currency above to convert.
                        </p>
                        <button onClick={() => setWsCurrencyMismatchWarn(false)} className="shrink-0 text-amber-500 hover:text-amber-700 ml-2">&#x2715;</button>
                    </div>
                )}

                <section className="rounded-2xl border border-ocean-ice/90 bg-white shadow-sm overflow-hidden">
                    <div className="p-5 sm:p-6 border-b border-ocean-powder bg-slate-50/70">
                        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between lg:gap-8">
                            <div className="min-w-0 flex-1 space-y-2">
                                <h1 className="text-2xl font-bold text-ocean-navy flex items-center gap-2">
                                    <LayoutDashboard className="h-7 w-7 shrink-0 text-ocean-rich" />
                                    Global analytics
                                </h1>
                                <p className="text-sm text-ocean-deep/85 leading-relaxed max-w-3xl">
                                    Executive view of your workspace: revenue from orders, pipeline leads, document usage,
                                    and per-agent contribution. Filter by period to compare performance.
                                </p>
                                <p className="text-xs font-medium text-ocean-deep/65">{periodSubtitle}</p>
                            </div>
                            <div className="hidden xl:block shrink-0 w-px min-h-[4.5rem] self-stretch bg-ocean-ice/80" aria-hidden />
                            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 lg:gap-4 shrink-0 lg:min-w-[min(100%,20rem)]">
                                <div className="rounded-xl border border-ocean-ice/70 bg-white px-3 py-2.5 text-center shadow-sm">
                                    <p className="text-[10px] uppercase tracking-wide text-ocean-deep/60">Agents</p>
                                    <p className="text-lg font-bold text-ocean-navy tabular-nums">{summary.totalAgents}</p>
                                </div>
                                <div className="rounded-xl border border-ocean-ice/70 bg-white px-3 py-2.5 text-center shadow-sm">
                                    <p className="text-[10px] uppercase tracking-wide text-ocean-deep/60">Orders (range)</p>
                                    <p className="text-lg font-bold text-ocean-navy tabular-nums">{summary.ordersInRange}</p>
                                </div>
                                <div className="rounded-xl border border-ocean-ice/70 bg-white px-3 py-2.5 text-center shadow-sm col-span-2 sm:col-span-1">
                                    <p className="text-[10px] uppercase tracking-wide text-ocean-deep/60">Leads (range)</p>
                                    <p className="text-lg font-bold text-ocean-navy tabular-nums">{summary.leadsInRange}</p>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div className="px-4 py-3 sm:px-5 sm:py-4 bg-ocean-powder/25 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
                        <div className="flex flex-wrap items-end gap-x-3 gap-y-2 flex-1">
                            {/* Period selector */}
                            <label className="flex flex-col gap-1 min-w-[10.5rem]">
                                <span className="text-[11px] font-medium uppercase tracking-wide text-ocean-deep/65">Period</span>
                                <select
                                    value={range}
                                    onChange={(e) => setRange(Number(e.target.value))}
                                    className="text-sm border border-ocean-ice rounded-lg px-3 py-2 bg-white w-full"
                                    aria-label="Report period"
                                >
                                    {RANGE_OPTIONS.map((opt) => (
                                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                                    ))}
                                </select>
                            </label>

                            {/* Display currency  - local only, converts amounts via live FX */}
                            <label className="flex flex-col gap-1 min-w-[9rem]">
                                <span className="text-[11px] font-medium uppercase tracking-wide text-ocean-deep/65">
                                    Display in
                                    {fxStatus === 'loading' && (
                                        <span className="ml-1 text-ocean-deep/40 normal-case">(loading rates…)</span>
                                    )}
                                    {fxStatus === 'error' && (
                                        <span className="ml-1 text-red-400 normal-case">(rates unavailable)</span>
                                    )}
                                </span>
                                <select
                                    value={displayCurrency}
                                    onChange={(e) => handleDisplayCurrencyChange(e.target.value)}
                                    className="text-sm border border-ocean-ice rounded-lg px-3 py-2 bg-white w-full font-medium text-ocean-navy"
                                    aria-label="Display currency"
                                    title="Converts all revenue amounts platform-wide. Workspace base currency is set in Profile."
                                >
                                    {CURRENCY_OPTIONS.map((c) => (
                                        <option key={c} value={c}>{c}</option>
                                    ))}
                                </select>
                            </label>
                        </div>

                        <div className="flex items-center gap-2 shrink-0 lg:pl-2">
                            <button
                                type="button"
                                onClick={() => setAutoRefresh(!autoRefresh)}
                                className={`flex items-center gap-1.5 text-sm px-3 py-2 rounded-lg border transition-colors ${
                                    autoRefresh
                                        ? 'border-green-200 bg-green-50 text-green-700'
                                        : 'border-ocean-ice bg-white text-ocean-deep/90'
                                }`}
                                title="Live: refresh automatically every 60 seconds."
                            >
                                <RefreshCw className={`h-3.5 w-3.5 ${autoRefresh ? 'animate-spin' : ''}`} />
                                {autoRefresh ? 'Live' : 'Paused'}
                            </button>
                            <button
                                type="button"
                                onClick={() => void fetchOverview()}
                                className="inline-flex items-center justify-center h-10 w-10 rounded-lg border border-ocean-ice bg-white hover:bg-ocean-mist/60 transition-colors"
                                title="Refresh now"
                            >
                                <RefreshCw className="h-4 w-4 text-ocean-deep/90" />
                            </button>
                        </div>
                    </div>
                </section>

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
                    {(() => {
                        const revRange = displayRevenue(summary.revenueInRange);
                        const revAll = displayRevenue(summary.totalRevenueAllTime);
                        return (
                            <>
                                <Kpi
                                    title="Revenue (range)"
                                    value={revRange.text}
                                    subtitle={[revRange.footnote, 'excl. cancelled orders'].filter(Boolean).join(' · ')}
                                    icon={<DollarSign className="h-5 w-5" />}
                                    gradient="from-ocean-sky to-ocean-bright"
                                />
                                <Kpi
                                    title="Revenue (all time)"
                                    value={revAll.text}
                                    subtitle={revAll.footnote}
                                    icon={<TrendingUp className="h-5 w-5" />}
                                    gradient="from-ocean-bright to-ocean-rich"
                                />
                            </>
                        );
                    })()}
                    <Kpi
                        title="Orders (range)"
                        value={summary.ordersInRange}
                        subtitle={`${summary.ordersToday} today`}
                        icon={<ShoppingBag className="h-5 w-5" />}
                        gradient="from-ocean-rich to-ocean-deep"
                    />
                    <Kpi
                        title="Orders (all time)"
                        value={summary.totalOrdersAllTime}
                        icon={<BarChart3 className="h-5 w-5" />}
                        gradient="from-ocean-deep to-ocean-navy"
                    />
                </div>

                {subscription && (
                    <div className="rounded-xl border border-ocean-ice/80 bg-white px-4 py-2.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                        <span className="flex items-center gap-2 text-ocean-deep">
                            <Zap className="h-4 w-4 text-ocean-bright shrink-0" />
                            <span className="capitalize font-medium text-ocean-navy">{subscription.plan}</span>
                            <span className="text-ocean-deep/70">{subscription.status}</span>
                        </span>
                        <span className="text-ocean-deep/80">
                            {subscription.messagesUsed.toLocaleString()} messages this month
                        </span>
                    </div>
                )}

                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <Kpi
                        title="Chat agents"
                        value={summary.chatAgents}
                        icon={<MessageSquare className="h-5 w-5" />}
                        gradient="from-ocean-sky to-ocean-bright"
                    />
                    <Kpi
                        title="Voice agents"
                        value={summary.voiceAgents}
                        icon={<Mic className="h-5 w-5" />}
                        gradient="from-ocean-deep to-ocean-navy"
                    />
                    <Kpi
                        title="Leads (range)"
                        value={summary.leadsInRange}
                        subtitle={`${summary.leadsToday} new today`}
                        icon={<Users className="h-5 w-5" />}
                        gradient="from-ocean-bright to-ocean-rich"
                    />
                    <Kpi
                        title="Documents"
                        value={summary.totalDocuments}
                        icon={<Bot className="h-5 w-5" />}
                        gradient="from-ocean-rich to-ocean-deep"
                    />
                </div>

                <div className="bg-white rounded-2xl border border-ocean-ice/80 shadow-sm overflow-hidden">
                    <div className="px-5 py-4 border-b border-ocean-ice/80">
                        <h2 className="font-semibold text-ocean-navy">Per-agent performance ({periodSubtitle.toLowerCase()})</h2>
                        <p className="text-xs text-ocean-deep/70 mt-1">Orders, revenue, and leads attributed in this period.</p>
                    </div>
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="bg-ocean-powder/50 text-left text-ocean-deep/80">
                                    <th className="px-4 py-3 font-medium">Agent</th>
                                    <th className="px-4 py-3 font-medium">Type</th>
                                    <th className="px-4 py-3 font-medium text-right">Orders</th>
                                    <th className="px-4 py-3 font-medium text-right">Revenue</th>
                                    <th className="px-4 py-3 font-medium text-right">Leads</th>
                                </tr>
                            </thead>
                            <tbody>
                                {agentPerformance.map((row) => (
                                    <tr key={row.id} className="border-t border-ocean-powder hover:bg-ocean-powder/30">
                                        <td className="px-4 py-3 font-medium text-ocean-navy">{row.name}</td>
                                        <td className="px-4 py-3 capitalize text-ocean-deep/90">{row.type}</td>
                                        <td className="px-4 py-3 text-right">{row.orders}</td>
                                        <td className="px-4 py-3 text-right">{displayRevenue(row.revenue).text}</td>
                                        <td className="px-4 py-3 text-right">{row.leads}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                        {agentPerformance.length === 0 && (
                            <p className="text-center text-ocean-deep/70 py-10">No agents in this workspace yet.</p>
                        )}
                    </div>
                </div>
            </div>
        </AnimatedPage>
    );
}

function Kpi({
    title,
    value,
    subtitle,
    icon,
    gradient,
}: {
    title: string;
    value: string | number;
    subtitle?: string;
    icon: ReactNode;
    gradient: string;
}) {
    return (
        <div className="group relative bg-white rounded-2xl shadow-sm border border-ocean-ice/80 p-5 hover:shadow-lg transition-all">
            <div className={`absolute -inset-0.5 bg-gradient-to-r ${gradient} rounded-2xl opacity-0 group-hover:opacity-20 blur transition-opacity`} />
            <div className="relative">
                <div className={`inline-flex p-2 rounded-lg bg-gradient-to-r ${gradient} text-white mb-3`}>{icon}</div>
                <p className="text-xs text-ocean-deep/80">{title}</p>
                <p className="text-xl font-bold text-ocean-navy mt-0.5">{value}</p>
                {subtitle && <p className="text-[10px] text-ocean-deep/60 mt-1 leading-snug">{subtitle}</p>}
            </div>
        </div>
    );
}
