import crypto from 'crypto';
import { Request, Response, NextFunction } from 'express';

export function verifySlackSignature(req: Request, res: Response, next: NextFunction): void {
    const signingSecret = process.env.SLACK_SIGNING_SECRET;
    if (!signingSecret) {
        res.status(500).json({ error: 'SLACK_SIGNING_SECRET not configured' });
        return;
    }

    const timestamp = req.headers['x-slack-request-timestamp'] as string;
    const slackSig = req.headers['x-slack-signature'] as string;

    if (!timestamp || !slackSig) {
        res.status(400).json({ error: 'Missing Slack signature headers' });
        return;
    }

    // Reject stale requests (older than 5 minutes)
    const age = Math.abs(Math.floor(Date.now() / 1000) - parseInt(timestamp, 10));
    if (age > 300) {
        res.status(400).json({ error: 'Request timestamp too old' });
        return;
    }

    // req.body is the raw Buffer (set by express.raw() for this route)
    const rawBody = req.body instanceof Buffer ? req.body.toString() : JSON.stringify(req.body);
    const baseString = `v0:${timestamp}:${rawBody}`;
    const hmac = crypto.createHmac('sha256', signingSecret).update(baseString).digest('hex');
    const computed = `v0=${hmac}`;

    if (!crypto.timingSafeEqual(Buffer.from(computed), Buffer.from(slackSig))) {
        res.status(403).json({ error: 'Invalid Slack signature' });
        return;
    }

    next();
}
