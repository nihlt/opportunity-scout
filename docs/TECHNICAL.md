# Technical Notes

## Architecture

The pipeline has two layers.

Raw/debug layer:

- `materials/*-visible-text.txt` stores visible page text captured by Playwright.
- `materials/*-links.json` stores page links with linked text.
- `materials/*-events.json` stores source-specific parsed events.
- `materials/sources-registry.json` stores source registry metadata and event counts.

Normalized layer:

- `data/events.jsonl` is the main runtime event feed, one JSON object per line.
- `data/events.current.json` is a readable snapshot of the current feed.
- `data/state.json` stores run state, new/updated/disappeared ids, Telegram send history, and feedback update offset.
- `data/preferences.json` stores local ranking preferences learned from Telegram replies and manual edits.

The raw/debug layer is useful for parser debugging. The normalized layer is used by local CLI and Telegram digest commands.

## Main Commands

```powershell
npm run scrape
npm run normalize
npm run digest
npm run daily
npm run digest:dry
npm run events
npm run prefs -- list
```

Source-specific scraping:

```powershell
npm run scrape:dou-ai
npm run scrape:ain
npm run scrape:kaggle
```

## Telegram Digest

The digest script is `scripts/send-telegram-digest.mjs`.

It reads:

- `data/events.jsonl`
- `data/state.json`
- `data/preferences.json`

It sends only new events from `state.lastChanges.newEventIds` that are not already in `state.sentTelegramEventIds`.

Manual test mode:

```powershell
npm run digest -- --last 5
```

This sends the last 5 normalized events and does not update state unless `--mark-sent` is also provided.

## Link Display

Telegram messages use `parse_mode: HTML` only so the event title can be a clickable link:

```html
1. <a href="https://example.com/event">Event title</a>
```

Other fields are plain labels. Text fields are HTML-escaped before sending.

## Paid Course Filter

Paid courses are removed from the digest when all of these are true:

- the event has tag `курси`
- `payment` exists
- `payment` contains a money-like value, such as `6167 грн/міс`, `$100`, `EUR`
- `payment` does not look free, such as `безкоштовно`, `безоплатно`, or `free`

This keeps free courses visible while dropping paid course ads.

## Telegram Feedback And Reactions

The bot is push-only. It does not run continuously.

On a normal `npm run digest`, before sending new events, the script calls Telegram `getUpdates` once and checks for replies to the last stored digest message ids.

Accepted reply format:

```text
1+
2--
3-
4++
```

Effects:

- `+` adds `1`
- `++` adds `2`
- `-` subtracts `1`
- `--` subtracts `2`

Feedback updates:

- `preferences.eventFeedback[eventId]`
- `preferences.words[...]` extracted from the event title and tags
- `state.telegramUpdateOffset`

After processing a valid feedback reply, the bot calls `setMessageReaction` with a thumbs-up reaction. If the reaction call fails, digest processing continues and logs a warning.

## Digest Sorting

Digest order:

1. AI-tagged events first.
2. Higher preference score next.
3. Earlier `dateNormalized` next.
4. Title as final tie-breaker.

Events without `dateNormalized` sort below dated events inside their group.

## Ignored Runtime Files

These files are generated or local-only and should not be committed:

- `.env`
- `materials/`
- `node_modules/`
- `data/events.jsonl`
- `data/events.current.json`
- `data/state.json`
- `data/preferences.json`
- `data/reaction-test/`

Committed examples/config:

- `.env.example`
- `data/tag-keywords.json`
- `data/location-keywords.json`
- `data/preferences.example.json`
- `package.json`
- `package-lock.json`
- `scripts/`

## Version Log

### 2026-06-24 - Telegram Feedback Preferences

Commit: `63f7b79 Add Telegram feedback preferences`

- Added reply-based Telegram feedback parsing.
- Added Telegram thumbs-up reaction for processed feedback replies.
- Added local preference scoring from event feedback and preference words.
- Added `npm run prefs` CLI for viewing and editing preference words.
- Changed digest link display so the event title is the clickable link.
- Filtered paid course entries from Telegram digest.
- Added ignored runtime files for preferences and reaction-test state.

### 2026-06-18 - Telegram Digest

Commit: `c45bc06 Add Telegram digest script, .env.example, opp.md`

- Added push-only Telegram digest script.
- Added `.env.example` for Telegram configuration.
- Added manual `--last N` test mode and `--mark-sent`.

### 2026-06-18 - Scraping And Normalization

Commit: `ea7653e Add scraping and normalized events pipeline`

- Added Playwright scraping for configured sources.
- Added raw materials output.
- Added normalized `data/events.jsonl` feed and current snapshot.
- Added state tracking for new, updated, and disappeared events.
