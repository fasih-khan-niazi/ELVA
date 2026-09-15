import { Response } from 'express';
import { AuthRequest } from '../middleware/authMiddleware';
import { Subscription, Tenant, Agent, DocumentModel, PLAN_LIMITS, PlanType } from '../models';
import { countTenantUsers, maxSeatsForPlan } from '../utils/seatLimits';
import { recordWorkspaceAudit } from '../services/auditService';
import Stripe from 'stripe';

// Initialize Stripe
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || '', {
    apiVersion: '2023-10-16'
});

// Stripe Price IDs (you'll set these in your .env after creating products in Stripe)
const STRIPE_PRICE_IDS: Record<PlanType, string> = {
    free: '',
    starter: process.env.STRIPE_STARTER_PRICE_ID || '',
    pro: process.env.STRIPE_PRO_PRICE_ID || '',
    enterprise: process.env.STRIPE_ENTERPRISE_PRICE_ID || ''
};

// Plan prices in cents for dynamic pricing (when no Price IDs configured)
const PLAN_PRICES_CENTS: Record<PlanType, number> = {
    free: 0,
    starter: 2000, // $20
    pro: 10000, // $100
    enterprise: 75000, // $750
};

// Helper function to get or create a Stripe price for a plan
async function getOrCreateStripePrice(plan: PlanType): Promise<string> {
    // First check if we have a configured price ID
    const configuredPriceId = STRIPE_PRICE_IDS[plan];
    if (configuredPriceId) {
        return configuredPriceId;
    }

    // Create a price dynamically (for development/testing)
    const planName = plan.charAt(0).toUpperCase() + plan.slice(1);
    
    // Create a product first
    const product = await stripe.products.create({
        name: `ELVA ${planName} Plan`,
        description: `ELVA AI Agent ${planName} subscription plan`,
        metadata: { plan }
    });

    // Create a recurring price for the product
    const price = await stripe.prices.create({
        product: product.id,
        unit_amount: PLAN_PRICES_CENTS[plan],
        currency: 'usd',
        recurring: {
            interval: 'month'
        },
        metadata: { plan }
    });

    return price.id;
}

/** Apply a paid Stripe Checkout session to the tenant subscription (shared by verify + webhook). */
async function activateSubscriptionFromCheckoutSession(
    session: Stripe.Checkout.Session,
    stripeSubscription: Stripe.Subscription,
): Promise<{ tenantId: string; plan: PlanType } | null> {
    const tenantId = session.metadata?.tenantId;
    const plan = session.metadata?.plan as PlanType | undefined;

    if (!tenantId || !plan) {
        console.error('[stripe] checkout session missing tenantId or plan metadata');
        return null;
    }

    let subscription = await Subscription.findOne({ tenantId });

    if (subscription) {
        subscription.plan = plan;
        subscription.status = 'active';
        subscription.stripeCustomerId = session.customer as string;
        subscription.stripeSubscriptionId = stripeSubscription.id;
        subscription.stripePriceId = stripeSubscription.items.data[0]?.price.id;
        subscription.currentPeriodStart = new Date(stripeSubscription.current_period_start * 1000);
        subscription.currentPeriodEnd = new Date(stripeSubscription.current_period_end * 1000);
        subscription.cancelAtPeriodEnd = false;
        await subscription.save();
    } else {
        subscription = await Subscription.create({
            tenantId,
            plan,
            status: 'active',
            stripeCustomerId: session.customer as string,
            stripeSubscriptionId: stripeSubscription.id,
            stripePriceId: stripeSubscription.items.data[0]?.price.id,
            currentPeriodStart: new Date(stripeSubscription.current_period_start * 1000),
            currentPeriodEnd: new Date(stripeSubscription.current_period_end * 1000),
        });
    }

    await Tenant.findByIdAndUpdate(tenantId, { plan });
    return { tenantId, plan };
}

// Get all available plans
export const getPlans = async (req: AuthRequest, res: Response) => {
    try {
        const plans = Object.entries(PLAN_LIMITS).map(([key, limits]) => ({
            id: key,
            name: key.charAt(0).toUpperCase() + key.slice(1),
            price: limits.price,
            features: {
                maxAgents: limits.maxAgents === -1 ? 'Unlimited' : limits.maxAgents,
                maxDocuments: limits.maxDocuments === -1 ? 'Unlimited' : limits.maxDocuments,
                maxMessagesPerMonth: limits.maxMessagesPerMonth === -1 ? 'Unlimited' : limits.maxMessagesPerMonth,
                maxDocumentSizeMB: limits.maxDocumentSizeMB,
                maxKnowledgeSummaryChars:
                    limits.maxKnowledgeSummaryChars === -1
                        ? 'Unlimited'
                        : limits.maxKnowledgeSummaryChars,
                voiceEnabled: limits.voiceEnabled,
                analyticsEnabled: limits.analyticsEnabled,
                connectorsEnabled: limits.connectorsEnabled,
                maxConnectors: limits.maxConnectors === -1 ? 'Unlimited' : limits.maxConnectors,
                prioritySupport: limits.prioritySupport,
                maxSeats: limits.maxSeats === -1 ? 'Unlimited' : limits.maxSeats,
            }
        }));

        res.json(plans);
    } catch (error: any) {
        console.error('Error fetching plans:', error);
        res.status(500).json({ message: 'Error fetching plans' });
    }
};

// Get current subscription for tenant
export const getCurrentSubscription = async (req: AuthRequest, res: Response) => {
    try {
        const tenantId = req.user?.tenantId;

        console.log('📊 Get current subscription - tenantId:', tenantId);

        if (!tenantId) {
            return res.status(400).json({ message: 'Tenant ID not found' });
        }

        let subscription = await Subscription.findOne({ tenantId });
        console.log('📄 Found subscription:', subscription ? { id: subscription._id, plan: subscription.plan } : 'none');

        // If no subscription exists, create a free one
        if (!subscription) {
            subscription = await Subscription.create({
                tenantId,
                plan: 'free',
                status: 'active'
            });
            console.log('📄 Created free subscription');
        }

        const now = new Date();

        // Reset message count if new month
        const lastMsgReset = new Date(subscription.lastMessageCountReset);
        if (now.getMonth() !== lastMsgReset.getMonth() || now.getFullYear() !== lastMsgReset.getFullYear()) {
            subscription.messagesUsedThisMonth = 0;
            subscription.lastMessageCountReset = now;
            await subscription.save();
        }

        // Reset monthly document counter if new month
        const lastDocReset = new Date(subscription.lastDocumentCountReset || subscription.createdAt);
        if (now.getMonth() !== lastDocReset.getMonth() || now.getFullYear() !== lastDocReset.getFullYear()) {
            subscription.documentsUploadedThisMonth = 0;
            subscription.lastDocumentCountReset = now;
            await subscription.save();
        }

        // Get current usage
        const agentCount = await Agent.countDocuments({ tenantId });
        const limits = PLAN_LIMITS[subscription.plan as PlanType];

        const docResetsAt = new Date(now.getFullYear(), now.getMonth() + 1, 1);
        const seatLimit = maxSeatsForPlan(subscription.plan as PlanType);
        const seatsUsed = await countTenantUsers(tenantId as any);

        res.json({
            subscription: {
                plan: subscription.plan,
                status: subscription.status,
                currentPeriodStart: subscription.currentPeriodStart,
                currentPeriodEnd: subscription.currentPeriodEnd,
                cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
            },
            usage: {
                agents: {
                    used: agentCount,
                    limit: limits.maxAgents,
                },
                documents: {
                    used: subscription.documentsUploadedThisMonth,
                    limit: limits.maxDocuments,
                    resetsAt: docResetsAt,
                },
                messages: {
                    used: subscription.messagesUsedThisMonth,
                    limit: limits.maxMessagesPerMonth,
                },
                seats: {
                    used: seatsUsed,
                    limit: seatLimit === -1 ? 'Unlimited' : seatLimit,
                },
            },
            features: {
                voiceEnabled: limits.voiceEnabled,
                analyticsEnabled: limits.analyticsEnabled,
                prioritySupport: limits.prioritySupport,
                maxDocumentSizeMB: limits.maxDocumentSizeMB
            }
        });
    } catch (error: any) {
        console.error('Error fetching subscription:', error);
        res.status(500).json({ message: 'Error fetching subscription' });
    }
};

// Select free plan (no payment required)
export const selectFreePlan = async (req: AuthRequest, res: Response) => {
    try {
        const tenantId = req.user?.tenantId;

        if (!tenantId) {
            return res.status(400).json({ message: 'Tenant ID not found' });
        }

        let subscription = await Subscription.findOne({ tenantId });
        const previousPlan = subscription?.plan ?? 'free';

        if (subscription) {
            subscription.plan = 'free';
            subscription.status = 'active';
            await subscription.save();
        } else {
            subscription = await Subscription.create({
                tenantId,
                plan: 'free',
                status: 'active'
            });
        }

        // Update tenant plan
        await Tenant.findByIdAndUpdate(tenantId, { plan: 'free' });

        if (req.user?.userId && previousPlan !== 'free') {
            recordWorkspaceAudit(req, {
                tenantId: tenantId as string,
                actorId: req.user.userId,
                action: 'subscription.select_free',
                targetType: 'subscription',
                targetId: String(subscription._id),
                metadata: { from: previousPlan, to: 'free' },
            });
        }

        res.json({ 
            message: 'Free plan activated',
            subscription: {
                plan: subscription.plan,
                status: subscription.status
            }
        });
    } catch (error: any) {
        console.error('Error selecting free plan:', error);
        res.status(500).json({ message: 'Error selecting free plan' });
    }
};

// Create Stripe checkout session for paid plans
export const createCheckoutSession = async (req: AuthRequest, res: Response) => {
    try {
        const { plan } = req.body;
        const tenantId = req.user?.tenantId;
        const userId = req.user?.userId;

        if (!tenantId) {
            return res.status(400).json({ message: 'Tenant ID not found' });
        }

        if (!plan || !['starter', 'pro', 'enterprise'].includes(plan)) {
            return res.status(400).json({ message: 'Invalid plan selected' });
        }

        // Check if Stripe is configured
        if (!process.env.STRIPE_SECRET_KEY) {
            return res.status(500).json({ message: 'Stripe is not configured. Please add STRIPE_SECRET_KEY to your .env file.' });
        }

        // Get or create price ID (dynamically if not configured)
        const priceId = await getOrCreateStripePrice(plan as PlanType);

        // Get or create Stripe customer
        const tenant = await Tenant.findById(tenantId);
        if (!tenant) {
            return res.status(404).json({ message: 'Tenant not found' });
        }

        let customerId = tenant.stripeCustomerId;

        if (!customerId) {
            const customer = await stripe.customers.create({
                metadata: {
                    tenantId: tenantId.toString(),
                    userId: userId || ''
                }
            });
            customerId = customer.id;
            tenant.stripeCustomerId = customerId;
            await tenant.save();
        }

        // Create checkout session
        const session = await stripe.checkout.sessions.create({
            customer: customerId,
            payment_method_types: ['card'],
            line_items: [
                {
                    price: priceId,
                    quantity: 1
                }
            ],
            mode: 'subscription',
            success_url: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/payment-success?session_id={CHECKOUT_SESSION_ID}`,
            cancel_url: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/subscription`,
            metadata: {
                tenantId: tenantId.toString(),
                plan
            }
        });

        if (userId) {
            recordWorkspaceAudit(req, {
                tenantId: tenantId as string,
                actorId: userId,
                action: 'subscription.checkout_started',
                metadata: { plan },
            });
        }

        res.json({ sessionId: session.id, url: session.url });
    } catch (error: any) {
        console.error('Error creating checkout session:', error);
        res.status(500).json({ message: 'Error creating checkout session', error: error.message });
    }
};

// Verify checkout session and activate subscription
export const verifyCheckoutSession = async (req: AuthRequest, res: Response) => {
    try {
        const { sessionId } = req.body;
        const tenantId = req.user?.tenantId;

        console.log('🔍 Verify checkout - tenantId:', tenantId, 'sessionId:', sessionId);

        if (!tenantId) {
            return res.status(400).json({ message: 'Tenant ID not found' });
        }

        if (!sessionId) {
            return res.status(400).json({ message: 'Session ID required' });
        }

        // Retrieve the session from Stripe
        const session = await stripe.checkout.sessions.retrieve(sessionId, {
            expand: ['subscription']
        });

        console.log('📦 Stripe session:', {
            payment_status: session.payment_status,
            metadata: session.metadata,
            subscription: session.subscription ? 'exists' : 'null'
        });

        if (session.payment_status !== 'paid' && session.payment_status !== 'no_payment_required') {
            return res.status(400).json({ message: 'Payment not completed' });
        }

        if (session.status && session.status !== 'complete') {
            return res.status(400).json({ message: 'Checkout session is not complete yet. Please try again in a moment.' });
        }

        if (session.metadata?.tenantId && session.metadata.tenantId !== tenantId.toString()) {
            return res.status(403).json({ message: 'Checkout session does not belong to this workspace' });
        }

        const plan = session.metadata?.plan as PlanType;

        console.log('📋 Plan from metadata:', plan);

        if (!plan) {
            console.error('❌ No plan in session metadata!');
            return res.status(400).json({ message: 'Plan not found in session' });
        }

        let stripeSubscription = session.subscription as Stripe.Subscription | string | null;
        if (!stripeSubscription) {
            console.error('❌ No subscription in session!');
            return res.status(400).json({ message: 'Subscription not found in session' });
        }
        if (typeof stripeSubscription === 'string') {
            stripeSubscription = await stripe.subscriptions.retrieve(stripeSubscription);
        }

        const activated = await activateSubscriptionFromCheckoutSession(session, stripeSubscription);
        if (!activated) {
            return res.status(400).json({ message: 'Invalid checkout session metadata' });
        }

        const subscription = await Subscription.findOne({ tenantId });
        console.log('✅ Activated subscription plan:', activated.plan);

        res.json({
            message: 'Subscription activated',
            subscription: {
                plan: subscription?.plan ?? activated.plan,
                status: subscription?.status ?? 'active',
                currentPeriodEnd: subscription?.currentPeriodEnd,
            },
        });
    } catch (error: any) {
        console.error('❌ Error verifying checkout session:', error);
        res.status(500).json({ message: 'Error verifying subscription' });
    }
};

// Create customer portal session for managing subscription
export const createPortalSession = async (req: AuthRequest, res: Response) => {
    try {
        const tenantId = req.user?.tenantId;

        if (!tenantId) {
            return res.status(400).json({ message: 'Tenant ID not found' });
        }

        const tenant = await Tenant.findById(tenantId);
        if (!tenant?.stripeCustomerId) {
            return res.status(400).json({ message: 'No billing account found' });
        }

        const session = await stripe.billingPortal.sessions.create({
            customer: tenant.stripeCustomerId,
            return_url: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/dashboard`
        });

        res.json({ url: session.url });
    } catch (error: any) {
        console.error('Error creating portal session:', error);
        res.status(500).json({ message: 'Error creating portal session' });
    }
};

// Cancel subscription
export const cancelSubscription = async (req: AuthRequest, res: Response) => {
    try {
        const tenantId = req.user?.tenantId;

        if (!tenantId) {
            return res.status(400).json({ message: 'Tenant ID not found' });
        }

        const subscription = await Subscription.findOne({ tenantId });
        if (!subscription?.stripeSubscriptionId) {
            return res.status(400).json({ message: 'No active subscription found' });
        }

        // Cancel at period end (user keeps access until end of billing cycle)
        await stripe.subscriptions.update(subscription.stripeSubscriptionId, {
            cancel_at_period_end: true
        });

        subscription.cancelAtPeriodEnd = true;
        await subscription.save();

        res.json({ 
            message: 'Subscription will be canceled at end of billing period',
            cancelAt: subscription.currentPeriodEnd
        });
    } catch (error: any) {
        console.error('Error canceling subscription:', error);
        res.status(500).json({ message: 'Error canceling subscription' });
    }
};

// Stripe webhook handler
export const handleStripeWebhook = async (req: AuthRequest, res: Response) => {
    const sig = req.headers['stripe-signature'] as string;
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

    if (!webhookSecret) {
        console.error('Stripe webhook secret not configured');
        return res.status(500).json({ message: 'Webhook not configured' });
    }

    let event: Stripe.Event;

    try {
        event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
    } catch (err: any) {
        console.error('Webhook signature verification failed:', err.message);
        return res.status(400).json({ message: `Webhook Error: ${err.message}` });
    }

    // Handle the event
    switch (event.type) {
        case 'checkout.session.completed': {
            const checkoutSession = event.data.object as Stripe.Checkout.Session;
            if (checkoutSession.mode !== 'subscription' || checkoutSession.payment_status !== 'paid') {
                break;
            }
            const subscriptionId =
                typeof checkoutSession.subscription === 'string'
                    ? checkoutSession.subscription
                    : checkoutSession.subscription?.id;
            if (!subscriptionId) {
                console.error('[stripe] checkout.session.completed without subscription id');
                break;
            }
            const stripeSubscription = await stripe.subscriptions.retrieve(subscriptionId);
            await activateSubscriptionFromCheckoutSession(checkoutSession, stripeSubscription);
            break;
        }

        case 'customer.subscription.updated':
        case 'customer.subscription.deleted': {
            const stripeSubscription = event.data.object as Stripe.Subscription;
            const subscription = await Subscription.findOne({ 
                stripeSubscriptionId: stripeSubscription.id 
            });

            if (subscription) {
                if (event.type === 'customer.subscription.deleted') {
                    subscription.plan = 'free';
                    subscription.status = 'canceled';
                    subscription.stripeSubscriptionId = undefined;
                } else {
                    subscription.status = stripeSubscription.status as any;
                    subscription.currentPeriodStart = new Date(stripeSubscription.current_period_start * 1000);
                    subscription.currentPeriodEnd = new Date(stripeSubscription.current_period_end * 1000);
                    subscription.cancelAtPeriodEnd = stripeSubscription.cancel_at_period_end;
                }
                await subscription.save();

                // Update tenant plan
                await Tenant.findByIdAndUpdate(subscription.tenantId, { 
                    plan: subscription.plan 
                });
            }
            break;
        }

        case 'invoice.payment_failed': {
            const invoice = event.data.object as Stripe.Invoice;
            const subscription = await Subscription.findOne({ 
                stripeCustomerId: invoice.customer as string 
            });

            if (subscription) {
                subscription.status = 'past_due';
                await subscription.save();
            }
            break;
        }

        default:
            console.log(`Unhandled event type: ${event.type}`);
    }

    res.json({ received: true });
};

// Increment message usage
export const incrementMessageUsage = async (tenantId: string): Promise<boolean> => {
    try {
        const subscription = await Subscription.findOne({ tenantId });
        if (!subscription) return false;

        const limits = PLAN_LIMITS[subscription.plan as PlanType];
        
        // Check if unlimited
        if (limits.maxMessagesPerMonth === -1) {
            subscription.messagesUsedThisMonth += 1;
            await subscription.save();
            return true;
        }

        // Check if limit reached
        if (subscription.messagesUsedThisMonth >= limits.maxMessagesPerMonth) {
            return false;
        }

        subscription.messagesUsedThisMonth += 1;
        await subscription.save();
        return true;
    } catch (error) {
        console.error('Error incrementing message usage:', error);
        return false;
    }
};
