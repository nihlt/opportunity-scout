import {
  answerCallbackQuery,
  deleteMessage,
  loadEnvFile,
  requireTelegramConfig,
  sendMessage,
  getUpdates,
} from '../lib/telegram-client.mjs';
import {
  queryNewest,
  queryNearest,
  queryToday,
  readEvents,
  readState,
} from '../lib/telegram-queries.mjs';
import {
  formatEventCompact,
  formatEventFull,
  formatLastUpdate,
  splitMessages,
} from '../lib/telegram-format.mjs';
import {
  CALLBACK_NEWEST,
  CALLBACK_NEAREST,
  CALLBACK_TODAY,
  mainKeyboard,
} from '../lib/telegram-keyboard.mjs';

const botMessagesByChat = new Map();

function chatState(chatId) {
  const key = String(chatId);
  if (!botMessagesByChat.has(key)) {
    botMessagesByChat.set(key, {
      controlMessageId: null,
      resultMessageIds: [],
    });
  }
  return botMessagesByChat.get(key);
}

async function deleteResultMessages(chatId) {
  const state = chatState(chatId);
  for (const messageId of state.resultMessageIds) {
    await deleteMessage(chatId, messageId).catch(() => {});
  }
  state.resultMessageIds = [];
}

async function sendControlMessage(chatId) {
  const state = chatState(chatId);
  await deleteResultMessages(chatId);
  if (state.controlMessageId) {
    await deleteMessage(chatId, state.controlMessageId).catch(() => {});
    state.controlMessageId = null;
  }

  const sent = await sendMessage(chatId, await buildWelcome(), { replyMarkup: mainKeyboard() });
  state.controlMessageId = sent.message_id;
  return sent;
}

async function replaceResultMessages(chatId, texts) {
  const state = chatState(chatId);
  await deleteResultMessages(chatId);
  const newIds = [];
  for (const text of texts) {
    const sent = await sendMessage(chatId, text);
    newIds.push(sent.message_id);
  }
  state.resultMessageIds = newIds;
  return newIds;
}

async function buildWelcome() {
  const state = await readState();
  const events = await readEvents();
  const total = events.length;
  const sourceCount = Array.isArray(state.sourceStats) ? state.sourceStats.length : 0;
  const lastUpdate = formatLastUpdate(state.lastNormalizeAt || state.lastRunAt);
  return [
    'Opps Monitor',
    `Зібрано ${total} можливостей з ${sourceCount} джерел.`,
    `Останнє оновлення: ${lastUpdate}`,
    '',
    'Оберіть дію кнопками нижче.',
  ].join('\n');
}

function eventBlocks(events, formatter) {
  return events.map((event, index) => formatter(event, index + 1));
}

async function respondWithEvents(chatId, events, { title, formatter }) {
  if (!events.length) {
    await replaceResultMessages(chatId, ['Немає подій для цього запиту.']);
    return;
  }
  const blocks = eventBlocks(events, formatter);
  const messages = splitMessages(blocks, { title });
  await replaceResultMessages(chatId, messages);
}

async function handleCallback(callbackQuery) {
  const chatId = callbackQuery.message?.chat?.id;
  const data = callbackQuery.data;
  if (!chatId) return;

  await answerCallbackQuery(callbackQuery.id).catch(() => {});

  const events = await readEvents();

  if (data === CALLBACK_TODAY) {
    const todayEvents = queryToday(events);
    if (todayEvents.length) {
      const sorted = [...todayEvents].sort((a, b) => {
        const dateA = a.dateNormalized || '9999-99-99';
        const dateB = b.dateNormalized || '9999-99-99';
        return dateA.localeCompare(dateB) || a.title.localeCompare(b.title);
      });
      await respondWithEvents(chatId, sorted, {
        title: `Today: ${sorted.length}`,
        formatter: formatEventFull,
      });
      return;
    }
    const nearest = queryNearest(events, 10);
    await respondWithEvents(chatId, nearest, {
      title: 'Немає подій на сьогодні. Найближчі:',
      formatter: formatEventCompact,
    });
    return;
  }

  if (data === CALLBACK_NEAREST) {
    const nearest = queryNearest(events, 10);
    await respondWithEvents(chatId, nearest, {
      title: 'Nearest 10',
      formatter: formatEventCompact,
    });
    return;
  }

  if (data === CALLBACK_NEWEST) {
    const newest = queryNewest(events, 10);
    await respondWithEvents(chatId, newest, {
      title: 'Newest 10',
      formatter: formatEventCompact,
    });
    return;
  }
}

async function handleMessage(message) {
  const chatId = message.chat?.id;
  const text = message.text;
  if (!chatId) return;

  if (text === '/start' || text === '/help') {
    await sendControlMessage(chatId);
  }
}

async function processUpdate(update) {
  if (update.callback_query) {
    await handleCallback(update.callback_query);
    return;
  }
  if (update.message) {
    await handleMessage(update.message);
  }
}

async function main() {
  await loadEnvFile();
  requireTelegramConfig();

  let offset = 0;
  console.log('Opps Monitor bot started. Polling for updates...');

  while (true) {
    let updates;
    try {
      updates = await getUpdates(offset);
    } catch (error) {
      console.error('getUpdates error:', error.message);
      await new Promise((resolve) => setTimeout(resolve, 5000));
      continue;
    }

    for (const update of updates) {
      try {
        await processUpdate(update);
      } catch (error) {
        console.error('Update handling error:', error.message);
      }
      offset = update.update_id + 1;
    }
  }
}

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
