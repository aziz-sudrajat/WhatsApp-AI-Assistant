# Disclaimer

## Unofficial API — read this first

WhatsApp AI Assistant connects to WhatsApp through the WhatsApp Web
protocol using the Baileys library. **This is not an official WhatsApp
API, and this project is not affiliated with, endorsed by, or connected
to WhatsApp LLC or Meta Platforms, Inc. in any way.**

WhatsApp's official API for automated messaging is the WhatsApp Business
API, which requires a Meta Business account and a business number. This
tool does not use it. It automates a personal account through the same
protocol WhatsApp Web uses.

## Account-ban risk

WhatsApp actively detects and restricts accounts that use automation.
Using this tool can lead to:

- Temporary restrictions on your number (temporary ban), or
- Permanent loss of the number (permanent ban).

**Test on a secondary number first.** Do not run this tool on a number
you cannot afford to lose. The authors accept no responsibility for
restricted, suspended, or banned accounts.

## Acceptable use

This tool is built for personal assistance on your own account: answering
your own messages with an AI you configured. It is **not** for:

- Spam, bulk messaging, or marketing campaigns
- Impersonating other people
- Harassment, fraud, or any illegal activity
- Circumventing WhatsApp's rules at scale

You are responsible for what the AI sends from your account, including
replies sent in automatic mode. Review the draft mode and the human
takeover behavior before enabling automatic replies.

## No warranty

This software is provided "as is", without warranty of any kind, express
or implied, including but not limited to the warranties of
merchantability, fitness for a particular purpose, and noninfringement.
In no event shall the authors or copyright holders be liable for any
claim, damages, or other liability arising from the use of this software.

## Secrets

Never commit your `.env` file, your WhatsApp session files (`data/auth/`),
or any API key. If a secret leaks, revoke it immediately (new API key from
the provider, new WhatsApp session by deleting `data/auth/` and
re-pairing).
