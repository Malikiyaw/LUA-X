import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { compileExecutionBrief } from "@lua-x/orchestrator";
import { healthStatus, VERSION } from "@lua-x/shared";

const HOST = process.env.HOST ?? "127.0.0.1";
const PORT = Number(process.env.PORT ?? 3000);

const INDEX_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>LUA-X</title>
<style>
:root{color-scheme:dark;font-family:Inter,system-ui,sans-serif;background:#07080d;color:#f5f7ff}
*{box-sizing:border-box}body{margin:0;min-height:100vh;background:radial-gradient(circle at 20% 0%,#182044 0,#07080d 42%)}
main{max-width:1100px;margin:auto;padding:48px 24px}.brand{font-size:14px;letter-spacing:.18em;font-weight:800;color:#9da8ff}.hero{margin:72px 0 32px}.hero h1{font-size:clamp(42px,8vw,82px);line-height:.95;margin:0 0 18px}.hero p{max-width:700px;color:#aeb5c8;font-size:18px;line-height:1.6}
.panel{border:1px solid #252a3a;background:#0d1019cc;border-radius:20px;padding:22px;box-shadow:0 20px 80px #0008}.row{display:flex;gap:12px}.row input{flex:1;background:#090b12;border:1px solid #30364a;color:#fff;border-radius:12px;padding:16px;font-size:16px}.row button{border:0;border-radius:12px;padding:0 22px;background:#e9ecff;color:#0b0d14;font-weight:800;cursor:pointer}.row button:disabled{opacity:.6;cursor:wait}.result{margin-top:18px;display:none}.chips{display:flex;flex-wrap:wrap;gap:8px}.chip{background:#171c2b;border:1px solid #2b3247;padding:7px 10px;border-radius:999px;color:#cbd2e9;font-size:13px}.status{color:#7df0b4;font-size:13px;margin-bottom:10px}.muted{color:#858da5}
</style></head>
<body><main><div class="brand">LUA-X / ROBLOX AI ENGINEERING STUDIO</div>
<section class="hero"><h1>Build games.<br>Engineer worlds.</h1><p>LUA-X turns creator intent into structured Roblox engineering work. Phase 0 is online: the workspace, orchestration contracts, health API, and prompt-planning core are ready for the Studio bridge.</p></section>
<section class="panel"><div class="status">● ORCHESTRATOR ONLINE</div><div class="row"><input id="prompt" placeholder="e.g. Build a round-based survival system with a lobby and rewards"><button id="plan">Plan</button></div><div id="result" class="result"></div></section></main>
<script>
const input=document.querySelector('#prompt');const button=document.querySelector('#plan');const result=document.querySelector('#result');
button.addEventListener('click',async()=>{const prompt=input.value.trim();if(!prompt)return;button.disabled=true;result.style.display='block';result.innerHTML='<span class="muted">Compiling execution brief…</span>';try{const r=await fetch('/api/plan',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({prompt})});const data=await r.json();if(!r.ok)throw new Error(data.error||'Request failed');result.innerHTML='<strong>'+escapeHtml(data.brief.objective.summary)+'</strong><p class="muted">Agents</p><div class="chips">'+data.brief.specialistAgents.map(x=>'<span class="chip">'+escapeHtml(x)+'</span>').join('')+'</div><p class="muted">Acceptance</p><div class="chips">'+data.brief.acceptanceCriteria.map(x=>'<span class="chip">'+escapeHtml(x)+'</span>').join('')+'</div>'}catch(e){result.innerHTML='<span style="color:#ff8f9b">'+escapeHtml(e.message)+'</span>'}finally{button.disabled=false}});
function escapeHtml(v){return String(v).replace(/[&<>\"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));}
</script></body></html>`;

function sendJson(response: ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload);
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "access-control-allow-origin": "*",
  });
  response.end(body);
}

async function readBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}

export const server = createServer(async (request, response) => {
  const method = request.method ?? "GET";
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? `${HOST}:${PORT}`}`);

  if (method === "OPTIONS") {
    response.writeHead(204, {
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET,POST,OPTIONS",
      "access-control-allow-headers": "content-type",
    });
    response.end();
    return;
  }

  if (method === "GET" && url.pathname === "/") {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(INDEX_HTML);
    return;
  }

  if (method === "GET" && url.pathname === "/health") {
    sendJson(response, 200, healthStatus());
    return;
  }

  if (method === "POST" && url.pathname === "/api/plan") {
    try {
      const raw = await readBody(request);
      const payload: unknown = JSON.parse(raw);
      if (!payload || typeof payload !== "object" || !("prompt" in payload) || typeof payload.prompt !== "string") {
        sendJson(response, 400, { error: "Request must contain a string prompt." });
        return;
      }
      const brief = compileExecutionBrief({ prompt: payload.prompt });
      sendJson(response, 200, { version: VERSION, brief });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Invalid request.";
      sendJson(response, 400, { error: message });
    }
    return;
  }

  sendJson(response, 404, { error: "Not found." });
});

if (process.env.NODE_ENV !== "test") {
  server.listen(PORT, HOST, () => console.log(`LUA-X listening on http://${HOST}:${PORT}`));
}
