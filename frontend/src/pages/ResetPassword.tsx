import { useState, FormEvent } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import { KeyRound, CheckCircle, Loader2, Eye, EyeOff } from 'lucide-react';
import { motion } from 'framer-motion';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

export default function ResetPassword() {
    const { token } = useParams<{ token: string }>();
    const navigate = useNavigate();

    const [password, setPassword] = useState('');
    const [confirm, setConfirm] = useState('');
    const [showPw, setShowPw] = useState(false);
    const [loading, setLoading] = useState(false);
    const [done, setDone] = useState(false);
    const [error, setError] = useState<string | null>(null);

    /** Mirror the backend passwordPolicy rules so the user gets instant feedback. */
    function validatePassword(pw: string): string | null {
        if (pw.length < 10) return 'Password must be at least 10 characters.';
        if (!/[A-Z]/.test(pw)) return 'Password must include at least one uppercase letter.';
        if (!/[a-z]/.test(pw)) return 'Password must include at least one lowercase letter.';
        if (!/[0-9]/.test(pw)) return 'Password must include at least one number.';
        if (!/[^A-Za-z0-9]/.test(pw)) return 'Password must include at least one special character.';
        return null;
    }

    const handleSubmit = async (e: FormEvent) => {
        e.preventDefault();
        setError(null);

        const policyError = validatePassword(password);
        if (policyError) {
            setError(policyError);
            return;
        }

        if (password !== confirm) {
            setError('Passwords do not match.');
            return;
        }

        setLoading(true);
        try {
            const res = await fetch(`${API_URL}/api/auth/reset-password`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ token, password }),
            });
            const data = await res.json();
            if (!res.ok) {
                setError(data.message || 'Something went wrong.');
            } else {
                setDone(true);
                setTimeout(() => navigate('/login'), 3000);
            }
        } catch {
            setError('Network error. Please try again.');
        } finally {
            setLoading(false);
        }
    };

    if (!token) {
        return (
            <div className="min-h-screen bg-ocean-powder flex items-center justify-center p-4">
                <div className="bg-white rounded-2xl shadow-xl border border-slate-200/60 px-8 py-10 max-w-md w-full text-center">
                    <p className="text-sm text-red-600 font-medium">Invalid reset link.</p>
                    <Link to="/forgot-password" className="mt-3 inline-block text-sm text-ocean-bright hover:underline">
                        Request a new one →
                    </Link>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-ocean-powder flex items-center justify-center p-4">
            <motion.div
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
                className="w-full max-w-md"
            >
                <div className="bg-white rounded-2xl shadow-xl border border-slate-200/60 overflow-hidden">
                    <div className="px-8 pt-8 pb-6 border-b border-slate-100">
                        <div className="flex items-center justify-center h-12 w-12 rounded-2xl bg-ocean-navy mx-auto mb-4">
                            <KeyRound className="h-5 w-5 text-white" aria-hidden />
                        </div>
                        <h1 className="text-xl font-bold text-slate-900 text-center">Set new password</h1>
                        <p className="text-sm text-slate-500 text-center mt-1.5">
                            Choose a strong password for your account.
                        </p>
                    </div>

                    <div className="px-8 py-6">
                        {done ? (
                            <motion.div
                                initial={{ opacity: 0, scale: 0.95 }}
                                animate={{ opacity: 1, scale: 1 }}
                                className="flex flex-col items-center gap-3 py-4 text-center"
                            >
                                <CheckCircle className="h-10 w-10 text-emerald-500" aria-hidden />
                                <p className="text-sm font-semibold text-slate-800">Password updated!</p>
                                <p className="text-sm text-slate-500">
                                    Redirecting you to sign in…
                                </p>
                            </motion.div>
                        ) : (
                            <form onSubmit={handleSubmit} className="space-y-4">
                                <div>
                                    <label htmlFor="rp-password" className="block text-xs font-semibold text-slate-700 mb-1.5">
                                        New password
                                    </label>
                                    <div className="relative">
                                        <input
                                            id="rp-password"
                                            type={showPw ? 'text' : 'password'}
                                            autoComplete="new-password"
                                            required
                                            value={password}
                                            onChange={e => setPassword(e.target.value)}
                                            placeholder="At least 10 characters, uppercase, number & symbol"
                                            className="w-full px-3.5 py-2.5 pr-10 rounded-xl border border-slate-200 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-ocean-sky focus:border-transparent transition-shadow"
                                        />
                                        <button
                                            type="button"
                                            onClick={() => setShowPw(v => !v)}
                                            className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors"
                                            aria-label={showPw ? 'Hide password' : 'Show password'}
                                        >
                                            {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                                        </button>
                                    </div>
                                </div>

                                <div>
                                    <label htmlFor="rp-confirm" className="block text-xs font-semibold text-slate-700 mb-1.5">
                                        Confirm password
                                    </label>
                                    <input
                                        id="rp-confirm"
                                        type={showPw ? 'text' : 'password'}
                                        autoComplete="new-password"
                                        required
                                        value={confirm}
                                        onChange={e => setConfirm(e.target.value)}
                                        placeholder="Re-enter your new password"
                                        className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-ocean-sky focus:border-transparent transition-shadow"
                                    />
                                </div>

                                {error && (
                                    <p className="text-sm text-red-600 bg-red-50 border border-red-100 px-3 py-2 rounded-lg">
                                        {error}
                                    </p>
                                )}

                                <button
                                    type="submit"
                                    disabled={loading || !password || !confirm}
                                    className="w-full flex items-center justify-center gap-2 bg-ocean-navy text-white font-semibold py-2.5 px-4 rounded-xl hover:bg-ocean-deep transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                                >
                                    {loading && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
                                    {loading ? 'Updating…' : 'Update password'}
                                </button>

                                <div className="flex items-center justify-center pt-1">
                                    <Link
                                        to="/login"
                                        className="text-sm text-slate-500 hover:text-slate-800 transition-colors"
                                    >
                                        Back to sign in
                                    </Link>
                                </div>
                            </form>
                        )}
                    </div>
                </div>
            </motion.div>
        </div>
    );
}
