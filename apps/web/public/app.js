const API_BASE = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' ? 'http://127.0.0.1:4000' : '';
const messagesEl = document.querySelector('#messages');
const promptEl = document.querySelector('#prompt');
const sendButton = document.querySelector('#send-button');
const composerNote = document.querySelector('#composer-note');
const toast = document.querySelector('#toast');
const backendStatus = document.querySelector('#backend-status');
const aiStatus = document.querySelector('#ai-status');
const modelLabel = document.querySelector('#model-label');
const studioPulse = document.querySelector('#studio-pulse');
const studioLabel = document.querySelector('#studio-label');
const studioDetail = document.querySelector('#studio-detail');
const studioCard = document.querySelector('#studio-card');
const pingButton = document.querySelector('#ping-studio');
const downloadPlugin = document.querySelector('#download-plugin');
const downloadPlugin2 = document.querySelector('#download-plugin-2');
const pingButton2 = document.querySelector('#ping-studio-2');
const syncContextButton = document.querySelector('#sync-context');
const connectNow = document.querySelector('#connect-now');
const openStudio = document.querySelector('#open-studio');
const waitingBox = document.querySelector('#waiting-box');
const pluginStatus = document.querySelector('#plugin-status');
const studioBigStatus = document.querySelector('#studio-big-status');
const studioSubtitle = document.querySelector('#studio-subtitle');
const rowProject = document.querySelector('#row-project');
const rowPlace = document.querySelector('#row-place');
const rowSession = document.querySelector('#row-session');
const rowLastPing = document.querySelector('#row-lastping');
const rowContext = document.querySelector('#row-context');
const pluginMeta = document.querySelector('#plugin-meta');
const viewTitle = document.querySelector('#view-title');
const comingTitle = document.querySelector('#coming-title');
const comingText = document.querySelector('#coming-text');
let toastTimer;
let sending = false;
let studioSessionId = null;
let studioConnected = false;
let studioPlaceName = null;
let studioPlaceId = null;
let studioContext = null;
let studioLastCommand = null;
let connectWaiting = false;

const PLUGIN_VERSION = '1.1.0';
const PLUGIN_DOWNLOADED_KEY = 'lua_x_plugin_downloaded';
const DOWNLOAD_COPY = 'Roblox Plugin installed by LUA-X.';

function showToast(message) {
  if (!toast) return;
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 3200);
}

function esc(v) {
  return String(v).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

function addMessage(text, kind) {
  const el = document.createElement('div');
  el.className = `msg ${kind}`;
  el.innerHTML = `<span class="msg-sender">${kind === 'user' ? 'You' : kind === 'error' ? 'LUA-X · error' : 'LUA-X'}</span><span class="msg-text">${esc(text)}</span>`;
  messagesEl.appendChild(el);
  messagesEl.scrollTop = messagesEl.scrollHeight;
  return el;
}

function setSending(value) {
  sending = value;
  sendButton.disabled = value;
  sendButton.querySelector('span:last-child').textContent = value ? 'Thinking…' : 'Send';
}

function relativeTime(ms) {
  if (!ms) return '—';
  const secs = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (secs < 5) return 'just now';
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  return `${Math.floor(mins / 60)}h ago`;
}

async function getJson(path) {
  const r = await fetch(`${API_BASE}${path}`, { headers: { accept: 'application/json' }, cache: 'no-store' });
  const b = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(b.error || `Request failed (${r.status})`);
  return b;
}

async function postJson(path, body) {
  const r = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify(body),
  });
  const b = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(b.error || `Request failed (${r.status})`);
  return b;
}

async function refreshHealth() {
  try {
    const h = await getJson('/api/health');
    backendStatus.textContent = h.status === 'ok' ? 'Online' : 'Degraded';
    backendStatus.classList.add('ok');
    const a = await getJson('/api/ai/status');
    aiStatus.textContent = a.configured ? 'AI Ready' : 'AI not configured';
    aiStatus.classList.toggle('ok', Boolean(a.configured));
    modelLabel.textContent = a.configured ? `NVIDIA · ${a.model}` : 'NVIDIA · not configured';
  } catch {
    backendStatus.textContent = 'Offline';
    backendStatus.classList.remove('ok');
    aiStatus.textContent = 'AI —';
    aiStatus.classList.remove('ok');
    modelLabel.textContent = 'NVIDIA · not configured';
  }
}

function renderStudioCard() {
  if (studioConnected) {
    const secs = Math.max(0, Math.round((Date.now() - (studioLastSeen || 0)) / 1000));
    studioPulse.classList.add('online');
    studioLabel.textContent = `Studio connected · ${studioPlaceName || 'Roblox Studio'}`;
    studioDetail.textContent = `session ${(studioSessionId || '—').slice(0, 8)} · seen ${secs}s ago · v${studioPluginVersion || '?'}`;
    pingButton.disabled = false;
    pingButton2.disabled = false;
    syncContextButton.disabled = false;
    studioCard?.classList.add('connected');
    studioBigStatus.textContent = '● Online';
    studioBigStatus.className = 'plugin-status online';
    studioSubtitle.textContent = 'Session bridge · online';
    rowProject.textContent = studioPlaceName || '—';
    rowPlace.textContent = studioPlaceId || '—';
    rowSession.textContent = studioSessionId ? studioSessionId.slice(0, 8) : '—';
    rowLastPing.textContent = relativeTime(studioLastCommand && studioLastCommand.type === 'ping' ? studioLastCommand.at : null);
    rowContext.textContent = studioContext
      ? `Synced · ${studioContext.scripts} script${studioContext.scripts === 1 ? '' : 's'} · ${studioContext.selection} selected`
      : 'Not synced';
    pluginStatus.textContent = 'Installed · connected';
    pluginStatus.className = 'plugin-status online';
    if (connectWaiting) {
      connectWaiting = false;
      waitingBox?.classList.add('hidden');
      connectNow.textContent = 'Connect Now';
      showToast('Studio session detected — you are online. ✓');
    }
  } else {
    studioSessionId = null;
    studioPulse.classList.remove('online');
    studioLabel.textContent = 'Studio offline';
    studioDetail.textContent = 'Open the LUA-X plugin in Roblox Studio and press Connect';
    pingButton.disabled = true;
    pingButton2.disabled = true;
    syncContextButton.disabled = true;
    studioCard?.classList.remove('connected');
    studioBigStatus.textContent = '● Offline';
    studioBigStatus.className = 'plugin-status';
    studioSubtitle.textContent = 'Session bridge';
    rowProject.textContent = '—';
    rowPlace.textContent = '—';
    rowSession.textContent = '—';
    rowLastPing.textContent = '—';
    rowContext.textContent = 'Not synced';
    if (connectWaiting) {
      waitingBox?.classList.remove('hidden');
    }
  }
}

let studioLastSeen = null;
let studioPluginVersion = null;

async function refreshStudio() {
  try {
    const s = await getJson('/api/studio/status');
    if (s.connected) {
      studioSessionId = s.sessionId || null;
      studioPlaceName = s.placeName || null;
      studioPlaceId = s.placeId || null;
      studioContext = s.context || null;
      studioLastCommand = s.lastCommand || null;
      studioLastSeen = s.lastSeenAt || Date.now();
      studioPluginVersion = s.pluginVersion || null;
      studioConnected = true;
    } else {
      studioConnected = false;
    }
  } catch {
    studioConnected = false;
  }
  renderStudioCard();
}

async function pingStudio() {
  if (!studioSessionId) {
    showToast('Studio is not connected.');
    return;
  }
  try {
    await postJson('/api/studio/command', { sessionId: studioSessionId, type: 'ping' });
    showToast('Ping sent to Studio — watch for the handshake flash.');
  } catch (e) {
    showToast(e instanceof Error ? e.message : 'Ping failed.');
  }
}

async function syncContext() {
  if (!studioSessionId) {
    showToast('Studio is not connected.');
    return;
  }
  try {
    await postJson('/api/studio/command', { sessionId: studioSessionId, type: 'refresh_context' });
    showToast('Context sync requested from Studio.');
  } catch (e) {
    showToast(e instanceof Error ? e.message : 'Sync failed.');
  }
}

function connectNowFlow() {
  if (studioConnected) {
    showToast('Studio is already connected.');
    return;
  }
  connectWaiting = true;
  waitingBox?.classList.remove('hidden');
  connectNow.textContent = 'Waiting for Studio…';
  showToast('Waiting for Roblox Studio to connect…');
}

function openStudioFlow() {
  showToast('1. Download LUA-X.lua  →  2. Put it in your Roblox Plugins folder  →  3. Restart Studio and click the LUA-X button');
}

function markPluginDownloaded() {
  try { localStorage.setItem(PLUGIN_DOWNLOADED_KEY, '1'); } catch { /* ignore */ }
  pluginStatus.textContent = 'Downloaded · waiting for Studio';
  pluginStatus.className = 'plugin-status';
  showToast('Downloading LUA-X.lua — place it in your Roblox Plugins folder.');
}

async function loadManifest() {
  try {
    const r = await fetch('/download/plugin-manifest.json', { cache: 'no-store' });
    if (!r.ok) return;
    const m = await r.json();
    if (pluginMeta && m.sha256) pluginMeta.textContent = `SHA-256 ${m.sha256.slice(0, 12)}… · v${m.version || PLUGIN_VERSION}`;
  } catch { /* manifest is optional */ }
}

async function send() {
  const text = promptEl.value.trim();
  if (!text || sending) return;
  addMessage(text, 'user');
  promptEl.value = '';
  setSending(true);
  composerNote.textContent = 'LUA-X is preparing an answer…';
  const typing = addMessage('LUA-X is thinking…', 'typing');
  const body = { prompt: text, projectId: 'web', mode: 'chat' };
  if (studioConnected && studioSessionId) {
    body.sessionId = studioSessionId;
    body.context = studioContext ? {
      projectId: studioPlaceId,
      placeName: studioPlaceName,
      scripts: studioContext.scripts,
      selection: studioContext.selection,
    } : { projectId: studioPlaceId, placeName: studioPlaceName };
  }
  try {
    const b = await postJson('/api/ai/generate', body);
    const reply = (typeof b.response === 'string' && b.response) || (b.plan && b.plan.summary) || 'No response from backend.';
    typing.remove();
    addMessage(reply, 'assistant');
    composerNote.textContent = studioConnected
      ? 'Answered with your live Studio context. Use Sync Context in Plugins to refresh it.'
      : 'Answered by LUA-X. Connect Studio (Plugins) to make chat project-aware.';
  } catch (e) {
    typing.remove();
    addMessage(e instanceof Error ? e.message : 'AI generation failed.', 'error');
    composerNote.textContent = 'Request failed. Check that the backend is running and the AI provider is configured.';
    showToast('Failed to reach the LUA-X backend.');
  } finally {
    setSending(false);
  }
}

function switchView(name) {
  document.querySelectorAll('.nav-item').forEach(item => item.classList.toggle('active', item.dataset.view === name));
  document.querySelectorAll('.view').forEach(view => view.classList.add('hidden'));
  const titles = { chat: 'Chat', plugins: 'Plugins', projects: 'Projects', history: 'History' };
  viewTitle.textContent = titles[name] || 'LUA-X';
  if (name === 'chat') document.querySelector('#view-chat').classList.remove('hidden');
  else if (name === 'plugins') document.querySelector('#view-plugins').classList.remove('hidden');
  else {
    comingTitle.textContent = (titles[name] || 'Section') + ' — coming soon';
    comingText.textContent = name === 'projects'
      ? 'Per-project workspaces and saved game context land here next.'
      : 'A history of plans, applies, and verifications will appear here.';
    document.querySelector('#view-coming').classList.remove('hidden');
  }
}

function bindViewNav() {
  document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', e => {
      e.preventDefault();
      switchView(item.dataset.view);
    });
  });
}

sendButton?.addEventListener('click', send);
pingButton?.addEventListener('click', pingStudio);
pingButton2?.addEventListener('click', pingStudio);
syncContextButton?.addEventListener('click', syncContext);
connectNow?.addEventListener('click', connectNowFlow);
openStudio?.addEventListener('click', openStudioFlow);
downloadPlugin?.addEventListener('click', markPluginDownloaded);
downloadPlugin2?.addEventListener('click', markPluginDownloaded);
promptEl?.addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    send();
  }
});
bindViewNav();

addMessage('Hi, I\'m LUA-X. Ask me to write Luau code, design a Roblox system, or solve a scripting problem.', 'assistant');
refreshHealth();
refreshStudio();
loadManifest();
setInterval(refreshHealth, 30000);
setInterval(refreshStudio, 4000);
setInterval(() => renderStudioCard(), 1000);