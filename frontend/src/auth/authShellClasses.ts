/** Shared layout for login, register, and invite full-bleed auth pages. */

export const AUTH_FORM_MAIN_CLASS =
    'flex min-h-0 w-full flex-1 flex-col overflow-y-auto overflow-x-hidden overscroll-y-contain bg-gradient-to-br from-ocean-powder via-white to-ocean-sky/20 lg:ml-[40%] lg:h-full lg:w-[60%]';

/**
 * Short auth flows (e.g. Sign in): fill the column and center the form vertically.
 * Scroll still lives on `<main>` only if content overflows.
 */
export const AUTH_FORM_BODY_CENTERED_CLASS =
    'flex min-h-full w-full flex-col justify-center px-3 pb-10 pt-[max(1.75rem,env(safe-area-inset-top,0px))] sm:px-5 sm:pb-12 sm:pt-10 lg:pb-14 lg:pt-12';

/**
 * Tall forms (Create account, invite password): top-aligned with generous bottom padding
 * so the last controls are reachable; no `min-h`/`justify-center` tricks that clip scroll range.
 */
export const AUTH_FORM_BODY_SCROLL_CLASS =
    'w-full flex flex-col px-3 pb-16 pt-[max(1.75rem,env(safe-area-inset-top,0px))] sm:px-5 sm:pb-20 sm:pt-10 lg:pb-24 lg:pt-12';
