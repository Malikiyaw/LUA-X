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
const connectStudio = document.querySelector('#connect-studio');
const downloadPlugin = document.querySelector('#download-plugin');
let toastTimer;
let currentStudioSessionId = null;
let studioConnected = false;

function showToast(message){
  if(!toast)return;
  toast.textContent=message;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer=setTimeout(()=>toast.classList.remove('show'),2800);
}
function esc(v){return String(v).replace(/[&<>\"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]))}
function readableError(body,fallback){
  if(!body)return fallback;
  if(typeof body.error==='string')return body.error;
  if(body.error&&typeof body.error==='object'&&typeof body.error.message==='string')return body.error.message;
  if(typeof body.detail==='string')return body.detail;
  return fallback;
}
function setPipeline(i,state,detail){
  if(!pipeline)return;
  const n=[...pipeline.querySelectorAll('.pipeline-step')][i];
  if(!n)return;
  const icon=n.querySelector('.step-icon');
  const s=n.querySelector(':scope > span:last-child');
  n.classList.toggle('complete',state==='complete');
  n.classList.toggle('running',state==='running');
  icon.textContent=state==='complete'?'✓':state==='running'?'•':String(i+1);
  s.textContent=state==='complete'?'Ready':state==='running'?'Working':'Idle';
  if(detail)n.querySelector('p').textContent=detail;
}
async function getJson(path){
  const r=await fetch(`${API_BASE}${path}`,{headers:{accept:'application/json'},cache:'no-store'});
  const b=await r.json().catch(()=>({}));
  if(!r.ok)throw new Error(readableError(b,`Request failed (${r.status})`));
  return b;
}
async function refreshHealth(){
  try{
    const h=await getJson('/health');
    backendStatus.textContent=h.status==='ok'?'Online':'Degraded';
    const a=await getJson('/api/ai/status');
    aiStatus.textContent=a.configured?'Ready':'Not configured';
    modelLabel.textContent=a.configured?`NVIDIA · ${a.model}`:'NVIDIA · not configured';
    systemStatus.textContent=a.configured?'Ready':'Backend online';
    systemStatus.classList.add('ok');
  }catch{
    backendStatus.textContent='Offline';
    aiStatus.textContent='Unavailable';
    systemStatus.textContent='Offline';
    systemStatus.classList.remove('ok');
  }
}
async function refreshStudio(){
  try{
    const studio=await getJson('/api/studio/status');
    studioConnected=Boolean(studio.connected);
    currentStudioSessionId=studio.sessionId||null;
    if(studioConnected){
      studioPulse?.classList.add('online');
      studioLabel.textContent=studio.placeName?`Studio connected · ${studio.placeName}`:'Studio connected';
      studioStatus.textContent='Connected';
      connectStudio.textContent='Ping Studio';
      connectStudio.dataset.connected='true';
    }else{
      studioPulse?.classList.remove('online');
      studioLabel.textContent='Studio not connected';
      studioStatus.textContent='Offline';
      connectStudio.textContent='Connect Studio →';
      connectStudio.dataset.connected='false';
    }
  }catch{
    studioConnected=false;
    studioPulse?.classList.remove('online');
    studioLabel.textContent='Studio unavailable';
    studioStatus.textContent='Offline';
    connectStudio.textContent='Connect Studio →';
  }
}
async function sendStudioCommand(type,payload={}){
  if(!currentStudioSessionId) throw new Error('No active Studio session. Open the LUA-X plugin in Roblox Studio first.');
  const r=await fetch(`${API_BASE}/api/studio/command`,{
    method:'POST',
    headers:{'content-type':'application/json',accept:'application/json'},
    body:JSON.stringify({sessionId:currentStudioSessionId,type,...payload})
  });
  const b=await r.json().catch(()=>({}));
  if(!r.ok)throw new Error(readableError(b,`Studio command failed (${r.status})`));
  return b;
}
async function build(){
  const v=prompt.value.trim();
  if(v.length<2){showToast('Describe what you want LUA-X to build first.');prompt.focus();return}
  buildButton.disabled=true;
  composerNote.textContent='LUA-X is preparing a reviewable build plan…';
  setPipeline(1,'running','Compiling your request into an execution brief');
  try{
    const r=await fetch(`${API_BASE}/api/ai/generate`,{
      method:'POST',
      headers:{'content-type':'application/json',accept:'application/json'},
      body:JSON.stringify({
        prompt:v,
        projectId:'my-roblox-game',
        mode:'build',
        context:{
          relevantFiles:[],
          relevantInstances:[],
          architecture:'Roblox project',
          constraints:['Preserve existing working behavior','Server-authoritative protected state','Produce reviewable changes']
        }
      })
    });
    const b=await r.json().catch(()=>({}));
    if(!r.ok)throw new Error(readableError(b,`AI request failed (${r.status})`));
    const count=b.plan?.changes?.length??0;
    const verificationCount=b.plan?.verification?.length??0;
    const pipelineCount=b.pipeline?.activeSurfaces?.length??0;
    setPipeline(1,'complete',b.plan?.summary||'Plan generated successfully');
    setPipeline(2,'complete',`${count} proposed change(s) routed across ${pipelineCount||1} surface(s)`);
    setPipeline(3,'complete',`${verificationCount} verification requirement(s) defined`);
    composerNote.innerHTML=`<strong>${esc(b.plan?.summary||'Build plan ready')}</strong> · ${count} change(s), ${verificationCount} verification requirement(s).`;
    if(studioConnected)showToast('Build plan ready. Studio is connected and ready for a command.');
    else showToast('Build plan ready for review. Connect Studio to send commands.');
  }catch(e){
    setPipeline(1,'idle','Waiting for the next build request');
    composerNote.textContent=e instanceof Error?e.message:'AI generation failed.';
    showToast(composerNote.textContent);
  }finally{buildButton.disabled=false;}
}

buildButton?.addEventListener('click',build);
prompt?.addEventListener('keydown',e=>{if((e.metaKey||e.ctrlKey)&&e.key==='Enter'){e.preventDefault();build()}});
document.querySelectorAll('[data-surface]').forEach(b=>b.addEventListener('click',()=>{
  const s=b.getAttribute('data-surface');
  if(s){prompt.value=`${s.charAt(0).toUpperCase()+s.slice(1)} task for my Roblox project: `;prompt.focus()}
}));
connectStudio?.addEventListener('click',async()=>{
  try{
    await refreshStudio();
    if(!studioConnected){showToast('Open LUA-X Studio in Roblox Studio and keep it running.');return;}
    await sendStudioCommand('ping');
    showToast('Ping sent to Roblox Studio.');
  }catch(e){showToast(e instanceof Error?e.message:'Studio command failed.');}
});
downloadPlugin?.addEventListener('click',()=>showToast('Downloading the canonical connected LUA-X Studio plugin…'));

studioPulse?.classList.remove('online');
studioLabel.textContent='Studio not connected';
studioStatus.textContent='Offline';
refreshHealth();
refreshStudio();
setInterval(refreshHealth,30000);
setInterval(refreshStudio,5000);
