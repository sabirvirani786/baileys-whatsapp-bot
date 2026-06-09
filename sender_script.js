
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
    
    let bubblesHtml = '<div style="background: #e1f5fe; padding: 8px 12px; border-radius: 8px; align-self: flex-start; max-width: 80%; font-size: 14px; box-shadow: 0 1px 1px rgba(0,0,0,0.1);">🔍 Loading products for *' + catName + '*...</div>';
    
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
