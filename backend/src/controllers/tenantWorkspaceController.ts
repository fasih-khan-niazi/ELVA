import { Response } from 'express';
import { AuthRequest } from '../middleware/authMiddleware';
import mongoose from 'mongoose';
import { Tenant } from '../models';
import { parseReportingCurrency, REPORTING_CURRENCY_CODES } from '../constants/reportingCurrency';
import { recordWorkspaceAudit } from '../services/auditService';

const MAX_WORKSPACE_LEN = 120;

/**
 * PATCH body: `{ workspaceName?: string, reportingCurrency?: string, ledgerCurrency?: string }` - business_admin only.
 * At least one field required.
 * `reportingCurrency` = tenant-wide display ISO code.
 * `ledgerCurrency` = how stored order totals are interpreted (usually matches catalog pricing).
 */
export const patchWorkspace = async (req: AuthRequest, res: Response) => {
    try {
        const { workspaceName, reportingCurrency, ledgerCurrency } = req.body as {
            workspaceName?: string;
            reportingCurrency?: string;
            ledgerCurrency?: string;
        };

        const tid = req.user!.tenantId;
        if (!tid || !mongoose.Types.ObjectId.isValid(tid)) {
            return res.status(400).json({ message: 'No workspace on this account.' });
        }

        const tenant = await Tenant.findById(new mongoose.Types.ObjectId(tid));
        if (!tenant) {
            return res.status(404).json({ message: 'Workspace not found.' });
        }

        let changed = false;
        const updates: Record<string, unknown> = {};

        if (workspaceName !== undefined) {
            if (typeof workspaceName !== 'string') {
                return res.status(400).json({ message: 'workspaceName must be a string.' });
            }
            const trimmed = workspaceName.trim();
            if (!trimmed) {
                return res.status(400).json({ message: 'Workspace name cannot be empty.' });
            }
            if (trimmed.length > MAX_WORKSPACE_LEN) {
                return res.status(400).json({ message: `Workspace name must be at most ${MAX_WORKSPACE_LEN} characters.` });
            }
            tenant.name = trimmed;
            changed = true;
            updates.workspaceName = trimmed;
        }

        if (reportingCurrency !== undefined) {
            const code = parseReportingCurrency(reportingCurrency);
            if (!code) {
                return res.status(400).json({
                    message: `reportingCurrency must be one of: ${REPORTING_CURRENCY_CODES.join(', ')}`,
                });
            }
            tenant.reportingCurrency = code;
            changed = true;
            updates.reportingCurrency = code;
        }

        if (ledgerCurrency !== undefined) {
            const code = parseReportingCurrency(ledgerCurrency);
            if (!code) {
                return res.status(400).json({
                    message: `ledgerCurrency must be one of: ${REPORTING_CURRENCY_CODES.join(', ')}`,
                });
            }
            tenant.ledgerCurrency = code;
            changed = true;
            updates.ledgerCurrency = code;
        }

        if (!changed) {
            return res.status(400).json({
                message: 'Provide workspaceName, reportingCurrency, and/or ledgerCurrency.',
            });
        }

        await tenant.save();

        recordWorkspaceAudit(req, {
            tenantId: tid,
            actorId: req.user!.userId,
            action: 'workspace.update',
            targetType: 'tenant',
            targetId: tid,
            metadata: { updates },
        });

        res.json({
            tenant: {
                id: String(tenant._id),
                name: tenant.name,
                plan: tenant.plan,
                registrationType: tenant.registrationType,
                allowedEmailDomain: tenant.allowedEmailDomain ?? null,
                reportingCurrency: tenant.reportingCurrency,
                ledgerCurrency: tenant.ledgerCurrency ?? 'PKR',
                createdAt: tenant.createdAt,
            },
        });
    } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : 'Server error';
        console.error('[patchWorkspace]', msg);
        res.status(500).json({ message: msg });
    }
};

/** @deprecated Use patchWorkspace - kept for route import stability */
export const patchWorkspaceName = patchWorkspace;
