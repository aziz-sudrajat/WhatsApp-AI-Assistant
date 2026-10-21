// WhatsApp client built on Baileys (WhatsApp Web protocol).
//
// Pairing: on first run Baileys emits a QR string; the caller displays it
// (terminal QR via qrcode-terminal). The session is persisted in the auth
// directory, so later restarts reconnect without a new scan.
//
// Testability: pass a `socketFactory` that returns a stub socket and no
// real connection is ever made. The default factory uses Baileys for real.
//
// This module never sends anything on its own; sending happens only when
// the gateway (or an explicit CLI action) calls sendText().

const { EventEmitter } = require('events');

let baileys = null;
function loadBaileys() {
  if (!baileys) baileys = require('@whiskeysockets/baileys');
  return baileys;
}

// Create a client. Options:
//   authDir: directory for the persisted session (multi-file auth state)
//   onQr(qr): called with each new QR string
//   onMessage(msg): called for each new incoming message (notify only)
//   onConnected(info): called once the socket is open ({ jid })
//   onDisconnected({ loggedOut }): called when the socket closes
//   socketFactory: async () => socket (default: real Baileys socket)
//   logger: function for diagnostics (defaults to a no-op)
function createClient(opts) {
  const {
    authDir,
    onQr = () => {},
    onMessage = () => {},
    onConnected = () => {},
    onDisconnected = () => {},
    socketFactory = null,
    logger = () => {},
  } = opts;

  const emitter = new EventEmitter();
  let sock = null;
  let ownJid = null;
  let stopped = false;
  let reconnectTimer = null;

  async function defaultFactory() {
    const { makeWASocket, useMultiFileAuthState } = loadBaileys();
    const { state, saveCreds } = await useMultiFileAuthState(authDir);
    const s = makeWASocket({ auth: state });
    s.ev.on('creds.update', saveCreds);
    return s;
  }

  function wire(s) {
    s.ev.on('connection.update', (update) => {
      if (update.qr) onQr(update.qr);
      if (update.connection === 'open') {
        ownJid = s.user?.id || null;
        onConnected({ jid: ownJid });
      }
      if (update.connection === 'close') {
        const { DisconnectReason } = loadBaileysSafe();
        const code = update.lastDisconnect?.error?.output?.statusCode;
        const loggedOut = code === DisconnectReason?.loggedOut;
        onDisconnected({ loggedOut: !!loggedOut });
        if (!stopped && !loggedOut) {
          // Transient drop: reconnect after a short delay. The timer is
          // intentionally kept referenced so the gateway stays alive.
          reconnectTimer = setTimeout(() => {
            start().catch((err) => logger(`reconnect failed: ${err.message}`));
          }, 3000);
        }
      }
    });

    s.ev.on('messages.upsert', ({ messages, type }) => {
      // Only 'notify' events are genuinely new messages. 'append' events
      // are history sync and must never trigger replies.
      if (type !== 'notify') return;
      for (const msg of messages || []) onMessage(msg);
    });
  }

  // Baileys is only required when a real socket is used, so tests with a
  // stub factory never load it. Guard the DisconnectReason lookup.
  function loadBaileysSafe() {
    try {
      return loadBaileys();
    } catch {
      return {};
    }
  }

  async function start() {
    if (stopped) return;
    const factory = socketFactory || defaultFactory;
    sock = await factory();
    wire(sock);
    emitter.emit('started');
  }

  async function sendText(chatId, text) {
    if (!sock) throw new Error('WhatsApp client is not connected.');
    return sock.sendMessage(chatId, { text });
  }

  async function setComposing(chatId) {
    if (!sock) return;
    try {
      await sock.sendPresenceUpdate('composing', chatId);
    } catch {
      // Presence is best-effort; a failure must not block the reply.
    }
  }

  async function setPausedPresence(chatId) {
    if (!sock) return;
    try {
      await sock.sendPresenceUpdate('paused', chatId);
    } catch {
      // Best-effort only.
    }
  }

  // Returns the raw own JID as reported by Baileys. It may carry a
  // device suffix (e.g. "123:5@s.whatsapp.net"); compare it with
  // normalizeJid() from router.js, never with raw string equality.
  function getOwnJid() {
    return ownJid;
  }

  function stop() {
    stopped = true;
    if (reconnectTimer) clearTimeout(reconnectTimer);
    try {
      if (sock && typeof sock.end === 'function') sock.end();
      else if (sock && sock.ws && typeof sock.ws.close === 'function') sock.ws.close();
    } catch {
      // Ignore errors during shutdown.
    }
  }

  return { start, sendText, setComposing, setPausedPresence, getOwnJid, stop, emitter };
}

module.exports = { createClient };
