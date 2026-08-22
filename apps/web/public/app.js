let API_BASE = '';
let apiBaseResolved = false;
try {
  const override = localStorage.getItem('lua_x_api_base');
  if (override) API_BASE = override.replace(/\/+$/, '');
} catch { /* ignore */ }

async function resolveApiBase() {
  if (apiBaseResolved) return API_BASE;
  apiBaseResolved = true;
  if (API_BASE) return API_BASE;
  try {
    const r = await fetch('/api/config', { cache: 'no-store' });
    if (!r.ok) return API_BASE;
    const cfg = await r.json();
    if (cfg && typeof cfg.apiBase === 'string' && cfg.apiBase.startsWith('http')) {
      API_BASE = cfg.apiBase.replace(/\/+$/, '');
    }
  } catch { /* keep same-origin default */ }
  return API_BASE;
}
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
const cancelConnect = document.querySelector('#cancel-connect');
const runDiagnosticsBtn = document.querySelector('#run-diagnostics');
const diagnosticsBox = document.querySelector('#diagnostics-box');
const agentActivity = document.querySelector('#agent-activity');
const agentActivityState = document.querySelector('#agent-activity-state');
const agentFeed = document.querySelector('#agent-feed');
let agentFeedLastAt = 0;
function renderAgentEvents(events) {
  if (!agentFeed || !Array.isArray(events) || events.length === 0) return;
  const fresh = events.filter((e) => e && typeof e.at === 'number' && e.at > agentFeedLastAt);
  if (fresh.length === 0) return;
  agentFeedLastAt = fresh[fresh.length - 1].at;
  for (const e of fresh) {
    const row = document.createElement('div');
    row.className = 'agent-event-row';
    const role = (typeof e.role === 'string' ? e.role : 'AGENT').toUpperCase();
    const when = new Date(e.at).toLocaleTimeString();
    const color = role.includes('ARCHITECT') ? '#8ab4ff' : role.includes('BUILDER') ? '#7fd1a8' : role === 'VISION' ? '#e0b36a' : '#9aa3b5';
    row.innerHTML = `<span style="color:${color};font-weight:700">${esc(role)}</span> <span style="opacity:.6">${when}</span> — ${esc(String(e.message ?? '').slice(0, 160))}`;
    agentFeed.appendChild(row);
    while (agentFeed.children.length > 40) agentFeed.removeChild(agentFeed.firstChild);
  }
  agentFeed.scrollTop = agentFeed.scrollHeight;
}
async function refreshAgentFeed() {
  if (!studioConnected || !studioSessionId || !agentFeed) {
    if (agentActivityState) agentActivityState.textContent = 'idle';
    return;
  }
  try {
    const data = await getJson(`/api/studio/agent-events?sessionId=${encodeURIComponent(studioSessionId)}&since=${agentFeedLastAt}`);
    if (data && Array.isArray(data.events)) {
      renderAgentEvents(data.events);
      if (agentActivityState) agentActivityState.textContent = data.events.length > 0 ? 'active' : 'connected';
    }
  } catch { /* feed is best-effort */ }
}
setInterval(refreshAgentFeed, 4000);
const diagSummary = document.querySelector('#diag-summary');
const diagItems = {
  website: document.querySelector('#diag-website'),
  api: document.querySelector('#diag-api'),
  bridge: document.querySelector('#diag-bridge'),
  connect: document.querySelector('#diag-connect'),
  pending: document.querySelector('#diag-pending'),
  session: document.querySelector('#diag-session'),
  heartbeat: document.querySelector('#diag-heartbeat'),
  command: document.querySelector('#diag-command'),
  ping: document.querySelector('#diag-ping'),
};
const svcBackend = document.querySelector('#svc-backend');
const svcAi = document.querySelector('#svc-ai');
const svcBridge = document.querySelector('#svc-bridge');
const svcStudio = document.querySelector('#svc-studio');
const waitingTitle = document.querySelector('#waiting-title');
const waitingSteps = document.querySelector('#waiting-steps');
const connectErrorBox = document.querySelector('#connect-error-box');
const connectErrorTitle = document.querySelector('#connect-error-title');
const connectErrorEndpoint = document.querySelector('#connect-error-endpoint');
const connectErrorHttp = document.querySelector('#connect-error-http');
const connectErrorResponse = document.querySelector('#connect-error-response');
const connectErrorRequest = document.querySelector('#connect-error-request');
const connectErrorTiming = document.querySelector('#connect-error-timing');
const connectErrorHint = document.querySelector('#connect-error-hint');
const troubleshootTitle = document.querySelector('#troubleshoot-title');
const troubleshootSteps = document.querySelector('#troubleshoot-steps');
const testBridgeBtn = document.querySelector('#test-bridge');
const bridgeTestBox = document.querySelector('#bridge-test-box');
const bridgeTestItems = {
  api: document.querySelector('#bridge-test-api'),
  status: document.querySelector('#bridge-test-status'),
  connect: document.querySelector('#bridge-test-connect'),
  request: document.querySelector('#bridge-test-request'),
};
const bridgeTestWait = document.querySelector('#bridge-test-wait');
const pluginMeta = document.querySelector('#plugin-meta');
const viewTitle = document.querySelector('#view-title');
const comingTitle = document.querySelector('#coming-title');
const comingText = document.querySelector('#coming-text');
const tokenInput = document.querySelector('#token-input');
const saveTokenBtn = document.querySelector('#save-token');
const clearTokenBtn = document.querySelector('#clear-token');
const visionPanel = document.querySelector('#studio-vision');
const visionStatus = document.querySelector('#vision-status');
const visionSubtitle = document.querySelector('#vision-subtitle');
const visionTree = document.querySelector('#vision-tree');
const visionTreeMeta = document.querySelector('#vision-tree-meta');
const visionSelection = document.querySelector('#vision-selection');
const visionCounts = document.querySelector('#vision-counts');
const visionAssets = document.querySelector('#vision-assets');
const visionQueryInput = document.querySelector('#vision-query-input');
const visionQueryBtn = document.querySelector('#vision-query-btn');
const visionQueryResults = document.querySelector('#vision-query-results');
const visionForge = document.querySelector('#vision-forge');
// Dashboard + WEPPY-grade panels
const dashStatus = document.querySelector('#dash-status');
const dashTargets = document.querySelector('#dash-targets');
const dashSync = document.querySelector('#dash-sync');
const dashChange = document.querySelector('#dash-change');
const dashVerify = document.querySelector('#dash-verify');
const dashTargetsList = document.querySelector('#dash-targets-list');
const dashChangelog = document.querySelector('#dash-changelog');
const syncStatus = document.querySelector('#sync-status');
const syncActive = document.querySelector('#sync-active');
const syncDir = document.querySelector('#sync-dir');
const syncSourcemap = document.querySelector('#sync-sourcemap');
const syncPlaces = document.querySelector('#sync-places');
const syncHistory = document.querySelector('#sync-history');
const assetsCount = document.querySelector('#assets-count');
const assetsShared = document.querySelector('#assets-shared');
const assetsList = document.querySelector('#assets-list');
const assetsName = document.querySelector('#assets-name');
const assetsType = document.querySelector('#assets-type');
const playtestList = document.querySelector('#playtest-list');
let toastTimer;
let sending = false;

const TOKEN_KEY = 'lua_x_api_token';
const webChatHistory = [];

function getToken() {
  try { return localStorage.getItem(TOKEN_KEY) || ''; } catch { return ''; }
}

function saveToken(value) {
  try { localStorage.setItem(TOKEN_KEY, (value || '').trim()); } catch { /* ignore */ }
}

function clearToken() {
  try { localStorage.removeItem(TOKEN_KEY); } catch { /* ignore */ }
}

function authHeaders() {
  const token = getToken();
  return token ? { authorization: `Bearer ${token}` } : {};
}

function promptForToken() {
  const existing = getToken();
  const entered = window.prompt('This LUA-X API requires a token. Paste your LUA-X API token:', existing);
  if (entered === null) return false;
  const trimmed = entered.trim();
  if (!trimmed) {
    clearToken();
    return false;
  }
  saveToken(trimmed);
  return true;
}

  const PLUGIN_VERSION = '2.0.0';
const PLUGIN_DOWNLOADED_KEY = 'lua_x_plugin_downloaded';
const POLL_NORMAL_MS = 4000;
const POLL_CONNECTING_MS = 1200;
const CONNECT_TIMEOUT_MS = 25000;
const CONNECT_STAGE_1_MS = 5000;
const CONNECT_STAGE_2_MS = 15000;

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
let connectState = 'offline'; // offline | connecting | connected | failed | backend_error
let connectTimer = null;
let connectStartedAt = 0;
let connectRequestId = null;
let handshakeDone = false;
let backendOk = false;
let backendHttp = null;
let aiOk = false;
let aiHttp = null;
let bridgeUp = false;
let bridgeHttp = null;
let downloadState = 'idle'; // idle | downloading | downloaded
let sharedChatCount = 0;
let studioDeepContext = null;

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

function renderCode(text) {
  const parts = String(text).split(/```/);
  let out = '';
  let inCode = false;
  for (const part of parts) {
    if (inCode) {
      const lines = part.split('\n');
      if (lines[0] && /^[a-zA-Z0-9_-]{1,16}$/.test(lines[0].trim())) lines.shift();
      out += `<pre class="msg-code">${esc(lines.join('\n'))}</pre>`;
    } else if (part) {
      out += `<span class="msg-text">${esc(part)}</span>`;
    }
    inCode = !inCode;
  }
  return out;
}

function renderMessages() {
  if (!messagesEl) return;
  messagesEl.innerHTML = '';
  if (webChatHistory.length === 0) {
    const el = document.createElement('div');
    el.className = 'msg assistant';
    el.innerHTML = `<span class="msg-sender">LUA-X</span><span class="msg-text">${esc('Hi, I\'m LUA-X. Ask me to write Luau, design Roblox systems, or build UI, animation, VFX, sound, and 3D geometry. Connect the Studio plugin to make me see your whole workspace and share this chat across the website and Roblox Studio.')}</span>`;
    messagesEl.appendChild(el);
  } else {
    for (const entry of webChatHistory) {
      const el = document.createElement('div');
      el.className = `msg ${entry.role === 'user' ? 'user' : 'assistant'}`;
      el.innerHTML = `<span class="msg-sender">${entry.role === 'user' ? 'You' : 'LUA-X'}</span>${renderCode(entry.content)}`;
      messagesEl.appendChild(el);
    }
  }
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

async function refreshSharedChat() {
  if (!studioConnected || !studioSessionId) return;
  try {
    const c = await getJson(`/api/studio/chat?sessionId=${encodeURIComponent(studioSessionId)}`);
    if (!c || !Array.isArray(c.messages)) return;
    const messages = c.messages.filter(m => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string');
    if (messages.length < sharedChatCount) return;
    const merged = messages.slice(-50).map(m => ({ role: m.role, content: m.content }));
    webChatHistory.length = 0;
    for (const m of merged) webChatHistory.push(m);
    sharedChatCount = messages.length;
    renderMessages();
  } catch { /* transient sync error — retry on next poll */ }
}

async function refreshSharedContext() {
  if (!studioConnected || !studioSessionId) {
    if (visionPanel) visionPanel.classList.add('hidden');
    return;
  }
  try {
    const c = await getJson(`/api/studio/context?sessionId=${encodeURIComponent(studioSessionId)}`);
    if (c && c.context && typeof c.context === 'object') {
      studioDeepContext = c.context;
      renderVision(studioDeepContext);
    }
  } catch { /* context stays stale until next poll */ }
}

function renderVision(ctx) {
  if (!visionPanel || !ctx) return;
  visionPanel.classList.remove('hidden');
  if (visionStatus) { visionStatus.textContent = 'Live'; visionStatus.classList.add('online'); }
  if (visionSubtitle) visionSubtitle.textContent = `Live — Place ${ctx.place?.name ?? ''} · ${ctx.place?.placeId ?? ''}`;
  if (visionTree) {
    const tree = typeof ctx.workspaceTree === 'string' ? ctx.workspaceTree : '';
    const lines = tree.split('\n');
    visionTree.textContent = lines.slice(0, 80).join('\n') + (lines.length > 80 ? `\n… +${lines.length - 80} more` : '');
    if (visionTreeMeta) visionTreeMeta.textContent = `${lines.length} nodes · ${ctx.instanceCounts?._total ?? '?'} total instances`;
  }
  if (visionSelection) {
    const sel = Array.isArray(ctx.selection) ? ctx.selection : [];
    const details = Array.isArray(ctx.selectionDetails) ? ctx.selectionDetails : [];
    if (details.length > 0) {
      visionSelection.innerHTML = details.map(d => `${esc(d.path)} [${esc(d.className)}] ${d.position ? esc(d.position):''} ${d.size ? esc(d.size):''} ${d.anchored!==undefined ? (d.anchored?'anchored':'unanchored'):''}`).join('<br>');
    } else if (sel.length > 0) {
      visionSelection.textContent = sel.join(', ');
    } else {
      visionSelection.textContent = '— none';
    }
  }
  if (visionCounts) {
    const counts = ctx.instanceCounts && typeof ctx.instanceCounts === 'object' ? ctx.instanceCounts : null;
    if (counts) {
      const entries = Object.entries(counts).filter(([k])=>k!=='_total').map(([k,v])=>`${k}: ${v}`).join(' · ');
      visionCounts.textContent = entries || '—';
    } else visionCounts.textContent = '—';
  }
  if (visionAssets) {
    const assets = Array.isArray(ctx.assetReferences) ? ctx.assetReferences : [];
    if (assets.length === 0) visionAssets.textContent = '— none';
    else visionAssets.innerHTML = assets.slice(0,6).map(a=>`${esc(a.path)} ${esc(a.property)} = ${esc(String(a.value).slice(0,40))}`).join('<br>') + (assets.length>6 ? `<br>… +${assets.length-6} more` : '');
  }
}

async function runVisionQuery() {
  if (!studioConnected || !studioSessionId || !visionQueryInput) return;
  const q = visionQueryInput.value.trim();
  if (q.length < 2) { if (visionQueryResults) visionQueryResults.textContent = 'Type at least 2 characters.'; return; }
  if (visionQueryResults) visionQueryResults.textContent = 'Searching…';
  try {
    const r = await getJson(`/api/studio/query?sessionId=${encodeURIComponent(studioSessionId)}&q=${encodeURIComponent(q)}`);
    if (!r || !Array.isArray(r.results) || r.results.length===0) { if (visionQueryResults) visionQueryResults.textContent = 'No matches.'; return; }
    if (visionQueryResults) visionQueryResults.innerHTML = r.results.map(x=>esc(x)).join('<br>');
  } catch (e) { if (visionQueryResults) visionQueryResults.textContent = e instanceof Error ? e.message : 'Query failed.'; }
}

function addTyping() {
  const el = document.createElement('div');
  el.className = 'msg skeleton skeleton-shimmer';
  el.innerHTML = '<span class="msg-sender">LUA-X</span><span class="line"></span><span class="line"></span><span class="line"></span>';
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
  await resolveApiBase();
  const r = await fetch(`${API_BASE}${path}`, { headers: { accept: 'application/json', ...authHeaders() }, cache: 'no-store' });
  const b = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(b.error || `Request failed (${r.status})`);
  return b;
}

async function postJson(path, body) {
  await resolveApiBase();
  const r = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json', ...authHeaders() },
    body: JSON.stringify(body),
  });
  const b = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(b.error || `Request failed (${r.status})`);
  return b;
}

async function fetchDetailed(path, init = {}) {
  await resolveApiBase();
  const t0 = Date.now();
  try {
    const r = await fetch(`${API_BASE}${path}`, { ...init, headers: { ...(init.headers || {}), ...authHeaders() }, cache: 'no-store' });
    const text = await r.text();
    let body = null;
    try { body = JSON.parse(text); } catch { body = text; }
    return { reached: true, status: r.status, statusText: r.statusText, body, text, timeMs: Date.now() - t0 };
  } catch (e) {
    return { reached: false, status: null, statusText: null, body: null, text: null, timeMs: Date.now() - t0, error: e };
  }
}

async function checkWebProxy() {
  for (const path of ['/api/health?web', '/web/health']) {
    try {
      const r = await fetch(path, { cache: 'no-store' });
      if (r.ok) {
        const b = await r.json().catch(() => null);
        if (b && b.service === 'lua-x-web') return true;
      }
    } catch { /* try next */ }
  }
  return false;
}

function classifyHttpError(detail) {
  if (!detail || !detail.reached || !detail.status) {
    return { title: 'Could not reach LUA-X API', hint: 'Network or CORS problem — the request never got an HTTP response. If running locally, make sure the API server (port 4000) is running and check the API base URL (a "lua_x_api_base" localStorage override wins over the web proxy). On Vercel, check that the api/ functions deployed successfully and the project has a NVIDIA_API_KEY in All Environments.' };
  }
  const serverError = detail.body && typeof detail.body === 'object' && detail.body.error && typeof detail.body.error === 'object'
    ? detail.body.error
    : null;
  if (serverError && typeof serverError.code === 'string') {
    const titles = { STUDIO_CONNECT_FAILED: 'Studio connection service failed', STUDIO_HANDLER_FAILED: 'Studio connection service failed' };
    return {
      title: titles[serverError.code] || 'Studio connection service failed',
      hint: typeof serverError.message === 'string' ? serverError.message : 'The LUA-X Studio API crashed while creating the connection request.',
      serverRequestId: typeof serverError.requestId === 'string' ? serverError.requestId : null,
    };
  }
  const status = detail.status;
  if (status === 404) return { title: 'Studio connect endpoint is missing', hint: 'The deployed LUA-X API does not contain the /api/studio/connect endpoint. Redeploy the latest api/ folder. If running locally, make sure the API server is running on port 4000.' };
  if (status === 405) return { title: 'Wrong route or method', hint: 'The deployed API routes /api/studio differently than expected.' };
  if (status === 401 || status === 403) return { title: 'Authorization rejected', hint: 'The API rejected the request — check authentication configuration.' };
  if (status === 429) return { title: 'Too many requests', hint: 'Rate limit exceeded — wait a moment and press Retry.' };
  if (status === 502 || status === 503) return { title: 'LUA-X Studio bridge unavailable', hint: 'The backend function or a dependency failed. Check Vercel function logs. If running locally, make sure the API server (LUA_X_STANDALONE=true) is running.' };
  if (status >= 500) return { title: 'LUA-X backend error', hint: 'The API function crashed (FUNCTION_INVOCATION_FAILED). Check the Vercel function logs.' };
  return { title: `Request failed (HTTP ${status})`, hint: 'The API rejected the connection request.' };
}

function renderConnectError(detail, requestId) {
  if (!connectErrorBox) return;
  const cls = classifyHttpError(detail);
  connectErrorBox.classList.remove('hidden');
  if (connectErrorTitle) connectErrorTitle.textContent = cls.title;
  if (connectErrorHint) connectErrorHint.textContent = cls.hint;
  if (connectErrorEndpoint) connectErrorEndpoint.textContent = `Endpoint: POST /api/studio/connect`;
  if (connectErrorHttp) connectErrorHttp.textContent = detail && detail.reached ? `HTTP: ${detail.status} ${detail.statusText || ''}` : 'HTTP: no response (network/CORS)';
  if (connectErrorResponse) {
    const snippet = detail && detail.text ? detail.text.slice(0, 160) : '—';
    connectErrorResponse.textContent = `Response: ${snippet}`;
  }
  if (connectErrorRequest) connectErrorRequest.textContent = `Request ID: ${cls.serverRequestId || requestId || '—'}`;
  if (connectErrorTiming) connectErrorTiming.textContent = detail ? `Timing: ${detail.timeMs}ms` : 'Timing: —';
}

async function refreshHealth() {
  await resolveApiBase();
  const h = await fetchDetailed('/api/health');
  if (h.reached && h.status === 200 && h.body && h.body.status === 'ok') {
    backendOk = true;
    backendHttp = 200;
    backendStatus.textContent = 'Online';
    backendStatus.classList.add('ok');
  } else {
    backendOk = false;
    backendHttp = h.reached ? h.status : null;
    const proxyUp = await checkWebProxy();
    if (proxyUp) {
      backendStatus.textContent = 'API down';
      backendStatus.classList.remove('ok');
    } else {
      backendStatus.textContent = h.reached ? `HTTP ${h.status}` : 'Unreachable';
      backendStatus.classList.remove('ok');
    }
  }
  const a = await fetchDetailed('/api/ai/status');
  if (a.reached && a.status === 200 && a.body) {
    aiOk = Boolean(a.body.configured);
    aiHttp = 200;
    aiStatus.textContent = aiOk ? 'AI Ready' : 'AI not configured';
    aiStatus.classList.toggle('ok', aiOk);
    modelLabel.textContent = aiOk ? `NVIDIA · ${a.body.model}` : 'NVIDIA · not configured';
  } else {
    aiOk = false;
    aiHttp = a.reached ? a.status : null;
    if (a.reached && a.status === 503) {
      aiStatus.textContent = 'AI not configured';
      aiStatus.classList.remove('ok');
      modelLabel.textContent = 'NVIDIA · not configured';
    } else {
      aiStatus.textContent = a.reached ? `HTTP ${a.status}` : 'Unreachable';
      aiStatus.classList.remove('ok');
      modelLabel.textContent = 'NVIDIA · not configured';
    }
  }
  updateServicePills();
}

function updateServicePills() {
  if (!svcBackend) return;
  svcBackend.textContent = backendOk ? 'Backend · Online' : (backendHttp ? `Backend · HTTP ${backendHttp}` : 'Backend · Unreachable');
  svcBackend.className = `status-pill ${backendOk ? 'ok' : 'bad'}`;
  svcAi.textContent = aiOk ? 'NVIDIA · Ready' : (aiHttp === 200 ? 'NVIDIA · Not configured' : (aiHttp ? `NVIDIA · HTTP ${aiHttp}` : 'NVIDIA · Unreachable'));
  svcAi.className = `status-pill ${aiOk ? 'ok' : aiHttp === 200 ? 'warn' : 'bad'}`;
  svcBridge.textContent = bridgeUp ? 'Studio Bridge · Available' : (bridgeHttp ? `Studio Bridge · HTTP ${bridgeHttp}` : 'Studio Bridge · Unreachable');
  svcBridge.className = `status-pill ${bridgeUp ? 'ok' : 'bad'}`;
  svcStudio.textContent = studioConnected ? 'Studio · Connected' : 'Studio · Waiting';
  svcStudio.className = `status-pill ${studioConnected ? 'ok' : 'warn'}`;
}

function renderChecklist() {
  if (!checkDownload) return;
  checkDownload.textContent = `${pluginDownloaded() ? 'PASS' : 'WAIT'} LUA-X download available`;
  checkDownload.className = pluginDownloaded() ? 'ok' : 'bad';
  checkBackend.textContent = `${backendOk ? 'PASS' : 'FAIL'} Backend online`;
  checkBackend.className = backendOk ? 'ok' : 'bad';
  checkAi.textContent = `${aiOk ? 'PASS' : 'FAIL'} NVIDIA backend online`;
  checkAi.className = aiOk ? 'ok' : 'bad';
  checkSession.textContent = 'FAIL Studio session not detected';
  checkSession.className = 'bad';
}

function updateWaitingStage() {
  if (connectState !== 'connecting') return;
  if (!waitingTitle || !waitingSteps) return;
  const elapsed = Date.now() - connectStartedAt;
  if (handshakeDone) {
    waitingTitle.textContent = 'Handshake complete — confirming session…';
    waitingSteps.textContent = 'The plugin answered the connection request. Waiting for the heartbeat to confirm the session.';
    return;
  }
  if (elapsed < CONNECT_STAGE_1_MS) {
    waitingTitle.textContent = 'Connecting to Roblox Studio…';
    waitingSteps.textContent = 'Connection request created — the plugin polls for it every few seconds.';
  } else if (elapsed < CONNECT_STAGE_2_MS) {
    waitingTitle.textContent = 'Waiting for Studio plugin…';
    waitingSteps.textContent = 'It polls for the request automatically. Keep LUA-X open in Roblox Studio.';
  } else {
    waitingTitle.textContent = 'Still waiting for the plugin to respond…';
    waitingSteps.textContent = 'If LUA-X is running in Studio, it should connect shortly. Press Cancel to abort.';
  }
}

function setConnectState(next) {
  connectState = next;
  const btn = connectNow;
  const pingBtn = pingButton2;
  const discBtn = disconnectStudioButton;
  const cancelBtn = cancelConnect;
  const waiting = waitingBox;
  const trouble = troubleshootBox;
  const errBox = connectErrorBox;
  if (!btn) return;
  switch (next) {
    case 'offline':
      btn.textContent = 'Connect to Studio';
      btn.disabled = false;
      pingBtn.classList.add('hidden');
      discBtn.classList.add('hidden');
      cancelBtn.classList.add('hidden');
      waiting.classList.add('hidden');
      trouble.classList.add('hidden');
      errBox?.classList.add('hidden');
      bridgeTestBox?.classList.add('hidden');
      rowConnection.textContent = 'Not connected';
      break;
    case 'connecting':
      btn.textContent = 'Connecting…';
      btn.disabled = true;
      pingBtn.classList.add('hidden');
      discBtn.classList.add('hidden');
      cancelBtn.classList.remove('hidden');
      waiting.classList.remove('hidden');
      trouble.classList.add('hidden');
      errBox?.classList.add('hidden');
      rowConnection.textContent = 'Waiting for Roblox Studio…';
      updateWaitingStage();
      break;
    case 'connected':
      btn.textContent = 'Connected';
      btn.disabled = true;
      pingBtn.classList.remove('hidden');
      discBtn.classList.remove('hidden');
      cancelBtn.classList.add('hidden');
      waiting.classList.add('hidden');
      trouble.classList.add('hidden');
      errBox?.classList.add('hidden');
      rowConnection.textContent = 'Connected';
      break;
    case 'failed':
      connectRequestId = null;
      btn.textContent = 'Try Again';
      btn.disabled = false;
      pingBtn.classList.add('hidden');
      discBtn.classList.add('hidden');
      cancelBtn.classList.add('hidden');
      waiting.classList.add('hidden');
      errBox?.classList.add('hidden');
      trouble.classList.remove('hidden');
      rowConnection.textContent = 'Connection timed out';
      if (backendOk && bridgeUp) {
        if (troubleshootTitle) troubleshootTitle.textContent = 'Connection timed out';
        if (troubleshootSteps) troubleshootSteps.innerHTML = 'The backend is reachable but the Studio plugin did not claim the connection request in time.<br><br>Possible causes:<br>• LUA-X plugin is not open in Roblox Studio<br>• HTTP Requests are disabled (Game Settings → Security → Allow HTTP Requests)<br>• The plugin is pointing to a different API endpoint<br>• Serverless cold start may have cleared the request — press <b>Try Again</b><br><br>Steps:<br>1. Open Roblox Studio<br>2. Launch LUA-X (Plugins menu)<br>3. Make sure the plugin endpoint matches this website\'s API<br>4. Press <b>Try Again</b> on the website';
      } else {
        if (troubleshootTitle) troubleshootTitle.textContent = 'Could not reach LUA-X';
        if (troubleshootSteps) troubleshootSteps.innerHTML = 'The website could not reach the LUA-X API. Fix the backend first — Studio installation steps only matter once the API is reachable.<br>Press <b>Test Studio Bridge</b> or <b>Run Connection Test</b> to see exactly where it fails.';
      }
      renderChecklist();
      break;
    case 'backend_error':
      btn.textContent = 'Try Again';
      btn.disabled = false;
      pingBtn.classList.add('hidden');
      discBtn.classList.add('hidden');
      cancelBtn.classList.add('hidden');
      waiting.classList.add('hidden');
      trouble.classList.add('hidden');
      rowConnection.textContent = 'Connection request failed';
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
    studioBigStatus.textContent = 'Online';
    studioBigStatus.className = 'plugin-status online';
    studioSubtitle.textContent = 'Connected — bridge is live.';
    rowProject.textContent = studioPlaceName || '—';
    rowPlace.textContent = studioPlaceId || '—';
    rowPlugin.textContent = `v${studioPluginVersion || '?'}`;
    rowHeartbeat.textContent = relativeTime(studioLastSeen);
    rowSession.textContent = studioSessionId ? `${studioSessionId.slice(0, 8)}…` : '—';
    pluginStatus.textContent = 'Installed · connected';
    pluginStatus.className = 'plugin-status online';
    if (installState) installState.textContent = 'Installed (Studio connected)';
    if (installStatus) installStatus.textContent = 'Installed · Studio connected';
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
      connectRequestId = null;
      showToast('Studio session detected — you are online.');
    }
    setConnectState('connected');
    updateServicePills();
    const lastPing = studioLastCommand && studioLastCommand.type === 'ping' ? studioLastCommand.at : null;
    if (lastPing && Date.now() - lastPing < 10000) {
      pingBtnText('Studio responded');
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
    studioBigStatus.textContent = 'Offline';
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
      updateWaitingStage();
      if (Date.now() - connectStartedAt > CONNECT_TIMEOUT_MS) {
        clearInterval(connectTimer);
        connectTimer = null;
        connectRequestId = null;
        setConnectState('failed');
        showToast('Connection request expired — Studio never completed the handshake. Press Try Again.');
      }
    } else if (connectState === 'connected') {
      setConnectState('offline');
    }
    updateServicePills();
  }
}

function pingBtnText(text) {
  if (pingButton2) pingButton2.textContent = text;
}

async function refreshStudio() {
  const s = await fetchDetailed('/api/studio/status');
  if (s.reached && s.status === 200 && s.body) {
    bridgeUp = true;
    bridgeHttp = 200;
    if (s.body.connected) {
      const freshness = s.body.lastSeenAt ? Date.now() - s.body.lastSeenAt : 99999;
      if (freshness <= 25000) {
        studioSessionId = s.body.sessionId || null;
        studioPlaceName = s.body.placeName || null;
        studioPlaceId = s.body.placeId || null;
        studioPluginVersion = s.body.pluginVersion || null;
        studioVersionStatus = s.body.versionStatus || null;
        studioContext = s.body.context || null;
        studioLastCommand = s.body.lastCommand || null;
        studioLastSeen = s.body.lastSeenAt || Date.now();
        studioConnected = true;
        if (agentActivity) agentActivity.classList.remove('hidden');
      } else {
        studioConnected = false;
      }
    } else {
      studioConnected = false;
    }
  } else {
    bridgeUp = s.reached && s.status === 200;
    bridgeHttp = s.reached ? s.status : null;
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
  if (downloadPlugin2) { downloadPlugin2.textContent = 'LUA-X.lua downloaded'; downloadPlugin2.disabled = false; }
  pluginStatus.textContent = 'Downloaded · waiting for Studio';
  pluginStatus.className = 'plugin-status';
  if (installState) installState.textContent = 'Downloaded (browser confirmed)';
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

async function connectNowFlow() {
  if (studioConnected) {
    showToast('Studio is already connected.');
    return;
  }
  connectStartedAt = Date.now();
  handshakeDone = false;
  setConnectState('connecting');
  const attemptId = `web_${Date.now().toString(36)}`;

  await resolveApiBase();
  const health = await fetchDetailed('/api/health');
  if (!health.reached || health.status !== 200) {
    connectRequestId = null;
    setConnectState('backend_error');
    renderConnectError(health, attemptId);
    const proxyUp = await checkWebProxy();
    showToast(proxyUp
      ? 'Web server is up but the API backend is unreachable — start the API server or check the deployment.'
      : 'Cannot reach the LUA-X backend — check that the API server is running.');
    return;
  }

  const detail = await fetchDetailed('/api/studio/connect', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ projectId: 'web' }),
  });
  if (!detail.reached || detail.status !== 200 || !detail.body || !detail.body.requestId) {
    connectRequestId = null;
    setConnectState('backend_error');
    renderConnectError(detail, attemptId);
    showToast('Connection request failed — see the details below.');
    return;
  }
  connectRequestId = detail.body.requestId;
  clearInterval(connectTimer);

  await refreshStudio();
  await refreshConnectStatus();

  connectTimer = setInterval(() => {
    refreshStudio();
    refreshConnectStatus();
  }, POLL_CONNECTING_MS);
  showToast('Connection request created — waiting for Roblox Studio…');
}

async function testBridgeFlow() {
  if (!bridgeTestBox) return;
  bridgeTestBox.classList.remove('hidden');
  const mark = (key, ok, text) => {
    const el = bridgeTestItems[key];
    if (el) {
      el.textContent = `${ok ? 'PASS' : 'FAIL'} ${text}`;
      el.className = ok ? 'ok' : 'bad';
    }
  };
  const spin = (key, text) => {
    const el = bridgeTestItems[key];
    if (el) {
      el.textContent = `WAIT ${text}`;
      el.className = '';
    }
  };
  if (bridgeTestWait) bridgeTestWait.textContent = 'Testing…';
  const api = await fetchDetailed('/api/health');
  const apiOk = api.reached && api.status === 200;
  mark('api', apiOk, apiOk ? 'API reachable' : (api.reached ? `API HTTP ${api.status}` : 'API unreachable'));
  const status = await fetchDetailed('/api/studio/status');
  const statusOk = status.reached && status.status === 200;
  mark('status', statusOk, statusOk ? 'Studio bridge reachable' : (status.reached ? `Bridge HTTP ${status.status}` : 'Bridge unreachable'));
  const connect = await fetchDetailed('/api/studio/connect', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ projectId: 'web' }),
  });
  const connectOk = connect.reached && connect.status === 200 && connect.body && connect.body.requestId;
  mark('connect', connectOk, connectOk ? 'Connect endpoint reachable' : (connect.reached ? `Connect HTTP ${connect.status}` : 'Connect unreachable'));
  mark('request', connectOk, connectOk ? `Connection request created (${String(connect.body.requestId).slice(0, 12)}…)` : 'No connection request');
  if (connectOk) {
    connectRequestId = connect.body.requestId;
    if (bridgeTestWait) bridgeTestWait.textContent = 'Waiting for the plugin to claim the request — press Connect to finish the handshake.';
  } else {
    if (bridgeTestWait) bridgeTestWait.textContent = 'The website → API path is broken. Check the Vercel deployment before debugging Roblox Studio.';
  }
}

async function refreshConnectStatus() {
  if (connectState !== 'connecting' || !connectRequestId) return;
  try {
    const c = await getJson(`/api/studio/connect/status?requestId=${encodeURIComponent(connectRequestId)}`);
    handshakeDone = c.status === 'fulfilled';
  } catch { /* keep previous stage */ }
}

function cancelConnectFlow() {
  clearInterval(connectTimer);
  connectTimer = null;
  connectRequestId = null;
  handshakeDone = false;
  setConnectState('offline');
  showToast('Connection request cancelled — the plugin will stay idle.');
}

async function runConnectionTest() {
  if (!diagnosticsBox) return;
  diagnosticsBox.classList.remove('hidden');
  const results = {};
  const mark = (key, ok, text) => {
    results[key] = ok;
    const el = diagItems[key];
    if (el) {
      el.textContent = `${ok ? 'PASS' : 'FAIL'} ${text}`;
      el.className = ok ? 'ok' : 'bad';
    }
  };
  const skip = (key) => {
    const el = diagItems[key];
    if (el) {
      el.textContent = `— ${el.textContent.split(' ').slice(1).join(' ')} (skipped: dependency failed)`;
      el.className = '';
    }
  };
  const spin = (key, text) => {
    const el = diagItems[key];
    if (el) {
      el.textContent = `WAIT ${text}`;
      el.className = '';
    }
  };
  if (diagSummary) diagSummary.textContent = 'Running checks in dependency order…';
  mark('website', true, 'Website reachable (you are on it)');

  spin('api', 'Checking API health');
  const api = await fetchDetailed('/api/health');
  const apiOk = api.reached && api.status === 200;
  mark('api', apiOk, apiOk ? 'API healthy' : (api.reached ? `API HTTP ${api.status}` : 'API unreachable (network/CORS)'));
  if (!apiOk) {
    skip('bridge'); skip('connect'); skip('pending'); skip('session'); skip('heartbeat'); skip('command'); skip('ping');
    if (diagSummary) diagSummary.textContent = '1 of 9 checks passed. The API is down — Studio and plugin checks are skipped until the API works.';
    return;
  }

  spin('bridge', 'Contacting the Studio bridge');
  const bridge = await fetchDetailed('/api/studio/status');
  const bridgeOk = bridge.reached && bridge.status === 200;
  mark('bridge', bridgeOk, bridgeOk ? 'Studio bridge responds' : (bridge.reached ? `Bridge HTTP ${bridge.status}` : 'Bridge unreachable'));
  if (!bridgeOk) {
    skip('connect'); skip('pending'); skip('session'); skip('heartbeat'); skip('command'); skip('ping');
    if (diagSummary) diagSummary.textContent = '2 of 9 checks passed. The Studio bridge route is broken — the /api/studio rewrite may be missing on Vercel.';
    return;
  }

  spin('connect', 'Creating a connection request');
  const connect = await fetchDetailed('/api/studio/connect', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ projectId: 'web' }),
  });
  const connectOk = connect.reached && connect.status === 200 && connect.body && connect.body.requestId;
  const connectRequestIdHere = connectOk ? connect.body.requestId : null;
  mark('connect', connectOk, connectOk ? 'Connect endpoint creates requests' : (connect.reached ? `Connect HTTP ${connect.status}` : 'Connect unreachable'));
  if (!connectOk) {
    skip('pending'); skip('session'); skip('heartbeat'); skip('command'); skip('ping');
    if (diagSummary) diagSummary.textContent = '3 of 9 checks passed. The connect endpoint is broken — the deployed function may be an old build.';
    return;
  }

  spin('pending', 'Verifying the pending-poll endpoint');
  const pending = await fetchDetailed(`/api/studio/connect/pending`);
  const pendingOk = pending.reached && pending.status === 200 && pending.body && pending.body.request && pending.body.request.requestId === connectRequestIdHere;
  mark('pending', pendingOk, pendingOk ? 'Plugin can poll for pending requests' : (pending.reached ? 'Pending-poll did not return the request' : 'Pending-poll unreachable'));
  if (!pendingOk) {
    skip('session'); skip('heartbeat'); skip('command'); skip('ping');
    if (diagSummary) diagSummary.textContent = '4 of 9 checks passed. The pending-poll endpoint does not expose the request — check the deployed studio handler.';
    return;
  }

  const sessionOk = studioConnected;
  mark('session', sessionOk, sessionOk ? 'Session registered' : 'No session — the plugin has not claimed the request');
  const heartbeatFresh = Boolean(studioLastSeen && Date.now() - studioLastSeen < 15000);
  if (!sessionOk) {
    skip('heartbeat'); skip('command'); skip('ping');
    if (diagSummary) diagSummary.textContent = '5 of 9 checks passed. The bridge works — the plugin needs to claim the pending request. Open Roblox Studio and check the LUA-X plugin card.';
    return;
  }
  mark('heartbeat', heartbeatFresh, heartbeatFresh ? 'Heartbeat received' : 'No heartbeat — plugin not running or HTTP requests blocked');
  mark('command', sessionOk, sessionOk ? 'Command channel ready' : 'Command channel needs a session');
  if (studioSessionId) {
    spin('ping', 'Sending ping command');
    const ping = await fetchDetailed('/api/studio/command', {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ sessionId: studioSessionId, type: 'ping' }),
    });
    mark('ping', ping.reached && ping.status === 200, ping.reached && ping.status === 200 ? 'Ping sent — plugin will answer in the chat' : (ping.reached ? `Ping HTTP ${ping.status}` : 'Ping unreachable'));
  } else {
    mark('ping', false, 'Ping needs a connected session');
  }
  const passed = Object.values(results).filter(Boolean).length;
  if (diagSummary) {
    diagSummary.textContent = `${passed} of 9 checks passed. ${passed === 9 ? 'Everything is healthy.' : 'See the failing check above — the most common cause is HTTP requests being disabled in Studio (Game Settings → Security).'}`;
  }
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
  webChatHistory.push({ role: 'user', content: text });
  renderMessages();
  promptEl.value = '';
  setSending(true);
  composerNote.textContent = 'LUA-X is preparing an answer…';
  const typing = addTyping();
  const body = { prompt: text, projectId: 'web', mode: 'chat', history: webChatHistory.slice(-10) };
  if (studioConnected && studioSessionId) {
    body.sessionId = studioSessionId;
    body.surface = 'web';
    body.context = studioDeepContext || {
      projectId: studioPlaceId,
      placeName: studioPlaceName,
      scripts: studioContext && studioContext.scripts,
      selection: studioContext && studioContext.selection,
    };
  }
  try {
    await resolveApiBase();
    let r = await fetchDetailed('/api/ai/generate', {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(body),
    });
    if (r.status === 401 && promptForToken()) {
      r = await fetchDetailed('/api/ai/generate', {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify(body),
      });
    }
    const b = r.body && typeof r.body === 'object' ? r.body : {};
    if (!r.reached || r.status !== 200 || !b) {
      typing.remove();
      const unauthorized = r.reached && r.status === 401;
      const notConfigured = r.reached && (r.status === 503 || (typeof b.error === 'string' && /not configured/i.test(b.error)));
      if (unauthorized) {
        addMessage('Authorization rejected. Add a valid LUA-X API token in Settings and try again.', 'error');
        composerNote.textContent = 'Authorization rejected — add the LUA-X API token in Settings.';
      } else if (notConfigured) {
        addMessage('The AI provider is not configured on the backend. Add an NVIDIA_API_KEY in Vercel (Settings → Environment Variables → All Environments) and redeploy.', 'error');
        composerNote.textContent = 'AI not configured — set NVIDIA_API_KEY in Vercel and redeploy.';
      } else if (!r.reached) {
        addMessage('Could not reach the LUA-X backend. Check that the API is deployed and reachable.', 'error');
        composerNote.textContent = 'Backend unreachable — check the API deployment.';
      } else {
        addMessage(typeof b.error === 'string' ? b.error : `Request failed (HTTP ${r.status}).`, 'error');
        composerNote.textContent = `Request failed (HTTP ${r.status}).`;
      }
      showToast('Failed to reach the LUA-X backend.');
      return;
    }
    const reply = (typeof b.response === 'string' && b.response) || (b.plan && b.plan.summary) || 'No response from backend.';
    typing.remove();
    if (Array.isArray(b.agentTrace) && b.agentTrace.length > 0) {
      agentActivity?.classList.remove('hidden');
      renderAgentEvents(b.agentTrace);
    }
    webChatHistory.push({ role: 'assistant', content: reply });
    if (b.plan && Array.isArray(b.plan.changes) && b.plan.changes.length > 0) {
      webChatHistory.push({ role: 'assistant', content: `Build plan ready — ${b.plan.changes.length} change${b.plan.changes.length === 1 ? '' : 's'}. Open the LUA-X plugin in Roblox Studio to review and apply it.` });
      // ForgeGUI parity inspector: if plan contains UI ops, show hint
      try {
        const uiOps = b.plan.changes.filter(c => c.operation === 'create_ui' || c.operation === 'update_instance' || c.target?.includes('Gui'));
        if (visionForge) {
          if (uiOps.length > 0) visionForge.textContent = `ForgeGUI parity: UI plan has ${uiOps.length} UI change(s). Theme + layout validated locally. Open Studio to verify visual result.`;
          else visionForge.textContent = `Plan ready: ${b.plan.changes.map(c=>c.operation+':'+c.target).slice(0,4).join(', ')}`;
        }
      } catch { /* ignore */ }
    }
    renderMessages();
    if (studioConnected && studioSessionId) refreshSharedChat();
    composerNote.textContent = studioConnected
      ? 'Answered with your live Studio context. Chat is synced with the LUA-X plugin — messages appear in Roblox Studio too.'
      : 'Answered by LUA-X. Connect Studio (Plugins) to make chat project-aware and synced.';
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
  const titles = { chat: 'Chat', dashboard: 'Dashboard', plugins: 'Plugins', sync: 'Sync', assets: 'Assets', 'ui-studio': 'UI Studio', playtest: 'Playtest', projects: 'Projects', history: 'History', settings: 'Settings' };
  viewTitle.textContent = titles[name] || 'LUA-X';
  if (name === 'chat') document.querySelector('#view-chat')?.classList.remove('hidden');
  else if (name === 'dashboard') { document.querySelector('#view-dashboard')?.classList.remove('hidden'); try { refreshDashboard(); } catch {} }
  else if (name === 'plugins') document.querySelector('#view-plugins')?.classList.remove('hidden');
  else if (name === 'sync') { document.querySelector('#view-sync')?.classList.remove('hidden'); try { refreshSync(); } catch {} }
  else if (name === 'assets') { document.querySelector('#view-assets')?.classList.remove('hidden'); try { refreshAssets(); } catch {} }
  else if (name === 'ui-studio') document.querySelector('#view-ui-studio')?.classList.remove('hidden');
  else if (name === 'playtest') { document.querySelector('#view-playtest')?.classList.remove('hidden'); try { refreshPlaytest(); } catch {} }
  else if (name === 'settings') {
    document.querySelector('#view-settings')?.classList.remove('hidden');
    if (tokenInput) tokenInput.value = getToken();
  }
  else {
    if (comingTitle) comingTitle.textContent = (titles[name] || 'Section') + ' — coming soon';
    if (comingText) comingText.textContent = name === 'projects'
      ? 'Per-project workspaces and saved game context land here next.'
      : 'A history of plans, applies, and verifications will appear here.';
    document.querySelector('#view-coming')?.classList.remove('hidden');
  }
}

async function refreshDashboard() {
  try {
    const t = await getJson('/api/studio/targets').catch(() => ({ targets: [] }));
    if (dashTargets) dashTargets.textContent = `${t.count ?? t.targets?.length ?? 0} / ${t.max ?? 5}`;
    if (dashTargetsList) {
      const list = t.targets ?? [];
      dashTargetsList.innerHTML = list.length ? list.map(s => `${esc(s.clientId || s.sessionId.slice(0,8))} — ${esc(s.placeName)} ${esc(s.placeId || '')} ${s.pinned?'📌':''}`).join('<br>') : 'No Studio targets yet. Open 1-5 Studio windows.';
    }
    if (dashStatus) dashStatus.textContent = studioConnected ? 'Online' : 'Offline';
  } catch { /* ignore */ }
  try {
    const ctx = studioDeepContext;
    if (dashSync) dashSync.textContent = ctx ? `${Object.keys(ctx.instanceCounts || {}).length} services` : '—';
    if (dashChange) dashChange.textContent = ctx ? `${(ctx.scripts || []).length} scripts indexed` : '—';
    if (dashVerify) dashVerify.textContent = 'Evidence: screenshot/metric/assertion';
  } catch { /* ignore */ }
}

async function refreshSync() {
  try {
    const placeId = studioPlaceId || 'shared';
    const idx = await getJson(`/api/studio/index?sessionId=${encodeURIComponent(studioSessionId || placeId)}`).catch(() => null);
    if (syncActive) syncActive.textContent = idx?.index ? `${idx.index.rootName} (${idx.index.scriptsCount} scripts)` : '—';
    if (syncPlaces) syncPlaces.textContent = idx?.index ? `Tree ${idx.index.treeNodes} nodes · ${idx.index.scriptsCount} scripts` : 'No sync yet. Click Start Full Sync in Edit mode.';
    if (syncSourcemap) {
      const sm = await getJson(`/api/studio/sourcemap?placeId=${encodeURIComponent(placeId)}`).catch(() => null);
      syncSourcemap.textContent = sm?.filePaths?.length ? `${sm.filePaths.length} paths` : '—';
    }
    if (syncHistory && studioSessionId) {
      const h = await getJson(`/api/studio/chat?sessionId=${encodeURIComponent(studioSessionId)}`).catch(() => null);
      if (h && Array.isArray(h.messages)) syncHistory.textContent = h.messages.slice(-5).map(m=>`${m.surface || ''}:${m.role}`).join(' → ') || 'No history';
    }
  } catch { /* ignore */ }
}

async function refreshAssets() {
  try {
    const placeId = studioPlaceId || 'shared';
    const r = await getJson(`/api/studio/assets?placeId=${encodeURIComponent(placeId)}`).catch(() => ({ assets: [] }));
    if (assetsCount) assetsCount.textContent = String(r.count ?? r.assets?.length ?? 0);
    if (assetsShared) assetsShared.textContent = String(r.assets?.filter(a=>a.placeId==='shared')?.length ?? 0);
    if (assetsList) {
      const list = r.assets ?? [];
      assetsList.innerHTML = list.length ? list.map(a=>`${esc(a.name)} [${esc(a.type)}] ${esc(a.uri || 'local')}`).join('<br>') : 'No assets yet. Generate an image then upload — never invent IDs.';
    }
  } catch { /* ignore */ }
}

async function refreshPlaytest() {
  try {
    const placeId = studioPlaceId || 'shared';
    const r = await getJson(`/api/studio/playtest?placeId=${encodeURIComponent(placeId)}`).catch(() => ({ tests: [] }));
    if (playtestList) {
      const list = r.tests ?? [];
      playtestList.innerHTML = list.length ? list.map(t=>`${esc(t.id)} ${esc(t.mode)} ${esc(t.status)} — ${esc(t.logs?.[0] || '')}`).join('<br>') : 'No tests yet.';
    }
  } catch { /* ignore */ }
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
cancelConnect?.addEventListener('click', cancelConnectFlow);
runDiagnosticsBtn?.addEventListener('click', runConnectionTest);
testBridgeBtn?.addEventListener('click', testBridgeFlow);
disconnectStudioButton?.addEventListener('click', disconnectStudio);
downloadPlugin?.addEventListener('click', startDownload);
downloadPlugin2?.addEventListener('click', startDownload);
versionDownload?.addEventListener('click', startDownload);
openGuide?.addEventListener('click', e => { e.preventDefault(); openGuideFlow(); });
saveTokenBtn?.addEventListener('click', () => {
  saveToken(tokenInput ? tokenInput.value : '');
  showToast('API token saved — requests send it as Bearer authorization.');
});
clearTokenBtn?.addEventListener('click', () => {
  clearToken();
  if (tokenInput) tokenInput.value = '';
  showToast('API token cleared.');
});
promptEl?.addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    send();
  }
});
visionQueryBtn?.addEventListener('click', runVisionQuery);
visionQueryInput?.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); runVisionQuery(); } });
document.querySelector('#dash-refresh')?.addEventListener('click', refreshDashboard);
document.querySelector('#dash-open-sync')?.addEventListener('click', () => switchView('sync'));
document.querySelector('#sync-start')?.addEventListener('click', async () => {
  if (!studioSessionId) { showToast('Connect Studio first.'); return; }
  try { await postJson('/api/studio/command', { sessionId: studioSessionId, type: 'build', prompt: 'Start full sync — snapshot scanner' }); showToast('Sync command queued — check Studio'); } catch (e) { showToast(e instanceof Error ? e.message : 'Sync failed'); }
});
document.querySelector('#sync-query-test')?.addEventListener('click', async () => {
  const q = prompt('Query sync (e.g. Shop):'); if (!q) return;
  try { const r = await getJson(`/api/studio/query?sessionId=${encodeURIComponent(studioSessionId || '')}&q=${encodeURIComponent(q)}`); showToast(`${r.results?.length || 0} matches`); } catch (e) { showToast(e instanceof Error ? e.message : 'Query failed'); }
});
document.querySelector('#assets-add')?.addEventListener('click', async () => {
  const elName = document.querySelector('#assets-name');
  const elType = document.querySelector('#assets-type');
  const name = (elName && elName.value ? elName.value.trim() : '') || `asset_${Date.now()}`;
  const type = (elType && elType.value) || 'image';
  try { await postJson('/api/studio/assets', { placeId: studioPlaceId || 'shared', name, type }); showToast(`Asset ${name} added`); refreshAssets(); } catch (e) { showToast(e instanceof Error ? e.message : 'Add failed'); }
});
document.querySelector('#playtest-start-play')?.addEventListener('click', async () => {
  try { await postJson('/api/studio/playtest', { placeId: studioPlaceId || 'shared', mode: 'play' }); showToast('Playtest started (F5)'); refreshPlaytest(); } catch (e) { showToast(e instanceof Error ? e.message : 'Playtest failed'); }
});
document.querySelector('#playtest-start-run')?.addEventListener('click', async () => {
  try { await postJson('/api/studio/playtest', { placeId: studioPlaceId || 'shared', mode: 'run' }); showToast('Run started (F8)'); refreshPlaytest(); } catch (e) { showToast(e instanceof Error ? e.message : 'Run failed'); }
});
document.querySelector('#playtest-run-test')?.addEventListener('click', async () => {
  try { await postJson('/api/studio/playtest', { placeId: studioPlaceId || 'shared', mode: 'run' }); showToast('Test run queued'); refreshPlaytest(); } catch (e) { showToast(e instanceof Error ? e.message : 'Test failed'); }
});
document.querySelector('#playtest-stop')?.addEventListener('click', () => showToast('Stop: sync resumes after play — WEPPY parity'));
document.querySelector('#ui-generate')?.addEventListener('click', () => {
  const el = document.querySelector('#ui-brief');
  const v = el && el.value ? el.value.trim() : ''; if (!v) { showToast('Describe UI first'); return; }
  promptEl.value = `Build UI: ${v} — use UIScreenSpec, theme tokens, responsive, 48px targets`; switchView('chat'); send();
});
document.querySelector('#ui-preview')?.addEventListener('click', () => showToast('Preview: Studio captures before/after — like WEPPY dashboard_ui'));
document.querySelector('#ui-check')?.addEventListener('click', () => showToast('Check: recompose|refine|approved — see vision-forge score'));
bindViewNav();

renderMessages();
refreshHealth();
refreshStudio();
loadManifest();
if (pluginDownloaded()) {
  downloadState = 'downloaded';
  installPanel?.classList.remove('hidden');
  if (installState) installState.textContent = 'Downloaded (browser confirmed)';
  if (installStatus) installStatus.textContent = 'Waiting for Studio…';
  if (downloadPlugin2) downloadPlugin2.textContent = 'LUA-X.lua downloaded';
}
setInterval(refreshHealth, 30000);
setInterval(refreshStudio, POLL_NORMAL_MS);
setInterval(() => renderStudioCard(), 1000);
setInterval(refreshSharedChat, 5000);
setInterval(refreshSharedContext, 15000);