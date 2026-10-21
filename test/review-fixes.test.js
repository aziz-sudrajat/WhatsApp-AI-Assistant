// Tests for the independent-review fixes 2, 5, 6, 7.
// (Fixes 1, 3, 4 have their own tests: drafts-concurrency.test.js and
// the new gateway handler tests in gateway.test.js.)

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { loadConfig, validateConfig } = require('../src/config');
const {
  decide,
  normalizeJid,
  isNewsletterJid,
} = require('../src/router/router');
const { RateLimiter } = require('../src/policy/rate');
const { TakeoverTracker } = require('../src/policy/takeover');
const { parseConfigSetArgs } = require('../src/cli');

function tmpRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'wa-ai-fix-'));
}

function baseConfig(overrides = {}) {
  const { config } = loadConfig({ env: {}, root: tmpRoot() });
  return { ...config, ...overrides };
}

function waMsg({ remoteJid, text, mentions = [] }) {
  const message =
    mentions.length > 0
      ? { extendedTextMessage: { text, contextInfo: { mentionedJid: mentions } } }
      : { conversation: text };
  return { key: { remoteJid, fromMe: false, id: 'MSG1' }, message };
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

describe('review fix 2: newsletter channels are skipped', () => {
  it('newsletter JIDs skip like status broadcasts, without a provider call', () => {
    const config = baseConfig({ defaultMode: 'auto' });
    const d = decide({
      ...deps(config),
      msg: waMsg({ remoteJid: '123@newsletter', text: 'hi' }),
    });
    assert.equal(d.action, 'skip');
    assert.match(d.reason, /newsletter/);
    assert.equal(isNewsletterJid('123@newsletter'), true);
    assert.equal(isNewsletterJid('123@s.whatsapp.net'), false);
  });
});

describe('review fix 7: JID normalization for mentions', () => {
  it('normalizeJid strips device suffixes but keeps the server part', () => {
    assert.equal(normalizeJid('123:5@s.whatsapp.net'), '123@s.whatsapp.net');
    assert.equal(normalizeJid('123@s.whatsapp.net'), '123@s.whatsapp.net');
    assert.equal(normalizeJid('123@lid'), '123@lid');
    assert.equal(normalizeJid('123:5@lid'), '123@lid');
    assert.equal(normalizeJid(''), '');
    assert.equal(normalizeJid(null), '');
  });

  it('mentionOnly fires when the mention carries a device suffix', () => {
    const config = baseConfig({ mentionOnly: true });
    const d = decide({
      ...deps(config),
      msg: waMsg({ remoteJid: '123@g.us', text: '@me hi', mentions: ['me:12@s.whatsapp.net'] }),
    });
    assert.notEqual(d.action, 'skip');
  });

  it('mentionOnly stays fail-closed across LID vs phone-number namespaces', () => {
    const config = baseConfig({ mentionOnly: true });
    const d = decide({
      ...deps(config),
      msg: waMsg({ remoteJid: '123@g.us', text: '@me hi', mentions: ['me@lid'] }),
    });
    assert.equal(d.action, 'skip');
    assert.match(d.reason, /not mentioned/);
  });
});

describe('review fix 5: config validation for timing and history fields', () => {
  function configWith(env) {
    return loadConfig({ env: { AI_PROVIDER: 'ollama', ...env }, root: tmpRoot() }).config;
  }

  it('rejects negative typingDelayMs and historyLimit, and non-positive draftPollMs', () => {
    assert.throws(() => validateConfig(configWith({ TYPING_DELAY_MS: '-1' })), /typingDelayMs/);
    assert.throws(() => validateConfig(configWith({ HISTORY_LIMIT: '-1' })), /historyLimit/);
    assert.throws(() => validateConfig(configWith({ DRAFT_POLL_MS: '0' })), /draftPollMs/);
    assert.throws(() => validateConfig(configWith({ DRAFT_POLL_MS: '-5' })), /draftPollMs/);
  });

  it('accepts zero delays/limits and a positive poll interval', () => {
    validateConfig(configWith({ TYPING_DELAY_MS: '0', HISTORY_LIMIT: '0', DRAFT_POLL_MS: '1' }));
  });
});

describe('review fix 6: config set keeps multi-word values', () => {
  it('joins all words after the key', () => {
    assert.deepEqual(parseConfigSetArgs(['set', 'systemPrompt', 'hello', 'world']), {
      key: 'systemPrompt',
      rawValue: 'hello world',
    });
    assert.deepEqual(parseConfigSetArgs(['set', 'aiModel', 'gpt-4o-mini']), {
      key: 'aiModel',
      rawValue: 'gpt-4o-mini',
    });
  });

  it('throws on a missing key or value', () => {
    assert.throws(() => parseConfigSetArgs(['set']), /Usage/);
    assert.throws(() => parseConfigSetArgs(['set', 'systemPrompt']), /Usage/);
  });
});
