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
  return (event.tags || []).some((tag) => tag.toLowerCase() === 'ai');
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
  return event.dateNormalized || event.date || '—';
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function hasMoneyPayment(event) {
  return /(?:\p{Sc}\s?\d|\d[\d\s,]*(?:\u0433\u0440\u043d|uah|usd|eur|gbp|jpy|inr))/iu.test(event.payment || '');
}

function isPaidCourse(event) {
  const tags = new Set((event.tags || []).map((tag) => tag.toLowerCase()));
  if (!tags.has('\u043a\u0443\u0440\u0441\u0438')) return false;
  if (!event.payment) return false;
  if (/\u0431\u0435\u0437\u043a\u043e\u0448\u0442\u043e\u0432|\u0431\u0435\u0437\u043e\u043f\u043b\u0430\u0442|free/i.test(event.payment)) return false;
  return hasMoneyPayment(event);
}

function filterDigestEvents(events) {
  return events.filter((event) => !isPaidCourse(event));
}

function formatEvent(event, index) {
  const lines = [
    `${index}. <a href="${escapeHtml(event.link)}">${escapeHtml(event.title)}</a>${event.calendar ? ` | <a href="${escapeHtml(event.calendar)}">calendar</a>` : ''}`,
    `Date: ${escapeHtml(formatDate(event))}`,
    `Source: ${escapeHtml(event.sourceName || event.sourceId)}`,
  ];

  if (event.tags?.length) lines.push(`Tags: ${escapeHtml(event.tags.join(', '))}`);
  if (event.description) lines.push(escapeHtml(truncate(event.description)));
  return lines.join('\n');
}

function splitMessages(events, { title = 'New opportunities' } = {}) {
  const messages = [];
  let current = `${escapeHtml(title)}: ${events.length}\n\n`;

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
    .filter(Boolean);
}

function lastEvents(events, count) {
  return events.slice(-count);
}

function selectEventsToSend(events, state, args) {
  if (args.last !== null) return lastEvents(events, args.last);
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

async function callTelegram(method, payload) {
  const response = await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    let errorText = '';
    try {
      const body = await response.json();
      errorText = body.description ? `: ${body.description}` : '';
    } catch {
      errorText = `: HTTP ${response.status}`;
    }
    throw new Error(`Telegram ${method} failed${errorText}`);
  }

  return response.json();
}

async function sendTelegramMessage(text) {
  const payload = await callTelegram('sendMessage', {
    chat_id: process.env.TELEGRAM_CHAT_ID,
    text,
    parse_mode: 'HTML',
    disable_web_page_preview: true,
  });

  return payload.result;
}

async function updateState(filePath, state, sentEvents, sentMessages) {
  const previousSentIds = Array.isArray(state.sentTelegramEventIds) ? state.sentTelegramEventIds : [];
  const sentTelegramEventIds = [...new Set([...previousSentIds, ...sentEvents.map((event) => event.id)])];

  const nextState = {
    ...state,
    sentTelegramEventIds,
    lastTelegramDigestAt: new Date().toISOString(),
    lastTelegramDigestEventIds: sentEvents.map((event) => event.id),
    lastTelegramDigestMessages: sentMessages,
  };

  await writeFile(filePath, JSON.stringify(nextState, null, 2) + '\n', 'utf8');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  await loadEnvFile(args.envFile);

  const events = await readEvents(args.eventsFile);
  const state = await readState(args.stateFile);

  if (!args.dryRun) {
    requireTelegramConfig();
  }

  const eventsToSend = filterDigestEvents(selectEventsToSend(events, state, args))
    .sort(compareDigestEvents);

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

  const sentMessages = [];
  let eventOffset = 0;
  for (const message of messages) {
    const sentMessage = await sendTelegramMessage(message);
    const eventCountInMessage = (message.match(/(?:^|\n)\d+\. <a href=/g) || []).length;
    const messageEvents = eventsToSend
      .slice(eventOffset, eventOffset + eventCountInMessage)
      .map((event, index) => ({
        number: eventOffset + index + 1,
        eventId: event.id,
        title: event.title,
      }));
    eventOffset += eventCountInMessage;
    sentMessages.push({
      messageId: sentMessage.message_id,
      events: messageEvents,
    });
  }

  if (shouldUpdateState) {
    await updateState(args.stateFile, state, eventsToSend, sentMessages);
  }

  const stateNote = shouldUpdateState ? 'state updated' : 'state unchanged';
  console.log(`Sent Telegram digest: ${eventsToSend.length} event(s), ${messages.length} message(s), ${stateNote}.`);
}

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
