import { initConfigWatcher } from './config.js';
import { connectToWhatsApp } from './connection.js';
import { handleIncomingMessages } from './message-handler.js';
import { startServer } from './server.js';
import { initScheduler } from './daily-poster.js';

async function bootstrap() {
  console.log('Starting Unified WhatsApp Bot...');
  
  // Watch config.json for changes
  initConfigWatcher();
  
  // Start web dashboard
  startServer();
  
  // Connect Baileys
  await connectToWhatsApp(handleIncomingMessages);

  // Start cron jobs for daily poster & scraping
  initScheduler();

  console.log('Bot initialization complete. Listening for messages...');
}

bootstrap().catch(err => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('Shutting down gracefully...');
  process.exit(0);
});
process.on('SIGTERM', () => {
  console.log('Shutting down gracefully...');
  process.exit(0);
});
