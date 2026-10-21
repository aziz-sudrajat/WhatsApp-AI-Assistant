// Configuration loading and validation.
// Secrets live ONLY in environment variables (or a local .env file that is
// never committed). This module never prints secret values.

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'data');

const DEFAULTS = {
  aiProvider: 'openai',
  aiModel: null, // null = provider default model
  systemPrompt:
    'You are a helpful personal assistant replying on WhatsApp. Keep replies short, natural, and helpful.',
  defaultMode: 'draft', // auto | draft | off
  privateOnly: false,
  mentionOnly: false,
  allowlist: [],
  blocklist: [],
  chatModes: {}, // chatId -> 'auto' | 'draft' | 'off'
  takeoverCooldownMin: 30,
  maxRepliesPerMin: 5,
  typingDelayMs: 1500,
  historyLimit: 20,
  draftPollMs: 5000,
};

// Provider metadata. `kind` selects the request/response shape.
// `envKey` is the NAME of the environment variable, never its value.
const PROVIDERS = {
  openai: {
    envKey: 'OPENAI_API_KEY',
    baseUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4o-mini',
    kind: 'openai',
  },
  anthropic: {
    envKey: 'ANTHROPIC_API_KEY',
    baseUrl: 'https://api.anthropic.com',
    defaultModel: 'claude-3-5-sonnet-20241022',
    kind: 'anthropic',
  },
  gemini: {
    envKey: 'GOOGLE_API_KEY',
    baseUrl: 'https://generativelanguage.googleapis.com',
    defaultModel: 'gemini-2.0-flash',
    kind: 'gemini',
  },
  deepseek: {
    envKey: 'DEEPSEEK_API_KEY',
    baseUrl: 'https://api.deepseek.com/v1',
    defaultModel: 'deepseek-chat',
    kind: 'openai',
  },
  groq: {
    envKey: 'GROQ_API_KEY',
    baseUrl: 'https://api.groq.com/openai/v1',
    defaultModel: 'llama-3.3-70b-versatile',
    kind: 'openai',
  },
  mistral: {
    envKey: 'MISTRAL_API_KEY',
    baseUrl: 'https://api.mistral.ai/v1',
    defaultModel: 'mistral-small-latest',
    kind: 'openai',
  },
  ollama: {
    envKey: null, // local server, no key needed
    baseUrl: 'http://localhost:11434',
    defaultModel: 'llama3.1',
    kind: 'ollama',
  },
  custom: {
    envKey: 'CUSTOM_API_KEY',
    baseUrl: null, // must come from CUSTOM_BASE_URL
    defaultModel: null, // must come from AI_MODEL
    kind: 'openai',
  },
};

function getProviderMeta(name) {
  const meta = PROVIDERS[name];
  if (!meta) {
    throw new Error(
      `Unknown AI provider "${name}". Supported providers: ${Object.keys(PROVIDERS).join(', ')}`
    );
  }
  return meta;
}

// Minimal .env parser (KEY=VALUE, # comments, optional quotes, optional
// `export ` prefix). Does not overwrite variables already present in env.
function parseDotEnvText(text) {
  const out = {};
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const body = line.startsWith('export ') ? line.slice(7).trim() : line;
    const eq = body.indexOf('=');
    if (eq === -1) continue;
    const key = body.slice(0, eq).trim();
    let value = body.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (key) out[key] = value;
  }
  return out;
}

// Load ROOT/.env into process.env (existing variables win). Missing file
// is fine; returns the number of variables applied.
function loadDotEnvFile(envPath = path.join(ROOT, '.env')) {
  if (!fs.existsSync(envPath)) return 0;
  const parsed = parseDotEnvText(fs.readFileSync(envPath, 'utf8'));
  let applied = 0;
  for (const [key, value] of Object.entries(parsed)) {
    if (process.env[key] === undefined) {
      process.env[key] = value;
      applied += 1;
    }
  }
  return applied;
}

function toBool(value, fallback) {
  if (value === undefined) return fallback;
  return String(value).toLowerCase() === 'true';
}

function toInt(value, fallback) {
  if (value === undefined) return fallback;
  const n = Number.parseInt(String(value), 10);
  return Number.isFinite(n) ? n : fallback;
}

function toList(value, fallback) {
  if (value === undefined) return fallback;
  return String(value)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

// Load effective configuration. Never throws for a missing API key; use
// validateConfig() for strict checks. Returns { config, warnings }.
function loadConfig(opts = {}) {
  const env = opts.env || process.env;
  const root = opts.root || ROOT;
  const dataDir = path.join(root, 'data');

  let fileConfig = {};
  const configFile = path.join(dataDir, 'config.json');
  if (fs.existsSync(configFile)) {
    try {
      fileConfig = JSON.parse(fs.readFileSync(configFile, 'utf8'));
    } catch (err) {
      throw new Error(`Invalid JSON in ${configFile}: ${err.message}`);
    }
  }

  const provider = env.AI_PROVIDER || fileConfig.aiProvider || DEFAULTS.aiProvider;
  const meta = getProviderMeta(provider);

  const baseUrl =
    provider === 'custom'
      ? env.CUSTOM_BASE_URL || fileConfig.customBaseUrl || null
      : env[`${provider.toUpperCase()}_BASE_URL`] || meta.baseUrl;

  const config = {
    ...DEFAULTS,
    ...fileConfig,
    root,
    dataDir,
    authDir: path.join(dataDir, 'auth'),
    draftsFile: path.join(dataDir, 'drafts.jsonl'),
    logFile: path.join(dataDir, 'logs.jsonl'),
    stateFile: path.join(dataDir, 'state.json'),
    configFile,
    aiProvider: provider,
    aiModel: env.AI_MODEL || fileConfig.aiModel || DEFAULTS.aiModel || meta.defaultModel,
    systemPrompt: env.SYSTEM_PROMPT || fileConfig.systemPrompt || DEFAULTS.systemPrompt,
    defaultMode: env.DEFAULT_MODE || fileConfig.defaultMode || DEFAULTS.defaultMode,
    privateOnly: toBool(env.PRIVATE_ONLY, fileConfig.privateOnly ?? DEFAULTS.privateOnly),
    mentionOnly: toBool(env.MENTION_ONLY, fileConfig.mentionOnly ?? DEFAULTS.mentionOnly),
    allowlist: toList(env.ALLOWLIST, fileConfig.allowlist || DEFAULTS.allowlist),
    blocklist: toList(env.BLOCKLIST, fileConfig.blocklist || DEFAULTS.blocklist),
    chatModes: fileConfig.chatModes || DEFAULTS.chatModes,
    takeoverCooldownMin: toInt(
      env.TAKEOVER_COOLDOWN_MIN,
      fileConfig.takeoverCooldownMin ?? DEFAULTS.takeoverCooldownMin
    ),
    maxRepliesPerMin: toInt(
      env.MAX_REPLIES_PER_MIN,
      fileConfig.maxRepliesPerMin ?? DEFAULTS.maxRepliesPerMin
    ),
    typingDelayMs: toInt(env.TYPING_DELAY_MS, fileConfig.typingDelayMs ?? DEFAULTS.typingDelayMs),
    historyLimit: toInt(env.HISTORY_LIMIT, fileConfig.historyLimit ?? DEFAULTS.historyLimit),
    draftPollMs: toInt(env.DRAFT_POLL_MS, fileConfig.draftPollMs ?? DEFAULTS.draftPollMs),
    providerMeta: meta,
    providerBaseUrl: baseUrl,
    providerApiKey: meta.envKey ? env[meta.envKey] || null : null,
  };

  const warnings = [];
  if (meta.envKey && !config.providerApiKey) {
    warnings.push(
      `No API key found for provider "${provider}". Set ${meta.envKey} in your environment or .env file.`
    );
  }
  if (provider === 'custom' && !baseUrl) {
    warnings.push('Custom provider requires CUSTOM_BASE_URL.');
  }
  if (provider === 'custom' && !env.AI_MODEL && !fileConfig.aiModel) {
    warnings.push('Custom provider requires AI_MODEL (no default model).');
  }
  if (!['auto', 'draft', 'off'].includes(config.defaultMode)) {
    warnings.push(`Invalid defaultMode "${config.defaultMode}". Expected auto, draft, or off.`);
  }
  return { config, warnings };
}

// Strict validation used by commands that actually connect or generate
// replies. Throws an Error with an actionable message.
function validateConfig(config) {
  const meta = config.providerMeta;
  if (meta.envKey && !config.providerApiKey) {
    throw new Error(
      `Missing API key for provider "${config.aiProvider}". Set ${meta.envKey} in your environment or .env file (see .env.example).`
    );
  }
  if (config.aiProvider === 'custom' && !config.providerBaseUrl) {
    throw new Error('Custom provider requires CUSTOM_BASE_URL (see .env.example).');
  }
  if (config.aiProvider === 'custom' && !config.aiModel) {
    throw new Error('Custom provider requires AI_MODEL (see .env.example).');
  }
  if (!['auto', 'draft', 'off'].includes(config.defaultMode)) {
    throw new Error(`Invalid defaultMode "${config.defaultMode}". Expected auto, draft, or off.`);
  }
  if (!(config.maxRepliesPerMin > 0)) {
    throw new Error('maxRepliesPerMin must be a positive number.');
  }
  if (!(config.takeoverCooldownMin >= 0)) {
    throw new Error('takeoverCooldownMin must be zero or positive.');
  }
  if (!(config.typingDelayMs >= 0)) {
    throw new Error('typingDelayMs must be zero or positive.');
  }
  if (!(config.historyLimit >= 0)) {
    throw new Error('historyLimit must be zero or positive.');
  }
  if (!(config.draftPollMs > 0)) {
    throw new Error('draftPollMs must be a positive number.');
  }
}

function ensureDataDir(config) {
  fs.mkdirSync(config.dataDir, { recursive: true });
  fs.mkdirSync(config.authDir, { recursive: true });
}

// Persist a top-level config key (or a chat mode) to data/config.json.
// Only keys already present in DEFAULTS (or chatModes) may be written.
function saveConfigValue(config, key, value) {
  ensureDataDir(config);
  let fileConfig = {};
  if (fs.existsSync(config.configFile)) {
    fileConfig = JSON.parse(fs.readFileSync(config.configFile, 'utf8'));
  }
  fileConfig[key] = value;
  fs.writeFileSync(config.configFile, `${JSON.stringify(fileConfig, null, 2)}\n`);
  return fileConfig;
}

function setChatMode(config, chatId, mode) {
  if (!['auto', 'draft', 'off'].includes(mode)) {
    throw new Error(`Invalid mode "${mode}". Expected auto, draft, or off.`);
  }
  ensureDataDir(config);
  let fileConfig = {};
  if (fs.existsSync(config.configFile)) {
    fileConfig = JSON.parse(fs.readFileSync(config.configFile, 'utf8'));
  }
  fileConfig.chatModes = { ...(fileConfig.chatModes || {}), [chatId]: mode };
  fs.writeFileSync(config.configFile, `${JSON.stringify(fileConfig, null, 2)}\n`);
  return fileConfig.chatModes;
}

module.exports = {
  ROOT,
  DATA_DIR,
  DEFAULTS,
  PROVIDERS,
  getProviderMeta,
  parseDotEnvText,
  loadDotEnvFile,
  loadConfig,
  validateConfig,
  ensureDataDir,
  saveConfigValue,
  setChatMode,
};
