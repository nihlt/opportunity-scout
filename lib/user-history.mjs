import { appendFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { userDirectory } from './user-config.mjs';

export async function appendUserHistory(chatId, entry) {
  const dir = userDirectory(chatId);
  await mkdir(dir, { recursive: true });
  const safeEntry = {
    timestamp: new Date().toISOString(),
    ...entry,
    chatId: String(chatId),
  };
  await appendFile(path.join(dir, 'history.jsonl'), JSON.stringify(safeEntry) + '\n', 'utf8');
}
