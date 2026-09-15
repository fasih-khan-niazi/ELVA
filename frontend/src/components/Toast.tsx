import hotToast, { type Toast } from 'react-hot-toast';
import { motion } from 'framer-motion';
import { CheckCircle2, XCircle, AlertTriangle, Info, X } from 'lucide-react';
import { motionTransition } from '@/lib/motion';

// ─── Durations ────────────────────────────────────────────────────────────────

const STANDARD_DURATION = 3000;
const WELCOME_DURATION = 4000;

// ─── Custom toast card rendered inside react-hot-toast's container ────────────

type ToastType = 'success' | 'error' | 'warning' | 'info';

interface ToastConfig {
    iconColor: string;
    iconBg: string;
    border: string;
    titleColor: string;
    messageColor: string;
    bg: string;
    dismissHover: string;
    Icon: React.ElementType;
}

const CONFIGS: Record<ToastType, ToastConfig> = {
    success: {
        Icon: CheckCircle2,
        iconColor: 'text-emerald-600',
        iconBg: 'bg-emerald-100',
        border: 'border-emerald-300',
        bg: 'bg-emerald-50',
        titleColor: 'text-emerald-950',
        messageColor: 'text-emerald-800/80',
        dismissHover: 'hover:text-emerald-700 hover:bg-emerald-100',
    },
    error: {
        Icon: XCircle,
        iconColor: 'text-red-600',
        iconBg: 'bg-red-100',
        border: 'border-red-300',
        bg: 'bg-red-50',
        titleColor: 'text-red-950',
        messageColor: 'text-red-800/80',
        dismissHover: 'hover:text-red-700 hover:bg-red-100',
    },
    warning: {
        Icon: AlertTriangle,
        iconColor: 'text-amber-600',
        iconBg: 'bg-amber-100',
        border: 'border-amber-300',
        bg: 'bg-amber-50',
        titleColor: 'text-amber-950',
        messageColor: 'text-amber-900/80',
        dismissHover: 'hover:text-amber-700 hover:bg-amber-100',
    },
    info: {
        Icon: Info,
        iconColor: 'text-slate-600',
        iconBg: 'bg-slate-100',
        border: 'border-slate-300',
        bg: 'bg-slate-50',
        titleColor: 'text-slate-900',
        messageColor: 'text-slate-600',
        dismissHover: 'hover:text-slate-700 hover:bg-slate-100',
    },
};

function ToastCard({
    t,
    type,
    title,
    message,
}: {
    t: Toast;
    type: ToastType;
    title: string;
    message?: string;
}) {
    const cfg = CONFIGS[type];
    const { Icon } = cfg;
    return (
        <motion.div
            role="status"
            aria-live="polite"
            initial={{ y: -72, opacity: 0, scale: 0.88 }}
            animate={
                t.visible
                    ? { y: 0, opacity: 1, scale: 1 }
                    : { y: -56, opacity: 0, scale: 0.9 }
            }
            transition={motionTransition({ type: 'spring', stiffness: 300, damping: 22 })}
            className={`flex items-start gap-3 pl-3 pr-4 py-3 rounded-2xl border shadow-xl backdrop-blur-sm ${cfg.bg} ${cfg.border} min-w-[280px] max-w-[400px] pointer-events-auto`}
            style={{ boxShadow: '0 12px 40px -8px rgba(3,4,94,0.18), 0 4px 12px -2px rgba(0,0,0,0.1)' }}
        >
            <div className={`p-1.5 rounded-xl ${cfg.iconBg} shrink-0 mt-0.5`}>
                <Icon className={`h-4 w-4 ${cfg.iconColor}`} aria-hidden />
            </div>

            <div className="flex-1 min-w-0 py-0.5">
                <p className={`text-sm font-semibold leading-snug ${cfg.titleColor}`}>{title}</p>
                {message && (
                    <p className={`text-xs mt-0.5 leading-relaxed ${cfg.messageColor}`}>{message}</p>
                )}
            </div>

            <button
                type="button"
                onClick={() => hotToast.dismiss(t.id)}
                className={`p-1.5 -mr-1 text-slate-400 rounded-lg transition-colors shrink-0 mt-0.5 ${cfg.dismissHover}`}
                aria-label="Dismiss notification"
            >
                <X className="h-3.5 w-3.5" aria-hidden />
            </button>
        </motion.div>
    );
}

function fire(type: ToastType, title: string, message?: string, duration = STANDARD_DURATION) {
    hotToast.custom(
        (t) => <ToastCard t={t} type={type} title={title} message={message} />,
        { duration, position: 'top-center' },
    );
}

// ─── Welcome toast (unique dark-navy / blue gradient — only blue toast) ───────

function WelcomeToastCard({
    t,
    name,
    email,
}: {
    t: Toast;
    name: string;
    email: string;
}) {
    const initials = name
        .split(/\s+/)
        .map(w => w[0])
        .join('')
        .slice(0, 2)
        .toUpperCase();

    return (
        <motion.div
            role="status"
            aria-live="polite"
            initial={{ y: -72, opacity: 0, scale: 0.88 }}
            animate={t.visible ? { y: 0, opacity: 1, scale: 1 } : { y: -56, opacity: 0, scale: 0.9 }}
            transition={motionTransition({ type: 'spring', stiffness: 300, damping: 22 })}
            className="flex items-center gap-3 pl-2 pr-3 py-2.5 rounded-2xl pointer-events-auto min-w-[280px] max-w-[360px] backdrop-blur-sm"
            style={{
                background: 'linear-gradient(135deg, #0d2240 0%, #1a3a5c 55%, #1d4e89 100%)',
                border: '1px solid rgba(255,255,255,0.1)',
                boxShadow: '0 20px 50px -8px rgba(3,4,94,0.4), 0 6px 16px -3px rgba(0,0,0,0.25)',
            }}
        >
            <div
                className="h-9 w-9 rounded-full flex items-center justify-center shrink-0 text-white font-bold text-sm"
                style={{ background: 'rgba(255,255,255,0.15)', border: '1px solid rgba(255,255,255,0.2)' }}
            >
                {initials || '?'}
            </div>

            <div className="flex-1 min-w-0">
                <p className="text-sm font-bold text-white leading-snug truncate">
                    Welcome back, {name}
                </p>
                <p className="text-[11px] mt-0.5 truncate" style={{ color: 'rgba(255,255,255,0.55)' }}>
                    {email}
                </p>
            </div>

            <button
                type="button"
                onClick={() => hotToast.dismiss(t.id)}
                className="p-1.5 rounded-lg transition-colors shrink-0 text-white/40 hover:text-white/80 hover:bg-white/10"
                aria-label="Dismiss welcome notification"
            >
                <X className="h-3.5 w-3.5" aria-hidden />
            </button>
        </motion.div>
    );
}

export function fireWelcomeToast(name: string, email: string) {
    hotToast.custom(
        t => <WelcomeToastCard t={t} name={name} email={email} />,
        { duration: WELCOME_DURATION, position: 'top-center' },
    );
}

// ─── Public API ───────────────────────────────────────────────────────────────

export type ToastContextType = {
    toast: (type: ToastType, title: string, message?: string) => void;
    success: (title: string, message?: string) => void;
    error: (title: string, message?: string) => void;
    warning: (title: string, message?: string) => void;
    info: (title: string, message?: string) => void;
};

/** Standalone toast API — use anywhere (including outside React components) */
export const appToast: ToastContextType = {
    toast: (type, title, message) => fire(type, title, message),
    success: (title, message) => fire('success', title, message),
    error: (title, message) => fire('error', title, message),
    warning: (title, message) => fire('warning', title, message),
    info: (title, message) => fire('info', title, message),
};

export function useToast(): ToastContextType {
    return appToast;
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
    return <>{children}</>;
}

/** @deprecated Import appToast instead — kept for gradual migration from raw react-hot-toast */
export { appToast as toast };
