import makeWASocket, {
  DisconnectReason,
  fetchLatestBaileysVersion,
  Browsers,
  type WASocket,
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import pino from 'pino';
import { useSupabaseAuthState } from './auth.js';

let sock: WASocket | null = null;
let currentQR: string | null = null;
let isConnected = false;

export async function connectToWhatsApp(
  onMessage: (m: any) => void,
  onOpen?: () => void,
): Promise<WASocket> {
  if (sock) {
    try { await sock.logout(); } catch { /* ignore */ }
    sock = null;
  }

  const { state, saveCreds } = await useSupabaseAuthState('default');
  const { version } = await fetchLatestBaileysVersion();

  sock = makeWASocket({
    version,
    auth: state,
    printQRInTerminal: false,
    browser: Browsers.ubuntu('Chrome'),
    markOnlineOnConnect: true,
    logger: pino({ level: 'silent' }),
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      currentQR = qr;
      console.log('[connection] QR code generated');
    }

    if (connection === 'open') {
      isConnected = true;
      console.log('[connection] Connected to WhatsApp');
      onOpen?.();
    }

    if (connection === 'close') {
      isConnected = false;
      const status = lastDisconnect?.error instanceof Boom
        ? lastDisconnect.error.output.statusCode
        : 0;

      if (status !== DisconnectReason.loggedOut) {
        setTimeout(() => connectToWhatsApp(onMessage, onOpen), 4000);
      } else {
        console.error('[connection] Logged out — delete auth_info_baileys and restart');
      }
    }
  });

  if (onMessage) sock.ev.on('messages.upsert', onMessage);
  return sock;
}

export function getSocket(): WASocket | null {
  return sock;
}

export function getCurrentQR(): string | null {
  return currentQR;
}

export function isWhatsAppConnected(): boolean {
  return isConnected && !!sock;
}

export async function logoutWhatsApp(): Promise<void> {
  if (sock) {
    try {
      await sock.logout();
    } catch (err) {
      console.error('[connection] Error during logout:', err);
    }
    sock = null;
    isConnected = false;
  }
}

export async function reconnectWhatsApp(onMessage: (m: any) => void, onOpen?: () => void): Promise<WASocket> {
  if (isWhatsAppConnected()) {
    throw new Error('Bot is already connected');
  }
  return connectToWhatsApp(onMessage, onOpen);
}
