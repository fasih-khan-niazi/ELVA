import { useCallback, useEffect, useState } from 'react';
import { Globe, Copy, Check } from 'lucide-react';
import { useToast } from './Toast';
import ConfirmDialog from './ConfirmDialog';
import { copyWithToast } from '@/lib/apiError';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3000';

const textareaCls =
    'w-full px-4 py-2 border border-ocean-ice rounded-lg focus:ring-2 focus:ring-ocean-bright focus:border-ocean-deep outline-none transition-all resize-none';

type Props = {
    agentId: string;
    token: string;
};

function CopyIconButton({
    ariaLabel,
    copied,
    onCopy,
}: {
    ariaLabel: string;
    copied: boolean;
    onCopy: () => void;
}) {
    return (
        <button
            type="button"
            onClick={onCopy}
            className={`shrink-0 inline-flex h-9 w-9 items-center justify-center rounded-lg border transition ${
                copied
                    ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                    : 'border-ocean-ice bg-white text-ocean-deep hover:bg-ocean-powder'
            }`}
            aria-label={ariaLabel}
            title={copied ? 'Copied' : ariaLabel}
        >
            {copied ? <Check className="h-4 w-4" aria-hidden /> : <Copy className="h-4 w-4" aria-hidden />}
        </button>
    );
}

export default function WebsiteChatSetupPanel({ agentId, token }: Props) {
    const toast = useToast();
    const [published, setPublished] = useState(false);
    const [origins, setOrigins] = useState('');
    const [lastToken, setLastToken] = useState<string | null>(null);
    const [snippet, setSnippet] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const [loadError, setLoadError] = useState('');
    const [banner, setBanner] = useState('');
    const [secretCopied, setSecretCopied] = useState(false);
    const [snippetCopied, setSnippetCopied] = useState(false);
    const [embedKeyExists, setEmbedKeyExists] = useState(false);
    const [rotateConfirmOpen, setRotateConfirmOpen] = useState(false);

    const load = useCallback(async () => {
        setLoadError('');
        try {
            const res = await fetch(`${API_BASE}/api/agents/${agentId}`, {
                headers: { Authorization: `Bearer ${token}` },
            });
            if (!res.ok) throw new Error('Could not load agent');
            const agent = await res.json();
            if (agent.type !== 'chat') {
                setLoadError('Chat agents only.');
                return;
            }
            setPublished(agent.chatEmbedPublished || false);
            setOrigins((agent.chatEmbedAllowedOrigins || []).join('\n'));
            setEmbedKeyExists(Boolean(agent.chatEmbedKeyId));
            setLastToken(null);
            setSnippet(null);
        } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : 'Load failed';
            setLoadError(msg);
        }
    }, [agentId, token]);

    useEffect(() => {
        void load();
    }, [load]);

    const copySecret = async () => {
        if (!lastToken) return;
        const ok = await copyWithToast(lastToken, toast, 'Embed secret copied');
        if (ok) {
            setSecretCopied(true);
            window.setTimeout(() => setSecretCopied(false), 2000);
        }
    };

    const copySnippet = async () => {
        if (!snippet) return;
        const ok = await copyWithToast(snippet, toast, 'Embed code copied');
        if (ok) {
            setSnippetCopied(true);
            window.setTimeout(() => setSnippetCopied(false), 2000);
        }
    };

    const save = async (rotateKey: boolean) => {
        setBusy(true);
        setBanner('');
        setSecretCopied(false);
        setSnippetCopied(false);
        try {
            const allowedOrigins = origins
                .split(/\r?\n/)
                .map((line) => line.trim())
                .filter(Boolean);
            const res = await fetch(`${API_BASE}/api/agents/${agentId}/chat-embed`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({
                    published,
                    allowedOrigins,
                    rotateKey,
                }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.message || 'Save failed');
            setEmbedKeyExists(Boolean(data.chatEmbedKeyId));
            if (data.embedToken) setLastToken(data.embedToken);
            setSnippet(data.embedSnippet || null);
            setBanner(
                rotateKey
                    ? 'New secret issued. Copy it now; the prior key is invalid.'
                    : 'Saved.',
            );
            toast.success(rotateKey ? 'New embed secret issued' : 'Website chat settings saved');
        } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : 'Save failed';
            setBanner(msg);
            toast.error('Save failed', msg);
        } finally {
            setBusy(false);
        }
    };

    if (loadError) {
        return (
            <p className="text-sm text-red-700 bg-red-50 border border-red-100 rounded-lg p-4">{loadError}</p>
        );
    }

    const okBanner =
        banner === 'Saved.' || (banner.startsWith('New secret') && !banner.toLowerCase().includes('fail'));

    return (
        <section className="rounded-xl border border-ocean-ice bg-white p-6 shadow-sm">
            <h2 className="text-lg font-semibold text-ocean-navy mb-6 flex items-center gap-2">
                <Globe className="h-5 w-5 text-ocean-rich shrink-0" aria-hidden />
                Publish & embed settings
            </h2>

            {banner && (
                <p
                    className={`text-sm mb-4 rounded-lg px-3 py-2 ${
                        okBanner ? 'bg-emerald-50 text-emerald-900 border border-emerald-100' : 'bg-red-50 text-red-800 border border-red-100'
                    }`}
                >
                    {banner}
                </p>
            )}

            <div className="mb-6">
                <label className="flex items-center gap-2">
                    <input
                        type="checkbox"
                        checked={published}
                        onChange={(e) => setPublished(e.target.checked)}
                        className="h-4 w-4 rounded border-ocean-ice text-ocean-deep focus:ring-ocean-bright"
                    />
                    <span className="text-sm font-medium text-ocean-navy">Published</span>
                </label>
                <p className="mt-2 text-xs text-ocean-deep/80 leading-relaxed pl-7">
                    When off, the public widget and REST endpoints refuse traffic for this embed. Turning it on exposes the agent only together
                    with a valid credential (no secret without creating or rotating a key below).
                </p>
            </div>

            <label className="block text-xs font-semibold uppercase tracking-wide text-ocean-deep/70 mb-1.5">
                Allowed origins
            </label>
            <textarea
                value={origins}
                onChange={(e) => setOrigins(e.target.value)}
                rows={2}
                className={textareaCls}
                placeholder="https://example.com&#10;https://www.example.com"
                title="Browsers sending an Origin matching a line below may call public embed endpoints."
            />

            <div className="flex flex-wrap gap-2 mt-6 mb-6">
                <button
                    type="button"
                    disabled={busy}
                    onClick={() => save(false)}
                    className="px-4 py-2 bg-ocean-deep text-white rounded-lg text-sm font-medium hover:bg-ocean-rich disabled:opacity-50"
                >
                    {busy ? 'Saving…' : 'Save'}
                </button>
                <button
                    type="button"
                    disabled={busy}
                    onClick={() => setRotateConfirmOpen(true)}
                    className="px-4 py-2 border border-ocean-ice text-ocean-deep rounded-lg text-sm font-medium hover:bg-ocean-powder disabled:opacity-50"
                >
                    Rotate secret
                </button>
            </div>

            <p className="text-xs text-ocean-deep/75 mb-4 leading-relaxed">
                The plaintext secret appears only immediately after Save issues a key (first publish without a key, or Rotate). Reloading clears
                that view; the server keeps only a hash. If you missed it, use Rotate to issue a replacement and update every site snippet.
                The embed snippet is only returned together with that one-time secret.
            </p>

            {lastToken && (
                <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5">
                    <div className="flex items-start justify-between gap-2 mb-1">
                        <p className="text-xs font-semibold text-amber-950 shrink-0">Secret · copy once</p>
                        <CopyIconButton ariaLabel="Copy secret" copied={secretCopied} onCopy={() => void copySecret()} />
                    </div>
                    <code className="text-xs break-all text-amber-950 block">{lastToken}</code>
                </div>
            )}
            {snippet && (
                <div>
                    <div className="flex items-center justify-between gap-2 mb-1.5">
                        <p className="text-xs font-semibold uppercase tracking-wide text-ocean-deep/70">Embed code</p>
                        <CopyIconButton
                            ariaLabel="Copy embed code"
                            copied={snippetCopied}
                            onCopy={() => void copySnippet()}
                        />
                    </div>
                    <pre className="text-xs bg-ocean-powder border border-ocean-ice rounded-lg p-3 overflow-x-auto whitespace-pre-wrap break-all">
                        {snippet}
                    </pre>
                </div>
            )}
            {embedKeyExists && lastToken === null && snippet === null ? (
                <p className="mt-4 rounded-lg border border-ocean-ice bg-ocean-mist/30 px-3 py-2 text-xs text-ocean-deep/85 leading-relaxed">
                    This agent already has embed credentials stored. Rotate secret whenever you need a new secret or embed snippet; that invalidates the previous key everywhere it was pasted.
                </p>
            ) : null}

            <ConfirmDialog
                open={rotateConfirmOpen}
                onOpenChange={setRotateConfirmOpen}
                title="Rotate embed secret?"
                description="Existing embeds will stop working immediately. You will need to update the snippet on every site where it is installed."
                confirmLabel="Rotate secret"
                destructive
                loading={busy}
                onConfirm={async () => {
                    setRotateConfirmOpen(false);
                    await save(true);
                }}
            />
        </section>
    );
}
