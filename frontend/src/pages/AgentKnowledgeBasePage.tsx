import { useState, useEffect, useRef } from 'react';
import { useParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { PageBackNav } from '../components/PageBackNav';
import { KnowledgeBasePageSkeleton } from '../components/skeletons';
import AnimatedPage from '../components/AnimatedPage';
import { useToast } from '../components/Toast';
import ConfirmDialog from '../components/ConfirmDialog';
import {
    FileText, Trash2, Upload, AlertTriangle, Info,
    AlertCircle, X, BookOpen, RefreshCw, PenLine, FolderOpen, Eye
} from 'lucide-react';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3000';

interface KBDocument {
    _id: string;
    filename: string;
    fileSize: number;
    contentType: string;
    createdAt: string;
}

interface DocQuota {
    remaining: number;
    used: number;
    limit: number;
    resetsAt?: string;
}

export default function AgentKnowledgeBasePage() {
    const { agentId } = useParams<{ agentId: string }>();
    const { token } = useAuth();
    const toast = useToast();
    const fileInputRef = useRef<HTMLInputElement>(null);

    const [agentName, setAgentName] = useState('');
    const [documents, setDocuments] = useState<KBDocument[]>([]);
    const [docQuota, setDocQuota] = useState<DocQuota | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    // Upload state
    const [pendingFiles, setPendingFiles] = useState<File[]>([]);
    const [uploading, setUploading] = useState(false);
    const [showUploadConfirm, setShowUploadConfirm] = useState(false);

    // Delete state
    const [deleteTarget, setDeleteTarget] = useState<KBDocument | null>(null);
    const [deleting, setDeleting] = useState(false);

    // Re-ingest state
    const [resyncing, setResyncing] = useState(false);
    const [resyncResult, setResyncResult] = useState<string>('');
    const [reingestConfirmOpen, setReingestConfirmOpen] = useState(false);

    const [activeTab, setActiveTab] = useState<'files' | 'summary'>('files');
    const [summaryDraft, setSummaryDraft] = useState('');
    const [summarySaved, setSummarySaved] = useState('');
    const [summarySaving, setSummarySaving] = useState(false);
    const [summaryCharLimit, setSummaryCharLimit] = useState(8_000);

    const [previewDoc, setPreviewDoc] = useState<KBDocument | null>(null);
    const [previewUrl, setPreviewUrl] = useState<string | null>(null);
    const [previewLoading, setPreviewLoading] = useState(false);

    useEffect(() => {
        if (agentId) {
            fetchDocuments();
            fetchQuota();
        }
    }, [agentId]);

    useEffect(() => {
        if (!previewDoc) return;
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                setPreviewDoc(null);
                setPreviewUrl(null);
            }
        };
        document.addEventListener('keydown', onKey);
        return () => document.removeEventListener('keydown', onKey);
    }, [previewDoc]);

    const fetchDocuments = async () => {
        try {
            setLoading(true);
            const res = await fetch(`${API_BASE}/api/documents/agent/${agentId}`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (!res.ok) throw new Error('Failed to load documents');
            const data = await res.json();
            setDocuments(data.documents);
            setAgentName(data.agentName);
            const ks = typeof data.knowledgeSummary === 'string' ? data.knowledgeSummary : '';
            setSummarySaved(ks);
            setSummaryDraft(ks);
            if (typeof data.knowledgeSummaryMaxChars === 'number' && data.knowledgeSummaryMaxChars > 0) {
                setSummaryCharLimit(data.knowledgeSummaryMaxChars);
            }
        } catch (err: any) {
            const msg = err.message || 'Failed to load documents';
            setError(msg);
            toast.error('Could not load knowledge base', msg);
        } finally {
            setLoading(false);
        }
    };

    const fetchQuota = async () => {
        try {
            const res = await fetch(`${API_BASE}/api/upload/remaining`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (res.ok) setDocQuota(await res.json());
        } catch {
            // non-critical
        }
    };

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (!e.target.files) return;
        const newFiles = Array.from(e.target.files);
        setPendingFiles(prev => {
            const existing = new Set(prev.map(f => f.name + f.size));
            return [...prev, ...newFiles.filter(f => !existing.has(f.name + f.size))];
        });
        e.target.value = '';
    };

    const removePendingFile = (index: number) => {
        setPendingFiles(prev => prev.filter((_, i) => i !== index));
    };

    const handleUploadClick = () => {
        if (pendingFiles.length === 0) return;

        if (docQuota && docQuota.limit !== -1 && pendingFiles.length > docQuota.remaining) {
            setError(`You selected ${pendingFiles.length} files but only have ${docQuota.remaining} upload(s) remaining this month.`);
            return;
        }
        setError('');
        setShowUploadConfirm(true);
    };

    const doUpload = async () => {
        setShowUploadConfirm(false);
        setUploading(true);
        setError('');

        try {
            const formData = new FormData();
            pendingFiles.forEach(f => formData.append('files', f));
            formData.append('agentId', agentId!);

            const res = await fetch(`${API_BASE}/api/upload/pdf`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}` },
                body: formData
            });

            const data = await res.json();

            if (!res.ok) {
                throw new Error(data.message || data.error || 'Upload failed');
            }

            setPendingFiles([]);
            toast.success('Documents uploaded');
            await Promise.all([fetchDocuments(), fetchQuota()]);
        } catch (err: any) {
            const msg = err.message || 'Upload failed';
            setError(msg);
            toast.error('Upload failed', msg);
        } finally {
            setUploading(false);
        }
    };

    const doDelete = async () => {
        if (!deleteTarget) return;
        setDeleting(true);
        setError('');

        try {
            const res = await fetch(`${API_BASE}/api/documents/${deleteTarget._id}`, {
                method: 'DELETE',
                headers: { 'Authorization': `Bearer ${token}` }
            });

            if (!res.ok) {
                const data = await res.json().catch(() => ({}));
                throw new Error(data.message || 'Delete failed');
            }

            setDocuments(prev => prev.filter(d => d._id !== deleteTarget._id));
            setDeleteTarget(null);
            toast.success('Document deleted');
        } catch (err: any) {
            const msg = err.message || 'Failed to delete document';
            setError(msg);
            toast.error('Delete failed', msg);
        } finally {
            setDeleting(false);
        }
    };

    const summaryDirty = summaryDraft !== summarySaved;

    const saveKnowledgeSummary = async () => {
        setSummarySaving(true);
        setError('');
        try {
            const res = await fetch(`${API_BASE}/api/documents/agent/${agentId}/knowledge-summary`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ summary: summaryDraft }),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                const ks = typeof data.knowledgeSummary === 'string' ? data.knowledgeSummary : null;
                if (ks !== null) {
                    setSummarySaved(ks);
                    setSummaryDraft(ks);
                }
                throw new Error(data.message || 'Failed to save knowledge summary');
            }
            const ks = typeof data.knowledgeSummary === 'string' ? data.knowledgeSummary : summaryDraft;
            setSummarySaved(ks);
            setSummaryDraft(ks);
            toast.success('Knowledge summary saved');
        } catch (err: any) {
            const msg = err.message || 'Failed to save knowledge summary';
            setError(msg);
            toast.error('Save failed', msg);
        } finally {
            setSummarySaving(false);
        }
    };

    const openDocumentPreview = async (doc: KBDocument) => {
        setPreviewDoc(doc);
        setPreviewUrl(null);
        setPreviewLoading(true);
        setError('');
        try {
            const res = await fetch(`${API_BASE}/api/documents/${doc._id}/view`, {
                headers: { 'Authorization': `Bearer ${token}` },
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data.message || 'Could not open document');
            if (typeof data.url !== 'string') throw new Error('Invalid document link');
            setPreviewUrl(data.url);
        } catch (err: any) {
            setPreviewDoc(null);
            setError(err.message || 'Could not open document');
        } finally {
            setPreviewLoading(false);
        }
    };

    const closeDocumentPreview = () => {
        setPreviewDoc(null);
        setPreviewUrl(null);
    };

    const runReingest = async () => {
        setResyncing(true);
        setResyncResult('');
        setError('');
        try {
            const res = await fetch(`${API_BASE}/api/documents/agent/${agentId}/reingest`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.message || 'Re-sync failed');
            setResyncResult(data.message);
            toast.success('Knowledge base re-synced');
            await fetchDocuments();
            await fetchQuota();
        } catch (err: any) {
            const msg = err.message || 'Re-sync failed';
            setError(msg);
            toast.error('Re-sync failed', msg);
        } finally {
            setResyncing(false);
        }
    };

    const doReingest = async () => {
        if (summaryDirty) {
            setReingestConfirmOpen(true);
            return;
        }
        await runReingest();
    };

    const formatBytes = (bytes: number) => {
        if (bytes < 1024) return `${bytes} B`;
        if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
        return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    };

    const formatDate = (iso: string) =>
        new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });

    const remainingAfterUpload = docQuota
        ? (docQuota.limit === -1 ? -1 : docQuota.remaining - pendingFiles.length)
        : null;

    if (loading) {
        return <KnowledgeBasePageSkeleton />;
    }

    return (
        <AnimatedPage className="bg-white pb-12">
            <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 pt-6 pb-10 sm:pt-8">
                <PageBackNav to="/dashboard" label="Back to Dashboard" />

                {/* Header */}
                <div className="bg-white rounded-xl shadow-sm border border-ocean-ice/80 p-6 mb-2">
                    <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                        <div className="flex items-center gap-3">
                            <div className="p-2 bg-ocean-mist rounded-lg">
                                <BookOpen className="h-6 w-6 text-ocean-deep" />
                            </div>
                            <div>
                                <h1 className="text-xl font-bold text-ocean-navy">Knowledge Base</h1>
                                <p className="text-sm text-ocean-deep/80">{agentName}</p>
                            </div>
                        </div>

                        {docQuota && (
                            <div className={`text-sm font-medium px-4 py-2 rounded-full border self-start sm:self-auto ${
                                docQuota.limit === -1
                                    ? 'bg-green-50 border-green-200 text-green-700'
                                    : docQuota.remaining <= 0
                                    ? 'bg-red-50 border-red-200 text-red-700'
                                    : docQuota.remaining <= 5
                                    ? 'bg-amber-50 border-amber-200 text-amber-700'
                                    : 'bg-ocean-powder border-ocean-ice text-ocean-deep'
                            }`}>
                                {docQuota.limit === -1
                                    ? 'Unlimited uploads'
                                    : `${docQuota.remaining} / ${docQuota.limit} uploads remaining this month`}
                            </div>
                        )}
                    </div>

                    {/* Quota info bar */}
                    {docQuota && docQuota.limit !== -1 && (
                        <div className="mt-4 flex items-start gap-2 text-xs text-ocean-deep/80 bg-ocean-powder rounded-lg px-4 py-3">
                            <Info className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                            <span>
                                Monthly upload quota resets on {docQuota.resetsAt ? formatDate(docQuota.resetsAt) : 'the 1st of next month'}.
                                Deleting documents does not restore your monthly quota. The limit tracks upload consumption, not storage.
                            </span>
                        </div>
                    )}
                </div>

                {error && (
                    <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg flex items-center text-red-700 text-sm">
                        <AlertCircle className="h-4 w-4 mr-2 shrink-0" />
                        {error}
                        <button type="button" onClick={() => setError('')} className="ml-auto p-1 hover:text-red-900">
                            <X className="h-4 w-4" />
                        </button>
                    </div>
                )}

                <div className="grid grid-cols-2 gap-1 p-1 bg-white rounded-xl border border-ocean-ice/80 shadow-sm mb-6 w-full">
                    <button
                        type="button"
                        onClick={() => setActiveTab('files')}
                        className={`flex w-full items-center justify-center gap-2 px-3 py-3 rounded-lg text-sm font-semibold transition-colors ${
                            activeTab === 'files'
                                ? 'bg-ocean-deep text-white shadow-sm'
                                : 'text-ocean-deep hover:bg-ocean-powder'
                        }`}
                    >
                        <FolderOpen className="h-4 w-4 shrink-0" />
                        Documents
                    </button>
                    <button
                        type="button"
                        onClick={() => setActiveTab('summary')}
                        className={`flex w-full items-center justify-center gap-2 px-3 py-3 rounded-lg text-sm font-semibold transition-colors ${
                            activeTab === 'summary'
                                ? 'bg-ocean-deep text-white shadow-sm'
                                : 'text-ocean-deep hover:bg-ocean-powder'
                        }`}
                    >
                        <PenLine className="h-4 w-4 shrink-0" />
                        <span className="truncate">Knowledge summary</span>
                        {summaryDirty ? (
                            <span className="h-2 w-2 rounded-full bg-amber-400 shrink-0" title="Unsaved changes" />
                        ) : null}
                    </button>
                </div>

                {activeTab === 'files' && (
                <>
                {/* Upload section */}
                <div className="bg-white rounded-xl shadow-sm border border-ocean-ice/80 p-6 mb-6">
                    <h2 className="text-base font-semibold text-ocean-navy mb-4">Add Documents</h2>

                    <div
                        className="border-2 border-dashed border-ocean-ice rounded-xl p-6 text-center hover:bg-ocean-powder transition-colors cursor-pointer"
                        onClick={() => fileInputRef.current?.click()}
                    >
                        <input
                            ref={fileInputRef}
                            type="file"
                            accept=".pdf"
                            multiple
                            onChange={handleFileChange}
                            className="hidden"
                            aria-label="Select PDF files to upload"
                        />
                        <div className="flex flex-col items-center">
                            <div className="p-3 bg-ocean-powder rounded-full mb-3">
                                <Upload className="h-5 w-5 text-ocean-deep" />
                            </div>
                            <p className="text-sm font-medium text-ocean-navy">Click to select PDF files</p>
                            <p className="text-xs text-ocean-deep/80 mt-1">FAQs, policies, product catalogs, training material</p>
                        </div>
                    </div>

                    {/* Pending files list */}
                    {pendingFiles.length > 0 && (
                        <div className="mt-3 space-y-2">
                            {pendingFiles.map((f, i) => (
                                <div key={i} className="flex items-center justify-between bg-ocean-powder border border-ocean-ice rounded-lg px-4 py-2">
                                    <div className="flex items-center gap-2 min-w-0">
                                        <FileText className="h-4 w-4 text-ocean-rich shrink-0" />
                                        <span className="text-sm text-ocean-deep truncate">{f.name}</span>
                                        <span className="text-xs text-ocean-deep/80 shrink-0">{formatBytes(f.size)}</span>
                                    </div>
                                    <button
                                        type="button"
                                        onClick={() => removePendingFile(i)}
                                        className="p-1 text-ocean-deep/60 hover:text-red-500 transition-colors"
                                        aria-label={`Remove ${f.name}`}
                                    >
                                        <X className="h-4 w-4" />
                                    </button>
                                </div>
                            ))}

                            {docQuota && docQuota.limit !== -1 && pendingFiles.length > docQuota.remaining && (
                                <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
                                    <AlertTriangle className="h-4 w-4 shrink-0" />
                                    Selected {pendingFiles.length} files but only {docQuota.remaining} upload(s) remaining this month.
                                </div>
                            )}

                            <div className="flex justify-end pt-1">
                                <button
                                    type="button"
                                    onClick={handleUploadClick}
                                    disabled={uploading || (docQuota !== null && docQuota.limit !== -1 && pendingFiles.length > docQuota.remaining)}
                                    className="flex items-center gap-2 px-5 py-2 bg-ocean-deep text-white rounded-lg hover:bg-ocean-rich disabled:opacity-50 disabled:cursor-not-allowed font-medium text-sm transition-colors"
                                >
                                    {uploading ? (
                                        <><RefreshCw className="h-4 w-4 animate-spin" /> Uploading...</>
                                    ) : (
                                        <><Upload className="h-4 w-4" /> Upload {pendingFiles.length} File{pendingFiles.length !== 1 ? 's' : ''}</>
                                    )}
                                </button>
                            </div>
                        </div>
                    )}
                </div>

                {/* Documents list + re-sync */}
                <div className="bg-white rounded-xl shadow-sm border border-ocean-ice/80 overflow-hidden">
                    <div className="p-5 sm:p-6 border-b border-ocean-ice/70 bg-gradient-to-br from-ocean-powder/80 to-white">
                        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                            <div>
                                <h2 className="text-base font-semibold text-ocean-navy">
                                    Current Documents
                                    <span className="ml-2 text-sm font-normal text-ocean-deep/80">({documents.length})</span>
                                </h2>
                                <p className="mt-1 text-xs text-ocean-deep/75 max-w-xl leading-relaxed">
                                    PDFs in storage for this agent. Open any file to view it here, or remove it from the knowledge base.
                                </p>
                            </div>
                            <div className="flex flex-col gap-2 sm:flex-row sm:items-center shrink-0">
                                <button
                                    type="button"
                                    onClick={() => void doReingest()}
                                    disabled={resyncing}
                                    className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-ocean-deep text-white text-sm font-semibold hover:bg-ocean-rich disabled:opacity-45 shadow-sm transition-colors"
                                >
                                    <RefreshCw className={`h-4 w-4 ${resyncing ? 'animate-spin' : ''}`} />
                                    {resyncing ? 'Re-syncing…' : 'Re-sync'}
                                </button>
                            </div>
                        </div>
                        {resyncResult ? (
                            <p className="mt-3 text-sm text-green-700 font-medium" aria-live="polite">{resyncResult}</p>
                        ) : null}
                    </div>

                    <div className="p-5 sm:p-6">
                    {documents.length === 0 ? (
                        <div className="text-center py-12">
                            <BookOpen className="h-12 w-12 text-gray-300 mx-auto mb-3" />
                            <p className="text-ocean-deep/80 font-medium">No documents yet</p>
                            <p className="text-sm text-ocean-deep/60 mt-1">Upload PDFs above to build this agent&apos;s knowledge base.</p>
                        </div>
                    ) : (
                        <div className="space-y-2">
                            {documents.map(doc => (
                                <div key={doc._id} className="flex items-center justify-between gap-3 p-4 bg-ocean-powder/60 rounded-xl border border-ocean-ice hover:border-ocean-deep/20 transition-colors">
                                    <div className="flex items-center gap-3 min-w-0">
                                        <div className="p-2 bg-white rounded-lg border border-ocean-ice shrink-0">
                                            <FileText className="h-4 w-4 text-ocean-rich" />
                                        </div>
                                        <div className="min-w-0">
                                            <p className="text-sm font-medium text-ocean-navy truncate">{doc.filename}</p>
                                            <p className="text-xs text-ocean-deep/80">
                                                {formatBytes(doc.fileSize)} · Added {formatDate(doc.createdAt)}
                                            </p>
                                        </div>
                                    </div>
                                    <div className="flex items-center shrink-0 gap-1">
                                        <button
                                            type="button"
                                            onClick={() => void openDocumentPreview(doc)}
                                            className="p-2 text-ocean-deep hover:text-ocean-navy hover:bg-white rounded-lg border border-transparent hover:border-ocean-ice transition-colors"
                                            title="View document"
                                            aria-label={`View ${doc.filename}`}
                                        >
                                            <Eye className="h-4 w-4" />
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => setDeleteTarget(doc)}
                                            className="p-2 text-ocean-deep/60 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                                            title="Delete document"
                                            aria-label={`Delete ${doc.filename}`}
                                        >
                                            <Trash2 className="h-4 w-4" />
                                        </button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                    </div>
                </div>
                </>
                )}

                {activeTab === 'summary' && (
                    <div className="bg-white rounded-xl shadow-sm border border-ocean-ice/80 p-6">
                        <div className="mb-4 space-y-2">
                            <h2 className="text-base font-semibold text-ocean-navy">What this agent should know</h2>
                            <p className="text-sm text-ocean-deep/85 leading-relaxed">
                                Write policies, FAQs, positioning, and edge cases in your own words. This is stored with your agent and embedded for search together with your PDFs. Use short headings and bullet lines so it stays easy to scan.
                            </p>
                        </div>

                        <label htmlFor="kb-summary-editor" className="sr-only">Knowledge summary</label>
                        <textarea
                            id="kb-summary-editor"
                            value={summaryDraft}
                            onChange={(e) => setSummaryDraft(e.target.value)}
                            spellCheck
                            maxLength={summaryCharLimit}
                            className="w-full min-h-[min(24rem,50vh)] rounded-xl border border-ocean-ice bg-ocean-powder/30 p-4 text-sm text-ocean-navy leading-relaxed placeholder:text-ocean-deep/40 focus:outline-none focus:ring-2 focus:ring-ocean-deep/25 focus:border-ocean-deep font-sans"
                            placeholder="Example:&#10;&#10;## Shipping&#10;- Standard: 3-5 business days in the US&#10;- Express: 1-2 days, extra fee&#10;&#10;## Returns&#10;- 30 days, original packaging&#10;- Refund to original payment method"
                        />

                        <div className="flex flex-col-reverse sm:flex-row sm:items-center sm:justify-between gap-3 mt-4">
                            <p className="text-xs text-ocean-deep/70">
                                {summaryDraft.length.toLocaleString()} / {summaryCharLimit.toLocaleString()} characters (plan limit for knowledge summary; separate from monthly PDF upload quota)
                                {summaryDirty ? ' · unsaved changes' : ' · saved'}
                            </p>
                            <div className="flex flex-wrap gap-2 justify-end">
                                <button
                                    type="button"
                                    disabled={!summaryDirty || summarySaving}
                                    onClick={() => { setSummaryDraft(summarySaved); }}
                                    className="px-4 py-2 rounded-lg border border-ocean-ice text-ocean-deep text-sm font-medium hover:bg-ocean-powder disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                                >
                                    Discard changes
                                </button>
                                <button
                                    type="button"
                                    disabled={!summaryDirty || summarySaving}
                                    onClick={() => void saveKnowledgeSummary()}
                                    className="flex items-center gap-2 px-5 py-2 rounded-lg bg-ocean-deep text-white text-sm font-medium hover:bg-ocean-rich disabled:opacity-45 disabled:cursor-not-allowed transition-colors"
                                >
                                    {summarySaving ? (
                                        <><RefreshCw className="h-4 w-4 animate-spin" /> Saving…</>
                                    ) : (
                                        'Save & sync to knowledge base'
                                    )}
                                </button>
                            </div>
                        </div>
                    </div>
                )}
            </div>

            {/* Upload Confirmation Modal */}
            {showUploadConfirm && (
                <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
                    <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-6">
                        <div className="flex items-center gap-3 mb-4">
                            <div className="p-2 bg-ocean-mist rounded-lg">
                                <Upload className="h-5 w-5 text-ocean-deep" />
                            </div>
                            <h3 className="text-lg font-semibold text-ocean-navy">Confirm Upload</h3>
                        </div>

                        <div className="bg-ocean-powder rounded-lg p-4 space-y-2 mb-4">
                            <div className="flex justify-between text-sm">
                                <span className="text-ocean-deep/90">Files to upload</span>
                                <span className="font-semibold text-ocean-navy">{pendingFiles.length}</span>
                            </div>
                            {docQuota && docQuota.limit !== -1 && (
                                <>
                                    <div className="flex justify-between text-sm">
                                        <span className="text-ocean-deep/90">Monthly quota remaining</span>
                                        <span className="font-semibold text-ocean-navy">{docQuota.remaining}</span>
                                    </div>
                                    <div className="flex justify-between text-sm border-t border-ocean-ice pt-2">
                                        <span className="text-ocean-deep/90">Remaining after upload</span>
                                        <span className={`font-semibold ${(remainingAfterUpload ?? 0) < 0 ? 'text-red-600' : 'text-ocean-navy'}`}>
                                            {remainingAfterUpload}
                                        </span>
                                    </div>
                                </>
                            )}
                        </div>

                        <p className="text-xs text-ocean-deep/80 mb-5">
                            Uploads count toward your monthly quota and are not restored if you delete files later.
                        </p>

                        <div className="flex gap-3">
                            <button
                                type="button"
                                onClick={() => setShowUploadConfirm(false)}
                                className="flex-1 px-4 py-2 border border-ocean-ice rounded-lg text-ocean-deep hover:bg-ocean-powder transition-colors"
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                onClick={doUpload}
                                className="flex-1 px-4 py-2 bg-ocean-deep text-white rounded-lg hover:bg-ocean-rich transition-colors font-medium"
                            >
                                Upload {pendingFiles.length} File{pendingFiles.length !== 1 ? 's' : ''}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Delete Confirmation Modal */}
            {deleteTarget && (
                <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
                    <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-6">
                        <div className="flex items-center gap-3 mb-4">
                            <div className="p-2 bg-red-100 rounded-lg">
                                <Trash2 className="h-5 w-5 text-red-600" />
                            </div>
                            <h3 className="text-lg font-semibold text-ocean-navy">Delete Document</h3>
                        </div>

                        <p className="text-sm text-ocean-deep/90 mb-2">
                            Are you sure you want to remove <span className="font-semibold text-ocean-navy">{deleteTarget.filename}</span> from this agent's knowledge base?
                        </p>
                        <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-5">
                            This document will be deleted and its content removed from the AI's memory. Your monthly upload quota will not be restored.
                        </p>

                        <div className="flex gap-3">
                            <button
                                type="button"
                                onClick={() => setDeleteTarget(null)}
                                disabled={deleting}
                                className="flex-1 px-4 py-2 border border-ocean-ice rounded-lg text-ocean-deep hover:bg-ocean-powder transition-colors disabled:opacity-50"
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                onClick={doDelete}
                                disabled={deleting}
                                className="flex-1 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors font-medium disabled:opacity-50 flex items-center justify-center gap-2"
                            >
                                {deleting ? (
                                    <><span className="h-4 w-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Deleting...</>
                                ) : 'Delete'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Document viewer */}
            {previewDoc && (
                <div
                    className="fixed inset-0 z-[60] flex items-center justify-center p-4 sm:p-6 bg-black/55 backdrop-blur-sm"
                    onClick={closeDocumentPreview}
                    role="presentation"
                >
                    <div
                        className="bg-white rounded-2xl shadow-2xl border border-ocean-ice w-full max-w-5xl max-h-[90vh] flex flex-col overflow-hidden"
                        role="dialog"
                        aria-modal="true"
                        aria-labelledby="kb-preview-title"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-ocean-ice bg-ocean-powder/40">
                            <h3 id="kb-preview-title" className="text-sm font-semibold text-ocean-navy truncate pr-2">
                                {previewDoc.filename}
                            </h3>
                            <button
                                type="button"
                                onClick={closeDocumentPreview}
                                className="p-2 rounded-lg text-ocean-deep hover:bg-white hover:text-ocean-navy border border-transparent hover:border-ocean-ice transition-colors shrink-0"
                                aria-label="Close"
                            >
                                <X className="h-5 w-5" />
                            </button>
                        </div>
                        <div className="flex-1 min-h-[50vh] bg-ocean-powder/20 flex items-center justify-center">
                            {previewLoading ? (
                                <div className="text-center py-16">
                                    <RefreshCw className="h-8 w-8 text-ocean-deep animate-spin mx-auto mb-2" />
                                    <p className="text-sm text-ocean-deep/80">Opening document…</p>
                                </div>
                            ) : previewUrl ? (
                                <iframe
                                    title={previewDoc.filename}
                                    src={previewUrl}
                                    className="w-full h-[min(72vh,800px)] border-0 bg-white"
                                />
                            ) : null}
                        </div>
                    </div>
                </div>
            )}
            <ConfirmDialog
                open={reingestConfirmOpen}
                onOpenChange={setReingestConfirmOpen}
                title="Re-sync with unsaved summary?"
                description="You have unsaved changes in Knowledge summary. Re-sync will refresh document data from the server, but unsaved summary edits will stay in the editor until you save or discard them."
                confirmLabel="Continue re-sync"
                loading={resyncing}
                onConfirm={async () => {
                    setReingestConfirmOpen(false);
                    await runReingest();
                }}
            />
        </AnimatedPage>
    );
}
