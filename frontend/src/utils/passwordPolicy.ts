/** Mirror `backend/src/utils/passwordPolicy.ts` for client-side checks & UX. */

export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_MAX_LENGTH = 128;

const HAS_UPPER = /[A-Z]/;
const HAS_LOWER = /[a-z]/;
const HAS_DIGIT = /\d/;
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

/** Heuristic meter independent of strict validation (shows progress while typing). */
export function scorePasswordStrength(password: string): 'weak' | 'medium' | 'strong' {
    const p = password ?? '';
    if (!p) return 'weak';
    const strict = validateStrongPassword(p);
    let complexityPoints = 0;
    if (p.length >= PASSWORD_MIN_LENGTH) complexityPoints++;
    if (p.length >= 14) complexityPoints++;
    if (HAS_UPPER.test(p) && HAS_LOWER.test(p)) complexityPoints++;
    if (HAS_DIGIT.test(p)) complexityPoints++;
    if (HAS_SPECIAL.test(p)) complexityPoints++;

    if (strict.ok) {
        return complexityPoints >= 5 && p.length >= 12 ? 'strong' : 'medium';
    }
    return complexityPoints <= 2 ? 'weak' : 'medium';
}
