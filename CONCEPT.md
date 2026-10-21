# WhatsApp AI Assistant — Concept

> Project: `WhatsApp-AI-Assistant` — repo: https://github.com/aziz-sudrajat/WhatsApp-AI-Assistant
> Language rule: all repo content (README, docs, code, CLI output) is in
> English, because the audience is international.

## Problem

People want an AI that answers their own WhatsApp messages. The official
WhatsApp Business API does not cover this: it requires a Meta Business
account and a business number, not a personal number. Personal accounts have
no official API. The practical route is the WhatsApp Web protocol via QR
pairing, which is unofficial and therefore carries an account-ban risk.

Existing options are either business-API-only, closed-source, or tied to a
single AI provider. There is no small, self-hosted, provider-agnostic bridge
that says: "pair your WhatsApp once via QR, pick any AI model, decide per
chat whether the AI auto-replies, drafts, or stays silent."

## Solution

A self-hosted gateway between WhatsApp and any LLM:

```
WhatsApp (Baileys, QR auth) ⇄ Router (filters, context, policy) ⇄ AI provider ⇄ Reply sender
                                                      ↓
                                        Session store, logs, config
```

1. **Connect.** Scan a QR code once (terminal or web page). The session is
   persisted, so later restarts reconnect without a new scan.
2. **Route.** An incoming message passes filters (allowlist/blocklist,
   private-only or groups, mention-only in groups) and builds per-chat
   context from recent history.
3. **Think.** The active AI provider generates a reply from the system
   prompt + chat context.
4. **Reply.** Depending on the chat's mode, the reply is sent automatically,
   held as a draft for owner approval, or skipped.

## Who it is for (and not for)

For: developers and power users who want a personal AI secretary on their
own WhatsApp; people learning LLM + messaging integration; owners of a
secondary number who want to experiment safely.

Not for: spam or marketing blasts, impersonating other people, or replacing
the official Business API.

## Architecture (v1)

| Component | Responsibility |
| --- | --- |
| `whatsapp/` | Baileys client, QR pairing, session persistence, send/receive |
| `router/` | Filters, per-chat context, reply-mode resolution |
| `ai/` | Provider abstraction: one `chat(messages) -> text` interface |
| `policy/` | Rate limits, typing delay, human takeover, pause/resume |
| `cli/` | `start`, `status`, `qr`, `pause`, `resume`, `config` commands |
| `store/` | Session files, per-chat settings, JSONL logs |

Tech stack: Node.js 20+ + Baileys (WebSocket-based, no browser needed).
No database in v1; JSON files + JSONL logs.

## AI providers (v1)

API keys live only in `.env`, never in the repo. One active provider at a
time, switchable via config:

- OpenAI, Anthropic (Claude), Google (Gemini), DeepSeek, Groq, Mistral
- Ollama (local, no key needed)
- Any custom OpenAI-compatible endpoint (base URL override)

## Reply modes and safety

- Modes per chat: `auto` / `draft` (owner approves before sending) / `off`.
- Human takeover: when the owner replies from their own phone, the AI pauses
  for that chat (configurable cooldown), so human and AI never talk over
  each other.
- Anti-ban hygiene: typing delay, per-chat rate limits, no bulk sending.
- Honest warning, printed in the README and at startup: this uses an
  unofficial API. WhatsApp may temporarily or permanently ban numbers that
  use automation. Test on a secondary number first.

## Muse compatibility

"Installed to Muse" is defined honestly, because Muse has no native MCP
registration pane (no settings page, server-URL field, or transport setup
for arbitrary MCP servers):

1. **CLI-first (primary).** Muse, or any agent with shell access, operates
   the tool through its CLI — the same proven pattern as REA.
2. **MCP server (Phase 2).** A stdio MCP server exposing `send_message`,
   `list_chats`, `list_drafts`, `approve_draft`, so MCP-capable clients
   (Claude Code, Codex, Cursor, etc.) can operate the tool.
3. **Bundled skill doc.** The repo ships a `SKILL.md` describing how an
   agent should operate the tool safely.

What this does NOT promise: one-click MCP registration inside Muse. That
surface does not exist.

## Non-goals (v1)

No WhatsApp Business API, no multi-account support, no bulk messaging, no
media generation, no message scheduling campaigns.

## Proposed repo layout

```
whatsapp-ai-assistant/
├── src/
│   ├── whatsapp/      # Baileys client + session store
│   ├── router/        # filters + context + mode resolution
│   ├── ai/            # provider abstraction + providers
│   ├── policy/        # rate limits, takeover, pause/resume
│   └── cli/           # command-line interface
├── .env.example
├── CONCEPT.md
├── ROADMAP.md
├── README.md          # detailed install tutorial
├── SKILL.md           # agent operating guide (incl. Muse)
└── package.json
```

## License

MIT (public repo, community use).
