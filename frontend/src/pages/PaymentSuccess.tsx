import { useState, useEffect } from 'react';

import { useNavigate, useSearchParams } from 'react-router-dom';

import { motion } from 'framer-motion';

import { useAuth } from '../context/AuthContext';

import { useToast } from '../components/Toast';

import AnimatedPage from '../components/AnimatedPage';

import { modalPanel } from '@/lib/motion';

import { CheckCircle, Loader, AlertCircle, ArrowRight } from 'lucide-react';

import { apiFetch, parseApiErrorMessage } from '@/lib/api';



export default function PaymentSuccess() {

    const { token, refreshSubscription, setSubscription } = useAuth();

    const navigate = useNavigate();

    const toast = useToast();

    const [searchParams] = useSearchParams();

    const [status, setStatus] = useState<'verifying' | 'success' | 'error'>('verifying');

    const [error, setError] = useState('');

    const [subscription, setLocalSubscription] = useState<{

        plan?: string;

        status?: string;

        currentPeriodEnd?: string;

    } | null>(null);



    useEffect(() => {

        const sessionId = searchParams.get('session_id');

        if (sessionId) {

            void verifyPayment(sessionId);

        } else {

            setStatus('error');

            setError('No session ID found');

            toast.error('Verification failed', 'No checkout session found');

        }

    }, [searchParams, token]);



    const verifyPayment = async (sessionId: string) => {

        try {

            const response = await apiFetch('/api/subscription/verify-checkout', {

                method: 'POST',

                token,

                body: JSON.stringify({ sessionId }),

            });



            const data = await response.json();



            if (response.ok) {

                setStatus('success');

                setLocalSubscription(data.subscription);

                setSubscription(data.subscription);

                localStorage.setItem('subscription', JSON.stringify(data.subscription));

                await refreshSubscription(token);

                toast.success('Payment confirmed', `Welcome to the ${data.subscription?.plan ?? ''} plan`);

            } else {

                const msg = data.message || (await parseApiErrorMessage(response, 'Failed to verify payment'));

                setStatus('error');

                setError(msg);

                toast.error('Verification failed', msg);

            }

        } catch {

            setStatus('error');

            setError('Failed to verify payment');

            toast.error('Verification failed', 'Could not reach the server');

        }

    };



    if (status === 'verifying') {

        return (

            <div className="flex min-h-[50vh] items-center justify-center bg-white py-24">

                <div className="text-center">

                    <Loader className="h-16 w-16 animate-spin text-ocean-deep mx-auto mb-6" />

                    <h2 className="text-2xl font-bold text-ocean-navy mb-2">Verifying Payment</h2>

                    <p className="text-ocean-deep/90">Please wait while we confirm your subscription...</p>

                </div>

            </div>

        );

    }



    if (status === 'error') {

        return (

            <AnimatedPage className="flex min-h-[50vh] items-center justify-center bg-white p-4 py-24">

                <motion.div

                    className="max-w-md w-full bg-white rounded-2xl shadow-xl p-8 text-center"

                    initial="hidden"

                    animate="visible"

                    variants={modalPanel}

                >

                    <div className="w-20 h-20 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-6">

                        <AlertCircle className="h-10 w-10 text-red-600" />

                    </div>

                    <h2 className="text-2xl font-bold text-ocean-navy mb-2">Payment Verification Failed</h2>

                    <p className="text-ocean-deep/90 mb-6">{error}</p>

                    <div className="space-y-3">

                        <button

                            onClick={() => navigate('/subscription')}

                            className="w-full py-3 px-4 bg-ocean-deep text-white rounded-xl font-semibold hover:bg-ocean-rich transition-colors"

                        >

                            Try Again

                        </button>

                        <button

                            onClick={() => navigate('/dashboard')}

                            className="w-full py-3 px-4 bg-ocean-mist/50 text-ocean-deep rounded-xl font-semibold hover:bg-ocean-ice transition-colors"

                        >

                            Go to Dashboard

                        </button>

                    </div>

                </motion.div>

            </AnimatedPage>

        );

    }



    return (

        <AnimatedPage className="flex min-h-[50vh] items-center justify-center bg-white p-4 py-24">

            <motion.div

                className="max-w-md w-full bg-white rounded-2xl shadow-xl p-8 text-center"

                initial="hidden"

                animate="visible"

                variants={modalPanel}

            >

                <div className="relative mb-6">

                    <div className="absolute inset-0 bg-green-400 rounded-full opacity-20 animate-ping" />

                    <div className="relative w-20 h-20 bg-gradient-to-r from-green-400 to-green-500 rounded-full flex items-center justify-center mx-auto">

                        <CheckCircle className="h-10 w-10 text-white" />

                    </div>

                </div>



                <h2 className="text-3xl font-bold text-ocean-navy mb-2">Payment Successful!</h2>

                <p className="text-ocean-deep/90 mb-6">

                    Welcome to the <span className="font-semibold capitalize">{subscription?.plan}</span> plan!

                </p>



                <div className="bg-ocean-powder rounded-xl p-4 mb-6 text-left">

                    <h3 className="font-semibold text-ocean-navy mb-2">Your Subscription</h3>

                    <div className="space-y-2 text-sm">

                        <div className="flex justify-between">

                            <span className="text-ocean-deep/90">Plan</span>

                            <span className="font-medium text-ocean-navy capitalize">{subscription?.plan}</span>

                        </div>

                        <div className="flex justify-between">

                            <span className="text-ocean-deep/90">Status</span>

                            <span className="font-medium text-green-600 capitalize">{subscription?.status}</span>

                        </div>

                        {subscription?.currentPeriodEnd && (

                            <div className="flex justify-between">

                                <span className="text-ocean-deep/90">Next billing</span>

                                <span className="font-medium text-ocean-navy">

                                    {new Date(subscription.currentPeriodEnd).toLocaleDateString()}

                                </span>

                            </div>

                        )}

                    </div>

                </div>



                <button

                    onClick={() => navigate('/dashboard')}

                    className="w-full py-3 px-4 bg-gradient-to-r from-ocean-deep to-ocean-rich text-white rounded-xl font-semibold hover:brightness-110 transition-all shadow-lg hover:shadow-xl flex items-center justify-center"

                >

                    Go to Dashboard

                    <ArrowRight className="h-5 w-5 ml-2" />

                </button>



                <p className="text-ocean-deep/80 text-sm mt-4">

                    You can manage your subscription anytime from the dashboard.

                </p>

            </motion.div>

        </AnimatedPage>

    );

}


