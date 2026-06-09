
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

  // Kharchify Set
  if (d.setItem) {
    html += '<div class="post-section"><h3>Kharchify Featured Set</h3><div class="products-grid">';
    html += '<div class="product-card" style="grid-column: span 2">';
    if (d.setItem.image) html += '<img style="height:300px" src="'+d.setItem.image+'">';
    html += '<div class="info">'+d.setItem.text+'</div></div>';
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
  
  let html = '<div class="products-grid">';
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
  
  let bubblesHtml = '<div style="background: #e1f5fe; padding: 8px 12px; border-radius: 8px; align-self: flex-start; max-width: 80%; font-size: 14px;">🔍 Loading products for *' + catName + '*...</div>';
  
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


