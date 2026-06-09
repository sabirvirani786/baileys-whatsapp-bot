import { getConfig } from './config.js';
import { getSocket } from './connection.js';
import messageQueue from './message-queue.js';

async function simulateTyping(jid: string, textLength = 10): Promise<void> {
  const cfg = getConfig();
  if (!cfg.bot.typingIndicator) return;
  const sock = getSocket();
  if (!sock) return;

  try {
    const duration = Math.min(textLength * (cfg.bot.typingDelayPerCharMs || 30), 4000);
    await sock.sendPresenceUpdate('composing', jid);
    await new Promise((r) => setTimeout(r, duration));
    await sock.sendPresenceUpdate('paused', jid);
  } catch { /* non-critical */ }
}

export async function safeSendMessage(jid: string, content: any, opts?: { typing?: boolean }): Promise<boolean> {
  if (!jid || !content) return false;
  try {
    const text = content.text || '';
    if (opts?.typing !== false) {
      await simulateTyping(jid, text.length);
    }
    await messageQueue.add(jid, content);
    return true;
  } catch (err) {
    console.error('[send] failed', err);
    return false;
  }
}

export async function directSendMessage(jid: string, content: any): Promise<boolean> {
  const sock = getSocket();
  if (!sock) return false;
  try {
    await sock.sendMessage(jid, content);
    return true;
  } catch (err) {
    console.error('[send] direct failed', err);
    return false;
  }
}
