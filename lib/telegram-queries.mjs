import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const defaultEventsPath = path.join(repoRoot, 'data', 'events.jsonl');
const defaultStatePath = path.join(repoRoot, 'data', 'state.json');

export async function readEvents(filePath = defaultEventsPath) {
  let text;
  try {
    text = await readFile(filePath, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

export async function readState(filePath = defaultStatePath) {
  try {
    return JSON.parse(await readFile(filePath, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return {};
    throw error;
  }
}

export function queryToday(events) {
  const today = todayDateUtc();
  return events.filter((event) => {
    const date = event.dateNormalized?.slice(0, 10);
    return date && date === today;
  });
}

function todayDateUtc() {
  return new Date().toISOString().slice(0, 10);
}

export function queryNearest(events, limit = 10) {
  const today = todayDateUtc();
  return events
    .filter((event) => {
      const date = event.dateNormalized?.slice(0, 10);
      return date && date >= today;
    })
    .sort((a, b) => {
      const dateA = a.dateNormalized || '9999-99-99';
      const dateB = b.dateNormalized || '9999-99-99';
      return dateA.localeCompare(dateB);
    })
    .slice(0, limit);
}

export function queryNewest(events, limit = 10) {
  return [...events]
    .sort((a, b) => {
      const timeA = a.firstSeenAt || '';
      const timeB = b.firstSeenAt || '';
      return timeB.localeCompare(timeA);
    })
    .slice(0, limit);
}
