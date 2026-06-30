import { cleanText, scrapeVisibleTextAndLinks } from '../lib/scraper-runtime.mjs';

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

export async function scrape({ page }) {
  const result = await scrapeKaggleCompetitions(page);
  return {
    visibleText: result.visibleText,
    links: result.links,
    rawEvents: result.rawEvents,
    metadata: {},
  };
}
