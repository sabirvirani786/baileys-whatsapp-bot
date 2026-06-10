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
import { getAllHadeeyaProducts, storeHadeeyaProduct } from './db.js';
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

export async function runDailyJob() {
  console.log('[daily-poster] ===== DAILY POSTER JOB START =====');

  try {
    const fs = await import('fs');
    const path = await import('path');
    const dir = path.resolve('poster_images');
    if (fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true });
      console.log('[daily-poster] Cleared old poster images.');
    }
  } catch (err) {
    console.log('[daily-poster] Failed to clear images', err);
  }

  const groups = env.DAILY_POST_GROUPS;
  if (!groups.length) {
    console.log('[daily-poster] No target groups configured');
    return;
  }

  const state = loadState();

  const allHadeeya = getAllHadeeyaProducts();
  const hadeeyaProducts: HadeeyaProduct[] = [];

  if (allHadeeya.length > 0) {
    let index = state.hadeeya_index || 0;
    for (let i = 0; i < 10; i++) {
      if (index >= allHadeeya.length) index = 0;
      hadeeyaProducts.push(allHadeeya[index]);
      index++;
    }
    state.hadeeya_index = index;
  }

  const kharchifyProducts = await fetchKharchifyProducts(undefined, 50); // Fetch a batch
  const chunk = kharchifyProducts.slice(state.product_index, state.product_index + 5);
  state.product_index += chunk.length;
  if (state.product_index >= kharchifyProducts.length) state.product_index = 0;

  if (!hadeeyaProducts.length && !chunk.length) {
    console.log('[daily-poster] No products to post');
    return;
  }

  for (const jid of groups) {
    try {
      await safeSendMessage(jid, { text: "Assalamu Alaikum! Today's featured items:" }, { typing: false });

      for (const p of chunk) {
        const text = formatProduct(p);
        if (p.image) {
          const imgPath = await downloadImage(p.image, `k_${p.id}`);
          if (imgPath) await safeSendMessage(jid, { image: { url: imgPath }, caption: text }, { typing: false });
          else await safeSendMessage(jid, { text }, { typing: false });
        } else {
          await safeSendMessage(jid, { text }, { typing: false });
        }
      }

      for (const p of hadeeyaProducts) {
        const text = `📌 *${p.name}*\n💰 Hadia: ₹${p.price_adjusted}\n📦 ${p.stock}`;
        if (p.image_url) {
          const imgPath = await downloadImage(p.image_url, `h_${p.product_id}`);
          if (imgPath) await safeSendMessage(jid, { image: { url: imgPath }, caption: text }, { typing: false });
          else await safeSendMessage(jid, { text }, { typing: false });
        } else {
          await safeSendMessage(jid, { text }, { typing: false });
        }
      }

      await safeSendMessage(jid, { text: "Reply to order or know more! JazakAllah." }, { typing: false });
      console.log(`[daily-poster] Sent to ${jid}`);
    } catch (err) {
      console.error(`[daily-poster] Failed sending to ${jid}`, err);
    }
  }

  saveState(state);
  console.log('[daily-poster] ===== DAILY POSTER JOB END =====');
}

export async function getDailyPostPreview() {
  const state = loadState();
  const kharchifyProducts = await fetchKharchifyProducts(undefined, 50);
  const chunk = kharchifyProducts.slice(state.product_index, state.product_index + 5);

  const allHadeeya = getAllHadeeyaProducts();
  const hadeeyaProducts: HadeeyaProduct[] = [];

  if (allHadeeya.length > 0) {
    let index = state.hadeeya_index || 0;
    for (let i = 0; i < 10; i++) {
      if (index >= allHadeeya.length) index = 0;
      hadeeyaProducts.push(allHadeeya[index]);
      index++;
    }
  }

  return {
    chunk: chunk.map(p => ({
      id: p.id,
      text: formatProduct(p),
      image: p.image
    })),
    hadeeyaProducts: hadeeyaProducts.map(p => ({
      id: p.product_id,
      text: `📌 *${p.name}*\n💰 Hadia: ₹${p.price_adjusted}\n📦 ${p.stock}`,
      image: p.image_url
    }))
  };
}

export async function scrapeHadeeya() {
  console.log('[daily-poster] === HADEEYA SCRAPER START ===');
  const cats = await getCombinedCategories();
  const hadeeyaCats = cats.filter(c => c.source === 'hadeeya');
  let stored = 0;

  for (const cat of hadeeyaCats) {
    const products = await fetchHadeeyaProducts(cat.sourceId!, 100);
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
  cron.schedule(`${postM} ${postH} * * *`, runDailyJob, { timezone: "Asia/Kolkata" });
  cron.schedule('0 6 * * *', scrapeHadeeya, { timezone: "Asia/Kolkata" });

  // Self-ping every 2 minutes to keep Render free tier awake
  cron.schedule('*/2 * * * *', async () => {
    try {
      const url = process.env.RENDER_EXTERNAL_URL || 'https://baileys-whatsapp-bot-u5wc.onrender.com';
      const { default: axios } = await import('axios');
      await axios.get(url);
      console.log(`[self-ping] Pinged ${url} to keep server awake`);
    } catch (err: any) {
      console.error(`[self-ping] Failed to ping server: ${err.message}`);
    }
  });

  // Clean up poster_images every 15 minutes (only files older than 15 mins)
  setInterval(async () => {
    try {
      const fs = await import('fs');
      const path = await import('path');
      const dir = path.resolve('poster_images');
      if (!fs.existsSync(dir)) return;
      const files = fs.readdirSync(dir);
      const now = Date.now();
      let deleted = 0;
      for (const file of files) {
        const filePath = path.join(dir, file);
        const stats = fs.statSync(filePath);
        if (now - stats.mtimeMs > 15 * 60 * 1000) {
          fs.unlinkSync(filePath);
          deleted++;
        }
      }
      if (deleted > 0) console.log(`[cleanup] Deleted ${deleted} old photos from poster_images.`);
    } catch (err) {
      // ignore
    }
  }, 15 * 60 * 1000);
}
