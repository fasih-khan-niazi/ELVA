import { DocHero, DocH2, DocP, DocUl, DocCallout, DocFigure, DocLead } from '../DocsPrimitives';

export default function DocSecurityData() {
    return (
        <article>
            <DocHero
                title="Security, isolation, and data handling"
                subtitle="ELVA scopes production APIs with signed JWTs carrying tenant identifiers. Middleware re-validates suspended users and mismatched session claims before business logic executes."
                imageUrl="https://images.unsplash.com/photo-1563986768609-322da13575f3?w=1200&q=80&auto=format&fit=crop"
                imageAlt="Mobile phone displaying security lock concept"
            />

            <DocLead>
                This section is narrative guidance-not a certification pack. Pair it with your pen-test reports, DPAs, and subprocessors list when enterprise security teams ask for artifacts.
            </DocLead>

            <DocFigure
                src="https://images.unsplash.com/photo-1555949963-aa79dcee981c?w=1200&q=80&auto=format&fit=crop"
                alt="Server room with blue lighting representing infrastructure"
                caption="Logical isolation is enforced in the application tier today; dedicated clusters per tenant remain an enterprise upsell if customers demand it."
                wide
            />

            <DocH2>Threat modeling highlights</DocH2>
            <DocUl>
                <li>
                    <strong>Token theft</strong> - Use HTTPS everywhere, short-lived sessions where possible, and rotate JWT secrets on compromise.
                </li>
                <li>
                    <strong>Invite abuse</strong> - Tokens expire in seven days; revoke pending invites from Profile when someone forwards the wrong email.
                </li>
                <li>
                    <strong>Insider risk</strong> - Audit admin actions (roadmap) and separate platform operator consoles from tenant routes.
                </li>
                <li>
                    <strong>Third-party AI vendors</strong> - Map which subprocessors touch prompts; some customers require zero-retention agreements.
                </li>
            </DocUl>

            <DocH2>Customer responsibilities</DocH2>
            <DocP>
                You own the content you upload and the lawfulness of campaigns (TCPA-style rules, marketing opt-ins, employment policies for monitoring). ELVA provides tooling; your counsel interprets obligations.
            </DocP>

            <DocCallout title="When procurement escalates" variant="warning">
                <p className="text-sm leading-relaxed">
                    Offer a packet: architecture diagram, tenant isolation explanation, Stripe data flow, invite security description, incident contact tree, and roadmap for SSO / SCIM. Missing any one item usually triggers a cyclical questionnaire loop.
                </p>
            </DocCallout>
        </article>
    );
}
