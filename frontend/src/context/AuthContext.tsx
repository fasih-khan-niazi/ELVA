import React, { createContext, useState, useEffect, useContext, useCallback } from 'react';
import { API_BASE, apiFetch, setUnauthorizedHandler } from '@/lib/api';

// ─── Multi-account saved sessions ────────────────────────────────────────────

export const SAVED_ACCOUNTS_KEY = 'elva_saved_accounts';

export interface SavedAccount {
    userId: string;
    email: string;
    name?: string | null;
    profilePicture?: string | null;
    token: string;
    tenantId?: string;
    workspaceName?: string | null;
    role: string;
}

function getJwtExpiry(token: string): number | null {
    try {
        const segment = token.split('.')[1];
        if (!segment) return null;
        const b64 = segment.replace(/-/g, '+').replace(/_/g, '/');
        const decoded = JSON.parse(atob(b64)) as Record<string, unknown>;
        return typeof decoded.exp === 'number' ? decoded.exp : null;
    } catch {
        return null;
    }
}

export function isSavedAccountExpired(acct: SavedAccount): boolean {
    const exp = getJwtExpiry(acct.token);
    if (exp === null) return false;
    return Date.now() / 1000 > exp - 60;
}

export function getSavedAccounts(): SavedAccount[] {
    try {
        const all = JSON.parse(localStorage.getItem(SAVED_ACCOUNTS_KEY) || '[]') as SavedAccount[];
        const sevenDaysSec = 7 * 24 * 60 * 60;
        const nowSec = Date.now() / 1000;
        const clean = all.filter(a => {
            if (a.role === 'platform_admin') return false;
            const exp = getJwtExpiry(a.token);
            if (exp !== null && nowSec > exp + sevenDaysSec) return false;
            return true;
        });
        if (clean.length !== all.length) {
            localStorage.setItem(SAVED_ACCOUNTS_KEY, JSON.stringify(clean));
        }
        return clean;
    } catch {
        return [];
    }
}

export function upsertSavedAccount(user: User, token: string) {
    if (user.role === 'platform_admin') return;
    const existing = getSavedAccounts().filter(a => a.userId !== user.id);
    existing.unshift({
        userId: user.id,
        email: user.email,
        name: user.name ?? null,
        profilePicture: user.profilePicture ?? null,
        token,
        tenantId: user.tenantId,
        workspaceName: user.workspaceName ?? null,
        role: user.role,
    });
    localStorage.setItem(SAVED_ACCOUNTS_KEY, JSON.stringify(existing.slice(0, 10)));
}

export function removeSavedAccount(userId: string) {
    const existing = getSavedAccounts().filter(a => a.userId !== userId);
    localStorage.setItem(SAVED_ACCOUNTS_KEY, JSON.stringify(existing));
}

// ─────────────────────────────────────────────────────────────────────────────

export interface User {
    id: string;
    email: string;
    role: string;
    tenantId?: string;
    workspaceName?: string | null;
    name?: string | null;
    profilePicture?: string | null;
    authProvider?: string;
    accountStatus?: string;
    emailVerified?: boolean;
}

export interface WelcomeUser {
    name: string;
    email: string;
}

interface Subscription {
    plan: string;
    status: string;
    currentPeriodEnd?: string;
}

interface AuthContextType {
    user: User | null;
    /** Bearer token when switching saved accounts; primary auth uses HttpOnly cookie. */
    token: string | null;
    subscription: Subscription | null;
    hasActiveSubscription: boolean;
    isLoading: boolean;
    login: (token: string, user: User) => void;
    logout: () => void;
    isAuthenticated: boolean;
    refreshSubscription: (tokenOverride?: string | null) => Promise<Subscription | null>;
    setSubscription: (sub: Subscription | null) => void;
    refreshUserProfile: () => Promise<void>;
    setUserPartial: (u: Partial<User> & Pick<User, 'id' | 'email' | 'role'>) => void;
    welcomeUser: WelcomeUser | null;
    clearWelcome: () => void;
    switchAccount: (acct: SavedAccount) => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

function mapApiUser(u: Record<string, unknown>): User {
    return {
        id: String(u.id),
        email: String(u.email),
        role: String(u.role),
        tenantId: u.tenantId ? String(u.tenantId) : undefined,
        workspaceName: (u.workspaceName as string | null | undefined) ?? null,
        name: (u.name as string | null | undefined) ?? null,
        profilePicture: (u.profilePicture as string | null | undefined) ?? null,
        authProvider: u.authProvider as string | undefined,
        accountStatus: u.accountStatus as string | undefined,
        emailVerified: (u.emailVerified as boolean | undefined) ?? true,
    };
}

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [user, setUser] = useState<User | null>(null);
    const [token, setToken] = useState<string | null>(null);
    const [subscription, setSubscription] = useState<Subscription | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [welcomeUser, setWelcomeUser] = useState<WelcomeUser | null>(null);

    const clearClientAuth = useCallback(() => {
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        localStorage.removeItem('subscription');
        setToken(null);
        setUser(null);
        setSubscription(null);
    }, []);

    const logout = useCallback(() => {
        void apiFetch('/api/user/logout-audit', { method: 'POST', token }).catch(() => {});
        void apiFetch('/api/auth/logout', { method: 'POST', token, skipAuthRedirect: true }).catch(() => {});
        clearClientAuth();
    }, [token, clearClientAuth]);

    useEffect(() => {
        setUnauthorizedHandler(() => {
            clearClientAuth();
            if (window.location.pathname !== '/login') {
                window.location.href = '/login';
            }
        });
        return () => setUnauthorizedHandler(null);
    }, [clearClientAuth]);

    useEffect(() => {
        const restore = async () => {
            try {
                const storedUser = localStorage.getItem('user');
                const storedToken = localStorage.getItem('token');

                if (storedToken) {
                    setToken(storedToken);
                }

                const res = await apiFetch('/api/auth/session', {
                    token: storedToken,
                    skipAuthRedirect: true,
                });

                if (res.ok) {
                    const data = (await res.json()) as { user: Record<string, unknown> };
                    const parsed = mapApiUser(data.user);
                    setUser(parsed);
                    localStorage.setItem('user', JSON.stringify(parsed));
                    if (storedToken && parsed.role !== 'platform_admin') {
                        upsertSavedAccount(parsed, storedToken);
                    }
                    setIsLoading(false);
                    return;
                }

                if (storedUser && storedToken) {
                    try {
                        setUser(JSON.parse(storedUser) as User);
                    } catch {
                        clearClientAuth();
                    }
                } else {
                    clearClientAuth();
                }
            } catch {
                clearClientAuth();
            }
            setIsLoading(false);
        };
        void restore();
    }, [clearClientAuth]);

    const refreshSubscription = useCallback(
        async (tokenOverride?: string | null): Promise<Subscription | null> => {
            const t = tokenOverride ?? token;
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 5000);

            try {
                const response = await apiFetch('/api/subscription/current', {
                    token: t,
                    signal: controller.signal,
                });
                clearTimeout(timeout);

                if (response.ok) {
                    const data = await response.json();
                    const sub = data.subscription ?? null;
                    setSubscription(sub);
                    if (sub) localStorage.setItem('subscription', JSON.stringify(sub));
                    else localStorage.removeItem('subscription');
                    return sub;
                }
            } catch (error) {
                console.error('Error fetching subscription:', error);
            }
            setSubscription(null);
            localStorage.removeItem('subscription');
            return null;
        },
        [token],
    );

    useEffect(() => {
        if (!user) return;
        if (user.role === 'platform_admin') {
            setSubscription(null);
            localStorage.removeItem('subscription');
            return;
        }
        const storedSubscription = localStorage.getItem('subscription');
        if (storedSubscription) {
            try {
                setSubscription(JSON.parse(storedSubscription));
            } catch {
                localStorage.removeItem('subscription');
            }
        }
        void refreshSubscription(token);
    }, [user, token, refreshSubscription]);

    useEffect(() => {
        if (!user || user.role === 'platform_admin') return;
        const id = setInterval(() => {
            void refreshSubscription(token);
        }, 5 * 60 * 1000);
        return () => clearInterval(id);
    }, [user, token, refreshSubscription]);

    const login = (newToken: string, newUser: User) => {
        localStorage.setItem('token', newToken);
        localStorage.setItem('user', JSON.stringify(newUser));
        localStorage.removeItem('subscription');
        setToken(newToken);
        setUser(newUser);
        setWelcomeUser({
            name: newUser.name?.trim() || newUser.email.split('@')[0],
            email: newUser.email,
        });
        if (newUser.role === 'platform_admin') {
            localStorage.removeItem(SAVED_ACCOUNTS_KEY);
        } else {
            upsertSavedAccount(newUser, newToken);
        }
    };

    const switchAccount = (acct: SavedAccount) => {
        localStorage.setItem('user', JSON.stringify({
            id: acct.userId,
            email: acct.email,
            name: acct.name,
            profilePicture: acct.profilePicture,
            role: acct.role,
            tenantId: acct.tenantId,
            workspaceName: acct.workspaceName,
        } satisfies User));
        setToken(acct.token);
        setUser({
            id: acct.userId,
            email: acct.email,
            name: acct.name,
            profilePicture: acct.profilePicture,
            role: acct.role,
            tenantId: acct.tenantId,
            workspaceName: acct.workspaceName,
        });
        localStorage.removeItem('subscription');
        setSubscription(null);
    };

    const clearWelcome = useCallback(() => setWelcomeUser(null), []);

    const hasActiveSubscription =
        subscription !== null && subscription.status === 'active' && subscription.plan !== undefined;

    const refreshUserProfile = async () => {
        try {
            const response = await apiFetch('/api/user/me', { token });
            if (!response.ok) return;
            const data = await response.json();
            const next = mapApiUser(data.user);
            next.workspaceName = next.workspaceName ?? user?.workspaceName ?? null;
            setUser(next);
            localStorage.setItem('user', JSON.stringify(next));
            if (token && next.role !== 'platform_admin') {
                upsertSavedAccount(next, token);
            }
        } catch {
            console.error('Error refreshing profile');
        }
    };

    const setUserPartial = (u: Partial<User> & Pick<User, 'id' | 'email' | 'role'>) => {
        setUser((prev) => {
            const merged = { ...prev, ...u } as User;
            localStorage.setItem('user', JSON.stringify(merged));
            return merged;
        });
    };

    return (
        <AuthContext.Provider
            value={{
                user,
                token,
                subscription,
                hasActiveSubscription,
                isLoading,
                login,
                logout,
                isAuthenticated: !!user,
                refreshSubscription,
                setSubscription,
                refreshUserProfile,
                setUserPartial,
                welcomeUser,
                clearWelcome,
                switchAccount,
            }}
        >
            {children}
        </AuthContext.Provider>
    );
};

export const useAuth = () => {
    const context = useContext(AuthContext);
    if (context === undefined) {
        throw new Error('useAuth must be used within an AuthProvider');
    }
    return context;
};

export { API_BASE };
