import { Tenant } from '../models';

/** Workspace ledger currency wins over per-agent default. */
export async function resolveWorkspaceCurrency(
    tenantId: string,
    agentCurrency?: string,
): Promise<string> {
    try {
        const tenant = await Tenant.findById(tenantId)
            .select('ledgerCurrency reportingCurrency')
            .lean();
        if (tenant?.ledgerCurrency) return tenant.ledgerCurrency;
        if (tenant?.reportingCurrency) return tenant.reportingCurrency;
    } catch {
        /* fall through */
    }
    return agentCurrency || 'USD';
}
