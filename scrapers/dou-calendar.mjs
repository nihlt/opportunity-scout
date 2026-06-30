import { scrapeDouCalendar } from '../lib/scraper-runtime.mjs';

export async function scrape({ browser, page, source }) {
  const result = await scrapeDouCalendar(browser, page, source);
  return {
    visibleText: result.visibleText,
    links: result.links,
    rawEvents: result.rawEvents,
    metadata: { pageCount: result.pageCount },
  };
}
