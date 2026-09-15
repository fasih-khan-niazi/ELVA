import { NavLink, Link, useNavigate, useLocation } from 'react-router-dom';
import {
    LayoutDashboard, Radio, Link2, MessageSquare, Activity, BarChart3,
    UserRound, CreditCard, BookOpen, Mic, LogOut, Menu, X,
    ChevronsUpDown, Plus, Zap, AlertCircle, PanelLeftClose, PanelLeftOpen,
    Loader2, Building2, MailWarning, Layers, Bot, FileText, Users,
    MessageCircle, Phone, BarChart2, Plug, Star, ArrowUpRight, CheckCircle2,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useRef, useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import {
    useAuth,
    getSavedAccounts,
    removeSavedAccount,
    isSavedAccountExpired,
    type SavedAccount,
} from '../context/AuthContext';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3000';

// ─── Avatar ───────────────────────────────────────────────────────────────────

function resolveAvatarUrl(src: string | null | undefined): string | null {
    if (!src) return null;
    if (src.startsWith('blob:') || src.startsWith('data:')) return src;
    try {
        const url = new URL(src);
        // Preserve the full path AND search (query string) so cache-bust params survive.
        if (url.pathname.startsWith('/uploads/')) return `${API_BASE}${url.pathname}${url.search}`;
    } catch { /* relative path — return as-is */ }
    return src;
}

function UserAvatar({ photoUrl, label, size = 'md' }: { photoUrl?: string | null; label: string; size?: 'sm' | 'md' | 'lg' }) {
    const initials = label.split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase();
    const resolved = resolveAvatarUrl(photoUrl);
    const [imgLoaded, setImgLoaded] = useState(false);
    const [imgError, setImgError] = useState(false);

    // Reset load/error state whenever the resolved URL changes (e.g. after a profile
    // photo update with a new cache-busting query param) so the fresh image renders.
    useEffect(() => {
        setImgLoaded(false);
        setImgError(false);
    }, [resolved]);
    const cls = size === 'sm'
        ? 'h-6 w-6 rounded-full text-[9px]'
        : size === 'lg'
        ? 'h-16 w-16 rounded-full text-xl'
        : 'h-8 w-8 rounded-full text-xs';

    const fallback = (
        <div className={`${cls} bg-ocean-bright text-white font-bold flex items-center justify-center shrink-0`}>
            {initials || '?'}
        </div>
    );

    if (resolved && !imgError) {
        return (
            <div className={`${cls} relative shrink-0 overflow-hidden`}>
                {/* Initials layer visible while image loads */}
                <div className="absolute inset-0 bg-ocean-bright text-white font-bold flex items-center justify-center text-inherit">
                    {initials || '?'}
                </div>
                {/* Image fades in on load */}
                <img
                    src={resolved}
                    alt=""
                    className={`absolute inset-0 w-full h-full object-cover border border-slate-200 transition-opacity duration-300 ${imgLoaded ? 'opacity-100' : 'opacity-0'}`}
                    onLoad={() => setImgLoaded(true)}
                    onError={() => setImgError(true)}
                    referrerPolicy="no-referrer"
                />
            </div>
        );
    }
    return fallback;
}

function displayLabel(user: { name?: string | null; email: string }): string {
    if (user.name && user.name.trim()) return user.name.trim();
    return user.email.split('@')[0];
}


// ─── Nav config ───────────────────────────────────────────────────────────────

interface NavItem {
    label: string;
    icon: React.ElementType;
    to: string;
    adminOnly?: boolean;
    /** When true, the NavLink passes `state={{ from: location.pathname }}` so destination pages can show a dynamic back button. */
    passCurrentPath?: boolean;
}

interface NavSection {
    label: string;
    items: NavItem[];
}

const NAV_SECTIONS: NavSection[] = [
    {
        label: 'Overview',
        items: [
            { label: 'Dashboard', icon: LayoutDashboard, to: '/dashboard' },
        ],
    },
    {
        label: 'Outreach',
        items: [
            { label: 'Campaigns', icon: Radio, to: '/campaigns' },
            { label: 'Connectors', icon: Link2, to: '/connectors' },
        ],
    },
    {
        label: 'Analytics',
        items: [
            { label: 'Chat Analytics', icon: MessageSquare, to: '/chat-analytics' },
            { label: 'Voice Analytics', icon: Activity, to: '/voice-analytics' },
            { label: 'Global Analytics', icon: BarChart3, to: '/global-analytics', adminOnly: true },
        ],
    },
    {
        label: 'Account',
        items: [
            { label: 'Profile', icon: UserRound, to: '/profile' },
            { label: 'Subscription', icon: CreditCard, to: '/subscription' },
            { label: 'Documentation', icon: BookOpen, to: '/docs', passCurrentPath: true },
        ],
    },
];

function isNavActive(to: string, pathname: string): boolean {
    if (to === '/dashboard') return pathname === '/dashboard';
    if (to === '/docs') return pathname.startsWith('/docs');
    if (to === '/campaigns') return pathname.startsWith('/campaigns');
    return pathname === to || pathname.startsWith(to + '/');
}

// ─── Plan details data ────────────────────────────────────────────────────────

interface PlanFeature {
    icon: React.ElementType;
    label: string;
    value: string;
}

const PLAN_FEATURES: Record<string, PlanFeature[]> = {
    free: [
        { icon: Bot,           label: 'AI Agents',         value: '1 agent' },
        { icon: FileText,      label: 'Documents',         value: '3 docs' },
        { icon: MessageCircle, label: 'Messages / month',  value: '100' },
        { icon: Users,         label: 'Workspace seats',   value: '1 seat (solo)' },
        { icon: Phone,         label: 'Voice calling',     value: 'Not included' },
        { icon: BarChart2,     label: 'Analytics',         value: 'Not included' },
        { icon: Plug,          label: 'Connectors',        value: 'Not included' },
    ],
    starter: [
        { icon: Bot,           label: 'AI Agents',         value: '3 agents' },
        { icon: FileText,      label: 'Documents',         value: '10 docs' },
        { icon: MessageCircle, label: 'Messages / month',  value: '1,000' },
        { icon: Users,         label: 'Workspace seats',   value: '3 seats' },
        { icon: Phone,         label: 'Voice calling',     value: 'Not included' },
        { icon: BarChart2,     label: 'Analytics',         value: 'Included' },
        { icon: Plug,          label: 'Connectors',        value: 'Up to 3' },
    ],
    pro: [
        { icon: Bot,           label: 'AI Agents',         value: '10 agents' },
        { icon: FileText,      label: 'Documents',         value: '50 docs' },
        { icon: MessageCircle, label: 'Messages / month',  value: '10,000' },
        { icon: Users,         label: 'Workspace seats',   value: '5 seats' },
        { icon: Phone,         label: 'Voice calling',     value: 'Included' },
        { icon: BarChart2,     label: 'Analytics',         value: 'Included' },
        { icon: Plug,          label: 'Connectors',        value: 'Up to 10' },
    ],
    enterprise: [
        { icon: Bot,           label: 'AI Agents',         value: '50 agents' },
        { icon: FileText,      label: 'Documents',         value: 'Unlimited' },
        { icon: MessageCircle, label: 'Messages / month',  value: 'Unlimited' },
        { icon: Users,         label: 'Workspace seats',   value: 'Unlimited' },
        { icon: Phone,         label: 'Voice calling',     value: 'Included' },
        { icon: BarChart2,     label: 'Analytics',         value: 'Included' },
        { icon: Plug,          label: 'Connectors',        value: 'Unlimited' },
    ],
};

const PLAN_BADGE_COLORS: Record<string, string> = {
    free:       'bg-slate-100 text-slate-600',
    starter:    'bg-ocean-powder text-ocean-deep',
    pro:        'bg-indigo-50 text-indigo-700',
    enterprise: 'bg-amber-50 text-amber-700',
};

// ─── Sidebar Content ──────────────────────────────────────────────────────────

function SidebarContent({ onClose, collapsed = false, onCollapse }: { onClose?: () => void; collapsed?: boolean; onCollapse?: () => void }) {
    const { user, token, logout, login, subscription } = useAuth();
    const navigate = useNavigate();
    const location = useLocation();
    const [userMenuOpen, setUserMenuOpen] = useState(false);
    const [switchConfirm, setSwitchConfirm] = useState<SavedAccount | null>(null);
    const [switchingTo, setSwitchingTo] = useState<SavedAccount | null>(null);
    const [navigatingToLogin, setNavigatingToLogin] = useState(false);
    const [expiredTapped, setExpiredTapped] = useState<string | null>(null);
    const [planModalOpen, setPlanModalOpen] = useState(false);

    // Close plan modal on Escape
    useEffect(() => {
        if (!planModalOpen) return;
        const handler = (e: KeyboardEvent) => {
            if (e.key === 'Escape') setPlanModalOpen(false);
        };
        document.addEventListener('keydown', handler);
        return () => document.removeEventListener('keydown', handler);
    }, [planModalOpen]);
    const menuRef = useRef<HTMLDivElement>(null);
    const planMenuRef = useRef<HTMLDivElement>(null);
    const [otherAccounts, setOtherAccounts] = useState<SavedAccount[]>([]);

    const label = user ? displayLabel(user) : '';
    const isAdmin = user?.role === 'business_admin';

    // Refresh saved accounts when menu opens
    useEffect(() => {
        if (userMenuOpen && user) {
            setOtherAccounts(getSavedAccounts().filter(a => a.userId !== user.id));
        }
    }, [userMenuOpen, user]);

    // Full-screen switch: after 700ms show the transition then navigate
    useEffect(() => {
        if (!switchingTo) return;
        const timer = setTimeout(() => {
            login(switchingTo.token, {
                id: switchingTo.userId,
                email: switchingTo.email,
                name: switchingTo.name ?? null,
                profilePicture: switchingTo.profilePicture ?? null,
                role: switchingTo.role,
                tenantId: switchingTo.tenantId,
                workspaceName: switchingTo.workspaceName ?? null,
            });
            navigate('/dashboard', { replace: true });
            setSwitchingTo(null);
        }, 700);
        return () => clearTimeout(timer);
    }, [switchingTo, login, navigate]);

    // Login-navigation transition: show overlay for 500ms then navigate.
    useEffect(() => {
        if (!navigatingToLogin) return;
        const timer = setTimeout(() => {
            navigate('/login?addAccount=true');
            setNavigatingToLogin(false);
        }, 500);
        return () => clearTimeout(timer);
    }, [navigatingToLogin, navigate]);

    const roleLabel = (role?: string) => {
        if (role === 'business_admin') return 'Admin';
        if (role === 'platform_admin') return 'Platform';
        return 'Member';
    };

    const roleBadgeClass = (role?: string) =>
        role === 'business_admin'
            ? 'bg-ocean-powder text-ocean-deep'
            : 'bg-slate-100 text-slate-500';

    const handleSignOutAndRemove = () => {
        if (!user) return;
        removeSavedAccount(user.id);
        setUserMenuOpen(false);
        onClose?.();

        const remaining = getSavedAccounts();
        const nextAccount = remaining.find(a => !isSavedAccountExpired(a));

        if (nextAccount) {
            const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';
            if (token) {
                void fetch(`${API_URL}/api/user/logout-audit`, {
                    method: 'POST',
                    headers: { Authorization: `Bearer ${token}` },
                }).catch(() => {});
            }
            setSwitchingTo(nextAccount);
        } else {
            logout();
            navigate('/login', { replace: true });
        }
    };

    const handleRemoveSavedAccount = (userId: string) => {
        removeSavedAccount(userId);
        setOtherAccounts(prev => prev.filter(a => a.userId !== userId));
    };

    const doSwitch = (acct: SavedAccount) => {
        setUserMenuOpen(false);
        setSwitchConfirm(null);
        onClose?.();
        setSwitchingTo(acct);
    };

    const handleSwitchAccount = (acct: SavedAccount) => {
        if (isSavedAccountExpired(acct)) {
            // Keep the menu open and highlight the expired row instead of navigating away.
            setExpiredTapped(acct.userId);
            return;
        }
        const diffWorkspace = user?.tenantId && acct.tenantId && user.tenantId !== acct.tenantId;
        if (diffWorkspace) {
            setSwitchConfirm(acct);
        } else {
            doSwitch(acct);
        }
    };

    /* Close user menu on outside click */
    useEffect(() => {
        function onDown(e: MouseEvent | TouchEvent) {
            if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
                setUserMenuOpen(false);
                setExpiredTapped(null);
            }
        }
        document.addEventListener('mousedown', onDown);
        document.addEventListener('touchstart', onDown, { passive: true });
        return () => {
            document.removeEventListener('mousedown', onDown);
            document.removeEventListener('touchstart', onDown);
        };
    }, []);

    /* Close plan popup on outside click */
    useEffect(() => {
        function onDown(e: MouseEvent | TouchEvent) {
            if (planMenuRef.current && !planMenuRef.current.contains(e.target as Node)) {
                setPlanModalOpen(false);
            }
        }
        document.addEventListener('mousedown', onDown);
        document.addEventListener('touchstart', onDown, { passive: true });
        return () => {
            document.removeEventListener('mousedown', onDown);
            document.removeEventListener('touchstart', onDown);
        };
    }, []);

    return (
        <>
            {/* ── Full-screen account-switch overlay (rendered via portal to escape sidebar) ── */}
            {switchingTo && createPortal(
                <motion.div
                    className="fixed inset-0 z-[200] flex flex-col items-center justify-center bg-white gap-3"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.18 }}
                >
                    <motion.div
                        initial={{ scale: 0.85, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        transition={{ delay: 0.08, duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
                        className="flex flex-col items-center gap-3"
                    >
                        <UserAvatar photoUrl={switchingTo.profilePicture} label={switchingTo.name || switchingTo.email} size="lg" />
                        <div className="text-center">
                            <p className="text-base font-bold text-slate-900">
                                {switchingTo.name || switchingTo.email.split('@')[0]}
                            </p>
                            <p className="text-sm text-slate-400">{switchingTo.email}</p>
                            {switchingTo.workspaceName && (
                                <p className="text-xs text-slate-400 mt-0.5">{switchingTo.workspaceName}</p>
                            )}
                        </div>
                        <div className="flex items-center gap-2 text-sm text-slate-400 mt-1">
                            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                            Switching account…
                        </div>
                    </motion.div>
                </motion.div>,
                document.body,
            )}

            {/* ── Login-navigation overlay ──────────────────────────────────────── */}
            {navigatingToLogin && createPortal(
                <motion.div
                    className="fixed inset-0 z-[200] flex flex-col items-center justify-center bg-white gap-3"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.18 }}
                >
                    <motion.div
                        initial={{ scale: 0.85, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        transition={{ delay: 0.08, duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
                        className="flex flex-col items-center gap-3"
                    >
                        <div className="h-14 w-14 rounded-2xl bg-ocean-navy flex items-center justify-center">
                            <Mic className="h-6 w-6 text-white" aria-hidden />
                        </div>
                        <div className="text-center">
                            <p className="text-base font-bold text-slate-900">Sign in to another account</p>
                            <p className="text-sm text-slate-400 mt-0.5">Taking you to the login page…</p>
                        </div>
                        <div className="flex items-center gap-2 text-sm text-slate-400 mt-1">
                            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                        </div>
                    </motion.div>
                </motion.div>,
                document.body,
            )}

            {/* Cross-workspace switch confirmation */}
            {switchConfirm && (
                <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
                    <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm border border-slate-200 overflow-hidden">
                        <div className="px-5 py-4 border-b border-slate-100 flex items-center gap-3">
                            <div className="h-9 w-9 rounded-xl bg-amber-50 flex items-center justify-center shrink-0">
                                <AlertCircle className="h-5 w-5 text-amber-500" aria-hidden />
                            </div>
                            <div>
                                <p className="text-sm font-bold text-slate-900">Switch Workspace?</p>
                                <p className="text-xs text-slate-400 mt-0.5">You are switching to a different workspace</p>
                            </div>
                        </div>
                        <div className="px-5 py-4">
                            <p className="text-sm text-slate-600 mb-1">
                                Switching to <span className="font-semibold text-slate-800">{switchConfirm.email}</span>
                            </p>
                            <p className="text-xs text-slate-400">
                                This workspace belongs to a different organization. Make sure you have permission to access it.
                            </p>
                        </div>
                        <div className="flex gap-2 px-5 pb-5">
                            <button
                                onClick={() => setSwitchConfirm(null)}
                                className="flex-1 px-4 py-2 border border-slate-200 text-slate-700 rounded-xl text-sm font-medium hover:bg-slate-50 transition-colors"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={() => { setSwitchConfirm(null); doSwitch(switchConfirm); }}
                                className="flex-1 px-4 py-2 bg-ocean-navy text-white rounded-xl text-sm font-semibold hover:bg-ocean-deep transition-colors"
                            >
                                Switch
                            </button>
                        </div>
                    </div>
                </div>
            )}

            <div className="flex flex-col h-full select-none">

                {/* Brand */}
                <div className="flex items-center h-[60px] border-b border-slate-100 shrink-0">
                    {collapsed ? (
                        /* Collapsed: the whole area is a single "expand" button — no link to homepage */
                        <button
                            onClick={onCollapse}
                            title="Expand sidebar"
                            aria-label="Expand sidebar"
                            className="flex items-center justify-center w-full h-full group hover:bg-slate-50 transition-colors duration-150"
                        >
                            <div className="bg-ocean-bright p-2 rounded-xl transition-colors duration-150 group-hover:bg-ocean-rich">
                                <Mic className="h-4 w-4 text-white" aria-hidden />
                            </div>
                        </button>
                    ) : (
                        /* Expanded: ELVA logo links to homepage + separate collapse button */
                        <>
                            <Link
                                to="/"
                                onClick={onClose}
                                title="Back to Home"
                                className="flex items-center gap-3 flex-1 h-full px-4 group hover:bg-slate-50 transition-colors duration-150 overflow-hidden"
                            >
                                <div className="bg-ocean-bright p-2 rounded-xl shrink-0 transition-colors duration-150 group-hover:bg-ocean-rich">
                                    <Mic className="h-4 w-4 text-white" aria-hidden />
                                </div>
                                <span className="font-bold text-base text-ocean-navy tracking-tight whitespace-nowrap">ELVA</span>
                            </Link>
                            {onCollapse && (
                                <button
                                    onClick={onCollapse}
                                    title="Collapse sidebar"
                                    aria-label="Collapse sidebar"
                                    className="p-2 mr-2 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors shrink-0"
                                >
                                    <PanelLeftClose className="h-4 w-4" aria-hidden />
                                </button>
                            )}
                        </>
                    )}
                </div>

                {/* Navigation */}
                <nav className="sidebar-nav flex-1 px-2 py-3 overflow-y-auto overflow-x-hidden">
                    {NAV_SECTIONS.map(section => {
                        const visibleItems = section.items.filter(item => !item.adminOnly || isAdmin);
                        if (visibleItems.length === 0) return null;
                        return (
                            <div key={section.label} className="mb-4">
                                {collapsed
                                    ? <div className="mx-3 mb-2 border-t border-slate-100" />
                                    : <p className="px-3 mb-1 text-[10px] uppercase font-semibold tracking-[0.12em] text-slate-400">{section.label}</p>
                                }
                                <ul className="space-y-0.5">
                                    {visibleItems.map(item => {
                                        const active = isNavActive(item.to, location.pathname);
                                        return (
                                            <li key={item.label} className="relative group/navitem">
                                                <NavLink
                                                    to={item.to}
                                                    state={item.passCurrentPath ? { from: location.pathname } : undefined}
                                                    onClick={onClose}
                                                    title={collapsed ? item.label : undefined}
                                                    className={`flex items-center rounded-lg text-sm transition-all duration-150 ${
                                                        collapsed
                                                            ? 'justify-center px-3 py-2.5'
                                                            : 'gap-3 px-3 py-2'
                                                    } ${
                                                        active
                                                            ? 'bg-ocean-navy text-white font-semibold shadow-sm ring-1 ring-inset ring-white/10'
                                                            : 'text-slate-600 font-medium hover:bg-slate-100/70 hover:text-slate-800 hover:ring-1 hover:ring-inset hover:ring-slate-200 active:scale-[0.98]'
                                                    }`}
                                                >
                                                    <item.icon className="h-4 w-4 shrink-0" aria-hidden />
                                                    {!collapsed && item.label}
                                                </NavLink>
                                                {/* Tooltip shown only in collapsed mode */}
                                                {collapsed && (
                                                    <div className="pointer-events-none absolute left-full top-1/2 -translate-y-1/2 ml-2.5 px-2.5 py-1.5 bg-slate-900 text-white text-xs font-medium rounded-lg whitespace-nowrap opacity-0 group-hover/navitem:opacity-100 transition-opacity z-[60] shadow-xl">
                                                        {item.label}
                                                        <div className="absolute right-full top-1/2 -translate-y-1/2 border-4 border-transparent border-r-slate-900" />
                                                    </div>
                                                )}
                                            </li>
                                        );
                                    })}
                                </ul>
                            </div>
                        );
                    })}
                </nav>

                {/* Footer */}
                <div className={`pb-4 border-t border-slate-100 pt-3 shrink-0 space-y-2 ${collapsed ? 'px-2' : 'px-3'}`}>

                    {/* Plan card + popup */}
                    {subscription && (
                        <div ref={planMenuRef} className="relative">

                            {/* Plan popup (appears above the trigger, same style as account menu) */}
                            {planModalOpen && (
                                <div className="absolute bottom-full left-0 mb-1.5 w-64 bg-white rounded-xl border border-slate-200 shadow-xl overflow-hidden z-50">

                                    {/* Header */}
                                    <div className="px-3 py-2.5 bg-slate-50 border-b border-slate-100">
                                        <div className="flex items-center gap-2.5">
                                            <div className="h-7 w-7 rounded-lg bg-ocean-powder border border-ocean-sky/20 flex items-center justify-center shrink-0">
                                                <Layers className="h-3.5 w-3.5 text-ocean-bright" aria-hidden />
                                            </div>
                                            <div className="flex-1 min-w-0">
                                                <p className="text-[9px] font-semibold text-slate-400 uppercase tracking-widest leading-none mb-0.5">Current plan</p>
                                                <div className="flex items-center gap-1.5">
                                                    <p className="text-sm font-bold text-slate-900 capitalize leading-none">{subscription.plan}</p>
                                                    <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full uppercase tracking-wide shrink-0 ${PLAN_BADGE_COLORS[subscription.plan] ?? 'bg-slate-100 text-slate-600'}`}>
                                                        {subscription.status}
                                                    </span>
                                                </div>
                                            </div>
                                        </div>
                                    </div>

                                    {/* Feature list */}
                                    <div className="px-3 py-2.5">
                                        <p className="text-[9px] font-semibold text-slate-400 uppercase tracking-widest mb-2">What's included</p>
                                        <ul className="space-y-1.5">
                                            {(PLAN_FEATURES[subscription.plan] ?? PLAN_FEATURES.free).map((feat) => {
                                                const isIncluded = !feat.value.toLowerCase().startsWith('not');
                                                return (
                                                    <li key={feat.label} className="flex items-center gap-2">
                                                        <div className={`h-5 w-5 rounded-md flex items-center justify-center shrink-0 ${isIncluded ? 'bg-ocean-powder/70' : 'bg-slate-100'}`}>
                                                            <feat.icon className={`h-3 w-3 ${isIncluded ? 'text-ocean-bright' : 'text-slate-300'}`} aria-hidden />
                                                        </div>
                                                        <div className="flex-1 min-w-0 flex items-center justify-between gap-1">
                                                            <span className={`text-[11px] ${isIncluded ? 'text-slate-600' : 'text-slate-400'}`}>{feat.label}</span>
                                                            <span className={`text-[11px] font-semibold shrink-0 flex items-center gap-1 ${isIncluded ? 'text-slate-800' : 'text-slate-300'}`}>
                                                                {isIncluded && <CheckCircle2 className="h-2.5 w-2.5 text-emerald-500 shrink-0" aria-hidden />}
                                                                {feat.value}
                                                            </span>
                                                        </div>
                                                    </li>
                                                );
                                            })}
                                        </ul>
                                    </div>

                                    {/* Upgrade button (non-enterprise only) */}
                                    {subscription.plan !== 'enterprise' && (
                                        <div className="border-t border-slate-100 py-1">
                                            <button
                                                onClick={() => { setPlanModalOpen(false); onClose?.(); navigate('/subscription'); }}
                                                className="w-full flex items-center gap-2.5 px-3 py-2 text-sm font-semibold text-ocean-navy hover:bg-ocean-powder/60 transition-colors"
                                            >
                                                <Star className="h-4 w-4 text-ocean-bright shrink-0" aria-hidden />
                                                Upgrade plan
                                            </button>
                                        </div>
                                    )}
                                </div>
                            )}

                            {/* Trigger button (collapsed: icon only, expanded: full card) */}
                            {collapsed ? (
                                <button
                                    onClick={() => { setUserMenuOpen(false); setPlanModalOpen(o => !o); }}
                                    title={`${subscription.plan} Plan — click for details`}
                                    className="w-full flex justify-center py-2 rounded-xl hover:bg-slate-100 transition-all duration-150 group/plan relative"
                                >
                                    <Layers className="h-4 w-4 text-ocean-bright" aria-hidden />
                                    {!planModalOpen && (
                                        <div className="pointer-events-none absolute left-full top-1/2 -translate-y-1/2 ml-2.5 px-2.5 py-1.5 bg-slate-900 text-white text-xs font-medium rounded-lg whitespace-nowrap opacity-0 group-hover/plan:opacity-100 transition-opacity z-[60] shadow-xl capitalize">
                                            {subscription.plan} Plan
                                            <div className="absolute right-full top-1/2 -translate-y-1/2 border-4 border-transparent border-r-slate-900" />
                                        </div>
                                    )}
                                </button>
                            ) : (
                                <button
                                    onClick={() => { setUserMenuOpen(false); setPlanModalOpen(o => !o); }}
                                    className={`w-full rounded-xl border bg-white shadow-sm transition-all duration-150 active:scale-[0.98] overflow-hidden text-left ${planModalOpen ? 'border-ocean-sky/50 shadow-md' : 'border-slate-200 hover:border-ocean-sky/50 hover:shadow-md'}`}
                                >
                                    <div className="px-3 py-2.5 flex items-center gap-2.5">
                                        <div className="h-7 w-7 rounded-lg bg-ocean-powder/60 border border-ocean-sky/20 flex items-center justify-center shrink-0">
                                            <Layers className="h-3.5 w-3.5 text-ocean-bright" aria-hidden />
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <p className="text-xs font-bold text-slate-800 capitalize leading-none">
                                                {subscription.plan} Plan
                                            </p>
                                            <div className="flex items-center gap-1.5 mt-1">
                                                <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${subscription.status === 'active' ? 'bg-emerald-500' : 'bg-amber-400'}`} />
                                                <span className="text-[10px] text-slate-400 capitalize leading-none">{subscription.status}</span>
                                            </div>
                                        </div>
                                        <ArrowUpRight className={`h-3.5 w-3.5 shrink-0 transition-colors ${planModalOpen ? 'text-ocean-bright' : 'text-slate-300'}`} aria-hidden />
                                    </div>
                                </button>
                            )}
                        </div>
                    )}

                    {/* User account menu */}
                    {user && (
                        <div
                            ref={menuRef}
                            className="relative"
                            onKeyDown={(e) => {
                                if (e.key === 'Escape') {
                                    setUserMenuOpen(false);
                                    setExpiredTapped(null);
                                }
                            }}
                        >

                            {/* Account dropdown */}
                            {userMenuOpen && (
                                <div className="absolute bottom-full left-0 mb-1.5 w-64 bg-white rounded-xl border border-slate-200 shadow-xl overflow-hidden z-50">

                                    {/* Signed-in header */}
                                    <div className="px-3 py-2.5 bg-slate-50 border-b border-slate-100">
                                        <p className="text-[9px] font-semibold text-slate-400 uppercase tracking-widest truncate mb-1.5">
                                            {user.workspaceName || 'Workspace Account'}
                                        </p>
                                        <div className="flex items-center gap-2">
                                            <UserAvatar photoUrl={user.profilePicture} label={label} size="sm" />
                                            <div className="flex-1 min-w-0">
                                                <p className="text-xs font-semibold text-slate-800 truncate">{label}</p>
                                                <p className="text-[10px] text-slate-400 truncate">{user.email}</p>
                                            </div>
                                            <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full uppercase tracking-wide shrink-0 ${roleBadgeClass(user.role)}`}>
                                                {roleLabel(user.role)}
                                            </span>
                                        </div>
                                    </div>

                                    {/* Empty state */}
                                    {otherAccounts.length === 0 && (
                                        <div className="px-3 py-3 border-b border-slate-100 text-center">
                                            <p className="text-[10px] text-slate-400 leading-relaxed">
                                                Only signed in to one account.
                                            </p>
                                            <p className="text-[10px] text-slate-400 leading-relaxed">
                                                Use <span className="font-semibold text-slate-500">Add / Switch Account</span> below to add more.
                                            </p>
                                        </div>
                                    )}

                                    {/* Switch / Remove saved accounts */}
                                    {otherAccounts.length > 0 && (
                                        <div className="border-b border-slate-100">
                                            <p className="px-3 pt-2 pb-0.5 text-[9px] font-semibold text-slate-400 uppercase tracking-widest">
                                                Saved Accounts
                                            </p>
                                            {otherAccounts.map(acct => {
                                                const expired = isSavedAccountExpired(acct);
                                                const tapped = expiredTapped === acct.userId;
                                                return (
                                                    <div
                                                        key={acct.userId}
                                                        className={`flex items-center group transition-colors ${tapped ? 'bg-amber-50' : 'hover:bg-slate-50'}`}
                                                    >
                                                        <button
                                                            onClick={() => handleSwitchAccount(acct)}
                                                            className="flex-1 flex items-center gap-2.5 px-3 py-2 min-w-0 text-left"
                                                        >
                                                            <UserAvatar
                                                                photoUrl={expired ? null : acct.profilePicture}
                                                                label={acct.name || acct.email}
                                                                size="sm"
                                                            />
                                                            <div className="flex-1 min-w-0">
                                                                <div className="flex items-center gap-1.5 min-w-0">
                                                                    <p className={`text-xs font-semibold truncate ${expired ? 'text-slate-400' : 'text-slate-700'}`}>
                                                                        {acct.name || acct.email.split('@')[0]}
                                                                    </p>
                                                                    <span className={`text-[8px] font-bold px-1 py-0.5 rounded-full uppercase shrink-0 ${roleBadgeClass(acct.role)}`}>
                                                                        {roleLabel(acct.role)}
                                                                    </span>
                                                                </div>
                                                                <p className="text-[10px] text-slate-400 truncate">{acct.email}</p>
                                                                {acct.workspaceName && !expired && (
                                                                    <div className="mt-1 inline-flex items-center gap-1 text-[10px] font-semibold text-ocean-deep bg-ocean-powder/70 border border-ocean-sky/30 px-2 py-0.5 rounded-md max-w-full">
                                                                        <Building2 className="h-3 w-3 shrink-0 text-ocean-rich" aria-hidden />
                                                                        <span className="truncate">Workspace: {acct.workspaceName}</span>
                                                                    </div>
                                                                )}
                                                                {expired && !tapped && (
                                                                    <p className="text-[9px] text-amber-500 font-medium leading-tight mt-0.5">
                                                                        Session expired · tap to re-auth
                                                                    </p>
                                                                )}
                                                                {expired && tapped && (
                                                                    <button
                                                                        onClick={(e) => {
                                                                            e.stopPropagation();
                                                                            setUserMenuOpen(false);
                                                                            onClose?.();
                                                                            navigate(`/login?addAccount=true&hint=${encodeURIComponent(acct.email)}`);
                                                                        }}
                                                                        className="text-[9px] text-ocean-rich font-semibold leading-tight mt-0.5 hover:underline"
                                                                    >
                                                                        Sign in again →
                                                                    </button>
                                                                )}
                                                            </div>
                                                        </button>
                                                        <button
                                                            onClick={() => handleRemoveSavedAccount(acct.userId)}
                                                            title="Remove this saved account"
                                                            className="opacity-0 group-hover:opacity-100 p-1.5 mr-2 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition-all"
                                                        >
                                                            <X className="h-3 w-3" aria-hidden />
                                                        </button>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    )}

                                    {/* Add Account */}
                                    <div className="py-1">
                                        <button
                                            onClick={() => {
                                                setUserMenuOpen(false);
                                                onClose?.();
                                                setNavigatingToLogin(true);
                                            }}
                                            className="w-full flex items-center gap-2.5 px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 transition-colors"
                                        >
                                            <Plus className="h-4 w-4 text-slate-400 shrink-0" aria-hidden />
                                            Add / Switch Account
                                        </button>
                                    </div>

                                    {/* Sign out */}
                                    <div className="border-t border-slate-100 py-1">
                                        <button
                                            onClick={handleSignOutAndRemove}
                                            className="w-full flex items-center gap-2.5 px-3 py-2 text-sm font-medium text-red-600 hover:bg-red-50 transition-colors"
                                        >
                                            <LogOut className="h-4 w-4 shrink-0" aria-hidden />
                                            Remove &amp; Sign Out
                                        </button>
                                    </div>
                                </div>
                            )}

                            {/* Trigger */}
                            <button
                                onClick={() => { setPlanModalOpen(false); setUserMenuOpen(o => !o); }}
                                title={collapsed ? label : undefined}
                                className={`w-full flex items-center rounded-xl hover:bg-slate-100 transition-all duration-150 active:scale-[0.98] ${collapsed ? 'justify-center px-2 py-2' : 'gap-2.5 px-2 py-2'}`}
                            >
                                <UserAvatar photoUrl={user.profilePicture} label={label} />
                                {!collapsed && (
                                    <>
                                        <div className="flex-1 min-w-0 text-left">
                                            <p
                                                className="text-xs font-semibold text-slate-800 leading-snug break-words"
                                                style={{ wordBreak: 'break-word' }}
                                            >
                                                {label}
                                            </p>
                                            <p className="text-[10px] text-slate-400 leading-snug mt-0.5 truncate" title={user.email}>
                                                {user.email}
                                            </p>
                                        </div>
                                        <ChevronsUpDown className="h-3.5 w-3.5 text-slate-400 shrink-0" aria-hidden />
                                    </>
                                )}
                            </button>
                        </div>
                    )}
                </div>
            </div>
        </>
    );
}

// ─── Layout Shell ─────────────────────────────────────────────────────────────

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
    const [mobileOpen, setMobileOpen] = useState(false);
    const [collapsed, setCollapsed] = useState(() => localStorage.getItem('elva_sidebar_collapsed') === 'true');
    const location = useLocation();
    const navigate = useNavigate();
    const { subscription, user } = useAuth();
    const showExpiryBanner = !!subscription && subscription.status !== 'active' && subscription.status !== 'trialing';
    const showUnverifiedBanner = user?.emailVerified === false && user.role !== 'platform_admin';
    const [resendCooldown, setResendCooldown] = useState(false);
    const [resendDone, setResendDone] = useState(false);

    const handleResendVerification = async () => {
        if (resendCooldown || !user?.email) return;
        setResendCooldown(true);
        try {
            const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';
            await fetch(`${API_BASE_URL}/api/auth/resend-verification`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email: user.email }),
            });
            setResendDone(true);
        } catch { /* silent */ }
        setTimeout(() => setResendCooldown(false), 60_000);
    };

    const toggleCollapsed = () => {
        setCollapsed(c => {
            const next = !c;
            localStorage.setItem('elva_sidebar_collapsed', String(next));
            return next;
        });
    };

    return (
        <div className="flex h-screen bg-slate-50 overflow-hidden">

            {/* Desktop Sidebar */}
            <motion.aside
                animate={{ width: collapsed ? 64 : 248 }}
                transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
                className="hidden lg:flex flex-col bg-white border-r-2 border-slate-200 shadow-[2px_0_8px_rgba(0,0,0,0.07)] shrink-0"
            >
                <SidebarContent collapsed={collapsed} onCollapse={toggleCollapsed} />
            </motion.aside>

            {/* Mobile Overlay */}
            {mobileOpen && (
                <div className="lg:hidden fixed inset-0 z-50 flex">
                    <div
                        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
                        onClick={() => setMobileOpen(false)}
                    />
                    <aside className="relative z-10 w-[248px] bg-white shadow-xl flex flex-col">
                        <button
                            onClick={() => setMobileOpen(false)}
                            className="absolute top-4 right-3 p-1.5 text-slate-400 hover:text-slate-700 rounded-lg transition-colors"
                            aria-label="Close sidebar"
                        >
                            <X className="h-4 w-4" aria-hidden />
                        </button>
                        <SidebarContent onClose={() => setMobileOpen(false)} />
                    </aside>
                </div>
            )}

            {/* Main content */}
            <div className="flex-1 flex flex-col min-w-0 overflow-hidden">

                {/* Mobile top bar */}
                <header className="lg:hidden flex items-center gap-3 px-4 h-[60px] bg-white border-b border-slate-200 shrink-0">
                    <button
                        onClick={() => setMobileOpen(true)}
                        className="p-2 -ml-1 text-slate-500 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition-colors"
                        aria-label="Open sidebar"
                    >
                        <Menu className="h-5 w-5" aria-hidden />
                    </button>
                    <Link to="/" className="flex items-center gap-2">
                        <div className="bg-ocean-bright p-1.5 rounded-lg">
                            <Mic className="h-4 w-4 text-white" aria-hidden />
                        </div>
                        <span className="font-bold text-ocean-navy tracking-tight">ELVA</span>
                    </Link>
                </header>

                {/* Subscription expiry banner */}
                {showExpiryBanner && (
                    <div className="flex items-center justify-center gap-3 px-4 py-2 bg-amber-50 border-b border-amber-200 shrink-0">
                        <AlertCircle className="h-4 w-4 text-amber-600 shrink-0" aria-hidden />
                        <p className="text-sm text-amber-900">
                            Your subscription is{' '}
                            <span className="font-semibold capitalize">{subscription!.status.replace('_', ' ')}</span>.
                        </p>
                        <button
                            onClick={() => navigate('/subscription')}
                            className="shrink-0 text-sm font-semibold text-amber-700 hover:text-amber-900 underline"
                        >
                            Renew now →
                        </button>
                    </div>
                )}

                {/* Unverified email banner */}
                {showUnverifiedBanner && (
                    <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 px-4 py-2 bg-blue-50 border-b border-blue-200 shrink-0">
                        <span className="inline-flex items-center gap-1.5 text-sm text-blue-900">
                            <MailWarning className="h-4 w-4 text-blue-500 shrink-0" aria-hidden />
                            Please verify your email address to unlock all features.
                        </span>
                        {resendDone ? (
                            <span className="text-sm font-semibold text-blue-600">Sent! Check your inbox.</span>
                        ) : (
                            <button
                                onClick={handleResendVerification}
                                disabled={resendCooldown}
                                className="shrink-0 text-sm font-semibold text-blue-700 hover:text-blue-900 underline disabled:opacity-50"
                            >
                                {resendCooldown ? 'Sent!' : 'Resend verification email →'}
                            </button>
                        )}
                    </div>
                )}

                <main className="flex-1 overflow-y-auto bg-white">
                    <AnimatePresence mode="wait" initial={false}>
                        <motion.div
                            key={location.pathname}
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -6 }}
                            transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
                        >
                            {children}
                        </motion.div>
                    </AnimatePresence>
                </main>
            </div>
        </div>
    );
}
