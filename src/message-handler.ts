import fs from 'fs';
import { extractMessageContent } from './message-extract.js';
import { safeSendMessage } from './send.js';
import { getConfig } from './config.js';
import { getCombinedCategories, fetchKharchifyProducts, fetchHadeeyaProducts, downloadImage, formatProduct } from './scraper.js';
import { categorySentRecently, markCategorySent } from './db.js';
import type { UserState } from './types.js';
import { sendWebhook } from './webhook.js';

function log(msg: string) {
  console.log(`[${new Date().toISOString()}] [messageHandler] ${msg}`);
}

const userStates = new Map<string, UserState>();

const dedupCache = new Set<string>();
function isDuplicate(msgId: string): boolean {
  if (!msgId) return false;
  if (dedupCache.has(msgId)) return true;
  dedupCache.add(msgId);
  if (dedupCache.size > 2000) {
    log('Dedup cache too large, trimming');
    const arr = Array.from(dedupCache);
    dedupCache.clear();
    arr.slice(-1000).forEach(id => dedupCache.add(id));
  }
  return false;
}

export async function sendCategoryProducts(jid: string, selectedCat: any) {
  log(`sendCategoryProducts() called — jid=${jid}, category="${selectedCat.name}"`);
  await safeSendMessage(jid, { text: `🔍 Loading products for *${selectedCat.name}*...` }, { typing: false });

  let products;
  if (selectedCat.source === 'kharchify') {
    log(`Fetching Kharchify products for "${selectedCat.name}"`);
    products = await fetchKharchifyProducts(selectedCat.name, 10);
  } else {
    log(`Fetching Hadeeya products for sourceId=${selectedCat.sourceId}`);
    products = await fetchHadeeyaProducts(selectedCat.sourceId!, 10);
  }

  log(`Fetched ${products.length} products for category "${selectedCat.name}"`);
  if (!products.length) {
    log(`No products found for "${selectedCat.name}"`);
    await safeSendMessage(jid, { text: `❌ No products found in this category.` }, { typing: false });
    return false;
  }

  for (const p of products) {
    const caption = formatProduct(p);
    if (p.image) {
      log(`Downloading image for product ${p.id} (${p.name?.substring(0, 30)})`);
      const imgPath = await downloadImage(p.image, `${p.source}_${p.id}`);
      if (imgPath) {
        log(`Sending product ${p.id} with image: ${imgPath}`);
        await safeSendMessage(jid, { image: { url: imgPath }, caption }, { typing: false });
      } else {
        log(`Image download failed for ${p.id}, sending text only`);
        await safeSendMessage(jid, { text: caption }, { typing: false });
      }
    } else {
      log(`No image for product ${p.id}, sending text only`);
      await safeSendMessage(jid, { text: caption }, { typing: false });
    }
  }
  await safeSendMessage(jid, { text: 'To see categories again, say "Hi"!' }, { typing: false });
  log(`sendCategoryProducts() complete for ${jid}`);
  return true;
}

export async function handleIncomingMessages(m: any) {
  log(`Received event type: ${m.type}, messageCount=${m.messages?.length || 0}`);
  if (m.type !== 'notify') {
    log(`Ignored non-notify event: ${m.type}`);
    return;
  }
  
  const msg = m.messages[0];
  if (!msg || !msg.message) {
    log(`Ignored — no message content`);
    return;
  }
  
  if (msg.key.fromMe) {
    log(`Ignored — message is from me (id: ${msg.key.id})`);
    return;
  }

  const jid = msg.key.remoteJid;
  if (!jid || jid === 'status@broadcast') {
    log(`Ignored — invalid jid or broadcast: ${jid}`);
    return;
  }

  const msgId = msg.key.id;
  if (isDuplicate(msgId)) {
    log(`Ignored — duplicate message id: ${msgId}`);
    return;
  }

  const cfg = getConfig().bot;
  if (cfg.replyOnlyInPrivateChats && jid.endsWith('@g.us')) {
    log(`Ignored — group chat message (replyOnlyInPrivateChats=true) from ${jid}`);
    return;
  }
  
  if (!cfg.autoReply) {
    log(`Ignored — autoReply is disabled in config`);
    return;
  }

  const { text } = extractMessageContent(msg);
  const lowerMsg = text.trim().toLowerCase();
  
  log(`Processing valid message from ${jid} — Text: "${text.substring(0, 100)}"`);
  if (!lowerMsg) {
    log(`Ignored — empty text content`);
    return;
  }

  log(`Sending webhook for message...`);
  sendWebhook('message_received', {
    jid,
    messageId: msgId,
    content: text,
    pushName: msg.pushName || 'Unknown',
  });

  try {
    let state = userStates.get(jid) || { stage: 'categories' };
    log(`User state for ${jid}: stage="${state.stage}", hasCats=${!!state.cats}`);

    // Restore categories if they are missing (e.g. after a server restart)
    if (!state.cats) {
      log(`No cached categories for ${jid}, fetching from APIs`);
      state.cats = await getCombinedCategories();
      log(`Fetched ${state.cats.length} categories for ${jid}`);
      userStates.set(jid, state);
    }

    const isGreeting = ['hi', 'hello', 'salam', 'assalamu alaikum', 'category'].includes(lowerMsg);
    log(`Message "${lowerMsg}" — isGreeting=${isGreeting}`);

    if (isGreeting) {
      state.stage = 'categories';
      await markCategorySent(jid);
      log(`Greeting detected, sending category list to ${jid}`);

      let reply = '🌙 *Welcome to Islamic Tabarrukat!*\n\nReply with a number or name to see products:\n\n';
      state.cats.forEach((c, i) => {
        reply += `${i + 1}. ${c.name}\n`;
      });
      await safeSendMessage(jid, { text: reply });
      return;
    }

    // Aggressively check for category matches (whether by name or number)
    const extractedNumMatch = text.match(/\d+/);
    let selectedCat = state.cats.find(c => c.name.toLowerCase() === lowerMsg);
    
    if (!selectedCat && extractedNumMatch) {
      const num = parseInt(extractedNumMatch[0], 10);
      log(`No name match, trying number match: ${num}`);
      if (!isNaN(num) && num > 0 && num <= state.cats.length) {
        selectedCat = state.cats[num - 1];
        log(`Number-matched to category: "${selectedCat.name}"`);
      }
    }

    if (selectedCat) {
      state.selected = selectedCat;
      state.stage = 'products';
      log(`Category selected: "${selectedCat.name}" for ${jid}`);
      
      await sendCategoryProducts(jid, selectedCat);
      
      // After sending products, check if we should show categories list
      const sentRecently = await categorySentRecently(jid);
      log(`Category sent recently for ${jid}: ${sentRecently}`);
      if (!sentRecently) {
        log(`Sending categories list again for ${jid}`);
        state.stage = 'categories';
        await markCategorySent(jid);
        let reply = '🌙 *Welcome to Islamic Tabarrukat!*\n\nReply with a number or name to see products:\n\n';
        state.cats.forEach((c, i) => {
          reply += `${i + 1}. ${c.name}\n`;
        });
        await safeSendMessage(jid, { text: reply });
      }
      return;
    }

    // If it wasn't a greeting and wasn't a valid category selection, check if we should send categories
    const sentRecently = await categorySentRecently(jid);
    log(`No match for "${lowerMsg}", sentRecently=${sentRecently}`);
    if (!sentRecently) {
      log(`Sending categories list to ${jid} as fallback`);
      state.stage = 'categories';
      await markCategorySent(jid);
      let reply = '🌙 *Welcome to Islamic Tabarrukat!*\n\nReply with a number or name to see products:\n\n';
      state.cats.forEach((c, i) => {
        reply += `${i + 1}. ${c.name}\n`;
      });
      await safeSendMessage(jid, { text: reply });
    }

  } catch (err) {
    log(`Error processing message for ${jid}: ${err}`);
    console.error(`[messageHandler] error for ${jid}`, err);
  }
}
