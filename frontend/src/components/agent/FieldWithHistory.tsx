import { useEffect, useRef } from 'react';
import { useFieldHistory } from '../../hooks/useFieldHistory';

interface Props {
    fieldKey: string;
    value: string;
    onChange: (v: string) => void;
    rows?: number;
    placeholder?: string;
    className?: string;
    label?: string;
    id?: string;
    /** Grows height with content up to maxAutoHeightPx; then scrolls. */
    autoGrow?: boolean;
    maxAutoHeightPx?: number;
}

export default function FieldWithHistory({
    fieldKey,
    value,
    onChange,
    rows = 4,
    placeholder = '',
    className = '',
    id,
    autoGrow = false,
    maxAutoHeightPx = 320,
}: Props) {
    const { suggestions, saveValue, open, handleFocus, handleBlur, handleSuggestionMouseDown } =
        useFieldHistory(fieldKey);

    const textareaRef = useRef<HTMLTextAreaElement>(null);

    useEffect(() => {
        if (!autoGrow) return;
        const el = textareaRef.current;
        if (!el) return;
        el.style.height = 'auto';
        const next = Math.min(el.scrollHeight + 4, maxAutoHeightPx);
        el.style.height = `${Math.max(next, 96)}px`;
        el.style.overflowY = el.scrollHeight + 4 > maxAutoHeightPx ? 'auto' : 'hidden';
    }, [value, autoGrow, maxAutoHeightPx]);

    const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
        onChange(e.target.value);
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.key === 'Enter' || e.key === 'Tab') {
            saveValue(value);
        }
    };

    const applySuggestion = (s: string) => {
        onChange(s);
        saveValue(s);
    };

    const shownSuggestions = suggestions.filter((s) => s !== value && s.length > 0);

    return (
        <div className="relative">
            <textarea
                ref={textareaRef}
                id={id}
                name={id}
                rows={autoGrow ? Math.max(rows, 5) : rows}
                value={value}
                onChange={handleChange}
                onBlur={(e) => { saveValue(e.target.value); handleBlur(); }}
                onFocus={handleFocus}
                onKeyDown={handleKeyDown}
                placeholder={placeholder}
                className={className}
            />
            {open && shownSuggestions.length > 0 && (
                <div className="absolute z-20 left-0 right-0 mt-1 bg-white border border-ocean-ice rounded-lg shadow-lg overflow-hidden">
                    <p className="px-3 py-1.5 text-xs text-ocean-deep/60 border-b border-ocean-ice/80">Recent values - click to reuse</p>
                    <div className="p-2 space-y-1 max-h-40 overflow-y-auto">
                        {shownSuggestions.map((s, i) => (
                            <button
                                key={i}
                                type="button"
                                onMouseDown={handleSuggestionMouseDown}
                                onClick={() => applySuggestion(s)}
                                className="w-full text-left px-3 py-1.5 text-sm text-ocean-deep hover:bg-ocean-powder hover:text-ocean-deep rounded-md truncate transition-colors"
                                title={s}
                            >
                                {s.length > 80 ? s.slice(0, 80) + '…' : s}
                            </button>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}
