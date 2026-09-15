/** Browser-local draft for the multi-step campaign creation wizard (until POST /campaigns succeeds). */

export const CAMPAIGN_WIZARD_LS_KEY = 'elva_campaign_wizard_v1';

export type StoredCreationMethod = 'ai' | 'template' | 'manual';

/** Minimal draft shape persisted to localStorage (mirrors CreateCampaignPage). */
export interface StoredCampaignDraft {
    agentId: string;
    name: string;
    description: string;
    goal: string;
    offer: string;
    targetPersona: string;
    valueProps: string[];
    painPoints: string[];
    openingScript: string;
    qualifyingQuestions: string[];
    objectionHandlers: { objection: string; response: string }[];
    callingHours: { startHour: number; endHour: number; daysOfWeek: number[]; timezoneOffsetMinutes: number };
    maxConcurrentCalls: number;
    retryAttempts: number;
    retryDelayMinutes: number;
    recordingEnabled: boolean;
    consentDisclosure: string;
    honorDnc: boolean;
    creationMethod: StoredCreationMethod;
    templateId?: string;
}

export interface StoredCampaignWizard {
    version: 1;
    method: StoredCreationMethod;
    step: number;
    aiGenerated: boolean;
    draft: StoredCampaignDraft;
    aiPrompt: string;
    selectedTemplateId: string | null;
    updatedAt: number;
}

function safeParse(raw: string | null): StoredCampaignWizard | null {
    if (!raw) return null;
    try {
        const x = JSON.parse(raw) as StoredCampaignWizard;
        if (x && x.version === 1 && typeof x.draft === 'object' && x.method && ['ai', 'template', 'manual'].includes(x.method)) return x;
    } catch {
        /* ignore */
    }
    return null;
}

export function loadCampaignWizardDraft(): StoredCampaignWizard | null {
    if (typeof localStorage === 'undefined') return null;
    return safeParse(localStorage.getItem(CAMPAIGN_WIZARD_LS_KEY));
}

export function saveCampaignWizardDraft(patch: Omit<StoredCampaignWizard, 'version' | 'updatedAt'>): void {
    if (typeof localStorage === 'undefined') return;
    try {
        const payload: StoredCampaignWizard = {
            version: 1,
            updatedAt: Date.now(),
            ...patch,
        };
        localStorage.setItem(CAMPAIGN_WIZARD_LS_KEY, JSON.stringify(payload));
    } catch {
        /* quota / privacy mode */
    }
}

export function clearCampaignWizardDraft(): void {
    if (typeof localStorage === 'undefined') return;
    try {
        localStorage.removeItem(CAMPAIGN_WIZARD_LS_KEY);
    } catch {
        /* ignore */
    }
}

export function peekWizardDraftSummary(): { title: string; updatedAt: number } | null {
    const d = loadCampaignWizardDraft();
    if (!d) return null;
    const title = (d.draft?.name || '').trim() || 'Untitled campaign';
    return { title, updatedAt: d.updatedAt };
}
