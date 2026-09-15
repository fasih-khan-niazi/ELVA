import { DocHero, DocH2, DocUl, DocCallout, DocFigure, DocSteps, DocLead } from '../DocsPrimitives';

export default function DocGettingStarted() {
    return (
        <article>
            <DocHero
                title="Getting started in under ten minutes"
                subtitle="Create a workspace, authenticate, pick a plan tier, and publish your first grounded agent. These steps assume you already have ELVA running locally or in a hosted environment."
                imageUrl="https://images.unsplash.com/photo-1460925895917-afdab827c52f?w=1200&q=80&auto=format&fit=crop"
                imageAlt="Analytics and charts on a laptop"
            />

            <DocLead>
                You can register with email and password or Google. Company teams should pick the <em>Company / team</em> path so future
                teammate invites and seat counters line up with procurement expectations. Company sign-up requires a{' '}
                <strong>work email</strong> (personal providers like Gmail or consumer Outlook are rejected).
            </DocLead>

            <DocSteps
                steps={[
                    {
                        title: 'Pick solo vs company onboarding',
                        body: (
                            <p>
                                Solo builders get a one-person workspace instantly-any mainstream email is fine. Company / team asks for a
                                recognizable workspace name and must use your organization&apos;s email domain (not Gmail, Yahoo, personal
                                Outlook, iCloud, etc.).
                            </p>
                        ),
                    },
                    {
                        title: 'Accept the Terms snapshot',
                        body: (
                            <p>
                                Every new account records the active <code className="rounded bg-slate-100 px-1">termsVersion</code> string.
                                When legal ships a new revision, bump the server constant and ask users to reaffirm on sensitive actions.
                            </p>
                        ),
                    },
                    {
                        title: 'Visit Subscription and pick a plan',
                        body: (
                            <p>
                                Free unlocks a tight quota for experiments. Paid tiers unlock richer voice, analytics, alerts and notifications, and
                                materially higher teammate seats. Checkout is Stripe-backed-keep webhooks online in production.
                            </p>
                        ),
                    },
                    {
                        title: 'Create an agent from Dashboard',
                        body: (
                            <p>
                                Start with a chat agent: name it, tune the first message, optionally attach starter knowledge, then open the
                                playground to validate responses before wiring voice or outbound campaigns.
                            </p>
                        ),
                    },
                ]}
            />

            <DocFigure
                src="https://images.unsplash.com/photo-1556742049-0cfed4f6a45d?w=1200&q=80&auto=format&fit=crop"
                alt="Person making a contactless card payment at a retail counter"
                caption="Billing is subscription-first: one Stripe customer per tenant keeps revenue reporting simple for finance."
            />

            <DocH2>Where to click next</DocH2>
            <DocUl>
                <li>
                    <strong>Profile</strong> - Update display name and, for admins, invite teammates with expiring email links.
                </li>
                <li>
                    <strong>Agents → Knowledge</strong> - Upload PDF packets; watch monthly byte limits in the UI when you near plan caps.
                </li>
                <li>
                    <strong>Alerts and notifications</strong> - Wire Slack, email, or webhooks so events like new leads fan out to your stack.
                </li>
            </DocUl>

            <DocCallout title="Before you demo to a buyer" variant="info">
                <p className="text-sm leading-relaxed">
                    Populate at least one grounded document, create a second teammate account, and screenshot the subscription page showing
                    seat usage. Buyers equate seat math with real deployment readiness.
                </p>
            </DocCallout>
        </article>
    );
}
