import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { fireWelcomeToast } from '../components/Toast';
import { DashboardSkeleton } from '../components/skeletons';
import {
    MessageSquare, Edit2, Trash2, Plus, Bot, TrendingUp,
    Mic, CreditCard, AlertTriangle, Zap, Phone, PhoneCall,
    ShoppingBag, Users, BarChart3, Radio, BookOpen, Link2,
    Globe, Lock, GripVertical, Package,
} from 'lucide-react';
import { motion } from 'framer-motion';
import CatalogModal from '../components/CatalogModal';
import {
    DndContext,
    closestCenter,
    PointerSensor,
    TouchSensor,
    useSensor,
    useSensors,
    type DragEndEvent,
} from '@dnd-kit/core';
import {
    SortableContext,
    useSortable,
    rectSortingStrategy,
    arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import VoiceTestPanel from '../components/VoiceTestPanel';
import { useToast } from '../components/Toast';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3000';

interface Agent {
    _id: string;
    name: string;
    type: 'chat' | 'voice';
    tone: string;
    language: string;
    currency?: string;
    prompt: string;
    persona?: { name?: string; summary?: string; speakingStyle?: string };
    phoneNumber?: string;
    callDirection?: 'inbound' | 'outbound';
    outboundCallerId?: string;
    sttProvider?: 'twilio' | 'google';
    ttsProvider?: 'twilio' | 'google';
    ttsVoice?: string;
}

interface SubscriptionData {
    subscription: {
        plan: string;
        status: string;
        currentPeriodEnd: string;
        cancelAtPeriodEnd: boolean;
    };
    usage: {
        agents: { used: number; limit: number };
        documents: { used: number; limit: number };
        messages: { used: number; limit: number };
    };
    features: {
        voiceEnabled: boolean;
        analyticsEnabled: boolean;
        prioritySupport: boolean;
        maxDocumentSizeMB: number;
    };
}

const AGENT_ORDER_KEY = (uid: string) => `elva_agent_order_${uid}`;

export default function Dashboard() {
    const { token, user, welcomeUser, clearWelcome } = useAuth();
    const isAdmin = user?.role === 'business_admin';
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const [agents, setAgents] = useState<Agent[]>([]);
    const [orderedAgents, setOrderedAgents] = useState<Agent[]>([]);

    const sensors = useSensors(
        useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
        useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 5 } }),
    );

    // Apply persisted sort order whenever raw agents list changes
    useEffect(() => {
        if (!agents.length) { setOrderedAgents([]); return; }
        const key = user ? AGENT_ORDER_KEY(user.id) : null;
        const saved = key ? localStorage.getItem(key) : null;
        if (saved) {
            try {
                const ids = JSON.parse(saved) as string[];
                const sorted = ids.map(id => agents.find(a => a._id === id)).filter(Boolean) as Agent[];
                const unseen = agents.filter(a => !ids.includes(a._id));
                setOrderedAgents([...sorted, ...unseen]);
                return;
            } catch { /* fall through */ }
        }
        setOrderedAgents(agents);
    }, [agents, user]);

    const handleDragEnd = (event: DragEndEvent) => {
        const { active, over } = event;
        if (!over || active.id === over.id) return;
        setOrderedAgents(prev => {
            const oldIdx = prev.findIndex(a => a._id === active.id);
            const newIdx = prev.findIndex(a => a._id === over.id);
            const next = arrayMove(prev, oldIdx, newIdx);
            if (user) localStorage.setItem(AGENT_ORDER_KEY(user.id), JSON.stringify(next.map(a => a._id)));
            return next;
        });
    };
    const [loading, setLoading] = useState(true);
    const [deleteTarget, setDeleteTarget] = useState<Agent | null>(null);
    const [deleteTypeName, setDeleteTypeName] = useState('');
    const [subscriptionData, setSubscriptionData] = useState<SubscriptionData | null>(null);
    const [limitError, setLimitError] = useState<string | null>(null);
    const [testCallAgent, setTestCallAgent] = useState<Agent | null>(null);
    const [testCallAutoStart, setTestCallAutoStart] = useState(false);
    const [deleting, setDeleting] = useState(false);
    const [notifications, setNotifications] = useState<Record<string, { orders: number; leads: number }>>({});
    const [catalogAgent, setCatalogAgent] = useState<Agent | null>(null);
    const [setupMenuAgentId, setSetupMenuAgentId] = useState<string | null>(null);
    const [pendingCatalogId, setPendingCatalogId] = useState<string | null>(null);
    const toast = useToast();

    useEffect(() => {
        const setupMenu = searchParams.get('setupMenu');
        const openCatalog = searchParams.get('catalog');
        if (setupMenu) {
            setSetupMenuAgentId(setupMenu);
            window.setTimeout(() => setSetupMenuAgentId(null), 12000);
        }
        if (openCatalog) {
            setPendingCatalogId(openCatalog);
        }
        if (setupMenu || openCatalog) {
            navigate('/dashboard', { replace: true });
        }
    }, [searchParams, navigate]);

    useEffect(() => {
        if (!pendingCatalogId || !agents.length) return;
        const target = agents.find((a) => a._id === pendingCatalogId);
        if (target) setCatalogAgent(target);
        setPendingCatalogId(null);
    }, [pendingCatalogId, agents]);

    useEffect(() => {
        const sessionId = searchParams.get('session_id');
        if (sessionId) navigate(`/payment-success?session_id=${sessionId}`);
    }, [searchParams, navigate]);

    const fetchNotifications = async () => {
        try {
            const res = await fetch(`${API_BASE}/api/dashboard/notifications`, {
                headers: { Authorization: `Bearer ${token}` },
            });
            if (res.ok) setNotifications(await res.json());
        } catch (err) {
            console.error('Error fetching notifications:', err);
        }
    };

    // Fire welcome toast exactly once per login/switch, even under React StrictMode.
    // StrictMode runs effects twice (mount → cleanup → remount) in development.
    // The ref persists across both invocations, so the second run is a no-op.
    const welcomeFiredRef = useRef(false);
    useEffect(() => {
        if (!welcomeUser) {
            welcomeFiredRef.current = false; // reset for the next account switch
            return;
        }
        if (welcomeFiredRef.current) return; // StrictMode second invocation — skip
        welcomeFiredRef.current = true;
        fireWelcomeToast(welcomeUser.name, welcomeUser.email);
        clearWelcome();
    }, [welcomeUser, clearWelcome]);

    useEffect(() => {
        fetchAgents();
        fetchSubscription();
        fetchNotifications();
        const interval = setInterval(fetchNotifications, 30000);
        return () => clearInterval(interval);
    }, []);

    const fetchAgents = async () => {
        try {
            const response = await fetch(`${API_BASE}/api/agents`, {
                headers: { Authorization: `Bearer ${token}` },
            });
            if (response.ok) {
                setAgents(await response.json());
            } else {
                toast.error('Failed to load agents');
            }
        } catch (error) {
            console.error('Error fetching agents:', error);
            toast.error('Connection error', 'Could not load agents');
        } finally {
            setLoading(false);
        }
    };

    const fetchSubscription = async () => {
        try {
            const response = await fetch(`${API_BASE}/api/subscription/current`, {
                headers: { Authorization: `Bearer ${token}` },
            });
            if (response.ok) setSubscriptionData(await response.json());
        } catch (error) {
            console.error('Error fetching subscription:', error);
        }
    };

    const handleDelete = async (agentId: string) => {
        setDeleting(true);
        try {
            const response = await fetch(`${API_BASE}/api/agents/${agentId}`, {
                method: 'DELETE',
                headers: { Authorization: `Bearer ${token}` },
            });
            if (response.ok) {
                fetchAgents();
                fetchSubscription();
                setDeleteTarget(null);
                setDeleteTypeName('');
                toast.success('Agent deleted');
            } else {
                toast.error('Failed to delete agent');
            }
        } catch (error) {
            console.error('Error deleting agent:', error);
            toast.error('Error deleting agent');
        } finally {
            setDeleting(false);
        }
    };

    const handleCreateAgent = () => {
        if (subscriptionData) {
            const { usage } = subscriptionData;
            if (usage.agents.limit !== -1 && usage.agents.used >= usage.agents.limit) {
                setLimitError('You have reached your agent limit. Please upgrade your plan to create more agents.');
                return;
            }
        }
        navigate('/create-agent');
    };

    const handleManageBilling = async () => {
        try {
            const response = await fetch(`${API_BASE}/api/subscription/create-portal`, {
                method: 'POST',
                headers: { Authorization: `Bearer ${token}` },
            });
            const data = await response.json();
            if (response.ok && data.url) {
                window.open(data.url, '_blank', 'noopener,noreferrer');
            } else {
                navigate('/subscription');
            }
        } catch {
            navigate('/subscription');
        }
    };

    const chatAgents = agents.filter(a => a.type === 'chat').length;
    const voiceAgents = agents.filter(a => a.type === 'voice').length;
    const totalAgents = agents.length;

    const formatLimit = (limit: number) => (limit === -1 ? '∞' : limit);
    const getUsagePct = (used: number, limit: number) =>
        limit === -1 ? 0 : Math.min((used / limit) * 100, 100);

    if (loading) {
        return <DashboardSkeleton />;
    }

    return (
        <motion.div
            className="p-6 max-w-7xl mx-auto space-y-5"
            initial="hidden"
            animate="show"
            variants={{ hidden: {}, show: { transition: { staggerChildren: 0.06 } } }}
        >
            {/* ── Page header ─────────────────────────────────────────── */}
            <motion.div
                className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4"
                variants={{ hidden: { opacity: 0, y: 12 }, show: { opacity: 1, y: 0, transition: { duration: 0.45, ease: [0.22, 1, 0.36, 1] } } }}
            >
                <div>
                    <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Dashboard</h1>
                    <p className="text-sm text-slate-500 mt-0.5">
                        Manage and monitor your AI-powered agents.
                    </p>
                </div>
                {isAdmin && (
                    <button
                        onClick={handleCreateAgent}
                        className="inline-flex items-center gap-2 px-5 py-2.5 bg-ocean-navy text-white rounded-xl text-sm font-semibold hover:bg-ocean-deep transition-all duration-200 shadow-sm hover:shadow-md active:scale-[0.97] shrink-0"
                    >
                        <Plus className="h-4 w-4 shrink-0" aria-hidden />
                        New Agent
                    </button>
                )}
            </motion.div>

            {/* ── Limit error ──────────────────────────────────────────── */}
            {limitError && (
                <motion.div
                    className="flex items-center justify-between gap-4 p-4 bg-amber-50 border border-amber-200 rounded-xl"
                    initial={{ opacity: 0, y: -8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -8 }}
                    transition={{ duration: 0.3 }}
                >
                    <div className="flex items-center gap-3 text-amber-800 text-sm">
                        <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />
                        <span>{limitError}</span>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                        {isAdmin && (
                            <button
                                onClick={() => navigate('/subscription')}
                                className="px-3 py-1.5 bg-amber-600 text-white rounded-lg hover:bg-amber-700 transition-colors text-xs font-semibold active:scale-[0.97]"
                            >
                                Upgrade Plan
                            </button>
                        )}
                        <button
                            onClick={() => setLimitError(null)}
                            className="px-3 py-1.5 text-amber-700 hover:bg-amber-100 rounded-lg transition-colors text-xs font-medium"
                        >
                            Dismiss
                        </button>
                    </div>
                </motion.div>
            )}

            {/* ── Stat cards ───────────────────────────────────────────── */}
            <motion.div
                className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4"
                variants={{ hidden: {}, show: { transition: { staggerChildren: 0.07 } } }}
            >
                {[
                    {
                        title: 'Total Agents',
                        value: `${totalAgents}`,
                        sub: subscriptionData ? `of ${formatLimit(subscriptionData.usage.agents.limit)}` : undefined,
                        icon: <Bot className="h-5 w-5" />,
                        iconBg: 'bg-ocean-sky',
                        pct: subscriptionData ? getUsagePct(totalAgents, subscriptionData.usage.agents.limit) : 0,
                    },
                    {
                        title: 'Chat Agents',
                        value: `${chatAgents}`,
                        icon: <MessageSquare className="h-5 w-5" />,
                        iconBg: 'bg-ocean-bright',
                    },
                    {
                        title: 'Voice Agents',
                        value: `${voiceAgents}`,
                        icon: <Mic className="h-5 w-5" />,
                        iconBg: 'bg-ocean-rich',
                        locked: !!subscriptionData && !subscriptionData.features.voiceEnabled,
                    },
                    {
                        title: 'Messages Used',
                        value: subscriptionData ? subscriptionData.usage.messages.used.toLocaleString() : '0',
                        sub: subscriptionData ? `of ${formatLimit(subscriptionData.usage.messages.limit)}` : undefined,
                        icon: <TrendingUp className="h-5 w-5" />,
                        iconBg: 'bg-ocean-deep',
                        pct: subscriptionData ? getUsagePct(subscriptionData.usage.messages.used, subscriptionData.usage.messages.limit) : 0,
                    },
                ].map(card => (
                    <StatCard key={card.title} {...card} />
                ))}
            </motion.div>

            {/* ── Subscription banner ──────────────────────────────────── */}
            {subscriptionData && (
                <motion.div
                    className="bg-white rounded-xl border border-slate-200/80 p-4"
                    style={{ boxShadow: '0 2px 8px -2px rgba(0,0,0,0.07), 0 1px 2px -1px rgba(0,0,0,0.05)' }}
                    variants={{ hidden: { opacity: 0, y: 14 }, show: { opacity: 1, y: 0, transition: { duration: 0.45, ease: [0.22, 1, 0.36, 1] } } }}
                    whileHover={{ y: -4, boxShadow: '0 10px 28px -5px rgba(0,0,0,0.11), 0 4px 10px -3px rgba(0,0,0,0.07)', transition: { type: 'spring', stiffness: 320, damping: 22 } }}
                >
                    <div className="flex flex-wrap items-center gap-4 justify-between">
                        <div className="flex items-center gap-3">
                            <div className={`p-2 rounded-lg ${subscriptionData.subscription.plan === 'enterprise' ? 'bg-amber-50' : 'bg-ocean-powder'}`}>
                                <Zap className={`h-4 w-4 ${subscriptionData.subscription.plan === 'enterprise' ? 'text-amber-600' : 'text-ocean-deep'}`} aria-hidden />
                            </div>
                            <div>
                                <p className="text-sm font-semibold text-slate-900 capitalize">
                                    {subscriptionData.subscription.plan} Plan
                                    {subscriptionData.subscription.cancelAtPeriodEnd && (
                                        <span className="ml-2 text-xs font-medium text-red-500">(Canceling)</span>
                                    )}
                                </p>
                                {subscriptionData.subscription.currentPeriodEnd && subscriptionData.subscription.plan !== 'free' && (
                                    <p className="text-[11px] text-slate-400 mt-0.5">
                                        Renews {new Date(subscriptionData.subscription.currentPeriodEnd).toLocaleDateString()}
                                    </p>
                                )}
                            </div>
                        </div>

                        <div className="flex flex-wrap items-center gap-5">
                            <UsageBar label="Agents" used={subscriptionData.usage.agents.used} limit={subscriptionData.usage.agents.limit} />
                            <UsageBar label="Docs" used={subscriptionData.usage.documents.used} limit={subscriptionData.usage.documents.limit} />
                            <UsageBar label="Messages" used={subscriptionData.usage.messages.used} limit={subscriptionData.usage.messages.limit} />

                            <div className="flex items-center gap-2">
                                {isAdmin && subscriptionData.subscription.plan !== 'enterprise' && (
                                    <button
                                        onClick={() => navigate('/subscription')}
                                        className="px-4 py-2 bg-ocean-navy text-white rounded-xl hover:bg-ocean-deep transition-all duration-200 text-xs font-semibold shadow-sm hover:shadow active:scale-[0.97]"
                                    >
                                        {subscriptionData.subscription.plan === 'free' ? 'Upgrade Plan' : 'Change Plan'}
                                    </button>
                                )}
                                <button
                                    onClick={handleManageBilling}
                                    className="inline-flex items-center gap-1.5 px-4 py-2 bg-slate-50 border border-slate-200 text-slate-700 rounded-xl hover:bg-slate-100 hover:border-slate-300 transition-all duration-200 text-xs font-semibold active:scale-[0.97]"
                                >
                                    <CreditCard className="h-3.5 w-3.5" aria-hidden />
                                    Billing
                                </button>
                            </div>
                        </div>
                    </div>
                </motion.div>
            )}

            {/* ── Agents section ───────────────────────────────────────── */}
            <motion.div
                className="bg-white rounded-xl border border-slate-200 shadow-sm"
                variants={{ hidden: { opacity: 0, y: 16 }, show: { opacity: 1, y: 0, transition: { duration: 0.5, ease: [0.22, 1, 0.36, 1] } } }}
            >
                {/* Section header */}
                <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
                    <div>
                        <h2 className="text-sm font-semibold text-slate-900">Your Agents</h2>
                        <p className="text-[11px] text-slate-400 mt-0.5">
                            {agents.length} agent{agents.length !== 1 ? 's' : ''} total
                        </p>
                    </div>
                </div>

                <div className="p-6">
                    {agents.length === 0 ? (
                        <div className="text-center py-14">
                            <div className="inline-flex items-center justify-center w-14 h-14 bg-ocean-powder rounded-2xl mb-4">
                                <Bot className="h-7 w-7 text-ocean-deep" aria-hidden />
                            </div>
                            <h3 className="text-base font-semibold text-slate-900 mb-1.5">No agents yet</h3>
                            <p className="text-sm text-slate-500 mb-5 max-w-xs mx-auto">
                                Create your first AI agent to start automating conversations and support.
                            </p>
                            <button
                                onClick={() => navigate('/create-agent')}
                                className="inline-flex items-center gap-2 px-5 py-2.5 bg-ocean-navy text-white rounded-xl text-sm font-semibold hover:bg-ocean-deep transition-all duration-200 shadow-sm hover:shadow-md active:scale-[0.97]"
                            >
                                <Plus className="h-4 w-4" aria-hidden />
                                Create Your First Agent
                            </button>
                        </div>
                    ) : (
                        <DndContext
                            sensors={sensors}
                            collisionDetection={closestCenter}
                            onDragEnd={handleDragEnd}
                        >
                            <SortableContext
                                items={orderedAgents.map(a => a._id)}
                                strategy={rectSortingStrategy}
                            >
                                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                                    {orderedAgents.map((agent, i) => (
                                        <SortableAgentCard
                                            key={agent._id}
                                            agent={agent}
                                            animDelay={i * 60}
                                            isAdmin={isAdmin}
                                            onChat={() =>
                                                navigate(
                                                    agent.type === 'voice'
                                                        ? `/voice-history/${agent._id}`
                                                        : `/chat/${agent._id}`
                                                )
                                            }
                                            onEdit={() => navigate(`/agents/${agent._id}/edit`)}
                                            onDelete={() => {
                                                setDeleteTarget(agent);
                                                setDeleteTypeName('');
                                            }}
                                            onTestCall={
                                                agent.type === 'voice' && agent.callDirection !== 'outbound'
                                                    ? () => {
                                                        setTestCallAutoStart(true);
                                                        setTestCallAgent(agent);
                                                    }
                                                    : undefined
                                            }
                                            onOrders={() => navigate(`/orders/${agent._id}`)}
                                            onLeads={() => navigate(`/leads/${agent._id}`)}
                                            onAnalytics={() => navigate(`/analytics/${agent._id}`)}
                                            onCampaigns={
                                                agent.callDirection === 'outbound'
                                                    ? () => navigate('/campaigns')
                                                    : undefined
                                            }
                                            onKnowledgeBase={() => navigate(`/agents/${agent._id}/knowledge-base`)}
                                            onWebsiteChat={
                                                agent.type === 'chat'
                                                    ? () => navigate(`/agents/${agent._id}/website-chat`)
                                                    : undefined
                                            }
                                            onConnectors={() => navigate(`/agents/${agent._id}/connectors`)}
                                            onCatalog={() => setCatalogAgent(agent)}
                                            highlightSetupMenu={setupMenuAgentId === agent._id}
                                            pendingOrders={notifications[agent._id]?.orders || 0}
                                            newLeads={notifications[agent._id]?.leads || 0}
                                        />
                                    ))}
                                </div>
                            </SortableContext>
                        </DndContext>
                    )}
                </div>
            </motion.div>

            {/* ── Voice test panel ─────────────────────────────────────── */}
            {testCallAgent && token && user?.tenantId && (
                <VoiceTestPanel
                    agentId={testCallAgent._id}
                    agentName={testCallAgent.name}
                    speakingName={testCallAgent.persona?.name || undefined}
                    tenantId={user.tenantId}
                    token={token}
                    autoStart={testCallAutoStart}
                    onClose={() => {
                        setTestCallAgent(null);
                        setTestCallAutoStart(false);
                    }}
                />
            )}

            <CatalogModal
                agent={catalogAgent}
                otherAgents={agents}
                onClose={() => setCatalogAgent(null)}
            />

            {/* ── Delete modal ─────────────────────────────────────────── */}
            {deleteTarget && (
                <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4">
                    <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-6 border border-slate-200 animate-fade-up" style={{ opacity: 0 }}>
                        <div className="text-center">
                            <div className="mx-auto flex items-center justify-center h-11 w-11 rounded-full bg-red-50 border border-red-100 mb-4">
                                <Trash2 className="h-5 w-5 text-red-500" aria-hidden />
                            </div>
                            <h3 className="text-base font-semibold text-slate-900 mb-1.5">Delete agent</h3>
                            <p className="text-sm text-slate-500 mb-1 text-left">
                                This cannot be undone. Type the agent name{' '}
                                <strong className="text-slate-800">{deleteTarget.name}</strong> to confirm.
                            </p>
                            <input
                                type="text"
                                value={deleteTypeName}
                                onChange={e => setDeleteTypeName(e.target.value)}
                                placeholder="Agent name"
                                className="w-full mt-2 mb-4 px-3 py-2 border border-slate-200 rounded-xl text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-ocean-sky/60 focus:border-transparent placeholder:text-slate-400 transition-shadow"
                                autoComplete="off"
                            />
                            <div className="flex gap-3">
                                <button
                                    type="button"
                                    onClick={() => { setDeleteTarget(null); setDeleteTypeName(''); }}
                                    disabled={deleting}
                                    className="flex-1 px-4 py-2 bg-slate-50 border border-slate-200 text-slate-700 rounded-xl hover:bg-slate-100 transition-all duration-200 disabled:opacity-50 text-sm font-medium active:scale-[0.97]"
                                >
                                    Cancel
                                </button>
                                <button
                                    type="button"
                                    onClick={() => handleDelete(deleteTarget._id)}
                                    disabled={deleting || deleteTypeName.trim() !== deleteTarget.name.trim()}
                                    className="flex-1 px-4 py-2 bg-red-600 text-white rounded-xl hover:bg-red-700 transition-all duration-200 disabled:opacity-50 text-sm font-semibold flex items-center justify-center gap-2 active:scale-[0.97]"
                                >
                                    {deleting ? (
                                        <><span className="h-4 w-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Deleting…</>
                                    ) : 'Delete Agent'}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </motion.div>
    );
}

/* ── Sub-components ─────────────────────────────────────────────────────── */

function UsageBar({ label, used, limit }: { label: string; used: number; limit: number }) {
    const pct = limit === -1 ? 0 : Math.min((used / limit) * 100, 100);
    const isCritical = pct >= 95;
    const isWarning = pct >= 80;

    return (
        <div className="min-w-[56px]">
            <p className="text-[10px] text-slate-400 mb-0.5 font-medium">{label}</p>
            <p className={`text-sm font-bold leading-tight ${isCritical ? 'text-red-600' : isWarning ? 'text-amber-600' : 'text-slate-900'}`}>
                {used.toLocaleString()}
                <span className="text-slate-400 font-normal text-[10px]"> / {limit === -1 ? '∞' : limit.toLocaleString()}</span>
            </p>
            {limit !== -1 && (
                <div className="w-14 h-1 bg-slate-100 rounded-full mt-1.5 overflow-hidden">
                    <div
                        className={`h-full rounded-full transition-all duration-500 ${isCritical ? 'bg-red-500' : isWarning ? 'bg-amber-500' : 'bg-emerald-500'}`}
                        style={{ width: `${pct}%` }}
                    />
                </div>
            )}
        </div>
    );
}

interface StatCardProps {
    title: string;
    value: string;
    sub?: string;
    icon: React.ReactNode;
    iconBg: string;
    pct?: number;
    locked?: boolean;
}

function StatCard({ title, value, sub, icon, iconBg, pct = 0, locked = false }: StatCardProps) {
    return (
        <motion.div
            className={`bg-white rounded-xl border border-slate-200/80 p-5 cursor-default ${locked ? 'opacity-60' : ''}`}
            style={{ boxShadow: '0 2px 8px -2px rgba(0,0,0,0.08), 0 1px 2px -1px rgba(0,0,0,0.05)' }}
            variants={{ hidden: { opacity: 0, y: 16 }, show: { opacity: 1, y: 0, transition: { duration: 0.5, ease: [0.22, 1, 0.36, 1] } } }}
            whileHover={{
                y: -8,
                scale: 1.018,
                boxShadow: '0 14px 36px -6px rgba(0,0,0,0.13), 0 5px 12px -3px rgba(0,0,0,0.08)',
                transition: { type: 'spring', stiffness: 320, damping: 22 },
            }}
            whileTap={{
                y: -3,
                scale: 0.988,
                transition: { duration: 0.1 },
            }}
        >
            <div className="flex items-start justify-between mb-3">
                <div className={`p-2.5 rounded-xl ${iconBg}`}>
                    <div className="text-white">{icon}</div>
                </div>
                {locked ? (
                    <span className="inline-flex items-center gap-1 text-[10px] font-medium text-slate-400 border border-slate-200 bg-slate-50 rounded-full px-2 py-0.5">
                        <Lock className="h-2.5 w-2.5" aria-hidden />
                        Upgrade
                    </span>
                ) : pct > 0 ? (
                    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                        pct >= 95 ? 'text-red-600 bg-red-50' :
                        pct >= 80 ? 'text-amber-600 bg-amber-50' :
                        'text-emerald-600 bg-emerald-50'
                    }`}>
                        {pct.toFixed(0)}%
                    </span>
                ) : null}
            </div>

            <p className="text-[11px] font-medium text-slate-500 mb-0.5 uppercase tracking-wider">{title}</p>
            <div className="flex items-baseline gap-1.5">
                <p className="text-3xl font-bold text-slate-900 leading-none">{value}</p>
                {sub && <p className="text-xs text-slate-400">{sub}</p>}
            </div>

            {pct > 0 && (
                <div className="mt-3 h-1 bg-slate-100 rounded-full overflow-hidden">
                    <div
                        className={`h-full rounded-full transition-all duration-700 ${
                            pct >= 95 ? 'bg-red-500' : pct >= 80 ? 'bg-amber-500' : 'bg-emerald-500'
                        }`}
                        style={{ width: `${pct}%` }}
                    />
                </div>
            )}
        </motion.div>
    );
}

/* ── Action button inside agent cards ─────────────────────────────────── */
interface ActionChipProps {
    icon: React.ElementType;
    label: string;
    onClick: () => void;
    badge?: number;
    className?: string;
}

function ActionChip({ icon: Icon, label, onClick, badge = 0, className = '' }: ActionChipProps) {
    return (
        <button
            type="button"
            onClick={onClick}
            title={label}
            className={`relative inline-flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded-xl border border-ocean-sky/20 bg-ocean-powder/40 text-xs font-medium text-ocean-deep hover:bg-ocean-powder hover:border-ocean-sky/50 hover:text-ocean-navy transition-all duration-150 active:scale-[0.95] ${className}`}
        >
            <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden />
            <span className="leading-none">{label}</span>
            {badge > 0 && (
                <span className="absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] flex items-center justify-center px-0.5 bg-red-500 text-white text-[9px] font-bold rounded-full shadow-sm">
                    {badge > 99 ? '99+' : badge}
                </span>
            )}
        </button>
    );
}

/* ── Agent card ────────────────────────────────────────────────────────── */
// ─── Sortable wrapper ─────────────────────────────────────────────────────────
function SortableAgentCard(props: AgentCardProps) {
    const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: props.agent._id });
    return (
        <div
            ref={setNodeRef}
            style={{
                transform: CSS.Transform.toString(transform),
                transition,
                zIndex: isDragging ? 20 : undefined,
            }}
            className="min-h-[360px] flex flex-col"
            {...attributes}
        >
            <AgentCard {...props} isDragging={isDragging} dragHandleListeners={listeners} />
        </div>
    );
}

interface AgentCardProps {
    agent: Agent;
    animDelay: number;
    isAdmin: boolean;
    isDragging?: boolean;
    dragHandleListeners?: Record<string, unknown>;
    onChat: () => void;
    onEdit: () => void;
    onDelete: () => void;
    onTestCall?: () => void;
    onOrders: () => void;
    onLeads: () => void;
    onAnalytics: () => void;
    onCampaigns?: () => void;
    onKnowledgeBase: () => void;
    onWebsiteChat?: () => void;
    onConnectors: () => void;
    onCatalog: () => void;
    highlightSetupMenu?: boolean;
    pendingOrders: number;
    newLeads: number;
}

function AgentCard({
    agent, animDelay, isAdmin, isDragging = false, dragHandleListeners,
    onChat, onEdit, onDelete, onTestCall,
    onOrders, onLeads, onAnalytics, onCampaigns,
    onKnowledgeBase, onWebsiteChat, onConnectors, onCatalog,
    highlightSetupMenu = false,
    pendingOrders, newLeads,
}: AgentCardProps) {
    const isChat = agent.type === 'chat';

    return (
        <motion.div
            className={`bg-white rounded-2xl border h-full flex flex-col ${
                highlightSetupMenu
                    ? 'border-amber-400 ring-2 ring-amber-300/80 shadow-lg shadow-amber-100/80'
                    : 'border-slate-200/80'
            }`}
            style={{ boxShadow: '0 2px 12px -3px rgba(0,0,0,0.09), 0 1px 3px -1px rgba(0,0,0,0.06)' }}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: animDelay / 1000, ease: [0.22, 1, 0.36, 1] }}
            whileHover={isDragging ? {} : {
                y: -10,
                scale: 1.015,
                boxShadow: '0 20px 48px -8px rgba(0,0,0,0.15), 0 8px 18px -4px rgba(0,0,0,0.08)',
                transition: { type: 'spring', stiffness: 320, damping: 22 },
            }}
            whileTap={isDragging ? {} : {
                y: -3,
                scale: 0.985,
                transition: { duration: 0.1 },
            }}
        >
            {/* Card header */}
            {isChat ? (
                /* Chat: soft blue-tinted header */
                <div className="px-5 pt-5 pb-4 bg-ocean-powder/40 border-b border-ocean-sky/20 rounded-t-2xl overflow-hidden">
                    <div className="flex items-start justify-between">
                        <div className="flex items-center gap-3 min-w-0">
                            <div className="w-10 h-10 rounded-xl bg-ocean-bright flex items-center justify-center shadow-sm shrink-0">
                                <MessageSquare className="h-5 w-5 text-white" aria-hidden />
                            </div>
                            <div className="min-w-0">
                                <h3 className="font-semibold text-slate-900 text-sm truncate leading-tight">{agent.name}</h3>
                                <span className="text-[10px] font-semibold text-ocean-deep mt-0.5 inline-block">Chat Agent</span>
                            </div>
                        </div>
                        <div className="flex gap-0.5 shrink-0 ml-2 items-center">
                            <button
                                {...dragHandleListeners}
                                title="Drag to reorder"
                                className="p-1.5 text-slate-300 hover:text-slate-500 cursor-grab active:cursor-grabbing rounded-lg transition-colors touch-none"
                                onClick={e => e.stopPropagation()}
                            >
                                <GripVertical className="h-3.5 w-3.5" aria-hidden />
                            </button>
                            {isAdmin && (
                                <>
                                    <button
                                        onClick={onEdit}
                                        title="Edit agent"
                                        className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-white/70 rounded-lg transition-all duration-150 active:scale-[0.92]"
                                    >
                                        <Edit2 className="h-3.5 w-3.5" aria-hidden />
                                    </button>
                                    <button
                                        onClick={onDelete}
                                        title="Delete agent"
                                        className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-all duration-150 active:scale-[0.92]"
                                    >
                                        <Trash2 className="h-3.5 w-3.5" aria-hidden />
                                    </button>
                                </>
                            )}
                        </div>
                    </div>
                </div>
            ) : (
                /* Voice: deep navy header */
                <div className="px-5 pt-5 pb-4 bg-ocean-navy border-b border-ocean-deep rounded-t-2xl overflow-hidden">
                    <div className="flex items-start justify-between">
                        <div className="flex items-center gap-3 min-w-0">
                            <div className="w-10 h-10 rounded-xl bg-white/15 flex items-center justify-center shrink-0">
                                <Mic className="h-5 w-5 text-ocean-aqua" aria-hidden />
                            </div>
                            <div className="min-w-0">
                                <h3 className="font-semibold text-white text-sm truncate leading-tight">{agent.name}</h3>
                                <div className="flex items-center gap-1.5 mt-0.5">
                                    <span className="text-[10px] font-semibold text-ocean-mist inline-block">Voice Agent</span>
                                    {agent.callDirection === 'outbound' ? (
                                        <span className="text-[10px] text-ocean-sky/70">· Outbound</span>
                                    ) : (
                                        <span className="text-[10px] text-ocean-sky/70">· Inbound</span>
                                    )}
                                </div>
                            </div>
                        </div>
                        <div className="flex gap-0.5 shrink-0 ml-2 items-center">
                            <button
                                {...dragHandleListeners}
                                title="Drag to reorder"
                                className="p-1.5 text-white/30 hover:text-white/70 cursor-grab active:cursor-grabbing rounded-lg transition-colors touch-none"
                                onClick={e => e.stopPropagation()}
                            >
                                <GripVertical className="h-3.5 w-3.5" aria-hidden />
                            </button>
                            {isAdmin && (
                                <>
                                    <button
                                        onClick={onEdit}
                                        title="Edit agent"
                                        className="p-1.5 text-white/50 hover:text-white hover:bg-white/10 rounded-lg transition-all duration-150 active:scale-[0.92]"
                                    >
                                        <Edit2 className="h-3.5 w-3.5" aria-hidden />
                                    </button>
                                    <button
                                        onClick={onDelete}
                                        title="Delete agent"
                                        className="p-1.5 text-white/50 hover:text-red-300 hover:bg-red-500/20 rounded-lg transition-all duration-150 active:scale-[0.92]"
                                    >
                                        <Trash2 className="h-3.5 w-3.5" aria-hidden />
                                    </button>
                                </>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* ── Card body ── */}
            <div className="px-5 py-4 flex-1 flex flex-col">
                {/* Agent details + catalog entry */}
                <div className="flex items-start justify-between gap-3 mb-4">
                    <div className="space-y-1.5 min-w-0 flex-1">
                        <div className="flex items-center gap-1.5 text-xs">
                            <span className="font-medium text-slate-500 w-16 shrink-0">Tone</span>
                            <span className="text-slate-700 capitalize">{agent.tone}</span>
                        </div>
                        <div className="flex items-center gap-1.5 text-xs">
                            <span className="font-medium text-slate-500 w-16 shrink-0">Language</span>
                            <span className="text-slate-700">{agent.language}</span>
                        </div>
                        {agent.type === 'voice' && agent.callDirection !== 'outbound' && agent.phoneNumber && (
                            <div className="flex items-center gap-1.5 text-xs">
                                <Phone className="h-3 w-3 text-slate-400 shrink-0" aria-hidden />
                                <span className="text-slate-600 font-mono text-[11px]">{agent.phoneNumber}</span>
                            </div>
                        )}
                        {agent.type === 'voice' && agent.callDirection === 'outbound' && agent.outboundCallerId && (
                            <div className="flex items-center gap-1.5 text-xs">
                                <Radio className="h-3 w-3 text-slate-400 shrink-0" aria-hidden />
                                <span className="text-slate-600 font-mono text-[11px]">{agent.outboundCallerId}</span>
                            </div>
                        )}
                    </div>
                    <motion.button
                        type="button"
                        onClick={onCatalog}
                        title="Manage catalog / menu"
                        animate={highlightSetupMenu ? { scale: [1, 1.06, 1] } : { scale: 1 }}
                        transition={highlightSetupMenu ? { repeat: 3, duration: 0.9 } : undefined}
                        className={`shrink-0 flex flex-col items-center justify-center gap-1 rounded-xl border px-3 py-2 text-center transition-all active:scale-[0.96] ${
                            highlightSetupMenu
                                ? 'border-amber-400 bg-amber-50 text-amber-900 shadow-sm'
                                : 'border-ocean-ice bg-ocean-powder/50 text-ocean-deep hover:bg-ocean-powder hover:border-ocean-sky/40'
                        }`}
                    >
                        <Package className="h-4 w-4" aria-hidden />
                        <span className="text-[10px] font-semibold leading-tight">Menu</span>
                    </motion.button>
                </div>
                {highlightSetupMenu && (
                    <p className="text-[11px] font-medium text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-3 -mt-2">
                        Set up your catalog — add menu items, then Sync to AI.
                    </p>
                )}

                {/* Spacer - pushes actions to bottom so all cards share the same height */}
                <div className="flex-1" />

                {/* Primary action */}
                <div className="flex gap-2 mb-3">
                    <button
                        type="button"
                        onClick={onChat}
                        className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-semibold transition-all duration-200 active:scale-[0.97] shadow-sm hover:shadow ${
                            isChat
                                ? 'bg-ocean-bright text-white hover:bg-ocean-rich'
                                : 'bg-ocean-navy text-white hover:bg-ocean-deep'
                        }`}
                    >
                        {isChat ? (
                            <><MessageSquare className="h-4 w-4" aria-hidden /> Open Chat</>
                        ) : (
                            <><Phone className="h-4 w-4" aria-hidden /> Call History</>
                        )}
                    </button>
                    {onTestCall && (
                        <button
                            onClick={onTestCall}
                            title="Test call"
                            aria-label="Test call"
                            className="px-3 py-2.5 bg-emerald-50 border border-emerald-200 text-emerald-700 rounded-xl hover:bg-emerald-100 hover:border-emerald-300 transition-all duration-150 active:scale-[0.95]"
                        >
                            <PhoneCall className="h-4 w-4" aria-hidden />
                        </button>
                    )}
                </div>

                {/* Secondary actions  - row 1: Outbound voice gets both Campaigns + Analytics */}
                {onCampaigns ? (
                    <>
                        <div className="flex gap-1.5 mb-1.5">
                            <ActionChip icon={BarChart3} label="Analytics" onClick={onAnalytics} className="flex-1" />
                            <ActionChip icon={Radio}     label="Campaigns" onClick={onCampaigns} className="flex-1" />
                        </div>
                        <div className="flex gap-1.5 mb-1.5">
                            <ActionChip icon={ShoppingBag} label="Orders" onClick={onOrders} badge={pendingOrders} className="flex-1" />
                            <ActionChip icon={Users}       label="Leads"  onClick={onLeads}  badge={newLeads}       className="flex-1" />
                        </div>
                    </>
                ) : (
                    <div className="flex gap-1.5 mb-1.5 flex-wrap">
                        <ActionChip icon={BarChart3}   label="Analytics" onClick={onAnalytics} className="flex-1 min-w-[5rem]" />
                        <ActionChip icon={ShoppingBag} label="Orders"    onClick={onOrders}    badge={pendingOrders} className="flex-1 min-w-[4.5rem]" />
                        <ActionChip icon={Users}       label="Leads"     onClick={onLeads}     badge={newLeads}       className="flex-1 min-w-[4rem]" />
                    </div>
                )}

                {/* Secondary actions  - row 2 */}
                <div className="flex gap-1.5 flex-wrap">
                    <ActionChip icon={BookOpen} label="Knowledge" onClick={onKnowledgeBase} className="flex-1" />
                    {isChat && onWebsiteChat && (
                        <ActionChip icon={Globe} label="Widget" onClick={onWebsiteChat} className="flex-1" />
                    )}
                    <ActionChip icon={Link2} label="Alerts" onClick={onConnectors} className="flex-1" />
                </div>
            </div>
        </motion.div>
    );
}
