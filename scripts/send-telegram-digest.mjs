import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const defaultEventsPath = path.join(repoRoot, 'data', 'events.jsonl');
const defaultStatePath = path.join(repoRoot, 'data', 'state.json');
const telegramLimit = 4096;
const safeMessageLimit = 3600;

function parseArgs(argv) {
  const args = {
    dryRun: false,
    last: null,
    markSent: false,
    envFile: path.join(repoRoot, '.env'),
    eventsFile: defaultEventsPath,
    stateFile: defaultStatePath,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--dry-run') args.dryRun = true;
    else if (arg === '--last') args.last = Number(argv[++index]);
    else if (arg === '--mark-sent') args.markSent = true;
    else if (arg === '--env-file') args.envFile = path.resolve(repoRoot, argv[++index]);
    else if (arg === '--events-file') args.eventsFile = path.resolve(repoRoot, argv[++index]);
    else if (arg === '--state-file') args.stateFile = path.resolve(repoRoot, argv[++index]);
  }

  if (args.last !== null && (!Number.isInteger(args.last) || args.last <= 0)) {
    throw new Error('--last must be a positive integer');
  }

  return args;
}

async function loadEnvFile(filePath) {
  let text;
  try {
    text = await readFile(filePath, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return;
    throw error;
  }

  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const match = trimmed.match(/^([^=\s]+)\s*=\s*(.*)$/);
    if (!match) continue;
    const [, key, rawValue] = match;
    if (process.env[key] !== undefined) continue;
    process.env[key] = rawValue.replace(/^["']|["']$/g, '');
  }
}

async function readEvents(filePath) {
  const text = await readFile(filePath, 'utf8');
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

async function readState(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'));
}

function isAiEvent(event) {
  return event.tags.some((tag) => tag.toLowerCase() === 'ai');
}

function compareDigestEvents(a, b) {
  const aiDelta = Number(isAiEvent(b)) - Number(isAiEvent(a));
  if (aiDelta) return aiDelta;

  const dateA = a.dateNormalized || '9999-99-99T99:99:99';
  const dateB = b.dateNormalized || '9999-99-99T99:99:99';
  return dateA.localeCompare(dateB) || a.title.localeCompare(b.title);
}

function truncate(text, maxLength = 260) {
  if (!text) return '';
  const clean = String(text).replace(/\s+/g, ' ').trim();
  if (clean.length <= maxLength) return clean;
  return `${clean.slice(0, maxLength - 1).trimEnd()}...`;
}

function formatDate(event) {
  if (event.datePrecision === 'date_range' && event.dateNormalized && event.dateEndNormalized) {
    return `${event.dateNormalized} - ${event.dateEndNormalized}`;
  }
  return event.dateNormalized || event.date || 'date unknown';
}

function formatEvent(event, index) {
  const lines = [
    `${index}. ${event.title}`,
    `Date: ${formatDate(event)}`,
    `Source: ${event.sourceName || event.sourceId}`,
  ];

  if (event.tags?.length) lines.push(`Tags: ${event.tags.join(', ')}`);
  if (event.payment) lines.push(`Payment: ${event.payment}`);
  if (event.description) lines.push(truncate(event.description));
  lines.push(event.link);
  return lines.join('\n');
}

function splitMessages(events, { title = 'New opportunities' } = {}) {
  const messages = [];
  let current = `${title}: ${events.length}\n\n`;

  events.forEach((event, index) => {
    const block = formatEvent(event, index + 1);
    if (block.length > telegramLimit) {
      throw new Error(`Formatted event is too long for Telegram: ${event.id}`);
    }

    if (current.length + block.length + 2 > safeMessageLimit) {
      messages.push(current.trimEnd());
      current = '';
    }
    current += `${block}\n\n`;
  });

  if (current.trim()) messages.push(current.trimEnd());
  return messages;
}

function pendingEvents(events, state) {
  const eventsById = new Map(events.map((event) => [event.id, event]));
  const newIds = Array.isArray(state.lastChanges?.newEventIds) ? state.lastChanges.newEventIds : [];
  const sentIds = new Set(Array.isArray(state.sentTelegramEventIds) ? state.sentTelegramEventIds : []);

  return newIds
    .filter((id) => !sentIds.has(id))
    .map((id) => eventsById.get(id))
    .filter(Boolean)
    .sort(compareDigestEvents);
}

function lastEvents(events, count) {
  return events.slice(-count).sort(compareDigestEvents);
}

function selectEventsToSend(events, state, args) {
  if (args.last !== null) {
    return lastEvents(events, args.last);
  }
  return pendingEvents(events, state);
}

function requireTelegramConfig() {
  const missing = [];
  if (!process.env.TELEGRAM_BOT_TOKEN) missing.push('TELEGRAM_BOT_TOKEN');
  if (!process.env.TELEGRAM_CHAT_ID) missing.push('TELEGRAM_CHAT_ID');
  if (missing.length) {
    throw new Error(`Missing Telegram env var(s): ${missing.join(', ')}`);
  }
}

async function sendTelegramMessage(text) {
  const response = await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      chat_id: process.env.TELEGRAM_CHAT_ID,
      text,
      disable_web_page_preview: true,
    }),
  });

  if (!response.ok) {
    let errorText = '';
    try {
      const payload = await response.json();
      errorText = payload.description ? `: ${payload.description}` : '';
    } catch {
      errorText = `: HTTP ${response.status}`;
    }
    throw new Error(`Telegram send failed${errorText}`);
  }
}

async function updateState(filePath, state, sentEvents) {
  const previousSentIds = Array.isArray(state.sentTelegramEventIds) ? state.sentTelegramEventIds : [];
  const sentTelegramEventIds = [...new Set([...previousSentIds, ...sentEvents.map((event) => event.id)])];

  const nextState = {
    ...state,
    sentTelegramEventIds,
    lastTelegramDigestAt: new Date().toISOString(),
    lastTelegramDigestEventIds: sentEvents.map((event) => event.id),
  };

  await writeFile(filePath, JSON.stringify(nextState, null, 2) + '\n', 'utf8');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  await loadEnvFile(args.envFile);

  const events = await readEvents(args.eventsFile);
  const state = await readState(args.stateFile);
  const eventsToSend = selectEventsToSend(events, state, args);

  if (!eventsToSend.length) {
    console.log(args.last === null ? 'No new Telegram digest events to send.' : 'No events found for --last.');
    return;
  }

  const isManualLastRun = args.last !== null;
  const messages = splitMessages(eventsToSend, {
    title: isManualLastRun ? 'Manual test digest' : 'New opportunities',
  });
  const shouldUpdateState = !args.dryRun && (!isManualLastRun || args.markSent);

  if (args.dryRun) {
    console.log(`Dry run: ${eventsToSend.length} event(s), ${messages.length} Telegram message(s).`);
    for (const [index, message] of messages.entries()) {
      console.log(`\n--- Message ${index + 1}/${messages.length} ---\n${message}`);
    }
    return;
  }

  requireTelegramConfig();

  for (const message of messages) {
    await sendTelegramMessage(message);
  }

  if (shouldUpdateState) {
    await updateState(args.stateFile, state, eventsToSend);
  }

  const stateNote = shouldUpdateState ? 'state updated' : 'state unchanged';
  console.log(`Sent Telegram digest: ${eventsToSend.length} event(s), ${messages.length} message(s), ${stateNote}.`);
}

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
