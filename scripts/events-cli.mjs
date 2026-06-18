import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const eventsJsonlPath = path.join(repoRoot, 'data', 'events.jsonl');

function parseArgs(argv) {
  const args = {
    source: null,
    tag: null,
    search: null,
    limit: 30,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--source') args.source = argv[++index];
    else if (arg === '--tag') args.tag = argv[++index];
    else if (arg === '--search') args.search = argv[++index];
    else if (arg === '--limit') args.limit = Number(argv[++index]);
    else if (arg === '--help' || arg === '-h') args.help = true;
  }

  return args;
}

function usage() {
  return [
    'Usage:',
    '  npm run events -- [--source kaggle-competitions] [--tag AI] [--search internship] [--limit 20]',
    '',
    'Examples:',
    '  npm run events -- --source kaggle-competitions',
    '  npm run events -- --tag AI',
    '  npm run events -- --search internship --limit 10',
  ].join('\n');
}

async function readEvents() {
  const text = await readFile(eventsJsonlPath, 'utf8');
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function matches(event, args) {
  if (args.source && event.sourceId !== args.source) return false;
  if (args.tag && !event.tags.some((tag) => tag.toLowerCase() === args.tag.toLowerCase())) return false;
  if (args.search) {
    const haystack = [event.title, event.description, event.location, event.payment, event.tags.join(' ')]
      .filter(Boolean)
      .join('\n')
      .toLowerCase();
    if (!haystack.includes(args.search.toLowerCase())) return false;
  }
  return true;
}

function printEvent(event) {
  const date = event.dateNormalized || event.date || 'no date';
  const payment = event.payment ? ` | ${event.payment}` : '';
  const tags = event.tags.length ? ` | ${event.tags.join(', ')}` : '';
  console.log(`${date} | ${event.sourceId}${payment}${tags}`);
  console.log(event.title);
  console.log(event.link);
  if (event.description) console.log(event.description.slice(0, 240));
  console.log('');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    return;
  }

  const events = (await readEvents()).filter((event) => matches(event, args)).slice(0, args.limit);
  for (const event of events) printEvent(event);
  console.log(`Shown ${events.length} event(s)`);
}

main().catch((error) => {
  if (error.code === 'ENOENT') {
    console.error('data/events.jsonl not found. Run `npm run normalize` first.');
    process.exitCode = 1;
    return;
  }
  console.error(error);
  process.exitCode = 1;
});
