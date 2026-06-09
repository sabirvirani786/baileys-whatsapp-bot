import cron from 'node-cron';
import fs from 'fs';
import path from 'path';
import { env } from './config.js';
import { safeSendMessage } from './send.js';
import {
  fetchKharchifyProducts,
  fetchKharchifySets,
  getCombinedCategories,
  fetchHadeeyaProducts,
  scrapeHadeeyaProductPage,
  downloadImage,
  formatProduct,
  formatSet
} from './scraper.js';
import { getHadeeyaProducts, storeHadeeyaProduct } from './db.js';
import type { DailyPostState, HadeeyaProduct } from './types.js';

const STATE_FILE = 'data/daily-post-state.json';

function loadState(): DailyPostState {
  try {
    if (fs.existsSync(STATE_FILE)) return JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'));
  } catch { /* ignore */ }
  return { product_page: 1, product_index: 0, set_index: 0 };
}

function saveState(state: DailyPostState) {
  try {
    fs.mkdirSync('data', { recursive: true });
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  } catch (err) {
    console.error('[daily-poster] Failed to save state', err);
  }
}

async function runDailyJob() {
  console.log('[daily-poster] ===== DAILY POSTER JOB START =====');
  const groups = env.DAILY_POST_GROUPS;
  if (!groups.length) {
    console.log('[daily-poster] No target groups configured');
    return;
  }

  const state = loadState();
  const kharchifyProducts = await fetchKharchifyProducts(undefined, 50); // Fetch a batch
  const chunk = kharchifyProducts.slice(state.product_index, state.product_index + 5);
  state.product_index += chunk.length;
  if (state.product_index >= kharchifyProducts.length) state.product_index = 0;

  const sets = await fetchKharchifySets();
  const setItem = sets[state.set_index % (sets.length || 1)] || null;
  state.set_index++;

  const hadeeyaProducts = getHadeeyaProducts(8);

  if (!chunk.length && !setItem && !hadeeyaProducts.length) {
    console.log('[daily-poster] No products to post');
    return;
  }

  for (const jid of groups) {
    try {
      await safeSendMessage(jid, { text: "Assalamu Alaikum! Today's featured items:" });
      
      for (const p of chunk) {
        const text = formatProduct(p);
        if (p.image) {
          const imgPath = await downloadImage(p.image, `k_${p.id}`);
          if (imgPath) await safeSendMessage(jid, { image: { url: imgPath }, caption: text });
          else await safeSendMessage(jid, { text });
        } else {
          await safeSendMessage(jid, { text });
        }
      }

      if (setItem) {
        const text = formatSet(setItem);
        if (setItem.image_url || setItem.product_images?.[0]?.image_url) {
          const imgPath = await downloadImage(setItem.image_url || setItem.product_images![0].image_url, `set_${setItem.id}`);
          if (imgPath) await safeSendMessage(jid, { image: { url: imgPath }, caption: text });
          else await safeSendMessage(jid, { text });
        } else {
          await safeSendMessage(jid, { text });
        }
      }

      for (const p of hadeeyaProducts) {
        const text = `📌 *${p.name}*\n💰 Hadia: ₹${p.price_adjusted}\n📦 ${p.stock}`;
        if (p.image_url) {
          const imgPath = await downloadImage(p.image_url, `h_${p.product_id}`);
          if (imgPath) await safeSendMessage(jid, { image: { url: imgPath }, caption: text });
          else await safeSendMessage(jid, { text });
        } else {
          await safeSendMessage(jid, { text });
        }
      }

      await safeSendMessage(jid, { text: "Reply to order or know more! JazakAllah." });
      console.log(`[daily-poster] Sent to ${jid}`);
    } catch (err) {
      console.error(`[daily-poster] Failed sending to ${jid}`, err);
    }
  }
  
  saveState(state);
  console.log('[daily-poster] ===== DAILY POSTER JOB END =====');
}

async function scrapeHadeeya() {
  console.log('[daily-poster] === HADEEYA SCRAPER START ===');
  const cats = await getCombinedCategories();
  const hadeeyaCats = cats.filter(c => c.source === 'hadeeya');
  let stored = 0;

  for (const cat of hadeeyaCats) {
    const products = await fetchHadeeyaProducts(cat.sourceId!, 2);
    for (const p of products) {
      if (!p.link) continue;
      const details = await scrapeHadeeyaProductPage(p.link);
      if (details.price && details.price >= 50 && !details.stock.toLowerCase().includes('out of stock')) {
        const hp: HadeeyaProduct = {
          product_id: Number(p.id),
          sku: details.sku,
          name: p.name,
          category: cat.name,
          price_original: details.price,
          price_adjusted: details.price,
          stock: details.stock,
          image_url: p.image || '',
          product_url: p.link,
          scraped_at: new Date().toISOString()
        };
        storeHadeeyaProduct(hp);
        stored++;
      }
    }
  }
  console.log(`[daily-poster] === HADEEYA SCRAPER END. Stored ${stored} products ===`);
}

export function initScheduler() {
  const postH = env.DAILY_POST_HOUR;
  const postM = env.DAILY_POST_MINUTE;
  console.log(`[daily-poster] Scheduled daily poster at ${postH}:${postM.toString().padStart(2, '0')}`);
  cron.schedule(`${postM} ${postH} * * *`, runDailyJob);
  cron.schedule('0 6 * * *', scrapeHadeeya);
}
