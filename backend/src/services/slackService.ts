import axios from 'axios';
import { SlackWorkspace } from '../models/SlackWorkspace';

// ── Incoming Webhook (Phase 1 - no OAuth) ────────────────────────────────

export async function sendSlackMessage(webhookUrl: string, body: string): Promise<void> {
    let payload: Record<string, any>;

    const trimmed = body.trim();
    if (trimmed.startsWith('{')) {
        payload = JSON.parse(trimmed);
    } else {
        payload = { text: trimmed };
    }

    const response = await axios.post(webhookUrl, payload, {
        headers: { 'Content-Type': 'application/json' },
        timeout: 8000,
    });

    if (response.status !== 200) {
        throw new Error(`Slack responded with status ${response.status}: ${response.data}`);
    }
}

// ── Bot Token API (Phase 2 - OAuth connected workspace) ──────────────────

export async function sendSlackMessageWithToken(
    tenantId: string,
    workspaceId: string,
    channelId: string,
    body: string
): Promise<void> {
    const workspace = await SlackWorkspace.findOne({ tenantId, workspaceId });
    if (!workspace) throw new Error(`Slack workspace ${workspaceId} not connected for tenant`);

    let payload: Record<string, any>;
    const trimmed = body.trim();
    if (trimmed.startsWith('{')) {
        const parsed = JSON.parse(trimmed);
        payload = { ...parsed, channel: channelId };
    } else {
        payload = { channel: channelId, text: trimmed };
    }

    const response = await axios.post('https://slack.com/api/chat.postMessage', payload, {
        headers: {
            Authorization: `Bearer ${workspace.botToken}`,
            'Content-Type': 'application/json',
        },
        timeout: 8000,
    });

    if (!response.data.ok) {
        throw new Error(`Slack API error: ${response.data.error}`);
    }
}

// ── List channels (used by connector wizard) ──────────────────────────────

export async function listSlackChannels(
    tenantId: string,
    workspaceId: string
): Promise<{ id: string; name: string; isPrivate: boolean }[]> {
    const workspace = await SlackWorkspace.findOne({ tenantId, workspaceId });
    if (!workspace) throw new Error(`Workspace not connected`);

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

    return [
        ...(pubRes.data.channels || []),
        ...(privRes.data.channels || []),
    ].map((c: any) => ({ id: c.id, name: c.name, isPrivate: c.is_private }));
}

// ── Update message via response_url (two-way action reply) ───────────────

export async function updateSlackMessageViaResponseUrl(
    responseUrl: string,
    text: string,
    replaceOriginal = true
): Promise<void> {
    await axios.post(responseUrl, { replace_original: replaceOriginal, text }, { timeout: 5000 });
}
