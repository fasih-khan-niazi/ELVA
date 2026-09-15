import { useState, useEffect } from 'react';
import { LayoutTemplate, Check, AlertCircle } from 'lucide-react';
import { useToast } from '../Toast';

export interface TemplateConfig {
    id: string;
    name: string;
    description: string;
    tags: string[];
    agentType: 'chat' | 'voice';
    callDirection?: 'inbound' | 'outbound';
    tone: string;
    language: string;
    currency: string;
    firstMessage: string;
    persona: { name: string; summary: string; speakingStyle: string };
    objectives: string[];
    capabilities: string[];
    guardrails: string;
    prompt: string;
    memoryConfig: { shortTermWindow: number; longTermEnabled: boolean };
    responseConfig: { temperature: number; maxTurns: number; fallbackMessage: string };
}

interface Props {
    agentType: 'chat' | 'voice';
    callDirection: 'inbound' | 'outbound';
    token: string;
    apiBase: string;
    onSelected: (template: TemplateConfig) => void;
}

const tagColors = [
    'bg-ocean-powder text-ocean-deep',
    'bg-blue-50 text-blue-700',
    'bg-green-50 text-green-700',
    'bg-purple-50 text-purple-700',
    'bg-amber-50 text-amber-700',
];

export default function TemplateSelector({ agentType, callDirection, token, apiBase, onSelected }: Props) {
    const toast = useToast();
    const [templates, setTemplates] = useState<TemplateConfig[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [selectedId, setSelectedId] = useState<string | null>(null);

    useEffect(() => {
        const params = new URLSearchParams({ type: agentType });
        if (agentType === 'voice') params.set('callDirection', callDirection);
        fetch(`${apiBase}/api/agents/templates?${params}`, {
            headers: { Authorization: `Bearer ${token}` },
        })
            .then((r) => r.json())
            .then((data) => {
                setTemplates(Array.isArray(data) ? data : []);
                setLoading(false);
            })
            .catch(() => {
                setError('Could not load templates.');
                toast.error('Templates unavailable', 'Could not load agent templates');
                setLoading(false);
            });
    }, [agentType, callDirection, token, apiBase]);

    const handleSelect = (t: TemplateConfig) => {
        setSelectedId(t.id);
        onSelected(t);
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center py-12">
                <div className="animate-spin rounded-full h-6 w-6 border-2 border-ocean-deep border-t-transparent" />
                <span className="ml-3 text-ocean-deep/80 text-sm">Loading templates…</span>
            </div>
        );
    }

    if (error) {
        return (
            <div className="flex items-center gap-2 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
                <AlertCircle className="h-4 w-4 shrink-0" />
                {error}
            </div>
        );
    }

    if (templates.length === 0) {
        return (
            <div className="text-center py-10 text-ocean-deep/80 text-sm">
                No templates available for this agent type yet.
            </div>
        );
    }

    return (
        <section className="space-y-4">
            <div className="flex items-center gap-3 p-4 bg-blue-50 border border-blue-200 rounded-xl">
                <div className="p-2 bg-blue-600 text-white rounded-lg shrink-0">
                    <LayoutTemplate className="h-5 w-5" />
                </div>
                <div>
                    <p className="font-semibold text-blue-900">Templates & Presets</p>
                    <p className="text-sm text-blue-700">Select a template - all fields are pre-filled. You only need to add your name and Knowledge Base.</p>
                </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {templates.map((t) => {
                    const isSelected = selectedId === t.id;
                    return (
                        <button
                            key={t.id}
                            type="button"
                            onClick={() => handleSelect(t)}
                            className={`p-4 rounded-xl border-2 text-left transition-all space-y-3 ${
                                isSelected
                                    ? 'border-ocean-deep bg-ocean-powder ring-1 ring-ocean-deep'
                                    : 'border-ocean-ice hover:border-ocean-bright/50 hover:bg-ocean-powder'
                            }`}
                        >
                            <div className="flex items-start justify-between gap-2">
                                <span className={`font-semibold text-sm ${isSelected ? 'text-ocean-navy' : 'text-ocean-navy'}`}>
                                    {t.name}
                                </span>
                                {isSelected && (
                                    <div className="shrink-0 p-0.5 bg-ocean-deep text-white rounded-full">
                                        <Check className="h-3.5 w-3.5" />
                                    </div>
                                )}
                            </div>
                            <p className="text-xs text-ocean-deep/80 leading-relaxed">{t.description}</p>
                            <div className="flex flex-wrap gap-1">
                                {t.tags.map((tag, i) => (
                                    <span
                                        key={tag}
                                        className={`text-xs px-2 py-0.5 rounded-full font-medium ${tagColors[i % tagColors.length]}`}
                                    >
                                        {tag}
                                    </span>
                                ))}
                            </div>
                        </button>
                    );
                })}
            </div>

            {selectedId && (
                <p className="text-sm text-ocean-deep font-medium text-center pt-1">
                    Template selected. Scroll down to review and adjust the pre-filled fields.
                </p>
            )}
        </section>
    );
}
