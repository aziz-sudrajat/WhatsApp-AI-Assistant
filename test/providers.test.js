// Tests for AI providers with a mocked fetch implementation.
// No network access, no API keys.

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { createProvider } = require('../src/ai/providers');

function mockFetch({ ok = true, status = 200, json }) {
  const calls = [];
  const fn = async (url, opts) => {
    calls.push({ url, opts, body: JSON.parse(opts.body) });
    return { ok, status, json: async () => json };
  };
  fn.calls = calls;
  return fn;
}

describe('OpenAI-compatible providers', () => {
  it('sends a chat completions request and parses the reply', async () => {
    const fetchImpl = mockFetch({
      json: { choices: [{ message: { content: 'hello back' } }] },
    });
    const provider = createProvider({
      provider: 'openai',
      model: 'gpt-4o-mini',
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'test-key',
    });
    const text = await provider.chat({
      system: 'be nice',
      messages: [{ role: 'user', content: 'hi' }],
      fetchImpl,
    });
    assert.equal(text, 'hello back');
    assert.equal(fetchImpl.calls.length, 1);
    assert.equal(fetchImpl.calls[0].url, 'https://api.openai.com/v1/chat/completions');
    assert.equal(fetchImpl.calls[0].opts.headers.Authorization, 'Bearer test-key');
    assert.deepEqual(fetchImpl.calls[0].body.messages, [
      { role: 'system', content: 'be nice' },
      { role: 'user', content: 'hi' },
    ]);
  });

  it('custom provider uses its own base URL', async () => {
    const fetchImpl = mockFetch({
      json: { choices: [{ message: { content: 'custom reply' } }] },
    });
    const provider = createProvider({
      provider: 'custom',
      model: 'my-model',
      baseUrl: 'https://example.invalid/v1',
      apiKey: 'custom-key',
    });
    const text = await provider.chat({ system: '', messages: [{ role: 'user', content: 'hi' }], fetchImpl });
    assert.equal(text, 'custom reply');
    assert.equal(fetchImpl.calls[0].url, 'https://example.invalid/v1/chat/completions');
  });

  it('throws a clear error on HTTP failure', async () => {
    const fetchImpl = mockFetch({ ok: false, status: 401, json: { error: { message: 'bad key' } } });
    const provider = createProvider({
      provider: 'deepseek',
      model: 'deepseek-chat',
      baseUrl: 'https://api.deepseek.com/v1',
      apiKey: 'bad',
    });
    await assert.rejects(
      provider.chat({ system: '', messages: [{ role: 'user', content: 'hi' }], fetchImpl }),
      /HTTP 401/
    );
  });

  it('throws on an empty reply', async () => {
    const fetchImpl = mockFetch({ json: { choices: [{ message: { content: '   ' } }] } });
    const provider = createProvider({
      provider: 'groq',
      model: 'llama-3.3-70b-versatile',
      baseUrl: 'https://api.groq.com/openai/v1',
      apiKey: 'k',
    });
    await assert.rejects(
      provider.chat({ system: '', messages: [{ role: 'user', content: 'hi' }], fetchImpl }),
      /empty reply/
    );
  });
});

describe('Anthropic provider', () => {
  it('sends a messages request and joins text parts', async () => {
    const fetchImpl = mockFetch({
      json: { content: [{ type: 'text', text: 'Hello ' }, { type: 'text', text: 'there' }] },
    });
    const provider = createProvider({
      provider: 'anthropic',
      model: 'claude-3-5-sonnet-20241022',
      baseUrl: 'https://api.anthropic.com',
      apiKey: 'ant-key',
    });
    const text = await provider.chat({
      system: 'sys',
      messages: [{ role: 'user', content: 'hi' }],
      fetchImpl,
    });
    assert.equal(text, 'Hello there');
    assert.equal(fetchImpl.calls[0].url, 'https://api.anthropic.com/v1/messages');
    assert.equal(fetchImpl.calls[0].opts.headers['x-api-key'], 'ant-key');
    assert.equal(fetchImpl.calls[0].body.system, 'sys');
  });
});

describe('Gemini provider', () => {
  it('maps roles and parses candidates', async () => {
    const fetchImpl = mockFetch({
      json: { candidates: [{ content: { parts: [{ text: 'gemini says hi' }] } }] },
    });
    const provider = createProvider({
      provider: 'gemini',
      model: 'gemini-2.0-flash',
      baseUrl: 'https://generativelanguage.googleapis.com',
      apiKey: 'g-key',
    });
    const text = await provider.chat({
      system: 'sys',
      messages: [
        { role: 'user', content: 'hi' },
        { role: 'assistant', content: 'yo' },
      ],
      fetchImpl,
    });
    assert.equal(text, 'gemini says hi');
    assert.match(fetchImpl.calls[0].url, /generateContent\?key=g-key/);
    assert.deepEqual(
      fetchImpl.calls[0].body.contents.map((c) => c.role),
      ['user', 'model']
    );
  });
});

describe('Ollama provider', () => {
  it('posts to /api/chat without a key and parses the message', async () => {
    const fetchImpl = mockFetch({
      json: { message: { role: 'assistant', content: 'local reply' } },
    });
    const provider = createProvider({
      provider: 'ollama',
      model: 'llama3.1',
      baseUrl: 'http://localhost:11434',
      apiKey: null,
    });
    const text = await provider.chat({
      system: '',
      messages: [{ role: 'user', content: 'hi' }],
      fetchImpl,
    });
    assert.equal(text, 'local reply');
    assert.equal(fetchImpl.calls[0].url, 'http://localhost:11434/api/chat');
    assert.equal(fetchImpl.calls[0].body.stream, false);
  });
});

describe('provider factory errors', () => {
  it('rejects unknown providers', () => {
    assert.throws(() => createProvider({ provider: 'nope', model: 'x', baseUrl: 'u', apiKey: 'k' }), /Unknown AI provider/);
  });

  it('requires a base URL and model for custom providers', () => {
    assert.throws(() => createProvider({ provider: 'custom', model: 'm', baseUrl: null, apiKey: 'k' }), /base URL/);
    assert.throws(() => createProvider({ provider: 'custom', model: null, baseUrl: 'https://x.invalid', apiKey: 'k' }), /no model/);
  });
});
