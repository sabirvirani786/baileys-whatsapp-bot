import fs from 'fs';
import { env } from './config.js';
import type { HadeeyaProduct } from './types.js';

const SUPABASE_HEADERS = () => ({
  apikey: env.SUPABASE_KEY,
  Authorization: `Bearer ${env.SUPABASE_KEY}`,
  'Content-Type': 'application/json',
});

const HADEEYA_FILE = 'data/hadeeya-products.json';
const CAT_SENT_FILE = 'data/category-sent.json';

function readJson<T>(p: string, fallback: T): T {
  try {
    if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf-8'));
  } catch { /* ignore */ }
  return fallback;
}

function writeJson(p: string, data: any): void {
  try { fs.writeFileSync(p, JSON.stringify(data)); } catch { /* ignore */ }
}

// ── Category-sent tracking ──

export async function categorySentRecently(jid: string): Promise<boolean> {
  try {
    if (env.SUPABASE_URL && env.SUPABASE_KEY) {
      const { default: axios } = await import('axios');
      const cutoff = new Date(Date.now() - 72 * 3600_000).toISOString();
      const { data } = await axios.get(`${env.SUPABASE_URL}/rest/v1/category_sent`, {
        headers: SUPABASE_HEADERS(),
        params: { jid: `eq.${jid}`, sent_at: `gt.${cutoff}`, select: 'id', limit: 1 },
      });
      if (data?.length > 0) return true;
    }
  } catch { /* fall through to file */ }

  const d = readJson<Record<string, number>>(CAT_SENT_FILE, {});
  const t = d[jid];
  return !!t && Date.now() - t < 72 * 3600_000;
}

export async function markCategorySent(jid: string): Promise<void> {
  try {
    if (env.SUPABASE_URL && env.SUPABASE_KEY) {
      const { default: axios } = await import('axios');
      await axios.post(
        `${env.SUPABASE_URL}/rest/v1/category_sent`,
        { jid, sent_at: new Date().toISOString() },
        { headers: { ...SUPABASE_HEADERS(), Prefer: 'resolution=merge-duplicates' } },
      );
    }
  } catch { /* ignore */ }

  const d = readJson<Record<string, number>>(CAT_SENT_FILE, {});
  d[jid] = Date.now();
  writeJson(CAT_SENT_FILE, d);
}

// ── Hadeeya products storage ──

export function storeHadeeyaProduct(product: HadeeyaProduct): void {
  const products = readJson<HadeeyaProduct[]>(HADEEYA_FILE, []);
  const idx = products.findIndex((p) => p.product_id === product.product_id);
  if (idx >= 0) products[idx] = product;
  else products.push(product);
  writeJson(HADEEYA_FILE, products);
}

export function getHadeeyaProducts(limit = 20): HadeeyaProduct[] {
  const products = readJson<HadeeyaProduct[]>(HADEEYA_FILE, []);
  products.sort((a, b) => (b.scraped_at ?? '').localeCompare(a.scraped_at ?? ''));
  return products.slice(0, limit);
}
