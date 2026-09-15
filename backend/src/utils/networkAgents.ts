/**
 * HTTP(S) agents that force IPv4 DNS lookup — reduces EAI_AGAIN on Windows.
 */

import https from 'https';
import dns from 'dns';

export const ipv4HttpsAgent = new https.Agent({
    keepAlive: true,
    lookup: (hostname, options, callback) => {
        dns.lookup(hostname, { ...options, family: 4 }, callback);
    },
});
