# Opps Monitor

Local monitor for learning, AI, hackathon, internship, and competition opportunities.

The project scrapes configured sources, normalizes events into one local feed, and sends a compact Telegram digest. It is designed to run locally on Windows.

## Setup

1. Install dependencies:

```powershell
npm install
```

2. Create `.env` from `.env.example` and fill in:

```text
TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=
```

Do not commit `.env`.

## Daily Use

Run the full local pipeline:

```powershell
npm run daily
```

This runs:

```powershell
npm run scrape
npm run normalize
npm run digest
```

Dry-run the Telegram digest without sending anything:

```powershell
npm run digest:dry
```

Send a manual test digest with the last N events:

```powershell
npm run digest -- --last 5
```

By default, `--last` is test-only and does not mark events as sent. To mark them as sent:

```powershell
npm run digest -- --last 5 --mark-sent
```

## Telegram Digest

The digest is push-only. There is no webhook, no always-running bot, and no long polling service.

Each event is shown with:

```text
1. Linked event title
Date: ...
Source: ...
Tags: ...
Payment: ...
Short description...
```

The event title is the clickable link. Paid course entries are filtered out when they have the `курси` tag and a money-like payment value.

## Feedback

After a digest is sent, reply to that Telegram message with ratings:

```text
1+
2--
3-
4++
```

The next normal digest run reads new replies once, updates local preferences, and reacts to processed feedback with a thumbs-up. This changes future ordering but does not require the bot to keep listening in the background.

View or edit preference words:

```powershell
npm run prefs -- list
npm run prefs -- set internship 3
npm run prefs -- set grant 2
npm run prefs -- delete grant
```

## Local Data

Generated/debug output is intentionally ignored by git:

- `materials/`
- `data/events.jsonl`
- `data/events.current.json`
- `data/state.json`
- `data/preferences.json`

`data/events.jsonl` is the main runtime feed. `materials/` is the raw/debug scraping layer.

## More Details

See [docs/TECHNICAL.md](docs/TECHNICAL.md) for architecture, file formats, Telegram feedback details, and the version log.
