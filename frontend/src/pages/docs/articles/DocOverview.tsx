import {
    DocHero,
    DocH2,
    DocP,
    DocUl,
    DocCallout,
    DocFigure,
    DocDiagramTenant,
    DocLead,
} from '../DocsPrimitives';

export default function DocOverview() {
    return (
        <article>
            <DocHero
                title="How ELVA fits your teams"
                subtitle="ELVA is a workspace-first platform for conversational AI: chat agents, optional voice pipelines, grounded knowledge from your PDFs and notes, plus CRM primitives-all isolated per tenant."
                imageUrl="https://images.unsplash.com/photo-1522071820081-009f0129c71c?w=1200&q=80&auto=format&fit=crop"
                imageAlt="Team collaborating around laptops in an open office"
            />

            <DocLead>
                Think of ELVA as a lightweight GTM stack wrapped around conversational AI: every agent inherits plan limits, and usage is
                scoped so one customer never crosses into another tenant&apos;s data.
            </DocLead>

            <DocDiagramTenant />

            <DocH2>Roles you use every day</DocH2>
            <DocUl>
                <li>
                    <strong className="text-ocean-navy">Workspace admin</strong> - Owns billing, invites teammates, and still uses the same
                    product surfaces (dashboard, agents, analytics) as the rest of the team.
                </li>
                <li>
                    <strong className="text-ocean-navy">Workspace member</strong> - Separate login, shares the same subscription pool and seat
                    limits; cannot change plans unless you promote them.
                </li>
                <li>
                    <strong className="text-ocean-navy">Platform operator</strong> - Internal ELVA tooling (roadmap) for cross-tenant support and
                    compliance; not part of the tenant app.
                </li>
            </DocUl>

            <DocFigure
                src="https://images.unsplash.com/photo-1551434678-e076c223a692?w=1200&q=80&auto=format&fit=crop"
                alt="Developers reviewing dashboard metrics on large monitors"
                caption="Dashboards, campaigns, leads, and voice analytics all read from the same tenant-scoped data layer."
                wide
            />

            <DocH2>What lives inside a workspace</DocH2>
            <DocP>
                The <strong className="text-ocean-navy">Dashboard</strong> is your home for agents. Each agent can be chat-first or voice-first.
                Attach documents for retrieval, tune prompts, wire alerts and notifications, and expose catalog or booking flows where your plan allows.
            </DocP>
            <DocUl>
                <li>
                    <strong>Conversation</strong> - Grounded answers, session history, channel-aware tone.
                </li>
                <li>
                    <strong>Knowledge</strong> - PDF ingestion, monthly upload counters, optional long-form knowledge summaries.
                </li>
                <li>
                    <strong>Growth</strong> - Leads, orders, outbound dialers where voice plans unlock them.
                </li>
                <li>
                    <strong>Compliance posture</strong> - Terms acceptance on onboarding, teammate invites with expiring tokens, audited-friendly API boundaries (extend with platform admin later).
                </li>
            </DocUl>

            <DocCallout title="Operational tip" variant="tip">
                <p className="text-sm leading-relaxed">
                    Procurement-friendly proof: tenancy isolation in JWT-backed APIs + Stripe entitlement snapshots + observable monthly
                    usage counters. Lead with those three when security reviews start.
                </p>
            </DocCallout>
        </article>
    );
}
