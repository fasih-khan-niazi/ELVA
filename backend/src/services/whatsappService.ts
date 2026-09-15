import axios from 'axios';

const GRAPH_API_VERSION = 'v19.0';

interface WhatsAppTextMessage {
    phoneNumberId: string;
    accessToken: string;
    to: string;
    body: string;
}

export async function sendWhatsAppMessage(opts: WhatsAppTextMessage): Promise<void> {
    const url = `https://graph.facebook.com/${GRAPH_API_VERSION}/${opts.phoneNumberId}/messages`;

    const payload = {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: opts.to.replace(/\s+/g, '').replace(/^\+/, ''),
        type: 'text',
        text: { preview_url: false, body: opts.body },
    };

    const response = await axios.post(url, payload, {
        headers: {
            Authorization: `Bearer ${opts.accessToken}`,
            'Content-Type': 'application/json',
        },
        timeout: 10_000,
    });

    if (response.status >= 400) {
        throw new Error(`WhatsApp API error ${response.status}: ${JSON.stringify(response.data)}`);
    }
}
