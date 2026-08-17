const API_BASE = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' ? 'http://127.0.0.1:4000' : '';
const prompt = document.querySelector('#prompt');
const buildButton = document.querySelector('#build-button');
const composerNote = document.querySelector('#composer-note');
const toast = document.querySelector('#toast');
const studioPulse = document.querySelector('#studio-pulse');
const studioLabel = document.querySelector('#studio-label');
const studioStatus = document.querySelector('#studio-status');
const aiStatus = document.querySelector('#ai-status');
const backendStatus = document.querySelector('#backend-status');
const systemStatus = document.querySelector('#system-status');
const modelLabel = document.querySelector('#model-label');
const pipeline = document.querySelector('#pipeline');
let toastTimer;

function showToast(message) {
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 2600);
}
function esc(value) {
  return String(value).replace(/[&<>\"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}
function setPipeline(step, state, detail) {
  const nodes = [...pipeline.querySelectorAll('.pipeline-step')];
  const node = nodes[step];
  if (!node) return;
  const icon = node.querySelector('.step-icon');
  const status = node.querySelector(':scope > span:last-child');
  node.classList.toggle('complete', state === 'complete');
  node.classList.toggle('running', state === 'running');
  icon.textContent = state === 'complete' ? '✓' : state === 'running' ? '•' : String(step + 1);
  status.textContent = state === 'complete' ? 'Ready' : state === 'running' ? 'Working' : 'Idle';
  if (detail) node.querySelector('p').textContent = detail;
}
async function getJson(path) {
  const response = await fetch(`${API_BASE}${path}`, { headers: { accept: 'application/json' } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `Request failed (${response.status})`);
  return body;
}
async function refreshHealth() {
  try {
    const health = await getJson('/health');
    backendStatus.textContent = health.status === 'ok' ? 'Online' : 'Degraded';
    const ai = await getJson('/api/ai/status');
    aiStatus.textContent = ai.configured ? 'Ready' : 'Not configured';
    modelLabel.textContent = ai.configured ? `NVIDIA · ${ai.model}` : 'NVIDIA · not configured';
    systemStatus.textContent = ai.configured ? 'Ready' : 'Backend online';
    systemStatus.classList.toggle('ok', true);
  } catch (error) {
    backendStatus.textContent = 'Offline';
    aiStatus.textContent = 'Unavailable';
    systemStatus.textContent = 'Offline';
    systemStatus.classList.remove('ok');
  }
}
async function build() {
  const value = prompt.value.trim();
  if (value.length < 2) {
    showToast('Describe what you want LUA-X to build first.');
    prompt.focus();
    return;
  }
  buildButton.disabled = true;
  composerNote.textContent = 'LUA-X is compiling project context and preparing a reviewable build plan…';
  setPipeline(1, 'running', 'Compiling your request into an execution brief');
  try {
    const response = await fetch(`${API_BASE}/api/ai/generate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ prompt: value, projectId: 'my-roblox-game', context: { relevantFiles: [], relevantInstances: [], architecture: 'Roblox project', constraints: ['Preserve existing working behavior', 'Server-authoritative protected state', 'Produce reviewable changes'] } })
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || `AI request failed (${response.status})`);
    setPipeline(1, 'complete', body.plan.summary || 'Plan generated successfully');
    setPipeline(2, 'running', `${body.plan.changes?.length ?? 0} proposed change(s) ready for review`);
    composerNote.innerHTML = `<strong>${esc(body.plan.summary || 'Build plan ready')}</strong> · ${body.plan.changes?.length ?? 0} change(s), ${body.plan.tests?.length ?? 0} test(s). Nothing has been pushed to Studio.`;
    setPipeline(2, 'complete', `${body.plan.changes?.length ?? 0} proposed change(s) ready for review`);
    setPipeline(3, 'complete', `${body.plan.tests?.length ?? 0} verification test(s) defined`);
    showToast('Build plan ready for review.');
  } catch (error) {
    setPipeline(1, 'idle', 'Waiting for the next build request');
    composerNote.textContent = error instanceof Error ? error.message : 'AI generation failed.';
    showToast(composerNote.textContent);
  } finally {
    buildButton.disabled = false;
  }
}
buildButton?.addEventListener('click', build);
prompt?.addEventListener('keydown', (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') { event.preventDefault(); build(); }
});
document.querySelectorAll('[data-surface]').forEach((button) => button.addEventListener('click', () => {
  const surface = button.getAttribute('data-surface');
  if (surface) {
    prompt.value = `${surface.charAt(0).toUpperCase() + surface.slice(1)} task for my Roblox project: `;
    prompt.focus();
    prompt.setSelectionRange(prompt.value.length, prompt.value.length);
  }
}));
document.querySelector('#connect-studio')?.addEventListener('click', () => showToast('Studio pairing will be available through the LUA-X plugin.'));
document.querySelector('#install-plugin')?.addEventListener('click', () => showToast('Plugin setup docs are being prepared for the Studio bridge.'));
studioPulse.classList.remove('online');
studioLabel.textContent = 'Studio not connected';
studioStatus.textContent = 'Offline';
refreshHealth();
setInterval(refreshHealth, 30000);
