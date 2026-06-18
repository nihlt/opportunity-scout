process.argv = [process.argv[0], new URL('./scrape-sources.mjs', import.meta.url).pathname, 'dou-ai'];
await import('./scrape-sources.mjs');
