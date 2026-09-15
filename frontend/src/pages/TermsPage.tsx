import { Link } from 'react-router-dom';
import termsBody from '../content/legal/terms.md?raw';
import { MarkdownDoc } from '../components/MarkdownDoc';
import { ArrowLeft } from 'lucide-react';

export default function TermsPage() {
    return (
        <div className="max-w-4xl mx-auto px-4 sm:px-6 py-10 pb-20">
            <Link to="/login" className="inline-flex items-center gap-2 text-sm font-medium text-ocean-navy hover:text-ocean-sky mb-6">
                <ArrowLeft className="h-4 w-4" /> Back to sign in
            </Link>
            <MarkdownDoc content={termsBody} />
        </div>
    );
}
