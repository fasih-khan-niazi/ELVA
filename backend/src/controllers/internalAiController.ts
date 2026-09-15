import { Request, Response } from 'express';
import { CatalogItem, Order, Agent, Lead } from '../models';
import { fire } from '../services/connectorService';

/** Called by ai_service - must pass `INTERNAL_API_SECRET` (see middleware). */
export async function internalGetCatalog(req: Request, res: Response) {
    try {
        const { agentId, tenantId } = req.query;
        if (!agentId || !tenantId) {
            return res.status(400).json({ message: 'agentId and tenantId are required' });
        }
        const [items, agent] = await Promise.all([
            CatalogItem.find({ agentId, tenantId, available: true })
                .select('name description price category options')
                .sort({ category: 1, name: 1 })
                .lean(),
            Agent.findOne({ _id: agentId, tenantId }).select('currency').lean(),
        ]);
        return res.json({ items, currency: agent?.currency || 'USD' });
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Server error';
        console.error('[internal/catalog]', msg);
        return res.status(500).json({ message: 'Server error' });
    }
}

export async function internalPostOrder(req: Request, res: Response) {
    try {
        const {
            agentId,
            tenantId,
            sessionId,
            channel,
            currency,
            items,
            customerName,
            customerPhone,
            customerEmail,
            customerAddress,
            notes,
            orderType,
            paymentMethod,
        } = req.body;

        if (!agentId || !tenantId || !items || !items.length) {
            return res.status(400).json({ message: 'agentId, tenantId, and items are required' });
        }

        const agent = await Agent.findOne({ _id: agentId, tenantId });
        if (!agent) {
            return res.status(404).json({ message: 'Agent not found' });
        }

        // Currency precedence: explicit from AI service → agent.currency → PKR default
        const orderCurrency = (currency || agent.currency || 'PKR').toUpperCase();

        const order = await Order.create({
            agentId,
            tenantId,
            sessionId: sessionId || `order_${Date.now()}`,
            channel: channel || 'chat',
            currency: orderCurrency,
            items,
            orderType: orderType || undefined,
            paymentMethod: paymentMethod || undefined,
            customerName,
            customerPhone,
            customerEmail,
            customerAddress,
            notes,
        });

        console.log(`[INTERNAL] Order created: ${order._id} for agent ${agentId}`);
        fire({ eventType: 'order.created', agentId, tenantId, data: order }).catch((err: unknown) => console.error('[connector] fire failed:', err instanceof Error ? err.message : err));
        return res.status(201).json(order);
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Server error';
        console.error('[internal/orders]', msg);
        return res.status(500).json({ message: 'Server error' });
    }
}

export async function internalPostLead(req: Request, res: Response) {
    try {
        const {
            agentId,
            tenantId,
            sessionId,
            channel,
            name,
            email,
            phone,
            company,
            interest,
            notes,
            tags,
        } = req.body;

        if (!agentId || !tenantId) {
            return res.status(400).json({ message: 'agentId and tenantId are required' });
        }

        const agent = await Agent.findOne({ _id: agentId, tenantId });
        if (!agent) {
            return res.status(404).json({ message: 'Agent not found' });
        }

        if (email || phone) {
            const existing = await Lead.findOne({
                tenantId,
                agentId,
                $or: [...(email ? [{ email }] : []), ...(phone ? [{ phone }] : [])],
            });
            if (existing) {
                if (name && !existing.name) existing.name = name;
                if (email && !existing.email) existing.email = email;
                if (phone && !existing.phone) existing.phone = phone;
                if (company && !existing.company) existing.company = company;
                if (interest) existing.interest = [existing.interest, interest].filter(Boolean).join('; ');
                if (notes) existing.notes = [existing.notes, notes].filter(Boolean).join('\n');
                if (tags?.length) existing.tags = [...new Set([...existing.tags, ...tags])];
                existing.lastActivity = new Date();
                if (existing.status === 'lost') {
                    existing.status = 'new';
                }
                if (tags?.includes('order_placed') && existing.status !== 'converted') {
                    existing.status = 'qualified';
                }
                await existing.save();
                console.log(`[INTERNAL] Lead updated: ${existing._id} for agent ${agentId}`);
                fire({ eventType: 'lead.created', agentId, tenantId, data: existing }).catch((err: unknown) => console.error('[connector] fire failed:', err instanceof Error ? err.message : err));
                return res.status(200).json(existing);
            }
        }

        const lead = await Lead.create({
            agentId,
            tenantId,
            sessionId: sessionId || `lead_${Date.now()}`,
            channel: channel || 'chat',
            name,
            email,
            phone,
            company,
            interest: interest || '',
            notes,
            source: 'auto',
            tags: tags || [],
            status: tags?.includes('order_placed') ? 'qualified' : 'new',
        });

        console.log(`[INTERNAL] Lead created: ${lead._id} for agent ${agentId}`);
        fire({ eventType: 'lead.created', agentId, tenantId, data: lead }).catch((err: unknown) => console.error('[connector] fire failed:', err instanceof Error ? err.message : err));
        return res.status(201).json(lead);
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Server error';
        console.error('[internal/leads]', msg);
        return res.status(500).json({ message: 'Server error' });
    }
}
