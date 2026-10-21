# WhatsApp AI Assistant — Roadmap

## Phase 0 — Concept & approval (now)

- [x] Concept + roadmap written
- [x] Owner approval: repo name, provider list, Muse integration shape
- [x] New public repo created under the owner's GitHub account
      (https://github.com/aziz-sudrajat/WhatsApp-AI-Assistant)

## Phase 1 — MVP (build first)

- [x] Project scaffold: Node.js + Baileys + CLI skeleton
- [x] WhatsApp pairing: QR in terminal, session persistence, reconnect
      without rescan
- [x] Receive + send messages (text, private chats first)
- [x] Provider abstraction + providers: OpenAI, Anthropic, Gemini,
      DeepSeek, Groq, Mistral, Ollama, custom OpenAI-compatible endpoint
- [x] Router: allowlist/blocklist, private-only vs groups, mention-only
- [x] Reply modes per chat: `auto` / `draft` / `off`
- [x] Human takeover: owner reply from phone pauses AI for that chat
- [x] Safety: typing delay, per-chat rate limits, pause/resume commands
- [x] Logging: JSONL for inbound, outbound, drafts, takeovers
- [x] `.env.example` + config validation with clear errors
- [x] README: detailed install tutorial from zero (prereqs, keys per
      provider, QR scan, first run, modes, troubleshooting, ToS warning)

### MVP verification (2026-10-21, build session)

- 41 unit tests pass (`npm test`): router decisions, rate limits,
  takeover, all provider request/response shapes (mocked fetch), draft
  store, config loading, gateway handler with fake clients, Baileys
  client wiring with a fake socket. No network, no WhatsApp connection.
- CLI smoke test passed offline: `status`, `config`, `list-drafts`,
  `approve-draft`, `config set-mode`, `config set`, `pause`, `resume`,
  `help`, and unknown-command handling (exit 1).
- README demo GIF: `assets/demo.gif` (67 KB, 5 frames), generated
  locally with `scripts/make_demo_gif.py`, honestly captioned as an
  illustrated simulation — not a real WhatsApp session.
- NOT verified by design: pairing against a real WhatsApp account and
  sending a real message. The build task forbids real-account contact;
  those two acceptance criteria need a real device run by the owner.

### MVP acceptance criteria

- QR scan pairs the account; restart reconnects without a new scan.
- A message in an `auto` chat gets an AI reply for at least 3 providers.
- A message in a `draft` chat produces a draft and sends nothing until
  approved.
- An owner reply from the phone pauses AI for that chat.
- A stranger can install from zero by following the README alone.

## Phase 2 — Integration & dashboard

- [ ] MCP server (stdio): `send_message`, `list_chats`, `list_drafts`,
      `approve_draft`
- [ ] `SKILL.md`: agent operating guide (including Muse via CLI)
- [ ] Web dashboard: QR display, live logs, per-chat mode toggles,
      draft approval UI
- [ ] Per-chat persona + system-prompt overrides
- [ ] Media support: image input (vision), voice input (transcription)
- [ ] Group mention handling improvements
- [ ] Docker image

## Phase 3 — Hardening & publish

- [ ] Unit + integration tests (fake AI provider, fake WhatsApp session)
- [ ] CI on push (lint + tests)
- [ ] Conversation summary memory per chat (opt-in)
- [ ] Multi-account support (only if there is real demand)
- [ ] Publish: push to the owner's public GitHub repo, release v1.0.0,
      announce

## Out of scope (all phases)

Spam/marketing blasts, impersonating other people, Business API replacement,
storing credentials anywhere except the owner's local `.env`.
