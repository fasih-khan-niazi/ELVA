/**
 * VoiceTestPanel — browser WebRTC test call for inbound voice agents.
 */

import { useState, useEffect, useLayoutEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Device, Call } from '@twilio/voice-sdk';
import {
    Phone,
    PhoneOff,
    Mic,
    MicOff,
    X,
    Loader2,
    Radio,
    Waves,
    ShoppingBag,
    User,
    CheckCircle2,
} from 'lucide-react';
import { formatMoney } from '../utils/currency';
import { useToast } from './Toast';

interface VoiceTestPanelProps {
    agentId: string;
    /** Dashboard label shown in modal header. */
    agentName: string;
    /** Persona name for transcript bubbles (falls back to token API). */
    speakingName?: string;
    tenantId: string;
    token: string;
    onClose: () => void;
    /** When true, starts connecting as soon as the panel opens (dashboard test button). */
    autoStart?: boolean;
}

type CallStatus =
    | 'idle'
    | 'fetching-token'
    | 'connecting'
    | 'ringing'
    | 'connected'
    | 'disconnected'
    | 'error';

interface LiveTurn {
    turnIndex: number;
    inputTranscript: string;
    aiResponse: string;
    intent?: string;
}

interface OrderItem {
    name?: string;
    quantity?: number;
    price?: number;
}

interface OrderSnapshot {
    status?: string;
    detail_step?: string;
    order_type?: string;
    items?: OrderItem[];
    customer?: { name?: string; phone?: string; email?: string };
    total?: number;
    subtotal?: number;
    delivery_charge?: number;
    _last_order_id?: string;
}

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3000';

function formatDuration(s: number) {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m}:${sec.toString().padStart(2, '0')}`;
}

function orderTotal(snapshot: OrderSnapshot | null): number | null {
    if (!snapshot) return null;
    if (typeof snapshot.total === 'number') return snapshot.total;
    const items = snapshot.items || [];
    const itemsSum = items.reduce((acc, it) => acc + (it.price || 0) * (it.quantity || 1), 0);
    const delivery = snapshot.delivery_charge ?? 0;
    if (typeof snapshot.subtotal === 'number') {
        return snapshot.subtotal + delivery;
    }
    if (itemsSum > 0) return itemsSum + delivery;
    return null;
}

function orderSubtotal(snapshot: OrderSnapshot | null): number | null {
    if (!snapshot) return null;
    if (typeof snapshot.subtotal === 'number') return snapshot.subtotal;
    const items = snapshot.items || [];
    const sum = items.reduce((acc, it) => acc + (it.price || 0) * (it.quantity || 1), 0);
    return sum > 0 ? sum : null;
}

export default function VoiceTestPanel({
    agentId,
    agentName,
    speakingName: speakingNameProp,
    tenantId,
    token,
    onClose,
    autoStart = false,
}: VoiceTestPanelProps) {
    const toast = useToast();
    const [status, setStatus] = useState<CallStatus>('idle');
    const [error, setError] = useState<string | null>(null);
    const [muted, setMuted] = useState(false);
    const [duration, setDuration] = useState(0);
    const [showEndConfirm, setShowEndConfirm] = useState(false);
    const [callSid, setCallSid] = useState<string | null>(null);
    const [turns, setTurns] = useState<LiveTurn[]>([]);
    const [orderSnapshot, setOrderSnapshot] = useState<OrderSnapshot | null>(null);
    const [confirmedOrder, setConfirmedOrder] = useState<OrderSnapshot | null>(null);
    const [speakingName, setSpeakingName] = useState(speakingNameProp || agentName);
    const [currency, setCurrency] = useState('PKR');
    const [serverTurnCount, setServerTurnCount] = useState(0);

    const deviceRef = useRef<Device | null>(null);
    const callRef = useRef<Call | null>(null);
    const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const callSidRef = useRef<string | null>(null);
    const autoStartedRef = useRef(false);
    const transcriptEndRef = useRef<HTMLDivElement | null>(null);
    const transcriptScrollRef = useRef<HTMLDivElement | null>(null);
    const lastSeenTurnIndexRef = useRef(-1);

    const cleanup = useCallback(() => {
        if (timerRef.current) {
            clearInterval(timerRef.current);
            timerRef.current = null;
        }
        if (callRef.current) {
            try {
                callRef.current.disconnect();
            } catch {
                /* ignore */
            }
            callRef.current = null;
        }
        if (deviceRef.current) {
            try {
                deviceRef.current.destroy();
            } catch {
                /* ignore */
            }
            deviceRef.current = null;
        }
    }, []);

    useEffect(() => () => {
        cleanup();
    }, [cleanup]);

    const extractCallSid = useCallback((call: Call) => {
        const sid =
            call.parameters?.CallSid
            || (call.customParameters?.get?.('CallSid') as string | undefined)
            || null;
        if (sid) {
            setCallSid(sid);
            callSidRef.current = sid;
        }
    }, []);

    const fetchLiveData = useCallback(async (sid: string) => {
        try {
            const resp = await fetch(`${API_BASE}/api/voice/browser/calls/${sid}/live`, {
                headers: { Authorization: `Bearer ${token}` },
            });
            if (!resp.ok) return;
            const data = await resp.json();
            if (typeof data.currency === 'string') {
                setCurrency(data.currency);
            }
            if (typeof data.turnCount === 'number') {
                setServerTurnCount(data.turnCount);
            }
            if (Array.isArray(data.turns)) {
                const incoming: LiveTurn[] = data.turns;
                const lastIdx = incoming.length > 0 ? incoming[incoming.length - 1].turnIndex : -1;
                setTurns((prev) => {
                    if (
                        prev.length === incoming.length
                        && lastIdx === lastSeenTurnIndexRef.current
                        && prev[prev.length - 1]?.aiResponse === incoming[incoming.length - 1]?.aiResponse
                    ) {
                        return prev;
                    }
                    lastSeenTurnIndexRef.current = lastIdx;
                    return incoming;
                });
            }
            if (data.orderSnapshot !== undefined) {
                setOrderSnapshot(data.orderSnapshot);
                if (data.orderSnapshot?.status === 'submitted') {
                    setConfirmedOrder(data.orderSnapshot);
                }
            }
        } catch {
            /* polling — ignore transient errors */
        }
    }, [token]);

    useEffect(() => {
        if (!callSid) return;
        void fetchLiveData(callSid);
        const pollMs = status === 'connected' ? 800 : 2000;
        const poll = setInterval(() => void fetchLiveData(callSid), pollMs);
        return () => {
            clearInterval(poll);
        };
    }, [callSid, status, fetchLiveData]);

    const isActive = status === 'connected' || status === 'ringing';
    const isLoading = status === 'fetching-token' || status === 'connecting';
    const activeOrderPanel = orderSnapshot?.status === 'submitted'
        ? orderSnapshot
        : confirmedOrder;
    const showSubmittedCard = activeOrderPanel?.status === 'submitted';
    const showLiveCart =
        !showSubmittedCard
        && (orderSnapshot?.items?.length ?? 0) > 0
        && ['collecting', 'awaiting_details', 'reviewing'].includes(orderSnapshot?.status || '');
    const showReviewCard =
        !showSubmittedCard
        && (
            orderSnapshot?.status === 'reviewing'
            || orderSnapshot?.detail_step === 'review'
        );
    const orderPanelSnapshot = showSubmittedCard
        ? activeOrderPanel
        : showReviewCard || showLiveCart
            ? orderSnapshot
            : null;
    const isAgentResponding =
        status === 'connected'
        && serverTurnCount > turns.length
        && turns.length > 0
        && !turns[turns.length - 1]?.aiResponse;

    useLayoutEffect(() => {
        const el = transcriptScrollRef.current;
        if (!el) return;
        el.scrollTop = el.scrollHeight;
    }, [turns, serverTurnCount, isAgentResponding]);

    const startCall = useCallback(async () => {
        setError(null);
        setTurns([]);
        setOrderSnapshot(null);
        setConfirmedOrder(null);
        setServerTurnCount(0);
        lastSeenTurnIndexRef.current = -1;
        setCallSid(null);
        callSidRef.current = null;
        setStatus('fetching-token');

        try {
            const resp = await fetch(`${API_BASE}/api/voice/browser/token/${agentId}`, {
                headers: { Authorization: `Bearer ${token}` },
            });

            if (!resp.ok) {
                const body = await resp.json().catch(() => ({}));
                throw new Error(body.error || `Token request failed (${resp.status})`);
            }

            const body = await resp.json();
            const { token: twilioToken, speakingName: apiSpeaking, personaName, currency: apiCurrency } = body;
            if (apiSpeaking || personaName) {
                setSpeakingName(apiSpeaking || personaName);
            } else if (speakingNameProp) {
                setSpeakingName(speakingNameProp);
            }
            if (apiCurrency) setCurrency(apiCurrency);
            setStatus('connecting');

            const device = new Device(twilioToken, {
                codecPreferences: [Call.Codec.Opus, Call.Codec.PCMU],
                logLevel: 1,
            });
            deviceRef.current = device;

            const call = await device.connect({ params: { agentId, tenantId } });
            callRef.current = call;
            setStatus('ringing');
            extractCallSid(call);

            call.on('ringing', () => extractCallSid(call));
            call.on('accept', () => {
                extractCallSid(call);
                setStatus('connected');
                setDuration(0);
                timerRef.current = setInterval(() => setDuration((d) => d + 1), 1000);
            });

            call.on('disconnect', () => {
                setStatus('disconnected');
                if (timerRef.current) {
                    clearInterval(timerRef.current);
                    timerRef.current = null;
                }
                if (callSidRef.current) void fetchLiveData(callSidRef.current);
            });

            call.on('cancel', () => {
                setStatus('disconnected');
                if (timerRef.current) {
                    clearInterval(timerRef.current);
                    timerRef.current = null;
                }
            });

            call.on('error', (err: { message?: string }) => {
                const msg = err?.message || 'Call error';
                setError(msg);
                toast.error('Call error', msg);
                setStatus('error');
                if (timerRef.current) {
                    clearInterval(timerRef.current);
                    timerRef.current = null;
                }
            });
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : 'Failed to start call';
            setError(msg);
            toast.error('Could not start call', msg);
            setStatus('error');
        }
    }, [agentId, tenantId, token, extractCallSid, fetchLiveData, speakingNameProp]);

    useEffect(() => {
        if (speakingNameProp) setSpeakingName(speakingNameProp);
    }, [speakingNameProp]);

    useEffect(() => {
        if (autoStart && !autoStartedRef.current) {
            autoStartedRef.current = true;
            void startCall();
        }
    }, [autoStart, startCall]);

    const requestClose = () => {
        if (isActive) {
            setShowEndConfirm(true);
            return;
        }
        cleanup();
        onClose();
    };

    const confirmEndAndClose = () => {
        setShowEndConfirm(false);
        callRef.current?.disconnect();
        cleanup();
        setStatus('disconnected');
        onClose();
    };

    const endCall = () => {
        callRef.current?.disconnect();
        cleanup();
        setStatus('disconnected');
    };

    const toggleMute = () => {
        if (!callRef.current) return;
        const next = !muted;
        callRef.current.mute(next);
        setMuted(next);
    };

    const statusLabel: Record<CallStatus, string> = {
        idle: 'Ready when you are',
        'fetching-token': 'Setting up your call…',
        connecting: 'Connecting…',
        ringing: 'Ringing…',
        connected: formatDuration(duration),
        disconnected: `Ended · ${formatDuration(duration)}`,
        error: 'Something went wrong',
    };

    const total = orderTotal(orderPanelSnapshot);
    const subtotal = orderSubtotal(orderPanelSnapshot);
    const deliveryCharge =
        orderPanelSnapshot?.delivery_charge ??
        (orderPanelSnapshot?.order_type === 'delivery' && total != null && subtotal != null
            ? Math.max(0, total - subtotal)
            : 0);

    const modal = (
        <div
            className="fixed inset-0 z-[9999] flex items-center justify-center p-4 sm:p-6"
            role="dialog"
            aria-modal="true"
            aria-labelledby="voice-test-title"
        >
            <div className="absolute inset-0 bg-slate-900/75 backdrop-blur-sm" aria-hidden />

            <div className="relative flex max-h-[90vh] w-full max-w-md flex-col overflow-hidden rounded-2xl bg-white shadow-2xl animate-fade-up">
                <div className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-100 bg-gradient-to-r from-ocean-navy to-ocean-deep px-5 py-4 text-white">
                    <div className="flex min-w-0 items-center gap-3">
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/15">
                            {isLoading ? (
                                <Loader2 className="h-5 w-5 animate-spin" aria-hidden />
                            ) : isActive ? (
                                <Waves className="h-5 w-5 animate-pulse" aria-hidden />
                            ) : (
                                <Radio className="h-5 w-5" aria-hidden />
                            )}
                        </div>
                        <div className="min-w-0">
                            <p className="text-[10px] font-semibold uppercase tracking-widest text-white/60">
                                {isLoading ? 'Connecting' : isActive ? 'Live call' : 'Test call'}
                            </p>
                            <h3 id="voice-test-title" className="truncate text-base font-bold">
                                {agentName}
                            </h3>
                        </div>
                    </div>
                    <button
                        type="button"
                        onClick={requestClose}
                        className="shrink-0 rounded-lg p-1.5 text-white/70 transition-colors hover:bg-white/10 hover:text-white"
                        aria-label="Close"
                    >
                        <X className="h-5 w-5" />
                    </button>
                </div>

                <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
                    <div className="shrink-0 px-5 pt-5 text-center">
                        <div className="mb-3 flex justify-center">
                            {isLoading ? (
                                <div className="relative flex h-16 w-16 items-center justify-center rounded-full bg-slate-50 ring-1 ring-slate-200">
                                    <span className="absolute inset-0 animate-ping rounded-full bg-ocean-bright/15" />
                                    <Loader2 className="relative h-8 w-8 animate-spin text-ocean-bright" />
                                </div>
                            ) : isActive ? (
                                <div className="relative flex h-16 w-16 items-center justify-center rounded-full bg-emerald-50 ring-2 ring-emerald-200">
                                    {status === 'connected' && (
                                        <>
                                            <span className="absolute inset-0 animate-ping rounded-full bg-emerald-400/20" />
                                            <Waves className="relative h-7 w-7 text-emerald-600 animate-pulse" />
                                        </>
                                    )}
                                    {status === 'ringing' && (
                                        <Phone className="h-7 w-7 text-ocean-bright animate-bounce" />
                                    )}
                                </div>
                            ) : (
                                <div className="flex h-16 w-16 items-center justify-center rounded-full bg-slate-50 ring-1 ring-slate-200">
                                    <Phone className="h-7 w-7 text-ocean-bright/80" />
                                </div>
                            )}
                        </div>

                        <p
                            className={`text-sm font-semibold ${
                                status === 'connected'
                                    ? 'text-emerald-700'
                                    : status === 'error'
                                        ? 'text-red-600'
                                        : 'text-slate-700'
                            }`}
                        >
                            {statusLabel[status]}
                        </p>
                    </div>

                    {orderPanelSnapshot && (showLiveCart || showReviewCard || showSubmittedCard) && (
                        <div
                            className={`mx-5 mt-3 shrink-0 rounded-xl border p-3 ${
                                showSubmittedCard
                                    ? 'border-emerald-200 bg-emerald-50/90'
                                    : showReviewCard
                                        ? 'border-amber-200 bg-amber-50/80'
                                        : 'border-sky-200 bg-sky-50/80'
                            }`}
                        >
                            <div className="mb-2 flex items-center gap-2">
                                {showSubmittedCard ? (
                                    <CheckCircle2 className="h-4 w-4 text-emerald-700" aria-hidden />
                                ) : (
                                    <ShoppingBag className={`h-4 w-4 ${showReviewCard ? 'text-amber-700' : 'text-sky-700'}`} aria-hidden />
                                )}
                                <p className={`text-xs font-bold uppercase tracking-wide ${
                                    showSubmittedCard
                                        ? 'text-emerald-800'
                                        : showReviewCard
                                            ? 'text-amber-800'
                                            : 'text-sky-800'
                                }`}>
                                    {showSubmittedCard
                                        ? 'Order placed'
                                        : showReviewCard
                                            ? 'Order review'
                                            : 'Your cart'}
                                </p>
                            </div>
                            <ul className="space-y-1">
                                {(orderPanelSnapshot.items || []).slice(0, 8).map((item, idx) => (
                                    <li
                                        key={`${item.name}-${idx}`}
                                        className={`flex justify-between text-xs ${
                                            showSubmittedCard
                                                ? 'text-emerald-950'
                                                : showReviewCard
                                                    ? 'text-amber-950'
                                                    : 'text-sky-950'
                                        }`}
                                    >
                                        <span className="truncate pr-2">
                                            {item.quantity && item.quantity > 1 ? `${item.quantity}× ` : ''}
                                            {item.name || 'Item'}
                                        </span>
                                        {item.price != null && item.price > 0 && (
                                            <span className="shrink-0 font-medium">
                                                {formatMoney(item.price * (item.quantity || 1), currency)}
                                            </span>
                                        )}
                                    </li>
                                ))}
                            </ul>
                            {orderPanelSnapshot.order_type && (
                                <p className={`mt-2 text-[11px] capitalize ${
                                    showSubmittedCard ? 'text-emerald-800/80' : showReviewCard ? 'text-amber-800/80' : 'text-sky-800/80'
                                }`}>
                                    {orderPanelSnapshot.order_type.replace(/-/g, ' ')}
                                </p>
                            )}
                            {orderPanelSnapshot.customer?.name && (
                                <p className={`mt-1 flex items-center gap-1 text-[11px] ${
                                    showSubmittedCard ? 'text-emerald-800/80' : showReviewCard ? 'text-amber-800/80' : 'text-sky-800/80'
                                }`}>
                                    <User className="h-3 w-3" aria-hidden />
                                    {orderPanelSnapshot.customer.name}
                                </p>
                            )}
                            {subtotal != null && deliveryCharge > 0 && (
                                <>
                                    <p className={`mt-2 flex justify-between text-[11px] ${
                                        showSubmittedCard ? 'text-emerald-900/90' : showReviewCard ? 'text-amber-900/90' : 'text-sky-900/90'
                                    }`}>
                                        <span>Subtotal</span>
                                        <span>{formatMoney(subtotal, currency)}</span>
                                    </p>
                                    <p className={`flex justify-between text-[11px] ${
                                        showSubmittedCard ? 'text-emerald-900/90' : showReviewCard ? 'text-amber-900/90' : 'text-sky-900/90'
                                    }`}>
                                        <span>Delivery</span>
                                        <span>{formatMoney(deliveryCharge, currency)}</span>
                                    </p>
                                </>
                            )}
                            {total != null && (
                                <p className={`mt-2 border-t pt-2 text-xs font-bold ${
                                    showSubmittedCard
                                        ? 'border-emerald-200/80 text-emerald-900'
                                        : showReviewCard
                                            ? 'border-amber-200/80 text-amber-900'
                                            : 'border-sky-200/80 text-sky-900'
                                }`}>
                                    Total {formatMoney(total, currency)}
                                </p>
                            )}
                            {showSubmittedCard && orderPanelSnapshot._last_order_id && (
                                <p className="mt-1 text-[10px] font-medium text-emerald-700/90">
                                    Ref #{String(orderPanelSnapshot._last_order_id).slice(-6).toUpperCase()}
                                </p>
                            )}
                            {showReviewCard && (
                                <p className="mt-1 text-[10px] text-amber-700/90">
                                    Say yes to confirm, or tell the agent what to change.
                                </p>
                            )}
                            {showLiveCart && (
                                <p className="mt-1 text-[10px] text-sky-700/90">
                                    Say place order when you are ready to checkout.
                                </p>
                            )}
                            {showSubmittedCard && (
                                <p className="mt-1 text-[10px] text-emerald-700/90">
                                    Your order is confirmed and being processed.
                                </p>
                            )}
                        </div>
                    )}

                    {(isActive || turns.length > 0) && (
                        <div
                            ref={transcriptScrollRef}
                            className="mx-5 mt-3 min-h-[120px] flex-1 overflow-y-auto rounded-xl border border-slate-100 bg-slate-50/80 p-3"
                        >
                            <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-slate-400">
                                Live transcript
                            </p>
                            {turns.length === 0 ? (
                                <p className="text-center text-xs text-slate-400 py-6">
                                    {isActive ? 'Listening…' : 'No transcript yet.'}
                                </p>
                            ) : (
                                <div className="space-y-3">
                                    {turns.map((turn) => (
                                        <div key={turn.turnIndex} className="space-y-2">
                                            {turn.inputTranscript && (
                                                <div className="flex justify-end">
                                                    <div className="max-w-[85%] rounded-2xl rounded-br-md bg-ocean-bright px-3 py-2 text-left">
                                                        <p className="text-[10px] font-semibold uppercase tracking-wide text-white/70">
                                                            You
                                                        </p>
                                                        <p className="text-xs leading-relaxed text-white">
                                                            {turn.inputTranscript}
                                                        </p>
                                                    </div>
                                                </div>
                                            )}
                                            {turn.aiResponse && (
                                                <div className="flex justify-start">
                                                    <div className="max-w-[85%] rounded-2xl rounded-bl-md border border-slate-200 bg-white px-3 py-2 text-left shadow-sm">
                                                        <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                                                            {speakingName}
                                                        </p>
                                                        <p className="text-xs leading-relaxed text-slate-700">
                                                            {turn.aiResponse}
                                                        </p>
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    ))}
                                    {isAgentResponding && (
                                        <div className="flex justify-start">
                                            <div className="rounded-2xl rounded-bl-md border border-slate-200 bg-white px-3 py-2 shadow-sm">
                                                <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                                                    {speakingName}
                                                </p>
                                                <p className="text-xs text-slate-500 animate-pulse">Responding…</p>
                                            </div>
                                        </div>
                                    )}
                                    <div ref={transcriptEndRef} />
                                </div>
                            )}
                        </div>
                    )}

                    <div className="shrink-0 px-5 py-4">
                        {status === 'disconnected' && (
                            <p className="mb-3 text-center text-xs text-slate-500">
                                Tap below to try again.
                            </p>
                        )}

                        {error && (
                            <div className="mb-3 rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-left">
                                <p className="text-xs text-red-700">{error}</p>
                            </div>
                        )}

                        {showEndConfirm && (
                            <div className="mb-3 rounded-xl border border-amber-100 bg-amber-50 px-4 py-3 text-left">
                                <p className="text-sm font-medium text-amber-900">End this test call?</p>
                                <p className="mt-1 text-xs text-amber-800/80">Your call will disconnect.</p>
                                <div className="mt-3 flex gap-2">
                                    <button
                                        type="button"
                                        onClick={() => setShowEndConfirm(false)}
                                        className="flex-1 rounded-lg border border-amber-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                                    >
                                        Keep talking
                                    </button>
                                    <button
                                        type="button"
                                        onClick={confirmEndAndClose}
                                        className="flex-1 rounded-lg bg-red-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-600"
                                    >
                                        End call
                                    </button>
                                </div>
                            </div>
                        )}

                        <div className="flex justify-center gap-3">
                            {(status === 'idle' || status === 'disconnected' || status === 'error') && (
                                <button
                                    type="button"
                                    onClick={startCall}
                                    disabled={isLoading}
                                    className="inline-flex items-center gap-2 rounded-xl bg-ocean-bright px-6 py-2.5 text-sm font-semibold text-white shadow-md transition-all hover:bg-ocean-rich active:scale-[0.98] disabled:opacity-50"
                                >
                                    <Phone className="h-4 w-4" />
                                    {status === 'disconnected' ? 'Call again' : 'Start test call'}
                                </button>
                            )}

                            {isActive && (
                                <>
                                    <button
                                        type="button"
                                        onClick={toggleMute}
                                        className={`rounded-xl border p-3 transition-all active:scale-95 ${
                                            muted
                                                ? 'border-amber-200 bg-amber-50 text-amber-700'
                                                : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                                        }`}
                                        title={muted ? 'Unmute' : 'Mute'}
                                    >
                                        {muted ? <MicOff className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
                                    </button>
                                    <button
                                        type="button"
                                        onClick={endCall}
                                        className="rounded-xl bg-red-500 p-3 text-white shadow-md transition-all hover:bg-red-600 active:scale-95"
                                        title="End call"
                                    >
                                        <PhoneOff className="h-5 w-5" />
                                    </button>
                                </>
                            )}

                            {isLoading && (
                                <button
                                    type="button"
                                    disabled
                                    className="inline-flex cursor-not-allowed items-center gap-2 rounded-xl bg-slate-100 px-5 py-2.5 text-sm font-medium text-slate-400"
                                >
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                    Connecting…
                                </button>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );

    return createPortal(modal, document.body);
}
