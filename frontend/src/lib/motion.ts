import type { Transition, Variants } from 'framer-motion';

/** Shared easing curve — matches Home.tsx / Dashboard.tsx */
export const EASE_OUT = [0.22, 1, 0.36, 1] as [number, number, number, number];

export const DEFAULT_DURATION = 0.25;
export const FAST_DURATION = 0.18;

/** Respect system reduced-motion preference */
export function prefersReducedMotion(): boolean {
    if (typeof window === 'undefined') return false;
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function motionTransition(fallback: Transition): Transition {
    if (prefersReducedMotion()) return { duration: 0 };
    return fallback;
}

export const fadeUp: Variants = {
    hidden: { opacity: 0, y: 44 },
    visible: {
        opacity: 1,
        y: 0,
        transition: motionTransition({ duration: 0.72, ease: EASE_OUT }),
    },
};

export const fadeUpFast: Variants = {
    hidden: { opacity: 0, y: 26 },
    visible: {
        opacity: 1,
        y: 0,
        transition: motionTransition({ duration: 0.52, ease: EASE_OUT }),
    },
};

export const scaleIn: Variants = {
    hidden: { opacity: 0, scale: 0.86 },
    visible: {
        opacity: 1,
        scale: 1,
        transition: motionTransition({ type: 'spring', stiffness: 200, damping: 22 }),
    },
};

export const stagger: Variants = {
    hidden: {},
    visible: {
        transition: prefersReducedMotion()
            ? {}
            : { staggerChildren: 0.13, delayChildren: 0.05 },
    },
};

export const staggerFast: Variants = {
    hidden: {},
    visible: {
        transition: prefersReducedMotion()
            ? {}
            : { staggerChildren: 0.09 },
    },
};

export const pageStagger: Variants = {
    hidden: {},
    show: {
        transition: prefersReducedMotion()
            ? {}
            : { staggerChildren: 0.06 },
    },
};

export const pageEnter: Variants = {
    hidden: { opacity: 0, y: 6 },
    show: {
        opacity: 1,
        y: 0,
        transition: motionTransition({ duration: DEFAULT_DURATION, ease: EASE_OUT }),
    },
};

export const listStagger: Variants = {
    hidden: {},
    show: {
        transition: prefersReducedMotion()
            ? {}
            : { staggerChildren: 0.04 },
    },
};

export const listItemEnter: Variants = {
    hidden: { opacity: 0, y: 6 },
    show: {
        opacity: 1,
        y: 0,
        transition: motionTransition({ duration: 0.22, ease: EASE_OUT }),
    },
};

export const modalBackdrop: Variants = {
    hidden: { opacity: 0 },
    visible: { opacity: 1 },
    exit: { opacity: 0 },
};

export const modalPanel: Variants = {
    hidden: { opacity: 0, y: 24, scale: 0.97 },
    visible: {
        opacity: 1,
        y: 0,
        scale: 1,
        transition: motionTransition({ type: 'spring', stiffness: 380, damping: 32 }),
    },
    exit: {
        opacity: 0,
        y: 16,
        scale: 0.98,
        transition: motionTransition({ duration: FAST_DURATION }),
    },
};

export const tapScale = prefersReducedMotion()
    ? {}
    : { whileTap: { scale: 0.97 } };

export const hoverLift = prefersReducedMotion()
    ? {}
    : { whileHover: { y: -2 }, transition: { type: 'spring', stiffness: 400, damping: 25 } };
