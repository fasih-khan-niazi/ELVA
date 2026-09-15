/**
 * ELVA Platform operator console (`/platform`). Requires `platform_admin` JWT from normal login.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { appToast as toast } from '../components/Toast';
import {
    LayoutDashboard,
    Server,
    RefreshCw,
    Plus,
    Trash2,
    Loader2,
    Copy,
    CalendarClock,
    ShieldOff,
    LogOut,
    Shield,
    Activity,
    Users,
    Building2,
    Bot,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import ConfirmDialog from '../components/ConfirmDialog';
import { copyWithToast } from '@/lib/apiError';
import { useAuth } from '../context/AuthContext';
import {
    PLATFORM_JWT_BACKUP_KEY,
    PLATFORM_USER_BACKUP_KEY,
} from '../constants/platformPortal';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3000';

type Overview = {
    totals: {
        tenants: number;
        workspaceUsers: number;
        agents: number;
        platformAdmins: number;
        subscriptions: number;
    };
    subscriptionBreakdown: {
        freeEstimate: number;
        paidApprox: number;
        canceled: number;
        approximateMRRUsdAcrossPlans: number;
    };
    assumptions: string;
};

type TenantRow = {
    id: string;
    name: string;
    plan: string;
    registrationType?: string;
    memberCount: number;
    accessSuspendedUntil: string | null;
    subscription: null | {
        plan: string;
        status: string;
        stripeSubscriptionId?: string;
    };
};

type Health = {
    status: string;
    mongo: string;
    aiServiceHttp: string;
    stripe: { configured: boolean; apiReachable: boolean };
    emailOutbound: string;
    aiServiceOrigin: string;
    timestamp: string;
};

/** Platform access freeze: suspend until N days from now (UTC-ish via local calendar day). */
function daysFromNowISO(days: number): string {
    const dt = new Date();
    dt.setDate(dt.getDate() + Math.max(1, Math.floor(days)));
    return dt.toISOString();
}

const FREEZE_PRESET_DAYS = [7, 14, 30, 90, 180, 365] as const;

export default function PlatformDashboard() {
    const { token, user, login, logout } = useAuth();
    const headers = useMemo(
        () => ({
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
        }),
        [token],
    );

    const [tab, setTab] = useState<'overview' | 'tenants' | 'health'>('overview');
    const [overview, setOverview] = useState<Overview | null>(null);
    const [health, setHealth] = useState<Health | null>(null);
    const [tenants, setTenants] = useState<TenantRow[]>([]);
    const [loading, setLoading] = useState(true);
    const [sandboxBusy, setSandboxBusy] = useState(false);

    const backupExists =
        !!localStorage.getItem(PLATFORM_JWT_BACKUP_KEY) &&
        !!localStorage.getItem(PLATFORM_USER_BACKUP_KEY);

    const loadOverview = useCallback(async () => {
        const r = await fetch(`${API_BASE}/api/platform/overview`, { headers });
        if (!r.ok) throw new Error('overview');
        setOverview(await r.json());
    }, [headers]);

    const loadTenants = useCallback(async () => {
        const r = await fetch(`${API_BASE}/api/platform/tenants?limit=120`, { headers });
        if (!r.ok) throw new Error('tenants');
        const d = await r.json();
        setTenants(d.tenants ?? []);
    }, [headers]);

    const loadHealth = useCallback(async () => {
        const r = await fetch(`${API_BASE}/api/platform/health`, { headers });
        if (!r.ok) throw new Error('health');
        setHealth(await r.json());
    }, [headers]);

    const reload = useCallback(async () => {
        setLoading(true);
        try {
            await Promise.all([loadOverview(), loadTenants(), loadHealth()]);
        } catch {
            toast.error('Unable to reload platform telemetry.');
        } finally {
            setLoading(false);
        }
    }, [loadOverview, loadTenants, loadHealth]);

    useEffect(() => {
        void reload();
    }, [reload]);

    const explorationStart = async () => {
        if (!token || !user) return;
        setSandboxBusy(true);
        try {
            localStorage.setItem(PLATFORM_JWT_BACKUP_KEY, token);
            localStorage.setItem(PLATFORM_USER_BACKUP_KEY, JSON.stringify(user));
            const r = await fetch(`${API_BASE}/api/platform/exploration/sandbox/session`, {
                method: 'POST',
                headers,
            });
            const payload = await r.json().catch(() => ({}));
            if (!r.ok) {
                localStorage.removeItem(PLATFORM_JWT_BACKUP_KEY);
                localStorage.removeItem(PLATFORM_USER_BACKUP_KEY);
                toast.error(
                    typeof payload.message === 'string' ? payload.message : 'Sandbox error',
                );
                return;
            }
            login(payload.token, payload.user);
            toast.success('Sandbox JWT issued - loading workspace shell.');
            window.location.assign('/dashboard');
        } finally {
            setSandboxBusy(false);
        }
    };

    const [createOpen, setCreateOpen] = useState(false);
    const [form, setForm] = useState({
        registrationType: 'solo' as 'solo' | 'company',
        organizationName: '',
        adminEmail: '',
        adminName: '',
    });
    const [oncePw, setOncePw] = useState<string | null>(null);
    const [cancelConfirmTenantId, setCancelConfirmTenantId] = useState<string | null>(null);
    const [cancelLoading, setCancelLoading] = useState(false);

    const provisionWorkspace = async () => {
        try {
            const r = await fetch(`${API_BASE}/api/platform/workspaces/create`, {
                method: 'POST',
                headers,
                body: JSON.stringify({
                    registrationType: form.registrationType,
                    organizationName: form.organizationName.trim() || undefined,
                    adminEmail: form.adminEmail.trim(),
                    adminName: form.adminName.trim() || undefined,
                }),
            });
            const d = await r.json();
            if (!r.ok) {
                toast.error(d.message || 'Create failed');
                return;
            }
            setOncePw(d.oneTimePasswordPlaintextShowOnceOnly ?? '');
            toast.success('Workspace created');
            await loadTenants();
        } catch {
            toast.error('Create failed');
        }
    };

    const patchSuspend = async (tenantId: string, untilISO: string | null) => {
        try {
            const r = await fetch(
                `${API_BASE}/api/platform/tenants/${tenantId}/access-suspension`,
                {
                    method: 'PATCH',
                    headers,
                    body: JSON.stringify(
                        untilISO ? { accessSuspendedUntil: untilISO } : {},
                    ),
                },
            );
            const d = await r.json().catch(() => ({}));
            if (!r.ok) {
                toast.error(d.message || 'Update failed');
                return;
            }
            toast.success(d.message || 'Updated');
            await loadTenants();
        } catch {
            toast.error('Update failed');
        }
    };

    const freezeLoginCustomDays = async (tenantId: string) => {
        const raw = window.prompt(
            'Freeze workspace login for how many days?',
            '45',
        );
        if (raw == null || raw.trim() === '') return;
        const n = parseInt(raw.trim(), 10);
        if (!Number.isFinite(n) || n < 1 || n > 3650) {
            toast.error('Enter a whole number between 1 and 3650 days.');
            return;
        }
        await patchSuspend(tenantId, daysFromNowISO(n));
    };

    const cancelStripe = async (tenantId: string) => {
        setCancelLoading(true);
        try {
            const r = await fetch(
                `${API_BASE}/api/platform/tenants/${tenantId}/subscription/cancel-now`,
                { method: 'POST', headers },
            );
            const d = await r.json().catch(() => ({}));
            if (!r.ok) {
                toast.error(d.message || 'Cancel failed');
                return;
            }
            toast.success(d.message || 'Canceled');
            await loadTenants();
            setCancelConfirmTenantId(null);
        } catch {
            toast.error('Cancel failed');
        } finally {
            setCancelLoading(false);
        }
    };

    const TAB_CONFIG = [
        { id: 'overview' as const, label: 'Overview', Icon: LayoutDashboard },
        { id: 'tenants' as const, label: 'Workspaces', Icon: Building2 },
        { id: 'health' as const, label: 'System Health', Icon: Activity },
    ];

    return (
        <motion.div
            className="min-h-screen bg-white"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
        >
            <div className="mx-auto max-w-7xl px-4 sm:px-6 py-8 sm:py-10 pb-20 space-y-6">

                {/* ── Page header ──────────────────────────────────────── */}
                <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
                    <div className="flex items-center gap-3 min-w-0">
                        <div className="h-10 w-10 rounded-xl bg-ocean-navy flex items-center justify-center shrink-0">
                            <Shield className="h-5 w-5 text-white" aria-hidden />
                        </div>
                        <div className="min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                                <h1 className="text-xl font-bold text-slate-900 tracking-tight">Platform Dashboard</h1>
                                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-ocean-powder text-ocean-deep uppercase tracking-wide">
                                    Operator
                                </span>
                            </div>
                            <p className="text-xs text-slate-500 mt-0.5">
                                Live telemetry, workspace management, system health.
                            </p>
                        </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0 flex-wrap">
                        <button
                            type="button"
                            disabled={loading}
                            onClick={() => void reload()}
                            className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:opacity-55"
                        >
                            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} aria-hidden />
                            Refresh
                        </button>
                        {!backupExists && (
                            <button
                                type="button"
                                disabled={sandboxBusy}
                                onClick={() => void explorationStart()}
                                className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-ocean-rich to-ocean-navy px-3.5 py-2 text-xs font-semibold text-white shadow-sm transition hover:brightness-105 disabled:opacity-55"
                            >
                                {sandboxBusy
                                    ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                                    : <ShieldOff className="h-3.5 w-3.5" aria-hidden />
                                }
                                Sandbox
                            </button>
                        )}
                        <button
                            type="button"
                            onClick={() => {
                                localStorage.removeItem(PLATFORM_JWT_BACKUP_KEY);
                                localStorage.removeItem(PLATFORM_USER_BACKUP_KEY);
                                logout();
                            }}
                            className="inline-flex items-center gap-2 rounded-xl border border-red-200 bg-white px-3.5 py-2 text-xs font-semibold text-red-700 shadow-sm transition hover:bg-red-50"
                        >
                            <LogOut className="h-3.5 w-3.5" aria-hidden />
                            Sign Out
                        </button>
                    </div>
                </div>

                {/* ── Tab bar ───────────────────────────────────────────── */}
                <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-xl w-fit">
                    {TAB_CONFIG.map(({ id, label, Icon }) => (
                        <button
                            key={id}
                            type="button"
                            onClick={() => setTab(id)}
                            className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold transition-all ${
                                tab === id
                                    ? 'bg-white text-slate-900 shadow-sm'
                                    : 'text-slate-500 hover:text-slate-700'
                            }`}
                        >
                            <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden />
                            {label}
                        </button>
                    ))}
                    <button
                        type="button"
                        onClick={() => {
                            setCreateOpen(true);
                            setOncePw(null);
                            setForm({ registrationType: 'solo', organizationName: '', adminEmail: '', adminName: '' });
                        }}
                        className="ml-2 flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold bg-emerald-600 text-white hover:bg-emerald-700 transition-colors shadow-sm"
                    >
                        <Plus className="h-3.5 w-3.5" aria-hidden />
                        New Workspace
                    </button>
                </div>

                {/* ── Tab content ───────────────────────────────────────── */}
                <AnimatePresence mode="wait">
                    {loading ? (
                        <motion.div
                            key="loading"
                            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                            className="flex flex-col items-center gap-4 py-24 text-slate-400"
                        >
                            <Loader2 className="h-8 w-8 animate-spin" aria-hidden />
                            <p className="text-sm font-medium">Pulling platform data…</p>
                        </motion.div>
                    ) : tab === 'overview' && overview ? (
                        <motion.div
                            key="overview"
                            initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
                            transition={{ duration: 0.25 }}
                            className="space-y-5"
                        >
                            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                                {[
                                    { label: 'Workspaces', value: overview.totals.tenants, Icon: Building2 },
                                    { label: 'Seat holders', value: overview.totals.workspaceUsers, Icon: Users },
                                    { label: 'Agents deployed', value: overview.totals.agents, Icon: Bot },
                                    { label: 'Operator accounts', value: overview.totals.platformAdmins, Icon: Shield },
                                ].map(({ label, value, Icon: CardIcon }, i) => (
                                    <motion.article
                                        key={label}
                                        initial={{ opacity: 0, y: 12 }}
                                        animate={{ opacity: 1, y: 0 }}
                                        transition={{ delay: i * 0.06, duration: 0.3 }}
                                        className="rounded-2xl border border-slate-200 bg-white px-5 py-4 shadow-sm"
                                    >
                                        <div className="flex items-center justify-between mb-3">
                                            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{label}</p>
                                            <div className="h-7 w-7 rounded-lg bg-ocean-powder/60 flex items-center justify-center">
                                                <CardIcon className="h-3.5 w-3.5 text-ocean-rich" aria-hidden />
                                            </div>
                                        </div>
                                        <p className="text-3xl font-black text-slate-900">{value}</p>
                                    </motion.article>
                                ))}
                            </div>
                            <motion.article
                                initial={{ opacity: 0, y: 12 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ delay: 0.28, duration: 0.3 }}
                                className="rounded-2xl border border-emerald-200 bg-emerald-50 px-6 py-5"
                            >
                                <p className="text-[11px] font-semibold uppercase tracking-wide text-emerald-700/80">
                                    Approx. catalogue MRR (USD)
                                </p>
                                <p className="mt-1 text-4xl font-black text-emerald-950">
                                    ${overview.subscriptionBreakdown.approximateMRRUsdAcrossPlans}
                                    <span className="ml-2 align-middle text-sm font-semibold text-emerald-800">
                                        billed monthly equiv.
                                    </span>
                                </p>
                                <p className="mt-3 text-xs leading-relaxed text-emerald-950/80">{overview.assumptions}</p>
                            </motion.article>
                        </motion.div>
                    ) : tab === 'health' && health ? (
                        <motion.div
                            key="health"
                            initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
                            transition={{ duration: 0.25 }}
                            className="space-y-4"
                        >
                            <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white px-5 py-4 shadow-sm">
                                <div>
                                    <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Last probe</p>
                                    <p className="mt-1 text-sm font-semibold text-slate-900">
                                        <time dateTime={health.timestamp}>{new Date(health.timestamp).toLocaleString()}</time>
                                    </p>
                                </div>
                                <span className={`rounded-full px-3 py-1 text-xs font-bold uppercase tracking-wide ${
                                    health.status === 'ok' ? 'bg-emerald-100 text-emerald-900' : 'bg-amber-100 text-amber-950'
                                }`}>
                                    {health.status}
                                </span>
                            </div>
                            <div className="grid gap-4 sm:grid-cols-2">
                                {[
                                    { label: 'MongoDB', value: health.mongo === 'connected' ? 'Connected' : 'Disconnected', ok: health.mongo === 'connected', note: 'Tenants, subscriptions, usage.' },
                                    { label: 'Outbound email', value: health.emailOutbound === 'configured' ? 'Configured' : 'Not configured', ok: health.emailOutbound === 'configured', note: 'Invitations and product mail.' },
                                ].map(({ label, value, ok, note }) => (
                                    <article key={label} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                                        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{label}</p>
                                        <p className={`mt-2 text-xl font-black ${ok ? 'text-emerald-700' : 'text-amber-700'}`}>{value}</p>
                                        <p className="mt-1.5 text-xs text-slate-400">{note}</p>
                                    </article>
                                ))}
                                <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                                    <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Stripe</p>
                                    <div className="mt-3 flex flex-wrap gap-2">
                                        <span className="rounded-lg bg-slate-100 px-3 py-1 font-mono text-xs font-semibold text-slate-700">
                                            Keys: {health.stripe.configured ? 'present' : 'missing'}
                                        </span>
                                        <span className="rounded-lg bg-slate-100 px-3 py-1 font-mono text-xs font-semibold text-slate-700">
                                            Live API: {health.stripe.apiReachable ? 'reachable' : 'unreachable'}
                                        </span>
                                    </div>
                                </article>
                                <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                                    <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">AI Service</p>
                                    <p className="mt-1 break-all font-mono text-[10px] text-slate-400">{health.aiServiceOrigin}</p>
                                    <p className={`mt-2 text-xl font-black ${health.aiServiceHttp === 'reachable' ? 'text-emerald-700' : 'text-red-700'}`}>
                                        {health.aiServiceHttp === 'reachable' ? 'Reachable' : 'Unreachable'}
                                    </p>
                                </article>
                            </div>
                        </motion.div>
                    ) : tab === 'tenants' ? (
                        <motion.div
                            key="tenants"
                            initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
                            transition={{ duration: 0.25 }}
                        >
                            <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
                                <table className="min-w-full text-sm">
                                    <thead className="bg-slate-50 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-400 border-b border-slate-200">
                                        <tr>
                                            <th className="px-4 py-3">Workspace</th>
                                            <th className="px-4 py-3">Members</th>
                                            <th className="px-4 py-3">Stripe</th>
                                            <th className="px-4 py-3">Login freeze</th>
                                            <th className="px-4 py-3">Actions</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-100">
                                        {tenants.map((t) => (
                                            <tr key={t.id} className="hover:bg-slate-50/50 transition-colors">
                                                <td className="max-w-[220px] px-4 py-3">
                                                    <div className="font-semibold text-slate-900">{t.name}</div>
                                                    <div className="break-all font-mono text-[10px] text-slate-400 mt-0.5">{t.id}</div>
                                                    <div className="text-[11px] capitalize text-slate-500 mt-0.5">
                                                        {t.plan} · {(t.registrationType || '').replace(',', ' ') || '?'}
                                                    </div>
                                                </td>
                                                <td className="px-4 py-3 text-slate-700">{t.memberCount}</td>
                                                <td className="px-4 py-3 text-[11px]">
                                                    {t.subscription?.stripeSubscriptionId ? (
                                                        <span className="font-mono text-slate-700">
                                                            {t.subscription.plan}/{t.subscription.status}
                                                        </span>
                                                    ) : (
                                                        <span className="text-slate-400">
                                                            {t.subscription?.plan || t.plan || 'free'} · no Stripe
                                                        </span>
                                                    )}
                                                </td>
                                                <td className="min-w-[200px] max-w-[320px] px-4 py-3 text-[11px]">
                                                    <div className="font-medium text-slate-700">
                                                        {t.accessSuspendedUntil
                                                            ? `Until ${new Date(t.accessSuspendedUntil).toLocaleString()}`
                                                            : 'Active'}
                                                    </div>
                                                    <div className="mt-1.5 flex flex-wrap gap-1">
                                                        {FREEZE_PRESET_DAYS.map((d) => (
                                                            <button
                                                                key={d}
                                                                type="button"
                                                                className="rounded-md border border-slate-200 bg-white px-1.5 py-0.5 text-[10px] font-bold text-ocean-rich shadow-sm hover:bg-slate-50"
                                                                onClick={() => void patchSuspend(t.id, daysFromNowISO(d))}
                                                            >
                                                                {d}d
                                                            </button>
                                                        ))}
                                                    </div>
                                                    <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
                                                        <button type="button" className="font-semibold text-ocean-rich hover:underline" onClick={() => void freezeLoginCustomDays(t.id)}>
                                                            Custom…
                                                        </button>
                                                        <span className="text-slate-300">|</span>
                                                        <button type="button" className="font-semibold text-red-600 hover:underline" onClick={() => void patchSuspend(t.id, null)}>
                                                            Clear
                                                        </button>
                                                    </div>
                                                </td>
                                                <td className="px-4 py-3">
                                                    {t.subscription?.stripeSubscriptionId ? (
                                                        <button
                                                            type="button"
                                                            onClick={() => setCancelConfirmTenantId(t.id)}
                                                            className="inline-flex items-center gap-1 rounded-lg border border-red-100 bg-red-50 px-3 py-1.5 text-[11px] font-semibold text-red-700 hover:bg-red-100 transition-colors"
                                                        >
                                                            <Trash2 className="h-3 w-3" aria-hidden />
                                                            Cancel Stripe
                                                        </button>
                                                    ) : (
                                                        <span className="text-slate-300 text-[11px]">—</span>
                                                    )}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </motion.div>
                    ) : null}
                </AnimatePresence>
            </div>

            {/* ── Create workspace modal ────────────────────────────── */}
            <AnimatePresence>
                {createOpen && (
                    <motion.div
                        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                        className="fixed inset-0 z-[60] flex items-start justify-center bg-slate-900/50 backdrop-blur-sm p-4 pt-20"
                    >
                        <motion.div
                            initial={{ scale: 0.96, opacity: 0, y: 8 }}
                            animate={{ scale: 1, opacity: 1, y: 0 }}
                            exit={{ scale: 0.96, opacity: 0 }}
                            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
                            className="w-full max-w-lg rounded-2xl bg-white shadow-2xl border border-slate-200"
                        >
                            {!oncePw ? (
                                <div className="p-6">
                                    <div className="flex items-center justify-between mb-5">
                                        <h2 className="text-base font-bold text-slate-900">Create workspace</h2>
                                        <button type="button" onClick={() => setCreateOpen(false)} className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors">
                                            <svg className="h-4 w-4" viewBox="0 0 14 14" fill="none"><path d="M1 1l12 12M13 1L1 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
                                        </button>
                                    </div>
                                    <div className="space-y-3 text-sm">
                                        <label className="flex flex-col gap-1.5">
                                            <span className="text-xs font-semibold text-slate-700">Workspace type</span>
                                            <select
                                                value={form.registrationType}
                                                className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-medium bg-white focus:outline-none focus:ring-2 focus:ring-ocean-rich/20"
                                                onChange={(ev) => setForm((f) => ({ ...f, registrationType: ev.target.value as typeof f.registrationType }))}
                                            >
                                                <option value="solo">Individual / solo</option>
                                                <option value="company">Company / team</option>
                                            </select>
                                        </label>
                                        {form.registrationType === 'company' && (
                                            <label className="flex flex-col gap-1.5">
                                                <span className="text-xs font-semibold text-slate-700">Organization name</span>
                                                <input className="rounded-xl border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ocean-rich/20" value={form.organizationName} onChange={(ev) => setForm((f) => ({ ...f, organizationName: ev.target.value }))} />
                                            </label>
                                        )}
                                        <label className="flex flex-col gap-1.5">
                                            <span className="text-xs font-semibold text-slate-700">Admin email</span>
                                            <input className="rounded-xl border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ocean-rich/20" type="email" autoComplete="off" value={form.adminEmail} onChange={(ev) => setForm((f) => ({ ...f, adminEmail: ev.target.value }))} />
                                        </label>
                                        <label className="flex flex-col gap-1.5">
                                            <span className="text-xs font-semibold text-slate-700">Display name (optional)</span>
                                            <input className="rounded-xl border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ocean-rich/20" value={form.adminName} onChange={(ev) => setForm((f) => ({ ...f, adminName: ev.target.value }))} />
                                        </label>
                                        <div className="rounded-xl bg-slate-50 border border-slate-200 px-3 py-2.5 text-xs leading-relaxed text-slate-600">
                                            A one-time password is generated and shown <strong className="text-slate-900">once</strong> on the next screen. It is not emailed — copy it securely before closing.
                                        </div>
                                        <button type="button" onClick={() => void provisionWorkspace()} className="mt-2 w-full rounded-xl bg-ocean-navy py-2.5 text-sm font-bold text-white hover:bg-ocean-deep transition-colors">
                                            Create workspace
                                        </button>
                                    </div>
                                </div>
                            ) : (
                                <div className="p-6 space-y-4">
                                    <div className="flex items-center gap-3">
                                        <div className="h-9 w-9 rounded-xl bg-emerald-100 flex items-center justify-center shrink-0">
                                            <Shield className="h-4.5 w-4.5 text-emerald-700" aria-hidden />
                                        </div>
                                        <div>
                                            <h3 className="text-sm font-bold text-slate-900">One-time admin password</h3>
                                            <p className="text-xs text-slate-500">Copy and transmit securely. This is shown once.</p>
                                        </div>
                                    </div>
                                    <code className="block break-all rounded-xl bg-slate-100 border border-slate-200 px-3 py-2.5 font-mono text-xs text-slate-800">
                                        {oncePw}
                                    </code>
                                    <button
                                        type="button"
                                        onClick={() => oncePw && void copyWithToast(oncePw, toast, 'Password copied')}
                                        className="w-full inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition-colors"
                                    >
                                        <Copy className="h-4 w-4" aria-hidden />
                                        Copy password
                                    </button>
                                    <button type="button" onClick={() => { setCreateOpen(false); setOncePw(null); }} className="w-full rounded-xl border border-slate-200 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition-colors">
                                        Done — stored safely
                                    </button>
                                </div>
                            )}
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>

            <ConfirmDialog
                open={!!cancelConfirmTenantId}
                onOpenChange={(open) => { if (!open && !cancelLoading) setCancelConfirmTenantId(null); }}
                title="Cancel Stripe billing?"
                description="Cancel Stripe billing immediately for this workspace? This action takes effect right away."
                confirmLabel="Cancel billing"
                destructive
                loading={cancelLoading}
                onConfirm={async () => {
                    if (cancelConfirmTenantId) await cancelStripe(cancelConfirmTenantId);
                }}
            />
        </motion.div>
    );
}
