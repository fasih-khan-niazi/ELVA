import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { Mail, Building2, Loader2 } from 'lucide-react';
import { appToast as toast } from '../components/Toast';
import { useAuth } from '../context/AuthContext';
import { PasswordStrengthMeter } from '../components/PasswordStrengthMeter';
import { AuthBrandAside } from '../components/AuthBrandAside';
import { AuthPasswordField } from '../components/PasswordFieldWithToggle';
import { TermsModal } from '../components/TermsModal';
import {
    AUTH_FORM_BODY_CENTERED_CLASS,
    AUTH_FORM_MAIN_CLASS,
} from '../auth/authShellClasses';
import { postLoginPath } from '../auth/postLoginPath';
import { validateStrongPassword } from '../utils/passwordPolicy';
const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';
const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID?.trim() ?? '';

declare global {
    interface Window {
        google?: {
            accounts: {
                id: {
                    initialize: (config: Record<string, unknown>) => void;
                    renderButton: (element: HTMLElement, config: Record<string, unknown>) => void;
                };
            };
        };
    }
}

export default function Login({ demoMode = false }: { demoMode?: boolean }) {
    const [searchParams] = useSearchParams();
    const hintEmail = searchParams.get('hint');
    const [loading, setLoading] = useState(false);
    const [googleLoading, setGoogleLoading] = useState(false);
    const [email, setEmail] = useState(hintEmail ? decodeURIComponent(hintEmail) : '');
    const [password, setPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [companyName, setCompanyName] = useState('');
    const [termsVersion, setTermsVersion] = useState('2026-05-elva-v3');
    const [registrationType, setRegistrationType] = useState<'solo' | 'company'>('solo');
    const [acceptTerms, setAcceptTerms] = useState(false);
    const [isSignUp, setIsSignUp] = useState(false);
    const signupGateRef = useRef({
        isSignUp: false,
        acceptTerms: false,
        termsVersion: '2026-05-elva-v3',
        registrationType: 'solo' as 'solo' | 'company',
        companyName: '',
    });
    const [termsModalOpen, setTermsModalOpen] = useState(false);
    const [formError, setFormError] = useState<string | null>(null);
    const navigate = useNavigate();
    const { login, refreshSubscription } = useAuth();

    useEffect(() => {
        signupGateRef.current = { isSignUp, acceptTerms, termsVersion, registrationType, companyName };
    }, [isSignUp, acceptTerms, termsVersion, registrationType, companyName]);

    useEffect(() => {
        fetch(`${API_URL}/api/legal/terms-meta`)
            .then((r) => (r.ok ? r.json() : null))
            .then((data) => {
                if (data?.termsVersion) setTermsVersion(String(data.termsVersion));
            })
            .catch(() => {});
    }, []);

    const googleProcessorRef = useRef<(response: { credential?: string }) => Promise<void>>(async () => {});

    googleProcessorRef.current = async (response: { credential?: string }) => {
        if (!response.credential) {
            toast.error('Google sign-in was cancelled.');
            return;
        }

        const ctx = signupGateRef.current;
        if (ctx.isSignUp) {
            if (!ctx.acceptTerms) {
                toast.error('Accept the Terms of Service to register with Google.');
                return;
            }
            if (ctx.registrationType === 'company' && !ctx.companyName.trim()) {
                toast.error('Enter your organization workspace name.');
                return;
            }
        }

        setFormError(null);
        setGoogleLoading(true);

        try {
            const payload: Record<string, unknown> = {
                credential: response.credential,
                clientId: GOOGLE_CLIENT_ID,
            };
            if (ctx.isSignUp) {
                payload.acceptTerms = true;
                payload.termsVersion = ctx.termsVersion;
                payload.registrationType = ctx.registrationType;
                if (ctx.registrationType === 'company') {
                    payload.organizationName = ctx.companyName.trim();
                }
            }

            const res = await fetch(`${API_URL}/api/auth/google`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify(payload),
            });

            const contentType = res.headers.get('content-type');
            if (!contentType || !contentType.includes('application/json')) {
                throw new Error(
                    `Could not reach the server (HTTP ${res.status}). Is the backend running at ${API_URL}?`,
                );
            }

            const data = await res.json();

            if (!res.ok) {
                throw new Error(data.message || 'Google sign-in failed');
            }

            login(data.token, data.user);
            const sub = await refreshSubscription(data.token);
            navigate(postLoginPath(sub));
        } catch (error: unknown) {
            const msg = error instanceof Error ? error.message : 'Google sign-in failed';
            toast.error(msg);
            setFormError(msg);
        } finally {
            setGoogleLoading(false);
        }
    };

    /** True once renderButton has injected Google's button into the DOM. */
    const [googleButtonReady, setGoogleButtonReady] = useState(false);
    const googleShellRef = useRef<HTMLDivElement>(null);

    /** Render Google's official SDK button — centered in its shell container. */
    const renderGoogleButton = useCallback(() => {
        if (demoMode || !window.google || !GOOGLE_CLIENT_ID) return;
        const el = document.getElementById('google-signin-button');
        if (!el) return;

        setGoogleButtonReady(false);
        el.innerHTML = '';

        const shellWidth = googleShellRef.current?.offsetWidth ?? 320;
        const w = Math.min(400, Math.max(200, shellWidth));

        window.google.accounts.id.renderButton(el, {
            theme: 'outline',
            size: 'large',
            width: w,
            text: 'continue_with',
            shape: 'rectangular',
        });

        el.style.display = 'flex';
        el.style.justifyContent = 'center';
        el.style.width = '100%';

        setGoogleButtonReady(true);
    }, [demoMode, GOOGLE_CLIENT_ID]);

    // Effect 1 — initialize GIS + render button.
    // The GSI script is pre-loaded via index.html <head>, so window.google is
    // usually already available when this effect runs on the login page.
    useEffect(() => {
        if (demoMode || !GOOGLE_CLIENT_ID) return;

        const init = () => {
            if (!window.google || !GOOGLE_CLIENT_ID) return;
            window.google.accounts.id.initialize({
                client_id: GOOGLE_CLIENT_ID,
                callback: (r: { credential?: string }) => void googleProcessorRef.current(r),
            });
            // Defer one tick so the DOM element is mounted before we target it.
            setTimeout(renderGoogleButton, 0);
        };

        if (window.google) {
            init();
            return;
        }

        // Fallback for first-ever cold load when the preloaded script hasn't fired yet.
        const script = document.createElement('script');
        script.src = 'https://accounts.google.com/gsi/client';
        script.async = true;
        script.defer = true;
        script.onload = init;
        document.body.appendChild(script);

        return () => {
            try { document.body.removeChild(script); } catch { /* already removed */ }
        };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [demoMode, GOOGLE_CLIENT_ID]);

    // Re-measure Google button when card width changes (sign-in ↔ create account) or on resize.
    useEffect(() => {
        if (demoMode || !GOOGLE_CLIENT_ID || !window.google) return;

        const shell = googleShellRef.current;
        if (!shell) return;

        const rerender = () => {
            requestAnimationFrame(() => renderGoogleButton());
        };

        const t = setTimeout(rerender, 50);
        const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(rerender) : null;
        ro?.observe(shell);

        return () => {
            clearTimeout(t);
            ro?.disconnect();
        };
    }, [isSignUp, demoMode, GOOGLE_CLIENT_ID, renderGoogleButton]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setFormError(null);
        if (demoMode) {
            navigate('/dashboard');
            return;
        }

        setLoading(true);
        const endpoint = isSignUp ? `${API_URL}/api/auth/signup` : `${API_URL}/api/auth/login`;
        let body: Record<string, unknown> = { email, password };
        if (isSignUp) {
            if (!acceptTerms) {
                toast.error('Accept the Terms of Service to register.');
                setLoading(false);
                return;
            }
            if (registrationType === 'company' && !companyName.trim()) {
                toast.error('Enter your organization workspace name.');
                setLoading(false);
                return;
            }
            const pwCheck = validateStrongPassword(password);
            if (!pwCheck.ok) {
                toast.error(pwCheck.message || 'Password does not meet requirements.');
                setLoading(false);
                return;
            }
            if (password !== confirmPassword) {
                toast.error('Passwords do not match. Re-enter the same password twice.');
                setLoading(false);
                return;
            }
            body = {
                email,
                password,
                companyName,
                registrationType,
                acceptTerms: true,
                termsVersion,
            };
        }

        try {
            const response = await fetch(endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify(body),
            });

            const contentType = response.headers.get('content-type');
            if (!contentType || !contentType.includes('application/json')) {
                throw new Error(
                    `Could not reach the server (HTTP ${response.status}). Is the backend running at ${API_URL}?`,
                );
            }

            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.message || 'Sign-in failed');
            }

            login(data.token, data.user);
            const sub = await refreshSubscription(data.token);
            navigate(postLoginPath(sub));
        } catch (error: unknown) {
            const msg = error instanceof Error ? error.message : 'Something went wrong';
            toast.error(msg);
            setFormError(msg);
        } finally {
            setLoading(false);
        }
    };

    const inputWrap =
        'flex items-stretch rounded-lg border border-ocean-sky/80 bg-white shadow-sm overflow-hidden transition focus-within:border-ocean-rich focus-within:ring-2 focus-within:ring-ocean-rich/20';
    const iconBox = 'flex items-center justify-center w-9 shrink-0 bg-ocean-mist/40 text-ocean-deep/70';
    const fieldCls =
        'flex-1 min-w-0 py-2 px-2.5 border-0 bg-transparent text-ocean-deep placeholder:text-ocean-deep/45 focus:ring-0 focus:outline-none text-sm';

    return (
        <div className="relative flex h-full min-h-0 w-full flex-1 flex-col bg-ocean-powder">
            <AuthBrandAside />

            {/* Form: signup uses a two-column grid on md+ */}
            <main className={AUTH_FORM_MAIN_CLASS}>
                <div className={AUTH_FORM_BODY_CENTERED_CLASS}>
                    <div
                        className={`mx-auto w-full ${isSignUp && !demoMode ? 'max-w-[480px] space-y-2.5 sm:space-y-3 md:max-w-[540px]' : 'max-w-[368px] space-y-2.5'}`}
                    >
                    <div className="lg:hidden text-center shrink-0">
                        <Link
                            to="/"
                            className="inline-flex items-center gap-2 text-ocean-navy font-bold text-base"
                        >
                            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-ocean-sky to-ocean-navy text-white text-xs">E</span>
                            ELVA
                        </Link>
                    </div>

                    <div className="space-y-1 text-center shrink-0">
                        <h2 className="text-xl font-bold text-ocean-navy tracking-tight">
                            {demoMode ? 'Demo access' : isSignUp ? 'Create your account' : 'Welcome back'}
                        </h2>
                        {demoMode ? (
                            <p className="text-ocean-deep/80 text-xs leading-snug">
                                Enter the dashboard without credentials.
                            </p>
                        ) : (
                            <p className="text-ocean-deep/80 text-xs leading-snug">
                                Google or email, takes under a minute.
                            </p>
                        )}
                    </div>

                    {demoMode && (
                        <div className="rounded-lg border border-ocean-sky/70 bg-ocean-mist/50 px-3 py-2 text-xs text-ocean-navy shrink-0">
                            Demo mode: submit to open the dashboard (no API).
                        </div>
                    )}

                    {formError && !demoMode && (
                        <div
                            role="alert"
                            className="rounded-lg border border-red-200 bg-red-50/95 px-3 py-2 text-xs text-red-800 shrink-0 leading-snug"
                        >
                            {formError}
                        </div>
                    )}

                    {!demoMode && (
                        <div className={`shrink-0 ${isSignUp ? 'space-y-2' : 'space-y-3'}`}>
                            <div className="flex p-0.5 rounded-lg bg-ocean-mist/60 border border-ocean-ice/80">
                                <button
                                    type="button"
                                    onClick={() => {
                                        setIsSignUp(false);
                                        setFormError(null);
                                        setConfirmPassword('');
                                    }}
                                    className={`flex-1 py-2 text-xs font-semibold rounded-md transition-all ${
                                        !isSignUp
                                            ? 'bg-white text-ocean-navy shadow-sm'
                                            : 'text-ocean-deep/70 hover:text-ocean-navy'
                                    }`}
                                >
                                    Sign in
                                </button>
                                <button
                                    type="button"
                                    onClick={() => {
                                        setIsSignUp(true);
                                        setFormError(null);
                                        setConfirmPassword('');
                                    }}
                                    className={`flex-1 py-2 text-xs font-semibold rounded-md transition-all ${
                                        isSignUp
                                            ? 'bg-white text-ocean-navy shadow-sm'
                                            : 'text-ocean-deep/70 hover:text-ocean-navy'
                                    }`}
                                >
                                    Create account
                                </button>
                            </div>

                            <div className="flex flex-col items-center">
                                <p className="w-full text-center text-[10px] font-semibold text-ocean-deep/65 mb-1.5 uppercase tracking-wider">
                                    Continue with
                                </p>
                                {!GOOGLE_CLIENT_ID && !demoMode && (
                                    <p className="w-full text-center text-[10px] text-amber-900 bg-amber-50 border border-amber-200/80 rounded-md px-2 py-1.5 mb-1.5 leading-snug">
                                        Google sign-in is off until you set{' '}
                                        <span className="font-mono text-[9px]">VITE_GOOGLE_CLIENT_ID</span> in{' '}
                                        <span className="font-mono text-[9px]">frontend/.env</span> (OAuth Web client ID).
                                    </p>
                                )}
                                <div
                                    ref={googleShellRef}
                                    className="relative mx-auto h-[44px] w-full max-w-[400px]"
                                >
                                    {!googleButtonReady && !googleLoading && (
                                        <div className="absolute inset-0 flex items-center justify-center gap-3 rounded-[4px] border border-[#dadce0] bg-white px-4 pointer-events-none select-none">
                                            <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden>
                                                <path fill="#4285F4" d="M17.64 9.2045c0-.638-.057-1.252-.163-1.841H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.909c1.701-1.567 2.683-3.874 2.683-6.615z"/>
                                                <path fill="#34A853" d="M9 18c2.43 0 4.467-.806 5.956-2.181l-2.909-2.258c-.806.54-1.837.859-3.047.859-2.344 0-4.328-1.583-5.036-3.71H.957v2.332C2.438 15.983 5.482 18 9 18z"/>
                                                <path fill="#FBBC05" d="M3.964 10.71C3.784 10.17 3.682 9.593 3.682 9s.102-1.17.282-1.71V4.958H.957C.348 6.173 0 7.547 0 9s.348 2.827.957 4.042L3.964 10.71z"/>
                                                <path fill="#EA4335" d="M9 3.58c1.321 0 2.508.454 3.44 1.346l2.582-2.581C13.463.891 11.426 0 9 0 5.482 0 2.438 2.017.957 4.958l3.007 2.332C4.672 5.163 6.656 3.58 9 3.58z"/>
                                            </svg>
                                            <span className="text-[14px] font-medium text-[#3c4043] tracking-[0.25px]">Continue with Google</span>
                                        </div>
                                    )}

                                    <div
                                        id="google-signin-button"
                                        className={`absolute inset-0 flex items-center justify-center transition-opacity duration-150 ${
                                            googleButtonReady && !googleLoading ? 'opacity-100' : 'opacity-0'
                                        }`}
                                        aria-hidden={!googleButtonReady || googleLoading}
                                    />

                                    {googleLoading && (
                                        <div className="absolute inset-0 z-10 flex items-center justify-center gap-2 rounded-[4px] border border-[#dadce0] bg-white px-4">
                                            <Loader2 className="h-3.5 w-3.5 animate-spin text-ocean-rich shrink-0" strokeWidth={2.5} />
                                            <span className="text-[14px] font-medium text-[#3c4043] tracking-[0.25px]">Completing sign-in…</span>
                                        </div>
                                    )}
                                </div>
                            </div>

                            <div className="relative flex items-center gap-2">
                                <div className="h-px flex-1 bg-ocean-ice" />
                                <span className="text-[10px] font-semibold text-ocean-deep/55 uppercase tracking-wider">or email</span>
                                <div className="h-px flex-1 bg-ocean-ice" />
                            </div>
                        </div>
                    )}

                    <form
                        className={isSignUp && !demoMode ? 'space-y-4' : 'space-y-2.5'}
                        onSubmit={handleSubmit}
                    >
                        {isSignUp && !demoMode ? (
                            <>
                                <div className="space-y-2 md:grid md:grid-cols-2 md:gap-x-4 md:gap-y-3 md:items-start md:space-y-0">
                                    <div className="space-y-1.5 md:col-span-2">
                                        <p className="text-[11px] font-semibold text-ocean-navy">Workspace</p>
                                        <div className="flex rounded-lg border border-ocean-ice/80 bg-ocean-mist/60 p-0.5">
                                            <button
                                                type="button"
                                                onClick={() => setRegistrationType('solo')}
                                                className={`w-1/2 rounded-md py-2.5 text-sm font-semibold transition-all ${
                                                    registrationType === 'solo'
                                                        ? 'bg-white text-ocean-navy shadow-sm'
                                                        : 'text-ocean-deep/70 hover:text-ocean-navy'
                                                }`}
                                            >
                                                Solo
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => setRegistrationType('company')}
                                                className={`w-1/2 rounded-md py-2.5 text-sm font-semibold transition-all ${
                                                    registrationType === 'company'
                                                        ? 'bg-white text-ocean-navy shadow-sm'
                                                        : 'text-ocean-deep/70 hover:text-ocean-navy'
                                                }`}
                                            >
                                                Company / team
                                            </button>
                                        </div>
                                    </div>

                                    <div className="md:col-span-1 space-y-1">
                                        <label
                                            htmlFor="email"
                                            className="block text-[10px] font-semibold text-ocean-navy"
                                        >
                                            Email
                                        </label>
                                        <div className={inputWrap}>
                                            <span className={iconBox} aria-hidden>
                                                <Mail className="h-4 w-4" />
                                            </span>
                                            <input
                                                id="email"
                                                type="email"
                                                value={email}
                                                onChange={(e) => setEmail(e.target.value)}
                                                className={fieldCls}
                                                placeholder="you@company.com"
                                                title={
                                                    registrationType === 'company'
                                                        ? 'Use your employer domain; personal inboxes are blocked.'
                                                        : undefined
                                                }
                                                autoComplete="email"
                                                required
                                            />
                                        </div>
                                    </div>

                                    <div className="md:col-span-1 space-y-1">
                                        <label
                                            htmlFor="company"
                                            className="block text-[10px] font-semibold text-ocean-navy md:mb-0"
                                        >
                                            {registrationType === 'solo' ? 'Display name (optional)' : 'Company name'}
                                        </label>
                                        <div className={inputWrap}>
                                            <span className={iconBox} aria-hidden>
                                                <Building2 className="h-4 w-4" />
                                            </span>
                                            <input
                                                id="company"
                                                type="text"
                                                value={companyName}
                                                onChange={(e) => setCompanyName(e.target.value)}
                                                className={fieldCls}
                                                placeholder={
                                                    registrationType === 'solo' ? 'From email if empty' : 'Acme Inc.'
                                                }
                                                title={
                                                    registrationType === 'company'
                                                        ? 'Work email required for company workspace.'
                                                        : undefined
                                                }
                                                autoComplete="organization"
                                                required={registrationType === 'company'}
                                            />
                                        </div>
                                    </div>

                                    <div className="md:col-span-1 space-y-1">
                                        <label
                                            htmlFor="password"
                                            className="block text-[10px] font-semibold text-ocean-navy"
                                        >
                                            Password
                                        </label>
                                        <AuthPasswordField
                                            id="password"
                                            value={password}
                                            onChange={(e) => setPassword(e.target.value)}
                                            placeholder="10+ chars, mixed case, number, symbol"
                                            autoComplete="new-password"
                                            minLength={10}
                                            required
                                        />
                                        <div className="mt-1">
                                            <PasswordStrengthMeter
                                                password={password}
                                                showRequirements={false}
                                                dense
                                            />
                                        </div>
                                    </div>

                                    <div className="md:col-span-1 space-y-1">
                                        <label
                                            htmlFor="confirm-password"
                                            className="block text-[10px] font-semibold text-ocean-navy"
                                        >
                                            Confirm password
                                        </label>
                                        <AuthPasswordField
                                            id="confirm-password"
                                            value={confirmPassword}
                                            onChange={(e) => setConfirmPassword(e.target.value)}
                                            placeholder="Same as password"
                                            autoComplete="new-password"
                                            minLength={10}
                                            required
                                        />
                                        {confirmPassword.length > 0 && password !== confirmPassword && (
                                            <p className="pt-1 text-[10px] font-medium text-red-600" role="status">
                                                Passwords do not match.
                                            </p>
                                        )}
                                    </div>
                                </div>

                                <label className="flex cursor-pointer select-none items-start gap-3 pt-1">
                                    <input
                                        type="checkbox"
                                        checked={acceptTerms}
                                        onChange={(e) => setAcceptTerms(e.target.checked)}
                                        className="mt-0.5 rounded border-ocean-sky text-ocean-navy focus:ring-ocean-rich"
                                        required
                                    />
                                    <span className="text-[10px] text-ocean-deep leading-snug sm:text-[11px]">
                                        I agree to the ELVA{' '}
                                        <button
                                            type="button"
                                            className="font-semibold text-ocean-rich underline-offset-2 hover:underline"
                                            onClick={() => setTermsModalOpen(true)}
                                        >
                                            Terms of Service
                                        </button>
                                        .
                                    </span>
                                </label>

                                <button
                                    type="submit"
                                    disabled={loading}
                                    className="w-full rounded-lg py-2.5 text-sm font-semibold text-white shadow-md shadow-ocean-navy/12 transition-all bg-gradient-to-r from-ocean-rich to-ocean-navy hover:brightness-[1.03] disabled:cursor-not-allowed disabled:opacity-55 disabled:shadow-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ocean-rich focus-visible:ring-offset-1 mt-2"
                                >
                                    {loading ? (
                                        <span className="inline-flex items-center justify-center gap-2">
                                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                            Creating…
                                        </span>
                                    ) : (
                                        'Create account'
                                    )}
                                </button>
                            </>
                        ) : (
                            <>
                                <div>
                                    <label
                                        htmlFor="email"
                                        className="mb-1 block text-[11px] font-semibold text-ocean-navy"
                                    >
                                        Email
                                    </label>
                                    <div className={inputWrap}>
                                        <span className={iconBox} aria-hidden>
                                            <Mail className="h-4 w-4" />
                                        </span>
                                        <input
                                            id="email"
                                            type="email"
                                            value={email}
                                            onChange={(e) => setEmail(e.target.value)}
                                            className={fieldCls}
                                            placeholder="you@company.com"
                                            autoComplete="email"
                                            required={!demoMode}
                                        />
                                    </div>
                                </div>
                                <div>
                                    <label
                                        htmlFor="password"
                                        className="mb-1 block text-[11px] font-semibold text-ocean-navy"
                                    >
                                        Password
                                    </label>
                                    <AuthPasswordField
                                        id="password"
                                        value={password}
                                        onChange={(e) => setPassword(e.target.value)}
                                        placeholder="••••••••"
                                        autoComplete="current-password"
                                        required={!demoMode}
                                    />
                                </div>

                                <div className="flex justify-end -mt-1">
                                    <Link
                                        to="/forgot-password"
                                        className="text-[11px] font-medium text-ocean-rich hover:text-ocean-deep hover:underline transition-colors"
                                    >
                                        Forgot password?
                                    </Link>
                                </div>

                                <button
                                    type="submit"
                                    disabled={loading}
                                    className="mt-1 w-full rounded-lg py-2.5 text-sm font-semibold text-white shadow-md shadow-ocean-navy/12 transition-all bg-gradient-to-r from-ocean-rich to-ocean-navy hover:brightness-[1.03] disabled:cursor-not-allowed disabled:opacity-55 disabled:shadow-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ocean-rich focus-visible:ring-offset-1"
                                >
                                    {loading ? (
                                        <span className="inline-flex items-center justify-center gap-2">
                                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                            {isSignUp ? 'Creating…' : 'Signing in…'}
                                        </span>
                                    ) : demoMode ? (
                                        'Enter demo'
                                    ) : (
                                        'Sign in'
                                    )}
                                </button>
                            </>
                        )}
                    </form>

                    <p className="shrink-0 pt-1 text-center text-[11px] text-ocean-deep/55">
                        <Link to="/" className="text-ocean-rich font-medium hover:underline">
                            ← Back to home
                        </Link>
                    </p>
                    </div>
                </div>
            </main>
            <TermsModal open={termsModalOpen} onClose={() => setTermsModalOpen(false)} />
        </div>
    );
}
