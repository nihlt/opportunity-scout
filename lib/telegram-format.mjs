const telegramLimit = 4096;
const safeMessageLimit = 4096;

const ukrainianMonths = [
  'січня', 'лютого', 'березня', 'квітня', 'травня', 'червня',
  'липня', 'серпня', 'вересня', 'жовтня', 'листопада', 'грудня',
];

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function truncate(text, maxLength = 260) {
  if (!text) return '';
  const clean = String(text).replace(/\s+/g, ' ').trim();
  if (clean.length <= maxLength) return clean;
  return `${clean.slice(0, maxLength - 1).trimEnd()}...`;
}

function formatDate(event) {
  if (event.datePrecision === 'date_range' && event.dateNormalized && event.dateEndNormalized) {
    return `${event.dateNormalized} - ${event.dateEndNormalized}`;
  }
  return event.dateNormalized || event.date || '-';
}

export function formatLastUpdate(isoTimestamp) {
  if (!isoTimestamp) return '-';
  const date = new Date(isoTimestamp);
  if (Number.isNaN(date.getTime())) return isoTimestamp;
  const day = date.getUTCDate();
  const month = ukrainianMonths[date.getUTCMonth()];
  const year = date.getUTCFullYear();
  const hours = String(date.getUTCHours()).padStart(2, '0');
  const minutes = String(date.getUTCMinutes()).padStart(2, '0');
  return `${day} ${month} ${year}, ${hours}:${minutes}`;
}

export function formatEventFull(event, index) {
  const lines = [
    `${index}. <a href="${escapeHtml(event.link)}">${escapeHtml(event.title)}</a>${event.calendar ? ` | <a href="${escapeHtml(event.calendar)}">calendar</a>` : ''}`,
    `Date: ${escapeHtml(formatDate(event))}`,
    `Source: ${escapeHtml(event.sourceName || event.sourceId)}`,
  ];

  if (event.tags?.length) lines.push(`Tags: ${escapeHtml(event.tags.join(', '))}`);
  if (event.description) lines.push(escapeHtml(truncate(event.description)));
  return lines.join('\n');
}

export function formatEventCompact(event, index) {
  const calendar = event.calendar
    ? ` | <a href="${escapeHtml(event.calendar)}">calendar</a>`
    : '';
  const lines = [
    `${index}. <a href="${escapeHtml(event.link)}">${escapeHtml(event.title)}</a>${calendar}`,
    `Date: ${escapeHtml(formatDate(event))}`,
    `Source: ${escapeHtml(event.sourceName || event.sourceId)}`,
  ];
  if (event.description) lines.push(escapeHtml(truncate(event.description, 160)));
  return lines.join('\n');
}

export function splitMessages(blocks, { title = null } = {}) {
  const messages = [];
  let current = title ? `${escapeHtml(title)}\n\n` : '';

  for (const block of blocks) {
    if (block.length > telegramLimit) {
      throw new Error(`Formatted block is too long for Telegram`);
    }

    if (current.length + block.length + 2 > safeMessageLimit) {
      if (current.trim()) messages.push(current.trimEnd());
      current = '';
    }
    current += `${block}\n\n`;
  }

  if (current.trim()) messages.push(current.trimEnd());
  return messages;
}
