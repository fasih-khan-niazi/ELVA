import { Response, NextFunction } from 'express';
import { AuthRequest } from './authMiddleware';
import { Subscription, PLAN_LIMITS, PlanType } from '../models';
import { Connector } from '../models/Connector';

export const checkConnectorLimit = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const tenantId = req.user?.tenantId;
        if (!tenantId) return res.status(400).json({ message: 'Tenant ID not found' });

        const subscription = await Subscription.findOne({ tenantId });
        const plan = (subscription?.plan || 'free') as PlanType;
        const limits = PLAN_LIMITS[plan] as any;

        if (limits.maxConnectors === 0) {
            return res.status(403).json({
                message: 'Alerts and notifications require a paid plan. Please upgrade.',
                error: 'FEATURE_NOT_AVAILABLE',
                feature: 'connectors',
                upgrade: true,
            });
        }

        if (limits.maxConnectors === -1) return next();

        const count = await Connector.countDocuments({ tenantId });
        if (count >= limits.maxConnectors) {
            return res.status(403).json({
                message: 'Alerts and notifications limit reached for your plan',
                error: 'LIMIT_REACHED',
                limit: limits.maxConnectors,
                used: count,
                upgrade: true,
            });
        }

        next();
    } catch (err) {
        console.error('Error checking connector limit:', err);
        res.status(500).json({ message: 'Error checking subscription limits' });
    }
};
