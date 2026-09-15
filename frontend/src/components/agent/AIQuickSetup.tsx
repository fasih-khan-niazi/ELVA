import { useState } from 'react';
import { Zap, AlertCircle } from 'lucide-react';
import { useToast } from '../Toast';

export interface GeneratedConfig {
    agentName: string;
    businessName: string;
    tone: string;
    firstMessage: string;
    personaName: string;
    personaSummary: string;
    speakingStyle: string;
    objectives: string[];
    capabilities: string[];
    guardrails: string;
    systemPrompt: string;
    temperature: number;
    fallbackMessage: string;
}

interface Props {
    agentType: 'chat' | 'voice';
    callDirection: 'inbound' | 'outbound';
    token: string;
    apiBase: string;
    onGenerated: (config: GeneratedConfig) => void;
}

export default function AIQuickSetup({ agentType, callDirection, token, apiBase, onGenerated }: Props) {
    const toast = useToast();
    const [description, setDescription] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    const handleGenerate = async () => {
        setError('');
        const trimmed = description.trim();
        if (trimmed.length < 20) {
            setError('Please write at least a sentence or two about your business.');
            return;
        }
        setLoading(true);
        try {
            const res = await fetch(`${apiBase}/api/agents/generate-config`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({
                    businessDescription: trimmed,
                    agentType,
                    callDirection,
                }),
            });
            if (!res.ok) {
                const err = await res.json().catch(() => ({ message: 'Unknown error' }));
                throw new Error(err.message || 'Generation failed');
            }
            const data: GeneratedConfig = await res.json();
            onGenerated(data);
        } catch (err: any) {
            const msg = err.message || 'Failed to generate config. Please try again.';
            setError(msg);
            toast.error('Generation failed', msg);
        } finally {
            setLoading(false);
        }
    };

    return (
        <section className="space-y-5">
            <div className="flex items-center gap-3 p-4 bg-green-50 border border-green-200 rounded-xl">
                <div className="p-2 bg-green-600 text-white rounded-lg shrink-0">
                    <Zap className="h-5 w-5" />
                </div>
                <div>
                    <p className="font-semibold text-green-900">AI Quick Setup</p>
                    <p className="text-sm text-green-700">Describe your business and we'll configure everything for you.</p>
                </div>
            </div>

            {error && (
                <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
                    <AlertCircle className="h-4 w-4 shrink-0" />
                    {error}
                </div>
            )}

            <div>
                <label className="block text-sm font-medium text-ocean-deep mb-1">
                    Tell us about your business
                </label>
                <textarea
                    rows={5}
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder={
                        agentType === 'voice' && callDirection === 'outbound'
                            ? "e.g. We are a real estate agency in Lahore running a cold-call campaign to qualify home buyers. Our agents call leads to ask about their budget, timeline, and preferred area."
                            : "e.g. We run a clothing store in Karachi selling men's formal wear. We need a chat assistant that answers questions about products, takes orders, and handles returns."
                    }
                    className="w-full px-4 py-3 border border-ocean-ice rounded-lg focus:ring-2 focus:ring-ocean-bright focus:border-ocean-deep outline-none transition-all text-sm"
                />
                <p className="text-xs text-ocean-deep/60 mt-1">
                    Include: what your business does, who your customers are, and what you want the agent to help with.
                </p>
            </div>

            <button
                type="button"
                onClick={handleGenerate}
                disabled={loading || description.trim().length < 10}
                className="w-full py-3 bg-green-600 text-white rounded-xl font-semibold hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
            >
                {loading ? (
                    <>
                        <div className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent" />
                        Generating your agent config…
                    </>
                ) : (
                    <>
                        <Zap className="h-4 w-4" />
                        Generate Agent Config
                    </>
                )}
            </button>
        </section>
    );
}
