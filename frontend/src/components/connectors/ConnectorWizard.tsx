import { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../Toast';
import {
    X, ChevronRight, ChevronLeft, Check, Loader2,
    ShoppingBag, UserCheck, Phone, Mail, Globe, Plus, Trash2,
    MessageSquare, Link2, Smartphone, ArrowLeftRight
} from 'lucide-react';
import TemplateGallery from './TemplateGallery';
import { EmbeddedPasswordField } from '../PasswordFieldWithToggle';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3000';

interface Condition { field: string; operator: string; value: string }
interface SlackWorkspace { _id: string; workspaceId: string; workspaceName: string; workspaceIcon?: string }
interface SlackChannel { id: string; name: string; isPrivate: boolean }

interface WizardState {
    name: string;
    source: 'orders' | 'leads' | 'calls' | '';
    event: 'created' | 'status_changed' | '';
    conditions: Condition[];
    channelType: 'slack' | 'email' | 'webhook' | 'whatsapp' | '';
    // Slack - webhook mode (Phase 1)
    slackMode: 'webhook' | 'oauth';
    slackWebhookUrl: string;
    slackChannelLabel: string;
    // Slack - OAuth mode (Phase 2)
    slackWorkspaceId: string;
    slackWorkspaceName: string;
    slackChannelId: string;
    slackChannelName: string;
    slackTwoWay: boolean;
    // Email
    emailRecipients: string;
    emailFromName: string;
    // Webhook
    webhookUrl: string;
    webhookSecret: string;
    // WhatsApp
    waPhoneNumberId: string;
    waAccessToken: string;
    waRecipientPhone: string;
    // Delivery & template
    deliveryMode: 'instant' | 'hourly_digest' | 'daily_digest';
    templateId: string;
    customTemplateBody: string;
    customTemplateSubject: string;
    useCustomTemplate: boolean;
}

const STEPS = ['Source & Trigger', 'Channel', 'Template', 'Review & Activate'];

const SOURCE_OPTIONS = [
    { value: 'orders', label: 'Orders', icon: ShoppingBag, desc: 'Fired when an order is placed' },
    { value: 'leads',  label: 'Leads',  icon: UserCheck,   desc: 'Fired when a lead is captured' },
    { value: 'calls',  label: 'Calls',  icon: Phone,       desc: 'Fired when a voice call completes' },
];

const CHANNEL_OPTIONS = [
    { value: 'slack',    label: 'Slack',           icon: <MessageSquare className="h-6 w-6 text-ocean-rich" />, desc: 'Incoming webhook (simple) or Slack app OAuth' },
    { value: 'email',    label: 'Email',            icon: <Mail className="h-6 w-6 text-blue-500" />,           desc: 'Send email via SendGrid' },
    { value: 'webhook',  label: 'Generic Webhook',  icon: <Link2 className="h-6 w-6 text-purple-500" />,        desc: 'HTTP POST to any endpoint' },
    { value: 'whatsapp', label: 'WhatsApp',          icon: <Smartphone className="h-6 w-6 text-green-500" />,   desc: 'Send via Meta Cloud API (BYOC)' },
];

const CONDITION_FIELDS: Record<string, { label: string; fields: { value: string; label: string }[] }> = {
    orders: { label: 'Order fields', fields: [
        { value: 'order.total', label: 'Total amount' },
        { value: 'order.channel', label: 'Channel (chat/voice)' },
        { value: 'order.status', label: 'Status' },
    ]},
    leads: { label: 'Lead fields', fields: [
        { value: 'lead.score', label: 'Lead score (0-100)' },
        { value: 'lead.source', label: 'Source (auto/manual)' },
        { value: 'lead.channel', label: 'Channel (chat/voice)' },
    ]},
    calls: { label: 'Call fields', fields: [
        { value: 'call.outcome', label: 'Outcome' },
        { value: 'call.sentiment', label: 'Sentiment' },
    ]},
};

interface Props {
    agentId: string;
    onClose: () => void;
    onCreated: () => void;
}

export default function ConnectorWizard({ agentId, onClose, onCreated }: Props) {
    const { token, subscription } = useAuth();
    const toast = useToast();
    const [step, setStep] = useState(0);
    const [saving, setSaving] = useState(false);

    const [workspaces, setWorkspaces] = useState<SlackWorkspace[]>([]);
    const [channels, setChannels] = useState<SlackChannel[]>([]);
    const [loadingWorkspaces, setLoadingWorkspaces] = useState(false);
    const [loadingChannels, setLoadingChannels] = useState(false);
    const [connectingSlack, setConnectingSlack] = useState(false);

    const isEnterprise = subscription?.plan === 'enterprise';

    const [s, setS] = useState<WizardState>({
        name: '',
        source: '',
        event: 'created',
        conditions: [],
        channelType: '',
        slackMode: 'webhook',
        slackWebhookUrl: '',
        slackChannelLabel: '',
        slackWorkspaceId: '',
        slackWorkspaceName: '',
        slackChannelId: '',
        slackChannelName: '',
        slackTwoWay: false,
        emailRecipients: '',
        emailFromName: '',
        webhookUrl: '',
        webhookSecret: '',
        waPhoneNumberId: '',
        waAccessToken: '',
        waRecipientPhone: '',
        deliveryMode: 'instant',
        templateId: '',
        customTemplateBody: '',
        customTemplateSubject: '',
        useCustomTemplate: false,
    });

    const update = (patch: Partial<WizardState>) => setS(prev => ({ ...prev, ...patch }));

    // Fetch connected Slack workspaces when user selects OAuth mode
    useEffect(() => {
        if (s.channelType === 'slack' && s.slackMode === 'oauth') {
            setLoadingWorkspaces(true);
            fetch(`${API_BASE}/api/slack/workspaces`, {
                headers: { Authorization: `Bearer ${token}` },
            })
                .then(r => r.json())
                .then(setWorkspaces)
                .catch(() => {})
                .finally(() => setLoadingWorkspaces(false));
        }
    }, [s.channelType, s.slackMode, token]);

    // Fetch channels when workspace is selected
    useEffect(() => {
        if (s.slackWorkspaceId && s.slackMode === 'oauth') {
            setLoadingChannels(true);
            fetch(`${API_BASE}/api/slack/workspaces/${s.slackWorkspaceId}/channels`, {
                headers: { Authorization: `Bearer ${token}` },
            })
                .then(r => r.json())
                .then(setChannels)
                .catch(() => {})
                .finally(() => setLoadingChannels(false));
        }
    }, [s.slackWorkspaceId, s.slackMode, token]);

    // Slack OAuth popup
    const handleSlackConnect = () => {
        setConnectingSlack(true);
        const popup = window.open(
            `${API_BASE}/api/slack/oauth/install?token=${token}`,
            'slack-oauth',
            'width=600,height=700,scrollbars=yes'
        );

        const handleMessage = (e: MessageEvent) => {
            if (e.data?.type === 'slack-connected') {
                window.removeEventListener('message', handleMessage);
                setConnectingSlack(false);
                // Re-fetch workspaces
                setLoadingWorkspaces(true);
                fetch(`${API_BASE}/api/slack/workspaces`, {
                    headers: { Authorization: `Bearer ${token}` },
                })
                    .then(r => r.json())
                    .then(ws => {
                        setWorkspaces(ws);
                        const newWs = ws.find((w: SlackWorkspace) => w.workspaceId === e.data.workspaceId);
                        if (newWs) update({ slackWorkspaceId: newWs.workspaceId, slackWorkspaceName: newWs.workspaceName });
                    })
                    .catch(() => {})
                    .finally(() => setLoadingWorkspaces(false));
                toast.success('Slack connected', `${e.data.workspaceName} workspace connected`);
            } else if (e.data?.type === 'slack-error') {
                window.removeEventListener('message', handleMessage);
                setConnectingSlack(false);
                toast.error('Slack connection failed', e.data.error);
            }
        };

        window.addEventListener('message', handleMessage);

        const checkClosed = setInterval(() => {
            if (popup?.closed) {
                clearInterval(checkClosed);
                setConnectingSlack(false);
                window.removeEventListener('message', handleMessage);
            }
        }, 1000);
    };

    const addCondition = () => {
        const firstField = s.source ? CONDITION_FIELDS[s.source]?.fields[0]?.value || '' : '';
        update({ conditions: [...s.conditions, { field: firstField, operator: 'gt', value: '' }] });
    };

    const updateCondition = (idx: number, patch: Partial<Condition>) => {
        const next = [...s.conditions];
        next[idx] = { ...next[idx], ...patch };
        update({ conditions: next });
    };

    const removeCondition = (idx: number) => {
        update({ conditions: s.conditions.filter((_, i) => i !== idx) });
    };

    const canNext = () => {
        if (step === 0) return !!s.name && !!s.source && !!s.event;
        if (step === 1) {
            if (!s.channelType) return false;
            if (s.channelType === 'slack') {
                if (s.slackMode === 'webhook') return !!s.slackWebhookUrl;
                return !!s.slackWorkspaceId && !!s.slackChannelId;
            }
            if (s.channelType === 'email') return !!s.emailRecipients;
            if (s.channelType === 'webhook') return !!s.webhookUrl;
            if (s.channelType === 'whatsapp') return !!s.waPhoneNumberId && !!s.waAccessToken && !!s.waRecipientPhone;
            return true;
        }
        if (step === 2) return s.useCustomTemplate ? !!s.customTemplateBody : !!s.templateId;
        return true;
    };

    const handleSave = async () => {
        setSaving(true);
        try {
            const destination: Record<string, any> = { type: s.channelType };

            if (s.channelType === 'slack') {
                if (s.slackMode === 'oauth') {
                    destination.slack = {
                        workspaceId: s.slackWorkspaceId,
                        channelId: s.slackChannelId,
                        channelName: s.slackChannelName,
                        twoWayEnabled: s.slackTwoWay && isEnterprise,
                    };
                } else {
                    destination.slack = { webhookUrl: s.slackWebhookUrl, channelLabel: s.slackChannelLabel };
                }
            } else if (s.channelType === 'email') {
                destination.email = {
                    recipients: s.emailRecipients.split(',').map(e => e.trim()).filter(Boolean),
                    fromName: s.emailFromName || undefined,
                };
            } else if (s.channelType === 'webhook') {
                destination.webhook = { url: s.webhookUrl, secret: s.webhookSecret || undefined };
            } else if (s.channelType === 'whatsapp') {
                destination.whatsapp = {
                    phoneNumberId: s.waPhoneNumberId,
                    accessToken: s.waAccessToken,
                    recipientPhone: s.waRecipientPhone,
                };
            }

            const body: Record<string, any> = {
                agentId,
                name: s.name,
                trigger: { source: s.source, event: s.event, conditions: s.conditions },
                destination,
                deliveryMode: s.deliveryMode,
            };

            if (s.useCustomTemplate) {
                body.customTemplate = { body: s.customTemplateBody, subject: s.customTemplateSubject || undefined };
            } else {
                body.templateId = s.templateId;
            }

            const res = await fetch(`${API_BASE}/api/connectors`, {
                method: 'POST',
                headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            });

            const data = await res.json();
            if (!res.ok) { toast.error('Failed to create alerts and notifications connector', data.message); return; }

            toast.success('Alerts and notifications connector created', 'It is now active and listening for events.');
            onCreated();
        } catch { toast.error('Server error'); }
        finally { setSaving(false); }
    };

    return (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={onClose}>
            <div
                className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col"
                onClick={e => e.stopPropagation()}
            >
                {/* Header */}
                <div className="flex items-center justify-between p-6 border-b border-ocean-ice/80">
                    <div>
                        <h2 className="text-xl font-bold text-ocean-navy">New alerts & notifications</h2>
                        <p className="text-sm text-ocean-deep/80 mt-0.5">Step {step + 1} of {STEPS.length} - {STEPS[step]}</p>
                    </div>
                    <button onClick={onClose} className="p-2 text-ocean-deep/80 hover:text-ocean-deep rounded-lg hover:bg-ocean-mist/50">
                        <X className="h-5 w-5" />
                    </button>
                </div>

                {/* Step indicator */}
                <div className="flex px-6 py-3 border-b border-ocean-ice/80 gap-2">
                    {STEPS.map((label, i) => (
                        <div key={i} className="flex items-center gap-1.5">
                            <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold transition-colors ${
                                i < step ? 'bg-ocean-deep text-white' : i === step ? 'bg-ocean-mist text-ocean-deep border-2 border-ocean-deep' : 'bg-ocean-mist/50 text-ocean-deep/60'
                            }`}>
                                {i < step ? <Check className="h-3 w-3" /> : i + 1}
                            </div>
                            <span className={`text-xs hidden sm:block ${i === step ? 'font-semibold text-ocean-deep' : 'text-ocean-deep/60'}`}>{label}</span>
                            {i < STEPS.length - 1 && <ChevronRight className="h-3 w-3 text-gray-300" />}
                        </div>
                    ))}
                </div>

                {/* Step content */}
                <div className="flex-1 overflow-y-auto p-6">

                    {/* Step 0 - Source & Trigger */}
                    {step === 0 && (
                        <div className="space-y-6">
                            <div>
                                <label className="block text-sm font-semibold text-ocean-deep mb-1">Name</label>
                                <input
                                    value={s.name}
                                    onChange={e => update({ name: e.target.value })}
                                    placeholder="e.g. New Orders → Slack #orders"
                                    className="w-full border border-ocean-ice rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ocean-bright"
                                />
                            </div>

                            <div>
                                <label className="block text-sm font-semibold text-ocean-deep mb-2">Data Source</label>
                                <div className="grid grid-cols-3 gap-3">
                                    {SOURCE_OPTIONS.map(opt => {
                                        const Icon = opt.icon;
                                        return (
                                            <button
                                                key={opt.value}
                                                type="button"
                                                onClick={() => update({ source: opt.value as any })}
                                                className={`p-4 rounded-xl border-2 text-left transition-all ${
                                                    s.source === opt.value ? 'border-ocean-deep bg-ocean-powder' : 'border-ocean-ice hover:border-ocean-bright/50'
                                                }`}
                                            >
                                                <Icon className={`h-6 w-6 mb-2 ${s.source === opt.value ? 'text-ocean-deep' : 'text-ocean-deep/60'}`} />
                                                <div className="font-semibold text-sm text-ocean-navy">{opt.label}</div>
                                                <div className="text-xs text-ocean-deep/80 mt-0.5">{opt.desc}</div>
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>

                            <div>
                                <label className="block text-sm font-semibold text-ocean-deep mb-2">Delivery Mode</label>
                                <div className="grid grid-cols-3 gap-2">
                                    {[
                                        { value: 'instant', label: 'Instant', desc: 'Fire immediately' },
                                        { value: 'hourly_digest', label: 'Hourly Digest', desc: 'Batch once/hour' },
                                        { value: 'daily_digest', label: 'Daily Digest', desc: 'Batch at 9 AM daily' },
                                    ].map(opt => (
                                        <button
                                            key={opt.value}
                                            type="button"
                                            onClick={() => update({ deliveryMode: opt.value as any })}
                                            className={`p-3 rounded-xl border-2 text-left transition-all ${
                                                s.deliveryMode === opt.value ? 'border-ocean-deep bg-ocean-powder' : 'border-ocean-ice hover:border-ocean-bright/50'
                                            }`}
                                        >
                                            <div className="font-semibold text-sm text-ocean-navy">{opt.label}</div>
                                            <div className="text-xs text-ocean-deep/80">{opt.desc}</div>
                                        </button>
                                    ))}
                                </div>
                            </div>

                            {s.source && (
                                <div>
                                    <div className="flex items-center justify-between mb-2">
                                        <label className="text-sm font-semibold text-ocean-deep">Conditions <span className="text-ocean-deep/60 font-normal">(optional)</span></label>
                                        <button type="button" onClick={addCondition} className="flex items-center text-xs text-ocean-deep hover:text-ocean-navy font-medium">
                                            <Plus className="h-3 w-3 mr-1" /> Add condition
                                        </button>
                                    </div>
                                    {s.conditions.length === 0 ? (
                                        <p className="text-xs text-ocean-deep/60">No conditions - fires on every event. Add one to filter by field value.</p>
                                    ) : (
                                        <div className="space-y-2">
                                            {s.conditions.map((cond, idx) => (
                                                <div key={idx} className="flex gap-2 items-center">
                                                    <select
                                                        value={cond.field}
                                                        onChange={e => updateCondition(idx, { field: e.target.value })}
                                                        className="flex-1 border border-ocean-ice rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-ocean-bright"
                                                    >
                                                        {(CONDITION_FIELDS[s.source]?.fields || []).map(f => (
                                                            <option key={f.value} value={f.value}>{f.label}</option>
                                                        ))}
                                                    </select>
                                                    <select
                                                        value={cond.operator}
                                                        onChange={e => updateCondition(idx, { operator: e.target.value })}
                                                        className="border border-ocean-ice rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-ocean-bright"
                                                    >
                                                        <option value="gt">&gt;</option>
                                                        <option value="lt">&lt;</option>
                                                        <option value="gte">&ge;</option>
                                                        <option value="lte">&le;</option>
                                                        <option value="eq">=</option>
                                                        <option value="contains">contains</option>
                                                    </select>
                                                    <input
                                                        value={cond.value}
                                                        onChange={e => updateCondition(idx, { value: e.target.value })}
                                                        placeholder="value"
                                                        className="flex-1 border border-ocean-ice rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-ocean-bright"
                                                    />
                                                    <button type="button" onClick={() => removeCondition(idx)} className="p-1.5 text-red-400 hover:text-red-600">
                                                        <Trash2 className="h-3.5 w-3.5" />
                                                    </button>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    )}

                    {/* Step 1 - Channel */}
                    {step === 1 && (
                        <div className="space-y-6">
                            <div>
                                <label className="block text-sm font-semibold text-ocean-deep mb-2">Channel Type</label>
                                <div className="grid grid-cols-2 gap-3">
                                    {CHANNEL_OPTIONS.map(opt => (
                                        <button
                                            key={opt.value}
                                            type="button"
                                            onClick={() => update({ channelType: opt.value as any })}
                                            className={`p-4 rounded-xl border-2 text-left transition-all ${
                                                s.channelType === opt.value ? 'border-ocean-deep bg-ocean-powder' : 'border-ocean-ice hover:border-ocean-bright/50'
                                            }`}
                                        >
                                            <div className="mb-2">{opt.icon}</div>
                                            <div className="font-semibold text-sm text-ocean-navy">{opt.label}</div>
                                            <div className="text-xs text-ocean-deep/80 mt-0.5">{opt.desc}</div>
                                        </button>
                                    ))}
                                </div>
                            </div>

                            {/* Slack config */}
                            {s.channelType === 'slack' && (
                                <div className="space-y-4 bg-ocean-powder rounded-xl p-4 border border-ocean-ice">
                                    {/* Mode toggle */}
                                    <div className="flex gap-2">
                                        {[
                                            { v: 'webhook', label: 'Incoming webhook', desc: 'Paste one URL Slack gives you · fastest · outbound only' },
                                            { v: 'oauth', label: 'Slack app (OAuth)', desc: 'ELVA signs in once per workspace · pick channel · optional Slack buttons (Enterprise)' },
                                        ].map(m => (
                                            <button
                                                key={m.v}
                                                type="button"
                                                onClick={() => update({ slackMode: m.v as any })}
                                                className={`flex-1 p-3 rounded-xl border-2 text-left transition-all ${
                                                    s.slackMode === m.v ? 'border-ocean-deep bg-ocean-powder' : 'border-ocean-ice hover:border-ocean-bright/50'
                                                }`}
                                            >
                                                <div className="font-semibold text-xs text-ocean-navy">{m.label}</div>
                                                <div className="text-xs text-ocean-deep/80">{m.desc}</div>
                                            </button>
                                        ))}
                                    </div>

                                    <div className={`rounded-xl border px-4 py-3 text-xs leading-relaxed ${s.slackMode === 'webhook' ? 'bg-white/70 border-ocean-sky/40' : 'bg-white/70 border-purple-200/60'}`}>
                                        {s.slackMode === 'webhook' ? (
                                            <p className="text-ocean-deep/90">
                                                <span className="font-semibold text-ocean-navy">Simple path:</span>{' '}
                                                Slack generates a webhook URL tied to one channel. ELVA POSTs messages there: no Slack app credentials on ELVA servers. Trade-off: Slack cannot call ELVA back (one-way alerts only).
                                            </p>
                                        ) : (
                                            <p className="text-ocean-deep/90">
                                                <span className="font-semibold text-ocean-navy">App path:</span>{' '}
                                                Each workspace admin clicks <strong>Connect Slack workspace</strong>; they never type Client ID/Secret.
                                                Those values are set <strong>once</strong> in ELVA&apos;s server environment per deployment, same pattern as Shopify/Notion. That enables channel pickers and optional two-way Slack buttons (Enterprise).
                                            </p>
                                        )}
                                    </div>

                                    {/* Webhook mode */}
                                    {s.slackMode === 'webhook' && (
                                        <>
                                            <div>
                                                <label className="block text-sm font-semibold text-ocean-deep mb-1">Slack Incoming Webhook URL <span className="text-red-500">*</span></label>
                                                <input
                                                    value={s.slackWebhookUrl}
                                                    onChange={e => update({ slackWebhookUrl: e.target.value })}
                                                    placeholder="https://hooks.slack.com/services/..."
                                                    className="w-full border border-ocean-ice rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ocean-bright"
                                                />
                                                <p className="text-xs text-ocean-deep/80 mt-1">In your Slack workspace: Apps → Incoming WebHooks → Add new webhook</p>
                                            </div>
                                            <div>
                                                <label className="block text-sm font-semibold text-ocean-deep mb-1">Channel Label <span className="text-ocean-deep/60 font-normal">(optional)</span></label>
                                                <input
                                                    value={s.slackChannelLabel}
                                                    onChange={e => update({ slackChannelLabel: e.target.value })}
                                                    placeholder="#orders"
                                                    className="w-full border border-ocean-ice rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ocean-bright"
                                                />
                                            </div>
                                        </>
                                    )}

                                    {/* OAuth mode */}
                                    {s.slackMode === 'oauth' && (
                                        <div className="space-y-3">
                                            {/* Workspace selector */}
                                            {loadingWorkspaces ? (
                                                <div className="flex items-center gap-2 text-sm text-ocean-deep/80"><Loader2 className="h-4 w-4 animate-spin" /> Loading workspaces…</div>
                                            ) : workspaces.length === 0 ? (
                                                <div className="text-sm text-ocean-deep/90">No workspaces connected yet.</div>
                                            ) : (
                                                <div>
                                                    <label className="block text-sm font-semibold text-ocean-deep mb-1">Workspace <span className="text-red-500">*</span></label>
                                                    <select
                                                        value={s.slackWorkspaceId}
                                                        onChange={e => {
                                                            const ws = workspaces.find(w => w.workspaceId === e.target.value);
                                                            update({ slackWorkspaceId: e.target.value, slackWorkspaceName: ws?.workspaceName || '', slackChannelId: '', slackChannelName: '' });
                                                        }}
                                                        className="w-full border border-ocean-ice rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ocean-bright"
                                                    >
                                                        <option value="">Select workspace…</option>
                                                        {workspaces.map(w => (
                                                            <option key={w.workspaceId} value={w.workspaceId}>{w.workspaceName}</option>
                                                        ))}
                                                    </select>
                                                </div>
                                            )}

                                            <button
                                                type="button"
                                                onClick={handleSlackConnect}
                                                disabled={connectingSlack}
                                                className="flex items-center gap-2 px-4 py-2 bg-ocean-deep text-white rounded-lg text-sm font-medium hover:bg-ocean-rich disabled:opacity-60"
                                            >
                                                {connectingSlack ? <Loader2 className="h-4 w-4 animate-spin" /> : <MessageSquare className="h-4 w-4" />}
                                                {connectingSlack ? 'Connecting…' : workspaces.length ? 'Connect another workspace' : 'Connect Slack workspace'}
                                            </button>

                                            {/* Channel selector */}
                                            {s.slackWorkspaceId && (
                                                <div>
                                                    <label className="block text-sm font-semibold text-ocean-deep mb-1">Channel <span className="text-red-500">*</span></label>
                                                    {loadingChannels ? (
                                                        <div className="flex items-center gap-2 text-sm text-ocean-deep/80"><Loader2 className="h-4 w-4 animate-spin" /> Loading channels…</div>
                                                    ) : (
                                                        <select
                                                            value={s.slackChannelId}
                                                            onChange={e => {
                                                                const ch = channels.find(c => c.id === e.target.value);
                                                                update({ slackChannelId: e.target.value, slackChannelName: ch?.name || '' });
                                                            }}
                                                            className="w-full border border-ocean-ice rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ocean-bright"
                                                        >
                                                            <option value="">Select channel…</option>
                                                            {channels.map(c => (
                                                                <option key={c.id} value={c.id}>#{c.name}{c.isPrivate ? ' 🔒' : ''}</option>
                                                            ))}
                                                        </select>
                                                    )}
                                                </div>
                                            )}

                                            {/* Two-way toggle - Enterprise only */}
                                            {s.slackWorkspaceId && s.slackChannelId && (
                                                <div className={`rounded-xl p-4 border ${isEnterprise ? 'bg-purple-50 border-purple-200' : 'bg-ocean-mist/50 border-ocean-ice opacity-60'}`}>
                                                    <div className="flex items-center justify-between">
                                                        <div>
                                                            <div className="flex items-center gap-2">
                                                                <ArrowLeftRight className="h-4 w-4 text-purple-600" />
                                                                <span className="text-sm font-semibold text-ocean-navy">Two-way Actions</span>
                                                                {!isEnterprise && <span className="text-xs bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full font-medium">Enterprise</span>}
                                                            </div>
                                                            <p className="text-xs text-ocean-deep/80 mt-1">Add Confirm/Cancel buttons to Slack messages so your team can update order or lead status without leaving Slack.</p>
                                                        </div>
                                                        <label className="relative inline-flex items-center cursor-pointer ml-4">
                                                            <input
                                                                type="checkbox"
                                                                checked={s.slackTwoWay}
                                                                disabled={!isEnterprise}
                                                                onChange={e => update({ slackTwoWay: e.target.checked })}
                                                                className="sr-only peer"
                                                            />
                                                            <div className="w-10 h-6 bg-ocean-ice peer-focus:ring-2 peer-focus:ring-purple-500 rounded-full peer peer-checked:bg-purple-600 peer-disabled:opacity-50 after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:after:translate-x-4" />
                                                        </label>
                                                    </div>
                                                    {!isEnterprise && (
                                                        <p className="text-xs text-purple-700 mt-2 font-medium">Upgrade to Enterprise to enable two-way Slack actions.</p>
                                                    )}
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </div>
                            )}

                            {/* Email config */}
                            {s.channelType === 'email' && (
                                <div className="space-y-4 bg-ocean-powder rounded-xl p-4 border border-ocean-ice">
                                    <div>
                                        <label className="block text-sm font-semibold text-ocean-deep mb-1">Recipients <span className="text-red-500">*</span></label>
                                        <input
                                            value={s.emailRecipients}
                                            onChange={e => update({ emailRecipients: e.target.value })}
                                            placeholder="alice@example.com, bob@example.com"
                                            className="w-full border border-ocean-ice rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ocean-bright"
                                        />
                                        <p className="text-xs text-ocean-deep/80 mt-1">Comma-separated email addresses</p>
                                    </div>
                                    <div>
                                        <label className="block text-sm font-semibold text-ocean-deep mb-1">From Name <span className="text-ocean-deep/60 font-normal">(optional)</span></label>
                                        <input
                                            value={s.emailFromName}
                                            onChange={e => update({ emailFromName: e.target.value })}
                                            placeholder="ELVA"
                                            className="w-full border border-ocean-ice rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ocean-bright"
                                        />
                                    </div>
                                    
                                </div>
                            )}

                            {/* Webhook config */}
                            {s.channelType === 'webhook' && (
                                <div className="space-y-4 bg-ocean-powder rounded-xl p-4 border border-ocean-ice">
                                    <div>
                                        <label className="block text-sm font-semibold text-ocean-deep mb-1">Endpoint URL <span className="text-red-500">*</span></label>
                                        <input
                                            value={s.webhookUrl}
                                            onChange={e => update({ webhookUrl: e.target.value })}
                                            placeholder="https://your-server.com/webhook"
                                            className="w-full border border-ocean-ice rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ocean-bright"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-sm font-semibold text-ocean-deep mb-1">
                                            <Globe className="h-3.5 w-3.5 inline mr-1 -mt-0.5" />
                                            Signing Secret <span className="text-ocean-deep/60 font-normal">(optional)</span>
                                        </label>
                                        <input
                                            value={s.webhookSecret}
                                            onChange={e => update({ webhookSecret: e.target.value })}
                                            placeholder="Leave blank to skip HMAC signing"
                                            className="w-full border border-ocean-ice rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ocean-bright"
                                        />
                                        <p className="text-xs text-ocean-deep/80 mt-1">ELVA will sign the payload with HMAC-SHA256 in the <code className="bg-ocean-ice px-1 rounded">X-ELVA-Signature</code> header</p>
                                    </div>
                                </div>
                            )}

                            {/* WhatsApp config */}
                            {s.channelType === 'whatsapp' && (
                                <div className="space-y-4 bg-ocean-powder rounded-xl p-4 border border-ocean-ice">
                                    <div className="flex items-start gap-2 text-xs text-green-800 bg-green-50 rounded-lg p-3 border border-green-200">
                                        <Smartphone className="h-4 w-4 shrink-0 mt-0.5 text-green-600" />
                                        <span><strong>BYOC: Bring Your Own Credentials.</strong> ELVA sends via your Meta Business API account. You pay Meta directly; ELVA charges nothing extra.</span>
                                    </div>
                                    <div>
                                        <label className="block text-sm font-semibold text-ocean-deep mb-1">Phone Number ID <span className="text-red-500">*</span></label>
                                        <input
                                            value={s.waPhoneNumberId}
                                            onChange={e => update({ waPhoneNumberId: e.target.value })}
                                            placeholder="Meta Business phone number ID"
                                            className="w-full border border-ocean-ice rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ocean-bright"
                                        />
                                        <p className="text-xs text-ocean-deep/80 mt-1">Found in Meta Business → WhatsApp → Phone Numbers</p>
                                    </div>
                                    <div>
                                        <label className="block text-sm font-semibold text-ocean-deep mb-1">Access Token <span className="text-red-500">*</span></label>
                                        <EmbeddedPasswordField
                                            value={s.waAccessToken}
                                            onChange={e => update({ waAccessToken: e.target.value })}
                                            placeholder="Meta permanent access token"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-sm font-semibold text-ocean-deep mb-1">Recipient Phone <span className="text-red-500">*</span></label>
                                        <input
                                            value={s.waRecipientPhone}
                                            onChange={e => update({ waRecipientPhone: e.target.value })}
                                            placeholder="+15550001234"
                                            className="w-full border border-ocean-ice rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ocean-bright"
                                        />
                                        <p className="text-xs text-ocean-deep/80 mt-1">WhatsApp number that will receive notifications (include country code)</p>
                                    </div>
                                </div>
                            )}
                        </div>
                    )}

                    {/* Step 2 - Template */}
                    {step === 2 && (
                        <div className="space-y-4">
                            <div className="flex items-center justify-between">
                                <p className="text-sm text-ocean-deep/90">Choose a built-in template or write your own.</p>
                                <label className="flex items-center gap-2 text-sm cursor-pointer">
                                    <input
                                        type="checkbox"
                                        checked={s.useCustomTemplate}
                                        onChange={e => update({ useCustomTemplate: e.target.checked })}
                                        className="rounded"
                                    />
                                    <span className="text-ocean-deep font-medium">Use custom template</span>
                                </label>
                            </div>

                            {s.useCustomTemplate ? (
                                <div className="space-y-3">
                                    {(s.channelType === 'email') && (
                                        <div>
                                            <label className="block text-sm font-semibold text-ocean-deep mb-1">Subject</label>
                                            <input
                                                value={s.customTemplateSubject}
                                                onChange={e => update({ customTemplateSubject: e.target.value })}
                                                placeholder="New Order #{{order.id}} - {{agent.name}}"
                                                className="w-full border border-ocean-ice rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ocean-bright"
                                            />
                                        </div>
                                    )}
                                    <div>
                                        <label className="block text-sm font-semibold text-ocean-deep mb-1">Body</label>
                                        <textarea
                                            value={s.customTemplateBody}
                                            onChange={e => update({ customTemplateBody: e.target.value })}
                                            rows={8}
                                            placeholder={
                                                s.channelType === 'slack'
                                                    ? `🛒 New Order #{{order.id}}\nCustomer: {{order.customerName}}\nTotal: {{order.currency}}{{order.total}}`
                                                    : s.channelType === 'email'
                                                    ? '<p>New order from <strong>{{order.customerName}}</strong></p>'
                                                    : s.channelType === 'whatsapp'
                                                    ? '🛒 New Order #{{order.id}}\nTotal: {{order.currency}}{{order.total}}'
                                                    : '{{order.customerName}} placed an order for {{order.currency}}{{order.total}}'
                                            }
                                            className="w-full border border-ocean-ice rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-ocean-bright"
                                        />
                                        <p className="text-xs text-ocean-deep/80 mt-1">
                                            Use <code className="bg-ocean-mist/50 px-1 rounded">{'{{order.total}}'}</code>,{' '}
                                            <code className="bg-ocean-mist/50 px-1 rounded">{'{{lead.name}}'}</code>,{' '}
                                            <code className="bg-ocean-mist/50 px-1 rounded">{'{{agent.name}}'}</code>, etc.
                                        </p>
                                    </div>
                                </div>
                            ) : (
                                <TemplateGallery
                                    source={s.source}
                                    channel={s.channelType}
                                    selectedId={s.templateId}
                                    onSelect={id => update({ templateId: id })}
                                />
                            )}
                        </div>
                    )}

                    {/* Step 3 - Review */}
                    {step === 3 && (
                        <div className="space-y-4">
                            <h3 className="font-semibold text-ocean-navy">Review your connector</h3>
                            <div className="bg-ocean-powder rounded-xl p-5 space-y-3 border border-ocean-ice">
                                {[
                                    { label: 'Name', value: s.name },
                                    { label: 'Source', value: `${s.source}: ${s.event}` },
                                    { label: 'Conditions', value: s.conditions.length ? `${s.conditions.length} condition(s) set` : 'None (fires on all events)' },
                                    { label: 'Channel', value: s.channelType },
                                    s.channelType === 'slack' && s.slackMode === 'webhook' && s.slackChannelLabel ? { label: 'Slack Channel', value: s.slackChannelLabel } : null,
                                    s.channelType === 'slack' && s.slackMode === 'oauth' ? { label: 'Workspace', value: s.slackWorkspaceName } : null,
                                    s.channelType === 'slack' && s.slackMode === 'oauth' && s.slackChannelName ? { label: 'Channel', value: `#${s.slackChannelName}` } : null,
                                    s.channelType === 'slack' && s.slackMode === 'oauth' ? { label: 'Two-way Actions', value: s.slackTwoWay ? 'Enabled' : 'Disabled' } : null,
                                    s.channelType === 'email' ? { label: 'Recipients', value: s.emailRecipients } : null,
                                    s.channelType === 'webhook' ? { label: 'Endpoint', value: s.webhookUrl } : null,
                                    s.channelType === 'whatsapp' ? { label: 'Recipient Phone', value: s.waRecipientPhone } : null,
                                    { label: 'Delivery Mode', value: s.deliveryMode.replace(/_/g, ' ') },
                                    { label: 'Template', value: s.useCustomTemplate ? 'Custom template' : 'Built-in template selected' },
                                ].filter(Boolean).map((row: any) => (
                                    <div key={row.label} className="flex justify-between text-sm">
                                        <span className="text-ocean-deep/80 font-medium">{row.label}</span>
                                        <span className="text-ocean-navy capitalize text-right max-w-[60%] truncate">{row.value}</span>
                                    </div>
                                ))}
                            </div>
                            <div className="bg-green-50 rounded-xl p-4 border border-green-200 text-sm text-green-800">
                                Once created, this connection activates immediately and fires whenever the trigger conditions are met.
                            </div>
                        </div>
                    )}
                </div>

                {/* Footer navigation */}
                <div className="flex items-center justify-between p-6 border-t border-ocean-ice/80">
                    <button
                        type="button"
                        onClick={() => step === 0 ? onClose() : setStep(step - 1)}
                        className="flex items-center px-4 py-2 text-ocean-deep/90 hover:text-ocean-navy font-medium"
                    >
                        <ChevronLeft className="h-4 w-4 mr-1" />
                        {step === 0 ? 'Cancel' : 'Back'}
                    </button>

                    {step < STEPS.length - 1 ? (
                        <button
                            type="button"
                            onClick={() => setStep(step + 1)}
                            disabled={!canNext()}
                            className="flex items-center px-5 py-2.5 bg-ocean-deep text-white rounded-xl font-medium hover:bg-ocean-rich disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                            Next <ChevronRight className="h-4 w-4 ml-1" />
                        </button>
                    ) : (
                        <button
                            type="button"
                            onClick={handleSave}
                            disabled={saving}
                            className="flex items-center px-5 py-2.5 bg-green-600 text-white rounded-xl font-medium hover:bg-green-700 disabled:opacity-50"
                        >
                            {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Check className="h-4 w-4 mr-2" />}
                            Create connector
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
}
