// Tests for the gateway handler and the Baileys client wiring.
// Everything uses fakes: no network, no WhatsApp connection, no real
// provider calls.

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { EventEmitter } = require('events');

const { createHandler, startDraftPoller } = require('../src/gateway');
const { createClient } = require('../src/whatsapp/client');
const { ChatHistory } = require('../src/router/router');
const { RateLimiter } = require('../src/policy/rate');
const { TakeoverTracker } = require('../src/policy/takeover');
const { loadConfig } = require('../src/config');
const { listPending } = require('../src/store/drafts');

function tmpRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'wa-ai-gw-'));
}

function baseConfig(overrides = {}) {
  const { config } = loadConfig({ env: {}, root: tmpRoot() });
  return { ...config, ...overrides };
}

function waMsg({ remoteJid, text, fromMe = false }) {
  return { key: { remoteJid, fromMe, id: 'MSG1' }, message: { conversation: text } };
}

function fakeClient() {
  const sent = [];
  return {
    sent,
    getOwnJid: () => 'me@s.whatsapp.net',
    setComposing: async () => {},
    setPausedPresence: async () => {},
    sendText: async (chatId, text) => {
      sent.push({ chatId, text });
    },
  };
}

function handlerDeps(config, overrides = {}) {
  const logs = [];
  return {
    deps: {
      config,
      provider: { chat: async () => 'fake AI reply' },
      client: fakeClient(),
      takeover: new TakeoverTracker(config.takeoverCooldownMin * 60_000),
      limiter: new RateLimiter(config.maxRepliesPerMin),
      history: new ChatHistory(config.historyLimit),
      log: (entry) => logs.push(entry),
      ...overrides,
    },
    logs,
  };
}

describe('gateway handler', () => {
  it('auto mode sends the AI reply and logs outbound', async () => {
    const config = baseConfig({ defaultMode: 'auto', typingDelayMs: 0 });
    const { deps, logs } = handlerDeps(config);
    const handler = createHandler(deps);
    const res = await handler(waMsg({ remoteJid: 'a@s.whatsapp.net', text: 'hello' }));
    assert.equal(res.action, 'reply');
    assert.equal(deps.client.sent.length, 1);
    assert.equal(deps.client.sent[0].text, 'fake AI reply');
    assert.ok(logs.some((l) => l.type === 'outbound'));
  });

  it('draft mode writes a draft and sends nothing', async () => {
    const config = baseConfig({ defaultMode: 'draft' });
    const { deps } = handlerDeps(config);
    const handler = createHandler(deps);
    const res = await handler(waMsg({ remoteJid: 'a@s.whatsapp.net', text: 'hello' }));
    assert.equal(res.action, 'draft');
    assert.equal(deps.client.sent.length, 0);
    assert.equal(listPending(config.draftsFile).length, 1);
    assert.equal(listPending(config.draftsFile)[0].draftText, 'fake AI reply');
  });

  it('off mode sends nothing and writes no draft', async () => {
    const config = baseConfig({ defaultMode: 'off' });
    const { deps } = handlerDeps(config);
    const handler = createHandler(deps);
    const res = await handler(waMsg({ remoteJid: 'a@s.whatsapp.net', text: 'hello' }));
    assert.equal(res.action, 'skip');
    assert.equal(deps.client.sent.length, 0);
    assert.equal(listPending(config.draftsFile).length, 0);
  });

  it('owner message triggers takeover and sends nothing', async () => {
    const config = baseConfig({ defaultMode: 'auto', typingDelayMs: 0 });
    const { deps, logs } = handlerDeps(config);
    const handler = createHandler(deps);
    const res = await handler(waMsg({ remoteJid: 'a@s.whatsapp.net', text: 'I got this', fromMe: true }));
    assert.equal(res.action, 'takeover');
    assert.equal(deps.client.sent.length, 0);
    assert.ok(logs.some((l) => l.type === 'takeover'));
  });

  it('provider errors send nothing and are logged', async () => {
    const config = baseConfig({ defaultMode: 'auto', typingDelayMs: 0 });
    const { deps, logs } = handlerDeps(config, {
      provider: {
        chat: async () => {
          throw new Error('provider down');
        },
      },
    });
    const handler = createHandler(deps);
    const res = await handler(waMsg({ remoteJid: 'a@s.whatsapp.net', text: 'hello' }));
    assert.equal(res.action, 'error');
    assert.equal(deps.client.sent.length, 0);
    assert.ok(logs.some((l) => l.type === 'error'));
  });

  it('draft poller sends approved drafts and marks them sent', async () => {
    const config = baseConfig({ defaultMode: 'draft', draftPollMs: 20 });
    const { deps } = handlerDeps(config);
    const handler = createHandler(deps);
    await handler(waMsg({ remoteJid: 'a@s.whatsapp.net', text: 'hello' }));
    assert.equal(listPending(config.draftsFile).length, 1);

    const { approveDraft } = require('../src/store/drafts');
    const draft = listPending(config.draftsFile)[0];
    approveDraft(config.draftsFile, draft.id);

    const stop = startDraftPoller({
      config,
      client: deps.client,
      history: deps.history,
      log: () => {},
    });
    await new Promise((resolve) => setTimeout(resolve, 150));
    stop();
    assert.equal(deps.client.sent.length, 1);
    assert.equal(deps.client.sent[0].text, 'fake AI reply');
    assert.equal(listPending(config.draftsFile).length, 0);
  });

  it('auto send failure falls back to a draft instead of losing the reply', async () => {
    const config = baseConfig({ defaultMode: 'auto', typingDelayMs: 0 });
    const { deps } = handlerDeps(config, {
      client: {
        ...fakeClient(),
        sendText: async () => {
          throw new Error('send failed');
        },
      },
    });
    const handler = createHandler(deps);
    const res = await handler(waMsg({ remoteJid: 'a@s.whatsapp.net', text: 'hello' }));
    assert.equal(res.action, 'draft');
    assert.equal(res.fallback, 'send-failed');
    assert.ok(res.draftId);
    assert.equal(deps.client.sent.length, 0);
    const pending = listPending(config.draftsFile);
    assert.equal(pending.length, 1);
    assert.equal(pending[0].draftText, 'fake AI reply');
    assert.equal(pending[0].fallback, 'send-failed');
  });

  it('provider error records no history turn', async () => {
    const config = baseConfig({ defaultMode: 'auto', typingDelayMs: 0 });
    const { deps } = handlerDeps(config, {
      provider: {
        chat: async () => {
          throw new Error('provider down');
        },
      },
    });
    const handler = createHandler(deps);
    const res = await handler(waMsg({ remoteJid: 'a@s.whatsapp.net', text: 'hello' }));
    assert.equal(res.action, 'error');
    assert.deepEqual(deps.history.get('a@s.whatsapp.net'), []);
  });

  it('successful auto reply records user then assistant history', async () => {
    const config = baseConfig({ defaultMode: 'auto', typingDelayMs: 0 });
    const { deps } = handlerDeps(config);
    const handler = createHandler(deps);
    await handler(waMsg({ remoteJid: 'a@s.whatsapp.net', text: 'hello' }));
    assert.deepEqual(deps.history.get('a@s.whatsapp.net'), [
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'fake AI reply' },
    ]);
  });
});

describe('Baileys client wiring (fake socket)', () => {
  function fakeSocket() {
    const sock = {
      ev: new EventEmitter(),
      user: { id: 'me@s.whatsapp.net' },
      sent: [],
      sendMessage: async (chatId, content) => {
        sock.sent.push({ chatId, content });
      },
      sendPresenceUpdate: async () => {},
      end: () => {},
    };
    return sock;
  }

  it('routes QR, open, notify messages; ignores history appends', async () => {
    const sock = fakeSocket();
    let factoryCalls = 0;
    const events = { qr: [], connected: [], messages: [], disconnected: [] };
    const client = createClient({
      authDir: tmpRoot(),
      socketFactory: async () => {
        factoryCalls += 1;
        return sock;
      },
      onQr: (qr) => events.qr.push(qr),
      onConnected: (info) => events.connected.push(info),
      onMessage: (msg) => events.messages.push(msg),
      onDisconnected: (info) => events.disconnected.push(info),
    });
    await client.start();
    assert.equal(factoryCalls, 1);

    sock.ev.emit('connection.update', { qr: 'FAKE-QR-STRING' });
    assert.deepEqual(events.qr, ['FAKE-QR-STRING']);

    sock.ev.emit('connection.update', { connection: 'open' });
    assert.equal(events.connected.length, 1);
    assert.equal(events.connected[0].jid, 'me@s.whatsapp.net');
    assert.equal(client.getOwnJid(), 'me@s.whatsapp.net');

    const msg = waMsg({ remoteJid: 'a@s.whatsapp.net', text: 'hi' });
    sock.ev.emit('messages.upsert', { type: 'notify', messages: [msg] });
    assert.equal(events.messages.length, 1);
    sock.ev.emit('messages.upsert', { type: 'append', messages: [msg] });
    assert.equal(events.messages.length, 1); // history sync ignored

    await client.sendText('a@s.whatsapp.net', 'hello');
    assert.equal(sock.sent.length, 1);

    sock.ev.emit('connection.update', {
      connection: 'close',
      lastDisconnect: { error: { output: { statusCode: 500 } } },
    });
    assert.equal(events.disconnected.length, 1);
    assert.equal(events.disconnected[0].loggedOut, false);
    client.stop();
  });
});
