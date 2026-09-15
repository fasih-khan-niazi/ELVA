import { Request, Response } from 'express';
import axios from 'axios';
import jwt from 'jsonwebtoken';
import { getJwtSecret } from '../config/jwtSecret';
import { SlackWorkspace } from '../models/SlackWorkspace';
import { Order, Lead } from '../models';

// ── Install - redirect user's browser to Slack OAuth consent screen ───────

export async function slackInstall(req: Request, res: Response): Promise<void> {
    const clientId = process.env.SLACK_CLIENT_ID;
    if (!clientId) {
        res.status(500).send('SLACK_CLIENT_ID not configured');
        return;
    }

    // Browser popup can't set Authorization header - accept token as query param
    const rawToken = req.query.token as string;
    if (!rawToken) {
        res.status(401).send('Missing token');
        return;
    }

    let tenantId: string;
    try {
        const decoded = jwt.verify(rawToken, getJwtSecret()) as any;
        tenantId = decoded.tenantId;
    } catch {
        res.status(401).send('Invalid token');
        return;
    }

    const scopes = 'chat:write,channels:read,groups:read';
    const redirectUri = `${process.env.BASE_URL}/api/slack/oauth/callback`;
    const state = Buffer.from(JSON.stringify({ tenantId })).toString('base64');

    const url =
        `https://slack.com/oauth/v2/authorize` +
        `?client_id=${encodeURIComponent(clientId)}` +
        `&scope=${encodeURIComponent(scopes)}` +
        `&redirect_uri=${encodeURIComponent(redirectUri)}` +
        `&state=${encodeURIComponent(state)}`;

    res.redirect(url);
}

// ── Callback - Slack redirects here after user approves ───────────────────

export async function slackCallback(req: Request, res: Response): Promise<void> {
    const { code, state, error } = req.query as Record<string, string>;

    if (error || !code) {
        res.send(buildPopupScript(null, error || 'access_denied'));
        return;
    }

    let tenantId: string | undefined;
    try {
        tenantId = JSON.parse(Buffer.from(state, 'base64').toString()).tenantId;
    } catch {
        res.send(buildPopupScript(null, 'invalid_state'));
        return;
    }

    try {
        const clientId = process.env.SLACK_CLIENT_ID!;
        const clientSecret = process.env.SLACK_CLIENT_SECRET!;
        const redirectUri = `${process.env.BASE_URL}/api/slack/oauth/callback`;

        const tokenRes = await axios.post(
            'https://slack.com/api/oauth.v2.access',
            new URLSearchParams({ code, client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri }).toString(),
            { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
        );

        const data = tokenRes.data;
        if (!data.ok) {
            res.send(buildPopupScript(null, data.error || 'oauth_failed'));
            return;
        }

        const workspaceId = data.team.id;
        const workspaceName = data.team.name;
        const workspaceIcon = data.team.icon?.image_34;
        const botToken = data.access_token;
        const botUserId = data.bot_user_id;
        const scope = data.scope;

        await SlackWorkspace.findOneAndUpdate(
            { tenantId, workspaceId },
            { tenantId, workspaceId, workspaceName, workspaceIcon, botToken, botUserId, scope, installedAt: new Date() },
            { upsert: true, new: true }
        );

        res.send(buildPopupScript({ workspaceId, workspaceName, workspaceIcon }, null));
    } catch (err: any) {
        console.error('[SlackOAuth] callback error:', err.message);
        res.send(buildPopupScript(null, 'server_error'));
    }
}

// ── List workspaces connected to this tenant ──────────────────────────────

export async function getSlackWorkspaces(req: Request, res: Response): Promise<void> {
    const tenantId = (req as any).user?.tenantId;
    const workspaces = await SlackWorkspace.find({ tenantId }, 'workspaceId workspaceName workspaceIcon installedAt');
    res.json(workspaces);
}

// ── List channels in a connected workspace ────────────────────────────────

export async function listSlackChannels(req: Request, res: Response): Promise<void> {
    const tenantId = (req as any).user?.tenantId;
    const { workspaceId } = req.params;

    const workspace = await SlackWorkspace.findOne({ tenantId, workspaceId });
    if (!workspace) {
        res.status(404).json({ message: 'Workspace not connected' });
        return;
    }

    try {
        const [pubRes, privRes] = await Promise.all([
            axios.get('https://slack.com/api/conversations.list', {
                params: { types: 'public_channel', exclude_archived: true, limit: 200 },
                headers: { Authorization: `Bearer ${workspace.botToken}` },
            }),
            axios.get('https://slack.com/api/conversations.list', {
                params: { types: 'private_channel', exclude_archived: true, limit: 200 },
                headers: { Authorization: `Bearer ${workspace.botToken}` },
            }),
        ]);

        const channels = [
            ...(pubRes.data.channels || []),
            ...(privRes.data.channels || []),
        ].map((c: any) => ({ id: c.id, name: c.name, isPrivate: c.is_private }));

        res.json(channels);
    } catch (err: any) {
        res.status(500).json({ message: 'Failed to fetch channels', error: err.message });
    }
}

// ── Slack Interactions endpoint (two-way button actions) ──────────────────

export async function slackInteractions(req: Request, res: Response): Promise<void> {
    // Body may be urlencoded (Slack sends payload=<json>)
    const rawPayload =
        typeof req.body === 'string'
            ? req.body
            : req.body instanceof Buffer
            ? req.body.toString()
            : '';

    let payload: any;
    try {
        const parsed = new URLSearchParams(rawPayload);
        payload = JSON.parse(parsed.get('payload') || '');
    } catch {
        res.status(400).json({ error: 'Invalid payload' });
        return;
    }

    if (payload.type !== 'block_actions') {
        res.status(200).send();
        return;
    }

    const responseUrl: string = payload.response_url;
    const action = payload.actions?.[0];
    if (!action) {
        res.status(200).send();
        return;
    }

    // action_id format: elva:order:confirm:{orderId} | elva:order:cancel:{orderId}
    //                   elva:lead:qualify:{leadId}   | elva:lead:disqualify:{leadId}
    const parts = action.action_id?.split(':');
    if (!parts || parts[0] !== 'elva' || parts.length < 4) {
        res.status(200).send();
        return;
    }

    const [, resource, verb, resourceId] = parts;

    // Acknowledge immediately - Slack requires < 3s
    res.status(200).send();

    try {
        let resultText = '';

        if (resource === 'order') {
            const statusMap: Record<string, string> = { confirm: 'confirmed', cancel: 'cancelled' };
            const newStatus = statusMap[verb];
            if (newStatus) {
                await Order.findByIdAndUpdate(resourceId, { status: newStatus });
                resultText = verb === 'confirm'
                    ? `✅ Order confirmed by <@${payload.user?.id}>`
                    : `❌ Order cancelled by <@${payload.user?.id}>`;
            }
        } else if (resource === 'lead') {
            const statusMap: Record<string, string> = { qualify: 'qualified', disqualify: 'disqualified' };
            const newStatus = statusMap[verb];
            if (newStatus) {
                await Lead.findByIdAndUpdate(resourceId, { status: newStatus });
                resultText = verb === 'qualify'
                    ? `✅ Lead qualified by <@${payload.user?.id}>`
                    : `❌ Lead disqualified by <@${payload.user?.id}>`;
            }
        }

        if (resultText && responseUrl) {
            await axios.post(responseUrl, {
                replace_original: true,
                text: resultText,
            });
        }
    } catch (err: any) {
        console.error('[SlackInteractions] failed to process action:', err.message);
    }
}

// ── Helper: close popup and postMessage to opener ─────────────────────────

function buildPopupScript(data: Record<string, any> | null, error: string | null): string {
    const msg = data
        ? JSON.stringify({ type: 'slack-connected', ...data })
        : JSON.stringify({ type: 'slack-error', error });
    return `<!DOCTYPE html><html><body><script>
try { window.opener.postMessage(${msg}, '*'); } catch(e) {}
window.close();
</script></body></html>`;
}
