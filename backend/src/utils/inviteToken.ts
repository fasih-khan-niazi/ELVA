import crypto from 'crypto';

export function hashInviteToken(raw: string): string {
    return crypto.createHash('sha256').update(raw, 'utf8').digest('hex');
}

export function createRawInviteToken(): string {
    return crypto.randomBytes(32).toString('base64url');
}

export function blurInviteEmail(email: string): string {
    const [local, domain] = email.split('@');
    if (!domain) return '***';
    const head = local.slice(0, Math.min(2, local.length));
    return `${head}•••@${domain}`;
}
