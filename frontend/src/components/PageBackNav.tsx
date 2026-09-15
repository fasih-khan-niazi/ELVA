import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';

/** Shared styles for back links and same-styled in-page back buttons. */
export const PAGE_BACK_NAV_BTN_CLS =
    'inline-flex items-center gap-2 rounded-lg px-1.5 py-1.5 -ml-1.5 text-sm font-medium text-ocean-deep/90 transition hover:bg-ocean-mist/60 hover:text-ocean-navy focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ocean-bright focus-visible:ring-offset-2';

type PageBackNavProps = {
    /** Visible label, e.g. "Back to Dashboard" */
    label: string;
    /** Absolute path - used with TanStack/router `Link`. */
    to: string;
    className?: string;
};

/** Consistent primary back navigation (top of screen, outside cards). */
export function PageBackNav({ label, to, className = '' }: PageBackNavProps) {
    return (
        <nav aria-label="Back navigation" className={`mb-8 ${className}`.trim()}>
            <Link to={to} className={PAGE_BACK_NAV_BTN_CLS}>
                <ArrowLeft className="h-4 w-4 shrink-0" aria-hidden /> {label}
            </Link>
        </nav>
    );
}
