import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { appToast as toast } from '../components/Toast';
import { ProfileSkeleton } from '../components/skeletons';
import AnimatedPage from '../components/AnimatedPage';
import {
    Building2,
    Check,
    ClipboardList,
    CreditCard,
    FileDown,
    Loader,
    Mail,
    Monitor,
    Pencil,
    Shield,
    Smartphone,
    Trash2,
    UserPlus,
    Users,
    X,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { PageBackNav } from '../components/PageBackNav';
import { formatAuditMetadata } from '../utils/formatAuditMetadata';
import { downloadWorkspaceAuditPdf } from '../utils/workspaceAuditPdf';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

function resolveUploadUrl(src: string | null | undefined): string | null {
    if (!src) return null;
    if (src.startsWith('blob:') || src.startsWith('data:')) return src;
    try {
        const url = new URL(src);
        // Preserve path AND search so cache-bust query params survive.
        if (url.pathname.startsWith('/uploads/')) return `${API_URL}${url.pathname}${url.search}`;
    } catch { /* relative path — return as-is */ }
    return src;
}

type Member = {
    id: string;
    email: string;
    name: string | null;
    role: string;
    profilePicture: string | null;
    authProvider: string;
    accountStatus: string;
    createdAt: string;
};

type SeatsSnapshot = {
    plan: string;
    limit: number;
    used: number;
    pending: number;
};

type MeResponse = {
    user: {
        id: string;
        email: string;
        name: string | null;
        role: string;
        tenantId: string | null;
        profilePicture: string | null;
        authProvider: string;
        accountStatus: string;
        createdAt: string;
    };
    tenant: null | {
        id: string;
        name: string;
        plan: string;
        registrationType?: 'solo' | 'company';
        allowedEmailDomain?: string | null;
        currency: string;
        createdAt: string;
    };
    subscription: null | {
        plan: string;
        status: string;
        currentPeriodEnd?: string;
    };
};

type PendingInvite = {
    id: string;
    email: string;
    expiresAt: string;
    createdAt: string;
};

type AuditEntry = {
    id: string;
    action: string;
    targetType?: string;
    targetId?: string;
    metadata?: Record<string, unknown>;
    createdAt: string;
    actorId: string;
    actorEmail: string | null;
    actorName: string | null;
};

function roleLabel(role: string) {
    if (role === 'business_admin') return 'Workspace admin';
    if (role === 'member') return 'Member';
    if (role === 'platform_admin') return 'platform_admin';
    return role;
}

function domainFromEmail(email: string): string | null {
    const norm = email.trim().toLowerCase();
    const at = norm.lastIndexOf('@');
    if (at <= 0 || at === norm.length - 1) return null;
    return norm.slice(at + 1);
}

function displayInitials(name: string | null | undefined, email: string) {
    const n = name?.trim();
    if (n) {
        const parts = n.split(/\s+/).filter(Boolean);
        if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
        return n.slice(0, 2).toUpperCase();
    }
    return email.trim().slice(0, 2).toUpperCase();
}

const ACTION_LABELS: Record<string, string> = {
    'auth.login': 'Signed in',
    'auth.signup': 'Registered workspace',
    'auth.logout': 'Signed out',
    'auth.password_set': 'Password set',
    'agent.create': 'Created agent',
    'agent.update': 'Updated agent',
    'agent.delete': 'Deleted agent',
    'member.remove': 'Removed member',
    'member.suspend': 'Suspended member',
    'member.resume': 'Reactivated member',
    'member.join': 'Joined workspace (invite)',
    'invite.send': 'Sent invite',
    'invite.revoke': 'Revoked invite',
    'workspace.update': 'Updated workspace settings',
    'workspace.invite_policy': 'Changed invite email policy',
    'document.upload': 'Uploaded knowledge file(s)',
    'document.delete': 'Deleted knowledge document',
    'document.reingest': 'Re-synced agent knowledge (re-ingest)',
    'knowledge.summary_update': 'Updated knowledge summary',
    'connector.create': 'Added alerts & notifications connector',
    'connector.update': 'Updated alerts & notifications connector',
    'connector.delete': 'Removed alerts & notifications connector',
    'profile.update': 'Updated profile',
    'profile.avatar_update': 'Updated profile photo',
    'subscription.select_free': 'Switched subscription to Free',
    'subscription.checkout_started': 'Started paid plan checkout',
};

function auditActionLabel(action: string) {
    return ACTION_LABELS[action] || action.replace(/\./g, ' ');
}

export default function Profile() {
    const { token, user, setUserPartial } = useAuth();
    const avatarInputRef = useRef<HTMLInputElement>(null);
    const [payload, setPayload] = useState<MeResponse | null>(null);
    const [loading, setLoading] = useState(true);
    const [personalEdit, setPersonalEdit] = useState(false);
    const [workspaceDraft, setWorkspaceDraft] = useState('');
    const [nameDraft, setNameDraft] = useState('');
    /** Set to the cache-bust timestamp after an avatar upload; consumed by fetchAll. */
    const avatarCacheBustRef = useRef<number | null>(null);
    const [workspaceCurrency, setWorkspaceCurrency] = useState('PKR');
    const [savingCurrency, setSavingCurrency] = useState(false);
    const [avatarFile, setAvatarFile] = useState<File | null>(null);
    const [avatarPreviewUrl, setAvatarPreviewUrl] = useState<string | null>(null);
    const [savePersonalBusy, setSavePersonalBusy] = useState(false);

    const [members, setMembers] = useState<Member[]>([]);
    const [pendingInvites, setPendingInvites] = useState<PendingInvite[]>([]);
    const [inviteEmail, setInviteEmail] = useState('');
    const [inviteBusy, setInviteBusy] = useState(false);
    const [invitePolicyBusy, setInvitePolicyBusy] = useState(false);

    const [adminsCount, setAdminsCount] = useState(1);
    const [seats, setSeats] = useState<SeatsSnapshot | null>(null);
    const [removeMemberTarget, setRemoveMemberTarget] = useState<Member | null>(null);
    const [removeConfirmEmail, setRemoveConfirmEmail] = useState('');
    const [removeMemberBusy, setRemoveMemberBusy] = useState(false);

    const [auditEntries, setAuditEntries] = useState<AuditEntry[]>([]);
    const [auditLoading, setAuditLoading] = useState(false);
    const [auditTabUserId, setAuditTabUserId] = useState<string | null>(null);
    const [auditModalOpen, setAuditModalOpen] = useState(false);
    const [auditPdfBusy, setAuditPdfBusy] = useState(false);
    const [teamBusyId, setTeamBusyId] = useState<string | null>(null);

    // ── Active Sessions ────────────────────────────────────────────────────
    interface SessionInfo {
        id: string;
        deviceLabel: string;
        ipAddress: string;
        createdAt: string;
        lastSeenAt: string;
        expiresAt: string;
        isCurrent: boolean;
    }
    const [sessions, setSessions] = useState<SessionInfo[]>([]);
    const [sessionsLoading, setSessionsLoading] = useState(false);
    const [revokeAllBusy, setRevokeAllBusy] = useState(false);

    const fetchSessions = useCallback(async () => {
        if (!token) return;
        setSessionsLoading(true);
        try {
            const r = await fetch(`${API_URL}/api/user/sessions`, {
                headers: { Authorization: `Bearer ${token}` },
            });
            if (r.ok) {
                const data = await r.json();
                setSessions(data.sessions ?? []);
            }
        } catch { /* silent */ }
        setSessionsLoading(false);
    }, [token]);

    useEffect(() => { void fetchSessions(); }, [fetchSessions]);

    const handleRevokeSession = async (sessionId: string) => {
        if (!token) return;
        try {
            const r = await fetch(`${API_URL}/api/user/sessions/${encodeURIComponent(sessionId)}`, {
                method: 'DELETE',
                headers: { Authorization: `Bearer ${token}` },
            });
            if (r.ok) {
                setSessions(prev => prev.filter(s => s.id !== sessionId));
                toast.success('Session revoked.');
            }
        } catch { toast.error('Could not revoke session.'); }
    };

    const handleRevokeAll = async () => {
        if (!token) return;
        setRevokeAllBusy(true);
        try {
            const r = await fetch(`${API_URL}/api/user/sessions`, {
                method: 'DELETE',
                headers: { Authorization: `Bearer ${token}` },
            });
            if (r.ok) {
                await fetchSessions();
                toast.success('All other sessions revoked.');
            }
        } catch { toast.error('Could not revoke sessions.'); }
        setRevokeAllBusy(false);
    };

    const fetchAll = useCallback(async () => {
        if (!token) return;
        setLoading(true);
        try {
            const r = await fetch(`${API_URL}/api/user/me`, {
                headers: { Authorization: `Bearer ${token}` },
            });
            if (!r.ok) {
                toast.error('Could not load profile');
                return;
            }
            const data = (await r.json()) as MeResponse;
            // If an avatar was just uploaded, cache-bust the URL so the browser
            // fetches the new file instead of serving the old cached image.
            if (avatarCacheBustRef.current !== null && data.user.profilePicture) {
                data.user.profilePicture = `${data.user.profilePicture.split('?')[0]}?v=${avatarCacheBustRef.current}`;
                avatarCacheBustRef.current = null;
            }
            setPayload(data);
            setWorkspaceCurrency(data.tenant?.currency || 'PKR');

            const registrationType = data.tenant?.registrationType;
            const isSoloWorkspace = registrationType === 'solo';

            const [mr, iv] = await Promise.all([
                fetch(`${API_URL}/api/tenant/members`, {
                    headers: { Authorization: `Bearer ${token}` },
                }),
                data.user.role === 'business_admin' && data.tenant && !isSoloWorkspace
                    ? fetch(`${API_URL}/api/tenant/invites`, {
                          headers: { Authorization: `Bearer ${token}` },
                      })
                    : Promise.resolve(null as Response | null),
            ]);

            if (mr.ok) {
                const tm = await mr.json();
                setMembers(tm.members || []);
                setAdminsCount(typeof tm.adminsCount === 'number' ? tm.adminsCount : 1);
                const s = tm.seats;
                if (
                    s &&
                    typeof s.used === 'number' &&
                    typeof s.pending === 'number' &&
                    typeof s.limit === 'number' &&
                    typeof s.plan === 'string'
                ) {
                    setSeats({ plan: s.plan, limit: s.limit, used: s.used, pending: s.pending });
                } else {
                    setSeats(null);
                }
            }
            if (iv && iv.ok) {
                const invData = await iv.json();
                setPendingInvites(invData.invites || []);
            } else {
                setPendingInvites([]);
            }
        } catch {
            toast.error('Network error loading profile');
        } finally {
            setLoading(false);
        }
    }, [token]);

    const fetchAudit = useCallback(async () => {
        if (!token || user?.role !== 'business_admin') return;
        setAuditLoading(true);
        try {
            const q =
                auditTabUserId != null
                    ? `?userId=${encodeURIComponent(auditTabUserId)}&limit=400`
                    : '?limit=400';
            const r = await fetch(`${API_URL}/api/tenant/audit-log${q}`, {
                headers: { Authorization: `Bearer ${token}` },
            });
            if (r.ok) {
                const data = await r.json();
                setAuditEntries(data.entries || []);
            }
        } catch {
            /* ignore */
        } finally {
            setAuditLoading(false);
        }
    }, [token, user?.role, auditTabUserId]);

    useEffect(() => {
        if (user?.role === 'business_admin' && auditModalOpen) {
            void fetchAudit();
        }
    }, [fetchAudit, user?.role, auditModalOpen]);

    const auditFilterDescription = useMemo(() => {
        if (auditTabUserId == null) return 'Everyone';
        const m = members.find((x) => String(x.id) === auditTabUserId);
        return m ? m.name || m.email : 'Selected member';
    }, [auditTabUserId, members]);

    const exportAuditPdf = async () => {
        if (auditEntries.length === 0) {
            toast.error('No events to export.');
            return;
        }
        const workspaceName = payload?.tenant?.name ?? 'Workspace';
        setAuditPdfBusy(true);
        try {
            await downloadWorkspaceAuditPdf({
                workspaceName,
                filterLabel: auditFilterDescription,
                entries: auditEntries.map((e) => ({
                    id: e.id,
                    action: e.action,
                    actionLabel: auditActionLabel(e.action),
                    createdAt: new Date(e.createdAt).toLocaleString(),
                    actorLine: [e.actorName, e.actorEmail].filter(Boolean).join(' · ') || e.actorId,
                    metadata: e.metadata,
                })),
            });
            toast.success('Activity report downloaded.');
        } catch {
            toast.error('Could not create PDF.');
        } finally {
            setAuditPdfBusy(false);
        }
    };

    useEffect(() => {
        fetchAll();
    }, [fetchAll]);

    useEffect(() => {
        return () => {
            if (avatarPreviewUrl) URL.revokeObjectURL(avatarPreviewUrl);
        };
    }, [avatarPreviewUrl]);

    const cancelPersonalEdit = () => {
        if (avatarPreviewUrl) URL.revokeObjectURL(avatarPreviewUrl);
        setAvatarPreviewUrl(null);
        setAvatarFile(null);
        setPersonalEdit(false);
        if (avatarInputRef.current) avatarInputRef.current.value = '';
    };

    const enterPersonalEdit = () => {
        if (!payload) return;
        setWorkspaceDraft(payload.tenant?.name ?? '');
        setNameDraft(payload.user.name?.trim() ?? '');
        setAvatarFile(null);
        if (avatarPreviewUrl) URL.revokeObjectURL(avatarPreviewUrl);
        setAvatarPreviewUrl(null);
        if (avatarInputRef.current) avatarInputRef.current.value = '';
        setPersonalEdit(true);
    };

    const onAvatarPicked = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        const okTypes = ['image/jpeg', 'image/png', 'image/webp'];
        if (!okTypes.includes(file.type)) {
            toast.error('Use a JPG, PNG, or WebP image.');
            e.target.value = '';
            return;
        }
        const max = 2 * 1024 * 1024; // 2 MB — industry standard for profile photos
        if (file.size > max) {
            toast.error('Image must be 2 MB or smaller.');
            e.target.value = '';
            return;
        }
        setAvatarFile(file);
        setAvatarPreviewUrl((prev) => {
            if (prev) URL.revokeObjectURL(prev);
            return URL.createObjectURL(file);
        });
    };

    const savePersonalCard = async () => {
        if (!token || !user || !payload) return;
        setSavePersonalBusy(true);

        let anythingChanged = false;
        let hadError = false;
        const admin = payload.user.role === 'business_admin';

        try {
            // ── 1. Profile photo ───────────────────────────────────────────
            if (avatarFile) {
                const fd = new FormData();
                fd.append('avatar', avatarFile);
                const r = await fetch(`${API_URL}/api/user/me/avatar`, {
                    method: 'POST',
                    headers: { Authorization: `Bearer ${token}` },
                    body: fd,
                });
                const data = await r.json().catch(() => ({}));
                if (!r.ok) {
                    toast.error((data as { message?: string }).message || 'Could not upload photo');
                    hadError = true;
                } else {
                    const pic = (data as { profilePicture?: string }).profilePicture;
                    if (pic) {
                        const bust = Date.now();
                        avatarCacheBustRef.current = bust;
                        const freshPic = `${pic.split('?')[0]}?v=${bust}`;
                        setUserPartial({ id: user.id, email: user.email, role: user.role, profilePicture: freshPic });
                    }
                    anythingChanged = true;
                }
            }

            // ── 2. Display name (available to all roles) ───────────────────
            if (!hadError) {
                const trimmedName = nameDraft.trim();
                const prevName = (payload.user.name ?? '').trim();
                if (trimmedName !== prevName) {
                    const r = await fetch(`${API_URL}/api/user/me`, {
                        method: 'PATCH',
                        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
                        body: JSON.stringify({ name: trimmedName }),
                    });
                    const data = await r.json().catch(() => ({}));
                    if (!r.ok) {
                        toast.error((data as { message?: string }).message || 'Could not update display name');
                        hadError = true;
                    } else {
                        setUserPartial({ id: user.id, email: user.email, role: user.role, name: trimmedName || null });
                        anythingChanged = true;
                    }
                }
            }

            // ── 3. Workspace name (admin only) ─────────────────────────────
            if (!hadError) {
                const trimmedWs = workspaceDraft.trim();
                if (admin && payload.tenant && trimmedWs && trimmedWs !== payload.tenant.name) {
                    const r = await fetch(`${API_URL}/api/tenant/workspace`, {
                        method: 'PATCH',
                        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
                        body: JSON.stringify({ workspaceName: trimmedWs }),
                    });
                    const data = await r.json().catch(() => ({}));
                    if (!r.ok) {
                        toast.error((data as { message?: string }).message || 'Could not update workspace name');
                        hadError = true;
                    } else {
                        anythingChanged = true;
                    }
                }
            }

            if (!hadError) {
                toast.success(anythingChanged ? 'Saved' : 'No changes to save');
                if (avatarPreviewUrl) URL.revokeObjectURL(avatarPreviewUrl);
                setAvatarPreviewUrl(null);
                setAvatarFile(null);
                setPersonalEdit(false);
                if (avatarInputRef.current) avatarInputRef.current.value = '';
            }
        } catch {
            toast.error('Failed to save');
            // Clear cache-bust ref so a future fetchAll does not apply a stale timestamp.
            avatarCacheBustRef.current = null;
        } finally {
            // Always re-fetch so the UI matches the server state, even on partial failure.
            await fetchAll();
            setSavePersonalBusy(false);
        }
    };

    const saveWorkspaceCurrency = async (code: string) => {
        if (!token) return;
        setSavingCurrency(true);
        try {
            const r = await fetch(`${API_URL}/api/tenant/workspace`, {
                method: 'PATCH',
                headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
                // Keep ledger and reporting in sync  - single source of truth for the workspace
                body: JSON.stringify({ reportingCurrency: code, ledgerCurrency: code }),
            });
            if (!r.ok) {
                const d = await r.json().catch(() => ({}));
                toast.error((d as { message?: string }).message || 'Could not save currency');
                return;
            }
            setWorkspaceCurrency(code);
            toast.success(`Workspace currency set to ${code}`);
        } catch {
            toast.error('Failed to save currency');
        } finally {
            setSavingCurrency(false);
        }
    };

    const sendInvite = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!token) return;
        setInviteBusy(true);
        try {
            const r = await fetch(`${API_URL}/api/tenant/invites`, {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${token}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    email: inviteEmail.trim(),
                }),
            });
            const data = await r.json();
            if (!r.ok) {
                toast.error(data.message || 'Could not send invite');
                return;
            }
            toast.success(
                data.emailSent
                    ? 'Invite email sent. They can accept the link to set their password.'
                    : 'Invite created - email delivery is off (check backend logs for the link).',
            );
            setInviteEmail('');
            fetchAll();
        } catch {
            toast.error('Failed to send invite');
        } finally {
            setInviteBusy(false);
        }
    };

    const cancelInvite = async (id: string) => {
        if (!token || !confirm('Cancel this pending invitation?')) return;
        try {
            const r = await fetch(`${API_URL}/api/tenant/invites/${id}`, {
                method: 'DELETE',
                headers: { Authorization: `Bearer ${token}` },
            });
            const data = await r.json();
            if (!r.ok) {
                toast.error(data.message || 'Could not cancel');
                return;
            }
            toast.success('Invite cancelled');
            fetchAll();
        } catch {
            toast.error('Failed to cancel');
        }
    };

    const requestRemoveMember = (m: Member) => {
        setRemoveMemberTarget(m);
        setRemoveConfirmEmail('');
    };

    const executeRemoveMember = async () => {
        if (!token || !removeMemberTarget) return;
        setRemoveMemberBusy(true);
        try {
            const r = await fetch(`${API_URL}/api/tenant/members/${removeMemberTarget.id}`, {
                method: 'DELETE',
                headers: { Authorization: `Bearer ${token}` },
            });
            const data = await r.json();
            if (!r.ok) {
                toast.error(data.message || 'Could not remove');
                return;
            }
            toast.success('Member removed');
            setRemoveMemberTarget(null);
            setRemoveConfirmEmail('');
            fetchAll();
            if (auditModalOpen) void fetchAudit();
        } catch {
            toast.error('Failed to remove');
        } finally {
            setRemoveMemberBusy(false);
        }
    };

    const suspendTeammate = async (m: Member) => {
        if (!token) return;
        setTeamBusyId(m.id);
        try {
            const r = await fetch(`${API_URL}/api/tenant/members/${m.id}/suspend`, {
                method: 'PATCH',
                headers: { Authorization: `Bearer ${token}` },
            });
            const data = await r.json();
            if (!r.ok) {
                toast.error(data.message || 'Could not suspend');
                return;
            }
            toast.success('Member suspended - they cannot sign in until reactivated.');
            fetchAll();
            if (auditModalOpen) void fetchAudit();
        } catch {
            toast.error('Failed to suspend');
        } finally {
            setTeamBusyId(null);
        }
    };

    const resumeTeammate = async (m: Member) => {
        if (!token) return;
        setTeamBusyId(m.id);
        try {
            const r = await fetch(`${API_URL}/api/tenant/members/${m.id}/resume`, {
                method: 'PATCH',
                headers: { Authorization: `Bearer ${token}` },
            });
            const data = await r.json();
            if (!r.ok) {
                toast.error(data.message || 'Could not reactivate');
                return;
            }
            toast.success('Member can sign in again.');
            fetchAll();
            if (auditModalOpen) void fetchAudit();
        } catch {
            toast.error('Failed to reactivate');
        } finally {
            setTeamBusyId(null);
        }
    };

    const saveInviteDomainPolicy = async (restrict: boolean) => {
        if (!token) return;
        setInvitePolicyBusy(true);
        try {
            const r = await fetch(`${API_URL}/api/tenant/invite-domain-policy`, {
                method: 'PATCH',
                headers: {
                    Authorization: `Bearer ${token}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ restrictInvitesToWorkDomain: restrict }),
            });
            const data = await r.json().catch(() => ({}));
            if (!r.ok) {
                toast.error((data as { message?: string }).message || 'Could not update invite policy');
                return;
            }
            if (restrict) {
                toast.success(
                    `Invites limited to @${(data as { allowedEmailDomain?: string }).allowedEmailDomain || 'your domain'}`,
                );
            } else {
                toast.success('Invites can use any email domain');
            }
            fetchAll();
        } catch {
            toast.error('Failed to update policy');
        } finally {
            setInvitePolicyBusy(false);
        }
    };

    if (loading || !payload) {
        return <ProfileSkeleton />;
    }

    const u = payload.user;
    const isAdmin = u.role === 'business_admin';
    const isSoloTenant = payload.tenant?.registrationType === 'solo';
    /** Company (or legacy) workspaces can use invites; solo cannot. */
    const tenantSupportsInvites = Boolean(payload.tenant) && !isSoloTenant;
    const canSendInvites = isAdmin && tenantSupportsInvites;
    const adminEmailDomain = domainFromEmail(u.email);
    const inviteDomainLocked = Boolean(payload.tenant?.allowedEmailDomain);

    return (
        <AnimatedPage className="max-w-3xl mx-auto px-4 sm:px-6 py-10 pb-20">
            <PageBackNav to="/dashboard" label="Back to Dashboard" />

            <h1 className="text-3xl font-bold text-ocean-navy tracking-tight mb-2">Profile & workspace</h1>
            <p className="text-ocean-deep/90 mb-10 text-sm sm:text-base">
                {isAdmin
                    ? tenantSupportsInvites
                        ? 'Your account details, workspace settings, team management, and activity audit. Invite colleagues when your organization is ready.'
                        : isSoloTenant
                          ? 'Your personal account and individual workspace. Teammates and email invites apply to company workspaces only.'
                          : 'Your account details and workspace.'
                    : 'Your personal profile and read-only workspace summary. Subscription changes, invites, and billing are handled by a workspace admin.'}
            </p>

            <section className="relative rounded-2xl border border-ocean-sky/50 bg-white/90 shadow-ocean-card p-6 mb-8 overflow-hidden transition-[box-shadow] group/personal">
                <input
                    ref={avatarInputRef}
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    className="hidden"
                    aria-hidden="true"
                    onChange={onAvatarPicked}
                />

                {!personalEdit ? (
                    <div
                        className="pointer-events-none absolute inset-0 z-[1] rounded-[inherit] opacity-0 transition-opacity duration-200 ease-out group-hover/personal:opacity-100 bg-ocean-deep/[0.035] ring-1 ring-inset ring-ocean-navy/10"
                        aria-hidden
                    />
                ) : null}

                <div className="relative z-[2]">
                    <div className="flex items-start justify-between gap-3 mb-4">
                        <h2 className="text-lg font-semibold text-ocean-navy flex items-center gap-2">
                            <Mail className="h-5 w-5 text-ocean-sky shrink-0" />
                            Personal
                        </h2>
                        <div className="flex items-center gap-2 shrink-0">
                            {!personalEdit ? (
                                <button
                                    type="button"
                                    onClick={enterPersonalEdit}
                                    className="inline-flex items-center justify-center rounded-xl border border-ocean-sky/50 bg-white/95 p-2.5 text-ocean-navy shadow-sm hover:bg-ocean-powder/80 hover:border-ocean-rich/30 focus-ocean transition-colors"
                                    title="Edit workspace name and profile photo"
                                >
                                    <Pencil className="h-4 w-4 shrink-0" aria-hidden />
                                    <span className="sr-only">Edit workspace name and profile photo</span>
                                </button>
                            ) : (
                                <>
                                    <button
                                        type="button"
                                        onClick={() => cancelPersonalEdit()}
                                        disabled={savePersonalBusy}
                                        className="inline-flex items-center justify-center rounded-xl border border-ocean-sky/50 bg-white/95 p-2.5 text-ocean-navy shadow-sm hover:bg-red-50 hover:border-red-200 focus-ocean transition-colors disabled:opacity-50"
                                        title="Cancel"
                                    >
                                        <X className="h-4 w-4 shrink-0" aria-hidden />
                                        <span className="sr-only">Cancel</span>
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => void savePersonalCard()}
                                        disabled={savePersonalBusy}
                                        className="inline-flex items-center gap-2 rounded-xl bg-ocean-navy px-3 py-2 text-sm font-semibold text-white shadow-ocean-sm hover:bg-ocean-sky hover:text-ocean-navy disabled:opacity-50 transition-colors"
                                    >
                                        {savePersonalBusy ? (
                                            'Saving…'
                                        ) : (
                                            <>
                                                <Check className="h-4 w-4 shrink-0" aria-hidden />
                                                Save
                                            </>
                                        )}
                                    </button>
                                </>
                            )}
                        </div>
                    </div>

                    <div className={`flex flex-col sm:flex-row gap-6 ${!personalEdit ? 'sm:cursor-default' : ''}`}>
                        <div className="shrink-0">
                            <div className="h-28 w-28 rounded-xl border-2 border-ocean-sky/45 bg-ocean-powder/70 overflow-hidden flex items-center justify-center shadow-inner ring-2 ring-transparent group-hover/personal:ring-ocean-deep/15 ring-offset-2 ring-offset-white transition-all cursor-default">
                                {(avatarPreviewUrl ?? resolveUploadUrl(u.profilePicture)) ? (
                                    <img
                                        src={avatarPreviewUrl ?? resolveUploadUrl(u.profilePicture) ?? ''}
                                        alt=""
                                        className="h-full w-full object-cover"
                                    />
                                ) : (
                                    <span className="text-xl font-bold text-ocean-deep/65 tabular-nums">
                                        {displayInitials(u.name, u.email)}
                                    </span>
                                )}
                            </div>
                            {personalEdit ? (
                                <button
                                    type="button"
                                    onClick={() => avatarInputRef.current?.click()}
                                    title="JPEG, PNG or WebP — max 2 MB"
                                    className="mt-3 text-xs font-semibold text-ocean-sky hover:text-ocean-navy underline-offset-4 hover:underline cursor-pointer"
                                >
                                    Change photo…
                                </button>
                            ) : null}
                        </div>

                        <div className="flex-1 space-y-3 text-sm cursor-default">
                            <p>
                                <span className="text-ocean-deep/70 block text-[11px] font-semibold uppercase tracking-wide mb-1">
                                    Workspace name
                                </span>
                                {personalEdit ? (
                                    isAdmin && payload.tenant ? (
                                        <input
                                            type="text"
                                            value={workspaceDraft}
                                            onChange={(e) => setWorkspaceDraft(e.target.value)}
                                            maxLength={120}
                                            autoComplete="off"
                                            aria-label="Workspace name"
                                            className="w-full rounded-lg border border-ocean-rich/35 bg-white px-3 py-2 text-ocean-deep text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-ocean-rich/25 focus:border-ocean-rich"
                                        />
                                    ) : (
                                        <span className="font-medium text-ocean-deep">{payload.tenant?.name ?? '-'}</span>
                                    )
                                ) : (
                                    <span className="font-medium text-ocean-deep">{payload.tenant?.name ?? '-'}</span>
                                )}
                                {!personalEdit && !payload.tenant ? (
                                    <span className="font-medium text-ocean-deep/55">No workspace attached</span>
                                ) : null}
                            </p>
                            <p>
                                <span className="text-ocean-deep/70 block text-[11px] font-semibold uppercase tracking-wide mb-1">
                                    Display name
                                </span>
                                {personalEdit ? (
                                    <input
                                        type="text"
                                        value={nameDraft}
                                        onChange={(e) => setNameDraft(e.target.value)}
                                        maxLength={120}
                                        placeholder="Your full name"
                                        autoComplete="name"
                                        aria-label="Display name"
                                        className="w-full rounded-lg border border-ocean-rich/35 bg-white px-3 py-2 text-ocean-deep text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-ocean-rich/25 focus:border-ocean-rich"
                                    />
                                ) : (
                                    <span className="font-medium text-ocean-deep">{u.name?.trim() || '-'}</span>
                                )}
                            </p>
                            <div className="pt-3 border-t border-ocean-sky/25 space-y-2">
                                <p>
                                    <span className="text-ocean-deep/70">Email</span>
                                    <span className="block font-medium text-ocean-deep">{u.email}</span>
                                </p>
                                <p>
                                    <span className="text-ocean-deep/70">Sign-in method</span>
                                    <span className="block font-medium capitalize text-ocean-deep">
                                        {u.authProvider === 'google' ? 'Google' : 'Email & password'}
                                    </span>
                                </p>
                                <p>
                                    <span className="text-ocean-deep/70 block">Role</span>
                                    <span className="font-medium capitalize text-ocean-deep inline-flex items-center gap-2 mt-1">
                                        <Shield className="h-4 w-4 text-ocean-sky shrink-0" aria-hidden />
                                        {roleLabel(u.role)}
                                    </span>
                                </p>
                            </div>
                        </div>
                    </div>
                </div>
            </section>

            {payload.tenant && (
                <section className="rounded-2xl border border-ocean-sky/50 bg-white/90 shadow-ocean-card p-6 mb-8">
                    <h2 className="text-lg font-semibold text-ocean-navy flex items-center gap-2 mb-4">
                        <Building2 className="h-5 w-5 text-ocean-sky" />
                        {isSoloTenant ? 'Workspace' : 'Organization'}
                    </h2>
                    <div className="grid sm:grid-cols-2 gap-4 text-sm">
                        <div>
                            <p className="text-ocean-deep/70">Workspace type</p>
                            <p className="font-medium text-ocean-deep">
                                {payload.tenant.registrationType === 'solo' ? 'Individual' : 'Company / team'}
                            </p>
                        </div>
                        {isAdmin && (
                            <>
                                <div>
                                    <p className="text-ocean-deep/70">Catalog plan</p>
                                    <p className="font-medium capitalize text-ocean-deep">{payload.tenant.plan}</p>
                                </div>
                                {payload.tenant.allowedEmailDomain ? (
                                    <div className="sm:col-span-2">
                                        <p className="text-ocean-deep/70">Required email domain (invites)</p>
                                        <p className="font-medium text-ocean-deep">@{payload.tenant.allowedEmailDomain}</p>
                                    </div>
                                ) : null}
                                <div className="sm:col-span-2 pt-2 border-t border-ocean-sky/20">
                                    <p className="text-ocean-deep/70 text-[11px] font-semibold uppercase tracking-wide mb-2">
                                        Workspace currency
                                    </p>
                                    <div className="flex items-center gap-3 flex-wrap">
                                        <select
                                            value={workspaceCurrency}
                                            disabled={savingCurrency}
                                            onChange={(e) => void saveWorkspaceCurrency(e.target.value)}
                                            className="text-sm border border-ocean-ice rounded-lg px-3 py-2 bg-white font-medium text-ocean-navy disabled:opacity-60 focus:outline-none focus:ring-2 focus:ring-ocean-sky/40"
                                            aria-label="Workspace currency"
                                        >
                                            {['PKR','USD','EUR','GBP','INR','AED','SAR','CAD','AUD'].map((c) => (
                                                <option key={c} value={c}>{c}</option>
                                            ))}
                                        </select>
                                        {savingCurrency && <span className="text-xs text-ocean-deep/60">Saving…</span>}
                                    </div>
                                </div>
                            </>
                        )}
                    </div>
                </section>
            )}

            {payload.subscription && (
                <section className="rounded-2xl border border-ocean-sky/50 bg-white/90 shadow-ocean-card p-6 mb-8">
                    <h2 className="text-lg font-semibold text-ocean-navy flex items-center gap-2 mb-4">
                        <CreditCard className="h-5 w-5 text-ocean-sky" />
                        Subscription snapshot
                    </h2>
                    <p className="text-sm text-ocean-deep/75 mb-5">
                        {isAdmin
                            ? 'Manage billing from the Subscription page.'
                            : 'This is your workspace’s current plan for reference. Changing plans or payment methods is done by a workspace admin - you will not see upgrade or checkout options on your account.'}
                    </p>
                    <div className="flex flex-wrap gap-4 text-sm">
                        <div>
                            <p className="text-ocean-deep/70">Plan</p>
                            <p className="font-semibold capitalize text-ocean-deep">{payload.subscription.plan}</p>
                        </div>
                        <div>
                            <p className="text-ocean-deep/70">Status</p>
                            <p className="font-semibold capitalize text-ocean-deep">{payload.subscription.status}</p>
                        </div>
                        {payload.subscription.currentPeriodEnd && (
                            <div>
                                <p className="text-ocean-deep/70">Renews</p>
                                <p className="font-medium text-ocean-deep">
                                    {new Date(payload.subscription.currentPeriodEnd).toLocaleDateString()}
                                </p>
                            </div>
                        )}
                    </div>
                </section>
            )}

            <section className="rounded-2xl border border-ocean-sky/50 bg-white/90 shadow-ocean-card p-6 mb-8">
                <h2 className="text-lg font-semibold text-ocean-navy flex items-center gap-2 mb-4">
                    <Users className="h-5 w-5 text-ocean-sky" />
                    Team
                </h2>
                {isAdmin ? (
                    <>
                <p className="text-sm text-ocean-deep/75 mb-5">
                    {isSoloTenant
                        ? 'This is your private workspace-you are the only member. Sharing and invites are disabled for individual accounts.'
                        : members.length <= 1
                          ? 'Add colleagues so each person signs in with their own account.'
                          : `${members.length} people in this workspace.`}
                </p>

                {canSendInvites && seats && (
                    <div
                        className={`mb-5 rounded-xl border px-4 py-3 text-xs ${
                            seats.limit !== -1 && seats.used + seats.pending >= seats.limit
                                ? 'border-amber-300 bg-amber-50/90 text-amber-950'
                                : 'border-ocean-sky/35 bg-ocean-powder/40 text-ocean-deep/90'
                        }`}
                    >
                        {seats.limit === -1 ? (
                            <p>
                                <strong className="text-ocean-navy">Seats:</strong> Unlimited on your {seats.plan} plan
                                ({seats.used} active workspace member{seats.used === 1 ? '' : 's'}
                                {seats.pending > 0 ? ` · ${seats.pending} pending invite(s)` : ''}).
                            </p>
                        ) : (
                            <p>
                                <strong className="text-ocean-navy">Seats ({seats.plan} plan):</strong>{' '}
                                <strong>{seats.used}</strong> active · <strong>{seats.pending}</strong> pending invites ·{' '}
                                <strong>{seats.limit}</strong> allowed.
                                {seats.used + seats.pending >= seats.limit ? (
                                    <span className="block mt-1.5 font-medium">
                                        At capacity - cancel a pending invite or upgrade to add more people.
                                    </span>
                                ) : (
                                    <span className="block mt-1.5 text-ocean-deep/75">
                                        {seats.limit - seats.used - seats.pending} seat(s) still available for new invites.
                                    </span>
                                )}
                            </p>
                        )}
                    </div>
                )}

                {canSendInvites && (
                    <div className="mb-6 rounded-xl border border-ocean-rich/25 bg-white/80 p-4 shadow-sm">
                        <p className="text-sm font-semibold text-ocean-navy flex items-center gap-2 mb-1">
                            <Shield className="h-4 w-4 text-ocean-rich shrink-0" />
                            Who can receive an invite?
                        </p>
                        <p className="text-xs text-ocean-deep/70 mb-3">
                            Joining still requires the secret invite link - this only limits which email addresses you may invite.
                        </p>
                        <div className="space-y-2">
                            <label
                                className={`flex gap-3 rounded-lg border p-3 cursor-pointer transition-colors ${
                                    !inviteDomainLocked
                                        ? 'border-ocean-rich bg-ocean-powder/40'
                                        : 'border-ocean-sky/40 hover:bg-ocean-powder/20'
                                } ${invitePolicyBusy ? 'opacity-60 pointer-events-none' : ''}`}
                            >
                                <input
                                    type="radio"
                                    name="invite-domain-mode"
                                    className="mt-1"
                                    checked={!inviteDomainLocked}
                                    onChange={() => void saveInviteDomainPolicy(false)}
                                    disabled={invitePolicyBusy}
                                />
                                <div>
                                    <p className="text-sm font-semibold text-ocean-navy">Any email domain</p>
                                    <p className="text-xs text-ocean-deep/70 mt-0.5">
                                        Useful for agencies, contractors, or partners on different mail systems.
                                    </p>
                                </div>
                            </label>
                            <label
                                className={`flex gap-3 rounded-lg border p-3 cursor-pointer transition-colors ${
                                    inviteDomainLocked
                                        ? 'border-ocean-rich bg-ocean-powder/40'
                                        : 'border-ocean-sky/40 hover:bg-ocean-powder/20'
                                } ${invitePolicyBusy ? 'opacity-60 pointer-events-none' : ''}`}
                            >
                                <input
                                    type="radio"
                                    name="invite-domain-mode"
                                    className="mt-1"
                                    checked={inviteDomainLocked}
                                    onChange={() => void saveInviteDomainPolicy(true)}
                                    disabled={invitePolicyBusy}
                                />
                                <div>
                                    <p className="text-sm font-semibold text-ocean-navy">
                                        Higher security - same company email only
                                    </p>
                                    <p className="text-xs text-ocean-deep/70 mt-0.5">
                                        Only addresses matching your sign-in domain
                                        {adminEmailDomain ? (
                                            <span className="font-mono text-ocean-navy"> @{adminEmailDomain}</span>
                                        ) : null}{' '}
                                        can be invited. Your admin account must use a work email (not Gmail, etc.).
                                    </p>
                                    {payload.tenant?.allowedEmailDomain && (
                                        <p className="text-[11px] text-ocean-deep/60 mt-1.5">
                                            Active rule: <span className="font-mono">@{payload.tenant.allowedEmailDomain}</span>
                                        </p>
                                    )}
                                </div>
                            </label>
                        </div>
                    </div>
                )}

                <ul className="divide-y divide-ocean-sky/25 border border-ocean-sky/30 rounded-xl overflow-hidden mb-6">
                    {members.map((m) => (
                        <li
                            key={m.id}
                            className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 px-4 py-3 bg-white/95"
                        >
                            <div>
                                <p className="font-medium text-ocean-deep">{m.name || m.email}</p>
                                {m.name && <p className="text-xs text-ocean-deep/65">{m.email}</p>}
                                <p className="text-xs text-ocean-deep/55 mt-0.5">
                                    {roleLabel(m.role)}
                                    {m.accountStatus !== 'active' ? ` · ${m.accountStatus}` : ''}
                                </p>
                            </div>
                            {canSendInvites &&
                                m.id !== u.id &&
                                (m.role !== 'business_admin' || adminsCount > 1) && (
                                <div className="flex flex-wrap items-center gap-2 shrink-0 self-start sm:self-auto">
                                    {m.accountStatus === 'suspended' ? (
                                        <button
                                            type="button"
                                            onClick={() => void resumeTeammate(m)}
                                            disabled={teamBusyId === m.id}
                                            className="text-xs font-semibold text-emerald-700 hover:underline disabled:opacity-50"
                                        >
                                            {teamBusyId === m.id ? 'Working…' : 'Reactivate'}
                                        </button>
                                    ) : (
                                        <button
                                            type="button"
                                            onClick={() => void suspendTeammate(m)}
                                            disabled={teamBusyId === m.id}
                                            className="text-xs font-semibold text-amber-800 hover:underline disabled:opacity-50"
                                        >
                                            {teamBusyId === m.id ? 'Working…' : 'Suspend'}
                                        </button>
                                    )}
                                    <button
                                        type="button"
                                        onClick={() => requestRemoveMember(m)}
                                        className="text-xs font-semibold text-red-700 hover:underline"
                                    >
                                        Remove
                                    </button>
                                </div>
                            )}
                        </li>
                    ))}
                </ul>

                {canSendInvites && pendingInvites.length > 0 && (
                    <ul className="mb-6 space-y-2">
                        <p className="text-xs font-semibold text-ocean-navy uppercase tracking-wide">Pending invites</p>
                        {pendingInvites.map((inv) => (
                            <li
                                key={inv.id}
                                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-ocean-sky/40 px-3 py-2 text-sm bg-ocean-powder/30"
                            >
                                <span className="text-ocean-deep font-medium">{inv.email}</span>
                                <span className="text-xs text-ocean-deep/65">
                                    Expires {new Date(inv.expiresAt).toLocaleDateString()}
                                </span>
                                {canSendInvites && (
                                    <button
                                        type="button"
                                        onClick={() => cancelInvite(inv.id)}
                                        className="text-xs font-semibold text-red-700 hover:underline"
                                    >
                                        Cancel
                                    </button>
                                )}
                            </li>
                        ))}
                    </ul>
                )}

                {canSendInvites ? (
                    <form onSubmit={sendInvite} className="space-y-4 border-t border-ocean-sky/30 pt-6">
                        <h3 className="text-sm font-semibold text-ocean-navy flex items-center gap-2">
                            <UserPlus className="h-4 w-4 text-ocean-sky" />
                            Invite by email
                        </h3>
                        <p className="text-sm text-ocean-deep/75">
                            We email a secure link; they accept the Terms, set a password, and join this workspace. Seats
                            and pending invites count against your plan limit.
                        </p>
                        <div className="flex flex-col sm:flex-row gap-3 sm:items-end">
                            <input
                                type="email"
                                required
                                placeholder="colleague@email.com"
                                autoComplete="off"
                                value={inviteEmail}
                                onChange={(e) => setInviteEmail(e.target.value)}
                                className="flex-1 rounded-lg border border-ocean-sky/80 px-3 py-2.5 text-sm text-ocean-deep focus:outline-none focus:ring-2 focus:ring-ocean-rich/25"
                            />
                            <button
                                type="submit"
                                disabled={inviteBusy}
                                className="rounded-lg bg-ocean-sky text-ocean-navy px-5 py-2.5 text-sm font-bold hover:bg-white hover:shadow-md border border-ocean-sky disabled:opacity-50 transition-colors shrink-0"
                            >
                                {inviteBusy ? 'Sending…' : 'Send invite'}
                            </button>
                        </div>
                    </form>
                ) : isSoloTenant ? (
                    <div className="border-t border-ocean-sky/30 pt-6 space-y-3 rounded-xl bg-ocean-powder/40 border border-ocean-sky/25 px-4 py-4">
                        <p className="text-sm font-semibold text-ocean-navy">Individual account</p>
                        <p className="text-sm text-ocean-deep/85 leading-relaxed">
                            Teammate invites and shared company seats are only available when you register as a <strong>Company / team</strong>{' '}
                            workspace. That keeps personal use separate from organizational billing and member management.
                        </p>
                        <p className="text-xs text-ocean-deep/70 leading-relaxed">
                            Need a team workspace? Create a new account and choose Company / team during sign-up (business email requirements may
                            apply in a future update).
                        </p>
                    </div>
                ) : (
                    <p className="text-sm text-ocean-deep/75 border-t border-ocean-sky/30 pt-6">
                        Ask your workspace admin to invite new members.
                    </p>
                )}
                    </>
                ) : (
                    <>
                        <p className="text-sm text-ocean-deep/75 mb-5 leading-relaxed">
                            {isSoloTenant
                                ? 'This is your private workspace-you are the only member.'
                                : 'People in your workspace. Invites, seats, and billing are managed by your workspace admin.'}
                        </p>
                        {!isSoloTenant && members.length > 0 && (
                            <ul className="divide-y divide-ocean-sky/25 border border-ocean-sky/30 rounded-xl overflow-hidden">
                                {members.map((m) => (
                                    <li key={m.id} className="px-4 py-3 bg-white/95">
                                        <p className="font-medium text-ocean-deep">{m.name || m.email}</p>
                                        <p className="text-xs text-ocean-deep/70">
                                            {roleLabel(m.role)}
                                            {m.accountStatus !== 'active' ? ` · ${m.accountStatus}` : ''}
                                        </p>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </>
                )}
            </section>

            {/* ── Active Sessions ──────────────────────────────────────────── */}
            <section className="rounded-2xl border border-ocean-sky/50 bg-white/90 shadow-ocean-card p-6 mb-8">
                <div className="flex flex-wrap items-start justify-between gap-4 mb-5">
                    <div>
                        <h2 className="text-lg font-semibold text-ocean-navy flex items-center gap-2">
                            <Monitor className="h-5 w-5 text-ocean-sky" />
                            Active sessions
                        </h2>
                        <p className="text-sm text-ocean-deep/70 mt-1">
                            Devices and browsers currently signed in to your account.
                        </p>
                    </div>
                    {sessions.filter(s => !s.isCurrent).length > 0 && (
                        <button
                            onClick={handleRevokeAll}
                            disabled={revokeAllBusy}
                            className="shrink-0 text-sm font-semibold text-red-600 hover:text-red-800 border border-red-200 hover:border-red-400 px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50"
                        >
                            {revokeAllBusy ? 'Revoking…' : 'Sign out all other sessions'}
                        </button>
                    )}
                </div>

                {sessionsLoading ? (
                    <div className="flex items-center gap-2 text-sm text-slate-400 py-4">
                        <Loader className="h-4 w-4 animate-spin" aria-hidden />
                        Loading sessions…
                    </div>
                ) : sessions.length === 0 ? (
                    <p className="text-sm text-slate-400 py-2">No active sessions found.</p>
                ) : (
                    <ul className="divide-y divide-slate-100 -mx-1">
                        {sessions.map(s => {
                            const isMobile = /iPhone|iPad|Android|Smartphone/i.test(s.deviceLabel);
                            return (
                                <li key={s.id} className="flex items-center gap-3 px-1 py-3">
                                    <div className="h-8 w-8 rounded-lg bg-slate-100 flex items-center justify-center shrink-0">
                                        {isMobile
                                            ? <Smartphone className="h-4 w-4 text-slate-500" aria-hidden />
                                            : <Monitor className="h-4 w-4 text-slate-500" aria-hidden />
                                        }
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-2 flex-wrap">
                                            <p className="text-sm font-semibold text-slate-800 truncate">
                                                {s.deviceLabel}
                                            </p>
                                            {s.isCurrent && (
                                                <span className="text-[10px] font-bold px-1.5 py-0.5 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-full">
                                                    This session
                                                </span>
                                            )}
                                        </div>
                                        <p className="text-xs text-slate-400 mt-0.5">
                                            {s.ipAddress && `${s.ipAddress} · `}
                                            Last active {new Date(s.lastSeenAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                                        </p>
                                    </div>
                                    {!s.isCurrent && (
                                        <button
                                            onClick={() => handleRevokeSession(s.id)}
                                            title="Revoke this session"
                                            className="shrink-0 text-xs font-semibold text-red-500 hover:text-red-700 hover:bg-red-50 px-2.5 py-1 rounded-lg transition-colors border border-red-100 hover:border-red-300"
                                        >
                                            Sign out
                                        </button>
                                    )}
                                </li>
                            );
                        })}
                    </ul>
                )}
            </section>

            {isAdmin && (
                <section className="rounded-2xl border border-ocean-sky/50 bg-white/90 shadow-ocean-card p-6 mb-8">
                    <h2 className="text-lg font-semibold text-ocean-navy flex items-center gap-2 mb-4">
                        <ClipboardList className="h-5 w-5 text-ocean-sky" />
                        Workspace activity
                    </h2>
                    <p className="text-sm text-ocean-deep/75 mb-5 leading-relaxed">
                        Audit trail for this workspace: sign-ins, sign-outs, invites, settings, agents, and members. Open
                        the log to view <strong>everyone</strong> or switch tabs to a <strong>specific person</strong>.
                    </p>
                    <button
                        type="button"
                        onClick={() => {
                            setAuditTabUserId(null);
                            setAuditModalOpen(true);
                        }}
                        className="rounded-lg bg-ocean-navy text-white px-5 py-2.5 text-sm font-semibold hover:bg-ocean-deep transition-colors shadow-sm border border-ocean-navy/20 w-full sm:w-auto"
                    >
                        View workspace activity
                    </button>
                </section>
            )}

            {isAdmin && auditModalOpen && (
                <div
                    className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4"
                    role="dialog"
                    aria-modal="true"
                    aria-labelledby="audit-modal-title"
                    onClick={(e) => {
                        if (e.target === e.currentTarget) setAuditModalOpen(false);
                    }}
                >
                    <div className="bg-white rounded-2xl shadow-2xl max-w-6xl w-full max-h-[92vh] flex flex-col border border-ocean-sky/80">
                        <div className="flex items-start justify-between gap-3 p-5 pb-3 border-b border-ocean-sky/25 shrink-0">
                            <div className="min-w-0 flex-1 pr-2">
                                <h3 id="audit-modal-title" className="text-lg font-semibold text-ocean-navy flex items-center gap-2">
                                    <ClipboardList className="h-5 w-5 text-ocean-sky shrink-0" />
                                    Workspace activity
                                </h3>
                                <p className="text-xs text-ocean-deep/70 mt-1 leading-relaxed">
                                    Filter by actor, then export a PDF for compliance or internal review. The file lists up
                                    to the most recent events shown here (newest first).
                                </p>
                            </div>
                            <div className="flex items-center gap-1 shrink-0">
                                <button
                                    type="button"
                                    onClick={() => void exportAuditPdf()}
                                    disabled={auditPdfBusy || auditLoading || auditEntries.length === 0}
                                    className="inline-flex items-center gap-1.5 rounded-lg border border-ocean-sky bg-ocean-powder/90 px-3 py-2 text-xs font-semibold text-ocean-navy hover:bg-white disabled:opacity-45 disabled:cursor-not-allowed transition-colors"
                                >
                                    {auditPdfBusy ? (
                                        <Loader className="h-3.5 w-3.5 animate-spin" />
                                    ) : (
                                        <FileDown className="h-3.5 w-3.5" />
                                    )}
                                    Download PDF
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setAuditModalOpen(false)}
                                    className="rounded-lg p-2 text-ocean-deep/70 hover:bg-ocean-powder hover:text-ocean-navy transition-colors"
                                    aria-label="Close"
                                >
                                    <X className="h-5 w-5" />
                                </button>
                            </div>
                        </div>
                        <div className="px-5 pt-3 shrink-0">
                            <div className="flex gap-1 overflow-x-auto pb-2 border-b border-ocean-sky/25">
                                <button
                                    type="button"
                                    onClick={() => setAuditTabUserId(null)}
                                    className={`shrink-0 px-3 py-1.5 rounded-lg text-xs font-semibold ${
                                        auditTabUserId === null
                                            ? 'bg-ocean-navy text-white'
                                            : 'bg-ocean-powder text-ocean-deep hover:bg-ocean-ice'
                                    }`}
                                >
                                    Everyone
                                </button>
                                {members.map((m) => (
                                    <button
                                        key={m.id}
                                        type="button"
                                        onClick={() => setAuditTabUserId(String(m.id))}
                                        title={m.name ? `${m.name} (${m.email})` : m.email}
                                        className={`shrink-0 px-3 py-1.5 rounded-lg text-xs font-semibold max-w-[200px] truncate ${
                                            auditTabUserId === String(m.id)
                                                ? 'bg-ocean-navy text-white'
                                                : 'bg-ocean-powder text-ocean-deep hover:bg-ocean-ice'
                                        }`}
                                    >
                                        {m.name || m.email}
                                    </button>
                                ))}
                            </div>
                        </div>
                        <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4">
                            {auditLoading ? (
                                <div className="flex justify-center py-12">
                                    <Loader className="h-8 w-8 animate-spin text-ocean-sky" />
                                </div>
                            ) : auditEntries.length === 0 ? (
                                <p className="text-sm text-ocean-deep/70 py-4">No events recorded yet.</p>
                            ) : (
                                <ul className="space-y-3 text-sm pr-1">
                                    {auditEntries.map((e) => {
                                        const metaLine = formatAuditMetadata(e.metadata);
                                        return (
                                            <li
                                                key={e.id}
                                                className="rounded-xl border border-ocean-sky/35 bg-white shadow-sm overflow-hidden flex"
                                            >
                                                <div className="w-1 shrink-0 bg-ocean-sky" aria-hidden />
                                                <div className="flex-1 min-w-0 px-4 py-3">
                                                    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                                                        <p className="font-semibold text-ocean-navy leading-snug">
                                                            {auditActionLabel(e.action)}
                                                        </p>
                                                        <time
                                                            dateTime={e.createdAt}
                                                            className="text-[11px] tabular-nums text-ocean-deep/60 shrink-0"
                                                        >
                                                            {new Date(e.createdAt).toLocaleString()}
                                                        </time>
                                                    </div>
                                                    <p className="text-xs text-ocean-deep/80 mt-1">
                                                        <span className="font-medium text-ocean-navy/90">Actor: </span>
                                                        {e.actorName
                                                            ? `${e.actorName} (${e.actorEmail || e.actorId})`
                                                            : e.actorEmail || e.actorId}
                                                    </p>
                                                    {(e.targetType || e.targetId) && (
                                                        <p className="text-[11px] text-ocean-deep/55 mt-1 font-mono break-all">
                                                            {e.targetType && <span>Target: {e.targetType} </span>}
                                                            {e.targetId && <span>· {e.targetId}</span>}
                                                        </p>
                                                    )}
                                                    {metaLine ? (
                                                        <div className="mt-2 rounded-lg bg-white/80 border border-ocean-sky/25 px-2.5 py-2 text-[11px] text-ocean-deep/75 leading-relaxed">
                                                            {metaLine}
                                                        </div>
                                                    ) : null}
                                                </div>
                                            </li>
                                        );
                                    })}
                                </ul>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {removeMemberTarget && (
                <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
                    <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-6 border border-ocean-sky/80">
                        <div className="flex items-center justify-center h-12 w-12 rounded-full bg-red-100 mb-4 mx-auto">
                            <Trash2 className="h-6 w-6 text-red-600" />
                        </div>
                        <h3 className="text-lg font-semibold text-ocean-navy mb-2 text-center">Remove from workspace</h3>
                        <p className="text-sm text-ocean-deep mb-2 text-left">
                            This revokes access immediately. They will not be able to sign in to this workspace. Type their
                            email{' '}
                            <strong className="text-ocean-navy break-all">{removeMemberTarget.email}</strong> to confirm.
                        </p>
                        <input
                            type="email"
                            value={removeConfirmEmail}
                            onChange={(e) => setRemoveConfirmEmail(e.target.value)}
                            placeholder="Email address"
                            className="w-full mt-2 mb-4 px-3 py-2 border border-ocean-ice rounded-xl text-ocean-navy text-sm focus:outline-none focus:ring-2 focus:ring-ocean-sky"
                            autoComplete="off"
                        />
                        <div className="flex gap-3">
                            <button
                                type="button"
                                onClick={() => {
                                    setRemoveMemberTarget(null);
                                    setRemoveConfirmEmail('');
                                }}
                                disabled={removeMemberBusy}
                                className="flex-1 px-4 py-2 border border-ocean-sky rounded-xl text-ocean-navy hover:bg-ocean-powder transition-colors disabled:opacity-50"
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                onClick={() => void executeRemoveMember()}
                                disabled={
                                    removeMemberBusy ||
                                    removeConfirmEmail.trim().toLowerCase() !==
                                        removeMemberTarget.email.trim().toLowerCase()
                                }
                                className="flex-1 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors disabled:opacity-50"
                            >
                                {removeMemberBusy ? 'Removing…' : 'Remove'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </AnimatedPage>
    );
}
