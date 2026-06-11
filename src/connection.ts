import makeWASocket, {
  DisconnectReason,
  fetchLatestBaileysVersion,
  Browsers,
  type WASocket,
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import pino from 'pino';
import { useSupabaseAuthState } from './auth.js';

function log(msg: string) {
  console.log(`[${new Date().toISOString()}] [connection] ${msg}`);
}

let sock: WASocket | null = null;
let currentQR: string | null = null;
let pairingCode: string | null = null;
let isConnected = false;

// Contact cache populated from messaging-history.set / chats.upsert events
let cachedContacts: { id: string; name: string; notify: string }[] = [];

export function getCachedContacts() {
  return cachedContacts;
}

export function clearContactCache() {
  cachedContacts = [];
}

export async function refreshContactCache(sock: WASocket) {
  log('refreshContactCache() — fetching contacts from groups and chats');
  try {
    const wa = sock as any;
    const contactsMap = new Map<string, { id: string; name: string; notify: string }>();

    // 1. Extract from all participating groups
    try {
      const groups = await sock.groupFetchAllParticipating();
      log(`Fetched ${Object.keys(groups).length} groups`);
      for (const [gid, group] of Object.entries(groups)) {
        const grp = group as any;
        if (grp.participants) {
          for (const p of grp.participants) {
            const id = typeof p === 'string' ? p : p.id;
            if (id && !contactsMap.has(id)) {
              const name = typeof p === 'string' ? '' : (p.name || p.lid || '');
              contactsMap.set(id, { id, name: name || '', notify: '' });
            }
          }
        }
      }
      log(`Extracted ${contactsMap.size} contacts from groups`);
    } catch (e: any) {
      log(`Group fetch failed: ${e.message}`);
    }

    // 2. Try to get contacts from internal BAILNEYS store (if available via any cast)
    try {
      if (typeof wa.getContacts === 'function') {
        const rawContacts = await wa.getContacts();
        if (rawContacts?.length) {
          for (const c of rawContacts) {
            if (c.id) {
              contactsMap.set(c.id, { id: c.id, name: c.name || c.notify || '', notify: c.notify || '' });
            }
          }
          log(`Added ${rawContacts.length} contacts from socket.getContacts()`);
        }
      }
    } catch { /* not available */ }

    cachedContacts = Array.from(contactsMap.values());
    log(`refreshContactCache complete — ${cachedContacts.length} total contacts`);
  } catch (err: any) {
    log(`refreshContactCache error: ${err.message}`);
  }
}

export async function connectToWhatsApp(
  onMessage: (m: any) => void,
  onOpen?: () => void,
  phoneNumber?: string,
): Promise<WASocket> {
  log('connectToWhatsApp() called' + (phoneNumber ? ` with phone: ${phoneNumber}` : ''));
  if (sock) {
    log('Existing socket found, logging out first');
    try { await sock.logout(); log('Existing socket logged out'); } catch { log('Existing socket logout skipped (no session)'); }
    sock = null;
  }

  log('Fetching Baileys version and Supabase auth state...');
  const { state, saveCreds } = await useSupabaseAuthState('default');
  const { version } = await fetchLatestBaileysVersion();
  log(`Using Baileys version: ${version}`);

  sock = makeWASocket({
    version,
    auth: state,
    printQRInTerminal: false,
    browser: Browsers.ubuntu('Chrome'),
    markOnlineOnConnect: true,
    logger: pino({ level: 'error' }),
  });
  log('WASocket created');

  // Reset contact cache on fresh connection
  cachedContacts = [];
  log('Contact cache cleared');

  sock.ev.on('creds.update', () => log('Creds updated, saving...'));
  sock.ev.on('creds.update', saveCreds);

  // Listen for contacts from Baileys events
  sock.ev.on('contacts.upsert', (contacts) => {
    log(`contacts.upsert event received with ${contacts.length} contacts`);
    for (const c of contacts) {
      const idx = cachedContacts.findIndex(ex => ex.id === c.id);
      const entry = { id: c.id, name: (c as any).name || '', notify: (c as any).notify || '' };
      if (idx >= 0) cachedContacts[idx] = entry;
      else cachedContacts.push(entry);
    }
    log(`Contact cache now has ${cachedContacts.length} entries`);
  });

  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect, qr } = update;
    log(`Connection update: ${connection || 'unknown'}${qr ? ' + QR' : ''}`);

    if (qr) {
      currentQR = qr;
      log('QR code generated and stored');
    }

    if (connection === 'open') {
      isConnected = true;
      log(`Connected to WhatsApp as ${sock?.user?.id || 'unknown'}`);
      onOpen?.();
      // Refresh contact cache on connect
      refreshContactCache(sock!).catch(e => log(`Initial contact cache refresh failed: ${e.message}`));
    }

    if (connection === 'close') {
      isConnected = false;
      const status = lastDisconnect?.error instanceof Boom
        ? lastDisconnect.error.output.statusCode
        : 0;
      log(`Connection closed. Status code: ${status}`);

      if (status === DisconnectReason.loggedOut) {
        log('LOGGED OUT — will not auto-reconnect');
        console.error('[connection] Logged out — delete auth_info_baileys and restart');
      } else if (status === DisconnectReason.connectionClosed) {
        log('Connection closed unexpectedly, reconnecting in 4s...');
        setTimeout(() => connectToWhatsApp(onMessage, onOpen, phoneNumber), 4000);
      } else if (status === DisconnectReason.restartRequired) {
        log('Restart required, reconnecting in 4s...');
        setTimeout(() => connectToWhatsApp(onMessage, onOpen, phoneNumber), 4000);
      } else if (status === DisconnectReason.timedOut) {
        log('Timed out, reconnecting in 4s...');
        setTimeout(() => connectToWhatsApp(onMessage, onOpen, phoneNumber), 4000);
      } else {
        log(`Unknown disconnect reason (${status}), reconnecting in 4s...`);
        setTimeout(() => connectToWhatsApp(onMessage, onOpen, phoneNumber), 4000);
      }
    }
  });

  // === PHONE NUMBER PAIRING CODE ===
  if (phoneNumber) {
    log(`Phone number provided: ${phoneNumber}, setting up pairing code listener`);
    sock.ev.on('connection.update', (update) => {
      if (update.connection === 'connecting' || update.qr) {
        log('Connection is in "connecting" state, checking registration status for pairing');
        if (!sock!.authState.creds.registered) {
          log('Device not registered, requesting pairing code...');
          sock!.requestPairingCode(phoneNumber)
            .then(code => {
              pairingCode = code;
              log(`Pairing code received: ${code}`);
              console.log(`\n📲 Your Pairing Code: ${code}\nOpen WhatsApp → Linked Devices → Link with Phone Number → Enter this code`);
            })
            .catch(err => {
              log(`Failed to generate pairing code: ${err}`);
              console.error('[connection] Failed to generate pairing code:', err);
            });
        } else {
          log('Device already registered, skipping pairing');
        }
      }
    });
  }

  if (onMessage) {
    log('Attaching messages.upsert handler');
    sock.ev.on('messages.upsert', onMessage);
  }
  log('connectToWhatsApp() complete, returning socket');
  return sock;
}

export function getSocket(): WASocket | null {
  return sock;
}

export function getCurrentQR(): string | null {
  return currentQR;
}

export function getPairingCode(): string | null {
  return pairingCode;
}

export function isWhatsAppConnected(): boolean {
  return (isConnected && !!sock) || !!sock?.user;
}

export async function logoutWhatsApp(): Promise<void> {
  log('logoutWhatsApp() called');
  if (sock) {
    try {
      await sock.logout();
      log('Logged out successfully');
    } catch (err) {
      log(`Error during logout: ${err}`);
      console.error('[connection] Error during logout:', err);
    }
    sock = null;
    isConnected = false;
    log('Socket set to null, isConnected = false');
  } else {
    log('No socket to logout');
  }
}

export async function reconnectWhatsApp(onMessage: (m: any) => void, onOpen?: () => void, phoneNumber?: string): Promise<WASocket> {
  log('reconnectWhatsApp() called');
  if (isWhatsAppConnected()) {
    log('Already connected, throwing error');
    throw new Error('Bot is already connected');
  }
  log('Proceeding to reconnect');
  return connectToWhatsApp(onMessage, onOpen, phoneNumber);
}
