/**
 * ELVA website chat widget — loaded via:
 * <script src=".../embed/elva-chat.js" data-api-base="https://api.example.com" data-elva-key="keyId.secret" async></script>
 */
(function () {
    var script = document.currentScript;
    if (!script) return;
    var apiBase = (script.getAttribute('data-api-base') || '').replace(/\/$/, '');
    var rawKey = script.getAttribute('data-elva-key') || '';
    if (!apiBase || !rawKey) {
        console.warn('[ELVA] embed: missing data-api-base or data-elva-key');
        return;
    }
    var keyPart = rawKey.split('.')[0] || 'k';
    var storageKey = 'elva_chat_sid_' + keyPart;

    var root = document.createElement('div');
    root.setAttribute('data-elva-widget', '1');
    root.style.cssText = 'all:initial;position:fixed;z-index:99999;font-family:system-ui,-apple-system,sans-serif;';
    document.body.appendChild(root);

    var panelOpen = false;
    var sessionId = null;

    try {
        sessionId = window.localStorage.getItem(storageKey);
    } catch (e) {}

    var shadow = root.attachShadow({ mode: 'open' });

    var style = document.createElement('style');
    style.textContent =
        ':host{display:block}' +
        '.fab{width:56px;height:56px;border-radius:50%;background:#0f3d56;color:#fff;border:none;cursor:pointer;' +
        'box-shadow:0 4px 14px rgba(0,0,0,.25);font-size:22px;line-height:56px;text-align:center;}' +
        '.panel{position:absolute;bottom:72px;right:0;width:min(400px,calc(100vw - 24px));max-height:560px;' +
        'background:#fff;border-radius:12px;box-shadow:0 8px 32px rgba(0,0,0,.18);display:none;flex-direction:column;overflow:hidden;}' +
        '.panel.open{display:flex}' +
        '.hdr{padding:12px 14px;background:#0f3d56;color:#fff;font-weight:600;font-size:15px;}' +
        '.msgs{flex:1;overflow-y:auto;padding:12px;min-height:220px;max-height:380px;background:#f7fafc;font-size:14px;line-height:1.45;}' +
        '.bubble{margin:6px 0;padding:8px 11px;border-radius:10px;max-width:92%;word-wrap:break-word;}' +
        '.bubble.user{background:#0f3d56;color:#fff;margin-left:auto;}' +
        '.bubble.bot{background:#fff;border:1px solid #e2e8f0;color:#1e293b;}' +
        '.row{display:flex;flex-direction:column;}' +
        '.inp-row{display:flex;gap:8px;padding:10px;border-top:1px solid #e2e8f0;background:#fff;}' +
        'input{flex:1;padding:10px 12px;border:1px solid #cbd5e1;border-radius:8px;font-size:14px;outline:none;}' +
        'button.send{padding:10px 16px;background:#0f3d56;color:#fff;border:none;border-radius:8px;cursor:pointer;font-weight:600;}' +
        'button.send:disabled{opacity:.5;cursor:default}';
    shadow.appendChild(style);

    var fab = document.createElement('button');
    fab.className = 'fab';
    fab.type = 'button';
    fab.setAttribute('aria-label', 'Open chat');
    fab.appendChild(document.createTextNode('\uD83D\uDCAC'));

    var panel = document.createElement('div');
    panel.className = 'panel';
    var hdr = document.createElement('div');
    hdr.className = 'hdr';
    hdr.textContent = 'Chat';
    var msgs = document.createElement('div');
    msgs.className = 'msgs';

    var inpRow = document.createElement('div');
    inpRow.className = 'inp-row';
    var inp = document.createElement('input');
    inp.type = 'text';
    inp.placeholder = 'Type a message...';
    var sendBtn = document.createElement('button');
    sendBtn.className = 'send';
    sendBtn.type = 'button';
    sendBtn.textContent = 'Send';

    inpRow.appendChild(inp);
    inpRow.appendChild(sendBtn);

    panel.appendChild(hdr);
    panel.appendChild(msgs);
    panel.appendChild(inpRow);

    var wrap = document.createElement('div');
    wrap.style.cssText = 'position:fixed;bottom:20px;right:20px;text-align:right;';
    wrap.appendChild(panel);
    wrap.appendChild(fab);
    shadow.appendChild(wrap);

    var configLoaded = false;
    var sending = false;

    function addBubble(text, who) {
        var d = document.createElement('div');
        d.className = 'bubble ' + (who === 'user' ? 'user' : 'bot');
        d.textContent = text;
        var row = document.createElement('div');
        row.className = 'row';
        row.appendChild(d);
        msgs.appendChild(row);
        msgs.scrollTop = msgs.scrollHeight;
    }

    function authHeader() {
        return { Authorization: 'Bearer ' + rawKey, 'Content-Type': 'application/json' };
    }

    function loadConfig() {
        fetch(apiBase + '/api/public/chat/config', { headers: { Authorization: 'Bearer ' + rawKey } })
            .then(function (r) {
                if (!r.ok) throw new Error('config');
                return r.json();
            })
            .then(function (c) {
                hdr.textContent = c.businessName || c.agentName || 'Chat';
                if (c.firstMessage) addBubble(c.firstMessage, 'bot');
                configLoaded = true;
            })
            .catch(function () {
                hdr.textContent = 'Chat';
                addBubble('Unable to load assistant. Check your embed key and that the agent is published in ELVA.', 'bot');
            });
    }

    function ensureSession() {
        if (!sessionId) {
            sessionId = 'session_embed_' + keyPart + '_' + Date.now();
            try {
                window.localStorage.setItem(storageKey, sessionId);
            } catch (e) {}
        }
        return sessionId;
    }

    function send() {
        var text = (inp.value || '').trim();
        if (!text || sending) return;
        sending = true;
        sendBtn.disabled = true;
        addBubble(text, 'user');
        inp.value = '';

        fetch(apiBase + '/api/public/chat/message', {
            method: 'POST',
            headers: authHeader(),
            body: JSON.stringify({
                message: text,
                sessionId: ensureSession(),
                client: 'embed',
            }),
        })
            .then(function (r) {
                return r.json().then(function (j) {
                    return { ok: r.ok, j: j };
                });
            })
            .then(function (_ref) {
                if (_ref.j.sessionId) sessionId = _ref.j.sessionId;
                try {
                    window.localStorage.setItem(storageKey, sessionId);
                } catch (e) {}
                if (_ref.ok && _ref.j.response) {
                    addBubble(_ref.j.response, 'bot');
                } else {
                    addBubble((_ref.j && _ref.j.message) || 'Something went wrong. Please try again.', 'bot');
                }
            })
            .catch(function () {
                addBubble('Network error. Please try again.', 'bot');
            })
            .finally(function () {
                sending = false;
                sendBtn.disabled = false;
                inp.focus();
            });
    }

    fab.addEventListener('click', function () {
        panelOpen = !panelOpen;
        panel.classList.toggle('open', panelOpen);
        if (panelOpen && !configLoaded) loadConfig();
        if (panelOpen) setTimeout(function () { inp.focus(); }, 100);
    });

    sendBtn.addEventListener('click', send);
    inp.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') send();
    });
})();
