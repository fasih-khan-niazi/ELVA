import { useState, useCallback } from 'react';
import type { InputHTMLAttributes } from 'react';
import { Eye, Lock } from 'lucide-react';

const AUTH_WRAP =
    'relative flex items-stretch rounded-lg border border-ocean-sky/80 bg-white shadow-sm overflow-hidden transition focus-within:border-ocean-rich focus-within:ring-2 focus-within:ring-ocean-rich/20';
const AUTH_ICON =
    'flex items-center justify-center w-9 shrink-0 bg-ocean-mist/40 text-ocean-deep/70';
const AUTH_FIELD =
    'flex-1 min-w-0 py-2 px-2.5 border-0 bg-transparent text-ocean-deep placeholder:text-ocean-deep/45 focus:ring-0 focus:outline-none text-sm';
const AUTH_TOGGLE =
    'flex touch-manipulation select-none items-center justify-center w-9 shrink-0 border-l border-ocean-sky/50 bg-ocean-mist/25 text-ocean-deep/55 transition hover:bg-ocean-mist/45 hover:text-ocean-navy focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ocean-rich/40 disabled:opacity-50 active:bg-ocean-mist/50';

type AuthProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> & {
    /** Extra classes merged into the text input (e.g. py-2.5 for invite layout). */
    inputClassName?: string;
};

/** Reveal while pointer is held down on the eye control; hidden on release. */
export function AuthPasswordField({ inputClassName = '', className: _c, ...rest }: AuthProps) {
    const [show, setShow] = useState(false);
    const { id, disabled, ...inputRest } = rest;

    const reveal = useCallback(() => {
        if (!disabled) setShow(true);
    }, [disabled]);
    const hide = useCallback(() => setShow(false), []);

    return (
        <div className={AUTH_WRAP}>
            <span className={AUTH_ICON} aria-hidden>
                <Lock className="h-4 w-4" />
            </span>
            <input
                id={id}
                type={show ? 'text' : 'password'}
                className={`${AUTH_FIELD} ${inputClassName}`.trim()}
                disabled={disabled}
                {...inputRest}
            />
            <button
                type="button"
                className={AUTH_TOGGLE}
                disabled={disabled}
                aria-label="Hold to show password"
                onPointerDown={(e) => {
                    e.preventDefault();
                    reveal();
                }}
                onPointerUp={hide}
                onPointerLeave={hide}
                onPointerCancel={hide}
                tabIndex={-1}
            >
                <Eye className="h-4 w-4 shrink-0 opacity-80" strokeWidth={2} aria-hidden />
            </button>
        </div>
    );
}

type EmbeddedProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>;

/** Default full-width bordered field; hold eye control to reveal. */
export function EmbeddedPasswordField({ className = '', ...rest }: EmbeddedProps) {
    const [show, setShow] = useState(false);
    const reveal = useCallback(() => {
        if (!rest.disabled) setShow(true);
    }, [rest.disabled]);
    const hide = useCallback(() => setShow(false), []);

    return (
        <div className="relative">
            <input
                type={show ? 'text' : 'password'}
                className={`w-full rounded-lg border border-ocean-ice py-2 pl-3 pr-11 text-sm focus:outline-none focus:ring-2 focus:ring-ocean-bright ${className}`.trim()}
                {...rest}
            />
            <button
                type="button"
                className="touch-manipulation select-none absolute right-1.5 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-md text-ocean-deep/50 transition hover:bg-ocean-mist/60 hover:text-ocean-navy focus:outline-none focus-visible:ring-2 focus-visible:ring-ocean-rich disabled:opacity-50 active:bg-ocean-mist/70"
                disabled={rest.disabled}
                aria-label="Hold to show password"
                onPointerDown={(e) => {
                    e.preventDefault();
                    reveal();
                }}
                onPointerUp={hide}
                onPointerLeave={hide}
                onPointerCancel={hide}
                tabIndex={-1}
            >
                <Eye className="h-4 w-4 opacity-80" strokeWidth={2} aria-hidden />
            </button>
        </div>
    );
}
