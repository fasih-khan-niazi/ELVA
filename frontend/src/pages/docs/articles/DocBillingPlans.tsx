import { DocHero, DocH2, DocUl, DocCallout, DocFigure, DocTable, DocLead } from '../DocsPrimitives';

export default function DocBillingPlans() {
    return (
        <article>
            <DocHero
                title="Plans, Stripe, and operational billing"
                subtitle="Every workspace carries exactly one subscription row. Upgrades flow through Stripe Checkout or Customer Portal; webhooks keep Mongo state aligned with payment reality."
                imageUrl="https://images.unsplash.com/photo-1563013544-824ae1b704d3?w=1200&q=80&auto=format&fit=crop"
                imageAlt="Credit card near a laptop keyboard suggesting online payment"
            />

            <DocLead>
                Finance teams care about clean customer IDs, predictable plan codes, and automated dunning. ELVA keeps <code className="rounded bg-slate-100 px-1">stripeCustomerId</code> on the tenant and mirrors plan fields after webhook events.
            </DocLead>

            <DocFigure
                src="https://images.unsplash.com/photo-1554224155-6726b3ff858f?w=1200&q=80&auto=format&fit=crop"
                alt="Person reviewing financial charts on paper and laptop"
                caption="Export-friendly plan names and seat counts help finance reconcile MRR without opening the product."
                wide
            />

            <DocH2>Feature matrix (illustrative)</DocH2>
            <DocTable
                headers={['Capability', 'Free', 'Starter', 'Pro', 'Enterprise']}
                rows={[
                    ['Chat agents', 'Yes', 'Yes', 'Yes', 'Yes'],
                    ['Voice agents', 'No', 'No', 'Yes', 'Yes'],
                    ['Alerts & notifications', 'No', 'Limited', 'Yes', 'Yes'],
                    ['Teammate seats', '1 (solo)', '3 (incl. admin)', '5 (incl. admin)', 'Unlimited (custom)'],
                    ['Priority support', 'No', 'No', 'Optional', 'Yes'],
                ]}
            />

            <DocH2>Operational runbook</DocH2>
            <DocUl>
                <li>Rotate Stripe API keys on the same schedule as other production secrets.</li>
                <li>Monitor webhook delivery logs; a missed <code className="rounded bg-slate-100 px-1">invoice.paid</code> event desyncs entitlements.</li>
                <li>When comping a customer, document it in your CRM and match manual adjustments with Stripe metadata to avoid surprise renewals.</li>
                <li>Future: per-seat Stripe quantities-design your SKUs now so catalog migration is a config change, not a rewrite.</li>
            </DocUl>

            <DocCallout title="Members cannot change billing" variant="info">
                <p className="text-sm leading-relaxed">
                    Standard members can read subscription status but not hit checkout mutations-this avoids shadow IT upgrades and keeps SOC narratives simple.
                </p>
            </DocCallout>
        </article>
    );
}
