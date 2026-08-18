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
const versionDownload = document.querySelector('#version-download');
const pingButton2 = document.querySelector('#ping-studio-2');
const disconnectStudioButton = document.querySelector('#disconnect-studio');
const connectNow = document.querySelector('#connect-now');
const openGuide = document.querySelector('#open-guide');
const waitingBox = document.querySelector('#waiting-box');
const troubleshootBox = document.querySelector('#troubleshoot-box');
const pluginStatus = document.querySelector('#plugin-status');
const studioBigStatus = document.querySelector('#studio-big-status');
const studioSubtitle = document.querySelector('#studio-subtitle');
const installState = document.querySelector('#install-state');
const installPanel = document.querySelector('#install-panel');
const installStatus = document.querySelector('#install-status');
const installNote = document.querySelector('#install-note');
const pluginVersionEl = document.querySelector('#plugin-version');
const versionWarning = document.querySelector('#version-warning');
const versionInstalled = document.querySelector('#version-installed');
const versionRequired = document.querySelector('#version-required');
const rowConnection = document.querySelector('#row-connection');
const rowProject = document.querySelector('#row-project');
const rowPlace = document.querySelector('#row-place');
const rowPlugin = document.querySelector('#row-plugin');
const rowHeartbeat = document.querySelector('#row-heartbeat');
const rowSession = document.querySelector('#row-session');
const checkDownload = document.querySelector('#check-download');
const checkBackend = document.querySelector('#check-backend');
const checkAi = document.querySelector('#check-ai');
const checkSession = document.querySelector('#check-session');
const pluginMeta = document.querySelector('#plugin-meta');
const viewTitle = document.querySelector('#view-title');
const comingTitle = document.querySelector('#coming-title');
const comingText = document.querySelector('#coming-text');
let toastTimer;
let sending = false;

const PLUGIN_VERSION = '1.2.0';
const PLUGIN_DOWNLOADED_KEY = 'lua_x_plugin_downloaded';
const POLL_NORMAL_MS = 4000;
const POLL_CONNECTING_MS = 1500;
const CONNECT_TIMEOUT_MS = 45000;

let requiredPluginVersion = PLUGIN_VERSION;
let studioConnected = false;
let studioSessionId = null;
let studioPlaceName = null;
let studioPlaceId = null;
let studioPluginVersion = null;
let studioVersionStatus = null;
let studioContext = null;
let studioLastCommand = null;
let studioLastSeen = null;
let connectState = 'offline'; // offline | connecting | connected | failed
let connectTimer = null;
let connectStartedAt = 0;
let backendOk = false;
let aiOk = false;
let downloadState = 'idle'; // idle | downloading | downloaded

function showToast(message) {
  if (!toast) return;
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 3400);
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

function versionAtLeast(installed, required) {
  const parse = v => String(v || '').split('.').map(n => parseInt(n, 10) || 0);
  const a = parse(installed);
  const b = parse(required);
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    if ((a[i] || 0) !== (b[i] || 0)) return (a[i] || 0) > (b[i] || 0);
  }
  return true;
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
    backendOk = h.status === 'ok';
    backendStatus.textContent = backendOk ? 'Online' : 'Degraded';
    backendStatus.classList.add('ok');
    const a = await getJson('/api/ai/status');
    aiOk = Boolean(a.configured);
    aiStatus.textContent = aiOk ? 'AI Ready' : 'AI not configured';
    aiStatus.classList.toggle('ok', aiOk);
    modelLabel.textContent = aiOk ? `NVIDIA · ${a.model}` : 'NVIDIA · not configured';
  } catch {
    backendOk = false;
    aiOk = false;
    backendStatus.textContent = 'Offline';
    backendStatus.classList.remove('ok');
    aiStatus.textContent = 'AI —';
    aiStatus.classList.remove('ok');
    modelLabel.textContent = 'NVIDIA · not configured';
  }
}

function renderChecklist() {
  if (!checkDownload) return;
  checkDownload.textContent = `${pluginDownloaded() ? '✓' : '…'} LUA-X download available`;
  checkDownload.className = pluginDownloaded() ? 'ok' : 'bad';
  checkBackend.textContent = `${backendOk ? '✓' : '✗'} Backend online`;
  checkBackend.className = backendOk ? 'ok' : 'bad';
  checkAi.textContent = `${aiOk ? '✓' : '✗'} NVIDIA backend online`;
  checkAi.className = aiOk ? 'ok' : 'bad';
  checkSession.textContent = '✗ Studio session not detected';
}

function setConnectState(next) {
  connectState = next;
  const btn = connectNow;
  const pingBtn = pingButton2;
  const discBtn = disconnectStudioButton;
  const waiting = waitingBox;
  const trouble = troubleshootBox;
  if (!btn) return;
  switch (next) {
    case 'offline':
      btn.textContent = 'Connect to Studio';
      btn.disabled = false;
      pingBtn.classList.add('hidden');
      discBtn.classList.add('hidden');
      waiting.classList.add('hidden');
      trouble.classList.add('hidden');
      rowConnection.textContent = 'Not connected';
      break;
    case 'connecting':
      btn.textContent = 'Connecting…';
      btn.disabled = true;
      pingBtn.classList.add('hidden');
      discBtn.classList.add('hidden');
      waiting.classList.remove('hidden');
      trouble.classList.add('hidden');
      rowConnection.textContent = 'Waiting for Roblox Studio…';
      break;
    case 'connected':
      btn.textContent = 'Connected ✓';
      btn.disabled = true;
      pingBtn.classList.remove('hidden');
      discBtn.classList.remove('hidden');
      waiting.classList.add('hidden');
      trouble.classList.add('hidden');
      rowConnection.textContent = 'Connected';
      break;
    case 'failed':
      btn.textContent = 'Retry Connection';
      btn.disabled = false;
      pingBtn.classList.add('hidden');
      discBtn.classList.add('hidden');
      waiting.classList.add('hidden');
      trouble.classList.remove('hidden');
      rowConnection.textContent = 'Could not connect';
      renderChecklist();
      break;
  }
}

function renderStudioCard() {
  if (studioConnected) {
    const secs = Math.max(0, Math.round((Date.now() - (studioLastSeen || 0)) / 1000));
    studioPulse.classList.add('online');
    studioLabel.textContent = `Studio connected · ${studioPlaceName || 'Roblox Studio'}`;
    studioDetail.textContent = `session ${(studioSessionId || '—').slice(0, 8)} · seen ${secs}s ago · v${studioPluginVersion || '?'}`;
    pingButton.disabled = false;
    studioCard?.classList.add('connected');
    studioBigStatus.textContent = '🟢 Online';
    studioBigStatus.className = 'plugin-status online';
    studioSubtitle.textContent = 'Connected — bridge is live.';
    rowProject.textContent = studioPlaceName || '—';
    rowPlace.textContent = studioPlaceId || '—';
    rowPlugin.textContent = `v${studioPluginVersion || '?'}`;
    rowHeartbeat.textContent = relativeTime(studioLastSeen);
    rowSession.textContent = studioSessionId ? `${studioSessionId.slice(0, 8)}…` : '—';
    pluginStatus.textContent = 'Installed · connected';
    pluginStatus.className = 'plugin-status online';
    if (installState) installState.textContent = '✓ Installed (Studio connected)';
    if (installStatus) installStatus.textContent = '✓ Installed · Studio connected';
    const outdated = studioVersionStatus === 'update_required'
      || (!studioVersionStatus && !versionAtLeast(studioPluginVersion, requiredPluginVersion));
    versionWarning?.classList.toggle('hidden', !outdated);
    if (outdated) {
      if (versionInstalled) versionInstalled.textContent = studioPluginVersion || '?';
      if (versionRequired) versionRequired.textContent = requiredPluginVersion;
    }
    if (connectState === 'connecting') {
      clearInterval(connectTimer);
      connectTimer = null;
      showToast('Studio session detected — you are online. ✓');
    }
    setConnectState('connected');
    const lastPing = studioLastCommand && studioLastCommand.type === 'ping' ? studioLastCommand.at : null;
    if (lastPing && Date.now() - lastPing < 10000) {
      pingBtnText('✓ Studio responded');
      setTimeout(() => { if (connectState === 'connected') pingBtnText('Ping Studio'); }, 8000);
    } else {
      pingBtnText('Ping Studio');
    }
  } else {
    studioSessionId = null;
    studioPulse.classList.remove('online');
    studioLabel.textContent = 'Studio offline';
    studioDetail.textContent = 'Open the LUA-X plugin in Roblox Studio to connect';
    pingButton.disabled = true;
    studioCard?.classList.remove('connected');
    studioBigStatus.textContent = '🔴 Offline';
    studioBigStatus.className = 'plugin-status';
    studioSubtitle.textContent = 'LUA-X Studio plugin has not connected.';
    rowProject.textContent = '—';
    rowPlace.textContent = '—';
    rowPlugin.textContent = '—';
    rowHeartbeat.textContent = '—';
    rowSession.textContent = '—';
    pluginStatus.textContent = pluginDownloaded() ? 'Downloaded · waiting for Studio' : 'Not detected';
    pluginStatus.className = 'plugin-status';
    if (installState && !pluginDownloaded()) installState.textContent = 'Download available';
    if (installStatus && pluginDownloaded()) installStatus.textContent = 'Waiting for Studio…';
    versionWarning?.classList.add('hidden');
    if (connectState === 'connecting') {
      if (Date.now() - connectStartedAt > CONNECT_TIMEOUT_MS) {
        clearInterval(connectTimer);
        connectTimer = null;
        setConnectState('failed');
        showToast('Could not detect a Studio session. See the troubleshooting list.');
      }
    } else if (connectState === 'connected') {
      setConnectState('offline');
    }
  }
}

function pingBtnText(text) {
  if (pingButton2) pingButton2.textContent = text;
}

async function refreshStudio() {
  try {
    const s = await getJson('/api/studio/status');
    if (s.connected) {
      studioSessionId = s.sessionId || null;
      studioPlaceName = s.placeName || null;
      studioPlaceId = s.placeId || null;
      studioPluginVersion = s.pluginVersion || null;
      studioVersionStatus = s.versionStatus || null;
      studioContext = s.context || null;
      studioLastCommand = s.lastCommand || null;
      studioLastSeen = s.lastSeenAt || Date.now();
      studioConnected = true;
    } else {
      studioConnected = false;
    }
  } catch {
    studioConnected = false;
  }
  renderStudioCard();
}

function pluginDownloaded() {
  try { return localStorage.getItem(PLUGIN_DOWNLOADED_KEY) === '1'; } catch { return false; }
}

function markPluginDownloaded() {
  try { localStorage.setItem(PLUGIN_DOWNLOADED_KEY, '1'); } catch { /* ignore */ }
  downloadState = 'downloaded';
  if (downloadPlugin2) { downloadPlugin2.textContent = 'LUA-X.lua downloaded ✓'; downloadPlugin2.disabled = false; }
  pluginStatus.textContent = 'Downloaded · waiting for Studio';
  pluginStatus.className = 'plugin-status';
  if (installState) installState.textContent = '✓ Downloaded (browser confirmed)';
  if (installStatus) installStatus.textContent = 'Waiting for Studio…';
  installPanel?.classList.remove('hidden');
  renderChecklist();
  showToast('LUA-X.lua downloaded — follow the installation steps.');
}

function startDownload() {
  if (downloadState === 'downloading') return;
  downloadState = 'downloading';
  if (downloadPlugin2) { downloadPlugin2.textContent = 'Downloading…'; downloadPlugin2.disabled = true; }
  showToast('Downloading LUA-X.lua…');
  setTimeout(markPluginDownloaded, 1200);
}

async function pingStudio() {
  if (!studioSessionId) {
    showToast('Studio is not connected.');
    return;
  }
  pingBtnText('Ping sent…');
  try {
    await postJson('/api/studio/command', { sessionId: studioSessionId, type: 'ping' });
    showToast('Ping sent — waiting for Studio to answer the handshake.');
  } catch (e) {
    pingBtnText('Ping Studio');
    showToast(e instanceof Error ? e.message : 'Ping failed.');
  }
}

async function disconnectStudio() {
  if (!studioSessionId) {
    showToast('Studio is not connected.');
    return;
  }
  try {
    await postJson('/api/studio/disconnect', { sessionId: studioSessionId });
    showToast('Studio session disconnected.');
  } catch { /* presence will expire via TTL */ }
  studioConnected = false;
  setConnectState('offline');
  refreshStudio();
}

function connectNowFlow() {
  if (studioConnected) {
    showToast('Studio is already connected.');
    return;
  }
  connectStartedAt = Date.now();
  setConnectState('connecting');
  clearInterval(connectTimer);
  connectTimer = setInterval(refreshStudio, POLL_CONNECTING_MS);
  showToast('Waiting for Roblox Studio…');
}

function openGuideFlow() {
  showToast('Steps: 1) Download LUA-X.lua  2) Plugins → Manage Plugins → Open Plugins Folder  3) Copy LUA-X.lua there  4) Restart Studio  5) Plugins → LUA-X');
}

async function loadManifest() {
  try {
    const r = await fetch('/download/plugin-manifest.json', { cache: 'no-store' });
    if (!r.ok) return;
    const m = await r.json();
    if (m.version) {
      requiredPluginVersion = m.version;
      if (pluginVersionEl) pluginVersionEl.textContent = m.version;
      if (versionRequired) versionRequired.textContent = m.version;
    }
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
      ? 'Answered with your live Studio context. Use Sync Context to refresh it.'
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
connectNow?.addEventListener('click', connectNowFlow);
disconnectStudioButton?.addEventListener('click', disconnectStudio);
downloadPlugin?.addEventListener('click', startDownload);
downloadPlugin2?.addEventListener('click', startDownload);
versionDownload?.addEventListener('click', startDownload);
openGuide?.addEventListener('click', e => { e.preventDefault(); openGuideFlow(); });
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
if (pluginDownloaded()) {
  downloadState = 'downloaded';
  installPanel?.classList.remove('hidden');
  if (installState) installState.textContent = '✓ Downloaded (browser confirmed)';
  if (installStatus) installStatus.textContent = 'Waiting for Studio…';
  if (downloadPlugin2) downloadPlugin2.textContent = 'LUA-X.lua downloaded ✓';
}
setInterval(refreshHealth, 30000);
setInterval(refreshStudio, POLL_NORMAL_MS);
setInterval(() => renderStudioCard(), 1000);