import { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import { X, CheckCircle, XCircle, Clock, Loader2, RefreshCw } from 'lucide-react';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3000';

interface Log {
    _id: string;
    status: 'delivered' | 'failed' | 'retrying' | 'queued';
    eventType: string;
    attempt: number;
    triggeredAt: string;
    deliveredAt?: string;
    errorMessage?: string;
}

const STATUS_CONFIG = {
    delivered: { icon: CheckCircle, color: 'text-green-600', bg: 'bg-green-50', label: 'Delivered' },
    failed:    { icon: XCircle,     color: 'text-red-600',   bg: 'bg-red-50',   label: 'Failed' },
    retrying:  { icon: Clock,       color: 'text-amber-600', bg: 'bg-amber-50', label: 'Retrying' },
    queued:    { icon: Clock,       color: 'text-blue-600',  bg: 'bg-blue-50',  label: 'Queued' },
};

interface Props {
    connectorId: string;
    onClose: () => void;
}

export default function ConnectorLogs({ connectorId, onClose }: Props) {
    const { token } = useAuth();
    const [logs, setLogs] = useState<Log[]>([]);
    const [loading, setLoading] = useState(true);

    const fetchLogs = async () => {
        setLoading(true);
        try {
            const res = await fetch(`${API_BASE}/api/connectors/${connectorId}/logs`, {
                headers: { Authorization: `Bearer ${token}` },
            });
            if (res.ok) setLogs(await res.json());
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { fetchLogs(); }, [connectorId]);

    return (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={onClose}>
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[80vh] flex flex-col" onClick={e => e.stopPropagation()}>
                <div className="flex items-center justify-between p-6 border-b border-ocean-ice/80">
                    <h2 className="text-lg font-bold text-ocean-navy">Delivery Logs</h2>
                    <div className="flex items-center gap-2">
                        <button onClick={fetchLogs} className="p-2 text-ocean-deep/80 hover:text-ocean-deep rounded-lg hover:bg-ocean-mist/50">
                            <RefreshCw className="h-4 w-4" />
                        </button>
                        <button onClick={onClose} className="p-2 text-ocean-deep/80 hover:text-ocean-deep rounded-lg hover:bg-ocean-mist/50">
                            <X className="h-4 w-4" />
                        </button>
                    </div>
                </div>

                <div className="flex-1 overflow-y-auto p-6">
                    {loading ? (
                        <div className="flex items-center justify-center py-12">
                            <Loader2 className="h-8 w-8 animate-spin text-ocean-deep" />
                        </div>
                    ) : logs.length === 0 ? (
                        <div className="text-center py-12 text-ocean-deep/80">No delivery logs yet</div>
                    ) : (
                        <div className="space-y-3">
                            {logs.map(log => {
                                const sc = STATUS_CONFIG[log.status];
                                const Icon = sc.icon;
                                return (
                                    <div key={log._id} className={`flex items-start gap-3 p-4 rounded-xl border ${sc.bg} border-opacity-50`}>
                                        <Icon className={`h-5 w-5 ${sc.color} shrink-0 mt-0.5`} />
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center gap-2 flex-wrap">
                                                <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${sc.bg} ${sc.color}`}>{sc.label}</span>
                                                <span className="text-xs text-ocean-deep/80 capitalize">{log.eventType}</span>
                                                <span className="text-xs text-ocean-deep/60">Attempt {log.attempt}</span>
                                            </div>
                                            <div className="text-xs text-ocean-deep/80 mt-1">
                                                Triggered: {new Date(log.triggeredAt).toLocaleString()}
                                                {log.deliveredAt && ` · Delivered: ${new Date(log.deliveredAt).toLocaleString()}`}
                                            </div>
                                            {log.errorMessage && (
                                                <div className="text-xs text-red-600 mt-1 font-mono bg-red-50 rounded p-2 break-all">
                                                    {log.errorMessage}
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
