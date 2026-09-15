import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../components/Toast';
import { handleApiError, handleNetworkError } from '@/lib/apiError';
import { PageBackNav } from '../components/PageBackNav';
import {
    PlayCircle, Pause, StopCircle, Upload, RefreshCw, Users,
    Phone, Target, Download, Clock, X, Ban,
    MessageSquare, AlertCircle, Sparkles, Filter, Activity,
    PenLine, ScrollText, LayoutDashboard, FlaskConical, Flame, PhoneForwarded,
    FileText,
} from 'lucide-react';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3000';

// ─── Types ────────────────────────────────────────────────────────────────

interface CampaignStats {
    pending: number;
    calling: number;
    interested: number;
    notInterested: number;
    noAnswer: number;
    voicemail: number;
    failed: number;
    callback: number;
    dnc: number;
    wrongNumber: number;
    connectedCalls: number;
    totalCallDurationSec: number;
}

interface ObjectionHandler {
    objection: string;
    response: string;
}

interface CallingHours {
    startHour: number;
    endHour: number;
    daysOfWeek: number[];
    timezoneOffsetMinutes: number;
}

interface Campaign {
    _id: string;
    name: string;
    description: string;
    status: 'draft' | 'running' | 'paused' | 'completed' | 'stopped' | 'scheduled';
    goal: string;
    offer: string;
    valueProps: string[];
    targetPersona: string;
    painPoints: string[];
    openingScript: string;
    qualifyingQuestions: string[];
    objectionHandlers: ObjectionHandler[];
    callingHours: CallingHours;
    recordingEnabled: boolean;
    consentDisclosure: string;
    honorDnc: boolean;
    totalContacts: number;
    maxConcurrentCalls: number;
    retryAttempts: number;
    retryDelayMinutes: number;
    callerIdNumber: string;
    stats: CampaignStats;
    agentId: { _id: string; name: string; transferNumber?: string } | null;
    createdAt: string;
    scheduledStartAt?: string;
    dialerActive?: boolean;
    callingAllowed?: { allowed: boolean; reason?: string };
    contactFilters?: {
        tags: string[];
        cities: string[];
        companies: string[];
        statuses: string[];
        minLeadScore?: number;
        maxLeadScore?: number;
    };
    abTest?: {
        enabled: boolean;
        variantBScript: string;
        variantBStats: {
            interested: number;
            notInterested: number;
            noAnswer: number;
            voicemail: number;
            connectedCalls: number;
        };
    };
}

interface Bant {
    budget: number;
    authority: number;
    need: number;
    timeline: number;
}

interface Contact {
    _id: string;
    phone: string;
    name: string;
    email: string;
    company: string;
    title?: string;
    status: string;
    disposition?: string;
    attemptCount: number;
    callDurationSec: number;
    aiSummary?: string;
    leadScore?: number;
    bant?: Bant;
    tags?: string[];
    callbackAt?: string;
    callbackReason?: string;
    dnc?: boolean;
    notes?: string;
    lastAttemptAt: string;
    callSid?: string;
}

interface Kpis {
    totalContacts: number;
    totalCalled: number;
    connected: number;
    conversions: number;
    connectRate: number;
    conversionRate: number;
    overallConversion: number;
    avgDurationSec: number;
    totalCallDurationSec: number;
    avgLeadScore: number;
    maxLeadScore: number;
    dispositions: Record<string, number>;
    stats: CampaignStats;
}

interface ContactDetail {
    contact: Contact;
    turns: Array<{
        turnIndex: number;
        inputTranscript: string;
        aiResponse: string;
        intent?: string;
        latencyMs: number;
        createdAt: string;
    }>;
}

// ─── Constants ────────────────────────────────────────────────────────────

const STATUS_COLORS: Record<string, string> = {
    draft:     'bg-ocean-mist/50 text-ocean-deep/90',
    scheduled: 'bg-blue-100 text-blue-700',
    running:   'bg-green-100 text-green-700',
    paused:    'bg-yellow-100 text-yellow-700',
    completed: 'bg-ocean-mist text-ocean-deep',
    stopped:   'bg-red-100 text-red-600',
};

const CONTACT_STATUS_COLORS: Record<string, string> = {
    pending: 'text-ocean-deep/80',
    calling: 'text-blue-600',
    interested: 'text-green-600',
    not_interested: 'text-red-500',
    no_answer: 'text-yellow-600',
    voicemail: 'text-purple-600',
    failed: 'text-red-700',
    callback: 'text-orange-500',
    dnc: 'text-ocean-deep/60',
    wrong_number: 'text-pink-500',
};

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

type PipelineTab = 'hot' | 'contacts' | 'callbacks';
type SetupTab = 'overview' | 'script' | 'conditions' | 'ab-test';
type CsvPreviewKind = 'all' | 'hot';

const GOAL_LABELS: Record<string, string> = {
    book_meeting: 'Book Meeting',
    qualify_lead: 'Qualify Lead (BANT)',
    transfer_to_human: 'Warm Transfer',
    nurture: 'Nurture',
    sell_direct: 'Direct Sell',
};

/** Short CSV import hints per campaign goal (shown in Sample format modal only). */
const GOAL_CSV_HINTS: Record<string, string> = {
    book_meeting: 'B2B-style lists often include company and title so the agent has context.',
    qualify_lead: 'Qualify workflows benefit from company/title when available-they are optional.',
    transfer_to_human: 'Warm transfers: name + phone are enough; add context columns if helpful.',
    nurture: 'Relationship touches: minimal columns are fine; enrich with extras if your script mentions them.',
    sell_direct: 'Consumer or mixed lists: omit title/company when not relevant-phone is mandatory.',
};

interface SampleCsvSection {
    title: string;
    bullets: string[];
    headers: string[];
    rows: string[][];
}

function buildSampleCsvSections(campaign: Campaign): SampleCsvSection[] {
    const hint = GOAL_CSV_HINTS[campaign.goal] || '';

    return [
        {
            title: 'Example: professional outreach',
            bullets: [
                ...(hint ? [hint] : []),
                'Every row needs a reachable phone column (header: phone, mobile, or number). Prefer international format (+country code …).',
                'Standard optional columns: name, email, company, title - leave cells empty when you do not use them.',
                'Extra columns are stored on each contact and can be used as merge tags, e.g. {appointment_time} for a header appointment_time.',
            ],
            headers: ['phone', 'name', 'email', 'company', 'title'],
            rows: [['+14155551234', 'Jane Smith', 'jane@acme.com', 'Acme Corp', 'VP Sales']],
        },
        {
            title: 'Example: appointment reminder',
            bullets: [
                'You may only need phone, name, email, plus custom columns (e.g. appointment_time); title is optional.',
                'Values that contain commas (like a full date and time) belong in one cell - in a raw CSV file that cell is usually wrapped in double quotes; uploads now respect quoted fields.',
            ],
            headers: ['phone', 'name', 'email', 'appointment_time'],
            rows: [['+14155559876', 'Alex Rivera', 'alex@email.com', 'Wed May 21, 2026 2:00 PM']],
        },
    ];
}

// ─── Helpers ──────────────────────────────────────────────────────────────

function fmtDuration(sec: number): string {
    if (!sec) return '-';
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

function fmtScore(score?: number): string {
    return typeof score === 'number' ? `${score}` : '-';
}

function scoreColor(score?: number): string {
    if (score === undefined) return 'text-ocean-deep/60';
    if (score >= 75) return 'text-green-600';
    if (score >= 50) return 'text-yellow-600';
    return 'text-ocean-deep/80';
}

// ─── KPI Card ─────────────────────────────────────────────────────────────

function KpiCard({ icon: Icon, label, value, sub, color = 'text-ocean-navy' }: {
    icon: React.ComponentType<{ className?: string }>;
    label: string;
    value: string | number;
    sub?: string;
    color?: string;
}) {
    return (
        <div className="bg-white rounded-lg border border-ocean-ice p-4">
            <div className="flex items-center gap-2 text-ocean-deep/80 text-xs">
                <Icon className="h-3.5 w-3.5" />
                {label}
            </div>
            <div className={`text-2xl font-bold mt-1 ${color}`}>{value}</div>
            {sub && <div className="text-xs text-ocean-deep/60 mt-0.5">{sub}</div>}
        </div>
    );
}

function StatCard({ label, value, color }: { label: string; value: number; color: string }) {
    return (
        <div className="bg-white rounded-lg border border-ocean-ice p-4 text-center">
            <div className={`text-2xl font-bold ${color}`}>{value}</div>
            <div className="text-xs text-ocean-deep/80 mt-1">{label}</div>
        </div>
    );
}

/** Full-width stats - shown under the header on every tab so KPIs stay visible. */
function CampaignStatsDashboard({
    campaign,
    kpis,
}: {
    campaign: Campaign;
    kpis: Kpis | null;
}) {
    const s = campaign.stats;
    const contacted =
        s.interested + s.notInterested + s.noAnswer + s.voicemail + s.failed + s.callback + s.dnc + s.wrongNumber;

    const interested =
        kpis?.conversions ?? s.interested;

    return (
        <section className="bg-white rounded-2xl border border-ocean-ice shadow-sm p-5 sm:p-6 mb-6 space-y-5">
            <div className="border-b border-ocean-ice/70 pb-3">
                <h2 className="text-base font-bold text-ocean-navy">Performance</h2>
                <p className="mt-1 text-xs text-ocean-deep/65">Dialer totals and answered-call outcomes.</p>
            </div>

            {campaign.status === 'running' && s.calling > 0 && (
                <div className="flex items-center gap-3 bg-green-50 border border-green-200 rounded-xl px-4 py-3">
                    <span className="h-2.5 w-2.5 bg-green-500 rounded-full animate-pulse shrink-0" />
                    <div className="text-sm">
                        <span className="font-semibold text-green-900">{s.calling} live call{s.calling !== 1 ? 's' : ''}</span>
                        <span className="text-green-800/90"> - use Contacts for row status.</span>
                    </div>
                    <Activity className="h-5 w-5 text-green-600 ml-auto shrink-0" />
                </div>
            )}

            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                <KpiCard
                    icon={Phone}
                    label="Connect rate"
                    value={`${kpis?.connectRate ?? 0}%`}
                    sub={`${kpis?.connected ?? 0} / ${kpis?.totalCalled ?? 0} reached`}
                />
                <KpiCard
                    icon={Target}
                    label="Conversion"
                    value={`${kpis?.conversionRate ?? 0}%`}
                    sub={`of answered calls`}
                    color="text-ocean-deep"
                />
                <KpiCard icon={Sparkles} label="Interested" value={interested} sub="qualified leads (status)" />
                <KpiCard icon={Clock} label="Avg call time" value={fmtDuration(kpis?.avgDurationSec || 0)}
                    sub={`${fmtDuration(kpis?.totalCallDurationSec || 0)} total talk`} />
            </div>

            <div className="overflow-x-auto pb-1 -mx-1 px-1">
                <div className="flex gap-2 min-w-max sm:min-w-0 sm:grid sm:grid-cols-5 lg:grid-cols-10 sm:gap-2">
                    <StatCard label="Pending" value={s.pending} color="text-ocean-deep" />
                    <StatCard label="Calling" value={s.calling} color="text-blue-600" />
                    <StatCard label="Interested" value={s.interested} color="text-green-600" />
                    <StatCard label="Not int." value={s.notInterested} color="text-red-500" />
                    <StatCard label="Callback" value={s.callback} color="text-orange-500" />
                    <StatCard label="No answer" value={s.noAnswer} color="text-yellow-600" />
                    <StatCard label="Voicemail" value={s.voicemail} color="text-purple-600" />
                    <StatCard label="Wrong #" value={s.wrongNumber} color="text-pink-500" />
                    <StatCard label="DNC" value={s.dnc} color="text-ocean-deep/60" />
                    <StatCard label="Failed" value={s.failed} color="text-red-700" />
                </div>
            </div>

            {campaign.totalContacts > 0 && (
                <div>
                    <div className="flex justify-between text-xs text-ocean-deep/80 mb-1.5">
                        <span>Contact progress</span>
                        <span>{contacted} / {campaign.totalContacts} ({Math.round((contacted / campaign.totalContacts) * 100)}%)</span>
                    </div>
                    <div className="h-2 bg-ocean-mist/60 rounded-full overflow-hidden">
                        <div
                            className="h-full bg-ocean-deep rounded-full transition-all"
                            style={{ width: `${Math.round((contacted / campaign.totalContacts) * 100)}%` }}
                        />
                    </div>
                </div>
            )}

            {kpis && Object.keys(kpis.dispositions).length > 0 && (
                <div className="border-t border-ocean-ice/80 pt-4">
                    <h3 className="text-xs font-semibold text-ocean-deep uppercase tracking-wide mb-2">AI disposition mix</h3>
                    <div className="grid sm:grid-cols-2 gap-x-8 gap-y-1.5 text-sm max-h-40 overflow-y-auto">
                        {Object.entries(kpis.dispositions).sort((a, b) => b[1] - a[1]).map(([d, n]) => (
                            <div key={d} className="flex justify-between gap-4">
                                <span className="text-ocean-deep/85 capitalize">{d.replace(/_/g, ' ')}</span>
                                <span className="font-semibold text-ocean-navy tabular-nums">{n}</span>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </section>
    );
}

// ─── Script tab: preview + edit ───────────────────────────────────────────

function formatCallingHoursPreview(h: CallingHours): string {
    const days = h.daysOfWeek.length
        ? [...h.daysOfWeek].sort((a, b) => a - b).map(i => DAY_NAMES[i]).join(', ')
        : 'No days selected';
    return `${days} · ${h.startHour}:00-${h.endHour}:00 · UTC ${h.timezoneOffsetMinutes >= 0 ? '+' : ''}${h.timezoneOffsetMinutes} min`;
}

function ScriptPlaybookForm({ campaign, token, onSaved }: {
    campaign: Campaign;
    token: string | null;
    onSaved?: () => void | Promise<void>;
}) {
    const toast = useToast();
    const [goal, setGoal] = useState(campaign.goal);
    const [offer, setOffer] = useState(campaign.offer);
    const [valueProps, setValueProps] = useState(campaign.valueProps.join('\n'));
    const [targetPersona, setTargetPersona] = useState(campaign.targetPersona);
    const [painPoints, setPainPoints] = useState(campaign.painPoints.join('\n'));
    const [openingScript, setOpeningScript] = useState(campaign.openingScript);
    const [qualifyingQuestions, setQualifyingQuestions] = useState(campaign.qualifyingQuestions.join('\n'));
    const [objections, setObjections] = useState<ObjectionHandler[]>(campaign.objectionHandlers || []);
    const [callingHours, setCallingHours] = useState<CallingHours>(campaign.callingHours);
    const [recordingEnabled, setRecordingEnabled] = useState(campaign.recordingEnabled);
    const [consentDisclosure, setConsentDisclosure] = useState(campaign.consentDisclosure);
    const [honorDnc, setHonorDnc] = useState(campaign.honorDnc);
    const [saving, setSaving] = useState(false);
    const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

    useEffect(() => {
        setGoal(campaign.goal);
        setOffer(campaign.offer);
        setValueProps(campaign.valueProps.join('\n'));
        setTargetPersona(campaign.targetPersona);
        setPainPoints(campaign.painPoints.join('\n'));
        setOpeningScript(campaign.openingScript);
        setQualifyingQuestions(campaign.qualifyingQuestions.join('\n'));
        setObjections(campaign.objectionHandlers || []);
        setCallingHours(campaign.callingHours);
        setRecordingEnabled(campaign.recordingEnabled);
        setConsentDisclosure(campaign.consentDisclosure);
        setHonorDnc(campaign.honorDnc);
    }, [campaign]);

    const addObjection = () => setObjections(o => [...o, { objection: '', response: '' }]);
    const updateObjection = (i: number, field: 'objection' | 'response', val: string) => {
        setObjections(o => o.map((h, idx) => idx === i ? { ...h, [field]: val } : h));
    };
    const removeObjection = (i: number) => setObjections(o => o.filter((_, idx) => idx !== i));
    const toggleDay = (d: number) => {
        setCallingHours(h => {
            const set = new Set(h.daysOfWeek);
            if (set.has(d)) set.delete(d); else set.add(d);
            return { ...h, daysOfWeek: Array.from(set).sort() };
        });
    };

    const save = async (e: React.FormEvent) => {
        e.preventDefault();
        setSaving(true);
        setMsg(null);
        try {
            const body = {
                goal, offer, targetPersona,
                valueProps: valueProps.split('\n').map(s => s.trim()).filter(Boolean),
                painPoints: painPoints.split('\n').map(s => s.trim()).filter(Boolean),
                openingScript,
                qualifyingQuestions: qualifyingQuestions.split('\n').map(s => s.trim()).filter(Boolean),
                objectionHandlers: objections.filter(o => o.objection.trim() && o.response.trim()),
                callingHours,
                recordingEnabled,
                consentDisclosure,
                honorDnc,
            };
            const res = await fetch(`${API_BASE}/api/campaigns/${campaign._id}/script`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                body: JSON.stringify(body),
            });
            if (!res.ok) {
                const msg = await handleApiError(res, toast, { title: 'Save failed', fallback: 'Failed to save script' });
                setMsg({ type: 'err', text: msg });
                return;
            }
            await res.json();
            await onSaved?.();
            setMsg({ type: 'ok', text: 'Script saved. Changes apply to all future calls.' });
            toast.success('Script saved', 'Changes apply to future calls');
        } catch (err: any) {
            const msg = err.message || 'Save failed';
            setMsg({ type: 'err', text: msg });
            toast.error('Save failed', msg);
        } finally {
            setSaving(false);
        }
    };

    return (
        <form onSubmit={save} className="space-y-6">
            {msg && (
                <div className={`p-3 rounded-lg border text-sm ${msg.type === 'ok' ? 'bg-green-50 border-green-200 text-green-700' : 'bg-red-50 border-red-200 text-red-700'}`}>
                    {msg.text}
                </div>
            )}

            <section className="bg-white rounded-xl border border-ocean-ice p-5">
                <h3 className="font-semibold text-ocean-navy mb-1">Goal & Offer</h3>
                <p className="text-xs text-ocean-deep/80 mb-4">Define what a successful call looks like and what value you are bringing to the contact.</p>

                <div className="grid grid-cols-2 gap-4">
                    <div>
                        <label className="block text-sm font-medium text-ocean-deep mb-1">Primary Goal</label>
                        <select title="Primary Goal" value={goal} onChange={e => setGoal(e.target.value)}
                            className="w-full px-3 py-2 border border-ocean-ice rounded-lg bg-white text-sm outline-none">
                            {Object.entries(GOAL_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                        </select>
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-ocean-deep mb-1">Target Persona</label>
                        <input type="text" value={targetPersona} onChange={e => setTargetPersona(e.target.value)}
                            className="w-full px-3 py-2 border border-ocean-ice rounded-lg text-sm outline-none"
                            placeholder="e.g., VPs of Sales at B2B SaaS" />
                    </div>
                </div>

                <div className="mt-4">
                    <label className="block text-sm font-medium text-ocean-deep mb-1">Offer</label>
                    <input type="text" value={offer} onChange={e => setOffer(e.target.value)}
                        className="w-full px-3 py-2 border border-ocean-ice rounded-lg text-sm outline-none"
                        placeholder="e.g., A free audit of your current pipeline" />
                </div>

                <div className="grid grid-cols-2 gap-4 mt-4">
                    <div>
                        <label className="block text-sm font-medium text-ocean-deep mb-1">Value Propositions (one per line)</label>
                        <textarea title="Value propositions" placeholder="e.g., Save 20 hours a week" value={valueProps} onChange={e => setValueProps(e.target.value)} rows={4}
                            className="w-full px-3 py-2 border border-ocean-ice rounded-lg text-sm outline-none font-mono" />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-ocean-deep mb-1">Pain Points You Solve (one per line)</label>
                        <textarea title="Pain points" placeholder="e.g., Wasted time on cold calls" value={painPoints} onChange={e => setPainPoints(e.target.value)} rows={4}
                            className="w-full px-3 py-2 border border-ocean-ice rounded-lg text-sm outline-none font-mono" />
                    </div>
                </div>
            </section>

            <section className="bg-white rounded-xl border border-ocean-ice p-5">
                <h3 className="font-semibold text-ocean-navy mb-1">Opening Script</h3>
                <p className="text-xs text-ocean-deep/80 mb-3">
                    First line the agent speaks when a human answers. Supports{' '}
                    <code className="text-ocean-deep">{'{firstName}'}</code>, <code className="text-ocean-deep">{'{name}'}</code>,{' '}
                    <code className="text-ocean-deep">{'{agentName}'}</code>, <code className="text-ocean-deep">{'{rep}'}</code>,{' '}
                    <code className="text-ocean-deep">{'{businessName}'}</code>, <code className="text-ocean-deep">{'{business}'}</code>,{' '}
                    <code className="text-ocean-deep">{'{company}'}</code>, <code className="text-ocean-deep">{'{offer}'}</code>. Tags from templates (
                    <code className="text-ocean-deep">{'{appointmentDate}'}</code>, etc.) are replaced with sensible default wording unless you personalize the script.
                </p>
                <textarea value={openingScript} onChange={e => setOpeningScript(e.target.value)} rows={4}
                    className="w-full px-3 py-2 border border-ocean-ice rounded-lg text-sm outline-none"
                    placeholder="Hi {firstName}, this is {agentName} with {businessName}. I know I caught you unannounced - do you have 30 seconds?" />
            </section>

            <section className="bg-white rounded-xl border border-ocean-ice p-5">
                <h3 className="font-semibold text-ocean-navy mb-1">Qualifying Questions</h3>
                <p className="text-xs text-ocean-deep/80 mb-3">
                    Agent asks these one at a time. Same placeholders as the opening script; merge tags you do not personalize are spoken as natural filler phrases.
                </p>
                <textarea title="Qualifying questions, one per line" placeholder="What challenges are you facing?" value={qualifyingQuestions} onChange={e => setQualifyingQuestions(e.target.value)} rows={6}
                    className="w-full px-3 py-2 border border-ocean-ice rounded-lg text-sm outline-none font-mono" />
            </section>

            <section className="bg-white rounded-xl border border-ocean-ice p-5">
                <div className="flex items-center justify-between mb-3">
                    <div>
                        <h3 className="font-semibold text-ocean-navy">Objection Playbook</h3>
                        <p className="text-xs text-ocean-deep/80">How the agent should respond to pushbacks - same placeholders as scripts where relevant.</p>
                    </div>
                    <button type="button" onClick={addObjection}
                        className="text-sm px-3 py-1.5 border border-ocean-ice rounded-lg hover:bg-ocean-powder">
                        + Add
                    </button>
                </div>
                <div className="space-y-3">
                    {objections.length === 0 && (
                        <p className="text-sm text-ocean-deep/60 italic">No objections added - click "+ Add" to start.</p>
                    )}
                    {objections.map((o, i) => (
                        <div key={i} className="grid grid-cols-5 gap-2 items-start">
                            <input type="text" value={o.objection}
                                onChange={e => updateObjection(i, 'objection', e.target.value)}
                                placeholder="Objection"
                                className="col-span-2 px-3 py-2 border border-ocean-ice rounded-lg text-sm outline-none" />
                            <input type="text" value={o.response}
                                onChange={e => updateObjection(i, 'response', e.target.value)}
                                placeholder="Suggested response"
                                className="col-span-2 px-3 py-2 border border-ocean-ice rounded-lg text-sm outline-none" />
                            <button type="button" onClick={() => removeObjection(i)}
                                className="text-red-500 hover:text-red-700 px-2 py-2 text-sm">
                                Remove
                            </button>
                        </div>
                    ))}
                </div>
            </section>

            <section className="bg-white rounded-xl border border-ocean-ice p-5">
                <h3 className="font-semibold text-ocean-navy mb-3">Calling Hours & Compliance</h3>

                <div className="grid grid-cols-3 gap-4 mb-4">
                    <div>
                        <label className="block text-sm font-medium text-ocean-deep mb-1">Start Hour (24h)</label>
                        <input title="Start Hour" placeholder="9" type="number" min={0} max={23} value={callingHours.startHour}
                            onChange={e => setCallingHours(h => ({ ...h, startHour: parseInt(e.target.value) || 0 }))}
                            className="w-full px-3 py-2 border border-ocean-ice rounded-lg text-sm outline-none" />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-ocean-deep mb-1">End Hour (24h)</label>
                        <input title="End Hour" placeholder="18" type="number" min={1} max={24} value={callingHours.endHour}
                            onChange={e => setCallingHours(h => ({ ...h, endHour: parseInt(e.target.value) || 0 }))}
                            className="w-full px-3 py-2 border border-ocean-ice rounded-lg text-sm outline-none" />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-ocean-deep mb-1">TZ Offset (min from UTC)</label>
                        <input title="Timezone offset in minutes from UTC" placeholder="0" type="number" value={callingHours.timezoneOffsetMinutes}
                            onChange={e => setCallingHours(h => ({ ...h, timezoneOffsetMinutes: parseInt(e.target.value) || 0 }))}
                            className="w-full px-3 py-2 border border-ocean-ice rounded-lg text-sm outline-none" />
                    </div>
                </div>

                <div className="mb-4">
                    <label className="block text-sm font-medium text-ocean-deep mb-2">Allowed Days</label>
                    <div className="flex gap-2">
                        {DAY_NAMES.map((d, idx) => (
                            <button key={d} type="button" onClick={() => toggleDay(idx)}
                                className={`px-3 py-1.5 rounded-lg text-sm font-medium border ${
                                    callingHours.daysOfWeek.includes(idx)
                                        ? 'bg-ocean-deep text-white border-ocean-deep'
                                        : 'bg-white text-ocean-deep/90 border-ocean-ice hover:bg-ocean-powder'
                                }`}>
                                {d}
                            </button>
                        ))}
                    </div>
                </div>

                <div className="space-y-2">
                    <label className="flex items-center gap-2 text-sm text-ocean-deep">
                        <input type="checkbox" checked={recordingEnabled} onChange={e => setRecordingEnabled(e.target.checked)} />
                        Record calls (Twilio will record the audio)
                    </label>
                    <label className="flex items-center gap-2 text-sm text-ocean-deep">
                        <input type="checkbox" checked={honorDnc} onChange={e => setHonorDnc(e.target.checked)} />
                        Honor Do-Not-Call list (skip contacts marked DNC)
                    </label>
                </div>

                <div className="mt-4">
                    <label className="block text-sm font-medium text-ocean-deep mb-1">Recording Consent Disclosure</label>
                    <input type="text" value={consentDisclosure} onChange={e => setConsentDisclosure(e.target.value)}
                        className="w-full px-3 py-2 border border-ocean-ice rounded-lg text-sm outline-none"
                        placeholder="e.g., This call may be recorded for quality and training purposes." />
                    <p className="text-xs text-ocean-deep/60 mt-1">Prepended to the opening when recording is enabled.</p>
                </div>
            </section>

            <div className="flex justify-end">
                <button type="submit" disabled={saving}
                    className="px-6 py-2.5 bg-ocean-deep text-white rounded-lg text-sm font-medium hover:bg-ocean-rich disabled:opacity-50">
                    {saving ? 'Saving...' : 'Save Script'}
                </button>
            </div>
        </form>
    );
}

function ScriptPlaybookTab({ campaign, token, onSaved }: {
    campaign: Campaign;
    token: string | null;
    onSaved: () => void | Promise<void>;
}) {
    const [editing, setEditing] = useState(false);
    const qq = campaign.qualifyingQuestions || [];
    const objections = campaign.objectionHandlers || [];
    const filledObjections = objections.filter(o => o.objection.trim() || o.response.trim());

    return (
        <div className="space-y-4">
            {!editing ? (
                <div className="bg-white rounded-2xl border border-ocean-ice shadow-sm p-5 sm:p-6 space-y-5">
                    <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                        <div>
                            <h2 className="text-base font-bold text-ocean-navy">Sales playbook</h2>
                            <p className="text-xs text-ocean-deep/70 mt-0.5 max-w-2xl">
                                Read-only summary. Open the editor when you want to change scripts, questions, or calling hours.
                            </p>
                        </div>
                        <button
                            type="button"
                            onClick={() => setEditing(true)}
                            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-ocean-ice text-sm font-medium text-ocean-deep hover:bg-ocean-powder shrink-0"
                        >
                            <PenLine className="h-4 w-4" />
                            Edit playbook
                        </button>
                    </div>

                    <div className="grid sm:grid-cols-2 gap-4 text-sm">
                        <div className="rounded-xl border border-ocean-ice/80 bg-ocean-powder/30 p-4">
                            <div className="text-xs font-semibold text-ocean-deep uppercase tracking-wide">Goal</div>
                            <div className="font-medium text-ocean-navy mt-1">{GOAL_LABELS[campaign.goal] || campaign.goal || '-'}</div>
                            {campaign.targetPersona && (
                                <div className="text-ocean-deep/85 mt-2 text-xs">Persona: <span className="text-ocean-navy font-medium">{campaign.targetPersona}</span></div>
                            )}
                        </div>
                        <div className="rounded-xl border border-ocean-ice/80 bg-ocean-powder/30 p-4">
                            <div className="text-xs font-semibold text-ocean-deep uppercase tracking-wide">Offer</div>
                            <div className="text-ocean-navy mt-1">{campaign.offer ? campaign.offer : <span className="text-ocean-deep/50 italic">Not set</span>}</div>
                        </div>
                    </div>

                    {(campaign.valueProps.length > 0 || campaign.painPoints.length > 0) && (
                        <div className="grid sm:grid-cols-2 gap-4 text-sm">
                            {campaign.valueProps.length > 0 && (
                                <div>
                                    <div className="text-xs font-semibold text-ocean-deep uppercase tracking-wide mb-2">Value props</div>
                                    <ul className="list-disc list-inside space-y-1 text-ocean-deep/90">
                                        {campaign.valueProps.map((v, i) => <li key={i}>{v}</li>)}
                                    </ul>
                                </div>
                            )}
                            {campaign.painPoints.length > 0 && (
                                <div>
                                    <div className="text-xs font-semibold text-ocean-deep uppercase tracking-wide mb-2">Pain points</div>
                                    <ul className="list-disc list-inside space-y-1 text-ocean-deep/90">
                                        {campaign.painPoints.map((v, i) => <li key={i}>{v}</li>)}
                                    </ul>
                                </div>
                            )}
                        </div>
                    )}

                    <div>
                        <div className="text-xs font-semibold text-ocean-deep uppercase tracking-wide mb-2">Opening line</div>
                        <div className="rounded-xl border border-ocean-ice bg-ocean-mist/20 p-4 text-sm text-ocean-navy whitespace-pre-wrap">
                            {campaign.openingScript ? campaign.openingScript : <span className="text-ocean-deep/50 italic">No opening script yet.</span>}
                        </div>
                    </div>

                    <div>
                        <div className="text-xs font-semibold text-ocean-deep uppercase tracking-wide mb-2">
                            Qualifying questions ({qq.length})
                        </div>
                        {qq.length === 0 ? (
                            <p className="text-sm text-ocean-deep/60 italic">None added.</p>
                        ) : (
                            <ol className="list-decimal list-inside space-y-1.5 text-sm text-ocean-deep/90">
                                {qq.slice(0, 6).map((q, i) => <li key={i} className="pl-1">{q}</li>)}
                            </ol>
                        )}
                        {qq.length > 6 && (
                            <p className="text-xs text-ocean-deep/60 mt-2">+ {qq.length - 6} more in the editor</p>
                        )}
                    </div>

                    <div>
                        <div className="text-xs font-semibold text-ocean-deep uppercase tracking-wide mb-2">
                            Objection playbook ({filledObjections.length} pair{filledObjections.length !== 1 ? 's' : ''})
                        </div>
                        {filledObjections.length === 0 ? (
                            <p className="text-sm text-ocean-deep/60 italic">No objection handlers yet.</p>
                        ) : (
                            <ul className="space-y-2 text-sm">
                                {filledObjections.slice(0, 4).map((o, i) => (
                                    <li key={i} className="border border-ocean-ice/80 rounded-lg p-3 bg-white">
                                        <div className="font-medium text-ocean-navy">{o.objection || '(objection)'}</div>
                                        <div className="text-ocean-deep/85 mt-1 text-xs leading-relaxed">{o.response || '-'}</div>
                                    </li>
                                ))}
                            </ul>
                        )}
                        {filledObjections.length > 4 && (
                            <p className="text-xs text-ocean-deep/60 mt-2">+ {filledObjections.length - 4} more in the editor</p>
                        )}
                    </div>

                    <div className="grid sm:grid-cols-2 gap-4 text-sm border-t border-ocean-ice/80 pt-4">
                        <div>
                            <div className="text-xs font-semibold text-ocean-deep uppercase tracking-wide mb-1">Calling hours</div>
                            <p className="text-ocean-deep/90">{formatCallingHoursPreview(campaign.callingHours)}</p>
                        </div>
                        <div>
                            <div className="text-xs font-semibold text-ocean-deep uppercase tracking-wide mb-1">Compliance</div>
                            <ul className="text-ocean-deep/90 space-y-0.5">
                                <li>Recording: {campaign.recordingEnabled ? 'On' : 'Off'}</li>
                                <li>Honor DNC: {campaign.honorDnc ? 'Yes' : 'No'}</li>
                                {campaign.recordingEnabled && campaign.consentDisclosure && (
                                    <li className="text-xs mt-1 text-ocean-deep/70">Consent: {campaign.consentDisclosure}</li>
                                )}
                            </ul>
                        </div>
                    </div>
                </div>
            ) : (
                <>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                        <button
                            type="button"
                            onClick={() => setEditing(false)}
                            className="text-sm font-medium text-ocean-deep hover:text-ocean-navy"
                        >
                            ← Back to preview
                        </button>
                    </div>
                    <ScriptPlaybookForm
                        key={campaign._id}
                        campaign={campaign}
                        token={token}
                        onSaved={async () => {
                            await onSaved();
                            setEditing(false);
                        }}
                    />
                </>
            )}
        </div>
    );
}

// ─── Conditions / Targeting Tab ──────────────────────────────────────────

function ConditionsTab({ campaign, token, onSaved }: {
    campaign: Campaign;
    token: string | null;
    onSaved: (c: Campaign) => void;
}) {
    const toast = useToast();
    const [tags, setTags] = useState((campaign.contactFilters?.tags || []).join(', '));
    const [cities, setCities] = useState((campaign.contactFilters?.cities || []).join(', '));
    const [companies, setCompanies] = useState((campaign.contactFilters?.companies || []).join(', '));
    const [minScore, setMinScore] = useState<string>(campaign.contactFilters?.minLeadScore?.toString() || '');
    const [maxScore, setMaxScore] = useState<string>(campaign.contactFilters?.maxLeadScore?.toString() || '');
    const [scheduledStart, setScheduledStart] = useState(
        campaign.scheduledStartAt ? new Date(campaign.scheduledStartAt).toISOString().slice(0, 16) : ''
    );
    const [saving, setSaving] = useState(false);
    const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

    const splitCsv = (s: string) => s.split(',').map(x => x.trim()).filter(Boolean);

    const save = async () => {
        setSaving(true); setMsg(null);
        try {
            const body: Record<string, unknown> = {
                contactFilters: {
                    tags: splitCsv(tags),
                    cities: splitCsv(cities),
                    companies: splitCsv(companies),
                    minLeadScore: minScore !== '' ? parseInt(minScore) : null,
                    maxLeadScore: maxScore !== '' ? parseInt(maxScore) : null,
                },
            };
            if (scheduledStart) body.scheduledStartAt = new Date(scheduledStart).toISOString();
            else body.scheduledStartAt = null;

            const res = await fetch(`${API_BASE}/api/campaigns/${campaign._id}/filters`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                body: JSON.stringify(body),
            });
            if (!res.ok) {
                const msg = await handleApiError(res, toast, { title: 'Save failed', fallback: 'Failed to save targeting' });
                setMsg({ type: 'err', text: msg });
                return;
            }
            const updated = await res.json();
            onSaved(updated);
            setMsg({ type: 'ok', text: 'Targeting settings saved.' });
            toast.success('Targeting saved');
        } catch (e: any) {
            const msg = e.message || 'Save failed';
            setMsg({ type: 'err', text: msg });
            toast.error('Save failed', msg);
        } finally { setSaving(false); }
    };

    return (
        <div className="space-y-5">
            {msg && (
                <div className={`p-3 rounded-xl border text-sm ${msg.type === 'ok' ? 'bg-green-50 border-green-200 text-green-700' : 'bg-red-50 border-red-200 text-red-700'}`}>
                    {msg.text}
                </div>
            )}

            <div className="bg-white rounded-2xl border border-ocean-ice p-5 space-y-4">
                <div className="flex items-center gap-2 mb-1">
                    <Filter className="h-4 w-4 text-ocean-rich" />
                    <h3 className="font-semibold text-ocean-navy">Contact Segment Filters</h3>
                </div>
                <p className="text-xs text-ocean-deep/80 -mt-2">
                    When set, the dialer will only call contacts that match ALL active filters.
                    Leave a field empty to skip that filter.
                </p>

                <div className="grid sm:grid-cols-2 gap-4">
                    <div>
                        <label className="block text-sm font-medium text-ocean-deep mb-1">Tags (comma-separated)</label>
                        <input type="text" value={tags} onChange={e => setTags(e.target.value)}
                            className="w-full px-3 py-2 border border-ocean-ice rounded-lg text-sm outline-none focus:ring-2 focus:ring-ocean-bright"
                            placeholder="enterprise, saas, warm-lead" />
                        <p className="text-xs text-ocean-deep/60 mt-1">Only dial contacts with any of these tags.</p>
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-ocean-deep mb-1">Cities (comma-separated)</label>
                        <input type="text" value={cities} onChange={e => setCities(e.target.value)}
                            className="w-full px-3 py-2 border border-ocean-ice rounded-lg text-sm outline-none focus:ring-2 focus:ring-ocean-bright"
                            placeholder="New York, Chicago, Austin" />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-ocean-deep mb-1">Companies (comma-separated)</label>
                        <input type="text" value={companies} onChange={e => setCompanies(e.target.value)}
                            className="w-full px-3 py-2 border border-ocean-ice rounded-lg text-sm outline-none focus:ring-2 focus:ring-ocean-bright"
                            placeholder="Acme Corp, TechStart Inc" />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-ocean-deep mb-1">Lead Score Range</label>
                        <div className="flex gap-2 items-center">
                            <input type="number" min={0} max={100} placeholder="Min (0)"
                                title="Minimum lead score"
                                value={minScore} onChange={e => setMinScore(e.target.value)}
                                className="w-full px-3 py-2 border border-ocean-ice rounded-lg text-sm outline-none" />
                            <span className="text-ocean-deep/60 text-sm">-</span>
                            <input type="number" min={0} max={100} placeholder="Max (100)"
                                title="Maximum lead score"
                                value={maxScore} onChange={e => setMaxScore(e.target.value)}
                                className="w-full px-3 py-2 border border-ocean-ice rounded-lg text-sm outline-none" />
                        </div>
                        <p className="text-xs text-ocean-deep/60 mt-1">Only applies to contacts that have been scored previously.</p>
                    </div>
                </div>
            </div>

            <div className="bg-white rounded-2xl border border-ocean-ice p-5 space-y-4">
                <div className="flex items-center gap-2">
                    <Clock className="h-4 w-4 text-ocean-rich" />
                    <h3 className="font-semibold text-ocean-navy">Scheduled Start</h3>
                </div>
                <p className="text-xs text-ocean-deep/80">Set a future date and time to automatically start this campaign. Leave empty to start manually.</p>
                <input
                    type="datetime-local"
                    title="Scheduled start time"
                    value={scheduledStart}
                    onChange={e => setScheduledStart(e.target.value)}
                    className="px-3 py-2 border border-ocean-ice rounded-lg text-sm outline-none focus:ring-2 focus:ring-ocean-bright"
                />
                {scheduledStart && (
                    <p className="text-xs text-ocean-deep">Campaign will start on: {new Date(scheduledStart).toLocaleString()}</p>
                )}
            </div>

            <div className="flex justify-end">
                <button onClick={save} disabled={saving}
                    className="px-6 py-2.5 bg-ocean-deep text-white rounded-xl text-sm font-medium hover:bg-ocean-rich disabled:opacity-50">
                    {saving ? 'Saving...' : 'Save Targeting'}
                </button>
            </div>
        </div>
    );
}

// ─── A/B Test Tab ─────────────────────────────────────────────────────────

function AbTestTab({ campaign, token, onSaved }: {
    campaign: Campaign;
    token: string | null;
    onSaved: (c: Campaign) => void;
}) {
    const toast = useToast();
    const [enabled, setEnabled] = useState(campaign.abTest?.enabled || false);
    const [variantBScript, setVariantBScript] = useState(campaign.abTest?.variantBScript || '');
    const [saving, setSaving] = useState(false);
    const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

    const stats = campaign.abTest?.variantBStats;
    const aStats = campaign.stats;

    const save = async () => {
        setSaving(true); setMsg(null);
        try {
            const res = await fetch(`${API_BASE}/api/campaigns/${campaign._id}/ab-test`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                body: JSON.stringify({ enabled, variantBScript }),
            });
            if (!res.ok) {
                const msg = await handleApiError(res, toast, { title: 'Save failed', fallback: 'Failed to save A/B test' });
                setMsg({ type: 'err', text: msg });
                return;
            }
            onSaved(await res.json());
            setMsg({ type: 'ok', text: 'A/B test settings saved.' });
            toast.success('A/B test saved');
        } catch (e: any) {
            const msg = e.message || 'Save failed';
            setMsg({ type: 'err', text: msg });
            toast.error('Save failed', msg);
        } finally { setSaving(false); }
    };

    const aConnected = aStats.connectedCalls || (aStats.interested + aStats.notInterested + aStats.callback);
    const bConnected = stats?.connectedCalls || 0;
    const aConvRate = aConnected > 0 ? Math.round((aStats.interested / aConnected) * 100) : 0;
    const bConvRate = bConnected > 0 ? Math.round(((stats?.interested || 0) / bConnected) * 100) : 0;

    return (
        <div className="space-y-5">
            {msg && (
                <div className={`p-3 rounded-xl border text-sm ${msg.type === 'ok' ? 'bg-green-50 border-green-200 text-green-700' : 'bg-red-50 border-red-200 text-red-700'}`}>
                    {msg.text}
                </div>
            )}

            <div className="bg-white rounded-2xl border border-ocean-ice p-5 space-y-4">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <Sparkles className="h-4 w-4 text-ocean-rich" />
                        <h3 className="font-semibold text-ocean-navy">A/B Script Testing</h3>
                    </div>
                    <label className="relative inline-flex items-center cursor-pointer">
                        <input type="checkbox" checked={enabled} onChange={e => setEnabled(e.target.checked)} className="sr-only peer" />
                        <div className="w-11 h-6 bg-ocean-ice peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-ocean-ice after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-ocean-deep"></div>
                        <span className="ms-3 text-sm font-medium text-ocean-deep">{enabled ? 'Enabled' : 'Disabled'}</span>
                    </label>
                </div>

                <p className="text-xs text-ocean-deep/80">
                    When enabled, the dialer alternates between Variant A (your main opening script) and Variant B on each call.
                    Conversion rates are tracked separately so you can see which performs better.
                </p>

                {enabled && (
                    <>
                        <div className="grid sm:grid-cols-2 gap-4">
                            <div className="bg-ocean-powder rounded-xl p-4 border border-ocean-ice">
                                <div className="flex items-center gap-2 mb-2">
                                    <span className="text-xs font-bold text-white bg-ocean-powder0 px-2 py-0.5 rounded">A</span>
                                    <span className="text-sm font-semibold text-ocean-deep">Variant A (Main Script)</span>
                                </div>
                                <p className="text-xs text-ocean-deep/80 leading-relaxed line-clamp-4">
                                    {campaign.openingScript || <em>No opening script set. Edit in Sales Script tab.</em>}
                                </p>
                                <div className="mt-3 flex gap-4 text-xs">
                                    <div>
                                        <span className="text-ocean-deep/60">Connected:</span>{' '}
                                        <span className="font-semibold text-ocean-deep">{aConnected}</span>
                                    </div>
                                    <div>
                                        <span className="text-ocean-deep/60">Leads:</span>{' '}
                                        <span className="font-semibold text-green-600">{aStats.interested}</span>
                                    </div>
                                    <div>
                                        <span className="text-ocean-deep/60">Conv:</span>{' '}
                                        <span className="font-semibold text-ocean-deep">{aConvRate}%</span>
                                    </div>
                                </div>
                            </div>

                            <div className="bg-ocean-powder rounded-xl p-4 border border-ocean-ice">
                                <div className="flex items-center gap-2 mb-2">
                                    <span className="text-xs font-bold text-white bg-ocean-powder0 px-2 py-0.5 rounded">B</span>
                                    <span className="text-sm font-semibold text-ocean-deep">Variant B (Test Script)</span>
                                </div>
                                <div className="mt-3 flex gap-4 text-xs">
                                    <div>
                                        <span className="text-ocean-deep/60">Connected:</span>{' '}
                                        <span className="font-semibold text-ocean-deep">{bConnected}</span>
                                    </div>
                                    <div>
                                        <span className="text-ocean-deep/60">Leads:</span>{' '}
                                        <span className="font-semibold text-green-600">{stats?.interested || 0}</span>
                                    </div>
                                    <div>
                                        <span className="text-ocean-deep/60">Conv:</span>{' '}
                                        <span className="font-semibold text-ocean-deep">{bConvRate}%</span>
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-ocean-deep mb-2">Variant B Opening Script</label>
                            <textarea
                                value={variantBScript}
                                onChange={e => setVariantBScript(e.target.value)}
                                rows={4}
                                className="w-full px-3 py-2.5 border border-ocean-ice rounded-xl text-sm outline-none focus:ring-2 focus:ring-ocean-bright"
                                placeholder="Write your alternative opening line here. Use {agentName}, {businessName}, {firstName} as placeholders."
                            />
                        </div>

                        {aConnected > 10 && bConnected > 10 && (
                            <div className={`p-4 rounded-xl border text-sm ${aConvRate >= bConvRate ? 'bg-ocean-powder border-ocean-ice' : 'bg-ocean-powder border-ocean-ice'}`}>
                                <div className="font-semibold text-ocean-deep mb-1">
                                    {aConvRate === bConvRate ? 'Both variants performing equally' :
                                     aConvRate > bConvRate ? `Variant A leads by ${aConvRate - bConvRate}pp` :
                                     `Variant B leads by ${bConvRate - aConvRate}pp`}
                                </div>
                                <div className="text-xs text-ocean-deep/80">
                                    Based on {aConnected + bConnected} total connected calls. Consider pausing the weaker variant once you have 50+ calls per variant.
                                </div>
                            </div>
                        )}
                    </>
                )}
            </div>

            <div className="flex justify-end">
                <button onClick={save} disabled={saving}
                    className="px-6 py-2.5 bg-ocean-deep text-white rounded-xl text-sm font-medium hover:bg-ocean-rich disabled:opacity-50">
                    {saving ? 'Saving...' : 'Save A/B Test'}
                </button>
            </div>
        </div>
    );
}

// ─── Contact Detail Modal ─────────────────────────────────────────────────

function ContactDetailModal({ campaignId, contactId, onClose, token, onUpdate }: {
    campaignId: string;
    contactId: string;
    onClose: () => void;
    token: string | null;
    onUpdate: () => void;
}) {
    const toast = useToast();
    const [detail, setDetail] = useState<ContactDetail | null>(null);
    const [loading, setLoading] = useState(true);
    const [notes, setNotes] = useState('');
    const [savingMsg, setSavingMsg] = useState('');

    useEffect(() => {
        (async () => {
            try {
                const res = await fetch(`${API_BASE}/api/campaigns/${campaignId}/contacts/${contactId}/detail`, {
                    headers: { Authorization: `Bearer ${token}` },
                });
                if (res.ok) {
                    const data = await res.json();
                    setDetail(data);
                    setNotes(data.contact.notes || '');
                }
            } finally {
                setLoading(false);
            }
        })();
    }, [campaignId, contactId, token]);

    const doPatch = async (body: Record<string, unknown>) => {
        setSavingMsg('Saving...');
        const res = await fetch(`${API_BASE}/api/campaigns/${campaignId}/contacts/${contactId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify(body),
        });
        if (res.ok) {
            const updated = await res.json();
            setDetail(d => d ? { ...d, contact: updated } : d);
            setSavingMsg('Saved');
            setTimeout(() => setSavingMsg(''), 1500);
            onUpdate();
        } else {
            await handleApiError(res, toast, { title: 'Save failed' });
            setSavingMsg('Save failed');
            setTimeout(() => setSavingMsg(''), 2500);
        }
    };

    const saveNotes = () => doPatch({ notes });
    const markDnc = () => doPatch({ dnc: true });
    const scheduleCallback = async () => {
        const when = prompt('Callback date/time (e.g. "2026-04-25 14:00" or ISO):');
        if (!when) return;
        const d = new Date(when);
        if (isNaN(d.getTime())) { toast.error('Invalid date', 'Use a valid date and time'); return; }
        doPatch({ callbackAt: d.toISOString() });
    };

    if (loading) return (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-xl p-8 text-ocean-deep/80">Loading contact...</div>
        </div>
    );

    if (!detail) return null;
    const c = detail.contact;
    const bant = c.bant || { budget: 0, authority: 0, need: 0, timeline: 0 };

    return (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4 overflow-y-auto">
            <div className="bg-white rounded-xl shadow-xl w-full max-w-3xl my-8">
                <div className="p-5 border-b border-ocean-ice/80 flex items-start justify-between">
                    <div>
                        <div className="flex items-center gap-2 flex-wrap">
                            <h2 className="text-lg font-semibold text-ocean-navy">{c.name || c.phone}</h2>
                            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${CONTACT_STATUS_COLORS[c.status]} bg-ocean-mist/50`}>
                                {c.status.replace('_', ' ')}
                            </span>
                            {c.disposition && (
                                <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-ocean-powder text-ocean-deep">
                                    {c.disposition.replace(/_/g, ' ')}
                                </span>
                            )}
                            {c.dnc && (
                                <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-red-100 text-red-600 flex items-center gap-1">
                                    <Ban className="h-3 w-3" /> DNC
                                </span>
                            )}
                        </div>
                        <div className="text-sm text-ocean-deep/80 mt-1">
                            {c.phone} {c.company && ` · ${c.company}`} {c.title && ` · ${c.title}`}
                        </div>
                    </div>
                    <button title="Close" onClick={onClose} className="text-ocean-deep/60 hover:text-ocean-deep/90">
                        <X className="h-5 w-5" />
                    </button>
                </div>

                <div className="p-5 space-y-5 max-h-[70vh] overflow-y-auto">
                    <div className="grid grid-cols-4 gap-3">
                        <div className="bg-ocean-powder rounded-lg p-3">
                            <div className="text-xs text-ocean-deep/80">Lead Score</div>
                            <div className={`text-2xl font-bold ${scoreColor(c.leadScore)}`}>{fmtScore(c.leadScore)}</div>
                        </div>
                        <div className="bg-ocean-powder rounded-lg p-3">
                            <div className="text-xs text-ocean-deep/80">Duration</div>
                            <div className="text-2xl font-bold text-ocean-navy">{fmtDuration(c.callDurationSec || 0)}</div>
                        </div>
                        <div className="bg-ocean-powder rounded-lg p-3">
                            <div className="text-xs text-ocean-deep/80">Attempts</div>
                            <div className="text-2xl font-bold text-ocean-navy">{c.attemptCount}</div>
                        </div>
                        <div className="bg-ocean-powder rounded-lg p-3">
                            <div className="text-xs text-ocean-deep/80">Turns</div>
                            <div className="text-2xl font-bold text-ocean-navy">{detail.turns.length}</div>
                        </div>
                    </div>

                    <div>
                        <h3 className="font-semibold text-ocean-navy text-sm mb-2">BANT Qualification</h3>
                        <div className="grid grid-cols-4 gap-2">
                            {(['budget', 'authority', 'need', 'timeline'] as const).map(k => (
                                <div key={k} className="bg-ocean-powder rounded-lg p-3 text-center">
                                    <div className="text-xs text-ocean-deep/80 capitalize">{k}</div>
                                    <div className="flex gap-1 justify-center mt-1">
                                        {[1, 2, 3, 4, 5].map(i => (
                                            <div key={i} className={`w-2 h-2 rounded-full ${i <= bant[k] ? 'bg-ocean-deep' : 'bg-ocean-ice'}`} />
                                        ))}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>

                    {c.aiSummary && (
                        <div>
                            <h3 className="font-semibold text-ocean-navy text-sm mb-2">Call Summary</h3>
                            <div className="bg-ocean-powder rounded-lg p-4 text-sm text-ocean-deep">
                                {c.aiSummary}
                            </div>
                        </div>
                    )}

                    {c.callbackAt && (
                        <div className="p-3 bg-orange-50 border border-orange-200 rounded-lg text-sm">
                            <span className="font-medium text-orange-700">Callback scheduled:</span>{' '}
                            <span className="text-orange-600">{new Date(c.callbackAt).toLocaleString()}</span>
                            {c.callbackReason && <div className="text-orange-600 mt-1 text-xs">{c.callbackReason}</div>}
                        </div>
                    )}

                    {c.tags && c.tags.length > 0 && (
                        <div>
                            <h3 className="font-semibold text-ocean-navy text-sm mb-2">Tags</h3>
                            <div className="flex flex-wrap gap-1">
                                {c.tags.map(t => (
                                    <span key={t} className="px-2 py-0.5 text-xs bg-ocean-mist/50 text-ocean-deep/90 rounded-full">{t}</span>
                                ))}
                            </div>
                        </div>
                    )}

                    <div>
                        <h3 className="font-semibold text-ocean-navy text-sm mb-2 flex items-center gap-2">
                            <MessageSquare className="h-4 w-4" /> Transcript ({detail.turns.length} turns)
                        </h3>
                        {detail.turns.length === 0 ? (
                            <p className="text-sm text-ocean-deep/60 italic">No transcript available.</p>
                        ) : (
                            <div className="bg-ocean-powder rounded-lg p-4 text-sm space-y-3 max-h-80 overflow-y-auto">
                                {detail.turns.map(t => (
                                    <div key={t.turnIndex}>
                                        {t.inputTranscript && (
                                            <div className="mb-1">
                                                <span className="text-xs font-semibold text-ocean-deep/80">Contact:</span>{' '}
                                                <span className="text-ocean-deep">{t.inputTranscript}</span>
                                            </div>
                                        )}
                                        {t.aiResponse && (
                                            <div>
                                                <span className="text-xs font-semibold text-ocean-rich">Agent:</span>{' '}
                                                <span className="text-ocean-deep">{t.aiResponse}</span>
                                                {t.intent && (
                                                    <span className="ml-2 text-xs text-ocean-bright">({t.intent})</span>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>

                    <div>
                        <h3 className="font-semibold text-ocean-navy text-sm mb-2">Operator Notes</h3>
                        <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3}
                            className="w-full px-3 py-2 border border-ocean-ice rounded-lg text-sm outline-none"
                            placeholder="Add internal notes about this contact..." />
                        <div className="flex items-center justify-between mt-2">
                            <span className="text-xs text-ocean-deep/80">{savingMsg}</span>
                            <button onClick={saveNotes} className="text-sm px-3 py-1.5 border border-ocean-ice rounded-lg hover:bg-ocean-powder">
                                Save Notes
                            </button>
                        </div>
                    </div>
                </div>

                <div className="p-4 border-t border-ocean-ice/80 flex items-center justify-between gap-2 flex-wrap">
                    <div className="flex gap-2">
                        {!c.dnc && (
                            <button onClick={() => { if (confirm('Mark this contact as Do-Not-Call?')) markDnc(); }}
                                className="flex items-center gap-1.5 px-3 py-2 text-sm border border-red-200 text-red-600 rounded-lg hover:bg-red-50">
                                <Ban className="h-4 w-4" /> Mark DNC
                            </button>
                        )}
                        <button onClick={scheduleCallback}
                            className="flex items-center gap-1.5 px-3 py-2 text-sm border border-ocean-ice rounded-lg hover:bg-ocean-powder">
                            <Clock className="h-4 w-4" /> Schedule Callback
                        </button>
                    </div>
                    <button onClick={onClose} className="px-4 py-2 bg-ocean-mist/50 text-ocean-deep rounded-lg text-sm font-medium hover:bg-ocean-ice">
                        Close
                    </button>
                </div>
            </div>
        </div>
    );
}

/** Name, description, dialer limits - PUT /api/campaigns/:id (blocked while running). */
function CampaignGeneralEditor({
    campaign,
    token,
    onSaved,
    onCancel,
}: {
    campaign: Campaign;
    token: string | null;
    onSaved?: () => void | Promise<void>;
    onCancel?: () => void;
}) {
    const toast = useToast();
    const [name, setName] = useState(campaign.name);
    const [description, setDescription] = useState(campaign.description || '');
    const [maxConcurrentCalls, setMaxConcurrentCalls] = useState(campaign.maxConcurrentCalls);
    const [retryAttempts, setRetryAttempts] = useState(campaign.retryAttempts);
    const [retryDelayMinutes, setRetryDelayMinutes] = useState(campaign.retryDelayMinutes);
    const [saving, setSaving] = useState(false);
    const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

    useEffect(() => {
        setName(campaign.name);
        setDescription(campaign.description || '');
        setMaxConcurrentCalls(campaign.maxConcurrentCalls);
        setRetryAttempts(campaign.retryAttempts);
        setRetryDelayMinutes(campaign.retryDelayMinutes);
    }, [campaign]);

    const locked = campaign.status === 'running';

    const submit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (locked) return;
        setSaving(true);
        setMsg(null);
        try {
            const res = await fetch(`${API_BASE}/api/campaigns/${campaign._id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                body: JSON.stringify({
                    name: name.trim(),
                    description: description.trim(),
                    maxConcurrentCalls: Math.min(10, Math.max(1, Number(maxConcurrentCalls) || 1)),
                    retryAttempts: Math.min(5, Math.max(0, Number(retryAttempts) || 0)),
                    retryDelayMinutes: Math.min(10080, Math.max(5, Number(retryDelayMinutes) || 60)),
                }),
            });
            const data = await res.json().catch(() => ({} as { message?: string }));
            if (!res.ok) {
                const msg = data.message || 'Save failed';
                toast.error('Save failed', msg);
                setMsg({ type: 'err', text: msg });
                return;
            }
            await onSaved?.();
            setMsg({ type: 'ok', text: 'Saved.' });
            toast.success('Campaign updated');
        } catch (err: any) {
            const msg = err.message || 'Save failed';
            setMsg({ type: 'err', text: msg });
            toast.error('Save failed', msg);
        } finally {
            setSaving(false);
        }
    };

    return (
        <form onSubmit={submit} className="bg-white rounded-xl border border-ocean-ice p-5 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2">
                <div>
                    <h3 className="font-semibold text-ocean-navy">Campaign details</h3>
                    <p className="text-xs text-ocean-deep/80 mt-0.5">Name, notes, and dialer limits (opening script and hours are under Sales Script).</p>
                </div>
                {locked && (
                    <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 shrink-0 max-w-md">
                        Pause the campaign to edit these fields.
                    </p>
                )}
            </div>

            <div>
                <label className="block text-sm font-medium text-ocean-deep mb-1">Campaign name</label>
                <input
                    title="Campaign name"
                    value={name}
                    onChange={e => setName(e.target.value)}
                    disabled={locked}
                    className="w-full px-3 py-2 border border-ocean-ice rounded-lg text-sm outline-none disabled:opacity-50"
                />
            </div>

            <div>
                <label className="block text-sm font-medium text-ocean-deep mb-1">Description (optional)</label>
                <textarea
                    title="Description"
                    value={description}
                    onChange={e => setDescription(e.target.value)}
                    disabled={locked}
                    rows={3}
                    className="w-full px-3 py-2 border border-ocean-ice rounded-lg text-sm outline-none resize-y min-h-[5rem] max-h-48 disabled:opacity-50"
                />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                    <label className="block text-xs text-ocean-deep/80 mb-1">Concurrent calls (1-10)</label>
                    <input
                        title="Concurrent calls"
                        type="number"
                        min={1}
                        max={10}
                        value={maxConcurrentCalls}
                        onChange={e => setMaxConcurrentCalls(parseInt(e.target.value, 10) || 1)}
                        disabled={locked}
                        className="w-full px-3 py-2 border border-ocean-ice rounded-lg text-sm outline-none disabled:opacity-50"
                    />
                </div>
                <div>
                    <label className="block text-xs text-ocean-deep/80 mb-1">Retry attempts</label>
                    <input
                        title="Retry attempts"
                        type="number"
                        min={0}
                        max={5}
                        value={retryAttempts}
                        onChange={e => setRetryAttempts(parseInt(e.target.value, 10) || 0)}
                        disabled={locked}
                        className="w-full px-3 py-2 border border-ocean-ice rounded-lg text-sm outline-none disabled:opacity-50"
                    />
                </div>
                <div>
                    <label className="block text-xs text-ocean-deep/80 mb-1">Retry delay (minutes)</label>
                    <input
                        title="Retry delay minutes"
                        type="number"
                        min={5}
                        max={10080}
                        value={retryDelayMinutes}
                        onChange={e => setRetryDelayMinutes(parseInt(e.target.value, 10) || 60)}
                        disabled={locked}
                        className="w-full px-3 py-2 border border-ocean-ice rounded-lg text-sm outline-none disabled:opacity-50"
                    />
                </div>
            </div>

            {msg && (
                <p className={`text-sm ${msg.type === 'ok' ? 'text-green-700' : 'text-red-600'}`}>{msg.text}</p>
            )}

            <div className="flex justify-end gap-2 flex-wrap">
                {onCancel && (
                    <button
                        type="button"
                        onClick={onCancel}
                        className="px-5 py-2 border border-ocean-ice rounded-lg text-sm font-medium text-ocean-deep hover:bg-ocean-powder"
                    >
                        Cancel
                    </button>
                )}
                <button
                    type="submit"
                    disabled={locked || saving || !name.trim()}
                    className="px-5 py-2 bg-ocean-deep text-white rounded-lg text-sm font-medium hover:bg-ocean-rich disabled:opacity-50"
                >
                    {saving ? 'Saving...' : 'Save details'}
                </button>
            </div>
        </form>
    );
}

function CampaignOverviewSection({
    campaign,
    token,
    onRefetch,
}: {
    campaign: Campaign;
    token: string | null;
    onRefetch: () => Promise<void>;
}) {
    const [editDetails, setEditDetails] = useState(false);
    const locked = campaign.status === 'running';

    return (
        <div className="space-y-4">
            {!editDetails ? (
                <div className="bg-white rounded-2xl border border-ocean-ice shadow-sm p-5 sm:p-6">
                    <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 mb-5">
                        <div>
                            <h2 className="text-base font-bold text-ocean-navy">Campaign details</h2>
                            <p className="text-xs text-ocean-deep/70 mt-0.5 max-w-xl">
                                Name, internal notes, and dialer limits. Opening lines and playbook live under the Sales Script tab.
                            </p>
                        </div>
                        <button
                            type="button"
                            onClick={() => setEditDetails(true)}
                            disabled={locked}
                            title={locked ? 'Pause the campaign to edit these fields' : undefined}
                            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-ocean-ice text-sm font-medium text-ocean-deep hover:bg-ocean-powder disabled:opacity-50 shrink-0"
                        >
                            <PenLine className="h-4 w-4" />
                            Edit details
                        </button>
                    </div>

                    <dl className="grid sm:grid-cols-2 gap-x-10 gap-y-4 text-sm">
                        <div>
                            <dt className="text-xs font-medium text-ocean-deep/70 uppercase tracking-wide">Campaign name</dt>
                            <dd className="mt-1 font-semibold text-ocean-navy">{campaign.name}</dd>
                        </div>
                        <div>
                            <dt className="text-xs font-medium text-ocean-deep/70 uppercase tracking-wide">Concurrent calls</dt>
                            <dd className="mt-1 text-ocean-deep">{campaign.maxConcurrentCalls} (max 10)</dd>
                        </div>
                        <div>
                            <dt className="text-xs font-medium text-ocean-deep/70 uppercase tracking-wide">Retry attempts</dt>
                            <dd className="mt-1 text-ocean-deep">{campaign.retryAttempts}</dd>
                        </div>
                        <div>
                            <dt className="text-xs font-medium text-ocean-deep/70 uppercase tracking-wide">Retry delay</dt>
                            <dd className="mt-1 text-ocean-deep">{campaign.retryDelayMinutes} minutes</dd>
                        </div>
                    </dl>

                    <div className="mt-5 pt-5 border-t border-ocean-ice/80">
                        <div className="text-xs font-medium text-ocean-deep/70 uppercase tracking-wide">Description</div>
                        <div className="mt-1.5 text-ocean-deep/90 whitespace-pre-wrap">
                            {(campaign.description || '').trim()
                                ? campaign.description
                                : <span className="text-ocean-deep/55 italic">No description</span>}
                        </div>
                    </div>

                    {locked && (
                        <p className="mt-4 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                            This campaign is running - pause it to edit name, description, or dialer limits.
                        </p>
                    )}
                </div>
            ) : (
                <CampaignGeneralEditor
                    campaign={campaign}
                    token={token}
                    onCancel={() => setEditDetails(false)}
                    onSaved={async () => {
                        await onRefetch();
                        setEditDetails(false);
                    }}
                />
            )}
        </div>
    );
}

// ─── Main page ────────────────────────────────────────────────────────────

export default function CampaignDetailPage() {
    const { id } = useParams<{ id: string }>();
    const { token } = useAuth();
    const toast = useToast();
    const [campaign, setCampaign] = useState<Campaign | null>(null);
    const [kpis, setKpis] = useState<Kpis | null>(null);
    const [contacts, setContacts] = useState<Contact[]>([]);
    const [hotLeads, setHotLeads] = useState<Contact[]>([]);
    const [callbacks, setCallbacks] = useState<Contact[]>([]);
    const [total, setTotal] = useState(0);
    const [page, setPage] = useState(1);
    const [statusFilter, setStatusFilter] = useState('');
    const [searchQ, setSearchQ] = useState('');
    const [loading, setLoading] = useState(true);
    const [actionLoading, setActionLoading] = useState('');
    const [error, setError] = useState('');
    const [uploadMsg, setUploadMsg] = useState('');
    const [selectedContact, setSelectedContact] = useState<string | null>(null);
    const [pipelineTab, setPipelineTab] = useState<PipelineTab>('hot');
    const [setupTab, setSetupTab] = useState<SetupTab>('overview');
    const [csvPreviewOpen, setCsvPreviewOpen] = useState(false);
    const [csvPreviewKind, setCsvPreviewKind] = useState<CsvPreviewKind>('all');
    const [csvPreviewText, setCsvPreviewText] = useState('');
    const [csvPreviewLoading, setCsvPreviewLoading] = useState(false);
    const [sampleCsvOpen, setSampleCsvOpen] = useState(false);
    const fileRef = useRef<HTMLInputElement>(null);

    const fetchCampaign = useCallback(async () => {
        try {
            const res = await fetch(`${API_BASE}/api/campaigns/${id}`, {
                headers: { Authorization: `Bearer ${token}` },
            });
            if (res.ok) setCampaign(await res.json());
        } catch { /* ignore */ }
    }, [id, token]);

    const fetchKpis = useCallback(async () => {
        try {
            const res = await fetch(`${API_BASE}/api/campaigns/${id}/kpis`, {
                headers: { Authorization: `Bearer ${token}` },
            });
            if (res.ok) setKpis(await res.json());
        } catch { /* ignore */ }
    }, [id, token]);

    const fetchContacts = useCallback(async (p = page, sf = statusFilter, q = searchQ) => {
        try {
            const params = new URLSearchParams({ page: String(p), limit: '20' });
            if (sf) params.set('status', sf);
            if (q) params.set('q', q);
            const res = await fetch(`${API_BASE}/api/campaigns/${id}/contacts?${params}`, {
                headers: { Authorization: `Bearer ${token}` },
            });
            if (res.ok) {
                const data = await res.json();
                setContacts(data.contacts);
                setTotal(data.total);
            }
        } catch { /* ignore */ }
    }, [id, token, page, statusFilter, searchQ]);

    const fetchHotLeads = useCallback(async () => {
        try {
            const res = await fetch(`${API_BASE}/api/campaigns/${id}/hot-leads?limit=50`, {
                headers: { Authorization: `Bearer ${token}` },
            });
            if (res.ok) setHotLeads(await res.json());
        } catch { /* ignore */ }
    }, [id, token]);

    const fetchCallbacks = useCallback(async () => {
        try {
            const res = await fetch(`${API_BASE}/api/campaigns/${id}/callbacks`, {
                headers: { Authorization: `Bearer ${token}` },
            });
            if (res.ok) setCallbacks(await res.json());
        } catch { /* ignore */ }
    }, [id, token]);

    useEffect(() => {
        const init = async () => {
            setLoading(true);
            await Promise.all([fetchCampaign(), fetchKpis(), fetchContacts(1, '', ''), fetchHotLeads(), fetchCallbacks()]);
            setLoading(false);
        };
        init();
    }, [id, token]); // eslint-disable-line react-hooks/exhaustive-deps

    useEffect(() => {
        fetchContacts(page, statusFilter, searchQ);
    }, [page, statusFilter, searchQ]); // eslint-disable-line react-hooks/exhaustive-deps

    // Auto-refresh while running
    useEffect(() => {
        if (campaign?.status !== 'running') return;
        const interval = setInterval(() => {
            fetchCampaign();
            fetchKpis();
            fetchContacts(page, statusFilter, searchQ);
            fetchHotLeads();
            fetchCallbacks();
        }, 10_000);
        return () => clearInterval(interval);
    }, [campaign?.status, page, statusFilter, searchQ]); // eslint-disable-line react-hooks/exhaustive-deps

    const doAction = async (action: 'start' | 'pause' | 'stop') => {
        setActionLoading(action);
        setError('');
        const labels = { start: 'Campaign started', pause: 'Campaign paused', stop: 'Campaign stopped' } as const;
        try {
            const res = await fetch(`${API_BASE}/api/campaigns/${id}/${action}`, {
                method: 'POST',
                headers: { Authorization: `Bearer ${token}` },
            });
            if (!res.ok) {
                const msg = await handleApiError(res, toast, { title: `Could not ${action} campaign` });
                setError(msg);
                return;
            }
            await fetchCampaign();
            toast.success(labels[action]);
        } catch (err: any) {
            const msg = err.message || `Failed to ${action} campaign`;
            setError(msg);
            handleNetworkError(toast, { title: `Could not ${action} campaign`, message: msg });
        } finally {
            setActionLoading('');
        }
    };

    const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        setUploadMsg('');
        setError('');
        const formData = new FormData();
        formData.append('file', file);
        try {
            const res = await fetch(`${API_BASE}/api/campaigns/${id}/contacts/upload`, {
                method: 'POST',
                headers: { Authorization: `Bearer ${token}` },
                body: formData,
            });
            const data = await res.json();
            if (!res.ok) {
                const msg = data.message || 'Upload failed';
                toast.error('Upload failed', msg);
                setError(msg);
                return;
            }
            const bits: string[] = [`Imported ${data.imported} contacts`];
            if (data.skippedDuplicate) bits.push(`${data.skippedDuplicate} duplicates skipped`);
            if (data.skippedDnc) bits.push(`${data.skippedDnc} DNC skipped`);
            if (data.rejected) bits.push(`${data.rejected} rejected`);
            const summary = bits.join(' · ');
            setUploadMsg(summary);
            toast.success('Contacts imported', summary);
            await Promise.all([fetchCampaign(), fetchKpis(), fetchContacts(1, statusFilter, searchQ)]);
        } catch (err: any) {
            const msg = err.message || 'Upload error';
            setError(msg);
            handleNetworkError(toast, { title: 'Upload failed', message: msg });
        } finally {
            if (fileRef.current) fileRef.current.value = '';
        }
    };

    const exportLeads = async () => {
        try {
            const res = await fetch(`${API_BASE}/api/campaigns/${id}/export-leads`, {
                headers: { Authorization: `Bearer ${token}` },
            });
            if (!res.ok) {
                const msg = await handleApiError(res, toast, { title: 'Export failed' });
                setError(msg);
                return;
            }
            const blob = await res.blob();
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `${(campaign?.name || 'campaign').replace(/[^a-z0-9]/gi, '_')}_leads.csv`;
            document.body.appendChild(a);
            a.click();
            a.remove();
            URL.revokeObjectURL(url);
            toast.success('Leads exported');
        } catch (err: any) {
            const msg = err.message || 'Export failed';
            setError(msg);
            handleNetworkError(toast, { title: 'Export failed', message: msg });
        }
    };

    const exportAllContacts = async () => {
        try {
            const res = await fetch(`${API_BASE}/api/campaigns/${id}/contacts/export`, {
                headers: { Authorization: `Bearer ${token}` },
            });
            if (!res.ok) {
                const msg = await handleApiError(res, toast, { title: 'Export failed' });
                setError(msg);
                return;
            }
            const blob = await res.blob();
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `${(campaign?.name || 'campaign').replace(/[^a-z0-9]/gi, '_')}_contacts_${new Date().toISOString().slice(0, 10)}.csv`;
            document.body.appendChild(a);
            a.click();
            a.remove();
            URL.revokeObjectURL(url);
            toast.success('Contacts exported');
        } catch (err: any) {
            const msg = err.message || 'Export failed';
            setError(msg);
            handleNetworkError(toast, { title: 'Export failed', message: msg });
        }
    };

    const loadCsvPreview = async (kind: CsvPreviewKind, opts?: { openModal?: boolean }) => {
        const openModal = opts?.openModal ?? false;
        if (openModal) setCsvPreviewOpen(true);
        setCsvPreviewKind(kind);
        setCsvPreviewLoading(true);
        setError('');
        const url =
            kind === 'all'
                ? `${API_BASE}/api/campaigns/${id}/contacts/export`
                : `${API_BASE}/api/campaigns/${id}/export-leads`;
        try {
            const res = await fetch(url, {
                headers: { Authorization: `Bearer ${token}` },
            });
            if (!res.ok) {
                const msg = await handleApiError(res, toast, { title: 'Preview failed' });
                setError(msg);
                return;
            }
            const raw = await res.text();
            setCsvPreviewText(raw.replace(/^\uFEFF/, ''));
        } catch (err: any) {
            const msg = err.message || 'Could not load CSV preview';
            setError(msg);
            handleNetworkError(toast, { title: 'Preview failed', message: msg });
        } finally {
            setCsvPreviewLoading(false);
        }
    };

    const openCsvPreviewChooser = () => {
        void loadCsvPreview('all', { openModal: true });
    };

    if (loading) {
        return (
            <div className="bg-white py-24 flex items-center justify-center text-ocean-deep/80">
                Loading campaign...
            </div>
        );
    }
    if (!campaign) {
        return (
            <div className="bg-white py-24 flex items-center justify-center text-ocean-deep/80">
                Campaign not found.
            </div>
        );
    }

    return (
        <div className="bg-white pb-12">
            <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 pt-6 sm:pt-8">
                <PageBackNav to="/campaigns" label="Back to Campaigns" />

                {/* Header - title + meta separated from action rows */}
                <div className="mb-6 rounded-2xl border border-ocean-ice bg-white p-6 shadow-sm sm:p-7">
                    <header className="space-y-6">
                        <div className="space-y-4">
                            <div className="flex flex-wrap items-center gap-2 gap-y-3">
                                <h1 className="min-w-0 break-words text-2xl font-bold tracking-tight text-ocean-navy sm:text-[1.65rem]">{campaign.name}</h1>
                                <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${STATUS_COLORS[campaign.status]}`}>{campaign.status}</span>
                                {campaign.goal && (
                                    <span className="rounded-full bg-ocean-powder px-2.5 py-1 text-xs font-medium text-ocean-deep">{GOAL_LABELS[campaign.goal] || campaign.goal}</span>
                                )}
                            </div>

                            <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
                                <div className="rounded-xl border border-ocean-ice/80 bg-ocean-mist/20 px-3 py-2.5">
                                    <dt className="text-xs font-medium uppercase tracking-wide text-ocean-deep/65">Assigned agent</dt>
                                    <dd className="mt-0.5 font-medium text-ocean-navy">{campaign.agentId?.name || '-'}</dd>
                                </div>
                                <div className="rounded-xl border border-ocean-ice/80 bg-ocean-mist/20 px-3 py-2.5">
                                    <dt className="text-xs font-medium uppercase tracking-wide text-ocean-deep/65">Caller ID</dt>
                                    <dd className="mt-0.5 font-mono text-sm font-medium text-ocean-navy">{campaign.callerIdNumber || 'Not set'}</dd>
                                </div>
                                <div className="rounded-xl border border-ocean-ice/80 bg-ocean-mist/20 px-3 py-2.5">
                                    <dt className="text-xs font-medium uppercase tracking-wide text-ocean-deep/65">Concurrency</dt>
                                    <dd className="mt-0.5 font-medium text-ocean-navy">{campaign.maxConcurrentCalls} parallel call{campaign.maxConcurrentCalls !== 1 ? 's' : ''}</dd>
                                </div>
                                <div className="rounded-xl border border-ocean-ice/80 bg-ocean-mist/20 px-3 py-2.5">
                                    <dt className="text-xs font-medium uppercase tracking-wide text-ocean-deep/65">Retries</dt>
                                    <dd className="mt-0.5 font-medium text-ocean-navy">{campaign.retryAttempts} · every {campaign.retryDelayMinutes} min</dd>
                                </div>
                            </dl>

                            {campaign.description?.trim() ? (
                                <p className="text-sm leading-relaxed text-ocean-deep/90">{campaign.description}</p>
                            ) : null}

                            {campaign.status === 'running' && campaign.callingAllowed && !campaign.callingAllowed.allowed && (
                                <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-800">
                                    <AlertCircle className="h-3.5 w-3.5 shrink-0" aria-hidden />
                                    Dialer paused: {campaign.callingAllowed.reason}
                                </div>
                            )}
                        </div>

                        <div className="border-t border-ocean-ice/90 pt-6">
                            <div className="grid gap-6 lg:grid-cols-3 lg:gap-8">
                                <div className="flex min-h-[9.5rem] flex-col rounded-xl border border-ocean-ice/80 bg-ocean-mist/25 p-4">
                                    <p className="text-[11px] font-semibold uppercase tracking-wide text-ocean-deep/65">Contacts &amp; data</p>
                                    <div className="mt-4 flex flex-1 flex-col justify-center gap-2">
                                        <label className="inline-flex min-h-[2.75rem] w-full cursor-pointer items-center justify-center gap-2 rounded-lg border border-ocean-ice bg-white px-3 py-2.5 text-center text-sm font-medium text-ocean-deep shadow-sm transition hover:border-ocean-deep/25 hover:bg-ocean-powder">
                                            <Upload className="h-4 w-4 shrink-0" aria-hidden /> Upload CSV
                                            <input ref={fileRef} title="Upload contacts CSV" type="file" accept=".csv" className="hidden" onChange={handleUpload} />
                                        </label>
                                        <button
                                            type="button"
                                            onClick={() => setSampleCsvOpen(true)}
                                            title="See example columns for this campaign goal (read-only)"
                                            className="inline-flex min-h-[2.75rem] w-full items-center justify-center gap-2 rounded-lg border border-ocean-bright/55 bg-white px-3 py-2 text-sm font-medium text-ocean-deep shadow-sm transition hover:bg-ocean-powder"
                                        >
                                            <FileText className="h-4 w-4 shrink-0 text-ocean-rich" aria-hidden />
                                            Sample format
                                        </button>
                                        <button
                                            type="button"
                                            title="Reload campaign and lists"
                                            onClick={async () => { await Promise.all([fetchCampaign(), fetchKpis(), fetchContacts(page, statusFilter, searchQ), fetchHotLeads(), fetchCallbacks()]); }}
                                            className="inline-flex min-h-[2.75rem] w-full items-center justify-center gap-2 rounded-lg border border-ocean-ice bg-white px-3 py-2 text-sm font-medium text-ocean-deep shadow-sm transition hover:bg-ocean-powder"
                                        >
                                            <RefreshCw className="h-4 w-4 shrink-0" aria-hidden /> Refresh
                                        </button>
                                    </div>
                                </div>

                                <div className="flex min-h-[9.5rem] flex-col rounded-xl border border-ocean-ice/80 bg-ocean-mist/25 p-4">
                                    <p className="text-[11px] font-semibold uppercase tracking-wide text-ocean-deep/65">Exports</p>
                                    <div className="mt-4 flex flex-1 flex-col justify-center gap-2">
                                        <button
                                            type="button"
                                            onClick={openCsvPreviewChooser}
                                            disabled={csvPreviewLoading || campaign.totalContacts === 0}
                                            title={campaign.totalContacts === 0 ? 'Upload contacts first' : 'Preview an export as plain text CSV (pick which dataset in the modal)'}
                                            className="inline-flex min-h-[2.75rem] w-full items-center justify-center gap-2 rounded-lg border border-ocean-bright/50 bg-white px-3 py-2 text-sm font-medium text-ocean-deep shadow-sm transition hover:border-ocean-deep/40 hover:bg-ocean-powder disabled:pointer-events-none disabled:opacity-45"
                                        >
                                            <FileText className="h-4 w-4 shrink-0 text-ocean-rich" aria-hidden />
                                            {csvPreviewLoading && !csvPreviewOpen ? 'Loading…' : 'View CSV'}
                                        </button>
                                        <button type="button" onClick={exportLeads} title="Export qualified leads (interested + callback) as CSV"
                                            className="inline-flex min-h-[2.75rem] w-full items-center justify-center gap-2 rounded-lg border border-ocean-ice bg-white px-3 py-2 text-sm font-medium text-ocean-deep shadow-sm transition hover:bg-ocean-powder">
                                            <Download className="h-4 w-4 shrink-0 text-emerald-600" aria-hidden /> Hot leads CSV
                                        </button>
                                        <button type="button" onClick={exportAllContacts} title="Download all contacts for this campaign as CSV"
                                            className="inline-flex min-h-[2.75rem] w-full items-center justify-center gap-2 rounded-lg border border-ocean-ice bg-white px-3 py-2 text-sm font-medium text-ocean-deep shadow-sm transition hover:bg-ocean-powder">
                                            <Download className="h-4 w-4 shrink-0 text-ocean-deep" aria-hidden /> Contacts CSV
                                        </button>
                                    </div>
                                </div>

                                <div className="flex min-h-[9.5rem] flex-col rounded-xl border border-ocean-ice/80 bg-ocean-mist/25 p-4">
                                    <p className="text-[11px] font-semibold uppercase tracking-wide text-ocean-deep/65">Dialer</p>
                                    <div className="mt-4 flex flex-1 flex-col justify-center gap-3">
                                            {(campaign.status === 'draft' || campaign.status === 'paused' || campaign.status === 'scheduled') && (
                                                <button
                                                    type="button"
                                                    onClick={() => doAction('start')}
                                                    disabled={!!actionLoading}
                                                    className="inline-flex w-full min-h-[2.75rem] items-center justify-center gap-2 rounded-xl border-2 border-emerald-700/80 bg-emerald-50 px-4 py-2.5 text-sm font-semibold text-emerald-950 shadow-sm transition hover:border-emerald-800 hover:bg-emerald-100 disabled:opacity-45"
                                                >
                                                    <PlayCircle className="h-5 w-5 shrink-0 text-emerald-800" aria-hidden />
                                                    {actionLoading === 'start' ? 'Starting...' : 'Start'}
                                                </button>
                                            )}
                                            {campaign.status === 'running' && (
                                                <button
                                                    type="button"
                                                    onClick={() => doAction('pause')}
                                                    disabled={!!actionLoading}
                                                    className="inline-flex w-full min-h-[2.75rem] items-center justify-center gap-2 rounded-xl border-2 border-amber-600/90 bg-amber-50 px-4 py-2.5 text-sm font-semibold text-amber-950 shadow-sm transition hover:border-amber-700 hover:bg-amber-100 disabled:opacity-45"
                                                >
                                                    <Pause className="h-4 w-4 shrink-0 text-amber-900" aria-hidden />
                                                    {actionLoading === 'pause' ? 'Pausing...' : 'Pause'}
                                                </button>
                                            )}
                                            {['running', 'paused', 'draft', 'scheduled'].includes(campaign.status) && (
                                                <button
                                                    type="button"
                                                    onClick={() => {
                                                        if (confirm('Stop this campaign?')) void doAction('stop');
                                                    }}
                                                    disabled={!!actionLoading}
                                                    className="inline-flex w-full min-h-[2.75rem] items-center justify-center gap-2 rounded-xl border-2 border-red-800/85 bg-red-50 px-4 py-2.5 text-sm font-semibold text-red-950 shadow-sm transition hover:border-red-900 hover:bg-red-100 disabled:opacity-45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400/80 focus-visible:ring-offset-2"
                                                >
                                                    <StopCircle className="h-5 w-5 shrink-0 text-red-800" aria-hidden />
                                                    {actionLoading === 'stop' ? 'Stopping...' : 'Stop'}
                                                </button>
                                            )}
                                            {!['running', 'paused', 'draft', 'scheduled'].includes(campaign.status) && (
                                                <p className="text-center text-xs text-ocean-deep/60">
                                                    Dialer controls are only available while the campaign can still be edited or run.
                                                </p>
                                            )}
                                    </div>
                                </div>
                            </div>
                        </div>
                    </header>

                    {(error || uploadMsg) && (
                        <div className="mt-5 space-y-3 border-t border-ocean-ice/80 pt-5">
                            {error && <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-800">{error}</div>}
                            {uploadMsg && <div className="rounded-lg border border-green-200 bg-green-50 px-3 py-2.5 text-sm text-green-800">{uploadMsg}</div>}
                        </div>
                    )}
                </div>

                <CampaignStatsDashboard campaign={campaign} kpis={kpis} />

                <div className="mb-6 space-y-6">
                    <div>
                        <p className="text-[11px] font-semibold uppercase tracking-wide text-ocean-deep/60 mb-2">Pipeline &amp; contacts</p>
                        <div className="grid grid-cols-3 gap-2 p-1.5 bg-white rounded-xl border border-ocean-ice/80 shadow-sm">
                            {([
                                { k: 'hot' as PipelineTab, label: 'Hot leads', Icon: Flame, badge: hotLeads.length },
                                { k: 'contacts' as PipelineTab, label: 'Contacts', Icon: Users, badge: total },
                                { k: 'callbacks' as PipelineTab, label: 'Callbacks', Icon: PhoneForwarded, badge: callbacks.length },
                            ]).map(({ k, label, Icon, badge }) => (
                                <button
                                    key={k}
                                    type="button"
                                    onClick={() => setPipelineTab(k)}
                                    className={`flex flex-col items-center justify-center gap-1.5 min-h-[4rem] rounded-lg px-2 py-2.5 text-[11px] sm:text-xs font-semibold transition-colors leading-tight ${
                                        pipelineTab === k ? 'bg-ocean-deep text-white shadow-sm' : 'text-ocean-deep hover:bg-ocean-powder'
                                    }`}
                                >
                                    <Icon className={`h-5 w-5 shrink-0 ${pipelineTab === k ? 'text-white' : 'text-ocean-deep'}`} aria-hidden />
                                    <span className="text-center">{label}</span>
                                    <span className={`text-[10px] font-bold tabular-nums ${pipelineTab === k ? 'text-white/90' : 'text-ocean-deep/70'}`}>{badge}</span>
                                </button>
                            ))}
                        </div>
                    </div>

                    {pipelineTab === 'hot' && (
                        <div className="bg-white rounded-xl border border-ocean-ice overflow-hidden">
                            <div className="p-4 border-b border-ocean-ice/80">
                                <h3 className="font-semibold text-ocean-navy">Hot Leads - highest lead score first</h3>
                                <p className="text-xs text-ocean-deep/80 mt-0.5">Qualified contacts sorted by AI-assigned score. Click a row to see the full transcript.</p>
                            </div>
                            {hotLeads.length === 0 ? (
                                <div className="p-10 text-center text-ocean-deep/80">
                                    <Target className="h-8 w-8 text-gray-300 mx-auto mb-2" />
                                    No qualified leads yet.
                                </div>
                            ) : (
                                <div className="overflow-x-auto">
                                    <table className="w-full text-sm">
                                        <thead>
                                            <tr className="bg-ocean-powder text-ocean-deep/80 text-xs uppercase tracking-wide">
                                                <th className="text-left px-4 py-3">Contact</th>
                                                <th className="text-left px-4 py-3">Score</th>
                                                <th className="text-left px-4 py-3">BANT</th>
                                                <th className="text-left px-4 py-3">Duration</th>
                                                <th className="text-left px-4 py-3">Summary</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-ocean-ice/80">
                                            {hotLeads.map(c => (
                                                <tr key={c._id} onClick={() => setSelectedContact(c._id)}
                                                    className="hover:bg-ocean-powder cursor-pointer">
                                                    <td className="px-4 py-3">
                                                        <div className="font-medium text-ocean-navy">{c.name || c.phone}</div>
                                                        {c.company && <div className="text-ocean-deep/80 text-xs">{c.company}</div>}
                                                    </td>
                                                    <td className="px-4 py-3">
                                                        <span className={`font-bold ${scoreColor(c.leadScore)}`}>{fmtScore(c.leadScore)}</span>
                                                    </td>
                                                    <td className="px-4 py-3 text-xs text-ocean-deep/90">
                                                        {c.bant
                                                            ? `B${c.bant.budget} A${c.bant.authority} N${c.bant.need} T${c.bant.timeline}`
                                                            : '-'}
                                                    </td>
                                                    <td className="px-4 py-3 text-ocean-deep/90">{fmtDuration(c.callDurationSec || 0)}</td>
                                                    <td className="px-4 py-3 text-ocean-deep/80 max-w-md truncate">{c.aiSummary || '-'}</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            )}
                        </div>
                    )}

                    {pipelineTab === 'contacts' && (
                        <div className="bg-white rounded-xl border border-ocean-ice overflow-hidden">
                            <div className="p-4 border-b border-ocean-ice/80 flex items-center justify-between gap-3 flex-wrap">
                                <div className="flex items-center gap-3">
                                    <h3 className="font-semibold text-ocean-navy">Contacts ({total})</h3>
                                    <input type="text" placeholder="Search name, phone, email..."
                                        value={searchQ}
                                        onChange={e => { setSearchQ(e.target.value); setPage(1); }}
                                        className="px-3 py-1.5 border border-ocean-ice rounded-lg text-sm outline-none w-64" />
                                </div>
                                <select title="Filter by status"
                                    value={statusFilter}
                                    onChange={e => { setStatusFilter(e.target.value); setPage(1); }}
                                    className="text-sm border border-ocean-ice rounded-lg px-3 py-1.5 bg-white outline-none">
                                    <option value="">All statuses</option>
                                    <option value="pending">Pending</option>
                                    <option value="calling">Calling</option>
                                    <option value="interested">Interested</option>
                                    <option value="not_interested">Not Interested</option>
                                    <option value="callback">Callback</option>
                                    <option value="no_answer">No Answer</option>
                                    <option value="voicemail">Voicemail</option>
                                    <option value="wrong_number">Wrong Number</option>
                                    <option value="dnc">DNC</option>
                                    <option value="failed">Failed</option>
                                </select>
                            </div>

                            {contacts.length === 0 ? (
                                <div className="p-10 text-center text-ocean-deep/80">
                                    <Users className="h-8 w-8 text-gray-300 mx-auto mb-2" />
                                    {campaign.totalContacts === 0 ? 'No contacts yet. Upload a CSV to get started.' : 'No contacts match the selected filter.'}
                                </div>
                            ) : (
                                <div className="overflow-x-auto">
                                    <table className="w-full text-sm">
                                        <thead>
                                            <tr className="bg-ocean-powder text-ocean-deep/80 text-xs uppercase tracking-wide">
                                                <th className="text-left px-4 py-3">Contact</th>
                                                <th className="text-left px-4 py-3">Phone</th>
                                                <th className="text-left px-4 py-3">Status</th>
                                                <th className="text-left px-4 py-3">Score</th>
                                                <th className="text-left px-4 py-3">Attempts</th>
                                                <th className="text-left px-4 py-3">Duration</th>
                                                <th className="text-left px-4 py-3">Summary</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-ocean-ice/80">
                                            {contacts.map(c => (
                                                <tr key={c._id} onClick={() => setSelectedContact(c._id)}
                                                    className="hover:bg-ocean-powder cursor-pointer">
                                                    <td className="px-4 py-3">
                                                        <div className="font-medium text-ocean-navy">{c.name || '-'}</div>
                                                        {c.company && <div className="text-ocean-deep/80 text-xs">{c.company}</div>}
                                                    </td>
                                                    <td className="px-4 py-3 text-ocean-deep">{c.phone}</td>
                                                    <td className="px-4 py-3">
                                                        <span className={`font-medium ${CONTACT_STATUS_COLORS[c.status] || 'text-ocean-deep/90'}`}>
                                                            {c.status.replace('_', ' ')}
                                                        </span>
                                                        {c.dnc && <span className="ml-1 text-xs text-red-500">· DNC</span>}
                                                    </td>
                                                    <td className={`px-4 py-3 font-semibold ${scoreColor(c.leadScore)}`}>{fmtScore(c.leadScore)}</td>
                                                    <td className="px-4 py-3 text-ocean-deep/90">{c.attemptCount}</td>
                                                    <td className="px-4 py-3 text-ocean-deep/90">{fmtDuration(c.callDurationSec || 0)}</td>
                                                    <td className="px-4 py-3 text-ocean-deep/80 max-w-xs truncate">{c.aiSummary || '-'}</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            )}

                            {total > 20 && (
                                <div className="px-4 py-3 border-t border-ocean-ice/80 flex items-center justify-between text-sm text-ocean-deep/90">
                                    <span>Showing {(page - 1) * 20 + 1}-{Math.min(page * 20, total)} of {total}</span>
                                    <div className="flex gap-2">
                                        <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
                                            className="px-3 py-1 border rounded-lg disabled:opacity-40 hover:bg-ocean-powder">Prev</button>
                                        <button onClick={() => setPage(p => p + 1)} disabled={page * 20 >= total}
                                            className="px-3 py-1 border rounded-lg disabled:opacity-40 hover:bg-ocean-powder">Next</button>
                                    </div>
                                </div>
                            )}
                        </div>
                    )}

                    {pipelineTab === 'callbacks' && (
                        <div className="bg-white rounded-xl border border-ocean-ice overflow-hidden">
                            <div className="p-4 border-b border-ocean-ice/80">
                                <h3 className="font-semibold text-ocean-navy">Scheduled Callbacks</h3>
                                <p className="text-xs text-ocean-deep/80 mt-0.5">Contacts that asked to be called back. Dialer auto-picks these up once their scheduled time arrives.</p>
                            </div>
                            {callbacks.length === 0 ? (
                                <div className="p-10 text-center text-ocean-deep/80">
                                    <Clock className="h-8 w-8 text-gray-300 mx-auto mb-2" />
                                    No callbacks scheduled.
                                </div>
                            ) : (
                                <div className="overflow-x-auto">
                                    <table className="w-full text-sm">
                                        <thead>
                                            <tr className="bg-ocean-powder text-ocean-deep/80 text-xs uppercase tracking-wide">
                                                <th className="text-left px-4 py-3">When</th>
                                                <th className="text-left px-4 py-3">Contact</th>
                                                <th className="text-left px-4 py-3">Phone</th>
                                                <th className="text-left px-4 py-3">Reason</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-ocean-ice/80">
                                            {callbacks.map(c => (
                                                <tr key={c._id} onClick={() => setSelectedContact(c._id)}
                                                    className="hover:bg-ocean-powder cursor-pointer">
                                                    <td className="px-4 py-3 text-ocean-deep">
                                                        {c.callbackAt ? new Date(c.callbackAt).toLocaleString() : '-'}
                                                    </td>
                                                    <td className="px-4 py-3">
                                                        <div className="font-medium text-ocean-navy">{c.name || '-'}</div>
                                                        {c.company && <div className="text-ocean-deep/80 text-xs">{c.company}</div>}
                                                    </td>
                                                    <td className="px-4 py-3 text-ocean-deep">{c.phone}</td>
                                                    <td className="px-4 py-3 text-ocean-deep/80 max-w-md truncate">{c.callbackReason || '-'}</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            )}
                        </div>
                    )}

                    <div>
                        <p className="text-[11px] font-semibold uppercase tracking-wide text-ocean-deep/60 mb-2">Campaign setup</p>
                        <div className="grid grid-cols-2 gap-2 p-1.5 sm:grid-cols-4 bg-white rounded-xl border border-ocean-ice/80 shadow-sm">
                            {([
                                { k: 'overview' as SetupTab, label: 'Overview', Icon: LayoutDashboard },
                                { k: 'script' as SetupTab, label: 'Sales Script', Icon: ScrollText },
                                { k: 'conditions' as SetupTab, label: 'Targeting', Icon: Filter },
                                { k: 'ab-test' as SetupTab, label: 'A/B Test', Icon: FlaskConical },
                            ]).map(({ k, label, Icon }) => (
                                <button
                                    key={k}
                                    type="button"
                                    onClick={() => setSetupTab(k)}
                                    className={`flex flex-col items-center justify-center gap-1.5 min-h-[4rem] sm:min-h-[3.75rem] rounded-lg px-2 py-3 text-[11px] sm:text-xs font-semibold transition-colors leading-tight ${
                                        setupTab === k ? 'bg-ocean-deep text-white shadow-sm' : 'text-ocean-deep hover:bg-ocean-powder'
                                    }`}
                                >
                                    <Icon className={`h-[1.125rem] w-[1.125rem] shrink-0 sm:h-5 sm:w-5 ${setupTab === k ? 'text-white' : 'text-ocean-deep'}`} aria-hidden />
                                    <span className="text-center">{label}</span>
                                </button>
                            ))}
                        </div>
                    </div>
                </div>

                {setupTab === 'overview' && (
                    <CampaignOverviewSection
                        campaign={campaign}
                        token={token}
                        onRefetch={async () => {
                            await fetchCampaign();
                        }}
                    />
                )}

                {setupTab === 'script' && (
                    <ScriptPlaybookTab
                        campaign={campaign}
                        token={token}
                        onSaved={async () => {
                            await fetchCampaign();
                            await fetchKpis();
                        }}
                    />
                )}

                {setupTab === 'conditions' && (
                    <ConditionsTab campaign={campaign} token={token} onSaved={c => setCampaign(c)} />
                )}

                {setupTab === 'ab-test' && (
                    <AbTestTab campaign={campaign} token={token} onSaved={c => setCampaign(c)} />
                )}
            </div>

            {sampleCsvOpen && (
                <div
                    className="fixed inset-0 z-[60] flex items-center justify-center bg-black/45 p-4"
                    role="dialog"
                    aria-modal="true"
                    aria-labelledby="sample-csv-title"
                    onClick={(e) => {
                        if (e.target === e.currentTarget) setSampleCsvOpen(false);
                    }}
                >
                    <div className="max-h-[90vh] w-full max-w-3xl overflow-hidden rounded-2xl border border-ocean-ice bg-white shadow-2xl">
                        <div className="flex items-center justify-between gap-3 border-b border-ocean-ice px-5 py-4">
                            <h2 id="sample-csv-title" className="text-lg font-semibold text-ocean-navy">
                                CSV format examples
                            </h2>
                            <button
                                type="button"
                                onClick={() => setSampleCsvOpen(false)}
                                className="rounded-lg p-2 text-ocean-deep/70 hover:bg-ocean-powder hover:text-ocean-navy"
                                aria-label="Close"
                            >
                                <X className="h-5 w-5" />
                            </button>
                        </div>
                        <div className="max-h-[min(78vh,720px)] space-y-5 overflow-auto p-5 sm:p-6">
                            <p className="text-sm text-ocean-deep/90">
                                Goal{' '}
                                <span className="font-semibold text-ocean-navy">{GOAL_LABELS[campaign.goal] || campaign.goal}</span>
                                . Below is how rows look in a spreadsheet; your file is the same data saved as <span className="font-medium">.csv</span> (comma-separated).
                            </p>
                            {buildSampleCsvSections(campaign).map((section) => (
                                <div key={section.title} className="rounded-xl border border-ocean-ice/90 bg-ocean-mist/20 p-4 sm:p-5">
                                    <h3 className="text-xs font-semibold uppercase tracking-wide text-ocean-deep/75">{section.title}</h3>
                                    <ul className="mt-3 list-disc space-y-2 pl-4 text-[13px] leading-relaxed text-ocean-deep/90">
                                        {section.bullets.map((b) => (
                                            <li key={b}>{b}</li>
                                        ))}
                                    </ul>
                                    <p className="mt-4 text-[11px] font-medium uppercase tracking-wide text-ocean-deep/55">Spreadsheet preview</p>
                                    <div className="mt-2 overflow-x-auto rounded-lg bg-white shadow-inner ring-1 ring-ocean-ice/70">
                                        <table className="w-full min-w-[280px] border-collapse text-left text-sm">
                                            <thead>
                                                <tr className="border-b border-ocean-ice bg-ocean-powder/90 text-xs uppercase tracking-wide text-ocean-deep/80">
                                                    {section.headers.map((h) => (
                                                        <th key={h} className="whitespace-nowrap px-3 py-2.5 font-semibold sm:px-4">
                                                            {h}
                                                        </th>
                                                    ))}
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {section.rows.map((row, ri) => (
                                                    <tr key={ri} className="border-b border-ocean-ice/60 last:border-0">
                                                        {row.map((cell, ci) => (
                                                            <td key={ci} className="max-w-[14rem] px-3 py-2.5 text-ocean-deep sm:max-w-none sm:px-4">
                                                                <span className="break-words">{cell}</span>
                                                            </td>
                                                        ))}
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            )}

            {csvPreviewOpen && (
                <div
                    className="fixed inset-0 z-[60] flex items-center justify-center bg-black/45 p-4"
                    role="dialog"
                    aria-modal="true"
                    aria-labelledby="csv-preview-title"
                    onClick={(e) => {
                        if (e.target === e.currentTarget) setCsvPreviewOpen(false);
                    }}
                >
                    <div className="flex max-h-[min(90vh,900px)] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-ocean-ice bg-white shadow-2xl">
                        <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-ocean-ice px-5 py-4">
                            <h2 id="csv-preview-title" className="text-lg font-semibold text-ocean-navy">
                                Preview CSV export
                            </h2>
                            <button
                                type="button"
                                onClick={() => setCsvPreviewOpen(false)}
                                className="rounded-lg p-2 text-ocean-deep/70 hover:bg-ocean-powder hover:text-ocean-navy"
                                aria-label="Close preview"
                            >
                                <X className="h-5 w-5" />
                            </button>
                        </div>
                        <div className="shrink-0 space-y-3 border-b border-ocean-ice/80 bg-ocean-mist/30 px-5 py-3">
                            <div className="flex flex-wrap gap-2">
                                <button
                                    type="button"
                                    disabled={csvPreviewLoading}
                                    onClick={() => void loadCsvPreview('all')}
                                    className={`rounded-lg px-3 py-2 text-xs font-semibold transition sm:text-sm ${
                                        csvPreviewKind === 'all'
                                            ? 'bg-ocean-deep text-white shadow-sm'
                                            : 'border border-ocean-ice bg-white text-ocean-deep hover:bg-white/80'
                                    }`}
                                >
                                    All contacts
                                </button>
                                <button
                                    type="button"
                                    disabled={csvPreviewLoading}
                                    onClick={() => void loadCsvPreview('hot')}
                                    className={`rounded-lg px-3 py-2 text-xs font-semibold transition sm:text-sm ${
                                        csvPreviewKind === 'hot'
                                            ? 'bg-ocean-deep text-white shadow-sm'
                                            : 'border border-ocean-ice bg-white text-ocean-deep hover:bg-white/80'
                                    }`}
                                >
                                    Hot leads
                                </button>
                            </div>
                            <p className="text-xs leading-relaxed text-ocean-deep/85">
                                {csvPreviewKind === 'all' ? (
                                    <>
                                        Same dataset as{' '}
                                        <span className="font-semibold text-ocean-navy">Contacts CSV</span>
                                        - every contact in this campaign with statuses, scores, BANT, summaries, etc. Live preview only; use the download button for a saved file.
                                    </>
                                ) : (
                                    <>
                                        Same dataset as{' '}
                                        <span className="font-semibold text-ocean-navy">Hot leads CSV</span>
                                        - contacts marked interested or callback. Not a separate &quot;saved&quot; CSV: the campaign exposes these two exports; this modal lets you read either one before downloading.
                                    </>
                                )}
                            </p>
                        </div>
                        <div className="relative min-h-0 flex-1 overflow-auto p-4">
                            {csvPreviewLoading && (
                                <div className="absolute inset-0 z-[1] flex items-center justify-center bg-white/70 text-sm font-medium text-ocean-deep">
                                    Loading…
                                </div>
                            )}
                            <pre className="whitespace-pre font-mono text-[11px] leading-relaxed text-ocean-deep">{csvPreviewText}</pre>
                        </div>
                    </div>
                </div>
            )}

            {selectedContact && (
                <ContactDetailModal
                    campaignId={campaign._id}
                    contactId={selectedContact}
                    token={token}
                    onClose={() => setSelectedContact(null)}
                    onUpdate={() => {
                        fetchCampaign();
                        fetchKpis();
                        fetchContacts(page, statusFilter, searchQ);
                        fetchHotLeads();
                        fetchCallbacks();
                    }}
                />
            )}
        </div>
    );
}
