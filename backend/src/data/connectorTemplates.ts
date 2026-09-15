import { ConnectorTemplate } from '../models/Connector';

const PREVIEW = {
    order: {
        id: 'A1B2C3',
        customerName: 'John Smith',
        customerPhone: '+1 555-0100',
        customerEmail: 'john@example.com',
        items: 'Margherita Pizza x2, Garlic Bread x1',
        itemsCount: 3,
        total: '34.50',
        subtotal: '32.00',
        tax: '2.50',
        status: 'pending',
        channel: 'voice',
        currency: '$',
        createdAt: new Date().toLocaleString(),
    },
    lead: {
        name: 'Sarah Johnson',
        email: 'sarah@company.com',
        phone: '+1 555-0199',
        company: 'Acme Corp',
        interest: 'Looking for enterprise pricing on catering services',
        score: 85,
        status: 'new',
        source: 'auto',
        channel: 'voice',
        createdAt: new Date().toLocaleString(),
    },
    call: {
        duration: '4m 32s',
        from: '+1 555-0177',
        outcome: 'Order placed',
        sentiment: 'Positive',
        summary: 'Customer ordered 2 pizzas and asked about delivery time.',
    },
    agent: { name: 'Restaurant Bot', businessName: 'Mario\'s Pizza' },
    digest: {
        date: new Date().toLocaleDateString(),
        ordersCount: 12,
        leadsCount: 5,
        revenue: '487.50',
        currency: '$',
    },
};

const BUILT_IN_TEMPLATES = [
    // ── ORDER CREATED - SLACK ──────────────────────────────────────────────
    {
        name: 'New Order - Slack Compact',
        description: 'Single-line Slack alert with key order details',
        source: 'orders',
        event: 'created',
        channel: 'slack',
        body: `🛒 *New Order #{{order.id}}* | {{order.currency}}{{order.total}} | {{order.customerName}} | {{order.items}} | via {{agent.name}}`,
        isBuiltIn: true,
        previewData: PREVIEW,
    },
    {
        name: 'New Order - Slack Detailed',
        description: 'Rich Slack card with customer details, itemized list, and total',
        source: 'orders',
        event: 'created',
        channel: 'slack',
        body: JSON.stringify({
            text: 'New Order #{{order.id}} - {{agent.name}}',
            blocks: [
                {
                    type: 'header',
                    text: { type: 'plain_text', text: '🛒 New Order #{{order.id}}', emoji: true },
                },
                {
                    type: 'section',
                    fields: [
                        { type: 'mrkdwn', text: '*Customer*\n{{order.customerName}}' },
                        { type: 'mrkdwn', text: '*Total*\n{{order.currency}}{{order.total}}' },
                        { type: 'mrkdwn', text: '*Channel*\n{{order.channel}}' },
                        { type: 'mrkdwn', text: '*Phone*\n{{order.customerPhone}}' },
                    ],
                },
                {
                    type: 'section',
                    text: { type: 'mrkdwn', text: '*Items:* {{order.items}}' },
                },
                { type: 'divider' },
                {
                    type: 'context',
                    elements: [{ type: 'mrkdwn', text: '{{agent.name}} · {{order.createdAt}}' }],
                },
            ],
        }),
        isBuiltIn: true,
        previewData: PREVIEW,
    },

    // ── ORDER CREATED - EMAIL ──────────────────────────────────────────────
    {
        name: 'New Order - Email Plain',
        description: 'Clean minimal email with order summary',
        source: 'orders',
        event: 'created',
        channel: 'email',
        subject: 'New Order #{{order.id}} - {{agent.name}}',
        body: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:24px;color:#111">
<h2 style="color:#4f46e5;margin-bottom:4px">New Order #{{order.id}}</h2>
<p style="color:#6b7280;margin-top:0">Received via {{agent.name}} · {{order.createdAt}}</p>
<table style="width:100%;border-collapse:collapse;margin:16px 0">
<tr><td style="padding:8px 0;border-bottom:1px solid #e5e7eb;color:#6b7280;width:40%">Customer</td><td style="padding:8px 0;border-bottom:1px solid #e5e7eb;font-weight:600">{{order.customerName}}</td></tr>
<tr><td style="padding:8px 0;border-bottom:1px solid #e5e7eb;color:#6b7280">Phone</td><td style="padding:8px 0;border-bottom:1px solid #e5e7eb">{{order.customerPhone}}</td></tr>
<tr><td style="padding:8px 0;border-bottom:1px solid #e5e7eb;color:#6b7280">Items</td><td style="padding:8px 0;border-bottom:1px solid #e5e7eb">{{order.items}}</td></tr>
<tr><td style="padding:8px 0;border-bottom:1px solid #e5e7eb;color:#6b7280">Subtotal</td><td style="padding:8px 0;border-bottom:1px solid #e5e7eb">{{order.currency}}{{order.subtotal}}</td></tr>
<tr><td style="padding:8px 0;border-bottom:1px solid #e5e7eb;color:#6b7280">Tax</td><td style="padding:8px 0;border-bottom:1px solid #e5e7eb">{{order.currency}}{{order.tax}}</td></tr>
<tr><td style="padding:8px 0;color:#6b7280;font-weight:700">Total</td><td style="padding:8px 0;font-weight:700;font-size:18px;color:#4f46e5">{{order.currency}}{{order.total}}</td></tr>
</table>
<p style="color:#9ca3af;font-size:12px;margin-top:24px">Sent by ELVA · {{agent.name}}</p>
</div>`,
        isBuiltIn: true,
        previewData: PREVIEW,
    },
    {
        name: 'New Order - Email Branded',
        description: 'Full-featured HTML receipt with header banner and itemized breakdown',
        source: 'orders',
        event: 'created',
        channel: 'email',
        subject: '🛒 Order from {{order.customerName}} - {{order.currency}}{{order.total}}',
        body: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;background:#f9fafb">
<div style="background:linear-gradient(135deg,#4f46e5,#7c3aed);padding:32px 24px;border-radius:12px 12px 0 0;text-align:center">
<h1 style="color:#fff;margin:0;font-size:24px">🛒 New Order</h1>
<p style="color:#c4b5fd;margin:8px 0 0">{{agent.name}} · {{agent.businessName}}</p>
</div>
<div style="background:#fff;padding:24px;border-radius:0 0 12px 12px;border:1px solid #e5e7eb;border-top:none">
<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px">
<div><span style="font-size:22px;font-weight:700;color:#111">Order #{{order.id}}</span></div>
<div style="background:#eef2ff;color:#4f46e5;padding:6px 14px;border-radius:999px;font-weight:600;font-size:14px">{{order.status}}</div>
</div>
<div style="background:#f9fafb;border-radius:8px;padding:16px;margin-bottom:20px">
<p style="margin:0 0 6px;font-weight:600;color:#374151">Customer Details</p>
<p style="margin:4px 0;color:#6b7280;font-size:14px">👤 {{order.customerName}}</p>
<p style="margin:4px 0;color:#6b7280;font-size:14px">📞 {{order.customerPhone}}</p>
<p style="margin:4px 0;color:#6b7280;font-size:14px">✉️ {{order.customerEmail}}</p>
</div>
<p style="font-weight:600;color:#374151;margin-bottom:8px">Order Items</p>
<div style="background:#f9fafb;border-radius:8px;padding:16px;margin-bottom:20px">
<p style="margin:0;color:#374151">{{order.items}}</p>
</div>
<table style="width:100%;border-collapse:collapse">
<tr><td style="padding:6px 0;color:#6b7280;border-top:1px solid #e5e7eb">Subtotal</td><td style="padding:6px 0;text-align:right;border-top:1px solid #e5e7eb">{{order.currency}}{{order.subtotal}}</td></tr>
<tr><td style="padding:6px 0;color:#6b7280">Tax</td><td style="padding:6px 0;text-align:right">{{order.currency}}{{order.tax}}</td></tr>
<tr><td style="padding:10px 0 0;font-weight:700;font-size:18px;border-top:2px solid #e5e7eb">Total</td><td style="padding:10px 0 0;text-align:right;font-weight:700;font-size:18px;color:#4f46e5;border-top:2px solid #e5e7eb">{{order.currency}}{{order.total}}</td></tr>
</table>
<p style="color:#9ca3af;font-size:11px;margin-top:24px;text-align:center">{{order.createdAt}} · Sent by ELVA Connected Apps</p>
</div>
</div>`,
        isBuiltIn: true,
        previewData: PREVIEW,
    },

    // ── LEAD CAPTURED - SLACK ──────────────────────────────────────────────
    {
        name: 'Lead Captured - Slack Quick Alert',
        description: 'Compact Slack notification for new lead with score',
        source: 'leads',
        event: 'created',
        channel: 'slack',
        body: `🎯 *New Lead: {{lead.name}}* | Score: {{lead.score}}/100 | {{lead.phone}} / {{lead.email}} | Interest: {{lead.interest}} | {{agent.name}}`,
        isBuiltIn: true,
        previewData: PREVIEW,
    },
    {
        name: 'Lead Captured - Slack Qualified Card',
        description: 'Rich Slack card with score, contact details, and interest summary',
        source: 'leads',
        event: 'created',
        channel: 'slack',
        body: JSON.stringify({
            text: 'New Lead: {{lead.name}} - Score {{lead.score}}/100',
            blocks: [
                {
                    type: 'header',
                    text: { type: 'plain_text', text: '🎯 New Lead Captured', emoji: true },
                },
                {
                    type: 'section',
                    fields: [
                        { type: 'mrkdwn', text: '*Name*\n{{lead.name}}' },
                        { type: 'mrkdwn', text: '*Score*\n{{lead.score}}/100' },
                        { type: 'mrkdwn', text: '*Email*\n{{lead.email}}' },
                        { type: 'mrkdwn', text: '*Phone*\n{{lead.phone}}' },
                        { type: 'mrkdwn', text: '*Company*\n{{lead.company}}' },
                        { type: 'mrkdwn', text: '*Source*\n{{lead.source}}' },
                    ],
                },
                {
                    type: 'section',
                    text: { type: 'mrkdwn', text: '*Interest:* {{lead.interest}}' },
                },
                { type: 'divider' },
                {
                    type: 'context',
                    elements: [{ type: 'mrkdwn', text: '{{agent.name}} · {{lead.createdAt}}' }],
                },
            ],
        }),
        isBuiltIn: true,
        previewData: PREVIEW,
    },

    // ── LEAD CAPTURED - EMAIL ──────────────────────────────────────────────
    {
        name: 'Lead Captured - Email Summary',
        description: 'Simple email summary of captured lead',
        source: 'leads',
        event: 'created',
        channel: 'email',
        subject: 'New Lead: {{lead.name}} - Score {{lead.score}}/100',
        body: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:24px;color:#111">
<h2 style="color:#4f46e5;margin-bottom:4px">🎯 New Lead Captured</h2>
<p style="color:#6b7280;margin-top:0">via {{agent.name}} · {{lead.createdAt}}</p>
<table style="width:100%;border-collapse:collapse;margin:16px 0">
<tr><td style="padding:8px 0;border-bottom:1px solid #e5e7eb;color:#6b7280;width:40%">Name</td><td style="padding:8px 0;border-bottom:1px solid #e5e7eb;font-weight:600">{{lead.name}}</td></tr>
<tr><td style="padding:8px 0;border-bottom:1px solid #e5e7eb;color:#6b7280">Email</td><td style="padding:8px 0;border-bottom:1px solid #e5e7eb">{{lead.email}}</td></tr>
<tr><td style="padding:8px 0;border-bottom:1px solid #e5e7eb;color:#6b7280">Phone</td><td style="padding:8px 0;border-bottom:1px solid #e5e7eb">{{lead.phone}}</td></tr>
<tr><td style="padding:8px 0;border-bottom:1px solid #e5e7eb;color:#6b7280">Company</td><td style="padding:8px 0;border-bottom:1px solid #e5e7eb">{{lead.company}}</td></tr>
<tr><td style="padding:8px 0;border-bottom:1px solid #e5e7eb;color:#6b7280">Interest</td><td style="padding:8px 0;border-bottom:1px solid #e5e7eb">{{lead.interest}}</td></tr>
<tr><td style="padding:8px 0;color:#6b7280;font-weight:700">Lead Score</td><td style="padding:8px 0;font-weight:700;font-size:18px;color:#4f46e5">{{lead.score}} / 100</td></tr>
</table>
<p style="color:#9ca3af;font-size:12px;margin-top:24px">Sent by ELVA · {{agent.name}}</p>
</div>`,
        isBuiltIn: true,
        previewData: PREVIEW,
    },
    {
        name: 'Lead Captured - Email CRM Card',
        description: 'Styled CRM-style card with score badge and direct action link',
        source: 'leads',
        event: 'created',
        channel: 'email',
        subject: '🎯 Hot Lead: {{lead.name}} from {{lead.company}} - {{agent.name}}',
        body: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;background:#f9fafb">
<div style="background:linear-gradient(135deg,#059669,#10b981);padding:32px 24px;border-radius:12px 12px 0 0;text-align:center">
<h1 style="color:#fff;margin:0;font-size:24px">🎯 New Lead</h1>
<p style="color:#a7f3d0;margin:8px 0 0">{{agent.name}} · {{agent.businessName}}</p>
</div>
<div style="background:#fff;padding:24px;border-radius:0 0 12px 12px;border:1px solid #e5e7eb;border-top:none">
<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px">
<div><span style="font-size:22px;font-weight:700;color:#111">{{lead.name}}</span><br><span style="color:#6b7280;font-size:14px">{{lead.company}}</span></div>
<div style="background:#ecfdf5;border:2px solid #10b981;color:#065f46;padding:8px 18px;border-radius:999px;font-weight:700;font-size:20px">{{lead.score}}<span style="font-size:12px;font-weight:400">/100</span></div>
</div>
<div style="background:#f9fafb;border-radius:8px;padding:16px;margin-bottom:16px">
<p style="margin:4px 0;color:#374151;font-size:14px">📧 {{lead.email}}</p>
<p style="margin:4px 0;color:#374151;font-size:14px">📞 {{lead.phone}}</p>
<p style="margin:4px 0;color:#374151;font-size:14px">🏢 {{lead.company}}</p>
</div>
<div style="background:#f0fdf4;border-left:3px solid #10b981;padding:12px 16px;border-radius:0 8px 8px 0;margin-bottom:20px">
<p style="margin:0;color:#065f46;font-size:14px"><strong>Interest:</strong> {{lead.interest}}</p>
</div>
<p style="color:#9ca3af;font-size:11px;text-align:center;margin-top:8px">{{lead.createdAt}} · Sent by ELVA Connected Apps</p>
</div>
</div>`,
        isBuiltIn: true,
        previewData: PREVIEW,
    },

    // ── CALL COMPLETED - SLACK ─────────────────────────────────────────────
    {
        name: 'Call Completed - Slack Brief',
        description: 'Single-line Slack note when a call ends',
        source: 'calls',
        event: 'created',
        channel: 'slack',
        body: `📞 *Call Ended* · {{call.duration}} · {{call.from}} | Outcome: {{call.outcome}} | Sentiment: {{call.sentiment}} | {{agent.name}}`,
        isBuiltIn: true,
        previewData: PREVIEW,
    },
    {
        name: 'Call Completed - Slack Full Summary',
        description: 'Detailed Slack card with duration, outcome, sentiment, and summary',
        source: 'calls',
        event: 'created',
        channel: 'slack',
        body: JSON.stringify({
            text: 'Call completed - {{agent.name}}',
            blocks: [
                {
                    type: 'header',
                    text: { type: 'plain_text', text: '📞 Call Completed', emoji: true },
                },
                {
                    type: 'section',
                    fields: [
                        { type: 'mrkdwn', text: '*Duration*\n{{call.duration}}' },
                        { type: 'mrkdwn', text: '*From*\n{{call.from}}' },
                        { type: 'mrkdwn', text: '*Outcome*\n{{call.outcome}}' },
                        { type: 'mrkdwn', text: '*Sentiment*\n{{call.sentiment}}' },
                    ],
                },
                {
                    type: 'section',
                    text: { type: 'mrkdwn', text: '*Summary:* {{call.summary}}' },
                },
                { type: 'divider' },
                {
                    type: 'context',
                    elements: [{ type: 'mrkdwn', text: '{{agent.name}} · {{agent.businessName}}' }],
                },
            ],
        }),
        isBuiltIn: true,
        previewData: PREVIEW,
    },

    // ── ORDER CREATED - WHATSAPP ──────────────────────────────────────────
    {
        name: 'New Order - WhatsApp Brief',
        description: 'Short WhatsApp text alert with order essentials',
        source: 'orders',
        event: 'created',
        channel: 'whatsapp',
        body: `🛒 New Order #{{order.id}}\nCustomer: {{order.customerName}}\nItems: {{order.items}}\nTotal: {{order.currency}}{{order.total}}\nVia: {{agent.name}}`,
        isBuiltIn: true,
        previewData: PREVIEW,
    },
    {
        name: 'New Order - WhatsApp Detailed',
        description: 'Full WhatsApp message with customer info and itemized total',
        source: 'orders',
        event: 'created',
        channel: 'whatsapp',
        body: `🛒 *New Order #{{order.id}}*\n\n👤 {{order.customerName}}\n📞 {{order.customerPhone}}\n📧 {{order.customerEmail}}\n\n📦 Items: {{order.items}}\n\n💰 Subtotal: {{order.currency}}{{order.subtotal}}\n🧾 Tax: {{order.currency}}{{order.tax}}\n✅ *Total: {{order.currency}}{{order.total}}*\n\n🤖 {{agent.name}} · {{agent.businessName}}`,
        isBuiltIn: true,
        previewData: PREVIEW,
    },

    // ── LEAD CAPTURED - WHATSAPP ───────────────────────────────────────────
    {
        name: 'Lead Captured - WhatsApp Quick',
        description: 'Short WhatsApp alert for new lead with score',
        source: 'leads',
        event: 'created',
        channel: 'whatsapp',
        body: `🎯 New Lead: {{lead.name}}\nScore: {{lead.score}}/100\n📞 {{lead.phone}}\n✉️ {{lead.email}}\nVia: {{agent.name}}`,
        isBuiltIn: true,
        previewData: PREVIEW,
    },
    {
        name: 'Lead Captured - WhatsApp Full Card',
        description: 'Detailed WhatsApp message with interest and company',
        source: 'leads',
        event: 'created',
        channel: 'whatsapp',
        body: `🎯 *New Lead Captured*\n\n👤 {{lead.name}}\n🏢 {{lead.company}}\n📞 {{lead.phone}}\n✉️ {{lead.email}}\n\n💡 Interest: {{lead.interest}}\n📊 Lead Score: *{{lead.score}}/100*\n\n🤖 {{agent.name}} · {{agent.businessName}}`,
        isBuiltIn: true,
        previewData: PREVIEW,
    },

    // ── DAILY DIGEST - EMAIL ───────────────────────────────────────────────
    {
        name: 'Daily Digest - Email Stats Table',
        description: 'Clean daily summary table with orders, leads, and revenue',
        source: 'digest',
        event: 'digest',
        channel: 'email',
        subject: 'Daily Report: {{digest.date}} - {{agent.name}}',
        body: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:24px;color:#111">
<h2 style="color:#4f46e5;margin-bottom:4px">📊 Daily Summary</h2>
<p style="color:#6b7280;margin-top:0">{{agent.name}} · {{digest.date}}</p>
<table style="width:100%;border-collapse:collapse;margin:16px 0">
<tr style="background:#eef2ff"><th style="padding:10px;text-align:left;color:#3730a3;border-bottom:2px solid #c7d2fe">Metric</th><th style="padding:10px;text-align:right;color:#3730a3;border-bottom:2px solid #c7d2fe">Value</th></tr>
<tr><td style="padding:10px;border-bottom:1px solid #f3f4f6">Orders Today</td><td style="padding:10px;border-bottom:1px solid #f3f4f6;text-align:right;font-weight:600">{{digest.ordersCount}}</td></tr>
<tr style="background:#f9fafb"><td style="padding:10px;border-bottom:1px solid #f3f4f6">Revenue Today</td><td style="padding:10px;border-bottom:1px solid #f3f4f6;text-align:right;font-weight:600;color:#4f46e5">{{digest.currency}}{{digest.revenue}}</td></tr>
<tr><td style="padding:10px">New Leads</td><td style="padding:10px;text-align:right;font-weight:600">{{digest.leadsCount}}</td></tr>
</table>
<p style="color:#9ca3af;font-size:12px;margin-top:24px">Sent by ELVA · {{agent.name}}</p>
</div>`,
        isBuiltIn: true,
        previewData: PREVIEW,
    },
    {
        name: 'Daily Digest - Email Visual Summary',
        description: 'Visual daily report with color-coded metric cards',
        source: 'digest',
        event: 'digest',
        channel: 'email',
        subject: '📊 {{agent.name}}: {{digest.ordersCount}} orders · {{digest.currency}}{{digest.revenue}} revenue today',
        body: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;background:#f9fafb">
<div style="background:linear-gradient(135deg,#4f46e5,#7c3aed);padding:32px 24px;border-radius:12px 12px 0 0;text-align:center">
<h1 style="color:#fff;margin:0;font-size:24px">📊 Daily Summary</h1>
<p style="color:#c4b5fd;margin:8px 0 0">{{agent.name}} · {{digest.date}}</p>
</div>
<div style="background:#fff;padding:24px;border-radius:0 0 12px 12px;border:1px solid #e5e7eb;border-top:none">
<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;margin-bottom:20px">
<div style="text-align:center;background:#eef2ff;border-radius:10px;padding:16px">
<div style="font-size:32px;font-weight:700;color:#4f46e5">{{digest.ordersCount}}</div>
<div style="font-size:12px;color:#6b7280;margin-top:4px">Orders</div>
</div>
<div style="text-align:center;background:#ecfdf5;border-radius:10px;padding:16px">
<div style="font-size:32px;font-weight:700;color:#059669">{{digest.leadsCount}}</div>
<div style="font-size:12px;color:#6b7280;margin-top:4px">Leads</div>
</div>
<div style="text-align:center;background:#fffbeb;border-radius:10px;padding:16px">
<div style="font-size:24px;font-weight:700;color:#d97706">{{digest.currency}}{{digest.revenue}}</div>
<div style="font-size:12px;color:#6b7280;margin-top:4px">Revenue</div>
</div>
</div>
<p style="color:#9ca3af;font-size:11px;text-align:center">Sent by ELVA Connected Apps</p>
</div>
</div>`,
        isBuiltIn: true,
        previewData: PREVIEW,
    },
];

export async function seedBuiltInTemplates(): Promise<void> {
    try {
        const existing = await ConnectorTemplate.countDocuments({ isBuiltIn: true });
        if (existing >= BUILT_IN_TEMPLATES.length) return;

        // Remove stale built-ins and re-seed (handles template updates on deploy)
        await ConnectorTemplate.deleteMany({ isBuiltIn: true });
        await ConnectorTemplate.insertMany(BUILT_IN_TEMPLATES);
        console.log(`[Connectors] Seeded ${BUILT_IN_TEMPLATES.length} built-in templates`);
    } catch (err) {
        console.error('[Connectors] Failed to seed templates:', err);
    }
}
