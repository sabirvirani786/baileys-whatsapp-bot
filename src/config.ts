import fs from 'fs';
import dotenv from 'dotenv';
import type { BotConfig } from './types.js';

dotenv.config();

const CONFIG_PATH = 'config.json';

const DEFAULTS: BotConfig = {
  bot: {
    autoReply: true,
    replyOnlyInPrivateChats: true,
    minDelaySeconds: 5,
    maxDelaySeconds: 15,
    typingIndicator: true,
    typingDelayPerCharMs: 30,
    maxRepliesPerHour: 25,
    maxGlobalMessagesPerHour: 25,
  },
  webhook: { enabled: false, url: '', secret: '' },
  session: { active: 'default' },
};

let config: BotConfig = structuredClone(DEFAULTS);

function load(): BotConfig {
  try {
    const parsed = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    config = {
      bot: { ...DEFAULTS.bot, ...parsed.bot },
      webhook: { ...DEFAULTS.webhook, ...parsed.webhook },
      session: { active: 'default', ...parsed.session },
    };
  } catch {
    config = structuredClone(DEFAULTS);
  }
  return config;
}

load();

export function getConfig(): BotConfig {
  return config;
}

export function initConfigWatcher(): void {
  fs.watchFile(CONFIG_PATH, () => load());
}

export const env = {
  KHARCHIFY_API_KEY: process.env.KHARCHIFY_API_KEY ?? '',
  SUPABASE_URL: process.env.SUPABASE_URL ?? '',
  SUPABASE_KEY: process.env.SUPABASE_KEY ?? '',
  DAILY_POST_GROUPS: (process.env.DAILY_POST_GROUPS ?? '').split(',').filter(Boolean),
  DAILY_POST_HOUR: parseInt(process.env.DAILY_POST_HOUR ?? '19', 10),
  DAILY_POST_MINUTE: parseInt(process.env.DAILY_POST_MINUTE ?? '35', 10),
  PRICE_ADJUSTMENT_PCT: parseFloat(process.env.PRICE_ADJUSTMENT_PERCENT ?? '20'),
};
