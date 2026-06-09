import express from 'express';
import axios from 'axios';
import * as cheerio from 'cheerio';
import { getCurrentQR, getSocket } from './connection.js';
import { getConfig } from './config.js';
import { fetchHadeeyaCategories, scrapeHadeeyaProductPage } from './scraper.js';

const HADEEYA_API = 'https://hadeeya.in/wp-json/wp/v2';
const HADEEYA_MARKUP = 0.20;

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.get('/', (req, res) => {
  const qr = getCurrentQR();
  const sock = getSocket();
  const state = sock?.user ? 'Connected as ' + sock.user.id : (qr ? 'Awaiting Scan' : 'Initializing...');

  res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <title>WhatsApp Bot Dashboard</title>
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <style>
        body { font-family: -apple-system, system-ui, sans-serif; background: #f0f2f5; color: #1c1e21; margin: 0; padding: 20px; }
        .container { max-width: 600px; margin: 0 auto; background: white; padding: 30px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
        h1 { margin-top: 0; color: #00a884; }
        .status { padding: 10px; border-radius: 4px; margin-bottom: 20px; font-weight: bold; }
        .connected { background: #d4edda; color: #155724; }
        .disconnected { background: #fff3cd; color: #856404; }
        #qr-container { display: ${qr && !sock?.user ? 'block' : 'none'}; margin: 20px 0; text-align: center; }
        .input-group { margin-bottom: 15px; }
        label { display: block; margin-bottom: 5px; font-weight: 500; }
        input, textarea, button { width: 100%; box-sizing: border-box; padding: 10px; border: 1px solid #ddd; border-radius: 4px; font-size: 16px; }
        textarea { height: 100px; resize: vertical; }
        button { background: #00a884; color: white; border: none; font-weight: bold; cursor: pointer; margin-top: 10px; }
        button:hover { background: #008f6f; }
        .help { font-size: 12px; color: #666; margin-top: 5px; }
      </style>
      <script src="https://cdn.rawgit.com/davidshimjs/qrcodejs/gh-pages/qrcode.min.js"></script>
    </head>
    <body>
      <div class="container">
        <h1>WhatsApp Bot Dashboard</h1>
        <div class="status ${sock?.user ? 'connected' : 'disconnected'}">Status: ${state}</div>
        
        <div id="qr-container">
          <p>Scan this QR code with WhatsApp:</p>
          <div id="qrcode"></div>
          <script>
            if ('${qr}') new QRCode(document.getElementById("qrcode"), { text: '${qr}', width: 256, height: 256 });
            setTimeout(() => location.reload(), 10000); // Reload to check status
          </script>
        </div>

        <form action="/send" method="POST" style="display: ${sock?.user ? 'block' : 'none'}">
          <div class="input-group">
            <label for="number">Phone Number</label>
            <input type="text" id="number" name="number" placeholder="e.g. 919876543210" required>
            <div class="help">Include country code without +</div>
          </div>
          <div class="input-group">
            <label for="message">Message</label>
            <textarea id="message" name="message" placeholder="Type your message here..." required></textarea>
          </div>
          <button type="submit">Send Message</button>
        </form>
      </div>
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
  const cats = await fetchHadeeyaCategories();
  res.json({ success: true, data: cats });
});

app.get('/api/scraper/search', async (req, res) => {
  const q = (req.query.q as string) || '';
  const catId = req.query.cat as string;
  const params: any = { per_page: 30, _fields: 'id,title,link,featured_media,excerpt' };
  if (q) params.search = q;
  if (catId) params.product_cat = catId;
  if (!q && !catId) return res.status(400).json({ success: false, error: 'Missing ?q= or ?cat=' });
  try {
    const { data } = await axios.get(`${HADEEYA_API}/product`, { params });
    const products: any[] = [];
    for (const p of data) {
      let image = null;
      if (p.featured_media) {
        try {
          const { data: media } = await axios.get(`${HADEEYA_API}/media/${p.featured_media}`);
          image = media.source_url;
        } catch { /* ignore */ }
      }
      products.push({
        id: p.id,
        name: p.title?.rendered || 'Product',
        description: (p.excerpt?.rendered || '').replace(/<[^>]*>/g, '').trim(),
        image,
        link: p.link,
      });
    }
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

// ── Scraper Test Frontend Page ───────────────────────────────────────────
app.get('/scraper-test', (_req, res) => {
  res.send(`
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Hadeeya Scraper Test</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, system-ui, sans-serif; background: #f0f2f5; color: #1c1e21; padding: 20px; }
  .container { max-width: 960px; margin: 0 auto; }
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
  .input-row button:hover { background: #008f6f; }
  .input-row button:disabled { opacity: 0.5; cursor: not-allowed; }
  .error { color: #dc3545; padding: 10px; background: #f8d7da; border-radius: 4px; margin-bottom: 10px; }
  .loading { text-align: center; padding: 30px; color: #666; }
  .spinner { display: inline-block; width: 24px; height: 24px; border: 3px solid #ddd; border-top-color: #00a884; border-radius: 50%; animation: spin .6s linear infinite; margin-right: 8px; vertical-align: middle; }
  @keyframes spin { to { transform: rotate(360deg); } }
  .products-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 16px; }
  .product-card { border: 1px solid #eee; border-radius: 8px; overflow: hidden; background: #fff; transition: box-shadow .2s; cursor: pointer; }
  .product-card:hover { box-shadow: 0 4px 12px rgba(0,0,0,0.12); }
  .product-card img { width: 100%; height: 180px; object-fit: cover; display: block; background: #f7f7f7; }
  .product-card .info { padding: 10px; }
  .product-card .info h3 { font-size: 14px; margin-bottom: 4px; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
  .product-card .info p { font-size: 12px; color: #666; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
  .detail-card { background: #fff; border: 1px solid #eee; border-radius: 8px; padding: 20px; margin-top: 10px; }
  .detail-card .gallery { display: flex; gap: 10px; overflow-x: auto; margin-bottom: 15px; }
  .detail-card .gallery img { height: 200px; border-radius: 6px; }
  .detail-card .field { margin-bottom: 8px; }
  .detail-card .field strong { display: inline-block; min-width: 140px; }
  .detail-card .price-orig { text-decoration: line-through; color: #999; }
  .detail-card .price-adj { font-size: 24px; color: #00a884; font-weight: bold; }
  .detail-card .markup-badge { display: inline-block; background: #e8f5e9; color: #2e7d32; padding: 4px 10px; border-radius: 12px; font-size: 13px; font-weight: 600; margin-left: 10px; }
  .stats { background: #e8f5e9; padding: 10px; border-radius: 6px; margin-bottom: 15px; font-size: 13px; color: #2e7d32; }
  .back-btn { display: inline-block; margin-bottom: 15px; color: #00a884; cursor: pointer; font-weight: 600; }
  .back-btn:hover { text-decoration: underline; }
  .search-hint { font-size: 12px; color: #888; margin-top: -10px; margin-bottom: 15px; }
</style>
</head>
<body>
<div class="container">
  <h1>🔍 Hadeeya Scraper Test</h1>

  <div class="tabs">
    <button class="tab active" data-tab="search">Search</button>
    <button class="tab" data-tab="category">By Category</button>
    <button class="tab" data-tab="detail">Product Detail</button>
  </div>

  <!-- Tab 1: Search -->
  <div class="panel active" id="panel-search">
    <div class="input-row">
      <input type="text" id="search-input" placeholder='e.g. banner, tasbih, ring, perfume' value="banner">
      <button id="search-btn">Search Hadeeya</button>
    </div>
    <div class="search-hint">Searches via WordPress REST API — returns up to 30 matching products.</div>
    <div id="search-results"></div>
  </div>

  <!-- Tab 2: By Category -->
  <div class="panel" id="panel-category">
    <div class="input-row">
      <select id="cat-select"><option value="">— Select a category —</option></select>
      <button id="cat-btn">Fetch Products</button>
    </div>
    <div id="cat-results"></div>
  </div>

  <!-- Tab 3: Product Detail -->
  <div class="panel" id="panel-detail">
    <div class="input-row">
      <input type="text" id="detail-input" placeholder="Paste Hadeeya product URL">
      <button id="detail-btn">Scrape Details</button>
    </div>
    <div class="search-hint">Scrapes product page for price, images, SKU, stock &amp; description. Adds 20% markup.</div>
    <div id="detail-results"></div>
  </div>
</div>

<script>
const BASE = '';

// ── Tab switching ──
document.querySelectorAll('.tab').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('panel-' + btn.dataset.tab).classList.add('active');
  });
});

// ── Helpers ──
function showError(container, msg) {
  container.innerHTML = '<div class="error">' + msg + '</div>';
}
function showLoading(container) {
  container.innerHTML = '<div class="loading"><span class="spinner"></span>Loading…</div>';
}

// ── Tab 1: Search ──
const searchInput = document.getElementById('search-input');
const searchBtn = document.getElementById('search-btn');
const searchResults = document.getElementById('search-results');

searchBtn.addEventListener('click', async () => {
  const q = searchInput.value.trim();
  if (!q) return showError(searchResults, 'Please enter a search term.');
  showLoading(searchResults);
  try {
    const r = await fetch(BASE + '/api/scraper/search?q=' + encodeURIComponent(q));
    const j = await r.json();
    if (!j.success) return showError(searchResults, j.error);
    if (!j.data.length) return showError(searchResults, 'No products found for "' + q + '".');
    let html = '<div class="stats">Found ' + j.data.length + ' product(s) for "<strong>' + q + '</strong>"</div>';
    html += '<div class="products-grid">';
    for (const p of j.data) {
      html += '<div class="product-card" onclick="document.getElementById(\\'detail-input\\').value=\\'' + (p.link || '') + '\\'; document.querySelector(\\'[data-tab=detail]\\').click(); document.getElementById(\\'detail-btn\\').click();">';
      html += p.image ? '<img src="' + p.image + '" alt="" loading="lazy">' : '<div style="height:180px;background:#f7f7f7;display:flex;align-items:center;justify-content:center;color:#ccc">No image</div>';
      html += '<div class="info"><h3>' + p.name + '</h3>';
      if (p.description) html += '<p>' + p.description.substring(0, 100) + '</p>';
      html += '</div></div>';
    }
    html += '</div>';
    searchResults.innerHTML = html;
  } catch (e) {
    showError(searchResults, 'Request failed: ' + e.message);
  }
});

// Enter key on search input
searchInput.addEventListener('keydown', e => { if (e.key === 'Enter') searchBtn.click(); });

// ── Tab 2: Categories ──
const catSelect = document.getElementById('cat-select');
const catBtn = document.getElementById('cat-btn');
const catResults = document.getElementById('cat-results');

// Load categories on first tab show
let catsLoaded = false;
document.querySelector('[data-tab="category"]').addEventListener('click', async () => {
  if (catsLoaded) return;
  catsLoaded = true;
  catSelect.disabled = true;
  catSelect.innerHTML = '<option value="">Loading categories…</option>';
  try {
    const r = await fetch(BASE + '/api/scraper/categories');
    const j = await r.json();
    if (!j.success || !j.data.length) {
      catSelect.innerHTML = '<option value="">No categories found</option>';
      return;
    }
    catSelect.innerHTML = '<option value="">— Select a category —</option>';
    for (const c of j.data) {
      catSelect.innerHTML += '<option value="' + c.sourceId + '">' + c.name + ' (' + (c.source || 'hadeeya') + ')</option>';
    }
    catSelect.disabled = false;
  } catch (e) {
    catSelect.innerHTML = '<option value="">Failed to load: ' + e.message + '</option>';
  }
});

catBtn.addEventListener('click', async () => {
  const catId = catSelect.value;
  if (!catId) return showError(catResults, 'Please select a category.');
  showLoading(catResults);
  try {
    const r = await fetch(BASE + '/api/scraper/search?cat=' + encodeURIComponent(catId));
    const j = await r.json();
    if (!j.success) return showError(catResults, j.error);
    if (!j.data.length) return showError(catResults, 'No products in this category.');
    let html = '<div class="stats">Found ' + j.data.length + ' product(s) in this category.</div>';
    html += '<div class="products-grid">';
    for (const p of j.data) {
      html += '<div class="product-card" onclick="document.getElementById(\\'detail-input\\').value=\\'' + (p.link || '') + '\\'; document.querySelector(\\'[data-tab=detail]\\').click(); document.getElementById(\\'detail-btn\\').click();">';
      html += p.image ? '<img src="' + p.image + '" alt="" loading="lazy">' : '<div style="height:180px;background:#f7f7f7;display:flex;align-items:center;justify-content:center;color:#ccc">No image</div>';
      html += '<div class="info"><h3>' + p.name + '</h3>';
      if (p.description) html += '<p>' + p.description.substring(0, 100) + '</p>';
      html += '</div></div>';
    }
    html += '</div>';
    catResults.innerHTML = html;
  } catch (e) {
    showError(catResults, 'Request failed: ' + e.message);
  }
});

// ── Tab 3: Product Detail ──
const detailInput = document.getElementById('detail-input');
const detailBtn = document.getElementById('detail-btn');
const detailResults = document.getElementById('detail-results');

detailBtn.addEventListener('click', async () => {
  let url = detailInput.value.trim();
  if (!url) return showError(detailResults, 'Please paste a Hadeeya product URL.');
  if (!url.startsWith('http')) url = 'https://hadeeya.in/product/' + url;
  showLoading(detailResults);
  try {
    const r = await fetch(BASE + '/api/scraper/product?url=' + encodeURIComponent(url));
    const j = await r.json();
    if (!j.success) return showError(detailResults, j.error);
    const d = j.data;
    let html = '<div class="back-btn" onclick="detailResults.innerHTML=\\'\\'">← Back to results</div>';
    html += '<div class="detail-card">';
    if (d.gallery && d.gallery.length) {
      html += '<div class="gallery">';
      for (const img of d.gallery) html += '<img src="' + img + '" alt="">';
      html += '</div>';
    } else if (d.mainImage) {
      html += '<div class="gallery"><img src="' + d.mainImage + '" alt=""></div>';
    }
    html += '<h2>' + (d.name || 'Product') + '</h2>';
    html += '<div class="field"><strong>Original Price:</strong> <span class="price-orig">₹' + (d.price ?? 'N/A') + '</span></div>';
    html += '<div class="field"><strong>After 20% Markup:</strong> <span class="price-adj">₹' + (d.adjustedPrice ?? 'N/A') + '</span> <span class="markup-badge">+20%</span></div>';
    html += '<div class="field"><strong>Stock:</strong> ' + (d.stock || 'N/A') + '</div>';
    html += '<div class="field"><strong>SKU:</strong> ' + (d.sku || 'N/A') + '</div>';
    if (d.description) html += '<div class="field"><strong>Description:</strong><br>' + d.description + '</div>';
    html += '<div class="field" style="margin-top:10px"><strong>URL:</strong> <a href="' + d.url + '" target="_blank">' + d.url + '</a></div>';
    html += '</div>';
    detailResults.innerHTML = html;
  } catch (e) {
    showError(detailResults, 'Request failed: ' + e.message);
  }
});

detailInput.addEventListener('keydown', e => { if (e.key === 'Enter') detailBtn.click(); });

// Auto-run search on load
searchBtn.click();
</script>
</body>
</html>
  `);
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
