import { useState, useCallback, useEffect, useRef } from 'react';

const MAX_HISTORY = 5;
const STORAGE_PREFIX = 'elva_field_history_';

export function useFieldHistory(fieldKey: string) {
    const [suggestions, setSuggestions] = useState<string[]>([]);
    const [open, setOpen] = useState(false);
    const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(() => {
        try {
            const stored = localStorage.getItem(STORAGE_PREFIX + fieldKey);
            if (stored) setSuggestions(JSON.parse(stored));
        } catch {
            // ignore parse errors
        }
    }, [fieldKey]);

    const saveValue = useCallback(
        (value: string) => {
            const trimmed = value.trim();
            if (!trimmed || trimmed.length < 5) return;
            setSuggestions((prev) => {
                const deduped = [trimmed, ...prev.filter((v) => v !== trimmed)].slice(0, MAX_HISTORY);
                try {
                    localStorage.setItem(STORAGE_PREFIX + fieldKey, JSON.stringify(deduped));
                } catch {
                    // storage quota exceeded - skip silently
                }
                return deduped;
            });
        },
        [fieldKey]
    );

    // Delay close so clicks on suggestion chips register before blur fires
    const handleBlur = useCallback(() => {
        closeTimerRef.current = setTimeout(() => setOpen(false), 150);
    }, []);

    const handleFocus = useCallback(() => {
        if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
        setOpen(true);
    }, []);

    const handleSuggestionMouseDown = useCallback(() => {
        if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    }, []);

    return { suggestions, saveValue, open, handleFocus, handleBlur, handleSuggestionMouseDown };
}
