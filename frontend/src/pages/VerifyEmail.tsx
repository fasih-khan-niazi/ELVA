import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { CheckCircle, XCircle, Loader2, Mail } from 'lucide-react';
import { motion } from 'framer-motion';
import { useAuth } from '../context/AuthContext';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

export default function VerifyEmail() {
    const { token } = useParams<{ token: string }>();
    const { refreshUserProfile } = useAuth();
    const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
    const [message, setMessage] = useState('');

    useEffect(() => {
        if (!token) {
            setStatus('error');
            setMessage('Invalid verification link.');
            return;
        }

        const run = async () => {
            try {
                const res = await fetch(`${API_URL}/api/auth/verify-email`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ token }),
                });
                const data = await res.json();
                if (res.ok) {
                    setStatus('success');
                    setMessage(data.message || 'Email verified successfully.');
                    // Refresh the profile so the banner disappears.
                    void refreshUserProfile();
                } else {
                    setStatus('error');
                    setMessage(data.message || 'Verification failed.');
                }
            } catch {
                setStatus('error');
                setMessage('Network error. Please try again.');
            }
        };
        void run();
    }, [token, refreshUserProfile]);

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
                        <h1 className="text-xl font-bold text-slate-900 text-center">Email Verification</h1>
                    </div>

                    <div className="px-8 py-8 flex flex-col items-center gap-4 text-center">
                        {status === 'loading' && (
                            <>
                                <Loader2 className="h-10 w-10 text-ocean-bright animate-spin" aria-hidden />
                                <p className="text-sm text-slate-500">Verifying your email…</p>
                            </>
                        )}

                        {status === 'success' && (
                            <motion.div
                                initial={{ opacity: 0, scale: 0.9 }}
                                animate={{ opacity: 1, scale: 1 }}
                                className="flex flex-col items-center gap-3"
                            >
                                <CheckCircle className="h-12 w-12 text-emerald-500" aria-hidden />
                                <p className="text-sm font-semibold text-slate-800">{message}</p>
                                <p className="text-sm text-slate-500">
                                    Your account is now fully verified.
                                </p>
                                <Link
                                    to="/dashboard"
                                    className="mt-2 inline-flex items-center gap-2 bg-ocean-navy text-white text-sm font-semibold px-5 py-2.5 rounded-xl hover:bg-ocean-deep transition-colors"
                                >
                                    Go to Dashboard →
                                </Link>
                            </motion.div>
                        )}

                        {status === 'error' && (
                            <motion.div
                                initial={{ opacity: 0, scale: 0.9 }}
                                animate={{ opacity: 1, scale: 1 }}
                                className="flex flex-col items-center gap-3"
                            >
                                <XCircle className="h-12 w-12 text-red-500" aria-hidden />
                                <p className="text-sm font-semibold text-slate-800">{message}</p>
                                <p className="text-sm text-slate-500">
                                    The link may have expired or already been used.
                                </p>
                                <Link
                                    to="/dashboard"
                                    className="mt-2 text-sm font-medium text-ocean-bright hover:underline"
                                >
                                    Request a new verification link from your dashboard
                                </Link>
                            </motion.div>
                        )}
                    </div>
                </div>
            </motion.div>
        </div>
    );
}
