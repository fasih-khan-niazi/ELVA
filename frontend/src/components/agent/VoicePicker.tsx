import { useEffect, useRef, useState } from 'react';
import { ChevronDown, Play, Volume2, Square } from 'lucide-react';
import { useToast } from '../Toast';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3000';

export interface AzureVoiceOption {
    id: string;
    label: string;
    language: string;
    gender: 'female' | 'male';
    locale: string;
    previewText?: string;
    previewReady?: boolean;
}

interface VoicePickerProps {
    token: string | null;
    value: string;
    onChange: (voiceId: string) => void;
    disabled?: boolean;
}

function formatVoiceOption(v: AzureVoiceOption): string {
    return `${v.label} (${v.language})`;
}

export default function VoicePicker({ token, value, onChange, disabled }: VoicePickerProps) {
    const toast = useToast();
    const [voices, setVoices] = useState<AzureVoiceOption[]>([]);
    const [loading, setLoading] = useState(true);
    const [previewing, setPreviewing] = useState(false);
    const [error, setError] = useState('');
    const audioRef = useRef<HTMLAudioElement | null>(null);
    const objectUrlRef = useRef<string | null>(null);

    const revokeObjectUrl = () => {
        if (objectUrlRef.current) {
            URL.revokeObjectURL(objectUrlRef.current);
            objectUrlRef.current = null;
        }
    };

    useEffect(() => {
        return () => {
            audioRef.current?.pause();
            revokeObjectUrl();
        };
    }, []);

    useEffect(() => {
        if (!token) return;
        let cancelled = false;
        (async () => {
            try {
                const res = await fetch(`${API_BASE}/api/voice/util/azure-voices`, {
                    headers: { Authorization: `Bearer ${token}` },
                });
                if (!res.ok) throw new Error('Failed to load voices');
                const data = await res.json();
                if (!cancelled) {
                    const list: AzureVoiceOption[] = data.voices || [];
                    setVoices(list);
                    const defaultVoice = data.defaultVoice || 'en-US-JennyNeural';
                    if (!value) {
                        onChange(defaultVoice);
                    } else if (!list.some((v) => v.id === value)) {
                        onChange(defaultVoice);
                    }
                }
            } catch (e: any) {
                if (!cancelled) {
                    const msg = e?.message || 'Could not load voices';
                    setError(msg);
                    toast.error('Voice list unavailable', msg);
                }
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();
        return () => { cancelled = true; };
    }, [token]);

    const stopPreview = () => {
        audioRef.current?.pause();
        audioRef.current = null;
        revokeObjectUrl();
        setPreviewing(false);
    };

    const handlePreview = async () => {
        if (!token || !value || previewing) return;
        setPreviewing(true);
        setError('');
        try {
            stopPreview();
            const res = await fetch(
                `${API_BASE}/api/voice/util/preview-samples/${encodeURIComponent(value)}/audio`,
                { headers: { Authorization: `Bearer ${token}` } },
            );
            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                throw new Error(err.message || 'Preview failed');
            }
            const blob = await res.blob();
            const url = URL.createObjectURL(blob);
            objectUrlRef.current = url;
            const audio = new Audio(url);
            audioRef.current = audio;
            audio.onended = () => stopPreview();
            audio.onerror = () => {
                setError('Could not play audio preview');
                toast.error('Preview unavailable', 'Could not play audio preview');
                stopPreview();
            };
            await audio.play();
        } catch (e: any) {
            setError(e?.message || 'Preview failed');
            toast.error('Preview failed', e?.message || 'Could not play preview');
            stopPreview();
        }
    };

    const selectedVoice = voices.find((v) => v.id === value);

    return (
        <div className="col-span-2">
            <label htmlFor="ttsVoice" className="block text-sm font-medium text-ocean-deep mb-1">
                Agent Voice
            </label>
            <div className="flex gap-2">
                <div className="relative flex-1 min-w-0">
                    <select
                        id="ttsVoice"
                        value={value}
                        onChange={(e) => onChange(e.target.value)}
                        disabled={disabled || loading}
                        className="w-full appearance-none pl-4 pr-10 py-2 border border-ocean-ice rounded-lg focus:ring-2 focus:ring-ocean-bright outline-none bg-white text-ocean-deep"
                    >
                        {loading && <option value={value}>Loading voices…</option>}
                        {!loading && voices.length === 0 && (
                            <option value="en-US-JennyNeural">Jenny (US, Female)</option>
                        )}
                        {voices.map((v) => (
                            <option key={v.id} value={v.id}>
                                {formatVoiceOption(v)}
                            </option>
                        ))}
                    </select>
                    <ChevronDown
                        className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ocean-deep/50"
                        aria-hidden
                    />
                </div>
                <button
                    type="button"
                    onClick={() => (previewing ? stopPreview() : void handlePreview())}
                    disabled={disabled || loading || !value}
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-ocean-ice bg-white text-ocean-deep hover:bg-ocean-powder disabled:opacity-50 transition-colors shrink-0"
                    title={previewing ? 'Stop preview' : 'Preview voice'}
                >
                    {previewing ? <Square className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                    {previewing ? 'Stop' : 'Preview'}
                </button>
            </div>
            {selectedVoice?.previewText && (
                <p className="text-xs text-ocean-deep/70 mt-3 flex items-start gap-1.5 leading-relaxed">
                    <Volume2 className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                    <span>&ldquo;{selectedVoice.previewText}&rdquo;</span>
                </p>
            )}
            {error && <p className="text-xs text-red-600 mt-2">{error}</p>}
        </div>
    );
}
