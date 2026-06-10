import { getConfig } from './config.js';
import { getSocket } from './connection.js';
import messageQueue from './message-queue.js';
import { isWhatsAppConnected } from './connection.js';

function log(msg: string) {
  console.log(`[${new Date().toISOString()}] [send] ${msg}`);
}

async function simulateTyping(jid: string, textLength = 10): Promise<void> {
  const cfg = getConfig();
  if (!cfg.bot.typingIndicator) {
    log(`Typing indicator disabled in config, skipping for ${jid}`);
    return;
  }
  const sock = getSocket();
  if (!sock) {
    log(`No socket available for typing indicator on ${jid}`);
    return;
  }

  try {
    const duration = Math.min(textLength * (cfg.bot.typingDelayPerCharMs || 30), 4000);
    log(`Simulating typing for ${jid} — duration=${duration}ms, textLength=${textLength}`);
    await sock.sendPresenceUpdate('composing', jid);
    await new Promise((r) => setTimeout(r, duration));
    await sock.sendPresenceUpdate('paused', jid);
  } catch { log(`Typing simulation failed (non-critical) for ${jid}`); }
}

export async function safeSendMessage(jid: string, content: any, opts?: { typing?: boolean }): Promise<boolean> {
  const contentType = content?.image ? 'image' : content?.text ? 'text' : 'unknown';
  log(`safeSendMessage() called — jid=${jid}, type=${contentType}, typing=${opts?.typing !== false}`);
  if (!jid || !content) {
    log(`Invalid args — jid=${!!jid}, content=${!!content}`);
    return false;
  }
  try {
    const text = content.text || '';
    if (opts?.typing !== false) {
      await simulateTyping(jid, text.length);
    }
    if (!isWhatsAppConnected()) {
      log(`WhatsApp not connected, skipping message to ${jid}`);
      return false;
    }
    log(`Adding message to queue for ${jid}`);
    await messageQueue.add(jid, content);
    log(`Successfully queued message for ${jid}`);
    return true;
  } catch (err) {
    log(`Failed to queue message for ${jid}: ${err}`);
    console.error('[send] failed', err);
    return false;
  }
}

export async function directSendMessage(jid: string, content: any): Promise<boolean> {
  log(`directSendMessage() called — jid=${jid}`);
  const sock = getSocket();
  if (!sock) {
    log(`No socket, cannot send directly to ${jid}`);
    return false;
  }
  try {
    await sock.sendMessage(jid, content);
    log(`Direct send succeeded to ${jid}`);
    return true;
  } catch (err) {
    log(`Direct send failed to ${jid}: ${err}`);
    console.error('[send] direct failed', err);
    return false;
  }
}
