import { scrapeVisibleTextAndLinks } from '../lib/scraper-runtime.mjs';

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

export async function scrape({ page }) {
  const pageData = await scrapeVisibleTextAndLinks(page);
  return {
    visibleText: pageData.visibleText,
    links: pageData.links,
    rawEvents: await scrapeKseNews(page),
    metadata: {},
  };
}
