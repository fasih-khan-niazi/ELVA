import { Zap, LayoutTemplate, Settings } from 'lucide-react';

export type SetupMethod = 'ai' | 'template' | 'manual';

interface Props {
    value: SetupMethod | null;
    onChange: (method: SetupMethod) => void;
}

const methods = [
    {
        id: 'ai' as SetupMethod,
        icon: Zap,
        title: 'AI Quick Setup',
        badge: 'Recommended',
        badgeColor: 'bg-green-100 text-green-700',
        description: 'Describe your business in a few lines. Our AI will fill in all the fields for you. Simply review and adjust.',
        iconBg: 'bg-green-600',
    },
    {
        id: 'template' as SetupMethod,
        icon: LayoutTemplate,
        title: 'Templates & Presets',
        badge: 'Quick Start',
        badgeColor: 'bg-blue-100 text-blue-700',
        description: 'Pick from pre-built agent templates for common use cases. Pre-configured for your agent type. Just add your name and KB.',
        iconBg: 'bg-blue-600',
    },
    {
        id: 'manual' as SetupMethod,
        icon: Settings,
        title: 'Manual Setup',
        badge: 'Full Control',
        badgeColor: 'bg-ocean-mist/50 text-ocean-deep',
        description: 'Configure every detail yourself. All fields in one streamlined 3-step form.',
        iconBg: 'bg-gray-600',
    },
];

export default function SetupMethodSelector({ value, onChange }: Props) {
    return (
        <section>
            <h3 className="text-lg font-semibold text-ocean-navy mb-2">2. How would you like to set up your agent?</h3>
            <p className="text-sm text-ocean-deep/80 mb-5">Choose a setup method that works best for you.</p>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-stretch">
                {methods.map((m) => {
                    const Icon = m.icon;
                    const selected = value === m.id;
                    return (
                        <button
                            key={m.id}
                            type="button"
                            onClick={() => onChange(m.id)}
                            className={`h-full p-5 rounded-xl border-2 text-left transition-all flex flex-col ${
                                selected
                                    ? 'border-ocean-deep bg-ocean-powder ring-1 ring-ocean-deep'
                                    : 'border-ocean-ice hover:border-ocean-ice hover:bg-ocean-powder'
                            }`}
                        >
                            <div className="flex shrink-0 items-start gap-3">
                                <div
                                    className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
                                        selected ? 'bg-ocean-deep' : m.iconBg
                                    } text-white`}
                                >
                                    <Icon className="h-5 w-5" />
                                </div>
                                <div className="min-w-0 flex-1">
                                    <p className="font-semibold text-sm leading-5 text-ocean-navy">
                                        {m.title}
                                    </p>
                                    <span className={`mt-1.5 inline-block text-xs font-medium px-2 py-0.5 rounded-full ${m.badgeColor}`}>
                                        {m.badge}
                                    </span>
                                </div>
                            </div>
                            <p className="mt-2 text-sm text-ocean-deep/80 leading-relaxed flex-1">{m.description}</p>
                        </button>
                    );
                })}
            </div>
        </section>
    );
}
