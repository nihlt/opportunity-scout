import { chromium } from 'playwright';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cleanText, loadKeywordRules, normalizeEvent } from '../lib/scraper-runtime.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const materialsDir = path.join(repoRoot, 'materials');
const registryPath = path.join(materialsDir, 'sources-registry.json');
const sourcesConfigPath = path.join(repoRoot, 'config', 'sources.json');

const scraperModules = {
  'dou-calendar': () => import('../scrapers/dou-calendar.mjs'),
  'ain-opportunities': () => import('../scrapers/ain-opportunities.mjs'),
  'kaggle-competitions': () => import('../scrapers/kaggle-competitions.mjs'),
  'kse-news': () => import('../scrapers/kse-news.mjs'),
};

async function readJson(filePath, fallback) {
  try {
    return JSON.parse(await readFile(filePath, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return fallback;
    throw error;
  }
}

function relative(filePath) {
  return path.relative(repoRoot, filePath).replaceAll('\\', '/');
}

function pathsFor(source) {
  return {
    visibleText: path.join(materialsDir, `${source.filesPrefix}-visible-text.txt`),
    links: path.join(materialsDir, `${source.filesPrefix}-links.json`),
    events: path.join(materialsDir, `${source.filesPrefix}-events.json`),
  };
}

async function loadSources() {
  const sources = await readJson(sourcesConfigPath, []);
  return sources.map((source) => ({
    ...source,
    scraper: source.scraper || source.type,
    type: source.type || source.scraper,
    enabled: source.enabled !== false,
  }));
}

function selectSources(sources) {
  const requested = process.argv.slice(2);
  if (!requested.length || requested.includes('all')) return sources.filter((source) => source.enabled !== false);

  const selected = sources.filter((source) => requested.includes(source.id));
  const missing = requested.filter((id) => !sources.some((source) => source.id === id));
  if (missing.length) throw new Error(`Unknown source id(s): ${missing.join(', ')}`);
  return selected;
}

async function runScraper(browser, source) {
  const loadModule = scraperModules[source.scraper];
  if (!loadModule) throw new Error(`Unknown scraper for ${source.id}: ${source.scraper}`);

  const page = await browser.newPage({ viewport: { width: 1440, height: 1400 } });
  await page.goto(source.url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {});
  if (source.scraper === 'kaggle-competitions') await page.waitForTimeout(5_000);

  try {
    const module = await loadModule();
    return await module.scrape({ browser, page, source, helpers: { cleanText } });
  } finally {
    await page.close();
  }
}

async function scrapeSource(browser, source) {
  const scraped = await runScraper(browser, source);
  const visibleText = scraped.visibleText || '';
  const links = scraped.links || [];
  const rawEvents = scraped.rawEvents || [];
  const metadata = scraped.metadata || {};

  const filePaths = pathsFor(source);
  await writeFile(filePaths.visibleText, cleanText(visibleText) + '\n', 'utf8');
  await writeFile(filePaths.links, JSON.stringify(links, null, 2) + '\n', 'utf8');

  const savedText = await readFile(filePaths.visibleText, 'utf8');
  const savedLinks = JSON.parse(await readFile(filePaths.links, 'utf8'));
  const scrapedAt = new Date().toISOString();
  const events = rawEvents
    .map((event) =>
      normalizeEvent(event, {
        scrapedAt,
        inferDetails: source.scraper !== 'kse-news',
        inferPayment:
          source.scraper !== 'kse-news' &&
          source.scraper !== 'ain-opportunities' &&
          source.scraper !== 'kaggle-competitions',
      }),
    )
    .filter((event) => event.title && event.link);

  const output = {
    sourceId: source.id,
    sourceName: source.name,
    sourceUrl: source.url,
    sourceType: source.scraper,
    scrapedAt,
    sourceFiles: {
      visibleText: relative(filePaths.visibleText),
      links: relative(filePaths.links),
    },
    pageTextCharacters: savedText.length,
    linkCount: savedLinks.length,
    ...metadata,
    events,
  };

  await writeFile(filePaths.events, JSON.stringify(output, null, 2) + '\n', 'utf8');

  return {
    id: source.id,
    name: source.name,
    type: source.scraper,
    url: source.url,
    files: {
      visibleText: relative(filePaths.visibleText),
      links: relative(filePaths.links),
      events: relative(filePaths.events),
    },
    eventCount: events.length,
    linkCount: savedLinks.length,
    pageTextCharacters: savedText.length,
    ...metadata,
    scrapedAt: output.scrapedAt,
  };
}

async function readExistingRegistryEntries() {
  try {
    const registry = JSON.parse(await readFile(registryPath, 'utf8'));
    return Array.isArray(registry.sources) ? registry.sources : [];
  } catch {
    return [];
  }
}

async function writeRegistry(allSources, entries, { mergeExisting = false } = {}) {
  const entryById = new Map();

  if (mergeExisting) {
    for (const entry of await readExistingRegistryEntries()) entryById.set(entry.id, entry);
  }
  for (const entry of entries) entryById.set(entry.id, entry);

  const finalEntries = allSources.map((source) => entryById.get(source.id)).filter(Boolean);
  const output = {
    generatedAt: new Date().toISOString(),
    sources: finalEntries,
    totals: {
      sources: finalEntries.length,
      events: finalEntries.reduce((sum, source) => sum + source.eventCount, 0),
      links: finalEntries.reduce((sum, source) => sum + source.linkCount, 0),
    },
  };

  await writeFile(registryPath, JSON.stringify(output, null, 2) + '\n', 'utf8');
}

async function main() {
  await mkdir(materialsDir, { recursive: true });
  await loadKeywordRules();

  const allSources = await loadSources();
  const selectedSources = selectSources(allSources);
  const browser = await chromium.launch({ headless: true });

  try {
    const registryEntries = [];
    for (const source of selectedSources) {
      console.log(`Scraping ${source.id}: ${source.url}`);
      const entry = await scrapeSource(browser, source);
      registryEntries.push(entry);
      console.log(`Saved ${entry.files.events} (${entry.eventCount})`);
    }
    await writeRegistry(allSources, registryEntries, { mergeExisting: selectedSources.length < allSources.length });
    console.log(`Saved registry: ${relative(registryPath)}`);
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
