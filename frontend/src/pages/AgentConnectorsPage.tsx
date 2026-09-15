import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../components/Toast';
import ConfirmDialog from '../components/ConfirmDialog';
import { AgentConnectorsPageSkeleton } from '../components/skeletons';
import AnimatedPage from '../components/AnimatedPage';
import { handleNetworkError } from '@/lib/apiError';
import { PageBackNav } from '../components/PageBackNav';
import {
    Link2, Plus, CheckCircle, XCircle, PauseCircle,
    Mail, Globe, Loader2, RefreshCw, AlertTriangle,
    List, FlaskConical, MessageSquare
} from 'lucide-react';
import ConnectorWizard from '../components/connectors/ConnectorWizard';
import ConnectorLogs from '../components/connectors/ConnectorLogs';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3000';

interface Connector {
    _id: string;
    name: string;
    status: 'active' | 'paused' | 'failed';
    trigger: { source: string; event: string; conditions: any[] };
    destination: { type: 'slack' | 'email' | 'webhook'; slack?: any; email?: any; webhook?: any };
    deliveryMode: string;
    templateId?: string;
    customTemplate?: any;
    stats: { sent: number; failed: number; lastFiredAt?: string };
    failureAlert: boolean;
    createdAt: string;
}

const CHANNEL_ICON: Record<string, React.ReactNode> = {
    slack:    <MessageSquare className="h-5 w-5 text-ocean-rich" />,
    email:    <Mail className="h-5 w-5 text-blue-500" />,
    webhook:  <Globe className="h-5 w-5 text-purple-500" />,
    whatsapp: <Globe className="h-5 w-5 text-green-500" />,
};

const STATUS_CONFIG = {
    active:  { label: 'Active',  color: 'text-green-700',  bg: 'bg-green-50 border-green-200',  icon: CheckCircle },
    paused:  { label: 'Paused',  color: 'text-amber-700',  bg: 'bg-amber-50 border-amber-200',  icon: PauseCircle },
    failed:  { label: 'Failed',  color: 'text-red-700',    bg: 'bg-red-50 border-red-200',      icon: XCircle },
};

export default function AgentConnectorsPage() {
    const { token, subscription } = useAuth();
    const { agentId } = useParams<{ agentId: string }>();
    const navigate = useNavigate();
    const toast = useToast();

    const [connectors, setConnectors] = useState<Connector[]>([]);
    const [loading, setLoading] = useState(true);
    const [showWizard, setShowWizard] = useState(false);
    const [logsConnectorId, setLogsConnectorId] = useState<string | null>(null);
    const [testingId, setTestingId] = useState<string | null>(null);
    const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
    const [deletingId, setDeletingId] = useState<string | null>(null);

    const headers = { Authorization: `Bearer ${token}` };

    const fetchConnectors = useCallback(async () => {
        if (connectors.length === 0) setLoading(true);
        try {
            const res = await fetch(`${API_BASE}/api/connectors?agentId=${agentId}`, { headers });
            if (res.ok) setConnectors(await res.json());
        } catch {
            handleNetworkError(toast, { title: 'Load failed', message: 'Could not load alerts and notifications' });
        } finally {
            setLoading(false);
        }
    }, [agentId, token, toast, connectors.length]);

    useEffect(() => { fetchConnectors(); }, [fetchConnectors]);

    const toggleStatus = async (id: string, current: string) => {
        const next = current === 'active' ? 'paused' : 'active';
        const previous = connectors;
        setConnectors(prev => prev.map(c => (c._id === id ? { ...c, status: next as Connector['status'] } : c)));
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

    const sendTest = async (id: string) => {
        setTestingId(id);
        try {
            const res = await fetch(`${API_BASE}/api/connectors/${id}/test`, { method: 'POST', headers });
            const data = await res.json();
            if (res.ok) toast.success('Test sent', 'Check your Slack / email / webhook endpoint');
            else toast.error('Test failed', data.message);
        } catch { toast.error('Test failed', 'Could not reach server'); }
        finally { setTestingId(null); }
    };

    const planName = subscription?.plan || 'free';
    const isLocked = planName === 'free';

    if (loading && connectors.length === 0) {
        return <AgentConnectorsPageSkeleton />;
    }

    return (
        <AnimatedPage className="bg-white pb-12">
            <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 pt-6 pb-10 sm:pt-8">
                <PageBackNav to="/dashboard" label="Back to Dashboard" />

                <div className="mb-8 flex flex-col gap-6 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                        <h1 className="flex items-center gap-2 text-3xl font-bold text-ocean-navy">
                            <Link2 className="h-8 w-8 shrink-0 text-ocean-deep" aria-hidden /> Alerts and Notifications
                        </h1>
                        <p className="mt-2 text-sm text-ocean-deep/70">Slack, email, webhook targets.</p>
                    </div>
                    <div className="flex shrink-0 flex-wrap gap-2 sm:justify-end">
                        <button
                            type="button"
                            onClick={fetchConnectors}
                            className="inline-flex min-h-[2.5rem] items-center gap-2 rounded-lg border border-ocean-ice bg-white px-3 py-2 text-sm font-medium text-ocean-deep shadow-sm transition hover:bg-ocean-powder"
                        >
                            <RefreshCw className="h-4 w-4" aria-hidden /> Refresh
                        </button>
                        {!isLocked && (
                            <button
                                type="button"
                                onClick={() => setShowWizard(true)}
                                className="inline-flex min-h-[2.5rem] items-center gap-2 rounded-lg bg-ocean-deep px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-ocean-rich"
                            >
                                <Plus className="h-4 w-4" aria-hidden /> New alerts & notifications
                            </button>
                        )}
                    </div>
                </div>

                {/* Locked state */}
                {isLocked && (
                    <div className="bg-amber-50 border border-amber-200 rounded-xl p-6 mb-6 flex items-start gap-4">
                        <AlertTriangle className="h-6 w-6 text-amber-600 shrink-0 mt-0.5" />
                        <div>
                            <p className="font-semibold text-amber-900">Alerts and Notifications: paid plans only</p>
                            <p className="text-amber-700 text-sm mt-1">Upgrade to Starter or higher to connect Slack, email, and webhooks.</p>
                            <button onClick={() => navigate('/subscription')} className="mt-3 bg-amber-600 text-white px-4 py-1.5 rounded-lg text-sm font-medium hover:bg-amber-700">
                                Upgrade Now
                            </button>
                        </div>
                    </div>
                )}

                {/* Connector list */}
                {connectors.length === 0 && !isLocked ? (
                    <div className="text-center py-20 bg-white rounded-2xl border border-ocean-ice/80">
                        <Link2 className="h-16 w-16 text-gray-300 mx-auto mb-4" />
                        <h3 className="text-xl font-semibold text-ocean-navy mb-2">No integrations yet</h3>
                        <p className="text-ocean-deep/70 mb-6 text-sm">Outbound destinations for events.</p>
                        <button
                            onClick={() => setShowWizard(true)}
                            className="bg-ocean-deep text-white px-5 py-2.5 rounded-full font-medium hover:bg-ocean-rich"
                        >
                            <Plus className="h-4 w-4 inline mr-1.5 -mt-0.5" /> Add alerts & notifications
                        </button>
                    </div>
                ) : (
                    <div className="space-y-4">
                        {connectors.map(c => {
                            const sc = STATUS_CONFIG[c.status];
                            const StatusIcon = sc.icon;

                            return (
                                <div key={c._id} className="bg-white rounded-xl border border-ocean-ice shadow-sm overflow-hidden">
                                    <div className="p-5">
                                        <div className="flex items-start gap-4">
                                            <div className={`p-2 rounded-lg border ${sc.bg} shrink-0`}>
                                                <StatusIcon className={`h-5 w-5 ${sc.color}`} />
                                            </div>

                                            <div className="flex items-start gap-3 shrink-0">
                                                {CHANNEL_ICON[c.destination.type]}
                                            </div>

                                            <div className="flex-1 min-w-0">
                                                <div className="flex items-center gap-2 flex-wrap">
                                                    <span className="font-semibold text-ocean-navy">{c.name}</span>
                                                    <span className={`text-xs px-2 py-0.5 rounded-full border ${sc.bg} ${sc.color}`}>{sc.label}</span>
                                                    {c.failureAlert && (
                                                        <span className="text-xs bg-red-100 text-red-700 px-2 py-0.5 rounded-full flex items-center gap-1">
                                                            <AlertTriangle className="h-3 w-3" /> Failed - needs attention
                                                        </span>
                                                    )}
                                                </div>
                                                <div className="text-sm text-ocean-deep/80 mt-1 space-y-0.5">
                                                    <div>
                                                        <span className="capitalize">{c.trigger.source}</span> {c.trigger.event} →{' '}
                                                        <span className="capitalize">{c.destination.type}</span>
                                                        {c.destination.slack?.channelLabel && ` (${c.destination.slack.channelLabel})`}
                                                        {c.destination.email?.recipients && ` (${c.destination.email.recipients.join(', ')})`}
                                                    </div>
                                                    <div>
                                                        Delivery: <span className="capitalize">{c.deliveryMode.replace('_', ' ')}</span>
                                                        {c.trigger.conditions?.length > 0 && ` · ${c.trigger.conditions.length} condition(s)`}
                                                    </div>
                                                    <div className="text-xs text-ocean-deep/60">
                                                        {c.stats.sent} sent · {c.stats.failed} failed
                                                        {c.stats.lastFiredAt && ` · Last: ${new Date(c.stats.lastFiredAt).toLocaleString()}`}
                                                    </div>
                                                </div>
                                            </div>

                                            <div className="flex items-center gap-2 shrink-0 flex-wrap justify-end">
                                                <button
                                                    onClick={() => sendTest(c._id)}
                                                    disabled={testingId === c._id}
                                                    className="flex items-center px-3 py-1.5 bg-ocean-powder border border-ocean-ice text-ocean-deep text-xs rounded-lg hover:bg-ocean-mist/50 disabled:opacity-50"
                                                    title="Send a test message"
                                                >
                                                    {testingId === c._id ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <FlaskConical className="h-3 w-3 mr-1" />}
                                                    Test
                                                </button>
                                                <button
                                                    onClick={() => setLogsConnectorId(c._id)}
                                                    className="flex items-center px-3 py-1.5 bg-ocean-powder border border-ocean-ice text-ocean-deep text-xs rounded-lg hover:bg-ocean-mist/50"
                                                    title="View delivery logs"
                                                >
                                                    <List className="h-3 w-3 mr-1" /> Logs
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
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>

            {/* Wizard overlay */}
            {showWizard && (
                <ConnectorWizard
                    agentId={agentId!}
                    onClose={() => setShowWizard(false)}
                    onCreated={() => { setShowWizard(false); fetchConnectors(); }}
                />
            )}

            {/* Logs panel */}
            {logsConnectorId && (
                <ConnectorLogs
                    connectorId={logsConnectorId}
                    onClose={() => setLogsConnectorId(null)}
                />
            )}

            <ConfirmDialog
                open={!!deleteConfirmId}
                onOpenChange={(open) => { if (!open && !deletingId) setDeleteConfirmId(null); }}
                title="Remove connector?"
                description="Remove this alerts and notifications connector? This action cannot be undone."
                confirmLabel="Remove"
                destructive
                loading={!!deletingId}
                onConfirm={confirmDeleteConnector}
            />
        </AnimatedPage>
    );
}
