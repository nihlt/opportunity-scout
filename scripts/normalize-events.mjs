import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const dataDir = path.join(repoRoot, 'data');
const materialsDir = path.join(repoRoot, 'materials');
const registryPath = path.join(materialsDir, 'sources-registry.json');
const eventsJsonlPath = path.join(dataDir, 'events.jsonl');
const currentJsonPath = path.join(dataDir, 'events.current.json');
const statePath = path.join(dataDir, 'state.json');

function cleanText(value) {
  return String(value ?? '')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

function stableId(sourceId, link, title) {
  return createHash('sha256')
    .update([sourceId, link, title].map(cleanText).join('\n'), 'utf8')
    .digest('hex')
    .slice(0, 24);
}

function eventId(source, link, title) {
  if (source.type === 'dou-calendar') {
    return stableId('dou-calendar', link, '');
  }

  return stableId(source.id, link, title);
}

function contentHash(event) {
  const comparable = {
    title: event.title,
    link: event.link,
    date: event.date,
    dateNormalized: event.dateNormalized,
    dateEndNormalized: event.dateEndNormalized,
    datePrecision: event.datePrecision,
    description: event.description,
    location: event.location,
    payment: event.payment,
    tags: event.tags,
    calendar: event.calendar,
    sourceId: event.sourceId,
  };

  return createHash('sha256').update(JSON.stringify(comparable), 'utf8').digest('hex');
}

function truncate(text, maxLength = 260) {
  if (!text) return '';
  const clean = String(text).replace(/\s+/g, ' ').trim();
  if (clean.length <= maxLength) return clean;
  return `${clean.slice(0, maxLength - 1).trimEnd()}...`;
}

function parseNormalizedDate(value) {
  if (!value || typeof value !== 'string') return null;
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2}))?)?$/);
  if (!match) return null;

  const [, year, month, day, hour = '00', minute = '00', second = '00'] = match;
  const date = new Date(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second),
  );

  return Number.isNaN(date.getTime()) ? null : date;
}

function addDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function addHours(date, hours) {
  const next = new Date(date);
  next.setHours(next.getHours() + hours);
  return next;
}

function pad2(value) {
  return String(value).padStart(2, '0');
}

function calendarDate(date) {
  return `${date.getFullYear()}${pad2(date.getMonth() + 1)}${pad2(date.getDate())}`;
}

function calendarDateTime(date) {
  return `${calendarDate(date)}T${pad2(date.getHours())}${pad2(date.getMinutes())}${pad2(date.getSeconds())}`;
}

function calendarDates(event) {
  if (!event.dateNormalized) return null;

  if (event.datePrecision === 'date') {
    const start = parseNormalizedDate(event.dateNormalized);
    if (!start) return null;
    return `${calendarDate(start)}/${calendarDate(addDays(start, 1))}`;
  }

  if (event.datePrecision === 'date_range') {
    const start = parseNormalizedDate(event.dateNormalized);
    const end = parseNormalizedDate(event.dateEndNormalized) || start;
    if (!start || !end) return null;
    return `${calendarDate(start)}/${calendarDate(addDays(end, 1))}`;
  }

  if (event.datePrecision === 'datetime') {
    const start = parseNormalizedDate(event.dateNormalized);
    if (!start) return null;
    return `${calendarDateTime(start)}/${calendarDateTime(addHours(start, 1))}`;
  }

  return null;
}

function buildCalendarLink(event) {
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: event.title || 'Opportunity',
  });
  const dates = calendarDates(event);
  if (dates) params.set('dates', dates);

  const details = [
    truncate(event.description, 180),
    event.sourceName ? `Source: ${event.sourceName}` : null,
    event.tags?.length ? `Tags: ${event.tags.join(', ')}` : null,
    event.link ? `Link: ${event.link}` : null,
  ].filter(Boolean).join('\n');
  if (details) params.set('details', details);
  if (event.location) params.set('location', event.location);

  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

async function readJson(filePath, fallback) {
  try {
    return JSON.parse(await readFile(filePath, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return fallback;
    throw error;
  }
}

async function readEventsJsonl() {
  try {
    const text = await readFile(eventsJsonlPath, 'utf8');
    return text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

function normalizeEvent(source, sourceEvent, index, observedAt) {
  const title = cleanText(sourceEvent.title);
  const link = cleanText(sourceEvent.link);
  const id = eventId(source, link, title);

  const normalized = {
    id,
    title,
    link,
    date: sourceEvent.date ?? null,
    dateNormalized: sourceEvent.dateNormalized ?? null,
    dateEndNormalized: sourceEvent.dateEndNormalized ?? null,
    datePrecision: sourceEvent.datePrecision ?? 'unknown',
    description: cleanText(sourceEvent.description) || null,
    location: cleanText(sourceEvent.location) || null,
    payment: cleanText(sourceEvent.payment) || null,
    tags: Array.isArray(sourceEvent.tags)
      ? [...new Set(sourceEvent.tags.map(cleanText).filter(Boolean))]
      : [],
    sourceId: source.id,
    sourceName: source.name,
    sourceType: source.type,
    sourceUrl: source.url,
    sourceIds: [source.id],
    sourceNames: [source.name],
    sourceUrls: [source.url],
    sourceEventFile: source.files.events,
    sourceEventIndex: index,
    firstSeenAt: observedAt,
    lastSeenAt: observedAt,
  };

  return {
    ...normalized,
    calendar: cleanText(sourceEvent.calendar) || buildCalendarLink(normalized),
  };
}

function mergeUnique(values) {
  return [...new Set(values.map(cleanText).filter(Boolean))];
}

function mergeEvents(existing, incoming) {
  const merged = {
    ...existing,
    description: existing.description || incoming.description,
    location: existing.location || incoming.location,
    payment: existing.payment || incoming.payment,
    calendar: existing.calendar || incoming.calendar,
    tags: mergeUnique([...(existing.tags || []), ...(incoming.tags || [])]),
    sourceIds: mergeUnique([...(existing.sourceIds || [existing.sourceId]), ...(incoming.sourceIds || [incoming.sourceId])]),
    sourceNames: mergeUnique([
      ...(existing.sourceNames || [existing.sourceName]),
      ...(incoming.sourceNames || [incoming.sourceName]),
    ]),
    sourceUrls: mergeUnique([...(existing.sourceUrls || [existing.sourceUrl]), ...(incoming.sourceUrls || [incoming.sourceUrl])]),
  };

  merged.sourceId = merged.sourceIds.join(', ');
  merged.sourceName = merged.sourceNames.join(' / ');
  merged.sourceUrl = merged.sourceUrls[0] || existing.sourceUrl;

  return merged;
}

function compareEvents(a, b) {
  return (
    String(a.dateNormalized || '9999-99-99').localeCompare(String(b.dateNormalized || '9999-99-99')) ||
    a.sourceId.localeCompare(b.sourceId) ||
    a.title.localeCompare(b.title)
  );
}

async function main() {
  await mkdir(dataDir, { recursive: true });

  const observedAt = new Date().toISOString();
  const registry = await readJson(registryPath, { sources: [] });
  const previousEvents = await readEventsJsonl();
  const previousById = new Map(previousEvents.map((event) => [event.id, event]));
  const currentById = new Map();
  const sourceStats = [];

  for (const source of registry.sources || []) {
    const eventFilePath = path.join(repoRoot, source.files.events);
    const raw = await readJson(eventFilePath, { events: [] });
    let count = 0;

    for (const [index, sourceEvent] of (raw.events || []).entries()) {
      const normalized = normalizeEvent(source, sourceEvent, index, observedAt);
      const previous = previousById.get(normalized.id);
      if (previous) {
        normalized.firstSeenAt = previous.firstSeenAt || observedAt;
      }
      normalized.lastSeenAt = observedAt;
      normalized.contentHash = contentHash(normalized);
      const existing = currentById.get(normalized.id);
      currentById.set(normalized.id, existing ? mergeEvents(existing, normalized) : normalized);
      count += 1;
    }

    sourceStats.push({
      id: source.id,
      name: source.name,
      eventCount: count,
      sourceEventFile: source.files.events,
      scrapedAt: source.scrapedAt,
    });
  }

  const currentEvents = [...currentById.values()];
  for (const event of currentEvents) {
    event.contentHash = contentHash(event);
  }
  currentEvents.sort(compareEvents);

  const previousHashes = new Map(previousEvents.map((event) => [event.id, event.contentHash]));
  const currentIds = new Set(currentEvents.map((event) => event.id));
  const newIds = currentEvents.filter((event) => !previousById.has(event.id)).map((event) => event.id);
  const updatedIds = currentEvents
    .filter((event) => previousById.has(event.id) && previousHashes.get(event.id) !== event.contentHash)
    .map((event) => event.id);
  const disappearedIds = previousEvents.filter((event) => !currentIds.has(event.id)).map((event) => event.id);

  await writeFile(
    eventsJsonlPath,
    currentEvents.map((event) => JSON.stringify(event)).join('\n') + (currentEvents.length ? '\n' : ''),
    'utf8',
  );

  await writeFile(
    currentJsonPath,
    JSON.stringify(
      {
        generatedAt: observedAt,
        totalEvents: currentEvents.length,
        events: currentEvents,
      },
      null,
      2,
    ) + '\n',
    'utf8',
  );

  const previousState = await readJson(statePath, {});
  const sentTelegramEventIds = Array.isArray(previousState.sentTelegramEventIds)
    ? previousState.sentTelegramEventIds
    : [];

  await writeFile(
    statePath,
    JSON.stringify(
      {
        ...previousState,
        lastRunAt: observedAt,
        lastNormalizeAt: observedAt,
        totalEvents: currentEvents.length,
        sourceStats,
        lastChanges: {
          newEventIds: newIds,
          updatedEventIds: updatedIds,
          disappearedEventIds: disappearedIds,
        },
        sentTelegramEventIds,
        lastTelegramDigestAt: previousState.lastTelegramDigestAt ?? null,
      },
      null,
      2,
    ) + '\n',
    'utf8',
  );

  console.log(`Normalized events: ${currentEvents.length}`);
  console.log(`New: ${newIds.length}, updated: ${updatedIds.length}, disappeared: ${disappearedIds.length}`);
  console.log(`Saved ${path.relative(repoRoot, eventsJsonlPath)}`);
  console.log(`Saved ${path.relative(repoRoot, currentJsonPath)}`);
  console.log(`Saved ${path.relative(repoRoot, statePath)}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
