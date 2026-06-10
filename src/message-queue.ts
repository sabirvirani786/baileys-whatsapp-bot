import { getConfig } from './config.js';
import { getSocket } from './connection.js';
import { isWhatsAppConnected } from './connection.js';

interface QueueItem {
  jid: string;
  content: any;
  timestamp: number;
}

class MessageQueue {
  private queue: QueueItem[] = [];
  private processing = false;
  private lastSendTime = 0;
  private msgCount = 0;
  private hourlyReset = Date.now();
  private lastJid: string | null = null;

  async add(jid: string, content: any): Promise<void> {
    this.queue.push({ jid, content, timestamp: Date.now() });
    if (!this.processing) this.process();
  }

  private async process(): Promise<void> {
    if (this.processing || !this.queue.length) return;
    this.processing = true;

    let item: QueueItem | null = null;

    try {
      const now = Date.now();
      if (now - this.hourlyReset > 3_600_000) {
        this.msgCount = 0;
        this.hourlyReset = now;
      }

      const limit = getConfig().bot.maxGlobalMessagesPerHour || 25;
      if (this.msgCount >= limit) {
        await delay(60_000);
        this.processing = false;
        return this.process();
      }

      item = this.queue.shift()!;
      let gap = Date.now() - this.lastSendTime;
      
      // If we are switching to a new chat/group, add a 10 second cooldown
      // to reset WhatsApp's anti-spam media burst limit.
      if (this.lastJid && this.lastJid !== item.jid) {
        console.log(`[queue] Switching from ${this.lastJid} to ${item.jid}. Cooldown 10s...`);
        if (gap < 10000) await delay(10000 - gap);
        gap = Date.now() - this.lastSendTime;
      }
      this.lastJid = item.jid;

      // Default gap between messages is 5000ms
      if (gap < 5000) await delay(5000 - gap);

      const sock = getSocket();
      if (sock && isWhatsAppConnected()) {
        console.log(`[queue] Sending message to ${item.jid}...`);
        
        // Convert local file URL to buffer for safety
        if (item.content?.image?.url) {
          try {
            const fs = await import('fs');
            if (fs.existsSync(item.content.image.url)) {
              item.content.image = fs.readFileSync(item.content.image.url);
            }
          } catch (err) {
            console.error('[queue] Failed to read image buffer', err);
          }
        }

        await sock.sendMessage(item.jid, item.content);
        console.log(`[queue] Successfully sent message to ${item.jid}`);
        this.lastSendTime = Date.now();
        this.msgCount++;
      } else {
        console.log(`[queue] Skipping message to ${item.jid} - WhatsApp not connected`);
        this.queue.unshift(item);
      }
    } catch (err) {
      console.error('[queue] send error', err);
      
      // Check if it's a connection error that we can retry for
      if (err && typeof err === 'object' && 'output' in err) {
        const errorOutput = err.output as any;
        const statusCode = errorOutput?.statusCode;
        const errorMessage = errorOutput?.payload?.message?.toLowerCase() || '';
        
        const isConnectionError = 
          statusCode === 428 || 
          errorMessage.includes('connection closed') ||
          errorMessage.includes('precondition required') ||
          errorMessage.includes('not connected') ||
          errorMessage.includes('network error');
        
        if (isConnectionError && !isWhatsAppConnected()) {
          console.log(`[queue] Connection error detected for ${item?.jid}, adding back to queue with retry logic`);
          if (item) {
            this.queue.unshift(item);
          }
        } else {
          console.log(`[queue] Non-retryable error for ${item?.jid}, dropping from queue`);
        }
      }
    } finally {
      this.processing = false;
      if (this.queue.length) setTimeout(() => this.process(), 1500);
    }
  }

  getLength(): number {
    return this.queue.length;
  }

  clear(): void {
    this.queue = [];
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

const messageQueue = new MessageQueue();
export default messageQueue;
