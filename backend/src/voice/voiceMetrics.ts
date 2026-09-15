import { VOICE_MVP_KPI_TARGETS } from './voiceContract';

export interface VoiceTurnTimings {
    receivedAt: number;
    aiRespondedAt: number;
}

export function calculateTurnLatencyMs(timings: VoiceTurnTimings): number {
    return Math.max(0, timings.aiRespondedAt - timings.receivedAt);
}

export function isWithinTurnLatencySlo(latencyMs: number): boolean {
    return latencyMs <= VOICE_MVP_KPI_TARGETS.maxTurnLatencyMs;
}
