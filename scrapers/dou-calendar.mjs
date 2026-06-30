import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  canonicalUrl,
  cleanText,
  hashText,
  readJson,
  scrapeVisibleTextAndLinks,
  tagsFromKeywords,
  uniqueStrings,
} from '../lib/scraper-runtime.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const materialsDir = path.join(repoRoot, 'materials');
const douDetailsCachePath = path.join(materialsDir, 'dou-event-details-cache.json');
const douMaxPages = 50;

function douDetailCacheKey(event) {
  if (event.link) return hashText(canonicalUrl(event.link));
  return hashText([event.title, event.date].map(cleanText).join('\n'));
}

function legacyDouDetailCacheKey(event) {
  return hashText([event.title, event.date].map(cleanText).join('\n'));
}

function douEventKey(event) {
  return canonicalUrl(event.link) || [event.title, event.link].map(cleanText).join('|');
}

async function readDouDetailsCache() {
  const cache = await readJson(douDetailsCachePath, { entries: {} });
  return {
    entries: cache && typeof cache.entries === 'object' && cache.entries ? cache.entries : {},
  };
}

async function writeDouDetailsCache(cache) {
  const output = {
    updatedAt: new Date().toISOString(),
    entries: cache.entries,
  };
  await writeFile(douDetailsCachePath, JSON.stringify(output, null, 2) + '\n', 'utf8');
}

async function scrapeDouCalendarList(page) {
  return page.evaluate(() => {
    const absolutize = (href) => {
      try {
        return new URL(href, document.location.href).href;
      } catch {
        return href;
      }
    };

    const parseWhenAndWhere = (node) => {
      const block = node.querySelector('.when-and-where');
      if (!block) return { date: '', location: '', payment: '' };

      const date = block.querySelector('.date')?.innerText?.trim() || '';
      const payment =
        [...block.querySelectorAll('span')]
          .filter((span) => !span.classList.contains('date'))
          .map((span) => span.innerText.trim())
          .filter(Boolean)
          .join(' ') || '';
      const location = [...block.childNodes]
        .filter((child) => child.nodeType === Node.TEXT_NODE)
        .map((child) => child.textContent.trim())
        .filter(Boolean)
        .join(' ');

      return { date, location, payment };
    };

    const seen = new Set();
    const events = [];

    for (const node of document.querySelectorAll('article.b-postcard')) {
      const text = node.innerText?.trim();
      if (!text || text.length < 40) continue;

      const eventLink = node.querySelector('h1 a, h2 a, h3 a, h4 a, .title a, a[href*="/calendar/"]');
      const title = eventLink?.innerText?.trim();
      const href = eventLink?.getAttribute('href');
      const link = href ? absolutize(href) : null;

      if (!title || !link) continue;
      const key = `${title}|${link}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const whenAndWhere = parseWhenAndWhere(node);

      events.push({
        title,
        link,
        date: whenAndWhere.date,
        description: node.querySelector('.b-typo, .descr, .description, p')?.innerText?.trim() || '',
        location: whenAndWhere.location,
        payment: whenAndWhere.payment,
        tags: [...node.querySelectorAll('a[href*="/calendar/tags/"], .tag')]
          .map((tag) => tag.innerText.trim())
          .filter(Boolean),
        text,
      });
    }

    return events;
  });
}

async function discoverDouCalendarPageUrls(page, sourceUrl) {
  return page.evaluate(({ sourceUrl }) => {
    const cleanUrl = (value) => {
      const url = new URL(value, document.location.href);
      url.hash = '';
      url.search = '';
      return url;
    };
    const source = cleanUrl(sourceUrl);
    const tagMatch = source.pathname.match(/^\/calendar\/tags\/[^/]+\/(?:\d+\/)?$/);
    const tagBasePath = tagMatch ? source.pathname.replace(/(?:\d+\/)?$/, '') : null;

    const pageNumber = (pathname) => {
      if (tagBasePath) {
        if (pathname === tagBasePath) return 1;
        const match = pathname.match(new RegExp(`^${tagBasePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\d+)/$`));
        return match ? Number(match[1]) : null;
      }

      if (pathname === '/calendar/') return 1;
      const match = pathname.match(/^\/calendar\/page-(\d+)\/$/);
      return match ? Number(match[1]) : null;
    };

    const isSameCalendarSection = (url) => {
      if (url.origin !== source.origin) return false;
      if (tagBasePath) {
        return url.pathname === tagBasePath || new RegExp(`^${tagBasePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\d+/$`).test(url.pathname);
      }
      return url.pathname === '/calendar/' || /^\/calendar\/page-\d+\/$/.test(url.pathname);
    };

    return [document.location.href, ...[...document.querySelectorAll('a[href]')].map((link) => link.href)]
      .map(cleanUrl)
      .filter(isSameCalendarSection)
      .map((url) => ({
        url: url.href,
        pageNumber: pageNumber(url.pathname),
      }))
      .filter((item) => Number.isInteger(item.pageNumber) && item.pageNumber > 0);
  }, { sourceUrl });
}

function mergeDouEvents(events) {
  const byKey = new Map();

  for (const event of events) {
    const key = douEventKey(event);
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, event);
      continue;
    }

    byKey.set(key, {
      ...existing,
      description: existing.description || event.description,
      location: existing.location || event.location,
      payment: existing.payment || event.payment,
      tags: uniqueStrings([...(existing.tags || []), ...(event.tags || [])]),
      text: cleanText([existing.text, event.text].filter(Boolean).join('\n\n--- DUPLICATE LIST ITEM ---\n\n')),
    });
  }

  return [...byKey.values()];
}

function uniqueLinks(links) {
  const byKey = new Map();

  for (const link of links) {
    const key = `${cleanText(link.text)}|${cleanText(link.href)}`;
    if (!byKey.has(key)) byKey.set(key, link);
  }

  return [...byKey.values()];
}

async function scrapeDouEventDetails(browser, event) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1800 } });
  await page.goto(event.link, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {});

  const detail = await page.evaluate(() => {
    const clean = (value) =>
      String(value ?? '')
        .replace(/\u00a0/g, ' ')
        .replace(/[ \t]+/g, ' ')
        .replace(/\n{3,}/g, '\n\n')
        .trim();

    const absolutize = (href) => {
      try {
        return new URL(href, document.location.href).href;
      } catch {
        return href;
      }
    };

    const parseWhenAndWhere = () => {
      const block = document.querySelector('.when-and-where');
      if (!block) return { date: '', location: '', payment: '' };

      const date = block.querySelector('.date')?.innerText?.trim() || '';
      const payment =
        [...block.querySelectorAll('span')]
          .filter((span) => !span.classList.contains('date'))
          .map((span) => span.innerText.trim())
          .filter(Boolean)
          .join(' ') || '';
      const location = [...block.childNodes]
        .filter((child) => child.nodeType === Node.TEXT_NODE)
        .map((child) => child.textContent.trim())
        .filter(Boolean)
        .join(' ');

      return { date, location, payment };
    };

    const parseSchemaEvent = () => {
      for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
        try {
          const data = JSON.parse(script.textContent);
          const items = Array.isArray(data) ? data : [data];
          const event = items.find((item) => item?.['@type'] === 'Event');
          if (event) return event;
        } catch {
          // Ignore unrelated structured data.
        }
      }
      return null;
    };

    const parsePageDetails = () => {
      const lines = clean(document.body.innerText)
        .split('\n')
        .map(clean)
        .filter(Boolean);
      const valueAfterLabel = (label) => {
        const index = lines.findIndex((line) => line.toLowerCase() === label.toLowerCase());
        return index >= 0 ? clean(lines[index + 1]) : '';
      };

      return {
        date: valueAfterLabel('Date'),
        time: valueAfterLabel('Time'),
        place: valueAfterLabel('Place'),
        price: valueAfterLabel('Price'),
      };
    };

    const compactCalendarDate = (value, { time = '', endOfDay = false } = {}) => {
      const text = clean(value);
      const timeMatch = clean(time).match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
      const timePart = timeMatch
        ? `${timeMatch[1].padStart(2, '0')}${timeMatch[2]}${timeMatch[3] || '00'}`
        : endOfDay
          ? '235959'
          : '000000';

      const dateOnly = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
      if (dateOnly) return `${dateOnly[1]}${dateOnly[2]}${dateOnly[3]}T${timePart}`;

      const dateTime = text.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/);
      if (dateTime) {
        return `${dateTime[1]}${dateTime[2]}${dateTime[3]}T${dateTime[4]}${dateTime[5]}${dateTime[6] || '00'}`;
      }

      return '';
    };

    const buildDouCalendarLink = (schemaEvent, pageDetails) => {
      if (!schemaEvent?.startDate) return '';

      const start = compactCalendarDate(schemaEvent.startDate, { time: pageDetails.time });
      const end = schemaEvent.endDate
        ? compactCalendarDate(schemaEvent.endDate, { time: pageDetails.time, endOfDay: !pageDetails.time })
        : compactCalendarDate(schemaEvent.startDate, { time: pageDetails.time, endOfDay: !pageDetails.time });
      if (!start || !end) return '';

      const location =
        clean(pageDetails.place) ||
        clean(schemaEvent.location?.name) ||
        clean(schemaEvent.location?.address?.streetAddress) ||
        clean(schemaEvent.location?.address?.addressLocality);
      const params = new URLSearchParams({
        action: 'TEMPLATE',
        text: clean(schemaEvent.name) || document.title.replace(/\s*\|.*$/, ''),
        dates: `${start}/${end}`,
        details: clean(schemaEvent.url) || document.location.href,
        trp: 'false',
        sprop: 'http://dou.ua',
      });
      params.append('sprop', 'name:DOU');
      if (location) params.set('location', location);

      return `https://www.google.com/calendar/event?${params.toString()}`;
    };

    const calendarLink = [...document.querySelectorAll('a.b-plus-calendar.__google[href], a[href]')]
      .map((link) => ({
        text: clean(link.innerText),
        href: absolutize(link.getAttribute('href')),
      }))
      .find((link) =>
        link.href.includes('google.com/calendar/event?action=TEMPLATE') ||
        /google calendar/i.test(link.text) ||
        link.href.includes('google.com/calendar/event') ||
        link.href.includes('calendar.google.com/calendar/render'),
      )?.href || '';
    const schemaEvent = parseSchemaEvent();
    const pageDetails = parsePageDetails();

    const tags = [...document.querySelectorAll('a[href*="/calendar/tags/"], .tag')]
      .map((tag) => clean(tag.innerText))
      .filter(Boolean);
    const description =
      clean(document.querySelector('.b-typo')?.innerText) ||
      clean(document.querySelector('meta[property="og:description"]')?.getAttribute('content')) ||
      clean([...document.querySelectorAll('article p, main p, p')]
        .map((node) => node.innerText)
        .filter(Boolean)
        .slice(0, 4)
        .join('\n\n'));
    const whenAndWhere = parseWhenAndWhere();
    const visibleText = clean(document.body.innerText);

    return {
      visibleText,
      calendar: calendarLink || buildDouCalendarLink(schemaEvent, pageDetails),
      tags,
      description,
      date: whenAndWhere.date,
      location: whenAndWhere.location || pageDetails.place,
      payment: whenAndWhere.payment,
    };
  });

  await page.close();
  return detail;
}

async function scrapeDouCalendar(browser, page, source) {
  const queuedUrls = new Set([canonicalUrl(page.url())]);
  const visitedUrls = new Set();
  const queue = [page.url()];
  const visibleTextParts = [];
  const allLinks = [];
  const allListEvents = [];

  while (queue.length && visitedUrls.size < douMaxPages) {
    const url = queue.shift();
    const canonicalPageUrl = canonicalUrl(url);
    if (visitedUrls.has(canonicalPageUrl)) continue;

    const currentPage = visitedUrls.size === 0 ? page : await browser.newPage({ viewport: { width: 1440, height: 1400 } });
    if (visitedUrls.size > 0) {
      await currentPage.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
      await currentPage.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {});
    }

    visitedUrls.add(canonicalPageUrl);

    const [pageData, listEvents, discoveredPages] = await Promise.all([
      scrapeVisibleTextAndLinks(currentPage),
      scrapeDouCalendarList(currentPage),
      discoverDouCalendarPageUrls(currentPage, source.url),
    ]);

    visibleTextParts.push(`PAGE: ${currentPage.url()}\n${cleanText(pageData.visibleText)}`);
    allLinks.push(...pageData.links);
    allListEvents.push(...listEvents);

    for (const discovered of discoveredPages.sort((a, b) => a.pageNumber - b.pageNumber)) {
      const canonicalDiscoveredUrl = canonicalUrl(discovered.url);
      if (queuedUrls.has(canonicalDiscoveredUrl) || visitedUrls.has(canonicalDiscoveredUrl)) continue;
      queuedUrls.add(canonicalDiscoveredUrl);
      queue.push(discovered.url);
    }

    if (currentPage !== page) {
      await currentPage.close();
    }
  }

  const listEvents = mergeDouEvents(allListEvents);
  const cache = await readDouDetailsCache();
  let cacheChanged = false;
  const enrichedEvents = [];

  for (const event of listEvents) {
    const cacheKey = douDetailCacheKey(event);
    const legacyCacheKey = legacyDouDetailCacheKey(event);
    let detail = cache.entries[cacheKey] || cache.entries[legacyCacheKey];

    if (!detail || !detail.calendar || /T000000%2F\d{8}T235959/.test(detail.calendar)) {
      detail = {
        ...(await scrapeDouEventDetails(browser, event)),
        title: event.title,
        date: event.date,
        link: event.link,
        cacheKey,
        scrapedAt: new Date().toISOString(),
      };
      cache.entries[cacheKey] = detail;
      cacheChanged = true;
    } else if (!cache.entries[cacheKey]) {
      cache.entries[cacheKey] = detail;
      cacheChanged = true;
    }

    const detailText = cleanText(detail.visibleText);
    const tags = uniqueStrings([
      ...(source.tags || []),
      ...(event.tags || []),
      ...(detail.tags || []),
      ...tagsFromKeywords(detailText),
    ]);

    enrichedEvents.push({
      ...event,
      date: cleanText(detail.date) || event.date,
      description: cleanText(detail.description) || event.description,
      location: cleanText(detail.location) || event.location,
      payment: cleanText(detail.payment) || event.payment,
      calendar: cleanText(detail.calendar) || null,
      tags,
      text: cleanText([event.text, detailText].filter(Boolean).join('\n\n--- DETAIL PAGE ---\n\n')),
      detailCacheKey: cacheKey,
      detailScrapedAt: detail.scrapedAt || null,
    });
  }

  if (cacheChanged) {
    await writeDouDetailsCache(cache);
  }

  return {
    visibleText: visibleTextParts.join('\n\n--- DOU PAGE ---\n\n'),
    links: uniqueLinks(allLinks),
    rawEvents: enrichedEvents,
    pageCount: visitedUrls.size,
  };
}

export async function scrape({ browser, page, source }) {
  const result = await scrapeDouCalendar(browser, page, source);
  return {
    visibleText: result.visibleText,
    links: result.links,
    rawEvents: result.rawEvents,
    metadata: { pageCount: result.pageCount },
  };
}
