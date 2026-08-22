/* LUA-X Mission Control — the website mirrors the twin-AI Studio session.
   Chat lives inside Roblox Studio; this page watches the bridge live. */
'use strict';

/* ===== helpers ===== */
const $ = (sel) => document.querySelector(sel);
function esc(v) { return String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
let toastTimer;
function showToast(message) {
  const t = $('#toast');
  if (!t) return;
  t.textContent = message;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 3200);
}
async function resolveApiBase() {
  try {
    const r = await fetch('/api/config', { cache: 'no-store' });
    if (r.ok) { const j = await r.json(); return (j && j.apiBase) || ''; }
  } catch { /* fall through */ }
  return '';
}

/* ===== token ===== */
const TOKEN_KEY = 'lua_x_api_token';
function getToken() { try { return localStorage.getItem(TOKEN_KEY) || ''; } catch { return ''; } }
function saveToken(value) { try { localStorage.setItem(TOKEN_KEY, value); } catch { /* ignore */ } }
function clearToken() { try { localStorage.removeItem(TOKEN_KEY); } catch { /* ignore */ } }
function authHeaders() { const t = getToken(); return t ? { authorization: `Bearer ${t}` } : {}; }

/* ===== fetch helpers ===== */
let API_BASE = '';
let apiBaseReady = false;
async function ensureApiBase() { if (!apiBaseReady) { API_BASE = await resolveApiBase() || ''; apiBaseReady = true; } return API_BASE; }
function url(path) { return `${API_BASE}${path}`; }
async function getJson(path) { const r = await fetch(url(path), { headers: { accept: 'application/json', ...authHeaders() }, cache: 'no-store' }); if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); }
async function postJson(path, body) {
  const r = await fetch(url(path), {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json', ...authHeaders() },
    body: JSON.stringify(body),
  });
  let j = null; try { j = await r.json(); } catch { /* ignore */ }
  return { status: r.status, ok: r.ok, body: j };
}
async function fetchDetailed(path, init = {}) {
  const started = Date.now();
  try {
    const r = await fetch(url(path), { cache: 'no-store', ...init });
    let body = null;
    try { body = await r.json(); } catch { /* non-JSON */ }
    return { reached: true, status: r.status, body, ms: Date.now() - started };
  } catch (e) {
    return { reached: false, status: 0, body: null, error: e instanceof Error ? e.message : 'network', ms: Date.now() - started };
  }
}

/* ===== element refs ===== */
const backendStatus = $('#backend-status');
const aiStatus = $('#ai-status');
const modelLabel = $('#model-label');
const studioPulse = $('#studio-pulse');
const studioLabel = $('#studio-label');
const studioDetail = $('#studio-detail');
const latencyChip = $('#latency-chip');
const downloadPlugin = $('#download-plugin');
const downloadPlugin2 = $('#download-plugin-2');
const pluginMeta = $('#plugin-meta');
const versionWarning = $('#version-warning');
const versionInstalled = $('#version-installed');
const versionRequired = $('#version-required');
const connectNowBtn = $('#connect-now');
const cancelConnectBtn = $('#cancel-connect');
const pingButtons = [$('#ping-studio'), $('#ping-studio-2')].filter(Boolean);
const disconnectBtn = $('#disconnect-studio');
const runDiagnosticsBtn = $('#run-diagnostics');
const testBridgeBtn = $('#test-bridge');
const waitingBox = $('#waiting-box');
const waitingTitle = $('#waiting-title');
const waitingSteps = $('#waiting-steps');
const rows = {
  connection: $('#row-connection'), project: $('#row-project'), place: $('#row-place'),
  plugin: $('#row-plugin'), heartbeat: $('#row-heartbeat'), session: $('#row-session'),
};
const checklist = {
  download: $('#check-download'), backend: $('#check-backend'), ai: $('#check-ai'), session: $('#check-session'),
};
const agentFeed = $('#agent-feed');
const agentState = $('#agent-activity-state');
const threadFeed = $('#thread-feed');
const threadState = $('#thread-state');

/* ===== state ===== */
const PLUGIN_DOWNLOADED_KEY = 'lua_x_plugin_downloaded';
const REQUIRED_FALLBACK = '2.1.0';
let requiredPluginVersion = REQUIRED_FALLBACK;
let studioConnected = false;
let studioSessionId = null;
let studioPlaceName = null;
let studioPlaceId = null;
let studioPluginVersion = null;
let studioLastSeen = 0;
let bridgeUp = false;
let connectRequestId = null;
let connectStartedAt = 0;
let pingSentAt = 0;
let lastPingAckAt = 0;
let agentFeedLastAt = 0;
let threadLastCount = -1;

/* ===== health pills ===== */
function setPill(el, ok, text) {
  if (!el) return;
  el.textContent = text;
  el.className = `status-pill ${ok === null ? '' : ok ? 'ok' : 'bad'}`;
}
async function refreshHealth() {
  const api = await fetchDetailed('/api/health');
  const up = api.reached && api.status === 200;
  setPill(backendStatus, up ? true : false, up ? 'API online' : 'API offline');
  if (checklist.backend) checklist.backend.className = up ? 'ok' : 'bad';
  bridgeUp = up;
  let ready = null; let model = ''; let vision = '';
  if (up) {
    const readyRes = await fetchDetailed('/api/ready');
    ready = readyRes.status === 200;
    try {
      const st = await getJson('/api/ai/status');
      model = typeof st.model === 'string' ? st.model : '';
      vision = typeof st.visionModel === 'string' ? st.visionModel : '';
      const twin = st.agents && st.agents.architect === 'twin';
      setPill(aiStatus, ready === true, ready ? (twin ? 'Twin-AI ready' : 'AI ready') : 'AI not configured');
    } catch { setPill(aiStatus, null, 'AI —'); }
  } else {
    setPill(aiStatus, false, 'AI —');
  }
  if (modelLabel) {
    modelLabel.textContent = model ? `NVIDIA · ${model.replace(/^.*\//, '')}` : '';
    modelLabel.title = vision ? `vision: ${vision}` : '';
  }
  if (ready !== null && checklist.ai) checklist.ai.className = ready ? 'ok' : 'bad';
}

/* ===== manifest / versions ===== */
function versionAtLeast(installed, required) {
  const a = String(installed || '').split('.').map((n) => parseInt(n, 10) || 0);
  const b = String(required || '').split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    if ((a[i] || 0) !== (b[i] || 0)) return (a[i] || 0) > (b[i] || 0);
  }
  return true;
}
async function loadManifest() {
  try {
    const r = await fetch('/download/plugin-manifest.json', { cache: 'no-store' });
    if (!r.ok) return;
    const m = await r.json();
    if (m.version) requiredPluginVersion = m.version;
    if (versionRequired) versionRequired.textContent = m.version || REQUIRED_FALLBACK;
    if (pluginMeta && m.sha256) pluginMeta.textContent = `SHA-256 ${String(m.sha256).slice(0, 16)}… · v${m.version || '?'}`;
  } catch { /* optional */ }
}

/* ===== downloads ===== */
function pluginDownloadedFlag() { try { return localStorage.getItem(PLUGIN_DOWNLOADED_KEY) === '1'; } catch { return false; } }
function markDownloaded() {
  try { localStorage.setItem(PLUGIN_DOWNLOADED_KEY, '1'); } catch { /* ignore */ }
  if (checklist.download) checklist.download.className = pluginDownloadedFlag() ? 'ok' : '';
  showToast('LUA-X.lua downloaded — drop it into your Plugins folder and restart Studio.');
}
[downloadPlugin, downloadPlugin2, $('#version-download')].forEach((el) => el && el.addEventListener('click', markDownloaded));

/* ===== studio status polling ===== */
function renderStudio(s) {
  const live = Boolean(s && s.connected);
  studioConnected = live;
  if (live) {
    studioSessionId = s.sessionId || studioSessionId;
    studioPlaceName = s.placeName || studioPlaceName;
    studioPlaceId = s.placeId || s.projectId || studioPlaceId;
    studioPluginVersion = s.pluginVersion || studioPluginVersion;
    studioLastSeen = s.lastSeenAt || Date.now();
    studioPulse.className = 'status-ring online';
    studioLabel.textContent = `LIVE · ${studioPlaceName || 'Roblox Studio'}`;
    studioDetail.textContent = `Place ${studioPlaceId || '?'} · plugin v${studioPluginVersion || '?'} · heartbeat ${Math.max(0, Math.round((Date.now() - studioLastSeen) / 1000))}s ago`;
    if (rows.connection) rows.connection.textContent = 'Connected';
    if (rows.project) rows.project.textContent = studioPlaceName || '—';
    if (rows.place) rows.place.textContent = studioPlaceId || '—';
    if (rows.plugin) rows.plugin.textContent = studioPluginVersion ? `v${studioPluginVersion}` : '—';
    if (rows.heartbeat) rows.heartbeat.textContent = `${Math.max(0, Math.round((Date.now() - studioLastSeen) / 1000))}s ago`;
    if (rows.session) rows.session.textContent = studioSessionId ? `${String(studioSessionId).slice(0, 8)}…` : '—';
    if (checklist.session) checklist.session.className = 'ok';
    if (connectRequestId) finishConnect(true);
    if (pingSentAt && s.lastCommand && s.lastCommand.type === 'ping' && s.lastCommand.at >= pingSentAt && lastPingAckAt !== s.lastCommand.at) {
      lastPingAckAt = s.lastCommand.at;
      const ms = Math.max(1, lastPingAckAt - pingSentAt);
      if (latencyChip) { latencyChip.textContent = `Bridge ${ms} ms · LIVE`; latencyChip.classList.remove('hidden'); }
      pingButtons.forEach((b) => { b.textContent = 'Ping Studio'; b.disabled = false; });
      showToast(`Bridge round-trip confirmed in ${ms} ms.`);
    }
    const outdated = studioPluginVersion && !versionAtLeast(studioPluginVersion, requiredPluginVersion);
    if (versionWarning) versionWarning.classList.toggle('hidden', !outdated);
    if (outdated && versionInstalled) versionInstalled.textContent = `v${studioPluginVersion}`;
  } else {
    studioPulse.className = 'status-ring offline';
    if (!connectRequestId) {
      studioLabel.textContent = 'Studio offline';
      studioDetail.textContent = 'Open the LUA-X plugin in Roblox Studio to connect';
    }
    if (rows.connection) rows.connection.textContent = 'Waiting for Studio…';
    if (checklist.session) checklist.session.className = '';
    pingButtons.forEach((b) => { if (b.id !== 'ping-studio-2') b.disabled = true; });
  }
  connectNowBtn.classList.toggle('hidden', live || Boolean(connectRequestId));
  cancelConnectBtn.classList.toggle('hidden', !connectRequestId);
  disconnectBtn.classList.toggle('hidden', !live);
  pingButtons.forEach((b) => b.classList.toggle('hidden', !live));
}
async function refreshStudio() {
  const s = await fetchDetailed('/api/studio/status?projectId=web');
  if (s.reached && s.status === 200 && s.body) renderStudio(s.body);
  else if (s.reached) renderStudio({ connected: false });
}

/* ===== connect flow ===== */
function stage(text, sub) {
  if (waitingBox) waitingBox.classList.remove('hidden');
  if (waitingTitle) waitingTitle.textContent = text;
  if (waitingSteps) waitingSteps.innerHTML = sub;
}
function finishConnect(successful) {
  connectRequestId = null;
  clearInterval(connectTimer);
  connectTimer = null;
  if (waitingBox) waitingBox.classList.add('hidden');
  if (successful) showToast('Studio connected — you can chat inside Roblox Studio now.');
}
let connectTimer = null;
async function connectNowFlow() {
  if (studioConnected) { showToast('Studio is already connected.'); return; }
  await ensureApiBase();
  connectStartedAt = Date.now();
  const health = await fetchDetailed('/api/health');
  if (!health.reached || health.status !== 200) {
    showError('Backend unreachable', health, 'Start the API server or check the Vercel deployment.');
    return;
  }
  const detail = await postJson('/api/studio/connect', { projectId: 'web' });
  if (!detail.ok || !detail.body || !detail.body.requestId) {
    showError('Connection request failed', { status: detail.status, requestId: detail.body && detail.body.requestId }, 'The API answered but did not create a request.');
    return;
  }
  connectRequestId = detail.body.requestId;
  stage('Connecting to Roblox Studio…', `Request <code>${esc(String(connectRequestId).slice(0, 18))}…</code> created — open the LUA-X plugin in Studio to claim it.`);
  connectTimer = setInterval(refreshConnectStatus, 1500);
  setTimeout(() => { if (connectRequestId) cancelConnectFlow('Timed out after 60s — was the plugin running?'); }, 60000);
}
function refreshConnectStatus() {
  if (!connectRequestId) return;
  getJson(`/api/studio/connect/status?requestId=${encodeURIComponent(connectRequestId)}`)
    .then((c) => {
      if (c.status === 'fulfilled') finishConnect(true);
      else if (c.status === 'expired') cancelConnectFlow('Request expired — try again with the plugin open.');
      else if (connectStartedAt && Date.now() - connectStartedAt > 500) {
        stage('Waiting for the plugin…', 'Open LUA-X in Roblox Studio — it claims this request automatically within a few seconds.');
      }
    })
    .catch(() => { /* keep waiting */ });
}
function cancelConnectFlow(reason) {
  finishConnect(false);
  if (reason) showToast(reason);
}
function showError(title, detail, hint) {
  const box = $('#connect-error-box');
  if (!box) return;
  box.classList.remove('hidden');
  const t = $('#connect-error-title'); if (t) t.textContent = title;
  const ep = $('#connect-error-endpoint'); if (ep) ep.textContent = `Endpoint ${API_BASE || '(same origin)'}`;
  const http = $('#connect-error-http'); if (http) http.textContent = `HTTP ${detail && detail.status ? detail.status : '—'}${detail && detail.ms ? ` · ${detail.ms}ms` : ''}`;
  const req = $('#connect-error-request'); if (req) req.textContent = `Request ${detail && detail.requestId ? String(detail.requestId).slice(0, 20) : '—'}`;
  const h = $('#connect-error-hint'); if (h) h.textContent = hint || '';
  setTimeout(() => box.classList.add('hidden'), 12000);
}

/* ===== ping + latency ===== */
async function pingStudio() {
  if (!studioSessionId) { showToast('Studio is not connected.'); return; }
  pingSentAt = Date.now();
  pingButtons.forEach((b) => { b.textContent = 'Pinging…'; b.disabled = true; });
  try { await postJson('/api/studio/command', { sessionId: studioSessionId, type: 'ping' }); } catch { pingButtons.forEach((b) => { b.textContent = 'Ping Studio'; b.disabled = false; }); }
}

/* ===== disconnect ===== */
async function disconnectStudio() {
  if (!studioSessionId) return;
  try { await postJson('/api/studio/disconnect', { sessionId: studioSessionId }); } catch { /* TTL expires */ }
  studioConnected = false;
  renderStudio({ connected: false });
  showToast('Studio session disconnected.');
}

/* ===== diagnostics ===== */
function mark(id, ok, text) {
  const el = document.getElementById(id);
  if (el) { el.textContent = `${ok ? 'PASS' : 'FAIL'} ${text}`; el.className = ok ? 'ok' : 'bad'; }
}
async function runDiagnosticsFlow() {
  const box = $('#diagnostics-box');
  if (box) box.classList.remove('hidden');
  const summary = $('#diag-summary'); if (summary) summary.textContent = 'Running checks…';
  mark('diag-website', true, 'Website loaded');
  const api = await fetchDetailed('/api/health');
  mark('diag-api', api.reached && api.status === 200, api.reached ? `API HTTP ${api.status}` : 'API unreachable');
  const status = await fetchDetailed('/api/studio/status?projectId=web');
  mark('diag-bridge', status.reached && status.status === 200, status.reached ? `Bridge HTTP ${status.status}` : 'Bridge unreachable');
  const connected = Boolean(status.body && status.body.connected);
  const connect = await postJson('/api/studio/connect', { projectId: 'web' });
  mark('diag-connect', connect.ok && connect.body && connect.body.requestId, connect.ok ? 'Connect endpoint OK' : 'Connect failed');
  const pending = connect.ok ? await getJson('/api/studio/connect/pending').catch(() => null) : null;
  mark('diag-pending', pending !== null, pending && pending.request ? 'Pending request visible to plugin' : 'No pending request (plugin may claim instantly)');
  mark('diag-session', connected, connected ? 'Studio session registered' : 'No live session (open the plugin)');
  mark('diag-heartbeat', connected, connected ? `Last seen ${Math.round((Date.now() - (status.body.lastSeenAt || Date.now())) / 1000)}s ago` : 'Requires live session');
  let commandOk = false;
  if (connected) { const c = await postJson('/api/studio/command', { sessionId: studioSessionId, type: 'refresh_context' }); commandOk = c.ok; }
  mark('diag-command', commandOk, commandOk ? 'Command queued to plugin' : 'Requires live session');
  mark('diag-ping', connected, connected ? (latencyChip && !latencyChip.classList.contains('hidden') ? latencyChip.textContent : 'Press Ping Studio to measure round-trip') : 'Requires live session');
  if (summary) summary.textContent = 'Diagnostics complete.';
}

async function testBridgeFlow() {
  const box = $('#bridge-test-box');
  if (box) box.classList.remove('hidden');
  const wait = $('#bridge-test-wait');
  const api = await fetchDetailed('/api/health');
  mark('bridge-test-api', api.reached && api.status === 200, api.reached ? `API HTTP ${api.status}` : 'API unreachable');
  const status = await fetchDetailed('/api/studio/status?projectId=web');
  mark('bridge-test-status', status.reached && status.status === 200, status.reached ? `Bridge HTTP ${status.status}` : 'Bridge unreachable');
  const connect = await postJson('/api/studio/connect', { projectId: 'web' });
  const ok = connect.ok && connect.body && connect.body.requestId;
  mark('bridge-test-connect', ok, ok ? 'Connect endpoint OK' : 'Connect failed');
  mark('bridge-test-request', ok, ok ? `Request ${String(connect.body.requestId).slice(0, 14)}…` : 'Not created');
  if (wait) wait.textContent = ok ? 'Waiting for the plugin to claim it — or press Connect to watch.' : 'Website → API path broken. Check the deployment.';
  if (ok) { connectRequestId = connect.body.requestId; connectStartedAt = Date.now(); connectTimer = setInterval(refreshConnectStatus, 1500); }
}

/* ===== agents feed ===== */
function renderAgentEvents(events) {
  if (!agentFeed || !Array.isArray(events)) return;
  const fresh = events.filter((e) => e && typeof e.at === 'number' && e.at > agentFeedLastAt);
  if (!fresh.length) return;
  agentFeedLastAt = fresh[fresh.length - 1].at;
  for (const e of fresh) {
    const role = String(e.role || 'AGENT').toUpperCase();
    const color = role.includes('ARCHITECT') ? '#8ab4ff' : role.includes('BUILDER') ? '#7fd1a8' : role === 'VISION' ? '#e0b36a' : '#9aa3b5';
    const row = document.createElement('div');
    row.className = 'agent-event-row';
    row.innerHTML = `<span style="color:${color};font-weight:800">${esc(role)}</span> <span style="opacity:.55">${new Date(e.at).toLocaleTimeString()}</span><br>${esc(String(e.message || '').slice(0, 220))}`;
    agentFeed.prepend(row);
    while (agentFeed.children.length > 80) agentFeed.removeChild(agentFeed.lastChild);
  }
  if (agentState) agentState.textContent = 'streaming';
}
async function refreshAgentFeed() {
  if (!studioConnected || !studioSessionId || !agentFeed) return;
  try {
    const data = await getJson(`/api/studio/agent-events?sessionId=${encodeURIComponent(studioSessionId)}&since=${agentFeedLastAt}`);
    if (data && Array.isArray(data.events)) renderAgentEvents(data.events);
  } catch { /* best-effort */ }
}

/* ===== shared thread mirror ===== */
function renderThread(messages) {
  if (!threadFeed) return;
  threadFeed.innerHTML = '';
  for (const m of messages.slice(-30)) {
    const div = document.createElement('div');
    div.className = `thread-msg ${m.role === 'user' ? 'user' : 'assistant'}`;
    const who = m.role === 'user' ? 'YOU (in Studio)' : 'LUA-X';
    const when = typeof m.at === 'number' ? ` · ${new Date(m.at).toLocaleTimeString()}` : '';
    div.innerHTML = `<div class="who">${esc(who + when)}</div><div class="body">${esc(String(m.content || '').slice(0, 900))}</div>`;
    threadFeed.appendChild(div);
  }
  threadFeed.scrollTop = threadFeed.scrollHeight;
}
async function refreshThread() {
  if (!studioConnected || !studioSessionId || !threadFeed) return;
  try {
    const data = await getJson(`/api/studio/chat?sessionId=${encodeURIComponent(studioSessionId)}`);
    if (data && Array.isArray(data.messages)) {
      if (data.messages.length !== threadLastCount) {
        threadLastCount = data.messages.length;
        renderThread(data.messages);
        if (threadState) threadState.textContent = `${data.messages.length} messages mirrored`;
      }
    }
  } catch { /* best-effort */ }
}

/* ===== settings ===== */
const tokenInput = $('#token-input');
$('#save-token')?.addEventListener('click', () => { saveToken(tokenInput.value.trim()); tokenInput.value = getToken(); showToast('Token saved.'); });
$('#clear-token')?.addEventListener('click', () => { clearToken(); tokenInput.value = ''; showToast('Token cleared.'); });

/* ===== navigation ===== */
function switchView(name) {
  for (const section of document.querySelectorAll('.view')) section.classList.add('hidden');
  const target = $(`#view-${name}`);
  if (target) target.classList.remove('hidden');
  for (const link of document.querySelectorAll('.nav-link')) link.classList.toggle('active', link.dataset.view === name);
  location.hash = name;
}
for (const link of document.querySelectorAll('.nav-link')) {
  link.addEventListener('click', (ev) => { ev.preventDefault(); switchView(link.dataset.view); });
}

/* ===== boot ===== */
(async function init() {
  await ensureApiBase();
  await loadManifest();
  if (tokenInput) tokenInput.value = getToken();
  if (checklist.download) checklist.download.className = pluginDownloadedFlag() ? 'ok' : '';
  connectNowBtn.addEventListener('click', () => { connectNowFlow(); });
  cancelConnectBtn.addEventListener('click', () => cancelConnectFlow('Cancelled.'));
  pingButtons.forEach((b) => b.addEventListener('click', pingStudio));
  disconnectBtn.addEventListener('click', disconnectStudio);
  runDiagnosticsBtn.addEventListener('click', runDiagnosticsFlow);
  testBridgeBtn.addEventListener('click', testBridgeFlow);
  const initial = (location.hash || '#home').replace('#', '');
  switchView(['home', 'agents', 'settings'].includes(initial) ? initial : 'home');
  await refreshHealth();
  await refreshStudio();
  setInterval(refreshHealth, 30000);
  setInterval(refreshStudio, 4000);
  setInterval(refreshAgentFeed, 4000);
  setInterval(refreshThread, 6000);
})();
