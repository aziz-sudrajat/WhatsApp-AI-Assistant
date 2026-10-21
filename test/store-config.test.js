// Tests for the draft store and config loading. No network, no WhatsApp.

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { appendDraft, listPending, approveDraft, markSent, readDrafts } = require('../src/store/drafts');
const { readState, setPaused } = require('../src/store/state');
const { loadConfig, validateConfig, parseDotEnvText } = require('../src/config');

function tmpFile(name) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-ai-store-'));
  return path.join(dir, name);
}

describe('draft store', () => {
  it('appends, lists pending, approves, and marks sent', () => {
    const file = tmpFile('drafts.jsonl');
    const d1 = appendDraft(file, { chatId: 'a@s.whatsapp.net', incomingText: 'hi', draftText: 'hello' });
    appendDraft(file, { chatId: 'b@s.whatsapp.net', incomingText: 'yo', draftText: 'hey' });
    assert.equal(d1.status, 'pending');
    assert.ok(d1.id.startsWith('draft-'));
    assert.equal(listPending(file).length, 2);

    const approved = approveDraft(file, d1.id);
    assert.equal(approved.status, 'approved');
    assert.equal(listPending(file).length, 1);
    assert.equal(approveDraft(file, d1.id), null); // already approved
    assert.equal(approveDraft(file, 'missing'), null);

    const sent = markSent(file, d1.id);
    assert.equal(sent.status, 'sent');
    assert.equal(readDrafts(file).find((d) => d.id === d1.id).status, 'sent');
  });

  it('reads an empty file as no drafts', () => {
    const file = tmpFile('drafts.jsonl');
    assert.deepEqual(listPending(file), []);
  });
});

describe('gateway state', () => {
  it('defaults to unpaused and toggles', () => {
    const file = tmpFile('state.json');
    assert.equal(readState(file).paused, false);
    setPaused(file, true);
    assert.equal(readState(file).paused, true);
    setPaused(file, false);
    assert.equal(readState(file).paused, false);
  });
});

describe('config loading', () => {
  it('applies defaults', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-ai-cfg-'));
    const { config, warnings } = loadConfig({ env: {}, root });
    assert.equal(config.aiProvider, 'openai');
    assert.equal(config.defaultMode, 'draft');
    assert.equal(config.maxRepliesPerMin, 5);
    assert.ok(warnings.some((w) => w.includes('OPENAI_API_KEY')));
  });

  it('applies environment overrides', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-ai-cfg-'));
    const { config } = loadConfig({
      env: {
        AI_PROVIDER: 'groq',
        AI_MODEL: 'llama-3.3-70b-versatile',
        GROQ_API_KEY: 'g-key',
        DEFAULT_MODE: 'auto',
        PRIVATE_ONLY: 'true',
        ALLOWLIST: 'a@s.whatsapp.net, b@s.whatsapp.net',
        MAX_REPLIES_PER_MIN: '2',
      },
      root,
    });
    assert.equal(config.aiProvider, 'groq');
    assert.equal(config.aiModel, 'llama-3.3-70b-versatile');
    assert.equal(config.defaultMode, 'auto');
    assert.equal(config.privateOnly, true);
    assert.deepEqual(config.allowlist, ['a@s.whatsapp.net', 'b@s.whatsapp.net']);
    assert.equal(config.maxRepliesPerMin, 2);
  });

  it('validates strictly for providers that need a key', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-ai-cfg-'));
    const { config } = loadConfig({ env: { AI_PROVIDER: 'openai' }, root });
    assert.throws(() => validateConfig(config), /OPENAI_API_KEY/);

    const ollama = loadConfig({ env: { AI_PROVIDER: 'ollama' }, root }).config;
    validateConfig(ollama); // no key needed, must not throw
  });

  it('rejects unknown providers', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-ai-cfg-'));
    assert.throws(() => loadConfig({ env: { AI_PROVIDER: 'nope' }, root }), /Unknown AI provider/);
  });

  it('parses .env text', () => {
    const parsed = parseDotEnvText([
      '# comment',
      'export FOO=bar',
      'QUOTED="hello world"',
      "SINGLE='x y'",
      'EMPTY=',
      'NOEQUALS',
      '',
    ].join('\n'));
    assert.deepEqual(parsed, { FOO: 'bar', QUOTED: 'hello world', SINGLE: 'x y', EMPTY: '' });
  });
});
