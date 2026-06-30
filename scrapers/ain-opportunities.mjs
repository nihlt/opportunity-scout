import { cleanText, scrapeVisibleTextAndLinks } from '../lib/scraper-runtime.mjs';

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

export async function scrape({ browser, page }) {
  const result = await scrapeAinOpportunities(browser, page);
  return {
    visibleText: result.visibleText,
    links: result.links,
    rawEvents: result.rawEvents,
    metadata: { articleCount: result.articleCount },
  };
}
