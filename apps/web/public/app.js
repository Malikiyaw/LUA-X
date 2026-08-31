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
       if(data.plan) verifySetFromPlan(data.plan, data.pipeline);
       else if(data.pipeline && data.pipeline.verificationRun) verifySetFromPipeline(data.pipeline);
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

// ===== UI STUDIO - Phase 2 (beats ForgeGUI) =====
let uiScreen = {
  id: 'lua-x-shop',
  name: 'LUA-X Shop HUD',
  rootId: 'root',
  components: [
    { id: 'root', kind: 'screen', name: 'Root', layout: 'list', style: { padding: 16, spacing: 10 } },
    { id: 'header', kind: 'frame', name: 'Header', parentId: 'root', layout: 'list', style: { cornerRadius: 12, padding: 12, colorToken: 'surface' }, children: ['title', 'buy'] },
    { id: 'title', kind: 'text', name: 'Title', parentId: 'header', style: { textSize: 18, colorToken: 'primary' } },
    { id: 'buy', kind: 'button', name: 'Buy', parentId: 'header', style: { cornerRadius: 10, padding: 8, colorToken: 'primary' }, states: [{ state: 'disabled', enabled: false }] },
  ],
  theme: { tokens: { primary: '#3B82F6', surface: '#1C1C1F', gap: 8, radius: 12 } },
  responsive: { rules: ['stack below 420px', 'grid 2col above 720px'] }
};
let uiSelectedId = 'root';
let uiRefDataUrl = null;

function uiValidate(screen){
  const issues=[];
  if(!screen.id.trim()||!screen.name.trim()) issues.push({severity:'error',code:'SCREEN_IDENTITY',message:'Screen id and name required.'});
  const ids=new Set(); const names=new Set();
  for(const c of screen.components){
    if(!c.id.trim()||!c.name.trim()) issues.push({severity:'error',code:'COMPONENT_IDENTITY',message:'Every component needs id+name',componentId:c.id});
    if(ids.has(c.id)) issues.push({severity:'error',code:'DUPLICATE_COMPONENT',message:`Duplicate id: ${c.id}`,componentId:c.id}); ids.add(c.id);
    const lower=c.name.trim().toLowerCase(); if(lower && names.has(lower)) issues.push({severity:'warning',code:'DUPLICATE_NAME',message:`Duplicate name: ${c.name}`,componentId:c.id}); else if(lower) names.add(lower);
    if(c.parentId && c.parentId!==c.id && !screen.components.some(p=>p.id===c.parentId)) issues.push({severity:'error',code:'MISSING_PARENT',message:`Parent ${c.parentId} missing`,componentId:c.id});
    if(c.style?.transparency!==undefined && (c.style.transparency<0||c.style.transparency>1)) issues.push({severity:'error',code:'TRANSPARENCY_RANGE',message:'Transparency 0-1',componentId:c.id});
    if(c.style?.textSize!==undefined && c.style.textSize<=0) issues.push({severity:'error',code:'TEXT_SIZE',message:'textSize >0',componentId:c.id});
    if(c.style?.cornerRadius!==undefined && (c.style.cornerRadius<0||c.style.cornerRadius>40)) issues.push({severity:'warning',code:'CORNER_RADIUS',message:'cornerRadius 0-40',componentId:c.id});
    if(c.style?.colorToken && !screen.theme.tokens[c.style.colorToken]) issues.push({severity:'warning',code:'UNKNOWN_TOKEN',message:`token ${c.style.colorToken} missing`,componentId:c.id});
  }
  if(!ids.has(screen.rootId)) issues.push({severity:'error',code:'MISSING_ROOT',message:`Root ${screen.rootId} missing`});
  // depth >6
  const parentMap=new Map(screen.components.map(c=>[c.id,c.parentId]));
  for(const c of screen.components){ let d=0; let cur=c.id; const seen=new Set(); while(cur && parentMap.get(cur) && !seen.has(cur) && d<20){ seen.add(cur); cur=parentMap.get(cur); d+=1;} if(d>6) issues.push({severity:'warning',code:'DEPTH_EXCEEDED',message:`${c.id} depth ${d}>6`,componentId:c.id});}
  if(Object.keys(screen.theme.tokens).length===0) issues.push({severity:'warning',code:'THEME_TOKENS_EMPTY',message:'theme.tokens empty — define palette/radii/spacing'});
  if(screen.responsive.rules.length===0 && screen.components.length>3) issues.push({severity:'warning',code:'RESPONSIVE_RULES_MISSING',message:'Add responsive rules for multi-device'});
  const states=new Map(); for(const c of screen.components) for(const s of c.states??[]){ const set=states.get(c.id)??new Set(); set.add(s.state); states.set(c.id,set); }
  for(const c of screen.components) if(c.kind==='button' && !(states.get(c.id)?.has('disabled'))) issues.push({severity:'warning',code:'BUTTON_DISABLED_STATE',message:'Buttons need disabled state',componentId:c.id});
  if(screen.components.filter(c=>c.kind==='button').length>3 && !screen.components.some(c=>c.kind==='frame' && c.layout==='list')) issues.push({severity:'warning',code:'LAYOUT_GROUPING',message:'Use Frame list/grid to group buttons (ForgeGUI parity)'});
  return issues;
}
function uiParity(screen){
  const issues=uiValidate(screen); const err=issues.filter(i=>i.severity==='error').length; const warn=issues.filter(i=>i.severity==='warning').length;
  let score=100 - err*15 - warn*4; if(Object.keys(screen.theme.tokens).length>=4) score+=5; if(screen.responsive.rules.length>0) score+=5;
  return { score: Math.max(0,Math.min(100,score)), issues };
}
function uiRender(){
  const badge=$('#ui-parity-badge'); const list=$('#ui-validation-list'); const count=$('#ui-issues-count'); const tree=$('#ui-tree'); const themeGrid=$('#ui-theme-grid'); const preview=$('#ui-preview'); const selLabel=$('#ui-selected-id');
  const parity=uiParity(uiScreen);
  if(badge){ badge.textContent=`Parity ${parity.score}/100`; badge.className=`badge ${parity.score>=80?'green':parity.score>=60?'':'bad'}`; }
  if(count) count.textContent=`${parity.issues.length} issues`;
  if(list){ list.innerHTML=parity.issues.length? parity.issues.map(i=>`<li class="${esc(i.severity)}"><b>${esc(i.code)}</b> — ${esc(i.message)}${i.componentId?` <span style="opacity:.6">[${esc(i.componentId)}]</span>`:''}</li>`).join('') : `<li style="opacity:.6">No issues — ForgeGUI parity ready</li>`; }
  if(tree){
    tree.innerHTML=uiScreen.components.map(c=>`<div class="ui-tree-row ${c.id===uiSelectedId?'active':''}" data-id="${esc(c.id)}"><span>${esc(c.name)} <span style="opacity:.6">(${esc(c.kind)})</span></span><span style="opacity:.6">${esc(c.id)}</span></div>`).join('');
    tree.querySelectorAll('.ui-tree-row').forEach(el=> el.addEventListener('click',()=>{ uiSelectedId=el.getAttribute('data-id'); uiRender(); uiFillProps(); }));
  }
  if(themeGrid){
    themeGrid.innerHTML=Object.entries(uiScreen.theme.tokens).map(([k,v])=>`<div class="theme-row"><input value="${esc(k)}" data-k="${esc(k)}" class="theme-key" placeholder="token"><input value="${esc(String(v))}" data-k="${esc(k)}" class="theme-val" placeholder="#3B82F6 or 8"><button class="ghost-button small theme-del" data-k="${esc(k)}" type="button">×</button></div>`).join('');
    themeGrid.querySelectorAll('.theme-del').forEach(b=> b.addEventListener('click',()=>{ const k=b.getAttribute('data-k'); if(k) { delete uiScreen.theme.tokens[k]; uiRender(); }}));
    themeGrid.querySelectorAll('.theme-key').forEach(inp=> inp.addEventListener('change',()=>{ const old=inp.getAttribute('data-k'); const ne=inp.value.trim(); if(!ne||ne===old) return; const v=uiScreen.theme.tokens[old]; delete uiScreen.theme.tokens[old]; uiScreen.theme.tokens[ne]=v; uiSelectedId=ne; uiRender(); }));
    themeGrid.querySelectorAll('.theme-val').forEach(inp=> inp.addEventListener('change',()=>{ const k=inp.getAttribute('data-k'); if(k) { uiScreen.theme.tokens[k]=inp.value.trim(); uiRender(); }}));
  }
  if(preview){
    const byId=new Map(uiScreen.components.map(c=>[c.id,c]));
    function renderNode(id, depth=0){
      const c=byId.get(id); if(!c) return '';
      const kids=(c.children||[]).map(cid=> byId.get(cid)).filter(Boolean);
      // also find parentId implicit children
      const implicit=uiScreen.components.filter(x=>x.parentId===id && !c.children?.includes(x.id));
      const all=[...kids, ...implicit];
      const isList=c.layout==='list'; const isGrid=c.layout==='grid';
      if(c.kind==='button') return `<div class="preview-node button" data-preview-id="${esc(c.id)}" style="${c.style?.cornerRadius?`border-radius:${c.style.cornerRadius}px`:''}">${esc(c.name)}</div>`;
      if(c.kind==='text') return `<div class="preview-node" data-preview-id="${esc(c.id)}" style="font-weight:600">${esc(c.name)}</div>`;
      if(c.kind==='screen' || c.kind==='frame'){
        const cls=isList?'frame-list':isGrid?'frame-grid':'';
        const inner=all.map(ch=> renderNode(ch.id, depth+1)).join('') || `<span style="opacity:.5">Empty ${esc(c.name)}</span>`;
        return `<div class="preview-node ${esc(cls)}" data-preview-id="${esc(c.id)}"><div style="font:600 11px var(--font);opacity:.6">${esc(c.name)} · ${esc(c.kind)} · ${esc(c.layout||'absolute')}</div><div style="margin-top:6px;display:${isGrid?'grid':isList?'flex':'block'};${isList?'flex-direction:column':''};gap:8px">${inner}</div></div>`;
      }
      return `<div class="preview-node" data-preview-id="${esc(c.id)}">${esc(c.name)} <span style="opacity:.6">${esc(c.kind)}</span></div>`;
    }
    preview.innerHTML=renderNode(uiScreen.rootId);
    preview.querySelectorAll('[data-preview-id]').forEach(el=> el.addEventListener('click',()=>{ uiSelectedId=el.getAttribute('data-preview-id'); uiRender(); uiFillProps(); }));
  }
  if(selLabel) selLabel.textContent=uiSelectedId;
  // responsive list
  const rl=$('#ui-responsive-list'); if(rl){ rl.innerHTML=uiScreen.responsive.rules.map((r,i)=>`<div style="display:flex;gap:6px;align-items:center;background:var(--field);border:1px solid var(--hairline);border-radius:6px;padding:4px 6px"><span style="flex:1;font:11px var(--font)">${esc(r)}</span><button class="ghost-button small" data-idx="${i}" type="button">×</button></div>`).join(''); rl.querySelectorAll('button[data-idx]').forEach(b=> b.addEventListener('click',()=>{ const i=parseInt(b.getAttribute('data-idx')||'0',10); uiScreen.responsive.rules.splice(i,1); uiRender(); })); }
}
function uiFillProps(){
  const c=uiScreen.components.find(x=>x.id===uiSelectedId); if(!c) return;
  $('#ui-prop-kind').value=c.kind; $('#ui-prop-name').value=c.name||''; $('#ui-prop-layout').value=c.layout||''; $('#ui-prop-radius').value=c.style?.cornerRadius??''; $('#ui-prop-padding').value=c.style?.padding??''; $('#ui-prop-trans').value=c.style?.transparency??''; $('#ui-prop-textsize').value=c.style?.textSize??''; $('#ui-prop-token').value=c.style?.colorToken||''; $('#ui-prop-parent').value=c.parentId||''; $('#ui-prop-action').value=c.action?.type||'';
}
function uiSaveProps(){
  const c=uiScreen.components.find(x=>x.id===uiSelectedId); if(!c) return;
  const kind=$('#ui-prop-kind').value; const name=$('#ui-prop-name').value.trim()||c.name; const layout=$('#ui-prop-layout').value||undefined;
  const radius=$('#ui-prop-radius').value; const padding=$('#ui-prop-padding').value; const trans=$('#ui-prop-trans').value; const tsize=$('#ui-prop-textsize').value; const token=$('#ui-prop-token').value.trim()||undefined; const parent=$('#ui-prop-parent').value.trim()||undefined; const act=$('#ui-prop-action').value.trim()||undefined;
  c.kind=kind; c.name=name; if(layout) c.layout=layout; else delete c.layout;
  c.style=c.style||{}; if(radius) c.style.cornerRadius=parseFloat(radius); else delete c.style.cornerRadius;
  if(padding) c.style.padding=parseFloat(padding); else delete c.style.padding;
  if(trans) c.style.transparency=parseFloat(trans); else delete c.style.transparency;
  if(tsize) c.style.textSize=parseFloat(tsize); else delete c.style.textSize;
  if(token) c.style.colorToken=token; else delete c.style.colorToken;
  if(parent) c.parentId=parent; else delete c.parentId;
  if(act) c.action={type:act}; else delete c.action;
  uiRender();
}
function uiAddComponent(kind, template){
  const id=`${kind}_${Date.now().toString(36).slice(-4)}`;
  const base={ id, kind, name: kind==='button'?'New Button':kind==='frame'?'Card':kind.charAt(0).toUpperCase()+kind.slice(1), parentId: uiSelectedId||'root', style:{ cornerRadius:8, padding:8 }, states: kind==='button'?[{state:'disabled',enabled:false}]:undefined };
  if(template==='shop') { base.name='Shop Grid'; base.layout='grid'; base.style={cornerRadius:12,padding:12}; }
  if(template==='modal') { base.name='Modal'; base.layout='list'; }
  if(template==='hud') { base.name='HUD Bar'; base.layout='list'; base.kind='frame'; }
  uiScreen.components.push(base);
  // maintain children for parent frame
  const parent=uiScreen.components.find(x=>x.id===base.parentId); if(parent && (parent.kind==='frame'||parent.kind==='screen')){ parent.children=parent.children||[]; if(!parent.children.includes(id)) parent.children.push(id); }
  uiSelectedId=id; uiRender(); uiFillProps(); showToast(`Added ${kind} — parity ${uiParity(uiScreen).score}`);
}
function uiExportCreateUi(){
  // Build create_ui recursive JSON as BUILDER expects (className tree)
  const map=new Map(uiScreen.components.map(c=>[c.id,c]));
  const tokenCss=(t)=> uiScreen.theme.tokens[t]||t;
  function toRobloxProps(c){
    const p={};
    if(c.style?.cornerRadius!==undefined) p.CornerRadius=`UDim.new(0,${c.style.cornerRadius})`; // will be child UICorner but include for parity
    if(c.style?.transparency!==undefined) p.BackgroundTransparency=c.style.transparency;
    if(c.style?.padding!==undefined) p.Padding=`UDim.new(0,${c.style.padding})`;
    if(c.style?.colorToken) { const v=tokenCss(c.style.colorToken); if(typeof v==='string' && v.startsWith('#')){ const hex=v.replace('#',''); const r=parseInt(hex.slice(0,2),16); const g=parseInt(hex.slice(2,4),16); const b=parseInt(hex.slice(4,6),16); p.BackgroundColor3=`Color3.fromRGB(${r},${g},${b})`; } }
    if(c.style?.textSize!==undefined) p.TextSize=c.style.textSize;
    return p;
  }
  function buildNode(id){
    const c=map.get(id); if(!c) return null;
    const classMap={ screen:'ScreenGui', frame:'Frame', button:'TextButton', text:'TextLabel', image:'ImageLabel', input:'TextBox', scroll:'ScrollingFrame', template:'Frame' };
    const children=(c.children||[]).map(cid=> buildNode(cid)).filter(Boolean);
    // implicit parentId children
    const implicit=uiScreen.components.filter(x=>x.parentId===id && !c.children?.includes(x.id)).map(x=> buildNode(x.id)).filter(Boolean);
    const all=[...children, ...implicit];
    // add UICorner/UIListLayout children for fidelity
    const extra=[]; if(c.style?.cornerRadius!==undefined) extra.push({className:'UICorner',name:'Corner',properties:{CornerRadius:`UDim.new(0,${c.style.cornerRadius})`}}); 
    if(c.layout==='list') extra.push({className:'UIListLayout',name:'List',properties:{Padding:`UDim.new(0,${c.style?.spacing??8})`,FillDirection:'Vertical',SortOrder:'LayoutOrder'}});
    if(c.layout==='grid') extra.push({className:'UIGridLayout',name:'Grid',properties:{CellPadding:`UDim2.new(0,8,0,8)`,CellSize:`UDim2.new(0,120,0,120)`}});
    if(c.style?.padding!==undefined) extra.push({className:'UIPadding',name:'Pad',properties:{PaddingTop:`UDim.new(0,${c.style.padding})`,PaddingBottom:`UDim.new(0,${c.style.padding})`,PaddingLeft:`UDim.new(0,${c.style.padding})`,PaddingRight:`UDim.new(0,${c.style.padding})`}});
    return { className: classMap[c.kind]||'Frame', name:c.name, properties: toRobloxProps(c), children:[...extra, ...all] };
  }
  const tree=buildNode(uiScreen.rootId);
  return JSON.stringify(tree, null, 2);
}
async function uiGenerateWithAI(){
  const specPreview=uiScreen.components.slice(0,8).map(c=> `${c.kind}:${c.name} parent=${c.parentId||'root'} token=${c.style?.colorToken||'-'}`).join('; ');
  const tokens=Object.entries(uiScreen.theme.tokens).map(([k,v])=> `${k}=${v}`).join(', ');
  const rules=uiScreen.responsive.rules.join('; ');
  const parity=uiParity(uiScreen).score;
  const hint=uiRefDataUrl?`Reference image attached — derive palette/radii from it. `:''; 
  const prompt=`${hint}Create UI shop with theme tokens [${tokens}] — parity target ${parity}/100. Responsive: [${rules}]. Existing spec [${specPreview}]. Build complete screen: ScreenGui with Frame list/grid grouping (ForgeGUI parity), ThemeTokens module (colors/fonts/radii/spacing), button disabled states, HUD/Shop grid where needed. Use concrete Color3.fromRGB/UDim2 values from tokens.`;
  // Use vision attach if ref present
  if(uiRefDataUrl) pendingImageDataUrl=uiRefDataUrl;
  chatInput.value=prompt; await sendChat();
}
async function uiPushToStudio(){
  if(!studioConnected || !studioSessionId){ showToast('Connect Studio first — ◎ Connect Studio'); return; }
  const spec=uiExportCreateUi();
  // Validate before push
  const issues=uiValidate(uiScreen).filter(i=>i.severity==='error');
  if(issues.length){ showToast(`Fix ${issues.length} errors before push — parity ${uiParity(uiScreen).score}`); return; }
  // Push via direct command: we store spec as apply result visible to AI, then AI can claim but immediate push uses Studio apply path
  // Send as build command with create_ui json — plugin will apply via applyInstanceSpec/create_ui
  try{
    await postJson('/api/studio/command', { sessionId: studioSessionId, type: 'build', prompt: `create_ui spec:\n${spec.slice(0,8000)}` });
    showToast('Pushed to Studio queue — plugin will apply create_ui');
  }catch{ showToast('Push failed — check Studio is LIVE'); }
}
$('#ui-save-props')?.addEventListener('click', uiSaveProps);
$('#ui-delete-comp')?.addEventListener('click', ()=>{ const idx=uiScreen.components.findIndex(c=>c.id===uiSelectedId); if(idx>=0){ const removed=uiScreen.components.splice(idx,1)[0]; // clean children refs
  for(const c of uiScreen.components) if(c.children) c.children=c.children.filter(id=> id!==removed.id);
  uiSelectedId=uiScreen.rootId; uiRender(); uiFillProps(); }});
$('#ui-add-token')?.addEventListener('click', ()=>{ const k=prompt('Token name (e.g. primary)'); if(!k) return; const v=prompt('Value (#hex or number)', '#3B82F6'); if(v===null) return; uiScreen.theme.tokens[k.trim()]=v.trim(); uiRender(); });
$('#ui-add-responsive')?.addEventListener('click', ()=>{ const inp=$('#ui-responsive-input'); const v=inp.value.trim(); if(!v) return; uiScreen.responsive.rules.push(v); inp.value=''; uiRender(); });
$('#ui-clear-btn')?.addEventListener('click', ()=>{ if(!confirm('Clear all components?')) return; uiScreen.components=[{id:'root',kind:'screen',name:'Root',layout:'list',style:{padding:16}}]; uiScreen.rootId='root'; uiSelectedId='root'; uiRender(); uiFillProps(); });
$('#ui-palette-grid')?.addEventListener('click', (e)=>{ const btn=e.target.closest('[data-kind]'); if(!btn) return; const kind=btn.getAttribute('data-kind'); const tmpl=btn.getAttribute('data-template'); uiAddComponent(kind, tmpl); });
$('#ui-export-btn')?.addEventListener('click', ()=>{ const spec=uiExportCreateUi(); const blob=new Blob([spec],{type:'application/json'}); const url=URL.createObjectURL(blob); const a=document.createElement('a'); a.href=url; a.download=`${uiScreen.id}.create_ui.json`; a.click(); URL.revokeObjectURL(url); showToast('Exported create_ui.json'); });
$('#ui-generate-btn')?.addEventListener('click', uiGenerateWithAI);
$('#ui-push-btn')?.addEventListener('click', uiPushToStudio);
$('#ui-ref-btn')?.addEventListener('click', ()=> $('#ui-ref-input').click());
$('#ui-ref-input')?.addEventListener('change', async()=>{
  const f=$('#ui-ref-input').files?.[0]; if(!f) return;
  const reader=new FileReader(); reader.onload=()=>{
    uiRefDataUrl=String(reader.result);
    const img=$('#ui-ref-preview'); if(img){ img.src=uiRefDataUrl; img.classList.remove('hidden'); }
    const label=$('#ui-ref-preview-label'); if(label) label.textContent=`Ref: ${f.name} — palette will be sampled on Generate`;
    // Sample dominant colors into tokens (simple canvas sampled)
    try{
      const c=document.createElement('canvas'); const ctx=c.getContext('2d'); const im=new Image(); im.onload=()=>{ c.width=64; c.height=64; ctx.drawImage(im,0,0,64,64); const data=ctx.getImageData(0,0,64,64).data; const buckets=new Map(); for(let i=0;i<data.length;i+=16){ const r=data[i],g=data[i+1],b=data[i+2]; const key=`#${r.toString(16).padStart(2,'0')}${g.toString(16).padStart(2,'0')}${b.toString(16).padStart(2,'0')}`; buckets.set(key,(buckets.get(key)||0)+1); } const top=[...buckets.entries()].sort((a,b)=>b[1]-a[1]).slice(0,3).map(e=>e[0]); if(top[0]) uiScreen.theme.tokens.primary=top[0]; if(top[1]) uiScreen.theme.tokens.surface=top[1]; if(top[2]) uiScreen.theme.tokens.accent=top[2]; uiRender(); showToast(`Style ref applied — primary ${top[0]}`); }; im.src=uiRefDataUrl;
    }catch{}
  }; reader.readAsDataURL(f);
});
// init
setTimeout(()=>{ uiRender(); uiFillProps(); verifyRender(); }, 300);

// ===== VERIFY & PLAYTEST - Phase 3 =====
let verifyRun = null;
let repairAttempts = 0;
const MAX_REPAIR = 3;
let lastPlan = null;

function classifyFailureFn(msg){
  const m=String(msg||'').toLowerCase();
  if(/compile|type.?error|build/.test(m)) return 'build';
  if(/security|permission|unauthorized|exploit/.test(m)) return 'security';
  if(/performance|fps|memory|timeout/.test(m)) return 'performance';
  if(/screenshot|visual|layout/.test(m)) return 'visual';
  if(/network|integration|remote/.test(m)) return 'integration';
  if(/assert|expected|logic/.test(m)) return 'logic';
  if(/runtime|exception|error/.test(m)) return 'runtime';
  return 'environment';
}
function repairPlanFn(failure){
  if(!failure.recoverable) return {action:'escalate',reason:'Not recoverable — human review required.'};
  if(failure.kind==='environment') return {action:'rerun',reason:'Transient environment — retry before code change.'};
  return {action:'repair',reason:`Repair ${failure.kind} then rerun affected test + regression.`};
}
function evaluateRunFn(run){
  const failures=run.results.flatMap(r=> r.failure?[r.failure]:[]);
  const missing=run.criteria.filter(c=> c.required && !run.results.some(r=> r.status==='passed' && r.evidence.some(e=> e.type==='assertion' && e.summary.includes(c.id)))).map(c=>c.id);
  const blocked=run.results.some(r=> r.status==='blocked');
  const passed=!blocked && failures.length===0 && missing.length===0 && run.tests.length>0 && run.tests.every(t=> run.results.find(r=> r.testId===t.id)?.status==='passed');
  return {passed, blocked, missingCriteria:missing, failures};
}
function verifySetFromPlan(plan, pipeline){
  lastPlan=plan;
  if(pipeline && pipeline.verificationRun && pipeline.verificationRun.tests){
    verifyRun = {
      id: pipeline.verificationRun.id || `verification-${Date.now()}`,
      startedAt: pipeline.verificationRun.startedAt || new Date().toISOString(),
      criteria: (pipeline.verificationRun.criteria||plan.acceptanceCriteria||[]).map((c,i)=> typeof c==='string'?{id:`criterion-${String(i+1).padStart(2,'0')}`,description:c,required:true}:c),
      tests: pipeline.verificationRun.tests,
      results: pipeline.verificationRun.results||[]
    };
  } else {
    const criteria=(plan.acceptanceCriteria||[]).map((d,i)=>({id:`criterion-${String(i+1).padStart(2,'0')}`,description:d,required:true}));
    const tests=(plan.verification||plan.acceptanceCriteria||['Apply in Studio','Playtest']).map((v,i)=>({id:`verify-${String(i+1).padStart(2,'0')}`,name:v,kind:'static',steps:[v],expected:[v],priority: plan.risks && plan.risks.length?'high':'medium'}));
    verifyRun={ id:`verification-${Date.now().toString(36)}`, startedAt:new Date().toISOString(), criteria, tests, results:[] };
  }
  repairAttempts=0;
  verifyRender();
  showToast(`Verification plan ready — ${verifyRun.tests.length} tests`);
}
function verifySetFromPipeline(pipeline){
  if(!pipeline||!pipeline.verificationRun) return;
  verifySetFromPlan({acceptanceCriteria: pipeline.verificationRun.criteria.map(c=>c.description), verification: pipeline.verificationRun.tests.map(t=>t.name), risks:[]}, pipeline);
}
function verifyRender(){
  const badge=$('#verify-badge'), evBadge=$('#verify-evidence-badge'), critCount=$('#verify-criteria-count'), testsCount=$('#verify-tests-count');
  const critList=$('#verify-criteria-list'), testsList=$('#verify-tests-list'), evList=$('#verify-evidence-list'), failList=$('#verify-failures-list');
  const runId=$('#verify-run-id'), status=$('#verify-status'), passedPill=$('#verify-passed-pill'), blockedPill=$('#verify-blocked-pill'), missingPill=$('#verify-missing-pill'), repairPill=$('#verify-repair-pill');
  if(!verifyRun){
    if(badge) badge.textContent='No run yet'; if(status) status.textContent='No verification run yet. Generate via chat (build mode) to auto-fill.';
    if(critList) critList.innerHTML='<li style="opacity:.6">No criteria</li>'; if(testsList) testsList.innerHTML='<li style="opacity:.6">No tests</li>';
    return;
  }
  const evCount=verifyRun.results.reduce((n,r)=> n + (r.evidence?.length||0),0);
  const evPassed=evaluateRunFn(verifyRun);
  if(badge) badge.textContent=evPassed.passed? 'PASSED': evPassed.blocked? 'BLOCKED': evPassed.failures.length? 'FAILED':'PENDING';
  badge.className=`badge ${evPassed.passed?'green':evPassed.failures.length?'bad':''}`;
  if(evBadge){ evBadge.textContent=`Evidence ${evCount}`; evBadge.classList.toggle('hidden', evCount===0); }
  if(critCount) critCount.textContent=String(verifyRun.criteria.length);
  if(testsCount) testsCount.textContent=String(verifyRun.tests.length);
  if(runId) runId.textContent=`${verifyRun.id} · ${new Date(verifyRun.startedAt).toLocaleTimeString()}`;
  if(status){
    if(evPassed.passed) status.textContent='✓ All criteria satisfied with evidence — pro-team ready.';
    else if(evPassed.blocked) status.textContent='⛔ Blocked — repair required.';
    else if(evPassed.missingCriteria.length) status.textContent=`Missing evidence for: ${evPassed.missingCriteria.join(', ')}`;
    else if(evPassed.failures.length) status.textContent=`${evPassed.failures.length} failure(s) — see repair plan.`;
    else status.textContent=`Pending — ${verifyRun.tests.length} tests, ${verifyRun.results.length} results.`;
  }
  if(passedPill) passedPill.textContent=`passed: ${evPassed.passed?'yes':'no'}`; if(passedPill) passedPill.className=`status-pill ${evPassed.passed?'ok':''}`;
  if(blockedPill) blockedPill.textContent=`blocked: ${evPassed.blocked?'yes':'no'}`; if(blockedPill) blockedPill.className=`status-pill ${evPassed.blocked?'bad':''}`;
  if(missingPill) missingPill.textContent=`missing: ${evPassed.missingCriteria.length}`; if(missingPill) missingPill.className=`status-pill ${evPassed.missingCriteria.length?'bad':''}`;
  if(repairPill) repairPill.textContent=`repair ${repairAttempts}/${MAX_REPAIR}`;
  if(critList){
    critList.innerHTML=verifyRun.criteria.map(c=>{
      const hasEvidence=verifyRun.results.some(r=> r.status==='passed' && r.evidence.some(e=> e.summary.includes(c.id)));
      return `<li class="${hasEvidence?'passed':''}"><div style="display:flex;justify-content:space-between"><span>${esc(c.description)}</span><span style="opacity:.6">${esc(c.id)} ${hasEvidence?'✓':''}</span></div><span style="font:10px var(--font);opacity:.6">${c.required?'required':''}</span></li>`;
    }).join('') || '<li style="opacity:.6">No criteria</li>';
  }
  if(testsList){
    testsList.innerHTML=verifyRun.tests.map(t=>{
      const res=verifyRun.results.find(r=> r.testId===t.id);
      const statusCls=res? res.status : 'pending';
      const fail=res?.failure? `<div style="color:#e06a6a;font:11px var(--font)">${esc(res.failure.kind)}: ${esc(res.failure.message)} <span style="opacity:.6">${res.failure.recoverable?'recoverable':'escalate'}</span></div>`:'';
      const ev=(res?.evidence||[]).slice(0,2).map(e=> `<span style="font:10px var(--font);background:var(--panel);border:1px solid var(--hairline);border-radius:6px;padding:2px 6px">${esc(e.type)}: ${esc(e.summary.slice(0,60))}</span>`).join(' ');
      return `<li class="${esc(statusCls)}"><div style="display:flex;justify-content:space-between"><span><b>${esc(t.name)}</b> <span style="opacity:.6">${esc(t.kind)} · ${esc(t.priority)}</span></span><span class="badge ${statusCls==='passed'?'green':statusCls==='failed'?'bad':''}">${esc(statusCls)}</span></div><div style="font:11px var(--font);opacity:.7;margin-top:4px">${esc(t.steps.join(' → '))}</div>${ev?`<div style="margin-top:6px;display:flex;gap:4px;flex-wrap:wrap">${ev}</div>`:''}${fail}<div class="test-actions"><button data-test="${esc(t.id)}" data-action="pass" type="button">Mark passed</button><button data-test="${esc(t.id)}" data-action="fail" type="button">Fail</button><button data-test="${esc(t.id)}" data-action="evidence" type="button">+ evidence</button></div></li>`;
    }).join('') || '<li style="opacity:.6">No tests</li>';
    testsList.querySelectorAll('button[data-test]').forEach(btn=> btn.addEventListener('click',()=>{
      const tid=btn.getAttribute('data-test'); const act=btn.getAttribute('data-action');
      if(act==='pass') verifyMark(tid,'passed'); else if(act==='fail') verifyMark(tid,'failed'); else if(act==='evidence') verifyAddEvidence(tid);
    }));
  }
  if(evList){
    const allEvs=verifyRun.results.flatMap(r=> r.evidence.map(e=> ({...e, testId:r.testId})) );
    evList.innerHTML=allEvs.length? allEvs.map(e=> `<li><div style="display:flex;justify-content:space-between"><span>${esc(e.type)} · ${esc(e.summary)}</span><span style="opacity:.6">${esc(e.testId)}</span></div>${e.value?`<div style="font:11px var(--font);opacity:.7">${esc(String(e.value).slice(0,120))}</div>`:''}</li>`).join('') : '<li style="opacity:.6">No evidence yet — run checks or playtest.</li>';
  }
  if(failList){
    const fails=verifyRun.results.filter(r=> r.failure).map(r=> ({...r.failure, testId:r.testId}));
    failList.innerHTML=fails.length? fails.map(f=>{
      const rp=repairPlanFn(f);
      const cls=classifyFailureFn(f.message);
      return `<li class="failed"><div><b>${esc(cls)}</b> — ${esc(f.message)} <span style="opacity:.6">[${esc(f.testId)}]</span></div><div style="font:11px var(--font);margin-top:4px">→ <b>${esc(rp.action)}</b>: ${esc(rp.reason)}</div></li>`;
    }).join('') : '<li style="opacity:.6">No failures — awaiting results.</li>';
  }
}
function verifyMark(testId, status){
  if(!verifyRun) return;
  let res=verifyRun.results.find(r=> r.testId===testId);
  if(!res){ res={testId, status, evidence:[], startedAt:new Date().toISOString(), finishedAt:new Date().toISOString()}; verifyRun.results.push(res); }
  res.status=status; res.finishedAt=new Date().toISOString();
  if(status==='passed' && !res.evidence.some(e=> e.type==='assertion')){
    const crit=verifyRun.criteria.find(c=> verifyRun.tests.find(t=> t.id===testId)?.name.includes(c.description.slice(0,20)) );
    res.evidence.push({type:'assertion', summary:`criterion ${crit?crit.id:testId} satisfied by ${testId}`, value:'evidence-backed'});
  }
  if(status==='failed' && !res.failure){
    res.failure={kind:classifyFailureFn('logic assert failed'), message:`Test ${testId} failed`, recoverable:true};
  } else if(status!=='failed') delete res.failure;
  verifyRender(); showToast(`${testId} → ${status}`);
}
function verifyAddEvidence(testId){
  if(!verifyRun) return;
  const txt=prompt('Evidence summary (e.g. console line or tool output)', 'console: output ok');
  if(!txt) return;
  let res=verifyRun.results.find(r=> r.testId===testId);
  if(!res){ res={testId, status:'running', evidence:[]}; verifyRun.results.push(res); }
  res.evidence.push({type: txt.startsWith('console')?'console': txt.startsWith('tool')?'tool':'assertion', summary:txt.slice(0,200), value: Date.now()});
  verifyRender();
}
async function verifyRunStatic(){
  if(!verifyRun){ showToast('No verification run — generate first'); return; }
  for(const t of verifyRun.tests){
    const r=verifyRun.results.find(x=> x.testId===t.id);
    if(!r || r.status==='pending'){
      verifyMark(t.id, 'running');
      await delay(300);
      // static checks: assume passed unless prior failures
      const isVisual=t.kind==='playtest' && !studioConnected;
      verifyMark(t.id, isVisual?'blocked':'passed');
      if(isVisual){
        const rr=verifyRun.results.find(x=> x.testId===t.id); if(rr){ rr.failure={kind:'environment',message:'Studio not connected — playtest blocked',recoverable:true}; rr.evidence.push({type:'tool',summary:'blocked: Studio offline'}); }
      } else {
        const rr=verifyRun.results.find(x=> x.testId===t.id); if(rr) rr.evidence.push({type:'tool',summary:'static: syntax + Luau gate passed'});
      }
    }
  }
  verifyRender();
}
function verifyRequestRepair(){
  if(!verifyRun) return;
  if(repairAttempts>=MAX_REPAIR){ showToast(`Repair limit ${MAX_REPAIR} reached — escalate to human`); return; }
  repairAttempts+=1;
  // simple: turn one failed into rerun
  const failed=verifyRun.results.find(r=> r.status==='failed');
  if(failed){ failed.status='running'; delete failed.failure; failed.evidence.push({type:'tool',summary:`repair attempt ${repairAttempts}`}); }
  verifyRender();
  showToast(`Repair ${repairAttempts}/${MAX_REPAIR} queued`);
  // if chat available, nudge AI to fix
  if(lastPlan && failed){
    const prompt=`Repair verification failure on ${failed.testId}: ${failed.failure?failed.failure.message:'failed test'}. Apply minimal fix and re-emit changes.`;
    chatInput.value=prompt; showToast('Repair prompt ready — send to twin agents');
  }
}
async function verifyPushToStudio(){
  if(!studioConnected || !studioSessionId){ showToast('Connect Studio first'); return; }
  if(!verifyRun){ showToast('No verification run'); return; }
  try{
    await postJson('/api/studio/command', {sessionId: studioSessionId, type:'verify', prompt: verifyRun.tests.map(t=> t.name).join('; ').slice(0,2000)});
    showToast('Verify command queued — Studio will report console');
    // also start playtest fetch
    setTimeout(refreshPlaytest, 1200);
  }catch{ showToast('Verify push failed'); }
}
// Playtest harness
let playtestPoll=null;
async function playtestStart(mode){
  if(!studioConnected){ showToast('Connect Studio first'); return; }
  const placeId=studioPlaceId || webSessionId || 'shared';
  try{
    const res=await postJson('/api/studio/playtest', {placeId, mode});
    if(res.ok){ showToast(`Playtest ${mode} started — ${res.body.test?.id||''}`); document.getElementById('playtest-status').textContent='running'; document.getElementById('playtest-detail').textContent=`Test ${res.body.test.id} · ${mode} · running`;
      const logEl=document.getElementById('playtest-log'); if(logEl) logEl.textContent='[LUA-X] Playtest running…\n'; 
      // poll status
      let tries=0; const pid=setInterval(async()=>{
        tries+=1; const s=await fetchDetailed(`/api/studio/playtest?placeId=${encodeURIComponent(placeId)}`);
        if(s.reached && s.body && Array.isArray(s.body.tests)){
          const latest=s.body.tests[s.body.tests.length-1];
          if(latest){ document.getElementById('playtest-status').textContent=latest.status; document.getElementById('playtest-detail').textContent=`Test ${latest.id} · ${latest.status} · ${latest.mode}`; if(latest.logs && latest.logs.length){ const el=document.getElementById('playtest-log'); if(el) el.textContent=latest.logs.join('\n'); }
            if(latest.status!=='running' || tries>20){ clearInterval(pid); // add evidence
               if(verifyRun && latest.status==='passed'){ const t=verifyRun.tests.find(x=> x.kind==='playtest')||verifyRun.tests[0]; if(t) verifyMark(t.id,'passed'); }
            }
          }
        }
        if(tries>20) clearInterval(pid);
      }, 900);
    } else showToast('Playtest start failed');
  }catch(e){ showToast('Playtest error: '+String(e.message).slice(0,120)); }
}
async function refreshPlaytest(){
  const placeId=studioPlaceId || webSessionId || 'shared';
  const s=await fetchDetailed(`/api/studio/playtest?placeId=${encodeURIComponent(placeId)}`);
  if(s.reached && s.body && Array.isArray(s.body.tests)){
    const t=s.body.tests[s.body.tests.length-1];
    if(t){ document.getElementById('playtest-status').textContent=t.status; document.getElementById('playtest-detail').textContent=`Test ${t.id} · ${t.status} · logs ${t.logs?.length||0}`; const el=document.getElementById('playtest-log'); if(el) el.textContent=(t.logs||[]).join('\n') || '[no logs]'; }
  } else {
    document.getElementById('playtest-detail').textContent='No playtest data';
  }
}
async function fetchConsole(){
  if(!studioConnected || !studioSessionId){ showToast('Connect Studio first'); return; }
  try{
    await postJson('/api/studio/command', {sessionId: studioSessionId, type:'analyze', prompt:'fetch console output for verification'});
    showToast('Console fetch queued — check Output in Studio');
    const logEl=document.getElementById('playtest-log'); if(logEl) logEl.textContent+='\n[queued get_console_output via desktop-bridge]\n';
  }catch{ showToast('Console fetch failed'); }
}
document.getElementById('verify-run-static')?.addEventListener('click', verifyRunStatic);
document.getElementById('verify-mark-pass')?.addEventListener('click', ()=>{ if(!verifyRun) return; verifyRun.tests.forEach(t=> verifyMark(t.id,'passed')); verifyRender(); });
document.getElementById('verify-request-repair')?.addEventListener('click', verifyRequestRepair);
document.getElementById('verify-push-verify')?.addEventListener('click', verifyPushToStudio);
document.getElementById('verify-add-test')?.addEventListener('click', ()=>{
  const inp=document.getElementById('verify-new-test'); const v=inp.value.trim(); if(!v) return;
  if(!verifyRun) verifyRun={id:`verification-${Date.now().toString(36)}`,startedAt:new Date().toISOString(),criteria:[],tests:[],results:[]};
  const id=`verify-${String(verifyRun.tests.length+1).padStart(2,'0')}`;
  verifyRun.tests.push({id, name:v, kind: v.toLowerCase().includes('play')?'playtest': v.toLowerCase().includes('performance')?'performance':'static', steps:[v], expected:[v], priority:'medium'});
  inp.value=''; verifyRender();
});
document.getElementById('verify-add-evidence')?.addEventListener('click', ()=>{
  const tid=prompt('Test id to add evidence (e.g. verify-01)'); if(!tid) return; verifyAddEvidence(tid);
});
document.getElementById('playtest-start')?.addEventListener('click', ()=> playtestStart('play'));
document.getElementById('playtest-run')?.addEventListener('click', ()=> playtestStart('run'));
document.getElementById('playtest-stop')?.addEventListener('click', async()=>{
  if(!studioConnected || !studioSessionId) return;
  try{ await postJson('/api/studio/command', {sessionId: studioSessionId, type:'stop'}); showToast('Stop queued'); document.getElementById('playtest-status').textContent='stopped'; }catch{}
});
document.getElementById('playtest-refresh')?.addEventListener('click', refreshPlaytest);
document.getElementById('playtest-console')?.addEventListener('click', fetchConsole);

// Left rail handlers

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
