import { useState, FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Mail, CheckCircle, Loader2 } from 'lucide-react';
import { motion } from 'framer-motion';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

export default function ForgotPassword() {
    const [email, setEmail] = useState('');
    const [loading, setLoading] = useState(false);
    const [sent, setSent] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const handleSubmit = async (e: FormEvent) => {
        e.preventDefault();
        setError(null);
        setLoading(true);
        try {
            const res = await fetch(`${API_URL}/api/auth/forgot-password`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email: email.trim() }),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                setError((data as { message?: string }).message || 'Something went wrong.');
            } else {
                setSent(true);
            }
        } catch {
            setError('Network error. Please try again.');
        } finally {
            setLoading(false);
        }
    };

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
                            <Mail className="h-5 w-5 text-white" aria-hidden />
                        </div>
                        <h1 className="text-xl font-bold text-slate-900 text-center">Forgot your password?</h1>
                        <p className="text-sm text-slate-500 text-center mt-1.5">
                            Enter your email and we'll send you a reset link.
                        </p>
                    </div>

                    <div className="px-8 py-6">
                        {sent ? (
                            <motion.div
                                initial={{ opacity: 0, scale: 0.95 }}
                                animate={{ opacity: 1, scale: 1 }}
                                className="flex flex-col items-center gap-3 py-4 text-center"
                            >
                                <CheckCircle className="h-10 w-10 text-emerald-500" aria-hidden />
                                <p className="text-sm font-semibold text-slate-800">Check your inbox</p>
                                <p className="text-sm text-slate-500 leading-relaxed">
                                    If <span className="font-medium text-slate-700">{email}</span> is registered,
                                    you'll receive a reset link within a few minutes. Check your spam folder if you
                                    don't see it.
                                </p>
                                <Link
                                    to="/login"
                                    className="mt-2 text-sm font-semibold text-ocean-bright hover:text-ocean-deep transition-colors"
                                >
                                    ← Back to sign in
                                </Link>
                            </motion.div>
                        ) : (
                            <form onSubmit={handleSubmit} className="space-y-4">
                                <div>
                                    <label htmlFor="fp-email" className="block text-xs font-semibold text-slate-700 mb-1.5">
                                        Email address
                                    </label>
                                    <input
                                        id="fp-email"
                                        type="email"
                                        autoComplete="email"
                                        required
                                        value={email}
                                        onChange={e => setEmail(e.target.value)}
                                        placeholder="you@example.com"
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
                                    disabled={loading || !email.trim()}
                                    className="w-full flex items-center justify-center gap-2 bg-ocean-navy text-white font-semibold py-2.5 px-4 rounded-xl hover:bg-ocean-deep transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                                >
                                    {loading && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
                                    {loading ? 'Sending…' : 'Send reset link'}
                                </button>

                                <div className="flex items-center justify-center pt-1">
                                    <Link
                                        to="/login"
                                        className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800 transition-colors"
                                    >
                                        <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
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
