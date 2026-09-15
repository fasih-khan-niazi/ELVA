/**
 * voiceLogger.ts - Structured JSON logger for the voice pipeline
 *
 * Pretty terminal output is on by default (VOICE_LOG_PRETTY=false for raw JSON).
 * Log levels: debug < info < warn < error (VOICE_LOG_LEVEL, default: info).
 */

import { terminalLog } from '../utils/terminalLog';

export type VoiceLogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_ORDER: Record<VoiceLogLevel, number> = {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3,
};

const configuredLevel: VoiceLogLevel =
    (process.env.VOICE_LOG_LEVEL as VoiceLogLevel) || 'info';

export interface VoiceLogEntry {
    ts: string;
    level: VoiceLogLevel;
    component: string;
    event: string;
    callSid?: string;
    tenantId?: string;
    agentId?: string;
    channel?: 'phone' | 'web';
    latencyMs?: number;
    sloOk?: boolean;
    turnIndex?: number;
    error?: string;
    detail?: Record<string, any>;
}

function shouldLog(level: VoiceLogLevel): boolean {
    return LEVEL_ORDER[level] >= LEVEL_ORDER[configuredLevel];
}

function emit(entry: VoiceLogEntry): void {
    if (!shouldLog(entry.level)) return;

    const pretty = process.env.VOICE_LOG_PRETTY !== 'false';
    if (pretty && entry.level !== 'debug') {
        const tag = entry.component.toUpperCase();
        const detail = entry.detail ? ` ${JSON.stringify(entry.detail)}` : '';
        const ctx = [
            entry.callSid ? entry.callSid.slice(0, 10) : '',
            entry.latencyMs != null ? `${entry.latencyMs}ms` : '',
            entry.sloOk != null ? (entry.sloOk ? 'SLO✓' : 'SLO✗') : '',
        ].filter(Boolean).join(' · ');
        const msg = `${entry.event}${ctx ? ` (${ctx})` : ''}${detail}`;
        switch (entry.level) {
            case 'error':
                terminalLog.err(tag, msg);
                return;
            case 'warn':
                terminalLog.warn(tag, msg);
                return;
            default:
                terminalLog.dim(msg);
                return;
        }
    }

    const line = JSON.stringify(entry);

    switch (entry.level) {
        case 'error':
            console.error(line);
            break;
        case 'warn':
            console.warn(line);
            break;
        default:
            console.log(line);
    }
}

/**
 * Create a scoped logger for a specific component.
 *
 * Usage:
 *   const log = voiceLog('orchestrator');
 *   log.info('turn-processed', { callSid, latencyMs, sloOk: true });
 */
export function voiceLog(component: string) {
    function makeEntry(
        level: VoiceLogLevel,
        event: string,
        ctx?: Partial<Omit<VoiceLogEntry, 'ts' | 'level' | 'component' | 'event'>>,
    ): VoiceLogEntry {
        return {
            ts: new Date().toISOString(),
            level,
            component,
            event,
            ...ctx,
        };
    }

    return {
        debug(event: string, ctx?: Partial<Omit<VoiceLogEntry, 'ts' | 'level' | 'component' | 'event'>>) {
            emit(makeEntry('debug', event, ctx));
        },
        info(event: string, ctx?: Partial<Omit<VoiceLogEntry, 'ts' | 'level' | 'component' | 'event'>>) {
            emit(makeEntry('info', event, ctx));
        },
        warn(event: string, ctx?: Partial<Omit<VoiceLogEntry, 'ts' | 'level' | 'component' | 'event'>>) {
            emit(makeEntry('warn', event, ctx));
        },
        error(event: string, ctx?: Partial<Omit<VoiceLogEntry, 'ts' | 'level' | 'component' | 'event'>>) {
            emit(makeEntry('error', event, ctx));
        },
    };
}

export type VoiceLogger = ReturnType<typeof voiceLog>;
