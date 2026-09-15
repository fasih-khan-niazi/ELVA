import mongoose, { Document, Schema } from 'mongoose';
import { Request, Response, NextFunction } from 'express';

/**
 * WebhookAuditLog - persists every raw Twilio webhook delivery for
 * debugging, compliance, and replay analysis.
 *
 * PII safety:
 *   • Phone numbers (From / To / ForwardedFrom) are masked:
 *     "+14155551234"  →  "***1234"
 *   • Raw body is kept but sensitive fields are overwritten with the
 *     masked version before storage.
 *
 * The middleware fires-and-forgets the write so it never adds latency
 * to the webhook response path.
 */

// ─── PII Masking ──────────────────────────────────────────────────────────

const PHONE_FIELDS = ['From', 'To', 'ForwardedFrom', 'Caller', 'Called'];

function maskPhone(raw: string): string {
    if (!raw || raw.length < 4) return '***';
    return '***' + raw.slice(-4);
}

function maskPayload(body: Record<string, any>): Record<string, any> {
    const safe = { ...body };
    for (const field of PHONE_FIELDS) {
        if (safe[field]) safe[field] = maskPhone(String(safe[field]));
    }
    return safe;
}

// ─── Mongoose model ───────────────────────────────────────────────────────

export interface IWebhookAuditLog extends Document {
    callSid: string;
    webhookPath: string;
    method: string;
    maskedPayload: Record<string, any>;
    headers: Record<string, string>;
    receivedAt: Date;
    processingResult?: 'success' | 'error' | 'duplicate';
    processingError?: string;
    createdAt: Date;
}

const WebhookAuditLogSchema = new Schema<IWebhookAuditLog>({
    callSid: { type: String, index: true, default: '' },
    webhookPath: { type: String, required: true },
    method: { type: String, default: 'POST' },
    maskedPayload: { type: Schema.Types.Mixed, default: {} },
    headers: { type: Schema.Types.Mixed, default: {} },
    receivedAt: { type: Date, required: true },
    processingResult: {
        type: String,
        enum: ['success', 'error', 'duplicate'],
    },
    processingError: { type: String },
    createdAt: { type: Date, default: Date.now },
});

// TTL index: auto-delete audit logs after 30 days (configurable via
// WEBHOOK_AUDIT_RETENTION_DAYS env var)
const retentionDays = Number(process.env.WEBHOOK_AUDIT_RETENTION_DAYS) || 30;
WebhookAuditLogSchema.index(
    { createdAt: 1 },
    { expireAfterSeconds: retentionDays * 86_400 },
);

export const WebhookAuditLog = mongoose.model<IWebhookAuditLog>(
    'WebhookAuditLog',
    WebhookAuditLogSchema,
);

// ─── Helpers ──────────────────────────────────────────────────────────────

/** Pick only the headers that are useful for debugging/auditing. */
function safeHeaders(req: Request): Record<string, string> {
    const picked: Record<string, string> = {};
    const keep = [
        'x-twilio-signature',
        'x-forwarded-for',
        'x-forwarded-proto',
        'x-forwarded-host',
        'content-type',
        'user-agent',
    ];
    for (const h of keep) {
        const val = req.headers[h];
        if (val) picked[h] = Array.isArray(val) ? val.join(', ') : val;
    }
    return picked;
}

// ─── Write-behind audit function ──────────────────────────────────────────

export async function writeAuditLog(
    req: Request,
    processingResult?: 'success' | 'error' | 'duplicate',
    processingError?: string,
): Promise<void> {
    try {
        const body = req.body || {};
        await WebhookAuditLog.create({
            callSid: body.CallSid || '',
            webhookPath: req.originalUrl || req.path,
            method: req.method,
            maskedPayload: maskPayload(body),
            headers: safeHeaders(req),
            receivedAt: new Date(),
            processingResult,
            processingError,
        });
    } catch (err: any) {
        // Audit writes must never crash the request pipeline
        console.error('[AUDIT-LOG] Failed to persist webhook audit log', err?.message);
    }
}

// ─── Express middleware (fire-and-forget on entry) ────────────────────────

export function webhookAuditLogger(
    req: Request,
    _res: Response,
    next: NextFunction,
): void {
    // Fire-and-forget - don't await, don't block the response
    writeAuditLog(req).catch(() => {});
    next();
}
