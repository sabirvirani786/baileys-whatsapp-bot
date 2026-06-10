import fs from 'fs';
import { env } from './config.js';
import type { HadeeyaProduct } from './types.js';

function log(msg: string) {
  console.log(`[${new Date().toISOString()}] [db] ${msg}`);
}

const SUPABASE_HEADERS = () => ({
  apikey: env.SUPABASE_KEY,
  Authorization: `Bearer ${env.SUPABASE_KEY}`,
  'Content-Type': 'application/json',
});

const HADEEYA_FILE = 'data/hadeeya-products.json';
const CAT_SENT_FILE = 'data/category-sent.json';

function readJson<T>(p: string, fallback: T): T {
  try {
    if (fs.existsSync(p)) {
      const data = fs.readFileSync(p, 'utf-8');
      log(`Read file: ${p} (${data.length} bytes)`);
      return JSON.parse(data);
    }
  } catch (err) { log(`Failed to read ${p}: ${err}`); }
  return fallback;
}

function writeJson(p: string, data: any): void {
  try {
    fs.writeFileSync(p, JSON.stringify(data));
    log(`Wrote file: ${p}`);
  } catch (err) { log(`Failed to write ${p}: ${err}`); }
}

// ── Category-sent tracking ──

export async function categorySentRecently(jid: string): Promise<boolean> {
  log(`categorySentRecently(${jid})`);
  try {
    if (env.SUPABASE_URL && env.SUPABASE_KEY) {
      log('Checking Supabase for recently sent categories');
      const { default: axios } = await import('axios');
      const cutoff = new Date(Date.now() - 72 * 3600_000).toISOString();
      const { data } = await axios.get(`${env.SUPABASE_URL}/rest/v1/category_sent`, {
        headers: SUPABASE_HEADERS(),
        params: { jid: `eq.${jid}`, sent_at: `gt.${cutoff}`, select: 'id', limit: 1 },
      });
      const found = data?.length > 0;
      log(`Supabase result: ${found ? 'sent recently' : 'not sent recently'}`);
      if (found) return true;
    }
  } catch (err) { log(`Supabase check failed: ${err}, falling back to file`); }

  const d = readJson<Record<string, number>>(CAT_SENT_FILE, {});
  const t = d[jid];
  const result = !!t && Date.now() - t < 72 * 3600_000;
  log(`File check result: ${result} (timestamp: ${t ? new Date(t).toISOString() : 'none'})`);
  return result;
}

export async function markCategorySent(jid: string): Promise<void> {
  log(`markCategorySent(${jid})`);
  try {
    if (env.SUPABASE_URL && env.SUPABASE_KEY) {
      log('Sending to Supabase');
      const { default: axios } = await import('axios');
      await axios.post(
        `${env.SUPABASE_URL}/rest/v1/category_sent`,
        { jid, sent_at: new Date().toISOString() },
        { headers: { ...SUPABASE_HEADERS(), Prefer: 'resolution=merge-duplicates' } },
      );
      log('Supabase mark successful');
    }
  } catch (err) { log(`Supabase mark failed: ${err}, falling back to file`); }

  const d = readJson<Record<string, number>>(CAT_SENT_FILE, {});
  d[jid] = Date.now();
  writeJson(CAT_SENT_FILE, d);
}

// ── Hadeeya products storage ──

export function storeHadeeyaProduct(product: HadeeyaProduct): void {
  log(`storeHadeeyaProduct(${product.product_id} — "${product.name?.substring(0, 30)}")`);
  const products = readJson<HadeeyaProduct[]>(HADEEYA_FILE, []);
  const idx = products.findIndex((p) => p.product_id === product.product_id);
  if (idx >= 0) {
    products[idx] = product;
    log(`Updated existing product ${product.product_id} at index ${idx}`);
  } else {
    products.push(product);
    log(`Added new product ${product.product_id}, total: ${products.length}`);
  }
  writeJson(HADEEYA_FILE, products);
}

export function getAllHadeeyaProducts(): HadeeyaProduct[] {
  log('getAllHadeeyaProducts()');
  const products = readJson<HadeeyaProduct[]>(HADEEYA_FILE, []);
  products.sort((a, b) => a.product_id - b.product_id);
  log(`Returning ${products.length} products`);
  return products;
}

export function clearHadeeyaProducts(): void {
  log('clearHadeeyaProducts() — clearing all Hadeeya products');
  writeJson(HADEEYA_FILE, []);
}

export function deleteHadeeyaProduct(productId: number | string): void {
  log(`deleteHadeeyaProduct(${productId})`);
  const products = readJson<HadeeyaProduct[]>(HADEEYA_FILE, []);
  const before = products.length;
  const filtered = products.filter(p => String(p.product_id) !== String(productId));
  const deleted = before - filtered.length;
  log(`Deleted ${deleted} product(s) matching ${productId}`);
  writeJson(HADEEYA_FILE, filtered);
}
