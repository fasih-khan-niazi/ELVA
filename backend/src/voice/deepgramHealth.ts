/**
 * Lightweight Deepgram reachability probe — avoids starting Media Streams
 * when api.deepgram.com is unreachable (DNS blips are common on some networks).
 */

import axios from 'axios';
import { terminalLog } from '../utils/terminalLog';
import { ipv4HttpsAgent } from '../utils/networkAgents';

const DEEPGRAM_API_KEY = process.env.DEEPGRAM_API_KEY || '';

let _healthy = true;
let _lastCheck = 0;
const CACHE_MS = 30_000;

const RETRYABLE = /EAI_AGAIN|ENOTFOUND|ETIMEDOUT|ECONNRESET|fetch failed|timeout/i;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export async function checkDeepgramReachable(force = false): Promise<boolean> {
    if (!DEEPGRAM_API_KEY) {
        terminalLog.warn('DEEPGRAM-HEALTH', 'DEEPGRAM_API_KEY not set');
        return false;
    }

    const now = Date.now();
    if (!force && now - _lastCheck < CACHE_MS) return _healthy;

    let lastErr = '';
    for (let attempt = 1; attempt <= 5; attempt++) {
        try {
            await axios.get('https://api.deepgram.com/v1/projects', {
                headers: { Authorization: `Token ${DEEPGRAM_API_KEY}` },
                timeout: 8_000,
                httpsAgent: ipv4HttpsAgent,
            });
            _healthy = true;
            _lastCheck = now;
            if (attempt > 1) {
                terminalLog.ok('DEEPGRAM-HEALTH', `Reachable on attempt ${attempt}`);
            }
            return true;
        } catch (err: any) {
            lastErr = err?.message || String(err);
            if (attempt < 5 && RETRYABLE.test(lastErr)) {
                terminalLog.warn('DEEPGRAM-HEALTH', `Attempt ${attempt}/5 failed — retrying`);
                await sleep(600 * attempt);
                continue;
            }
            break;
        }
    }

    _healthy = false;
    _lastCheck = now;
    terminalLog.err('DEEPGRAM-HEALTH', `Unreachable — ${lastErr}`);
    return false;
}
