/**
 * callAnalysisService.ts
 *
 * Post-call AI analysis: given a full transcript, produce a compact summary,
 * BANT breakdown, lead score and recommended disposition.
 *
 * Called at the end of each outbound call. Runs best-effort; if the AI
 * service is unreachable we fall back to a heuristic score.
 */

import axios from 'axios';
import { VoiceTurn } from './voiceModels';
import { voiceLog } from './voiceLogger';
import { CallDisposition, IBantScore } from '../models/outboundContactModel';
import { getAiServiceSecretHeaders } from '../utils/aiServiceSecret';

const log = voiceLog('call-analysis');
const AI_SERVICE_URL = process.env.AI_SERVICE_URL || 'http://localhost:8000';
const AI_ANALYSIS_TIMEOUT_MS = 20_000;

export interface CallAnalysis {
    summary: string;
    bant: IBantScore;
    leadScore: number;        // 0-100
    disposition: CallDisposition;
    tags: string[];
    nextAction: string;
}

// ─── Heuristic fallback ──────────────────────────────────────────────────

function keywordScore(text: string, words: string[]): number {
    const lower = text.toLowerCase();
    return words.reduce((acc, w) => acc + (lower.includes(w) ? 1 : 0), 0);
}

function heuristicScore(transcript: string, baseIntent?: string): CallAnalysis {
    const budget = Math.min(5, keywordScore(transcript, ['budget', 'afford', 'pricing', 'cost', 'we can pay', 'we pay', '$']));
    const authority = Math.min(5, keywordScore(transcript, ['i decide', "i'm the", 'my team', 'i manage', 'i own', 'founder', 'ceo', 'director', 'head of']));
    const need = Math.min(5, keywordScore(transcript, ['problem', 'struggle', 'challenge', 'pain', 'hard time', 'issue', 'need']));
    const timeline = Math.min(5, keywordScore(transcript, ['next week', 'this quarter', 'this month', 'soon', 'asap', 'immediately', 'right now']));

    const bant: IBantScore = { budget, authority, need, timeline };
    const leadScore = Math.round(((budget + authority + need + timeline) / 20) * 100);

    let disposition: CallDisposition = 'hung_up';
    if (baseIntent === 'interested' || baseIntent === 'qualified_interest' || baseIntent === 'meeting_booked') {
        disposition = leadScore >= 60 ? 'qualified_interest' : 'callback_requested';
    } else if (baseIntent === 'not_interested') {
        disposition = 'not_interested';
    } else if (baseIntent === 'do_not_call' || baseIntent === 'dnc') {
        disposition = 'dnc_requested';
    } else if (baseIntent === 'wrong_number') {
        disposition = 'wrong_number';
    } else if (baseIntent === 'gatekeeper') {
        disposition = 'gatekeeper';
    } else if (baseIntent === 'callback') {
        disposition = 'callback_requested';
    } else if (baseIntent === 'transfer' || baseIntent === 'escalate' || baseIntent === 'human_handoff') {
        disposition = 'transferred';
    }

    return {
        summary: transcript.slice(0, 400).replace(/\s+/g, ' ').trim() || 'Call ended without substantive exchange.',
        bant,
        leadScore,
        disposition,
        tags: [],
        nextAction: leadScore >= 60 ? 'Follow up within 24h' : 'Move on or nurture',
    };
}

// ─── Build transcript string ──────────────────────────────────────────────

export async function buildTranscript(sessionId: string): Promise<string> {
    const turns = await VoiceTurn.find({ sessionId }).sort({ turnIndex: 1 });
    const lines: string[] = [];
    for (const t of turns) {
        if (t.inputTranscript) lines.push(`CONTACT: ${t.inputTranscript}`);
        if (t.aiResponse) lines.push(`AGENT: ${t.aiResponse}`);
    }
    return lines.join('\n');
}

// ─── Main analysis entrypoint ─────────────────────────────────────────────

export async function analyzeOutboundCall(
    sessionId: string,
    opts: {
        baseIntent?: string;
        campaignGoal?: string;
        contactName?: string;
    } = {},
): Promise<CallAnalysis> {
    const transcript = await buildTranscript(sessionId);
    if (!transcript.trim()) {
        return heuristicScore('', opts.baseIntent);
    }

    // Try AI-powered analysis; fall back to heuristic if unreachable
    try {
        const resp = await axios.post(
            `${AI_SERVICE_URL}/analyze-call`,
            {
                transcript,
                campaign_goal: opts.campaignGoal || 'qualify_lead',
                contact_name: opts.contactName || '',
                base_intent: opts.baseIntent || '',
            },
            { timeout: AI_ANALYSIS_TIMEOUT_MS, headers: getAiServiceSecretHeaders() },
        );

        const data = resp.data || {};
        const bant: IBantScore = {
            budget: clamp(Number(data.bant?.budget ?? 0), 0, 5),
            authority: clamp(Number(data.bant?.authority ?? 0), 0, 5),
            need: clamp(Number(data.bant?.need ?? 0), 0, 5),
            timeline: clamp(Number(data.bant?.timeline ?? 0), 0, 5),
        };

        const leadScore = typeof data.lead_score === 'number'
            ? clamp(Math.round(data.lead_score), 0, 100)
            : Math.round(((bant.budget + bant.authority + bant.need + bant.timeline) / 20) * 100);

        return {
            summary: (data.summary || transcript.slice(0, 400)).toString().slice(0, 800),
            bant,
            leadScore,
            disposition: normalizeDisposition(data.disposition, opts.baseIntent),
            tags: Array.isArray(data.tags) ? data.tags.map(String).slice(0, 10) : [],
            nextAction: (data.next_action || (leadScore >= 60 ? 'Follow up within 24h' : 'Move on or nurture')).toString().slice(0, 200),
        };
    } catch (err: any) {
        log.warn('analysis-fallback', { detail: { error: err?.message } });
        return heuristicScore(transcript, opts.baseIntent);
    }
}

function clamp(n: number, lo: number, hi: number): number {
    if (Number.isNaN(n)) return lo;
    return Math.max(lo, Math.min(hi, n));
}

function normalizeDisposition(raw: unknown, baseIntent?: string): CallDisposition {
    const valid: CallDisposition[] = [
        'no_contact', 'voicemail_dropped', 'voicemail_no_drop',
        'gatekeeper', 'wrong_number', 'dnc_requested',
        'not_interested', 'objection_unresolved', 'callback_requested',
        'qualified_interest', 'meeting_booked', 'transferred',
        'hung_up', 'technical_failure',
    ];
    if (typeof raw === 'string' && valid.includes(raw as CallDisposition)) return raw as CallDisposition;
    // Best-effort map from base intent
    if (baseIntent === 'interested' || baseIntent === 'qualified_interest') return 'qualified_interest';
    if (baseIntent === 'transfer' || baseIntent === 'escalate') return 'transferred';
    if (baseIntent === 'callback') return 'callback_requested';
    if (baseIntent === 'do_not_call' || baseIntent === 'dnc') return 'dnc_requested';
    if (baseIntent === 'wrong_number') return 'wrong_number';
    if (baseIntent === 'gatekeeper') return 'gatekeeper';
    if (baseIntent === 'not_interested') return 'not_interested';
    return 'hung_up';
}

// ─── Callback time parsing ────────────────────────────────────────────────

/**
 * Parse phrases like "tomorrow 3pm", "next Monday 10am", "in 2 hours",
 * or an ISO datetime into a concrete Date. Best-effort only.
 */
export function parseCallbackTime(phrase: string, baseDate: Date = new Date()): Date | null {
    if (!phrase) return null;
    const trimmed = phrase.trim();

    // Try ISO first
    const iso = new Date(trimmed);
    if (!isNaN(iso.getTime()) && iso.getTime() > baseDate.getTime()) return iso;

    const lower = trimmed.toLowerCase();

    // in X hours / minutes / days
    const relMatch = lower.match(/in\s+(\d+)\s*(minute|minutes|min|hour|hours|hr|hrs|day|days)/);
    if (relMatch) {
        const n = parseInt(relMatch[1], 10);
        const unit = relMatch[2];
        const ms = unit.startsWith('min') ? n * 60_000
            : unit.startsWith('hour') || unit.startsWith('hr') ? n * 3_600_000
            : n * 86_400_000;
        return new Date(baseDate.getTime() + ms);
    }

    // tomorrow / today + optional time
    const timeMatch = lower.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/);
    let hours = 10, minutes = 0;
    if (timeMatch) {
        hours = parseInt(timeMatch[1], 10);
        minutes = timeMatch[2] ? parseInt(timeMatch[2], 10) : 0;
        const ampm = timeMatch[3];
        if (ampm === 'pm' && hours < 12) hours += 12;
        if (ampm === 'am' && hours === 12) hours = 0;
    }

    const result = new Date(baseDate);
    if (lower.includes('tomorrow')) {
        result.setDate(result.getDate() + 1);
        result.setHours(hours, minutes, 0, 0);
        return result;
    }
    if (lower.includes('today') || lower.includes('later')) {
        result.setHours(hours, minutes, 0, 0);
        if (result.getTime() <= baseDate.getTime()) result.setDate(result.getDate() + 1);
        return result;
    }

    // Day-of-week: "next monday 3pm" / "monday 10am"
    const dayMatch = lower.match(/(sun|mon|tue|wed|thu|fri|sat)/);
    if (dayMatch) {
        const dayMap: Record<string, number> = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
        const target = dayMap[dayMatch[1]];
        const current = result.getDay();
        let diff = target - current;
        if (diff <= 0 || lower.includes('next')) diff += 7;
        result.setDate(result.getDate() + diff);
        result.setHours(hours, minutes, 0, 0);
        return result;
    }

    // Default: 24 hours later at a reasonable hour
    const fallback = new Date(baseDate.getTime() + 86_400_000);
    fallback.setHours(10, 0, 0, 0);
    return fallback;
}

// ─── Calling-hours compliance ─────────────────────────────────────────────

export interface CallingHoursCheck {
    allowed: boolean;
    reason?: string;
}

export function isWithinCallingHours(hours: {
    startHour: number;
    endHour: number;
    daysOfWeek: number[];
    timezoneOffsetMinutes: number;
}, now: Date = new Date()): CallingHoursCheck {
    // Apply campaign's timezone offset to get local time at the calling window
    const local = new Date(now.getTime() + hours.timezoneOffsetMinutes * 60_000);
    const utcDay = local.getUTCDay();      // 0-6
    const utcHour = local.getUTCHours();   // 0-23

    if (!hours.daysOfWeek.includes(utcDay)) {
        return { allowed: false, reason: 'outside calling days' };
    }
    if (utcHour < hours.startHour || utcHour >= hours.endHour) {
        return { allowed: false, reason: 'outside calling hours' };
    }
    return { allowed: true };
}
