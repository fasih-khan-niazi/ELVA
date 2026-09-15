/**
 * browserVoiceService.ts - Twilio Client SDK (WebRTC) support
 *
 * Generates Twilio Access Tokens with Voice Grant so the browser
 * can establish a WebRTC call to the voice agent, and provides the
 * TwiML handler for the incoming browser-initiated connection.
 */

import twilio from 'twilio';

const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID || '';
const TWILIO_API_KEY = process.env.TWILIO_API_KEY || '';
const TWILIO_API_SECRET = process.env.TWILIO_API_SECRET || '';
const TWILIO_TWIML_APP_SID = process.env.TWILIO_TWIML_APP_SID || '';

/**
 * Generate a short-lived Twilio Access Token with Voice Grant.
 */
export function generateAccessToken(userId: string): string {
    if (!TWILIO_ACCOUNT_SID || !TWILIO_API_KEY || !TWILIO_API_SECRET) {
        throw new Error('Twilio API credentials not configured (TWILIO_ACCOUNT_SID, TWILIO_API_KEY, TWILIO_API_SECRET)');
    }
    if (!TWILIO_TWIML_APP_SID) {
        throw new Error('TWILIO_TWIML_APP_SID not configured - create a TwiML App in the Twilio Console');
    }

    const AccessToken = twilio.jwt.AccessToken;
    const VoiceGrant = AccessToken.VoiceGrant;

    const token = new AccessToken(
        TWILIO_ACCOUNT_SID,
        TWILIO_API_KEY,
        TWILIO_API_SECRET,
        {
            identity: `elva_user_${userId}`,
            ttl: 3600,
        },
    );

    const voiceGrant = new VoiceGrant({
        outgoingApplicationSid: TWILIO_TWIML_APP_SID,
        incomingAllow: false,
    });

    token.addGrant(voiceGrant);

    return token.toJwt();
}
