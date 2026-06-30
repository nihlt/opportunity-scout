import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const defaultTemplatePath = path.join(repoRoot, 'config', 'user-template.json');
const usersDir = path.join(repoRoot, 'data', 'users');
const paymentModes = new Set(['free-or-free-tier', 'all']);

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'));
}

function sanitizeChatId(chatId) {
  const value = String(chatId ?? '').trim();
  if (!value) throw new Error('Missing chat id for user config');
  if (!/^[A-Za-z0-9_.:-]+$/.test(value)) {
    throw new Error('Chat id contains unsupported characters');
  }
  return value;
}

function asStringArray(value, fallback) {
  if (!Array.isArray(value)) return [...fallback];
  return value.filter((item) => typeof item === 'string' && item.trim()).map((item) => item.trim());
}

export function userConfigPath(chatId) {
  return path.join(usersDir, sanitizeChatId(chatId), 'config.json');
}

export function userDirectory(chatId) {
  return path.join(usersDir, sanitizeChatId(chatId));
}

export function validateUserConfig(rawConfig, template) {
  const config = rawConfig && typeof rawConfig === 'object' ? rawConfig : {};
  const paymentMode = typeof config.paymentMode === 'string' ? config.paymentMode : template.paymentMode;

  return {
    enabledSources: asStringArray(config.enabledSources, template.enabledSources || []),
    includeTags: asStringArray(config.includeTags, template.includeTags || []),
    excludeTags: asStringArray(config.excludeTags, template.excludeTags || []),
    paymentMode: paymentModes.has(paymentMode) ? paymentMode : template.paymentMode,
  };
}

export async function loadUserConfig({ chatId, configPath = null, templatePath = defaultTemplatePath } = {}) {
  const template = validateUserConfig(await readJson(templatePath), {
    enabledSources: [],
    includeTags: [],
    excludeTags: [],
    paymentMode: 'free-or-free-tier',
  });

  if (configPath) {
    return {
      config: validateUserConfig(await readJson(configPath), template),
      path: configPath,
      created: false,
    };
  }

  const filePath = userConfigPath(chatId);
  try {
    return {
      config: validateUserConfig(await readJson(filePath), template),
      path: filePath,
      created: false,
    };
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }

  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(template, null, 2) + '\n', 'utf8');
  return { config: template, path: filePath, created: true };
}
