/** Bot OAuth (Connect workspace) requires these; must match Slack app settings + `BASE_URL`. */
export function isSlackOAuthConfigured(): boolean {
    return !!(
        process.env.SLACK_CLIENT_ID?.trim() &&
        process.env.SLACK_CLIENT_SECRET?.trim() &&
        process.env.BASE_URL?.trim()
    );
}

/** Slack button interactions verify with signing secret (`/api/slack/interactions`). */
export function isSlackInteractivityConfigured(): boolean {
    return !!(isSlackOAuthConfigured() && process.env.SLACK_SIGNING_SECRET?.trim());
}
