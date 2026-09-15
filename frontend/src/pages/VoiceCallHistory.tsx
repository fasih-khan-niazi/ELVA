import { useEffect, useState, useCallback, type MouseEvent } from 'react';
import { useParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { PageBackNav } from '../components/PageBackNav';
import {
    PhoneOff,
    Phone,
    Clock,
    MessageSquare,
    AlertTriangle,
    CheckCircle2,
    XCircle,
    ArrowRightLeft,
    Timer,
    Wifi,
    Globe,
    RefreshCw,
    ChevronDown,
    ChevronUp,
    FileText,
    Trash2,
    RotateCcw,
} from 'lucide-react';
import {
    downloadTranscriptPdf,
    type TranscriptExportAppendix,
} from '../utils/transcriptExport';
import { useToast } from '../components/Toast';
import ConfirmDialog from '../components/ConfirmDialog';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3000';

// ─── Types ────────────────────────────────────────────────────────────────

interface SessionStats {
    totalCalls: number;
    completedCount: number;
    failedCount: number;
    otherCount?: number;
    statusBreakdown?: Record<string, number>;
    totalDurationSec: number;
    avgDurationSec: number;
    totalTurns: number;
}

interface VoiceSession {
    _id: string;
    callSid: string;
    agentId: string;
    channel: 'phone' | 'web';
    from: string;
    to: string;
    status: string;
    turnCount: number;
    totalLatencyMs: number;
    endReason?: string;
    startedAt: string;
    endedAt?: string;
    durationSec?: number;
    trashedAt?: string;
}

interface VoiceTurn {
    _id: string;
    turnIndex: number;
    inputTranscript: string;
    inputConfidence?: number;
    aiResponse: string;
    intent?: string;
    latencyMs: number;
    sloOk: boolean;
    error?: string;
    createdAt: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────

function formatDuration(sec?: number): string {
    if (!sec) return '-';
    const m = Math.floor(sec / 60);
    const s = Math.round(sec % 60);
    return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

/**
 * Returns duration in seconds, falling back to startedAt/endedAt diff
 * when durationSec is not stored (common for outbound calls).
 */
function getSessionDuration(session: VoiceSession): number | undefined {
    if (session.durationSec != null && session.durationSec > 0) return session.durationSec;
    if (session.startedAt && session.endedAt) {
        const diff = Math.round(
            (new Date(session.endedAt).getTime() - new Date(session.startedAt).getTime()) / 1000
        );
        return diff > 0 ? diff : undefined;
    }
    return undefined;
}

/**
 * For outbound sessions the backend stores the dialled customer number
 * in `from` (the agent's caller-ID flows through `to`). So for outbound
 * we read `from` but label it "to".
 */
function sessionPhoneDisplay(session: VoiceSession, isOutbound: boolean) {
    if (isOutbound) {
        const num = session.from && session.from !== 'browser' ? session.from : null;
        return num ? { label: 'to', number: num } : null;
    }
    const num = session.from && session.from !== 'browser' ? session.from : null;
    return num ? { label: 'from', number: num } : null;
}

function formatDate(iso: string): string {
    const d = new Date(iso);
    return d.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
    });
}

function statusBadge(status: string) {
    const map: Record<string, { color: string; icon: React.ReactNode }> = {
        completed: { color: 'bg-green-100 text-green-700', icon: <CheckCircle2 className="h-3.5 w-3.5" /> },
        'in-progress': { color: 'bg-blue-100 text-blue-700', icon: <Phone className="h-3.5 w-3.5 animate-pulse" /> },
        failed: { color: 'bg-red-100 text-red-700', icon: <XCircle className="h-3.5 w-3.5" /> },
        initiated: { color: 'bg-yellow-100 text-yellow-700', icon: <Clock className="h-3.5 w-3.5" /> },
        canceled: { color: 'bg-ocean-mist/50 text-ocean-deep/90', icon: <PhoneOff className="h-3.5 w-3.5" /> },
    };
    const def = { color: 'bg-ocean-mist/50 text-ocean-deep/90', icon: <Clock className="h-3.5 w-3.5" /> };
    const { color, icon } = map[status] || def;
    return (
        <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium ${color}`}>
            {icon}
            {status}
        </span>
    );
}

function endReasonLabel(reason?: string): string {
    if (!reason) return '-';
    const labels: Record<string, string> = {
        goodbye: 'Goodbye',
        max_turns: 'Max turns',
        silence_timeout: 'Silence timeout',
        error_limit: 'Error limit',
        transfer: 'Transferred',
        caller_hangup: 'Caller hung up',
        unknown: 'Unknown',
    };
    return labels[reason] || reason;
}

function channelIcon(ch: 'phone' | 'web') {
    return ch === 'web'
        ? <Globe className="h-4 w-4 text-ocean-bright" />
        : <Phone className="h-4 w-4 text-ocean-deep" />;
}

// ─── Turn Detail Row ──────────────────────────────────────────────────────

function TurnRow({ turn }: { turn: VoiceTurn }) {
    return (
        <div className="py-4 border-b border-ocean-ice last:border-0">
            <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-ocean-deep/55 w-8">#{turn.turnIndex + 1}</span>
                    {turn.intent && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-ocean-powder text-ocean-deep font-medium">
                            {turn.intent}
                        </span>
                    )}
                    {turn.error && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-50 text-red-600 font-medium flex items-center gap-0.5">
                            <AlertTriangle className="h-3 w-3" /> Error
                        </span>
                    )}
                </div>
                <div className="flex items-center gap-3 text-xs text-ocean-deep/55">
                    <span className={`font-mono ${turn.latencyMs > 3000 ? 'text-red-500' : turn.latencyMs > 1500 ? 'text-amber-500' : 'text-green-600'}`}>
                        {(turn.latencyMs / 1000).toFixed(1)}s
                    </span>
                    {turn.inputConfidence != null && (
                        <span className={`font-mono ${turn.inputConfidence < 0.55 ? 'text-red-500' : turn.inputConfidence < 0.7 ? 'text-amber-500' : 'text-green-600'}`}>
                            {(turn.inputConfidence * 100).toFixed(0)}% conf
                        </span>
                    )}
                    {!turn.sloOk && (
                        <span className="text-red-400 font-medium">SLO miss</span>
                    )}
                </div>
            </div>

            {/* Caller message */}
            <div className="flex gap-3 mb-2">
                <div className="flex-shrink-0 w-8 h-8 rounded-full bg-ocean-powder flex items-center justify-center">
                    <Phone className="h-4 w-4 text-ocean-deep/75" />
                </div>
                <div className="flex-1 bg-ocean-mist/90 rounded-xl px-4 py-3 text-sm text-ocean-navy">
                    {turn.inputTranscript}
                </div>
            </div>

            {/* AI response */}
            <div className="flex gap-3">
                <div className="flex-shrink-0 w-8 h-8 rounded-full bg-ocean-bright/30 flex items-center justify-center ring-2 ring-ocean-mist">
                    <MessageSquare className="h-4 w-4 text-ocean-deep" />
                </div>
                <div className="flex-1 bg-ocean-ice/90 rounded-xl px-4 py-3 text-sm text-ocean-navy">
                    {turn.aiResponse}
                </div>
            </div>

            {turn.error && (
                <div className="ml-11 mt-2 text-xs bg-red-50 text-red-600 rounded-lg px-3 py-2">
                    {turn.error}
                </div>
            )}
        </div>
    );
}

// ─── Session Row (expandable) ─────────────────────────────────────────────

function SessionRow({
    session,
    token,
    isOutbound,
    agentLabel,
    isTrashView,
    onMoved,
}: {
    session: VoiceSession;
    token: string;
    isOutbound: boolean;
    agentLabel: string;
    isTrashView: boolean;
    onMoved: (stats?: SessionStats) => void;
}) {
    const [expanded, setExpanded] = useState(false);
    const [turns, setTurns] = useState<VoiceTurn[]>([]);
    const [exportAppendix, setExportAppendix] = useState<TranscriptExportAppendix | null>(null);
    const [loadingTurns, setLoadingTurns] = useState(false);
    const [exporting, setExporting] = useState(false);
    const [actionLoading, setActionLoading] = useState(false);
    const [pendingAction, setPendingAction] = useState<'trash' | 'delete' | null>(null);
    const toast = useToast();

    const fetchTurns = async () => {
        if (turns.length > 0) {
            setExpanded(!expanded);
            return;
        }
        setLoadingTurns(true);
        setExpanded(true);
        try {
            const res = await fetch(
                `${API_BASE}/api/voice-admin/sessions/${session.callSid}/turns`,
                { headers: { Authorization: `Bearer ${token}` } },
            );
            if (res.ok) {
                const data = await res.json();
                setTurns(data.turns || []);
                setExportAppendix(data.exportContext || null);
            } else {
                toast.error('Could not load transcript');
            }
        } catch (err) {
            console.error('Failed to load turns', err);
            toast.error('Could not load transcript');
        } finally {
            setLoadingTurns(false);
        }
    };

    const avgLatency = session.turnCount > 0
        ? Math.round(session.totalLatencyMs / session.turnCount)
        : 0;

    const exportMeta = {
        callSid: session.callSid,
        agentLabel,
        startedAt: session.startedAt,
        durationSec: getSessionDuration(session),
        channel: session.channel,
        endReason: session.endReason,
    };

    const transcriptTurns = turns.map((t) => ({
        turnIndex: t.turnIndex,
        inputTranscript: t.inputTranscript,
        aiResponse: t.aiResponse,
        intent: t.intent,
        latencyMs: t.latencyMs,
        inputConfidence: t.inputConfidence,
        sloOk: t.sloOk,
        error: t.error,
    }));

    const handleExportPdf = async () => {
        if (turns.length === 0) return;
        setExporting(true);
        try {
            await downloadTranscriptPdf(exportMeta, transcriptTurns, exportAppendix || undefined);
        } catch (err: any) {
            console.error('Transcript export failed', err);
            toast.error('Export failed', err?.message || 'Could not generate PDF.');
        } finally {
            setExporting(false);
        }
    };

    const requestMoveToTrash = (e: MouseEvent) => {
        e.stopPropagation();
        if (actionLoading) return;
        setPendingAction('trash');
    };

    const moveToTrash = async () => {
        setActionLoading(true);
        try {
            const res = await fetch(
                `${API_BASE}/api/voice-admin/sessions/${encodeURIComponent(session.callSid)}/trash`,
                { method: 'POST', headers: { Authorization: `Bearer ${token}` } },
            );
            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                throw new Error(err.message || 'Could not move to trash');
            }
            const data = await res.json();
            toast.success('Call moved to trash');
            onMoved(data.stats);
        } catch (err: any) {
            toast.error(err?.message || 'Could not move to trash');
        } finally {
            setActionLoading(false);
        }
    };

    const restoreFromTrash = async (e: MouseEvent) => {
        e.stopPropagation();
        if (actionLoading) return;
        setActionLoading(true);
        try {
            const res = await fetch(
                `${API_BASE}/api/voice-admin/sessions/${encodeURIComponent(session.callSid)}/restore`,
                { method: 'POST', headers: { Authorization: `Bearer ${token}` } },
            );
            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                throw new Error(err.message || 'Could not restore call');
            }
            const data = await res.json();
            toast.success('Call restored');
            onMoved(data.stats);
        } catch (err: any) {
            toast.error(err?.message || 'Could not restore call');
        } finally {
            setActionLoading(false);
        }
    };

    const requestDeletePermanent = (e: MouseEvent) => {
        e.stopPropagation();
        if (actionLoading) return;
        setPendingAction('delete');
    };

    const deletePermanent = async () => {
        setActionLoading(true);
        try {
            const res = await fetch(
                `${API_BASE}/api/voice-admin/sessions/${encodeURIComponent(session.callSid)}`,
                { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } },
            );
            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                throw new Error(err.message || 'Could not delete call');
            }
            toast.success('Call permanently deleted');
            onMoved();
        } catch (err: any) {
            toast.error(err?.message || 'Could not delete call');
        } finally {
            setActionLoading(false);
        }
    };

    return (
        <div className="bg-white rounded-xl border border-ocean-ice shadow-sm overflow-hidden">
            {/* Header row */}
            <button
                onClick={fetchTurns}
                className="w-full flex items-center justify-between px-5 py-4 hover:bg-ocean-powder/50 transition-colors text-left"
            >
                <div className="flex items-center gap-4 flex-1 min-w-0">
                    {channelIcon(session.channel)}
                    <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                            {statusBadge(session.status)}
                            <span className="text-xs text-ocean-deep/55 font-mono truncate max-w-[160px]">
                                {session.callSid.slice(0, 20)}…
                            </span>
                        </div>
                        <div className="text-xs text-ocean-deep/75 mt-1">
                            {formatDate(session.startedAt)}
                            {(() => {
                                const phone = sessionPhoneDisplay(session, isOutbound);
                                return phone ? (
                                    <span className="ml-2">
                                        {phone.label} <span className="font-mono">{phone.number}</span>
                                    </span>
                                ) : null;
                            })()}
                        </div>
                    </div>
                </div>

                <div className="flex items-center gap-3 text-sm text-ocean-deep flex-shrink-0">
                    <div className="flex items-center gap-1.5" title="Duration">
                        <Timer className="h-3.5 w-3.5 text-ocean-deep/55" />
                        <span>{formatDuration(getSessionDuration(session))}</span>
                    </div>
                    <div className="flex items-center gap-1.5" title="Turns">
                        <ArrowRightLeft className="h-3.5 w-3.5 text-ocean-deep/55" />
                        <span>{session.turnCount}</span>
                    </div>
                    <div className="flex items-center gap-1.5" title="Avg latency">
                        <Wifi className="h-3.5 w-3.5 text-ocean-deep/55" />
                        <span className={`font-mono text-xs ${avgLatency > 3000 ? 'text-red-500' : avgLatency > 1500 ? 'text-amber-500' : 'text-green-600'}`}>
                            {(avgLatency / 1000).toFixed(1)}s
                        </span>
                    </div>
                    <div className="text-xs text-ocean-deep/55 w-24 text-right hidden sm:block">
                        {endReasonLabel(session.endReason)}
                    </div>
                    {!isTrashView ? (
                        <button
                            type="button"
                            onClick={requestMoveToTrash}
                            disabled={actionLoading}
                            className="inline-flex items-center gap-1 rounded-lg border border-ocean-ice bg-white px-2.5 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
                            title="Move to trash"
                        >
                            <Trash2 className="h-3.5 w-3.5" />
                            <span className="hidden md:inline">Trash</span>
                        </button>
                    ) : (
                        <>
                            <button
                                type="button"
                                onClick={restoreFromTrash}
                                disabled={actionLoading}
                                className="inline-flex items-center gap-1 rounded-lg border border-ocean-ice bg-white px-2.5 py-1.5 text-xs font-medium text-ocean-deep hover:bg-ocean-powder disabled:opacity-50"
                                title="Restore call"
                            >
                                <RotateCcw className="h-3.5 w-3.5" />
                                <span className="hidden md:inline">Restore</span>
                            </button>
                            <button
                                type="button"
                                onClick={requestDeletePermanent}
                                disabled={actionLoading}
                                className="inline-flex items-center gap-1 rounded-lg border border-red-200 bg-white px-2.5 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
                                title="Delete permanently"
                            >
                                <Trash2 className="h-3.5 w-3.5" />
                                <span className="hidden md:inline">Delete</span>
                            </button>
                        </>
                    )}
                    {expanded
                        ? <ChevronUp className="h-4 w-4 text-ocean-deep/55" />
                        : <ChevronDown className="h-4 w-4 text-ocean-deep/55" />
                    }
                </div>
            </button>

            {/* Expanded turn detail */}
            {expanded && (
                <div className="border-t border-ocean-ice px-5 py-3 bg-ocean-powder/30">
                    {loadingTurns ? (
                        <div className="flex items-center justify-center py-8">
                            <RefreshCw className="h-5 w-5 animate-spin text-ocean-deep mr-2" />
                            <span className="text-sm text-ocean-deep/75">Loading conversation…</span>
                        </div>
                    ) : turns.length === 0 ? (
                        <p className="text-sm text-ocean-deep/55 text-center py-6">No turns recorded for this session.</p>
                    ) : (
                        <>
                            <div className="flex flex-wrap justify-end gap-2 mb-3">
                                <button
                                    type="button"
                                    disabled={exporting}
                                    onClick={() => void handleExportPdf()}
                                    className="inline-flex items-center gap-1.5 rounded-lg border border-ocean-deep bg-ocean-deep px-4 py-2 text-xs font-semibold text-white hover:bg-ocean-navy disabled:opacity-50"
                                >
                                    <FileText className="h-3.5 w-3.5" />
                                    {exporting ? 'Exporting PDF…' : 'Download PDF'}
                                </button>
                            </div>
                            <div className="divide-y divide-ocean-ice/80">
                                {turns.map((turn) => (
                                    <TurnRow key={turn._id} turn={turn} />
                                ))}
                            </div>
                        </>
                    )}
                </div>
            )}

            <ConfirmDialog
                open={pendingAction === 'trash'}
                onOpenChange={(open) => { if (!open && !actionLoading) setPendingAction(null); }}
                title="Move call to trash?"
                description="This call will be removed from your stats until you restore it."
                confirmLabel="Move to trash"
                destructive
                loading={actionLoading}
                onConfirm={async () => {
                    setPendingAction(null);
                    await moveToTrash();
                }}
            />
            <ConfirmDialog
                open={pendingAction === 'delete'}
                onOpenChange={(open) => { if (!open && !actionLoading) setPendingAction(null); }}
                title="Permanently delete call?"
                description="This will permanently delete the call and its transcript. This cannot be undone."
                confirmLabel="Delete permanently"
                destructive
                loading={actionLoading}
                onConfirm={async () => {
                    setPendingAction(null);
                    await deletePermanent();
                }}
            />
        </div>
    );
}

// ─── Main Page Component ──────────────────────────────────────────────────

export default function VoiceCallHistory() {
    const { agentId } = useParams<{ agentId: string }>();
    const { token } = useAuth();

    const [sessions, setSessions] = useState<VoiceSession[]>([]);
    const [total, setTotal] = useState(0);
    const [trashTotal, setTrashTotal] = useState(0);
    const [stats, setStats] = useState<SessionStats | null>(null);
    const [loading, setLoading] = useState(true);
    const [statusFilter, setStatusFilter] = useState('');
    const [view, setView] = useState<'active' | 'trash'>('active');
    const [page, setPage] = useState(0);
    const [agentName, setAgentName] = useState('');
    const [speakingName, setSpeakingName] = useState('');
    const [callDirection, setCallDirection] = useState<'inbound' | 'outbound'>('inbound');
    const pageSize = 20;
    const isOutbound = callDirection === 'outbound';

    // Fetch agent metadata (name + direction)
    useEffect(() => {
        if (!agentId || !token) return;
        fetch(`${API_BASE}/api/agents/${agentId}`, {
            headers: { Authorization: `Bearer ${token}` },
        })
            .then((r) => r.ok ? r.json() : null)
            .then((d) => {
                if (d?.name) setAgentName(d.name);
                const persona = (d?.persona?.name || '').trim();
                setSpeakingName(persona || d?.name || 'Agent');
                if (d?.callDirection === 'outbound') setCallDirection('outbound');
            })
            .catch(() => {});
    }, [agentId, token]);

    const fetchSessions = useCallback(async () => {
        if (!agentId || !token) return;
        setLoading(true);
        try {
            const params = new URLSearchParams({
                agentId,
                limit: String(pageSize),
                offset: String(page * pageSize),
                sort: '-startedAt',
            });
            if (statusFilter) params.set('status', statusFilter);
            if (view === 'trash') params.set('trashed', 'true');

            const res = await fetch(`${API_BASE}/api/voice-admin/sessions?${params}`, {
                headers: { Authorization: `Bearer ${token}` },
            });
            if (res.ok) {
                const data = await res.json();
                setSessions(data.sessions || []);
                setTotal(data.total || 0);
                setTrashTotal(data.trashTotal ?? 0);
                setStats(data.stats || null);
            }
        } catch (err) {
            console.error('Failed to fetch sessions', err);
        } finally {
            setLoading(false);
        }
    }, [agentId, token, page, statusFilter, view]);

    useEffect(() => {
        fetchSessions();
    }, [fetchSessions]);

    const handleSessionMoved = useCallback((newStats?: SessionStats) => {
        if (newStats) setStats(newStats);
        void fetchSessions();
    }, [fetchSessions]);

    const totalPages = Math.ceil(total / pageSize);
    const isTrashView = view === 'trash';

    const displayTotalCalls = stats?.totalCalls ?? 0;
    const completedCount = stats?.completedCount ?? 0;
    const failedCount = stats?.failedCount ?? 0;
    const totalDuration = stats?.totalDurationSec ?? 0;
    const avgDuration = stats?.avgDurationSec ?? 0;
    const otherCount = stats?.otherCount ?? Math.max(0, displayTotalCalls - completedCount - failedCount);

    return (
        <div className="bg-white pb-12 py-8 px-4 sm:px-6 lg:px-8">
            <div className="max-w-5xl mx-auto space-y-6">
                <PageBackNav to="/dashboard" label="Back to Dashboard" />

                <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                        <h1 className="text-2xl font-bold text-ocean-navy">Call History</h1>
                        {agentName && <p className="text-sm text-ocean-deep/75">{agentName}</p>}
                    </div>
                    <div className="flex shrink-0 flex-wrap items-center gap-3">
                        <div className="inline-flex min-w-[280px] rounded-xl border-2 border-ocean-ice bg-ocean-powder/40 p-1 shadow-sm">
                            <button
                                type="button"
                                onClick={() => { setView('active'); setPage(0); }}
                                className={`flex-1 rounded-lg px-10 py-2.5 text-sm font-semibold transition-all ${view === 'active' ? 'bg-ocean-deep text-white shadow-md' : 'text-ocean-deep hover:bg-white/90'}`}
                            >
                                Calls
                            </button>
                            <button
                                type="button"
                                onClick={() => { setView('trash'); setPage(0); }}
                                className={`flex-1 rounded-lg px-10 py-2.5 text-sm font-semibold transition-all ${view === 'trash' ? 'bg-ocean-deep text-white shadow-md' : 'text-ocean-deep hover:bg-white/90'}`}
                            >
                                Trash{trashTotal > 0 ? ` (${trashTotal})` : ''}
                            </button>
                        </div>
                        {!isTrashView && (
                            <select
                                value={statusFilter}
                                onChange={(e) => { setStatusFilter(e.target.value); setPage(0); }}
                                className="text-sm border border-ocean-ice rounded-lg px-3 py-1.5 bg-white"
                            >
                                <option value="">All statuses</option>
                                <option value="completed">Completed</option>
                                <option value="in-progress">In Progress</option>
                                <option value="failed">Failed</option>
                                <option value="canceled">Canceled</option>
                            </select>
                        )}
                        <button
                            type="button"
                            onClick={fetchSessions}
                            className="p-2 hover:bg-ocean-powder rounded-lg transition-colors"
                            title="Refresh"
                        >
                            <RefreshCw className={`h-4 w-4 text-ocean-deep/75 ${loading ? 'animate-spin' : ''}`} />
                        </button>
                    </div>
                </div>

                {/* Summary Cards */}
                {!isTrashView && (
                <div className={`grid grid-cols-2 gap-4 ${otherCount > 0 ? 'sm:grid-cols-3 lg:grid-cols-6' : 'sm:grid-cols-5'}`}>
                    <div className="bg-white rounded-xl border border-ocean-ice shadow-sm p-4">
                        <p className="text-xs text-ocean-deep/75 mb-1">Total Calls</p>
                        <p className="text-2xl font-bold text-ocean-navy">{displayTotalCalls}</p>
                    </div>
                    <div className="bg-white rounded-xl border border-ocean-ice shadow-sm p-4">
                        <p className="text-xs text-ocean-deep/75 mb-1">Completed</p>
                        <p className="text-2xl font-bold text-green-600">{completedCount}</p>
                    </div>
                    <div className="bg-white rounded-xl border border-ocean-ice shadow-sm p-4">
                        <p className="text-xs text-ocean-deep/75 mb-1">Failed</p>
                        <p className="text-2xl font-bold text-red-500">{failedCount}</p>
                    </div>
                    {otherCount > 0 && (
                        <div className="bg-white rounded-xl border border-amber-200 shadow-sm p-4" title="Calls that ended as canceled, no-answer, in-progress, or other non-completed statuses">
                            <p className="text-xs text-amber-700/80 mb-1">Other</p>
                            <p className="text-2xl font-bold text-amber-600">{otherCount}</p>
                        </div>
                    )}
                    <div className="bg-white rounded-xl border border-ocean-ice shadow-sm p-4">
                        <p className="text-xs text-ocean-deep/75 mb-1">Avg Duration</p>
                        <p className="text-2xl font-bold text-ocean-navy">{formatDuration(avgDuration)}</p>
                    </div>
                    <div className="bg-white rounded-xl border border-ocean-ice shadow-sm p-4">
                        <p className="text-xs text-ocean-deep/75 mb-1">Total Duration</p>
                        <p className="text-2xl font-bold text-ocean-navy">{formatDuration(totalDuration)}</p>
                    </div>
                </div>
                )}

                {/* Sessions List */}
                {loading ? (
                    <div className="flex items-center justify-center py-20">
                        <RefreshCw className="h-8 w-8 animate-spin text-ocean-deep" />
                    </div>
                ) : sessions.length === 0 ? (
                    <div className="text-center py-20">
                        <PhoneOff className="h-12 w-12 text-ocean-mist mx-auto mb-4" />
                        <p className="text-ocean-deep/75 text-lg">
                            {isTrashView ? 'Trash is empty' : 'No calls yet'}
                        </p>
                        <p className="text-ocean-deep/55 text-sm mt-1">
                            {isTrashView
                                ? 'Deleted calls will appear here until you restore or permanently remove them.'
                                : 'Calls will appear here once this agent receives or makes a voice call.'}
                        </p>
                    </div>
                ) : (
                    <div className="space-y-3">
                        {sessions.map((session) => (
                            <SessionRow
                                key={session._id}
                                session={session}
                                token={token!}
                                isOutbound={isOutbound}
                                agentLabel={speakingName || agentName || 'Agent'}
                                isTrashView={isTrashView}
                                onMoved={handleSessionMoved}
                            />
                        ))}
                    </div>
                )}

                {/* Pagination */}
                {totalPages > 1 && (
                    <div className="flex items-center justify-between pt-2">
                        <p className="text-sm text-ocean-deep/75">
                            Showing {page * pageSize + 1}-{Math.min((page + 1) * pageSize, total)} of {total}
                        </p>
                        <div className="flex gap-2">
                            <button
                                disabled={page === 0}
                                onClick={() => setPage(page - 1)}
                                className="px-3 py-1.5 text-sm rounded-lg border border-ocean-ice bg-white hover:bg-ocean-powder disabled:opacity-40 disabled:cursor-not-allowed"
                            >
                                Previous
                            </button>
                            <button
                                disabled={page >= totalPages - 1}
                                onClick={() => setPage(page + 1)}
                                className="px-3 py-1.5 text-sm rounded-lg border border-ocean-ice bg-white hover:bg-ocean-powder disabled:opacity-40 disabled:cursor-not-allowed"
                            >
                                Next
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
