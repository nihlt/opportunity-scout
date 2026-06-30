import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const eventsPath = path.join(repoRoot, 'data', 'events.jsonl');
const outputPath = path.join(repoRoot, 'review.html');

const sourceColors = [
  { bg: '#fff1f2', border: '#e11d48', ink: '#881337' },
  { bg: '#ecfeff', border: '#0891b2', ink: '#164e63' },
  { bg: '#f0fdf4', border: '#16a34a', ink: '#14532d' },
  { bg: '#fffbeb', border: '#d97706', ink: '#78350f' },
  { bg: '#eef2ff', border: '#4f46e5', ink: '#312e81' },
  { bg: '#fdf4ff', border: '#c026d3', ink: '#701a75' },
  { bg: '#f5f5f4', border: '#57534e', ink: '#292524' },
];

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function attr(value) {
  return escapeHtml(value).replace(/'/g, '&#39;');
}

function cleanText(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function truncate(value, maxLength = 420) {
  const text = cleanText(value);
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 1).trimEnd()}...`;
}

async function readEvents() {
  const text = await readFile(eventsPath, 'utf8');
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function compareEvents(a, b) {
  const dateA = a.dateNormalized || '9999-99-99T99:99:99';
  const dateB = b.dateNormalized || '9999-99-99T99:99:99';
  return dateA.localeCompare(dateB) || cleanText(a.sourceName).localeCompare(cleanText(b.sourceName)) || cleanText(a.title).localeCompare(cleanText(b.title));
}

function formatDate(event) {
  if (event.datePrecision === 'date_range' && event.dateNormalized && event.dateEndNormalized) {
    return `${event.dateNormalized} - ${event.dateEndNormalized}`;
  }
  return event.dateNormalized || event.date || 'unknown';
}

function sourceLinks(event) {
  const ids = Array.isArray(event.sourceIds) && event.sourceIds.length ? event.sourceIds : [event.sourceId];
  const names = Array.isArray(event.sourceNames) && event.sourceNames.length ? event.sourceNames : [event.sourceName || event.sourceId];
  const urls = Array.isArray(event.sourceUrls) && event.sourceUrls.length ? event.sourceUrls : [event.sourceUrl];

  return ids.map((id, index) => ({
    id,
    name: names[index] || id,
    url: urls[index] || event.sourceUrl,
  }));
}

function sourceColorMap(events) {
  const ids = [...new Set(events.flatMap((event) => sourceLinks(event).map((source) => source.id)).filter(Boolean))].sort();
  return new Map(ids.map((id, index) => [id, sourceColors[index % sourceColors.length]]));
}

function renderSourcePill(source, color) {
  const style = `background:${color.bg};border-color:${color.border};color:${color.ink}`;
  const label = escapeHtml(source.name || source.id);
  if (!source.url) return `<span class="source-pill" style="${style}">${label}</span>`;
  return `<a class="source-pill" style="${style}" href="${attr(source.url)}" target="_blank" rel="noopener noreferrer">${label}</a>`;
}

function renderEvent(event, colorMap, index) {
  const sources = sourceLinks(event);
  const primaryColor = colorMap.get(sources[0]?.id) || sourceColors[0];
  const sourcePills = sources.map((source) => renderSourcePill(source, colorMap.get(source.id) || primaryColor)).join('');
  const tags = Array.isArray(event.tags) && event.tags.length
    ? `<div class="tags">${event.tags.map((tag) => `<span>${escapeHtml(tag)}</span>`).join('')}</div>`
    : '';
  const calendar = event.calendar
    ? `<a class="meta-link" href="${attr(event.calendar)}" target="_blank" rel="noopener noreferrer">calendar</a>`
    : '<span class="muted">no calendar link</span>';
  const sourceFile = event.sourceEventFile
    ? `<span class="muted">raw: ${escapeHtml(event.sourceEventFile)} #${escapeHtml(event.sourceEventIndex ?? '')}</span>`
    : '';

  return `
    <article class="event" style="--source-border:${primaryColor.border};--source-bg:${primaryColor.bg}">
      <div class="event-index">${index + 1}</div>
      <div class="event-main">
        <div class="event-topline">
          <div class="date">${escapeHtml(formatDate(event))}</div>
          <div class="sources">${sourcePills}</div>
        </div>
        <h2><a href="${attr(event.link)}" target="_blank" rel="noopener noreferrer">${escapeHtml(event.title || '(untitled)')}</a></h2>
        <div class="meta">
          ${calendar}
          <span>ID: ${escapeHtml(event.id)}</span>
          ${sourceFile}
        </div>
        ${tags}
        ${event.description ? `<p>${escapeHtml(truncate(event.description))}</p>` : ''}
      </div>
    </article>`;
}

function renderLegend(colorMap, events) {
  const counts = new Map();
  for (const event of events) {
    for (const source of sourceLinks(event)) {
      counts.set(source.id, (counts.get(source.id) || 0) + 1);
    }
  }

  return [...colorMap.entries()]
    .map(([id, color]) => {
      const event = events.find((item) => sourceLinks(item).some((source) => source.id === id));
      const source = sourceLinks(event).find((item) => item.id === id);
      return `${renderSourcePill(source, color)} <span class="legend-count">${counts.get(id) || 0}</span>`;
    })
    .join('');
}

async function main() {
  const events = (await readEvents()).sort(compareEvents);
  const colorMap = sourceColorMap(events);
  const generatedAt = new Date().toISOString();
  const datedCount = events.filter((event) => event.dateNormalized).length;
  const unknownDateCount = events.length - datedCount;

  const html = `<!doctype html>
<html lang="uk">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Opps Monitor Review</title>
  <style>
    :root {
      color-scheme: light;
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: #f8fafc;
      color: #111827;
    }
    body {
      margin: 0;
      background: #f8fafc;
    }
    header {
      position: sticky;
      top: 0;
      z-index: 10;
      border-bottom: 1px solid #e5e7eb;
      background: rgba(248, 250, 252, 0.96);
      backdrop-filter: blur(12px);
    }
    .header-inner {
      max-width: 1200px;
      margin: 0 auto;
      padding: 18px 20px 16px;
    }
    h1 {
      margin: 0 0 8px;
      font-size: 24px;
      line-height: 1.2;
      letter-spacing: 0;
    }
    .summary {
      display: flex;
      flex-wrap: wrap;
      gap: 10px 16px;
      color: #4b5563;
      font-size: 14px;
    }
    .legend {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin-top: 14px;
      align-items: center;
    }
    main {
      max-width: 1200px;
      margin: 0 auto;
      padding: 18px 20px 40px;
    }
    .event {
      display: grid;
      grid-template-columns: 46px minmax(0, 1fr);
      gap: 12px;
      border-left: 6px solid var(--source-border);
      border-top: 1px solid #e5e7eb;
      border-right: 1px solid #e5e7eb;
      border-bottom: 1px solid #e5e7eb;
      background: linear-gradient(90deg, var(--source-bg), #ffffff 180px);
      margin-bottom: 10px;
      padding: 14px 16px 14px 10px;
      border-radius: 8px;
    }
    .event-index {
      color: #6b7280;
      font-variant-numeric: tabular-nums;
      text-align: right;
      padding-top: 3px;
      font-size: 13px;
    }
    .event-main {
      min-width: 0;
    }
    .event-topline {
      display: flex;
      flex-wrap: wrap;
      gap: 8px 12px;
      align-items: center;
      margin-bottom: 5px;
    }
    .date {
      font-size: 13px;
      font-weight: 700;
      color: #111827;
      font-variant-numeric: tabular-nums;
    }
    .sources {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
    }
    .source-pill {
      display: inline-flex;
      align-items: center;
      min-height: 24px;
      border: 1px solid;
      border-radius: 999px;
      padding: 3px 9px;
      font-size: 12px;
      font-weight: 700;
      text-decoration: none;
      white-space: nowrap;
    }
    h2 {
      margin: 0 0 7px;
      font-size: 18px;
      line-height: 1.35;
      letter-spacing: 0;
      overflow-wrap: anywhere;
    }
    h2 a {
      color: #0f172a;
      text-decoration-color: #94a3b8;
      text-underline-offset: 3px;
    }
    .meta {
      display: flex;
      flex-wrap: wrap;
      gap: 8px 12px;
      align-items: center;
      color: #6b7280;
      font-size: 12px;
      margin-bottom: 8px;
    }
    .meta-link {
      color: #2563eb;
      font-weight: 700;
      text-decoration: none;
    }
    .tags {
      display: flex;
      flex-wrap: wrap;
      gap: 5px;
      margin: 0 0 8px;
    }
    .tags span {
      background: #f1f5f9;
      border: 1px solid #e2e8f0;
      border-radius: 999px;
      color: #334155;
      font-size: 12px;
      padding: 3px 8px;
    }
    p {
      margin: 0;
      color: #374151;
      font-size: 14px;
      line-height: 1.5;
      overflow-wrap: anywhere;
    }
    .muted {
      color: #6b7280;
    }
    .legend-count {
      margin-left: -4px;
      color: #64748b;
      font-size: 12px;
      font-variant-numeric: tabular-nums;
    }
    @media (max-width: 720px) {
      .event {
        grid-template-columns: 1fr;
        padding-left: 14px;
      }
      .event-index {
        text-align: left;
        padding-top: 0;
      }
      .header-inner,
      main {
        padding-left: 14px;
        padding-right: 14px;
      }
    }
  </style>
</head>
<body>
  <header>
    <div class="header-inner">
      <h1>Opps Monitor Review</h1>
      <div class="summary">
        <span>${events.length} events</span>
        <span>${datedCount} dated</span>
        <span>${unknownDateCount} unknown date</span>
        <span>sorted by date, unknown last</span>
        <span>generated ${escapeHtml(generatedAt)}</span>
      </div>
      <div class="legend">${renderLegend(colorMap, events)}</div>
    </div>
  </header>
  <main>
    ${events.map((event, index) => renderEvent(event, colorMap, index)).join('\n')}
  </main>
</body>
</html>
`;

  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, html, 'utf8');
  console.log(`Wrote ${path.relative(repoRoot, outputPath)} (${events.length} events)`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
