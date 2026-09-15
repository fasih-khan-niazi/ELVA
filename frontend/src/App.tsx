import { useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import PlatformDashboard from './pages/PlatformDashboard';
import CreateAgent from './pages/CreateAgent';
import Chat from './pages/Chat';
import Home from './pages/Home';
import About from './pages/About';
import Subscription from './pages/Subscription';
import PaymentSuccess from './pages/PaymentSuccess';
import VoiceAnalytics from './pages/VoiceAnalytics';
import GlobalAnalytics from './pages/GlobalAnalytics';
import ChatAnalytics from './pages/ChatAnalytics';
import VoiceCallHistory from './pages/VoiceCallHistory';
import EditAgent from './pages/EditAgent';
import OrdersPage from './pages/OrdersPage';
import LeadsPage from './pages/LeadsPage';
import AnalyticsPage from './pages/AnalyticsPage';
import CampaignsPage from './pages/CampaignsPage';
import CampaignDetailPage from './pages/CampaignDetailPage';
import CreateCampaignPage from './pages/CreateCampaignPage';
import AgentKnowledgeBasePage from './pages/AgentKnowledgeBasePage';
import ConnectorsPage from './pages/ConnectorsPage';
import AgentConnectorsPage from './pages/AgentConnectorsPage';
import WebsiteChatSetupPage from './pages/WebsiteChatSetupPage';
import Profile from './pages/Profile';
import DocsPage from './pages/DocsPage';
import TermsPage from './pages/TermsPage';
import AcceptInvite from './pages/AcceptInvite';
import ForgotPassword from './pages/ForgotPassword';
import ResetPassword from './pages/ResetPassword';
import VerifyEmail from './pages/VerifyEmail';
import Navbar from './components/Navbar';
import DashboardLayout from './components/DashboardLayout';
import { Toaster } from 'react-hot-toast';
import { ToastProvider } from './components/Toast';
import { AuthProvider, useAuth } from './context/AuthContext';
import { RouteGuardSkeleton } from './components/skeletons';

/** Reset window scroll on navigation. */
function ScrollToTop() {
    const { pathname, search } = useLocation();
    useEffect(() => {
        window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
    }, [pathname, search]);
    return null;
}

/**
 * All route path prefixes that belong to the authenticated app shell
 * (i.e. they get the sidebar layout and no top navbar).
 */
const APP_SHELL_PATHS = [
    '/dashboard',
    '/create-agent',
    '/agents/',
    '/chat/',
    '/voice-analytics',
    '/global-analytics',
    '/chat-analytics',
    '/voice-history/',
    '/orders/',
    '/leads/',
    '/analytics/',
    '/campaigns',
    '/connectors',
    '/profile',
    '/subscription',
    '/payment-success',
];

function isAppShellPath(pathname: string): boolean {
    return APP_SHELL_PATHS.some(p => {
        if (p.endsWith('/')) return pathname.startsWith(p);
        return pathname === p || pathname.startsWith(p + '/');
    });
}

// Protected route that requires subscription
function ProtectedRoute({ children }: { children: React.ReactNode }) {
    const { isAuthenticated, subscription, isLoading, user } = useAuth();

    if (isLoading) {
        return <RouteGuardSkeleton />;
    }

    if (!isAuthenticated) return <Navigate to="/login" />;

    const subscriptionReady =
        subscription &&
        ['active', 'trialing'].includes(subscription.status) &&
        subscription.plan;

    const emailVerified =
        user?.emailVerified !== false || user?.authProvider === 'google';

    // Subscription onboarding: unverified users may stay on /subscription until a plan is active.
    if (!emailVerified && !subscriptionReady) {
        return <Navigate to="/subscription" replace />;
    }

    if (!subscriptionReady) {
        if (user?.role === 'platform_admin') return <Navigate to="/platform" replace />;
        return <Navigate to="/subscription" />;
    }

    return <>{children}</>;
}

// Route that requires auth but not necessarily subscription
function AuthRoute({ children }: { children: React.ReactNode }) {
    const { isAuthenticated, isLoading } = useAuth();

    if (isLoading) {
        return <RouteGuardSkeleton />;
    }

    if (!isAuthenticated) return <Navigate to="/login" />;
    return <>{children}</>;
}

/** Workspace administrators only (business_admin). */
function AdminRoute({ children }: { children: React.ReactNode }) {
    const { user, isLoading } = useAuth();

    if (isLoading) {
        return <RouteGuardSkeleton />;
    }

    if (user?.role !== 'business_admin') return <Navigate to="/dashboard" replace />;
    return <>{children}</>;
}

function PlatformRoute({ children }: { children: React.ReactNode }) {
    const { user, isLoading } = useAuth();

    if (isLoading) {
        return <RouteGuardSkeleton />;
    }

    if (user?.role !== 'platform_admin') return <Navigate to="/dashboard" replace />;
    return <>{children}</>;
}

function AppRoutes() {
    const { isAuthenticated, subscription, user } = useAuth();
    const location = useLocation();

    /** Full-bleed auth shell: no layout at all. */
    const isFullBleedAuth =
        location.pathname === '/login' ||
        location.pathname === '/forgot-password' ||
        location.pathname.startsWith('/reset-password/') ||
        location.pathname.startsWith('/verify-email/') ||
        location.pathname.startsWith('/invite/');

    /** Dashboard app shell: sidebar layout, no top navbar.
     *  Platform admins are NEVER wrapped in DashboardLayout — they have their own
     *  standalone UI and should never see the business-user sidebar. */
    const isDashboardShell =
        !isFullBleedAuth &&
        isAppShellPath(location.pathname) &&
        user?.role !== 'platform_admin';

    const getPostLoginRedirect = () => {
        if (user?.role === 'platform_admin') return '/platform';
        if (!subscription) return '/subscription';
        return '/dashboard';
    };

    const routes = (
        <Routes>
            {/* ── Public ────────────────────────────────────────────────── */}
            <Route path="/" element={<Home />} />
            <Route path="/about" element={<About />} />
            <Route path="/docs" element={<DocsPage />} />
            <Route path="/docs/:slug" element={<DocsPage />} />
            <Route path="/legal/terms" element={<TermsPage />} />
            <Route path="/invite/:token" element={<AcceptInvite />} />
            <Route path="/forgot-password" element={<ForgotPassword />} />
            <Route path="/reset-password/:token" element={<ResetPassword />} />
            <Route path="/verify-email/:token" element={<VerifyEmail />} />
            <Route
                path="/login"
                element={
                    /* Allow authenticated users through when adding a second account */
                    !isAuthenticated || new URLSearchParams(window.location.search).get('addAccount') === 'true'
                        ? <Login />
                        : <Navigate to={getPostLoginRedirect()} />
                }
            />

            {/* ── Platform admin ────────────────────────────────────────── */}
            <Route
                path="/platform"
                element={
                    <AuthRoute>
                        <PlatformRoute>
                            <PlatformDashboard />
                        </PlatformRoute>
                    </AuthRoute>
                }
            />

            {/* ── Auth-only (no sub required) ───────────────────────────── */}
            <Route
                path="/subscription"
                element={<AuthRoute><Subscription /></AuthRoute>}
            />
            <Route
                path="/profile"
                element={<AuthRoute><Profile /></AuthRoute>}
            />
            <Route
                path="/payment-success"
                element={<AuthRoute><PaymentSuccess /></AuthRoute>}
            />

            {/* ── Protected (active subscription required) ──────────────── */}
            <Route
                path="/dashboard"
                element={<ProtectedRoute><Dashboard /></ProtectedRoute>}
            />
            <Route
                path="/create-agent"
                element={<ProtectedRoute><CreateAgent /></ProtectedRoute>}
            />
            <Route
                path="/agents/:agentId/edit"
                element={<ProtectedRoute><EditAgent /></ProtectedRoute>}
            />
            <Route
                path="/agents/:agentId/website-chat"
                element={<ProtectedRoute><WebsiteChatSetupPage /></ProtectedRoute>}
            />
            <Route
                path="/chat/:agentId"
                element={<ProtectedRoute><Chat /></ProtectedRoute>}
            />
            <Route
                path="/voice-analytics"
                element={<ProtectedRoute><VoiceAnalytics /></ProtectedRoute>}
            />
            <Route
                path="/global-analytics"
                element={
                    <ProtectedRoute>
                        <AdminRoute><GlobalAnalytics /></AdminRoute>
                    </ProtectedRoute>
                }
            />
            <Route
                path="/chat-analytics"
                element={<ProtectedRoute><ChatAnalytics /></ProtectedRoute>}
            />
            <Route
                path="/voice-history/:agentId"
                element={<ProtectedRoute><VoiceCallHistory /></ProtectedRoute>}
            />
            <Route
                path="/orders/:agentId"
                element={<ProtectedRoute><OrdersPage /></ProtectedRoute>}
            />
            <Route
                path="/leads/:agentId"
                element={<ProtectedRoute><LeadsPage /></ProtectedRoute>}
            />
            <Route
                path="/analytics/:agentId"
                element={<ProtectedRoute><AnalyticsPage /></ProtectedRoute>}
            />
            <Route
                path="/campaigns"
                element={<ProtectedRoute><CampaignsPage /></ProtectedRoute>}
            />
            <Route
                path="/campaigns/create"
                element={<ProtectedRoute><CreateCampaignPage /></ProtectedRoute>}
            />
            <Route
                path="/campaigns/:id"
                element={<ProtectedRoute><CampaignDetailPage /></ProtectedRoute>}
            />
            <Route
                path="/agents/:agentId/knowledge-base"
                element={<ProtectedRoute><AgentKnowledgeBasePage /></ProtectedRoute>}
            />
            <Route
                path="/connectors"
                element={<ProtectedRoute><ConnectorsPage /></ProtectedRoute>}
            />
            <Route
                path="/agents/:agentId/connectors"
                element={<ProtectedRoute><AgentConnectorsPage /></ProtectedRoute>}
            />
        </Routes>
    );

    /* Full-bleed auth pages (login / invite)  - no layout */
    if (isFullBleedAuth) {
        return (
            <div className="fixed inset-0 z-[40] overflow-hidden bg-ocean-powder flex flex-col">
                <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
                    {routes}
                </div>
            </div>
        );
    }

    /* Dashboard app shell  - sidebar layout, no top Navbar */
    if (isDashboardShell) {
        return (
            <DashboardLayout>
                {routes}
            </DashboardLayout>
        );
    }

    /* Public pages (Home, About, Docs, Platform, etc.)  - top Navbar */
    return (
        <div className="min-h-screen bg-gradient-to-b from-white to-ocean-powder text-ocean-deep font-normal antialiased">
            <Navbar />
            {routes}
        </div>
    );
}

function App() {
    return (
        <AuthProvider>
            <ToastProvider>
                <Router>
                    <ScrollToTop />
                    <AppRoutes />
                </Router>
                {/* Toaster container - custom cards are rendered by Toast.tsx via toast.custom() */}
                <Toaster
                    position="top-center"
                    containerClassName="!top-4 !z-[9999]"
                    gutter={10}
                    toastOptions={{
                        duration: 3000,
                        style: { background: 'transparent', boxShadow: 'none', padding: 0 },
                    }}
                />
            </ToastProvider>
        </AuthProvider>
    );
}

export default App;
