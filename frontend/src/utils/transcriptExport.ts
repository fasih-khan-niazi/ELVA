const PDF = {
    navy: [10, 40, 66] as [number, number, number],
    ocean: [12, 74, 110] as [number, number, number],
    sky: [14, 165, 233] as [number, number, number],
    powder: [240, 249, 255] as [number, number, number],
    mist: [224, 242, 254] as [number, number, number],
    slate: [100, 116, 139] as [number, number, number],
    text: [15, 23, 42] as [number, number, number],
    white: [255, 255, 255] as [number, number, number],
    green: [22, 163, 74] as [number, number, number],
    red: [220, 38, 38] as [number, number, number],
    amber: [146, 64, 14] as [number, number, number],
    amberBg: [255, 251, 235] as [number, number, number],
    greenBg: [236, 253, 245] as [number, number, number],
};

export interface TranscriptTurn {
    turnIndex: number;
    inputTranscript: string;
    aiResponse: string;
    intent?: string;
    latencyMs?: number;
    inputConfidence?: number;
    sloOk?: boolean;
    error?: string;
}

export interface TranscriptExportMeta {
    callSid: string;
    agentLabel: string;
    startedAt?: string;
    durationSec?: number;
    channel?: string;
    endReason?: string;
}

export interface TranscriptExportAppendix {
    orderSnapshot?: Record<string, unknown> | null;
    order?: Record<string, unknown> | null;
    lead?: Record<string, unknown> | null;
}

function slugCallId(callSid: string): string {
    return callSid.slice(0, 12);
}

function formatDuration(sec?: number): string {
    if (sec == null) return '';
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

function buildMetaChips(meta: TranscriptExportMeta): Array<{ label: string; value: string }> {
    const chips: Array<{ label: string; value: string }> = [
        { label: 'Agent', value: meta.agentLabel },
    ];
    if (meta.startedAt) chips.push({ label: 'Date', value: new Date(meta.startedAt).toLocaleString() });
    if (meta.durationSec != null) chips.push({ label: 'Duration', value: formatDuration(meta.durationSec) });
    chips.push({ label: 'Call ID', value: meta.callSid });
    if (meta.channel) chips.push({ label: 'Channel', value: meta.channel });
    if (meta.endReason) chips.push({ label: 'End', value: meta.endReason.replace(/-/g, ' ') });
    return chips;
}

function agentSpeakerLabel(label: string): string {
    const short = label.split(',')[0]?.trim() || label;
    return short.length > 22 ? `${short.slice(0, 20)}…` : short;
}

function turnMetaLine(turn: TranscriptTurn): string {
    const bits = [`Turn ${turn.turnIndex + 1}`];
    if (turn.intent) bits.push(turn.intent);
    if (turn.latencyMs != null) bits.push(`${(turn.latencyMs / 1000).toFixed(1)}s`);
    if (turn.inputConfidence != null) bits.push(`${Math.round(turn.inputConfidence * 100)}% conf`);
    if (turn.sloOk === false) bits.push('SLO miss');
    return bits.join('  ·  ');
}

type JsPdfDoc = import('jspdf').jsPDF;

type PdfRectMode = 'F' | 'FD' | 'S';

/** jsPDF v4 removed roundRect on some builds — fall back to rect. */
function pdfRect(
    doc: JsPdfDoc,
    x: number,
    y: number,
    w: number,
    h: number,
    mode: PdfRectMode = 'F',
): void {
    const d = doc as JsPdfDoc & { roundRect?: (x: number, y: number, w: number, h: number, rx: number, ry: number, m: PdfRectMode) => void };
    if (typeof d.roundRect === 'function') {
        d.roundRect(x, y, w, h, 2, 2, mode);
    } else {
        doc.rect(x, y, w, h, mode);
    }
}

function ensureSpace(doc: JsPdfDoc, y: number, needed: number, margin: number): number {
    const pageH = doc.internal.pageSize.getHeight();
    if (y + needed > pageH - margin) {
        doc.addPage();
        return margin;
    }
    return y;
}

function drawPdfHeader(doc: JsPdfDoc, meta: TranscriptExportMeta, margin: number, pageW: number): number {
    doc.setFillColor(...PDF.navy);
    doc.rect(0, 0, pageW, 38, 'F');
    doc.setTextColor(...PDF.white);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(18);
    doc.text('Call Transcript', margin, 15);
    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.text(`ELVA Voice  ·  ${meta.agentLabel}`, margin, 23);
    doc.setFontSize(8);
    doc.setTextColor(200, 220, 235);
    doc.text(`Generated ${new Date().toLocaleString()}`, margin, 31);
    return 46;
}

function drawMetaChips(doc: JsPdfDoc, meta: TranscriptExportMeta, startY: number, margin: number, pageW: number): number {
    let y = startY;
    let x = margin;
    const rowH = 8;
    const chips = buildMetaChips(meta);

    for (const chip of chips) {
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(7.5);
        const labelText = `${chip.label}:`;
        doc.setFont('helvetica', 'normal');
        const valueText = ` ${chip.value}`;
        const w = doc.getTextWidth(labelText) + doc.getTextWidth(valueText) + 10;

        if (x + w > pageW - margin) {
            x = margin;
            y += rowH + 2;
        }

        y = ensureSpace(doc, y, rowH + 2, margin);
        doc.setFillColor(...PDF.powder);
        doc.setDrawColor(...PDF.mist);
        doc.setLineWidth(0.2);
        pdfRect(doc, x, y, w, rowH, 'FD');

        doc.setFont('helvetica', 'bold');
        doc.setFontSize(7.5);
        doc.setTextColor(...PDF.slate);
        doc.text(labelText, x + 4, y + 5.5);
        const labelW = doc.getTextWidth(labelText);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(...PDF.text);
        doc.text(valueText.trimStart(), x + 4 + labelW, y + 5.5);

        x += w + 3;
    }

    return y + rowH + 10;
}

function drawMessageBubble(
    doc: JsPdfDoc,
    y: number,
    margin: number,
    pageW: number,
    label: string,
    message: string,
    align: 'left' | 'right',
    colors: {
        bg: [number, number, number];
        text: [number, number, number];
        labelColor?: [number, number, number];
    },
): number {
    const maxBubbleW = (pageW - margin * 2) * 0.74;
    const padX = 5;
    const padY = 4;
    const lineH = 4.8;

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9.5);
    const bodyLines = doc.splitTextToSize(message, maxBubbleW - padX * 2) as string[];

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7);
    const labelLine = label.toUpperCase();
    let contentW = doc.getTextWidth(labelLine);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9.5);
    for (const line of bodyLines) {
        contentW = Math.max(contentW, doc.getTextWidth(line));
    }

    const bubbleW = Math.min(maxBubbleW, contentW + padX * 2);
    const bubbleH = padY + 4.5 + bodyLines.length * lineH + padY;

    y = ensureSpace(doc, y, bubbleH + 5, margin);
    const x = align === 'right' ? pageW - margin - bubbleW : margin;

    doc.setFillColor(...colors.bg);
    pdfRect(doc, x, y, bubbleW, bubbleH, 'F');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7);
    doc.setTextColor(...(colors.labelColor || colors.text));
    doc.text(labelLine, x + padX, y + padY + 2.5);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9.5);
    doc.setTextColor(...colors.text);
    let ty = y + padY + 7;
    for (const line of bodyLines) {
        doc.text(line, x + padX, ty);
        ty += lineH;
    }

    return y + bubbleH + 4;
}

function drawAppendix(
    doc: JsPdfDoc,
    appendix: TranscriptExportAppendix | undefined,
    startY: number,
    margin: number,
    pageW: number,
): number {
    if (!appendix) return startY;

    const order = appendix.order as Record<string, unknown> | null | undefined;
    const snap = appendix.orderSnapshot as Record<string, unknown> | null | undefined;
    const lead = appendix.lead as Record<string, unknown> | null | undefined;
    let y = startY + 4;

    const boxW = pageW - margin * 2;

    if (order) {
        y = ensureSpace(doc, y, 30, margin);
        doc.setFillColor(...PDF.powder);
        doc.setDrawColor(...PDF.mist);
        pdfRect(doc, margin, y, boxW, 28, 'FD');
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(10);
        doc.setTextColor(...PDF.ocean);
        doc.text('Order placed', margin + 5, y + 7);
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(8.5);
        doc.setTextColor(...PDF.text);
        const lines: string[] = [];
        if (order.status) lines.push(`Status: ${order.status}`);
        if (order.total != null) lines.push(`Total: ${order.total}`);
        if (order.customerName) lines.push(`Customer: ${order.customerName}`);
        doc.text(lines.join('   ·   '), margin + 5, y + 14);
        const items = (order.items as Array<Record<string, unknown>>) || [];
        const itemText = items.slice(0, 4).map((it) => `${it.quantity ?? 1}x ${it.name}`).join(', ');
        if (itemText) {
            const wrapped = doc.splitTextToSize(itemText, boxW - 10) as string[];
            doc.text(wrapped.slice(0, 2), margin + 5, y + 20);
        }
        y += 32;
    } else if (snap?.items && Array.isArray(snap.items) && (snap.items as unknown[]).length > 0) {
        y = ensureSpace(doc, y, 24, margin);
        doc.setFillColor(...PDF.amberBg);
        doc.setDrawColor(253, 230, 138);
        pdfRect(doc, margin, y, boxW, 22, 'FD');
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(10);
        doc.setTextColor(...PDF.amber);
        doc.text('In-call order snapshot', margin + 5, y + 7);
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(8.5);
        doc.setTextColor(...PDF.text);
        const itemText = (snap.items as Array<Record<string, unknown>>).slice(0, 6)
            .map((it) => `${it.quantity ?? 1}x ${it.name}`).join(', ');
        doc.text(doc.splitTextToSize(itemText, boxW - 10) as string[], margin + 5, y + 14);
        y += 26;
    }

    if (lead) {
        y = ensureSpace(doc, y, 24, margin);
        doc.setFillColor(...PDF.greenBg);
        doc.setDrawColor(167, 243, 208);
        pdfRect(doc, margin, y, boxW, 22, 'FD');
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(10);
        doc.setTextColor(...PDF.green);
        doc.text('Lead captured', margin + 5, y + 7);
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(8.5);
        doc.setTextColor(...PDF.text);
        const parts: string[] = [];
        if (lead.name) parts.push(`Name: ${lead.name}`);
        if (lead.phone) parts.push(`Phone: ${lead.phone}`);
        if (lead.email) parts.push(`Email: ${lead.email}`);
        doc.text(parts.join('   ·   '), margin + 5, y + 14);
        y += 26;
    }

    return y;
}

function drawPageFooter(doc: JsPdfDoc, margin: number, pageW: number): void {
    const pageH = doc.internal.pageSize.getHeight();
    doc.setDrawColor(...PDF.mist);
    doc.setLineWidth(0.3);
    doc.line(margin, pageH - 12, pageW - margin, pageH - 12);
    doc.setFontSize(7);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...PDF.slate);
    doc.text(
        'Exported from ELVA call history. Latency and intent reflect values captured at call time.',
        margin,
        pageH - 7,
    );
}

export async function downloadTranscriptPdf(
    meta: TranscriptExportMeta,
    turns: TranscriptTurn[],
    appendix?: TranscriptExportAppendix,
    filename?: string,
): Promise<void> {
    const [{ jsPDF }] = await Promise.all([import('jspdf')]);
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    const pageW = doc.internal.pageSize.getWidth();
    const margin = 14;
    const agentLabel = agentSpeakerLabel(meta.agentLabel);

    let y = drawPdfHeader(doc, meta, margin, pageW);
    y = drawMetaChips(doc, meta, y, margin, pageW);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(...PDF.ocean);
    doc.text('Conversation', margin, y);
    y += 8;

    for (const turn of turns) {
        y = ensureSpace(doc, y, 20, margin);

        doc.setFont('helvetica', 'bold');
        doc.setFontSize(7.5);
        doc.setTextColor(...PDF.ocean);
        doc.text(turnMetaLine(turn).toUpperCase(), margin, y);
        y += 6;

        if (turn.inputTranscript) {
            y = drawMessageBubble(doc, y, margin, pageW, 'Caller', turn.inputTranscript, 'right', {
                bg: PDF.sky,
                text: PDF.white,
                labelColor: [224, 242, 254],
            });
        }

        if (turn.aiResponse) {
            y = drawMessageBubble(doc, y, margin, pageW, agentLabel, turn.aiResponse, 'left', {
                bg: PDF.powder,
                text: PDF.text,
                labelColor: PDF.ocean,
            });
        }

        if (turn.error) {
            y = ensureSpace(doc, y, 12, margin);
            doc.setFillColor(254, 242, 242);
            doc.setDrawColor(254, 202, 202);
            pdfRect(doc, margin, y, pageW - margin * 2, 10, 'FD');
            doc.setFont('helvetica', 'normal');
            doc.setFontSize(8);
            doc.setTextColor(...PDF.red);
            doc.text(`Error: ${turn.error}`, margin + 4, y + 6.5);
            y += 14;
        }

        doc.setDrawColor(...PDF.mist);
        doc.setLineWidth(0.2);
        doc.line(margin, y, pageW - margin, y);
        y += 6;
    }

    y = drawAppendix(doc, appendix, y, margin, pageW);

    const pageCount = doc.getNumberOfPages();
    for (let i = 1; i <= pageCount; i += 1) {
        doc.setPage(i);
        drawPageFooter(doc, margin, pageW);
        doc.setFontSize(7);
        doc.setTextColor(...PDF.slate);
        doc.text(`Page ${i} of ${pageCount}`, pageW - margin, doc.internal.pageSize.getHeight() - 7, { align: 'right' });
    }

    doc.save(filename || `transcript-${slugCallId(meta.callSid)}.pdf`);
}
