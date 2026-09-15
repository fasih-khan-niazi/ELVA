/** Matches `hasActiveSubscription` in AuthContext - where to send the user after auth. */
export function postLoginPath(sub: {
    plan?: string;
    status?: string;
} | null): '/dashboard' | '/subscription' {
    if (sub && sub.status === 'active' && sub.plan !== undefined) {
        return '/dashboard';
    }
    return '/subscription';
}
