import { DocHero, DocH2, DocP, DocUl, DocCallout, DocFigure, DocLead, DocSteps } from '../DocsPrimitives';

export default function DocAgentsKnowledge() {
    return (
        <article>
            <DocHero
                title="Agents, knowledge, and modality"
                subtitle="Chat agents ship fastest. Voice agents add telephony complexity but unlock campaigns and richer observability when your subscription enables them."
                imageUrl="https://images.unsplash.com/photo-1481627834876-b7833e8f5570?w=1200&q=80&auto=format&fit=crop"
                imageAlt="Open books and notes representing a curated knowledge base for agents"
            />

            <DocLead>
                Each agent owns prompts, tone, summaries, alerts and notifications destinations, catalogs, guardrails. Retrieval calls always include tenant and agent identifiers so embeddings stay partitioned logically in the backend.
            </DocLead>

            <DocFigure
                src="https://images.unsplash.com/photo-1531482615713-2afd69097998?w=1200&q=80&auto=format&fit=crop"
                alt="Designer collaborating at laptop with sticky notes nearby"
                caption="Treat prompts like product copy: iterate with marketing, revise with compliance, regression-test before production traffic."
            />

            <DocH2>Grounding playbook</DocH2>
            <DocSteps
                steps={[
                    {
                        title: 'Upload only high-signal PDFs',
                        body: <p>Policy manuals, SKU sheets, FAQs-not every slide deck deserves embedding budget.</p>,
                    },
                    {
                        title: 'Maintain a knowledge summary block',
                        body: <p>Use it for prices or promos that change weekly without re-ingesting entire files.</p>,
                    },
                    {
                        title: 'Run adversarial tests',
                        body: <p>Voice amplifies guardrail mistakes; script refusals for regulated claims and competitor comparisons.</p>,
                    },
                    {
                        title: 'Tie insights to analytics',
                        body: <p>Correlate drop-off intents with missing documentation-then close the loop by updating knowledge.</p>,
                    },
                ]}
            />

            <DocH2>Voice-specific cautions</DocH2>
            <DocP>
                STT/TTS vendors, carrier agreements, and disclosure laws differ by region. Build visible escalation paths (transfer to human, leave voicemail) and document consent capture if you record.
            </DocP>

            <DocUl>
                <li>Latency budgets: buyers will ask for tail numbers on first-line voice.</li>
                <li>Outbound dialing may require scrubbed lists and quiet hours-coordinate with counsel.</li>
                <li>Keep browser QA lines separate from production TN inventory for cleaner metrics.</li>
            </DocUl>

            <DocCallout title="Shipping checklist" variant="tip">
                <p className="text-sm leading-relaxed">
                    Snapshot prompt versions, retrieval chunk counts, and failover messages before major launches. Incident response is easier when you can diff configs quickly.
                </p>
            </DocCallout>
        </article>
    );
}
