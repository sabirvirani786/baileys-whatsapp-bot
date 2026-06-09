import axios from 'axios';
import crypto from 'crypto';
import { getConfig } from './config.js';

export async function sendWebhook(event: string, payload: any, retries = 3): Promise<boolean> {
  const cfg = getConfig().webhook;
  if (!cfg?.enabled || !cfg?.url) {
    console.log(`[webhook] Ignored event '${event}' - webhook disabled or no url`);
    return false;
  }

  const full = { event, timestamp: new Date().toISOString(), data: payload };
  const body = JSON.stringify(full);
  const signature = cfg.secret
    ? crypto.createHmac('sha256', cfg.secret).update(body).digest('hex')
    : '';

  console.log(`[webhook] Sending event '${event}' to ${cfg.url}`);
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      await axios.post(cfg.url, full, {
        headers: { 'Content-Type': 'application/json', 'X-Signature': signature, 'X-Event': event },
        timeout: 10_000,
      });
      return true;
    } catch {
      if (attempt >= retries) return false;
      const wait = Math.min(1000 * 2 ** attempt, 5000) + Math.random() * 1000;
      await new Promise((r) => setTimeout(r, wait));
    }
  }
  return false;
}
