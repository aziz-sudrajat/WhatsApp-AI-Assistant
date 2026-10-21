// Tests for router decisions: modes, filters, takeover, rate limits.
// No network, no WhatsApp connection.

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { loadConfig } = require('../src/config');
const { decide, ChatHistory, buildMessages } = require('../src/router/router');
const { RateLimiter } = require('../src/policy/rate');
const { TakeoverTracker } = require('../src/policy/takeover');

function tmpRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'wa-ai-router-'));
}

function baseConfig(overrides = {}) {
  const { config } = loadConfig({ env: {}, root: tmpRoot() });
  return { ...config, ...overrides };
}

function waMsg({ remoteJid, text, fromMe = false, mentions = [] }) {
  const message =
    mentions.length > 0
      ? { extendedTextMessage: { text, contextInfo: { mentionedJid: mentions } } }
      : { conversation: text };
  return { key: { remoteJid, fromMe, id: 'MSG1' }, message };
}

function deps(config, overrides = {}) {
  return {
    msg: null,
    ownJid: 'me@s.whatsapp.net',
    config,
    state: { paused: false },
    takeover: new TakeoverTracker(config.takeoverCooldownMin * 60_000),
    limiter: new RateLimiter(config.maxRepliesPerMin),
    ...overrides,
  };
}

describe('router modes', () => {
  it('auto mode replies, draft mode drafts, off mode skips', () => {
    const config = baseConfig({ defaultMode: 'auto' });
    let d = decide({ ...deps(config), msg: waMsg({ remoteJid: '123@s.whatsapp.net', text: 'hi' }) });
    assert.equal(d.action, 'reply');

    const draftConfig = baseConfig({ defaultMode: 'draft' });
    d = decide({ ...deps(draftConfig), msg: waMsg({ remoteJid: '123@s.whatsapp.net', text: 'hi' }) });
    assert.equal(d.action, 'draft');

    const offConfig = baseConfig({ defaultMode: 'off' });
    d = decide({ ...deps(offConfig), msg: waMsg({ remoteJid: '123@s.whatsapp.net', text: 'hi' }) });
    assert.equal(d.action, 'skip');
  });

  it('per-chat mode overrides the default mode', () => {
    const config = baseConfig({
      defaultMode: 'auto',
      chatModes: { '123@s.whatsapp.net': 'off' },
    });
    const d = decide({ ...deps(config), msg: waMsg({ remoteJid: '123@s.whatsapp.net', text: 'hi' }) });
    assert.equal(d.action, 'skip');
    assert.match(d.reason, /mode is off/);
  });
});

describe('router filters', () => {
  it('blocklist blocks, allowlist restricts', () => {
    const blocked = baseConfig({ blocklist: ['bad@s.whatsapp.net'] });
    let d = decide({ ...deps(blocked), msg: waMsg({ remoteJid: 'bad@s.whatsapp.net', text: 'hi' }) });
    assert.equal(d.action, 'skip');

    const allowed = baseConfig({ allowlist: ['good@s.whatsapp.net'] });
    d = decide({ ...deps(allowed), msg: waMsg({ remoteJid: 'other@s.whatsapp.net', text: 'hi' }) });
    assert.equal(d.action, 'skip');
    d = decide({ ...deps(allowed), msg: waMsg({ remoteJid: 'good@s.whatsapp.net', text: 'hi' }) });
    assert.notEqual(d.action, 'skip');
  });

  it('privateOnly skips groups but not private chats', () => {
    const config = baseConfig({ privateOnly: true });
    let d = decide({ ...deps(config), msg: waMsg({ remoteJid: '123@g.us', text: 'hi' }) });
    assert.equal(d.action, 'skip');
    d = decide({ ...deps(config), msg: waMsg({ remoteJid: '123@s.whatsapp.net', text: 'hi' }) });
    assert.notEqual(d.action, 'skip');
  });

  it('mentionOnly skips unmentioned group messages', () => {
    const config = baseConfig({ mentionOnly: true });
    let d = decide({
      ...deps(config),
      msg: waMsg({ remoteJid: '123@g.us', text: 'hello everyone' }),
    });
    assert.equal(d.action, 'skip');
    d = decide({
      ...deps(config),
      msg: waMsg({ remoteJid: '123@g.us', text: '@me hi', mentions: ['me@s.whatsapp.net'] }),
    });
    assert.notEqual(d.action, 'skip');
    // Private chats are unaffected by mentionOnly.
    d = decide({ ...deps(config), msg: waMsg({ remoteJid: '123@s.whatsapp.net', text: 'hi' }) });
    assert.notEqual(d.action, 'skip');
  });

  it('status broadcasts and empty messages are skipped', () => {
    const config = baseConfig();
    let d = decide({ ...deps(config), msg: waMsg({ remoteJid: 'status@broadcast', text: 'hi' }) });
    assert.equal(d.action, 'skip');
    d = decide({ ...deps(config), msg: waMsg({ remoteJid: '123@s.whatsapp.net', text: '   ' }) });
    assert.equal(d.action, 'skip');
  });

  it('global pause skips everything', () => {
    const config = baseConfig();
    const d = decide({
      ...deps(config, { state: { paused: true } }),
      msg: waMsg({ remoteJid: '123@s.whatsapp.net', text: 'hi' }),
    });
    assert.equal(d.action, 'skip');
    assert.match(d.reason, /globally paused/);
  });
});

describe('router takeover and rate limits', () => {
  it('owner message triggers takeover, then the cooldown expires', () => {
    const config = baseConfig({ takeoverCooldownMin: 30 });
    const takeover = new TakeoverTracker(30 * 60_000);
    const now = Date.now();
    const d1 = decide({
      ...deps(config, { takeover }),
      msg: waMsg({ remoteJid: '123@s.whatsapp.net', text: 'I got this', fromMe: true }),
      now,
    });
    assert.equal(d1.action, 'takeover');
    const d2 = decide({
      ...deps(config, { takeover }),
      msg: waMsg({ remoteJid: '123@s.whatsapp.net', text: 'hello?' }),
      now: now + 1000,
    });
    assert.equal(d2.action, 'skip');
    assert.match(d2.reason, /takeover cooldown/);
    const d3 = decide({
      ...deps(config, { takeover }),
      msg: waMsg({ remoteJid: '123@s.whatsapp.net', text: 'hello?' }),
      now: now + 31 * 60_000,
    });
    assert.notEqual(d3.action, 'skip');
  });

  it('per-chat rate limit blocks after the allowance is used', () => {
    const config = baseConfig({ defaultMode: 'auto', maxRepliesPerMin: 2 });
    const limiter = new RateLimiter(2);
    const now = Date.now();
    const mk = () =>
      decide({
        ...deps(config, { limiter }),
        msg: waMsg({ remoteJid: '123@s.whatsapp.net', text: 'hi' }),
        now,
      });
    assert.equal(mk().action, 'reply');
    assert.equal(mk().action, 'reply');
    const third = mk();
    assert.equal(third.action, 'skip');
    assert.match(third.reason, /rate limit/);
  });
});

describe('chat history', () => {
  it('caps history at the limit, oldest first out', () => {
    const h = new ChatHistory(2);
    h.add('c1', 'user', 'one');
    h.add('c1', 'assistant', 'two');
    h.add('c1', 'user', 'three');
    assert.deepEqual(h.get('c1'), [
      { role: 'assistant', content: 'two' },
      { role: 'user', content: 'three' },
    ]);
  });

  it('buildMessages puts system first, then history, then the user turn', () => {
    const { system, messages } = buildMessages({
      system: 'sys',
      history: [{ role: 'user', content: 'old' }],
      userText: 'new',
    });
    assert.equal(system, 'sys');
    assert.deepEqual(messages, [
      { role: 'user', content: 'old' },
      { role: 'user', content: 'new' },
    ]);
  });
});
