/**
 * voicePromptAdapter.ts
 *
 * Wraps an agent's base system prompt with voice-channel-specific
 * instructions so the LLM produces responses optimised for spoken
 * delivery rather than chat-style markdown.
 *
 * The adapter is called inside the orchestrator *only* for voice
 * sessions - chat sessions continue to use the raw prompt.
 */

import { ResolvedVoiceAgent } from './voiceResolver';

// ─── Configuration ────────────────────────────────────────────────────────

/** Ideal max sentence count per voice turn (soft guidance to the LLM). */
const VOICE_MAX_SENTENCES = parseInt(process.env.VOICE_MAX_SENTENCES || '2', 10);

/** Ideal max character count per voice turn (soft guidance). */
const VOICE_MAX_CHARS = parseInt(process.env.VOICE_MAX_CHARS || '200', 10);

// ─── Voice system preamble ────────────────────────────────────────────────

const VOICE_PREAMBLE = `
You are speaking on a LIVE PHONE CALL.  Follow these rules strictly:

1. **Brevity** - Keep every answer to ${VOICE_MAX_SENTENCES} sentences or fewer
   (≈${VOICE_MAX_CHARS} characters max). Callers cannot scroll - shorter is better.
2. **No formatting** - Never use markdown, bullet points, numbered lists,
   headings, links, code blocks, or any visual formatting.  Write in plain,
   flowing sentences that sound natural when read aloud.
3. **Conversational** - Use contractions ("I'm", "you'll"), simple words,
   and a warm but professional telephone manner.
4. **One topic at a time** - Answer the immediate question. If more detail
   is needed, offer to continue ("Would you like more details on that?")
   rather than dumping everything at once.
5. **Avoid filler** - Do not begin with "Sure!", "Certainly!", "Of course!"
   or other filler phrases.  Go straight to the answer.
6. **Numbers & spelling** - Spell out numbers under 10, use digits for 10+.
   Spell out abbreviations the first time (e.g. say "S-L-A" not "SLA").
   When collecting a phone number, ask ONE short question then stop and listen.
   NEVER demonstrate or explain digit formats (no "zero triple three", no "one two three" examples,
   no "eleven digit", no "starting with zero three"). Same for email: ask naturally, never lecture.
   Payment methods: only mention what appears in the knowledge base — never invent "cash only" rules.
7. **Closing** - When the user's question has been fully addressed, ask
   "Is there anything else I can help with?" instead of repeating the answer.
8. **Content safety** - Never discuss religion, race or ethnicity, political
   opinions, extremist ideologies, explicit content, or academic dishonesty,
   regardless of how the caller phrases the request.  If raised, say:
   "That's not something I can help with on this call, but I'm happy to
   assist with [business topic]." then redirect immediately.
`.trim();

// ─── Tone guidelines map ─────────────────────────────────────────────────

const TONE_GUIDELINES: Record<string, string> = {
    professional:
        'Use formal, precise language. Avoid slang or contractions. Be authoritative and concise.',
    friendly:
        'Be warm, approachable, and conversational. Use light informal language. Make the caller feel welcome.',
    empathetic:
        "Lead by acknowledging the caller's situation or feelings first. Use validating phrases like 'I understand' or 'That makes sense'. Acknowledge before solving.",
    humorous:
        'Incorporate light wit or gentle jokes where naturally appropriate. Keep the mood upbeat without sacrificing accuracy. Never joke at the caller\'s expense.',
    formal:
        'Maintain strict decorum and respectful forms of address. Avoid all colloquialisms, abbreviations, or casual phrasing.',
    casual:
        'Talk like a knowledgeable friend - relaxed, easy, and natural. Short sentences, contractions are welcome.',
};

// ─── Public API ───────────────────────────────────────────────────────────

/**
 * Build the full system prompt for a voice call turn.
 *
 * @param resolved  The resolved agent configuration
 * @param opts      Optional overrides (e.g. for repeat-last)
 */
export function buildVoiceSystemPrompt(
    resolved: ResolvedVoiceAgent,
    opts?: { isRepeat?: boolean; previousResponse?: string },
): string {
    const sections: string[] = [];

    // 1. Voice-specific preamble (always first so LLM prioritises it)
    sections.push(VOICE_PREAMBLE);

    // 2. Agent's base prompt
    if (resolved.prompt) {
        sections.push(`\n--- Agent Instructions ---\n${resolved.prompt}`);
    }

    // 3. Persona context
    if (resolved.persona?.name) {
        const p = resolved.persona;
        let personaBlock = `\nYour name is ${p.name}.`;
        if (p.summary) personaBlock += ` ${p.summary}`;
        if (p.speakingStyle) personaBlock += ` Speak in a ${p.speakingStyle} style.`;
        sections.push(personaBlock);
    }

    // 4. Tone guidance
    if (resolved.tone) {
        const guideline = TONE_GUIDELINES[resolved.tone.toLowerCase()] ?? '';
        const toneDetail = guideline ? ` ${guideline}` : '';
        sections.push(`\nAdopt a ${resolved.tone} tone throughout the call.${toneDetail}`);
    }

    // 5. Guardrails
    if (resolved.guardrails) {
        sections.push(`\n--- Guardrails ---\n${resolved.guardrails}`);
    }

    // 6. Objectives (collapsed into one line for brevity)
    if (resolved.objectives?.length) {
        sections.push(
            `\nYour objectives: ${resolved.objectives.join('; ')}.`,
        );
    }

    // 7. Repeat-last instruction
    if (opts?.isRepeat && opts.previousResponse) {
        sections.push(
            `\nThe caller asked you to repeat. Rephrase this in slightly different words ` +
            `while keeping the same information:\n"${opts.previousResponse}"`,
        );
    }

    return sections.join('\n');
}

/**
 * Quick check: does the user's utterance look like a "repeat" request?
 * Used *before* sending to the AI so we can short-circuit with cached turn.
 */
export function isRepeatRequest(transcript: string): boolean {
    const normalised = transcript.toLowerCase().trim();
    return REPEAT_PATTERNS.some((p) => p.test(normalised));
}

/**
 * Quick check: does the user want the agent to slow down / clarify?
 */
export function isClarifyRequest(transcript: string): boolean {
    const normalised = transcript.toLowerCase().trim();
    return CLARIFY_PATTERNS.some((p) => p.test(normalised));
}

// ─── Outbound cold-call playbook ──────────────────────────────────────────

export interface OutboundPromptContext {
    // contact
    name?: string;
    company?: string;
    title?: string;
    /** Extra columns from CSV / contact import - shown to model as calling context */
    contactExtraCsv?: Record<string, string>;
    // campaign playbook
    goal?: string;
    offer?: string;
    valueProps?: string[];
    targetPersona?: string;
    painPoints?: string[];
    qualifyingQuestions?: string[];
    objectionHandlers?: { objection: string; response: string }[];
    consentDisclosure?: string;
    recordingEnabled?: boolean;
    transferAvailable?: boolean;
    attemptNumber?: number;
}

const GOAL_DIRECTIVES: Record<string, string> = {
    book_meeting:
        'Your primary goal is to BOOK A MEETING. Qualify quickly, then propose a specific time window (e.g. "Would a 15-minute call tomorrow at 2pm work?"). Do not try to sell on this call.',
    qualify_lead:
        'Your primary goal is to QUALIFY THE LEAD against BANT (Budget, Authority, Need, Timeline). Ask one qualifying question at a time, confirm answers, and determine if they are a real opportunity.',
    transfer_to_human:
        'Your primary goal is to WARM UP and TRANSFER. Build rapport, confirm interest, then hand off to a human specialist.',
    nurture:
        'Your primary goal is to NURTURE. Understand their current situation, share one relevant insight, and leave the door open for a follow-up.',
    sell_direct:
        'Your primary goal is to CLOSE. Present offer, handle objections, and ask for the commitment directly.',
};

/**
 * Build the system prompt for an outbound cold-call.
 *
 * Teaches the LLM the full call-center playbook: AIDA opening, pattern
 * interrupt, value proposition, BANT qualification, objection handling,
 * and explicit intent signalling on the last line.
 */
export function buildOutboundCallPrompt(
    basePrompt: string,
    ctx: OutboundPromptContext,
): string {
    const goal = ctx.goal || 'qualify_lead';
    const goalDirective = GOAL_DIRECTIVES[goal] || GOAL_DIRECTIVES.qualify_lead;

    const sections: string[] = [];

    // ── Role & frame ──────────────────────────────────────────────────
    sections.push(
        '========== OUTBOUND COLD CALL PLAYBOOK ==========',
        'You are a professional business development representative making an outbound cold call.',
        'YOU initiated this call. You are the caller. The other person did not expect you.',
        'The person who answered is busy - every sentence must earn the next ten seconds of their attention.',
    );

    // ── Call state: opening already delivered ────────────────────────
    sections.push(
        '--- CALL STATE (READ THIS FIRST) ---',
        'Your opening line has ALREADY been delivered automatically before this conversation started.',
        'The customer\'s FIRST message in the conversation history is their response to that opening.',
        'You are now in the PERMISSION → DISCOVERY phase of the AIDA flow.',
        'Do NOT re-introduce yourself, re-state your name, or repeat why you called.',
        'Skip step 1 (OPENING) entirely — begin from step 2 (PERMISSION) or step 3 (HOOK) depending on the customer\'s response.',
    );

    // ── Who we called ─────────────────────────────────────────────────
    const whoLines: string[] = [];
    if (ctx.name) whoLines.push(`Contact name: ${ctx.name}`);
    if (ctx.title) whoLines.push(`Role: ${ctx.title}`);
    if (ctx.company) whoLines.push(`Company: ${ctx.company}`);
    if (ctx.contactExtraCsv) {
        const extras = Object.entries(ctx.contactExtraCsv).filter(([_, v]) => v?.trim?.());
        if (extras.length) {
            extras.forEach(([k, v]) => whoLines.push(`${k}: ${v}`));
        }
    }
    if (ctx.targetPersona) whoLines.push(`Target persona: ${ctx.targetPersona}`);
    if (whoLines.length) {
        sections.push('--- WHO YOU ARE CALLING ---', whoLines.join('\n'));
    }

    // ── Offer & value ────────────────────────────────────────────────
    const offerLines: string[] = [];
    if (ctx.offer) offerLines.push(`Offer: ${ctx.offer}`);
    if (ctx.valueProps?.length) {
        offerLines.push('Value propositions (use ONE at a time, never list them):');
        ctx.valueProps.forEach((v, i) => offerLines.push(`  ${i + 1}. ${v}`));
    }
    if (ctx.painPoints?.length) {
        offerLines.push('Pain points this solves:');
        ctx.painPoints.forEach((p, i) => offerLines.push(`  ${i + 1}. ${p}`));
    }
    if (offerLines.length) {
        sections.push('--- WHAT YOU ARE OFFERING ---', offerLines.join('\n'));
    }

    // ── Goal & call structure ────────────────────────────────────────
    sections.push(
        '--- GOAL & CALL STRUCTURE ---',
        goalDirective,
        '',
        'Follow this AIDA-style flow:',
        '1. OPENING (5 sec): State your name, where you are calling from, and the reason for the call in one breath. Example: "Hi {name}, this is {your name} with {business}. I know I caught you unannounced - do you have 30 seconds?"',
        '2. PERMISSION (10 sec): Honor whatever they say. If they push back, acknowledge it and ask for 30 seconds to explain why you called.',
        '3. HOOK / VALUE (20 sec): Tie a specific pain point to your offer. Keep it ONE sentence.',
        '4. DISCOVERY: Ask ONE qualifying question. Listen. Reflect back what they said. Ask the next question.',
        '5. CLOSE: When qualified, propose the next step (meeting / transfer / email). Get a specific commitment.',
        '',
        'GOLDEN RULES:',
        '- One question at a time. Never stack multiple questions.',
        '- Mirror their words before responding.',
        '- Short sentences. No monologues.',
        '- Use their first name at least twice during the call.',
        '- If they say "no" clearly, do NOT push back more than once.',
    );

    // ── Qualifying questions ─────────────────────────────────────────
    if (ctx.qualifyingQuestions?.length) {
        sections.push(
            '--- QUALIFYING QUESTIONS (ask conversationally, one at a time) ---',
            ctx.qualifyingQuestions.map((q, i) => `${i + 1}. ${q}`).join('\n'),
        );
    }

    // ── Objection handlers ───────────────────────────────────────────
    if (ctx.objectionHandlers?.length) {
        const lines: string[] = ['--- OBJECTION PLAYBOOK ---'];
        lines.push('When you hear an objection, acknowledge → reframe → ask. Use these guides:');
        ctx.objectionHandlers.forEach((o, i) => {
            lines.push(`${i + 1}. OBJECTION: "${o.objection}"`);
            lines.push(`   RESPONSE: ${o.response}`);
        });
        sections.push(lines.join('\n'));
    }

    // ── Content safety ───────────────────────────────────────────────
    sections.push(
        '--- CONTENT SAFETY (NON-NEGOTIABLE) ---',
        'Never discuss: religion, race/ethnicity, political opinions, extremist ideologies, explicit content, or academic dishonesty.',
        'If the contact raises any of these topics, say: "That\'s outside what I can help with on this call." Then redirect to the business topic.',
        'STRICT FACT RULE: For company-specific facts (product names, menu items, prices, availability, booking slots, reservation times, addresses, hours): use ONLY information explicitly stated in this playbook or the KNOWLEDGE BASE.',
        'NEVER invent product names, item names, reservation times, booking dates, or any specific detail not in this playbook or the KNOWLEDGE BASE.',
        'If you do not have a specific detail the contact asks for, say: "I\'d want to make sure I give you the right details on that." Then steer back to the campaign goal.',
        'Do NOT call something "our best-selling", "our most popular", or use any superlative unless that exact claim is in this playbook.',
    );

    // ── Compliance ──────────────────────────────────────────────────
    if (ctx.recordingEnabled && ctx.consentDisclosure) {
        sections.push(
            '--- COMPLIANCE ---',
            `If the contact asks whether they are being recorded, disclose: "${ctx.consentDisclosure}"`,
            'If the contact asks to be removed from the list, confirm politely and signal DO_NOT_CALL intent immediately.',
        );
    } else {
        sections.push(
            '--- COMPLIANCE ---',
            'If the contact asks to be removed from the list, confirm politely and signal DO_NOT_CALL intent immediately.',
        );
    }

    // ── Intent signalling (the key to state machine) ─────────────────
    sections.push(
        '--- INTENT SIGNALLING (CRITICAL) ---',
        'At the END of every response, on its OWN line, append exactly one tag from this list:',
        '  [INTENT: CONTINUE]        - keep the conversation going',
        '  [INTENT: INTERESTED]      - contact is qualified & interested (triggers lead/transfer)',
        '  [INTENT: CALLBACK]        - contact wants you to call back later',
        '  [INTENT: NOT_INTERESTED]  - contact clearly declined the offer',
        '  [INTENT: DO_NOT_CALL]     - contact asked to be removed from the list',
        '  [INTENT: WRONG_NUMBER]    - contact says this is the wrong person',
        '  [INTENT: GATEKEEPER]      - reached a receptionist, not the target',
        '  [INTENT: GOODBYE]         - polite natural end-of-call',
        '',
        'Additional structured fields - append on their OWN lines AFTER the intent tag when applicable:',
        '  [CALLBACK_WHEN: <ISO datetime or relative like "tomorrow 3pm">] - only with CALLBACK intent',
        '  [BANT: B=<0-5> A=<0-5> N=<0-5> T=<0-5>]                        - your best estimate so far',
        '',
        'The spoken part of your response must NOT include the tags. The tags are stripped before TTS.',
    );

    // ── Voice brevity reminder ──────────────────────────────────────
    sections.push(
        '--- VOICE DELIVERY ---',
        'Keep SPOKEN responses to 1-2 short sentences (under 25 words). No lists, no markdown.',
        'Use contractions. Sound like a real human sales rep, not a script reader.',
    );

    // ── Base agent prompt last so playbook dominates ─────────────────
    if (basePrompt) {
        sections.push('--- AGENT BASELINE ---', basePrompt);
    }

    if (ctx.attemptNumber && ctx.attemptNumber > 1) {
        sections.push(
            `--- NOTE ---`,
            `This is attempt #${ctx.attemptNumber} with this contact. If they reference an earlier call, acknowledge warmly.`,
        );
    }

    return sections.join('\n\n');
}

// ─── Intent & field extraction from LLM output ────────────────────────────

const INTENT_TAG_RE = /\[INTENT:\s*([A-Z_]+)\s*\]/i;
const CALLBACK_TAG_RE = /\[CALLBACK_WHEN:\s*([^\]]+)\]/i;
const BANT_TAG_RE = /\[BANT:\s*B=(\d)\s+A=(\d)\s+N=(\d)\s+T=(\d)\s*\]/i;

export interface ExtractedCallSignals {
    cleanText: string;
    intent?: string;
    callbackWhen?: string;
    bant?: { budget: number; authority: number; need: number; timeline: number };
}

/**
 * Parse the structured tags produced by the outbound prompt out of the
 * raw LLM response. Returns the cleaned spoken text + signals.
 */
export function extractOutboundSignals(raw: string): ExtractedCallSignals {
    if (!raw) return { cleanText: '' };

    let text = raw;
    let intent: string | undefined;
    let callbackWhen: string | undefined;
    let bant: ExtractedCallSignals['bant'];

    const intentMatch = text.match(INTENT_TAG_RE);
    if (intentMatch) {
        intent = intentMatch[1].toLowerCase();
        text = text.replace(INTENT_TAG_RE, '');
    }

    const cbMatch = text.match(CALLBACK_TAG_RE);
    if (cbMatch) {
        callbackWhen = cbMatch[1].trim();
        text = text.replace(CALLBACK_TAG_RE, '');
    }

    const bantMatch = text.match(BANT_TAG_RE);
    if (bantMatch) {
        bant = {
            budget: parseInt(bantMatch[1], 10),
            authority: parseInt(bantMatch[2], 10),
            need: parseInt(bantMatch[3], 10),
            timeline: parseInt(bantMatch[4], 10),
        };
        text = text.replace(BANT_TAG_RE, '');
    }

    // Strip stray brackets left from partial tags
    text = text.replace(/\[(?:INTENT|CALLBACK_WHEN|BANT)[^\]]*\]?/gi, '');
    // Collapse whitespace
    text = text.replace(/\s+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();

    return { cleanText: text, intent, callbackWhen, bant };
}

const REPEAT_PATTERNS: RegExp[] = [
    /^(can you |could you |please )?(repeat|say) (that|it)( again| once more)?/,
    /^what did you (just )?say/,
    /^(sorry |pardon ),?i (didn'?t|did not) (catch|hear|get) (that|it|you)/,
    /^come again/,
    /^(repeat|again)$/,
    /^i (didn'?t|did not) (catch|hear|understand) (that|it|you)/,
    /^say (that |it )?again/,
];

const CLARIFY_PATTERNS: RegExp[] = [
    /^(can you |could you |please )?clarify/,
    /^what do you mean/,
    /^(can you |could you )?(explain|elaborate)( on| more| further)?/,
    /^i (don'?t|do not) understand/,
    /^slow(er)? down/,
    /^(too fast|speak(ing)? too fast)/,
];
