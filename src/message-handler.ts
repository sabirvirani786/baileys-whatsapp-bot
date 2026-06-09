import fs from 'fs';
import { extractMessageContent } from './message-extract.js';
import { safeSendMessage } from './send.js';
import { getConfig } from './config.js';
import { getCombinedCategories, fetchKharchifyProducts, fetchHadeeyaProducts, downloadImage, formatProduct } from './scraper.js';
import { categorySentRecently, markCategorySent } from './db.js';
import type { UserState } from './types.js';
import { sendWebhook } from './webhook.js';

const userStates = new Map<string, UserState>();

// Optional inline dedup if webhook doesn't do it
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

export async function handleIncomingMessages(m: any) {
  const msg = m.messages[0];
  if (!msg || !msg.message) return;
  if (msg.key.fromMe) return;

  const jid = msg.key.remoteJid;
  if (!jid || jid === 'status@broadcast') return;

  const msgId = msg.key.id;
  if (isDuplicate(msgId)) return;

  const cfg = getConfig().bot;
  if (cfg.replyOnlyInPrivateChats && jid.endsWith('@g.us')) return;
  if (!cfg.autoReply) return;

  const { text } = extractMessageContent(msg);
  const lowerMsg = text.trim().toLowerCase();
  if (!lowerMsg) return;

  sendWebhook('message_received', {
    jid,
    messageId: msgId,
    content: text,
    pushName: msg.pushName || 'Unknown',
  });

  try {
    let state = userStates.get(jid) || { stage: 'categories' };

    if (['hi', 'hello', 'salam', 'assalamu alaikum'].includes(lowerMsg) || !state.cats) {
      const sentRecently = await categorySentRecently(jid);
      if (sentRecently && !['hi', 'hello', 'salam', 'assalamu alaikum'].includes(lowerMsg)) {
        return; // Don't spam categories if they just sent a random message
      }

      const cats = await getCombinedCategories();
      state.cats = cats;
      state.stage = 'categories';
      userStates.set(jid, state);
      await markCategorySent(jid);

      let reply = '🌙 *Welcome to Islamic Tabarrukat!*\n\nReply with a number or name to see products:\n\n';
      cats.forEach((c, i) => {
        reply += `${i + 1}. ${c.name}\n`;
      });
      await safeSendMessage(jid, { text: reply });
      return;
    }

    if (state.stage === 'categories' && state.cats) {
      let selectedCat = state.cats.find(c => c.name.toLowerCase() === lowerMsg);
      if (!selectedCat) {
        const num = parseInt(lowerMsg, 10);
        if (!isNaN(num) && num > 0 && num <= state.cats.length) {
          selectedCat = state.cats[num - 1];
        }
      }

      if (selectedCat) {
        state.selected = selectedCat;
        state.stage = 'products';
        await safeSendMessage(jid, { text: `🔍 Loading products for *${selectedCat.name}*...` });

        let products;
        if (selectedCat.source === 'kharchify') {
          products = await fetchKharchifyProducts(selectedCat.name, 10);
        } else {
          products = await fetchHadeeyaProducts(selectedCat.sourceId!, 10);
        }

        if (!products.length) {
          await safeSendMessage(jid, { text: `❌ No products found in this category.` });
          state.stage = 'categories'; // reset
          return;
        }

        for (const p of products) {
          const caption = formatProduct(p);
          if (p.image) {
            const imgPath = await downloadImage(p.image, `${p.source}_${p.id}`);
            if (imgPath) await safeSendMessage(jid, { image: { url: imgPath }, caption });
            else await safeSendMessage(jid, { text: caption });
          } else {
            await safeSendMessage(jid, { text: caption });
          }
        }
        await safeSendMessage(jid, { text: 'To see categories again, say "Hi"!' });
        state.stage = 'categories'; // Reset so they can choose another next time easily
      } else {
        await safeSendMessage(jid, { text: `Please select a valid category number or name.` });
      }
    }
  } catch (err) {
    console.error(`[messageHandler] error for ${jid}`, err);
  }
}
