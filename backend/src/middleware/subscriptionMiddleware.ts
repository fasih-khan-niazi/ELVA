import { Response, NextFunction } from 'express';
import { AuthRequest } from './authMiddleware';
import { Subscription, Agent, DocumentModel, PLAN_LIMITS, PlanType } from '../models';

// Check if user can create more agents
export const checkAgentLimit = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const tenantId = req.user?.tenantId;

        if (!tenantId) {
            return res.status(400).json({ message: 'Tenant ID not found' });
        }

        const subscription = await Subscription.findOne({ tenantId });
        const plan = subscription?.plan || 'free';
        const limits = PLAN_LIMITS[plan as PlanType];

        // Check if unlimited
        if (limits.maxAgents === -1) {
            return next();
        }

        const agentCount = await Agent.countDocuments({ tenantId });

        if (agentCount >= limits.maxAgents) {
            return res.status(403).json({
                message: 'Agent limit reached',
                error: 'LIMIT_REACHED',
                limit: limits.maxAgents,
                used: agentCount,
                upgrade: true
            });
        }

        next();
    } catch (error) {
        console.error('Error checking agent limit:', error);
        res.status(500).json({ message: 'Error checking subscription limits' });
    }
};

// Check if user can upload more documents (monthly consumption-based limit)
export const checkDocumentLimit = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const tenantId = req.user?.tenantId;

        if (!tenantId) {
            return res.status(400).json({ message: 'Tenant ID not found' });
        }

        let subscription = await Subscription.findOne({ tenantId });
        const plan = subscription?.plan || 'free';
        const limits = PLAN_LIMITS[plan as PlanType];

        // Check if unlimited
        if (limits.maxDocuments === -1) {
            return next();
        }

        // Reset monthly counter if new billing month
        if (subscription) {
            const now = new Date();
            const lastReset = new Date(subscription.lastDocumentCountReset || subscription.createdAt);
            if (now.getMonth() !== lastReset.getMonth() || now.getFullYear() !== lastReset.getFullYear()) {
                subscription.documentsUploadedThisMonth = 0;
                subscription.lastDocumentCountReset = now;
                await subscription.save();
            }
        }

        const used = subscription?.documentsUploadedThisMonth ?? 0;

        // Support batch: req.files (array) or single req.file
        const filesCount = Array.isArray((req as any).files)
            ? (req as any).files.length
            : 1;

        const remaining = limits.maxDocuments - used;

        if (remaining <= 0 || filesCount > remaining) {
            return res.status(403).json({
                message: filesCount > 1
                    ? `Upload would exceed your monthly limit. You have ${remaining} document upload(s) remaining this month.`
                    : 'Monthly document upload limit reached',
                error: 'DOCUMENT_LIMIT_REACHED',
                limit: limits.maxDocuments,
                used,
                remaining,
                upgrade: true
            });
        }

        next();
    } catch (error) {
        console.error('Error checking document limit:', error);
        res.status(500).json({ message: 'Error checking subscription limits' });
    }
};

// Check document size limit (supports single and multiple files)
export const checkDocumentSize = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const tenantId = req.user?.tenantId;

        if (!tenantId) {
            return res.status(400).json({ message: 'Tenant ID not found' });
        }

        const subscription = await Subscription.findOne({ tenantId });
        const plan = subscription?.plan || 'free';
        const limits = PLAN_LIMITS[plan as PlanType];

        // Collect all files (single or batch)
        const files: Express.Multer.File[] = Array.isArray((req as any).files)
            ? (req as any).files
            : ((req as any).file ? [(req as any).file] : []);

        for (const file of files) {
            const fileSizeMB = file.size / (1024 * 1024);
            if (fileSizeMB > limits.maxDocumentSizeMB) {
                return res.status(403).json({
                    message: `File "${file.originalname}" exceeds the size limit of ${limits.maxDocumentSizeMB}MB for your plan`,
                    error: 'SIZE_LIMIT_EXCEEDED',
                    filename: file.originalname,
                    limit: limits.maxDocumentSizeMB,
                    fileSize: fileSizeMB.toFixed(2),
                    upgrade: true
                });
            }
        }

        next();
    } catch (error) {
        console.error('Error checking document size:', error);
        res.status(500).json({ message: 'Error checking subscription limits' });
    }
};

// Check if voice is enabled for the plan
export const checkVoiceEnabled = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const tenantId = req.user?.tenantId;

        if (!tenantId) {
            return res.status(400).json({ message: 'Tenant ID not found' });
        }

        const subscription = await Subscription.findOne({ tenantId });
        const plan = subscription?.plan || 'free';
        const limits = PLAN_LIMITS[plan as PlanType];

        if (!limits.voiceEnabled) {
            return res.status(403).json({
                message: 'Voice agents are not available on your plan',
                error: 'FEATURE_NOT_AVAILABLE',
                feature: 'voice',
                upgrade: true
            });
        }

        next();
    } catch (error) {
        console.error('Error checking voice feature:', error);
        res.status(500).json({ message: 'Error checking subscription limits' });
    }
};

/** Analytics dashboards & reporting APIs (per plan `analyticsEnabled`). */
export const requireAnalyticsEnabled = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const tenantId = req.user?.tenantId;
        if (!tenantId) {
            return res.status(400).json({ message: 'Tenant ID not found' });
        }
        const subscription = await Subscription.findOne({ tenantId });
        const plan = subscription?.plan || 'free';
        const limits = PLAN_LIMITS[plan as PlanType];
        if (!limits.analyticsEnabled) {
            return res.status(403).json({
                message: 'Analytics dashboards are not included on your plan. Upgrade to unlock.',
                error: 'ANALYTICS_NOT_AVAILABLE',
                feature: 'analytics',
                upgrade: true,
            });
        }
        next();
    } catch (error) {
        console.error('Error checking analytics feature:', error);
        res.status(500).json({ message: 'Error checking subscription limits' });
    }
};

// Check message limit
export const checkMessageLimit = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const tenantId = req.user?.tenantId;

        if (!tenantId) {
            return res.status(400).json({ message: 'Tenant ID not found' });
        }

        let subscription = await Subscription.findOne({ tenantId });
        
        if (!subscription) {
            subscription = await Subscription.create({
                tenantId,
                plan: 'free',
                status: 'active'
            });
        }

        const plan = subscription.plan;
        const limits = PLAN_LIMITS[plan as PlanType];

        // Reset message count if new month
        const now = new Date();
        const lastReset = new Date(subscription.lastMessageCountReset);
        if (now.getMonth() !== lastReset.getMonth() || now.getFullYear() !== lastReset.getFullYear()) {
            subscription.messagesUsedThisMonth = 0;
            subscription.lastMessageCountReset = now;
            await subscription.save();
        }

        // Check if unlimited
        if (limits.maxMessagesPerMonth === -1) {
            return next();
        }

        if (subscription.messagesUsedThisMonth >= limits.maxMessagesPerMonth) {
            return res.status(403).json({
                message: 'Monthly message limit reached',
                error: 'MESSAGE_LIMIT_REACHED',
                limit: limits.maxMessagesPerMonth,
                used: subscription.messagesUsedThisMonth,
                resetsAt: new Date(now.getFullYear(), now.getMonth() + 1, 1),
                upgrade: true
            });
        }

        next();
    } catch (error) {
        console.error('Error checking message limit:', error);
        res.status(500).json({ message: 'Error checking subscription limits' });
    }
};

// Check if subscription is active
export const requireActiveSubscription = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const tenantId = req.user?.tenantId;

        if (!tenantId) {
            return res.status(400).json({ message: 'Tenant ID not found' });
        }

        const subscription = await Subscription.findOne({ tenantId });

        // Allow if no subscription (they get free tier)
        if (!subscription) {
            return next();
        }

        // Check status
        if (subscription.status === 'past_due') {
            return res.status(403).json({
                message: 'Your subscription payment is past due. Please update your payment method.',
                error: 'SUBSCRIPTION_PAST_DUE',
                updatePayment: true
            });
        }

        if (subscription.status === 'canceled' && subscription.plan !== 'free') {
            // Downgrade to free if subscription was canceled
            subscription.plan = 'free';
            await subscription.save();
        }

        next();
    } catch (error) {
        console.error('Error checking subscription status:', error);
        res.status(500).json({ message: 'Error checking subscription' });
    }
};
