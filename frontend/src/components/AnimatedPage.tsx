import type { ReactNode } from 'react';
import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';
import { pageStagger, pageEnter } from '@/lib/motion';

type AnimatedPageProps = {
    children: ReactNode;
    className?: string;
    /** When false, skip entrance animation (e.g. tab switches) */
    animate?: boolean;
};

/** Subtle page entrance — fast enough not to feel like extra loading time */
export default function AnimatedPage({ children, className, animate = true }: AnimatedPageProps) {
    if (!animate) {
        return <div className={className}>{children}</div>;
    }

    return (
        <motion.div
            className={cn(className)}
            initial="hidden"
            animate="show"
            variants={pageStagger}
        >
            <motion.div variants={pageEnter}>{children}</motion.div>
        </motion.div>
    );
}
