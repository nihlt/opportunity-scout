import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const preferencesPath = path.join(repoRoot, 'data', 'preferences.json');

function parseArgs(argv) {
  const [command, key, score] = argv;
  return { command: command || 'list', key, score };
}

async function readPreferences() {
  try {
    return JSON.parse(await readFile(preferencesPath, 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    return { words: {}, eventFeedback: {}, lastUpdatedAt: null };
  }
}

async function writePreferences(preferences) {
  await mkdir(path.dirname(preferencesPath), { recursive: true });
  await writeFile(preferencesPath, JSON.stringify(preferences, null, 2) + '\n', 'utf8');
}

function printUsage() {
  console.log([
    'Usage:',
    '  npm run prefs -- list',
    '  npm run prefs -- set <word> <score>',
    '  npm run prefs -- delete <word>',
  ].join('\n'));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const preferences = await readPreferences();
  preferences.words ||= {};
  preferences.eventFeedback ||= {};

  if (args.command === 'list') {
    const entries = Object.entries(preferences.words).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    if (!entries.length) {
      console.log('No preference words yet.');
      return;
    }
    for (const [word, score] of entries) {
      console.log(`${word}: ${score}`);
    }
    return;
  }

  if (args.command === 'set') {
    const score = Number(args.score);
    if (!args.key || !Number.isFinite(score)) {
      printUsage();
      process.exitCode = 1;
      return;
    }
    preferences.words[args.key] = score;
    preferences.lastUpdatedAt = new Date().toISOString();
    await writePreferences(preferences);
    console.log(`Set "${args.key}" to ${score}`);
    return;
  }

  if (args.command === 'delete') {
    if (!args.key) {
      printUsage();
      process.exitCode = 1;
      return;
    }
    delete preferences.words[args.key];
    preferences.lastUpdatedAt = new Date().toISOString();
    await writePreferences(preferences);
    console.log(`Deleted "${args.key}"`);
    return;
  }

  printUsage();
  process.exitCode = 1;
}

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
