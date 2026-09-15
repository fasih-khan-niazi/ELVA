import crypto from 'crypto';
import axios from 'axios';
import cron from 'node-cron';
import { Connector, ConnectorLog, ConnectorTemplate, IConnector, IConnectorLog } from '../models/Connector';
import { Agent } from '../models';
import { terminalLog } from '../utils/terminalLog';
import { sendSlackMessage, sendSlackMessageWithToken } from './slackService';
import { isEmailDeliveryConfigured, sendEmail } from './emailService';
import { sendWhatsAppMessage } from './whatsappService';

const CURRENCY_SYMBOLS: Record<string, string> = {
    USD: '$', PKR: 'Rs.', EUR: '€', GBP: '£', INR: '₹',
    AED: 'AED ', SAR: 'SAR ', CAD: 'C$', AUD: 'A$',
};

// ── Template engine ────────────────────────────────────────────────────────

function safeStr(val: any): string {
    if (val === undefined || val === null) return '';
    return String(val);
}

function escapeForJson(str: string): string {
    return str.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\r/g, '\\r');
}

function renderTemplate(template: string, data: Record<string, any>): string {
    const isJson = template.trim().startsWith('{');
    return template.replace(/\{\{([^}]+)\}\}/g, (_, key) => {
        const parts = key.trim().split('.');
        let value: any = data;
        for (const part of parts) value = value?.[part];
        const str = safeStr(value);
        return isJson ? escapeForJson(str) : str;
    });
}

// ── Condition evaluator ────────────────────────────────────────────────────

function evaluateConditions(conditions: IConnector['trigger']['conditions'], data: Record<string, any>): boolean {
    for (const cond of conditions) {
        const parts = cond.field.split('.');
        let actual: any = data;
        for (const p of parts) actual = actual?.[p];

        const expected = cond.value;
        switch (cond.operator) {
            case 'gt':  if (!(Number(actual) > Number(expected))) return false; break;
            case 'lt':  if (!(Number(actual) < Number(expected))) return false; break;
            case 'gte': if (!(Number(actual) >= Number(expected))) return false; break;
            case 'lte': if (!(Number(actual) <= Number(expected))) return false; break;
            case 'eq':  if (String(actual) !== String(expected)) return false; break;
            case 'contains':
                if (!String(actual).toLowerCase().includes(String(expected).toLowerCase())) return false;
                break;
        }
    }
    return true;
}

// ── Template data builders ─────────────────────────────────────────────────

function buildOrderData(order: any, agent: any): Record<string, any> {
    const currency = CURRENCY_SYMBOLS[agent?.currency || 'USD'] || '$';
    return {
        order: {
            id: order._id?.toString().slice(-6).toUpperCase() || '',
            customerName: order.customerName || 'Unknown',
            customerPhone: order.customerPhone || '',
            customerEmail: order.customerEmail || '',
            customerAddress: order.customerAddress || '',
            items: (order.items || []).map((i: any) => `${i.name} x${i.quantity}`).join(', '),
            itemsCount: (order.items || []).length,
            total: Number(order.total || 0).toFixed(2),
            subtotal: Number(order.subtotal || 0).toFixed(2),
            tax: Number(order.tax || 0).toFixed(2),
            status: order.status || 'pending',
            channel: order.channel || 'chat',
            currency,
            createdAt: new Date(order.createdAt || Date.now()).toLocaleString(),
        },
        agent: {
            name: agent?.name || '',
            businessName: agent?.businessName || '',
        },
    };
}

function buildLeadData(lead: any, agent: any): Record<string, any> {
    return {
        lead: {
            name: lead.name || 'Unknown',
            email: lead.email || '',
            phone: lead.phone || '',
            company: lead.company || '',
            interest: lead.interest || '',
            score: lead.score || 0,
            status: lead.status || 'new',
            source: lead.source || 'auto',
            channel: lead.channel || 'chat',
            createdAt: new Date(lead.createdAt || Date.now()).toLocaleString(),
        },
        agent: {
            name: agent?.name || '',
            businessName: agent?.businessName || '',
        },
    };
}

function buildCallData(call: any, agent: any): Record<string, any> {
    return {
        call: {
            duration: call.duration || '',
            from: call.from || '',
            outcome: call.outcome || '',
            sentiment: call.sentiment || '',
            summary: call.summary || '',
        },
        agent: {
            name: agent?.name || '',
            businessName: agent?.businessName || '',
        },
    };
}

// ── Dispatcher ─────────────────────────────────────────────────────────────

function injectTwoWayButtons(rendered: string, connector: IConnector, resourceId: string): string {
    if (!connector.destination.slack?.twoWayEnabled || !resourceId) return rendered;

    const trimmed = rendered.trim();
    if (!trimmed.startsWith('{')) return rendered; // only Block Kit supports buttons

    let block: any;
    try { block = JSON.parse(trimmed); } catch { return rendered; }

    const source = connector.trigger.source; // 'orders' | 'leads'
    let actions: any[];

    if (source === 'orders') {
        actions = [
            { type: 'button', text: { type: 'plain_text', text: '✅ Confirm Order', emoji: true }, style: 'primary', action_id: `elva:order:confirm:${resourceId}`, value: resourceId },
            { type: 'button', text: { type: 'plain_text', text: '❌ Cancel Order', emoji: true }, style: 'danger', action_id: `elva:order:cancel:${resourceId}`, value: resourceId },
        ];
    } else if (source === 'leads') {
        actions = [
            { type: 'button', text: { type: 'plain_text', text: '✅ Qualify Lead', emoji: true }, style: 'primary', action_id: `elva:lead:qualify:${resourceId}`, value: resourceId },
            { type: 'button', text: { type: 'plain_text', text: '❌ Disqualify', emoji: true }, style: 'danger', action_id: `elva:lead:disqualify:${resourceId}`, value: resourceId },
        ];
    } else {
        return rendered;
    }

    const actionsBlock = { type: 'actions', elements: actions };
    if (!block.blocks) block.blocks = [];
    block.blocks.push(actionsBlock);

    return JSON.stringify(block);
}

async function dispatch(connector: IConnector, rendered: string, subject?: string, resourceId?: string): Promise<void> {
    const dest = connector.destination;

    if (dest.type === 'slack') {
        if (dest.slack?.channelId && dest.slack?.workspaceId) {
            // Phase 2 - OAuth bot token path
            const bodyWithButtons = injectTwoWayButtons(rendered, connector, resourceId || '');
            await sendSlackMessageWithToken(
                connector.tenantId.toString(),
                dest.slack.workspaceId,
                dest.slack.channelId,
                bodyWithButtons
            );
        } else if (dest.slack?.webhookUrl) {
            // Phase 1 - Incoming Webhook path (no two-way)
            await sendSlackMessage(dest.slack.webhookUrl, rendered);
        } else {
            throw new Error('Slack alerts connector misconfigured: no webhookUrl or channelId');
        }

    } else if (dest.type === 'email' && dest.email?.recipients?.length) {
        const { sent } = await sendEmail({
            to: dest.email.recipients,
            subject: subject || 'ELVA alerts notification',
            html: rendered,
            fromName: dest.email.fromName,
            categories: ['elva-connector'],
        });
        if (!sent) {
            throw new Error(
                isEmailDeliveryConfigured()
                    ? 'Email was not sent (no valid recipients or SendGrid rejected the request — check server logs)'
                    : 'Email not configured: set SENDGRID_API_KEY and SENDGRID_FROM_EMAIL'
            );
        }

    } else if (dest.type === 'webhook' && dest.webhook?.url) {
        const payload = { event: connector.trigger.event, source: connector.trigger.source, message: rendered, timestamp: new Date().toISOString() };
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        if (dest.webhook.secret) {
            const sig = crypto.createHmac('sha256', dest.webhook.secret).update(JSON.stringify(payload)).digest('hex');
            headers['X-ELVA-Signature'] = `sha256=${sig}`;
        }
        if (dest.webhook.headers) {
            const h = dest.webhook.headers;
            if (h instanceof Map) {
                for (const [k, v] of h.entries()) headers[k] = v;
            } else if (typeof h === 'object') {
                for (const [k, v] of Object.entries(h as Record<string, string>)) {
                    if (v != null) headers[k] = String(v);
                }
            }
        }
        const res = await axios.post(dest.webhook.url, payload, { headers, timeout: 8000 });
        if (res.status >= 400) throw new Error(`Webhook responded ${res.status}`);

    } else if (dest.type === 'whatsapp' && dest.whatsapp?.phoneNumberId && dest.whatsapp?.recipientPhone) {
        await sendWhatsAppMessage({
            phoneNumberId: dest.whatsapp.phoneNumberId,
            accessToken: dest.whatsapp.accessToken,
            to: dest.whatsapp.recipientPhone,
            body: rendered,
        });

    } else {
        throw new Error('Alerts destination is misconfigured');
    }
}

// ── Retry loop (fire-and-forget) ───────────────────────────────────────────

const MAX_RETRIES = 3;
const RETRY_DELAYS = [5_000, 30_000, 300_000]; // 5s, 30s, 5min

async function executeWithRetry(
    connector: IConnector,
    rendered: string,
    subject: string | undefined,
    logId: string,
    attempt: number,
    resourceId?: string
): Promise<void> {
    try {
        await dispatch(connector, rendered, subject, resourceId);

        await ConnectorLog.findByIdAndUpdate(logId, {
            status: 'delivered',
            deliveredAt: new Date(),
            attempt,
        });
        await Connector.findByIdAndUpdate(connector._id, {
            $inc: { 'stats.sent': 1 },
            'stats.lastFiredAt': new Date(),
            failureAlert: false,
        });

    } catch (err: any) {
        const errMsg = err?.message || 'Unknown error';

        if (attempt < MAX_RETRIES) {
            await ConnectorLog.findByIdAndUpdate(logId, { status: 'retrying', attempt, errorMessage: errMsg });
            const delay = RETRY_DELAYS[attempt - 1] || 5000;
            setTimeout(() => executeWithRetry(connector, rendered, subject, logId, attempt + 1, resourceId), delay);
        } else {
            await ConnectorLog.findByIdAndUpdate(logId, { status: 'failed', attempt, errorMessage: errMsg });
            await Connector.findByIdAndUpdate(connector._id, {
                $inc: { 'stats.failed': 1 },
                status: 'failed',
                failureAlert: true,
            });
            console.error(`[Connector] ${connector.name} failed after ${MAX_RETRIES} attempts: ${errMsg}`);
        }
    }
}

// ── Resolve rendered message from connector + data ─────────────────────────

async function resolveRendered(connector: IConnector, templateData: Record<string, any>): Promise<{ body: string; subject?: string }> {
    let templateBody: string;
    let templateSubject: string | undefined;

    if (connector.customTemplate?.body) {
        templateBody = connector.customTemplate.body;
        templateSubject = connector.customTemplate.subject;
    } else if (connector.templateId) {
        const tpl = await ConnectorTemplate.findById(connector.templateId);
        if (!tpl) throw new Error(`Template ${connector.templateId} not found`);
        templateBody = tpl.body;
        templateSubject = tpl.subject;
    } else {
        throw new Error('Connector has no template configured');
    }

    return {
        body: renderTemplate(templateBody, templateData),
        subject: templateSubject ? renderTemplate(templateSubject, templateData) : undefined,
    };
}

// ── Main fire function ─────────────────────────────────────────────────────

export interface TriggerPayload {
    eventType: 'order.created' | 'lead.created' | 'call.completed';
    agentId: string;
    tenantId: string;
    data: any;
}

/** Maps API event names to stored `trigger.source` / `trigger.event` (plural sources in DB). */
function triggerFromEventType(
    eventType: TriggerPayload['eventType']
): { source: IConnector['trigger']['source']; event: IConnector['trigger']['event'] } {
    switch (eventType) {
        case 'order.created':
            return { source: 'orders', event: 'created' };
        case 'lead.created':
            return { source: 'leads', event: 'created' };
        case 'call.completed':
            // Wizard defaults calls to event `created` (voice "completed" → same trigger row).
            return { source: 'calls', event: 'created' };
        default: {
            const _x: never = eventType;
            return _x;
        }
    }
}

export async function fire(payload: TriggerPayload): Promise<void> {
    try {
        const { source, event } = triggerFromEventType(payload.eventType);

        const connectors = await Connector.find({
            agentId: payload.agentId,
            tenantId: payload.tenantId,
            status: 'active',
            'trigger.source': source,
            'trigger.event': event,
        });

        if (!connectors.length) return;

        const agent = await Agent.findById(payload.agentId);

        let templateData: Record<string, any>;
        if (source === 'orders') templateData = buildOrderData(payload.data, agent);
        else if (source === 'leads') templateData = buildLeadData(payload.data, agent);
        else templateData = buildCallData(payload.data, agent);

        const resourceId: string = payload.data?._id?.toString() || '';

        for (const connector of connectors) {
            if (connector.trigger.conditions?.length && !evaluateConditions(connector.trigger.conditions, templateData)) {
                continue;
            }

            let rendered: string;
            let subject: string | undefined;
            try {
                const result = await resolveRendered(connector, templateData);
                rendered = result.body;
                subject = result.subject;
            } catch (err: any) {
                console.error(`[Connector] Template resolution failed for ${connector.name}: ${err.message}`);
                continue;
            }

            const log = await ConnectorLog.create({
                connectorId: connector._id,
                tenantId: connector.tenantId,
                agentId: connector.agentId,
                eventType: payload.eventType,
                payload: templateData,
                status: connector.deliveryMode === 'instant' ? 'retrying' : 'queued',
            });

            if (connector.deliveryMode === 'instant') {
                // Fire-and-forget - don't await so the API response isn't blocked
                executeWithRetry(connector, rendered, subject, log._id.toString(), 1, resourceId).catch(() => {});
            }
            // digest modes are processed by the cron job below
        }
    } catch (err) {
        console.error('[Connector] fire() error:', err);
    }
}

// ── Digest cron jobs ───────────────────────────────────────────────────────

async function runDigest(mode: 'hourly_digest' | 'daily_digest'): Promise<void> {
    const queuedLogs = await ConnectorLog.find({ status: 'queued' }).populate<{ connectorId: IConnector }>('connectorId');

    const grouped = new Map<string, { connector: IConnector; logs: any[]; templateData: Record<string, any>[] }>();
    for (const log of queuedLogs) {
        const connector = log.connectorId as unknown as IConnector;
        if (!connector || connector.deliveryMode !== mode) continue;
        const key = connector._id.toString();
        if (!grouped.has(key)) grouped.set(key, { connector, logs: [], templateData: [] });
        grouped.get(key)!.logs.push(log);
        grouped.get(key)!.templateData.push(log.payload);
    }

    for (const { connector, logs, templateData } of grouped.values()) {
        const agent = await Agent.findById(connector.agentId);
        const currency = CURRENCY_SYMBOLS[agent?.currency || 'USD'] || '$';

        const ordersCount = templateData.filter(d => d.order).length;
        const leadsCount = templateData.filter(d => d.lead).length;
        const revenue = templateData
            .filter(d => d.order)
            .reduce((sum, d) => sum + parseFloat(d.order?.total || '0'), 0)
            .toFixed(2);

        const digestData = {
            digest: {
                date: new Date().toLocaleDateString(),
                ordersCount,
                leadsCount,
                revenue,
                currency,
            },
            agent: { name: agent?.name || '', businessName: agent?.businessName || '' },
        };

        try {
            const { body, subject } = await resolveRendered(connector, digestData);
            await dispatch(connector, body, subject);
            const ids = logs.map(l => l._id);
            await ConnectorLog.updateMany({ _id: { $in: ids } }, { status: 'delivered', deliveredAt: new Date() });
            await Connector.findByIdAndUpdate(connector._id, {
                $inc: { 'stats.sent': 1 },
                'stats.lastFiredAt': new Date(),
            });
        } catch (err: any) {
            console.error(`[Connector] Digest dispatch failed for ${connector.name}: ${err.message}`);
        }
    }
}

export function startDigestScheduler(): void {
    cron.schedule('0 * * * *', () => runDigest('hourly_digest'));
    cron.schedule('0 9 * * *', () => runDigest('daily_digest'));
    terminalLog.dim('Connectors digest scheduler started (hourly + daily)');
}

// ── Test fire (sends one delivery without creating a log) ──────────────────

export async function testConnector(connector: IConnector): Promise<void> {
    const agent = await Agent.findById(connector.agentId);
    const tpl = connector.templateId ? await ConnectorTemplate.findById(connector.templateId) : null;
    const previewData = tpl?.previewData || {};

    const { body, subject } = await resolveRendered(connector, previewData);
    await dispatch(connector, body, subject);
}
