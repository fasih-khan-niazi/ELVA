import { Request, Response } from 'express';
import { Lead, Agent } from '../models';

// Create a new lead
export const createLead = async (req: Request, res: Response) => {
    try {
        const {
            agentId, sessionId, channel, name, email, phone,
            company, interest, notes, source, tags
        } = req.body;
        const tenantId = (req as any).user?.tenantId;

        if (!agentId) {
            return res.status(400).json({ message: 'agentId is required' });
        }

        const agent = await Agent.findOne({ _id: agentId, tenantId });
        if (!agent) {
            return res.status(404).json({ message: 'Agent not found' });
        }

        // Check for duplicate leads by email or phone within same tenant
        if (email || phone) {
            const existing = await Lead.findOne({
                tenantId,
                agentId,
                $or: [
                    ...(email ? [{ email }] : []),
                    ...(phone ? [{ phone }] : []),
                ]
            });
            if (existing) {
                // Update existing lead instead of creating duplicate
                if (name && !existing.name) existing.name = name;
                if (email && !existing.email) existing.email = email;
                if (phone && !existing.phone) existing.phone = phone;
                if (company && !existing.company) existing.company = company;
                if (interest) existing.interest = [existing.interest, interest].filter(Boolean).join('; ');
                if (notes) existing.notes = [existing.notes, notes].filter(Boolean).join('\n');
                if (tags?.length) existing.tags = [...new Set([...existing.tags, ...tags])];
                existing.lastActivity = new Date();
                await existing.save();
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
            source: source || 'manual',
            tags: tags || [],
        });

        return res.status(201).json(lead);
    } catch (err: any) {
        console.error('Error creating lead:', err);
        return res.status(500).json({ message: 'Server error' });
    }
};

// Get all leads for an agent
export const getLeads = async (req: Request, res: Response) => {
    try {
        const { agentId } = req.params;
        const tenantId = (req as any).user?.tenantId;
        const { status, page = '1', limit = '25', search, sort = '-createdAt' } = req.query;

        const agent = await Agent.findOne({ _id: agentId, tenantId });
        if (!agent) {
            return res.status(404).json({ message: 'Agent not found' });
        }

        const filter: any = { agentId, tenantId };
        if (status && status !== 'all') filter.status = status;
        if (search) {
            const regex = new RegExp(search as string, 'i');
            filter.$or = [
                { name: regex },
                { email: regex },
                { phone: regex },
                { company: regex },
                { interest: regex },
            ];
        }

        const pageNum = parseInt(page as string, 10);
        const limitNum = parseInt(limit as string, 10);
        const skip = (pageNum - 1) * limitNum;

        const [leads, total] = await Promise.all([
            Lead.find(filter).sort(sort as string).skip(skip).limit(limitNum),
            Lead.countDocuments(filter),
        ]);

        return res.json({
            leads,
            total,
            page: pageNum,
            pages: Math.ceil(total / limitNum),
        });
    } catch (err: any) {
        console.error('Error fetching leads:', err);
        return res.status(500).json({ message: 'Server error' });
    }
};

// Get a single lead
export const getLeadById = async (req: Request, res: Response) => {
    try {
        const { agentId, leadId } = req.params;
        const tenantId = (req as any).user?.tenantId;

        const lead = await Lead.findOne({ _id: leadId, agentId, tenantId });
        if (!lead) {
            return res.status(404).json({ message: 'Lead not found' });
        }

        return res.json(lead);
    } catch (err: any) {
        console.error('Error fetching lead:', err);
        return res.status(500).json({ message: 'Server error' });
    }
};

// Update lead status
export const updateLeadStatus = async (req: Request, res: Response) => {
    try {
        const { agentId, leadId } = req.params;
        const { status } = req.body;
        const tenantId = (req as any).user?.tenantId;

        const validStatuses = ['new', 'contacted', 'qualified', 'converted', 'lost'];
        if (!validStatuses.includes(status)) {
            return res.status(400).json({ message: `Invalid status. Must be one of: ${validStatuses.join(', ')}` });
        }

        const lead = await Lead.findOneAndUpdate(
            { _id: leadId, agentId, tenantId },
            { status, lastActivity: new Date() },
            { new: true }
        );
        if (!lead) {
            return res.status(404).json({ message: 'Lead not found' });
        }

        return res.json(lead);
    } catch (err: any) {
        console.error('Error updating lead status:', err);
        return res.status(500).json({ message: 'Server error' });
    }
};

// Update lead details
export const updateLead = async (req: Request, res: Response) => {
    try {
        const { agentId, leadId } = req.params;
        const tenantId = (req as any).user?.tenantId;
        const { name, email, phone, company, interest, notes, tags, status } = req.body;

        const update: any = { lastActivity: new Date() };
        if (name !== undefined) update.name = name;
        if (email !== undefined) update.email = email;
        if (phone !== undefined) update.phone = phone;
        if (company !== undefined) update.company = company;
        if (interest !== undefined) update.interest = interest;
        if (notes !== undefined) update.notes = notes;
        if (tags !== undefined) update.tags = tags;
        if (status !== undefined) update.status = status;

        const lead = await Lead.findOneAndUpdate(
            { _id: leadId, agentId, tenantId },
            update,
            { new: true }
        );
        if (!lead) {
            return res.status(404).json({ message: 'Lead not found' });
        }

        return res.json(lead);
    } catch (err: any) {
        console.error('Error updating lead:', err);
        return res.status(500).json({ message: 'Server error' });
    }
};

// Delete a lead
export const deleteLead = async (req: Request, res: Response) => {
    try {
        const { agentId, leadId } = req.params;
        const tenantId = (req as any).user?.tenantId;

        const lead = await Lead.findOneAndDelete({ _id: leadId, agentId, tenantId });
        if (!lead) {
            return res.status(404).json({ message: 'Lead not found' });
        }

        return res.json({ message: 'Lead deleted' });
    } catch (err: any) {
        console.error('Error deleting lead:', err);
        return res.status(500).json({ message: 'Server error' });
    }
};

// Export all leads as CSV
export const exportLeadsCSV = async (req: Request, res: Response) => {
    try {
        const { agentId } = req.params;
        const tenantId = (req as any).user?.tenantId;

        const agent = await Agent.findOne({ _id: agentId, tenantId });
        if (!agent) return res.status(404).json({ message: 'Agent not found' });

        const leads = await Lead.find({ agentId, tenantId }).sort({ createdAt: -1 }).lean();

        const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
        const headers = ['Name', 'Email', 'Phone', 'Company', 'Status', 'Score', 'Interest', 'Source', 'Channel', 'Tags', 'Notes', 'Created At', 'Last Activity'];
        const rows = leads.map((l: any) => [
            esc(l.name), esc(l.email), esc(l.phone), esc(l.company),
            esc(l.status), esc(l.score), esc(l.interest), esc(l.source),
            esc(l.channel), esc((l.tags || []).join('; ')), esc(l.notes),
            esc(l.createdAt ? new Date(l.createdAt).toISOString() : ''),
            esc(l.lastActivity ? new Date(l.lastActivity).toISOString() : ''),
        ].join(','));

        const csv = [headers.map(esc).join(','), ...rows].join('\n');
        const date = new Date().toISOString().slice(0, 10);

        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="leads_${date}.csv"`);
        return res.send('﻿' + csv);
    } catch (err: any) {
        console.error('Error exporting leads CSV:', err);
        return res.status(500).json({ message: 'Server error' });
    }
};

// Get lead stats
export const getLeadStats = async (req: Request, res: Response) => {
    try {
        const { agentId } = req.params;
        const tenantId = (req as any).user?.tenantId;

        const agent = await Agent.findOne({ _id: agentId, tenantId });
        if (!agent) {
            return res.status(404).json({ message: 'Agent not found' });
        }

        const now = new Date();
        const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const weekStart = new Date(todayStart);
        weekStart.setDate(weekStart.getDate() - 7);

        const [totalLeads, todayLeads, weekLeads, byStatus, bySource, avgScore] = await Promise.all([
            Lead.countDocuments({ agentId, tenantId }),
            Lead.countDocuments({ agentId, tenantId, createdAt: { $gte: todayStart } }),
            Lead.countDocuments({ agentId, tenantId, createdAt: { $gte: weekStart } }),
            Lead.aggregate([
                { $match: { agentId: agent._id, tenantId: agent.tenantId } },
                { $group: { _id: '$status', count: { $sum: 1 } } }
            ]),
            Lead.aggregate([
                { $match: { agentId: agent._id, tenantId: agent.tenantId } },
                { $group: { _id: '$source', count: { $sum: 1 } } }
            ]),
            Lead.aggregate([
                { $match: { agentId: agent._id, tenantId: agent.tenantId } },
                { $group: { _id: null, avg: { $avg: '$score' } } }
            ]),
        ]);

        const statusMap: Record<string, number> = {};
        byStatus.forEach((s: any) => { statusMap[s._id] = s.count; });

        const sourceMap: Record<string, number> = {};
        bySource.forEach((s: any) => { sourceMap[s._id] = s.count; });

        const conversionRate = totalLeads > 0
            ? ((statusMap['converted'] || 0) / totalLeads * 100).toFixed(1)
            : '0.0';

        return res.json({
            totalLeads,
            todayLeads,
            weekLeads,
            byStatus: statusMap,
            bySource: sourceMap,
            avgScore: avgScore[0]?.avg ? Math.round(avgScore[0].avg) : 0,
            conversionRate: parseFloat(conversionRate),
        });
    } catch (err: any) {
        console.error('Error fetching lead stats:', err);
        return res.status(500).json({ message: 'Server error' });
    }
};
