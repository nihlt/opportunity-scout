import { scrapeKaggleCompetitions } from '../lib/scraper-runtime.mjs';

export async function scrape({ page }) {
  const result = await scrapeKaggleCompetitions(page);
  return {
    visibleText: result.visibleText,
    links: result.links,
    rawEvents: result.rawEvents,
    metadata: {},
  };
}
