# Opps Monitor

Opps Monitor is a small Node.js app that collects opportunities from public sources and makes them easy to review or open from Telegram.

It currently tracks DOU calendar events, AIN opportunity digests, Kaggle competitions, and KSE University news. The app is built for a simple demo flow: scrape data ahead of time, normalize it into one local catalogue, then let users explore the same catalogue through Telegram buttons.

## Main Flow

```text
config/sources.json
  -> npm run scrape
  -> materials/*-events.json
  -> npm run normalize
  -> data/events.jsonl + data/state.json
  -> Telegram bot / digest / review.html
```

## Modules

- `scripts/scrape-sources.mjs` runs Playwright and calls source-specific scrapers from `scrapers/`.
- `scrapers/*.mjs` contain the site-specific parsing logic. A new source is added by creating a scraper module and registering it in `config/sources.json`.
- `scripts/normalize-events.mjs` merges raw source events into `data/events.jsonl`, tracks changes in `data/state.json`, and builds calendar links.
- `scripts/send-telegram-digest.mjs` sends new opportunities to Telegram as a digest.
- `scripts/telegram-bot.mjs` runs a polling Telegram bot with buttons for `Today`, `Nearest 10`, and `Newest 10`.
- `scripts/build-review-html.mjs` generates `review.html` for debugging and visual review.

## Commands

```bash
npm install
npm run scrape
npm run normalize
npm run review:html
npm run digest:dry
npm run bot
```

For the full daily pipeline:

```bash
npm run daily
```

## Telegram Setup

Create `.env`:

```text
TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=
```

`npm run bot` starts a long-running polling bot. `/start` creates a persistent control message with buttons. Button results are sent below that control message, and old result messages are removed when the user chooses another action.

## Data Files

Runtime data is intentionally local and mostly gitignored:

- `materials/` stores raw scraped source outputs.
- `data/events.jsonl` is the main normalized catalogue.
- `data/state.json` stores last run metadata, detected changes, and Telegram digest state.
- `review.html` is generated for local inspection.
