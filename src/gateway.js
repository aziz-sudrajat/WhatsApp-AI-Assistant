// Gateway: turns incoming WhatsApp messages into AI replies, drafts, or
// silence, following the router's decision. Also polls the drafts file
// for owner-approved drafts and sends them.
//
// The handler is dependency-injected (sendText, provider, stores), so the
// whole decision flow is testable without any WhatsApp connection.

const { decide, extractText, ChatHistory, buildMessages } = require('./router/router');
const { appendLog } = require('./store/logs');
const { appendDraft, readDrafts, markSent } = require('./store/drafts');
const { readState } = require('./store/state');

// Build the per-message handler. deps:
//   config, provider, client ({ sendText, setComposing, setPausedPresence, getOwnJid }),
//   takeover, limiter, history, log (defaults to appendLog to config.logFile)
function createHandler(deps) {
  const {
    config,
    provider,
    client,
    takeover,
    limiter,
    history = new ChatHistory(config.historyLimit),
    log = (entry) => appendLog(config.logFile, entry),
  } = deps;

  return async function handleMessage(msg) {
    const chatId = msg.key?.remoteJid || '';
    const text = extractText(msg);
    const sender = msg.key?.participant || chatId;

    if (!chatId) return { action: 'skip', reason: 'no chat id' };

    log({ type: 'inbound', chatId, sender, text: text.slice(0, 500) });

    const state = readState(config.stateFile);
    const decision = decide({
      msg,
      ownJid: client.getOwnJid(),
      config,
      state,
      takeover,
      limiter,
    });

    if (decision.action === 'takeover') {
      log({ type: 'takeover', chatId, cooldownMin: config.takeoverCooldownMin });
      return decision;
    }
    if (decision.action === 'skip') {
      return decision;
    }

    // Generate the reply with the active AI provider. The user turn is
    // added to history only after a successful reply: on provider error
    // nothing is recorded, so a later call never sees a user turn
    // without its assistant reply (strict providers such as Gemini and
    // Anthropic require role alternation).
    const { system, messages } = buildMessages({
      system: config.systemPrompt,
      history: history.get(chatId),
      userText: text,
    });
    let reply;
    try {
      reply = await provider.chat({ system, messages });
    } catch (err) {
      log({ type: 'error', chatId, error: err.message });
      return { action: 'error', reason: err.message, chatId };
    }
    history.add(chatId, 'user', text);

    if (decision.action === 'draft') {
      const draft = appendDraft(config.draftsFile, {
        chatId,
        sender,
        incomingText: text,
        draftText: reply,
      });
      log({ type: 'draft', chatId, draftId: draft.id });
      return { action: 'draft', draftId: draft.id, chatId };
    }

    // Auto mode: typing simulation, then send. A send failure must not
    // lose the reply: it is written as a draft (fallback: 'send-failed')
    // so the owner can approve and resend it.
    await client.setComposing(chatId);
    if (config.typingDelayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, config.typingDelayMs));
    }
    try {
      await client.sendText(chatId, reply);
    } catch (err) {
      const draft = appendDraft(config.draftsFile, {
        chatId,
        sender,
        incomingText: text,
        draftText: reply,
        fallback: 'send-failed',
        sendError: err.message,
      });
      log({ type: 'error', chatId, draftId: draft.id, error: err.message });
      log({ type: 'draft', chatId, draftId: draft.id, fallback: 'send-failed' });
      return { action: 'draft', draftId: draft.id, chatId, fallback: 'send-failed' };
    }
    await client.setPausedPresence(chatId);
    history.add(chatId, 'assistant', reply);
    log({ type: 'outbound', chatId, text: reply.slice(0, 500) });
    return { action: 'reply', chatId };
  };
}

// Poll the drafts file for owner-approved drafts and send them. Returns a
// stop function. Only drafts with status "approved" are sent.
function startDraftPoller({ config, client, history, log }) {
  const poll = async () => {
    let drafts;
    try {
      drafts = readDrafts(config.draftsFile);
    } catch {
      return;
    }
    for (const draft of drafts) {
      if (draft.status !== 'approved') continue;
      try {
        await client.sendText(draft.chatId, draft.draftText);
        markSent(config.draftsFile, draft.id);
        history.add(draft.chatId, 'assistant', draft.draftText);
        log({ type: 'outbound', chatId: draft.chatId, draftId: draft.id, approved: true });
      } catch (err) {
        log({ type: 'error', chatId: draft.chatId, draftId: draft.id, error: err.message });
      }
    }
  };
  const timer = setInterval(() => {
    poll().catch(() => {});
  }, config.draftPollMs);
  return () => clearInterval(timer);
}

module.exports = { createHandler, startDraftPoller };
