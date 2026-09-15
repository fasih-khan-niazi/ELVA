import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import {
    Plus, Users, Phone, TrendingUp, Target, Ban, X,
    Pause, CheckCircle, Clock, Square, Sparkles,
    LayoutTemplate, PenLine, Activity,
    Trash2,
} from 'lucide-react';
import { peekWizardDraftSummary, clearCampaignWizardDraft } from '../utils/campaignWizardDraft';
import { PageBackNav } from '../components/PageBackNav';
import { useToast } from '../components/Toast';
import ConfirmDialog from '../components/ConfirmDialog';
import { CampaignsPageSkeleton } from '../components/skeletons';
import AnimatedPage from '../components/AnimatedPage';
import { motion } from 'framer-motion';
import { listStagger, listItemEnter } from '@/lib/motion';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3000';

interface Campaign {
    _id: string;
    name: string;
    description: string;
    status: 'draft' | 'running' | 'paused' | 'completed' | 'stopped' | 'scheduled';
    goal: string;
    creationMethod?: 'ai' | 'template' | 'manual';
    totalContacts: number;
    agentId: { _id: string; name: string } | null;
    stats: {
        pending: number;
        calling: number;
        interested: number;
        notInterested: number;
        noAnswer: number;
        voicemail: number;
        failed: number;
        callback: number;
        dnc: number;
        wrongNumber: number;
        connectedCalls: number;
        totalCallDurationSec: number;
    };
    createdAt: string;
}

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: React.ElementType }> = {
    draft:     { label: 'Draft',     color: 'bg-ocean-mist/50 text-ocean-deep/90',    icon: PenLine },
    scheduled: { label: 'Scheduled', color: 'bg-blue-100 text-blue-700',    icon: Clock },
    running:   { label: 'Running',   color: 'bg-green-100 text-green-700',  icon: Activity },
    paused:    { label: 'Paused',    color: 'bg-amber-100 text-amber-700',  icon: Pause },
    completed: { label: 'Completed', color: 'bg-ocean-mist text-ocean-deep',icon: CheckCircle },
    stopped:   { label: 'Stopped',   color: 'bg-red-100 text-red-600',      icon: Square },
};

const GOAL_LABELS: Record<string, string> = {
    book_meeting:      'Book Meeting',
    qualify_lead:      'Qualify Lead',
    transfer_to_human: 'Warm Transfer',
    nurture:           'Nurture',
    sell_direct:       'Direct Sell',
};

const METHOD_CONFIG: Record<string, { label: string; color: string; icon: React.ElementType }> = {
    ai:       { label: 'AI', color: 'bg-ocean-mist text-ocean-deep', icon: Sparkles },
    template: { label: 'Template', color: 'bg-emerald-50 text-emerald-700', icon: LayoutTemplate },
    manual:   { label: 'Manual', color: 'bg-ocean-mist/50 text-ocean-deep/90', icon: PenLine },
};

const FILTER_TABS = [
    { key: 'all',       label: 'All' },
    { key: 'running',   label: 'Running' },
    { key: 'draft',     label: 'Draft' },
    { key: 'scheduled', label: 'Scheduled' },
    { key: 'completed', label: 'Completed' },
];

interface DncEntry {
    phone: string;
    name: string;
    company: string;
    addedAt: string;
    campaignCount: number;
}

function DncModal({ token, onClose }: { token: string | null; onClose: () => void }) {
    const [entries, setEntries] = useState<DncEntry[]>([]);
    const [loading, setLoading] = useState(true);
    const [phone, setPhone] = useState('');
    const [name, setName] = useState('');
    const [adding, setAdding] = useState(false);
    const [err, setErr] = useState('');

    const load = async () => {
        try {
            const res = await fetch(`${API_BASE}/api/campaigns/dnc`, { headers: { Authorization: `Bearer ${token}` } });
            if (res.ok) setEntries(await res.json());
            else setErr('Failed to load DNC list');
        } catch { setErr('Connection error'); } finally { setLoading(false); }
    };

    useEffect(() => { load(); }, []); // eslint-disable-line

    const add = async (e: React.FormEvent) => {
        e.preventDefault(); setAdding(true); setErr('');
        try {
            const res = await fetch(`${API_BASE}/api/campaigns/dnc`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                body: JSON.stringify({ phone, name }),
            });
            if (!res.ok) { const e1 = await res.json().catch(() => ({ message: 'Failed' })); throw new Error(e1.message); }
            setPhone(''); setName(''); await load();
        } catch (e: any) { setErr(e.message || 'Failed'); } finally { setAdding(false); }
    };

    const remove = async (p: string) => {
        if (!confirm(`Remove ${p} from DNC?`)) return;
        await fetch(`${API_BASE}/api/campaigns/dnc/${encodeURIComponent(p)}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
        await load();
    };

    return (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4 overflow-y-auto">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl my-8">
                <div className="p-5 border-b border-ocean-ice/80 flex items-center justify-between">
                    <div>
                        <h2 className="text-base font-semibold text-ocean-navy flex items-center gap-2">
                            <Ban className="h-4 w-4 text-red-500" /> Do-Not-Call List
                        </h2>
                        <p className="text-xs text-ocean-deep/80 mt-0.5">Numbers here are skipped across all campaigns when "honor DNC" is on.</p>
                    </div>
                    <button type="button" onClick={onClose} className="text-ocean-deep/60 hover:text-ocean-deep/90"><X className="h-5 w-5" /></button>
                </div>
                <div className="p-5 space-y-4">
                    <form onSubmit={add} className="flex gap-2 items-end">
                        <div className="flex-1">
                            <label className="block text-xs font-medium text-ocean-deep mb-1">Phone (E.164)</label>
                            <input type="tel" required value={phone} onChange={e => setPhone(e.target.value)} placeholder="+14155551234"
                                className="w-full px-3 py-2 border border-ocean-ice rounded-lg text-sm outline-none focus:ring-2 focus:ring-red-400" />
                        </div>
                        <div className="flex-1">
                            <label className="block text-xs font-medium text-ocean-deep mb-1">Name (optional)</label>
                            <input type="text" value={name} onChange={e => setName(e.target.value)} placeholder="Jane Smith"
                                className="w-full px-3 py-2 border border-ocean-ice rounded-lg text-sm outline-none" />
                        </div>
                        <button type="submit" disabled={adding}
                            className="px-4 py-2 bg-red-500 text-white rounded-lg text-sm font-medium hover:bg-red-600 disabled:opacity-50">
                            {adding ? '...' : 'Add'}
                        </button>
                    </form>
                    {err && <p className="text-red-600 text-xs">{err}</p>}
                    {loading ? (
                        <p className="py-6 text-center text-ocean-deep/60 text-sm">Loading...</p>
                    ) : entries.length === 0 ? (
                        <p className="py-6 text-center text-ocean-deep/60 text-sm">No numbers on DNC list.</p>
                    ) : (
                        <div className="border border-ocean-ice rounded-xl overflow-hidden max-h-80 overflow-y-auto">
                            <table className="w-full text-sm">
                                <thead className="bg-ocean-powder text-ocean-deep/80 text-xs uppercase tracking-wide sticky top-0">
                                    <tr>
                                        <th className="text-left px-3 py-2">Phone</th>
                                        <th className="text-left px-3 py-2">Name</th>
                                        <th className="text-left px-3 py-2">Added</th>
                                        <th className="px-3 py-2"></th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-ocean-ice/80">
                                    {entries.map(e => (
                                        <tr key={e.phone}>
                                            <td className="px-3 py-2 font-mono text-ocean-deep">{e.phone}</td>
                                            <td className="px-3 py-2 text-ocean-deep/90">{e.name || '-'}</td>
                                            <td className="px-3 py-2 text-ocean-deep/60 text-xs">{new Date(e.addedAt).toLocaleDateString()}</td>
                                            <td className="px-3 py-2 text-right">
                                                <button onClick={() => remove(e.phone)} className="text-xs text-red-500 hover:text-red-700">Remove</button>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>
                <div className="p-4 border-t border-ocean-ice/80 flex justify-end">
                    <button onClick={onClose} className="px-4 py-2 bg-ocean-mist/50 text-ocean-deep rounded-lg text-sm font-medium hover:bg-ocean-ice">Close</button>
                </div>
            </div>
        </div>
    );
}

function computeMetrics(s: Campaign['stats']) {
    const contacted = s.interested + s.notInterested + s.noAnswer + s.voicemail + s.failed + s.callback + s.dnc + s.wrongNumber;
    const connected = s.connectedCalls || (s.interested + s.notInterested + s.callback);
    const connectRate = contacted > 0 ? Math.round((connected / contacted) * 100) : 0;
    const conversionRate = connected > 0 ? Math.round((s.interested / connected) * 100) : 0;
    const progress = contacted > 0 ? Math.round((contacted / Math.max(contacted, s.pending + contacted)) * 100) : 0;
    return { contacted, connected, connectRate, conversionRate, progress };
}

export default function CampaignsPage() {
    const { token } = useAuth();
    const navigate = useNavigate();
    const toast = useToast();

    const [campaigns, setCampaigns] = useState<Campaign[]>([]);
    const [loading, setLoading] = useState(true);
    const [showDnc, setShowDnc] = useState(false);
    const [activeTab, setActiveTab] = useState('all');
    const [wizardDraft, setWizardDraft] = useState(() => peekWizardDraftSummary());
    const [deletingId, setDeletingId] = useState<string | null>(null);
    const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

    useEffect(() => {
        setWizardDraft(peekWizardDraftSummary());
    }, []);

    useEffect(() => {
        const refresh = () => setWizardDraft(peekWizardDraftSummary());
        window.addEventListener('focus', refresh);
        return () => window.removeEventListener('focus', refresh);
    }, []);

    useEffect(() => {
        (async () => {
            try {
                const res = await fetch(`${API_BASE}/api/campaigns`, { headers: { Authorization: `Bearer ${token}` } });
                if (res.ok) setCampaigns(await res.json());
                else toast.error('Could not load campaigns');
            } catch {
                toast.error('Connection error', 'Could not load campaigns');
            } finally { setLoading(false); }
        })();
    }, [token]);

    const filtered = activeTab === 'all' ? campaigns : campaigns.filter(c => c.status === activeTab);

    const requestDeleteCampaign = (id: string) => {
        const camp = campaigns.find(c => c._id === id);
        if (!camp) return;
        if (camp.status === 'running') {
            toast.warning('Stop the campaign first', 'Pause or stop the campaign before deleting it.');
            return;
        }
        setDeleteConfirmId(id);
    };

    const confirmDeleteCampaign = async () => {
        if (!deleteConfirmId) return;
        const id = deleteConfirmId;
        setDeletingId(id);
        try {
            const res = await fetch(`${API_BASE}/api/campaigns/${id}`, {
                method: 'DELETE',
                headers: { Authorization: `Bearer ${token}` },
            });
            const data = await res.json().catch(() => ({ message: 'Delete failed' }));
            if (!res.ok) throw new Error(data.message || 'Delete failed');
            setCampaigns(prev => prev.filter(c => c._id !== id));
            toast.success('Campaign deleted');
            setDeleteConfirmId(null);
        } catch (e: unknown) {
            toast.error('Delete failed', e instanceof Error ? e.message : 'Could not delete campaign');
        } finally {
            setDeletingId(null);
        }
    };

    const deleteConfirmCampaign = deleteConfirmId
        ? campaigns.find(c => c._id === deleteConfirmId)
        : null;

    const agg = campaigns.reduce((acc, c) => {
        const m = computeMetrics(c.stats);
        acc.contacted += m.contacted;
        acc.connected += m.connected;
        acc.interested += c.stats.interested;
        acc.totalContacts += c.totalContacts;
        return acc;
    }, { contacted: 0, connected: 0, interested: 0, totalContacts: 0 });
    const aggConnectRate = agg.contacted > 0 ? Math.round((agg.connected / agg.contacted) * 100) : 0;
    const aggConversion  = agg.connected > 0 ? Math.round((agg.interested / agg.connected) * 100) : 0;

    const tabCounts: Record<string, number> = { all: campaigns.length };
    for (const c of campaigns) tabCounts[c.status] = (tabCounts[c.status] || 0) + 1;

    if (loading) {
        return <CampaignsPageSkeleton />;
    }

    return (
        <AnimatedPage className="bg-white pb-12">
            <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 pt-6 sm:pt-8">
                <PageBackNav to="/dashboard" label="Back to Dashboard" />
                <div className="mb-8 rounded-3xl border border-white/15 bg-gradient-to-br from-ocean-navy via-ocean-deep to-ocean-rich px-6 py-7 text-white shadow-ocean sm:px-8 sm:py-8">
                    <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
                        <div className="min-w-0">
                            <h1 className="text-2xl font-bold tracking-tight">Outbound Campaigns</h1>
                            <p className="mt-1 text-sm text-white/85">
                                AI-powered voice campaigns for lead generation, follow-ups, and outreach.
                            </p>
                        </div>
                        <div className="flex flex-shrink-0 flex-wrap gap-2.5 lg:justify-end">
                            <button
                                type="button"
                                onClick={() => setShowDnc(true)}
                                className="inline-flex items-center gap-2 rounded-xl border border-rose-300/65 bg-rose-500/20 px-3.5 py-2.5 text-sm font-semibold text-rose-50 shadow-sm backdrop-blur-[2px] transition hover:border-rose-200/85 hover:bg-rose-500/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-200 focus-visible:ring-offset-2 focus-visible:ring-offset-ocean-deep"
                            >
                                <Ban className="h-4 w-4 shrink-0" aria-hidden /> DNC list
                            </button>
                            <button
                                type="button"
                                onClick={() => navigate('/campaigns/create?fresh=1')}
                                className="inline-flex items-center gap-2 rounded-xl border-2 border-cyan-200/95 bg-white px-4 py-2.5 text-sm font-semibold text-ocean-navy shadow-[0_10px_30px_-8px_rgba(0,0,0,.45)] transition hover:border-white hover:bg-cyan-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-ocean-rich"
                            >
                                <Plus className="h-4 w-4 shrink-0" aria-hidden /> New campaign
                            </button>
                        </div>
                    </div>
                </div>

                {wizardDraft && (
                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 p-4 mb-6 rounded-2xl border border-ocean-bright/30 bg-ocean-powder/80">
                        <div className="text-sm text-ocean-deep">
                            <span className="font-semibold text-ocean-navy">Wizard draft on this device: </span>
                            {wizardDraft.title}
                            <span className="text-ocean-deep/70"> · Updated {new Date(wizardDraft.updatedAt).toLocaleString()}</span>
                        </div>
                        <div className="flex flex-wrap gap-2">
                            <button
                                type="button"
                                onClick={() => { navigate('/campaigns/create'); setWizardDraft(peekWizardDraftSummary()); }}
                                className="px-4 py-2 rounded-xl bg-ocean-deep text-white text-sm font-semibold hover:bg-ocean-rich"
                            >
                                Resume setup
                            </button>
                            <button
                                type="button"
                                onClick={() => { clearCampaignWizardDraft(); setWizardDraft(null); }}
                                className="px-4 py-2 rounded-xl border border-ocean-ice text-ocean-deep text-sm font-medium hover:bg-white"
                            >
                                Discard draft
                            </button>
                        </div>
                    </div>
                )}

                {/* Aggregate KPI row */}
                {campaigns.length > 0 && (
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
                        {[
                            { icon: Users,      label: 'Total Contacts', value: agg.totalContacts.toLocaleString(),         sub: `${campaigns.length} campaign${campaigns.length !== 1 ? 's' : ''}`, color: 'text-ocean-navy' },
                            { icon: Phone,      label: 'Connected',      value: agg.connected.toLocaleString(),             sub: `${aggConnectRate}% connect rate`, color: 'text-ocean-navy' },
                            { icon: Target,     label: 'Qualified Leads',value: agg.interested.toLocaleString(),            sub: 'interested responses', color: 'text-green-600' },
                            { icon: TrendingUp, label: 'Conversion',     value: `${aggConversion}%`,                        sub: 'of connected calls', color: 'text-ocean-deep' },
                        ].map(({ icon: Icon, label, value, sub, color }) => (
                            <div key={label} className="rounded-xl border border-ocean-ice bg-white p-4 shadow-ocean-sm">
                                <div className="flex items-center gap-2 text-ocean-deep/60 text-xs mb-1.5">
                                    <Icon className="h-3.5 w-3.5" /> {label}
                                </div>
                                <div className={`text-2xl font-bold ${color}`}>{value}</div>
                                <div className="text-xs text-ocean-deep/60 mt-0.5">{sub}</div>
                            </div>
                        ))}
                    </div>
                )}

                {/* Filter tabs */}
                <div className="flex flex-wrap gap-1 mb-2 border-b border-ocean-ice">
                    {FILTER_TABS.map(tab => (
                        <button
                            key={tab.key}
                            type="button"
                            onClick={() => setActiveTab(tab.key)}
                            className={`flex items-center gap-2 px-3 py-2 text-sm font-medium border-b-2 transition-colors whitespace-nowrap -mb-px ${
                                activeTab === tab.key
                                    ? 'border-ocean-deep text-ocean-deep'
                                    : 'border-transparent text-ocean-deep/80 hover:text-ocean-deep'
                            }`}
                        >
                            <span>{tab.label}</span>
                            <span
                                className={`min-w-[1.25rem] text-center text-xs font-semibold px-1.5 py-0.5 rounded-full ${
                                    activeTab === tab.key ? 'bg-ocean-mist text-ocean-deep' : 'bg-ocean-mist/50 text-ocean-deep/80'
                                }`}
                            >
                                {tabCounts[tab.key] ?? 0}
                            </span>
                        </button>
                    ))}
                </div>
                {/* Campaign list */}
                {filtered.length === 0 ? (
                    <div className="bg-white rounded-2xl border border-ocean-ice p-14 text-center">
                        <Phone className="h-10 w-10 text-gray-200 mx-auto mb-3" />
                        {activeTab === 'all' ? (
                            <>
                                <p className="text-ocean-deep/80 font-medium mb-4">No campaigns yet.</p>
                                <button
                                    onClick={() => navigate('/campaigns/create?fresh=1')}
                                    className="inline-flex items-center gap-2 px-5 py-2.5 bg-ocean-deep text-white rounded-xl text-sm font-semibold hover:bg-ocean-rich"
                                >
                                    <Plus className="h-4 w-4" /> Create your first campaign
                                </button>
                            </>
                        ) : (
                            <p className="text-ocean-deep/60 text-sm">No {activeTab} campaigns.</p>
                        )}
                    </div>
                ) : (
                    <motion.div className="space-y-3" initial="hidden" animate="show" variants={listStagger}>
                        {filtered.map(c => {
                            const m = computeMetrics(c.stats);
                            const statusCfg = STATUS_CONFIG[c.status] || STATUS_CONFIG.draft;
                            const StatusIcon = statusCfg.icon;
                            const methodCfg = c.creationMethod ? METHOD_CONFIG[c.creationMethod] : null;
                            const MethodIcon = methodCfg?.icon;
                            const pct = c.totalContacts > 0
                                ? Math.round((m.contacted / c.totalContacts) * 100)
                                : 0;

                            return (
                                <motion.div
                                    key={c._id}
                                    variants={listItemEnter}
                                    className="group relative rounded-2xl border border-ocean-ice bg-white shadow-ocean-sm transition-all hover:border-ocean-rich hover:shadow-md"
                                >
                                    <div className="flex">
                                        <button
                                            type="button"
                                            onClick={() => navigate(`/campaigns/${c._id}`)}
                                            className="flex-1 min-w-0 cursor-pointer rounded-2xl text-left p-5 pr-14 sm:pr-5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ocean-bright focus-visible:ring-offset-2"
                                        >
                                            <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
                                                <div className="min-w-0 space-y-2">
                                                    <div className="flex flex-wrap items-center gap-x-2 gap-y-2">
                                                        <span className="truncate font-semibold text-ocean-navy group-hover:text-ocean-deep">{c.name}</span>
                                                        <span className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${statusCfg.color}`}>
                                                            <StatusIcon className="h-3 w-3" />
                                                            {statusCfg.label}
                                                        </span>
                                                        {c.goal && (
                                                            <span className="rounded-full bg-ocean-mist/50 px-2 py-0.5 text-xs font-medium text-ocean-deep/90">
                                                                {GOAL_LABELS[c.goal] || c.goal}
                                                            </span>
                                                        )}
                                                        {methodCfg && MethodIcon && (
                                                            <span className={`inline-flex shrink-0 items-center gap-1 rounded-full px-1.5 py-0.5 text-xs font-medium ${methodCfg.color}`}>
                                                                <MethodIcon className="h-3 w-3" /> {methodCfg.label}
                                                            </span>
                                                        )}
                                                    </div>
                                                    <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-ocean-deep/85 sm:text-sm">
                                                        <span>
                                                            <span className="font-medium text-ocean-deep">Agent:</span>{' '}
                                                            {c.agentId?.name || '-'}
                                                        </span>
                                                        <span aria-hidden className="text-ocean-ice hidden sm:inline">|</span>
                                                        <span>
                                                            <span className="font-medium text-ocean-deep">Contacts:</span>{' '}
                                                            {c.totalContacts.toLocaleString()}
                                                        </span>
                                                    </div>
                                                </div>

                                                <div className="flex flex-wrap items-center gap-4 lg:justify-end lg:gap-6">
                                                    <div className="min-w-[3.25rem] text-left lg:text-right">
                                                        <div className="text-xs text-ocean-deep/60">Leads</div>
                                                        <div className="font-bold text-green-600">{c.stats.interested}</div>
                                                    </div>
                                                    <div className="min-w-[3.25rem] text-left lg:text-right">
                                                        <div className="text-xs text-ocean-deep/60">Connect</div>
                                                        <div className="font-bold text-ocean-deep">{m.connectRate}%</div>
                                                    </div>
                                                    <div className="min-w-[3.25rem] text-left lg:text-right">
                                                        <div className="text-xs text-ocean-deep/60">Convert</div>
                                                        <div className="font-bold text-ocean-deep">{m.conversionRate}%</div>
                                                    </div>
                                                    {c.status === 'running' && c.stats.calling > 0 && (
                                                        <div className="flex items-center gap-1.5 rounded-lg bg-green-50 px-2 py-1 text-xs font-semibold text-green-600">
                                                            <span className="h-2 w-2 animate-pulse rounded-full bg-green-500" />
                                                            {c.stats.calling} live
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                        </button>

                                        <div className="absolute right-0 top-1/2 z-20 flex -translate-y-1/2 pr-2 sm:right-3 lg:static lg:top-auto lg:z-auto lg:translate-y-0 lg:flex-col lg:self-stretch lg:justify-center lg:border-l lg:border-ocean-ice/90 lg:pr-0 lg:pl-0">
                                            <button
                                                type="button"
                                                disabled={!!deletingId || c.status === 'running'}
                                                title={c.status === 'running' ? 'Stop this campaign before deleting' : 'Delete campaign'}
                                                onClick={(ev) => {
                                                    ev.preventDefault();
                                                    ev.stopPropagation();
                                                    void requestDeleteCampaign(c._id);
                                                }}
                                                className="flex items-center justify-center rounded-xl border border-red-700/90 bg-red-500 p-3 text-white shadow-sm transition hover:border-red-800 hover:bg-red-600 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-300 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-40 lg:h-full lg:min-h-[5rem] lg:w-[3.25rem] lg:rounded-none lg:rounded-r-2xl lg:border-l lg:border-red-800/50 lg:bg-red-500 lg:p-0 lg:hover:bg-red-600"
                                                aria-label="Delete campaign"
                                            >
                                                <Trash2 className={`h-5 w-5 ${deletingId === c._id ? 'animate-pulse' : ''}`} />
                                            </button>
                                        </div>
                                    </div>

                                    {c.totalContacts > 0 && (
                                        <div className="border-t border-ocean-ice/80 px-5 pb-4 pt-4">
                                            <div className="mb-1 flex items-center justify-between text-xs text-ocean-deep/60">
                                                <span>{m.contacted.toLocaleString()} contacted</span>
                                                <span>{pct}%</span>
                                            </div>
                                            <div className="h-1.5 overflow-hidden rounded-full bg-ocean-mist/50">
                                                <div
                                                    className={`h-full rounded-full transition-all ${c.status === 'running' ? 'bg-ocean-deep' : 'bg-ocean-ice'}`}
                                                    style={{ width: `${pct}%` }}
                                                />
                                            </div>
                                        </div>
                                    )}
                                </motion.div>
                            );
                        })}
                    </motion.div>
                )}
            </div>

            {showDnc && <DncModal token={token} onClose={() => setShowDnc(false)} />}

            <ConfirmDialog
                open={!!deleteConfirmId}
                onOpenChange={(open) => { if (!open && !deletingId) setDeleteConfirmId(null); }}
                title="Delete campaign?"
                description={
                    deleteConfirmCampaign
                        ? `Delete "${deleteConfirmCampaign.name}" and all of its dialer contacts? This cannot be undone.`
                        : 'This cannot be undone.'
                }
                confirmLabel="Delete"
                destructive
                loading={!!deletingId}
                onConfirm={confirmDeleteCampaign}
            />
        </AnimatedPage>
    );
}
