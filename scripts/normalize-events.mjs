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
    sourceId: event.sourceId,
  };

  return createHash('sha256').update(JSON.stringify(comparable), 'utf8').digest('hex');
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
  const id = stableId(source.id, link, title);

  return {
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
    sourceEventFile: source.files.events,
    sourceEventIndex: index,
    firstSeenAt: observedAt,
    lastSeenAt: observedAt,
  };
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
  const currentEvents = [];
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
      currentEvents.push(normalized);
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
