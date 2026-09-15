import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../components/Toast';
import { LeadsPageSkeleton } from '../components/skeletons';
import AnimatedPage from '../components/AnimatedPage';
import { motion } from 'framer-motion';
import { listStagger, listItemEnter } from '@/lib/motion';
import { PageBackNav } from '../components/PageBackNav';
import {
    Users, UserPlus, TrendingUp, Target, Star,
    Mail, Phone, Building2, Calendar, ChevronDown,
    RefreshCw, Search, Edit3, Trash2, Check, X, Loader2, Sparkles,
    Download, FileText
} from 'lucide-react';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3000';

interface Lead {
    _id: string;
    agentId: string;
    sessionId: string;
    channel: 'chat' | 'voice';
    status: 'new' | 'contacted' | 'qualified' | 'converted' | 'lost';
    score: number;
    name?: string;
    email?: string;
    phone?: string;
    company?: string;
    interest: string;
    notes?: string;
    source: 'auto' | 'manual';
    tags: string[];
    lastActivity: string;
    createdAt: string;
    updatedAt: string;
}

interface LeadStats {
    totalLeads: number;
    todayLeads: number;
    weekLeads: number;
    byStatus: Record<string, number>;
    bySource: Record<string, number>;
    avgScore: number;
    conversionRate: number;
}

const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
    new: { label: 'New', color: 'text-blue-700', bg: 'bg-blue-50 border-blue-200' },
    contacted: { label: 'Contacted', color: 'text-amber-700', bg: 'bg-amber-50 border-amber-200' },
    qualified: { label: 'Qualified', color: 'text-purple-700', bg: 'bg-purple-50 border-purple-200' },
    converted: { label: 'Converted', color: 'text-green-700', bg: 'bg-green-50 border-green-200' },
    lost: { label: 'Lost', color: 'text-ocean-deep/80', bg: 'bg-ocean-powder border-ocean-ice' },
};

const STATUS_FLOW = ['new', 'contacted', 'qualified', 'converted'];

function ScoreBadge({ score }: { score: number }) {
    let color = 'text-ocean-deep/80 bg-ocean-mist/50';
    if (score >= 70) color = 'text-green-700 bg-green-100';
    else if (score >= 40) color = 'text-amber-700 bg-amber-100';
    else if (score > 0) color = 'text-red-600 bg-red-50';
    return (
        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold ${color}`}>
            <Star className="h-3 w-3" /> {score}
        </span>
    );
}

export default function LeadsPage() {
    const { token } = useAuth();
    const { agentId } = useParams<{ agentId: string }>();
    const toast = useToast();

    const [leads, setLeads] = useState<Lead[]>([]);
    const [stats, setStats] = useState<LeadStats | null>(null);
    const [loading, setLoading] = useState(true);
    const [statusFilter, setStatusFilter] = useState<string>('all');
    const [searchQuery, setSearchQuery] = useState('');
    const [expandedLead, setExpandedLead] = useState<string | null>(null);
    const [updatingStatus, setUpdatingStatus] = useState<string | null>(null);
    const [editingLead, setEditingLead] = useState<string | null>(null);
    const [editForm, setEditForm] = useState<Partial<Lead>>({});
    const [showAddForm, setShowAddForm] = useState(false);
    const [addForm, setAddForm] = useState({ name: '', email: '', phone: '', company: '', interest: '', notes: '' });

    const fetchLeads = useCallback(async () => {
        try {
            const params = new URLSearchParams();
            if (statusFilter !== 'all') params.set('status', statusFilter);
            if (searchQuery) params.set('search', searchQuery);
            params.set('limit', '50');

            const res = await fetch(`${API_BASE}/api/leads/${agentId}?${params}`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (res.ok) {
                const data = await res.json();
                setLeads(data.leads || []);
            } else {
                toast.error('Failed to load leads');
            }
        } catch (err) {
            console.error('Error fetching leads:', err);
            toast.error('Connection error', 'Could not reach server');
        } finally {
            setLoading(false);
        }
    }, [agentId, token, statusFilter, searchQuery]);

    const fetchStats = useCallback(async () => {
        try {
            const res = await fetch(`${API_BASE}/api/leads/stats/${agentId}`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (res.ok) {
                setStats(await res.json());
            }
        } catch (err) {
            console.error('Error fetching lead stats:', err);
        }
    }, [agentId, token]);

    useEffect(() => {
        fetchLeads();
        fetchStats();
    }, [fetchLeads, fetchStats]);

    const updateStatus = async (leadId: string, newStatus: string) => {
        setUpdatingStatus(leadId);
        try {
            const res = await fetch(`${API_BASE}/api/leads/${agentId}/${leadId}/status`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                body: JSON.stringify({ status: newStatus })
            });
            if (res.ok) { await fetchLeads(); await fetchStats(); }
            else { toast.error('Update failed', 'Could not update lead status'); }
        } catch (err) {
            console.error('Error updating lead status:', err);
            toast.error('Connection error');
        } finally {
            setUpdatingStatus(null);
        }
    };

    const saveLead = async (leadId: string) => {
        try {
            const res = await fetch(`${API_BASE}/api/leads/${agentId}/${leadId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                body: JSON.stringify(editForm)
            });
            if (res.ok) {
                setEditingLead(null);
                await fetchLeads();
                await fetchStats();
                toast.success('Lead updated');
            } else {
                toast.error('Save failed');
            }
        } catch (err) {
            console.error('Error saving lead:', err);
            toast.error('Connection error');
        }
    };

    const deleteLead = async (leadId: string) => {
        if (!confirm('Delete this lead?')) return;
        try {
            const res = await fetch(`${API_BASE}/api/leads/${agentId}/${leadId}`, {
                method: 'DELETE',
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (res.ok) { await fetchLeads(); await fetchStats(); toast.success('Lead deleted'); }
            else { toast.error('Delete failed'); }
        } catch (err) {
            console.error('Error deleting lead:', err);
            toast.error('Connection error');
        }
    };

    const addLead = async () => {
        try {
            const res = await fetch(`${API_BASE}/api/leads`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                body: JSON.stringify({ agentId, source: 'manual', ...addForm })
            });
            if (res.ok) {
                setShowAddForm(false);
                setAddForm({ name: '', email: '', phone: '', company: '', interest: '', notes: '' });
                await fetchLeads();
                await fetchStats();
                toast.success('Lead added');
            } else {
                toast.error('Failed to add lead');
            }
        } catch (err) {
            console.error('Error adding lead:', err);
            toast.error('Connection error');
        }
    };

    const exportCSV = async () => {
        try {
            const res = await fetch(`${API_BASE}/api/leads/export/${agentId}`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (!res.ok) { toast.error('Export failed'); return; }
            const blob = await res.blob();
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `leads_${new Date().toISOString().slice(0, 10)}.csv`;
            a.click();
            URL.revokeObjectURL(url);
            toast.success('CSV exported');
        } catch {
            toast.error('Export failed', 'Could not reach server');
        }
    };

    const exportPDF = () => {
        const win = window.open('', '_blank', 'width=900,height=700');
        if (!win) { toast.error('Popup blocked', 'Allow popups to export PDF'); return; }
        const rows = leads.map(l => `
            <tr>
                <td>${l.name || '-'}</td>
                <td>${l.email || '-'}</td>
                <td>${l.phone || '-'}</td>
                <td>${l.company || '-'}</td>
                <td>${l.status}</td>
                <td>${l.score}</td>
                <td>${l.channel}</td>
                <td>${l.source === 'auto' ? 'AI' : 'Manual'}</td>
                <td>${new Date(l.createdAt).toLocaleDateString()}</td>
            </tr>`).join('');
        const html = `<!DOCTYPE html><html><head><title>Leads Report</title>
        <style>
            body{font-family:Arial,sans-serif;margin:24px;color:#111}
            h1{color:#059669;font-size:20px;margin-bottom:4px}
            .meta{color:#6b7280;font-size:12px;margin-bottom:16px}
            table{width:100%;border-collapse:collapse;font-size:12px}
            th{background:#f0fdf4;padding:8px;text-align:left;border-bottom:2px solid #d1fae5;color:#065f46}
            td{padding:7px 8px;border-bottom:1px solid #f3f4f6}
            tr:nth-child(even) td{background:#f9fafb}
            .stats{display:flex;gap:16px;margin-bottom:16px}
            .stat{border:1px solid #e5e7eb;border-radius:8px;padding:10px 16px;text-align:center}
            .stat-val{font-size:22px;font-weight:700;color:#059669}
            .stat-lbl{font-size:11px;color:#6b7280;margin-top:2px}
            @media print{body{margin:0}}
        </style></head><body>
        <h1>Leads Report</h1>
        <div class="meta">Exported ${new Date().toLocaleString()} &nbsp;·&nbsp; Showing ${leads.length} lead(s) (current filter)</div>
        ${stats ? `<div class="stats">
            <div class="stat"><div class="stat-val">${stats.totalLeads}</div><div class="stat-lbl">Total</div></div>
            <div class="stat"><div class="stat-val">${stats.todayLeads}</div><div class="stat-lbl">Today</div></div>
            <div class="stat"><div class="stat-val">${stats.avgScore}</div><div class="stat-lbl">Avg Score</div></div>
            <div class="stat"><div class="stat-val">${stats.conversionRate}%</div><div class="stat-lbl">Conversion</div></div>
        </div>` : ''}
        <table><thead><tr>
            <th>Name</th><th>Email</th><th>Phone</th><th>Company</th>
            <th>Status</th><th>Score</th><th>Channel</th><th>Source</th><th>Created</th>
        </tr></thead><tbody>${rows}</tbody></table>
        <script>window.onload=()=>window.print()</script>
        </body></html>`;
        win.document.write(html);
        win.document.close();
    };

    const getNextStatus = (currentStatus: string): string | null => {
        const idx = STATUS_FLOW.indexOf(currentStatus);
        if (idx === -1 || idx >= STATUS_FLOW.length - 1) return null;
        return STATUS_FLOW[idx + 1];
    };

    const formatDate = (dateStr: string) => {
        const d = new Date(dateStr);
        const now = new Date();
        const diffMs = now.getTime() - d.getTime();
        const diffMin = Math.floor(diffMs / 60000);
        if (diffMin < 1) return 'Just now';
        if (diffMin < 60) return `${diffMin}m ago`;
        if (diffMin < 1440) return `${Math.floor(diffMin / 60)}h ago`;
        return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    };

    if (loading) {
        return <LeadsPageSkeleton />;
    }

    return (
        <AnimatedPage className="bg-white pb-12">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
                <PageBackNav to="/dashboard" label="Back to Dashboard" />
                <div className="flex items-center justify-between mb-8">
                    <div>
                        <h1 className="text-3xl font-bold text-ocean-navy flex items-center gap-2">
                            <Users className="h-8 w-8 text-emerald-600" />
                            Leads
                        </h1>
                        <p className="text-ocean-deep/80 mt-1">Customer leads captured by your AI agent</p>
                    </div>
                    <div className="flex items-center gap-2 flex-wrap">
                        <button
                            onClick={() => setShowAddForm(true)}
                            className="flex items-center px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 text-sm font-medium shadow-sm"
                        >
                            <UserPlus className="h-4 w-4 mr-1.5" /> Add Lead
                        </button>
                        <button
                            onClick={exportCSV}
                            className="flex items-center px-3 py-2 bg-white border border-ocean-ice rounded-lg hover:bg-ocean-powder text-sm font-medium text-ocean-deep"
                            title="Export all leads as CSV"
                        >
                            <Download className="h-4 w-4 mr-1.5 text-emerald-600" /> CSV
                        </button>
                        <button
                            onClick={exportPDF}
                            className="flex items-center px-3 py-2 bg-white border border-ocean-ice rounded-lg hover:bg-ocean-powder text-sm font-medium text-ocean-deep"
                            title="Export current view as PDF"
                        >
                            <FileText className="h-4 w-4 mr-1.5 text-rose-500" /> PDF
                        </button>
                        <button
                            onClick={() => { fetchLeads(); fetchStats(); }}
                            className="flex items-center px-3 py-2 bg-white border border-ocean-ice rounded-lg hover:bg-ocean-powder text-sm font-medium text-ocean-deep"
                        >
                            <RefreshCw className="h-4 w-4 mr-1.5" /> Refresh
                        </button>
                    </div>
                </div>

                {/* Stats Cards */}
                {stats && (
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
                        <StatCard title="Total Leads" value={stats.totalLeads} icon={<Users className="h-5 w-5" />} gradient="from-emerald-500 to-teal-500" />
                        <StatCard title="Today" value={stats.todayLeads} icon={<UserPlus className="h-5 w-5" />} gradient="from-blue-500 to-cyan-500" />
                        <StatCard title="This Week" value={stats.weekLeads} icon={<TrendingUp className="h-5 w-5" />} gradient="from-ocean-deep to-ocean-rich" />
                        <StatCard title="Conversion" value={`${stats.conversionRate}%`} icon={<Target className="h-5 w-5" />} gradient="from-green-500 to-emerald-500" />
                    </div>
                )}

                {/* Search + Filters */}
                <div className="flex gap-3 mb-6 flex-wrap items-center">
                    <div className="relative flex-1 min-w-[200px] max-w-sm">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-ocean-deep/60" />
                        <input
                            type="text"
                            placeholder="Search leads..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="w-full pl-9 pr-4 py-2 border border-ocean-ice rounded-lg text-sm focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
                        />
                    </div>
                    <div className="flex gap-2 flex-wrap">
                        {['all', ...Object.keys(STATUS_CONFIG)].map((status) => {
                            const config = status === 'all' ? null : STATUS_CONFIG[status];
                            const count = status === 'all' ? (stats?.totalLeads || 0) : (stats?.byStatus?.[status] || 0);
                            return (
                                <button
                                    key={status}
                                    onClick={() => setStatusFilter(status)}
                                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                                        statusFilter === status
                                            ? 'bg-emerald-600 text-white shadow-md'
                                            : 'bg-white text-ocean-deep/90 border border-ocean-ice hover:bg-ocean-powder'
                                    }`}
                                >
                                    {status === 'all' ? 'All' : config?.label} ({count})
                                </button>
                            );
                        })}
                    </div>
                </div>

                {/* Add Lead Modal */}
                {showAddForm && (
                    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
                        <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-6">
                            <h3 className="text-lg font-bold text-ocean-navy mb-4 flex items-center gap-2">
                                <UserPlus className="h-5 w-5 text-emerald-600" /> Add Lead Manually
                            </h3>
                            <div className="space-y-3">
                                <input placeholder="Name" value={addForm.name} onChange={(e) => setAddForm({ ...addForm, name: e.target.value })}
                                    className="w-full px-3 py-2 border border-ocean-ice rounded-lg text-sm" />
                                <input placeholder="Email" value={addForm.email} onChange={(e) => setAddForm({ ...addForm, email: e.target.value })}
                                    className="w-full px-3 py-2 border border-ocean-ice rounded-lg text-sm" />
                                <input placeholder="Phone" value={addForm.phone} onChange={(e) => setAddForm({ ...addForm, phone: e.target.value })}
                                    className="w-full px-3 py-2 border border-ocean-ice rounded-lg text-sm" />
                                <input placeholder="Company" value={addForm.company} onChange={(e) => setAddForm({ ...addForm, company: e.target.value })}
                                    className="w-full px-3 py-2 border border-ocean-ice rounded-lg text-sm" />
                                <input placeholder="Interest / Inquiry" value={addForm.interest} onChange={(e) => setAddForm({ ...addForm, interest: e.target.value })}
                                    className="w-full px-3 py-2 border border-ocean-ice rounded-lg text-sm" />
                                <textarea placeholder="Notes" value={addForm.notes} onChange={(e) => setAddForm({ ...addForm, notes: e.target.value })}
                                    className="w-full px-3 py-2 border border-ocean-ice rounded-lg text-sm" rows={2} />
                            </div>
                            <div className="flex gap-3 mt-5">
                                <button onClick={() => setShowAddForm(false)} className="flex-1 px-4 py-2 border border-ocean-ice rounded-lg text-sm font-medium text-ocean-deep hover:bg-ocean-powder">Cancel</button>
                                <button onClick={addLead} className="flex-1 px-4 py-2 bg-emerald-600 text-white rounded-lg text-sm font-medium hover:bg-emerald-700">Add Lead</button>
                            </div>
                        </div>
                    </div>
                )}

                {/* Leads List */}
                {leads.length === 0 ? (
                    <div className="text-center py-20 bg-white rounded-2xl border border-ocean-ice/80">
                        <Users className="h-16 w-16 text-gray-300 mx-auto mb-4" />
                        <h3 className="text-xl font-semibold text-ocean-navy mb-2">No leads yet</h3>
                        <p className="text-ocean-deep/80 mb-4">Leads captured by your AI agent from conversations will appear here.</p>
                        <button onClick={() => setShowAddForm(true)} className="px-4 py-2 bg-emerald-600 text-white rounded-lg text-sm font-medium hover:bg-emerald-700">
                            <UserPlus className="h-4 w-4 inline mr-1" /> Add Lead Manually
                        </button>
                    </div>
                ) : (
                    <motion.div className="space-y-3" initial="hidden" animate="show" variants={listStagger}>
                        {leads.map((lead) => {
                            const statusCfg = STATUS_CONFIG[lead.status] || STATUS_CONFIG.new;
                            const isExpanded = expandedLead === lead._id;
                            const isEditing = editingLead === lead._id;
                            const nextStatus = getNextStatus(lead.status);

                            return (
                                <motion.div key={lead._id} variants={listItemEnter} className="bg-white rounded-xl border border-ocean-ice shadow-sm hover:shadow-md transition-all overflow-hidden">
                                    {/* Lead Header */}
                                    <div className="flex items-center justify-between p-4 cursor-pointer" onClick={() => setExpandedLead(isExpanded ? null : lead._id)}>
                                        <div className="flex items-center gap-4 flex-1 min-w-0">
                                            <div className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold ${
                                                lead.score >= 70 ? 'bg-green-100 text-green-700' :
                                                lead.score >= 40 ? 'bg-amber-100 text-amber-700' :
                                                'bg-ocean-mist/50 text-ocean-deep/90'
                                            }`}>
                                                {lead.name ? lead.name[0].toUpperCase() : '?'}
                                            </div>
                                            <div className="min-w-0">
                                                <div className="flex items-center gap-2 flex-wrap">
                                                    <span className="font-semibold text-ocean-navy truncate">
                                                        {lead.name || 'Unknown'}
                                                    </span>
                                                    <span className={`text-xs px-2 py-0.5 rounded-full border ${statusCfg.bg} ${statusCfg.color}`}>
                                                        {statusCfg.label}
                                                    </span>
                                                    <ScoreBadge score={lead.score} />
                                                    {lead.source === 'auto' && (
                                                        <span className="text-xs px-1.5 py-0.5 rounded-full bg-ocean-powder text-ocean-deep flex items-center gap-0.5">
                                                            <Sparkles className="h-3 w-3" /> AI
                                                        </span>
                                                    )}
                                                    <span className={`text-xs px-2 py-0.5 rounded-full ${
                                                        lead.channel === 'voice' ? 'bg-purple-50 text-purple-700' : 'bg-blue-50 text-blue-700'
                                                    }`}>
                                                        {lead.channel === 'voice' ? 'Voice' : 'Chat'}
                                                    </span>
                                                </div>
                                                <div className="text-xs text-ocean-deep/80 mt-0.5 flex gap-3 flex-wrap">
                                                    {lead.email && <span className="flex items-center gap-1"><Mail className="h-3 w-3" />{lead.email}</span>}
                                                    {lead.phone && <span className="flex items-center gap-1"><Phone className="h-3 w-3" />{lead.phone}</span>}
                                                    {lead.company && <span className="flex items-center gap-1"><Building2 className="h-3 w-3" />{lead.company}</span>}
                                                    <span className="flex items-center gap-1"><Calendar className="h-3 w-3" />{formatDate(lead.createdAt)}</span>
                                                </div>
                                            </div>
                                        </div>

                                        <div className="flex items-center gap-2 ml-4">
                                            {nextStatus && lead.status !== 'lost' && (
                                                <button
                                                    onClick={(e) => { e.stopPropagation(); updateStatus(lead._id, nextStatus); }}
                                                    disabled={updatingStatus === lead._id}
                                                    className="px-3 py-1.5 bg-emerald-600 text-white text-xs rounded-lg hover:bg-emerald-700 disabled:opacity-50"
                                                >
                                                    {updatingStatus === lead._id ? <Loader2 className="h-3 w-3 animate-spin" /> : `→ ${STATUS_CONFIG[nextStatus]?.label}`}
                                                </button>
                                            )}
                                            {lead.status === 'new' && (
                                                <button
                                                    onClick={(e) => { e.stopPropagation(); updateStatus(lead._id, 'lost'); }}
                                                    className="px-2 py-1.5 bg-red-50 text-red-500 text-xs rounded-lg hover:bg-red-100"
                                                >Lost</button>
                                            )}
                                            <ChevronDown className={`h-4 w-4 text-ocean-deep/60 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                                        </div>
                                    </div>

                                    {/* Expanded Details */}
                                    {isExpanded && (
                                        <div className="border-t border-ocean-ice/80 p-5 bg-ocean-powder/80">
                                            {isEditing ? (
                                                <div className="space-y-3 max-w-lg">
                                                    <div className="grid grid-cols-2 gap-3">
                                                        <input placeholder="Name" value={editForm.name || ''} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                                                            className="px-3 py-2 border border-ocean-ice rounded-lg text-sm" />
                                                        <input placeholder="Email" value={editForm.email || ''} onChange={(e) => setEditForm({ ...editForm, email: e.target.value })}
                                                            className="px-3 py-2 border border-ocean-ice rounded-lg text-sm" />
                                                        <input placeholder="Phone" value={editForm.phone || ''} onChange={(e) => setEditForm({ ...editForm, phone: e.target.value })}
                                                            className="px-3 py-2 border border-ocean-ice rounded-lg text-sm" />
                                                        <input placeholder="Company" value={editForm.company || ''} onChange={(e) => setEditForm({ ...editForm, company: e.target.value })}
                                                            className="px-3 py-2 border border-ocean-ice rounded-lg text-sm" />
                                                    </div>
                                                    <input placeholder="Interest" value={editForm.interest || ''} onChange={(e) => setEditForm({ ...editForm, interest: e.target.value })}
                                                        className="w-full px-3 py-2 border border-ocean-ice rounded-lg text-sm" />
                                                    <textarea placeholder="Notes" value={editForm.notes || ''} onChange={(e) => setEditForm({ ...editForm, notes: e.target.value })}
                                                        className="w-full px-3 py-2 border border-ocean-ice rounded-lg text-sm" rows={2} />
                                                    <div className="flex gap-2">
                                                        <button onClick={() => saveLead(lead._id)} className="px-3 py-1.5 bg-emerald-600 text-white text-sm rounded-lg hover:bg-emerald-700 flex items-center gap-1">
                                                            <Check className="h-3.5 w-3.5" /> Save
                                                        </button>
                                                        <button onClick={() => setEditingLead(null)} className="px-3 py-1.5 border border-ocean-ice text-sm rounded-lg hover:bg-ocean-powder flex items-center gap-1">
                                                            <X className="h-3.5 w-3.5" /> Cancel
                                                        </button>
                                                    </div>
                                                </div>
                                            ) : (
                                                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                                    <div>
                                                        <h4 className="text-sm font-semibold text-ocean-deep mb-3">Contact Details</h4>
                                                        <div className="space-y-2 bg-white p-4 rounded-lg border border-ocean-ice/80">
                                                            <InfoRow icon={<Users className="h-4 w-4" />} label="Name" value={lead.name} />
                                                            <InfoRow icon={<Mail className="h-4 w-4" />} label="Email" value={lead.email} />
                                                            <InfoRow icon={<Phone className="h-4 w-4" />} label="Phone" value={lead.phone} />
                                                            <InfoRow icon={<Building2 className="h-4 w-4" />} label="Company" value={lead.company} />
                                                        </div>

                                                        {lead.interest && (
                                                            <div className="mt-3">
                                                                <h4 className="text-sm font-semibold text-ocean-deep mb-2">Interest</h4>
                                                                <p className="text-sm bg-white p-3 rounded-lg border border-ocean-ice/80 text-ocean-deep">{lead.interest}</p>
                                                            </div>
                                                        )}

                                                        {lead.notes && (
                                                            <div className="mt-3">
                                                                <h4 className="text-sm font-semibold text-ocean-deep mb-2">Notes</h4>
                                                                <p className="text-sm bg-white p-3 rounded-lg border border-ocean-ice/80 text-ocean-deep/90">{lead.notes}</p>
                                                            </div>
                                                        )}
                                                    </div>
                                                    <div>
                                                        <h4 className="text-sm font-semibold text-ocean-deep mb-3">Details</h4>
                                                        <div className="text-xs text-ocean-deep/80 space-y-1.5 bg-white p-4 rounded-lg border border-ocean-ice/80">
                                                            <div>Source: <span className="font-medium">{lead.source === 'auto' ? 'AI Captured' : 'Manual'}</span></div>
                                                            <div>Channel: <span className="font-medium capitalize">{lead.channel}</span></div>
                                                            <div>Score: <ScoreBadge score={lead.score} /></div>
                                                            <div>Session: <span className="font-mono">{lead.sessionId}</span></div>
                                                            <div>Created: {new Date(lead.createdAt).toLocaleString()}</div>
                                                            <div>Last Activity: {new Date(lead.lastActivity).toLocaleString()}</div>
                                                            {lead.tags.length > 0 && (
                                                                <div className="flex gap-1 flex-wrap mt-2">
                                                                    {lead.tags.map((tag, i) => (
                                                                        <span key={i} className="px-2 py-0.5 bg-ocean-mist/50 text-ocean-deep/90 rounded-full text-[10px]">{tag}</span>
                                                                    ))}
                                                                </div>
                                                            )}
                                                        </div>

                                                        <div className="flex gap-2 mt-4">
                                                            <button
                                                                onClick={() => { setEditingLead(lead._id); setEditForm({ name: lead.name, email: lead.email, phone: lead.phone, company: lead.company, interest: lead.interest, notes: lead.notes }); }}
                                                                className="px-3 py-1.5 bg-ocean-mist/50 text-ocean-deep text-sm rounded-lg hover:bg-ocean-ice flex items-center gap-1"
                                                            >
                                                                <Edit3 className="h-3.5 w-3.5" /> Edit
                                                            </button>
                                                            <button
                                                                onClick={() => deleteLead(lead._id)}
                                                                className="px-3 py-1.5 bg-red-50 text-red-600 text-sm rounded-lg hover:bg-red-100 flex items-center gap-1"
                                                            >
                                                                <Trash2 className="h-3.5 w-3.5" /> Delete
                                                            </button>
                                                        </div>
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </motion.div>
                            );
                        })}
                    </motion.div>
                )}
            </div>
        </AnimatedPage>
    );
}

function InfoRow({ icon, label, value }: { icon: React.ReactNode; label: string; value?: string }) {
    return (
        <div className="flex items-center gap-2 text-sm">
            <span className="text-ocean-deep/60">{icon}</span>
            <span className="text-ocean-deep/80 w-16">{label}:</span>
            <span className={value ? 'text-ocean-navy' : 'text-gray-300 italic'}>{value || 'Not provided'}</span>
        </div>
    );
}

function StatCard({ title, value, icon, gradient }: { title: string; value: string | number; icon: React.ReactNode; gradient: string }) {
    return (
        <div className="bg-white rounded-xl border border-ocean-ice/80 p-4 shadow-sm">
            <div className="flex items-center justify-between mb-2">
                <div className={`p-2 rounded-lg bg-gradient-to-r ${gradient}`}>
                    <div className="text-white">{icon}</div>
                </div>
            </div>
            <p className="text-xs text-ocean-deep/80">{title}</p>
            <p className="text-2xl font-bold text-ocean-navy mt-0.5">{value}</p>
        </div>
    );
}
