import { useRef } from 'react';
import { Upload, X, FileText, AlertTriangle } from 'lucide-react';
import FieldWithHistory from './FieldWithHistory';

export interface ManualFormState {
    // Basics
    name: string;
    businessName: string;
    tone: string;
    language: string;
    currency: string;
    firstMessage: string;
    // Intelligence
    personaName: string;
    speakingStyle: string;
    personaSummary: string;
    objectivesInput: string;
    capabilitiesInput: string;
    guardrails: string;
    // Advanced
    prompt: string;
    temperature: number;
    memoryWindow: number;
    longTermMemory: boolean;
    maxTurns: number;
    fallbackMessage: string;
}

interface DocQuota { remaining: number; used: number; limit: number; }

interface Props {
    form: ManualFormState;
    onChange: (patch: Partial<ManualFormState>) => void;
    step: 1 | 2 | 3;
    onStepChange: (s: 1 | 2 | 3) => void;
    // KB
    files: File[];
    onFilesChange: (files: File[]) => void;
    docQuota: DocQuota | null;
}

const inputCls = 'w-full px-4 py-2 border border-ocean-ice rounded-lg focus:ring-2 focus:ring-ocean-bright focus:border-ocean-deep outline-none transition-all';
const textareaCls = `${inputCls} resize-none`;

function formatBytes(bytes: number) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const STEPS = [
    { n: 1 as const, label: 'Basics' },
    { n: 2 as const, label: 'Intelligence' },
    { n: 3 as const, label: 'Advanced' },
];

export default function ManualSetupForm({ form, onChange, step, onStepChange, files, onFilesChange, docQuota }: Props) {
    const fileInputRef = useRef<HTMLInputElement>(null);

    const set = (key: keyof ManualFormState) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
        onChange({ [key]: e.target.value });
    };

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (!e.target.files) return;
        const newFiles = Array.from(e.target.files);
        const existing = new Set(files.map(f => f.name + f.size));
        onFilesChange([...files, ...newFiles.filter(f => !existing.has(f.name + f.size))]);
        e.target.value = '';
    };

    const removeFile = (i: number) => onFilesChange(files.filter((_, idx) => idx !== i));

    return (
        <div className="space-y-6">
            {/* Step tabs */}
            <div className="flex rounded-xl border border-ocean-ice overflow-hidden">
                {STEPS.map((s, idx) => (
                    <button
                        key={s.n}
                        type="button"
                        onClick={() => onStepChange(s.n)}
                        className={`flex-1 py-3 text-sm font-medium transition-colors ${
                            step === s.n
                                ? 'bg-ocean-deep text-white'
                                : 'bg-white text-ocean-deep/90 hover:bg-ocean-powder'
                        } ${idx > 0 ? 'border-l border-ocean-ice' : ''}`}
                    >
                        <span className={`inline-flex items-center justify-center w-5 h-5 rounded-full text-xs mr-2 ${
                            step === s.n ? 'bg-white text-ocean-deep' : 'bg-ocean-mist/50 text-ocean-deep/80'
                        }`}>{s.n}</span>
                        {s.label}
                    </button>
                ))}
            </div>

            {/* Step 1: Basics */}
            {step === 1 && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="col-span-2">
                        <label htmlFor="name" className="block text-sm font-medium text-ocean-deep mb-1">Agent Name <span className="text-red-500">*</span></label>
                        <input id="name" name="agentName" type="text" autoComplete="organization" value={form.name} onChange={set('name')} className={inputCls} placeholder="e.g., Support Bot" required />
                    </div>
                    <div className="col-span-2">
                        <label htmlFor="businessName" className="block text-sm font-medium text-ocean-deep mb-1">Business Name</label>
                        <input id="businessName" name="businessName" type="text" autoComplete="organization" value={form.businessName} onChange={set('businessName')} className={inputCls} placeholder="e.g., TastyFood, Acme Corp" />
                    </div>
                    <div>
                        <label htmlFor="tone" className="block text-sm font-medium text-ocean-deep mb-1">Tone</label>
                        <select id="tone" name="tone" value={form.tone} onChange={set('tone')} className={inputCls + ' bg-white'}>
                            <option value="professional">Professional</option>
                            <option value="friendly">Friendly</option>
                            <option value="empathetic">Empathetic</option>
                            <option value="humorous">Humorous</option>
                        </select>
                    </div>
                    <div>
                        <label htmlFor="language" className="block text-sm font-medium text-ocean-deep mb-1">Language</label>
                        <select id="language" name="language" value={form.language} onChange={set('language')} className={inputCls + ' bg-white'}>
                            <option value="en">English</option>
                            <option value="es">Spanish</option>
                            <option value="fr">French</option>
                            <option value="de">German</option>
                        </select>
                    </div>
                    <div>
                        <label htmlFor="currency" className="block text-sm font-medium text-ocean-deep mb-1">Currency</label>
                        <select id="currency" name="currency" value={form.currency} onChange={set('currency')} className={inputCls + ' bg-white'}>
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
                        <label className="block text-sm font-medium text-ocean-deep mb-1">
                            First Message (Greeting)
                            <span className="ml-1 text-xs text-ocean-deep/60">- sent verbatim when chat starts</span>
                        </label>
                        <input id="firstMessage" name="firstMessage" type="text" autoComplete="off" value={form.firstMessage} onChange={set('firstMessage')} className={inputCls} placeholder="e.g., Hello! How can I help you today?" />
                    </div>
                    <div className="col-span-2 flex justify-end">
                        <button type="button" onClick={() => onStepChange(2)} className="px-6 py-2.5 bg-ocean-deep text-white rounded-lg font-medium hover:bg-ocean-rich transition-colors">
                            Next: Intelligence →
                        </button>
                    </div>
                </div>
            )}

            {/* Step 2: Intelligence */}
            {step === 2 && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div>
                        <label htmlFor="personaName" className="block text-sm font-medium text-ocean-deep mb-1">Persona Name</label>
                        <input id="personaName" name="personaName" type="text" autoComplete="off" value={form.personaName} onChange={set('personaName')} className={inputCls} placeholder="e.g., Aurora, Max" />
                    </div>
                    <div>
                        <label htmlFor="speakingStyle" className="block text-sm font-medium text-ocean-deep mb-1">Speaking Style</label>
                        <input id="speakingStyle" name="speakingStyle" type="text" autoComplete="off" value={form.speakingStyle} onChange={set('speakingStyle')} className={inputCls} placeholder="e.g., warm, concise, confident" />
                    </div>
                    <div className="col-span-2">
                        <label className="block text-sm font-medium text-ocean-deep mb-1">Persona Summary</label>
                        <FieldWithHistory fieldKey="personaSummary" value={form.personaSummary} onChange={(v) => onChange({ personaSummary: v })} rows={5} placeholder="Describe your agent's background, role and authority" className={textareaCls} autoGrow maxAutoHeightPx={320} />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-ocean-deep mb-1">Primary Objectives <span className="text-xs text-ocean-deep/60">(one per line)</span></label>
                        <FieldWithHistory fieldKey="objectives" value={form.objectivesInput} onChange={(v) => onChange({ objectivesInput: v })} rows={5} placeholder={`Convert inbound leads\nResolve tier-1 support tickets`} className={textareaCls} autoGrow maxAutoHeightPx={280} />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-ocean-deep mb-1">Capabilities <span className="text-xs text-ocean-deep/60">(one per line)</span></label>
                        <FieldWithHistory fieldKey="capabilities" value={form.capabilitiesInput} onChange={(v) => onChange({ capabilitiesInput: v })} rows={5} placeholder={`Answer pricing questions\nBook demos via CRM`} className={textareaCls} autoGrow maxAutoHeightPx={280} />
                    </div>
                    <div className="col-span-2">
                        <label className="block text-sm font-medium text-ocean-deep mb-1">Guardrails & Escalation Policy</label>
                        <FieldWithHistory fieldKey="guardrails" value={form.guardrails} onChange={(v) => onChange({ guardrails: v })} rows={4} placeholder="List forbidden topics, escalation triggers, compliance notes..." className={textareaCls} autoGrow maxAutoHeightPx={300} />
                    </div>

                    {/* Knowledge Base */}
                    <div className="col-span-2">
                        <div className="flex items-center justify-between mb-2">
                            <label className="block text-sm font-medium text-ocean-deep">Knowledge Base (PDF files)</label>
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
                            className="border-2 border-dashed border-ocean-ice rounded-xl p-5 text-center hover:bg-ocean-powder transition-colors cursor-pointer"
                            onClick={() => fileInputRef.current?.click()}
                        >
                            <input ref={fileInputRef} type="file" accept=".pdf" multiple onChange={handleFileChange} className="hidden" aria-label="Upload knowledge base PDF files" title="Upload PDF files" />
                            <Upload className="h-5 w-5 text-ocean-rich mx-auto mb-1" />
                            <p className="text-sm text-ocean-deep font-medium">Click to select PDF files</p>
                            <p className="text-xs text-ocean-deep/60">FAQs, policies, product catalogs…</p>
                        </div>
                        {files.length > 0 && (
                            <div className="mt-2 space-y-1">
                                {files.map((f, i) => (
                                    <div key={i} className="flex items-center justify-between bg-ocean-powder border border-ocean-ice rounded-lg px-3 py-2">
                                        <div className="flex items-center gap-2 min-w-0">
                                            <FileText className="h-4 w-4 text-ocean-rich shrink-0" />
                                            <span className="text-sm text-ocean-deep truncate">{f.name}</span>
                                            <span className="text-xs text-ocean-deep/60 shrink-0">{formatBytes(f.size)}</span>
                                        </div>
                                        <button type="button" aria-label="Remove file" title="Remove file" onClick={() => removeFile(i)} className="p-1 text-ocean-deep/60 hover:text-red-500 transition-colors"><X className="h-4 w-4" /></button>
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
                    </div>

                    <div className="col-span-2 flex justify-between">
                        <button type="button" onClick={() => onStepChange(1)} className="px-6 py-2.5 border border-ocean-ice text-ocean-deep rounded-lg font-medium hover:bg-ocean-powder transition-colors">
                            ← Back
                        </button>
                        <button type="button" onClick={() => onStepChange(3)} className="px-6 py-2.5 bg-ocean-deep text-white rounded-lg font-medium hover:bg-ocean-rich transition-colors">
                            Next: Advanced →
                        </button>
                    </div>
                </div>
            )}

            {/* Step 3: Advanced */}
            {step === 3 && (
                <div className="space-y-6">
                    <div>
                        <label className="block text-sm font-medium text-ocean-deep mb-1">
                            System Prompt
                            <span className="ml-1 text-xs text-ocean-deep/60">- optional, leave blank to auto-generate from persona</span>
                        </label>
                        <FieldWithHistory fieldKey="systemPrompt" value={form.prompt} onChange={(v) => onChange({ prompt: v })} rows={7} placeholder="Describe the agent's role, constraints, and behavior in detail..." className={textareaCls} autoGrow maxAutoHeightPx={400} />
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                        <div>
                            <label htmlFor="temperature" className="block text-sm font-medium text-ocean-deep mb-1">Creativity (Temperature)</label>
                            <input id="temperature" name="temperature" type="range" min={0} max={1} step={0.05} value={form.temperature} onChange={(e) => onChange({ temperature: parseFloat(e.target.value) })} className="w-full" />
                            <div className="flex justify-between text-xs text-ocean-deep/60 mt-1">
                                <span>Precise</span>
                                <span className="font-medium text-ocean-deep">{form.temperature.toFixed(2)}</span>
                                <span>Creative</span>
                            </div>
                        </div>
                        <div>
                            <label htmlFor="memoryWindow" className="block text-sm font-medium text-ocean-deep mb-1">Memory Window (turns)</label>
                            <input id="memoryWindow" name="memoryWindow" type="number" min={2} max={20} value={form.memoryWindow} onChange={(e) => onChange({ memoryWindow: parseInt(e.target.value, 10) || 8 })} className={inputCls} />
                            <p className="text-xs text-ocean-deep/60 mt-1">How many past messages the agent remembers</p>
                        </div>
                        <div>
                            <label htmlFor="maxTurns" className="block text-sm font-medium text-ocean-deep mb-1">Max Conversation Turns</label>
                            <input id="maxTurns" name="maxTurns" type="number" min={1} max={100} value={form.maxTurns} onChange={(e) => onChange({ maxTurns: parseInt(e.target.value, 10) || 30 })} className={inputCls} />
                        </div>
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-ocean-deep mb-1">Fallback Message</label>
                        <FieldWithHistory fieldKey="fallbackMessage" value={form.fallbackMessage} onChange={(v) => onChange({ fallbackMessage: v })} rows={3} placeholder="Message sent when the agent cannot help..." className={textareaCls} autoGrow maxAutoHeightPx={200} />
                    </div>
                    <label className="inline-flex items-center space-x-3">
                        <input type="checkbox" checked={form.longTermMemory} onChange={(e) => onChange({ longTermMemory: e.target.checked })} className="h-4 w-4 text-ocean-deep border-ocean-ice rounded focus:ring-ocean-bright" />
                        <span className="text-sm text-ocean-deep">Enable long-term memory</span>
                    </label>
                    <div className="flex justify-between pt-2">
                        <button type="button" onClick={() => onStepChange(2)} className="px-6 py-2.5 border border-ocean-ice text-ocean-deep rounded-lg font-medium hover:bg-ocean-powder transition-colors">
                            ← Back
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}
