import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { PageBackNav } from '../components/PageBackNav';
import { MessageSquare, Mic, Upload, Check, AlertCircle, Phone, Save, Loader2, ExternalLink } from 'lucide-react';
import FieldWithHistory from '../components/agent/FieldWithHistory';
import VoicePicker from '../components/agent/VoicePicker';
import { FormSkeleton } from '../components/skeletons';
import { Skeleton } from '../components/ui/skeleton';
import { useToast } from '../components/Toast';
import AnimatedPage from '../components/AnimatedPage';

const textareaCls = 'w-full px-4 py-2 border border-ocean-ice rounded-lg focus:ring-2 focus:ring-ocean-bright focus:border-ocean-deep outline-none transition-all resize-none';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3000';

export default function EditAgent() {
    const { token } = useAuth();
    const navigate = useNavigate();
    const { agentId } = useParams<{ agentId: string }>();
    const toast = useToast();

    // Form State
    const [name, setName] = useState('');
    const [businessName, setBusinessName] = useState('');
    const [type, setType] = useState<'chat' | 'voice'>('chat');
    const [tone, setTone] = useState('professional');
    const [language, setLanguage] = useState('en');
    const [currency, setCurrency] = useState('USD');
    const [firstMessage, setFirstMessage] = useState('');
    const [prompt, setPrompt] = useState('');
    const [personaName, setPersonaName] = useState('');
    const [personaSummary, setPersonaSummary] = useState('');
    const [speakingStyle, setSpeakingStyle] = useState('');
    const [objectivesInput, setObjectivesInput] = useState('');
    const [capabilitiesInput, setCapabilitiesInput] = useState('');
    const [guardrails, setGuardrails] = useState('');
    const [memoryWindow, setMemoryWindow] = useState(8);
    const [longTermMemory, setLongTermMemory] = useState(false);
    const [temperature, setTemperature] = useState(0.35);
    const [maxTurns, setMaxTurns] = useState(4);
    const [fallbackMessage, setFallbackMessage] = useState('I am going to connect you with one of my teammates for more help.');

    // Voice-specific State
    const [callDirection, setCallDirection] = useState<'inbound' | 'outbound'>('inbound');
    const [phoneNumber, setPhoneNumber] = useState('');
    const [outboundCallerId, setOutboundCallerId] = useState('');
    const [transferNumber, setTransferNumber] = useState('');
    const [voicemailDropUrl, setVoicemailDropUrl] = useState('');
    const [ttsVoiceProvider, setTtsVoiceProvider] = useState<'twilio' | 'elevenlabs'>('twilio');
    const [ttsVoice, setTtsVoice] = useState('en-US-JennyNeural');

    // File Upload State
    const [file, setFile] = useState<File | null>(null);
    const [uploading, setUploading] = useState(false);

    // UI State
    const [loading, setLoading] = useState(false);
    const [fetching, setFetching] = useState(true);
    const [error, setError] = useState('');

    useEffect(() => {
        if (!agentId || !token) return;
        const fetchAgent = async () => {
            try {
                const res = await fetch(`${API_BASE}/api/agents/${agentId}`, {
                    headers: { 'Authorization': `Bearer ${token}` }
                });
                if (!res.ok) throw new Error('Failed to load agent');
                const agent = await res.json();

                setName(agent.name || '');
                setBusinessName(agent.businessName || '');
                setType(agent.type || 'chat');
                setTone(agent.tone || 'professional');
                setLanguage(agent.language || 'en');
                setCurrency(agent.currency || 'USD');
                setFirstMessage(agent.firstMessage || '');
                setPrompt(agent.prompt || '');
                setPersonaName(agent.persona?.name || '');
                setPersonaSummary(agent.persona?.summary || '');
                setSpeakingStyle(agent.persona?.speakingStyle || '');
                setObjectivesInput((agent.objectives || []).join('\n'));
                setCapabilitiesInput((agent.capabilities || []).join('\n'));
                setGuardrails(agent.guardrails || '');
                setMemoryWindow(agent.memoryConfig?.shortTermWindow || 8);
                setLongTermMemory(agent.memoryConfig?.longTermEnabled || false);
                setTemperature(agent.responseConfig?.temperature ?? 0.35);
                setMaxTurns(agent.responseConfig?.maxTurns || 4);
                setFallbackMessage(agent.responseConfig?.fallbackMessage || 'I am going to connect you with one of my teammates for more help.');

                // Voice fields
                setCallDirection(agent.callDirection || 'inbound');
                setPhoneNumber(agent.phoneNumber || '');
                setOutboundCallerId(agent.outboundCallerId || '');
                setTransferNumber(agent.transferNumber || '');
                setVoicemailDropUrl((agent as any).voicemailDropUrl || '');
                setTtsVoiceProvider((agent as any).ttsVoiceProvider || 'twilio');
                setTtsVoice(agent.ttsVoice || 'en-US-JennyNeural');
            } catch (err: any) {
                const msg = err.message || 'Error loading agent';
                setError(msg);
                toast.error('Could not load agent', msg);
            } finally {
                setFetching(false);
            }
        };
        fetchAgent();
    }, [agentId, token]);

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const selectedFile = e.target.files?.[0];
        if (selectedFile) {
            if (selectedFile.type !== 'application/pdf') {
                setError('Please select a PDF file');
                return;
            }
            setFile(selectedFile);
            setError('');
        }
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setError('');

        try {
            const objectives = objectivesInput
                .split(/\r?\n/)
                .map((line) => line.trim())
                .filter(Boolean);
            const capabilities = capabilitiesInput
                .split(/\r?\n/)
                .map((line) => line.trim())
                .filter(Boolean);

            const res = await fetch(`${API_BASE}/api/agents/${agentId}`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({
                    name,
                    businessName,
                    type,
                    tone,
                    language,
                    currency,
                    firstMessage,
                    prompt,
                    persona: {
                        name: personaName || name,
                        summary: personaSummary,
                        speakingStyle: speakingStyle || tone
                    },
                    objectives,
                    capabilities,
                    guardrails,
                    memoryConfig: {
                        shortTermWindow: Number(memoryWindow) || 8,
                        longTermEnabled: longTermMemory
                    },
                    responseConfig: {
                        temperature,
                        maxTurns,
                        fallbackMessage
                    },
                    ...(type === 'voice' ? {
                        callDirection,
                        phoneNumber: callDirection === 'inbound' ? phoneNumber : '',
                        outboundCallerId: callDirection === 'outbound' ? outboundCallerId : '',
                        transferNumber,
                        voicemailDropUrl: callDirection === 'outbound' ? voicemailDropUrl : '',
                        ttsVoiceProvider: callDirection === 'outbound' ? ttsVoiceProvider : 'twilio',
                        sttProvider: 'twilio',
                        ttsProvider: 'twilio',
                        ttsVoice,
                    } : {})
                })
            });

            if (!res.ok) {
                const errorData = await res.json().catch(() => ({ message: 'Unknown error' }));
                throw new Error(errorData.message || 'Failed to update agent');
            }

            // Upload new knowledge base file if selected
            if (file) {
                setUploading(true);
                const formData = new FormData();
                formData.append('file', file);
                formData.append('agentId', agentId!);

                const uploadRes = await fetch(`${API_BASE}/api/upload/pdf`, {
                    method: 'POST',
                    headers: { 'Authorization': `Bearer ${token}` },
                    body: formData
                });

                if (!uploadRes.ok) {
                    toast.warning('Agent saved, but upload failed', 'Knowledge base file could not be uploaded.');
                }
            }

            toast.success('Agent updated');
            setTimeout(() => navigate('/dashboard'), 800);
        } catch (err: any) {
            const msg = err.message || 'Error updating agent';
            setError(msg);
            toast.error('Could not update agent', msg);
        } finally {
            setLoading(false);
            setUploading(false);
        }
    };

    if (fetching) {
        return (
            <div className="bg-white pb-12">
                <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
                    <Skeleton className="h-4 w-36 mb-6" />
                    <FormSkeleton fields={8} />
                </div>
            </div>
        );
    }

    return (
        <AnimatedPage className="bg-white pb-12">
            <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 pt-6 pb-10 sm:pt-8">
                <PageBackNav to="/dashboard" label="Back to Dashboard" />

                <div className="bg-white rounded-xl shadow-lg border border-ocean-ice/80 overflow-hidden">
                    <div className="p-8 border-b border-ocean-ice/80 bg-white">
                        <h1 className="text-2xl font-bold text-ocean-navy">Edit Agent</h1>
                        <p className="text-ocean-deep/80 mt-1">Update your agent's configuration, personality, and knowledge base.</p>
                        <button
                            type="button"
                            onClick={() => navigate(`/dashboard?catalog=${agentId}`)}
                            className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-ocean-deep hover:text-ocean-navy transition-colors"
                        >
                            <ExternalLink className="h-4 w-4" />
                            Open catalog / menu
                        </button>
                    </div>

                    {error && (
                        <div className="mx-8 mt-6 p-4 bg-red-50 border border-red-200 rounded-lg flex items-center text-red-700">
                            <AlertCircle className="h-5 w-5 mr-2 flex-shrink-0" />
                            {error}
                        </div>
                    )}

                    {/* Settings form */}
                    <form onSubmit={handleSubmit} className="p-8 space-y-8">
                        {/* 1. Agent Type */}
                        <section>
                            <h3 className="text-lg font-semibold text-ocean-navy mb-4">1. Agent Type</h3>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <button
                                    type="button"
                                    onClick={() => setType('chat')}
                                    className={`p-6 rounded-xl border-2 flex items-start space-x-4 transition-all ${type === 'chat'
                                        ? 'border-ocean-deep bg-ocean-powder ring-1 ring-ocean-deep'
                                        : 'border-ocean-ice hover:border-ocean-ice hover:bg-ocean-powder'
                                        }`}
                                >
                                    <div className={`p-3 rounded-lg ${type === 'chat' ? 'bg-ocean-deep text-white' : 'bg-white border border-ocean-ice text-ocean-deep/80'}`}>
                                        <MessageSquare className="h-6 w-6" />
                                    </div>
                                    <div className="text-left">
                                        <div className={`font-semibold text-lg ${type === 'chat' ? 'text-ocean-navy' : 'text-ocean-navy'}`}>Chat Agent</div>
                                        <p className="text-sm text-ocean-deep/80 mt-1">Best for customer support, Q&A, and text-based assistance.</p>
                                    </div>
                                    {type === 'chat' && <div className="ml-auto text-ocean-deep"><Check className="h-5 w-5" /></div>}
                                </button>

                                <button
                                    type="button"
                                    onClick={() => setType('voice')}
                                    className={`p-6 rounded-xl border-2 flex items-start space-x-4 transition-all ${type === 'voice'
                                        ? 'border-ocean-deep bg-ocean-powder ring-1 ring-ocean-deep'
                                        : 'border-ocean-ice hover:border-ocean-ice hover:bg-ocean-powder'
                                        }`}
                                >
                                    <div className={`p-3 rounded-lg ${type === 'voice' ? 'bg-ocean-deep text-white' : 'bg-white border border-ocean-ice text-ocean-deep/80'}`}>
                                        <Mic className="h-6 w-6" />
                                    </div>
                                    <div className="text-left">
                                        <div className={`font-semibold text-lg ${type === 'voice' ? 'text-ocean-navy' : 'text-ocean-navy'}`}>Voice Agent</div>
                                        <p className="text-sm text-ocean-deep/80 mt-1">Best for phone calls, voice commands, and audio interactions.</p>
                                    </div>
                                    {type === 'voice' && <div className="ml-auto text-ocean-deep"><Check className="h-5 w-5" /></div>}
                                </button>
                            </div>
                        </section>

                        <hr className="border-ocean-ice/80" />

                        {/* Voice Configuration */}
                        {type === 'voice' && (
                            <>
                                <section>
                                    <h3 className="text-lg font-semibold text-ocean-navy mb-4 flex items-center">
                                        <Phone className="h-5 w-5 mr-2 text-purple-600" />
                                        Voice Configuration
                                    </h3>
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                        {/* Call Direction */}
                                        <div className="col-span-2">
                                            <label className="block text-sm font-medium text-ocean-deep mb-2">Call Direction</label>
                                            <div className="grid grid-cols-2 gap-3">
                                                <button
                                                    type="button"
                                                    onClick={() => setCallDirection('inbound')}
                                                    className={`px-4 py-3 rounded-lg border-2 text-sm font-medium transition-all ${callDirection === 'inbound' ? 'border-ocean-deep bg-ocean-powder text-ocean-deep' : 'border-ocean-ice text-ocean-deep hover:border-ocean-ice'}`}
                                                >
                                                    Inbound
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => setCallDirection('outbound')}
                                                    className={`px-4 py-3 rounded-lg border-2 text-sm font-medium transition-all ${callDirection === 'outbound' ? 'border-ocean-deep bg-ocean-powder text-ocean-deep' : 'border-ocean-ice text-ocean-deep hover:border-ocean-ice'}`}
                                                >
                                                    Outbound
                                                </button>
                                            </div>
                                        </div>

                                        {/* Inbound: phone number */}
                                        {callDirection === 'inbound' && (
                                            <div className="col-span-2">
                                                <label htmlFor="phoneNumber" className="block text-sm font-medium text-ocean-deep mb-1">Twilio Phone Number</label>
                                                <input
                                                    type="text"
                                                    id="phoneNumber"
                                                    value={phoneNumber}
                                                    onChange={(e) => setPhoneNumber(e.target.value)}
                                                    className="w-full px-4 py-2 border border-ocean-ice rounded-lg focus:ring-2 focus:ring-ocean-bright focus:border-ocean-deep outline-none transition-all"
                                                    placeholder="e.g., +14155551234"
                                                />
                                                <p className="text-sm text-ocean-deep/80 mt-1">The Twilio number mapped to this agent (E.164). Incoming calls route here.</p>
                                            </div>
                                        )}

                                        {/* Outbound: caller ID + transfer number + voicemail drop */}
                                        {callDirection === 'outbound' && (
                                            <>
                                                <div className="col-span-2">
                                                    <label htmlFor="outboundCallerId" className="block text-sm font-medium text-ocean-deep mb-1">Outbound Caller ID</label>
                                                    <input
                                                        type="text"
                                                        id="outboundCallerId"
                                                        value={outboundCallerId}
                                                        onChange={(e) => setOutboundCallerId(e.target.value)}
                                                        className="w-full px-4 py-2 border border-ocean-ice rounded-lg focus:ring-2 focus:ring-ocean-bright focus:border-ocean-deep outline-none transition-all"
                                                        placeholder="e.g., +14155551234"
                                                    />
                                                    <p className="text-sm text-ocean-deep/80 mt-1">Twilio number shown to contacts when this agent places calls (E.164).</p>
                                                </div>
                                                <div className="col-span-2">
                                                    <label htmlFor="transferNumber" className="block text-sm font-medium text-ocean-deep mb-1">Warm Transfer Number</label>
                                                    <input
                                                        type="text"
                                                        id="transferNumber"
                                                        value={transferNumber}
                                                        onChange={(e) => setTransferNumber(e.target.value)}
                                                        className="w-full px-4 py-2 border border-ocean-ice rounded-lg focus:ring-2 focus:ring-ocean-bright focus:border-ocean-deep outline-none transition-all"
                                                        placeholder="e.g., +12025550100"
                                                    />
                                                    <p className="text-sm text-ocean-deep/80 mt-1">When a prospect is interested, the AI says "let me connect you" and Twilio forwards the call here.</p>
                                                </div>
                                                <div className="col-span-2">
                                                    <label htmlFor="voicemailDropUrl" className="block text-sm font-medium text-ocean-deep mb-1">
                                                        Voicemail Drop URL <span className="text-ocean-deep/60 font-normal">(optional)</span>
                                                    </label>
                                                    <input
                                                        type="url"
                                                        id="voicemailDropUrl"
                                                        value={voicemailDropUrl}
                                                        onChange={(e) => setVoicemailDropUrl(e.target.value)}
                                                        className="w-full px-4 py-2 border border-ocean-ice rounded-lg focus:ring-2 focus:ring-ocean-bright focus:border-ocean-deep outline-none transition-all"
                                                        placeholder="https://example.com/voicemail.mp3"
                                                    />
                                                    <p className="text-sm text-ocean-deep/80 mt-1">
                                                        Public URL to an MP3/WAV recording. Played when AMD detects voicemail instead of the AI speaking. Leave blank to use AI-generated TTS voicemail.
                                                    </p>
                                                </div>
                                            </>
                                        )}

                                        <VoicePicker token={token} value={ttsVoice} onChange={setTtsVoice} />
                                    </div>
                                </section>
                                <hr className="border-ocean-ice/80" />
                            </>
                        )}

                        {/* 2. Basic Information */}
                        <section className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            <div className="col-span-2">
                                <h3 className="text-lg font-semibold text-ocean-navy mb-4">2. Agent Details</h3>
                            </div>

                            <div className="col-span-2">
                                <label htmlFor="name" className="block text-sm font-medium text-ocean-deep mb-1">Agent Name</label>
                                <input
                                    type="text"
                                    id="name"
                                    name="agentName"
                                    autoComplete="organization"
                                    value={name}
                                    onChange={(e) => setName(e.target.value)}
                                    className="w-full px-4 py-2 border border-ocean-ice rounded-lg focus:ring-2 focus:ring-ocean-bright focus:border-ocean-deep outline-none transition-all"
                                    placeholder="e.g., Support Bot"
                                    required
                                />
                            </div>

                            <div className="col-span-2">
                                <label htmlFor="businessName" className="block text-sm font-medium text-ocean-deep mb-1">Business Name</label>
                                <input
                                    type="text"
                                    id="businessName"
                                    name="businessName"
                                    autoComplete="organization"
                                    value={businessName}
                                    onChange={(e) => setBusinessName(e.target.value)}
                                    className="w-full px-4 py-2 border border-ocean-ice rounded-lg focus:ring-2 focus:ring-ocean-bright focus:border-ocean-deep outline-none transition-all"
                                    placeholder="e.g., TastyFood, Acme Corp"
                                />
                                <p className="text-sm text-ocean-deep/80 mt-1">The business this agent represents (used in greetings)</p>
                            </div>

                            <div>
                                <label htmlFor="tone" className="block text-sm font-medium text-ocean-deep mb-1">Tone</label>
                                <select
                                    id="tone"
                                    value={tone}
                                    onChange={(e) => setTone(e.target.value)}
                                    className="w-full px-4 py-2 border border-ocean-ice rounded-lg focus:ring-2 focus:ring-ocean-bright focus:border-ocean-deep outline-none transition-all bg-white"
                                >
                                    <option value="professional">Professional</option>
                                    <option value="friendly">Friendly</option>
                                    <option value="empathetic">Empathetic</option>
                                    <option value="humorous">Humorous</option>
                                </select>
                            </div>

                            <div>
                                <label htmlFor="language" className="block text-sm font-medium text-ocean-deep mb-1">Language</label>
                                <select
                                    id="language"
                                    value={language}
                                    onChange={(e) => setLanguage(e.target.value)}
                                    className="w-full px-4 py-2 border border-ocean-ice rounded-lg focus:ring-2 focus:ring-ocean-bright focus:border-ocean-deep outline-none transition-all bg-white"
                                >
                                    <option value="en">English</option>
                                    <option value="es">Spanish</option>
                                    <option value="fr">French</option>
                                    <option value="de">German</option>
                                </select>
                            </div>

                            <div>
                                <label htmlFor="currency" className="block text-sm font-medium text-ocean-deep mb-1">Currency</label>
                                <select
                                    id="currency"
                                    value={currency}
                                    onChange={(e) => setCurrency(e.target.value)}
                                    className="w-full px-4 py-2 border border-ocean-ice rounded-lg focus:ring-2 focus:ring-ocean-bright focus:border-ocean-deep outline-none transition-all bg-white"
                                >
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
                                <label htmlFor="firstMessage" className="block text-sm font-medium text-ocean-deep mb-1">
                                    First Message (Greeting)
                                    <span className="ml-1 text-xs text-ocean-deep/60">- sent verbatim when chat starts</span>
                                </label>
                                <input
                                    type="text"
                                    id="firstMessage"
                                    name="firstMessage"
                                    autoComplete="off"
                                    value={firstMessage}
                                    onChange={(e) => setFirstMessage(e.target.value)}
                                    className="w-full px-4 py-2 border border-ocean-ice rounded-lg focus:ring-2 focus:ring-ocean-bright focus:border-ocean-deep outline-none transition-all"
                                    placeholder="e.g., Hello! How can I help you today?"
                                />
                            </div>
                        </section>

                        <hr className="border-ocean-ice/80" />

                        {/* 3. Persona & Goals */}
                        <section>
                            <h3 className="text-lg font-semibold text-ocean-navy mb-4">3. Persona & Goals</h3>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
                                <div>
                                    <label htmlFor="personaName" className="block text-sm font-medium text-ocean-deep mb-1">Persona Name</label>
                                    <input
                                        type="text"
                                        id="personaName"
                                        name="personaName"
                                        autoComplete="off"
                                        value={personaName}
                                        onChange={(e) => setPersonaName(e.target.value)}
                                        className="w-full px-4 py-2 border border-ocean-ice rounded-lg focus:ring-2 focus:ring-ocean-bright focus:border-ocean-deep outline-none transition-all"
                                        placeholder="e.g., Aurora, your hospitality concierge"
                                    />
                                </div>
                                <div>
                                    <label htmlFor="speakingStyle" className="block text-sm font-medium text-ocean-deep mb-1">Speaking Style</label>
                                    <input
                                        type="text"
                                        id="speakingStyle"
                                        name="speakingStyle"
                                        autoComplete="off"
                                        value={speakingStyle}
                                        onChange={(e) => setSpeakingStyle(e.target.value)}
                                        className="w-full px-4 py-2 border border-ocean-ice rounded-lg focus:ring-2 focus:ring-ocean-bright focus:border-ocean-deep outline-none transition-all"
                                        placeholder="e.g., warm, concise, confident"
                                    />
                                </div>
                            </div>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
                                <div>
                                    <label htmlFor="personaSummary" className="block text-sm font-medium text-ocean-deep mb-1">Persona Summary</label>
                                    <FieldWithHistory
                                        fieldKey="personaSummary"
                                        id="personaSummary"
                                        value={personaSummary}
                                        onChange={setPersonaSummary}
                                        rows={5}
                                        autoGrow
                                        maxAutoHeightPx={320}
                                        className={textareaCls}
                                        placeholder="Describe your agent's background, authority and vibe"
                                    />
                                </div>
                                <div className="grid grid-cols-1 gap-6">
                                    <div>
                                        <label htmlFor="objectives" className="block text-sm font-medium text-ocean-deep mb-1">Primary Objectives (one per line)</label>
                                        <FieldWithHistory
                                            fieldKey="objectives"
                                            id="objectives"
                                            value={objectivesInput}
                                            onChange={setObjectivesInput}
                                            rows={5}
                                            autoGrow
                                            maxAutoHeightPx={280}
                                            className={textareaCls}
                                            placeholder={`Convert inbound leads\nResolve tier-1 support tickets`}
                                        />
                                    </div>
                                    <div>
                                        <label htmlFor="capabilities" className="block text-sm font-medium text-ocean-deep mb-1">Capabilities (one per line)</label>
                                        <FieldWithHistory
                                            fieldKey="capabilities"
                                            id="capabilities"
                                            value={capabilitiesInput}
                                            onChange={setCapabilitiesInput}
                                            rows={5}
                                            autoGrow
                                            maxAutoHeightPx={280}
                                            className={textareaCls}
                                            placeholder={`Answer pricing questions\nBook demos via CRM`}
                                        />
                                    </div>
                                </div>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                <div>
                                    <label htmlFor="guardrails" className="block text-sm font-medium text-ocean-deep mb-1">Guardrails & Escalation Policy</label>
                                    <FieldWithHistory
                                        fieldKey="guardrails"
                                        id="guardrails"
                                        value={guardrails}
                                        onChange={setGuardrails}
                                        rows={4}
                                        autoGrow
                                        maxAutoHeightPx={300}
                                        className={textareaCls}
                                        placeholder="List forbidden topics, escalation triggers, compliance notes..."
                                    />
                                </div>
                                <div className="grid grid-cols-1 gap-6">
                                    <div>
                                        <label htmlFor="memoryWindow" className="block text-sm font-medium text-ocean-deep mb-1">Short-term Memory Window</label>
                                        <input
                                            id="memoryWindow"
                                            name="memoryWindow"
                                            type="number"
                                            min={2}
                                            max={20}
                                            value={memoryWindow}
                                            onChange={(e) => setMemoryWindow(parseInt(e.target.value, 10) || 8)}
                                            className="w-full px-4 py-2 border border-ocean-ice rounded-lg focus:ring-2 focus:ring-ocean-bright focus:border-ocean-deep outline-none transition-all"
                                        />
                                        <p className="text-xs text-ocean-deep/80 mt-1">How many prior messages should the agent consider when reasoning.</p>
                                    </div>
                                    <label className="inline-flex items-center space-x-3">
                                        <input
                                            type="checkbox"
                                            checked={longTermMemory}
                                            onChange={(e) => setLongTermMemory(e.target.checked)}
                                            className="h-4 w-4 text-ocean-deep border-ocean-ice rounded focus:ring-ocean-bright"
                                        />
                                        <span className="text-sm text-ocean-deep">Enable long-term memory (summaries stored for later sessions)</span>
                                    </label>
                                </div>
                            </div>
                        </section>

                        <hr className="border-ocean-ice/80" />

                        {/* 4. Knowledge Base */}
                        <section>
                            <h3 className="text-lg font-semibold text-ocean-navy mb-4">4. Knowledge Base</h3>
                            <p className="text-sm text-ocean-deep/80 mb-3">Upload a new PDF to replace or add to the existing knowledge base.</p>
                            <div className="border-2 border-dashed border-ocean-ice rounded-xl p-8 text-center hover:bg-ocean-powder transition-colors cursor-pointer relative">
                                <input
                                    type="file"
                                    accept=".pdf"
                                    onChange={handleFileChange}
                                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                                    aria-label="Upload knowledge base PDF file"
                                    title="Upload PDF file"
                                />
                                <div className="flex flex-col items-center justify-center">
                                    <div className="p-3 bg-ocean-powder rounded-full mb-3">
                                        <Upload className="h-6 w-6 text-ocean-deep" />
                                    </div>
                                    <p className="text-sm font-medium text-ocean-navy">
                                        {file ? file.name : 'Click to upload PDF'}
                                    </p>
                                    <p className="text-xs text-ocean-deep/80 mt-1">
                                        {file ? 'New file selected. Will be uploaded on save.' : 'Optional: upload a new document to update the knowledge base'}
                                    </p>
                                </div>
                            </div>
                            {uploading && (
                                <p className="text-sm text-ocean-deep mt-2 text-center">Uploading knowledge base...</p>
                            )}
                        </section>

                        <hr className="border-ocean-ice/80" />

                        {/* 5. System Prompt */}
                        <section>
                            <h3 className="text-lg font-semibold text-ocean-navy mb-4">5. System Prompt <span className="text-sm font-normal text-ocean-deep/60">- leave blank to auto-generate from persona</span></h3>
                            <FieldWithHistory
                                fieldKey="systemPrompt"
                                id="prompt"
                                value={prompt}
                                onChange={setPrompt}
                                rows={7}
                                autoGrow
                                maxAutoHeightPx={400}
                                className={textareaCls}
                                placeholder="Describe the agent's role, constraints, and behavior in detail..."
                            />
                            <p className="text-sm text-ocean-deep/80 mt-2">This is the core instruction set for your AI agent.</p>
                        </section>

                        {/* 6. Response Style */}
                        <section className="mt-8">
                            <h3 className="text-lg font-semibold text-ocean-navy mb-4">6. Response Style</h3>
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                                <div>
                                    <label htmlFor="temperature" className="block text-sm font-medium text-ocean-deep mb-1">Creativity (Temperature)</label>
                                    <input
                                        id="temperature"
                                        title="Creativity temperature"
                                        type="range"
                                        min={0}
                                        max={1}
                                        step={0.05}
                                        value={temperature}
                                        onChange={(e) => setTemperature(parseFloat(e.target.value))}
                                        className="w-full"
                                    />
                                    <div className="text-sm text-ocean-deep/90 text-right">{temperature.toFixed(2)}</div>
                                </div>
                                <div>
                                    <label htmlFor="maxTurns" className="block text-sm font-medium text-ocean-deep mb-1">Max Conversation Turns</label>
                                    <input
                                        id="maxTurns"
                                        name="maxTurns"
                                        type="number"
                                        min={1}
                                        max={100}
                                        value={maxTurns}
                                        onChange={(e) => setMaxTurns(parseInt(e.target.value, 10) || 30)}
                                        className="w-full px-4 py-2 border border-ocean-ice rounded-lg focus:ring-2 focus:ring-ocean-bright focus:border-ocean-deep outline-none transition-all"
                                    />
                                </div>
                                <div>
                                    <label htmlFor="fallbackMessage" className="block text-sm font-medium text-ocean-deep mb-1">Fallback Message</label>
                                    <FieldWithHistory
                                        fieldKey="fallbackMessage"
                                        id="fallbackMessage"
                                        value={fallbackMessage}
                                        onChange={setFallbackMessage}
                                        rows={3}
                                        autoGrow
                                        maxAutoHeightPx={200}
                                        className={textareaCls}
                                        placeholder="Message sent when the agent cannot help..."
                                    />
                                </div>
                            </div>
                        </section>

                        {type === 'chat' && (
                            <section className="mt-8 rounded-xl border border-ocean-ice bg-ocean-powder/40 p-5">
                                <h3 className="text-base font-semibold text-ocean-navy mb-1">Website Chat</h3>
                                <p className="text-xs text-ocean-deep/70 mb-3">Embed · API credentials</p>
                                <button
                                    type="button"
                                    onClick={() => navigate(`/agents/${agentId}/website-chat`)}
                                    className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-ocean-deep text-white text-sm font-medium hover:bg-ocean-rich shadow-sm"
                                >
                                    Open Website Chat
                                    <ExternalLink className="h-3.5 w-3.5 opacity-90" aria-hidden />
                                </button>
                            </section>
                        )}

                        <div className="pt-6 flex justify-end items-center space-x-4 border-t border-ocean-ice/80">
                            <button
                                type="button"
                                onClick={() => navigate('/dashboard')}
                                className="px-6 py-2.5 border border-ocean-ice text-ocean-deep rounded-lg hover:bg-ocean-powder font-medium transition-colors"
                            >
                                Cancel
                            </button>
                            <button
                                type="submit"
                                disabled={loading}
                                className="px-8 py-2.5 bg-ocean-deep text-white rounded-lg hover:bg-ocean-rich disabled:opacity-50 disabled:cursor-not-allowed font-medium shadow-sm transition-all flex items-center"
                            >
                                {loading ? (
                                    <>
                                        <Loader2 className="h-4 w-4 animate-spin mr-2" />
                                        Saving...
                                    </>
                                ) : (
                                    <>
                                        <Save className="h-4 w-4 mr-2" />
                                        Save Changes
                                    </>
                                )}
                            </button>
                        </div>
                    </form>
                </div>
            </div>
        </AnimatedPage>
    );
}
