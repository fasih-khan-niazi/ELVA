import { useEffect } from 'react';
import { X, ExternalLink } from 'lucide-react';
import termsBody from '../content/legal/terms.md?raw';
import { MarkdownDoc } from './MarkdownDoc';

type Props = {
    open: boolean;
    onClose: () => void;
};

/** Full terms in a scrollable overlay; full page still available in a new tab. */
export function TermsModal({ open, onClose }: Props) {
    useEffect(() => {
        if (!open) return;
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [open, onClose]);

    if (!open) return null;

    return (
        <div
            className="fixed inset-0 z-[100] flex items-end justify-center sm:items-center sm:p-4"
            role="dialog"
            aria-modal="true"
            aria-labelledby="terms-modal-title"
        >
            <button
                type="button"
                className="absolute inset-0 bg-slate-900/55 backdrop-blur-[2px]"
                aria-label="Close terms"
                onClick={onClose}
            />
            <div
                className="relative flex max-h-[min(92dvh,900px)] w-full max-w-3xl flex-col overflow-hidden rounded-t-2xl border border-ocean-sky/50 bg-white shadow-2xl sm:rounded-2xl"
                onClick={(e) => e.stopPropagation()}
            >
                <header className="flex shrink-0 flex-wrap items-start justify-between gap-3 border-b border-ocean-sky/40 bg-ocean-powder/80 px-4 py-3 sm:px-5">
                    <div>
                        <h2 id="terms-modal-title" className="text-lg font-bold text-ocean-navy">
                            Terms of Service
                        </h2>
                        <a
                            href="/legal/terms"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="mt-1.5 inline-flex items-center gap-1.5 text-[10px] text-ocean-deep/70 transition hover:text-ocean-rich"
                        >
                            <ExternalLink className="h-3 w-3 shrink-0" strokeWidth={2} />
                            <span>Open full page in new tab</span>
                        </a>
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        className="rounded-lg p-2 text-ocean-deep/70 transition hover:bg-ocean-mist/80 hover:text-ocean-navy focus:outline-none focus-visible:ring-2 focus-visible:ring-ocean-rich"
                        aria-label="Close"
                    >
                        <X className="h-5 w-5" />
                    </button>
                </header>
                <div className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain px-4 pb-8 pt-4 sm:px-6">
                    <MarkdownDoc content={termsBody} className="!max-w-none" />
                </div>
            </div>
        </div>
    );
}
