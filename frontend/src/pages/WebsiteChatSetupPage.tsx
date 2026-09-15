import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { PageBackNav } from '../components/PageBackNav';
import WebsiteChatSetupPanel from '../components/WebsiteChatSetupPanel';
import { MessageSquare, Code2, Shield, Sparkles } from 'lucide-react';

const steps = [
    {
        title: 'Open this page for a chat agent',
        body: 'Only chat-type agents can be embedded. Create one from the dashboard or pick an existing chat agent and use Website Chat from the agent card or editor.',
    },
    {
        title: 'Publish and save',
        body: 'Turn on Published, list allowed site origins if you want to restrict where the widget may run, then Save. Use Rotate secret if a key is ever exposed.',
    },
    {
        title: 'Paste the snippet on your site',
        body: 'Copy the embed code and add it just before </body> on every page where you want the launcher. The script loads the widget and points it at your ELVA API.',
    },
    {
        title: 'Deploy with a public API URL',
        body: 'In production, your backend BASE_URL must be the live HTTPS origin that serves /api/public/chat and /embed/elva-chat.js (usually the same API host) so visitor browsers never call localhost.',
    },
];

export default function WebsiteChatSetupPage() {
    const { token } = useAuth();
    const { agentId } = useParams<{ agentId: string }>();
    const [searchParams] = useSearchParams();
    const navigate = useNavigate();
    const fromCreate = searchParams.get('new') === '1';

    if (!agentId || !token) {
        return (
            <div className="min-h-[40vh] flex items-center justify-center text-ocean-deep px-4">
                <p className="text-sm">Missing session or agent.</p>
            </div>
        );
    }

    return (
        <div className="bg-white min-h-screen pb-16">
            <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 pt-6">
                <PageBackNav to="/dashboard" label="Back" />

                <div className="mt-6 rounded-3xl border border-white/20 bg-gradient-to-br from-ocean-navy via-ocean-deep to-ocean-rich px-6 py-8 text-white shadow-ocean sm:px-10">
                    <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
                        <div className="min-w-0">
                            <div className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-ocean-aqua">
                                <Sparkles className="h-3.5 w-3.5" aria-hidden />
                                Website widget
                            </div>
                            <h1 className="mt-3 text-2xl font-bold tracking-tight sm:text-3xl">Website Chat & embed</h1>
                            <p className="mt-2 max-w-2xl text-sm text-white/85 leading-relaxed">
                                Put your chat agent on your site with one script tag, a rotating credential, and optional origin
                                restrictions. Paste the snippet before <code className="rounded bg-white/15 px-1 py-0.5">&lt;/body&gt;</code>.
                            </p>
                        </div>
                        <div className="flex shrink-0 flex-wrap gap-2">
                            <button
                                type="button"
                                onClick={() => navigate('/dashboard')}
                                className="rounded-xl border border-white/25 bg-white/10 px-4 py-2.5 text-sm font-medium text-white backdrop-blur-sm transition hover:bg-white/20"
                            >
                                Dashboard
                            </button>
                            <button
                                type="button"
                                onClick={() =>
                                    navigate(`/chat/${agentId}`, {
                                        state: { returnTo: `/agents/${agentId}/website-chat` },
                                    })
                                }
                                className="rounded-xl bg-white px-4 py-2.5 text-sm font-semibold text-ocean-navy shadow-sm transition hover:bg-ocean-powder"
                            >
                                Test in console
                            </button>
                        </div>
                    </div>
                </div>

                {fromCreate ? (
                    <p className="mt-4 text-sm text-ocean-deep/75">Chat agent created. Configure the public widget below.</p>
                ) : null}

                <div className="mt-8 grid gap-8 lg:grid-cols-12 lg:items-start">
                    <div className="space-y-6 lg:col-span-5">
                        <section className="rounded-2xl border border-ocean-ice bg-white p-6 shadow-ocean-sm">
                            <h2 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-ocean-deep/70">
                                <MessageSquare className="h-4 w-4 text-ocean-deep" aria-hidden />
                                How it works
                            </h2>
                            <ol className="mt-4 space-y-4">
                                {steps.map((s, i) => (
                                    <li key={s.title} className="flex gap-3">
                                        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-ocean-powder text-xs font-bold text-ocean-navy ring-1 ring-ocean-ice">
                                            {i + 1}
                                        </span>
                                        <div>
                                            <p className="text-sm font-semibold text-ocean-navy">{s.title}</p>
                                            <p className="mt-1 text-sm text-ocean-deep/80 leading-relaxed">{s.body}</p>
                                        </div>
                                    </li>
                                ))}
                            </ol>
                        </section>
                    </div>

                    <div className="space-y-6 lg:col-span-7">
                        <section className="rounded-2xl border border-dashed border-ocean-ice bg-white/80 p-5">
                            <h2 className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-ocean-deep/70">
                                <Code2 className="h-4 w-4" aria-hidden />
                                What "the snippet" is
                            </h2>
                            <p className="mt-2 text-sm text-ocean-deep/85 leading-relaxed">
                                After you save, the server returns a short HTML block: a <code className="rounded bg-ocean-powder px-1 py-0.5 text-xs">&lt;script&gt;</code>{' '}
                                tag whose <code className="rounded bg-ocean-powder px-1 py-0.5 text-xs">src</code> is your API&apos;s{' '}
                                <code className="rounded bg-ocean-powder px-1 py-0.5 text-xs">/embed/elva-chat.js</code>, plus{' '}
                                <code className="rounded bg-ocean-powder px-1 py-0.5 text-xs">data-api-base</code> and agent fields.{' '}
                                <strong className="text-ocean-navy">BASE_URL</strong> in the backend{' '}
                                <code className="rounded bg-ocean-powder px-1 py-0.5 text-xs">.env</code> is what fills those URLs when the snippet is
                                generated. Set it to your production API hostname (HTTPS) before you copy embed code for a live site.
                            </p>
                        </section>

                        <WebsiteChatSetupPanel agentId={agentId} token={token} />
                    </div>
                </div>

                <section className="mt-6 rounded-2xl border border-ocean-ice bg-white p-5 shadow-ocean-sm">
                    <h2 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-ocean-deep/70 mb-3">
                        <Shield className="h-4 w-4 text-ocean-deep" aria-hidden />
                        Security &amp; limits
                    </h2>
                    <div className="grid gap-3 sm:grid-cols-3 text-sm text-ocean-deep/85">
                        <div className="flex gap-2.5">
                            <span className="mt-0.5 h-1.5 w-1.5 shrink-0 rounded-full bg-ocean-rich" />
                            <p><strong className="text-ocean-navy font-semibold">Secret shown once:</strong> copy it immediately after save or rotate and store it like an API key.</p>
                        </div>
                        <div className="flex gap-2.5">
                            <span className="mt-0.5 h-1.5 w-1.5 shrink-0 rounded-full bg-ocean-rich" />
                            <p><strong className="text-ocean-navy font-semibold">Allowed origins:</strong> enter full <code className="rounded bg-ocean-powder px-1 text-xs">https://</code> origins, one per line. <code className="rounded bg-ocean-powder px-1 text-xs">www.example.com</code> and <code className="rounded bg-ocean-powder px-1 text-xs">example.com</code> are treated separately. Leave empty to allow any origin.</p>
                        </div>
                        <div className="flex gap-2.5">
                            <span className="mt-0.5 h-1.5 w-1.5 shrink-0 rounded-full bg-ocean-rich" />
                            <p><strong className="text-ocean-navy font-semibold">Usage &amp; quotas:</strong> widget sessions count toward your workspace plan and appear tagged in analytics.</p>
                        </div>
                    </div>
                </section>
            </div>
        </div>
    );
}
