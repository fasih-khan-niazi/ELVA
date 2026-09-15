import { Request } from 'express';
import mongoose from 'mongoose';
import { WorkspaceAuditLog, WorkspaceAuditAction } from '../models/WorkspaceAuditLog';

function clientIp(req: Pick<Request, 'ip'> | undefined): string | undefined {
    if (!req?.ip) return undefined;
    return String(req.ip);
}

function ua(req: Pick<Request, 'headers'> | undefined): string | undefined {
    const h = req?.headers?.['user-agent'];
    return typeof h === 'string' ? h.slice(0, 512) : undefined;
}

/**
 * Best-effort persistence; never throws to callers (audit must not break primary flows).
 */
export function recordWorkspaceAudit(
    req: Pick<Request, 'ip' | 'headers'> | undefined,
    opts: {
        tenantId: string;
        actorId: string;
        action: WorkspaceAuditAction;
        targetType?: string;
        targetId?: string;
        metadata?: Record<string, unknown>;
    },
): void {
    if (!mongoose.Types.ObjectId.isValid(opts.tenantId) || !mongoose.Types.ObjectId.isValid(opts.actorId)) {
        return;
    }
    void WorkspaceAuditLog.create({
        tenantId: new mongoose.Types.ObjectId(opts.tenantId),
        actorId: new mongoose.Types.ObjectId(opts.actorId),
        action: opts.action,
        targetType: opts.targetType,
        targetId: opts.targetId,
        metadata: opts.metadata,
        ip: clientIp(req),
        userAgent: ua(req),
    }).catch((e: unknown) => {
        console.warn('[workspace-audit]', e instanceof Error ? e.message : e);
    });
}
