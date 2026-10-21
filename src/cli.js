#!/usr/bin/env node
// WhatsApp AI Assistant — command-line interface.
//
// Commands:
//   start                    Run the gateway (connects WhatsApp, replies)
//   qr                       Pair a new account (prints a QR code to scan)
//   status                   Show gateway status (no WhatsApp connection)
//   config                   Show effective configuration (no secrets)
//   config set-mode <chat> <auto|draft|off>
//   config set <key> <value>
//   pause                    Globally pause AI replies
//   resume                   Resume AI replies
//   list-drafts              List pending drafts
//   approve-draft <id>       Approve a draft (the gateway sends it)
//   help                     Show this help
//
// Only `start` and `qr` open a WhatsApp connection. All other commands
// work offline against local files.

const fs = require('fs');
const path = require('path');

const {
  loadDotEnvFile,
  loadConfig,
  validateConfig,
  ensureDataDir,
  saveConfigValue,
  setChatMode,
  getProviderMeta,
} = require('./config');
const { createProvider } = require('./ai/providers');
const { createClient } = require('./whatsapp/client');
const { createHandler, startDraftPoller } = require('./gateway');
const { ChatHistory } = require('./router/router');
const { RateLimiter } = require('./policy/rate');
const { TakeoverTracker } = require('./policy/takeover');
const { readState, setPaused } = require('./store/state');
const { listPending, approveDraft } = require('./store/drafts');

const VERSION = (() => {
  try {
    return require('../package.json').version;
  } catch {
    return '0.1.0';
  }
})();

function fail(message) {
  console.error(`Error: ${message}`);
  process.exit(1);
}

function usage() {
  console.log(`WhatsApp AI Assistant v${VERSION}
Usage: wa-ai <command> [args]

  start                    Run the gateway (connects WhatsApp)
  qr                       Pair a new account (prints a QR code to scan)
  status                   Show gateway status (offline)
  config                   Show effective configuration (offline)
  config set-mode <chat> <auto|draft|off>
  config set <key> <value>
  pause                    Globally pause AI replies
  resume                   Resume AI replies
  list-drafts              List pending drafts
  approve-draft <id>       Approve a draft for sending
  help                     Show this help

See README.md for the full tutorial.`);
}

// Public view of the config: never includes secret values.
function publicConfig(config) {
  return {
    aiProvider: config.aiProvider,
    aiModel: config.aiModel,
    keyConfigured: !!config.providerApiKey,
    systemPrompt: config.systemPrompt,
    defaultMode: config.defaultMode,
    privateOnly: config.privateOnly,
    mentionOnly: config.mentionOnly,
    allowlist: config.allowlist,
    blocklist: config.blocklist,
    chatModes: config.chatModes,
    takeoverCooldownMin: config.takeoverCooldownMin,
    maxRepliesPerMin: config.maxRepliesPerMin,
    typingDelayMs: config.typingDelayMs,
    historyLimit: config.historyLimit,
    draftPollMs: config.draftPollMs,
    dataDir: config.dataDir,
  };
}

function printBanner(config) {
  console.log(`WhatsApp AI Assistant v${VERSION}`);
  console.log(`Provider: ${config.aiProvider} (${config.aiModel}) | Default mode: ${config.defaultMode}`);
  console.log('WARNING: this tool uses an unofficial WhatsApp API. WhatsApp may');
  console.log('temporarily or permanently ban numbers that use automation.');
  console.log('Test on a secondary number first. See DISCLAIMER.md.');
}

async function cmdStart() {
  const { config, warnings } = loadConfig();
  for (const w of warnings) console.error(`Warning: ${w}`);
  try {
    validateConfig(config);
  } catch (err) {
    fail(err.message);
  }
  ensureDataDir(config);
  printBanner(config);

  const provider = createProvider({
    provider: config.aiProvider,
    model: config.aiModel,
    baseUrl: config.providerBaseUrl,
    apiKey: config.providerApiKey,
  });
  const limiter = new RateLimiter(config.maxRepliesPerMin);
  const takeover = new TakeoverTracker(config.takeoverCooldownMin * 60_000);
  const history = new ChatHistory(config.historyLimit);

  // `handler` is assigned below; the onMessage callback only runs after
  // client.start(), so it is always initialized by then.
  let handler;
  const client = createClient({
    authDir: config.authDir,
    logger: (m) => console.error(m),
    onQr: (qr) => {
      const qrcode = require('qrcode-terminal');
      console.log('\nScan this QR code with WhatsApp (Linked Devices):');
      qrcode.generate(qr, { small: true });
    },
    onConnected: ({ jid }) => {
      console.log(`Connected to WhatsApp as ${jid || '(unknown id)'}.`);
    },
    onDisconnected: ({ loggedOut }) => {
      if (loggedOut) {
        console.error('Logged out of WhatsApp. Delete the auth directory and pair again.');
      } else {
        console.error('WhatsApp connection closed; reconnecting...');
      }
    },
    onMessage: (msg) => {
      handler(msg).catch((err) => {
        console.error(`Message handling failed: ${err.message}`);
      });
    },
  });

  const { appendLog } = require('./store/logs');
  handler = createHandler({
    config,
    provider,
    client,
    takeover,
    limiter,
    history,
    log: (entry) => appendLog(config.logFile, entry),
  });
  const stopPoller = startDraftPoller({
    config,
    client,
    history,
    log: (entry) => appendLog(config.logFile, entry),
  });

  const shutdown = () => {
    console.log('\nShutting down...');
    stopPoller();
    client.stop();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  await client.start();
  console.log('Gateway running. Press Ctrl+C to stop.');
}

async function cmdQr() {
  const { config } = loadConfig();
  ensureDataDir(config);
  console.log('Pairing a new WhatsApp account. Scan the QR code below with');
  console.log('WhatsApp on your phone (Settings > Linked Devices).');
  console.log('The session will be saved, so later restarts need no new scan.');

  const client = createClient({
    authDir: config.authDir,
    onQr: (qr) => {
      const qrcode = require('qrcode-terminal');
      console.log('');
      qrcode.generate(qr, { small: true });
    },
    onConnected: ({ jid }) => {
      console.log(`\nPaired successfully as ${jid || '(unknown id)'}.`);
      console.log(`Session saved. You can now run: wa-ai start`);
      client.stop();
      process.exit(0);
    },
    onDisconnected: ({ loggedOut }) => {
      if (loggedOut) fail('Logged out during pairing. Try again.');
    },
  });
  await client.start();
}

function cmdStatus() {
  const { config, warnings } = loadConfig();
  for (const w of warnings) console.error(`Warning: ${w}`);
  const state = readState(config.stateFile);
  const pending = listPending(config.draftsFile);
  const authExists = fs.existsSync(config.authDir) && fs.readdirSync(config.authDir).length > 0;
  console.log(`WhatsApp AI Assistant v${VERSION} — status`);
  console.log(`  Provider:      ${config.aiProvider} (${config.aiModel})`);
  console.log(`  API key:       ${config.providerApiKey ? 'configured' : 'MISSING'}`);
  console.log(`  Default mode:  ${config.defaultMode}`);
  console.log(`  Global pause:  ${state.paused ? 'PAUSED' : 'running'}`);
  console.log(`  WhatsApp auth: ${authExists ? 'paired (session saved)' : 'not paired yet (run: wa-ai qr)'}`);
  console.log(`  Pending drafts: ${pending.length}`);
  console.log(`  Chat modes set: ${Object.keys(config.chatModes).length}`);
  console.log(`  Data dir:      ${config.dataDir}`);
}

// Parse `config set` arguments. All words after the key form the value
// (so `config set systemPrompt hello world` stores "hello world", not
// just "hello"). Throws on a missing key or value.
function parseConfigSetArgs(args) {
  const [, key, ...valueParts] = args;
  if (!key || valueParts.length === 0) {
    throw new Error('Usage: wa-ai config set <key> <value>');
  }
  return { key, rawValue: valueParts.join(' ') };
}

function cmdConfig(args) {
  const { config } = loadConfig();
  if (args[0] === 'set-mode') {
    const [, chatId, mode] = args;
    if (!chatId || !mode) fail('Usage: wa-ai config set-mode <chatId> <auto|draft|off>');
    const modes = setChatMode(config, chatId, mode);
    console.log(`Mode for ${chatId} set to ${mode}.`);
    console.log(`Current chat modes: ${JSON.stringify(modes)}`);
    return;
  }
  if (args[0] === 'set') {
    let key;
    let rawValue;
    try {
      ({ key, rawValue } = parseConfigSetArgs(args));
    } catch (err) {
      fail(err.message);
    }
    const scalarKeys = [
      'defaultMode', 'privateOnly', 'mentionOnly', 'takeoverCooldownMin',
      'maxRepliesPerMin', 'typingDelayMs', 'historyLimit', 'draftPollMs',
      'systemPrompt', 'aiProvider', 'aiModel',
    ];
    if (!scalarKeys.includes(key)) {
      fail(`Unknown config key "${key}". Known keys: ${scalarKeys.join(', ')}`);
    }
    let value = rawValue;
    if (rawValue === 'true') value = true;
    else if (rawValue === 'false') value = false;
    else if (/^-?\d+$/.test(rawValue)) value = Number.parseInt(rawValue, 10);
    if (key === 'defaultMode' && !['auto', 'draft', 'off'].includes(value)) {
      fail('defaultMode must be auto, draft, or off.');
    }
    if (key === 'aiProvider') getProviderMeta(value);
    saveConfigValue(config, key, value);
    console.log(`Config ${key} set to ${JSON.stringify(value)}.`);
    return;
  }
  if (args.length > 0) fail(`Unknown config subcommand "${args[0]}". See: wa-ai help`);
  console.log(JSON.stringify(publicConfig(config), null, 2));
}

function cmdPause() {
  const { config } = loadConfig();
  ensureDataDir(config);
  setPaused(config.stateFile, true);
  console.log('Gateway paused. AI replies are disabled until: wa-ai resume');
}

function cmdResume() {
  const { config } = loadConfig();
  ensureDataDir(config);
  setPaused(config.stateFile, false);
  console.log('Gateway resumed. AI replies are enabled.');
}

function cmdListDrafts() {
  const { config } = loadConfig();
  const pending = listPending(config.draftsFile);
  if (pending.length === 0) {
    console.log('No pending drafts.');
    return;
  }
  for (const d of pending) {
    console.log(`- ${d.id} | chat ${d.chatId} | ${d.createdAt}`);
    console.log(`  in:    ${(d.incomingText || '').slice(0, 120)}`);
    console.log(`  draft: ${(d.draftText || '').slice(0, 120)}`);
  }
  console.log(`\n${pending.length} pending draft(s). Approve one with: wa-ai approve-draft <id>`);
}

function cmdApproveDraft(id) {
  if (!id) fail('Usage: wa-ai approve-draft <id>');
  const { config } = loadConfig();
  const draft = approveDraft(config.draftsFile, id);
  if (!draft) fail(`Draft "${id}" not found or not pending.`);
  console.log(`Draft ${id} approved. The running gateway will send it on its next poll.`);
  console.log(`Chat: ${draft.chatId}`);
}

async function main() {
  loadDotEnvFile();
  const [cmd, ...args] = process.argv.slice(2);
  try {
    switch (cmd) {
      case 'start':
        await cmdStart();
        break;
      case 'qr':
        await cmdQr();
        break;
      case 'status':
        cmdStatus();
        break;
      case 'config':
        cmdConfig(args);
        break;
      case 'pause':
        cmdPause();
        break;
      case 'resume':
        cmdResume();
        break;
      case 'list-drafts':
        cmdListDrafts();
        break;
      case 'approve-draft':
        cmdApproveDraft(args[0]);
        break;
      case 'help':
      case undefined:
        usage();
        break;
      default:
        console.error(`Unknown command "${cmd}".`);
        usage();
        process.exit(1);
    }
  } catch (err) {
    fail(err.message);
  }
}

if (require.main === module) {
  main();
}

module.exports = { main, parseConfigSetArgs };
