import { getConfig } from './config.js';
import { getSocket } from './connection.js';

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

  async add(jid: string, content: any): Promise<void> {
    this.queue.push({ jid, content, timestamp: Date.now() });
    if (!this.processing) this.process();
  }

  private async process(): Promise<void> {
    if (this.processing || !this.queue.length) return;
    this.processing = true;

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

      const item = this.queue.shift()!;
      const gap = now - this.lastSendTime;
      if (gap < 1200) await delay(1200 - gap);

      const sock = getSocket();
      if (sock) {
        await sock.sendMessage(item.jid, item.content);
        this.lastSendTime = Date.now();
        this.msgCount++;
      }
    } catch (err) {
      console.error('[queue] send error', err);
    } finally {
      this.processing = false;
      if (this.queue.length) setTimeout(() => this.process(), 800);
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
