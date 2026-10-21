// AI provider abstraction: every provider exposes the same interface,
//   chat({ system, messages, fetchImpl }) -> reply text
// Messages use OpenAI-style roles: { role: 'user'|'assistant', content }.
// Plain global fetch only; no provider SDKs. fetchImpl is injectable so
// tests can run without any network access.

const { getProviderMeta } = require('../config');

async function postJson(url, headers, body, fetchImpl) {
  const res = await fetchImpl(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  let data = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  if (!res.ok) {
    const excerpt = data ? JSON.stringify(data).slice(0, 300) : `HTTP ${res.status}`;
    throw new Error(`Provider request failed (HTTP ${res.status}): ${excerpt}`);
  }
  return data;
}

function requireText(text, provider) {
  if (!text || !String(text).trim()) {
    throw new Error(`Provider "${provider}" returned an empty reply.`);
  }
  return String(text);
}

// OpenAI-compatible chat completions shape. Used by OpenAI, DeepSeek,
// Groq, Mistral, and custom endpoints.
async function chatOpenAICompatible({ baseUrl, apiKey, model, system, messages, fetchImpl }) {
  const payload = {
    model,
    messages: [
      ...(system ? [{ role: 'system', content: system }] : []),
      ...messages,
    ],
  };
  const data = await postJson(
    `${baseUrl.replace(/\/$/, '')}/chat/completions`,
    { Authorization: `Bearer ${apiKey}` },
    payload,
    fetchImpl
  );
  const text = data?.choices?.[0]?.message?.content;
  return requireText(text, 'openai-compatible');
}

async function chatAnthropic({ baseUrl, apiKey, model, system, messages, fetchImpl }) {
  const data = await postJson(
    `${baseUrl.replace(/\/$/, '')}/v1/messages`,
    { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    { model, max_tokens: 1024, ...(system ? { system } : {}), messages },
    fetchImpl
  );
  const text = (data?.content || [])
    .filter((part) => part.type === 'text')
    .map((part) => part.text)
    .join('');
  return requireText(text, 'anthropic');
}

async function chatGemini({ baseUrl, apiKey, model, system, messages, fetchImpl }) {
  const url = `${baseUrl.replace(/\/$/, '')}/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const contents = messages.map((m) => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }],
  }));
  const body = {
    contents,
    ...(system ? { system_instruction: { parts: [{ text: system }] } } : {}),
  };
  const data = await postJson(url, {}, body, fetchImpl);
  const text = (data?.candidates?.[0]?.content?.parts || [])
    .map((part) => part.text || '')
    .join('');
  return requireText(text, 'gemini');
}

async function chatOllama({ baseUrl, model, system, messages, fetchImpl }) {
  const data = await postJson(
    `${baseUrl.replace(/\/$/, '')}/api/chat`,
    {},
    {
      model,
      messages: [
        ...(system ? [{ role: 'system', content: system }] : []),
        ...messages,
      ],
      stream: false,
    },
    fetchImpl
  );
  return requireText(data?.message?.content, 'ollama');
}

const CHATTERS = {
  openai: chatOpenAICompatible,
  anthropic: chatAnthropic,
  gemini: chatGemini,
  ollama: chatOllama,
};

// Build a provider client from resolved config values.
//   createProvider({ provider, model, baseUrl, apiKey })
// Returns { name, model, chat({ system, messages, fetchImpl }) }.
function createProvider({ provider, model, baseUrl, apiKey }) {
  const meta = getProviderMeta(provider);
  const chatter = CHATTERS[meta.kind];
  if (!chatter) {
    throw new Error(`No chat implementation for provider kind "${meta.kind}".`);
  }
  const resolvedBase = baseUrl || meta.baseUrl;
  if (!resolvedBase) {
    throw new Error(`Provider "${provider}" has no base URL. Set CUSTOM_BASE_URL for custom providers.`);
  }
  const resolvedModel = model || meta.defaultModel;
  if (!resolvedModel) {
    throw new Error(`Provider "${provider}" has no model. Set AI_MODEL.`);
  }
  return {
    name: provider,
    model: resolvedModel,
    async chat({ system, messages, fetchImpl = globalThis.fetch }) {
      if (typeof fetchImpl !== 'function') {
        throw new Error('A fetch implementation is required.');
      }
      return chatter({
        baseUrl: resolvedBase,
        apiKey: apiKey || '',
        model: resolvedModel,
        system,
        messages,
        fetchImpl,
      });
    },
  };
}

module.exports = { createProvider, getProviderMeta };
