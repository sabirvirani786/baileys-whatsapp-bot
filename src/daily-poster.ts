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

function log(msg: string) {
  console.log(`[${new Date().toISOString()}] [daily-poster] ${msg}`);
}

const STATE_FILE = 'data/daily-post-state.json';

function loadState(): DailyPostState {
  log('loadState()');
  try {
    if (fs.existsSync(STATE_FILE)) {
      const state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'));
      log(`State loaded: ${JSON.stringify(state)}`);
      return state;
    }
  } catch (err) { log(`Failed to load state: ${err}`); }
  log('No state file, returning defaults');
  return { product_page: 1, product_index: 0, set_index: 0 };
}

function saveState(state: DailyPostState) {
  log(`saveState(): ${JSON.stringify(state)}`);
  try {
    fs.mkdirSync('data', { recursive: true });
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
    log('State saved successfully');
  } catch (err) {
    log(`Failed to save state: ${err}`);
    console.error('[daily-poster] Failed to save state', err);
  }
}

export async function runDailyJob() {
  log('===== DAILY POSTER JOB START =====');

  try {
    const imgDir = path.resolve('poster_images');
    if (fs.existsSync(imgDir)) {
      fs.rmSync(imgDir, { recursive: true, force: true });
      log('Cleared old poster images directory');
    }
  } catch (err) {
    log(`Failed to clear images: ${err}`);
  }

  const groups = env.DAILY_POST_GROUPS;
  log(`Target groups (${groups.length}): ${JSON.stringify(groups)}`);
  if (!groups.length) {
    log('No target groups configured, aborting');
    return;
  }

  const state = loadState();

  const allHadeeya = getAllHadeeyaProducts();
  log(`Total Hadeeya products in DB: ${allHadeeya.length}`);
  const hadeeyaProducts: HadeeyaProduct[] = [];

  if (allHadeeya.length > 0) {
    let index = state.hadeeya_index || 0;
    log(`Starting Hadeeya index: ${index}`);
    for (let i = 0; i < 10; i++) {
      if (index >= allHadeeya.length) index = 0;
      hadeeyaProducts.push(allHadeeya[index]);
      index++;
    }
    state.hadeeya_index = index;
    log(`Selected ${hadeeyaProducts.length} Hadeeya products, new index: ${index}`);
  } else {
    log('No Hadeeya products in DB, skipping Hadeeya section');
  }

  log('Fetching Kharchify products batch (50)...');
  const kharchifyProducts = await fetchKharchifyProducts(undefined, 50);
  log(`Kharchify API returned ${kharchifyProducts.length} products total`);
  const chunk = kharchifyProducts.slice(state.product_index, state.product_index + 5);
  state.product_index += chunk.length;
  log(`Kharchify chunk: ${chunk.length} products (index ${state.product_index - chunk.length} to ${state.product_index})`);
  if (state.product_index >= kharchifyProducts.length) {
    state.product_index = 0;
    log('Kharchify index wrapped to 0');
  }

  if (!hadeeyaProducts.length && !chunk.length) {
    log('No products to post from either source, aborting');
    return;
  }

  log(`Starting send loop for ${groups.length} groups`);
  for (const jid of groups) {
    try {
      log(`Sending intro message to ${jid}`);
      await safeSendMessage(jid, { text: "Assalamu Alaikum! Today's featured items:" }, { typing: false });

      log(`Sending ${chunk.length} Kharchify products to ${jid}`);
      for (const p of chunk) {
        const text = formatProduct(p);
        if (p.image) {
          const imgPath = await downloadImage(p.image, `k_${p.id}`);
          if (imgPath) {
            log(`Sending Kharchify product ${p.id} with image to ${jid}`);
            await safeSendMessage(jid, { image: { url: imgPath }, caption: text }, { typing: false });
          } else {
            log(`Image download failed for Kharchify ${p.id}, sending text to ${jid}`);
            await safeSendMessage(jid, { text }, { typing: false });
          }
        } else {
          log(`No image for Kharchify product ${p.id}, sending text to ${jid}`);
          await safeSendMessage(jid, { text }, { typing: false });
        }
      }

      log(`Sending ${hadeeyaProducts.length} Hadeeya products to ${jid}`);
      for (const p of hadeeyaProducts) {
        const text = `📌 *${p.name}*\n💰 Hadia: ₹${p.price_adjusted}\n📦 ${p.stock}`;
        if (p.image_url) {
          const imgPath = await downloadImage(p.image_url, `h_${p.product_id}`);
          if (imgPath) {
            log(`Sending Hadeeya product ${p.product_id} with image to ${jid}`);
            await safeSendMessage(jid, { image: { url: imgPath }, caption: text }, { typing: false });
          } else {
            log(`Image download failed for Hadeeya ${p.product_id}, sending text to ${jid}`);
            await safeSendMessage(jid, { text }, { typing: false });
          }
        } else {
          log(`No image for Hadeeya product ${p.product_id}, sending text to ${jid}`);
          await safeSendMessage(jid, { text }, { typing: false });
        }
      }

      log(`Sending closing message to ${jid}`);
      await safeSendMessage(jid, { text: "Reply to order or know more! JazakAllah." }, { typing: false });
      log(`Completed sending to ${jid}`);
    } catch (err) {
      log(`Failed sending to ${jid}: ${err}`);
      console.error(`[daily-poster] Failed sending to ${jid}`, err);
    }
  }

  saveState(state);
  log('===== DAILY POSTER JOB END =====');
}

export async function runDailyJobWithSelection(
  selectedKharchifyIds: string[],
  selectedHadeeyaIds: number[]
) {
  log(`runDailyJobWithSelection() — kharchify: [${selectedKharchifyIds}], hadeeya: [${selectedHadeeyaIds}]`);

  const groups = env.DAILY_POST_GROUPS;
  log(`Target groups (${groups.length}): ${JSON.stringify(groups)}`);
  if (!groups.length) throw new Error('No target groups configured in DAILY_POST_GROUPS');

  // Resolve Kharchify products
  let chunk: any[] = [];
  if (selectedKharchifyIds.length) {
    const allKharchify = await fetchKharchifyProducts(undefined, 50);
    chunk = allKharchify.filter(p => selectedKharchifyIds.includes(String(p.id)));
    log(`Resolved ${chunk.length} / ${selectedKharchifyIds.length} Kharchify products`);
  }

  // Resolve Hadeeya products from DB
  let hadeeyaProducts: HadeeyaProduct[] = [];
  if (selectedHadeeyaIds.length) {
    const allHadeeya = getAllHadeeyaProducts();
    hadeeyaProducts = allHadeeya.filter(p => selectedHadeeyaIds.includes(p.product_id));
    log(`Resolved ${hadeeyaProducts.length} / ${selectedHadeeyaIds.length} Hadeeya products`);
  }

  if (!chunk.length && !hadeeyaProducts.length) {
    throw new Error('No valid products found for the selected IDs');
  }

  for (const jid of groups) {
    try {
      log(`Sending intro to ${jid}`);
      await safeSendMessage(jid, { text: "Assalamu Alaikum! Today's featured items:" }, { typing: false });

      for (const p of chunk) {
        const text = formatProduct(p);
        if (p.image) {
          const imgPath = await downloadImage(p.image, `k_${p.id}`);
          if (imgPath) {
            await safeSendMessage(jid, { image: { url: imgPath }, caption: text }, { typing: false });
          } else {
            await safeSendMessage(jid, { text }, { typing: false });
          }
        } else {
          await safeSendMessage(jid, { text }, { typing: false });
        }
      }

      for (const p of hadeeyaProducts) {
        const text = `📌 *${p.name}*\n💰 Hadia: ₹${p.price_adjusted}\n📦 ${p.stock}`;
        if (p.image_url) {
          const imgPath = await downloadImage(p.image_url, `h_${p.product_id}`);
          if (imgPath) {
            await safeSendMessage(jid, { image: { url: imgPath }, caption: text }, { typing: false });
          } else {
            await safeSendMessage(jid, { text }, { typing: false });
          }
        } else {
          await safeSendMessage(jid, { text }, { typing: false });
        }
      }

      await safeSendMessage(jid, { text: "Reply to order or know more! JazakAllah." }, { typing: false });
      log(`Completed sending to ${jid}`);
    } catch (err) {
      log(`Failed sending to ${jid}: ${err}`);
      console.error(`[daily-poster] Failed sending to ${jid}`, err);
    }
  }
  log('runDailyJobWithSelection() complete');
}

export async function getDailyPostPreview() {
  log('getDailyPostPreview() called');
  const state = loadState();
  const kharchifyProducts = await fetchKharchifyProducts(undefined, 50);
  const chunk = kharchifyProducts.slice(state.product_index, state.product_index + 5);
  log(`Preview: ${chunk.length} Kharchify products starting at index ${state.product_index}`);

  const allHadeeya = getAllHadeeyaProducts();
  const hadeeyaProducts: HadeeyaProduct[] = [];

  if (allHadeeya.length > 0) {
    let index = state.hadeeya_index || 0;
    for (let i = 0; i < 10; i++) {
      if (index >= allHadeeya.length) index = 0;
      hadeeyaProducts.push(allHadeeya[index]);
      index++;
    }
    log(`Preview: ${hadeeyaProducts.length} Hadeeya products`);
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
  log('=== HADEEYA SCRAPER START ===');
  const cats = await getCombinedCategories();
  const hadeeyaCats = cats.filter(c => c.source === 'hadeeya');
  log(`Found ${hadeeyaCats.length} Hadeeya categories`);
  let stored = 0;

  for (const cat of hadeeyaCats) {
    log(`Scraping category "${cat.name}" (sourceId=${cat.sourceId})`);
    const products = await fetchHadeeyaProducts(cat.sourceId!, 100);
    log(`Category "${cat.name}" returned ${products.length} products`);
    for (const p of products) {
      if (!p.link) {
        log(`Product ${p.id} has no link, skipping`);
        continue;
      }
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
        log(`Stored product ${p.id} "${p.name?.substring(0, 30)}" (₹${details.price})`);
      } else {
        const reason = !details.price ? 'no price' : details.price < 50 ? `price ${details.price} < 50` : 'out of stock';
        log(`Skipped product ${p.id}: ${reason}`);
      }
    }
  }
  log(`=== HADEEYA SCRAPER END. Stored ${stored} products ===`);
}

export function initScheduler() {
  const postH = env.DAILY_POST_HOUR;
  const postM = env.DAILY_POST_MINUTE;
  log(`Scheduler initialized. Daily poster at ${postH}:${String(postM).padStart(2, '0')} IST`);
  log(`Hadeeya scraper at 06:00 IST`);
  cron.schedule(`${postM} ${postH} * * *`, runDailyJob, { timezone: "Asia/Kolkata" });
  cron.schedule('0 6 * * *', scrapeHadeeya, { timezone: "Asia/Kolkata" });

  // Self-ping every 2 minutes to keep Render free tier awake
  cron.schedule('*/2 * * * *', async () => {
    try {
      const url = process.env.RENDER_EXTERNAL_URL || 'https://baileys-whatsapp-bot-u5wc.onrender.com';
      const { default: axios } = await import('axios');
      await axios.get(url);
      log(`Self-ping to ${url} succeeded`);
    } catch (err: any) {
      log(`Self-ping failed: ${err.message}`);
    }
  });

  // Clean up poster_images every 15 minutes (only files older than 15 mins)
  setInterval(async () => {
    try {
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
      if (deleted > 0) log(`Cleaned up ${deleted} old poster images`);
    } catch (err) {
      log(`Image cleanup error (non-critical): ${err}`);
    }
  }, 15 * 60 * 1000);
}
