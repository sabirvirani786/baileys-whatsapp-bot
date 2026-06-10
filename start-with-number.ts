import { connectToWhatsApp } from './src/connection.js';
import { handleIncomingMessages } from './src/message-handler.js';
import { startServer } from './src/server.js';
import { initScheduler } from './src/daily-poster.js';

const PHONE_NUMBER = '919173737249'; // ← CHANGE TO YOUR NUMBER (without +)

async function bootstrap() {
  console.log('Starting Unified WhatsApp Bot with Phone Number Login...');
  
  // Start web dashboard
  startServer();
  
  // Connect Baileys with phone number
  await connectToWhatsApp(handleIncomingMessages, undefined, PHONE_NUMBER);
  
  // Start cron jobs for daily poster & scraping
  initScheduler();
  
  console.log('Bot initialization complete. Listening for messages...');
}

bootstrap().catch(err => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});