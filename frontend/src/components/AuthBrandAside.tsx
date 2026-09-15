import { Link } from 'react-router-dom';
import { Shield, BookOpen, Phone, Sparkles, Lock, BarChart3 } from 'lucide-react';

/** Fixed left marketing column. No internal scroll; fills the viewport visually. */
export function AuthBrandAside() {
    return (
        <aside
            className="relative z-20 hidden min-h-0 w-[40%] min-w-[40%] max-w-[40%] flex-col overflow-hidden text-white lg:fixed lg:inset-y-0 lg:left-0 lg:flex"
            style={{
                background: 'linear-gradient(165deg, #071229 0%, #0c4a6e 42%, #0e7490 78%, #155e75 100%)',
            }}
        >
            <div className="pointer-events-none absolute inset-0 opacity-30">
                <div className="absolute -left-20 top-1/4 h-64 w-64 rounded-full bg-cyan-400/30 blur-3xl" />
                <div className="absolute -right-10 bottom-1/4 h-72 w-72 rounded-full bg-sky-400/25 blur-3xl" />
                <div className="absolute left-1/3 top-10 h-px w-32 bg-gradient-to-r from-transparent via-cyan-300/50 to-transparent" />
            </div>

            <div className="relative z-10 flex h-full min-h-0 flex-col overflow-hidden px-7 py-8 xl:px-9 xl:py-9">
                <Link
                    to="/"
                    className="inline-flex shrink-0 items-center gap-2 text-base font-semibold tracking-tight text-white/95 hover:text-white"
                >
                    <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-cyan-400/90 to-sky-700 text-xs font-bold text-slate-950 shadow-lg shadow-cyan-900/40">
                        E
                    </span>
                    ELVA
                </Link>

                <div className="mt-5 min-h-0 flex-1 flex flex-col justify-center gap-5 xl:gap-6">
                    <div>
                        <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-cyan-200/90">
                            Built for revenue &amp; support teams
                        </p>
                        <h1 className="mt-2 max-w-xl bg-gradient-to-br from-white via-cyan-50 to-sky-200 bg-clip-text text-xl font-bold leading-snug text-transparent xl:text-2xl xl:leading-snug">
                            AI agents that talk and listen on your terms.
                        </h1>
                        <p className="mt-2 max-w-xl text-[12px] leading-relaxed text-sky-100/90 xl:text-[13px]">
                            Chat &amp; voice in one stack, grounded on your docs, with analytics your GTM team can
                            actually use: not another black-box demo.
                        </p>
                    </div>

                    <div className="space-y-2">
                        <p className="text-[10px] font-semibold uppercase tracking-wider text-cyan-200/80">
                            Why teams switch
                        </p>
                        <div className="space-y-2">
                            <div className="rounded-xl border border-cyan-400/25 bg-slate-950/35 px-3 py-2.5 shadow-inner shadow-cyan-950/20">
                                <div className="flex items-start gap-2.5">
                                    <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-cyan-500/20 text-cyan-200">
                                        <Phone className="h-3.5 w-3.5" strokeWidth={2} />
                                    </span>
                                    <div>
                                        <p className="text-xs font-semibold text-white">Voice &amp; chat in one flow</p>
                                        <p className="mt-0.5 text-[10px] leading-snug text-sky-200/75">
                                            Outbound campaigns, inbound triage, and Twilio-ready telephony: one playbook,
                                            one audit trail.
                                        </p>
                                    </div>
                                </div>
                            </div>
                            <div className="rounded-xl border border-sky-400/20 bg-slate-950/30 px-3 py-2.5">
                                <div className="flex items-start gap-2.5">
                                    <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-sky-500/20 text-sky-200">
                                        <BookOpen className="h-3.5 w-3.5" strokeWidth={2} />
                                    </span>
                                    <div>
                                        <p className="text-xs font-semibold text-white">Grounded answers, your policies</p>
                                        <p className="mt-0.5 text-[10px] leading-snug text-sky-200/75">
                                            Upload playbooks &amp; contracts; agents cite what you approved, with fewer
                                            hallucinated promises to customers.
                                        </p>
                                    </div>
                                </div>
                            </div>
                            <div className="rounded-xl border border-emerald-400/20 bg-emerald-950/20 px-3 py-2.5">
                                <div className="flex items-start gap-2.5">
                                    <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-emerald-500/20 text-emerald-200">
                                        <BarChart3 className="h-3.5 w-3.5" strokeWidth={2} />
                                    </span>
                                    <div>
                                        <p className="text-xs font-semibold text-white">Talks, transcripts, outcomes</p>
                                        <p className="mt-0.5 text-[10px] leading-snug text-emerald-100/75">
                                            Funnels, SLAs, and cost-per-qualified-lead: exportable metrics ops and
                                            leadership ask for weekly.
                                        </p>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div className="flex flex-wrap gap-1.5">
                        <span className="inline-flex items-center rounded-full border border-fuchsia-400/30 bg-fuchsia-500/10 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-fuchsia-100">
                            <Sparkles className="mr-1 h-2.5 w-2.5" />
                            LLM + rules
                        </span>
                        <span className="inline-flex items-center rounded-full border border-amber-400/35 bg-amber-500/10 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-amber-100">
                            Workspaces
                        </span>
                        <span className="inline-flex items-center rounded-full border border-violet-400/30 bg-violet-500/10 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-violet-100">
                            Role-based access
                        </span>
                    </div>

                    <ul className="space-y-2 text-[10px] leading-snug text-sky-200/80">
                        <li className="flex gap-2">
                            <Lock className="mt-0.5 h-3 w-3 shrink-0 text-cyan-300" />
                            <span>
                                <strong className="text-white">Enterprise-friendly:</strong> JWT-scoped APIs, encrypted
                                sessions, tenant isolation, a posture you can describe in security reviews.
                            </span>
                        </li>
                        <li className="flex gap-2">
                            <Shield className="mt-0.5 h-3 w-3 shrink-0 text-cyan-300" />
                            <span>
                                <strong className="text-white">Plans that scale:</strong> Stripe-backed tiers; add seats
                                as your team grows without rewiring your stack.
                            </span>
                        </li>
                    </ul>
                </div>

                <div className="mt-auto shrink-0 border-t border-white/10 pt-3">
                    <div className="grid grid-cols-3 gap-1.5">
                        <div className="rounded-lg border border-cyan-300/20 bg-gradient-to-b from-white/10 to-white/5 px-1.5 py-1.5">
                            <p className="text-[10px] font-bold tabular-nums text-cyan-100">SOC 2*</p>
                            <p className="mt-0.5 text-[7px] uppercase leading-tight tracking-wide text-sky-300/80">
                                Roadmap
                            </p>
                        </div>
                        <div className="rounded-lg border border-sky-300/20 bg-gradient-to-b from-white/10 to-white/5 px-1.5 py-1.5">
                            <p className="text-[10px] font-bold tabular-nums text-sky-100">AES-256</p>
                            <p className="mt-0.5 text-[7px] uppercase leading-tight tracking-wide text-sky-300/80">
                                Transit*
                            </p>
                        </div>
                        <div className="rounded-lg border border-teal-300/20 bg-gradient-to-b from-white/10 to-white/5 px-1.5 py-1.5">
                            <p className="text-[10px] font-bold text-teal-100">Multi</p>
                            <p className="mt-0.5 text-[7px] uppercase leading-tight tracking-wide text-teal-300/80">
                                Tenant
                            </p>
                        </div>
                    </div>
                    <p className="mt-1.5 text-[8px] italic leading-tight text-slate-500">
                        * Roadmap / typical practice. Confirm in your procurement review.
                    </p>
                    <div className="mt-2 flex flex-wrap gap-x-2 text-[9px] text-slate-400">
                        <span className="inline-flex items-center gap-1 text-cyan-200/90">
                            <Shield className="h-2.5 w-2.5 shrink-0" />
                            JWT APIs · encrypted sessions
                        </span>
                    </div>
                </div>
            </div>
        </aside>
    );
}
