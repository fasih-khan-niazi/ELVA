import { Link, useParams, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { ArrowLeft, BookOpen, ArrowRight } from 'lucide-react';
import { DocsLayout } from './docs/DocsLayout';
import { DOC_SECTIONS, docNavMeta, getDocSection } from './docs/docRegistry';
import type { DocSection } from './docs/docRegistry';

function backLabelFromPath(from?: string): string {
    if (!from) return 'Back to ELVA';
    if (from === '/') return 'Back to Home';
    if (from.startsWith('/dashboard')) return 'Back to Dashboard';
    if (from.startsWith('/profile')) return 'Back to Profile';
    if (from.startsWith('/subscription')) return 'Back to Subscription';
    if (from.startsWith('/campaigns')) return 'Back to Campaigns';
    if (from.startsWith('/connectors')) return 'Back to Connectors';
    if (from.startsWith('/global-analytics')) return 'Back to Analytics';
    if (from.startsWith('/chat-analytics') || from.startsWith('/voice-analytics')) return 'Back to Analytics';
    return 'Go Back';
}

function DocsHub({ sections }: { sections: readonly DocSection[] }) {
    const location = useLocation();
    const navigate = useNavigate();
    const fromPath = (location.state as { from?: string } | null)?.from;
    const backLabel = backLabelFromPath(fromPath);

    const handleBack = () => {
        if (fromPath) navigate(fromPath);
        else navigate('/');
    };

    return (
        <div className="bg-white pb-16">
            <div className="border-b border-slate-200/80 bg-white/90 backdrop-blur-sm">
                <div className="max-w-[90rem] mx-auto px-4 sm:px-6 py-4 flex flex-wrap items-center gap-4">
                    <button
                        onClick={handleBack}
                        className="inline-flex items-center gap-2 text-sm font-medium text-ocean-deep hover:text-ocean-navy transition-colors"
                    >
                        <ArrowLeft className="h-4 w-4 shrink-0" />
                        {backLabel}
                    </button>
                    <span className="hidden sm:block h-4 w-px bg-slate-200" aria-hidden />
                    <span className="inline-flex items-center gap-2 text-sm font-semibold text-ocean-navy">
                        <BookOpen className="h-4 w-4 text-ocean-rich" />
                        Documentation
                    </span>
                </div>
            </div>

            <div className="max-w-[90rem] mx-auto px-4 sm:px-6 lg:px-10 py-12 lg:py-16">
                <header className="grid lg:grid-cols-[1fr,min(480px,42%)] gap-10 lg:gap-14 items-center mb-14 lg:mb-20">
                    <div>
                        <p className="text-xs font-bold uppercase tracking-widest text-ocean-rich mb-3">Guides · reference tone</p>
                        <h1 className="text-3xl sm:text-4xl lg:text-[2.75rem] font-bold text-ocean-navy tracking-tight leading-tight">
                            Everything your team needs to run ELVA
                        </h1>
                        <p className="mt-5 text-base sm:text-lg text-slate-600 leading-relaxed max-w-xl">
                            Onboarding, agents, billing, invites, and security-written as plain product documentation with photos and diagrams,
                            not raw markdown dumps. Pick a topic or use the sidebar once you&apos;re inside a guide.
                        </p>
                        <div className="mt-8 flex flex-wrap gap-4">
                            <Link
                                to={`/docs/${DOC_SECTIONS[1]?.slug ?? 'getting-started'}`}
                                state={{ from: fromPath }}
                                className="inline-flex items-center gap-2 rounded-full bg-ocean-navy text-white px-6 py-3 text-sm font-semibold shadow-lg shadow-ocean-navy/20 hover:bg-ocean-deep transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ocean-sky focus-visible:ring-offset-2"
                            >
                                Start here
                                <ArrowRight className="h-4 w-4" aria-hidden />
                            </Link>
                            <Link
                                to={`/docs/${DOC_SECTIONS[0]?.slug ?? 'welcome'}`}
                                state={{ from: fromPath }}
                                className="inline-flex items-center rounded-full border-2 border-ocean-navy/20 bg-white px-6 py-3 text-sm font-semibold text-ocean-navy hover:border-ocean-sky hover:bg-ocean-powder/30 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ocean-sky"
                            >
                                Product overview
                            </Link>
                        </div>
                    </div>
                    <figure className="relative rounded-3xl overflow-hidden border border-slate-200 shadow-2xl shadow-slate-300/40 bg-slate-100 aspect-[4/3] lg:aspect-auto lg:min-h-[280px]">
                        <img
                            src="https://images.unsplash.com/photo-1529333166437-7750a6dd5a70?w=1400&q=80&auto=format&fit=crop"
                            alt="Team collaborating in a bright office"
                            className="absolute inset-0 w-full h-full object-cover"
                            loading="eager"
                        />
                        <figcaption className="sr-only">Teams using ELVA for conversational workflows</figcaption>
                        <div className="absolute inset-0 bg-gradient-to-tr from-ocean-navy/50 via-transparent to-transparent pointer-events-none" />
                    </figure>
                </header>

                <section aria-labelledby="docs-hub-sections-heading">
                    <h2 id="docs-hub-sections-heading" className="sr-only">
                        Documentation sections
                    </h2>
                    <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-6 lg:gap-8">
                        {sections.map((s) => (
                            <Link
                                key={s.slug}
                                to={`/docs/${s.slug}`}
                                state={{ from: fromPath }}
                                className="group flex flex-col rounded-2xl border border-slate-200/90 bg-white shadow-sm shadow-slate-200/50 overflow-hidden hover:border-ocean-sky/50 hover:shadow-xl hover:-translate-y-0.5 transition-all duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ocean-sky focus-visible:ring-offset-2"
                            >
                                <div className="relative h-44 sm:h-48 overflow-hidden bg-slate-100 shrink-0">
                                    <img
                                        src={s.cardImageUrl}
                                        alt=""
                                        className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                                        loading="lazy"
                                    />
                                    <div className="absolute inset-0 bg-gradient-to-t from-ocean-navy/35 to-transparent opacity-90" />
                                    <span className="absolute bottom-3 left-4 text-[11px] font-bold uppercase tracking-wider text-white drop-shadow-md">
                                        {s.eyebrow}
                                    </span>
                                </div>
                                <div className="p-5 sm:p-6 flex flex-col flex-1">
                                    <h3 className="text-lg font-bold text-ocean-navy tracking-tight group-hover:text-ocean-rich transition-colors">
                                        {s.title}
                                    </h3>
                                    <p className="mt-2 text-sm text-slate-600 leading-relaxed flex-1">{s.description}</p>
                                    <span className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-ocean-navy">
                                        Read guide
                                        <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" aria-hidden />
                                    </span>
                                </div>
                            </Link>
                        ))}
                    </div>
                </section>
            </div>
        </div>
    );
}

export default function DocsPage() {
    const { slug } = useParams<{ slug?: string }>();
    const navSections = docNavMeta();

    if (!slug) {
        return <DocsHub sections={DOC_SECTIONS} />;
    }

    const section = getDocSection(slug);
    if (!section) {
        return <Navigate to="/docs" replace />;
    }

    const { Article } = section;

    return (
        <DocsLayout sections={navSections} currentSlug={slug}>
            <Article />
        </DocsLayout>
    );
}
