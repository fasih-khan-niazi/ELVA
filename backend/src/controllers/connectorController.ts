import { Response } from 'express';
import { AuthRequest } from '../middleware/authMiddleware';
import { Connector, ConnectorTemplate, ConnectorLog } from '../models/Connector';
import { testConnector } from '../services/connectorService';
import { recordWorkspaceAudit } from '../services/auditService';

// GET /api/connectors?agentId=... (omit agentId for global dashboard)
export const getConnectors = async (req: AuthRequest, res: Response) => {
    try {
        const tenantId = req.user!.tenantId!;
        const { agentId } = req.query;

        const query: Record<string, any> = { tenantId };
        if (agentId) query.agentId = agentId;

        const connectors = await Connector.find(query)
            .populate('agentId', 'name')
            .sort({ createdAt: -1 });

        return res.json(connectors);
    } catch (err) {
        console.error('getConnectors error:', err);
        return res.status(500).json({ message: 'Server error' });
    }
};

// GET /api/connectors/:id
export const getConnector = async (req: AuthRequest, res: Response) => {
    try {
        const tenantId = req.user!.tenantId!;
        const connector = await Connector.findOne({ _id: req.params.id, tenantId });
        if (!connector) return res.status(404).json({ message: 'Alerts and notifications connector not found' });
        return res.json(connector);
    } catch (err) {
        return res.status(500).json({ message: 'Server error' });
    }
};

// POST /api/connectors
export const createConnector = async (req: AuthRequest, res: Response) => {
    try {
        const tenantId = req.user!.tenantId!;
        const { agentId, name, trigger, destination, deliveryMode, templateId, customTemplate } = req.body;

        if (!agentId || !name || !trigger || !destination) {
            return res.status(400).json({ message: 'agentId, name, trigger, and destination are required' });
        }

        const connector = await Connector.create({
            tenantId,
            agentId,
            name,
            trigger,
            destination,
            deliveryMode: deliveryMode || 'instant',
            templateId: templateId || undefined,
            customTemplate: customTemplate || undefined,
        });

        recordWorkspaceAudit(req, {
            tenantId,
            actorId: req.user!.userId,
            action: 'connector.create',
            targetType: 'connector',
            targetId: String(connector._id),
            metadata: { name, agentId: String(agentId) },
        });

        return res.status(201).json(connector);
    } catch (err: any) {
        console.error('createConnector error:', err);
        return res.status(500).json({ message: err.message || 'Server error' });
    }
};

// PUT /api/connectors/:id
export const updateConnector = async (req: AuthRequest, res: Response) => {
    try {
        const tenantId = req.user!.tenantId!;
        const { name, trigger, destination, deliveryMode, templateId, customTemplate, status } = req.body;

        const connector = await Connector.findOneAndUpdate(
            { _id: req.params.id, tenantId },
            { $set: { name, trigger, destination, deliveryMode, templateId, customTemplate, status } },
            { new: true, runValidators: true }
        );

        if (!connector) return res.status(404).json({ message: 'Alerts and notifications connector not found' });
        recordWorkspaceAudit(req, {
            tenantId,
            actorId: req.user!.userId,
            action: 'connector.update',
            targetType: 'connector',
            targetId: String(connector._id),
            metadata: { name: connector.name },
        });
        return res.json(connector);
    } catch (err: any) {
        return res.status(500).json({ message: err.message || 'Server error' });
    }
};

// PATCH /api/connectors/:id/status - toggle active/paused
export const toggleConnectorStatus = async (req: AuthRequest, res: Response) => {
    try {
        const tenantId = req.user!.tenantId!;
        const { status } = req.body;

        if (!['active', 'paused'].includes(status)) {
            return res.status(400).json({ message: 'status must be active or paused' });
        }

        const connector = await Connector.findOneAndUpdate(
            { _id: req.params.id, tenantId },
            { $set: { status, failureAlert: false } },
            { new: true }
        );

        if (!connector) return res.status(404).json({ message: 'Alerts and notifications connector not found' });
        recordWorkspaceAudit(req, {
            tenantId,
            actorId: req.user!.userId,
            action: 'connector.update',
            targetType: 'connector',
            targetId: String(connector._id),
            metadata: { name: connector.name, status },
        });
        return res.json(connector);
    } catch (err) {
        return res.status(500).json({ message: 'Server error' });
    }
};

// DELETE /api/connectors/:id
export const deleteConnector = async (req: AuthRequest, res: Response) => {
    try {
        const tenantId = req.user!.tenantId!;
        const connector = await Connector.findOneAndDelete({ _id: req.params.id, tenantId });
        if (!connector) return res.status(404).json({ message: 'Alerts and notifications connector not found' });
        recordWorkspaceAudit(req, {
            tenantId,
            actorId: req.user!.userId,
            action: 'connector.delete',
            targetType: 'connector',
            targetId: req.params.id,
            metadata: { name: connector.name },
        });
        await ConnectorLog.deleteMany({ connectorId: req.params.id });
        return res.json({ message: 'Alerts and notifications connector removed' });
    } catch (err) {
        return res.status(500).json({ message: 'Server error' });
    }
};

// POST /api/connectors/:id/test - send a test message
export const testConnectorHandler = async (req: AuthRequest, res: Response) => {
    try {
        const tenantId = req.user!.tenantId!;
        const connector = await Connector.findOne({ _id: req.params.id, tenantId });
        if (!connector) return res.status(404).json({ message: 'Alerts and notifications connector not found' });

        await testConnector(connector);
        return res.json({ message: 'Test message sent successfully' });
    } catch (err: any) {
        return res.status(400).json({ message: err.message || 'Test failed' });
    }
};

// GET /api/connectors/:id/logs
export const getConnectorLogs = async (req: AuthRequest, res: Response) => {
    try {
        const tenantId = req.user!.tenantId!;
        const connector = await Connector.findOne({ _id: req.params.id, tenantId });
        if (!connector) return res.status(404).json({ message: 'Alerts and notifications connector not found' });

        const logs = await ConnectorLog.find({ connectorId: req.params.id })
            .sort({ createdAt: -1 })
            .limit(50);

        return res.json(logs);
    } catch (err) {
        return res.status(500).json({ message: 'Server error' });
    }
};

// GET /api/connectors/templates - list all built-in templates (no auth filter needed)
export const getTemplates = async (req: AuthRequest, res: Response) => {
    try {
        const { source, channel } = req.query;
        const query: Record<string, any> = {};
        if (source) query.source = source;
        if (channel) query.channel = channel;

        const templates = await ConnectorTemplate.find(query).sort({ source: 1, name: 1 });
        return res.json(templates);
    } catch (err) {
        return res.status(500).json({ message: 'Server error' });
    }
};

// GET /api/connectors/stats - global stats for dashboard
export const getConnectorStats = async (req: AuthRequest, res: Response) => {
    try {
        const tenantId = req.user!.tenantId!;

        const [total, active, failed, paused] = await Promise.all([
            Connector.countDocuments({ tenantId }),
            Connector.countDocuments({ tenantId, status: 'active' }),
            Connector.countDocuments({ tenantId, status: 'failed' }),
            Connector.countDocuments({ tenantId, status: 'paused' }),
        ]);

        const sentAgg = await Connector.aggregate([
            { $match: { tenantId: tenantId as any } },
            { $group: { _id: null, totalSent: { $sum: '$stats.sent' }, totalFailed: { $sum: '$stats.failed' } } },
        ]);

        return res.json({
            total, active, failed, paused,
            totalSent: sentAgg[0]?.totalSent || 0,
            totalFailed: sentAgg[0]?.totalFailed || 0,
        });
    } catch (err) {
        return res.status(500).json({ message: 'Server error' });
    }
};
