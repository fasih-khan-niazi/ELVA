import { useEffect, useState } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { appToast as toast } from '../components/Toast';
import { Loader2, CheckCircle2 } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { PasswordStrengthMeter } from '../components/PasswordStrengthMeter';
import { AuthBrandAside } from '../components/AuthBrandAside';
import { AuthPasswordField } from '../components/PasswordFieldWithToggle';
import { TermsModal } from '../components/TermsModal';
import { validateStrongPassword } from '../utils/passwordPolicy';
import {
    AUTH_FORM_BODY_CENTERED_CLASS,
    AUTH_FORM_BODY_SCROLL_CLASS,
    AUTH_FORM_MAIN_CLASS,
} from '../auth/authShellClasses';
import { postLoginPath } from '../auth/postLoginPath';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

export default function AcceptInvite() {
    const { token } = useParams<{ token: string }>();
    const navigate = useNavigate();
    const { login, refreshSubscription } = useAuth();
    const [loading, setLoading] = useState(true);
    const [meta, setMeta] = useState<{ emailMask: string; termsVersion: string } | null>(null);
    const [err, setErr] = useState<string | null>(null);
    const [password, setPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [acceptTerms, setAcceptTerms] = useState(false);
    const [termsModalOpen, setTermsModalOpen] = useState(false);
    const [submitting, setSubmitting] = useState(false);

    useEffect(() => {
        if (!token) {
            setErr('Invalid invitation link.');
            setLoading(false);
            return;
        }
        let cancelled = false;
        (async () => {
            try {
                const r = await fetch(`${API_URL}/api/auth/invite/${encodeURIComponent(token)}`);
                const data = await r.json().catch(() => ({}));
                if (!r.ok) {
                    if (!cancelled) setErr(data.message || 'Invite not found.');
                    return;
                }
                if (!cancelled) setMeta({ emailMask: data.emailMask, termsVersion: data.termsVersion });
            } catch {
                if (!cancelled) setErr('Could not reach the server.');
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [token]);

    const onSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!token || !acceptTerms || !meta) {
            toast.error('Accept the terms and complete the form.');
            return;
        }
        const pw = validateStrongPassword(password);
        if (!pw.ok) {
            toast.error(pw.message || 'Password does not meet requirements.');
            return;
        }
        if (password !== confirmPassword) {
            toast.error('Passwords do not match. Re-enter the same password twice.');
            return;
        }
        setSubmitting(true);
        try {
            const r = await fetch(`${API_URL}/api/auth/invite/accept`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    token,
                    password,
                    acceptTerms: true,
                    termsVersion: meta.termsVersion,
                }),
            });
            const data = await r.json();
            if (!r.ok) throw new Error(data.message || 'Could not accept invite');
            login(data.token, data.user);
            const sub = await refreshSubscription(data.token);
            toast.success('Welcome, you joined the workspace.');
            navigate(postLoginPath(sub));
        } catch (e: unknown) {
            toast.error(e instanceof Error ? e.message : 'Failed');
        } finally {
            setSubmitting(false);
        }
    };

    if (loading) {
        return (
            <div className="relative flex h-full min-h-0 w-full flex-1 flex-col bg-ocean-powder">
                <AuthBrandAside />
                <main className={AUTH_FORM_MAIN_CLASS}>
                    <div
                        className={`${AUTH_FORM_BODY_CENTERED_CLASS} items-center gap-3 text-ocean-deep`}
                    >
                        <Loader2 className="h-10 w-10 animate-spin text-ocean-sky" />
                        <p className="text-sm font-medium">Checking invite…</p>
                    </div>
                </main>
            </div>
        );
    }

    if (err || !meta) {
        return (
            <div className="relative flex h-full min-h-0 w-full flex-1 flex-col bg-ocean-powder">
                <AuthBrandAside />
                <main className={AUTH_FORM_MAIN_CLASS}>
                    <div className={AUTH_FORM_BODY_CENTERED_CLASS}>
                        <div className="mx-auto w-full max-w-[368px] space-y-4 text-center">
                            <div className="lg:hidden">
                                <Link
                                    to="/"
                                    className="inline-flex items-center gap-2 text-ocean-navy font-bold text-base"
                                >
                                    <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-ocean-sky to-ocean-navy text-white text-xs">
                                        E
                                    </span>
                                    ELVA
                                </Link>
                            </div>
                            <h1 className="text-xl font-bold text-ocean-navy">Invite unavailable</h1>
                            <p className="text-sm text-ocean-deep/85 leading-relaxed">{err || 'Something went wrong.'}</p>
                            <Link
                                to="/login"
                                className="inline-block text-ocean-rich text-sm font-semibold hover:underline"
                            >
                                Go to sign in
                            </Link>
                        </div>
                    </div>
                </main>
            </div>
        );
    }

    return (
        <div className="relative flex h-full min-h-0 w-full flex-1 flex-col bg-ocean-powder">
            <AuthBrandAside />
            <main className={AUTH_FORM_MAIN_CLASS}>
                <div className={AUTH_FORM_BODY_SCROLL_CLASS}>
                    <div className="mx-auto w-full max-w-[368px] space-y-4 sm:space-y-5">
                        <div className="lg:hidden text-center shrink-0">
                            <Link
                                to="/"
                                className="inline-flex items-center gap-2 text-ocean-navy font-bold text-base"
                            >
                                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-ocean-sky to-ocean-navy text-white text-xs">
                                    E
                                </span>
                                ELVA
                            </Link>
                        </div>

                        <div className="space-y-1 text-center lg:text-left">
                            <h1 className="text-xl font-bold tracking-tight text-ocean-navy">Join your workspace</h1>
                            <p className="text-xs leading-snug text-ocean-deep/80">
                                Invite for{' '}
                                <span className="font-semibold text-ocean-navy">{meta.emailMask}</span>. Set a permanent
                                password and accept the Terms to finish joining.
                            </p>
                        </div>

                        <form onSubmit={onSubmit} className="space-y-5">
                            <div>
                                <label htmlFor="invite-password" className="mb-1 block text-[11px] font-semibold text-ocean-navy">
                                    Password
                                </label>
                                <AuthPasswordField
                                    id="invite-password"
                                    inputClassName="py-2.5"
                                    minLength={10}
                                    maxLength={128}
                                    autoComplete="new-password"
                                    value={password}
                                    onChange={(e) => setPassword(e.target.value)}
                                    placeholder="Strong password (10+ chars, mixed case, number, symbol)"
                                    required
                                />
                                <div className="mt-2">
                                    <PasswordStrengthMeter password={password} showRequirements={false} dense />
                                </div>
                            </div>

                            <div>
                                <label
                                    htmlFor="invite-confirm-password"
                                    className="mb-1 block text-[11px] font-semibold text-ocean-navy"
                                >
                                    Confirm password
                                </label>
                                <AuthPasswordField
                                    id="invite-confirm-password"
                                    inputClassName="py-2.5"
                                    minLength={10}
                                    maxLength={128}
                                    autoComplete="new-password"
                                    value={confirmPassword}
                                    onChange={(e) => setConfirmPassword(e.target.value)}
                                    placeholder="Same as password"
                                    required
                                />
                                {confirmPassword.length > 0 && password !== confirmPassword && (
                                    <p className="pt-1 text-[10px] font-medium text-red-600" role="status">
                                        Passwords do not match.
                                    </p>
                                )}
                            </div>

                            <label className="flex cursor-pointer select-none items-start gap-3 pt-1">
                                <input
                                    type="checkbox"
                                    checked={acceptTerms}
                                    onChange={(e) => setAcceptTerms(e.target.checked)}
                                    className="mt-0.5 rounded border-ocean-sky text-ocean-navy focus:ring-ocean-rich"
                                    required
                                />
                                <span className="text-[11px] leading-snug text-ocean-deep">
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
                                disabled={submitting}
                                className="mt-1 flex w-full items-center justify-center gap-2 rounded-lg py-2.5 text-sm font-semibold text-white bg-gradient-to-r from-ocean-rich to-ocean-navy shadow-md shadow-ocean-navy/12 transition-all hover:brightness-[1.03] disabled:cursor-not-allowed disabled:opacity-55 disabled:shadow-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ocean-rich focus-visible:ring-offset-1"
                            >
                                {submitting ? (
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                ) : (
                                    <CheckCircle2 className="h-4 w-4" />
                                )}
                                {submitting ? 'Creating account…' : 'Accept and join'}
                            </button>
                        </form>

                        <p className="pt-1 text-center text-[11px] text-ocean-deep/55">
                            <Link to="/login" className="font-medium text-ocean-rich hover:underline">
                                Already have an account? Sign in
                            </Link>
                        </p>
                    </div>
                </div>
            </main>
            <TermsModal open={termsModalOpen} onClose={() => setTermsModalOpen(false)} />
        </div>
    );
}
