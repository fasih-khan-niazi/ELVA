import { useState, useEffect, useRef, useCallback } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { PageBackNav } from '../components/PageBackNav';
import { Send, Loader, AlertCircle, Bot, User, CheckCircle, MessageSquare, Plus, Clock, Zap } from 'lucide-react';
import { useToast } from '../components/Toast';
import { ChatSkeleton } from '../components/skeletons';
import { motion } from 'framer-motion';
import { listItemEnter } from '@/lib/motion';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3000';

interface Agent {
    _id: string;
    name: string;
    type: string;
    tone?: string;
}

interface Message {
    role: 'user' | 'assistant';
    content: string;
    timestamp: Date;
    // Server-side end-to-end latency for assistant turns. Lets us show
    // a real-time accuracy badge instead of a client-side stopwatch
    // (which would include browser/network jitter).
    latencyMs?: number;
}

interface SessionSummary {
    _id: string;
    sessionId: string;
    title: string;
    messageCount: number;
    updatedAt: string;
    createdAt: string;
}

function formatRelativeTime(dateStr: string): string {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString();
}

type ChatLocationState = { returnTo?: string };

export default function Chat() {
    const { token } = useAuth();
    const toast = useToast();
    const navigate = useNavigate();
    const location = useLocation();
    const { agentId } = useParams<{ agentId: string }>();
    const returnTo = (location.state as ChatLocationState | null)?.returnTo;
    const backHref = returnTo?.startsWith('/') ? returnTo : '/dashboard';
    const backLabel = returnTo?.includes('/website-chat')
        ? 'Back to Website Chat'
        : returnTo
          ? 'Back'
          : 'Back to Dashboard';

    const [agent, setAgent] = useState<Agent | null>(null);
    const [messages, setMessages] = useState<Message[]>([]);
    const [input, setInput] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [loadingAgent, setLoadingAgent] = useState(true);
    const [orderConfirmed, setOrderConfirmed] = useState(false);

    // History sidebar state
    const [sessions, setSessions] = useState<SessionSummary[]>([]);
    const [loadingSessions, setLoadingSessions] = useState(false);
    const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
    const [viewingHistory, setViewingHistory] = useState(false);

    // Current live session (read-write). MUST be regenerated when "New Chat"
    // is clicked, otherwise the AI service keeps loading old history and the
    // agent will continue the previous conversation (e.g. re-listing the menu).
    const [currentSessionId, setCurrentSessionId] = useState(
        () => `session_${agentId}_${Date.now()}`,
    );

    const messagesEndRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (agentId) {
            fetchAgent();
            fetchSessions();
        }
    }, [agentId]);

    // Auto-focus the input once the agent has loaded (loadingAgent flips false)
    useEffect(() => {
        if (!loadingAgent) {
            setTimeout(() => inputRef.current?.focus(), 0);
        }
    }, [loadingAgent]);

    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages, loading]);

    const fetchAgent = async () => {
        try {
            const response = await fetch(`${API_BASE}/api/agents/${agentId}`, {
                headers: { 'Authorization': `Bearer ${token}` },
            });
            if (response.ok) {
                setAgent(await response.json());
            } else {
                setError('Failed to load agent');
                toast.error('Could not load agent');
            }
        } catch {
            setError('Failed to load agent');
            toast.error('Connection error', 'Could not load agent');
        } finally {
            setLoadingAgent(false);
        }
    };

    const fetchSessions = async () => {
        setLoadingSessions(true);
        try {
            const response = await fetch(`${API_BASE}/api/chat/sessions/${agentId}`, {
                headers: { 'Authorization': `Bearer ${token}` },
            });
            if (response.ok) {
                const all: SessionSummary[] = await response.json();
                // Exclude the current live session - it's shown separately in the sidebar top
                setSessions(all.filter(s => s.sessionId !== currentSessionId));
            }
        } catch {
            // Non-fatal - sidebar just stays empty
        } finally {
            setLoadingSessions(false);
        }
    };

    const loadSession = async (sessionId: string) => {
        try {
            const response = await fetch(`${API_BASE}/api/chat/sessions/${agentId}/${sessionId}`, {
                headers: { 'Authorization': `Bearer ${token}` },
            });
            if (response.ok) {
                const data = await response.json();
                const loaded: Message[] = (data.messages || []).map((m: any) => ({
                    role: m.role,
                    content: m.content,
                    timestamp: new Date(m.timestamp),
                    latencyMs: typeof m.latencyMs === 'number' ? m.latencyMs : undefined,
                }));
                setMessages(loaded);
                setSelectedSessionId(sessionId);
                setViewingHistory(true);
                setError('');
            }
        } catch {
            setError('Failed to load conversation');
        }
    };

    const startNewChat = useCallback(() => {
        setMessages([]);
        setSelectedSessionId(null);
        setViewingHistory(false);
        setError('');
        setOrderConfirmed(false);
        // CRITICAL: regenerate the session id so the AI service starts with a
        // clean conversation history instead of continuing the previous one.
        setCurrentSessionId(`session_${agentId}_${Date.now()}`);
        setTimeout(() => inputRef.current?.focus(), 0);
    }, [agentId]);

    const sendMessage = async () => {
        if (!input.trim() || !agentId || viewingHistory) return;

        const userMessage: Message = { role: 'user', content: input, timestamp: new Date() };
        setMessages(prev => [...prev, userMessage]);
        setInput('');
        setLoading(true);
        setError('');

        try {
            const response = await fetch(`${API_BASE}/api/chat/message`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`,
                },
                body: JSON.stringify({ agentId, message: input, sessionId: currentSessionId }),
            });

            const data = await response.json();

            if (response.ok) {
                setMessages(prev => [...prev, {
                    role: 'assistant',
                    content: data.response,
                    timestamp: new Date(),
                    latencyMs: typeof data.latencyMs === 'number' ? data.latencyMs : undefined,
                }]);
                if (data.orderEvent === 'submitted') {
                    setOrderConfirmed(true);
                    setTimeout(() => setOrderConfirmed(false), 6000);
                }
                // Refresh sidebar after each message so the new session appears
                fetchSessions();
            } else {
                const msg = data.message || 'Failed to get response';
                setError(msg);
                toast.error('Message failed', msg);
            }
        } catch {
            setError('Failed to send message');
            toast.error('Connection error', 'Failed to send message');
        } finally {
            setLoading(false);
            setTimeout(() => inputRef.current?.focus(), 0);
        }
    };

    if (loadingAgent) {
        return <ChatSkeleton />;
    }

    if (!agent) {
        return (
            <div className="flex min-h-[50vh] items-center justify-center bg-white py-24">
                <div className="text-center">
                    <AlertCircle className="h-16 w-16 text-ocean-deep/60 mx-auto mb-4" />
                    <h2 className="text-2xl font-bold text-ocean-navy mb-2">Agent Not Found</h2>
                    <button type="button" onClick={() => navigate(backHref)} className="px-6 py-3 bg-ocean-deep text-white rounded-lg hover:bg-ocean-rich">
                        {returnTo ? 'Back' : 'Back to Dashboard'}
                    </button>
                </div>
            </div>
        );
    }

    return (
        /* Fills exactly the viewport below the sticky navbar  - no page scroll */
        <div className="h-[calc(100vh-4.25rem)] flex flex-col overflow-hidden bg-white">
            <div className="flex flex-col flex-1 min-h-0 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 pt-3 pb-3">
                <PageBackNav to={backHref} label={backLabel} />
                {/* Header */}
                <div className="mb-2">
                    <h1 className="text-xl font-bold text-ocean-navy">{agent.name}</h1>
                    <p className="text-ocean-deep/90 text-sm mt-0.5">{agent.tone} � {agent.type}</p>
                </div>

                {/* Two-column layout  - flex-1 + min-h-0 lets it fill all remaining height */}
                <div className="flex gap-3 flex-1 min-h-0">

                    {/* -- Left sidebar: chat history  - hidden on mobile, shown sm+ -- */}
                    <div className="hidden sm:flex sm:w-52 lg:w-64 flex-shrink-0 bg-white rounded-xl shadow-lg border border-ocean-ice/80 flex-col overflow-hidden">
                        <div className="p-3 border-b border-ocean-ice/80 flex items-center justify-between">
                            <span className="text-sm font-semibold text-ocean-deep flex items-center gap-1.5">
                                <MessageSquare className="h-4 w-4" />
                                Chat History
                            </span>
                            <button
                                type="button"
                                onClick={startNewChat}
                                title="New chat"
                                className="p-1.5 rounded-lg hover:bg-ocean-powder text-ocean-deep transition-colors"
                            >
                                <Plus className="h-4 w-4" />
                            </button>
                        </div>

                        <div className="flex-1 overflow-y-auto">
                            {/* Current live session (always at top when it has messages) */}
                            {messages.length > 0 && !viewingHistory && (
                                <button
                                    type="button"
                                    onClick={startNewChat}
                                    className="w-full text-left px-3 py-2.5 border-b border-gray-50 bg-ocean-powder hover:bg-ocean-mist transition-colors"
                                >
                                    <p className="text-xs font-semibold text-ocean-deep truncate">
                                        {messages[0]?.content?.slice(0, 45) || 'Current chat'}
                                    </p>
                                    <p className="text-xs text-ocean-rich mt-0.5 flex items-center gap-1">
                                        <Clock className="h-3 w-3" />
                                        Now
                                    </p>
                                </button>
                            )}

                            {loadingSessions ? (
                                <div className="flex items-center justify-center py-8">
                                    <Loader className="h-4 w-4 animate-spin text-ocean-deep/60" />
                                </div>
                            ) : sessions.length === 0 ? (
                                <div className="px-3 py-8 text-center">
                                    <MessageSquare className="h-8 w-8 text-gray-200 mx-auto mb-2" />
                                    <p className="text-xs text-ocean-deep/60">No past conversations yet</p>
                                </div>
                            ) : (
                                sessions.map(session => (
                                    <button
                                        key={session.sessionId}
                                        type="button"
                                        onClick={() => loadSession(session.sessionId)}
                                        className={`w-full text-left px-3 py-2.5 border-b border-gray-50 transition-colors hover:bg-ocean-powder ${
                                            selectedSessionId === session.sessionId ? 'bg-ocean-mist/50' : ''
                                        }`}
                                    >
                                        <p className="text-xs font-medium text-ocean-deep truncate">{session.title}</p>
                                        <p className="text-xs text-ocean-deep/60 mt-0.5 flex items-center gap-1">
                                            <Clock className="h-3 w-3" />
                                            {formatRelativeTime(session.updatedAt)}
                                            <span className="ml-auto">{session.messageCount} msgs</span>
                                        </p>
                                    </button>
                                ))
                            )}
                        </div>
                    </div>

                    {/* -- Right: chat window -- */}
                    <div className="flex-1 bg-white rounded-xl shadow-lg border border-ocean-ice/80 overflow-hidden flex flex-col">
                        {/* History banner */}
                        {viewingHistory && (
                            <div className="px-4 py-2 bg-amber-50 border-b border-amber-200 flex items-center justify-between">
                                <span className="text-xs text-amber-700 font-medium">Viewing past conversation (read-only)</span>
                                <button
                                    type="button"
                                    onClick={startNewChat}
                                    className="text-xs text-ocean-deep hover:underline font-medium"
                                >
                                    + New Chat
                                </button>
                            </div>
                        )}

                        {/* Messages */}
                        <div className="flex-1 overflow-y-auto p-6 space-y-4">
                            {messages.length === 0 ? (
                                <div className="flex items-center justify-center h-full text-center">
                                    <div>
                                        <Bot className="h-16 w-16 text-ocean-mist mx-auto mb-4" />
                                        <p className="text-ocean-deep/80 text-lg">Start a conversation</p>
                                    </div>
                                </div>
                            ) : (
                                messages.map((msg, idx) => (
                                    <motion.div
                                        key={idx}
                                        initial="hidden"
                                        animate="show"
                                        variants={listItemEnter}
                                        className={`flex items-start space-x-3 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                                    >
                                        {msg.role === 'assistant' && (
                                            <div className="flex-shrink-0 w-8 h-8 rounded-full bg-ocean-mist flex items-center justify-center">
                                                <Bot className="h-5 w-5 text-ocean-deep" />
                                            </div>
                                        )}
                                        <div className={`max-w-2xl ${msg.role === 'user' ? '' : ''}`}>
                                            <div className={`px-4 py-3 rounded-2xl ${msg.role === 'user' ? 'bg-ocean-deep text-white' : 'bg-ocean-mist/50 text-ocean-navy'}`}>
                                                <p className="text-sm leading-relaxed whitespace-pre-wrap">{msg.content}</p>
                                            </div>
                                            {msg.role === 'assistant' && typeof msg.latencyMs === 'number' && (
                                                <div className="mt-1 ml-2 flex items-center gap-1 text-[10px] text-ocean-deep/60">
                                                    <Zap className={`h-2.5 w-2.5 ${msg.latencyMs <= 2000 ? 'text-green-500' : msg.latencyMs <= 4500 ? 'text-amber-500' : 'text-red-500'}`} />
                                                    <span>{(msg.latencyMs / 1000).toFixed(2)}s</span>
                                                </div>
                                            )}
                                        </div>
                                        {msg.role === 'user' && (
                                            <div className="flex-shrink-0 w-8 h-8 rounded-full bg-ocean-ice flex items-center justify-center">
                                                <User className="h-5 w-5 text-ocean-deep/90" />
                                            </div>
                                        )}
                                    </motion.div>
                                ))
                            )}
                            {loading && (
                                <div className="flex items-start space-x-3">
                                    <div className="flex-shrink-0 w-8 h-8 rounded-full bg-ocean-mist flex items-center justify-center">
                                        <Bot className="h-5 w-5 text-ocean-deep" />
                                    </div>
                                    <div className="bg-ocean-mist/50 px-4 py-3 rounded-2xl">
                                        <div className="flex space-x-2">
                                            <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" />
                                            <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce [animation-delay:150ms]" />
                                            <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce [animation-delay:300ms]" />
                                        </div>
                                    </div>
                                </div>
                            )}
                            <div ref={messagesEndRef} />
                        </div>

                        {/* Order confirmation toast */}
                        {orderConfirmed && (
                            <div className="px-6 py-3 bg-green-50 border-t border-green-200">
                                <div className="flex items-center text-green-700 text-sm font-medium">
                                    <CheckCircle className="h-4 w-4 mr-2 flex-shrink-0" />
                                    Order placed successfully! Check your Orders dashboard to track it.
                                </div>
                            </div>
                        )}

                        {/* Error */}
                        {error && (
                            <div className="px-6 py-3 bg-red-50 border-t border-red-100">
                                <div className="flex items-center text-red-700 text-sm">
                                    <AlertCircle className="h-4 w-4 mr-2" />
                                    {error}
                                </div>
                            </div>
                        )}

                        {/* Input area */}
                        <div className="border-t border-ocean-ice/80 p-4 bg-ocean-powder">
                            {viewingHistory ? (
                                <div className="flex items-center justify-center gap-3 py-1">
                                    <span className="text-sm text-ocean-deep/60">This is a read-only view.</span>
                                    <button type="button" onClick={startNewChat} className="text-sm text-ocean-deep font-medium hover:underline">
                                        Start a new chat ?
                                    </button>
                                </div>
                            ) : (
                                <div className="flex space-x-3">
                                    <input
                                        ref={inputRef}
                                        type="text"
                                        value={input}
                                        onChange={(e) => setInput(e.target.value)}
                                        onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), sendMessage())}
                                        placeholder="Type your message..."
                                        disabled={loading}
                                        className="flex-1 px-4 py-3 border border-ocean-ice rounded-lg focus:ring-2 focus:ring-ocean-bright focus:border-ocean-deep outline-none transition-all disabled:bg-ocean-mist/50"
                                    />
                                    <button
                                        type="button"
                                        onClick={sendMessage}
                                        disabled={loading || !input.trim()}
                                        className="px-6 py-3 bg-ocean-deep text-white rounded-lg hover:bg-ocean-rich disabled:opacity-50 transition-all flex items-center space-x-2"
                                    >
                                        {loading ? <Loader className="h-5 w-5 animate-spin" /> : <Send className="h-5 w-5" />}
                                    </button>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
