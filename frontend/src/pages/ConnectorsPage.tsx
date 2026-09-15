import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../components/Toast';
import { ConnectorsPageSkeleton } from '../components/skeletons';
import AnimatedPage from '../components/AnimatedPage';
import ConfirmDialog from '../components/ConfirmDialog';
import { handleNetworkError } from '@/lib/apiError';
import { PageBackNav } from '../components/PageBackNav';
import {
    Link2, CheckCircle, XCircle, PauseCircle,
    Mail, Globe, TrendingUp, Activity, Loader2, RefreshCw,
    ChevronRight, AlertTriangle, MessageSquare
} from 'lucide-react';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3000';

interface Connector {
    _id: string;
    name: string;
    status: 'active' | 'paused' | 'failed';
    trigger: { source: string; event: string };
    destination: { type: 'slack' | 'email' | 'webhook' };
    deliveryMode: string;
    stats: { sent: number; failed: number; lastFiredAt?: string };
    failureAlert: boolean;
    agentId: { _id: string; name: string } | string;
    createdAt: string;
}

interface Stats {
    total: number;
    active: number;
    failed: number;
    paused: number;
    totalSent: number;
    totalFailed: number;
}

const CHANNEL_ICON: Record<string, React.ReactNode> = {
    slack:    <MessageSquare className="h-4 w-4 text-ocean-deep" />,
    email:    <Mail className="h-4 w-4 text-ocean-rich" />,
    webhook:  <Globe className="h-4 w-4 text-violet-600" />,
    whatsapp: <Globe className="h-4 w-4 text-emerald-600" />,
};

const STATUS_CONFIG = {
    active:  { label: 'Active',  color: 'text-green-700',  bg: 'bg-green-50 border-green-200',  icon: CheckCircle },
    paused:  { label: 'Paused',  color: 'text-amber-700',  bg: 'bg-amber-50 border-amber-200',  icon: PauseCircle },
    failed:  { label: 'Failed',  color: 'text-red-700',    bg: 'bg-red-50 border-red-200',      icon: XCircle },
};

export default function ConnectorsPage() {
    const { token, subscription } = useAuth();
    const navigate = useNavigate();
    const toast = useToast();

    const [connectors, setConnectors] = useState<Connector[]>([]);
    const [stats, setStats] = useState<Stats | null>(null);
    const [loading, setLoading] = useState(true);
    const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
    const [deletingId, setDeletingId] = useState<string | null>(null);

    const headers = { Authorization: `Bearer ${token}` };

    const fetchAll = useCallback(async () => {
        if (connectors.length === 0) setLoading(true);
        try {
            const [cRes, sRes] = await Promise.all([
                fetch(`${API_BASE}/api/connectors`, { headers }),
                fetch(`${API_BASE}/api/connectors/stats`, { headers }),
            ]);
            if (cRes.ok) setConnectors(await cRes.json());
            if (sRes.ok) setStats(await sRes.json());
        } catch {
            handleNetworkError(toast, { title: 'Load failed', message: 'Could not load alerts and notifications' });
        } finally {
            setLoading(false);
        }
    }, [token, connectors.length]);

    useEffect(() => { fetchAll(); }, [fetchAll]);

    const toggleStatus = async (id: string, current: string) => {
        const next = current === 'active' ? 'paused' : 'active';
        const previous = connectors;
        setConnectors(prev => prev.map(c => (c._id === id ? { ...c, status: next } : c)));
        try {
            const res = await fetch(`${API_BASE}/api/connectors/${id}/status`, {
                method: 'PATCH',
                headers: { ...headers, 'Content-Type': 'application/json' },
                body: JSON.stringify({ status: next }),
            });
            if (res.ok) {
                toast.success(next === 'active' ? 'Integration activated' : 'Integration paused');
            } else {
                setConnectors(previous);
                toast.error('Update failed');
            }
        } catch {
            setConnectors(previous);
            toast.error('Update failed');
        }
    };

    const confirmDeleteConnector = async () => {
        if (!deleteConfirmId) return;
        const id = deleteConfirmId;
        setDeletingId(id);
        try {
            const res = await fetch(`${API_BASE}/api/connectors/${id}`, { method: 'DELETE', headers });
            if (res.ok) {
                setConnectors(prev => prev.filter(c => c._id !== id));
                toast.success('Alerts and notifications connector removed');
                setDeleteConfirmId(null);
            } else {
                toast.error('Delete failed');
            }
        } catch {
            toast.error('Delete failed');
        } finally {
            setDeletingId(null);
        }
    };

    const planName = subscription?.plan || 'free';
    const isLocked = planName === 'free';

    if (isLocked) {
        return (
            <div className="flex min-h-[50vh] items-center justify-center bg-white px-4 py-24">
                <div className="bg-white rounded-2xl border border-ocean-ice shadow-ocean-card p-12 max-w-lg text-center">
                    <div className="w-16 h-16 bg-ocean-mist rounded-full flex items-center justify-center mx-auto mb-4 ring-2 ring-ocean-ice">
                        <Link2 className="h-8 w-8 text-ocean-deep" />
                    </div>
                    <h2 className="text-2xl font-bold text-ocean-navy mb-2">Alerts and notifications require a paid plan</h2>
                    <p className="text-ocean-deep/80 mb-6">Connect Slack, email, and webhooks to your agent's orders and leads. Available from the Starter plan.</p>
                    <button
                        type="button"
                        onClick={() => navigate('/subscription')}
                        className="rounded-full bg-ocean-deep px-6 py-2.5 font-medium text-white shadow-ocean-sm transition hover:bg-ocean-rich"
                    >
                        Upgrade Plan
                    </button>
                </div>
            </div>
        );
    }

    if (loading && connectors.length === 0 && !stats) {
        return <ConnectorsPageSkeleton />;
    }

    return (
        <AnimatedPage className="bg-white pb-12">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-6 pb-10 sm:pt-8">
                <PageBackNav to="/dashboard" label="Back to Dashboard" />
                <div className="mb-8 rounded-3xl border border-white/20 bg-gradient-to-br from-ocean-navy via-ocean-deep to-ocean-rich px-6 py-8 text-white shadow-ocean sm:px-10">
                    <div className="flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
                        <div>
                            <h1 className="flex items-center gap-3 text-3xl font-bold tracking-tight">
                                <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-white/15 ring-1 ring-white/25">
                                    <Link2 className="h-6 w-6 text-ocean-aqua" aria-hidden />
                                </span>
                                Alerts and notifications
                            </h1>
                            <p className="mt-2 max-w-xl text-sm text-white/80">Route agent events to Slack, email, and webhooks.</p>
                        </div>
                        <button type="button" onClick={fetchAll} className="inline-flex items-center justify-center rounded-xl border border-white/25 bg-white/10 px-4 py-2.5 text-sm font-medium text-white backdrop-blur-sm transition hover:bg-white/20">
                            <RefreshCw className="mr-1.5 h-4 w-4" aria-hidden /> Refresh
                        </button>
                    </div>
                </div>

                {/* Stats */}
                {stats && (
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
                        {[
                            { label: 'Total connectors', value: stats.total, icon: <Link2 className="h-5 w-5" />, gradient: 'from-ocean-deep to-ocean-rich' },
                            { label: 'Active', value: stats.active, icon: <Activity className="h-5 w-5" />, gradient: 'from-emerald-600 to-teal-500' },
                            { label: 'Failed', value: stats.failed, icon: <AlertTriangle className="h-5 w-5" />, gradient: 'from-red-500 to-rose-600' },
                            { label: 'Total Sent', value: stats.totalSent, icon: <TrendingUp className="h-5 w-5" />, gradient: 'from-blue-600 to-ocean-sky' },
                        ].map(card => (
                            <div key={card.label} className="rounded-2xl border border-ocean-ice/90 bg-white p-5 shadow-ocean-sm">
                                <div className={`mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br ${card.gradient} text-white shadow-sm`}>
                                    {card.icon}
                                </div>
                                <p className="text-sm text-ocean-deep">{card.label}</p>
                                <p className="mt-1 text-2xl font-bold text-ocean-navy">{card.value}</p>
                            </div>
                        ))}
                    </div>
                )}

                {/* Connector list */}
                {connectors.length === 0 ? (
                    <div className="rounded-2xl border border-ocean-ice bg-white py-20 text-center shadow-ocean-card">
                        <Link2 className="mx-auto mb-4 h-16 w-16 text-ocean-mist" />
                        <h3 className="mb-2 text-xl font-semibold text-ocean-navy">No alerts and notifications yet</h3>
                        <p className="mb-6 text-ocean-deep">Open an agent and use Alerts and notifications under that agent to add Slack, email, or webhooks.</p>
                        <button type="button" onClick={() => navigate('/dashboard')} className="rounded-full bg-ocean-deep px-5 py-2 font-medium text-white shadow-ocean-sm hover:bg-ocean-rich">
                            Go to Dashboard
                        </button>
                    </div>
                ) : (
                    <div className="space-y-3">
                        {connectors.map(c => {
                            const sc = STATUS_CONFIG[c.status];
                            const StatusIcon = sc.icon;
                            const agentName = typeof c.agentId === 'object' ? (c.agentId as any).name : 'Unknown Agent';
                            const agentId = typeof c.agentId === 'object' ? (c.agentId as any)._id : c.agentId;

                            return (
                                <div key={c._id} className="flex items-center gap-4 rounded-xl border border-ocean-ice bg-white p-5 shadow-ocean-sm transition hover:shadow-ocean-card">
                                    <div className={`p-2 rounded-lg border ${sc.bg}`}>
                                        <StatusIcon className={`h-5 w-5 ${sc.color}`} />
                                    </div>

                                    <div className="flex items-center gap-2 text-ocean-deep/70">
                                        {CHANNEL_ICON[c.destination.type]}
                                    </div>

                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-2">
                                            <span className="font-semibold text-ocean-navy truncate">{c.name}</span>
                                            {c.failureAlert && (
                                                <span className="text-xs bg-red-100 text-red-700 px-2 py-0.5 rounded-full">Needs attention</span>
                                            )}
                                        </div>
                                        <div className="text-sm text-ocean-deep/75 mt-0.5">
                                            {agentName} · {c.trigger.source} {c.trigger.event} · {c.deliveryMode.replace('_', ' ')}
                                        </div>
                                    </div>

                                    <div className="hidden text-right text-sm text-ocean-deep/70 md:block">
                                        <div>{c.stats.sent} sent · {c.stats.failed} failed</div>
                                        <div>{c.stats.lastFiredAt ? `Last: ${new Date(c.stats.lastFiredAt).toLocaleDateString()}` : 'Never fired'}</div>
                                    </div>

                                    <div className="flex items-center gap-2 shrink-0">
                                        <button
                                            type="button"
                                            onClick={() => navigate(`/agents/${agentId}/connectors`)}
                                            className="rounded-lg p-2 text-ocean-deep/45 transition hover:bg-ocean-powder hover:text-ocean-deep"
                                            title="View agent alerts and notifications"
                                        >
                                            <ChevronRight className="h-4 w-4" />
                                        </button>
                                        <button
                                            onClick={() => toggleStatus(c._id, c.status)}
                                            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                                                c.status === 'active'
                                                    ? 'bg-amber-50 text-amber-700 hover:bg-amber-100'
                                                    : 'bg-green-50 text-green-700 hover:bg-green-100'
                                            }`}
                                        >
                                            {c.status === 'active' ? 'Pause' : 'Activate'}
                                        </button>
                                        <button
                                            onClick={() => setDeleteConfirmId(c._id)}
                                            className="px-3 py-1.5 rounded-lg text-xs font-medium bg-red-50 text-red-600 hover:bg-red-100"
                                        >
                                            Delete
                                        </button>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>

            <ConfirmDialog
                open={!!deleteConfirmId}
                onOpenChange={(open) => { if (!open && !deletingId) setDeleteConfirmId(null); }}
                title="Remove connector?"
                description="Remove this alerts and notifications connector? This cannot be undone."
                confirmLabel="Remove"
                destructive
                loading={!!deletingId}
                onConfirm={confirmDeleteConnector}
            />
        </AnimatedPage>
    );
}
