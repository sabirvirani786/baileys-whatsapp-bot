import express from 'express';
import axios from 'axios';
import * as cheerio from 'cheerio';
import { getCurrentQR, getSocket, logoutWhatsApp, reconnectWhatsApp, isWhatsAppConnected, getCachedContacts, refreshContactCache } from './connection.js';
import { getConfig } from './config.js';
import { fetchHadeeyaCategories, scrapeHadeeyaProductPage, getCombinedCategories } from './scraper.js';
import { getDailyPostPreview } from './daily-poster.js';
import { deleteHadeeyaProduct, clearHadeeyaProducts } from './db.js';
import { handleIncomingMessages, sendCategoryProducts } from './message-handler.js';

const HADEEYA_API = 'https://hadeeya.in/wp-json/wp/v2';
const HADEEYA_MARKUP = 0.20;

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.get('/', (_req, res) => {
  const qr = getCurrentQR();
  const sock = getSocket();
  const state = sock?.user ? 'Connected as ' + sock.user.id : (qr ? 'Awaiting Scan' : 'Initializing...');

  res.send(`
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Unified Bot Dashboard</title>
<script src="https://cdn.rawgit.com/davidshimjs/qrcodejs/gh-pages/qrcode.min.js"></script>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, system-ui, sans-serif; background: #f0f2f5; color: #1c1e21; }
  .header { background: #075e54; color: white; padding: 15px 20px; font-size: 18px; font-weight: bold; box-shadow: 0 1px 3px rgba(0,0,0,0.1); display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 10px; }
  .header h1 { font-size: 18px; }
  .status-badge { padding: 4px 12px; border-radius: 12px; font-size: 12px; font-weight: 600; }
  .status-badge.connected { background: #d4edda; color: #155724; }
  .status-badge.disconnected { background: #fff3cd; color: #856404; }
  .container { max-width: 1100px; margin: 20px auto; padding: 0 20px; }
  .tabs { display: flex; gap: 4px; margin-bottom: 20px; flex-wrap: wrap; }
  .tab { padding: 10px 18px; background: #ddd; border: none; border-radius: 6px 6px 0 0; cursor: pointer; font-size: 13px; font-weight: 600; }
  .tab.active { background: #00a884; color: #fff; }
  .tab:hover { opacity: 0.85; }
  .panel { display: none; background: #fff; padding: 24px; border-radius: 0 8px 8px 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
  .panel.active { display: block; }
  .input-group { margin-bottom: 15px; }
  .input-group label { display: block; margin-bottom: 5px; font-size: 14px; font-weight: 600; color: #555; }
  .input-group input, .input-group select, .input-group textarea { width: 100%; padding: 10px; border: 1px solid #ccc; border-radius: 4px; font-size: 14px; }
  .input-group textarea { height: 80px; resize: vertical; }
  .input-row { display: flex; gap: 10px; margin-bottom: 15px; flex-wrap: wrap; }
  .input-row input, .input-row select { flex: 1; min-width: 150px; padding: 10px; border: 1px solid #ccc; border-radius: 4px; font-size: 14px; }
  .btn { padding: 10px 20px; background: #00a884; color: #fff; border: none; border-radius: 4px; cursor: pointer; font-weight: 600; font-size: 14px; }
  .btn:hover { opacity: 0.9; }
  .btn.danger { background: #dc3545; }
  .btn.warning { background: #ffc107; color: #212529; }
  .btn.success { background: #28a745; }
  .btn.secondary { background: #6c757d; }
  .btn:disabled { opacity: 0.5; cursor: not-allowed; }
  .msg { padding: 10px; border-radius: 4px; margin-bottom: 15px; font-size: 14px; }
  .msg.error { background: #f8d7da; color: #721c24; display: block; }
  .msg.success { background: #d4edda; color: #155724; display: block; }
  .msg.loading { background: #e2e3e5; color: #383d41; display: block; text-align: center; }
  #qr-code-container { text-align: center; margin: 20px 0; }
  .products-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 16px; }
  .product-card { border: 1px solid #eee; border-radius: 8px; overflow: hidden; background: #fff; position: relative; }
  .product-card img { width: 100%; height: 160px; object-fit: cover; display: block; background: #f7f7f7; }
  .product-card .info { padding: 10px; white-space: pre-wrap; font-size: 12px; }
  .post-section { margin-bottom: 24px; }
  .post-section h3 { margin-bottom: 10px; border-bottom: 2px solid #eee; padding-bottom: 5px; }
  .contact-list { max-height: 400px; overflow-y: auto; border: 1px solid #eee; border-radius: 4px; padding: 10px; }
  .contact-list div { padding: 4px 0; border-bottom: 1px solid #f0f0f0; font-size: 13px; }
  @media (max-width: 600px) { .tabs { flex-direction: column; } .tab { border-radius: 4px; } }
</style>
</head>
<body>

<div class="header">
  <h1>🤖 Unified Bot Dashboard</h1>
  <span class="status-badge ${sock?.user ? 'connected' : 'disconnected'}" id="header-status">${state}</span>
</div>

<div class="container">
  <div class="tabs">
    <button class="tab active" data-tab="status">Status & Send</button>
    <button class="tab" data-tab="sender">Direct Sender</button>
    <button class="tab" data-tab="contacts">Contacts & Export</button>
    <button class="tab" data-tab="test">Test Dashboard</button>
    <button class="tab" data-tab="reset">Reset</button>
  </div>

  <!-- ========== TAB: STATUS & SEND ========== -->
  <div class="panel active" id="panel-status">
    <h2>Connection Status</h2>
    <div id="status-msg" class="msg" style="display:none;"></div>
    <div class="input-row">
      <button id="start-btn" class="btn ${sock?.user ? 'warning' : 'success'}">${sock?.user ? 'Stop WhatsApp' : 'Start WhatsApp'}</button>
      <button id="logout-btn" class="btn danger">Logout</button>
      <button id="refresh-status-btn" class="btn secondary">Refresh Status</button>
    </div>
    <div id="qr-code-container" style="display:${qr && !sock?.user ? 'block' : 'none'}">
      <p>Scan QR with WhatsApp:</p>
      <div id="qrcode"></div>
      <script>if ('${qr}') try { new QRCode(document.getElementById('qrcode'), { text: '${qr}', width: 256, height: 256 }); } catch(e) {}</script>
    </div>
    <hr style="margin: 20px 0;">
    <h3>Send Message</h3>
    <div class="input-group">
      <label>Phone Number (with country code, no +)</label>
      <input type="text" id="send-number" placeholder="e.g. 919876543210">
    </div>
    <div class="input-group">
      <label>Message</label>
      <textarea id="send-text" placeholder="Type your message..."></textarea>
    </div>
    <button id="send-btn" class="btn">Send Message</button>
  </div>

  <!-- ========== TAB: DIRECT SENDER ========== -->
  <div class="panel" id="panel-sender">
    <h2>Direct Sender - Islamic Tabarrukat</h2>
    <div id="sender-msg" class="msg" style="display:none;"></div>
    <div class="input-group">
      <label style="display:flex; justify-content:space-between; align-items:center;">
        <span>Recipient Number(s) or Groups</span>
        <div>
          <button id="s-load-history" class="btn secondary" style="padding:4px 10px; font-size:12px;">Load History</button>
          <button id="s-load-groups" class="btn secondary" style="padding:4px 10px; font-size:12px;">Load Groups</button>
        </div>
      </label>
      <input type="text" id="s-number" placeholder="e.g. 919876543210, 1203630@g.us">
      <div style="font-size:11px; color:#666; margin-top:4px;">Separate multiple with commas</div>
    </div>
    <div class="input-group" id="s-groups-container" style="display:none;">
      <label>Select Groups</label>
      <input type="text" id="s-group-search" placeholder="Search..." style="margin-bottom:5px; padding:6px; font-size:13px;">
      <select id="s-groups-list" multiple style="height:100px; width:100%;"></select>
      <button id="s-add-groups" class="btn secondary" style="margin-top:5px; width:100%;">Add Selected Groups</button>
    </div>
    <div class="input-group">
      <label>Category</label>
      <select id="s-cat"><option>Loading...</option></select>
    </div>
    <div class="input-row">
      <button id="s-preview-btn" class="btn">Preview</button>
      <button id="s-send-btn" class="btn success" style="display:none;">Send to WhatsApp</button>
    </div>
    <div id="s-preview-pane" style="display:none; max-width:400px; margin:20px auto; background:#e5ddd5; border-radius:8px; overflow:hidden;">
      <div style="background:#075e54; color:white; padding:10px 15px; font-weight:bold;">WhatsApp Preview</div>
      <div id="s-preview-content" style="padding:15px; max-height:500px; overflow-y:auto; display:flex; flex-direction:column; gap:10px; background-image:url('https://user-images.githubusercontent.com/15075759/28719144-86dc0f70-73b1-11e7-911d-60d70fcded21.png');"></div>
    </div>
  </div>

  <!-- ========== TAB: CONTACTS & EXPORT ========== -->
  <div class="panel" id="panel-contacts">
    <h2>Contacts & Export</h2>
    <div id="contacts-msg" class="msg" style="display:none;"></div>
    <div class="input-row">
      <button id="c-export-btn" class="btn success">Export All Contacts to JSON</button>
      <button id="c-fetch-btn" class="btn">Fetch WhatsApp Contacts</button>
    </div>
    <div id="c-contacts-list" class="contact-list" style="display:none;"></div>
  </div>

  <!-- ========== TAB: TEST DASHBOARD ========== -->
  <div class="panel" id="panel-test">
    <h2>Test Dashboard</h2>
    <div id="test-msg" class="msg" style="display:none;"></div>
    <div class="tabs" style="margin-bottom:15px;">
      <button class="tab active" data-subtab="daily" style="font-size:12px; padding:6px 12px;">Daily Poster</button>
      <button class="tab" data-subtab="scraper" style="font-size:12px; padding:6px 12px;">Scraper</button>
      <button class="tab" data-subtab="chatbot" style="font-size:12px; padding:6px 12px;">Chatbot</button>
      <button class="tab" data-subtab="hadeeya" style="font-size:12px; padding:6px 12px;">Hadeeya</button>
    </div>

    <div class="subpanel active" id="subpanel-daily">
      <div class="input-row">
        <button id="t-load-daily" class="btn">Preview Daily Post</button>
        <button id="t-post-daily" class="btn success">Post Now</button>
        <button id="t-scrape-daily" class="btn" style="background:#17a2b8;">Scrape Hadeeya</button>
        <button id="t-clear-hadeeya" class="btn danger">Clear Queue</button>
      </div>
      <div id="t-daily-results"></div>
    </div>

    <div class="subpanel" id="subpanel-scraper" style="display:none;">
      <div class="input-row">
        <select id="t-scraper-cat"><option>Loading...</option></select>
        <button id="t-scraper-btn" class="btn">Scrape</button>
      </div>
      <div id="t-scraper-results"></div>
    </div>

    <div class="subpanel" id="subpanel-chatbot" style="display:none;">
      <div class="input-row">
        <input type="text" id="t-chat-num" placeholder="Phone (e.g. 919876543210)">
        <input type="text" id="t-chat-msg" placeholder="Message (e.g. 'hi')">
        <button id="t-chat-btn" class="btn">Simulate</button>
      </div>
      <div id="t-chat-results"></div>
    </div>

    <div class="subpanel" id="subpanel-hadeeya" style="display:none;">
      <div class="input-row">
        <input type="text" id="t-hadeeya-url" placeholder="Hadeeya product URL" style="flex:2;">
        <button id="t-hadeeya-btn" class="btn">Scrape</button>
      </div>
      <div id="t-hadeeya-results"></div>
    </div>
  </div>

  <!-- ========== TAB: RESET ========== -->
  <div class="panel" id="panel-reset">
    <h2>⚠️ Reset</h2>
    <div id="reset-msg" class="msg" style="display:none;"></div>
    <p style="margin-bottom:15px; color:#666;">This will clear all cached data, poster images, exported contact files, Hadeeya product queue, and logout WhatsApp.</p>
    <button id="reset-btn" class="btn danger">Full Reset</button>
  </div>
</div>

<script>
const req = async (url, opts) => { const r = await fetch(url, opts); return await r.json(); };

// Tab switching
document.querySelectorAll('.tab[data-tab]').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab[data-tab]').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('panel-' + btn.dataset.tab).classList.add('active');
  });
});

// Sub-tab switching
document.querySelectorAll('.tab[data-subtab]').forEach(btn => {
  btn.addEventListener('click', () => {
    const container = btn.closest('.panel');
    container.querySelectorAll('.tab[data-subtab]').forEach(b => b.classList.remove('active'));
    container.querySelectorAll('.subpanel').forEach(p => p.style.display = 'none');
    btn.classList.add('active');
    document.getElementById('subpanel-' + btn.dataset.subtab).style.display = 'block';
  });
});

function showMsg(id, type, text) {
  const el = document.getElementById(id);
  el.className = 'msg ' + type;
  el.innerText = text;
  el.style.display = 'block';
}

// ==================== TAB: STATUS ====================
document.getElementById('refresh-status-btn').addEventListener('click', () => location.reload());
document.getElementById('start-btn').addEventListener('click', async () => {
  const btn = document.getElementById('start-btn');
  const isConnected = btn.classList.contains('warning');
  if (isConnected) {
    // Stop - just logout
    const j = await req('/api/whatsapp/control', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({action:'logout'}) });
    if (j.success) location.reload();
    else showMsg('status-msg', 'error', j.error);
  } else {
    // Start - reconnect
    const j = await req('/api/whatsapp/control', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({action:'reconnect'}) });
    if (j.success) { showMsg('status-msg', 'success', 'Reconnecting... Check QR code.'); setTimeout(() => location.reload(), 3000); }
    else showMsg('status-msg', 'error', j.error);
  }
});
document.getElementById('logout-btn').addEventListener('click', async () => {
  if (!confirm('Logout WhatsApp?')) return;
  const j = await req('/api/whatsapp/control', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({action:'logout'}) });
  if (j.success) location.reload();
  else showMsg('status-msg', 'error', j.error);
});
document.getElementById('send-btn').addEventListener('click', async () => {
  const num = document.getElementById('send-number').value.trim();
  const text = document.getElementById('send-text').value.trim();
  if (!num || !text) return showMsg('status-msg', 'error', 'Enter number and message');
  showMsg('status-msg', 'loading', 'Sending...');
  const f = document.createElement('form'); f.method = 'POST'; f.action = '/send';
  const i1 = document.createElement('input'); i1.name = 'number'; i1.value = num;
  const i2 = document.createElement('input'); i2.name = 'message'; i2.value = text;
  f.appendChild(i1); f.appendChild(i2); document.body.appendChild(f); f.submit();
});

// ==================== TAB: SENDER ====================
const sCat = document.getElementById('s-cat');
const sNumber = document.getElementById('s-number');
(async () => {
  try { const j = await req('/api/scraper/categories'); if (j.success) { sCat.innerHTML = '<option value="">— Select —</option>'; j.data.forEach(c => { sCat.innerHTML += '<option value="'+c.name+'">'+c.name+' ('+c.source+')</option>'; }); } } catch(e) {}
})();

document.getElementById('s-load-history').addEventListener('click', async () => {
  const j = await req('/api/history-numbers');
  if (j.success && j.data.length) { sNumber.value = j.data.join(', '); showMsg('sender-msg', 'success', 'Loaded '+j.data.length+' numbers'); }
  else showMsg('sender-msg', 'error', 'No history numbers found');
});

document.getElementById('s-load-groups').addEventListener('click', async () => {
  document.getElementById('s-groups-container').style.display = 'block';
  const sel = document.getElementById('s-groups-list'); sel.innerHTML = '<option>Loading...</option>';
  const j = await req('/api/groups');
  if (j.success) { sel.innerHTML = ''; j.data.forEach(g => { const o = document.createElement('option'); o.value = g.id; o.text = g.subject+' ('+g.participants+' members)'; sel.appendChild(o); }); showMsg('sender-msg', 'success', 'Loaded '+j.data.length+' groups'); }
  else showMsg('sender-msg', 'error', 'Failed to load groups');
});
document.getElementById('s-group-search').addEventListener('keyup', () => {
  const f = document.getElementById('s-group-search').value.toLowerCase();
  Array.from(document.getElementById('s-groups-list').options).forEach(o => { o.style.display = o.text.toLowerCase().includes(f) ? '' : 'none'; });
});
document.getElementById('s-add-groups').addEventListener('click', () => {
  const selected = Array.from(document.getElementById('s-groups-list').selectedOptions).map(o => o.value);
  if (!selected.length) return;
  const cur = sNumber.value.trim();
  sNumber.value = cur + (cur && !cur.endsWith(',') ? ', ' : '') + selected.join(', ');
  showMsg('sender-msg', 'success', 'Added '+selected.length+' groups');
});

document.getElementById('s-preview-btn').addEventListener('click', async () => {
  const num = sNumber.value.trim();
  const catName = sCat.value;
  if (!num || !catName) return showMsg('sender-msg', 'error', 'Enter number and select category');
  showMsg('sender-msg', 'loading', 'Loading preview...');
  document.getElementById('s-preview-pane').style.display = 'none';
  document.getElementById('s-send-btn').style.display = 'none';
  const j = await req('/api/scraper/search?q='+encodeURIComponent(catName));
  if (!j.success) return showMsg('sender-msg', 'error', j.error);
  showMsg('sender-msg', 'success', 'Loaded '+j.data.length+' products');
  document.getElementById('s-send-btn').style.display = 'inline-block';
  document.getElementById('s-preview-pane').style.display = 'block';
  let html = '<div style="background:#e1f5fe; padding:8px 12px; border-radius:8px; align-self:flex-start; max-width:80%; font-size:13px;">🔍 '+j.data.length+' products</div>';
  j.data.forEach(p => {
    html += '<div style="background:white; padding:4px; border-radius:8px; align-self:flex-start; max-width:85%; font-size:13px; box-shadow:0 1px 1px rgba(0,0,0,0.1);">';
    if (p.image) html += '<img src="'+p.image+'" style="width:100%; border-radius:6px; display:block; margin-bottom:5px;">';
    let txt = '📌 *'+p.name.replace(/&#038;/g,'&')+'*\\n\\n';
    if (p.description) txt += p.description+'\\n\\n';
    txt += '💰 ₹'+(p.price||0);
    html += '<div style="padding:4px;">'+txt.replace(/\\\\n/g,'<br>')+'</div></div>';
  });
  html += '<div style="background:#e1f5fe; padding:8px 12px; border-radius:8px; align-self:flex-start; max-width:80%; font-size:13px;">Say "Hi" to see categories</div>';
  document.getElementById('s-preview-content').innerHTML = html;
});

document.getElementById('s-send-btn').addEventListener('click', async () => {
  document.getElementById('s-send-btn').disabled = true;
  showMsg('sender-msg', 'loading', 'Sending...');
  const j = await req('/api/send-category', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({number:sNumber.value.trim(),categoryName:sCat.value}) });
  if (j.success) { showMsg('sender-msg', 'success', j.message); document.getElementById('s-send-btn').style.display = 'none'; }
  else showMsg('sender-msg', 'error', j.error);
  document.getElementById('s-send-btn').disabled = false;
});

// ==================== TAB: CONTACTS ====================
document.getElementById('c-export-btn').addEventListener('click', async () => {
  showMsg('contacts-msg', 'loading', 'Exporting contacts...');
  const j = await req('/api/contacts/export');
  if (j.success) showMsg('contacts-msg', 'success', 'Exported '+j.total+' contacts to '+j.file);
  else showMsg('contacts-msg', 'error', j.error);
});
document.getElementById('c-fetch-btn').addEventListener('click', async () => {
  showMsg('contacts-msg', 'loading', 'Fetching contacts...');
  const j = await req('/api/contacts/whatsapp');
  if (j.success) {
    showMsg('contacts-msg', 'success', 'Found '+j.total+' contacts/groups');
    const list = document.getElementById('c-contacts-list');
    list.style.display = 'block';
    list.innerHTML = '<div style="font-weight:bold; padding:8px 0;">All Contacts ('+j.total+'):</div>' + j.data.map(c => '<div>'+c.name+' — '+c.number+' <span style="color:#999;font-size:11px;">['+c.type+']</span></div>').join('');
  } else showMsg('contacts-msg', 'error', j.error);
});

// ==================== TAB: TEST ====================
// Daily sub-tab
document.getElementById('t-load-daily').addEventListener('click', async () => {
  document.getElementById('t-daily-results').innerHTML = '<div class="msg loading">Loading...</div>';
  const j = await req('/api/test/daily-post');
  if (!j.success) return document.getElementById('t-daily-results').innerHTML = '<div class="msg error">'+j.error+'</div>';
  let html = '';
  if (j.data.chunk && j.data.chunk.length) { html += '<div class="post-section"><h3>Kharchify (5)</h3><div class="products-grid">'; j.data.chunk.forEach(p => { html += '<div class="product-card">'+(p.image?'<img src="'+p.image+'">':'')+'<div class="info">'+p.text+'</div></div>'; }); html += '</div></div>'; }
  if (j.data.hadeeyaProducts && j.data.hadeeyaProducts.length) { html += '<div class="post-section"><h3>Hadeeya Queue</h3><div class="products-grid">'; j.data.hadeeyaProducts.forEach(p => { html += '<div class="product-card"><button class="btn danger" style="position:absolute;top:5px;right:5px;padding:2px 6px;font-size:11px;" onclick="deleteHadeeya('+p.id+')">X</button>'+(p.image?'<img src="'+p.image+'">':'')+'<div class="info">'+p.text+'</div></div>'; }); html += '</div></div>'; }
  document.getElementById('t-daily-results').innerHTML = html || '<i>Nothing scheduled</i>';
});
window.deleteHadeeya = async (id) => { await req('/api/test/hadeeya-delete', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({id}) }); document.getElementById('t-load-daily').click(); };
document.getElementById('t-clear-hadeeya').addEventListener('click', async () => { if (confirm('Clear all queued Hadeeya?')) { await req('/api/test/hadeeya-delete', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({id:'all'}) }); document.getElementById('t-load-daily').click(); } });
document.getElementById('t-scrape-daily').addEventListener('click', async () => { document.getElementById('t-daily-results').innerHTML = '<div class="msg loading">Scraping...</div>'; const j = await req('/api/test/scrape-hadeeya', {method:'POST'}); if (j.success) document.getElementById('t-load-daily').click(); else document.getElementById('t-daily-results').innerHTML = '<div class="msg error">'+j.error+'</div>'; });
document.getElementById('t-post-daily').addEventListener('click', async () => { if (!confirm('Send daily post NOW?')) return; document.getElementById('t-daily-results').innerHTML = '<div class="msg loading">Sending...</div>'; const j = await req('/api/test/daily-post-now', {method:'POST'}); document.getElementById('t-daily-results').innerHTML = j.success ? '<div class="msg success">Sent!</div>' : '<div class="msg error">'+j.error+'</div>'; });

// Scraper sub-tab
const tScraperCat = document.getElementById('t-scraper-cat');
(async () => { try { const j = await req('/api/scraper/categories'); if (j.success) { tScraperCat.innerHTML = '<option value="">— Select —</option>'; j.data.forEach(c => { tScraperCat.innerHTML += '<option value="'+c.sourceId+'">'+c.name+' ('+c.source+')</option>'; }); } } catch(e) {} })();
document.getElementById('t-scraper-btn').addEventListener('click', async () => {
  if (!tScraperCat.value) return;
  document.getElementById('t-scraper-results').innerHTML = '<div class="msg loading">Scraping...</div>';
  const j = await req('/api/scraper/search?cat='+encodeURIComponent(tScraperCat.value));
  if (!j.success) return document.getElementById('t-scraper-results').innerHTML = '<div class="msg error">'+j.error+'</div>';
  let html = '<div style="padding:10px;background:#e1f5fe;border-radius:8px;margin-bottom:15px;font-weight:bold;">Loaded '+j.data.length+' products</div><div class="products-grid">';
  j.data.forEach(p => { html += '<div class="product-card">'+(p.image?'<img src="'+p.image+'">':'')+'<div class="info"><b>'+p.name+'</b><br><br>'+(p.description||'')+'</div></div>'; });
  html += '</div>';
  document.getElementById('t-scraper-results').innerHTML = html;
});

// Chatbot sub-tab
document.getElementById('t-chat-btn').addEventListener('click', async () => {
  const num = document.getElementById('t-chat-num').value.trim();
  const msg = document.getElementById('t-chat-msg').value.trim();
  if (!num || !msg) return;
  document.getElementById('t-chat-results').innerHTML = '<div class="msg loading">Simulating...</div>';
  const j = await req('/api/test/chatbot-incoming', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({number:num,message:msg}) });
  document.getElementById('t-chat-results').innerHTML = j.success ? '<div class="msg success">'+j.message+'</div>' : '<div class="msg error">'+j.error+'</div>';
});

// Hadeeya scraper sub-tab
document.getElementById('t-hadeeya-btn').addEventListener('click', async () => {
  const url = document.getElementById('t-hadeeya-url').value.trim();
  if (!url) return;
  document.getElementById('t-hadeeya-results').innerHTML = '<div class="msg loading">Scraping...</div>';
  const j = await req('/api/scraper/product?url='+encodeURIComponent(url));
  if (!j.success) return document.getElementById('t-hadeeya-results').innerHTML = '<div class="msg error">'+j.error+'</div>';
  document.getElementById('t-hadeeya-results').innerHTML = '<div class="msg success">Scraped: '+j.data.name+'</div><pre style="background:#f5f5f5;padding:15px;border-radius:8px;overflow:auto;font-size:12px;">'+JSON.stringify(j.data,null,2)+'</pre>';
});

// ==================== TAB: RESET ====================
document.getElementById('reset-btn').addEventListener('click', async () => {
  if (!confirm('⚠️ This will clear ALL data and logout WhatsApp. Continue?')) return;
  if (!confirm('Are you SURE?')) return;
  showMsg('reset-msg', 'loading', 'Resetting...');
  const j = await req('/api/reset-full', { method:'POST' });
  if (j.success) { showMsg('reset-msg', 'success', j.message); setTimeout(() => location.reload(), 2000); }
  else showMsg('reset-msg', 'error', j.error);
});
</script>
</body>
</html>
  `);
});

app.post('/send', async (req, res) => {
  const { number, message } = req.body;
  const sock = getSocket();
  
  if (!sock) {
    res.status(500).send('Bot is not connected.');
    return;
  }

  try {
    const jid = `${number.replace(/\D/g, '')}@s.whatsapp.net`;
    await sock.sendMessage(jid, { text: message });
    res.redirect('/?success=1');
  } catch (err) {
    res.status(500).send('Failed to send: ' + String(err));
  }
});

// ── Scraper Test API Routes ─────────────────────────────────────────────
app.get('/api/scraper/categories', async (_req, res) => {
  const cats = await getCombinedCategories();
  res.json({ success: true, data: cats });
});

app.get('/api/scraper/search', async (req, res) => {
  const q = (req.query.q as string) || '';
  const catId = req.query.cat as string;
  const keyword = q || catId;
  
  if (!keyword) return res.status(400).json({ success: false, error: 'Missing ?q= or ?cat=' });
  
  try {
    // We use fetchHadeeyaProducts because it now deep-scrapes the prices too!
    const { fetchHadeeyaProducts } = await import('./scraper.js');
    const products = await fetchHadeeyaProducts(keyword, 100);
    res.json({ success: true, data: products });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/scraper/product', async (req, res) => {
  const url = req.query.url as string;
  if (!url) return res.status(400).json({ success: false, error: 'Missing ?url=' });
  try {
    const { price, stock, sku } = await scrapeHadeeyaProductPage(url);
    const { data } = await axios.get(url);
    const $ = cheerio.load(data);
    const name = $('.product_title').text().trim() || $('h1').text().trim();
    const desc = $('.woocommerce-product-details__short-description').text().trim() || $('.product-short-description').text().trim();
    const mainImage = $('.woocommerce-product-gallery__image img').first().attr('data-src') || $('.woocommerce-product-gallery__image img').first().attr('src') || '';
    const gallery: string[] = [];
    $('.woocommerce-product-gallery__image img').each((_: any, el: any) => {
      const src = $(el).attr('data-src') || $(el).attr('src');
      if (src && !gallery.includes(src)) gallery.push(src);
    });
    const adjustedPrice = price !== null ? Math.round(price * (1 + HADEEYA_MARKUP)) : null;
    res.json({
      success: true,
      data: { name, description: desc, price, adjustedPrice, stock, sku, url, mainImage, gallery },
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── Daily Poster Test API Routes ────────────────────────────────────────
app.get('/api/test/daily-post', async (_req, res) => {
  try {
    const preview = await getDailyPostPreview();
    res.json({ success: true, data: preview });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/test/hadeeya-delete', (req, res) => {
  try {
    const { id } = req.body;
    if (id === 'all') {
      clearHadeeyaProducts();
    } else {
      deleteHadeeyaProduct(id);
    }
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/test/chatbot-incoming', async (req, res) => {
  try {
    const { number, message } = req.body;
    const jid = `${number.replace(/\D/g, '')}@s.whatsapp.net`;
    const mockEvent = {
      type: 'notify',
      messages: [{
        key: { remoteJid: jid, fromMe: false, id: 'test-' + Date.now() },
        message: { conversation: message },
        pushName: 'Dashboard Tester'
      }]
    };
    // This physically triggers the bot to process the message and send a real reply!
    await handleIncomingMessages(mockEvent);
    res.json({ success: true, message: 'Message sent into bot handler! Check the WhatsApp account.' });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/send-category', async (req, res) => {
  try {
    const { number, categoryName } = req.body;
    if (!number || !categoryName) return res.status(400).json({ success: false, error: 'Missing number or categoryName' });

    const cats = await getCombinedCategories();
    const selectedCat = cats.find(c => c.name === categoryName);

    if (!selectedCat) {
      return res.status(404).json({ success: false, error: 'Category not found' });
    }

    const numbers = number.split(',').map((n: string) => n.trim()).filter(Boolean);
    let successCount = 0;

    for (const num of numbers) {
      let jid = num;
      if (!jid.includes('@g.us') && !jid.includes('@s.whatsapp.net')) {
        jid = `${jid.replace(/\D/g, '')}@s.whatsapp.net`;
      }
      const success = await sendCategoryProducts(jid, selectedCat);
      if (success) successCount++;
      // small delay to prevent rate limit
      await new Promise(r => setTimeout(r, 500));
    }

    if (successCount > 0) {
      res.json({ success: true, message: `Category products sent successfully to ${successCount} numbers!` });
    } else {
      res.status(400).json({ success: false, error: 'Failed to send products. (Check if numbers are valid and category is not empty).' });
    }
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/history-numbers', async (_req, res) => {
  try {
    const allNumbers = new Set<string>();

    // 1. From category-sent.json history
    const fs = await import('fs');
    const catPath = 'data/category-sent.json';
    if (fs.existsSync(catPath)) {
      const d = JSON.parse(fs.readFileSync(catPath, 'utf-8'));
      for (const jid of Object.keys(d)) {
        if (jid.includes('@s.whatsapp.net')) allNumbers.add(jid.split('@')[0]);
      }
    }

    // 2. From contact cache
    const contacts = getCachedContacts();
    for (const c of contacts) {
      if (c.id.endsWith('@s.whatsapp.net')) allNumbers.add(c.id.split('@')[0]);
    }

    // 3. From groups (group participants)
    const sock = getSocket();
    if (sock?.user) {
      try {
        const groups = await sock.groupFetchAllParticipating();
        for (const gid of Object.keys(groups)) {
          const grp = (groups as any)[gid];
          if (grp.participants) {
            for (const p of grp.participants) {
              const id = typeof p === 'string' ? p : p.id;
              if (id && id.endsWith('@s.whatsapp.net')) allNumbers.add(id.split('@')[0]);
            }
          }
        }
      } catch { /* ignore */ }
    }

    res.json({ success: true, data: Array.from(allNumbers) });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/groups', async (_req, res) => {
  try {
    const sock = getSocket();
    if (!sock || !sock.user) {
      return res.status(400).json({ success: false, error: 'Bot is not connected' });
    }
    const groups = await sock.groupFetchAllParticipating();
    const groupList = Object.values(groups).map((g: any) => ({
      id: g.id,
      subject: g.subject,
      participants: g.participants?.length || 0
    }));
    res.json({ success: true, data: groupList });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/test/scrape-hadeeya', async (_req, res) => {
  try {
    const { scrapeHadeeya } = await import('./daily-poster.js');
    await scrapeHadeeya();
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/test/daily-post-now', async (_req, res) => {
  try {
    const { runDailyJob } = await import('./daily-poster.js');
    await runDailyJob();
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── WhatsApp Connection Control ───────────────────────────────────────────
app.post('/api/whatsapp/control', async (req, res) => {
  const { action } = req.body;
  
  try {
    if (action === 'logout') {
      await logoutWhatsApp();
      res.json({ success: true, message: 'WhatsApp logged out successfully' });
    } else if (action === 'reconnect') {
      await reconnectWhatsApp(handleIncomingMessages);
      res.json({ success: true, message: 'WhatsApp reconnecting...' });
    } else if (action === 'status') {
      res.json({ 
        success: true, 
        connected: isWhatsAppConnected(),
        user: getSocket()?.user,
        hasQR: !!(getCurrentQR() && !getSocket()?.user)
      });
    } else {
      res.status(400).json({ success: false, error: 'Invalid action' });
    }
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── Standalone Direct Sender Page ─────────────────────────────────────────
app.get('/sender', (_req, res) => {
  res.send(`
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>WhatsApp Direct Sender</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, system-ui, sans-serif; background: #ece5dd; color: #1c1e21; }
  .header { background: #075e54; color: white; padding: 15px 20px; font-size: 18px; font-weight: bold; box-shadow: 0 1px 3px rgba(0,0,0,0.1); display: flex; align-items: center; }
  .container { max-width: 800px; margin: 20px auto; display: flex; gap: 20px; padding: 0 20px; flex-wrap: wrap; }
  .controls { flex: 1; min-width: 300px; background: white; padding: 20px; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); align-self: flex-start; }
  .preview-pane { flex: 1; min-width: 300px; max-width: 400px; background: #e5ddd5; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 5px rgba(0,0,0,0.2); display: flex; flex-direction: column; height: 600px; margin: 0 auto; }
  .preview-header { background: #075e54; color: white; padding: 10px 15px; font-weight: bold; display: flex; align-items: center; gap: 10px; }
  .preview-header .avatar { width: 35px; height: 35px; background: #ccc; border-radius: 50%; }
  .preview-content { flex: 1; padding: 15px; overflow-y: auto; display: flex; flex-direction: column; gap: 10px; background-image: url('https://user-images.githubusercontent.com/15075759/28719144-86dc0f70-73b1-11e7-911d-60d70fcded21.png'); }
  
  .input-group { margin-bottom: 15px; }
  .input-group label { display: block; margin-bottom: 5px; font-size: 14px; font-weight: 600; color: #555; }
  .input-group input, .input-group select { width: 100%; padding: 10px; border: 1px solid #ccc; border-radius: 4px; font-size: 14px; }
  
  .btn { display: block; width: 100%; padding: 12px; background: #128c7e; color: white; border: none; border-radius: 4px; font-weight: bold; cursor: pointer; text-align: center; font-size: 15px; margin-bottom: 10px; }
  .btn:hover { background: #075e54; }
  .btn:disabled { background: #ccc; cursor: not-allowed; }
  
  .msg { padding: 10px; border-radius: 4px; margin-bottom: 15px; font-size: 14px; display: none; }
  .msg.error { background: #f8d7da; color: #721c24; display: block; }
  .msg.success { background: #d4edda; color: #155724; display: block; }
  .msg.loading { background: #e2e3e5; color: #383d41; display: block; text-align: center; }
</style>
</head>
<body>

<div class="header">💬 Direct Sender - Islamic Tabarrukat</div>

<div class="container">
  <!-- Controls -->
  <div class="controls">
    <div id="status-msg" class="msg" style="display:none;"></div>
    
    <div class="input-group">
      <label style="display:flex; justify-content:space-between; align-items:center;">
        <span>Recipient Phone Number(s) or Groups</span>
        <div>
          <button id="load-history-btn" style="background:#ddd; border:none; padding:4px 8px; border-radius:4px; font-size:12px; cursor:pointer;">Load History</button>
          <button id="load-groups-btn" style="background:#ddd; border:none; padding:4px 8px; border-radius:4px; font-size:12px; cursor:pointer; margin-left:5px;">Load Groups</button>
        </div>
      </label>
      <input type="text" id="phone-num" placeholder="e.g. 919876543210, 1203630@g.us">
      <div style="font-size: 11px; color: #666; margin-top: 4px;">Separate multiple numbers with commas for broadcast.</div>
    </div>
    
    <div class="input-group" id="groups-container" style="display:none;">
      <label>Select Groups to Append</label>
      <input type="text" id="group-search" placeholder="Search groups by name..." style="margin-bottom:5px; padding:6px; font-size:13px; width:100%; border:1px solid #ccc; border-radius:4px;">
      <select id="groups-list" multiple style="height:100px; margin-bottom:5px; width:100%;"></select>
      <button id="add-groups-btn" style="background:#128c7e; color:white; border:none; padding:6px; border-radius:4px; font-size:12px; cursor:pointer; width:100%;">Add Selected Groups</button>
    </div>
    
    <div class="input-group">
      <label>Category to Send</label>
      <select id="cat-select">
        <option value="">Loading categories...</option>
      </select>
    </div>
    
    <button id="preview-btn" class="btn">Generate Preview</button>
    <button id="send-btn" class="btn" style="display:none; background: #25d366; color: #075e54;">Send to WhatsApp</button>
  </div>

  <!-- WhatsApp Preview -->
  <div class="preview-pane">
    <div class="preview-header">
      <div class="avatar"></div>
      <div id="preview-title">User Preview</div>
    </div>
    <div class="preview-content" id="preview-content">
      <div style="text-align: center; color: #666; background: rgba(255,255,255,0.8); padding: 5px 10px; border-radius: 12px; font-size: 12px; align-self: center; margin-top: 20px;">
        Select a category and click Generate Preview
      </div>
    </div>
  </div>
</div>

<script>
const req = async (url, options) => { const r = await fetch(url, options); return await r.json(); };

const catSelect = document.getElementById('cat-select');
const statusMsg = document.getElementById('status-msg');
const previewContent = document.getElementById('preview-content');
const previewTitle = document.getElementById('preview-title');
const sendBtn = document.getElementById('send-btn');
const previewBtn = document.getElementById('preview-btn');
const loadHistoryBtn = document.getElementById('load-history-btn');

function showMsg(type, text) {
  statusMsg.className = 'msg ' + type;
  statusMsg.innerText = text;
  statusMsg.style.display = 'block';
}

loadHistoryBtn.addEventListener('click', async () => {
  try {
    const j = await req('/api/history-numbers');
    if (j.success && j.data.length > 0) {
      document.getElementById('phone-num').value = j.data.join(', ');
      showMsg('success', 'Loaded ' + j.data.length + ' numbers from history.');
    } else {
      showMsg('error', 'No standard phone numbers found in history.');
    }
  } catch (e) {
    showMsg('error', 'Failed to load history.');
  }
});

const loadGroupsBtn = document.getElementById('load-groups-btn');
const groupsContainer = document.getElementById('groups-container');
const groupsList = document.getElementById('groups-list');
const addGroupsBtn = document.getElementById('add-groups-btn');

loadGroupsBtn.addEventListener('click', async () => {
  try {
    groupsContainer.style.display = 'block';
    groupsList.innerHTML = '<option>Loading...</option>';
    const j = await req('/api/groups');
    if (j.success) {
      groupsList.innerHTML = '';
      j.data.forEach(g => {
        const opt = document.createElement('option');
        opt.value = g.id;
        opt.text = g.subject + ' (' + g.participants + ' members)';
        groupsList.appendChild(opt);
      });
      showMsg('success', 'Loaded ' + j.data.length + ' groups.');
    } else {
      showMsg('error', j.error || 'Failed to load groups');
    }
  } catch (e) {
    showMsg('error', 'Failed to load groups.');
  }
});

const groupSearchInput = document.getElementById('group-search');
groupSearchInput.addEventListener('keyup', () => {
  const filter = groupSearchInput.value.toLowerCase();
  const options = groupsList.options;
  for (let i = 0; i < options.length; i++) {
    const text = options[i].text.toLowerCase();
    options[i].style.display = text.includes(filter) ? '' : 'none';
  }
});

addGroupsBtn.addEventListener('click', () => {
  const selected = Array.from(groupsList.selectedOptions).map(o => o.value);
  if (selected.length === 0) return;
  const input = document.getElementById('phone-num');
  const current = input.value.trim();
  const sep = current && !current.endsWith(',') ? ', ' : '';
  input.value = current + sep + selected.join(', ');
  showMsg('success', 'Added ' + selected.length + ' groups to recipient list.');
});

// Load Categories
(async () => {
  try {
    const j = await req('/api/scraper/categories');
    catSelect.innerHTML = '<option value="">— Select a category —</option>';
    j.data.forEach(c => {
      catSelect.innerHTML += '<option value="' + c.name + '" data-sourceid="' + c.sourceId + '">' + c.name + ' (' + c.source + ')</option>';
    });
  } catch (e) {
    showMsg('error', 'Failed to load categories');
  }
})();

previewBtn.addEventListener('click', async () => {
  const num = document.getElementById('phone-num').value.trim();
  const selectedOpt = catSelect.options[catSelect.selectedIndex];
  const catName = selectedOpt.value;
  const sourceId = selectedOpt.dataset.sourceid;
  
  if (!num || !catName) return showMsg('error', 'Please enter a number and select a category.');
  
  showMsg('loading', 'Loading preview...');
  sendBtn.style.display = 'none';
  previewTitle.innerText = '+' + num;

  const keyword = sourceId && sourceId !== 'undefined' ? sourceId : catName;
  try {
    const j = await req('/api/scraper/search?cat=' + encodeURIComponent(keyword));
    if (!j.success) return showMsg('error', j.error);
    
    statusMsg.style.display = 'none';
    sendBtn.style.display = 'block';
    
    let bubblesHtml = '<div style="background: #e1f5fe; padding: 8px 12px; border-radius: 8px; align-self: flex-start; max-width: 80%; font-size: 14px; box-shadow: 0 1px 1px rgba(0,0,0,0.1);">🔍 Loaded ' + j.data.length + ' products for *' + catName + '*!</div>';
    
    j.data.forEach(p => {
      bubblesHtml += '<div style="background: white; padding: 4px; border-radius: 8px; align-self: flex-start; max-width: 85%; font-size: 14px; box-shadow: 0 1px 1px rgba(0,0,0,0.1);">';
      if (p.image) {
        bubblesHtml += '<img src="' + p.image + '" style="width: 100%; border-radius: 6px; display: block; margin-bottom: 5px;">';
      }
      let pText = '📌 *' + p.name.replace(/&#038;/g, '&') + '*\\n\\n';
      if (p.description) pText += p.description + '\\n\\n';
      pText += '💰 Final Price: ₹' + (p.price || 0);
      const txt = pText.replace(/\\n/g, '<br>');
      bubblesHtml += '<div style="padding: 4px;">' + txt + '</div>';
      bubblesHtml += '</div>';
    });
    
    bubblesHtml += '<div style="background: #e1f5fe; padding: 8px 12px; border-radius: 8px; align-self: flex-start; max-width: 80%; font-size: 14px; box-shadow: 0 1px 1px rgba(0,0,0,0.1);">To see categories again, say "Hi"!</div>';
    
    previewContent.innerHTML = bubblesHtml;
  } catch (e) {
    showMsg('error', e.message);
  }
});

sendBtn.addEventListener('click', async () => {
  const num = document.getElementById('phone-num').value.trim();
  const catName = document.getElementById('cat-select').value;
  
  sendBtn.disabled = true;
  previewBtn.disabled = true;
  showMsg('loading', 'Sending to WhatsApp...');
  
  try {
    const res = await fetch('/api/send-category', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ number: num, categoryName: catName })
    });
    const j = await res.json();
    if (j.success) {
      showMsg('success', j.message);
      sendBtn.style.display = 'none';
    } else {
      showMsg('error', j.error);
    }
  } catch (err) {
    showMsg('error', err.message);
  }
  
  sendBtn.disabled = false;
  previewBtn.disabled = false;
});
</script>
</body>
</html>
  `);
});

// ── Unified Testing Dashboard ───────────────────────────────────────────
app.get('/dashboard', (_req, res) => {
  res.send(`
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Unified Testing Dashboard</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, system-ui, sans-serif; background: #f0f2f5; color: #1c1e21; padding: 20px; }
  .container { max-width: 1000px; margin: 0 auto; }
  h1 { color: #00a884; margin-bottom: 20px; }
  .tabs { display: flex; gap: 8px; margin-bottom: 20px; flex-wrap: wrap; }
  .tab { padding: 10px 20px; background: #ddd; border: none; border-radius: 6px; cursor: pointer; font-size: 14px; font-weight: 600; }
  .tab.active { background: #00a884; color: #fff; }
  .tab:hover { opacity: 0.85; }
  .panel { display: none; background: #fff; padding: 20px; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
  .panel.active { display: block; }
  .input-row { display: flex; gap: 10px; margin-bottom: 15px; flex-wrap: wrap; }
  .input-row input, .input-row select { flex: 1; min-width: 200px; padding: 10px; border: 1px solid #ccc; border-radius: 4px; font-size: 14px; }
  .input-row button { padding: 10px 24px; background: #00a884; color: #fff; border: none; border-radius: 4px; cursor: pointer; font-weight: 600; }
  .input-row button.danger { background: #dc3545; }
  .input-row button:hover { opacity: 0.9; }
  .error { color: #dc3545; padding: 10px; background: #f8d7da; border-radius: 4px; margin-bottom: 10px; }
  .success { color: #28a745; padding: 10px; background: #d4edda; border-radius: 4px; margin-bottom: 10px; }
  .loading { text-align: center; padding: 30px; color: #666; }
  
  .post-section { margin-bottom: 30px; }
  .post-section h3 { margin-bottom: 10px; border-bottom: 2px solid #eee; padding-bottom: 5px; }
  
  .products-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 16px; }
  .product-card { border: 1px solid #eee; border-radius: 8px; overflow: hidden; background: #fff; position: relative; }
  .product-card img { width: 100%; height: 180px; object-fit: cover; display: block; background: #f7f7f7; }
  .product-card .info { padding: 10px; white-space: pre-wrap; font-size: 13px; font-family: monospace; }
  .delete-btn { position: absolute; top: 5px; right: 5px; background: rgba(220,53,69,0.9); color: white; border: none; padding: 5px 10px; border-radius: 4px; cursor: pointer; font-size: 12px; }
  .delete-btn:hover { background: red; }
</style>
</head>
<body>
<div class="container">
  <h1>⚙️ Unified Testing Dashboard</h1>

  <div class="tabs">
    <button class="tab active" data-tab="daily">Daily Poster Preview</button>
    <button class="tab" data-tab="scraper">Category Scraper</button>
    <button class="tab" data-tab="chatbot">Chatbot Reply Test</button>
    <button class="tab" data-tab="direct-send">Direct Send (WhatsApp View)</button>
  </div>

  <!-- Tab: Daily Poster Preview -->
  <div class="panel active" id="panel-daily">
    <div class="input-row">
      <button id="load-daily-btn">Preview Today's Daily Post</button>
      <button id="post-daily-btn" style="background:#28a745;">Post Now</button>
      <button id="scrape-daily-btn" style="background:#17a2b8;">Scrape Now (Fill Queue)</button>
      <button id="clear-hadeeya-btn" class="danger">Clear Hadeeya Queue</button>
    </div>
    <div id="daily-results"></div>
  </div>

  <!-- Tab: Category Scraper -->
  <div class="panel" id="panel-scraper">
    <div class="input-row">
      <select id="cat-select"><option value="">Loading categories...</option></select>
      <button id="cat-btn">Scrape Category Products</button>
    </div>
    <div id="cat-results"></div>
  </div>

  <!-- Tab: Chatbot Reply Test -->
  <div class="panel" id="panel-chatbot">
    <div class="input-row">
      <input type="text" id="chat-num" placeholder="Test Phone Number (e.g. 919876543210)">
      <input type="text" id="chat-msg" placeholder="Type a message (e.g. 'hi' or 'category')">
      <button id="chat-btn">Simulate Incoming Message</button>
    </div>
    <p style="font-size: 12px; color: #666; margin-top: -10px; margin-bottom: 15px;">
      This will send a real message via WhatsApp to simulate how the bot responds to the user!
    </p>
    <div id="chat-results"></div>
  </div>

  <!-- Tab: Direct Send -->
  <div class="panel" id="panel-direct-send">
    <div class="input-row">
      <input type="text" id="ds-num" placeholder="Phone Number (e.g. 919876543210)">
      <select id="ds-cat"><option value="">Loading categories...</option></select>
    </div>
    <div class="input-row">
      <button id="ds-preview-btn">Preview</button>
      <button id="ds-send-btn" style="display:none;">Send Now</button>
    </div>
    <div id="ds-results"></div>
    
    <div id="ds-whatsapp-preview" style="display:none; max-width: 400px; margin: 20px auto; background: #e5ddd5; border-radius: 8px; border: 1px solid #ccc; overflow: hidden; font-family: -apple-system, system-ui, sans-serif;">
      <div style="background: #075e54; color: white; padding: 10px 15px; font-weight: bold; font-size: 16px;">
        WhatsApp Preview
      </div>
      <div id="ds-preview-content" style="padding: 15px; height: 500px; overflow-y: auto; display: flex; flex-direction: column; gap: 10px;">
         <!-- Bubbles go here -->
      </div>
    </div>
  </div>

</div>

<script>
// Tab Switching
document.querySelectorAll('.tab').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('panel-' + btn.dataset.tab).classList.add('active');
  });
});

const req = async (url, options) => {
  const r = await fetch(url, options);
  return await r.json();
};

// --- Daily Poster ---
const dailyResults = document.getElementById('daily-results');
document.getElementById('load-daily-btn').addEventListener('click', async () => {
  dailyResults.innerHTML = '<div class="loading">Loading preview...</div>';
  const j = await req('/api/test/daily-post');
  if (!j.success) return dailyResults.innerHTML = '<div class="error">' + j.error + '</div>';
  
  let html = '';
  const d = j.data;
  
  // Kharchify Chunk
  if (d.chunk && d.chunk.length) {
    html += '<div class="post-section"><h3>Kharchify Routine (5 Products)</h3><div class="products-grid">';
    d.chunk.forEach(p => {
      html += '<div class="product-card">';
      if (p.image) html += '<img src="'+p.image+'">';
      html += '<div class="info">'+p.text+'</div></div>';
    });
    html += '</div></div>';
  }

  // Hadeeya Products
  if (d.hadeeyaProducts && d.hadeeyaProducts.length) {
    html += '<div class="post-section"><h3>Hadeeya Scraped Queue</h3><div class="products-grid">';
    d.hadeeyaProducts.forEach(p => {
      html += '<div class="product-card">';
      html += '<button class="delete-btn" onclick="deleteHadeeya('+p.id+')">Delete</button>';
      if (p.image) html += '<img src="'+p.image+'">';
      html += '<div class="info">'+p.text+'</div></div>';
    });
    html += '</div></div>';
  }

  if (!html) html = '<i>Nothing scheduled to post!</i>';
  dailyResults.innerHTML = html;
});

window.deleteHadeeya = async (id) => {
  await req('/api/test/hadeeya-delete', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id })
  });
  document.getElementById('load-daily-btn').click();
};

document.getElementById('clear-hadeeya-btn').addEventListener('click', async () => {
  if (confirm("Clear all queued Hadeeya products?")) {
    await window.deleteHadeeya('all');
  }
});

document.getElementById('scrape-daily-btn').addEventListener('click', async () => {
  document.getElementById('daily-results').innerHTML = '<div class="loading">Scraping Hadeeya... This may take up to a minute!</div>';
  const j = await req('/api/test/scrape-hadeeya', { method: 'POST' });
  if (j.success) {
    document.getElementById('load-daily-btn').click();
  } else {
    document.getElementById('daily-results').innerHTML = '<div class="error">'+j.error+'</div>';
  }
});

document.getElementById('post-daily-btn').addEventListener('click', async () => {
  if (!confirm("Are you sure you want to SEND the daily post to all configured groups RIGHT NOW?")) return;
  document.getElementById('daily-results').innerHTML = '<div class="loading">Sending daily post... Check your WhatsApp!</div>';
  const j = await req('/api/test/daily-post-now', { method: 'POST' });
  if (j.success) {
    document.getElementById('daily-results').innerHTML = '<div class="success">Daily post sent successfully!</div>';
  } else {
    document.getElementById('daily-results').innerHTML = '<div class="error">'+j.error+'</div>';
  }
});

// --- Category Scraper ---
const catSelect = document.getElementById('cat-select');
const catResults = document.getElementById('cat-results');
(async () => {
  const j = await req('/api/scraper/categories');
  catSelect.innerHTML = '<option value="">— Select a category —</option>';
  j.data.forEach(c => {
    catSelect.innerHTML += '<option value="' + c.sourceId + '">' + c.name + ' (' + c.source + ')</option>';
  });
})();

document.getElementById('cat-btn').addEventListener('click', async () => {
  if (!catSelect.value) return;
  catResults.innerHTML = '<div class="loading">Scraping...</div>';
  const j = await req('/api/scraper/search?cat=' + encodeURIComponent(catSelect.value));
  if (!j.success) return catResults.innerHTML = '<div class="error">'+j.error+'</div>';
  
  let html = '<div style="margin-bottom:15px; padding: 10px; background: #e1f5fe; border-radius: 8px; font-weight:bold;">🔍 Loaded ' + j.data.length + ' products for this category!</div><div class="products-grid">';
  j.data.forEach(p => {
    html += '<div class="product-card">';
    if (p.image) html += '<img src="'+p.image+'">';
    html += '<div class="info" style="font-family:sans-serif"><b>'+p.name+'</b><br><br>'+(p.description||'')+'</div></div>';
  });
  html += '</div>';
  catResults.innerHTML = html;
});

// --- Chatbot Simulator ---
document.getElementById('chat-btn').addEventListener('click', async () => {
  const num = document.getElementById('chat-num').value.trim();
  const msg = document.getElementById('chat-msg').value.trim();
  const resDiv = document.getElementById('chat-results');
  if (!num || !msg) return;
  resDiv.innerHTML = '<div class="loading">Simulating...</div>';
  
  // We trigger the actual simulated incoming message route!
  // This will make the bot think 'num' sent 'msg', and it will send a real reply back to 'num'!
  try {
    const res = await fetch('/api/test/chatbot-incoming', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ number: num, message: msg })
    });
    const j = await res.json();
    if (j.success) resDiv.innerHTML = '<div class="success">' + j.message + '</div>';
    else resDiv.innerHTML = '<div class="error">' + j.error + '</div>';
  } catch (err) {
    resDiv.innerHTML = '<div class="error">'+err.message+'</div>';
  }
});

// --- Direct Send & WhatsApp Preview ---
const dsCatSelect = document.getElementById('ds-cat');
const dsResults = document.getElementById('ds-results');
const dsPreviewContent = document.getElementById('ds-preview-content');
const dsWhatsappPreview = document.getElementById('ds-whatsapp-preview');
const dsSendBtn = document.getElementById('ds-send-btn');

// Populate categories for Direct Send
(async () => {
  const j = await req('/api/scraper/categories');
  dsCatSelect.innerHTML = '<option value="">— Select a category —</option>';
  j.data.forEach(c => {
    // We store c.name as value because we need to send name to /api/send-category
    dsCatSelect.innerHTML += '<option value="' + c.name + '" data-sourceid="' + c.sourceId + '">' + c.name + ' (' + c.source + ')</option>';
  });
})();

document.getElementById('ds-preview-btn').addEventListener('click', async () => {
  const num = document.getElementById('ds-num').value.trim();
  const selectedOpt = dsCatSelect.options[dsCatSelect.selectedIndex];
  const catName = selectedOpt.value;
  const sourceId = selectedOpt.dataset.sourceid;
  
  if (!num || !catName) return dsResults.innerHTML = '<div class="error">Please enter a number and select a category.</div>';
  
  dsResults.innerHTML = '<div class="loading">Generating preview...</div>';
  dsWhatsappPreview.style.display = 'none';
  dsSendBtn.style.display = 'none';

  // Use the search endpoint which works for both if we pass the search query correctly
  // Wait, for Kharchify, we use catName. For Hadeeya, we should ideally use sourceId if available.
  const keyword = sourceId && sourceId !== 'undefined' ? sourceId : catName;
  const j = await req('/api/scraper/search?cat=' + encodeURIComponent(keyword));
  
  if (!j.success) return dsResults.innerHTML = '<div class="error">'+j.error+'</div>';
  
  dsResults.innerHTML = '';
  dsWhatsappPreview.style.display = 'block';
  dsSendBtn.style.display = 'inline-block';
  
  let bubblesHtml = '<div style="background: #e1f5fe; padding: 8px 12px; border-radius: 8px; align-self: flex-start; max-width: 80%; font-size: 14px;">🔍 Loaded ' + j.data.length + ' products for *' + catName + '*!</div>';
  
  j.data.forEach(p => {
    bubblesHtml += '<div style="background: white; padding: 4px; border-radius: 8px; align-self: flex-start; max-width: 85%; font-size: 14px; box-shadow: 0 1px 1px rgba(0,0,0,0.1);">';
    if (p.image) {
      bubblesHtml += '<img src="' + p.image + '" style="width: 100%; border-radius: 6px; display: block; margin-bottom: 5px;">';
    }
    let pText = '📌 *' + p.name.replace(/&#038;/g, '&') + '*\\n\\n';
    if (p.description) pText += p.description + '\\n\\n';
    pText += '💰 Final Price: ₹' + (p.price || 0);
    const txt = pText.replace(/\\n/g, '<br>');
    bubblesHtml += '<div style="padding: 4px;">' + txt + '</div>';
    bubblesHtml += '</div>';
  });
  
  bubblesHtml += '<div style="background: #e1f5fe; padding: 8px 12px; border-radius: 8px; align-self: flex-start; max-width: 80%; font-size: 14px;">To see categories again, say "Hi"!</div>';
  
  dsPreviewContent.innerHTML = bubblesHtml;
});

dsSendBtn.addEventListener('click', async () => {
  const num = document.getElementById('ds-num').value.trim();
  const catName = document.getElementById('ds-cat').value;
  
  dsSendBtn.disabled = true;
  dsSendBtn.innerText = 'Sending...';
  dsResults.innerHTML = '<div class="loading">Sending WhatsApp messages...</div>';
  
  try {
    const res = await fetch('/api/send-category', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ number: num, categoryName: catName })
    });
    const j = await res.json();
    if (j.success) {
      dsResults.innerHTML = '<div class="success">' + j.message + '</div>';
      dsWhatsappPreview.style.display = 'none';
      dsSendBtn.style.display = 'none';
    } else {
      dsResults.innerHTML = '<div class="error">' + j.error + '</div>';
    }
  } catch (err) {
    dsResults.innerHTML = '<div class="error">'+err.message+'</div>';
  }
  
  dsSendBtn.disabled = false;
  dsSendBtn.innerText = 'Send Now';
});

// Auto-refresh page when disconnected to pick up QR / status changes
const headerStatus = document.getElementById('header-status');
if (headerStatus && headerStatus.textContent.includes('Initializing')) {
  console.log('[dashboard] Status is Initializing, will auto-refresh every 10s to check for QR');
  setTimeout(() => { console.log('[dashboard] Auto-refreshing...'); location.reload(); }, 10000);
}
if (headerStatus && headerStatus.textContent.includes('Awaiting Scan')) {
  console.log('[dashboard] Status is Awaiting Scan, will auto-refresh every 15s');
  setTimeout(() => { console.log('[dashboard] Auto-refreshing...'); location.reload(); }, 15000);
}

</script>
</body>
</html>
  `);
});

// ── Contact Export API ────────────────────────────────────────────────────
app.get('/api/contacts/export', async (_req, res) => {
  try {
    const sock = getSocket();
    let contacts = getCachedContacts();
    if (!contacts.length && sock?.user) {
      // Try to refresh cache on demand
      await refreshContactCache(sock);
      contacts = getCachedContacts();
    }
    if (!contacts.length) {
      return res.status(400).json({ success: false, error: 'No contacts in cache. Bot may still be syncing.' });
    }
    const exported = contacts
      .filter(c => c.id && c.id.endsWith('@s.whatsapp.net'))
      .map(c => ({
        number: c.id.replace('@s.whatsapp.net', ''),
        name: c.name || c.notify || 'Unknown',
        id: c.id,
      }));
    const fs = await import('fs');
    const outputPath = 'exported-contacts.json';
    fs.writeFileSync(outputPath, JSON.stringify({ exportedAt: new Date().toISOString(), total: exported.length, contacts: exported }, null, 2));
    res.json({ success: true, total: exported.length, file: outputPath });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/contacts/whatsapp', async (_req, res) => {
  try {
    const sock = getSocket();
    let contacts = getCachedContacts();
    if (!contacts.length && sock?.user) {
      await refreshContactCache(sock);
      contacts = getCachedContacts();
    }
    if (!contacts.length) {
      return res.status(400).json({ success: false, error: 'No contacts in cache. Bot may still be syncing.' });
    }
    const list = contacts
      .filter(c => c.id && (c.id.endsWith('@s.whatsapp.net') || c.id.endsWith('@g.us')))
      .map(c => ({
        id: c.id,
        number: c.id.replace('@s.whatsapp.net', '').replace('@g.us', ''),
        name: c.name || c.notify || 'Unknown',
        type: c.id.endsWith('@g.us') ? 'group' : 'user',
      }));
    res.json({ success: true, total: list.length, data: list });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── Reset Full ────────────────────────────────────────────────────────────
app.post('/api/reset-full', async (_req, res) => {
  try {
    const fs = await import('fs');
    const path = await import('path');
    
    // 1. Clear poster_images
    const imgDir = path.resolve('poster_images');
    if (fs.existsSync(imgDir)) {
      fs.rmSync(imgDir, { recursive: true, force: true });
    }

    // 2. Clear data files
    const dataDir = path.resolve('data');
    if (fs.existsSync(dataDir)) {
      const files = fs.readdirSync(dataDir);
      for (const file of files) {
        fs.unlinkSync(path.join(dataDir, file));
      }
    }

    // 3. Clear Hadeeya products from DB
    const { clearHadeeyaProducts, deleteHadeeyaProduct } = await import('./db.js');
    clearHadeeyaProducts();

    // 4. Clear exported JSON files
    const exportFiles = ['exported-contacts.json', 'exported-group-contacts.json', 'whatsapp-full-chat-history.json', 'group-members-simple.json'];
    for (const f of exportFiles) {
      if (fs.existsSync(f)) fs.unlinkSync(f);
    }

    // 5. Clear category log & dedup log
    const srcDir = path.resolve('src');
    for (const f of ['category_log.json', 'dedup_log.json']) {
      const fp = path.join(srcDir, f);
      if (fs.existsSync(fp)) fs.unlinkSync(fp);
    }

    // 6. Logout & reconnect WhatsApp
    await logoutWhatsApp();

    res.json({ success: true, message: 'Full reset complete. Data cleared, WhatsApp logged out.' });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── Health Check ──────────────────────────────────────────────────────────
app.get('/health', (_req, res) => {
  res.send('ok');
});

export function startServer() {
  const port = process.env.PORT || 3000;
  app.listen(port, () => {
    console.log(`[server] Dashboard running on port ${port}`);
  });
}
