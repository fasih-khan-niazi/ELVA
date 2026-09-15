import DOMPurify from 'dompurify';
import { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import { CheckCircle, Loader2, Eye } from 'lucide-react';
import { API_BASE } from '@/lib/api';

interface Template {
    _id: string;
    name: string;
    description: string;
    source: string;
    event: string;
    channel: string;
    subject?: string;
    body: string;
    isBuiltIn: boolean;
    previewData: Record<string, any>;
}

interface Props {
    source: string;
    channel: string;
    selectedId: string | null;
    onSelect: (id: string) => void;
}

function renderPreview(body: string, data: Record<string, any>): string {
    return body.replace(/\{\{([^}]+)\}\}/g, (_, key) => {
        const parts = key.trim().split('.');
        let val: any = data;
        for (const p of parts) val = val?.[p];
        return val !== undefined && val !== null ? String(val) : `{{${key}}}`;
    });
}

export default function TemplateGallery({ source, channel, selectedId, onSelect }: Props) {
    const { token } = useAuth();
    const [templates, setTemplates] = useState<Template[]>([]);
    const [loading, setLoading] = useState(true);
    const [preview, setPreview] = useState<Template | null>(null);

    useEffect(() => {
        setLoading(true);
        fetch(`${API_BASE}/api/connectors/templates?source=${source}&channel=${channel}`, {
            headers: { Authorization: `Bearer ${token}` },
        })
            .then(r => r.json())
            .then(data => setTemplates(Array.isArray(data) ? data : []))
            .finally(() => setLoading(false));
    }, [source, channel, token]);

    if (loading) return (
        <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-ocean-deep" />
        </div>
    );

    if (templates.length === 0) return (
        <p className="text-sm text-ocean-deep/80 py-4">No templates available for this source + channel combination.</p>
    );

    return (
        <>
            <div className="grid grid-cols-1 gap-3">
                {templates.map(tpl => (
                    <div
                        key={tpl._id}
                        onClick={() => onSelect(tpl._id)}
                        className={`relative p-4 rounded-xl border-2 cursor-pointer transition-all ${
                            selectedId === tpl._id
                                ? 'border-ocean-deep bg-ocean-powder'
                                : 'border-ocean-ice bg-white hover:border-ocean-bright/50 hover:bg-ocean-powder/30'
                        }`}
                    >
                        <div className="flex items-start justify-between gap-3">
                            <div className="flex-1">
                                <div className="flex items-center gap-2">
                                    <span className="font-semibold text-ocean-navy text-sm">{tpl.name}</span>
                                    {tpl.isBuiltIn && (
                                        <span className="text-xs bg-ocean-mist text-ocean-deep px-1.5 py-0.5 rounded">Built-in</span>
                                    )}
                                </div>
                                <p className="text-xs text-ocean-deep/80 mt-0.5">{tpl.description}</p>
                                {tpl.subject && (
                                    <p className="text-xs text-ocean-deep/60 mt-1">Subject: <span className="font-mono">{tpl.subject}</span></p>
                                )}
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                                <button
                                    type="button"
                                    onClick={e => { e.stopPropagation(); setPreview(tpl); }}
                                    className="p-1.5 text-ocean-deep/60 hover:text-ocean-deep rounded-lg hover:bg-ocean-mist"
                                    title="Preview"
                                >
                                    <Eye className="h-4 w-4" />
                                </button>
                                {selectedId === tpl._id && (
                                    <CheckCircle className="h-5 w-5 text-ocean-deep" />
                                )}
                            </div>
                        </div>
                    </div>
                ))}
            </div>

            {/* Preview modal */}
            {preview && (
                <div className="fixed inset-0 bg-black/50 z-[60] flex items-center justify-center p-4" onClick={() => setPreview(null)}>
                    <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[80vh] flex flex-col" onClick={e => e.stopPropagation()}>
                        <div className="flex items-center justify-between p-5 border-b border-ocean-ice/80">
                            <h3 className="font-bold text-ocean-navy">{preview.name} - Preview</h3>
                            <button onClick={() => setPreview(null)} className="p-1.5 text-ocean-deep/80 hover:text-ocean-deep rounded-lg hover:bg-ocean-mist/50">✕</button>
                        </div>
                        <div className="flex-1 overflow-y-auto p-5">
                            {preview.subject && (
                                <div className="mb-4">
                                    <p className="text-xs font-semibold text-ocean-deep/80 uppercase tracking-wide mb-1">Subject</p>
                                    <p className="text-sm bg-ocean-powder rounded-lg p-3 border border-ocean-ice">
                                        {renderPreview(preview.subject, preview.previewData)}
                                    </p>
                                </div>
                            )}
                            <p className="text-xs font-semibold text-ocean-deep/80 uppercase tracking-wide mb-2">Body</p>
                            {preview.channel === 'email' ? (
                                <div
                                    className="border border-ocean-ice rounded-xl overflow-hidden"
                                    dangerouslySetInnerHTML={{
                                        __html: DOMPurify.sanitize(
                                            renderPreview(preview.body, preview.previewData),
                                        ),
                                    }}
                                />
                            ) : (
                                <pre className="text-xs text-ocean-deep bg-ocean-powder rounded-xl p-4 border border-ocean-ice overflow-x-auto whitespace-pre-wrap">
                                    {renderPreview(preview.body, preview.previewData)}
                                </pre>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}
