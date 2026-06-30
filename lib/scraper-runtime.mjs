import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const tagKeywordsPath = path.join(repoRoot, 'data', 'tag-keywords.json');
const locationKeywordsPath = path.join(repoRoot, 'data', 'location-keywords.json');

let tagKeywordRules = [];
let locationKeywordRules = [];

export function cleanText(value) {
  return String(value ?? '')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function uniqueStrings(values) {
  return [...new Set(values.map(cleanText).filter(Boolean))];
}

export function hashText(value) {
  return createHash('sha256').update(cleanText(value), 'utf8').digest('hex').slice(0, 24);
}

export function canonicalUrl(value) {
  try {
    const url = new URL(value);
    url.hash = '';
    url.search = '';
    if (!url.pathname.endsWith('/')) url.pathname += '/';
    return url.href;
  } catch {
    return cleanText(value);
  }
}

function keywordRegex(keyword) {
  const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (/^[a-z0-9 .+-]+$/i.test(keyword)) {
    return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, 'i');
  }
  return new RegExp(escaped, 'i');
}

function tokenRegex(token) {
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?<![\\p{L}\\p{N}_])${escaped}(?![\\p{L}\\p{N}_])`, 'iu');
}

function compileRulePatterns(rule) {
  const tokenPatterns = (rule.tokens || []).map(tokenRegex);
  const rawPatterns = (rule.patterns || []).map((pattern) => new RegExp(pattern, 'iu'));
  const combined = [...tokenPatterns, ...rawPatterns];
  if (combined.length) return combined;
  return (rule.keywords || []).map(keywordRegex);
}

export function tagsFromKeywords(text) {
  return tagKeywordRules
    .filter((rule) => rule.patterns.some((pattern) => pattern.test(text)))
    .map((rule) => rule.tag);
}

function locationsFromKeywords(text) {
  return locationKeywordRules
    .filter((rule) => rule.keywords.some((keyword) => keywordRegex(keyword).test(text)))
    .map((rule) => rule.location);
}

export async function loadKeywordRules() {
  tagKeywordRules = JSON.parse(await readFile(tagKeywordsPath, 'utf8')).map((rule) => ({
    ...rule,
    patterns: compileRulePatterns(rule),
  }));
  locationKeywordRules = JSON.parse(await readFile(locationKeywordsPath, 'utf8'));
}

export async function readJson(filePath, fallback) {
  try {
    return JSON.parse(await readFile(filePath, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return fallback;
    throw error;
  }
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

export function normalizeEvent(raw, options = {}) {
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

export async function scrapeVisibleTextAndLinks(page) {
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
