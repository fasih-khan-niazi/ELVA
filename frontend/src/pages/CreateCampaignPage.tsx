import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import {
    ArrowLeft, ArrowRight, Sparkles, LayoutTemplate, PenLine,
    Loader2, ChevronRight, Check, Calendar, UserCheck, Megaphone,
    DollarSign, Star, RefreshCw, Phone, AlertCircle, Plus, Trash2,
} from 'lucide-react';
import { PageBackNav, PAGE_BACK_NAV_BTN_CLS } from '../components/PageBackNav';
import { useToast } from '../components/Toast';
import {
    clearCampaignWizardDraft,
    loadCampaignWizardDraft,
    saveCampaignWizardDraft,
    type StoredCampaignDraft,
} from '../utils/campaignWizardDraft';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3000';

// ─── Types ─────────────────────────────────────────────────────────────────────

interface Agent {
    _id: string;
    name: string;
    type: string;
    callDirection: string;
}

interface TemplateCard {
    id: string;
    name: string;
    category: string;
    description: string;
    icon: string;
    goal: string;
    targetPersona: string;
    tags: string[];
}

interface CampaignDraft {
    agentId: string;
    name: string;
    description: string;
    goal: string;
    offer: string;
    targetPersona: string;
    valueProps: string[];
    painPoints: string[];
    openingScript: string;
    qualifyingQuestions: string[];
    objectionHandlers: { objection: string; response: string }[];
    callingHours: { startHour: number; endHour: number; daysOfWeek: number[]; timezoneOffsetMinutes: number };
    maxConcurrentCalls: number;
    retryAttempts: number;
    retryDelayMinutes: number;
    recordingEnabled: boolean;
    consentDisclosure: string;
    honorDnc: boolean;
    creationMethod: 'ai' | 'template' | 'manual';
    templateId?: string;
}

type Method = 'ai' | 'template' | 'manual' | null;

// ─── Icon map ─────────────────────────────────────────────────────────────────

const ICON_MAP: Record<string, React.ElementType> = {
    Calendar, UserCheck, Megaphone, DollarSign, Star, RefreshCw, Phone,
};

// ─── Goal labels ──────────────────────────────────────────────────────────────

const GOAL_LABELS: Record<string, string> = {
    book_meeting: 'Book a Meeting',
    qualify_lead: 'Qualify Lead (BANT)',
    transfer_to_human: 'Warm Transfer',
    nurture: 'Nurture',
    sell_direct: 'Direct Sell',
};

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const emptyDraft = (): CampaignDraft => ({
    agentId: '',
    name: '',
    description: '',
    goal: 'qualify_lead',
    offer: '',
    targetPersona: '',
    valueProps: ['', '', ''],
    painPoints: [''],
    openingScript: '',
    qualifyingQuestions: [
        'What challenges are you currently facing in this area?',
        "Who makes decisions about this at your company?",
        'Do you have a budget allocated for solving this?',
        'When are you looking to address this?',
    ],
    objectionHandlers: [
        { objection: "I'm not interested", response: "I completely understand. Many of our clients felt the same way at first. Could I ask what your biggest challenge is right now?" },
        { objection: "I'm too busy right now", response: "I appreciate that - I'll be quick. Would a 10-minute call later this week work?" },
    ],
    callingHours: { startHour: 9, endHour: 18, daysOfWeek: [1, 2, 3, 4, 5], timezoneOffsetMinutes: 0 },
    maxConcurrentCalls: 5,
    retryAttempts: 2,
    retryDelayMinutes: 60,
    recordingEnabled: false,
    consentDisclosure: '',
    honorDnc: true,
    creationMethod: 'manual',
});

// ─── Step indicators ──────────────────────────────────────────────────────────

function Steps({ step, total }: { step: number; total: number }) {
    return (
        <div className="flex items-center gap-1.5">
            {Array.from({ length: total }, (_, i) => (
                <div
                    key={i}
                    className={`h-1.5 rounded-full transition-all ${i < step ? 'bg-ocean-deep w-6' : i === step ? 'bg-ocean-sky w-4' : 'bg-ocean-ice w-3'}`}
                />
            ))}
        </div>
    );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function CreateCampaignPage() {
    const navigate = useNavigate();
    const { token } = useAuth();
    const toast = useToast();

    const [method, setMethod] = useState<Method>(null);
    const [step, setStep] = useState(0);

    // Data
    const [agents, setAgents] = useState<Agent[]>([]);
    const [templates, setTemplates] = useState<TemplateCard[]>([]);
    const [draft, setDraft] = useState<CampaignDraft>(emptyDraft());

    // AI method state
    const [aiPrompt, setAiPrompt] = useState('');
    const [aiLoading, setAiLoading] = useState(false);
    const [aiError, setAiError] = useState('');
    const [aiGenerated, setAiGenerated] = useState(false);

    // Template state
    const [selectedTemplate, setSelectedTemplate] = useState<TemplateCard | null>(null);
    const [templateLoading, setTemplateLoading] = useState(false);

    // Submit
    const [submitting, setSubmitting] = useState(false);
    const [submitError, setSubmitError] = useState('');

    const [searchParams] = useSearchParams();
    const initWizardRef = useRef(false);
    const [pendingRestoreTemplateId, setPendingRestoreTemplateId] = useState<string | null>(null);

    useEffect(() => {
        if (method === null) return;
        const handler = (e: BeforeUnloadEvent) => {
            e.preventDefault();
            e.returnValue = '';
        };
        window.addEventListener('beforeunload', handler);
        return () => window.removeEventListener('beforeunload', handler);
    }, [method]);

    const exitToMethodPicker = useCallback(() => {
        clearCampaignWizardDraft();
        setMethod(null);
        setAiGenerated(false);
        setSelectedTemplate(null);
        setPendingRestoreTemplateId(null);
        setDraft(emptyDraft());
        setStep(0);
        setAiPrompt('');
        setSubmitError('');
    }, []);

    useEffect(() => {
        if (initWizardRef.current) return;
        initWizardRef.current = true;

        if (searchParams.get('fresh') === '1') {
            clearCampaignWizardDraft();
            navigate('/campaigns/create', { replace: true });
            return;
        }

        const saved = loadCampaignWizardDraft();
        if (!saved) return;

        setMethod(saved.method);
        setStep(Math.max(0, Math.min(2, saved.step)));
        setAiGenerated(saved.aiGenerated);
        setDraft(saved.draft as CampaignDraft);
        setAiPrompt(saved.aiPrompt);
        if (saved.selectedTemplateId) setPendingRestoreTemplateId(saved.selectedTemplateId);
    }, [navigate, searchParams]);

    useEffect(() => {
        if (!pendingRestoreTemplateId || templates.length === 0) return;
        const t = templates.find(x => x.id === pendingRestoreTemplateId);
        if (t) setSelectedTemplate(t);
        setPendingRestoreTemplateId(null);
    }, [pendingRestoreTemplateId, templates]);

    useEffect(() => {
        if (method === null) return;
        const tid = window.setTimeout(() => {
            saveCampaignWizardDraft({
                method: method as StoredCampaignDraft['creationMethod'],
                step,
                aiGenerated,
                draft: draft as StoredCampaignDraft,
                aiPrompt,
                selectedTemplateId: selectedTemplate?.id ?? null,
            });
        }, 450);
        return () => window.clearTimeout(tid);
    }, [method, step, aiGenerated, draft, aiPrompt, selectedTemplate]);

    useEffect(() => {
        fetchAgents();
        fetchTemplates();
    }, [token]);

    const fetchAgents = async () => {
        try {
            const res = await fetch(`${API_BASE}/api/agents`, {
                headers: { Authorization: `Bearer ${token}` },
            });
            if (res.ok) {
                const data: Agent[] = await res.json();
                const outbound = data.filter(a => a.type === 'voice' && a.callDirection === 'outbound');
                setAgents(outbound);
                if (outbound.length === 1) {
                    setDraft(d =>
                        d.agentId ? d : { ...d, agentId: outbound[0]._id },
                    );
                }
            }
        } catch { /* ignore */ }
    };

    const fetchTemplates = async () => {
        try {
            const res = await fetch(`${API_BASE}/api/campaigns/templates`, {
                headers: { Authorization: `Bearer ${token}` },
            });
            if (res.ok) setTemplates(await res.json());
        } catch { /* ignore */ }
    };

    const loadTemplateDetail = async (tpl: TemplateCard) => {
        setTemplateLoading(true);
        try {
            const res = await fetch(`${API_BASE}/api/campaigns/templates/${tpl.id}`, {
                headers: { Authorization: `Bearer ${token}` },
            });
            if (res.ok) {
                const full = await res.json();
                setDraft(d => ({
                    ...d,
                    name: full.name,
                    description: full.description,
                    goal: full.goal,
                    offer: full.offer,
                    targetPersona: full.targetPersona,
                    valueProps: full.valueProps?.length ? full.valueProps : d.valueProps,
                    painPoints: full.painPoints?.length ? full.painPoints : d.painPoints,
                    openingScript: full.openingScript,
                    qualifyingQuestions: full.qualifyingQuestions?.length ? full.qualifyingQuestions : d.qualifyingQuestions,
                    objectionHandlers: full.objectionHandlers?.length ? full.objectionHandlers : d.objectionHandlers,
                    callingHours: full.callingHours || d.callingHours,
                    maxConcurrentCalls: full.maxConcurrentCalls ?? d.maxConcurrentCalls,
                    retryAttempts: full.retryAttempts ?? d.retryAttempts,
                    retryDelayMinutes: full.retryDelayMinutes ?? d.retryDelayMinutes,
                    recordingEnabled: full.recordingEnabled ?? d.recordingEnabled,
                    consentDisclosure: full.consentDisclosure ?? d.consentDisclosure,
                    creationMethod: 'template',
                    templateId: tpl.id,
                }));
            }
        } finally { setTemplateLoading(false); }
    };

    const handleAiGenerate = async () => {
        if (!aiPrompt.trim()) return;
        setAiLoading(true);
        setAiError('');
        try {
            const res = await fetch(`${API_BASE}/api/campaigns/generate`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                body: JSON.stringify({ prompt: aiPrompt }),
            });
            if (!res.ok) {
                const e = await res.json().catch(() => ({ message: 'Generation failed' }));
                throw new Error(e.message);
            }
            const data = await res.json();
            setDraft(d => ({
                ...d,
                name: data.name || d.name,
                description: data.description || d.description,
                goal: data.goal || d.goal,
                offer: data.offer || d.offer,
                targetPersona: data.targetPersona || d.targetPersona,
                valueProps: data.valueProps?.length ? data.valueProps : d.valueProps,
                painPoints: data.painPoints?.length ? data.painPoints : d.painPoints,
                openingScript: data.openingScript || d.openingScript,
                qualifyingQuestions: data.qualifyingQuestions?.length ? data.qualifyingQuestions : d.qualifyingQuestions,
                objectionHandlers: data.objectionHandlers?.length ? data.objectionHandlers : d.objectionHandlers,
                callingHours: data.callingHours || d.callingHours,
                maxConcurrentCalls: data.maxConcurrentCalls ?? d.maxConcurrentCalls,
                retryAttempts: data.retryAttempts ?? d.retryAttempts,
                retryDelayMinutes: data.retryDelayMinutes ?? d.retryDelayMinutes,
                consentDisclosure: data.consentDisclosure ?? d.consentDisclosure,
                creationMethod: 'ai',
            }));
            setAiGenerated(true);
            // Start at step 0 so user always picks outbound agent + confirms basics before script/settings.
            setStep(0);
        } catch (e: any) {
            const msg = e.message || 'Generation failed. Please try again.';
            setAiError(msg);
            toast.error('Generation failed', msg);
        } finally { setAiLoading(false); }
    };

    const handleSubmit = async () => {
        if (!draft.agentId) { setSubmitError('Please select an outbound agent'); return; }
        if (!draft.name.trim()) { setSubmitError('Campaign name is required'); return; }

        setSubmitting(true);
        setSubmitError('');
        try {
            const body = {
                ...draft,
                valueProps: draft.valueProps.filter(Boolean),
                painPoints: draft.painPoints.filter(Boolean),
            };
            const res = await fetch(`${API_BASE}/api/campaigns`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                body: JSON.stringify(body),
            });
            if (!res.ok) {
                const e = await res.json().catch(() => ({ message: 'Failed' }));
                throw new Error(e.message);
            }
            const created = await res.json();
            clearCampaignWizardDraft();
            toast.success('Campaign created', draft.name.trim());
            navigate(`/campaigns/${created._id}`);
        } catch (e: any) {
            const msg = e.message || 'Error creating campaign';
            setSubmitError(msg);
            toast.error('Could not create campaign', msg);
        } finally { setSubmitting(false); }
    };

    // ─── Method Selection ─────────────────────────────────────────────────────

    if (!method) {
        return (
            <div className="bg-white pb-12">
                <div className="max-w-3xl mx-auto px-4 py-10">
                    <PageBackNav to="/campaigns" label="Back to Campaigns" />
                    <div className="mb-8">
                        <h1 className="text-2xl font-bold text-ocean-navy">Create a Campaign</h1>
                        <p className="text-ocean-deep/80 mt-1">Choose how you'd like to set up your outbound campaign.</p>
                    </div>

                    <div className="grid gap-4">
                        {/* AI */}
                        <button
                            onClick={() => { setMethod('ai'); setStep(0); setDraft({ ...emptyDraft(), creationMethod: 'ai' }); }}
                            className="group bg-white border-2 border-ocean-ice hover:border-ocean-bright rounded-2xl p-6 text-left transition-all hover:shadow-md"
                        >
                            <div className="flex items-start gap-4">
                                <div className="bg-ocean-mist p-3 rounded-xl group-hover:bg-ocean-deep transition-colors">
                                    <Sparkles className="h-6 w-6 text-ocean-deep group-hover:text-white transition-colors" />
                                </div>
                                <div className="flex-1">
                                    <div className="flex items-center justify-between">
                                        <h3 className="text-base font-semibold text-ocean-navy">Generate with AI</h3>
                                        <span className="text-xs bg-ocean-powder text-ocean-deep font-medium px-2 py-0.5 rounded-full">Recommended</span>
                                    </div>
                                    <p className="text-sm text-ocean-deep/80 mt-1">Describe your goal in plain English and AI will generate the full script, questions, objection handlers, and settings.</p>
                                    <p className="text-xs text-ocean-deep/60 mt-2">Example: "Follow up with leads who downloaded our pricing guide and book a 20-minute demo"</p>
                                </div>
                                <ChevronRight className="h-5 w-5 text-gray-300 group-hover:text-ocean-rich self-center transition-colors" />
                            </div>
                        </button>

                        {/* Template */}
                        <button
                            onClick={() => { setMethod('template'); setStep(0); setDraft({ ...emptyDraft(), creationMethod: 'template' }); }}
                            className="group bg-white border-2 border-ocean-ice hover:border-emerald-400 rounded-2xl p-6 text-left transition-all hover:shadow-md"
                        >
                            <div className="flex items-start gap-4">
                                <div className="bg-emerald-100 p-3 rounded-xl group-hover:bg-emerald-600 transition-colors">
                                    <LayoutTemplate className="h-6 w-6 text-emerald-600 group-hover:text-white transition-colors" />
                                </div>
                                <div className="flex-1">
                                    <h3 className="text-base font-semibold text-ocean-navy">Start from a Template</h3>
                                    <p className="text-sm text-ocean-deep/80 mt-1">Choose from 7 proven templates: appointment reminders, cold outreach, lead follow-up, win-back, and more.</p>
                                    <p className="text-xs text-ocean-deep/60 mt-2">Pre-filled scripts and settings you can customize before launching.</p>
                                </div>
                                <ChevronRight className="h-5 w-5 text-gray-300 group-hover:text-emerald-500 self-center transition-colors" />
                            </div>
                        </button>

                        {/* Manual */}
                        <button
                            onClick={() => { setMethod('manual'); setStep(0); setDraft({ ...emptyDraft(), creationMethod: 'manual' }); }}
                            className="group bg-white border-2 border-ocean-ice hover:border-gray-400 rounded-2xl p-6 text-left transition-all hover:shadow-md"
                        >
                            <div className="flex items-start gap-4">
                                <div className="bg-ocean-mist/50 p-3 rounded-xl group-hover:bg-gray-700 transition-colors">
                                    <PenLine className="h-6 w-6 text-ocean-deep/90 group-hover:text-white transition-colors" />
                                </div>
                                <div className="flex-1">
                                    <h3 className="text-base font-semibold text-ocean-navy">Build Manually</h3>
                                    <p className="text-sm text-ocean-deep/80 mt-1">Full control - define every aspect of your campaign from scratch. Best if you have a proven script ready.</p>
                                </div>
                                <ChevronRight className="h-5 w-5 text-gray-300 group-hover:text-ocean-deep/80 self-center transition-colors" />
                            </div>
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    // ─── AI Method ────────────────────────────────────────────────────────────

    if (method === 'ai' && !aiGenerated) {
        return (
            <div className="bg-white pb-12">
                <div className="max-w-2xl mx-auto px-4 py-10">
                    <nav aria-label="Back navigation">
                        <button type="button" onClick={exitToMethodPicker} className={`${PAGE_BACK_NAV_BTN_CLS} mb-8`}>
                            <ArrowLeft className="h-4 w-4 shrink-0" aria-hidden /> Back
                        </button>
                    </nav>
                    <div className="flex items-center gap-3 mb-6">
                        <div className="bg-ocean-mist p-2.5 rounded-xl">
                            <Sparkles className="h-5 w-5 text-ocean-deep" />
                        </div>
                        <div>
                            <h1 className="text-xl font-bold text-ocean-navy">Generate with AI</h1>
                            <p className="text-sm text-ocean-deep/80">Describe your campaign and AI will build the whole thing.</p>
                        </div>
                    </div>

                    <div className="bg-white rounded-2xl border border-ocean-ice p-6 space-y-4">
                        <div>
                            <label className="block text-sm font-medium text-ocean-deep mb-2">
                                What is the goal of this campaign?
                            </label>
                            <textarea
                                value={aiPrompt}
                                onChange={e => setAiPrompt(e.target.value)}
                                rows={5}
                                placeholder={`Examples:\n• "Follow up with leads who downloaded our pricing guide and book a 20-minute demo"\n• "Call patients to remind them about their dentist appointment next week"\n• "Reach out to churned customers from 6 months ago with a win-back offer"`}
                                className="w-full px-4 py-3 border border-ocean-ice rounded-xl focus:ring-2 focus:ring-ocean-bright outline-none text-sm resize-none"
                            />
                        </div>

                        {aiError && (
                            <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
                                <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                                {aiError}
                            </div>
                        )}

                        <div className="flex justify-end">
                            <button
                                onClick={handleAiGenerate}
                                disabled={!aiPrompt.trim() || aiLoading}
                                className="flex items-center gap-2 px-6 py-2.5 bg-ocean-deep text-white rounded-xl font-medium hover:bg-ocean-rich disabled:opacity-50 transition-all"
                            >
                                {aiLoading ? (
                                    <><Loader2 className="h-4 w-4 animate-spin" /> Generating...</>
                                ) : (
                                    <><Sparkles className="h-4 w-4" /> Generate Campaign</>
                                )}
                            </button>
                        </div>

                        <div className="border-t border-ocean-ice/80 pt-3">
                            <p className="text-xs text-ocean-deep/60">AI will create: campaign name, opening script, qualifying questions, objection handlers, calling schedule, and recommended settings. You can edit everything before saving.</p>
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    // ─── Template Selection ───────────────────────────────────────────────────

    if (method === 'template' && !draft.templateId) {
        return (
            <div className="bg-white pb-12">
                <div className="max-w-4xl mx-auto px-4 py-10">
                    <nav aria-label="Back navigation">
                        <button type="button" onClick={exitToMethodPicker} className={`${PAGE_BACK_NAV_BTN_CLS} mb-8`}>
                            <ArrowLeft className="h-4 w-4 shrink-0" aria-hidden /> Back
                        </button>
                    </nav>
                    <div className="flex items-center gap-3 mb-6">
                        <div className="bg-emerald-100 p-2.5 rounded-xl">
                            <LayoutTemplate className="h-5 w-5 text-emerald-600" />
                        </div>
                        <div>
                            <h1 className="text-xl font-bold text-ocean-navy">Choose a Template</h1>
                            <p className="text-sm text-ocean-deep/80">Select a template to pre-fill your campaign. You can customize everything.</p>
                        </div>
                    </div>

                    {templateLoading && (
                        <div className="flex items-center justify-center py-16 text-ocean-deep/60">
                            <Loader2 className="h-6 w-6 animate-spin mr-2" /> Loading template...
                        </div>
                    )}

                    <div className="grid sm:grid-cols-2 gap-4">
                        {templates.map(tpl => {
                            const Icon = ICON_MAP[tpl.icon] || Phone;
                            const isSelected = selectedTemplate?.id === tpl.id;
                            return (
                                <button
                                    key={tpl.id}
                                    onClick={async () => {
                                        setSelectedTemplate(tpl);
                                        await loadTemplateDetail(tpl);
                                        setStep(0);
                                    }}
                                    className={`text-left bg-white rounded-2xl border-2 p-5 hover:border-emerald-400 hover:shadow-md transition-all ${isSelected ? 'border-emerald-500' : 'border-ocean-ice'}`}
                                >
                                    <div className="flex items-start gap-3">
                                        <div className="bg-emerald-50 p-2 rounded-lg shrink-0">
                                            <Icon className="h-5 w-5 text-emerald-600" />
                                        </div>
                                        <div>
                                            <div className="flex items-center gap-2">
                                                <span className="font-semibold text-ocean-navy text-sm">{tpl.name}</span>
                                                {isSelected && <Check className="h-3.5 w-3.5 text-emerald-600" />}
                                            </div>
                                            <span className="text-xs text-emerald-700 font-medium">{tpl.category}</span>
                                            <p className="text-xs text-ocean-deep/80 mt-1 leading-relaxed">{tpl.description}</p>
                                            <div className="flex flex-wrap gap-1 mt-2">
                                                {tpl.tags.slice(0, 3).map(tag => (
                                                    <span key={tag} className="text-xs bg-ocean-mist/50 text-ocean-deep/80 px-1.5 py-0.5 rounded">{tag}</span>
                                                ))}
                                            </div>
                                        </div>
                                    </div>
                                </button>
                            );
                        })}
                    </div>
                </div>
            </div>
        );
    }

    // ─── Review / Edit + Final Steps ──────────────────────────────────────────

    const totalSteps = 3;

    return (
        <div className="bg-white pb-12">
            <div className="max-w-3xl mx-auto px-4 py-10">
                <div className="flex items-center justify-between mb-8">
                    <nav aria-label="Back navigation">
                        <button
                            type="button"
                            onClick={() => {
                                if (step === 0) exitToMethodPicker();
                                else setStep(s => s - 1);
                            }}
                            className={PAGE_BACK_NAV_BTN_CLS}
                        >
                            <ArrowLeft className="h-4 w-4 shrink-0" aria-hidden /> Back
                        </button>
                    </nav>
                    <Steps step={step} total={totalSteps} />
                </div>

                {/* Step 0: Agent + Basics */}
                {step === 0 && (
                    <div className="space-y-6">
                        <div>
                            <h2 className="text-xl font-bold text-ocean-navy">Campaign Basics</h2>
                            <p className="text-ocean-deep/80 text-sm mt-1">Assign an agent and set the campaign foundation.</p>
                        </div>

                        {/* Agent picker */}
                        <div className="bg-white rounded-2xl border border-ocean-ice p-5 space-y-4">
                            <h3 className="text-sm font-semibold text-ocean-deep uppercase tracking-wide">Outbound Agent</h3>
                            {agents.length === 0 ? (
                                <div className="flex items-center gap-2 p-3 bg-amber-50 border border-amber-200 rounded-lg text-amber-700 text-sm">
                                    <AlertCircle className="h-4 w-4 shrink-0" />
                                    No outbound voice agents found. <a href="/create-agent" className="underline ml-1">Create one first</a>.
                                </div>
                            ) : (
                                <div className="grid gap-2">
                                    {agents.map(a => (
                                        <button
                                            key={a._id}
                                            onClick={() => setDraft(d => ({ ...d, agentId: a._id }))}
                                            className={`flex items-center gap-3 p-3 rounded-xl border-2 text-left transition-all ${draft.agentId === a._id ? 'border-ocean-deep bg-ocean-powder' : 'border-ocean-ice hover:border-ocean-ice'}`}
                                        >
                                            <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold ${draft.agentId === a._id ? 'bg-ocean-deep text-white' : 'bg-ocean-mist/50 text-ocean-deep/90'}`}>
                                                {a.name[0]?.toUpperCase()}
                                            </div>
                                            <span className="text-sm font-medium text-ocean-deep">{a.name}</span>
                                            {draft.agentId === a._id && <Check className="h-4 w-4 text-ocean-deep ml-auto" />}
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>

                        {/* Name + Goal + Description */}
                        <div className="bg-white rounded-2xl border border-ocean-ice p-5 space-y-4">
                            <h3 className="text-sm font-semibold text-ocean-deep uppercase tracking-wide">Details</h3>
                            <div>
                                <label className="block text-sm font-medium text-ocean-deep mb-1">Campaign Name</label>
                                <input
                                    type="text"
                                    value={draft.name}
                                    onChange={e => setDraft(d => ({ ...d, name: e.target.value }))}
                                    className="w-full px-3 py-2 border border-ocean-ice rounded-lg outline-none focus:ring-2 focus:ring-ocean-bright text-sm"
                                    placeholder="e.g., Q2 SMB Lead Follow-Up"
                                />
                            </div>
                            <div className="grid sm:grid-cols-2 gap-3">
                                <div>
                                    <label className="block text-sm font-medium text-ocean-deep mb-1">Primary Goal</label>
                                    <select
                                        title="Primary Goal"
                                        value={draft.goal}
                                        onChange={e => setDraft(d => ({ ...d, goal: e.target.value }))}
                                        className="w-full px-3 py-2 border border-ocean-ice rounded-lg outline-none focus:ring-2 focus:ring-ocean-bright bg-white text-sm"
                                    >
                                        {Object.entries(GOAL_LABELS).map(([v, l]) => (
                                            <option key={v} value={v}>{l}</option>
                                        ))}
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-ocean-deep mb-1">Description (optional)</label>
                                    <input
                                        type="text"
                                        value={draft.description}
                                        onChange={e => setDraft(d => ({ ...d, description: e.target.value }))}
                                        className="w-full px-3 py-2 border border-ocean-ice rounded-lg outline-none focus:ring-2 focus:ring-ocean-bright text-sm"
                                        placeholder="Internal notes..."
                                    />
                                </div>
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-ocean-deep mb-1">What are you offering?</label>
                                <input
                                    type="text"
                                    value={draft.offer}
                                    onChange={e => setDraft(d => ({ ...d, offer: e.target.value }))}
                                    className="w-full px-3 py-2 border border-ocean-ice rounded-lg outline-none focus:ring-2 focus:ring-ocean-bright text-sm"
                                    placeholder="e.g., A free 15-minute consultation on reducing support costs"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-ocean-deep mb-1">Target Persona</label>
                                <input
                                    type="text"
                                    value={draft.targetPersona}
                                    onChange={e => setDraft(d => ({ ...d, targetPersona: e.target.value }))}
                                    className="w-full px-3 py-2 border border-ocean-ice rounded-lg outline-none focus:ring-2 focus:ring-ocean-bright text-sm"
                                    placeholder="e.g., Operations leaders at 50-500 person SaaS companies"
                                />
                            </div>
                        </div>

                        <div className="flex justify-end">
                            <button
                                onClick={() => {
                                    if (!draft.agentId) return setSubmitError('Please select an agent');
                                    if (!draft.name.trim()) return setSubmitError('Campaign name is required');
                                    setSubmitError('');
                                    setStep(1);
                                }}
                                disabled={!draft.agentId || !draft.name.trim()}
                                className="flex items-center gap-2 px-6 py-2.5 bg-ocean-deep text-white rounded-xl font-medium hover:bg-ocean-rich disabled:opacity-40 transition-all"
                            >
                                Continue <ArrowRight className="h-4 w-4" />
                            </button>
                        </div>
                        {submitError && <p className="text-red-600 text-sm text-right">{submitError}</p>}
                    </div>
                )}

                {/* Step 1: Script & Playbook */}
                {step === 1 && (
                    <div className="space-y-6">
                        <div>
                            <h2 className="text-xl font-bold text-ocean-navy">Script & Playbook</h2>
                            <p className="text-ocean-deep/80 text-sm mt-1">Review and edit the AI-generated or template-filled script.</p>
                        </div>

                        <div className="bg-white rounded-2xl border border-ocean-ice p-5 space-y-5">
                            <div>
                                <label className="block text-sm font-medium text-ocean-deep mb-1">Opening Script</label>
                                <textarea
                                    value={draft.openingScript}
                                    onChange={e => setDraft(d => ({ ...d, openingScript: e.target.value }))}
                                    rows={4}
                                    placeholder="Hi {firstName}, this is {agentName} from {businessName}..."
                                    className="w-full px-3 py-2.5 border border-ocean-ice rounded-lg outline-none focus:ring-2 focus:ring-ocean-bright text-sm"
                                />
                                <p className="text-xs text-ocean-deep/60 mt-1">Use {'{agentName}'}, {'{businessName}'}, {'{firstName}'} as placeholders.</p>
                            </div>

                            <div>
                                <div className="flex items-center justify-between mb-2">
                                    <label className="block text-sm font-medium text-ocean-deep">Qualifying Questions</label>
                                    <button
                                        type="button"
                                        onClick={() => setDraft(d => ({ ...d, qualifyingQuestions: [...d.qualifyingQuestions, ''] }))}
                                        className="text-xs text-ocean-deep hover:text-ocean-deep flex items-center gap-1"
                                    >
                                        <Plus className="h-3.5 w-3.5" /> Add
                                    </button>
                                </div>
                                <div className="space-y-2">
                                    {draft.qualifyingQuestions.map((q, i) => (
                                        <div key={i} className="flex gap-2">
                                            <input
                                                type="text"
                                                value={q}
                                                onChange={e => {
                                                    const qs = [...draft.qualifyingQuestions];
                                                    qs[i] = e.target.value;
                                                    setDraft(d => ({ ...d, qualifyingQuestions: qs }));
                                                }}
                                                className="flex-1 px-3 py-2 border border-ocean-ice rounded-lg outline-none focus:ring-2 focus:ring-ocean-bright text-sm"
                                                placeholder={`Question ${i + 1}`}
                                            />
                                            {draft.qualifyingQuestions.length > 1 && (
                                                <button
                                                    type="button"
                                                    onClick={() => setDraft(d => ({ ...d, qualifyingQuestions: d.qualifyingQuestions.filter((_, j) => j !== i) }))}
                                                    className="text-ocean-deep/60 hover:text-red-500"
                                                >
                                                    <Trash2 className="h-4 w-4" />
                                                </button>
                                            )}
                                        </div>
                                    ))}
                                </div>
                            </div>

                            <div>
                                <div className="flex items-center justify-between mb-2">
                                    <label className="block text-sm font-medium text-ocean-deep">Objection Handlers</label>
                                    <button
                                        type="button"
                                        onClick={() => setDraft(d => ({ ...d, objectionHandlers: [...d.objectionHandlers, { objection: '', response: '' }] }))}
                                        className="text-xs text-ocean-deep hover:text-ocean-deep flex items-center gap-1"
                                    >
                                        <Plus className="h-3.5 w-3.5" /> Add
                                    </button>
                                </div>
                                <div className="space-y-3">
                                    {draft.objectionHandlers.map((oh, i) => (
                                        <div key={i} className="border border-ocean-ice rounded-lg p-3 space-y-2 relative">
                                            <button
                                                type="button"
                                                onClick={() => setDraft(d => ({ ...d, objectionHandlers: d.objectionHandlers.filter((_, j) => j !== i) }))}
                                                className="absolute top-2 right-2 text-gray-300 hover:text-red-500"
                                            >
                                                <Trash2 className="h-3.5 w-3.5" />
                                            </button>
                                            <input
                                                type="text"
                                                value={oh.objection}
                                                onChange={e => {
                                                    const ohs = [...draft.objectionHandlers];
                                                    ohs[i] = { ...ohs[i], objection: e.target.value };
                                                    setDraft(d => ({ ...d, objectionHandlers: ohs }));
                                                }}
                                                className="w-full px-3 py-1.5 border border-ocean-ice rounded text-sm outline-none focus:ring-1 focus:ring-ocean-bright"
                                                placeholder="Objection (e.g., I'm not interested)"
                                            />
                                            <textarea
                                                value={oh.response}
                                                onChange={e => {
                                                    const ohs = [...draft.objectionHandlers];
                                                    ohs[i] = { ...ohs[i], response: e.target.value };
                                                    setDraft(d => ({ ...d, objectionHandlers: ohs }));
                                                }}
                                                rows={2}
                                                className="w-full px-3 py-1.5 border border-ocean-ice rounded text-sm outline-none focus:ring-1 focus:ring-ocean-bright resize-none"
                                                placeholder="Response..."
                                            />
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>

                        <div className="flex justify-between">
                            <button onClick={() => setStep(0)} className="px-4 py-2.5 border border-ocean-ice rounded-xl text-sm text-ocean-deep hover:bg-ocean-powder">
                                Back
                            </button>
                            <button
                                onClick={() => setStep(2)}
                                className="flex items-center gap-2 px-6 py-2.5 bg-ocean-deep text-white rounded-xl font-medium hover:bg-ocean-rich"
                            >
                                Continue <ArrowRight className="h-4 w-4" />
                            </button>
                        </div>
                    </div>
                )}

                {/* Step 2: Settings + Launch */}
                {step === 2 && (
                    <div className="space-y-6">
                        <div>
                            <h2 className="text-xl font-bold text-ocean-navy">Schedule & Settings</h2>
                            <p className="text-ocean-deep/80 text-sm mt-1">Configure calling hours, concurrency, and compliance.</p>
                        </div>

                        <div className="bg-white rounded-2xl border border-ocean-ice p-5 space-y-5">
                            {/* Calling hours */}
                            <div>
                                <h3 className="text-sm font-semibold text-ocean-deep mb-3">Calling Hours</h3>
                                <div className="flex flex-wrap gap-2 mb-3">
                                    {DAYS.map((day, i) => (
                                        <button
                                            key={i}
                                            type="button"
                                            onClick={() => {
                                                const days = draft.callingHours.daysOfWeek.includes(i)
                                                    ? draft.callingHours.daysOfWeek.filter(d => d !== i)
                                                    : [...draft.callingHours.daysOfWeek, i].sort();
                                                setDraft(d => ({ ...d, callingHours: { ...d.callingHours, daysOfWeek: days } }));
                                            }}
                                            className={`px-3 py-1.5 rounded-lg text-xs font-medium border-2 transition-all ${draft.callingHours.daysOfWeek.includes(i) ? 'border-ocean-deep bg-ocean-powder text-ocean-deep' : 'border-ocean-ice text-ocean-deep/80 hover:border-ocean-ice'}`}
                                        >
                                            {day}
                                        </button>
                                    ))}
                                </div>
                                <div className="grid grid-cols-2 gap-3">
                                    <div>
                                        <label className="block text-xs text-ocean-deep/80 mb-1">Start Hour (0-23)</label>
                                        <input
                                            type="number" min={0} max={23}
                                            title="Start Hour"
                                            value={draft.callingHours.startHour}
                                            onChange={e => setDraft(d => ({ ...d, callingHours: { ...d.callingHours, startHour: parseInt(e.target.value) || 9 } }))}
                                            className="w-full px-3 py-2 border border-ocean-ice rounded-lg outline-none text-sm"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-xs text-ocean-deep/80 mb-1">End Hour (0-24)</label>
                                        <input
                                            type="number" min={1} max={24}
                                            title="End Hour"
                                            value={draft.callingHours.endHour}
                                            onChange={e => setDraft(d => ({ ...d, callingHours: { ...d.callingHours, endHour: parseInt(e.target.value) || 18 } }))}
                                            className="w-full px-3 py-2 border border-ocean-ice rounded-lg outline-none text-sm"
                                        />
                                    </div>
                                </div>
                            </div>

                            {/* Dialer settings */}
                            <div>
                                <h3 className="text-sm font-semibold text-ocean-deep mb-3">Dialer Settings</h3>
                                <div className="grid grid-cols-3 gap-3">
                                    <div>
                                        <label className="block text-xs text-ocean-deep/80 mb-1">Concurrent Calls</label>
                                        <input type="number" min={1} max={10} title="Concurrent Calls"
                                            value={draft.maxConcurrentCalls}
                                            onChange={e => setDraft(d => ({ ...d, maxConcurrentCalls: parseInt(e.target.value) || 1 }))}
                                            className="w-full px-3 py-2 border border-ocean-ice rounded-lg outline-none text-sm" />
                                    </div>
                                    <div>
                                        <label className="block text-xs text-ocean-deep/80 mb-1">Retry Attempts</label>
                                        <input type="number" min={0} max={5} title="Retry Attempts"
                                            value={draft.retryAttempts}
                                            onChange={e => setDraft(d => ({ ...d, retryAttempts: parseInt(e.target.value) || 0 }))}
                                            className="w-full px-3 py-2 border border-ocean-ice rounded-lg outline-none text-sm" />
                                    </div>
                                    <div>
                                        <label className="block text-xs text-ocean-deep/80 mb-1">Retry Delay (min)</label>
                                        <input type="number" min={5} max={10080} title="Retry Delay"
                                            value={draft.retryDelayMinutes}
                                            onChange={e => setDraft(d => ({ ...d, retryDelayMinutes: parseInt(e.target.value) || 60 }))}
                                            className="w-full px-3 py-2 border border-ocean-ice rounded-lg outline-none text-sm" />
                                    </div>
                                </div>
                            </div>

                            {/* Compliance */}
                            <div>
                                <h3 className="text-sm font-semibold text-ocean-deep mb-3">Compliance</h3>
                                <div className="space-y-3">
                                    <div className="flex items-center gap-3">
                                        <input type="checkbox" id="recording" checked={draft.recordingEnabled}
                                            onChange={e => setDraft(d => ({ ...d, recordingEnabled: e.target.checked }))}
                                            className="h-4 w-4 rounded accent-ocean-deep" />
                                        <label htmlFor="recording" className="text-sm text-ocean-deep">Enable call recording</label>
                                    </div>
                                    <div className="flex items-center gap-3">
                                        <input type="checkbox" id="honor-dnc" checked={draft.honorDnc}
                                            onChange={e => setDraft(d => ({ ...d, honorDnc: e.target.checked }))}
                                            className="h-4 w-4 rounded accent-ocean-deep" />
                                        <label htmlFor="honor-dnc" className="text-sm text-ocean-deep">Honor tenant-wide DNC list</label>
                                    </div>
                                    <div>
                                        <label className="block text-xs text-ocean-deep/80 mb-1">Consent / Disclosure (optional)</label>
                                        <input type="text"
                                            value={draft.consentDisclosure}
                                            onChange={e => setDraft(d => ({ ...d, consentDisclosure: e.target.value }))}
                                            className="w-full px-3 py-2 border border-ocean-ice rounded-lg outline-none text-sm"
                                            placeholder="This call may be recorded for quality purposes." />
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* Review summary */}
                        <div className="bg-ocean-powder border border-ocean-ice rounded-2xl p-4">
                            <h3 className="text-sm font-semibold text-ocean-navy mb-2">Review Summary</h3>
                            <div className="grid sm:grid-cols-2 gap-y-1.5 text-sm">
                                <div className="sm:col-span-2">
                                    <span className="text-ocean-deep/80">Outbound agent:</span>{' '}
                                    <span className="font-medium text-ocean-deep">
                                        {draft.agentId
                                            ? agents.find(a => a._id === draft.agentId)?.name || 'Unknown'
                                            : 'Not selected'}
                                    </span>
                                </div>
                                <div><span className="text-ocean-deep/80">Name:</span> <span className="font-medium text-ocean-deep">{draft.name}</span></div>
                                <div><span className="text-ocean-deep/80">Goal:</span> <span className="font-medium text-ocean-deep">{GOAL_LABELS[draft.goal] || draft.goal}</span></div>
                                <div><span className="text-ocean-deep/80">Questions:</span> <span className="font-medium text-ocean-deep">{draft.qualifyingQuestions.filter(Boolean).length}</span></div>
                                <div><span className="text-ocean-deep/80">Objection handlers:</span> <span className="font-medium text-ocean-deep">{draft.objectionHandlers.filter(o => o.objection).length}</span></div>
                                <div><span className="text-ocean-deep/80">Concurrent calls:</span> <span className="font-medium text-ocean-deep">{draft.maxConcurrentCalls}</span></div>
                                <div><span className="text-ocean-deep/80">Retries:</span> <span className="font-medium text-ocean-deep">{draft.retryAttempts}× / {draft.retryDelayMinutes}min</span></div>
                            </div>
                        </div>

                        {submitError && (
                            <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
                                <AlertCircle className="h-4 w-4 shrink-0" /> {submitError}
                            </div>
                        )}

                        <div className="flex justify-between">
                            <button onClick={() => setStep(1)} className="px-4 py-2.5 border border-ocean-ice rounded-xl text-sm text-ocean-deep hover:bg-ocean-powder">
                                Back
                            </button>
                            <button
                                onClick={handleSubmit}
                                disabled={submitting || !draft.agentId || !draft.name.trim()}
                                className="flex items-center gap-2 px-6 py-2.5 bg-ocean-deep text-white rounded-xl font-medium hover:bg-ocean-rich disabled:opacity-50"
                            >
                                {submitting ? <><Loader2 className="h-4 w-4 animate-spin" /> Creating...</> : <><Check className="h-4 w-4" /> Create Campaign</>}
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
