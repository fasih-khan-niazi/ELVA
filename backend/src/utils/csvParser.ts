import { parse } from 'csv-parse/sync';

export interface ParsedContact {
    phone: string;
    name: string;
    email: string;
    company: string;
    title: string;
    /** Any extra CSV columns (e.g. appointment_time) keyed by sanitized header names. */
    customFields: Record<string, string>;
}

export interface CsvParseResult {
    valid: ParsedContact[];
    rejected: Array<{ row: number; reason: string; raw: string }>;
}

function sanitizeHeaderKey(h: string): string {
    return (
        h
            .trim()
            .toLowerCase()
            .replace(/['"]/g, '')
            .replace(/\s+/g, '_')
            .replace(/[^a-z0-9_]/g, '') || 'field'
    );
}

function normalizePhone(raw: string): string {
    const trimmed = raw.trim();

    if (trimmed.startsWith('+')) {
        const digits = trimmed.replace(/[\s\-().]/g, '');
        return /^\+\d{7,15}$/.test(digits) ? digits : '';
    }

    if (trimmed.startsWith('00')) {
        const digits = trimmed.slice(2).replace(/[\s\-().]/g, '');
        return /^\d{7,15}$/.test(digits) ? `+${digits}` : '';
    }

    const digits = trimmed.replace(/[\s\-().+]/g, '');
    if (!/^\d{7,15}$/.test(digits)) return '';

    if (digits.startsWith('0') && digits.length === 11) {
        return `+92${digits.slice(1)}`;
    }

    if (digits.length >= 11) {
        return `+${digits}`;
    }

    return '';
}

export function parseCsvBuffer(buffer: Buffer): CsvParseResult {
    const text = buffer.toString('utf8');
    let rows: string[][];
    try {
        rows = parse(text, {
            bom: true,
            skip_empty_lines: true,
            relax_column_count: true,
            trim: true,
            cast: false,
        }) as string[][];
    } catch {
        return {
            valid: [],
            rejected: [{ row: 0, reason: 'Could not parse CSV (malformed quoting or encoding)', raw: text.slice(0, 280) }],
        };
    }

    if (rows.length === 0) return { valid: [], rejected: [] };

    const headerProbe = rows[0].map((c) => String(c).toLowerCase()).join(' ');
    const hasHeader =
        headerProbe.includes('phone') ||
        headerProbe.includes('name') ||
        headerProbe.includes('email') ||
        headerProbe.includes('mobile') ||
        headerProbe.includes('number');

    const dataRows = hasHeader ? rows.slice(1) : rows;

    let colPhone = 0;
    let colName = 1;
    let colEmail = 2;
    let colCompany = 3;
    let colTitle = -1;
    let rawHeaders: string[] = [];

    if (hasHeader) {
        rawHeaders = rows[0].map((h) => String(h).trim());
        const headers = rawHeaders.map((h) => h.toLowerCase().replace(/['"]/g, ''));

        colPhone = headers.findIndex((h) => h.includes('phone') || h.includes('mobile') || h.includes('number'));
        colName = headers.findIndex((h) => {
            const n = h === 'name' || (h.includes('name') && !h.includes('company'));
            return n || h.includes('full_name') || h.includes('fullname');
        });
        colEmail = headers.findIndex((h) => h.includes('email'));
        colCompany = headers.findIndex((h) => h.includes('company') || h.includes('org') || h.includes('business'));
        colTitle = headers.findIndex((h) => h.includes('title') || h.includes('role') || h.includes('position'));

        if (colPhone === -1) colPhone = 0;
        if (colName === -1) colName = 1;
    }

    const reserved = new Set<number>();
    reserved.add(colPhone);
    if (colName >= 0) reserved.add(colName);
    if (colEmail >= 0) reserved.add(colEmail);
    if (colCompany >= 0) reserved.add(colCompany);
    if (colTitle >= 0) reserved.add(colTitle);

    const valid: ParsedContact[] = [];
    const rejected: CsvParseResult['rejected'] = [];

    dataRows.forEach((cols, idx) => {
        const rowNum = hasHeader ? idx + 2 : idx + 1;
        const raw = cols.join(',');
        const rawPhone = cols[colPhone] ?? '';
        const phone = normalizePhone(String(rawPhone));

        if (!phone) {
            rejected.push({ row: rowNum, reason: 'Invalid or missing phone number', raw });
            return;
        }

        const customFields: Record<string, string> = {};
        if (hasHeader && rawHeaders.length) {
            rawHeaders.forEach((h, ci) => {
                if (reserved.has(ci)) return;
                const key = sanitizeHeaderKey(h);
                const val = (cols[ci] ?? '').toString().trim();
                if (val) customFields[key] = val;
            });
        }

        valid.push({
            phone,
            name: colName >= 0 ? String(cols[colName] ?? '').trim() : '',
            email: colEmail >= 0 ? String(cols[colEmail] ?? '').trim() : '',
            company: colCompany >= 0 ? String(cols[colCompany] ?? '').trim() : '',
            title: colTitle >= 0 ? String(cols[colTitle] ?? '').trim() : '',
            customFields,
        });
    });

    return { valid, rejected };
}
