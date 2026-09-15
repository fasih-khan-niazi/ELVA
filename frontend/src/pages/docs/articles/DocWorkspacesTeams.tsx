import { DocHero, DocH2, DocP, DocUl, DocCallout, DocFigure, DocTable, DocLead } from '../DocsPrimitives';

export default function DocWorkspacesTeams() {
    return (
        <article>
            <DocHero
                title="Workspaces, admins, and teammate seats"
                subtitle="One subscription covers every active user in that workspace. Pending email invites also hold a seat slot so you cannot oversubscribe accidentally while people are still onboarding."
                imageUrl="https://images.unsplash.com/photo-1600880292203-757bb62b4baf?w=1200&q=80&auto=format&fit=crop"
                imageAlt="Professionals meeting at a conference table with laptops"
            />

            <DocLead>
                Enterprises expect &ldquo;business unit &rarr; subscriptions &rarr; users.&rdquo; ELVA models the business unit as a <em>tenant</em> with
                a single Stripe subscription object. That keeps revenue recognition simple but still allows multiple authentications per tenant.
            </DocLead>

            <DocFigure
                src="https://images.unsplash.com/photo-1529333166437-7750a6dd5a70?w=1200&q=80&auto=format&fit=crop"
                alt="Diverse coworkers standing and talking in a bright office"
                caption="Invite colleagues from Profile → Team; they complete password setup through a secure browser link."
                wide
            />

            <DocH2>Seat math in plain language</DocH2>
            <DocP>
                Seats count <strong>workspace members</strong> (admins + teammates). When you send an invite, that pending row also reserves a slot until
                it expires or you revoke it-so you cannot queue twenty invites on a three-seat plan without upgrading.
            </DocP>

            <DocTable
                headers={['Plan (illustrative)', 'Typical seat envelope', 'Notes']}
                rows={[
                    ['Free', '1', 'Single builder or proof-of-concept.'],
                    ['Starter', 'Up to 3', 'Small revenue or customer-success pods.'],
                    ['Pro', 'Up to 5', 'Cross-functional GTM + ops without enterprise paperwork.'],
                    ['Enterprise', 'Unlimited (contractual)', 'Formal MSA + optional domain lock (field ready).'],
                ]}
            />

            <DocH2>Invites that feel enterprise-grade</DocH2>
            <DocUl>
                <li>
                    Admins paste a colleague email; ELVA emails a time-boxed link (&ldquo;magic link style&rdquo;) that forces password creation and
                    Terms acceptance.
                </li>
                <li>
                    If SendGrid is offline in dev, ELVA still stores the invite token and prints a copyable URL server-side-never ship that to production
                    without delivery.
                </li>
                <li>
                    Company workspace admins choose in <strong>Profile → Team</strong> whether invites may go to <em>any</em> email domain or are{' '}
                    <strong>restricted to the same domain as the admin&apos;s sign-in address</strong> (higher security).
                </li>
            </DocUl>

            <DocCallout title="Seat disputes" variant="warning">
                <p className="text-sm leading-relaxed">
                    If someone insists they &ldquo;just need read-only access,&rdquo; they still occupy a seat today. Build a future role matrix if you need
                    auditor or billing-clerk personas without full agent edit rights.
                </p>
            </DocCallout>
        </article>
    );
}
