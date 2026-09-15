import { Link, useNavigate, useLocation } from 'react-router-dom';



import { Menu, X, Mic, ChevronDown, LogOut, UserRound, LayoutDashboard } from 'lucide-react';



import { useEffect, useRef, useState } from 'react';



import { useAuth } from '../context/AuthContext';

import type { User } from '../context/AuthContext';

import {

    PLATFORM_JWT_BACKUP_KEY,

    PLATFORM_USER_BACKUP_KEY,

} from '../constants/platformPortal';


function displayLabel(user: { name?: string | null; email: string }) {

    if (user.name && user.name.trim()) return user.name.trim();

    return user.email.split('@')[0];

}



const NAVBAR_API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

function resolveNavbarUploadUrl(src: string | null | undefined): string | null {
    if (!src) return null;
    if (src.startsWith('blob:') || src.startsWith('data:')) return src;
    try {
        const { pathname } = new URL(src);
        if (pathname.startsWith('/uploads/')) return `${NAVBAR_API_URL}${pathname}`;
    } catch { /* not an absolute URL */ }
    return src;
}

function UserAvatar({

    photoUrl,

    label,

}: {

    photoUrl?: string | null;

    label: string;

}) {

    const initials = label

        .split(/\s+/)

        .map((w) => w[0])

        .join('')

        .slice(0, 2)

        .toUpperCase();

    const resolvedPhotoUrl = resolveNavbarUploadUrl(photoUrl);

    if (resolvedPhotoUrl) {

        return (

            <img

                src={resolvedPhotoUrl}

                alt=""

                className="h-9 w-9 rounded-full object-cover border border-white/25 shrink-0"

                referrerPolicy="no-referrer"

            />

        );

    }

    return (

        <div

            className="h-9 w-9 rounded-full bg-ocean-sky text-ocean-navy text-xs font-bold flex items-center justify-center border border-white/20 shrink-0"

            aria-hidden

        >

            {initials || '?'}

        </div>

    );

}



export default function Navbar() {

    const navigate = useNavigate();



    const location = useLocation();



    const [isOpen, setIsOpen] = useState(false);

    const [accountOpen, setAccountOpen] = useState(false);

    const menuRef = useRef<HTMLDivElement>(null);



    const { user, logout, isAuthenticated, login } = useAuth();



    useEffect(() => {

        function onPointerDown(ev: MouseEvent | TouchEvent) {

            const el = menuRef.current;

            if (!el || !(ev.target instanceof Node) || !el.contains(ev.target)) {

                setAccountOpen(false);

            }

        }

        document.addEventListener('mousedown', onPointerDown);

        document.addEventListener('touchstart', onPointerDown, { passive: true });

        return () => {

            document.removeEventListener('mousedown', onPointerDown);

            document.removeEventListener('touchstart', onPointerDown);

        };

    }, []);



    const handleLogout = () => {

        logout();

        setAccountOpen(false);

        setIsOpen(false);

        navigate('/');

    };



    const handleProfile = () => {

        navigate('/profile');

        setAccountOpen(false);

        setIsOpen(false);

    };



    const isActive = (path: string) => location.pathname === path;



    const linkClass = (path: string) =>

        `rounded-md px-3 py-2 text-sm font-medium tracking-tight transition-colors ${

            isActive(path)

                ? 'text-white font-semibold bg-white/10'

                : 'text-white/75 hover:text-white hover:bg-white/[0.07]'

        }`;



    const mobileLinkClass = (path: string) =>

        `block rounded-lg px-4 py-3 text-base font-medium transition-colors ${

            isActive(path)

                ? 'text-white font-semibold bg-white/10'

                : 'text-white/88 hover:bg-white/[0.07] hover:text-white'

        }`;



    const closeMenu = () => setIsOpen(false);



    const label = user ? displayLabel(user) : '';

    const email = user?.email ?? '';

    const sandboxBackupJwt =
        typeof window !== 'undefined' ? localStorage.getItem(PLATFORM_JWT_BACKUP_KEY) : null;
    const sandboxBackupUserJson =
        typeof window !== 'undefined' ? localStorage.getItem(PLATFORM_USER_BACKUP_KEY) : null;
    const showSandboxBanner = !!(
        sandboxBackupJwt &&
        sandboxBackupUserJson &&
        user?.role === 'business_admin'
    );

    const restoreOperatorSession = () => {
        if (!sandboxBackupJwt || !sandboxBackupUserJson) return;
        try {
            const restored = JSON.parse(sandboxBackupUserJson) as User;
            login(sandboxBackupJwt, restored);
            localStorage.removeItem(PLATFORM_JWT_BACKUP_KEY);
            localStorage.removeItem(PLATFORM_USER_BACKUP_KEY);
            navigate('/platform');
            setAccountOpen(false);
            setIsOpen(false);
        } catch (err) {
            console.error('[Navbar] Failed to restore operator JWT', err);
        }
    };


    return (
        <>
            {showSandboxBanner ? (
                <div className="flex flex-wrap items-center justify-between gap-2 bg-amber-400 px-4 py-2 text-[12px] font-semibold text-ocean-navy">
                    <span>Exploration sandbox mode: you are viewing a reserved test workspace.</span>
                    <button
                        type="button"
                        onClick={() => restoreOperatorSession()}
                        className="rounded-lg bg-ocean-deep px-3 py-1 text-[11px] font-bold text-white hover:bg-ocean-rich"
                    >
                        Exit sandbox back to /platform
                    </button>
                </div>
            ) : null}

        <nav className="sticky top-0 z-50 bg-ocean-navy text-white shadow-ocean backdrop-blur-md border-b border-white/[0.08] transition-shadow duration-300">

            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">

                <div className="flex justify-between h-[4.25rem]">

                    <div className="flex items-center">

                        <Link

                            to="/"

                            className="flex-shrink-0 flex items-center gap-3 group rounded-xl py-1 -ml-1 pl-1 pr-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ocean-sky focus-visible:ring-offset-2 focus-visible:ring-offset-ocean-navy"

                            onClick={closeMenu}

                        >

                            <div className="bg-ocean-sky p-2 rounded-xl transition-colors duration-200 group-hover:bg-ocean-bright">

                                <Mic className="h-6 w-6 text-white" aria-hidden />

                            </div>

                            <span className="font-bold text-xl tracking-tight text-white">ELVA</span>

                        </Link>

                    </div>



                    {/* Desktop Menu */}

                    <div className="hidden md:flex items-center space-x-1 lg:space-x-2">

                        <Link to="/" className={`${linkClass('/')} whitespace-nowrap`}>

                            Home

                        </Link>

                        <Link to="/about" className={`${linkClass('/about')} whitespace-nowrap`}>

                            About Us

                        </Link>

                        <Link to="/docs" className={`${linkClass('/docs')} whitespace-nowrap`}>

                            Docs

                        </Link>

                        {isAuthenticated ? (

                            <>

                                {user?.role === 'platform_admin' ? (

                                    <Link to="/platform" className={`${linkClass('/platform')} whitespace-nowrap`}>

                                        <span className="inline-flex items-center gap-2">

                                            <LayoutDashboard className="h-4 w-4" aria-hidden />

                                            Platform

                                        </span>

                                    </Link>

                                ) : (

                                    <>

                                        <Link to="/dashboard" className={`${linkClass('/dashboard')} whitespace-nowrap`}>

                                            Dashboard

                                        </Link>

                                        <Link to="/subscription" className={`${linkClass('/subscription')} whitespace-nowrap`}>

                                            Subscription

                                        </Link>

                                    </>

                                )}


                                <div

                                    ref={menuRef}

                                    className="relative flex items-center gap-1 pl-4 ml-3 border-l border-white/15"

                                >

                                    <button

                                        type="button"

                                        onClick={() => setAccountOpen((o) => !o)}

                                        className="flex items-center gap-2 rounded-full py-1.5 pr-3 pl-1.5 hover:bg-white/10 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ocean-sky focus-visible:ring-offset-2 focus-visible:ring-offset-ocean-navy"

                                        aria-expanded={accountOpen}

                                        aria-haspopup="menu"

                                    >

                                        <UserAvatar photoUrl={user?.profilePicture} label={label} />

                                        <span className="text-sm font-medium text-white max-w-[140px] truncate text-left">

                                            {label}

                                        </span>

                                        <ChevronDown

                                            className={`h-4 w-4 shrink-0 text-white/65 transition-transform ${

                                                accountOpen ? 'rotate-180' : ''

                                            }`}

                                            aria-hidden

                                        />

                                    </button>

                                    {accountOpen && (

                                        <div

                                            role="menu"

                                            className="absolute right-0 top-[calc(100%+8px)] w-56 rounded-xl border border-slate-200 bg-white text-ocean-navy shadow-xl shadow-slate-900/15 ring-1 ring-black/5 py-1 z-[60]"

                                        >

                                            <p className="px-4 py-2.5 text-xs font-medium text-slate-600 truncate border-b border-slate-100" title={email}>

                                                {email}

                                            </p>

                                            <button

                                                type="button"

                                                role="menuitem"

                                                onClick={handleProfile}

                                                className="w-full flex items-center gap-2 px-4 py-2.5 text-sm font-semibold text-ocean-navy hover:bg-ocean-powder/70 focus-visible:bg-ocean-powder/70 focus-visible:outline-none"

                                            >

                                                <UserRound className="h-4 w-4 text-ocean-rich shrink-0" aria-hidden />

                                                Profile

                                            </button>

                                            <button

                                                type="button"

                                                role="menuitem"

                                                onClick={handleLogout}

                                                className="w-full flex items-center gap-2 px-4 py-2.5 text-sm font-semibold text-red-700 hover:bg-red-50 focus-visible:bg-red-50 focus-visible:outline-none border-t border-slate-100"

                                            >

                                                <LogOut className="h-4 w-4 shrink-0" aria-hidden />

                                                Log out

                                            </button>

                                        </div>

                                    )}

                                </div>

                            </>

                        ) : (

                            <Link

                                to="/login"

                                className="ml-6 inline-flex items-center justify-center font-bold text-ocean-navy bg-ocean-sky rounded-full px-7 py-2.5 shadow-ocean hover:bg-white hover:text-ocean-navy hover:shadow-xl hover:-translate-y-0.5 active:translate-y-0 transition-all duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-ocean-navy"

                            >

                                Get Started

                            </Link>

                        )}

                    </div>



                    {/* Mobile menu button */}

                    <div className="md:hidden flex items-center">

                        <button

                            onClick={() => setIsOpen(!isOpen)}

                            className="p-2.5 rounded-xl text-white/90 hover:text-white hover:bg-white/10 focus-ocean transition-colors duration-200"

                            aria-label={isOpen ? 'Close menu' : 'Open menu'}

                            aria-expanded={isOpen}

                        >

                            {isOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}

                        </button>

                    </div>

                </div>

            </div>



            {/* Mobile Menu */}

            {isOpen && (

                <div className="md:hidden border-t border-white/10 bg-ocean-navy/95 animate-slide-in backdrop-blur-md">

                    <div className="px-4 pt-4 pb-5 space-y-1">

                        <Link to="/" className={mobileLinkClass('/')} onClick={closeMenu}>

                            Home

                        </Link>

                        <Link to="/about" className={mobileLinkClass('/about')} onClick={closeMenu}>

                            About Us

                        </Link>

                        <Link to="/docs" className={mobileLinkClass('/docs')} onClick={closeMenu}>

                            Docs

                        </Link>

                        {isAuthenticated ? (

                            <>

                                {user?.role === 'platform_admin' ? (

                                    <Link to="/platform" className={mobileLinkClass('/platform')} onClick={closeMenu}>

                                        Platform console

                                    </Link>

                                ) : (

                                    <>

                                        <Link to="/dashboard" className={mobileLinkClass('/dashboard')} onClick={closeMenu}>

                                            Dashboard

                                        </Link>

                                        <Link

                                            to="/subscription"

                                            className={mobileLinkClass('/subscription')}

                                            onClick={closeMenu}

                                        >

                                            Subscription

                                        </Link>

                                    </>

                                )}

                                <button

                                    type="button"

                                    onClick={() => {

                                        navigate('/profile');

                                        closeMenu();

                                    }}

                                    className={`${mobileLinkClass('/profile')} w-full text-left`}

                                >

                                    Profile

                                </button>

                                {user && (

                                    <div className="flex items-center gap-3 px-4 py-3 rounded-xl mt-3 bg-white/[0.06] border border-white/10">

                                        <UserAvatar photoUrl={user.profilePicture} label={label} />

                                        <div className="min-w-0 flex-1">

                                            <p className="font-semibold text-white truncate">{label}</p>

                                            <p className="text-xs text-white/60 truncate">{user.email}</p>

                                        </div>

                                    </div>

                                )}

                                <button

                                    onClick={handleLogout}

                                    className="block w-full text-left px-4 py-3 rounded-xl font-semibold text-white bg-ocean-sky/95 hover:bg-ocean-sky transition-colors mt-2 shadow-ocean"

                                >

                                    Sign Out

                                </button>

                            </>

                        ) : (

                            <Link

                                to="/login"

                                className="block text-center px-4 py-3 rounded-xl mt-2 font-semibold bg-white text-ocean-navy hover:bg-ocean-sky transition-colors"

                                onClick={closeMenu}

                            >

                                Get Started

                            </Link>

                        )}

                    </div>

                </div>

            )}

        </nav>
        </>
    );

}




