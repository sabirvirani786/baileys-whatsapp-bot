import { getConfig } from './config.js';
import { getSocket } from './connection.js';
import { isWhatsAppConnected } from './connection.js';

function log(msg: string) {
  console.log(`[${new Date().toISOString()}] [queue] ${msg}`);
}

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
    const hasImage = !!content?.image?.url || !!content?.image?.buffer;
    log(`add() called — jid=${jid}, hasImage=${hasImage}, queueLength=${this.queue.length}`);
    this.queue.push({ jid, content, timestamp: Date.now() });
    if (!this.processing) {
      log('Not currently processing, starting process()');
      this.process();
    } else {
      log('Already processing, item queued');
    }
  }

  private async process(): Promise<void> {
    if (this.processing || !this.queue.length) {
      log(`process() skipped — processing=${this.processing}, queueLength=${this.queue.length}`);
      return;
    }
    this.processing = true;
    log(`process() started — queueLength=${this.queue.length}`);

    let item: QueueItem | null = null;

    try {
      const now = Date.now();
      const timeSinceHourlyReset = now - this.hourlyReset;
      if (timeSinceHourlyReset > 3_600_000) {
        log(`Hourly window reset (was ${Math.floor(timeSinceHourlyReset / 1000)}s old)`);
        this.msgCount = 0;
        this.hourlyReset = now;
      }

      const limit = getConfig().bot.maxGlobalMessagesPerHour || 25;
      log(`Messages sent this hour: ${this.msgCount}/${limit}`);
      if (this.msgCount >= limit) {
        log(`Rate limit hit (${this.msgCount}/${limit}), waiting 60s`);
        await delay(60_000);
        this.processing = false;
        return this.process();
      }

      item = this.queue.shift()!;
      const itemAge = Math.floor((Date.now() - item.timestamp) / 1000);
      log(`Processing item for ${item.jid} (queued ${itemAge}s ago)`);

      let gap = Date.now() - this.lastSendTime;
      log(`Time since last send: ${Math.floor(gap / 1000)}s`);
      
      // If we are switching to a new chat/group, add a 10 second cooldown
      if (this.lastJid && this.lastJid !== item.jid) {
        log(`Switching from ${this.lastJid} to ${item.jid}. Cooldown 10s required`);
        if (gap < 10000) {
          const wait = 10000 - gap;
          log(`Waiting ${Math.floor(wait / 1000)}s for chat-switch cooldown`);
          await delay(wait);
        }
        gap = Date.now() - this.lastSendTime;
      }
      this.lastJid = item.jid;

      // Default gap between messages is 5000ms
      if (gap < 5000) {
        const wait = 5000 - gap;
        log(`Waiting ${Math.floor(wait / 1000)}s for inter-message gap`);
        await delay(wait);
      }

      const sock = getSocket();
      const connected = sock && isWhatsAppConnected();
      log(`Socket available: ${!!sock}, Connected: ${connected}`);
      if (sock && connected) {
        log(`Sending message to ${item.jid}...`);
        
        // Convert local file URL to buffer for safety
        if (item.content?.image?.url) {
          log(`Image URL detected: ${item.content.image.url.substring(0, 80)}`);
          try {
            const fs = await import('fs');
            if (fs.existsSync(item.content.image.url)) {
              const buf = fs.readFileSync(item.content.image.url);
              item.content.image = buf;
              log(`Converted local image file to buffer (${buf.length} bytes)`);
            } else {
              log(`Local image file not found: ${item.content.image.url}`);
            }
          } catch (err) {
            log(`Failed to read image buffer: ${err}`);
            console.error('[queue] Failed to read image buffer', err);
          }
        }

        await sock.sendMessage(item.jid, item.content);
        log(`Successfully sent message to ${item.jid}`);
        this.lastSendTime = Date.now();
        this.msgCount++;
        log(`Total messages this hour: ${this.msgCount}`);
      } else {
        log(`Cannot send to ${item.jid} — WhatsApp not connected, re-queueing`);
        this.queue.unshift(item);
      }
    } catch (err: any) {
      log(`send error for ${item?.jid}: ${err.message || err}`);
      console.error('[queue] send error', err);
      
      // Check if it's a connection error that we can retry for
      if (err && typeof err === 'object' && 'output' in err) {
        const errorOutput = (err as any).output;
        const statusCode = errorOutput?.statusCode;
        const errorMessage = errorOutput?.payload?.message?.toLowerCase() || '';
        log(`Error analysis — statusCode=${statusCode}, message="${errorMessage}"`);
        
        const isConnectionError = 
          statusCode === 428 || 
          errorMessage.includes('connection closed') ||
          errorMessage.includes('precondition required') ||
          errorMessage.includes('not connected') ||
          errorMessage.includes('network error');
        
        if (isConnectionError && !isWhatsAppConnected()) {
          log(`Connection error detected for ${item?.jid}, adding back to queue for retry`);
          if (item) {
            this.queue.unshift(item);
          }
        } else {
          log(`Non-retryable error for ${item?.jid}, dropping from queue`);
        }
      } else {
        log(`Error is not a Baileys output error, cannot determine retryability — dropping item`);
      }
    } finally {
      this.processing = false;
      if (this.queue.length) {
        log(`Queue has ${this.queue.length} remaining items, scheduling next process in 1500ms`);
        setTimeout(() => this.process(), 1500);
      } else {
        log('Queue empty, processor idle');
      }
    }
  }

  getLength(): number {
    return this.queue.length;
  }

  clear(): void {
    log(`clear() — clearing ${this.queue.length} items`);
    this.queue = [];
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

const messageQueue = new MessageQueue();
export default messageQueue;
