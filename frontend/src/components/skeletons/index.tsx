import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

/* ─── Shared building blocks ─────────────────────────────────────────────── */

function BackNavSkeleton() {
    return <Skeleton className="h-4 w-36 mb-6" />;
}

function FilterPillsSkeleton({ count = 7 }: { count?: number }) {
    return (
        <div className="flex gap-2 flex-wrap">
            {Array.from({ length: count }).map((_, i) => (
                <Skeleton key={i} className={`h-9 rounded-lg ${i === 0 ? 'w-16' : 'w-24'}`} />
            ))}
        </div>
    );
}

/** Matches Orders/Leads gradient stat cards */
function GradientStatCardsSkeleton({ count = 4 }: { count?: number }) {
    return (
        <div className={`grid grid-cols-2 gap-4 ${count === 4 ? 'md:grid-cols-4' : 'md:grid-cols-3'}`}>
            {Array.from({ length: count }).map((_, i) => (
                <div key={i} className="rounded-2xl border border-ocean-ice/80 bg-white p-5 shadow-sm overflow-hidden">
                    <Skeleton className="h-10 w-10 rounded-xl mb-3" />
                    <Skeleton className="h-3 w-20 mb-2" />
                    <Skeleton className="h-8 w-14" />
                </div>
            ))}
        </div>
    );
}

/** Matches Dashboard stat cards (icon top-left, title, value, optional bar) */
function DashboardStatCardSkeleton() {
    return (
        <div className="bg-white rounded-xl border border-slate-200/80 p-5">
            <div className="flex items-start justify-between mb-3">
                <Skeleton className="h-10 w-10 rounded-xl" />
                <Skeleton className="h-5 w-10 rounded-full" />
            </div>
            <Skeleton className="h-3 w-24 mb-2" />
            <Skeleton className="h-9 w-16 mb-3" />
            <Skeleton className="h-1 w-full rounded-full" />
        </div>
    );
}

function AgentCardSkeleton({ variant = 'chat' }: { variant?: 'chat' | 'voice' }) {
    return (
        <div className="bg-white rounded-2xl border border-slate-200/80 h-full flex flex-col overflow-hidden">
            <div
                className={cn(
                    'px-5 pt-5 pb-4 border-b rounded-t-2xl',
                    variant === 'chat' ? 'bg-ocean-powder/30 border-ocean-sky/20' : 'bg-slate-200/40 border-slate-200',
                )}
            >
                <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3">
                        <Skeleton className="h-10 w-10 rounded-xl shrink-0" />
                        <div className="space-y-1.5">
                            <Skeleton className="h-4 w-28" />
                            <Skeleton className="h-3 w-16" />
                        </div>
                    </div>
                    <div className="flex gap-1">
                        <Skeleton className="h-7 w-7 rounded-lg" />
                        <Skeleton className="h-7 w-7 rounded-lg" />
                    </div>
                </div>
            </div>
            <div className="px-5 py-4 flex-1 flex flex-col">
                <div className="space-y-2 mb-4">
                    <Skeleton className="h-3 w-full max-w-[140px]" />
                    <Skeleton className="h-3 w-full max-w-[120px]" />
                </div>
                <div className="flex-1" />
                <Skeleton className="h-10 w-full rounded-xl mb-3" />
                <div className="flex flex-wrap gap-2">
                    {Array.from({ length: 5 }).map((_, i) => (
                        <Skeleton key={i} className="h-8 w-[72px] rounded-xl" />
                    ))}
                </div>
            </div>
        </div>
    );
}

function OrderCardSkeleton() {
    return (
        <div className="bg-white rounded-xl border border-ocean-ice shadow-sm overflow-hidden">
            <div className="flex items-center justify-between p-5">
                <div className="flex items-center gap-4 flex-1 min-w-0">
                    <Skeleton className="h-10 w-10 rounded-lg shrink-0" />
                    <div className="flex-1 space-y-2 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                            <Skeleton className="h-4 w-16" />
                            <Skeleton className="h-5 w-20 rounded-full" />
                            <Skeleton className="h-5 w-14 rounded-full" />
                        </div>
                        <Skeleton className="h-3 w-48 max-w-full" />
                    </div>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                    <Skeleton className="h-6 w-16" />
                    <Skeleton className="h-8 w-24 rounded-lg" />
                    <Skeleton className="h-5 w-5 rounded" />
                </div>
            </div>
        </div>
    );
}

function LeadCardSkeleton() {
    return (
        <div className="bg-white rounded-xl border border-ocean-ice shadow-sm overflow-hidden">
            <div className="flex items-center justify-between p-4">
                <div className="flex items-center gap-4 flex-1 min-w-0">
                    <Skeleton className="h-10 w-10 rounded-full shrink-0" />
                    <div className="flex-1 space-y-2 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                            <Skeleton className="h-4 w-24" />
                            <Skeleton className="h-5 w-16 rounded-full" />
                            <Skeleton className="h-5 w-10 rounded-full" />
                            <Skeleton className="h-5 w-12 rounded-full" />
                        </div>
                        <div className="flex gap-3 flex-wrap">
                            <Skeleton className="h-3 w-32" />
                            <Skeleton className="h-3 w-24" />
                        </div>
                    </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                    <Skeleton className="h-8 w-20 rounded-lg" />
                    <Skeleton className="h-4 w-4" />
                </div>
            </div>
        </div>
    );
}

function ConnectorRowSkeleton() {
    return (
        <div className="flex items-center gap-4 rounded-xl border border-ocean-ice bg-white p-5 shadow-sm">
            <Skeleton className="h-9 w-9 rounded-lg shrink-0" />
            <Skeleton className="h-5 w-5 rounded shrink-0" />
            <div className="flex-1 min-w-0 space-y-2">
                <Skeleton className="h-4 w-40" />
                <Skeleton className="h-3 w-56 max-w-full" />
            </div>
            <div className="flex gap-2 shrink-0">
                <Skeleton className="h-8 w-16 rounded-lg" />
                <Skeleton className="h-8 w-16 rounded-lg" />
                <Skeleton className="h-8 w-14 rounded-lg" />
            </div>
        </div>
    );
}

/* ─── Page-level skeletons ───────────────────────────────────────────────── */

export function DashboardSkeleton() {
    return (
        <div className="p-6 max-w-7xl mx-auto space-y-5">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <div className="space-y-2">
                    <Skeleton className="h-8 w-36" />
                    <Skeleton className="h-4 w-64 max-w-full" />
                </div>
                <Skeleton className="h-10 w-32 rounded-xl" />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                {Array.from({ length: 4 }).map((_, i) => (
                    <DashboardStatCardSkeleton key={i} />
                ))}
            </div>

            <div className="bg-white rounded-xl border border-slate-200/80 p-4">
                <div className="flex flex-wrap items-center gap-4 justify-between">
                    <div className="flex items-center gap-3">
                        <Skeleton className="h-9 w-9 rounded-lg" />
                        <div className="space-y-1.5">
                            <Skeleton className="h-4 w-28" />
                            <Skeleton className="h-3 w-36" />
                        </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-5">
                        {Array.from({ length: 3 }).map((_, i) => (
                            <div key={i} className="space-y-1">
                                <Skeleton className="h-3 w-14" />
                                <Skeleton className="h-2 w-24 rounded-full" />
                            </div>
                        ))}
                        <Skeleton className="h-9 w-24 rounded-xl" />
                        <Skeleton className="h-9 w-20 rounded-xl" />
                    </div>
                </div>
            </div>

            <div className="bg-white rounded-xl border border-slate-200 shadow-sm">
                <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
                    <div className="space-y-1">
                        <Skeleton className="h-4 w-24" />
                        <Skeleton className="h-3 w-16" />
                    </div>
                </div>
                <div className="p-6 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                    <AgentCardSkeleton variant="chat" />
                    <AgentCardSkeleton variant="voice" />
                    <AgentCardSkeleton variant="chat" />
                </div>
            </div>
        </div>
    );
}

export function OrdersPageSkeleton() {
    return (
        <div className="bg-white pb-12">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
                <BackNavSkeleton />
                <div className="flex items-center justify-between mb-8">
                    <div className="space-y-2">
                        <div className="flex items-center gap-2">
                            <Skeleton className="h-8 w-8 rounded-lg" />
                            <Skeleton className="h-9 w-32" />
                        </div>
                        <Skeleton className="h-4 w-72 max-w-full" />
                    </div>
                    <div className="flex gap-2">
                        <Skeleton className="h-9 w-20 rounded-lg" />
                        <Skeleton className="h-9 w-20 rounded-lg" />
                        <Skeleton className="h-9 w-24 rounded-lg" />
                    </div>
                </div>
                <GradientStatCardsSkeleton count={3} />
                <div className="mt-8 mb-6">
                    <FilterPillsSkeleton count={7} />
                </div>
                <div className="space-y-4">
                    {Array.from({ length: 5 }).map((_, i) => (
                        <OrderCardSkeleton key={i} />
                    ))}
                </div>
            </div>
        </div>
    );
}

export function LeadsPageSkeleton() {
    return (
        <div className="bg-white pb-12">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
                <BackNavSkeleton />
                <div className="flex items-center justify-between mb-8">
                    <div className="space-y-2">
                        <div className="flex items-center gap-2">
                            <Skeleton className="h-8 w-8 rounded-lg" />
                            <Skeleton className="h-9 w-24" />
                        </div>
                        <Skeleton className="h-4 w-64 max-w-full" />
                    </div>
                    <div className="flex gap-2 flex-wrap">
                        <Skeleton className="h-9 w-28 rounded-lg" />
                        <Skeleton className="h-9 w-20 rounded-lg" />
                        <Skeleton className="h-9 w-20 rounded-lg" />
                        <Skeleton className="h-9 w-24 rounded-lg" />
                    </div>
                </div>
                <GradientStatCardsSkeleton count={4} />
                <div className="mt-8 mb-6 flex gap-3 flex-wrap items-center">
                    <Skeleton className="h-10 flex-1 min-w-[200px] max-w-sm rounded-lg" />
                    <FilterPillsSkeleton count={6} />
                </div>
                <div className="space-y-3">
                    {Array.from({ length: 6 }).map((_, i) => (
                        <LeadCardSkeleton key={i} />
                    ))}
                </div>
            </div>
        </div>
    );
}

export function ConnectorsPageSkeleton() {
    return (
        <div className="bg-white pb-12">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-6 pb-10 sm:pt-8">
                <BackNavSkeleton />
                <div className="mb-8 rounded-3xl border border-ocean-ice/60 bg-slate-200/50 px-6 py-8 sm:px-10">
                    <div className="flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
                        <div className="flex items-center gap-3">
                            <Skeleton className="h-11 w-11 rounded-2xl" />
                            <div className="space-y-2">
                                <Skeleton className="h-8 w-56" />
                                <Skeleton className="h-4 w-72 max-w-full" />
                            </div>
                        </div>
                        <Skeleton className="h-10 w-28 rounded-xl" />
                    </div>
                </div>
                <GradientStatCardsSkeleton count={4} />
                <div className="mt-8 space-y-3">
                    {Array.from({ length: 4 }).map((_, i) => (
                        <ConnectorRowSkeleton key={i} />
                    ))}
                </div>
            </div>
        </div>
    );
}

export function AnalyticsPageSkeleton() {
    return (
        <div className="bg-slate-50 min-h-full pb-12">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
                <BackNavSkeleton />
                <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between mb-8">
                    <div className="space-y-2">
                        <div className="flex items-center gap-2">
                            <Skeleton className="h-7 w-7 rounded" />
                            <Skeleton className="h-8 w-36" />
                        </div>
                        <Skeleton className="h-4 w-32" />
                    </div>
                    <div className="flex flex-wrap items-center gap-3">
                        <div className="flex rounded-lg overflow-hidden border border-ocean-ice">
                            {Array.from({ length: 4 }).map((_, i) => (
                                <Skeleton key={i} className="h-9 w-16 rounded-none" />
                            ))}
                        </div>
                        <Skeleton className="h-9 w-20 rounded-lg" />
                        <Skeleton className="h-9 w-24 rounded-lg" />
                    </div>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                    {Array.from({ length: 4 }).map((_, i) => (
                        <div key={i} className="rounded-xl border border-ocean-ice bg-white p-4">
                            <Skeleton className="h-8 w-8 rounded-lg mb-3" />
                            <Skeleton className="h-3 w-20 mb-2" />
                            <Skeleton className="h-7 w-12" />
                            <Skeleton className="h-3 w-28 mt-2" />
                        </div>
                    ))}
                </div>
                <div className="grid lg:grid-cols-2 gap-6">
                    <div className="rounded-xl border border-ocean-ice bg-white p-6 space-y-4">
                        <Skeleton className="h-5 w-32" />
                        {Array.from({ length: 5 }).map((_, i) => (
                            <div key={i} className="flex justify-between">
                                <Skeleton className="h-4 w-24" />
                                <Skeleton className="h-4 w-12" />
                            </div>
                        ))}
                    </div>
                    <div className="rounded-xl border border-ocean-ice bg-white p-6 space-y-4">
                        <Skeleton className="h-5 w-32" />
                        {Array.from({ length: 5 }).map((_, i) => (
                            <div key={i} className="flex justify-between">
                                <Skeleton className="h-4 w-24" />
                                <Skeleton className="h-4 w-12" />
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
}

export function GlobalAnalyticsSkeleton() {
    return (
        <div className="bg-white pb-12 py-8 px-4 sm:px-6 lg:px-8">
            <div className="max-w-7xl mx-auto space-y-6">
                <BackNavSkeleton />
                <section className="rounded-2xl border border-ocean-ice/90 bg-white shadow-sm overflow-hidden">
                    <div className="p-5 sm:p-6 border-b border-ocean-powder bg-slate-50/70">
                        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                            <div className="space-y-2 flex-1">
                                <div className="flex items-center gap-2">
                                    <Skeleton className="h-7 w-7" />
                                    <Skeleton className="h-8 w-44" />
                                </div>
                                <Skeleton className="h-4 w-full max-w-xl" />
                                <Skeleton className="h-3 w-32" />
                            </div>
                            <div className="grid grid-cols-3 gap-3 shrink-0">
                                {Array.from({ length: 3 }).map((_, i) => (
                                    <Skeleton key={i} className="h-16 w-24 rounded-xl" />
                                ))}
                            </div>
                        </div>
                    </div>
                    <div className="px-5 py-4 flex flex-wrap gap-3">
                        <Skeleton className="h-10 w-36 rounded-lg" />
                        <Skeleton className="h-10 w-40 rounded-lg" />
                        <Skeleton className="h-10 w-28 rounded-lg" />
                    </div>
                </section>
                <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
                    {Array.from({ length: 4 }).map((_, i) => (
                        <div key={i} className="rounded-xl border border-ocean-ice bg-white p-5">
                            <Skeleton className="h-4 w-24 mb-2" />
                            <Skeleton className="h-8 w-20" />
                        </div>
                    ))}
                </div>
                <Skeleton className="h-64 w-full rounded-2xl" />
            </div>
        </div>
    );
}

export function ChatAnalyticsSkeleton() {
    return (
        <div className="bg-white pb-12 py-8 px-4 sm:px-6 lg:px-8">
            <div className="max-w-7xl mx-auto space-y-6">
                <BackNavSkeleton />
                <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                    <div className="space-y-2">
                        <div className="flex items-center gap-2">
                            <Skeleton className="h-7 w-7" />
                            <Skeleton className="h-8 w-40" />
                        </div>
                        <Skeleton className="h-4 w-80 max-w-full" />
                    </div>
                    <div className="flex gap-3">
                        <Skeleton className="h-10 w-36 rounded-lg" />
                        <Skeleton className="h-10 w-24 rounded-lg" />
                        <Skeleton className="h-10 w-24 rounded-lg" />
                    </div>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    {Array.from({ length: 4 }).map((_, i) => (
                        <div key={i} className="rounded-xl border border-ocean-ice bg-white p-4">
                            <Skeleton className="h-8 w-8 rounded-lg mb-2" />
                            <Skeleton className="h-3 w-20 mb-1" />
                            <Skeleton className="h-7 w-14" />
                        </div>
                    ))}
                </div>
                <Skeleton className="h-52 w-full rounded-2xl" />
            </div>
        </div>
    );
}

export function ChatSkeleton({ className }: { className?: string }) {
    return (
        <div className={cn('h-[calc(100vh-4.25rem)] flex flex-col overflow-hidden bg-white', className)}>
            <div className="flex flex-col flex-1 min-h-0 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 pt-3 pb-3">
                <BackNavSkeleton />
                <div className="mb-2 space-y-1">
                    <Skeleton className="h-6 w-40" />
                    <Skeleton className="h-4 w-28" />
                </div>
                <div className="flex gap-3 flex-1 min-h-0">
                    <div className="hidden sm:flex sm:w-52 lg:w-64 shrink-0 bg-white rounded-xl border border-ocean-ice/80 flex-col overflow-hidden">
                        <div className="p-3 border-b border-ocean-ice/80 flex justify-between">
                            <Skeleton className="h-4 w-24" />
                            <Skeleton className="h-7 w-7 rounded-lg" />
                        </div>
                        <div className="flex-1 p-2 space-y-1">
                            {Array.from({ length: 6 }).map((_, i) => (
                                <Skeleton key={i} className="h-12 w-full rounded-lg" />
                            ))}
                        </div>
                    </div>
                    <div className="flex-1 flex flex-col min-w-0 bg-white rounded-xl border border-ocean-ice/80 overflow-hidden">
                        <div className="flex-1 p-4 space-y-4 overflow-hidden">
                            <Skeleton className="h-14 w-3/5 max-w-sm rounded-2xl rounded-tl-sm" />
                            <Skeleton className="h-10 w-2/5 max-w-xs ml-auto rounded-2xl rounded-tr-sm" />
                            <Skeleton className="h-16 w-4/5 max-w-md rounded-2xl rounded-tl-sm" />
                        </div>
                        <div className="p-3 border-t border-ocean-ice/80">
                            <Skeleton className="h-12 w-full rounded-xl" />
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}

export function ProfileSkeleton() {
    return (
        <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8 space-y-8">
            <div className="flex items-center gap-4">
                <Skeleton className="h-16 w-16 rounded-full" />
                <div className="space-y-2">
                    <Skeleton className="h-6 w-40" />
                    <Skeleton className="h-4 w-56" />
                </div>
            </div>
            {Array.from({ length: 3 }).map((_, s) => (
                <div key={s} className="rounded-2xl border border-ocean-ice bg-white p-6 space-y-4">
                    <Skeleton className="h-5 w-32" />
                    {Array.from({ length: 2 }).map((_, i) => (
                        <div key={i} className="space-y-2">
                            <Skeleton className="h-4 w-24" />
                            <Skeleton className="h-10 w-full rounded-lg" />
                        </div>
                    ))}
                </div>
            ))}
        </div>
    );
}

export function RouteGuardSkeleton() {
    return (
        <div className="min-h-screen flex items-center justify-center bg-slate-50">
            <div className="w-full max-w-xs space-y-4 px-6">
                <Skeleton className="h-10 w-10 rounded-full mx-auto" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-3/4 mx-auto" />
            </div>
        </div>
    );
}

function CampaignCardSkeleton() {
    return (
        <div className="rounded-2xl border border-ocean-ice bg-white shadow-sm overflow-hidden">
            <div className="p-5 space-y-4">
                <div className="flex flex-wrap items-center gap-2">
                    <Skeleton className="h-5 w-40" />
                    <Skeleton className="h-5 w-16 rounded-full" />
                    <Skeleton className="h-5 w-20 rounded-full" />
                </div>
                <div className="flex gap-4">
                    <Skeleton className="h-3 w-28" />
                    <Skeleton className="h-3 w-24" />
                </div>
                <div className="grid grid-cols-3 gap-3">
                    {Array.from({ length: 3 }).map((_, i) => (
                        <Skeleton key={i} className="h-12 rounded-lg" />
                    ))}
                </div>
                <Skeleton className="h-1.5 w-full rounded-full" />
            </div>
        </div>
    );
}

export function CampaignsPageSkeleton() {
    return (
        <div className="bg-white pb-12">
            <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 pt-6 sm:pt-8">
                <BackNavSkeleton />
                <div className="mb-8 rounded-3xl border border-ocean-ice/60 bg-slate-200/40 px-6 py-8 sm:px-8">
                    <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
                        <div className="space-y-2">
                            <Skeleton className="h-8 w-52" />
                            <Skeleton className="h-4 w-80 max-w-full" />
                        </div>
                        <div className="flex gap-2">
                            <Skeleton className="h-10 w-28 rounded-xl" />
                            <Skeleton className="h-10 w-36 rounded-xl" />
                        </div>
                    </div>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
                    {Array.from({ length: 4 }).map((_, i) => (
                        <Skeleton key={i} className="h-20 rounded-xl" />
                    ))}
                </div>
                <div className="flex gap-2 mb-6 border-b border-ocean-ice pb-2">
                    {Array.from({ length: 5 }).map((_, i) => (
                        <Skeleton key={i} className="h-8 w-20" />
                    ))}
                </div>
                <div className="space-y-3">
                    {Array.from({ length: 4 }).map((_, i) => (
                        <CampaignCardSkeleton key={i} />
                    ))}
                </div>
            </div>
        </div>
    );
}

export function KnowledgeBasePageSkeleton() {
    return (
        <div className="bg-white pb-12">
            <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 pt-6 pb-10 sm:pt-8">
                <BackNavSkeleton />
                <div className="rounded-xl border border-ocean-ice/80 bg-white p-6 mb-6">
                    <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                        <div className="flex items-center gap-3">
                            <Skeleton className="h-10 w-10 rounded-lg" />
                            <div className="space-y-2">
                                <Skeleton className="h-6 w-44" />
                                <Skeleton className="h-4 w-56" />
                            </div>
                        </div>
                        <Skeleton className="h-9 w-32 rounded-lg" />
                    </div>
                </div>
                <Skeleton className="h-3 w-full rounded-full mb-6" />
                <div className="rounded-xl border border-ocean-ice bg-white p-6 mb-6 space-y-4">
                    <Skeleton className="h-5 w-40" />
                    <Skeleton className="h-24 w-full rounded-xl border-2 border-dashed border-slate-200" />
                </div>
                <div className="space-y-3">
                    {Array.from({ length: 4 }).map((_, i) => (
                        <div key={i} className="flex items-center gap-4 rounded-xl border border-ocean-ice p-4">
                            <Skeleton className="h-10 w-10 rounded-lg shrink-0" />
                            <div className="flex-1 space-y-2">
                                <Skeleton className="h-4 w-48" />
                                <Skeleton className="h-3 w-32" />
                            </div>
                            <Skeleton className="h-8 w-8 rounded-lg" />
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}

export function SubscriptionPageSkeleton() {
    return (
        <div className="bg-white px-4 py-12">
            <div className="max-w-7xl mx-auto">
                <BackNavSkeleton />
                <div className="text-center mb-8 space-y-3">
                    <Skeleton className="h-10 w-64 mx-auto" />
                    <Skeleton className="h-4 w-96 max-w-full mx-auto" />
                </div>
                <div className="grid md:grid-cols-3 gap-6 max-w-5xl mx-auto">
                    {Array.from({ length: 3 }).map((_, i) => (
                        <div key={i} className="rounded-2xl border border-ocean-ice p-6 space-y-4">
                            <Skeleton className="h-6 w-24" />
                            <Skeleton className="h-10 w-20" />
                            <div className="space-y-2 pt-2">
                                {Array.from({ length: 4 }).map((_, j) => (
                                    <Skeleton key={j} className="h-3 w-full" />
                                ))}
                            </div>
                            <Skeleton className="h-10 w-full rounded-xl mt-4" />
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}

function AgentConnectorCardSkeleton() {
    return (
        <div className="bg-white rounded-xl border border-ocean-ice shadow-sm p-5">
            <div className="flex items-start gap-4">
                <Skeleton className="h-9 w-9 rounded-lg shrink-0" />
                <div className="flex-1 space-y-2">
                    <Skeleton className="h-4 w-36" />
                    <Skeleton className="h-3 w-52 max-w-full" />
                    <Skeleton className="h-3 w-40" />
                </div>
                <div className="flex gap-2 shrink-0">
                    <Skeleton className="h-8 w-16 rounded-lg" />
                    <Skeleton className="h-8 w-16 rounded-lg" />
                </div>
            </div>
        </div>
    );
}

export function AgentConnectorsPageSkeleton() {
    return (
        <div className="bg-white pb-12">
            <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 pt-6 pb-10 sm:pt-8">
                <BackNavSkeleton />
                <div className="mb-8 flex flex-col gap-6 sm:flex-row sm:items-start sm:justify-between">
                    <div className="space-y-2">
                        <div className="flex items-center gap-2">
                            <Skeleton className="h-8 w-8 rounded" />
                            <Skeleton className="h-9 w-56" />
                        </div>
                        <Skeleton className="h-4 w-48" />
                    </div>
                    <div className="flex gap-2">
                        <Skeleton className="h-10 w-24 rounded-lg" />
                        <Skeleton className="h-10 w-44 rounded-lg" />
                    </div>
                </div>
                <div className="space-y-4">
                    {Array.from({ length: 3 }).map((_, i) => (
                        <AgentConnectorCardSkeleton key={i} />
                    ))}
                </div>
            </div>
        </div>
    );
}

/** Generic form loading placeholder (Create/Edit Agent) */
export function FormSkeleton({ fields = 6 }: { fields?: number }) {
    return (
        <div className="rounded-xl border border-ocean-ice/80 bg-white p-6 space-y-5">
            <Skeleton className="h-7 w-48" />
            <Skeleton className="h-4 w-full max-w-md" />
            {Array.from({ length: fields }).map((_, i) => (
                <div key={i} className="space-y-2">
                    <Skeleton className="h-4 w-28" />
                    <Skeleton className={`h-10 w-full rounded-lg ${i === fields - 1 ? 'h-24' : ''}`} />
                </div>
            ))}
            <div className="flex gap-3 pt-2">
                <Skeleton className="h-10 w-28 rounded-lg" />
                <Skeleton className="h-10 w-24 rounded-lg" />
            </div>
        </div>
    );
}

export const VoiceAnalyticsSkeleton = ChatAnalyticsSkeleton;

/* Legacy alias */
export { GradientStatCardsSkeleton as StatCardsSkeleton };
