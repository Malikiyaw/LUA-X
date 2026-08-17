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
const pingButton = document.querySelector('#ping-studio');
const downloadPlugin = document.querySelector('#download-plugin');
let toastTimer;
let sending = false;
let studioSessionId = null;

function showToast(message) {
  if (!toast) return;
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 2600);
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

async function getJson(path) {
  const r = await fetch(`${API_BASE}${path}`, { headers: { accept: 'application/json' }, cache: 'no-store' });
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

async function refreshStudio() {
  try {
    const s = await getJson('/api/studio/status');
    if (s.connected) {
      studioSessionId = s.sessionId || null;
      const secs = Math.max(0, Math.round((Date.now() - (s.lastSeenAt || 0)) / 1000));
      studioPulse.classList.add('online');
      studioLabel.textContent = `Studio connected · ${s.placeName || 'Roblox Studio'}`;
      studioDetail.textContent = `session ${(s.sessionId || '—').slice(0, 8)} · seen ${secs}s ago · v${s.pluginVersion || '?'}`;
      pingButton.disabled = false;
      document.querySelector('.connection-card')?.classList.add('connected');
    } else {
      studioSessionId = null;
      studioPulse.classList.remove('online');
      studioLabel.textContent = 'Studio offline';
      studioDetail.textContent = 'Open the LUA-X plugin in Roblox Studio and press Connect';
      pingButton.disabled = true;
      document.querySelector('.connection-card')?.classList.remove('connected');
    }
  } catch {
    studioSessionId = null;
    studioPulse.classList.remove('online');
    studioLabel.textContent = 'Studio offline';
    studioDetail.textContent = 'Could not reach the LUA-X API';
    pingButton.disabled = true;
    document.querySelector('.connection-card')?.classList.remove('connected');
  }
}

async function pingStudio() {
  if (!studioSessionId) {
    showToast('Studio is not connected.');
    return;
  }
  try {
    const r = await fetch(`${API_BASE}/api/studio/command`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ sessionId: studioSessionId, type: 'ping' }),
    });
    const b = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(b.error || `Ping failed (${r.status})`);
    showToast('Ping sent to Studio ✓');
  } catch (e) {
    showToast(e instanceof Error ? e.message : 'Ping failed.');
  }
}

async function send() {
  const text = promptEl.value.trim();
  if (!text || sending) return;
  addMessage(text, 'user');
  promptEl.value = '';
  setSending(true);
  composerNote.textContent = 'LUA-X is preparing an answer…';
  const typing = addMessage('LUA-X is thinking…', 'typing');
  try {
    const r = await fetch(`${API_BASE}/api/ai/generate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ prompt: text, projectId: 'web', mode: 'chat' }),
    });
    const b = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(b.error || `AI request failed (${r.status})`);
    const reply = (typeof b.response === 'string' && b.response) || (b.plan && b.plan.summary) || 'No response from backend.';
    typing.remove();
    addMessage(reply, 'assistant');
    composerNote.textContent = 'Answered by LUA-X. Nothing is pushed to Studio automatically.';
  } catch (e) {
    typing.remove();
    addMessage(e instanceof Error ? e.message : 'AI generation failed.', 'error');
    composerNote.textContent = 'Request failed. Check that the backend is running and the AI provider is configured.';
    showToast('Failed to reach the LUA-X backend.');
  } finally {
    setSending(false);
  }
}

sendButton?.addEventListener('click', send);
pingButton?.addEventListener('click', pingStudio);
promptEl?.addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    send();
  }
});
downloadPlugin?.addEventListener('click', () => showToast('Downloading LUA-X.plugin.lua — place it in your Roblox Plugins folder.'));

addMessage('Hi, I\'m LUA-X. Ask me to write Luau code, design a Roblox system, or solve a scripting problem.', 'assistant');
refreshHealth();
refreshStudio();
setInterval(refreshHealth, 30000);
setInterval(refreshStudio, 4000);
