import type { ComponentType } from 'react';
import type { DocSectionMeta } from './docTypes';
import DocOverview from './articles/DocOverview';
import DocGettingStarted from './articles/DocGettingStarted';
import DocAgentsKnowledge from './articles/DocAgentsKnowledge';
import DocBillingPlans from './articles/DocBillingPlans';
import DocWorkspacesTeams from './articles/DocWorkspacesTeams';
import DocSecurityData from './articles/DocSecurityData';

export type DocSection = DocSectionMeta & {
    Article: ComponentType;
    /** Hero image for the docs hub card */
    cardImageUrl: string;
};

export const DOC_SECTIONS: readonly DocSection[] = [
    {
        slug: 'welcome',
        title: 'Welcome',
        description: 'What ELVA is and how your workspace fits together.',
        eyebrow: 'Overview',
        cardImageUrl:
            'https://images.unsplash.com/photo-1522071820081-009f0129c71c?w=800&q=80&auto=format&fit=crop',
        Article: DocOverview,
    },
    {
        slug: 'getting-started',
        title: 'Getting started',
        description: 'Create an account, pick a plan, and open the dashboard.',
        eyebrow: 'Onboarding',
        cardImageUrl:
            'https://images.unsplash.com/photo-1460925895917-afdab827c52f?w=800&q=80&auto=format&fit=crop',
        Article: DocGettingStarted,
    },
    {
        slug: 'agents',
        title: 'Agents & knowledge',
        description: 'Chat and voice agents, documents, grounding, and guardrails.',
        eyebrow: 'Agents',
        cardImageUrl:
            'https://images.unsplash.com/photo-1481627834876-b7833e8f5570?w=800&q=80&auto=format&fit=crop',
        Article: DocAgentsKnowledge,
    },
    {
        slug: 'plans-and-seats',
        title: 'Plans & seats',
        description: 'How billing and teammate seats work on a shared plan.',
        eyebrow: 'Billing',
        cardImageUrl:
            'https://images.unsplash.com/photo-1563013544-824ae1b704d3?w=800&q=80&auto=format&fit=crop',
        Article: DocBillingPlans,
    },
    {
        slug: 'team-invites',
        title: 'Team invites',
        description: 'Admins, seats, invites, and how colleagues join your workspace.',
        eyebrow: 'Collaboration',
        cardImageUrl:
            'https://images.unsplash.com/photo-1600880292203-757bb62b4baf?w=800&q=80&auto=format&fit=crop',
        Article: DocWorkspacesTeams,
    },
    {
        slug: 'security',
        title: 'Security & data',
        description: 'Tenant isolation, JWTs, and what to tell enterprise security reviewers.',
        eyebrow: 'Trust',
        cardImageUrl:
            'https://images.unsplash.com/photo-1563986768609-322da13575f3?w=800&q=80&auto=format&fit=crop',
        Article: DocSecurityData,
    },
] as const;

export function docNavMeta(): DocSectionMeta[] {
    return DOC_SECTIONS.map(({ slug, title, description, eyebrow }) => ({
        slug,
        title,
        description,
        eyebrow,
    }));
}

export function getDocSection(slug: string): DocSection | undefined {
    return DOC_SECTIONS.find((s) => s.slug === slug);
}
