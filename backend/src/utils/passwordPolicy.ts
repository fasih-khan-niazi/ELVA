/** Shared rules for password validation (signup, invite accept). */

export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_MAX_LENGTH = 128;

/** At least one character from each class. */
const HAS_UPPER = /[A-Z]/;
const HAS_LOWER = /[a-z]/;
const HAS_DIGIT = /\d/;
/** Common special characters; adjust if product requires a specific set. */
const HAS_SPECIAL = /[!@#$%^&*()_+\-=[\]{};':"\\|,.<>\/?`~]/;

export interface PasswordValidationResult {
    ok: boolean;
    message?: string;
}

export function validateStrongPassword(password: string): PasswordValidationResult {
    const p = password ?? '';
    if (p.length < PASSWORD_MIN_LENGTH) {
        return {
            ok: false,
            message: `Password must be at least ${PASSWORD_MIN_LENGTH} characters.`,
        };
    }
    if (p.length > PASSWORD_MAX_LENGTH) {
        return { ok: false, message: `Password must be at most ${PASSWORD_MAX_LENGTH} characters.` };
    }
    if (!HAS_UPPER.test(p)) {
        return { ok: false, message: 'Include at least one uppercase letter.' };
    }
    if (!HAS_LOWER.test(p)) {
        return { ok: false, message: 'Include at least one lowercase letter.' };
    }
    if (!HAS_DIGIT.test(p)) {
        return { ok: false, message: 'Include at least one number.' };
    }
    if (!HAS_SPECIAL.test(p)) {
        return { ok: false, message: 'Include at least one special character (e.g. ! @ # $ %).' };
    }
    return { ok: true };
}
