import { scrapeKseNews, scrapeVisibleTextAndLinks } from '../lib/scraper-runtime.mjs';

export async function scrape({ page }) {
  const pageData = await scrapeVisibleTextAndLinks(page);
  return {
    visibleText: pageData.visibleText,
    links: pageData.links,
    rawEvents: await scrapeKseNews(page),
    metadata: {},
  };
}
