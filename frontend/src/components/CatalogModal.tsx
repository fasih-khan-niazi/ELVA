import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Package } from 'lucide-react';
import CatalogManager from './CatalogManager';

export interface CatalogModalAgent {
    _id: string;
    name: string;
    currency?: string;
}

interface CatalogModalProps {
    agent: CatalogModalAgent | null;
    otherAgents: CatalogModalAgent[];
    onClose: () => void;
}

export default function CatalogModal({ agent, otherAgents, onClose }: CatalogModalProps) {
    useEffect(() => {
        if (!agent) return;
        const prev = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
        };
        window.addEventListener('keydown', onKey);
        return () => {
            document.body.style.overflow = prev;
            window.removeEventListener('keydown', onKey);
        };
    }, [agent, onClose]);

    if (typeof document === 'undefined') return null;

    return createPortal(
        <AnimatePresence>
            {agent && (
                <motion.div
                    className="fixed inset-0 z-[9999] flex items-center justify-center p-4 sm:p-6"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.2 }}
                    role="dialog"
                    aria-modal="true"
                    aria-labelledby="catalog-modal-title"
                >
                    {/* Full-viewport backdrop — blocks clicks on sidebar, header, and page */}
                    <motion.div
                        className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        aria-hidden
                    />

                    <motion.div
                        className="relative z-10 flex w-full max-w-3xl max-h-[min(88vh,920px)] flex-col overflow-hidden rounded-2xl border border-ocean-ice bg-white shadow-2xl"
                        initial={{ opacity: 0, y: 24, scale: 0.97 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: 16, scale: 0.98 }}
                        transition={{ type: 'spring', stiffness: 380, damping: 32 }}
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="flex shrink-0 items-center justify-between border-b border-ocean-ice bg-white px-5 py-4 sm:px-6">
                            <div className="min-w-0 pr-4">
                                <div className="flex items-center gap-2">
                                    <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-ocean-deep text-white shadow-sm">
                                        <Package className="h-4 w-4" aria-hidden />
                                    </div>
                                    <div className="min-w-0">
                                        <h2 id="catalog-modal-title" className="truncate text-lg font-semibold text-ocean-navy">
                                            Catalog / Menu
                                        </h2>
                                        <p className="truncate text-xs text-ocean-deep/70">{agent.name}</p>
                                    </div>
                                </div>
                            </div>
                            <button
                                type="button"
                                onClick={onClose}
                                className="rounded-xl p-2 text-ocean-deep/60 transition-colors hover:bg-ocean-powder hover:text-ocean-navy"
                                aria-label="Close catalog"
                            >
                                <X className="h-5 w-5" />
                            </button>
                        </div>

                        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-5 sm:px-6">
                            <CatalogManager
                                agentId={agent._id}
                                currency={agent.currency}
                                duplicateFromAgents={otherAgents.filter((a) => a._id !== agent._id)}
                            />
                        </div>
                    </motion.div>
                </motion.div>
            )}
        </AnimatePresence>,
        document.body,
    );
}
