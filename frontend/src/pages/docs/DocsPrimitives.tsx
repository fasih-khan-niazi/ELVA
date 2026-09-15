/** Shared building blocks for documentation pages (not markdown). */

export function DocHero({
    title,
    subtitle,
    imageUrl,
    imageAlt,
}: {
    title: string;
    subtitle: string;
    imageUrl: string;
    imageAlt: string;
}) {
    return (
        <header className="mb-12 grid lg:grid-cols-2 gap-8 lg:gap-12 items-center">
            <div>
                <h1 className="text-3xl sm:text-4xl font-bold text-ocean-navy tracking-tight leading-tight">{title}</h1>
                <p className="mt-4 text-base sm:text-lg text-slate-600 leading-relaxed">{subtitle}</p>
            </div>
            <figure className="relative overflow-hidden rounded-2xl border border-slate-200 shadow-xl shadow-slate-200/50 bg-slate-100">
                <img src={imageUrl} alt={imageAlt} className="w-full h-56 sm:h-64 lg:h-72 object-cover" loading="lazy" />
                <figcaption className="sr-only">{imageAlt}</figcaption>
            </figure>
        </header>
    );
}

export function DocH2({ children, id }: { children: React.ReactNode; id?: string }) {
    return (
        <h2 id={id} className="scroll-mt-28 text-2xl font-bold text-ocean-navy mt-14 mb-4 first:mt-0 tracking-tight">
            {children}
        </h2>
    );
}

export function DocLead({ children }: { children: React.ReactNode }) {
    return <p className="text-lg text-slate-600 leading-relaxed mb-6">{children}</p>;
}

export function DocP({ children }: { children: React.ReactNode }) {
    return <p className="text-slate-700 leading-relaxed mb-4">{children}</p>;
}

export function DocUl({ children }: { children: React.ReactNode }) {
    return <ul className="list-disc pl-6 space-y-2 text-slate-700 mb-6">{children}</ul>;
}

export function DocOl({ children }: { children: React.ReactNode }) {
    return <ol className="list-decimal pl-6 space-y-2 text-slate-700 mb-6">{children}</ol>;
}

export function DocCallout({
    title,
    variant = 'info',
    children,
}: {
    title: string;
    variant?: 'info' | 'tip' | 'warning';
    children: React.ReactNode;
}) {
    const styles =
        variant === 'warning'
            ? 'border-amber-200 bg-amber-50/90 text-amber-950'
            : variant === 'tip'
              ? 'border-emerald-200 bg-emerald-50/80 text-emerald-950'
              : 'border-ocean-sky/60 bg-ocean-powder/50 text-ocean-navy';
    return (
        <div className={`rounded-xl border px-4 py-4 my-8 ${styles}`}>
            <p className="text-sm font-bold uppercase tracking-wide opacity-90 mb-1">{title}</p>
            <div className="text-sm leading-relaxed opacity-95 space-y-2">{children}</div>
        </div>
    );
}

export function DocFigure({
    src,
    alt,
    caption,
    wide = false,
}: {
    src: string;
    alt: string;
    caption: string;
    wide?: boolean;
}) {
    return (
        <figure className={`my-10 ${wide ? '' : 'max-w-3xl'}`}>
            <div className="overflow-hidden rounded-2xl border border-slate-200 shadow-lg bg-slate-100">
                <img src={src} alt={alt} className="w-full h-48 sm:h-64 object-cover" loading="lazy" />
            </div>
            <figcaption className="mt-2 text-sm text-slate-500 text-center sm:text-left">{caption}</figcaption>
        </figure>
    );
}

export function DocSteps({
    steps,
}: {
    steps: { title: string; body: React.ReactNode }[];
}) {
    return (
        <ol className="space-y-6 my-8 counter-reset-none list-none pl-0">
            {steps.map((step, i) => (
                <li key={i} className="flex gap-4">
                    <span
                        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-ocean-navy text-white text-sm font-bold shadow-md"
                        aria-hidden
                    >
                        {i + 1}
                    </span>
                    <div className="pt-0.5">
                        <p className="font-semibold text-ocean-navy">{step.title}</p>
                        <div className="mt-1 text-slate-700 text-sm leading-relaxed">{step.body}</div>
                    </div>
                </li>
            ))}
        </ol>
    );
}

export function DocTable({
    headers,
    rows,
}: {
    headers: string[];
    rows: (string | number)[][];
}) {
    return (
        <div className="my-8 overflow-x-auto rounded-xl border border-slate-200 shadow-sm">
            <table className="min-w-full text-sm text-left">
                <thead>
                    <tr className="bg-slate-100 border-b border-slate-200">
                        {headers.map((h) => (
                            <th key={h} className="px-4 py-3 font-semibold text-ocean-navy whitespace-nowrap">
                                {h}
                            </th>
                        ))}
                    </tr>
                </thead>
                <tbody>
                    {rows.map((row, ri) => (
                        <tr key={ri} className="border-t border-slate-100 odd:bg-white even:bg-slate-50/50">
                            {row.map((cell, ci) => (
                                <td key={ci} className="px-4 py-3 text-slate-700">
                                    {cell}
                                </td>
                            ))}
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}

export function DocDiagramTenant() {
    return (
        <div
            className="my-10 rounded-2xl border-2 border-ocean-sky/40 bg-ocean-powder/20 p-6 sm:p-8"
            aria-label="Diagram: tenant isolation"
        >
            <p className="text-center text-xs font-bold uppercase tracking-widest text-ocean-deep/60 mb-6">
                Logical architecture
            </p>
            <div className="flex flex-col sm:flex-row items-stretch justify-center gap-4 max-w-3xl mx-auto">
                <div className="flex-1 rounded-xl bg-white border border-slate-200 p-4 text-center shadow-sm">
                    <p className="text-xs font-semibold text-slate-500">Workspace A</p>
                    <p className="mt-3 text-sm text-ocean-navy font-medium">Users · Agents · Docs · CRM data</p>
                    <div className="mt-4 h-2 rounded-full bg-ocean-sky/30" />
                </div>
                <div className="hidden sm:flex items-center text-slate-400 text-xl font-light px-2">≠</div>
                <div className="flex-1 rounded-xl bg-white border border-slate-200 p-4 text-center shadow-sm opacity-90">
                    <p className="text-xs font-semibold text-slate-500">Workspace B</p>
                    <p className="mt-3 text-sm text-ocean-navy font-medium">Fully separate data boundary</p>
                    <div className="mt-4 h-2 rounded-full bg-slate-200" />
                </div>
            </div>
            <p className="text-center text-sm text-slate-600 mt-6 max-w-lg mx-auto">
                Every API call is scoped by your signed-in tenant. Agents and uploads never leak across workspaces at the API
                layer.
            </p>
        </div>
    );
}
