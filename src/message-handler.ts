import fs from 'fs';
import { extractMessageContent } from './message-extract.js';
import { safeSendMessage } from './send.js';
import { getConfig } from './config.js';
import { getCombinedCategories, fetchKharchifyProducts, fetchHadeeyaProducts, downloadImage, formatProduct } from './scraper.js';
import { categorySentRecently, markCategorySent } from './db.js';
import type { UserState } from './types.js';
import { sendWebhook } from './webhook.js';

const userStates = new Map<string, UserState>();

const dedupCache = new Set<string>();
function isDuplicate(msgId: string): boolean {
  if (!msgId) return false;
  if (dedupCache.has(msgId)) return true;
  dedupCache.add(msgId);
  if (dedupCache.size > 2000) {
    const arr = Array.from(dedupCache);
    dedupCache.clear();
    arr.slice(-1000).forEach(id => dedupCache.add(id));
  }
  return false;
}

export async function sendCategoryProducts(jid: string, selectedCat: any) {
  await safeSendMessage(jid, { text: `🔍 Loading products for *${selectedCat.name}*...` }, { typing: false });

  let products;
  if (selectedCat.source === 'kharchify') {
    products = await fetchKharchifyProducts(selectedCat.name, 10);
  } else {
    products = await fetchHadeeyaProducts(selectedCat.sourceId!, 10);
  }

  if (!products.length) {
    await safeSendMessage(jid, { text: `❌ No products found in this category.` }, { typing: false });
    return false; // Indicating failure to find products
  }

  for (const p of products) {
    const caption = formatProduct(p);
    if (p.image) {
      const imgPath = await downloadImage(p.image, `${p.source}_${p.id}`);
      if (imgPath) await safeSendMessage(jid, { image: { url: imgPath }, caption }, { typing: false });
      else await safeSendMessage(jid, { text: caption }, { typing: false });
    } else {
      await safeSendMessage(jid, { text: caption }, { typing: false });
    }
  }
  await safeSendMessage(jid, { text: 'To see categories again, say "Hi"!' }, { typing: false });
  return true;
}

export async function handleIncomingMessages(m: any) {
  console.log(`\n[messageHandler] Received event type: ${m.type}`);
  if (m.type !== 'notify') {
    console.log(`[messageHandler] Ignored non-notify event: ${m.type}`);
    return;
  }
  
  const msg = m.messages[0];
  if (!msg || !msg.message) {
    console.log(`[messageHandler] Ignored - no message content`);
    return;
  }
  
  if (msg.key.fromMe) {
    console.log(`[messageHandler] Ignored - message is from me`);
    return;
  }

  const jid = msg.key.remoteJid;
  if (!jid || jid === 'status@broadcast') {
    console.log(`[messageHandler] Ignored - invalid jid or broadcast: ${jid}`);
    return;
  }

  const msgId = msg.key.id;
  if (isDuplicate(msgId)) {
    console.log(`[messageHandler] Ignored - duplicate message id: ${msgId}`);
    return;
  }

  const cfg = getConfig().bot;
  if (cfg.replyOnlyInPrivateChats && jid.endsWith('@g.us')) {
    console.log(`[messageHandler] Ignored - group chat message (replyOnlyInPrivateChats=true)`);
    return;
  }
  
  if (!cfg.autoReply) {
    console.log(`[messageHandler] Ignored - autoReply is disabled in config`);
    return;
  }

  const { text } = extractMessageContent(msg);
  const lowerMsg = text.trim().toLowerCase();
  
  console.log(`[messageHandler] Processing valid message from ${jid} - Text: "${text}"`);
  if (!lowerMsg) {
    console.log(`[messageHandler] Ignored - empty text content`);
    return;
  }

  console.log(`[messageHandler] Sending webhook for message...`);
  sendWebhook('message_received', {
    jid,
    messageId: msgId,
    content: text,
    pushName: msg.pushName || 'Unknown',
  });

  try {
    let state = userStates.get(jid) || { stage: 'categories' };

    // Restore categories if they are missing (e.g. after a server restart)
    if (!state.cats) {
      state.cats = await getCombinedCategories();
      userStates.set(jid, state);
    }

    const isGreeting = ['hi', 'hello', 'salam', 'assalamu alaikum', 'category'].includes(lowerMsg);

    if (isGreeting) {
      state.stage = 'categories';
      await markCategorySent(jid);

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
      if (!isNaN(num) && num > 0 && num <= state.cats.length) {
        selectedCat = state.cats[num - 1];
      }
    }

    if (selectedCat) {
      state.selected = selectedCat;
      state.stage = 'products';
      
      await sendCategoryProducts(jid, selectedCat);
      
      // After sending products, check if we should show categories list
      const sentRecently = await categorySentRecently(jid);
      if (!sentRecently) {
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
    // Only send if we haven't sent them recently to avoid spam
    const sentRecently = await categorySentRecently(jid);
    if (!sentRecently) {
      state.stage = 'categories';
      await markCategorySent(jid);
      let reply = '🌙 *Welcome to Islamic Tabarrukat!*\n\nReply with a number or name to see products:\n\n';
      state.cats.forEach((c, i) => {
        reply += `${i + 1}. ${c.name}\n`;
      });
      await safeSendMessage(jid, { text: reply });
    }

  } catch (err) {
    console.error(`[messageHandler] error for ${jid}`, err);
  }
}
