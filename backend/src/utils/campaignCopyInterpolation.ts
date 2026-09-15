/**
 * Replace merge tags / placeholders in outbound campaign copy (opening line,
 * qualifying questions, objection handlers). CRM-only tokens fall back to
 * natural wording so callers never hear raw "{appointmentDate}".
 */

export interface OutboundInterpolationContext {
    contactFirstName: string;
    contactCompany: string;
    contactEmail: string;
    businessName: string;
    repName: string;
    offer: string;
    targetPersona: string;
    valueProps: string[];
    painPoints: string[];
    /** Extra CSV columns (lowercased keys) for {placeholder} merge tags in scripts. */
    csvFields: Record<string, string>;
}

function firstNonEmptyLine(lines: string[] | undefined, fallback: string): string {
    const s = lines?.find((x) => x && String(x).trim());
    return s?.trim() || fallback;
}

function buildFallbackMap(ctx: OutboundInterpolationContext): Record<string, string> {
    return {
        appointmentDate: 'your appointment date',
        appointmentTime: 'your appointment time',
        date: 'that date',
        time: 'that time',
        leadAction: 'connected with our team',
        invoiceNumber: 'your invoice reference',
        amount: 'the amount due',
        dueDate: 'the due date shown',
        email: ctx.contactEmail || 'your email on file',
        eventName: 'our upcoming session',
        eventDate: 'the scheduled date',
        industry: ctx.contactCompany ? 'organizations like yours' : 'your field',
        eventTopic: 'related topics',
        keyTopic: 'key topics',
        keyChallenge: 'common challenges teams face',
        keyPainPoint: 'practical takeaways',
        speaker: 'our speakers',
        socialProof: 'teams like yours',
        interaction: 'visit with us',
        monthsSince: 'a little while',
    };
}

/** Interpolate placeholders in a single string. */
export function interpolateOutboundCampaignText(
    raw: string,
    ctx: OutboundInterpolationContext,
): string {
    if (!raw) return '';

    const primaryPain = firstNonEmptyLine(ctx.painPoints, 'this area');
    const primaryVp = firstNonEmptyLine(ctx.valueProps, 'what we offer');

    const fallbackMap = buildFallbackMap(ctx);
    const placeholders: Record<string, string> = { ...fallbackMap };
    for (const [k, v] of Object.entries(ctx.csvFields || {})) {
        if (v && String(v).trim()) placeholders[k.toLowerCase()] = String(v).trim();
    }

    let s = raw
        .replace(/\{firstName\}/gi, ctx.contactFirstName || 'there')
        .replace(/\{name\}/gi, ctx.contactFirstName || 'there')
        .replace(/\{company\}/gi, ctx.contactCompany || 'your company')
        .replace(/\{businessName\}/gi, ctx.businessName || 'our team')
        .replace(/\{business\}/gi, ctx.businessName || 'our team')
        .replace(/\{agentName\}/gi, ctx.repName || 'your team')
        .replace(/\{rep\}/gi, ctx.repName || 'your team')
        .replace(/\{offer\}/gi, ctx.offer || 'our service')
        .replace(/\{targetPersona\}/gi, ctx.targetPersona || 'teams like yours')
        .replace(/\{primaryValueProp\}/gi, primaryVp)
        .replace(/\{painPoint\}/gi, primaryPain);

    s = s.replace(/\{([a-zA-Z][a-zA-Z0-9_]*)\}/g, (_m, key: string) => placeholders[key.toLowerCase()] ?? '');

    return s.replace(/\s{2,}/g, ' ').trim();
}

export function buildOutboundInterpolationContext(
    campaign: {
        offer?: string;
        targetPersona?: string;
        valueProps?: string[];
        painPoints?: string[];
    },
    contact: {
        name?: string;
        company?: string;
        email?: string;
        customFields?: Record<string, string>;
    } | null,
    resolvedAgent: {
        agentName: string;
        businessName?: string;
        persona?: { name?: string };
    },
): OutboundInterpolationContext {
    const first = contact?.name?.split(/\s+/)[0] || '';
    const repName = resolvedAgent.persona?.name || resolvedAgent.agentName || 'your team';

    const csvFields: Record<string, string> = {};
    if (contact?.customFields && typeof contact.customFields === 'object') {
        for (const [k, v] of Object.entries(contact.customFields)) {
            const val = typeof v === 'string' ? v.trim() : '';
            if (val) csvFields[k.toLowerCase()] = val;
        }
    }

    return {
        contactFirstName: first,
        contactCompany: contact?.company || '',
        contactEmail: contact?.email || '',
        businessName: resolvedAgent.businessName || 'our team',
        repName,
        offer: campaign.offer || '',
        targetPersona: campaign.targetPersona || '',
        valueProps: Array.isArray(campaign.valueProps) ? campaign.valueProps : [],
        painPoints: Array.isArray(campaign.painPoints) ? campaign.painPoints : [],
        csvFields,
    };
}

export function interpolateOutboundCopyArray(
    items: string[],
    ctx: OutboundInterpolationContext,
): string[] {
    return items.map((line) => interpolateOutboundCampaignText(line, ctx));
}

export function interpolateOutboundObjections(
    items: { objection: string; response: string }[],
    ctx: OutboundInterpolationContext,
): { objection: string; response: string }[] {
    return items.map((h) => ({
        objection: interpolateOutboundCampaignText(h.objection || '', ctx),
        response: interpolateOutboundCampaignText(h.response || '', ctx),
    }));
}
