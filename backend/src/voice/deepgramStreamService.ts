/**
 * Deepgram streaming STT — wraps the Deepgram SDK v5 for voice calls.
 *
 * Each phone call gets its own WebSocket connection to Deepgram.
 * Audio (mulaw 8kHz from Twilio Media Streams) is sent in real-time
 * and Deepgram fires a callback ~200ms after the caller stops speaking.
 */

import { DeepgramClient } from '@deepgram/sdk';
import type { listen } from '@deepgram/sdk';
import { terminalLog } from '../utils/terminalLog';
import { normalizeVoiceStt, parseDeepgramKeywords } from './voiceSttNormalize';

const DEEPGRAM_API_KEY = process.env.DEEPGRAM_API_KEY || '';
const DEEPGRAM_MODEL = process.env.DEEPGRAM_MODEL || 'nova-2';
const DEEPGRAM_ENDPOINTING_MS = parseInt(process.env.DEEPGRAM_ENDPOINTING_MS || '400', 10);
const MAX_CONNECT_ATTEMPTS = 5;

const RETRYABLE = /EAI_AGAIN|ENOTFOUND|ETIMEDOUT|ECONNRESET|fetch failed|timeout/i;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export interface DeepgramSessionOptions {
    onTranscript: (text: string, confidence?: number) => void;
    onInterimTranscript?: (text: string) => void;
    onError?: (err: Error) => void;
    onReady?: () => void;
    onFailed?: () => void;
    language?: string;
    currency?: string;
}

type V1Socket = Awaited<ReturnType<InstanceType<typeof DeepgramClient>['listen']['v1']['connect']>>;

export class DeepgramSession {
    private socket: V1Socket | null = null;
    private _ready = false;
    private _failed = false;
    private _audioQueue: Buffer[] = [];
    private _closed = false;
    private _connectPromise: Promise<void>;
    private _reconnecting = false;

    constructor(private opts: DeepgramSessionOptions) {
        this._connectPromise = this._openWithRetries();
    }

    isReady(): boolean {
        return this._ready && !this._failed;
    }

    hasFailed(): boolean {
        return this._failed;
    }

    /** Wait until connected or failed (whichever comes first). */
    async waitForReady(timeoutMs = 10_000): Promise<boolean> {
        const deadline = Date.now() + timeoutMs;
        while (Date.now() < deadline) {
            await this._connectPromise.catch(() => {});
            if (this._ready) return true;
            if (this._failed) return false;
            await sleep(100);
        }
        return this._ready;
    }

    private async _openWithRetries(): Promise<void> {
        if (!DEEPGRAM_API_KEY) {
            terminalLog.err('DEEPGRAM', 'DEEPGRAM_API_KEY not set — STT disabled');
            this._failed = true;
            this.opts.onFailed?.();
            return;
        }

        for (let attempt = 1; attempt <= MAX_CONNECT_ATTEMPTS; attempt++) {
            try {
                await this._connectOnce();
                return;
            } catch (err: any) {
                const msg = err?.message || String(err);
                terminalLog.warn('DEEPGRAM', `Connect ${attempt}/${MAX_CONNECT_ATTEMPTS} failed: ${msg}`);
                if (/Unexpected server response:\s*400/i.test(msg)) {
                    terminalLog.err(
                        'DEEPGRAM',
                        'HTTP 400 — check DEEPGRAM_MODEL / DEEPGRAM_KEYWORDS (keyterm is not supported on nova-2)',
                    );
                    break;
                }
                if (attempt < MAX_CONNECT_ATTEMPTS && RETRYABLE.test(msg)) {
                    await sleep(500 * attempt);
                    continue;
                }
                this._failed = true;
                this.opts.onError?.(err instanceof Error ? err : new Error(msg));
                this.opts.onFailed?.();
                return;
            }
        }
    }

    private async _connectOnce(): Promise<void> {
        const client = new DeepgramClient({ apiKey: DEEPGRAM_API_KEY });
        // nova-2 uses `keywords` (word:intensifier). `keyterm` is nova-3+ and returns HTTP 400 on nova-2.
        const keywords = parseDeepgramKeywords();

        this.socket = await client.listen.v1.connect({
            Authorization: `Token ${DEEPGRAM_API_KEY}`,
            model: DEEPGRAM_MODEL as any,
            language: (this.opts.language || 'en-US') as any,
            encoding: 'mulaw' as any,
            sample_rate: 8000 as any,
            channels: 1 as any,
            endpointing: DEEPGRAM_ENDPOINTING_MS as any,
            interim_results: true as any,
            smart_format: true as any,
            ...(keywords ? { keywords: keywords as any } : {}),
        });

        await new Promise<void>((resolve, reject) => {
            const failTimer = setTimeout(() => {
                reject(new Error('Deepgram connection open timeout'));
            }, 8_000);

            this.socket!.on('open', () => {
                clearTimeout(failTimer);
                this._ready = true;
                this._failed = false;
                terminalLog.ok('DEEPGRAM', 'Connection open');
                this.opts.onReady?.();
                for (const chunk of this._audioQueue) {
                    this._sendChunk(chunk);
                }
                this._audioQueue = [];
                resolve();
            });

            this.socket!.on('error', (err: Error) => {
                clearTimeout(failTimer);
                terminalLog.err('DEEPGRAM', err?.message || 'socket error');
                this.opts.onError?.(err);
                if (!this._ready) reject(err);
            });

            this.socket!.on('close', () => {
                terminalLog.dim('Deepgram connection closed');
                this._ready = false;
                if (!this._closed && !this._reconnecting) {
                    void this._tryReconnect();
                }
            });

            this.socket!.on('message', (msg: listen.ListenV1Results | listen.ListenV1Metadata | listen.ListenV1UtteranceEnd | listen.ListenV1SpeechStarted) => {
                if (msg.type !== 'Results') return;
                const result = msg as listen.ListenV1Results;
                const alt = result.channel?.alternatives?.[0];
                const text = (alt?.transcript || '').trim();
                const isFinal = result.is_final;
                if (!text) return;
                if (isFinal) {
                    const confidence = alt?.confidence;
                    const normalized = normalizeVoiceStt(text, this.opts.currency);
                    if (!normalized) return;
                    terminalLog.voice(
                        'DEEPGRAM',
                        `"${normalized}"${normalized !== text ? ` (raw: "${text}")` : ''} (${confidence?.toFixed(2)})`,
                    );
                    this.opts.onTranscript(normalized, confidence);
                } else if (text.length >= 3) {
                    this.opts.onInterimTranscript?.(text);
                }
            });

            this.socket!.connect();
        });
    }

    private async _tryReconnect(): Promise<void> {
        if (this._closed || this._reconnecting) return;
        this._reconnecting = true;
        terminalLog.info('DEEPGRAM', 'Attempting reconnect…');
        this._failed = false;
        try {
            this.socket = null;
            await this._connectOnce();
            terminalLog.ok('DEEPGRAM', 'Reconnected');
        } catch (err: any) {
            terminalLog.err('DEEPGRAM', `Reconnect failed: ${err?.message}`);
            this._failed = true;
            this.opts.onFailed?.();
        } finally {
            this._reconnecting = false;
        }
    }

    private _sendChunk(chunk: Buffer): void {
        if (!this.socket || !this._ready) return;
        try {
            this.socket.sendMedia(chunk);
        } catch (err: any) {
            terminalLog.warn('DEEPGRAM', `sendMedia error: ${err?.message}`);
        }
    }

    sendAudio(chunk: Buffer): void {
        if (this._closed) return;
        if (!this._ready || !this.socket) {
            this._audioQueue.push(chunk);
            return;
        }
        this._sendChunk(chunk);
    }

    close(): void {
        if (this._closed) return;
        this._closed = true;
        this._audioQueue = [];
        try {
            this.socket?.close();
        } catch { /* ignore */ }
        this.socket = null;
        this._ready = false;
    }
}
