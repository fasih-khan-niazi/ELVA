import {
    ArrowRight,
    Mic,
    Shield,
    Zap,
    Check,
    Play,
    Sparkles,
    MessageSquare,
    Rocket,
    Building2,
    Crown,
    TrendingUp,
    FileUp,
    Cpu,
    Link2,
    LineChart,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';

const vp = { once: true, amount: 0.12 } as const;

const fadeUp = {
    hidden: { opacity: 0, y: 44 },
    visible: { opacity: 1, y: 0, transition: { duration: 0.72, ease: [0.22, 1, 0.36, 1] } },
};

const fadeUpFast = {
    hidden: { opacity: 0, y: 26 },
    visible: { opacity: 1, y: 0, transition: { duration: 0.52, ease: [0.22, 1, 0.36, 1] } },
};

const scaleIn = {
    hidden: { opacity: 0, scale: 0.86 },
    visible: { opacity: 1, scale: 1, transition: { type: 'spring' as const, stiffness: 200, damping: 22 } },
};

const stagger = {
    hidden: {},
    visible: { transition: { staggerChildren: 0.13, delayChildren: 0.05 } },
};

const staggerFast = {
    hidden: {},
    visible: { transition: { staggerChildren: 0.09 } },
};

interface Plan {
    id: string;
    name: string;
    price: number;
    features: {
        maxAgents: number | string;
        maxDocuments: number | string;
        maxMessagesPerMonth: number | string;
        maxDocumentSizeMB: number;
        voiceEnabled: boolean;
        analyticsEnabled: boolean;
        prioritySupport: boolean;
    };
}

const planIcons: Record<string, React.ReactNode> = {
    free: <Zap className="h-6 w-6" />,
    starter: <Rocket className="h-6 w-6" />,
    pro: <Building2 className="h-6 w-6" />,
    enterprise: <Crown className="h-6 w-6" />
};

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3000';



export default function Home() {
    const [plans, setPlans] = useState<Plan[]>([]);

    useEffect(() => {
        fetch(`${API_BASE}/api/subscription/plans`)
            .then(res => res.json())
            .then(data => setPlans(data))
            .catch(err => console.error('Error fetching plans:', err));
    }, []);

    return (
        <div className="bg-ocean-powder font-normal text-ocean-deep overflow-hidden">
            {/* Hero Section - Dark Theme with Rich Background */}
            <section className="relative pt-24 pb-32 bg-ocean-navy overflow-hidden min-h-[90vh] flex items-center">
                {/* Rich Dark Background */}
                <div className="absolute inset-0 z-0">
                    <div className="absolute inset-0 bg-gradient-to-br from-ocean-navy via-ocean-deep to-ocean-rich"></div>
                    <motion.div className="absolute top-20 left-1/4 w-96 h-96 bg-ocean-sky rounded-full mix-blend-multiply filter blur-[128px] opacity-20"
                        animate={{ x: [0,30,-20,0], y: [0,-50,20,0], scale: [1,1.1,0.9,1] }}
                        transition={{ duration: 7, repeat: Infinity, ease: 'easeInOut' }} />
                    <motion.div className="absolute bottom-20 right-1/4 w-96 h-96 bg-ocean-deep rounded-full mix-blend-soft-light filter blur-[128px] opacity-25"
                        animate={{ x: [0,-25,15,0], y: [0,40,-30,0], scale: [1,0.9,1.1,1] }}
                        transition={{ duration: 7, repeat: Infinity, ease: 'easeInOut', delay: 2 }} />
                    <motion.div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-80 h-80 bg-ocean-navy rounded-full mix-blend-overlay filter blur-[128px] opacity-20"
                        animate={{ scale: [1,1.15,0.95,1] }}
                        transition={{ duration: 7, repeat: Infinity, ease: 'easeInOut', delay: 4 }} />
                    <div className="absolute inset-0 opacity-[0.03] bg-[linear-gradient(rgba(255,255,255,0.1)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.1)_1px,transparent_1px)] bg-[size:60px_60px]"></div>
                    <div className="absolute inset-0 overflow-hidden">
                        {[...Array(16)].map((_, i) => (
                            <motion.div key={i}
                                className="absolute w-1 h-1 bg-white rounded-full opacity-20"
                                style={{ left: `${(i * 6.25) % 100}%`, top: `${(i * 13 + 7) % 100}%` }}
                                animate={{ y: [0, -22, 0], opacity: [0.15, 0.4, 0.15] }}
                                transition={{ duration: 8 + (i % 4) * 2, repeat: Infinity, ease: 'easeInOut', delay: i * 0.4 }} />
                        ))}
                    </div>
                    <div className="absolute bottom-0 left-0 right-0 h-32 bg-gradient-to-t from-ocean-navy to-transparent"></div>
                </div>

                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10 w-full">
                    <motion.div variants={stagger} initial="hidden" animate="visible" className="flex flex-col items-center">
                        <motion.h1 variants={fadeUp} className="text-center text-5xl md:text-6xl lg:text-7xl font-bold text-white tracking-tight mb-8 leading-tight">
                            <span className="block mb-2">Where Conversations</span>
                            <span className="text-transparent bg-clip-text bg-gradient-to-r from-cyan-300 via-white to-teal-200">
                                Become Intelligence
                            </span>
                        </motion.h1>

                        <motion.p variants={fadeUp} className="text-center text-lg md:text-xl text-slate-300 mb-12 max-w-3xl mx-auto leading-relaxed">
                            Deploy <span className="font-semibold text-ocean-sky">AI-powered chat and voice agents</span> in minutes. Upload your knowledge base and let <span className="font-bold text-white">ELVA</span> handle customer support 24/7.
                        </motion.p>

                        <motion.div variants={fadeUp} className="flex flex-col sm:flex-row gap-4 justify-center mb-16 w-full sm:w-auto">
                            <motion.div whileHover={{ scale: 1.04, y: -2 }} whileTap={{ scale: 0.97 }} transition={{ type: 'spring', stiffness: 400, damping: 20 }}>
                                <Link to="/login" className="inline-flex items-center justify-center px-8 py-4 text-base font-bold rounded-xl text-ocean-navy bg-ocean-sky hover:bg-white transition-colors duration-200 shadow-xl shadow-black/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80">
                                    Start Building Free
                                    <ArrowRight className="ml-2 h-5 w-5" />
                                </Link>
                            </motion.div>
                            <motion.div whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }} transition={{ type: 'spring', stiffness: 400, damping: 20 }}>
                                <Link to="/about" className="inline-flex items-center justify-center px-8 py-4 text-base font-semibold rounded-lg text-white bg-white/10 border border-white/20 hover:bg-white/20 backdrop-blur-sm transition-colors duration-200">
                                    <Play className="h-5 w-5 mr-2" />
                                    Watch Demo
                                </Link>
                            </motion.div>
                        </motion.div>

                        <motion.div variants={fadeUp} className="relative w-full max-w-6xl">
                            <motion.div variants={staggerFast} initial="hidden" animate="visible" className="grid md:grid-cols-3 gap-6">
                                {[
                                    { icon: <MessageSquare className="h-7 w-7 text-white" />, bg: 'bg-ocean-sky', title: 'Smart Conversations', desc: 'Natural language understanding that feels human. Your customers will love it.', stat: <><TrendingUp className="h-4 w-4" /><span>95% satisfaction rate</span></>, statColor: 'text-ocean-sky', border: 'hover:border-ocean-sky/50', glass: true },
                                    { icon: <Mic className="h-7 w-7 text-ocean-sky" />, bg: 'bg-white', title: 'Voice Agents', desc: 'Deploy voice-enabled AI agents that handle calls and respond naturally in real-time.', stat: <><Zap className="h-4 w-4" /><span>Real-time responses</span></>, statColor: 'text-white', border: '', glass: false },
                                    { icon: <FileUp className="h-7 w-7 text-white" />, bg: 'bg-emerald-600', title: 'Instant Training', desc: 'Upload documents, PDFs, or links. Your AI learns your business in seconds.', stat: <><Check className="h-4 w-4" /><span>No coding required</span></>, statColor: 'text-emerald-400', border: 'hover:border-emerald-400/50', glass: true },
                                ].map((card, i) => (
                                    <motion.div key={card.title} variants={fadeUpFast}
                                        whileHover={{ y: -8, scale: 1.02 }}
                                        transition={{ type: 'spring', stiffness: 320, damping: 22 }}
                                        className={`group relative rounded-2xl p-6 border overflow-hidden ${i === 1 ? 'bg-gradient-to-br from-ocean-sky to-sky-600 border-transparent shadow-xl shadow-ocean-sky/30 md:scale-[1.02]' : 'bg-white/10 backdrop-blur-md border-white/20'}`}>
                                        <div className={`absolute top-0 right-0 w-32 h-32 ${i === 1 ? 'bg-white' : i === 2 ? 'bg-emerald-500' : 'bg-ocean-sky'} rounded-full -translate-y-1/2 translate-x-1/2 opacity-10`}></div>
                                        <div className="relative">
                                            <div className={`w-14 h-14 rounded-xl ${card.bg} flex items-center justify-center mb-4 shadow-lg`}>
                                                {card.icon}
                                            </div>
                                            <h3 className="text-xl font-bold text-white mb-2">{card.title}</h3>
                                            <p className={`text-sm mb-4 ${i === 1 ? 'text-white/90' : 'text-slate-300'}`}>{card.desc}</p>
                                            <div className={`flex items-center gap-2 font-semibold text-sm ${card.statColor}`}>{card.stat}</div>
                                        </div>
                                        {i === 1 && (
                                            <div className="absolute bottom-4 right-4 flex items-end gap-1">
                                                {[3,5,4,6,3].map((h, j) => (
                                                    <motion.div key={j} className="w-1 bg-white/60 rounded-full"
                                                        animate={{ height: [`${h*4}px`, `${(h+2)*4}px`, `${h*4}px`] }}
                                                        transition={{ duration: 0.8, repeat: Infinity, delay: j * 0.15, ease: 'easeInOut' }} />
                                                ))}
                                            </div>
                                        )}
                                    </motion.div>
                                ))}
                            </motion.div>

                            <motion.div variants={fadeUp} className="mt-12 bg-white/5 backdrop-blur-md rounded-2xl p-6 sm:p-8 border border-white/10">
                                <p className="text-center text-sm font-semibold text-slate-400 mb-6 uppercase tracking-wider">Trusted by innovative teams worldwide</p>
                                <motion.div variants={staggerFast} initial="hidden" animate="visible" className="grid grid-cols-2 md:grid-cols-4 gap-6 sm:gap-8">
                                    {[['10M+','Messages Handled'],['500+','Companies'],['99.9%','Uptime'],['4.9★','User Rating']].map(([num,lbl]) => (
                                        <motion.div key={lbl} variants={scaleIn} className="text-center">
                                            <div className="text-2xl sm:text-3xl font-bold text-white">{num}</div>
                                            <div className="text-sm text-slate-400 mt-1">{lbl}</div>
                                        </motion.div>
                                    ))}
                                </motion.div>
                            </motion.div>
                        </motion.div>
                    </motion.div>
                </div>
            </section>

            {/* Features Section */}
            <section className="py-28 bg-white relative overflow-hidden">
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                    <motion.div variants={stagger} initial="hidden" whileInView="visible" viewport={vp}>
                        <motion.div variants={fadeUp} className="text-center mb-20">
                            <h2 className="text-4xl md:text-5xl font-bold text-slate-900 mb-6">
                                Built for the
                                <span className="relative mx-3">
                                    <span className="bg-gradient-to-r from-ocean-sky to-sky-600 bg-clip-text text-transparent">Modern</span>
                                    <svg className="absolute -bottom-2 left-0 w-full" height="8" viewBox="0 0 100 8" preserveAspectRatio="none">
                                        <path d="M0 7 Q50 0 100 7" stroke="url(#uGrad)" strokeWidth="3" fill="none"/>
                                        <defs><linearGradient id="uGrad" x1="0%" y1="0%" x2="100%" y2="0%"><stop offset="0%" stopColor="#7091E6"/><stop offset="100%" stopColor="#38BDF8"/></linearGradient></defs>
                                    </svg>
                                </span>
                                Enterprise
                            </h2>
                            <p className="text-xl text-slate-600 max-w-2xl mx-auto">Everything you need to transform customer interactions into meaningful experiences.</p>
                        </motion.div>

                        <div className="grid md:grid-cols-2 gap-8 max-w-5xl mx-auto">
                            {[
                                { icon: <MessageSquare className="h-8 w-8 text-white" />, iconBg: 'from-ocean-sky to-ocean-navy', title: 'Conversational AI', desc: 'Human-like conversations powered by advanced language models. Understands context, intent, and nuance.', tags: [['Context Aware','bg-ocean-powder text-ocean-navy'],['GPT-4 Powered','bg-ocean-powder text-ocean-navy']], orb: 'from-ocean-sky/50 to-ocean-powder' },
                                { icon: <Zap className="h-8 w-8 text-white" />, iconBg: 'from-amber-500 to-orange-500', title: 'Lightning Fast Setup', desc: 'Upload your documents and go live in minutes. Our RAG engine processes everything automatically.', tags: [['Auto Processing','bg-amber-50 text-amber-700'],['No Code','bg-amber-50 text-amber-700']], orb: 'from-amber-100 to-amber-50' },
                                { icon: <TrendingUp className="h-8 w-8 text-white" />, iconBg: 'from-emerald-500 to-teal-500', title: 'Smart Analytics', desc: 'Track conversations, measure satisfaction, and get actionable insights to improve your support.', tags: [['Real-time Stats','bg-emerald-50 text-emerald-700'],['Insights','bg-emerald-50 text-emerald-700']], orb: 'from-emerald-100 to-emerald-50' },
                                { icon: <Mic className="h-8 w-8 text-white" />, iconBg: 'from-sky-500 to-cyan-500', title: 'Voice & Text', desc: 'Seamlessly switch between voice and text. Natural speech recognition with real-time responses.', tags: [['Voice AI','bg-sky-50 text-sky-700'],['Real-time','bg-sky-50 text-sky-700']], orb: 'from-sky-100 to-sky-50' },
                            ].map((card) => (
                                <motion.div key={card.title} variants={fadeUpFast}
                                    whileHover={{ y: -10, scale: 1.015, boxShadow: '0 24px 48px -12px rgba(173,187,218,0.45)' }}
                                    transition={{ type: 'spring', stiffness: 320, damping: 22 }}
                                    className="group relative bg-white rounded-3xl p-8 shadow-lg shadow-slate-200/50 border border-slate-100 overflow-hidden cursor-default">
                                    <div className={`absolute top-0 right-0 w-32 h-32 bg-gradient-to-br ${card.orb} rounded-full -translate-y-1/2 translate-x-1/2 opacity-50`}></div>
                                    <div className="relative">
                                        <motion.div whileHover={{ scale: 1.12, rotate: 3 }} transition={{ type: 'spring', stiffness: 400 }}
                                            className={`w-16 h-16 rounded-2xl bg-gradient-to-br ${card.iconBg} flex items-center justify-center mb-6 shadow-lg`}>
                                            {card.icon}
                                        </motion.div>
                                        <h3 className="text-2xl font-bold text-slate-900 mb-3">{card.title}</h3>
                                        <p className="text-slate-600 mb-6 leading-relaxed">{card.desc}</p>
                                        <div className="flex flex-wrap gap-2">
                                            {card.tags.map(([t,cls]) => <span key={t} className={`px-3 py-1 ${cls} text-sm font-medium rounded-full`}>{t}</span>)}
                                        </div>
                                    </div>
                                </motion.div>
                            ))}
                        </div>

                        <motion.div variants={fadeUp} className="mt-20 flex flex-wrap justify-center gap-10 sm:gap-20">
                            {[['90%','Uptime SLA'],['<3s','Response Time'],['10K+','Queries Handled'],['24/7','Availability']].map(([n,l]) => (
                                <motion.div key={l} variants={scaleIn} className="text-center">
                                    <div className="text-4xl font-bold bg-gradient-to-r from-ocean-navy to-ocean-deep bg-clip-text text-transparent">{n}</div>
                                    <div className="text-ocean-deep/80 mt-1 font-normal text-sm">{l}</div>
                                </motion.div>
                            ))}
                        </motion.div>
                    </motion.div>
                </div>
            </section>

            {/* AI SaaS platform strip */}
            <section className="relative border-y border-ocean-sky/25 bg-white py-20">
                <div className="relative mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
                    <motion.div variants={stagger} initial="hidden" whileInView="visible" viewport={vp}>
                        <motion.div variants={fadeUp} className="mx-auto max-w-3xl text-center">
                            <h2 className="text-4xl font-bold tracking-tight text-ocean-navy md:text-[2.75rem]">
                                Everything an AI ops team expects
                            </h2>
                            <p className="mt-5 text-lg font-normal text-ocean-deep leading-relaxed">
                                Multi-tenant workspaces, knowledge ingestion, voice and chat channels, Stripe-backed plans, alerts and notifications, and observability - stitched into one console so your team ships faster and customers get answers sooner.
                            </p>
                        </motion.div>
                        <div className="mt-16 grid gap-8 md:grid-cols-3">
                            {[
                                { icon: Cpu, title: 'Composable agents', body: 'Separate chat and voice agents with shared knowledge, per-agent analytics, and guarded tools so your team can iterate without redeploying infra.' },
                                { icon: Link2, title: 'Alerts, notifications & workflows', body: 'Wire CRMs, commerce, and alerting so automations feel native. Built for teams who outgrow static FAQ widgets.' },
                                { icon: LineChart, title: 'Usage you can bill', body: 'Message caps, document limits, agent seats, and Stripe subscription state surface where you create - no surprise overages.' },
                            ].map(({ icon: Icon, title, body }) => (
                                <motion.article key={title} variants={fadeUpFast}
                                    whileHover={{ y: -8, scale: 1.015, boxShadow: '0 16px 40px -8px rgba(112,145,230,0.18)' }}
                                    transition={{ type: 'spring', stiffness: 320, damping: 22 }}
                                    className="group relative overflow-hidden rounded-3xl border border-ocean-sky/30 bg-white p-8 shadow-ocean-sm cursor-default">
                                    <motion.div whileHover={{ scale: 1.1, rotate: -4 }} transition={{ type: 'spring', stiffness: 400 }}
                                        className="mb-6 inline-flex rounded-2xl bg-ocean-navy/[0.07] p-4 text-ocean-navy">
                                        <Icon className="h-8 w-8" strokeWidth={1.75} aria-hidden />
                                    </motion.div>
                                    <h3 className="text-xl font-bold text-ocean-navy">{title}</h3>
                                    <p className="mt-4 font-normal leading-relaxed text-ocean-deep">{body}</p>
                                </motion.article>
                            ))}
                        </div>
                    </motion.div>
                </div>
            </section>

            {/* Why ELVA Section */}
            <section className="py-28 bg-ocean-navy relative overflow-hidden">
                <div className="absolute inset-0">
                    <motion.div className="absolute top-0 left-1/4 w-96 h-96 bg-ocean-sky rounded-full mix-blend-multiply filter blur-[128px] opacity-20"
                        animate={{ x: [0,25,-18,0], y: [0,-40,18,0] }} transition={{ duration: 8, repeat: Infinity, ease: 'easeInOut' }} />
                    <motion.div className="absolute bottom-0 right-1/4 w-96 h-96 bg-ocean-deep rounded-full mix-blend-soft-light filter blur-[128px] opacity-25"
                        animate={{ x: [0,-20,15,0], y: [0,35,-22,0] }} transition={{ duration: 8, repeat: Infinity, ease: 'easeInOut', delay: 2.5 }} />
                </div>
                <div className="absolute inset-0 opacity-5 bg-[linear-gradient(rgba(255,255,255,.1)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.1)_1px,transparent_1px)] bg-[size:50px_50px]"></div>

                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
                    <motion.div variants={stagger} initial="hidden" whileInView="visible" viewport={vp}>
                        <motion.div variants={fadeUp} className="text-center mb-20">
                            <h2 className="text-5xl md:text-6xl font-bold text-white mb-6">
                                The Future of
                                <span className="block mt-2 bg-gradient-to-r from-ocean-sky via-white to-ocean-deep/90 bg-clip-text text-transparent">Customer Support</span>
                            </h2>
                            <p className="text-xl text-slate-400 max-w-2xl mx-auto">Experience the power of AI that truly understands your business</p>
                        </motion.div>

                        <div className="grid md:grid-cols-3 gap-6">
                            <motion.div variants={fadeUpFast}
                                whileHover={{ scale: 1.02 }} transition={{ type: 'spring', stiffness: 280, damping: 22 }}
                                className="md:col-span-2 relative bg-gradient-to-br from-ocean-sky to-ocean-navy rounded-3xl p-8 overflow-hidden cursor-default">
                                <div className="absolute top-0 right-0 w-64 h-64 bg-white/10 rounded-full filter blur-3xl translate-x-20 -translate-y-20"></div>
                                <div className="relative z-10">
                                    <div className="flex items-center gap-4 mb-6">
                                        <div className="w-14 h-14 bg-white/20 backdrop-blur rounded-2xl flex items-center justify-center">
                                            <Zap className="h-7 w-7 text-white" />
                                        </div>
                                        <span className="text-white/80 text-sm font-medium px-3 py-1 bg-white/10 rounded-full">Lightning Fast</span>
                                    </div>
                                    <h3 className="text-3xl font-bold text-white mb-4">Instant AI Training</h3>
                                    <p className="text-white/90 text-lg mb-8 max-w-md">Upload your documents and watch your AI agent learn everything in seconds. No waiting, no complex setup.</p>
                                    <div className="flex items-center gap-6">
                                        <div className="text-center"><div className="text-4xl font-bold text-white">{"<"}30s</div><div className="text-ocean-sky text-sm">Training Time</div></div>
                                        <div className="w-px h-12 bg-white/20"></div>
                                        <div className="text-center"><div className="text-4xl font-bold text-white">100+</div><div className="text-ocean-sky text-sm">File Formats</div></div>
                                    </div>
                                </div>
                            </motion.div>

                            <div className="space-y-6">
                                {[
                                    { icon: <Shield className="h-6 w-6 text-sky-400" />, bg: 'bg-sky-500/20', title: 'Enterprise Security', desc: 'SOC2 compliant with end-to-end encryption. Your data stays yours.', hover: 'hover:border-sky-500/50' },
                                    { icon: <TrendingUp className="h-6 w-6 text-emerald-400" />, bg: 'bg-emerald-500/20', title: 'Scale Infinitely', desc: 'Handle 1 or 1 million conversations. Auto-scaling infrastructure.', hover: 'hover:border-emerald-500/50' },
                                ].map((c) => (
                                    <motion.div key={c.title} variants={fadeUpFast}
                                        whileHover={{ x: 4, scale: 1.02 }} transition={{ type: 'spring', stiffness: 340, damping: 22 }}
                                        className={`bg-slate-800/50 backdrop-blur border border-slate-700/50 rounded-3xl p-6 ${c.hover} cursor-default`}>
                                        <motion.div whileHover={{ scale: 1.12 }} transition={{ type: 'spring', stiffness: 400 }}
                                            className={`w-12 h-12 ${c.bg} rounded-xl flex items-center justify-center mb-4`}>{c.icon}</motion.div>
                                        <h4 className="text-xl font-bold text-white mb-2">{c.title}</h4>
                                        <p className="text-slate-400">{c.desc}</p>
                                    </motion.div>
                                ))}
                            </div>

                            {[
                                { icon: <Mic className="h-6 w-6 text-ocean-sky" />, bg: 'bg-ocean-sky/20', title: 'Voice AI', desc: 'Natural voice conversations with your AI agent. Sounds human, works 24/7.', hover: 'hover:border-ocean-sky/50', badge: 'NEW' },
                                { icon: <MessageSquare className="h-6 w-6 text-amber-400" />, bg: 'bg-amber-500/20', title: 'Smart Context', desc: 'Remembers conversation history and understands nuanced queries.', hover: 'hover:border-amber-500/50', badge: null },
                                { icon: <Rocket className="h-6 w-6 text-cyan-400" />, bg: 'bg-cyan-500/20', title: 'Quick Deploy', desc: 'Go live in minutes. Embed anywhere with a single line of code.', hover: 'hover:border-cyan-500/50', badge: null },
                            ].map((c) => (
                                <motion.div key={c.title} variants={fadeUpFast}
                                    whileHover={{ y: -6, scale: 1.02 }} transition={{ type: 'spring', stiffness: 320, damping: 22 }}
                                    className={`bg-gradient-to-br from-slate-800 to-slate-900 border border-slate-700/50 rounded-3xl p-6 ${c.hover} transition-colors cursor-default`}>
                                    <div className="flex items-start justify-between mb-4">
                                        <motion.div whileHover={{ scale: 1.12 }} transition={{ type: 'spring', stiffness: 400 }}
                                            className={`w-12 h-12 ${c.bg} rounded-xl flex items-center justify-center`}>{c.icon}</motion.div>
                                        {c.badge && <span className="text-xs font-medium px-2 py-1 bg-ocean-sky/20 text-ocean-sky rounded-full">{c.badge}</span>}
                                    </div>
                                    <h4 className="text-xl font-bold text-white mb-2">{c.title}</h4>
                                    <p className="text-slate-400">{c.desc}</p>
                                </motion.div>
                            ))}
                        </div>

                        <motion.div variants={fadeUp} className="mt-16 text-center">
                            <motion.div whileHover={{ scale: 1.04, y: -2 }} whileTap={{ scale: 0.97 }} transition={{ type: 'spring', stiffness: 380, damping: 22 }} className="inline-block">
                                <Link to="/login" className="inline-flex items-center gap-3 px-8 py-4 bg-white text-slate-900 font-semibold rounded-xl hover:bg-slate-100 transition-colors shadow-2xl shadow-white/10">
                                    Start Building for Free
                                    <ArrowRight className="h-5 w-5" />
                                </Link>
                            </motion.div>
                        </motion.div>
                    </motion.div>
                </div>
            </section>

            {/* Industry Solutions */}
            <section className="py-32 bg-white relative overflow-hidden">
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
                    <motion.div variants={stagger} initial="hidden" whileInView="visible" viewport={vp}>
                    {/* Header */}
                    <motion.div variants={fadeUp} className="text-center mb-20">
                        <h2 className="text-5xl md:text-7xl font-bold mb-6">
                            <span className="text-slate-900">Transforming </span>
                            <span className="bg-gradient-to-r from-ocean-sky via-sky-600 to-cyan-600 bg-clip-text text-transparent">Industries</span>
                        </h2>
                        <p className="text-xl text-slate-600 max-w-2xl mx-auto">
                            Powering meaningful conversations across every sector with AI that understands your business.
                        </p>
                    </motion.div>

                    {/* Industry Cards - Equal Size */}
                    <motion.div variants={staggerFast} initial="hidden" whileInView="visible" viewport={vp} className="grid lg:grid-cols-3 gap-8">
                        {/* E-Commerce Card */}
                        <motion.div variants={fadeUpFast} className="group relative h-full">
                            <div className="absolute inset-0 bg-gradient-to-br from-blue-500 to-ocean-sky rounded-3xl blur-xl opacity-0 group-hover:opacity-20 transition-opacity duration-500"></div>
                            <div className="relative h-full bg-white p-8 rounded-3xl border-2 border-slate-100 hover:border-ocean-sky transition-all duration-500 transform hover:-translate-y-2 hover:shadow-2xl hover:shadow-[0_24px_48px_-12px_rgba(173,187,218,0.45)] overflow-hidden flex flex-col">
                                {/* Decorative gradient corner */}
                                <div className="absolute top-0 right-0 w-32 h-32 bg-gradient-to-br from-blue-100 to-transparent rounded-full -translate-y-1/2 translate-x-1/2"></div>
                                
                                <div className="relative z-10 flex flex-col h-full">
                                    <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-blue-500 to-ocean-sky flex items-center justify-center mb-5 shadow-lg shadow-blue-200">
                                        <svg className="w-7 h-7 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z" />
                                        </svg>
                                    </div>
                                    
                                    <h3 className="text-xl font-bold text-slate-900 mb-2">E-Commerce</h3>
                                    <p className="text-slate-500 mb-5 text-sm leading-relaxed flex-grow">Transform shopping experiences with AI that handles inquiries and drives sales 24/7</p>
                                    
                                    <div className="space-y-2.5 mb-6">
                                        <div className="flex items-center gap-2.5 text-slate-700">
                                            <div className="w-5 h-5 rounded-full bg-blue-100 flex items-center justify-center">
                                                <Check className="w-3 h-3 text-blue-600" />
                                            </div>
                                            <span className="text-sm">Smart Recommendations</span>
                                        </div>
                                        <div className="flex items-center gap-2.5 text-slate-700">
                                            <div className="w-5 h-5 rounded-full bg-blue-100 flex items-center justify-center">
                                                <Check className="w-3 h-3 text-blue-600" />
                                            </div>
                                            <span className="text-sm">Real-time Order Tracking</span>
                                        </div>
                                        <div className="flex items-center gap-2.5 text-slate-700">
                                            <div className="w-5 h-5 rounded-full bg-blue-100 flex items-center justify-center">
                                                <Check className="w-3 h-3 text-blue-600" />
                                            </div>
                                            <span className="text-sm">Automated Returns</span>
                                        </div>
                                    </div>
                                    
                                    {/* Stats */}
                                    <div className="pt-5 border-t border-slate-100 flex items-center justify-between mt-auto">
                                        <div>
                                            <div className="text-xl font-bold text-slate-900">40%</div>
                                            <div className="text-xs text-slate-400 uppercase tracking-wide">Cart Recovery</div>
                                        </div>
                                        <div className="w-px h-8 bg-slate-200"></div>
                                        <div>
                                            <div className="text-xl font-bold text-slate-900">3x</div>
                                            <div className="text-xs text-slate-400 uppercase tracking-wide">Faster Support</div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </motion.div>

                        {/* SaaS Card */}
                        <motion.div variants={fadeUpFast} className="group relative h-full">
                            <div className="absolute inset-0 bg-gradient-to-br from-ocean-sky to-sky-500 rounded-3xl blur-xl opacity-0 group-hover:opacity-20 transition-opacity duration-500"></div>
                            <div className="relative h-full bg-white p-8 rounded-3xl border-2 border-slate-100 hover:border-sky-200 transition-all duration-500 transform hover:-translate-y-2 hover:shadow-2xl hover:shadow-sky-200/30 overflow-hidden flex flex-col">
                                {/* Featured badge */}
                                <div className="absolute top-4 right-4">
                                    <span className="px-3 py-1 bg-gradient-to-r from-ocean-sky to-sky-500 rounded-full text-white text-xs font-semibold shadow-sm">Popular</span>
                                </div>
                                
                                {/* Decorative gradient corner */}
                                <div className="absolute top-0 right-0 w-32 h-32 bg-gradient-to-br from-ocean-sky/50 to-transparent rounded-full -translate-y-1/2 translate-x-1/2"></div>
                                
                                <div className="relative z-10 flex flex-col h-full">
                                    <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-ocean-sky to-sky-600 flex items-center justify-center mb-5 shadow-lg shadow-ocean">
                                        <Rocket className="w-7 h-7 text-white" />
                                    </div>
                                    
                                    <h3 className="text-xl font-bold text-slate-900 mb-2">SaaS Companies</h3>
                                    <p className="text-slate-500 mb-5 text-sm leading-relaxed flex-grow">Accelerate growth with intelligent onboarding and instant tech support</p>
                                    
                                    <div className="space-y-2.5 mb-6">
                                        <div className="flex items-center gap-2.5 text-slate-700">
                                            <div className="w-5 h-5 rounded-full bg-ocean-sky/50 flex items-center justify-center">
                                                <Check className="w-3 h-3 text-ocean-sky" />
                                            </div>
                                            <span className="text-sm">Automated Onboarding</span>
                                        </div>
                                        <div className="flex items-center gap-2.5 text-slate-700">
                                            <div className="w-5 h-5 rounded-full bg-ocean-sky/50 flex items-center justify-center">
                                                <Check className="w-3 h-3 text-ocean-sky" />
                                            </div>
                                            <span className="text-sm">24/7 Technical Support</span>
                                        </div>
                                        <div className="flex items-center gap-2.5 text-slate-700">
                                            <div className="w-5 h-5 rounded-full bg-ocean-sky/50 flex items-center justify-center">
                                                <Check className="w-3 h-3 text-ocean-sky" />
                                            </div>
                                            <span className="text-sm">Feature Discovery</span>
                                        </div>
                                    </div>
                                    
                                    {/* Stats */}
                                    <div className="pt-5 border-t border-slate-100 flex items-center justify-between mt-auto">
                                        <div>
                                            <div className="text-xl font-bold text-slate-900">60%</div>
                                            <div className="text-xs text-slate-400 uppercase tracking-wide">Faster Onboard</div>
                                        </div>
                                        <div className="w-px h-8 bg-slate-200"></div>
                                        <div>
                                            <div className="text-xl font-bold text-slate-900">85%</div>
                                            <div className="text-xs text-slate-400 uppercase tracking-wide">Self-Service</div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </motion.div>

                        {/* Restaurant & Food Card */}
                        <motion.div variants={fadeUpFast} className="group relative h-full">
                            <div className="absolute inset-0 bg-gradient-to-br from-orange-500 to-amber-500 rounded-3xl blur-xl opacity-0 group-hover:opacity-20 transition-opacity duration-500"></div>
                            <div className="relative h-full bg-white p-8 rounded-3xl border-2 border-slate-100 hover:border-orange-200 transition-all duration-500 transform hover:-translate-y-2 hover:shadow-2xl hover:shadow-orange-200/30 overflow-hidden flex flex-col">
                                {/* Decorative gradient corner */}
                                <div className="absolute top-0 right-0 w-32 h-32 bg-gradient-to-br from-orange-100 to-transparent rounded-full -translate-y-1/2 translate-x-1/2"></div>
                                
                                <div className="relative z-10 flex flex-col h-full">
                                    <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-orange-500 to-amber-600 flex items-center justify-center mb-5 shadow-lg shadow-orange-200">
                                        <svg className="w-7 h-7 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                                        </svg>
                                    </div>
                                    
                                    <h3 className="text-xl font-bold text-slate-900 mb-2">Restaurant & Food</h3>
                                    <p className="text-slate-500 mb-5 text-sm leading-relaxed flex-grow">Streamline orders, reservations, and customer service for dining excellence</p>
                                    
                                    <div className="space-y-2.5 mb-6">
                                        <div className="flex items-center gap-2.5 text-slate-700">
                                            <div className="w-5 h-5 rounded-full bg-orange-100 flex items-center justify-center">
                                                <Check className="w-3 h-3 text-orange-600" />
                                            </div>
                                            <span className="text-sm">Order Management</span>
                                        </div>
                                        <div className="flex items-center gap-2.5 text-slate-700">
                                            <div className="w-5 h-5 rounded-full bg-orange-100 flex items-center justify-center">
                                                <Check className="w-3 h-3 text-orange-600" />
                                            </div>
                                            <span className="text-sm">Table Reservations</span>
                                        </div>
                                        <div className="flex items-center gap-2.5 text-slate-700">
                                            <div className="w-5 h-5 rounded-full bg-orange-100 flex items-center justify-center">
                                                <Check className="w-3 h-3 text-orange-600" />
                                            </div>
                                            <span className="text-sm">Menu Inquiries</span>
                                        </div>
                                    </div>
                                    
                                    {/* Stats */}
                                    <div className="pt-5 border-t border-slate-100 flex items-center justify-between mt-auto">
                                        <div>
                                            <div className="text-xl font-bold text-slate-900">35%</div>
                                            <div className="text-xs text-slate-400 uppercase tracking-wide">More Orders</div>
                                        </div>
                                        <div className="w-px h-8 bg-slate-200"></div>
                                        <div>
                                            <div className="text-xl font-bold text-slate-900">2min</div>
                                            <div className="text-xs text-slate-400 uppercase tracking-wide">Avg Response</div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </motion.div>
                    </motion.div>

                    <motion.div variants={fadeUp} className="mt-16 text-center">
                        <motion.div whileHover={{ scale: 1.04, y: -2 }} whileTap={{ scale: 0.97 }} transition={{ type: 'spring', stiffness: 380, damping: 22 }} className="inline-block">
                            <Link to="/login" className="inline-flex items-center gap-3 px-8 py-4 bg-gradient-to-r from-ocean-sky to-sky-600 text-white font-semibold rounded-2xl shadow-lg shadow-ocean-sky/30">
                                <span>Explore Your Industry Solution</span>
                                <ArrowRight className="h-5 w-5" />
                            </Link>
                        </motion.div>
                    </motion.div>
                    </motion.div>
                </div>
            </section>

            {/* Stats Section */}
            <section className="py-20 bg-ocean-navy text-white relative overflow-hidden">
                <motion.div className="absolute top-1/4 right-1/4 w-96 h-96 bg-ocean-navy rounded-full mix-blend-multiply filter blur-3xl opacity-20"
                    animate={{ scale: [1, 1.15, 0.95, 1] }} transition={{ duration: 8, repeat: Infinity, ease: 'easeInOut' }} />
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
                    <motion.div variants={stagger} initial="hidden" whileInView="visible" viewport={vp} className="grid grid-cols-2 md:grid-cols-4 gap-8">
                        {[['10M+','Messages Processed'],['50K+','Active Users'],['99.9%','Uptime SLA'],['100+','Enterprise Clients']].map(([n,l]) => (
                            <motion.div key={l} variants={scaleIn} className="text-center">
                                <div className="text-4xl font-bold text-ocean-sky mb-2 drop-shadow-sm">{n}</div>
                                <p className="text-ocean-sky font-semibold">{l}</p>
                            </motion.div>
                        ))}
                    </motion.div>
                </div>
            </section>

            {/* Pricing Section */}
            <section className="py-28 bg-white relative overflow-hidden">
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
                    <motion.div variants={stagger} initial="hidden" whileInView="visible" viewport={vp}>
                        <motion.div variants={fadeUp} className="text-center mb-20">
                            <h2 className="text-5xl md:text-6xl font-bold mb-6 text-slate-900">
                                Choose Your
                                <span className="block mt-2 bg-gradient-to-r from-ocean-sky via-sky-600 to-ocean-sky bg-clip-text text-transparent">Perfect Plan</span>
                            </h2>
                            <p className="text-xl text-slate-600 max-w-2xl mx-auto">Start free and scale as you grow. No hidden fees, cancel anytime.</p>
                        </motion.div>
                        <motion.div variants={staggerFast} initial="hidden" whileInView="visible" viewport={vp} className="grid md:grid-cols-4 gap-6">
                            {plans.map((plan) => (
                                <motion.div key={plan.id} variants={fadeUpFast}
                                    whileHover={{ y: -10, scale: 1.02 }} transition={{ type: 'spring', stiffness: 300, damping: 22 }}>
                                    <DynamicPricingCard plan={plan} highlight={plan.id === 'pro'} />
                                </motion.div>
                            ))}
                        </motion.div>
                    </motion.div>
                </div>
            </section>

            {/* CTA Section */}
            <section className="py-24 bg-ocean-sky text-white relative overflow-hidden">
                <div className="absolute inset-0 bg-gradient-to-b from-ocean-sky to-ocean-navy"></div>
                <motion.div className="absolute top-1/4 -left-40 w-80 h-80 bg-white/5 rounded-full filter blur-3xl"
                    animate={{ scale: [1, 1.2, 0.9, 1] }} transition={{ duration: 8, repeat: Infinity, ease: 'easeInOut' }} />
                <motion.div variants={stagger} initial="hidden" whileInView="visible" viewport={vp} className="max-w-4xl mx-auto text-center px-4 relative z-10">
                    <motion.h2 variants={fadeUp} className="text-4xl sm:text-5xl font-bold mb-6">Ready to transform your customer support?</motion.h2>
                    <motion.p variants={fadeUp} className="text-xl text-white/90 mb-10">Join thousands of businesses using ELVA to deliver exceptional support.</motion.p>
                    <motion.div variants={fadeUp} className="flex flex-col sm:flex-row gap-4 justify-center">
                        <motion.div whileHover={{ scale: 1.04, y: -2 }} whileTap={{ scale: 0.97 }} transition={{ type: 'spring', stiffness: 380, damping: 20 }}>
                            <Link to="/login" className="inline-flex items-center justify-center px-10 py-4 text-base font-semibold rounded-lg text-ocean-sky bg-white hover:bg-slate-50 transition-colors shadow-lg">
                                Start Free Trial
                                <ArrowRight className="ml-2 h-5 w-5" />
                            </Link>
                        </motion.div>
                        <motion.div whileHover={{ scale: 1.04, y: -2 }} whileTap={{ scale: 0.97 }} transition={{ type: 'spring', stiffness: 380, damping: 20 }}>
                            <Link to="/about" className="inline-flex items-center justify-center px-10 py-4 text-base font-semibold rounded-xl text-white bg-ocean-navy hover:bg-ocean-navy/80 transition-colors border border-white/20">
                                <Play className="mr-2 h-5 w-5" />
                                Watch Demo
                            </Link>
                        </motion.div>
                    </motion.div>
                </motion.div>
            </section>

            {/* Footer - Solid Dark */}
            <footer className="bg-ocean-navy text-slate-200 pt-20 pb-8 border-t border-white/10">
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                    <div className="grid md:grid-cols-5 gap-8 mb-12">
                        <div>
                            <span className="font-bold text-2xl text-white flex items-center gap-2 mb-4">
                                <div className="bg-ocean-sky p-2 rounded-lg">
                                    <Mic className="h-5 w-5 text-white" />
                                </div>
                                ELVA
                            </span>
                            <p className="text-slate-400 text-sm">Empowering businesses with intelligent AI agents.</p>
                        </div>
                        <div>
                            <h4 className="font-bold text-white mb-4">Product</h4>
                            <ul className="space-y-2 text-sm">
                                <li><a href="#" className="text-slate-400 hover:text-white transition">Features</a></li>
                                <li><a href="#" className="text-slate-400 hover:text-white transition">Pricing</a></li>
                                <li><a href="#" className="text-slate-400 hover:text-white transition">API</a></li>
                            </ul>
                        </div>
                        <div>
                            <h4 className="font-bold text-white mb-4">Company</h4>
                            <ul className="space-y-2 text-sm">
                                <li><Link to="/about" className="text-slate-400 hover:text-white transition">About</Link></li>
                                <li><a href="#" className="text-slate-400 hover:text-white transition">Blog</a></li>
                                <li><a href="#" className="text-slate-400 hover:text-white transition">Contact</a></li>
                            </ul>
                        </div>
                        <div>
                            <h4 className="font-bold text-white mb-4">Legal</h4>
                            <ul className="space-y-2 text-sm">
                                <li><a href="#" className="text-slate-400 hover:text-white transition">Privacy</a></li>
                                <li><a href="#" className="text-slate-400 hover:text-white transition">Terms</a></li>
                            </ul>
                        </div>
                        <div>
                            <h4 className="font-bold text-white mb-4">Newsletter</h4>
                            <div className="flex gap-2">
                                <input type="email" placeholder="your@email.com" className="flex-1 px-3 py-2 rounded bg-slate-800 text-white placeholder-slate-500 text-sm focus:outline-none focus:ring-2 focus:ring-ocean-sky" />
                                <button className="px-3 py-2 bg-ocean-sky text-white rounded font-semibold hover:bg-ocean-navy">→</button>
                            </div>
                        </div>
                    </div>
                    <div className="border-t border-slate-800 pt-8 text-center text-sm text-slate-400">
                        © {new Date().getFullYear()} ELVA Inc. All rights reserved.
                    </div>
                </div>
            </footer>

        </div>
    );
}

function StatCard({ number, label }: { number: string; label: string }) {
    return (
        <div className="text-center">
            <div className="text-4xl font-bold text-ocean-sky mb-2 drop-shadow-sm">{number}</div>
            <p className="text-ocean-sky font-semibold">{label}</p>
        </div>
    );
}

function DynamicPricingCard({ plan, highlight = false }: { plan: Plan; highlight?: boolean }) {
    const formatValue = (value: number | string): string => {
        if (value === -1 || value === 'Unlimited') return 'Unlimited';
        if (typeof value === 'number') return value.toLocaleString();
        return value;
    };

    const features = [
        `${formatValue(plan.features.maxAgents)} Agent${plan.features.maxAgents !== 1 ? 's' : ''}`,
        `${formatValue(plan.features.maxDocuments)} Document${plan.features.maxDocuments !== 1 ? 's' : ''}`,
        `${formatValue(plan.features.maxMessagesPerMonth)} Messages/mo`,
        `${plan.features.maxDocumentSizeMB}MB max file size`,
        plan.features.voiceEnabled ? 'Voice Agents Enabled' : null,
        plan.features.analyticsEnabled ? 'Analytics Dashboard' : null,
        plan.features.prioritySupport ? 'Priority Support' : null,
    ].filter(Boolean) as string[];

    return (
        <div className={`group relative p-8 rounded-3xl transition-all duration-500 transform hover:-translate-y-3 ${highlight ? 'bg-gradient-to-br from-ocean-sky via-sky-600 to-ocean-navy shadow-2xl shadow-[0_20px_50px_-8px_rgba(61,82,160,0.4)] scale-[1.02] z-10' : 'bg-gradient-to-br from-slate-50 to-ocean-powder border-2 border-ocean-sky/60 shadow-xl shadow-ocean-sm hover:border-ocean-sky hover:shadow-ocean-card'}`}>
            {/* Popular Badge */}
            {highlight && (
                <div className="absolute -top-4 left-1/2 -translate-x-1/2">
                    <span className="px-4 py-1.5 bg-gradient-to-r from-amber-400 to-orange-400 text-white text-xs font-bold rounded-full shadow-lg shadow-amber-400/30 uppercase tracking-wide">
                        Most Popular
                    </span>
                </div>
            )}
            
            {/* Decorative Corner for all cards */}
            <div className={`absolute top-0 right-0 w-32 h-32 rounded-full -translate-y-1/2 translate-x-1/2 blur-2xl ${highlight ? 'bg-white/10' : 'bg-ocean-sky/30'}`}></div>
            
            <div className={`w-12 h-12 rounded-2xl flex items-center justify-center mb-6 ${highlight ? 'bg-white/20 text-white' : 'bg-gradient-to-br from-ocean-sky to-sky-500 text-white shadow-lg shadow-ocean'}`}>
                {planIcons[plan.id] || <Zap className="h-6 w-6" />}
            </div>

            <h3 className={`text-2xl font-bold mb-2 capitalize ${highlight ? 'text-white' : 'text-slate-800'}`}>{plan.name}</h3>
            <div className={`mb-6 ${highlight ? 'text-white' : 'text-slate-800'}`}>
                <span className="text-5xl font-bold">{plan.price === 0 ? 'Free' : `$${plan.price}`}</span>
                {plan.price > 0 && <span className={`text-base font-normal ${highlight ? 'text-ocean-sky' : 'text-slate-500'}`}>/month</span>}
            </div>
            
            <div className={`w-full h-px mb-6 ${highlight ? 'bg-white/20' : 'bg-slate-200'}`}></div>
            
            <ul className="space-y-4 mb-8">
                {features.map((f, i) => (
                    <li key={i} className={`flex items-center text-sm ${highlight ? 'text-white/90' : 'text-slate-600'}`}>
                        <div className={`mr-3 flex-shrink-0 w-5 h-5 rounded-full flex items-center justify-center ${highlight ? 'bg-white/20' : 'bg-ocean-sky/50'}`}>
                            <Check className={`h-3 w-3 ${highlight ? 'text-white' : 'text-ocean-navy'}`} />
                        </div>
                        <span className="font-medium">{f}</span>
                    </li>
                ))}
            </ul>
            <Link 
                to="/login"
                className={`block w-full py-4 rounded-xl font-semibold text-center transition-all duration-300 hover:scale-[1.02] ${highlight ? 'bg-white text-ocean-navy hover:bg-ocean-powder shadow-lg shadow-black/10' : 'bg-gradient-to-r from-ocean-sky to-ocean-navy hover:brightness-105 text-white shadow-ocean focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40'}`}
            >
                {plan.price === 0 ? 'Start Free' : 'Get Started'}
            </Link>
        </div>
    );
}
