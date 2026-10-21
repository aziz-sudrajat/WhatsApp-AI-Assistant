// Message routing: decide what the gateway does with one incoming
// WhatsApp message. Pure decision logic (no network, no Baileys), so it
// is fully unit-testable.
//
// Decision actions:
//   'reply'    -> generate an AI reply and send it now
//   'draft'    -> generate an AI reply and hold it for owner approval
//   'takeover' -> the owner wrote from their phone; pause AI for this chat
//   'skip'     -> do nothing (reason explains why)

function isGroupJid(jid) {
  return typeof jid === 'string' && jid.endsWith('@g.us');
}

function isStatusBroadcast(jid) {
  return jid === 'status@broadcast';
}

function isNewsletterJid(jid) {
  return typeof jid === 'string' && jid.endsWith('@newsletter');
}

// Normalize a WhatsApp JID for comparison: strip the device suffix
// (":<device>") that Baileys may attach, e.g. "123:5@s.whatsapp.net"
// becomes "123@s.whatsapp.net". The server part is kept: "@lid" and
// "@s.whatsapp.net" are different namespaces and are NOT equated, so a
// mention using a LID JID will not match an s.whatsapp.net own JID.
// Documented limitation: mentionOnly matching requires the mention and
// the own JID to share the same server part after device-suffix
// stripping; a LID mention against a phone-number own JID never fires
// (fail-closed: the message is skipped, never wrongly replied to).
function normalizeJid(jid) {
  if (typeof jid !== 'string') return '';
  const at = jid.indexOf('@');
  if (at === -1) return jid;
  const user = jid.slice(0, at).split(':')[0];
  return `${user}@${jid.slice(at + 1)}`;
}

// Extract plain text from a Baileys message object. Returns '' when the
// message carries no text (image, sticker, protocol message, ...).
function extractText(msg) {
  const m = msg.message || {};
  if (typeof m.conversation === 'string') return m.conversation;
  if (m.extendedTextMessage && typeof m.extendedTextMessage.text === 'string') {
    return m.extendedTextMessage.text;
  }
  return '';
}

function getMentions(msg) {
  return (
    msg.message?.extendedTextMessage?.contextInfo?.mentionedJid || []
  );
}

// Per-chat rolling history (capped, oldest entries dropped first).
class ChatHistory {
  constructor(limit = 20) {
    this.limit = limit;
    this.byChat = new Map(); // chatId -> [{ role, content }]
  }

  add(chatId, role, content) {
    const list = this.byChat.get(chatId) || [];
    list.push({ role, content });
    while (list.length > this.limit) list.shift();
    this.byChat.set(chatId, list);
  }

  get(chatId) {
    return [...(this.byChat.get(chatId) || [])];
  }
}

// Build the message list sent to the AI provider.
function buildMessages({ system, history, userText }) {
  return {
    system,
    messages: [...history, { role: 'user', content: userText }],
  };
}

// Decide the action for one message.
//   msg: Baileys message object
//   ownJid: the gateway account's JID (for mention detection), may be null
//   config: resolved config object
//   state: { paused } global gateway state
//   takeover: TakeoverTracker instance
//   limiter: RateLimiter instance
//   now: epoch ms (injectable for tests)
function decide({ msg, ownJid, config, state, takeover, limiter, now = Date.now() }) {
  const chatId = msg.key?.remoteJid || '';
  const text = extractText(msg);
  const fromMe = !!msg.key?.fromMe;
  const group = isGroupJid(chatId);

  if (isStatusBroadcast(chatId)) return { action: 'skip', reason: 'status broadcast', chatId, group, text };
  if (isNewsletterJid(chatId)) return { action: 'skip', reason: 'newsletter channel', chatId, group, text };
  if (!text.trim()) return { action: 'skip', reason: 'no text content', chatId, group, text };

  // The owner's own message: human takeover, never an AI reply.
  if (fromMe) {
    takeover.noteTakeover(chatId, now);
    return { action: 'takeover', reason: 'owner message from phone', chatId, group, text };
  }

  if (state.paused) return { action: 'skip', reason: 'gateway globally paused', chatId, group, text };
  if (takeover.isPaused(chatId, now)) {
    return { action: 'skip', reason: 'human takeover cooldown active', chatId, group, text };
  }
  if (config.blocklist.includes(chatId)) {
    return { action: 'skip', reason: 'chat is blocklisted', chatId, group, text };
  }
  if (config.allowlist.length > 0 && !config.allowlist.includes(chatId)) {
    return { action: 'skip', reason: 'chat is not allowlisted', chatId, group, text };
  }
  if (config.privateOnly && group) {
    return { action: 'skip', reason: 'groups disabled (private-only mode)', chatId, group, text };
  }
  if (config.mentionOnly && group) {
    const mentions = getMentions(msg);
    const own = ownJid ? normalizeJid(ownJid) : '';
    if (!own || !mentions.some((m) => normalizeJid(m) === own)) {
      return { action: 'skip', reason: 'bot not mentioned in group', chatId, group, text };
    }
  }

  const mode = config.chatModes[chatId] || config.defaultMode;
  if (mode === 'off') return { action: 'skip', reason: 'chat mode is off', chatId, group, text };
  if (!limiter.allow(chatId, now)) {
    return { action: 'skip', reason: 'per-chat rate limit reached', chatId, group, text };
  }
  if (mode === 'auto') return { action: 'reply', reason: 'chat mode is auto', chatId, group, text };
  return { action: 'draft', reason: 'chat mode is draft', chatId, group, text };
}

module.exports = {
  isGroupJid,
  isStatusBroadcast,
  isNewsletterJid,
  normalizeJid,
  extractText,
  getMentions,
  ChatHistory,
  buildMessages,
  decide,
};
