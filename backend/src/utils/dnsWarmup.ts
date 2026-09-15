/**
 * Pre-resolve voice/API hostnames before probes — warms the OS DNS cache.
 */

import dns from 'dns/promises';
import { terminalLog } from './terminalLog';

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function voiceHosts(): string[] {
    const region = process.env.AZURE_SPEECH_REGION || 'centralindia';
    const hosts = [
        'api.deepgram.com',
        `${region}.tts.speech.microsoft.com`,
    ];
    const supa = process.env.SUPABASE_URL;
    if (supa) {
        try {
            hosts.push(new URL(supa).hostname);
        } catch { /* ignore */ }
    }
    return hosts;
}

export async function warmupDnsHosts(maxAttempts = 5): Promise<void> {
    for (const host of voiceHosts()) {
        let resolved = false;
        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            try {
                const { address } = await dns.lookup(host, { family: 4 });
                terminalLog.dim(`DNS ${host} → ${address}`);
                resolved = true;
                break;
            } catch (err: any) {
                if (attempt < maxAttempts) {
                    await sleep(400 * attempt);
                    continue;
                }
                terminalLog.warn('DNS', `${host} unresolved (${err?.code || err?.message})`);
            }
        }
        if (!resolved) {
            // Non-fatal — per-call retries will still run.
        }
    }
}
