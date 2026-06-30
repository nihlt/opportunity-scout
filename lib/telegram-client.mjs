import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

export async function loadEnvFile(filePath = path.join(repoRoot, '.env')) {
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

export function requireTelegramConfig() {
  if (!process.env.TELEGRAM_BOT_TOKEN) {
    throw new Error('Missing TELEGRAM_BOT_TOKEN in environment');
  }
}

export async function callTelegram(method, payload) {
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

export async function sendMessage(chatId, text, { replyMarkup = null } = {}) {
  const payload = {
    chat_id: chatId,
    text,
    parse_mode: 'HTML',
    disable_web_page_preview: true,
  };
  if (replyMarkup) payload.reply_markup = replyMarkup;
  const result = await callTelegram('sendMessage', payload);
  return result.result;
}

export async function deleteMessage(chatId, messageId) {
  return callTelegram('deleteMessage', { chat_id: chatId, message_id: messageId });
}

export async function answerCallbackQuery(callbackQueryId, text = '') {
  const payload = { callback_query_id: callbackQueryId };
  if (text) payload.text = text;
  return callTelegram('answerCallbackQuery', payload);
}

export async function getUpdates(offset, timeout = 30) {
  const result = await callTelegram('getUpdates', {
    offset,
    timeout,
    allowed_updates: ['message', 'callback_query'],
  });
  return result.result;
}
