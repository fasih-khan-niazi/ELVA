import { Mic, Layers, Shield, Sparkles, BookOpen, Radio, Gauge, Zap, ArrowRight } from 'lucide-react';
import { Link } from 'react-router-dom';

/** About ELVA - enterprise AI agents for chat & voice */
export default function About() {
    const pillars = [
        {
            title: 'One platform',
            icon: Layers,
            copy: 'ELVA keeps chat agents, voice SIP/RTP flows, campaigns, alerts and notifications destinations, billing, and knowledge bases under one tenant - so ops teams stop juggling spreadsheets and disparate voice APIs.',
        },
        {
            title: 'Governed intelligence',
            icon: Shield,
            copy: 'Agents pull answers from your documents and approved tools instead of hallucinating freely. Retrieval-grounded replies, usage caps, and per-environment controls match how regulated teams ship AI.',
        },
        {
            title: 'Measured from day one',
            icon: Gauge,
            copy: 'Voice analytics, conversation history, orders, leads, and subscription usage live beside each agent - built for founders who care about SLA, margins, and real adoption.',
        },
    ];

    const flows = [
        {
            step: '01',
            headline: 'Ingest knowledge',
            body: 'Upload manuals, FAQs, catalogs, or connect structured systems. ELVA indexes content for retrieval so agents speak in your brand voice.',
            icon: BookOpen,
        },
        {
            step: '02',
            headline: 'Design agents',
            body: 'Spin up chat assistants for web embeds or voice agents with Twilio-class telephony patterns - inbound reception, outbound campaigns, and browser test calls.',
            icon: Mic,
        },
        {
            step: '03',
            headline: 'Operate & iterate',
            body: 'Review transcripts, escalate edge cases, wire alerts and notifications (Slack, email, webhooks), then tune prompts without redeploying infrastructure.',
            icon: Radio,
        },
    ];

    return (
        <div className="relative min-h-screen overflow-hidden bg-white font-normal">

            {/* Hero */}
            <section className="relative px-4 pb-16 pt-16 md:pb-24 md:pt-16">
                <div className="mx-auto grid max-w-7xl gap-14 lg:grid-cols-[1.1fr_0.95fr] lg:items-center">
                    <div className="space-y-8 animate-fade-up">
                        <div>
                            <h1 className="text-[2.4rem] md:text-[3.25rem] lg:text-[3.6rem] font-bold leading-[1.05] text-ocean-navy">
                                AI agents that{' '}
                                <span className="relative inline-block">
                                    sound like your team
                                    <svg className="absolute bottom-[-4px] left-0 w-full text-ocean-sky" viewBox="0 0 200 8" preserveAspectRatio="none">
                                        <path d="M0 6 Q100 0 200 6" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
                                    </svg>
                                </span>{' '}
                                and scale like software
                            </h1>
                            <p className="mt-8 max-w-xl text-lg font-normal leading-relaxed text-ocean-deep md:text-xl">
                                ELVA is not a generic chatbot showcase product. It is an opinionated control plane for multi-tenant conversational AI: create agents, attach knowledge, expose them on the
                                channels your business already uses, and watch usage & revenue-friendly metrics in the same UI you use to ship updates.
                            </p>
                        </div>
                        <div className="flex flex-wrap gap-4">
                            <Link
                                to="/login"
                                className="inline-flex items-center gap-2 rounded-2xl bg-ocean-navy px-8 py-4 text-sm font-bold uppercase tracking-wide text-white shadow-xl transition-all duration-300 hover:-translate-y-1 hover:bg-ocean-navy hover:shadow-2xl focus-ocean"
                            >
                                Open console
                                <ArrowRight className="h-5 w-5" />
                            </Link>
                            <a
                                href="mailto:sales@elva.ai"
                                className="inline-flex items-center gap-2 rounded-2xl border-2 border-ocean-sky/50 bg-white px-8 py-4 text-sm font-semibold text-ocean-deep transition-all duration-300 hover:border-ocean-navy hover:text-ocean-navy"
                            >
                                Talk to sales
                            </a>
                        </div>
                        <dl className="grid gap-6 sm:grid-cols-3">
                            {[
                                { k: 'Deployments', v: 'Hosted for you' },
                                { k: 'Agents', v: 'Chat + voice' },
                                { k: 'Model safety', v: 'Knowledge-bound' },
                            ].map(({ k, v }) => (
                                <div key={k} className="rounded-2xl border border-white/40 bg-white/80 p-5 shadow-ocean-sm backdrop-blur transition-transform duration-300 hover:-translate-y-1">
                                    <dt className="text-[0.7rem] font-bold uppercase tracking-[0.2em] text-ocean-sky">{k}</dt>
                                    <dd className="mt-2 text-base font-semibold text-ocean-navy">{v}</dd>
                                </div>
                            ))}
                        </dl>
                    </div>
                    <div className="relative">
                        <div className="rounded-[2.5rem] border border-white/30 bg-gradient-to-br from-ocean-navy via-ocean-deep to-ocean-rich p-[1px] shadow-[0_35px_120px_-35px_rgba(3,4,94,0.35)]">
                            <div className="relative overflow-hidden rounded-[2.45rem] bg-gradient-to-br from-white/10 to-white/[0.03] p-8 text-white backdrop-blur-xl">
                                <div className="absolute -right-24 -top-24 h-72 w-72 rounded-full bg-ocean-sky/30 blur-3xl" />
                                <Sparkles className="relative mb-8 h-11 w-11 text-ocean-sky" aria-hidden />
                                <p className="relative text-sm font-semibold uppercase tracking-[0.3em] text-white/70">Product snapshot</p>
                                <p className="relative mt-6 text-2xl font-bold leading-snug">
                                    Alerts and notifications · voice campaign runner · subscription-aware usage · knowledge base versioning.
                                </p>
                                <div className="relative mt-10 space-y-6 text-sm font-normal text-white/85">
                                    <p>Roadmap items ship here first because ELVA is built for teams who need production voice, not weekend prototypes.</p>
                                    <p className="rounded-2xl border border-white/15 bg-white/[0.06] p-4 font-medium text-white">
                                        Behind the scenes ELVA coordinates ASR/TTS providers, call state, and document pipelines so your builders focus on tone, policy, and escalation - not raw telephony
                                        plumbing.
                                    </p>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </section>

            {/* Pillars */}
            <section className="relative border-y border-ocean-sky/20 bg-white/60 py-20 backdrop-blur-sm">
                <div className="mx-auto max-w-7xl px-4">
                    <div className="mx-auto max-w-2xl text-center">
                        <p className="text-sm font-bold uppercase tracking-[0.3em] text-ocean-sky">Why teams choose ELVA</p>
                        <h2 className="mt-4 text-3xl font-bold text-ocean-navy md:text-4xl">Built for operators who own the full stack</h2>
                        <p className="mt-4 font-normal text-ocean-deep">
                            Not a marketing microsite - the same primitives you see in this copy map to real modules in the authenticated product.
                        </p>
                    </div>
                    <div className="mt-16 grid gap-8 md:grid-cols-3 stagger-child">
                        {pillars.map(({ title, icon: Icon, copy }) => (
                            <article
                                key={title}
                                className="rounded-3xl border border-ocean-sky/30 bg-ocean-powder/90 p-8 shadow-ocean-card transition-all duration-300 hover:-translate-y-2 hover:shadow-ocean"
                            >
                                <div className="mb-6 inline-flex rounded-2xl bg-ocean-navy/10 p-4 text-ocean-navy">
                                    <Icon className="h-8 w-8" aria-hidden />
                                </div>
                                <h3 className="mb-4 text-xl font-bold text-ocean-navy">{title}</h3>
                                <p className="font-normal leading-relaxed text-ocean-deep">{copy}</p>
                            </article>
                        ))}
                    </div>
                </div>
            </section>

            {/* Lifecycle */}
            <section className="relative px-4 py-20">
                <div className="mx-auto max-w-7xl">
                    <div className="mb-12 flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
                        <div>
                            <h2 className="text-3xl font-bold text-ocean-navy md:text-4xl">Lifecycle in three beats</h2>
                            <p className="mt-4 max-w-2xl font-normal text-ocean-deep">Document once, automate everywhere ELVA exposes an API or UI affordance.</p>
                        </div>
                        <Zap className="hidden text-ocean-sky md:block md:h-12 md:w-12" aria-hidden />
                    </div>
                    <div className="grid gap-8 lg:grid-cols-3">
                        {flows.map(({ step, headline, body, icon: Icon }) => (
                            <div key={step} className="group relative overflow-hidden rounded-3xl border border-ocean-deep/15 bg-white p-8 shadow-ocean-sm transition-all duration-500 hover:-translate-y-1 hover:shadow-ocean-card">
                                <span className="text-5xl font-bold text-ocean-sky/30">{step}</span>
                                <Icon className="mt-8 h-9 w-9 text-ocean-navy transition-transform duration-300 group-hover:scale-105" aria-hidden />
                                <h3 className="mt-6 text-2xl font-bold text-ocean-navy">{headline}</h3>
                                <p className="mt-4 font-normal leading-relaxed text-ocean-deep">{body}</p>
                            </div>
                        ))}
                    </div>
                </div>
            </section>

            {/* Closing CTA */}
            <section className="relative mb-24 px-4">
                <div className="mx-auto max-w-5xl rounded-[2.75rem] border border-ocean-navy/15 bg-gradient-to-br from-ocean-navy via-ocean-deep to-ocean-navy p-[1px] shadow-2xl">
                    <div className="rounded-[2.7rem] bg-ocean-powder px-8 py-12 text-center md:px-16">
                        <h2 className="text-3xl font-bold text-ocean-navy md:text-4xl">Ready when your roadmap is.</h2>
                        <p className="mx-auto mt-5 max-w-2xl font-normal text-ocean-deep">
                            Sign in from the navbar, provision agents against your Stripe-backed plan limits, or email us if you need bespoke SLAs - we built ELVA to grow with accountable teams.
                        </p>
                        <div className="mt-10 flex flex-wrap justify-center gap-4">
                            <Link
                                to="/login"
                                className="inline-flex min-w-[200px] items-center justify-center rounded-2xl bg-ocean-navy px-8 py-4 text-base font-bold text-white shadow-ocean transition-all duration-300 hover:-translate-y-1 hover:bg-ocean-navy"
                            >
                                Launch workspace
                            </Link>
                            <Link
                                to="/"
                                className="inline-flex min-w-[200px] items-center justify-center rounded-2xl border-2 border-ocean-navy bg-transparent px-8 py-4 text-base font-semibold text-ocean-navy transition-colors duration-300 hover:bg-ocean-navy hover:text-white"
                            >
                                Back to home
                            </Link>
                        </div>
                    </div>
                </div>
            </section>
        </div>
    );
}
