import { formatAuditMetadata } from './formatAuditMetadata';

export type AuditPdfEntryInput = {
    id: string;
    action: string;
    actionLabel: string;
    createdAt: string;
    actorLine: string;
    metadata?: Record<string, unknown>;
};

function slugFilename(d: Date): string {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `elva-workspace-activity-${y}-${m}-${day}.pdf`;
}

/**
 * Builds a landscape PDF table of workspace audit events (dynamic import keeps initial bundle smaller).
 */
export async function downloadWorkspaceAuditPdf(opts: {
    workspaceName: string;
    filterLabel: string;
    entries: AuditPdfEntryInput[];
}): Promise<void> {
    const [{ jsPDF }, autoTableMod] = await Promise.all([import('jspdf'), import('jspdf-autotable')]);
    const autoTable = autoTableMod.default;

    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
    const generatedAt = new Date();

    doc.setFillColor(10, 40, 66);
    doc.rect(0, 0, 297, 22, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.text('ELVA - Workspace activity report', 10, 14);

    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    doc.text(`Workspace: ${opts.workspaceName}`, 10, 19);

    doc.setTextColor(40, 40, 40);
    doc.setFontSize(9);
    doc.text(`Filter: ${opts.filterLabel}`, 10, 28);
    doc.setTextColor(100, 100, 100);
    doc.text(`Generated (local time): ${generatedAt.toLocaleString()}`, 10, 33);
    doc.text(`Events: ${opts.entries.length}`, 10, 38);

    const body = opts.entries.map((e) => [
        e.createdAt,
        e.action,
        e.actionLabel,
        e.actorLine,
        formatAuditMetadata(e.metadata) || '-',
    ]);

    autoTable(doc, {
        startY: 43,
        head: [['When (local)', 'Action code', 'Summary', 'Actor', 'Details']],
        body,
        styles: { fontSize: 7, cellPadding: 1.2, valign: 'top', overflow: 'linebreak' },
        headStyles: {
            fillColor: [12, 74, 110],
            textColor: 255,
            fontStyle: 'bold',
        },
        alternateRowStyles: { fillColor: [245, 250, 252] },
        columnStyles: {
            0: { cellWidth: 34 },
            1: { cellWidth: 38 },
            2: { cellWidth: 42 },
            3: { cellWidth: 48 },
            4: { cellWidth: 'auto' as unknown as number },
        },
        margin: { left: 10, right: 10 },
    });

    doc.setFontSize(7);
    doc.setTextColor(120, 120, 120);
    doc.text(
        'This export reflects events stored in ELVA at export time. Retention and completeness depend on workspace settings and product configuration.',
        10,
        doc.internal.pageSize.getHeight() - 6,
        { maxWidth: 277 },
    );

    doc.save(slugFilename(generatedAt));
}
