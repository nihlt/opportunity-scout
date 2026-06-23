import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const defaultEventsPath = path.join(repoRoot, 'data', 'events.jsonl');
const defaultStatePath = path.join(repoRoot, 'data', 'state.json');
const defaultPreferencesPath = path.join(repoRoot, 'data', 'preferences.json');
const telegramLimit = 4096;
const safeMessageLimit = 3600;
const preferenceStopWords = new Set([
  'and',
  'are',
  'for',
  'from',
  'the',
  'with',
  'you',
  '\u0430\u0431\u043e',
  '\u0432\u0456\u0434',
  '\u0434\u043b\u044f',
  '\u0437\u0430',
  '\u043d\u0430',
  '\u043f\u0440\u043e',
  '\u0442\u0430',
  '\u0443',
  '\u0443\u0441\u0456',
  '\u0449\u043e',
]);

function parseArgs(argv) {
  const args = {
    dryRun: false,
    last: null,
    markSent: false,
    envFile: path.join(repoRoot, '.env'),
    eventsFile: defaultEventsPath,
    stateFile: defaultStatePath,
    preferencesFile: defaultPreferencesPath,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--dry-run') args.dryRun = true;
    else if (arg === '--last') args.last = Number(argv[++index]);
    else if (arg === '--mark-sent') args.markSent = true;
    else if (arg === '--env-file') args.envFile = path.resolve(repoRoot, argv[++index]);
    else if (arg === '--events-file') args.eventsFile = path.resolve(repoRoot, argv[++index]);
    else if (arg === '--state-file') args.stateFile = path.resolve(repoRoot, argv[++index]);
    else if (arg === '--preferences-file') args.preferencesFile = path.resolve(repoRoot, argv[++index]);
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

async function readPreferences(filePath) {
  try {
    const preferences = JSON.parse(await readFile(filePath, 'utf8'));
    return {
      words: preferences.words || {},
      eventFeedback: preferences.eventFeedback || {},
      lastUpdatedAt: preferences.lastUpdatedAt || null,
    };
  } catch (error) {
    if (error.code === 'ENOENT') {
      return { words: {}, eventFeedback: {}, lastUpdatedAt: null };
    }
    throw error;
  }
}

async function writePreferences(filePath, preferences) {
  await writeFile(filePath, JSON.stringify(preferences, null, 2) + '\n', 'utf8');
}

function isAiEvent(event) {
  return event.tags.some((tag) => tag.toLowerCase() === 'ai');
}

function preferenceScore(event, preferences) {
  const text = [event.title, event.description, event.tags?.join(' ')].filter(Boolean).join('\n').toLowerCase();
  let score = Number(preferences.eventFeedback?.[event.id] || 0);

  for (const [word, value] of Object.entries(preferences.words || {})) {
    if (word && text.includes(word.toLowerCase())) {
      score += Number(value) || 0;
    }
  }

  return score;
}

function extractPreferenceTerms(event) {
  const rawText = [event.title, event.tags?.join(' ')].filter(Boolean).join(' ').toLowerCase();
  const terms = new Set();

  for (const match of rawText.matchAll(/[\p{L}\p{N}][\p{L}\p{N}_+-]*/gu)) {
    const term = match[0].trim();
    if (term.length < 2 || preferenceStopWords.has(term)) continue;
    terms.add(term);
  }

  return [...terms];
}

function applyEventFeedback(preferences, event, eventId, delta) {
  preferences.eventFeedback[eventId] = (Number(preferences.eventFeedback[eventId]) || 0) + delta;

  if (!event) return;
  for (const term of extractPreferenceTerms(event)) {
    preferences.words[term] = (Number(preferences.words[term]) || 0) + delta;
    if (preferences.words[term] === 0) delete preferences.words[term];
  }
}

function compareDigestEvents(a, b, preferences = {}) {
  const aiDelta = Number(isAiEvent(b)) - Number(isAiEvent(a));
  if (aiDelta) return aiDelta;

  const scoreDelta = preferenceScore(b, preferences) - preferenceScore(a, preferences);
  if (scoreDelta) return scoreDelta;

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
    `${index}. <a href="${escapeHtml(event.link)}">${escapeHtml(event.title)}</a>`,
    `Date: ${escapeHtml(formatDate(event))}`,
    `Source: ${escapeHtml(event.sourceName || event.sourceId)}`,
  ];

  if (event.tags?.length) lines.push(`Tags: ${escapeHtml(event.tags.join(', '))}`);
  if (event.payment) lines.push(`Payment: ${escapeHtml(event.payment)}`);
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

async function setMessageReaction(chatId, messageId, emoji = '\u{1F44D}') {
  await callTelegram('setMessageReaction', {
    chat_id: chatId,
    message_id: messageId,
    reaction: [{ type: 'emoji', emoji }],
  }).catch((error) => {
    console.warn(`Could not set feedback reaction: ${error.message}`);
  });
}

async function getUpdates(state) {
  const payload = {
    timeout: 0,
    allowed_updates: ['message'],
  };

  if (Number.isInteger(state.telegramUpdateOffset)) {
    payload.offset = state.telegramUpdateOffset;
  }

  const response = await callTelegram('getUpdates', payload);
  return Array.isArray(response.result) ? response.result : [];
}

function feedbackDelta(markers) {
  if (markers === '++') return 2;
  if (markers === '+') return 1;
  if (markers === '--') return -2;
  if (markers === '-') return -1;
  return 0;
}

function parseFeedbackText(text) {
  const feedback = [];
  for (const line of String(text || '').split(/\r?\n/)) {
    const match = line.trim().match(/^(\d+)\s*(\+\+|--|\+|-)$/);
    if (match) {
      feedback.push({ number: Number(match[1]), delta: feedbackDelta(match[2]) });
    }
  }
  return feedback;
}

function digestMessageMappings(state) {
  const mappings = new Map();
  for (const digestMessage of state.lastTelegramDigestMessages || []) {
    const messageId = digestMessage.messageId;
    if (!messageId) continue;
    mappings.set(messageId, new Map((digestMessage.events || []).map((event) => [event.number, event.eventId])));
  }
  return mappings;
}

async function processFeedbackUpdates(state, preferences, { dryRun = false, eventsById = new Map() } = {}) {
  const updates = await getUpdates(state);
  const mappings = digestMessageMappings(state);
  let maxUpdateId = Number.isInteger(state.telegramUpdateOffset) ? state.telegramUpdateOffset - 1 : -1;
  let feedbackCount = 0;

  for (const update of updates) {
    if (Number.isInteger(update.update_id)) maxUpdateId = Math.max(maxUpdateId, update.update_id);

    const message = update.message;
    if (!message || String(message.chat?.id) !== String(process.env.TELEGRAM_CHAT_ID)) continue;
    const repliedMessageId = message.reply_to_message?.message_id;
    if (!mappings.has(repliedMessageId)) continue;

    const parsed = parseFeedbackText(message.text);
    if (!parsed.length) continue;

    const numberToEventId = mappings.get(repliedMessageId);
    for (const item of parsed) {
      const eventId = numberToEventId.get(item.number);
      if (!eventId) continue;
      applyEventFeedback(preferences, eventsById.get(eventId), eventId, item.delta);
      feedbackCount += 1;
    }

    if (!dryRun) {
      await setMessageReaction(message.chat.id, message.message_id);
    }
  }

  if (maxUpdateId >= 0) {
    state.telegramUpdateOffset = maxUpdateId + 1;
  }

  if (feedbackCount) {
    preferences.lastUpdatedAt = new Date().toISOString();
  }

  return { feedbackCount, updateCount: updates.length };
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
  const preferences = await readPreferences(args.preferencesFile);
  const eventsById = new Map(events.map((event) => [event.id, event]));

  const needsTelegram = !args.dryRun;
  if (needsTelegram) {
    requireTelegramConfig();
  }

  let feedbackResult = { feedbackCount: 0, updateCount: 0 };
  if (!args.dryRun && args.last === null) {
    feedbackResult = await processFeedbackUpdates(state, preferences, { eventsById });
    if (feedbackResult.feedbackCount) {
      await writePreferences(args.preferencesFile, preferences);
    }
  }

  const eventsToSend = filterDigestEvents(selectEventsToSend(events, state, args))
    .sort((a, b) => compareDigestEvents(a, b, preferences));

  if (!eventsToSend.length) {
    console.log(args.last === null ? 'No new Telegram digest events to send.' : 'No events found for --last.');
    if (!args.dryRun && args.last === null && feedbackResult.updateCount) {
      await writeFile(args.stateFile, JSON.stringify(state, null, 2) + '\n', 'utf8');
    }
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
  } else if (feedbackResult.updateCount) {
    await writeFile(args.stateFile, JSON.stringify(state, null, 2) + '\n', 'utf8');
  }

  const stateNote = shouldUpdateState ? 'state updated' : 'state unchanged';
  console.log(`Sent Telegram digest: ${eventsToSend.length} event(s), ${messages.length} message(s), ${stateNote}.`);
}

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
