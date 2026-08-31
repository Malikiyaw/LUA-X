/* LUA-X — AI-Native Roblox Studio Landing + Chat */
'use strict';
const $ = (s) => document.querySelector(s);
function esc(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function delay(ms){return new Promise(r=>setTimeout(r,ms))}
let toastTimer; function showToast(m){const t=$('#toast'); if(!t) return; t.textContent=m; t.classList.add('show'); clearTimeout(toastTimer); toastTimer=setTimeout(()=>t.classList.remove('show'),3200)}
async function resolveApiBase(){try{const r=await fetch('/api/config',{cache:'no-store'}); if(r.ok){const j=await r.json(); return j.apiBase||''}}catch{} return ''}
const SESSION_KEY='lua_x_session_id';
function getOrCreateSessionId(){
  try{
    let sid=null;
    try{sid=localStorage.getItem(SESSION_KEY)}catch{}
    if(sid && sid.trim().length>=8) return sid.trim().slice(0,100);
    const fresh=(typeof crypto!=='undefined' && crypto.randomUUID) ? crypto.randomUUID() : `web_${Date.now().toString(36)}_${Math.random().toString(36).slice(2,8)}`;
    try{localStorage.setItem(SESSION_KEY,fresh)}catch{}
    return fresh;
  }catch{ return `web_${Date.now().toString(36)}` }
}
let WEB_SESSION_ID=getOrCreateSessionId();
const TOKEN_KEY='lua_x_api_token';
function getToken(){try{return localStorage.getItem(TOKEN_KEY)||''}catch{return ''}}
function saveToken(v){try{localStorage.setItem(TOKEN_KEY,v)}catch{}}
function clearToken(){try{localStorage.removeItem(TOKEN_KEY)}catch{}}
function authHeaders(){const t=getToken(); return t?{authorization:`Bearer ${t}`}:{}}
let API_BASE=''; let apiBaseReady=false;
async function ensureApiBase(){if(!apiBaseReady){API_BASE=await resolveApiBase()||''; apiBaseReady=true} return API_BASE}
function url(p){return `${API_BASE}${p}`}
async function getJson(p){const r=await fetch(url(p),{headers:{accept:'application/json',...authHeaders()},cache:'no-store'}); if(!r.ok) throw new Error(`HTTP ${r.status}`); return r.json()}
async function postJson(p,b){const r=await fetch(url(p),{method:'POST',headers:{'content-type':'application/json',accept:'application/json',...authHeaders()},body:JSON.stringify(b)}); let j=null; try{j=await r.json()}catch{} return {status:r.status,ok:r.ok,body:j}}
async function fetchDetailed(p,init={}){const s=Date.now(); try{const r=await fetch(url(p),{cache:'no-store',...init}); let b=null; try{b=await r.json()}catch{} return {reached:true,status:r.status,body:b,ms:Date.now()-s}}catch(e){return {reached:false,status:0,body:null,error:e.message,ms:Date.now()-s}}}

// State
let studioConnected=false, studioSessionId=null, studioPlaceName=null, studioPlaceId=null, studioPluginVersion=null, studioLastSeen=0;
let requiredPluginVersion='2.2.0', bridgeUp=false, connectRequestId=null, pingSentAt=0, agentFeedLastAt=0, threadLastCount=-1;
let chatBusy=false, twinOn=true, chatHistory=[];
let webSessionId=WEB_SESSION_ID;
const backendStatus=$('#backend-status'), aiStatus=$('#ai-status'), modelLabel=$('#model-label'), composerModel=$('#composer-model');
const studioPulse=$('#studio-pulse'), studioLabel=$('#studio-label'), studioDetail=$('#studio-detail'), latencyChip=$('#latency-chip');
const threadFeed=$('#thread-feed'), chatFeed=$('#chat-feed'), agentFeed=$('#agent-feed');
const chatInput=$('#chat-input'), sendBtn=$('#send-btn'), twinPill=$('#twin-pill'), suggestionsRow=$('#suggestions-row');
const imageInput=$('#image-input'), visionBtn=$('#vision-btn'), useVision=$('#use-vision');
const personalizeToggle=$('#personalize-toggle'), canvasStage=$('#canvas-stage');
const statStudio=$('#stat-studio');
let railMobileOpen=false;

function setPill(el,ok,text){ if(!el) return; el.textContent=text; el.className=`status-pill ${ok===null?'':ok?'ok':'bad'}` }
async function refreshHealth(){
  const api=await fetchDetailed('/api/health'); const up=api.reached&&api.status===200; setPill(backendStatus,up?true:false,up?'API online':'API offline');
  const chk=$('#check-backend'); if(chk) chk.className=up?'ok':'bad'; bridgeUp=up;
  let ready=null, model='', vision='';
  if(up){
    const rr=await fetchDetailed('/api/ready'); ready=rr.status===200;
    try{ const st=await getJson('/api/ai/status'); model=st.model||''; vision=st.visionModel||''; const twin=st.agents&&st.agents.architect==='twin'; setPill(aiStatus,ready===true,ready?(twin?'Twin-AI ready':'AI ready'):'AI not configured'); }catch{ setPill(aiStatus,null,'AI —')}
  } else setPill(aiStatus,false,'AI —');
  if(modelLabel){ modelLabel.textContent=model?`NVIDIA · ${model.split('/').pop()}`:''; modelLabel.title=vision?`vision: ${vision}`:''; if(composerModel) composerModel.textContent=model?`NVIDIA · ${model.split('/').pop()} · 2 keys`:'AI · checking…'; const lm=$('#left-model'); if(lm) lm.textContent=model?`AI · ${model.split('/').pop()} · 2 keys`:'AI —'}
  const ca=$('#check-ai'); if(ca) ca.className=ready?'ok':'bad';
  if(statStudio) statStudio.textContent=up?'Studio online':'Studio offline';
}
function versionAtLeast(a,b){const A=String(a||'').split('.').map(n=>parseInt(n,10)||0),B=String(b||'').split('.').map(n=>parseInt(n,10)||0); for(let i=0;i<Math.max(A.length,B.length);i++) if((A[i]||0)!==(B[i]||0)) return (A[i]||0)>(B[i]||0); return true}
async function loadManifest(){try{const r=await fetch('/download/plugin-manifest.json',{cache:'no-store'}); if(!r.ok) return; const m=await r.json(); if(m.version) requiredPluginVersion=m.version; const pm=$('#plugin-meta'); if(pm&&m.sha256) pm.textContent=`SHA-256 ${String(m.sha256).slice(0,16)}… · v${m.version||'?'}`}catch{}}
function renderStudio(s){
  const live=Boolean(s&&s.connected); studioConnected=live;
  if(live){
    studioSessionId=s.sessionId||studioSessionId; studioPlaceName=s.placeName||studioPlaceName; studioPlaceId=s.placeId||s.projectId||studioPlaceId; studioPluginVersion=s.pluginVersion||studioPluginVersion; studioLastSeen=s.lastSeenAt||Date.now();
    if(studioSessionId) webSessionId=studioSessionId;
    if(studioPulse) studioPulse.className='status-dot online';
    if(studioLabel) studioLabel.textContent=`LIVE · ${studioPlaceName||'Roblox Studio'}`;
    if(studioDetail) studioDetail.textContent=`Place ${studioPlaceId||'?'} · v${studioPluginVersion||'?'} · ${Math.max(0,Math.round((Date.now()-studioLastSeen)/1000))}s ago`;
    const rc=$('#row-connection'); if(rc) rc.textContent='Connected'; const rp=$('#row-plugin'); if(rp) rp.textContent=studioPluginVersion?`v${studioPluginVersion}`:'—'; const rs=$('#row-session'); if(rs) rs.textContent=studioSessionId?`${String(studioSessionId).slice(0,8)}…`:'—';
    const cs=$('#check-session'); if(cs) cs.className='ok';
    const ss=$('#stat-session'); if(ss) ss.textContent=studioSessionId?`${String(studioSessionId).slice(0,6)}…`:'LIVE';
    const sessEl=$('#stat-session'); if(sessEl) sessEl.title=studioSessionId||'';
    if(pingSentAt && s.lastCommand && s.lastCommand.type==='ping' && s.lastCommand.at>=pingSentAt){ const ms=Math.max(1,s.lastCommand.at-pingSentAt); if(latencyChip){latencyChip.textContent=`Bridge ${ms} ms · LIVE`; latencyChip.classList.remove('hidden')} showToast(`Bridge ${ms}ms`)}
  } else {
    if(studioPulse) studioPulse.className='status-dot offline';
    if(studioLabel) studioLabel.textContent='Studio offline';
    if(studioDetail) studioDetail.textContent='Connect via plugin or CLI proxy — click ◎ Connect Studio';
    const rc=$('#row-connection'); if(rc) rc.textContent='Waiting…';
    const cs=$('#check-session'); if(cs) cs.className='';
    const ss=$('#stat-session'); if(ss) ss.textContent=webSessionId?`${String(webSessionId).slice(0,6)}…`:'—';
  }
}
async function refreshStudio(){
  // Prefer per-session status, fallback to project web for green dot
  let s=null;
  if(webSessionId){
    s=await fetchDetailed(`/api/studio/status?projectId=web&clientId=${encodeURIComponent(String(webSessionId).slice(0,16))}`);
    if(s.reached&&s.status===200&&s.body&&s.body.connected){ renderStudio(s.body); return }
    const bySession=await fetchDetailed(`/api/studio/status?projectId=${encodeURIComponent(webSessionId)}`);
    if(bySession.reached&&bySession.status===200&&bySession.body&&bySession.body.connected){ renderStudio(bySession.body); return }
  }
  s=await fetchDetailed('/api/studio/status?projectId=web');
  if(s.reached&&s.status===200&&s.body) renderStudio(s.body); else renderStudio({connected:false})
}

// Connect flow — Phase 1: website session pairing (persistent webSessionId)
let connectTimer=null, connectStartedAt=0;
function finishConnect(ok){
  connectRequestId=null; clearInterval(connectTimer); connectTimer=null;
  const wb=$('#waiting-box'); if(wb) wb.classList.add('hidden');
  if(ok){ showToast('Studio connected — chat is live'); refreshStudio(); }
}
async function connectNowFlow(){
  if(studioConnected){showToast('Already LIVE — just chat'); return}
  await ensureApiBase();
  const h=await fetchDetailed('/api/health'); if(!h.reached||h.status!==200){showToast('Backend unreachable — check Vercel env');return}
  // Use persistent web session as projectId so plugin can claim it
  const d=await postJson('/api/studio/connect',{projectId: webSessionId});
  if(!d.ok||!d.body||!d.body.requestId){showToast('Connect failed — retry');return}
  connectRequestId=d.body.requestId;
  const wb=$('#waiting-box'); if(wb) wb.classList.remove('hidden');
  const wt=$('#waiting-title'); if(wt) wt.textContent='Waiting for Studio…';
  const ws=$('#waiting-steps'); if(ws) ws.innerHTML=`Request <code>${esc(String(connectRequestId).slice(0,18))}…</code> — session <code>${esc(String(webSessionId).slice(0,8))}…</code><br>Open Roblox Studio → place loaded → plugin LUA-X auto-claims in 4s.`;
  connectStartedAt=Date.now();
  connectTimer=setInterval(refreshConnectStatus,1500);
  setTimeout(()=>{if(connectRequestId) {finishConnect(false); showToast('Timed out — is plugin running? Check LUA-X.lua is in Plugins & Studio restarted')}},60000)
}
async function refreshConnectStatus(){
  if(!connectRequestId) return;
  try{
    const c=await getJson(`/api/studio/connect/status?requestId=${encodeURIComponent(connectRequestId)}`);
    if(c.status==='fulfilled'){
      if(c.sessionId) { webSessionId=c.sessionId; try{localStorage.setItem(SESSION_KEY, webSessionId)}catch{} }
      finishConnect(true);
    } else if(c.status==='expired'){finishConnect(false); showToast('Request expired — click Connect again')}
  }catch{}
}
async function pingStudio(){ if(!studioSessionId){showToast('Studio not connected — click ◎ Connect Studio');return} pingSentAt=Date.now(); try{await postJson('/api/studio/command',{sessionId:studioSessionId,type:'ping'})}catch{}}
async function disconnectStudio(){ if(!studioSessionId) return; try{await postJson('/api/studio/disconnect',{sessionId:studioSessionId})}catch{} studioConnected=false; studioSessionId=null; renderStudio({connected:false}); showToast('Disconnected')}

// Agent canvas
function renderAgentEvents(events){
  if(!Array.isArray(events) || !events.length) return;
  const fresh=events.filter(e=>e&&e.at>agentFeedLastAt); if(!fresh.length) return; agentFeedLastAt=fresh[fresh.length-1].at;
  const archBody=$('#arch-body'), buildBody=$('#build-body'), archModel=$('#arch-model'), buildModel=$('#build-model'), state=$('#agent-activity-state'), archBody2=$('#arch-body2'), buildBody2=$('#build-body2'), archModel2=$('#arch-model2'), buildModel2=$('#build-model2');
  for(const e of fresh){
    const role=String(e.role||'').toUpperCase(); const msg=String(e.message||'').slice(0,220);
    if(role.includes('ARCHITECT')){ if(archBody) archBody.textContent=msg; if(archBody2) archBody2.textContent=msg; if(archModel&&e.model) archModel.textContent=e.model.split('/').pop(); if(archModel2&&e.model) archModel2.textContent=e.model.split('/').pop(); }
    else if(role.includes('BUILDER')){ if(buildBody) buildBody.textContent=msg; if(buildBody2) buildBody2.textContent=msg; if(buildModel&&e.model) buildModel.textContent=e.model.split('/').pop(); if(buildModel2&&e.model) buildModel2.textContent=e.model.split('/').pop(); }
    if(state) state.textContent='streaming';
    if(agentFeed){ const row=document.createElement('div'); row.className='agent-event-row'; const color=role.includes('ARCHITECT')?'#8ab4ff':role.includes('BUILDER')?'#7fd1a8':'#9aa3b5'; row.innerHTML=`<span style="color:${color};font-weight:800">${esc(role)}</span> <span style="opacity:.5">${new Date(e.at).toLocaleTimeString()}</span><br>${esc(msg)}`; agentFeed.prepend(row); while(agentFeed.children.length>80) agentFeed.removeChild(agentFeed.lastChild); agentFeed.classList.remove('hidden'); }
  }
  drawConnections();
}
async function refreshAgentFeed(){ if(!studioConnected||!studioSessionId) return; try{const d=await getJson(`/api/studio/agent-events?sessionId=${encodeURIComponent(studioSessionId)}&since=${agentFeedLastAt}`); if(d&&Array.isArray(d.events)) renderAgentEvents(d.events)}catch{} }

// Chat rendering
function appendMsg(role,text,opts={}){
  const container=$('#thread-feed');
  if(!container) return;
  const div=document.createElement('div');
  div.className=`msg ${role}`;
  const when=opts.at?` · ${new Date(opts.at).toLocaleTimeString()}`:'';
  const who=role==='user'?`YOU${when}`:`LUA-X${when}`;
  let body=esc(text);
  body=body.replace(/```lua([\s\S]*?)```/g,'<pre style="background:#0a0b12;padding:8px;border-radius:8px;overflow:auto"><code>$1</code></pre>');
  body=body.replace(/```([\s\S]*?)```/g,'<pre style="background:#0a0b12;padding:8px;border-radius:8px;overflow:auto"><code>$1</code></pre>');
  div.innerHTML=`<div class="who">${esc(who)}</div><div class="body">${body}</div>`;
  if(opts.plan){
    const card=document.createElement('div'); card.className='takeaways-card'; card.style.marginTop='8px';
    const changes=(opts.plan.changes||[]).slice(0,6).map(c=>`<li>${esc(c.operation)} @ ${esc(c.target)} <span style="opacity:.6">${esc(c.risk)}</span></li>`).join('');
    card.innerHTML=`<div class="takeaways-head">Build Plan — ${esc(opts.plan.summary||'plan')}</div><ul class="takeaways-list">${changes}</ul><button class="primary-button small" data-apply="1">Apply in Studio</button>`;
    div.appendChild(card);
  }
  container.appendChild(div);
  const feed=$('#chat-feed'); if(feed) feed.scrollTop=feed.scrollHeight;
  container.scrollTop=container.scrollHeight;
}
function renderSuggestions(list){
  if(!suggestionsRow) return;
  if(!list||!list.length){ suggestionsRow.classList.add('hidden'); suggestionsRow.innerHTML=''; return; }
  suggestionsRow.classList.remove('hidden');
  suggestionsRow.innerHTML=list.map(s=>`<button class="chip small" data-suggest="${esc(s)}">→ ${esc(s)}</button>`).join('');
  suggestionsRow.querySelectorAll('[data-suggest]').forEach(b=>b.addEventListener('click',()=>{ chatInput.value=b.getAttribute('data-suggest')||''; sendChat(); }));
}

let pendingImageDataUrl=null;
visionBtn?.addEventListener('click',()=> imageInput.click());
imageInput?.addEventListener('change', async ()=>{
  const f=imageInput.files&&imageInput.files[0]; if(!f) return;
  const reader=new FileReader();
  reader.onload=()=>{ pendingImageDataUrl=String(reader.result); showToast('Image attached — will be sent for mesh/vision'); };
  reader.readAsDataURL(f);
});

async function sendChat(){
  if(chatBusy) {showToast('Agents busy — please wait'); return}
  const raw=String(chatInput.value||'').trim();
  if(raw.length<2){showToast('Type a message'); return}
  let mode='chat';
  if(raw.startsWith('/build')) mode='build';
  else if(twinOn){
    const low=raw.toLowerCase();
    const isGreeting = raw.length<6 || (raw.length<=20 && /^(hi|hello|hey|yo|hiya|halo|hai|ciao|bonjour|hola|sup|howdy|test|ping)[!.\s]*$/i.test(raw));
    const hasBuildIntent = /build|make|create|script|system|game|add |fix|generate/.test(low);
    if(raw.length>=8 && hasBuildIntent && !isGreeting) mode='build';
    else if(raw.length>=15 && !isGreeting) mode='build';
  }
  chatBusy=true; if(sendBtn) sendBtn.disabled=true;
  appendMsg('user', raw, {at:Date.now()});
  chatInput.value=''; renderSuggestions([]);
  const archBody=$('#arch-body'); if(archBody && mode==='build') archBody.textContent='ARCHITECT analyzing request & project context…';
  const buildBody=$('#build-body'); if(buildBody && mode==='build') buildBody.textContent='Waiting for handoff…';
  const archBody2=$('#arch-body2'); if(archBody2 && mode==='build') archBody2.textContent='ARCHITECT analyzing request & project context…';
  const buildBody2=$('#build-body2'); if(buildBody2 && mode==='build') buildBody2.textContent='Waiting for handoff…';
  const archModel=$('#arch-model'); if(archModel && mode==='build') archModel.textContent='ARCHITECT';
  const buildModel=$('#build-model'); if(buildModel && mode==='build') buildModel.textContent='BUILDER';
  const centralThinking=$('#canvas-thinking'); if(centralThinking) centralThinking.textContent='ARCHITECT thinking…';
  try{
    await ensureApiBase();
    // Phase 1: always send persistent webSessionId so backend history + studio apply tie together
    const effectiveSessionId = studioSessionId || webSessionId;
    const body={ prompt: raw.replace(/^\/build\s*/,''), mode, projectId: studioPlaceId||webSessionId||'web', sessionId: effectiveSessionId, surface:'web' };
    if(pendingImageDataUrl && useVision && useVision.checked){
      body.context={ imageDataUrl: pendingImageDataUrl, wantsMesh: /mesh|model|generate/i.test(raw) };
    }
    body.history = chatHistory.slice(-10).map(m=>({role:m.role, content:m.text}));
    const res=await postJson('/api/ai/generate', body);
    let data=res.body;
    if(!res.ok){
      const detail=data&&data.detail?String(data.detail).slice(0,400):`HTTP ${res.status}`;
      const hint=data&&data.hint?` Hint: ${data.hint}`:'';
      appendMsg('assistant', `Backend ${res.status}: ${data&&data.error?data.error:'error'} — ${detail}${hint}`, {at:Date.now()});
      if(data&&data.agentTrace){ renderAgentEvents(data.agentTrace) }
    } else {
      const text=data.response||data.content||JSON.stringify(data).slice(0,800);
      appendMsg('assistant', text, {at:Date.now(), plan:data.plan});
      if(data.suggestions) renderSuggestions(data.suggestions);
      if(data.agentTrace) renderAgentEvents(data.agentTrace);
      if(data.model && modelLabel) modelLabel.textContent=`NVIDIA · ${String(data.model).split('/').pop()}`;
      if(centralThinking) centralThinking.textContent='Dessin is thinking…';
      const buildModelEl=$('#build-model'); if(buildModelEl) buildModelEl.textContent=data.model?data.model.split('/').pop():'';
    }
    chatHistory.push({role:'user', text:raw},{role:'assistant', text:String((res.body&&res.body.response)||'').slice(0,2000)});
    pendingImageDataUrl=null; if(imageInput) imageInput.value='';
  } catch(e){
    appendMsg('assistant', `Network error: ${String(e.message||e).slice(0,400)} — check API online and token.`, {at:Date.now()});
  } finally { chatBusy=false; if(sendBtn) sendBtn.disabled=false; }
}

// Connections SVG
function drawConnections(){
  const svg=$('#canvas-connections'); if(!svg) return; const container=svg.parentElement; if(!container) return;
  const rect=container.getBoundingClientRect(); svg.setAttribute('viewBox',`0 0 ${rect.width} ${rect.height}`); svg.setAttribute('width',rect.width); svg.setAttribute('height',rect.height);
  const central=$('#central-task'); if(!central) return;
  const cr=central.getBoundingClientRect();
  const cx=cr.left+cr.width/2-rect.left, cy=cr.top+cr.height/2-rect.top;
  let paths=`<line x1="${cx}" y1="${cy}" x2="${cx}" y2="${cy-10}" stroke="rgba(255,255,255,.12)" stroke-width="1" stroke-dasharray="4,4"/>`;
  [['#node-arch','#arch-body'],['#node-build','#build-body']].forEach(([nid,_])=>{
    const el=$(nid); if(!el) return;
    const r=el.getBoundingClientRect();
    const nx=r.left+r.width/2-rect.left, ny=r.top+r.height/2-rect.top;
    paths+=`<path d="M${cx},${cy+40} Q${cx+(nx-cx)*0.5},${(cy+ny)/2} ${nx},${ny-10}" stroke="rgba(59,130,246,.25)" stroke-width="1.5" fill="none"/>`;
  });
  svg.innerHTML=paths;
}
window.addEventListener('resize', drawConnections);

// Left rail handlers
function scrollToTarget(target){
  const el=document.querySelector(target); if(!el) return;
  el.scrollIntoView({behavior:'smooth',block:'start'});
  const nav=el.querySelector('.nav-link'); if(nav) nav.classList.add('active');
}
document.querySelectorAll('.rail-btn[data-target]').forEach(btn=>{
  btn.addEventListener('click',()=>{
    const target=btn.getAttribute('data-target');
    if(target==='#settings-dialog'){ $('#settings-dialog')?.showModal(); return}
    if(target==='#chat-feed' && chatInput){ chatInput.focus(); }
    scrollToTarget(target);
  });
});
$('#rail-docs')?.addEventListener('click',()=>{
  const el=$('#docs'); if(el) el.scrollIntoView({behavior:'smooth'});
});

// Bindings
sendBtn?.addEventListener('click', sendChat);
chatInput?.addEventListener('keydown', (e)=>{
  if(e.key==='Enter' && !e.shiftKey){ e.preventDefault(); sendChat(); }
});
$('#twin-pill')?.addEventListener('click', ()=>{
  twinOn=!twinOn;
  const p=$('#twin-pill'); if(p){ p.textContent=twinOn?'TWIN ON':'TWIN OFF'; p.style.opacity=twinOn?'1':'.6'}
  if(personalizeToggle) personalizeToggle.classList.toggle('on', twinOn);
  showToast(twinOn?'Twin agents ON — ARCHITECT+BUILDER':'Twin OFF — fast chat');
});
personalizeToggle?.addEventListener('click', ()=>{
  twinOn=!twinOn;
  personalizeToggle.classList.toggle('on', twinOn);
  const p=$('#twin-pill'); if(p){ p.textContent=twinOn?'TWIN ON':'TWIN OFF'; }
  showToast(twinOn?'Personilize ON':'Personilize OFF');
});
$('#toggle-canvas')?.addEventListener('click', ()=>{
  const cs=$('#canvas-stage'); if(!cs) return;
  cs.classList.toggle('hidden');
  document.body.classList.toggle('is-canvas', !cs.classList.contains('hidden'));
  showToast(cs.classList.contains('hidden')?'Chat mode':'Canvas mode — Market/Legal agents');
});
$('#close-card')?.addEventListener('click', ()=> showToast('Card minimize — use New AI chat to reset'));
document.querySelectorAll('.reply-pill').forEach(el=> el.addEventListener('click',()=>{
  const p=el.getAttribute('data-prompt')||'Reply'; if(chatInput){ chatInput.value=p; chatInput.focus(); }
}));
document.querySelectorAll('[data-prompt]').forEach(el=> el.addEventListener('click',()=>{
  const p=el.getAttribute('data-prompt')||el.textContent||''; if(chatInput){chatInput.value=p; sendChat()}
}));
$('#open-settings')?.addEventListener('click',()=> $('#settings-dialog')?.showModal());
$('#save-token')?.addEventListener('click',()=>{ const v=$('#token-input').value.trim(); saveToken(v); showToast('Token saved'); });
$('#clear-token')?.addEventListener('click',()=>{ clearToken(); const inp=$('#token-input'); if(inp) inp.value=''; showToast('Token cleared')});
$('#new-chat-btn')?.addEventListener('click',()=>{ chatHistory=[]; const tf=$('#thread-feed'); if(tf) tf.innerHTML=''; renderSuggestions([]); showToast('New chat')});
$('#connect-now')?.addEventListener('click', connectNowFlow);
$('#hero-start-btn')?.addEventListener('click', ()=>{
  if(!studioConnected){ connectNowFlow(); }
  const el=$('#chat-input'); if(el){el.focus(); showToast(studioConnected?'Twin agents ready — chat now':'Connecting… then chat');}
});
$('#hero-docs-btn')?.addEventListener('click', ()=>{ const el=$('#docs'); if(el) el.scrollIntoView({behavior:'smooth'})});
$('#hero-desktop-btn')?.addEventListener('click', ()=>{ showToast('Desktop proxy: npx @lua-x/desktop-bridge --token <token>')});
$('#new-project-btn')?.addEventListener('click', ()=>{ showToast('New project — start typing in the chat')});
$('#see-steps')?.addEventListener('click', (e)=>{ e.preventDefault(); showToast('Twin pipeline steps: ARCHITECT → BUILDER → review → apply')});
$('#nav-rail-toggle')?.addEventListener('click',()=>{
  const rail=$('#left-rail'); if(!rail) return;
  railMobileOpen=!railMobileOpen;
  rail.classList.toggle('open', railMobileOpen);
});

// Boot — Phase 1: show persistent session immediately
(async function init(){
  await ensureApiBase();
  const ss=$('#stat-session'); if(ss) ss.textContent=webSessionId?`${String(webSessionId).slice(0,6)}…`:'—';
  const rs=$('#row-session'); if(rs) rs.textContent=webSessionId?`${String(webSessionId).slice(0,8)}…`:'—';
  const cs=$('#check-session'); if(cs) cs.textContent=`Session ${String(webSessionId).slice(0,8)}…`;
  try{const r=await fetch('/download/plugin-manifest.json',{cache:'no-store'}); if(r.ok){const m=await r.json(); const pm=$('#plugin-meta'); if(pm&&m.sha256) pm.textContent=`SHA-256 ${String(m.sha256).slice(0,16)}… · v${m.version||'?'}`}}catch{}
  const ti=$('#token-input'); if(ti) ti.value=getToken();
  await refreshHealth(); await refreshStudio();
  setInterval(refreshHealth,30000); setInterval(refreshStudio,4000); setInterval(refreshAgentFeed,3000);
  setInterval(async()=>{
    if(!studioConnected||!studioSessionId) return;
    try{ const d=await getJson(`/api/studio/chat?sessionId=${encodeURIComponent(studioSessionId)}`); if(d&&Array.isArray(d.messages) && d.messages.length!==threadLastCount){ threadLastCount=d.messages.length } }catch{}
  },6000);
  setTimeout(drawConnections, 300);
})();
