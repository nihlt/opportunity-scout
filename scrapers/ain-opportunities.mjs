import { scrapeAinOpportunities } from '../lib/scraper-runtime.mjs';

export async function scrape({ browser, page }) {
  const result = await scrapeAinOpportunities(browser, page);
  return {
    visibleText: result.visibleText,
    links: result.links,
    rawEvents: result.rawEvents,
    metadata: { articleCount: result.articleCount },
  };
}
