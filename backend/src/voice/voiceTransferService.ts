import twilio from 'twilio';
import { buildTransferTwiml } from './twimlService';
import { MSG_GOODBYE, MSG_TRANSFER } from './voiceLifecycle';
import { terminalLog } from '../utils/terminalLog';

const accountSid = process.env.TWILIO_ACCOUNT_SID || '';
const authToken = process.env.TWILIO_AUTH_TOKEN || '';

let _client: ReturnType<typeof twilio> | null = null;

function getClient(): ReturnType<typeof twilio> | null {
    if (!accountSid || !authToken) return null;
    if (!_client) _client = twilio(accountSid, authToken);
    return _client;
}

/**
 * Redirect an active Media Streams call to a PSTN transfer via Twilio REST.
 * Ends the WebSocket stream and connects the caller to `transferTo`.
 */
export async function transferActiveCall(
    callSid: string,
    transferTo: string,
    holdMessage: string = MSG_TRANSFER,
): Promise<boolean> {
    const client = getClient();
    if (!client) {
        terminalLog.err('TRANSFER', 'Twilio credentials missing');
        return false;
    }

    try {
        const twiml = buildTransferTwiml(holdMessage, transferTo, MSG_GOODBYE);
        await client.calls(callSid).update({ twiml });
        terminalLog.voice('TRANSFER', `${callSid.slice(0, 10)}… → ${transferTo}`);
        return true;
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        terminalLog.err('TRANSFER', msg);
        return false;
    }
}
