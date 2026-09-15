import sgMail from '@sendgrid/mail';

let initialized = false;

function tryInit(): boolean {
    if (initialized) return true;
    const key = process.env.SENDGRID_API_KEY?.trim();
    if (!key) return false;
    sgMail.setApiKey(key);
    initialized = true;
    return true;
}

/** Recipient list: trim, drop empties / invalid, RFC-ish check, dedupe. */
export function normalizeEmailRecipients(addresses: string[]): string[] {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const raw of addresses) {
        const t = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
        if (!t || !t.includes('@') || seen.has(t)) continue;
        seen.add(t);
        out.push(t);
    }
    return out;
}

/** Best-effort plain text for multipart (deliverability + legacy clients). */
export function htmlToPlainTextApprox(html: string): string {
    return html
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/(p|div|li|tr|h[1-6])\s*>/gi, '\n')
        .replace(/<[^>]+>/g, '')
        .replace(/&nbsp;/gi, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&#39;/g, "'")
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

export function isEmailDeliveryConfigured(): boolean {
    const key = process.env.SENDGRID_API_KEY?.trim();
    const from = process.env.SENDGRID_FROM_EMAIL?.trim();
    return !!(key && from);
}

function logSendGridError(e: unknown) {
    if (e && typeof e === 'object' && 'response' in e) {
        const resp = (e as { response?: { body?: unknown } }).response;
        if (resp?.body !== undefined) {
            console.error('[email] SendGrid response:', JSON.stringify(resp.body));
            return;
        }
    }
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[email] SendGrid error:', msg);
}

export type SendEmailOptions = {
    to: string[];
    subject: string;
    html: string;
    /** Shown next to SENDGRID_FROM_EMAIL; falls back to SENDGRID_FROM_NAME then "ELVA". */
    fromName?: string;
    replyTo?: string;
    /** SendGrid categories (activity / stats grouping). Max 10 chars each in practice. */
    categories?: string[];
};

/**
 * Sends one logical message via SendGrid (`isMultiple: true` → each recipient gets their own envelope).
 * Returns `{ sent: false }` when SendGrid is not configured or there are no valid recipients - does not throw.
 */
export async function sendEmail(opts: SendEmailOptions): Promise<{ sent: boolean }> {
    const recipients = normalizeEmailRecipients(opts.to);
    if (!recipients.length) {
        console.warn('[email] No valid recipients; skipped:', opts.subject);
        return { sent: false };
    }

    if (!tryInit()) {
        console.warn('[email] SendGrid not configured; skipped:', opts.subject, '→', recipients);
        return { sent: false };
    }

    const fromEmail = process.env.SENDGRID_FROM_EMAIL?.trim();
    if (!fromEmail) {
        console.warn('[email] SENDGRID_FROM_EMAIL unset; skipped:', opts.subject);
        return { sent: false };
    }

    const defaultName = process.env.SENDGRID_FROM_NAME?.trim() || 'ELVA';
    const fromName = (opts.fromName?.trim() || defaultName).slice(0, 120);

    const envReply = process.env.SENDGRID_REPLY_TO?.trim();
    const replyAddr = (opts.replyTo?.trim() || envReply || '').trim() || undefined;

    const plain = htmlToPlainTextApprox(opts.html).slice(0, 900_000);
    const msg: Parameters<typeof sgMail.sendMultiple>[0] = {
        to: recipients,
        from: { email: fromEmail, name: fromName },
        replyTo: replyAddr ? { email: replyAddr } : undefined,
        subject: opts.subject.slice(0, 998),
        html: opts.html.slice(0, 900_000),
        text: plain || undefined,
        categories: opts.categories?.length ? opts.categories.map((c) => c.slice(0, 100)) : undefined,
    };

    try {
        await sgMail.sendMultiple(msg);
        return { sent: true };
    } catch (e: unknown) {
        logSendGridError(e);
        return { sent: false };
    }
}
