import { useState, useEffect } from 'react';

import { Navigate, useNavigate } from 'react-router-dom';

import { useAuth } from '../context/AuthContext';

import { PageBackNav } from '../components/PageBackNav';

import { SubscriptionPageSkeleton } from '../components/skeletons';

import AnimatedPage from '../components/AnimatedPage';

import { appToast as toast } from '../components/Toast';

import { Check, Zap, Building2, Rocket, Crown, Loader, AlertCircle } from 'lucide-react';

import { apiFetch, parseApiErrorMessage } from '@/lib/api';



interface Plan {

    id: string;

    name: string;

    price: number;

    features: {

        maxAgents: number | string;

        maxDocuments: number | string;

        maxMessagesPerMonth: number | string;

        maxDocumentSizeMB: number;

        maxKnowledgeSummaryChars?: number | string;

        maxSeats?: number | string;

        voiceEnabled: boolean;

        analyticsEnabled: boolean;

        connectorsEnabled?: boolean;

        maxConnectors?: number | string;

        prioritySupport: boolean;

    };

}



interface CurrentSubscription {

    plan: string;

    status: string;

    currentPeriodEnd?: string;

}



const planIcons: Record<string, React.ReactNode> = {

    free: <Zap className="h-8 w-8" />,

    starter: <Rocket className="h-8 w-8" />,

    pro: <Building2 className="h-8 w-8" />,

    enterprise: <Crown className="h-8 w-8" />

};



const planColors: Record<string, string> = {

    free: 'from-slate-400 to-slate-600',

    starter: 'from-ocean-deep to-ocean-navy',

    pro: 'from-ocean-sky to-ocean-navy',

    enterprise: 'from-amber-400 to-amber-600'

};



const planBorders: Record<string, string> = {

    free: 'border-ocean-sky/70 hover:border-ocean-deep',

    starter: 'border-ocean-sky/35 hover:border-ocean-sky',

    pro: 'border-ocean-sky ring-2 ring-ocean-sky/40',

    enterprise: 'border-amber-200/80 hover:border-amber-400'

};



export default function Subscription() {

    const { token, user, refreshSubscription } = useAuth();

    const navigate = useNavigate();



    const [plans, setPlans] = useState<Plan[]>([]);

    const [currentSubscription, setCurrentSubscription] = useState<CurrentSubscription | null>(null);

    const [loading, setLoading] = useState(true);

    const [selecting, setSelecting] = useState<string | null>(null);

    const [error, setError] = useState('');



    useEffect(() => {

        void fetchPlans();

        void fetchCurrentSubscription();

    }, [token]);



    const fetchPlans = async () => {

        try {

            const response = await apiFetch('/api/subscription/plans', { skipAuthRedirect: true });

            if (response.ok) {

                const data = await response.json();

                setPlans(data);

            }

        } catch {

            toast.error('Failed to load plans');

            setError('Failed to load plans');

        } finally {

            setLoading(false);

        }

    };



    const fetchCurrentSubscription = async () => {

        try {

            const response = await apiFetch('/api/subscription/current', { token, skipAuthRedirect: true });

            if (response.ok) {

                const data = await response.json();

                setCurrentSubscription(data.subscription);

            }

        } catch {

            console.error('Failed to fetch current subscription');

        }

    };



    const handleSelectPlan = async (planId: string) => {

        if (currentSubscription?.plan === planId) {

            return;

        }



        setSelecting(planId);

        setError('');



        try {

            if (planId === 'free') {

                const response = await apiFetch('/api/subscription/select-free', {

                    method: 'POST',

                    token,

                });



                if (response.ok) {

                    await refreshSubscription(token);

                    toast.success('Plan updated', 'You are now on the free plan');

                    navigate('/dashboard');

                } else {

                    const msg = await parseApiErrorMessage(response, 'Failed to select plan');

                    toast.error('Plan change failed', msg);

                    setError(msg);

                }

            } else {

                const response = await apiFetch('/api/subscription/create-checkout', {

                    method: 'POST',

                    token,

                    body: JSON.stringify({ plan: planId }),

                });



                const data = await response.json();



                if (response.ok && data.url) {

                    window.location.href = data.url;

                } else {

                    const msg = data.message || (await parseApiErrorMessage(response, 'Failed to create checkout session'));

                    toast.error('Checkout failed', msg);

                    setError(msg);

                }

            }

        } catch {

            toast.error('Request failed', 'Could not process your plan change');

            setError('Failed to process request');

        } finally {

            setSelecting(null);

        }

    };



    const canManageBilling = user?.role === 'business_admin';



    const formatFeatureValue = (value: number | string): string => {

        if (value === -1 || value === 'Unlimited') return 'Unlimited';

        if (typeof value === 'number') return value.toLocaleString();

        return value;

    };



    const formatSeatLabel = (value: number | string | undefined): string => {

        if (value === undefined) return '-';

        if (value === 'Unlimited' || value === -1) return 'Unlimited';

        if (typeof value === 'number') return value.toLocaleString();

        return String(value);

    };



    const workspaceSeatsLine = (planId: string, maxSeats: number | string | undefined): string => {

        if (planId === 'free') return '1 workspace seat (solo - you only)';

        if (planId === 'enterprise') return 'Unlimited workspace seats (custom / Enterprise agreements)';

        if (planId === 'starter') return '3 workspace seats (includes admin)';

        if (planId === 'pro') return '5 workspace seats (includes admin)';

        return `${formatSeatLabel(maxSeats)} workspace seats`;

    };



    if (user?.role === 'platform_admin') {

        return <Navigate to="/platform" replace />;

    }



    if (loading) {

        return <SubscriptionPageSkeleton />;

    }



    return (

        <AnimatedPage className="bg-white px-4 py-12">

            <div className="max-w-7xl mx-auto">

                <PageBackNav to="/dashboard" label="Back to Dashboard" />



                <div className="text-center mb-8">

                    {!canManageBilling && (

                        <div className="max-w-xl mx-auto mb-6 px-4 py-3 rounded-xl bg-ocean-navy/5 border border-ocean-navy/10 text-ocean-deep text-sm">

                            Billing is locked for your role. Ask a workspace admin to change plans or payment details.

                        </div>

                    )}

                    <h1 className="text-4xl font-bold text-ocean-navy mb-4 tracking-tight">

                        {currentSubscription ? 'Manage Your Plan' : 'Choose Your Plan'}

                    </h1>

                    <p className="text-xl text-ocean-deep max-w-2xl mx-auto">

                        {currentSubscription 

                            ? `You're currently on the ${currentSubscription.plan.charAt(0).toUpperCase() + currentSubscription.plan.slice(1)} plan.`

                            : 'Select the perfect plan for your business. Start free and upgrade as you grow.'

                        }

                    </p>

                </div>



                {currentSubscription && currentSubscription.plan !== 'free' && (

                    <div className="max-w-2xl mx-auto mb-8 p-6 bg-white rounded-2xl border border-ocean-sky/70 shadow-ocean-card hover:shadow-ocean transition-shadow duration-300">

                        <div className="flex items-center justify-between">

                            <div className="flex items-center gap-3">

                                <div className={`p-2 rounded-lg bg-gradient-to-r ${planColors[currentSubscription.plan] || 'from-ocean-deep to-ocean-navy'}`}>

                                    {planIcons[currentSubscription.plan]}

                                </div>

                                <div>

                                    <p className="font-semibold text-ocean-navy capitalize">{currentSubscription.plan} Plan</p>

                                    {currentSubscription.currentPeriodEnd && (

                                        <p className="text-sm text-ocean-deep">

                                            Renews on {new Date(currentSubscription.currentPeriodEnd).toLocaleDateString()}

                                        </p>

                                    )}

                                </div>

                            </div>

                            <span className="px-3 py-1 bg-green-100 text-green-700 rounded-full text-sm font-medium capitalize">

                                {currentSubscription.status}

                            </span>

                        </div>

                    </div>

                )}



                {error && (

                    <div className="max-w-md mx-auto mb-8 p-4 bg-red-50 border border-red-200 rounded-lg flex items-center text-red-700">

                        <AlertCircle className="h-5 w-5 mr-2 flex-shrink-0" />

                        {error}

                    </div>

                )}



                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">

                    {plans.map((plan) => (

                        <div

                            key={plan.id}

                            className={`relative bg-white rounded-2xl border-2 backdrop-blur-sm ${planBorders[plan.id]} transition-all duration-300 overflow-hidden hover:shadow-ocean-card hover:-translate-y-0.5 ${plan.id === 'pro' ? 'transform scale-[1.02]' : ''}`}

                        >

                            {plan.id === 'pro' && (

                                <div className="absolute top-0 left-0 right-0 bg-gradient-to-r from-ocean-sky to-ocean-navy text-white text-center py-1.5 text-sm font-semibold shadow-md">

                                    Most Popular

                                </div>

                            )}



                            <div className={`p-6 ${plan.id === 'pro' ? 'pt-10' : ''}`}>

                                <div className={`inline-flex items-center justify-center w-14 h-14 rounded-xl bg-gradient-to-r ${planColors[plan.id]} text-white mb-4`}>

                                    {planIcons[plan.id]}

                                </div>

                                <h3 className="text-xl font-bold text-ocean-navy mb-2">{plan.name}</h3>



                                <div className="mb-6">

                                    <span className="text-4xl font-bold text-ocean-navy">${plan.price}</span>

                                    <span className="text-ocean-deep">/month</span>

                                </div>



                                <ul className="space-y-3 mb-6">

                                    <FeatureItem included={true} text={`${formatFeatureValue(plan.features.maxAgents)} Agents`} />

                                    <FeatureItem included={true} text={`${formatFeatureValue(plan.features.maxDocuments)} Documents`} />

                                    <FeatureItem included={true} text={`${formatFeatureValue(plan.features.maxMessagesPerMonth)} Messages/mo`} />

                                    <FeatureItem included={true} text={`${formatFeatureValue(plan.features.maxKnowledgeSummaryChars ?? '-')} knowledge-summary characters / month`} />

                                    <FeatureItem included={plan.features.connectorsEnabled ?? false} text={`Alerts & notifications (up to ${formatSeatLabel(plan.features.maxConnectors)} destinations)`} />

                                    <FeatureItem included={true} text={workspaceSeatsLine(plan.id, plan.features.maxSeats)} />

                                    <FeatureItem included={true} text={`${plan.features.maxDocumentSizeMB}MB file size`} />

                                    <FeatureItem included={plan.features.voiceEnabled} text="Voice Agents" />

                                    <FeatureItem included={plan.features.analyticsEnabled} text="Analytics Dashboard" />

                                    <FeatureItem included={plan.features.prioritySupport} text="Priority Support" />

                                </ul>



                                <button

                                    onClick={() => canManageBilling && handleSelectPlan(plan.id)}

                                    disabled={selecting !== null || currentSubscription?.plan === plan.id || !canManageBilling}

                                    className={`w-full py-3.5 px-4 rounded-xl font-semibold transition-all duration-200 flex items-center justify-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ocean-sky focus-visible:ring-offset-2 ${

                                        currentSubscription?.plan === plan.id

                                            ? 'bg-emerald-50 text-emerald-800 border border-emerald-200 cursor-default'

                                            : plan.id === 'pro'

                                            ? 'bg-gradient-to-r from-ocean-sky to-ocean-navy text-white hover:brightness-105 shadow-ocean hover:shadow-xl hover:-translate-y-0.5'

                                            : plan.id === 'free'

                                            ? 'bg-ocean-powder text-ocean-navy border border-ocean-sky hover:bg-white hover:border-ocean-sky/50'

                                            : 'bg-ocean-navy text-white hover:bg-ocean-sky hover:shadow-ocean'

                                    } disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:translate-y-0`}

                                >

                                    {selecting === plan.id ? (

                                        <Loader className="h-5 w-5 animate-spin" />

                                    ) : currentSubscription?.plan === plan.id ? (

                                        <>

                                            <Check className="h-4 w-4 mr-2" />

                                            Current Plan

                                        </>

                                    ) : plan.price === 0 ? (

                                        currentSubscription ? 'Downgrade to Free' : 'Start Free'

                                    ) : currentSubscription && plans.findIndex(p => p.id === currentSubscription.plan) > plans.findIndex(p => p.id === plan.id) ? (

                                        'Downgrade'

                                    ) : (

                                        'Upgrade'

                                    )}

                                </button>

                            </div>

                        </div>

                    ))}

                </div>



                <div className="mt-16 text-center">

                    <p className="text-ocean-deep">

                        All paid plans include a 14-day free trial. Cancel anytime.

                    </p>

                    <p className="text-ocean-deep/80 text-sm mt-2">

                        Need a custom plan? <a href="mailto:sales@elva.ai" className="text-ocean-navy font-semibold underline-offset-2 hover:underline hover:text-ocean-sky transition-colors">Contact Sales</a>

                    </p>

                </div>

            </div>

        </AnimatedPage>

    );

}



function FeatureItem({ included, text }: { included: boolean; text: string }) {

    return (

        <li className={`flex items-center ${included ? 'text-ocean-navy/90' : 'text-ocean-deep'}`}>

            <span className={`flex-shrink-0 w-5 h-5 rounded-full flex items-center justify-center mr-3 ${

                included ? 'bg-emerald-500/15 text-emerald-700' : 'bg-ocean-powder text-ocean-deep'

            }`}>

                {included ? <Check className="h-3 w-3" /> : <span className="text-xs">-</span>}

            </span>

            <span className="text-sm">{text}</span>

        </li>

    );

}


