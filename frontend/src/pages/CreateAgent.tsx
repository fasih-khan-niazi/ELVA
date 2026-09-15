import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { PageBackNav } from '../components/PageBackNav';
import {
    MessageSquare, Mic, Upload, Check, AlertCircle,
    Phone, X, FileText, AlertTriangle, ChevronDown, ChevronUp,
} from 'lucide-react';
import SetupMethodSelector, { SetupMethod } from '../components/agent/SetupMethodSelector';
import AIQuickSetup, { GeneratedConfig } from '../components/agent/AIQuickSetup';
import TemplateSelector, { TemplateConfig } from '../components/agent/TemplateSelector';
import ManualSetupForm, { ManualFormState } from '../components/agent/ManualSetupForm';
import FieldWithHistory from '../components/agent/FieldWithHistory';
import VoicePicker from '../components/agent/VoicePicker';
import { useToast } from '../components/Toast';
import AnimatedPage from '../components/AnimatedPage';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3000';

interface DocQuota { remaining: number; used: number; limit: number; }

const inputCls = 'w-full px-4 py-2 border border-ocean-ice rounded-lg focus:ring-2 focus:ring-ocean-bright/80 focus:border-ocean-deep outline-none transition-all bg-white';
const textareaCls = `${inputCls} resize-none`;

function formatBytes(bytes: number) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function CreateAgent() {
    const { token } = useAuth();
    const navigate = useNavigate();
    const toast = useToast();
    const fileInputRef = useRef<HTMLInputElement>(null);

    // ── Agent type (Step 1) ───────────────────────────────────────────────
    const [type, setType] = useState<'chat' | 'voice'>('chat');
    const [callDirection, setCallDirection] = useState<'inbound' | 'outbound'>('inbound');
    const [phoneNumber, setPhoneNumber] = useState('');
    const [outboundCallerId, setOutboundCallerId] = useState('');
    const [transferNumber, setTransferNumber] = useState('');
    const [sttProvider] = useState<'twilio'>('twilio');
    const [ttsProvider] = useState<'twilio'>('twilio');
    const [ttsVoice, setTtsVoice] = useState('en-US-JennyNeural');

    // ── Setup method (Step 2) ─────────────────────────────────────────────
    const [setupMethod, setSetupMethod] = useState<SetupMethod | null>(null);

    // ── Shared form fields (filled by AI / Template / Manual) ────────────
    const [name, setName] = useState('');
    const [businessName, setBusinessName] = useState('');
    const [tone, setTone] = useState('professional');
    const [language, setLanguage] = useState('en');
    const [currency, setCurrency] = useState('USD');
    const [firstMessage, setFirstMessage] = useState('');
    const [personaName, setPersonaName] = useState('');
    const [personaSummary, setPersonaSummary] = useState('');
    const [speakingStyle, setSpeakingStyle] = useState('');
    const [objectivesInput, setObjectivesInput] = useState('');
    const [capabilitiesInput, setCapabilitiesInput] = useState('');
    const [guardrails, setGuardrails] = useState('');
    const [prompt, setPrompt] = useState('');
    const [temperature, setTemperature] = useState(0.35);
    const [memoryWindow, setMemoryWindow] = useState(8);
    const [longTermMemory, setLongTermMemory] = useState(false);
    const [maxTurns, setMaxTurns] = useState(30);
    const [fallbackMessage, setFallbackMessage] = useState('I am going to connect you with one of my teammates for more help.');

    // ── Manual setup 3-step state ─────────────────────────────────────────
    const [manualStep, setManualStep] = useState<1 | 2 | 3>(1);

    // ── AI/Template review phase ──────────────────────────────────────────
    const [showReview, setShowReview] = useState(false);
    const [reviewAdvancedOpen, setReviewAdvancedOpen] = useState(false);

    // ── KB files ──────────────────────────────────────────────────────────
    const [files, setFiles] = useState<File[]>([]);
    const [docQuota, setDocQuota] = useState<DocQuota | null>(null);
    const [uploading, setUploading] = useState(false);

    // ── Confirmation modal ────────────────────────────────────────────────
    const [showConfirm, setShowConfirm] = useState(false);

    // ── UI ────────────────────────────────────────────────────────────────
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    useEffect(() => {
        fetch(`${API_BASE}/api/upload/remaining`, {
            headers: { Authorization: `Bearer ${token}` },
        })
            .then((r) => (r.ok ? r.json() : null))
            .then((d) => d && setDocQuota(d))
            .catch(() => {});
    }, [token]);

    // ── Helpers to fill all form fields from AI or template data ─────────

    const applyGeneratedConfig = (cfg: GeneratedConfig) => {
        setName(cfg.agentName || '');
        setBusinessName(cfg.businessName || '');
        setTone(cfg.tone || 'professional');
        setFirstMessage(cfg.firstMessage || '');
        setPersonaName(cfg.personaName || '');
        setPersonaSummary(cfg.personaSummary || '');
        setSpeakingStyle(cfg.speakingStyle || '');
        setObjectivesInput((cfg.objectives || []).join('\n'));
        setCapabilitiesInput((cfg.capabilities || []).join('\n'));
        setGuardrails(cfg.guardrails || '');
        setPrompt(cfg.systemPrompt || '');
        setTemperature(cfg.temperature ?? 0.35);
        setFallbackMessage(cfg.fallbackMessage || fallbackMessage);
        setShowReview(true);
    };

    const applyTemplate = (t: TemplateConfig) => {
        setTone(t.tone || 'professional');
        setLanguage(t.language || 'en');
        setCurrency(t.currency || 'USD');
        setFirstMessage(t.firstMessage || '');
        setPersonaName(t.persona?.name || '');
        setPersonaSummary(t.persona?.summary || '');
        setSpeakingStyle(t.persona?.speakingStyle || '');
        setObjectivesInput((t.objectives || []).join('\n'));
        setCapabilitiesInput((t.capabilities || []).join('\n'));
        setGuardrails(t.guardrails || '');
        setPrompt(t.prompt || '');
        setTemperature(t.responseConfig?.temperature ?? 0.35);
        setMaxTurns(t.responseConfig?.maxTurns ?? 30);
        setFallbackMessage(t.responseConfig?.fallbackMessage || fallbackMessage);
        setMemoryWindow(t.memoryConfig?.shortTermWindow ?? 8);
        setLongTermMemory(t.memoryConfig?.longTermEnabled ?? false);
        setShowReview(true);
    };

    const manualFormState: ManualFormState = {
        name, businessName, tone, language, currency, firstMessage,
        personaName, speakingStyle, personaSummary, objectivesInput,
        capabilitiesInput, guardrails, prompt, temperature, memoryWindow,
        longTermMemory, maxTurns, fallbackMessage,
    };

    const setManualFormState = (patch: Partial<ManualFormState>) => {
        if ('name' in patch) setName(patch.name!);
        if ('businessName' in patch) setBusinessName(patch.businessName!);
        if ('tone' in patch) setTone(patch.tone!);
        if ('language' in patch) setLanguage(patch.language!);
        if ('currency' in patch) setCurrency(patch.currency!);
        if ('firstMessage' in patch) setFirstMessage(patch.firstMessage!);
        if ('personaName' in patch) setPersonaName(patch.personaName!);
        if ('speakingStyle' in patch) setSpeakingStyle(patch.speakingStyle!);
        if ('personaSummary' in patch) setPersonaSummary(patch.personaSummary!);
        if ('objectivesInput' in patch) setObjectivesInput(patch.objectivesInput!);
        if ('capabilitiesInput' in patch) setCapabilitiesInput(patch.capabilitiesInput!);
        if ('guardrails' in patch) setGuardrails(patch.guardrails!);
        if ('prompt' in patch) setPrompt(patch.prompt!);
        if ('temperature' in patch) setTemperature(patch.temperature!);
        if ('memoryWindow' in patch) setMemoryWindow(patch.memoryWindow!);
        if ('longTermMemory' in patch) setLongTermMemory(patch.longTermMemory!);
        if ('maxTurns' in patch) setMaxTurns(patch.maxTurns!);
        if ('fallbackMessage' in patch) setFallbackMessage(patch.fallbackMessage!);
    };

    // ── KB file handling ─────────────────────────────────────────────────

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (!e.target.files) return;
        const newFiles = Array.from(e.target.files);
        setFiles((prev) => {
            const existing = new Set(prev.map((f) => f.name + f.size));
            return [...prev, ...newFiles.filter((f) => !existing.has(f.name + f.size))];
        });
        e.target.value = '';
    };

    const removeFile = (i: number) => setFiles((prev) => prev.filter((_, idx) => idx !== i));

    // ── Submit ────────────────────────────────────────────────────────────

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');
        if (!name.trim()) { setError('Agent name is required.'); return; }
        if (files.length > 0) {
            if (docQuota && docQuota.limit !== -1 && files.length > docQuota.remaining) {
                setError(`You selected ${files.length} file(s) but only have ${docQuota.remaining} upload(s) remaining.`);
                return;
            }
            setShowConfirm(true);
        } else {
            await doCreateAgent();
        }
    };

    const doCreateAgent = async () => {
        setShowConfirm(false);
        setLoading(true);
        try {
            const objectives = objectivesInput.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
            const capabilities = capabilitiesInput.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

            const agentRes = await fetch(`${API_BASE}/api/agents`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                body: JSON.stringify({
                    name,
                    businessName,
                    type,
                    tone,
                    language,
                    currency,
                    firstMessage,
                    prompt,
                    persona: { name: personaName || name, summary: personaSummary, speakingStyle: speakingStyle || tone },
                    objectives,
                    capabilities,
                    guardrails,
                    memoryConfig: { shortTermWindow: Number(memoryWindow) || 8, longTermEnabled: longTermMemory },
                    responseConfig: { temperature, maxTurns, fallbackMessage },
                    ...(type === 'voice' ? {
                        callDirection,
                        phoneNumber: callDirection === 'inbound' ? phoneNumber : '',
                        outboundCallerId: callDirection === 'outbound' ? outboundCallerId : '',
                        transferNumber,
                        sttProvider,
                        ttsProvider,
                        ttsVoice,
                    } : {}),
                }),
            });

            if (!agentRes.ok) {
                const err = await agentRes.json().catch(() => ({ message: 'Unknown error' }));
                throw new Error(err.message || 'Failed to create agent');
            }

            const agentData = await agentRes.json();

            if (files.length > 0) {
                setUploading(true);
                const fd = new FormData();
                files.forEach((f) => fd.append('files', f));
                fd.append('agentId', agentData._id);
                const uploadRes = await fetch(`${API_BASE}/api/upload/pdf`, {
                    method: 'POST',
                    headers: { Authorization: `Bearer ${token}` },
                    body: fd,
                });
                if (!uploadRes.ok) {
                    const upErr = await uploadRes.json().catch(() => ({}));
                    const msg = upErr.message || upErr.error || 'Unknown error';
                    toast.warning('Agent created, but upload failed', msg);
                    setError(`Agent created, but KB upload failed: ${msg}`);
                    setLoading(false);
                    setUploading(false);
                    return;
                }
            }

            toast.success('Agent created');
            navigate(`/dashboard?setupMenu=${agentData._id}`);
        } catch (err: any) {
            const msg = err.message || 'Error creating agent';
            setError(msg);
            toast.error('Could not create agent', msg);
        } finally {
            setLoading(false);
            setUploading(false);
        }
    };

    const remainingAfterUpload = docQuota
        ? (docQuota.limit === -1 ? -1 : docQuota.remaining - files.length)
        : null;

    // ── Render review / common KB section ────────────────────────────────

    const renderKBSection = () => (
        <section>
            <div className="flex items-center justify-between mb-2">
                <h3 className="text-base font-semibold text-ocean-navy">Knowledge Base (PDF files)</h3>
                {docQuota && (
                    <span className={`text-xs font-medium px-2 py-1 rounded-full ${
                        docQuota.limit === -1 ? 'bg-green-50 text-green-700' :
                        docQuota.remaining <= 0 ? 'bg-red-50 text-red-700' :
                        docQuota.remaining <= 5 ? 'bg-amber-50 text-amber-700' :
                        'bg-ocean-powder text-ocean-deep'
                    }`}>
                        {docQuota.limit === -1 ? 'Unlimited uploads' : `${docQuota.remaining} upload${docQuota.remaining !== 1 ? 's' : ''} remaining`}
                    </span>
                )}
            </div>
            <div
                className="border-2 border-dashed border-ocean-ice rounded-xl p-5 text-center hover:bg-ocean-mist/50 transition-colors cursor-pointer"
                onClick={() => fileInputRef.current?.click()}
            >
                <input ref={fileInputRef} type="file" accept=".pdf" multiple onChange={handleFileChange} className="hidden" aria-label="Upload knowledge base PDF files" />
                <Upload className="h-5 w-5 text-ocean-deep mx-auto mb-1" />
                <p className="text-sm text-ocean-deep font-medium">Click to select PDF files</p>
                <p className="text-xs text-ocean-deep/60">FAQs, policies, product catalogs…</p>
            </div>
            {files.length > 0 && (
                <div className="mt-2 space-y-1">
                    {files.map((f, i) => (
                        <div key={i} className="flex items-center justify-between bg-ocean-powder border border-ocean-ice rounded-lg px-3 py-2">
                            <div className="flex items-center gap-2 min-w-0">
                                <FileText className="h-4 w-4 text-ocean-deep shrink-0" />
                                <span className="text-sm text-ocean-deep truncate">{f.name}</span>
                                <span className="text-xs text-ocean-deep/60 shrink-0">{formatBytes(f.size)}</span>
                            </div>
                            <button type="button" aria-label="Remove file" title="Remove file" onClick={(e) => { e.stopPropagation(); removeFile(i); }} className="p-1 text-ocean-deep/60 hover:text-red-500 transition-colors"><X className="h-4 w-4" /></button>
                        </div>
                    ))}
                    {docQuota && docQuota.limit !== -1 && files.length > docQuota.remaining && (
                        <div className="flex items-center gap-2 p-2 bg-red-50 border border-red-200 rounded-lg text-red-700 text-xs">
                            <AlertTriangle className="h-4 w-4 shrink-0" />
                            You've selected {files.length} files but only have {docQuota.remaining} remaining.
                        </div>
                    )}
                </div>
            )}
            {uploading && <p className="text-sm text-ocean-deep mt-2 text-center">Uploading knowledge base files…</p>}
        </section>
    );

    const renderSubmitButton = () => (
        <div className="pt-6 flex justify-end items-center space-x-4 border-t border-ocean-ice">
            <button type="button" onClick={() => navigate('/dashboard')} className="px-6 py-2.5 border border-ocean-ice text-ocean-deep rounded-lg hover:bg-ocean-powder font-medium transition-colors">
                Cancel
            </button>
            <button
                type="submit"
                disabled={loading || (docQuota !== null && docQuota.limit !== -1 && files.length > docQuota.remaining)}
                className="px-8 py-2.5 bg-ocean-deep text-white rounded-lg hover:bg-ocean-rich disabled:opacity-50 disabled:cursor-not-allowed font-medium shadow-sm transition-all flex items-center"
            >
                {loading ? (
                    <><div className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent mr-2" />{uploading ? 'Uploading…' : 'Creating…'}</>
                ) : 'Create Agent'}
            </button>
        </div>
    );

    // ── Review form (after AI Quick Setup or Template) ────────────────────

    const renderReviewForm = () => (
        <div className="space-y-6">
            <div className="p-4 bg-ocean-powder border border-ocean-ice rounded-xl text-sm text-ocean-navy">
                <strong>Review your agent settings.</strong> All fields are pre-filled for you. Change anything you like, then click Create Agent.
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                <div className="col-span-2">
                    <label htmlFor="r-name" className="block text-sm font-medium text-ocean-deep mb-1">Agent Name <span className="text-red-500">*</span></label>
                    <input id="r-name" name="agentName" type="text" autoComplete="organization" value={name} onChange={(e) => setName(e.target.value)} className={inputCls} placeholder="e.g., Support Bot" required />
                </div>
                <div className="col-span-2">
                    <label htmlFor="r-businessName" className="block text-sm font-medium text-ocean-deep mb-1">Business Name</label>
                    <input id="r-businessName" name="businessName" type="text" autoComplete="organization" value={businessName} onChange={(e) => setBusinessName(e.target.value)} className={inputCls} placeholder="e.g., TastyFood, Acme Corp" />
                </div>
                <div>
                    <label htmlFor="r-tone" className="block text-sm font-medium text-ocean-deep mb-1">Tone</label>
                    <select id="r-tone" value={tone} onChange={(e) => setTone(e.target.value)} className={inputCls + ' bg-white'}>
                        <option value="professional">Professional</option>
                        <option value="friendly">Friendly</option>
                        <option value="empathetic">Empathetic</option>
                        <option value="humorous">Humorous</option>
                    </select>
                </div>
                <div>
                    <label htmlFor="r-currency" className="block text-sm font-medium text-ocean-deep mb-1">Currency</label>
                    <select id="r-currency" value={currency} onChange={(e) => setCurrency(e.target.value)} className={inputCls + ' bg-white'}>
                        <option value="USD">USD ($)</option>
                        <option value="PKR">PKR (Rs.)</option>
                        <option value="EUR">EUR (€)</option>
                        <option value="GBP">GBP (£)</option>
                        <option value="INR">INR (₹)</option>
                        <option value="AED">AED (AED)</option>
                        <option value="SAR">SAR (SAR)</option>
                        <option value="CAD">CAD (C$)</option>
                        <option value="AUD">AUD (A$)</option>
                    </select>
                </div>
                <div className="col-span-2">
                    <label htmlFor="r-firstMessage" className="block text-sm font-medium text-ocean-deep mb-1">
                        First Message (Greeting)
                        <span className="ml-1 text-xs text-ocean-deep/60">- sent verbatim when chat starts</span>
                    </label>
                    <input id="r-firstMessage" name="firstMessage" type="text" autoComplete="off" value={firstMessage} onChange={(e) => setFirstMessage(e.target.value)} className={inputCls} placeholder="e.g., Hello! How can I help you today?" />
                </div>
            </div>

            {/* Advanced toggle */}
            <button
                type="button"
                onClick={() => setReviewAdvancedOpen((v) => !v)}
                className="flex items-center gap-2 text-sm font-medium text-ocean-deep hover:text-ocean-navy transition-colors"
            >
                {reviewAdvancedOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                {reviewAdvancedOpen ? 'Hide advanced settings' : 'Show advanced settings (persona, objectives, guardrails, system prompt…)'}
            </button>

            {reviewAdvancedOpen && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-5 p-5 bg-ocean-powder rounded-xl border border-ocean-ice">
                    <div>
                        <label className="block text-sm font-medium text-ocean-deep mb-1">Persona Name</label>
                        <input name="personaName" type="text" value={personaName} onChange={(e) => setPersonaName(e.target.value)} className={inputCls} placeholder="e.g., Aurora, Max" />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-ocean-deep mb-1">Speaking Style</label>
                        <input name="speakingStyle" type="text" value={speakingStyle} onChange={(e) => setSpeakingStyle(e.target.value)} className={inputCls} placeholder="e.g., warm, concise" />
                    </div>
                    <div className="col-span-2">
                        <label className="block text-sm font-medium text-ocean-deep mb-1">Persona Summary</label>
                        <FieldWithHistory fieldKey="personaSummary" value={personaSummary} onChange={setPersonaSummary} rows={5} placeholder="Describe your agent's background and role" className={textareaCls} autoGrow maxAutoHeightPx={320} />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-ocean-deep mb-1">Primary Objectives <span className="text-xs text-ocean-deep/60">(one per line)</span></label>
                        <FieldWithHistory fieldKey="objectives" value={objectivesInput} onChange={setObjectivesInput} rows={5} placeholder={`Convert inbound leads\nResolve support tickets`} className={textareaCls} autoGrow maxAutoHeightPx={280} />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-ocean-deep mb-1">Capabilities <span className="text-xs text-ocean-deep/60">(one per line)</span></label>
                        <FieldWithHistory fieldKey="capabilities" value={capabilitiesInput} onChange={setCapabilitiesInput} rows={5} placeholder={`Answer pricing questions\nBook demos`} className={textareaCls} autoGrow maxAutoHeightPx={280} />
                    </div>
                    <div className="col-span-2">
                        <label className="block text-sm font-medium text-ocean-deep mb-1">Guardrails & Escalation Policy</label>
                        <FieldWithHistory fieldKey="guardrails" value={guardrails} onChange={setGuardrails} rows={4} placeholder="Forbidden topics, escalation triggers…" className={textareaCls} autoGrow maxAutoHeightPx={300} />
                    </div>
                    <div className="col-span-2">
                        <label className="block text-sm font-medium text-ocean-deep mb-1">System Prompt <span className="text-xs text-ocean-deep/60">- leave blank to auto-generate</span></label>
                        <FieldWithHistory fieldKey="systemPrompt" value={prompt} onChange={setPrompt} rows={6} placeholder="Describe the agent's role and constraints…" className={textareaCls} autoGrow maxAutoHeightPx={400} />
                    </div>
                    <div>
                        <label htmlFor="adv-temperature" className="block text-sm font-medium text-ocean-deep mb-1">Creativity (Temperature)</label>
                        <input id="adv-temperature" title="Creativity temperature" type="range" min={0} max={1} step={0.05} value={temperature} onChange={(e) => setTemperature(parseFloat(e.target.value))} className="w-full" />
                        <div className="flex justify-between text-xs text-ocean-deep/60 mt-1"><span>Precise</span><span className="font-medium text-ocean-deep">{temperature.toFixed(2)}</span><span>Creative</span></div>
                    </div>
                    <div>
                        <label htmlFor="adv-memoryWindow" className="block text-sm font-medium text-ocean-deep mb-1">Memory Window (turns)</label>
                        <input id="adv-memoryWindow" title="Memory window" type="number" min={2} max={20} value={memoryWindow} onChange={(e) => setMemoryWindow(parseInt(e.target.value, 10) || 8)} className={inputCls} />
                    </div>
                    <div>
                        <label htmlFor="adv-maxTurns" className="block text-sm font-medium text-ocean-deep mb-1">Max Conversation Turns</label>
                        <input id="adv-maxTurns" title="Max conversation turns" type="number" min={1} max={100} value={maxTurns} onChange={(e) => setMaxTurns(parseInt(e.target.value, 10) || 30)} className={inputCls} />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-ocean-deep mb-1">Fallback Message</label>
                        <FieldWithHistory fieldKey="fallbackMessage" value={fallbackMessage} onChange={setFallbackMessage} rows={3} placeholder="Message when agent cannot help…" className={textareaCls} autoGrow maxAutoHeightPx={200} />
                    </div>
                </div>
            )}
        </div>
    );

    // ── Voice config section (shown in Step 1 when voice is selected) ─────

    const renderVoiceConfig = () => (
        <>
            <hr className="border-ocean-ice" />
            <section>
                <h3 className="text-lg font-semibold text-ocean-navy mb-4 flex items-center">
                    <Phone className="h-5 w-5 mr-2 text-ocean-deep" />
                    Voice Configuration
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="col-span-2">
                        <label className="block text-sm font-medium text-ocean-deep mb-2">Call Direction</label>
                        <div className="grid grid-cols-2 gap-3">
                            <button type="button" onClick={() => setCallDirection('inbound')} className={`px-4 py-3 rounded-lg border-2 text-sm font-medium transition-all ${callDirection === 'inbound' ? 'border-ocean-deep bg-ocean-powder text-ocean-deep' : 'border-ocean-ice text-ocean-deep hover:border-ocean-bright/50'}`}>Inbound</button>
                            <button type="button" onClick={() => setCallDirection('outbound')} className={`px-4 py-3 rounded-lg border-2 text-sm font-medium transition-all ${callDirection === 'outbound' ? 'border-ocean-deep bg-ocean-powder text-ocean-deep' : 'border-ocean-ice text-ocean-deep hover:border-ocean-bright/50'}`}>Outbound</button>
                        </div>
                    </div>
                    {callDirection === 'inbound' && (
                        <div className="col-span-2">
                            <label htmlFor="phoneNumber" className="block text-sm font-medium text-ocean-deep mb-1">Twilio Phone Number</label>
                            <input type="text" id="phoneNumber" name="phoneNumber" value={phoneNumber} onChange={(e) => setPhoneNumber(e.target.value)} className={inputCls} placeholder="e.g., +14155551234" />
                            <p className="text-xs text-ocean-deep/60 mt-1">The Twilio number mapped to this agent (E.164).</p>
                        </div>
                    )}
                    {callDirection === 'outbound' && (
                        <>
                            <div className="col-span-2">
                                <label htmlFor="outboundCallerId" className="block text-sm font-medium text-ocean-deep mb-1">Outbound Caller ID</label>
                                <input type="text" id="outboundCallerId" name="outboundCallerId" value={outboundCallerId} onChange={(e) => setOutboundCallerId(e.target.value)} className={inputCls} placeholder="e.g., +14155551234" />
                            </div>
                            <div className="col-span-2">
                                <label htmlFor="transferNumber" className="block text-sm font-medium text-ocean-deep mb-1">Transfer-to Number</label>
                                <input type="text" id="transferNumber" name="transferNumber" value={transferNumber} onChange={(e) => setTransferNumber(e.target.value)} className={inputCls} placeholder="e.g., +12025550100" />
                            </div>
                        </>
                    )}
                    <VoicePicker token={token} value={ttsVoice} onChange={setTtsVoice} />
                </div>
            </section>
        </>
    );

    // ── Main render ───────────────────────────────────────────────────────

    return (
        <AnimatedPage className="bg-white pb-12">
            <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6 lg:px-8">
                <PageBackNav to="/dashboard" label="Back to Dashboard" />

                <div className="overflow-hidden rounded-2xl border border-ocean-ice bg-white shadow-ocean-card">
                    <div className="border-b border-ocean-ice bg-gradient-to-r from-ocean-powder/80 via-white to-ocean-mist/30 p-8">
                        <h1 className="text-2xl font-bold text-ocean-navy">Create New Agent</h1>
                        <p className="mt-1 text-ocean-deep">Set up your AI agent in minutes - choose the method that works for you.</p>
                    </div>

                    {error && (
                        <div className="mx-8 mt-6 p-4 bg-red-50 border border-red-200 rounded-lg flex items-center text-red-700">
                            <AlertCircle className="h-5 w-5 mr-2 shrink-0" />
                            {error}
                        </div>
                    )}

                    <form onSubmit={handleSubmit} className="p-8 space-y-8">

                        {/* Step 1: Agent Type */}
                        <section>
                            <h3 className="text-lg font-semibold text-ocean-navy mb-4">1. Choose Agent Type</h3>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <button type="button" onClick={() => setType('chat')} className={`p-6 rounded-xl border-2 flex items-start space-x-4 transition-all ${type === 'chat' ? 'border-ocean-deep bg-ocean-powder ring-1 ring-ocean-deep' : 'border-ocean-ice hover:border-ocean-bright/50 hover:bg-ocean-powder'}`}>
                                    <div className={`p-3 rounded-lg ${type === 'chat' ? 'bg-ocean-deep text-white' : 'bg-white border border-ocean-ice text-ocean-deep/80'}`}><MessageSquare className="h-6 w-6" /></div>
                                    <div className="text-left">
                                        <div className={`font-semibold text-lg ${type === 'chat' ? 'text-ocean-navy' : 'text-ocean-navy'}`}>Chat Agent</div>
                                        <p className="text-sm text-ocean-deep/80 mt-1">Best for customer support, Q&A, and text-based assistance.</p>
                                    </div>
                                    {type === 'chat' && <div className="ml-auto text-ocean-deep"><Check className="h-5 w-5" /></div>}
                                </button>
                                <button type="button" onClick={() => setType('voice')} className={`p-6 rounded-xl border-2 flex items-start space-x-4 transition-all ${type === 'voice' ? 'border-ocean-deep bg-ocean-powder ring-1 ring-ocean-deep' : 'border-ocean-ice hover:border-ocean-bright/50 hover:bg-ocean-powder'}`}>
                                    <div className={`p-3 rounded-lg ${type === 'voice' ? 'bg-ocean-deep text-white' : 'bg-white border border-ocean-ice text-ocean-deep/80'}`}><Mic className="h-6 w-6" /></div>
                                    <div className="text-left">
                                        <div className={`font-semibold text-lg ${type === 'voice' ? 'text-ocean-navy' : 'text-ocean-navy'}`}>Voice Agent</div>
                                        <p className="text-sm text-ocean-deep/80 mt-1">Best for phone calls, voice commands, and audio interactions.</p>
                                    </div>
                                    {type === 'voice' && <div className="ml-auto text-ocean-deep"><Check className="h-5 w-5" /></div>}
                                </button>
                            </div>
                        </section>

                        {/* Voice config - shown immediately under Step 1 when voice selected */}
                        {type === 'voice' && renderVoiceConfig()}

                        <hr className="border-ocean-ice" />

                        {/* Step 2: Setup Method */}
                        <SetupMethodSelector value={setupMethod} onChange={(m) => {
                            setSetupMethod(m);
                            setShowReview(false);
                            setManualStep(1);
                        }} />

                        {/* Step 3: Setup content */}
                        {setupMethod && (
                            <>
                                <hr className="border-ocean-ice" />

                                {/* AI Quick Setup */}
                                {setupMethod === 'ai' && !showReview && (
                                    <AIQuickSetup
                                        agentType={type}
                                        callDirection={callDirection}
                                        token={token!}
                                        apiBase={API_BASE}
                                        onGenerated={applyGeneratedConfig}
                                    />
                                )}

                                {/* Template Selector */}
                                {setupMethod === 'template' && !showReview && (
                                    <TemplateSelector
                                        agentType={type}
                                        callDirection={callDirection}
                                        token={token!}
                                        apiBase={API_BASE}
                                        onSelected={applyTemplate}
                                    />
                                )}

                                {/* Manual Setup - 3-step form (includes KB) */}
                                {setupMethod === 'manual' && (
                                    <>
                                        <ManualSetupForm
                                            form={manualFormState}
                                            onChange={setManualFormState}
                                            step={manualStep}
                                            onStepChange={setManualStep}
                                            files={files}
                                            onFilesChange={setFiles}
                                            docQuota={docQuota}
                                        />
                                        {manualStep === 3 && (
                                            <>
                                                <hr className="border-ocean-ice" />
                                                {renderSubmitButton()}
                                            </>
                                        )}
                                    </>
                                )}

                                {/* Review form - shown after AI / Template */}
                                {(setupMethod === 'ai' || setupMethod === 'template') && showReview && (
                                    <>
                                        {renderReviewForm()}
                                        <hr className="border-ocean-ice" />
                                        {renderKBSection()}
                                        <hr className="border-ocean-ice" />
                                        {renderSubmitButton()}
                                    </>
                                )}
                            </>
                        )}
                    </form>
                </div>
            </div>

            {/* Confirmation Modal */}
            {showConfirm && (
                <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
                    <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-6">
                        <div className="flex items-center gap-3 mb-4">
                            <div className="p-2 bg-ocean-mist rounded-lg"><Upload className="h-5 w-5 text-ocean-deep" /></div>
                            <h3 className="text-lg font-semibold text-ocean-navy">Confirm Knowledge Base Upload</h3>
                        </div>
                        <div className="space-y-3 mb-6">
                            <div className="bg-ocean-powder rounded-lg p-4 space-y-2">
                                <div className="flex justify-between text-sm"><span className="text-ocean-deep/90">Files to upload</span><span className="font-semibold text-ocean-navy">{files.length}</span></div>
                                {docQuota && docQuota.limit !== -1 && (
                                    <>
                                        <div className="flex justify-between text-sm"><span className="text-ocean-deep/90">Monthly quota remaining</span><span className="font-semibold text-ocean-navy">{docQuota.remaining}</span></div>
                                        <div className="flex justify-between text-sm border-t border-ocean-ice pt-2"><span className="text-ocean-deep/90">Remaining after upload</span><span className={`font-semibold ${(remainingAfterUpload ?? 0) < 0 ? 'text-red-600' : 'text-ocean-navy'}`}>{remainingAfterUpload}</span></div>
                                    </>
                                )}
                            </div>
                            <p className="text-xs text-ocean-deep/80">Document uploads count toward your monthly quota and are not restored if deleted.</p>
                        </div>
                        <div className="flex gap-3">
                            <button onClick={() => setShowConfirm(false)} className="flex-1 px-4 py-2 border border-ocean-ice rounded-lg text-ocean-deep hover:bg-ocean-powder transition-colors">Cancel</button>
                            <button onClick={doCreateAgent} className="flex-1 px-4 py-2 bg-ocean-deep text-white rounded-lg hover:bg-ocean-rich transition-colors font-medium">
                                Create Agent & Upload {files.length} File{files.length !== 1 ? 's' : ''}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </AnimatedPage>
    );
}
