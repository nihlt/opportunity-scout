import { chromium } from 'playwright';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const materialsDir = path.join(repoRoot, 'materials');
const registryPath = path.join(materialsDir, 'sources-registry.json');
const douDetailsCachePath = path.join(materialsDir, 'dou-event-details-cache.json');
const tagKeywordsPath = path.join(repoRoot, 'data', 'tag-keywords.json');
const locationKeywordsPath = path.join(repoRoot, 'data', 'location-keywords.json');

const sources = [
  {
    id: 'dou-ai',
    name: 'DOU Calendar: AI',
    type: 'dou-calendar',
    url: 'https://dou.ua/calendar/tags/AI/',
    filesPrefix: 'dou-ai',
    tags: ['AI'],
  },
  {
    id: 'dou-competitions',
    name: 'DOU Calendar: змагання',
    type: 'dou-calendar',
    url: 'https://dou.ua/calendar/tags/%D0%B7%D0%BC%D0%B0%D0%B3%D0%B0%D0%BD%D0%BD%D1%8F/',
    filesPrefix: 'dou-competitions',
    tags: ['змагання'],
  },
  {
    id: 'dou-hackathons',
    name: 'DOU Calendar: хакатон',
    type: 'dou-calendar',
    url: 'https://dou.ua/calendar/tags/%D1%85%D0%B0%D0%BA%D0%B0%D1%82%D0%BE%D0%BD/',
    filesPrefix: 'dou-hackathons',
    tags: ['хакатон'],
  },
  {
    id: 'kse-university-news',
    name: 'KSE University News',
    type: 'kse-news',
    url: 'https://university.kse.ua/university-news',
    filesPrefix: 'kse-university-news',
  },
  {
    id: 'ain-opportunities-week',
    name: 'AIN: Можливості тижня',
    type: 'ain-opportunities',
    url: 'https://ain.ua/search/?q=%22%D0%BC%D0%BE%D0%B6%D0%BB%D0%B8%D0%B2%D0%BE%D1%81%D1%82%D1%96+%D1%82%D0%B8%D0%B6%D0%BD%D1%8F%22',
    filesPrefix: 'ain-opportunities-week',
  },
  {
    id: 'kaggle-competitions',
    name: 'Kaggle Competitions',
    type: 'kaggle-competitions',
    url: 'https://www.kaggle.com/competitions?listOption=active%5C&participationFilter=open&hostSegmentIdFilter=1',
    filesPrefix: 'kaggle-competitions',
  },
];

let tagKeywordRules = [];
let locationKeywordRules = [];

function cleanText(value) {
  return String(value ?? '')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function uniqueStrings(values) {
  return [...new Set(values.map(cleanText).filter(Boolean))];
}

function hashText(value) {
  return createHash('sha256').update(cleanText(value), 'utf8').digest('hex').slice(0, 24);
}

function douDetailCacheKey(event) {
  return hashText([event.title, event.date].map(cleanText).join('\n'));
}

function keywordRegex(keyword) {
  const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (/^[a-z0-9 .+-]+$/i.test(keyword)) {
    return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, 'i');
  }
  return new RegExp(escaped, 'i');
}

function compileRulePatterns(rule) {
  if (rule.patterns) {
    return rule.patterns.map((pattern) => new RegExp(pattern, 'iu'));
  }
  return (rule.keywords || []).map(keywordRegex);
}

function tagsFromKeywords(text) {
  return tagKeywordRules
    .filter((rule) => rule.patterns.some((pattern) => pattern.test(text)))
    .map((rule) => rule.tag);
}

function locationsFromKeywords(text) {
  return locationKeywordRules
    .filter((rule) => rule.keywords.some((keyword) => keywordRegex(keyword).test(text)))
    .map((rule) => rule.location);
}

async function loadKeywordRules() {
  tagKeywordRules = JSON.parse(await readFile(tagKeywordsPath, 'utf8')).map((rule) => ({
    ...rule,
    patterns: compileRulePatterns(rule),
  }));
  locationKeywordRules = JSON.parse(await readFile(locationKeywordsPath, 'utf8'));
}

async function readJson(filePath, fallback) {
  try {
    return JSON.parse(await readFile(filePath, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return fallback;
    throw error;
  }
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

function parsePayment(text) {
  const lower = text.toLowerCase();
  const lines = text.split('\n').map(cleanText).filter(Boolean);
  const priceLine = lines.find((line) =>
    /(\$|€|₴|грн|uah|usd|eur|безкоштов|безоплат|free|оплат|варт|донат)/i.test(line),
  );

  if (/безкоштов|безоплат|free/.test(lower)) {
    return priceLine || 'безкоштовно';
  }

  return priceLine || null;
}

function parseKagglePayment(value) {
  const text = cleanText(value);
  const match = text.match(/(?:[$€£¥₹]\s?\d[\d,]*(?:\.\d+)?|\d[\d,]*(?:\.\d+)?\s?(?:USD|EUR|GBP|JPY|INR|UAH))/i);
  return match?.[0] || null;
}

function cleanKaggleDeadline(value) {
  const text = cleanText(value).replace(/^Deadline:\s*/i, '');
  return text.replace(/\s+GMT[+-]\d+$/i, '').trim() || null;
}

function isKaggleNonCashAwardLine(value) {
  return /^(knowledge|kudos|swag|medals?|points?)$/i.test(cleanText(value));
}

const ukrainianMonths = new Map([
  ['січня', 1],
  ['лютого', 2],
  ['березня', 3],
  ['квітня', 4],
  ['травня', 5],
  ['червня', 6],
  ['липня', 7],
  ['серпня', 8],
  ['вересня', 9],
  ['жовтня', 10],
  ['листопада', 11],
  ['грудня', 12],
]);

const englishMonths = new Map([
  ['jan', 1],
  ['january', 1],
  ['feb', 2],
  ['february', 2],
  ['mar', 3],
  ['march', 3],
  ['apr', 4],
  ['april', 4],
  ['may', 5],
  ['jun', 6],
  ['june', 6],
  ['jul', 7],
  ['july', 7],
  ['aug', 8],
  ['august', 8],
  ['sep', 9],
  ['sept', 9],
  ['september', 9],
  ['oct', 10],
  ['october', 10],
  ['nov', 11],
  ['november', 11],
  ['dec', 12],
  ['december', 12],
]);

function pad2(value) {
  return String(value).padStart(2, '0');
}

function dateOnly(year, month, day) {
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

function parseMeridiemTime(hourText, minuteText, secondText, meridiem) {
  let hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText || 0);

  if (/pm/i.test(meridiem) && hour !== 12) hour += 12;
  if (/am/i.test(meridiem) && hour === 12) hour = 0;

  return `${pad2(hour)}:${pad2(minute)}:${pad2(second)}`;
}

function normalizeDateFields(rawDate, { scrapedAt } = {}) {
  const date = cleanText(rawDate);
  if (!date) {
    return { dateNormalized: null, dateEndNormalized: null, datePrecision: 'unknown' };
  }

  const scrapedYear = scrapedAt ? new Date(scrapedAt).getUTCFullYear() : new Date().getUTCFullYear();

  const kaggleMatch = date.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4}),\s*(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)$/i);
  if (kaggleMatch) {
    const [, month, day, year, hour, minute, second, meridiem] = kaggleMatch;
    return {
      dateNormalized: `${dateOnly(Number(year), Number(month), Number(day))}T${parseMeridiemTime(hour, minute, second, meridiem)}`,
      dateEndNormalized: null,
      datePrecision: 'datetime',
    };
  }

  const ukrainianRangeMatch = date.match(/^(\d{1,2})\s*[—-]\s*(\d{1,2})\s+(січня|лютого|березня|квітня|травня|червня|липня|серпня|вересня|жовтня|листопада|грудня)(?:\s+(\d{4})\s+року)?$/i);
  if (ukrainianRangeMatch) {
    const [, startDay, endDay, monthText, yearText] = ukrainianRangeMatch;
    const year = Number(yearText || scrapedYear);
    const month = ukrainianMonths.get(monthText.toLowerCase());
    return {
      dateNormalized: dateOnly(year, month, Number(startDay)),
      dateEndNormalized: dateOnly(year, month, Number(endDay)),
      datePrecision: 'date_range',
    };
  }

  const ukrainianDateMatch = date.match(/^(\d{1,2})\s+(січня|лютого|березня|квітня|травня|червня|липня|серпня|вересня|жовтня|листопада|грудня)(?:\s+(\d{4})\s+року)?$/i);
  if (ukrainianDateMatch) {
    const [, day, monthText, yearText] = ukrainianDateMatch;
    const year = Number(yearText || scrapedYear);
    const month = ukrainianMonths.get(monthText.toLowerCase());
    return {
      dateNormalized: dateOnly(year, month, Number(day)),
      dateEndNormalized: null,
      datePrecision: 'date',
    };
  }

  const englishShortDateMatch = date.match(/^(\d{1,2})\s+([A-Z][a-z]+)\s+(\d{4})$/);
  if (englishShortDateMatch) {
    const [, day, monthText, year] = englishShortDateMatch;
    const month = englishMonths.get(monthText.toLowerCase());
    if (month) {
      return {
        dateNormalized: dateOnly(Number(year), month, Number(day)),
        dateEndNormalized: null,
        datePrecision: 'date',
      };
    }
  }

  const englishMonthRangeMatch = date.match(/^([A-Z][a-z]+)\s+(\d{1,2})\s*[—-]\s*(\d{1,2}),\s*(\d{4})$/);
  if (englishMonthRangeMatch) {
    const [, monthText, startDay, endDay, year] = englishMonthRangeMatch;
    const month = englishMonths.get(monthText.toLowerCase());
    if (month) {
      return {
        dateNormalized: dateOnly(Number(year), month, Number(startDay)),
        dateEndNormalized: dateOnly(Number(year), month, Number(endDay)),
        datePrecision: 'date_range',
      };
    }
  }

  return { dateNormalized: null, dateEndNormalized: null, datePrecision: 'unknown' };
}

function extractDateFromText(text) {
  const lines = text.split('\n').map(cleanText).filter(Boolean);
  const datePattern =
    /(\d{1,2}(?:\s*[—-]\s*\d{1,2})?\s+(?:січня|лютого|березня|квітня|травня|червня|липня|серпня|вересня|жовтня|листопада|грудня)(?:\s+\d{4}\s+року)?|\d{1,2}\s+[A-Z][a-z]{2}\s+\d{4}|\d{1,2}[./]\d{1,2}(?:[./]\d{2,4})?|\b(?:сьогодні|завтра)\b)/i;
  const dateLine = lines.find((line) => datePattern.test(line));
  return dateLine?.match(datePattern)?.[0] || null;
}

function pickLocation(text) {
  const configuredLocations = locationsFromKeywords(text);
  if (configuredLocations.length) return configuredLocations.join(', ');

  const lines = text.split('\n').map(cleanText).filter(Boolean);
  const locationLine = lines.find((line) =>
    /(online|онлайн|offline|офлайн|kyiv|київ|lviv|львів|warsaw|варшава|ukraine|україна|remote|віддалено|zoom|meet|google meet)/i.test(line),
  );
  return locationLine || null;
}

function descriptionFromText(text, title) {
  const lines = text
    .split('\n')
    .map(cleanText)
    .filter(Boolean)
    .filter((line) => line !== title);

  const useful = lines.filter((line) =>
    line.length > 35 &&
    !/^(\d{1,2}|сьогодні|завтра)\b/i.test(line) &&
    !/^(додати|поділитися|коментарі|зареєструватися)$/i.test(line),
  );

  return useful.slice(0, 3).join(' ') || null;
}

function normalizeEvent(raw, options = {}) {
  const inferDetails = options.inferDetails ?? true;
  const inferPayment = options.inferPayment ?? inferDetails;
  const forcedPayment = Object.hasOwn(raw, 'payment') ? cleanText(raw.payment) : '';
  const text = cleanText(raw.text);
  const title = cleanText(raw.title);
  const date = cleanText(raw.date) || extractDateFromText(text);
  const normalizedDate = normalizeDateFields(date, { scrapedAt: options.scrapedAt });
  const description = cleanText(raw.description) || descriptionFromText(text, title);
  const searchableText = [title, description].filter(Boolean).join('\n');
  const location = cleanText(raw.location) || (inferDetails ? pickLocation(searchableText) : null);
  const payment = forcedPayment || (inferPayment ? parsePayment(text) : null);
  const tags = uniqueStrings([...(raw.tags || []), ...tagsFromKeywords(searchableText)]);

  return {
    title,
    link: raw.link || null,
    calendar: cleanText(raw.calendar) || null,
    date: date || null,
    ...normalizedDate,
    description: description || null,
    location: location || null,
    payment: payment || null,
    tags,
  };
}

async function scrapeVisibleTextAndLinks(page) {
  return page.evaluate(() => {
    const absolutize = (href) => {
      try {
        return new URL(href, document.location.href).href;
      } catch {
        return href;
      }
    };

    return {
      visibleText: document.body.innerText,
      links: [...document.querySelectorAll('a[href]')]
        .map((link) => ({
          text: link.innerText.trim().replace(/\s+/g, ' '),
          href: absolutize(link.getAttribute('href')),
        }))
        .filter((link) => link.text || link.href),
    };
  });
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
  const listEvents = await scrapeDouCalendarList(page);
  const cache = await readDouDetailsCache();
  let cacheChanged = false;
  const enrichedEvents = [];

  for (const event of listEvents) {
    const cacheKey = douDetailCacheKey(event);
    let detail = cache.entries[cacheKey];

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

  return enrichedEvents;
}

async function scrapeKseNews(page) {
  return page.evaluate(() => {
    const absolutize = (href) => {
      try {
        return new URL(href, document.location.href).href;
      } catch {
        return href;
      }
    };

    const seen = new Set();
    const events = [];

    for (const node of document.querySelectorAll('article.article_3aa, article')) {
      const text = node.innerText?.trim();
      if (!text || text.length < 40) continue;

      const titleLink =
        node.querySelector('h1 a, h2 a, h3 a, .article__title_kCs a, a[href*="/university-news/"]') ||
        node.querySelector('a[href]');
      const title =
        titleLink?.innerText?.trim() ||
        node.querySelector('h1, h2, h3, .article__title_kCs')?.innerText?.trim();
      const href = titleLink?.getAttribute('href');
      const link = href ? absolutize(href) : null;
      const date =
        node.querySelector('time')?.getAttribute('datetime') ||
        node.querySelector('time, .article__date_2SL, [class*="date"]')?.innerText?.trim() ||
        text.split('\n').map((line) => line.trim()).find((line) => /^\d{1,2}\s+[A-Z][a-z]{2}\s+\d{4}$/.test(line)) ||
        '';

      if (!title || !link || !link.includes('/university-news/')) continue;
      const key = `${title}|${link}`;
      if (seen.has(key)) continue;
      seen.add(key);

      events.push({
        title,
        link,
        date,
        description: node.querySelector('.article__description_1Pk, p')?.innerText?.trim() || '',
        location: '',
        payment: '',
        tags: ['KSE', 'news'],
        text,
      });
    }

    return events;
  });
}

async function getAinSearchArticles(page) {
  return page.evaluate(() => {
    const seen = new Set();
    const articles = [];

    for (const link of document.querySelectorAll('a[href]')) {
      const text = link.innerText.trim().replace(/\s+/g, ' ');
      const href = link.href;
      if (!text.toLowerCase().includes('можливості тижня')) continue;
      if (!href.startsWith('https://ain.ua/20')) continue;
      if (seen.has(href)) continue;
      seen.add(href);
      articles.push({ title: text, url: href });
    }

    return articles;
  });
}

async function scrapeAinArticle(browser, article) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 2000 } });
  await page.goto(article.url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {});

  const data = await page.evaluate((sourceArticle) => {
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
    const isArticleInternalLink = (href) =>
      href.includes('/author/') ||
      href.includes('/tag/') ||
      href.includes('/business/') ||
      href.includes('/technology/') ||
      href.includes('/startups/') ||
      href.includes('facebook.com/sharer') ||
      href.includes('twitter.com/intent');
    const isDetailLink = (link) => {
      const linkText = link.innerText.trim().toLowerCase();
      const parentText = link.parentElement?.innerText?.trim().toLowerCase() || '';
      return /посилан/.test(linkText) || /детал(і|ьніше).*посилан/.test(parentText);
    };

    const articleRoot =
      document.querySelector('.post-content') ||
      document.querySelector('.article-content__wrapper') ||
      document.querySelector('.article-main') ||
      document.querySelector('article') ||
      document.querySelector('main') ||
      document.body;
    const articleTitle =
      document.querySelector('article h1, h1')?.innerText?.trim() ||
      sourceArticle.title ||
      document.title;
    const articleText = articleRoot.innerText;
    const articleLinks = [...articleRoot.querySelectorAll('a[href]')]
      .map((link) => ({
        text: clean(link.innerText),
        href: absolutize(link.getAttribute('href')),
      }))
      .filter((link) => link.href && !isArticleInternalLink(link.href));

    const events = [];
    const headings = [...articleRoot.querySelectorAll('h2')];

    for (const heading of headings) {
      const title = clean(heading.innerText);
      if (!title || title.endsWith(':')) continue;

      const nodes = [];
      let current = heading.nextElementSibling;
      while (current) {
        if (current.tagName === 'H2' && !current.innerText.trim().endsWith(':')) break;
        nodes.push(current);
        current = current.nextElementSibling;
      }

      const sectionText = clean(nodes.map((node) => node.innerText).filter(Boolean).join('\n\n'));
      if (sectionText.length < 50) continue;

      const detailLinkElement =
        nodes.flatMap((node) => [...node.querySelectorAll('a[href]')]).find(isDetailLink) ||
        nodes.flatMap((node) => [...node.querySelectorAll('a[href]')]).find((link) => {
          const href = absolutize(link.getAttribute('href'));
          return href && !href.includes('ain.ua') && !isArticleInternalLink(href);
        });
      const detailHref = detailLinkElement?.getAttribute('href');
      const detailLink = detailHref ? absolutize(detailHref) : sourceArticle.url;

      const description = clean(
        sectionText
          .replace(/Детал(і|ьніше)( про програму та як на неї податися)?\s+—\s+за посиланням\.?/gi, '')
          .replace(/Деталі\s+—\s+за посиланням\.?/gi, '')
          .replace(/Детальніше\s+—\s+за посиланням\.?/gi, ''),
      )
        .split(/\n+Читайте також:/i)[0]
        .trim();

      events.push({
        title,
        link: detailLink,
        date: '',
        description,
        location: '',
        payment: '',
        tags: ['news'],
        text: `${title}\n${sectionText}`,
        sourceArticleTitle: articleTitle,
        sourceArticleUrl: sourceArticle.url,
      });
    }

    return {
      articleTitle,
      articleUrl: sourceArticle.url,
      visibleText: articleText,
      links: articleLinks,
      events,
    };
  }, article);

  await page.close();
  return data;
}

async function scrapeAinOpportunities(browser, searchPage) {
  const searchData = await scrapeVisibleTextAndLinks(searchPage);
  const articles = await getAinSearchArticles(searchPage);
  const articleResults = [];

  for (const article of articles) {
    articleResults.push(await scrapeAinArticle(browser, article));
  }

  const visibleText = [
    `SEARCH PAGE: ${searchPage.url()}`,
    cleanText(searchData.visibleText),
    ...articleResults.map((article) =>
      [
        `ARTICLE: ${article.articleTitle}`,
        `URL: ${article.articleUrl}`,
        cleanText(article.visibleText),
      ].join('\n'),
    ),
  ].join('\n\n---\n\n');

  const links = [
    ...searchData.links.map((link) => ({ ...link, context: 'search' })),
    ...articles.map((article) => ({
      text: article.title,
      href: article.url,
      context: 'search-result',
    })),
    ...articleResults.flatMap((article) =>
      article.links.map((link) => ({
        ...link,
        context: 'article',
        sourceArticleTitle: article.articleTitle,
        sourceArticleUrl: article.articleUrl,
      })),
    ),
  ];

  const events = articleResults.flatMap((article) => article.events);
  return { visibleText, links, rawEvents: events, articleCount: articleResults.length };
}

async function scrapeKaggleCompetitions(page) {
  const pageData = await scrapeVisibleTextAndLinks(page);
  const items = page.locator('li[aria-label$="List Item"]').filter({ has: page.locator('a[href*="/competitions/"]') });
  const count = await items.count();
  const rawEvents = [];

  for (let index = 0; index < count; index += 1) {
    const item = items.nth(index);
    const text = cleanText(await item.innerText({ timeout: 10_000 }).catch(() => ''));
    if (!text) continue;

    const linkLocator = item.locator('a[href*="/competitions/"]').first();
    const href = await linkLocator.getAttribute('href').catch(() => null);
    const titleFromAria = await linkLocator.getAttribute('aria-label').catch(() => null);
    const link = href ? new URL(href, page.url()).href : null;
    const lines = text.split('\n').map(cleanText).filter(Boolean);
    const title = cleanText(titleFromAria) || lines[0] || '';
    const metaLine = lines.find((line) => /Teams|to go|ago|Competition|Featured/i.test(line)) || '';
    const payment = parseKagglePayment(lines.find((line) => parseKagglePayment(line)) || '');
    const description = lines
      .filter((line) => line !== title)
      .filter((line) => line !== metaLine)
      .filter((line) => line !== payment)
      .filter((line) => !isKaggleNonCashAwardLine(line))
      .filter((line) => !/^more_horiz$/i.test(line))
      .join(' ');

    let deadline = null;
    const deadlineTrigger = item.locator('text=/to go|ago/i').last();
    if ((await deadlineTrigger.count()) > 0) {
      await deadlineTrigger.hover({ timeout: 10_000 }).catch(() => {});
      await page.waitForTimeout(250);
      const tooltipText = await page
        .locator('[role="tooltip"], .MuiTooltip-tooltip')
        .last()
        .innerText({ timeout: 2_000 })
        .catch(() => '');
      deadline = cleanKaggleDeadline(tooltipText);
    }

    rawEvents.push({
      title,
      link,
      date: deadline || '',
      description,
      location: '',
      payment: payment || '',
      tags: ['Kaggle', 'competition'],
      text,
    });
  }

  return {
    visibleText: pageData.visibleText,
    links: pageData.links,
    rawEvents,
  };
}

async function scrapeSource(browser, source) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1400 } });
  await page.goto(source.url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {});
  if (source.type === 'kaggle-competitions') {
    await page.waitForTimeout(5_000);
  }

  let visibleText;
  let links;
  let rawEvents;
  let extraMetadata = {};

  if (source.type === 'ain-opportunities') {
    const ain = await scrapeAinOpportunities(browser, page);
    visibleText = ain.visibleText;
    links = ain.links;
    rawEvents = ain.rawEvents;
    extraMetadata = { articleCount: ain.articleCount };
  } else if (source.type === 'kaggle-competitions') {
    const kaggle = await scrapeKaggleCompetitions(page);
    visibleText = kaggle.visibleText;
    links = kaggle.links;
    rawEvents = kaggle.rawEvents;
  } else {
    const scrapedPage = await scrapeVisibleTextAndLinks(page);
    visibleText = scrapedPage.visibleText;
    links = scrapedPage.links;
    rawEvents = source.type === 'dou-calendar' ? await scrapeDouCalendar(browser, page, source) : await scrapeKseNews(page);
  }

  await page.close();

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
        inferDetails: source.type !== 'kse-news',
        inferPayment:
          source.type !== 'kse-news' &&
          source.type !== 'ain-opportunities' &&
          source.type !== 'kaggle-competitions',
      }),
    )
    .filter((event) => event.title && event.link);

  const output = {
    sourceId: source.id,
    sourceName: source.name,
    sourceUrl: source.url,
    sourceType: source.type,
    scrapedAt,
    sourceFiles: {
      visibleText: relative(filePaths.visibleText),
      links: relative(filePaths.links),
    },
    pageTextCharacters: savedText.length,
    linkCount: savedLinks.length,
    ...extraMetadata,
    events,
  };

  await writeFile(filePaths.events, JSON.stringify(output, null, 2) + '\n', 'utf8');

  return {
    id: source.id,
    name: source.name,
    type: source.type,
    url: source.url,
    files: {
      visibleText: relative(filePaths.visibleText),
      links: relative(filePaths.links),
      events: relative(filePaths.events),
    },
    eventCount: events.length,
    linkCount: savedLinks.length,
    pageTextCharacters: savedText.length,
    ...extraMetadata,
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

async function writeRegistry(entries, { mergeExisting = false } = {}) {
  const entryById = new Map();

  if (mergeExisting) {
    for (const entry of await readExistingRegistryEntries()) {
      entryById.set(entry.id, entry);
    }
  }

  for (const entry of entries) {
    entryById.set(entry.id, entry);
  }

  const finalEntries = sources
    .map((source) => entryById.get(source.id))
    .filter(Boolean);

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

function selectSources() {
  const requested = process.argv.slice(2);
  if (!requested.length || requested.includes('all')) return sources;

  const selected = sources.filter((source) => requested.includes(source.id));
  const missing = requested.filter((id) => !sources.some((source) => source.id === id));
  if (missing.length) {
    throw new Error(`Unknown source id(s): ${missing.join(', ')}`);
  }
  return selected;
}

async function main() {
  await mkdir(materialsDir, { recursive: true });
  await loadKeywordRules();

  const selectedSources = selectSources();
  const browser = await chromium.launch({ headless: true });

  try {
    const registryEntries = [];
    for (const source of selectedSources) {
      console.log(`Scraping ${source.id}: ${source.url}`);
      const entry = await scrapeSource(browser, source);
      registryEntries.push(entry);
      console.log(`Saved ${entry.files.events} (${entry.eventCount})`);
    }
    await writeRegistry(registryEntries, { mergeExisting: selectedSources.length < sources.length });
    console.log(`Saved registry: ${relative(registryPath)}`);
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
