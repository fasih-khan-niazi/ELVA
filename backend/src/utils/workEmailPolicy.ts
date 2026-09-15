/**
 * Consumer / personal email domains blocked for Company / team self-registration.
 * Keep in sync with `frontend/src/lib/workEmailPolicy.ts`.
 */
const CONSUMER_EMAIL_DOMAINS = new Set([
    'gmail.com',
    'googlemail.com',
    'yahoo.com',
    'yahoo.co.uk',
    'yahoo.co.in',
    'yahoo.fr',
    'hotmail.com',
    'hotmail.co.uk',
    'outlook.com',
    'outlook.fr',
    'live.com',
    'msn.com',
    'icloud.com',
    'me.com',
    'mac.com',
    'aol.com',
    'proton.me',
    'protonmail.com',
    'pm.me',
    'hey.com',
    'fastmail.com',
    'fastmail.fm',
    'mail.com',
    'gmx.com',
    'gmx.net',
    'gmx.de',
    'web.de',
    'tutanota.com',
    'tutamail.com',
    'duck.com',
    'yandex.com',
    'yandex.ru',
    'qq.com',
    '163.com',
    '126.com',
]);

export const COMPANY_REQUIRES_WORK_EMAIL_MESSAGE =
    'Company / team signup requires a work email (your organization’s domain). Personal providers such as Gmail, Outlook personal, Yahoo, iCloud, and similar are not allowed. Choose Individual, or register with your company address.';

export function isConsumerEmailDomain(email: string): boolean {
    const norm = email.trim().toLowerCase();
    const at = norm.lastIndexOf('@');
    if (at < 0 || at === norm.length - 1) return false;
    const domain = norm.slice(at + 1);
    return CONSUMER_EMAIL_DOMAINS.has(domain);
}
