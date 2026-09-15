import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../components/Toast';
import { motion } from 'framer-motion';
import { pageStagger, pageEnter, listStagger, listItemEnter } from '@/lib/motion';
import { OrdersPageSkeleton } from '../components/skeletons';
import { PageBackNav } from '../components/PageBackNav';
import { fetchRatesFrom, type RatesMap } from '../utils/fxFromUsd';
import {
    Package, Clock, CheckCircle, XCircle, Truck,
    DollarSign, ShoppingBag, TrendingUp, RefreshCw, ChevronDown,
    User, Phone, Mail, MapPin, MessageSquare, Loader2,
    Download, FileText
} from 'lucide-react';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3000';
const DISPLAY_CURRENCY_KEY = 'elva_display_currency';

interface OrderItem {
    name: string;
    price: number;
    quantity: number;
    options?: Array<{ name: string; choice: string }>;
    notes?: string;
}

interface Order {
    _id: string;
    agentId: string;
    sessionId: string;
    channel: 'chat' | 'voice';
    status: 'pending' | 'confirmed' | 'preparing' | 'ready' | 'completed' | 'cancelled';
    currency?: string;
    items: OrderItem[];
    subtotal: number;
    tax: number;
    total: number;
    customerName?: string;
    customerPhone?: string;
    customerEmail?: string;
    customerAddress?: string;
    notes?: string;
    createdAt: string;
    updatedAt: string;
}

interface OrderStats {
    totalOrders: number;
    todayOrders: number;
    weekOrders: number;
    byStatus: Record<string, number>;
    /** Workspace admins only - aggregate rollups. */
    totalRevenue?: number;
    avgOrderValue?: number;
}

const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string; icon: any }> = {
    pending: { label: 'Pending', color: 'text-amber-700', bg: 'bg-amber-50 border-amber-200', icon: Clock },
    confirmed: { label: 'Confirmed', color: 'text-blue-700', bg: 'bg-blue-50 border-blue-200', icon: CheckCircle },
    preparing: { label: 'Preparing', color: 'text-purple-700', bg: 'bg-purple-50 border-purple-200', icon: Package },
    ready: { label: 'Ready', color: 'text-green-700', bg: 'bg-green-50 border-green-200', icon: Truck },
    completed: { label: 'Completed', color: 'text-ocean-deep', bg: 'bg-ocean-powder border-ocean-ice', icon: CheckCircle },
    cancelled: { label: 'Cancelled', color: 'text-red-700', bg: 'bg-red-50 border-red-200', icon: XCircle },
};

const STATUS_FLOW = ['pending', 'confirmed', 'preparing', 'ready', 'completed'];

const CURRENCY_SYMBOLS: Record<string, string> = {
    USD: '$', PKR: 'Rs.', EUR: '€', GBP: '£', INR: '₹',
    AED: 'AED ', SAR: 'SAR ', CAD: 'C$', AUD: 'A$',
};

export default function OrdersPage() {
    const { token, user } = useAuth();
    const isWorkspaceAdmin = user?.role === 'business_admin';
    const { agentId } = useParams<{ agentId: string }>();
    const toast = useToast();

    const [orders, setOrders] = useState<Order[]>([]);
    const [stats, setStats] = useState<OrderStats | null>(null);
    const [loading, setLoading] = useState(true);
    const [statusFilter, setStatusFilter] = useState<string>('all');
    const [expandedOrder, setExpandedOrder] = useState<string | null>(null);
    const [updatingStatus, setUpdatingStatus] = useState<string | null>(null);
    // Agent-level currency  - what the orders are stored in.
    const [agentCurrency, setAgentCurrency] = useState('PKR');
    // Global display currency set in GlobalAnalytics, persisted in localStorage.
    const displayCurrency = (localStorage.getItem(DISPLAY_CURRENCY_KEY) || agentCurrency).toUpperCase();
    const displaySym = CURRENCY_SYMBOLS[displayCurrency] || displayCurrency;
    // FX rates fetched with base = displayCurrency so we can convert any stored currency → displayCurrency.
    const [fxRates, setFxRates] = useState<RatesMap | null>(null);
    const fxFetchedForRef = useRef<string>('');

    /**
     * Convert `amount` (stored in `fromCurrency`) to `displayCurrency` for display.
     * Formula: since rates are base=displayCurrency, rates[fromCurrency] = how much fromCurrency = 1 displayCurrency.
     * So amount_display = amount / rates[fromCurrency].
     */
    const toDisplay = (amount: number, fromCurrency: string): string => {
        const from = (fromCurrency || agentCurrency).toUpperCase();
        const to = displayCurrency;
        if (from === to || !fxRates) return `${displaySym}${amount.toFixed(2)}`;
        const rate = fxRates[from];
        if (!rate || !Number.isFinite(rate)) return `${displaySym}${amount.toFixed(2)}`;
        return `${displaySym}${(amount / rate).toFixed(2)}`;
    };

    // Fetch FX rates whenever displayCurrency changes (skip if it matches agentCurrency  - no conversion needed).
    useEffect(() => {
        if (fxFetchedForRef.current === displayCurrency) return;
        fxFetchedForRef.current = displayCurrency;
        fetchRatesFrom(displayCurrency)
            .then(setFxRates)
            .catch(() => setFxRates(null));
    }, [displayCurrency]);

    const fetchOrders = useCallback(async () => {
        try {
            const url = `${API_BASE}/api/orders/${agentId}?status=${statusFilter}&limit=50`;
            const res = await fetch(url, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (res.ok) {
                const data = await res.json();
                setOrders(data.orders || []);
            } else {
                toast.error('Failed to load orders');
            }
        } catch (err) {
            console.error('Error fetching orders:', err);
            toast.error('Connection error', 'Could not reach server');
        } finally {
            setLoading(false);
        }
    }, [agentId, token, statusFilter]);

    const fetchStats = useCallback(async () => {
        try {
            const res = await fetch(`${API_BASE}/api/orders/stats/${agentId}`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (res.ok) {
                setStats(await res.json());
            }
        } catch (err) {
            console.error('Error fetching stats:', err);
        }
    }, [agentId, token]);

    useEffect(() => {
        fetchOrders();
        fetchStats();
        // Fetch agent currency
        (async () => {
            try {
                const res = await fetch(`${API_BASE}/api/agents/${agentId}`, {
                    headers: { 'Authorization': `Bearer ${token}` }
                });
                if (res.ok) {
                    const agent = await res.json();
                    setAgentCurrency((agent.currency || 'PKR').toUpperCase());
                }
            } catch (err) {
                console.error('Error fetching agent currency:', err);
            }
        })();
    }, [fetchOrders, fetchStats]);

    const updateStatus = async (orderId: string, newStatus: string) => {
        setUpdatingStatus(orderId);
        try {
            const res = await fetch(`${API_BASE}/api/orders/${agentId}/${orderId}/status`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({ status: newStatus })
            });
            if (res.ok) {
                await fetchOrders();
                await fetchStats();
            } else {
                toast.error('Update failed', 'Could not update order status');
            }
        } catch (err) {
            console.error('Error updating status:', err);
            toast.error('Connection error', 'Could not reach server');
        } finally {
            setUpdatingStatus(null);
        }
    };

    const exportCSV = async () => {
        try {
            const res = await fetch(`${API_BASE}/api/orders/export/${agentId}`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (!res.ok) { toast.error('Export failed'); return; }
            const blob = await res.blob();
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `orders_${new Date().toISOString().slice(0, 10)}.csv`;
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
        const rows = orders.map(o => `
            <tr>
                <td>#${o._id.slice(-6).toUpperCase()}</td>
                <td>${o.status}</td>
                <td>${o.channel}</td>
                <td>${o.customerName || '-'}</td>
                <td>${o.customerPhone || '-'}</td>
                <td>${o.items.map(i => `${i.name} x${i.quantity}`).join(', ')}</td>
                <td>${toDisplay(o.subtotal, o.currency || agentCurrency)}</td>
                <td>${toDisplay(o.tax, o.currency || agentCurrency)}</td>
                <td style="font-weight:600">${toDisplay(o.total, o.currency || agentCurrency)}</td>
                <td>${new Date(o.createdAt).toLocaleDateString()}</td>
            </tr>`).join('');
        const html = `<!DOCTYPE html><html><head><title>Orders Report</title>
        <style>
            body{font-family:Arial,sans-serif;margin:24px;color:#111}
            h1{color:#4f46e5;font-size:20px;margin-bottom:4px}
            .meta{color:#6b7280;font-size:12px;margin-bottom:16px}
            table{width:100%;border-collapse:collapse;font-size:11px}
            th{background:#eef2ff;padding:8px;text-align:left;border-bottom:2px solid #c7d2fe;color:#3730a3}
            td{padding:7px 8px;border-bottom:1px solid #f3f4f6}
            tr:nth-child(even) td{background:#f9fafb}
            .stats{display:flex;gap:16px;margin-bottom:16px}
            .stat{border:1px solid #e5e7eb;border-radius:8px;padding:10px 16px;text-align:center}
            .stat-val{font-size:22px;font-weight:700;color:#4f46e5}
            .stat-lbl{font-size:11px;color:#6b7280;margin-top:2px}
            @media print{body{margin:0}}
        </style></head><body>
        <h1>Orders Report</h1>
        <div class="meta">Exported ${new Date().toLocaleString()} &nbsp;·&nbsp; Showing ${orders.length} order(s) (current filter)</div>
        ${stats ? `<div class="stats">
            <div class="stat"><div class="stat-val">${stats.totalOrders}</div><div class="stat-lbl">Total Orders</div></div>
            <div class="stat"><div class="stat-val">${stats.todayOrders}</div><div class="stat-lbl">Today</div></div>
            ${isWorkspaceAdmin && stats.totalRevenue !== undefined && stats.avgOrderValue !== undefined ? `
            <div class="stat"><div class="stat-val">${toDisplay(stats.totalRevenue, agentCurrency)}</div><div class="stat-lbl">Revenue</div></div>
            <div class="stat"><div class="stat-val">${toDisplay(stats.avgOrderValue, agentCurrency)}</div><div class="stat-lbl">Avg Order</div></div>` : `
            <div class="stat"><div class="stat-val">${stats.weekOrders}</div><div class="stat-lbl">This week</div></div>`}
        </div>` : ''}
        <table><thead><tr>
            <th>Order ID</th><th>Status</th><th>Channel</th><th>Customer</th><th>Phone</th>
            <th>Items</th><th>Subtotal</th><th>Tax</th><th>Total</th><th>Date</th>
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

    const formatDate = (dateStr: string | null | undefined) => {
        if (!dateStr) return 'Unknown date';
        const d = new Date(dateStr);
        if (isNaN(d.getTime())) return 'Unknown date';
        const now = new Date();
        const diffMs = now.getTime() - d.getTime();
        const diffMin = Math.floor(diffMs / 60000);

        if (diffMin < 1) return 'Just now';
        if (diffMin < 60) return `${diffMin}m ago`;
        if (diffMin < 1440) return `${Math.floor(diffMin / 60)}h ago`;
        return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    };

    if (loading) {
        return <OrdersPageSkeleton />;
    }

    return (
        <motion.div
            className="bg-white pb-12"
            initial="hidden"
            animate="show"
            variants={pageStagger}
        >
            <motion.div variants={pageEnter} className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
                <PageBackNav to="/dashboard" label="Back to Dashboard" />
                <div className="flex items-center justify-between mb-8">
                    <div>
                        <h1 className="text-3xl font-bold text-ocean-navy flex items-center gap-2">
                            <ShoppingBag className="h-8 w-8 text-ocean-deep" />
                            Orders
                        </h1>
                        <p className="text-ocean-deep/80 mt-1">Manage incoming orders from your AI agent</p>
                    </div>
                    <div className="flex items-center gap-2">
                        <button
                            onClick={exportCSV}
                            className="flex items-center px-3 py-2 bg-white border border-ocean-ice rounded-lg hover:bg-ocean-powder text-sm font-medium text-ocean-deep"
                            title="Export all orders as CSV"
                        >
                            <Download className="h-4 w-4 mr-1.5 text-ocean-deep" /> CSV
                        </button>
                        <button
                            onClick={exportPDF}
                            className="flex items-center px-3 py-2 bg-white border border-ocean-ice rounded-lg hover:bg-ocean-powder text-sm font-medium text-ocean-deep"
                            title="Export current view as PDF"
                        >
                            <FileText className="h-4 w-4 mr-1.5 text-rose-500" /> PDF
                        </button>
                        <button
                            onClick={() => { fetchOrders(); fetchStats(); }}
                            className="flex items-center px-3 py-2 bg-white border border-ocean-ice rounded-lg hover:bg-ocean-powder text-sm font-medium text-ocean-deep"
                        >
                            <RefreshCw className="h-4 w-4 mr-1.5" /> Refresh
                        </button>
                    </div>
                </div>

                {/* Stats Cards */}
                {stats && (
                    <div className={`grid grid-cols-2 gap-4 mb-8 ${isWorkspaceAdmin ? 'md:grid-cols-4' : 'md:grid-cols-3'}`}>
                        <StatCard
                            title="Today's Orders"
                            value={stats.todayOrders}
                            icon={<ShoppingBag className="h-5 w-5" />}
                            gradient="from-blue-500 to-cyan-500"
                        />
                        <StatCard
                            title="This Week"
                            value={stats.weekOrders}
                            icon={<TrendingUp className="h-5 w-5" />}
                            gradient="from-ocean-deep to-ocean-rich"
                        />
                        {isWorkspaceAdmin && stats.totalRevenue !== undefined && stats.avgOrderValue !== undefined ? (
                            <>
                                <StatCard
                                    title="Total Revenue"
                                    value={toDisplay(stats.totalRevenue, agentCurrency)}
                                    icon={<DollarSign className="h-5 w-5" />}
                                    gradient="from-green-500 to-emerald-500"
                                />
                                <StatCard
                                    title="Avg Order"
                                    value={toDisplay(stats.avgOrderValue, agentCurrency)}
                                    icon={<DollarSign className="h-5 w-5" />}
                                    gradient="from-amber-500 to-orange-500"
                                />
                            </>
                        ) : (
                            <StatCard
                                title="All orders"
                                value={stats.totalOrders}
                                icon={<Package className="h-5 w-5" />}
                                gradient="from-violet-500 to-purple-500"
                            />
                        )}
                    </div>
                )}

                {/* Status Filter */}
                <div className="flex gap-2 mb-6 flex-wrap">
                    {['all', ...Object.keys(STATUS_CONFIG)].map((status) => {
                        const config = status === 'all' ? null : STATUS_CONFIG[status];
                        const count = status === 'all'
                            ? orders.length
                            : stats?.byStatus?.[status] || 0;
                        return (
                            <button
                                key={status}
                                onClick={() => setStatusFilter(status)}
                                className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                                    statusFilter === status
                                        ? 'bg-ocean-deep text-white shadow-md'
                                        : 'bg-white text-ocean-deep/90 border border-ocean-ice hover:bg-ocean-powder'
                                }`}
                            >
                                {status === 'all' ? 'All' : config?.label} ({count})
                            </button>
                        );
                    })}
                </div>

                {/* Orders List */}
                {orders.length === 0 ? (
                    <div className="text-center py-20 bg-white rounded-2xl border border-ocean-ice/80">
                        <ShoppingBag className="h-16 w-16 text-gray-300 mx-auto mb-4" />
                        <h3 className="text-xl font-semibold text-ocean-navy mb-2">No orders yet</h3>
                        <p className="text-ocean-deep/80">Orders placed through your AI agent will appear here.</p>
                    </div>
                ) : (
                    <motion.div className="space-y-4" initial="hidden" animate="show" variants={listStagger}>
                        {orders.map((order) => {
                            const statusCfg = STATUS_CONFIG[order.status] || STATUS_CONFIG.pending;
                            const StatusIcon = statusCfg.icon;
                            const isExpanded = expandedOrder === order._id;
                            const nextStatus = getNextStatus(order.status);

                            return (
                                <motion.div
                                    key={order._id}
                                    variants={listItemEnter}
                                    className="bg-white rounded-xl border border-ocean-ice shadow-sm hover:shadow-md transition-all overflow-hidden"
                                >
                                    {/* Order Header */}
                                    <div
                                        className="flex items-center justify-between p-5 cursor-pointer"
                                        onClick={() => setExpandedOrder(isExpanded ? null : order._id)}
                                    >
                                        <div className="flex items-center gap-4">
                                            <div className={`p-2 rounded-lg border ${statusCfg.bg}`}>
                                                <StatusIcon className={`h-5 w-5 ${statusCfg.color}`} />
                                            </div>
                                            <div>
                                                <div className="flex items-center gap-2">
                                                    <span className="font-semibold text-ocean-navy">
                                                        #{order._id.slice(-6).toUpperCase()}
                                                    </span>
                                                    <span className={`text-xs px-2 py-0.5 rounded-full border ${statusCfg.bg} ${statusCfg.color}`}>
                                                        {statusCfg.label}
                                                    </span>
                                                    <span className={`text-xs px-2 py-0.5 rounded-full ${
                                                        order.channel === 'voice'
                                                            ? 'bg-purple-50 text-purple-700'
                                                            : 'bg-blue-50 text-blue-700'
                                                    }`}>
                                                        {order.channel === 'voice' ? 'Voice' : 'Chat'}
                                                    </span>
                                                </div>
                                                <div className="text-sm text-ocean-deep/80 mt-0.5">
                                                    {order.items.length} item{order.items.length !== 1 ? 's' : ''} · {formatDate(order.createdAt)}
                                                    {order.customerName && ` · ${order.customerName}`}
                                                </div>
                                            </div>
                                        </div>

                                        <div className="flex items-center gap-4">
                                            <span className="text-lg font-bold text-ocean-navy">
                                                {toDisplay(order.total, order.currency || agentCurrency)}
                                            </span>

                                            {nextStatus && order.status !== 'cancelled' && (
                                                <button
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        updateStatus(order._id, nextStatus);
                                                    }}
                                                    disabled={updatingStatus === order._id}
                                                    className="px-3 py-1.5 bg-ocean-deep text-white text-sm rounded-lg hover:bg-ocean-rich disabled:opacity-50 transition-colors"
                                                >
                                                    {updatingStatus === order._id ? (
                                                        <Loader2 className="h-4 w-4 animate-spin" />
                                                    ) : (
                                                        `→ ${STATUS_CONFIG[nextStatus]?.label}`
                                                    )}
                                                </button>
                                            )}

                                            {order.status === 'pending' && (
                                                <button
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        updateStatus(order._id, 'cancelled');
                                                    }}
                                                    disabled={updatingStatus === order._id}
                                                    className="px-3 py-1.5 bg-red-50 text-red-600 text-sm rounded-lg hover:bg-red-100 transition-colors"
                                                >
                                                    Cancel
                                                </button>
                                            )}

                                            <ChevronDown className={`h-5 w-5 text-ocean-deep/60 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                                        </div>
                                    </div>

                                    {/* Expanded Details */}
                                    {isExpanded && (
                                        <div className="border-t border-ocean-ice/80 p-5 bg-ocean-powder/80">
                                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                                {/* Items List */}
                                                <div>
                                                    <h4 className="text-sm font-semibold text-ocean-deep mb-3">Order Items</h4>
                                                    <div className="space-y-2">
                                                        {order.items.map((item, idx) => (
                                                            <div key={idx} className="flex justify-between items-start bg-white p-3 rounded-lg border border-ocean-ice/80">
                                                                <div>
                                                                    <span className="font-medium text-ocean-navy">{item.name}</span>
                                                                    <span className="text-ocean-deep/80 ml-2">x{item.quantity}</span>
                                                                    {item.options && item.options.length > 0 && (
                                                                        <div className="text-xs text-ocean-deep/80 mt-1">
                                                                            {item.options.map((opt, i) => (
                                                                                <span key={i} className="mr-2">{opt.name}: {opt.choice}</span>
                                                                            ))}
                                                                        </div>
                                                                    )}
                                                                    {item.notes && (
                                                                        <div className="text-xs text-amber-600 mt-1">Note: {item.notes}</div>
                                                                    )}
                                                                </div>
                                                                <span className="font-medium text-ocean-navy">
                                                                    {toDisplay(item.price * item.quantity, order.currency || agentCurrency)}
                                                                </span>
                                                            </div>
                                                        ))}
                                                    </div>
                                                    <div className="mt-3 pt-3 border-t border-ocean-ice flex justify-between text-sm">
                                                        <span className="text-ocean-deep/90">Subtotal</span>
                                                        <span className="font-medium">{toDisplay(order.subtotal, order.currency || agentCurrency)}</span>
                                                    </div>
                                                    {order.tax > 0 && (
                                                        <div className="flex justify-between text-sm mt-1">
                                                            <span className="text-ocean-deep/90">Tax</span>
                                                            <span>{toDisplay(order.tax, order.currency || agentCurrency)}</span>
                                                        </div>
                                                    )}
                                                    <div className="flex justify-between font-bold text-lg mt-2">
                                                        <span>Total</span>
                                                        <span>{toDisplay(order.total, order.currency || agentCurrency)}</span>
                                                    </div>
                                                </div>

                                                {/* Customer Info */}
                                                <div>
                                                    <h4 className="text-sm font-semibold text-ocean-deep mb-3">Customer Info</h4>
                                                    <div className="space-y-2 bg-white p-4 rounded-lg border border-ocean-ice/80">
                                                        {order.customerName && (
                                                            <div className="flex items-center gap-2 text-sm">
                                                                <User className="h-4 w-4 text-ocean-deep/60" />
                                                                <span>{order.customerName}</span>
                                                            </div>
                                                        )}
                                                        {order.customerPhone && (
                                                            <div className="flex items-center gap-2 text-sm">
                                                                <Phone className="h-4 w-4 text-ocean-deep/60" />
                                                                <span>{order.customerPhone}</span>
                                                            </div>
                                                        )}
                                                        {order.customerEmail && (
                                                            <div className="flex items-center gap-2 text-sm">
                                                                <Mail className="h-4 w-4 text-ocean-deep/60" />
                                                                <span>{order.customerEmail}</span>
                                                            </div>
                                                        )}
                                                        {order.customerAddress && (
                                                            <div className="flex items-center gap-2 text-sm">
                                                                <MapPin className="h-4 w-4 text-ocean-deep/60" />
                                                                <span>{order.customerAddress}</span>
                                                            </div>
                                                        )}
                                                        {!order.customerName && !order.customerPhone && !order.customerEmail && (
                                                            <p className="text-sm text-ocean-deep/60">No customer info provided</p>
                                                        )}
                                                    </div>

                                                    {order.notes && (
                                                        <div className="mt-3">
                                                            <h4 className="text-sm font-semibold text-ocean-deep mb-2">Notes</h4>
                                                            <div className="flex items-start gap-2 text-sm bg-white p-3 rounded-lg border border-ocean-ice/80">
                                                                <MessageSquare className="h-4 w-4 text-ocean-deep/60 mt-0.5" />
                                                                <span>{order.notes}</span>
                                                            </div>
                                                        </div>
                                                    )}

                                                    <div className="mt-3">
                                                        <h4 className="text-sm font-semibold text-ocean-deep mb-2">Details</h4>
                                                        <div className="text-xs text-ocean-deep/80 space-y-1 bg-white p-3 rounded-lg border border-ocean-ice/80">
                                                            <div>Session: <span className="font-mono">{order.sessionId}</span></div>
                                                            <div>Created: {new Date(order.createdAt).toLocaleString()}</div>
                                                            <div>Updated: {new Date(order.updatedAt).toLocaleString()}</div>
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    )}
                                </motion.div>
                            );
                        })}
                    </motion.div>
                )}
            </motion.div>
        </motion.div>
    );
}

function StatCard({ title, value, icon, gradient }: { title: string; value: string | number; icon: React.ReactNode; gradient: string }) {
    return (
        <div className="bg-white rounded-xl border border-ocean-ice/80 p-5 shadow-sm">
            <div className="flex items-center justify-between mb-3">
                <div className={`p-2 rounded-lg bg-gradient-to-r ${gradient}`}>
                    <div className="text-white">{icon}</div>
                </div>
            </div>
            <p className="text-sm text-ocean-deep/80">{title}</p>
            <p className="text-2xl font-bold text-ocean-navy mt-1">{value}</p>
        </div>
    );
}
