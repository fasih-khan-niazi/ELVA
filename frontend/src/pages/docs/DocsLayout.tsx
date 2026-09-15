import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { ArrowLeft, BookOpen } from 'lucide-react';
import type { DocSectionMeta } from './docTypes';

type Props = {
    sections: DocSectionMeta[];
    currentSlug: string;
    children: React.ReactNode;
};

function backLabelFromPath(from?: string): string {
    if (!from) return 'Back to Docs';
    if (from === '/') return 'Back to Home';
    if (from.startsWith('/dashboard')) return 'Back to Dashboard';
    if (from.startsWith('/profile')) return 'Back to Profile';
    if (from.startsWith('/subscription')) return 'Back to Subscription';
    if (from.startsWith('/campaigns')) return 'Back to Campaigns';
    if (from.startsWith('/connectors')) return 'Back to Connectors';
    if (from.includes('analytics')) return 'Back to Analytics';
    return 'Go Back';
}

export function DocsLayout({ sections, currentSlug, children }: Props) {
    const location = useLocation();
    const navigate = useNavigate();
    const fromPath = (location.state as { from?: string } | null)?.from;
    const backLabel = backLabelFromPath(fromPath);

    const handleBack = () => {
        if (fromPath) navigate(fromPath);
        else navigate('/docs');
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
                    <Link
                        to="/docs"
                        state={{ from: fromPath }}
                        className="inline-flex items-center gap-2 text-sm font-semibold text-ocean-navy"
                    >
                        <BookOpen className="h-4 w-4 text-ocean-rich" />
                        Documentation
                    </Link>
                </div>
            </div>

            <div className="max-w-[90rem] mx-auto flex flex-col lg:flex-row">
                <aside className="lg:w-64 xl:w-72 shrink-0 border-b lg:border-b-0 lg:border-r border-slate-200 bg-white/80 lg:min-h-[calc(100vh-4.25rem)] lg:sticky lg:top-[4.25rem] self-start lg:max-h-[calc(100vh-4.25rem)] lg:overflow-y-auto">
                    <nav className="p-4 sm:p-5 space-y-1" aria-label="Documentation sections">
                        <p className="px-3 pb-2 text-[11px] font-bold uppercase tracking-wider text-slate-500">
                            Guides
                        </p>
                        {sections.map((s) => (
                            <NavLink
                                key={s.slug}
                                to={`/docs/${s.slug}`}
                                className={({ isActive }) =>
                                    `block rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
                                        isActive || currentSlug === s.slug
                                            ? 'bg-ocean-navy text-white shadow-md'
                                            : 'text-ocean-deep hover:bg-ocean-powder/80 text-slate-800'
                                    }`
                                }
                            >
                                {s.title}
                            </NavLink>
                        ))}
                    </nav>
                </aside>

                <main className="flex-1 min-w-0 px-4 sm:px-8 lg:px-12 py-10 pb-20">{children}</main>
            </div>
        </div>
    );
}
