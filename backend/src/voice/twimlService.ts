import VoiceResponse from 'twilio/lib/twiml/VoiceResponse';



/**

 * Minimal TwiML builders for the Media Streams voice pipeline.

 * Conversation turns run over WebSocket — not TwiML <Gather> loops.

 */



export function buildRejectTwiml(message: string): string {

    const twiml = new VoiceResponse();

    twiml.say(message);

    twiml.hangup();

    return twiml.toString();

}



export function buildGoodbyeTwiml(message: string): string {

    const twiml = new VoiceResponse();

    twiml.say(message);

    twiml.hangup();

    return twiml.toString();

}



/**

 * Say a hold message, then <Dial> the transfer number.

 */

export function buildTransferTwiml(

    holdMessage: string,

    transferTo: string,

    fallbackMessage: string,

): string {

    const twiml = new VoiceResponse();

    twiml.say(holdMessage);

    twiml.dial({ timeout: 30 }, transferTo);

    twiml.say(fallbackMessage);

    twiml.hangup();

    return twiml.toString();

}



/**

 * Connect call audio to our Media Streams WebSocket handler.

 */

export function buildMediaStreamTwiml(
    callSid: string,
    callType: string = 'inbound',
    streamToken: string = '',
): string {

    const baseUrl = (process.env.BASE_URL || 'http://localhost:3000')

        .replace(/^http:/, 'ws:')

        .replace(/^https:/, 'wss:');

    const streamUrl = `${baseUrl}/api/voice/stream`;

    const twiml = new VoiceResponse();
    const connect = twiml.connect();
    const stream = connect.stream({ url: streamUrl });
    stream.parameter({ name: 'type', value: callType });
    if (streamToken) {
        stream.parameter({ name: 'token', value: streamToken });
    }
    if (callSid) {
        stream.parameter({ name: 'callSid', value: callSid });
    }

    return twiml.toString();

}

