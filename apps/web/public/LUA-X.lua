-- LUA-X Studio Plugin 1.4.0
-- Chat-first connected bridge: heartbeat, website commands, forgeGUI-style chat pane,
-- web<->plugin shared conversations, full workspace vision (explorer tree + all script source),
-- AI planning, safe apply of scripts AND real Roblox instances (UI, animation, sound, VFX,
-- geometry), connection card, disconnect/reconnect, and startup diagnostics.

local HttpService = game:GetService("HttpService")
local Selection = game:GetService("Selection")
local ChangeHistoryService = game:GetService("ChangeHistoryService")
local ScriptEditorService = game:GetService("ScriptEditorService")
local ClipboardService = game:GetService("ClipboardService")
local UserInputService = game:GetService("UserInputService")

local PLUGIN_VERSION = "1.4.1"
local DEFAULT_ENDPOINT = "https://lua-x-api.vercel.app/api/ai/generate"
local ENDPOINT_KEY = "LUA_X_API_ENDPOINT"
local TOKEN_KEY = "LUA_X_API_TOKEN"
local SESSION_KEY = "LUA_X_STUDIO_SESSION"
local HEARTBEAT_SECONDS = 4
local COMMAND_SECONDS = 2
local CONNECT_POLL_SECONDS = 2
local CHAT_POLL_SECONDS = 6
local MAX_SCRIPTS = 32
local MAX_SOURCE = 6500
local MAX_CONTEXT = 40000
local MAX_HISTORY = 50
local MAX_TREE_NODES = 1400
local TREE_DEPTH = 8
local MAX_SELECTION_DETAILS = 12
local MAX_ASSET_REFS = 24
local TREE_ROOTS = {"Workspace", "ReplicatedStorage", "ServerScriptService", "ServerStorage", "StarterPlayer", "StarterGui", "Lighting", "SoundService", "ReplicatedFirst", "Teams"}

local C = {
	bg = Color3.fromRGB(9, 11, 17), panel = Color3.fromRGB(17, 20, 29), field = Color3.fromRGB(26, 30, 41),
	stroke = Color3.fromRGB(45, 51, 68), text = Color3.fromRGB(245, 247, 255), muted = Color3.fromRGB(153, 162, 181),
	accent = Color3.fromRGB(96, 132, 186), good = Color3.fromRGB(102, 179, 124), warn = Color3.fromRGB(190, 150, 90), bad = Color3.fromRGB(201, 111, 111),
}

local toolbar = plugin:CreateToolbar("LUA-X")
local toolbarButton = toolbar:CreateButton("LUA-X", "Open connected LUA-X Studio", "rbxassetid://14978048121")
toolbarButton.ClickableWhenViewportHidden = true

local widget, statusLabel, statusDot, connectionLabel, connectionDot, sessionLabel
local endpointBox, tokenBox, promptBox, contextBox, planBox, applyButton, selectionLabel, activityLabel
local websiteChip, aiChip, errorLabel
local connCardDot, connCardStatus, connCardProject, connCardPlace, connCardSession, connCardWebsite, connDiagLabel, connButton
local chatModeButton, buildModeButton, chatPanel, buildPanel, chatScroller, chatList, chatInput, chatSend, chatSyncLabel, typingLabel
local currentPlan, currentContext = nil, {}
local chatHistory = {}
local currentMode = "chat"
local busy, applyArmed, disconnected = false, false, false
local lastClaimedRequest = nil
local sessionId = plugin:GetSetting(SESSION_KEY)
if type(sessionId) ~= "string" or sessionId == "" then sessionId = HttpService:GenerateGUID(false); plugin:SetSetting(SESSION_KEY, sessionId) end

local function ui(kind, props, parent)
	local o = Instance.new(kind)
	for k, v in pairs(props or {}) do o[k] = v end
	o.Parent = parent
	return o
end
local function round(o, r) ui("UICorner", {CornerRadius = UDim.new(0, r or 9)}, o); return o end
local function stroke(o) ui("UIStroke", {Color = C.stroke, Thickness = 1, Transparency = 0.12}, o); return o end
local function trim(v, n)
	v = tostring(v or "")
	return #v <= n and v or string.sub(v, 1, n) .. "\n… [truncated]"
end
local function endpoint()
	local v = tostring(endpointBox and endpointBox.Text or DEFAULT_ENDPOINT):gsub("^%s+", ""):gsub("%s+$", "")
	if v == "" then v = DEFAULT_ENDPOINT end
	while string.sub(v, -1) == "/" do v = string.sub(v, 1, -2) end
	if string.match(v, "/api/ai/generate$") then return v end
	if string.match(v, "/api$") then return v .. "/ai/generate" end
	return v .. "/api/ai/generate"
end
local function rootUrl() return string.gsub(endpoint(), "/api/ai/generate$", "") end
local function setStatus(text, kind)
	if statusLabel then statusLabel.Text = text end
	local color = kind == "good" and C.good or kind == "warn" and C.warn or kind == "bad" and C.bad or C.muted
	if statusLabel then statusLabel.TextColor3 = color end
	if statusDot then statusDot.BackgroundColor3 = color end
	if activityLabel then activityLabel.Text = kind == "good" and "Healthy" or kind == "bad" and "Attention" or "Working" end
end
local function setConnected(on, label)
	local statusText = on and ("Connected · " .. (label or "online")) or (disconnected and "Disconnected · tap Reconnect" or "Studio offline")
	if connectionLabel then connectionLabel.Text = statusText end
	if connectionDot then connectionDot.BackgroundColor3 = on and C.good or C.bad end
	if connCardDot then connCardDot.BackgroundColor3 = on and C.good or (disconnected and C.warn or C.bad) end
	if connCardStatus then connCardStatus.Text = on and "Connected" or (disconnected and "Disconnected" or "Offline") end
	if connCardProject then connCardProject.Text = tostring(game.Name) end
	if connCardPlace then connCardPlace.Text = tostring(game.PlaceId) end
	if connCardSession then connCardSession.Text = string.sub(sessionId, 1, 8) .. "…" end
	if connCardWebsite then connCardWebsite.Text = "—" end
	if connButton then connButton.Text = on and "Disconnect" or (disconnected and "Reconnect" or "Disconnect") end
	if connButton then connButton.Visible = true end
	if chatSyncLabel then chatSyncLabel.Text = on and "· synced to web" or "· local only" end
	if chatSyncLabel then chatSyncLabel.TextColor3 = on and C.good or C.muted end
end
local function token()
	return tostring(plugin:GetSetting(TOKEN_KEY) or ""):gsub("^%s+", ""):gsub("%s+$", "")
end
local function request(method, url, payload)
	local headers = {Accept = "application/json"}
	local tok = token()
	if tok ~= "" then headers["Authorization"] = "Bearer " .. tok end
	local options = {Url = url, Method = method, Headers = headers}
	if payload ~= nil then options.Headers["Content-Type"] = "application/json"; options.Body = HttpService:JSONEncode(payload) end
	return HttpService:RequestAsync(options)
end
local function bodyError(response)
	local raw = tostring(response and (response.Body or response.StatusMessage) or "Request failed")
	local ok, parsed = pcall(function() return HttpService:JSONDecode(raw) end)
	if ok and type(parsed) == "table" then
		if type(parsed.error) == "table" and type(parsed.error.message) == "string" then return parsed.error.message end
		if type(parsed.error) == "string" then return parsed.error end
		if type(parsed.detail) == "string" then return parsed.detail end
	end
	return trim(raw, 300)
end
local function safe(method, url, payload, tries)
	local last
	for i = 1, tries or 2 do
		local ok, response = pcall(function() return request(method, url, payload) end)
		if ok and response and response.Success then return true, response end
		last = response or last
		if response and response.StatusCode and response.StatusCode < 500 and response.StatusCode ~= 429 then break end
		task.wait(0.35 * i)
	end
	return false, last
end

local function pathOf(instance)
	local p, cur = {}, instance
	while cur and cur ~= game do table.insert(p, 1, cur.Name); cur = cur.Parent end
	return #p > 0 and "game." .. table.concat(p, ".") or "game"
end
local function findPath(path)
	local n = tostring(path or ""):gsub("^game%.?", "")
	if n == "" then return game end
	local cur = game
	for _, part in ipairs(string.split(n, ".")) do if part == "" then return nil end; cur = cur:FindFirstChild(part); if not cur then return nil end end
	return cur
end
local function readSource(object)
	local ok, value = pcall(function() return object.Source end)
	return ok and type(value) == "string" and value or nil
end
local function selectedScripts()
	local result, seen = {}, {}
	for _, item in ipairs(Selection:Get()) do
		if item:IsA("LuaSourceContainer") and not seen[item] then table.insert(result, item); seen[item] = true end
		for _, desc in ipairs(item:GetDescendants()) do
			if #result >= MAX_SCRIPTS then break end
			if desc:IsA("LuaSourceContainer") and not seen[desc] then table.insert(result, desc); seen[desc] = true end
		end
		if #result >= MAX_SCRIPTS then break end
	end
	return result
end
local function compactTree()
	local lines, count = {}, 0
	local function walk(inst, depth)
		if count >= MAX_TREE_NODES or depth > TREE_DEPTH then return end
		table.insert(lines, string.rep("  ", depth) .. inst.Name .. " (" .. inst.ClassName .. ")")
		count = count + 1
		if inst.ClassName == "Terrain" then return end
		for _, child in ipairs(inst:GetChildren()) do walk(child, depth + 1) end
	end
	local covered = {}
	for _, root in ipairs(TREE_ROOTS) do
		local svc = game:FindService(root)
		if svc then covered[svc] = true; walk(svc, 0) end
	end
	for _, child in ipairs(game:GetChildren()) do
		if not covered[child] then walk(child, 0) end
	end
	return table.concat(lines, "\n")
end
local function collectScripts(seen, files, sourceParts)
	local function take(script)
		if #files >= MAX_SCRIPTS or seen[script] then return end
		seen[script] = true
		table.insert(files, pathOf(script))
		local source = readSource(script)
		if source then table.insert(sourceParts, "-- " .. pathOf(script) .. "\n" .. trim(source, MAX_SOURCE)) end
	end
	for _, script in ipairs(selectedScripts()) do take(script) end
	for _, root in ipairs(TREE_ROOTS) do
		if #files >= MAX_SCRIPTS then break end
		local svc = game:FindService(root)
		if svc then
			for _, desc in ipairs(svc:GetDescendants()) do
				if #files >= MAX_SCRIPTS then break end
				if desc:IsA("LuaSourceContainer") then take(desc) end
			end
		end
	end
end
local function safeGetProp(inst, prop)
	local ok, v = pcall(function() return inst[prop] end)
	if not ok then return nil end
	return v
end
local function selectionDetailsList(selected)
	local out = {}
	for i = 1, math.min(#selected, MAX_SELECTION_DETAILS) do
		local inst = selected[i]
		local entry = { path = pathOf(inst), className = inst.ClassName, name = inst.Name, parent = inst.Parent and inst.Parent.Name or "nil", childCount = #inst:GetChildren() }
		local pos = safeGetProp(inst, "Position")
		if typeof(pos) == "Vector3" then entry.position = string.format("Vector3.new(%.2f, %.2f, %.2f)", pos.X, pos.Y, pos.Z) end
		local size = safeGetProp(inst, "Size")
		if typeof(size) == "Vector3" then entry.size = string.format("Vector3.new(%.2f, %.2f, %.2f)", size.X, size.Y, size.Z) end
		local cf = safeGetProp(inst, "CFrame")
		if typeof(cf) == "CFrame" then local p = cf.Position; entry.cframe = string.format("CFrame.new(%.2f, %.2f, %.2f)", p.X, p.Y, p.Z) end
		local anchored = safeGetProp(inst, "Anchored")
		if type(anchored) == "boolean" then entry.anchored = anchored end
		local mat = safeGetProp(inst, "Material")
		if mat then entry.material = tostring(mat) end
		local color = safeGetProp(inst, "Color")
		if typeof(color) == "Color3" then entry.color = string.format("Color3.fromRGB(%d,%d,%d)", math.floor(color.R*255), math.floor(color.G*255), math.floor(color.B*255)) end
		local trans = safeGetProp(inst, "Transparency")
		if type(trans) == "number" then entry.transparency = trans end
		-- Luau service tags
		local attrs = safeGetProp(inst, "GetAttributes")
		if type(attrs) == "function" then
			local ok2, a = pcall(function() return inst:GetAttributes() end)
			if ok2 and type(a) == "table" then
				local count = 0; for _ in pairs(a) do count+=1 end
				if count>0 then entry.hasAttributes = true end
			end
		end
		table.insert(out, entry)
	end
	return out
end
local function collectInstanceCounts()
	local counts = {}
	for _, root in ipairs(TREE_ROOTS) do
		local svc = game:FindService(root)
		if svc then
			local n = #svc:GetDescendants()
			counts[root] = n
		end
	end
	local ok, placeCount = pcall(function() return #game:GetDescendants() end)
	if ok then counts["_total"] = placeCount end
	return counts
end
local function collectAssetRefs()
	local refs, seen = {}, {}
	local function checkAssetProps(inst, path)
		if #refs >= MAX_ASSET_REFS then return end
		local probes = {"SoundId","Texture","TextureId","MeshId","AnimationId","Image","AssetId"}
		for _, prop in ipairs(probes) do
			local v = safeGetProp(inst, prop)
			if type(v) == "string" and v:find("rbxasset") then
				local key = path .. "." .. prop
				if not seen[key] then seen[key]=true; table.insert(refs, {path=path, property=prop, value=trim(v,120)}) end
				if #refs >= MAX_ASSET_REFS then return end
			end
		end
	end
	for _, root in ipairs(TREE_ROOTS) do
		if #refs >= MAX_ASSET_REFS then break end
		local svc = game:FindService(root)
		if svc then
			for _, desc in ipairs(svc:GetDescendants()) do
				if #refs >= MAX_ASSET_REFS then break end
				checkAssetProps(desc, pathOf(desc))
			end
		end
	end
	return refs
end
local function getLightingSummary()
	local lighting = game:FindService("Lighting")
	if not lighting then return nil end
	local summary = {}
	local clock = safeGetProp(lighting, "ClockTime")
	if type(clock)=="number" then summary.clockTime = clock end
	local brightness = safeGetProp(lighting, "Brightness")
	if type(brightness)=="number" then summary.brightness = brightness end
	local tech = safeGetProp(lighting, "Technology")
	if tech then summary.technology = tostring(tech) end
	return summary
end
local function refreshContext()
	local selected = Selection:Get()
	local instances, files, sourceParts, seen = {}, {}, {}, {}
	for _, item in ipairs(selected) do table.insert(instances, pathOf(item) .. " [" .. item.ClassName .. "]") end
	collectScripts(seen, files, sourceParts)
	local tree = compactTree()
	local selDetails = selectionDetailsList(selected)
	local counts = collectInstanceCounts()
	local assets = collectAssetRefs()
	local lighting = getLightingSummary()
	currentContext = {
		place = { name = tostring(game.Name), placeId = tostring(game.PlaceId), services = TREE_ROOTS },
		selection = instances,
		selectionDetails = selDetails,
		workspaceTree = tree,
		scripts = files,
		architecture = trim(table.concat(sourceParts, "\n\n"), MAX_CONTEXT),
		instanceCounts = counts,
		assetReferences = assets,
		lighting = lighting,
		screenCaptureAvailable = false,
		constraints = {"Use the current Roblox Studio selection as context.", "workspaceTree is the live Studio explorer — you can see the whole place.", "scripts lists every Lua source LUA-X could read; architecture holds their full source.", "Never expose provider API keys.", "Prefer minimal reversible changes.", "Never claim runtime verification without evidence.", "selectionDetails holds live properties for selected instances; instanceCounts is per-service descendent counts; assetReferences lists rbxasset fields."},
	}
	-- Adaptive trim to stay under server CONTEXT_MAX_BYTES 60000
	local okJson, jsonStr = pcall(function() return HttpService:JSONEncode(currentContext) end)
	if okJson and #jsonStr > 55000 then
		local over = #jsonStr - 55000
		local arch = currentContext.architecture or ""
		if #arch > over + 1000 then
			currentContext.architecture = trim(arch, math.max(4000, #arch - over - 1000))
		else
			-- fallback trim workspaceTree
			local t = currentContext.workspaceTree or ""
			if #t > over + 2000 then currentContext.workspaceTree = trim(t, math.max(2000, #t - over - 1000)) end
		end
	end
	if contextBox then contextBox.Text = table.concat({"SELECTIONS  " .. #selected, "SCRIPTS     " .. #files, "TREE        " .. select(2, tree:gsub("\n", "\n")) + 1 .. " nodes", "", "TREE", #tree > 0 and trim(tree, 1500) or "(empty)", #files > 0 and ("\nSCRIPTS\n" .. table.concat(files, "\n")) or ""}, "\n") end
	if selectionLabel then selectionLabel.Text = tostring(#selected) .. " selected" end
	contextDirty = true
end
local contextDirty = false
local function pushContext()
	if disconnected or contextDirty == false then return end
	contextDirty = false
	local ok, response = safe("POST", rootUrl() .. "/api/studio/context", {sessionId = sessionId, context = type(currentContext) == "table" and currentContext or {}}, 1)
	if not ok then contextDirty = true end
end
local function saveEndpoint() local value = endpoint(); endpointBox.Text = value; plugin:SetSetting(ENDPOINT_KEY, value); return value end

local function heartbeatBody()
	local context = type(currentContext) == "table" and currentContext or {}
	return {
		projectId = tostring(game.PlaceId),
		sessionId = sessionId,
		placeName = tostring(game.Name),
		placeId = tostring(game.PlaceId),
		pluginVersion = PLUGIN_VERSION,
		capabilities = {"chat", "context", "build", "apply", "verify", "instances", "sync", "vision"},
		context = {selection=#Selection:Get(), scripts=#(type(context.scripts)=="table" and context.scripts or {}), tree=select(2, tostring(context.workspaceTree or ""):gsub("\n", "\n")) + 1},
	}
end

local lastDiagnostic = ""
local function reportError(message)
	local text = tostring(message or "")
	if text == lastDiagnostic then return end
	lastDiagnostic = text
	if connDiagLabel then connDiagLabel.Text = "Last error: " .. trim(text, 160) end
	if text:find("not enabled", 1, true) or text:find("HttpService", 1, true) then
		setStatus("HTTP Requests disabled — Game Settings → Security → Allow HTTP Requests", "bad")
	elseif text:find("404", 1, true) or text:find("Not Found", 1, true) then
		setStatus("API endpoint not found — check the endpoint URL is correct.", "bad")
	elseif text:find("401", 1, true) or text:find("Unauthorized", 1, true) then
		setStatus("Authorization rejected — add your LUA-X API token and Save Token.", "bad")
	elseif text:find("CORS", 1, true) or text:find("cross-origin", 1, true) then
		setStatus("CORS blocked — the API server must allow requests from this origin.", "bad")
	elseif text:find("timeout", 1, true) or text:find("abort", 1, true) then
		setStatus("Request timed out — the API server may be cold starting, retrying…", "warn")
	else
		setStatus("Backend unreachable: " .. trim(text, 120), "bad")
	end
end

local function heartbeat()
	if disconnected then return end
	local ok, response = safe("POST", rootUrl() .. "/api/studio/heartbeat", heartbeatBody(), 2)
	if ok then
		local dOk, data = pcall(function() return HttpService:JSONDecode(response.Body) end)
		local versionStatus = dOk and type(data) == "table" and data.versionStatus or "current"
		setConnected(true, dOk and type(data)=="table" and data.projectId and ("Place " .. tostring(data.projectId)) or "online")
		if connCardWebsite then connCardWebsite.Text = "Online" end
		lastDiagnostic = ""
		if versionStatus == "update_required" then setStatus("Plugin update required — website expects LUA-X " .. PLUGIN_VERSION .. "+.", "warn") end
	else
		setConnected(false)
		if connCardWebsite then connCardWebsite.Text = "Offline" end
		reportError(response and (response.StatusMessage or response.Body) or "network error")
	end
end

local function registerSession(requestId)
	if disconnected then return false end
	local body = heartbeatBody()
	if type(requestId) == "string" and requestId ~= "" then body.requestId = requestId end
	local ok, response = safe("POST", rootUrl() .. "/api/studio/register", body, 3)
	if ok then
		local dOk, data = pcall(function() return HttpService:JSONDecode(response.Body) end)
		if dOk and type(data) == "table" and data.connected then
			setConnected(true, "Place " .. tostring(data.projectId or ""))
			if connCardWebsite then connCardWebsite.Text = "Online" end
			lastDiagnostic = ""
			return true
		end
	end
	reportError(response and (response.StatusMessage or response.Body) or "network error")
	return false
end

local function pollConnectionRequests()
	if disconnected then return end
	local ok, response = safe("GET", rootUrl() .. "/api/studio/connect/pending", nil, 1)
	if not ok or not response then return end
	local dOk, data = pcall(function() return HttpService:JSONDecode(response.Body) end)
	if not dOk or type(data) ~= "table" or type(data.request) ~= "table" then return end
	local request = data.request
	if type(request.requestId) ~= "string" or request.requestId == "" then return end
	if request.requestId == lastClaimedRequest then return end
	local regOk = registerSession(request.requestId)
	if regOk then
		lastClaimedRequest = request.requestId
		setStatus("Website connection request answered · session registered.", "good")
		task.defer(function() pcall(heartbeat) end)
	else
		lastClaimedRequest = nil
	end
end

local function refreshRemoteStatus()
	if not websiteChip or not aiChip then return end
	local wOk, wResponse = safe("GET", rootUrl() .. "/api/health", nil, 1)
	websiteChip.Text = wOk and "Website: Online" or "Website: Offline"
	websiteChip.TextColor3 = wOk and C.good or C.bad
	if connCardWebsite then connCardWebsite.Text = wOk and "Online" or "Offline" end
	local aOk, aResponse = safe("GET", rootUrl() .. "/api/ai/status", nil, 1)
	local configured = false
	if aOk and aResponse then
		local dOk, data = pcall(function() return HttpService:JSONDecode(aResponse.Body) end)
		configured = dOk and type(data) == "table" and data.configured == true
	end
	aiChip.Text = configured and "AI: Ready" or "AI: —"
	aiChip.TextColor3 = configured and C.good or C.warn
end

local function startupDiagnostics()
	local lines = {}
	local hOk, hResponse = safe("GET", rootUrl() .. "/api/health", nil, 1)
	table.insert(lines, hOk and "API health: online" or "API health: unreachable (check endpoint URL + Vercel deployment)")
	local aOk, aResponse = safe("GET", rootUrl() .. "/api/ai/status", nil, 1)
	local aiReady = false
	if aOk and aResponse then
		local dOk, data = pcall(function() return HttpService:JSONDecode(aResponse.Body) end)
		aiReady = dOk and type(data) == "table" and data.configured == true
	end
	table.insert(lines, aiReady and "AI backend: ready (" .. (aOk and "keys ok" or "no keys") .. ")" or "AI backend: not configured (set NVIDIA_API_KEY in Vercel → All Environments + Redeploy)")
	local regOk = registerSession()
	table.insert(lines, regOk and "Session registration: ok" or "Session registration: failed (endpoint unreachable or Vercel cold start — retry)")
	table.insert(lines, "HTTP Requests: " .. (hOk and "enabled" or "DISABLED → Game Settings → Security → Allow HTTP Requests ON"))
	if hOk then table.insert(lines, "Endpoint: " .. endpoint())
	else table.insert(lines, "Endpoint tried: " .. rootUrl() .. "/api/health — check Vercel domain matches website URL") end
	if connDiagLabel then connDiagLabel.Text = table.concat(lines, "\n") end
	return regOk
end

local function setMode(mode)
	currentMode = mode
	if chatPanel then chatPanel.Visible = mode == "chat" end
	if buildPanel then buildPanel.Visible = mode == "build" end
	if chatModeButton then chatModeButton.BackgroundColor3 = mode == "chat" and C.accent or C.field end
	if buildModeButton then buildModeButton.BackgroundColor3 = mode == "build" and C.accent or C.field end
	if chatModeButton then chatModeButton.TextColor3 = mode == "chat" and C.text or C.muted end
	if buildModeButton then buildModeButton.TextColor3 = mode == "build" and C.text or C.muted end
end

local function verifyLocal()
	local count = #Selection:Get(); local scripts = #selectedScripts(); local ops = type(currentPlan)=="table" and type(currentPlan.changes)=="table" and #currentPlan.changes or 0
	planBox.Text = table.concat({"LUA-X VERIFICATION","","Plugin:    LUA-X " .. PLUGIN_VERSION,"Endpoint: " .. endpoint(),"Session:  " .. sessionId,"Place:    " .. tostring(game.PlaceId),"Selected: " .. count,"Scripts:  " .. scripts,"Plan ops: " .. ops,"","Plugin health verified. Runtime playtest not claimed."},"\n")
	setStatus("Studio-side verification complete.", "good")
end

local function pollCommands()
	local ok, response = safe("GET", rootUrl() .. "/api/studio/command?sessionId=" .. HttpService:UrlEncode(sessionId), nil, 1)
	if not ok or not response then return end
	local dOk, data = pcall(function() return HttpService:JSONDecode(response.Body) end)
	if not dOk or type(data) ~= "table" or type(data.command) ~= "table" then return end
	local command = data.command
	if command.type == "ping" then setStatus("Website handshake received · ping answered.", "good")
	elseif command.type == "refresh_context" then refreshContext(); setStatus("Context refresh requested by website · synced.", "good")
	elseif command.type == "analyze" then refreshContext(); setStatus("Analyze requested by website · context synced.", "good")
	elseif command.type == "verify" then verifyLocal(); setStatus("Verify requested by website · done.", "good")
	elseif command.type == "stop" then setStatus("Stop requested by website · idle.", "warn")
	elseif command.type == "build" and type(command.prompt) == "string" then
		setMode("build")
		promptBox.Text = command.prompt
		setStatus("Build request received from LUA-X web.", "good")
		task.defer(function() if promptBox and promptBox.Parent then promptBox:CaptureFocus() end end)
	end
end

local function disconnectNow()
	if disconnected then return end
	disconnected = true
	local ok, response = safe("POST", rootUrl() .. "/api/studio/disconnect", {sessionId = sessionId}, 2)
	setConnected(false)
	if connCardWebsite then connCardWebsite.Text = "Offline" end
	setStatus(ok and "Disconnected from LUA-X web · click Reconnect to resume." or "Disconnect failed: " .. (response and bodyError(response) or "unreachable"), "warn")
end

local function reconnectNow()
	disconnected = false
	local ok = registerSession()
	if ok then setStatus("Reconnected · session registered with LUA-X web.", "good")
	else
		setStatus("Could not complete Studio handshake — check the connection card and Run Diagnostics for the exact reason.", "bad")
	end
end

local function writeSource(object, source)
	local ok, err = pcall(function() ScriptEditorService:UpdateSourceAsync(object, function() return source end) end)
	if ok then return true end
	local fallback, fallbackErr = pcall(function() object.Source = source end)
	return fallback, fallback and nil or tostring(fallbackErr or err)
end

local function numbers(s)
	local out = {}
	for n in string.gmatch(s, "%-?%d+%.?%d*") do
		local v = tonumber(n)
		if v ~= nil then table.insert(out, v) end
	end
	return out
end
local function resolveColor3(s)
	local inner = string.match(s, "%((.*)%)")
	if not inner then return nil end
	local r, g, b = string.match(inner, "(%d+)%s*,%s*(%d+)%s*,%s*(%d+)")
	if not r then return nil end
	return Color3.fromRGB(tonumber(r), tonumber(g), tonumber(b))
end
local function resolveNumberRange(s)
	local inner = string.match(s, "%((.*)%)")
	local n = inner and numbers(inner) or {}
	if #n == 1 then return NumberRange.new(n[1]) end
	if #n >= 2 then return NumberRange.new(n[1], n[2]) end
end
local function resolveNumberSequence(s)
	local inner = string.match(s, "%((.*)%)")
	if not inner then return nil end
	if string.find(inner, "NumberSequenceKeypoint", 1, true) then
		local stops = {}
		for t, v in string.gmatch(inner, "NumberSequenceKeypoint%.new%s*%(%s*([%d%.%-]+)%s*,%s*([%d%.%-]+)%s*%)") do
			table.insert(stops, NumberSequenceKeypoint.new(tonumber(t), tonumber(v)))
		end
		if #stops > 0 then return NumberSequence.new(stops) end
	end
	local n = numbers(inner)
	if #n == 1 then return NumberSequence.new(n[1]) end
	if #n >= 2 then return NumberSequence.new(n[1], n[2]) end
end
local function resolveColorSequence(s)
	local inner = string.match(s, "%((.*)%)")
	if not inner then return nil end
	if string.find(inner, "ColorSequenceKeypoint", 1, true) then
		local stops = {}
		for t, r, g, b in string.gmatch(inner, "ColorSequenceKeypoint%.new%s*%(%s*([%d%.%-]+)%s*,%s*Color3%.fromRGB%s*%(%s*(%d+)%s*,%s*(%d+)%s*,%s*(%d+)%s*%)%s*%)") do
			table.insert(stops, ColorSequenceKeypoint.new(tonumber(t), Color3.fromRGB(tonumber(r), tonumber(g), tonumber(b))))
		end
		if #stops > 0 then return ColorSequence.new(stops) end
	end
	local colors = {}
	for c in string.gmatch(inner, "Color3%.fromRGB%s*%(%s*%d+%s*,%s*%d+%s*,%s*%d+%s*%)") do
		local col = resolveColor3(c)
		if col then table.insert(colors, col) end
	end
	if #colors == 1 then return ColorSequence.new(colors[1]) end
	if #colors >= 2 then return ColorSequence.new(colors[1], colors[2]) end
end
local function resolveCFrame(s)
	local inner = string.match(s, "%((.*)%)")
	local n = inner and numbers(inner) or {}
	if #n == 3 then return CFrame.new(n[1], n[2], n[3]) end
	if #n == 6 then return CFrame.new(n[1], n[2], n[3], n[4], n[5], n[6]) end
	if #n == 12 then return CFrame.new(n[1], n[2], n[3], n[4], n[5], n[6], n[7], n[8], n[9], n[10], n[11], n[12]) end
end
local function resolveEnum(s)
	local cur = Enum
	for _, part in ipairs(string.split(s, ".")) do
		if part ~= "Enum" then
			local nextCur = cur[part]
			if nextCur == nil then return nil end
			cur = nextCur
		end
	end
	return cur
end
local function resolveValue(value)
	if type(value) == "number" or type(value) == "boolean" then return value end
	if type(value) ~= "string" then return nil end
	local v = tostring(value):gsub("^%s+", ""):gsub("%s+$", "")
	if v == "" then return "" end
	if string.match(v, "^Color3%.fromRGB%(") then local r = resolveColor3(v); if r then return r end end
	if string.match(v, "^ColorSequence%.new%(") then local r = resolveColorSequence(v); if r then return r end end
	if string.match(v, "^NumberRange%.new%(") then local r = resolveNumberRange(v); if r then return r end end
	if string.match(v, "^NumberSequence%.new%(") then local r = resolveNumberSequence(v); if r then return r end end
	if string.match(v, "^Vector3%.new%(") then local n = numbers(v); if #n >= 3 then return Vector3.new(n[1], n[2], n[3]) end end
	if string.match(v, "^Vector2%.new%(") then local n = numbers(v); if #n >= 2 then return Vector2.new(n[1], n[2]) end end
	if string.match(v, "^UDim2%.new%(") then local n = numbers(v); if #n >= 4 then return UDim2.new(n[1], n[2], n[3], n[4]) end end
	if string.match(v, "^UDim%.new%(") then local n = numbers(v); if #n >= 2 then return UDim.new(n[1], n[2]) end end
	if string.match(v, "^BrickColor%.new%(") then local name = string.match(v, "%((.-)%)"); if name then local ok, r = pcall(BrickColor.new, name); if ok then return r end end end
	if string.match(v, "^CFrame%.new%(") then local r = resolveCFrame(v); if r then return r end end
	if string.match(v, "^CFrame%.lookAt%(") then local n = numbers(v); if #n >= 6 then return CFrame.lookAt(n[1], n[2], n[3], n[4], n[5], n[6]) end end
	if string.match(v, "^Ray%.new%(") then local n = numbers(v); if #n >= 6 then return Ray.new(Vector3.new(n[1], n[2], n[3]), Vector3.new(n[4], n[5], n[6])) end end
	if string.match(v, "^Enum%.") then local r = resolveEnum(v); if r then return r end end
	return v
end

local INSTANCE_OP_DEFAULTS = {
	create_animation = "Animation",
	create_sound = "Sound",
	create_vfx = "ParticleEmitter",
	create_ui = "Frame",
}

local function applyInstanceSpec(spec, parentPath, defaultClass)
	local okJson, specData = pcall(HttpService.JSONDecode, HttpService, spec)
	if not okJson or type(specData) ~= "table" then return false, "invalid instance spec (expect JSON {className, name?, properties})" end
	local className = type(specData.className) == "string" and specData.className ~= "" and specData.className or defaultClass
	local properties = type(specData.properties) == "table" and specData.properties or {}
	local name = type(specData.name) == "string" and specData.name ~= "" and specData.name or nil
	if not className then return false, "instance className required (e.g. Part, Frame, Sound)" end
	local parent = findPath(parentPath)
	if not parent then return false, "parent not found: " .. parentPath end
	local okCreate, object = pcall(Instance.new, className)
	if not okCreate then return false, "unknown class: " .. className end
	local function fail(reason)
		pcall(function() object:Destroy() end)
		return false, reason
	end
	for key, rawValue in pairs(properties) do
		if key ~= "Parent" then
			local okSet, err = pcall(function()
				local resolved = resolveValue(rawValue)
				object[key] = resolved
			end)
			if not okSet then return fail("property " .. tostring(key) .. " failed: " .. tostring(err)) end
		end
	end
	if name then object.Name = name end
	local okParent, parentErr = pcall(function() object.Parent = parent end)
	if not okParent then return fail("parent failed: " .. tostring(parentErr)) end
	return true, "created " .. tostring(object.ClassName) .. " " .. (name or object.Name) .. " under " .. parentPath
end

local function applyProposal(proposal)
	local op, target, content = proposal.operation, proposal.target, proposal.content
	if op == "note" then return false, "note (not applied)" end
	if op == "update_script" or op == "create_script" then
		if type(target) ~= "string" or target == "" or type(content) ~= "string" then return false, "invalid proposal" end
		if op == "update_script" then
			local object = findPath(target)
			if not object or not object:IsA("LuaSourceContainer") then return false, "script not found: " .. target end
			local ok, err = writeSource(object, content)
			return ok, ok and ("updated " .. target) or ("failed " .. target .. ": " .. tostring(err))
		end
		local parts = string.split(target, ".")
		local name = table.remove(parts)
		local parent = findPath(table.concat(parts, "."))
		if not name or not parent or parent:FindFirstChild(name) then return false, "invalid/existing target: " .. target end
		local object = Instance.new("Script")
		object.Name = name
		object.Parent = parent
		local ok, err = writeSource(object, content)
		if not ok then object:Destroy(); return false, "failed " .. target .. ": " .. tostring(err) end
		return true, "created " .. target
	end
	if op == "delete_instance" then
		if type(target) ~= "string" or target == "" then return false, "invalid target" end
		local object = findPath(target)
		if not object or object == game then return false, "instance not found: " .. target end
		object:Destroy()
		return true, "deleted " .. target
	end
	if op == "update_instance" then
		if type(target) ~= "string" or target == "" or type(content) ~= "string" then return false, "invalid proposal" end
		local object = findPath(target)
		if not object then return false, "instance not found: " .. target end
		local okJson, spec = pcall(HttpService.JSONDecode, HttpService, content)
		if not okJson or type(spec) ~= "table" or type(spec.properties) ~= "table" then return false, "invalid instance spec" end
		local count = 0
		for key, rawValue in pairs(spec.properties) do
			if key ~= "Parent" then
				local okSet, err = pcall(function() object[key] = resolveValue(rawValue) end)
				if not okSet then return false, "property " .. tostring(key) .. " failed: " .. tostring(err) end
				count = count + 1
			end
		end
		return true, "updated " .. target .. " (" .. count .. " properties)"
	end
	if INSTANCE_OP_DEFAULTS[op] then
		local spec = type(content) == "string" and content or "{}"
		return applyInstanceSpec(spec, target, INSTANCE_OP_DEFAULTS[op])
	end
	return false, "unsupported operation: " .. tostring(op)
end

local function generatePlan()
	if busy then return end
	local prompt = tostring(promptBox.Text or ""):gsub("^%s+", ""):gsub("%s+$", "")
	if #prompt < 2 then setStatus("Describe the change first.", "bad"); return end
	busy = true; applyArmed = false; applyButton.Text = "Apply Changes"; refreshContext(); setStatus("LUA-X is generating a structured plan…", "warn")
	local history = {}
	for i = math.max(1, #chatHistory - 10), #chatHistory do
		local entry = chatHistory[i]
		if type(entry) == "table" and (entry.role == "user" or entry.role == "assistant") and type(entry.text) == "string" then
			table.insert(history, {role = entry.role, content = entry.text})
		end
	end
	local payload = {prompt=prompt, projectId=tostring(game.PlaceId), mode="build", context=currentContext, history=history}
	if not disconnected then payload.sessionId = sessionId; payload.surface = "plugin" end
	local ok, response = safe("POST", saveEndpoint(), payload, 3)
	busy = false
	if not ok then
		if response and response.StatusCode == 401 then
			setStatus("Authorization rejected — add your LUA-X API token and Save Token.", "bad")
		else
			setStatus("Backend " .. tostring(response and response.StatusCode or "error") .. ": " .. (response and bodyError(response) or "unreachable"), "bad")
		end
		warn("[LUA-X] " .. (response and bodyError(response) or "request failed")); return
	end
	local dOk, data = pcall(function() return HttpService:JSONDecode(response.Body) end)
	if not dOk or type(data) ~= "table" then setStatus("Backend returned invalid JSON.", "bad"); return end
	if data.error then setStatus("LUA-X: " .. tostring(data.error), "bad"); return end
	if type(data.plan) ~= "table" or type(data.plan.changes) ~= "table" then
		if type(data.rawText) == "string" and data.rawText ~= "" then
			planBox.Text = "LUA-X returned a non-plan response:\n\n" .. trim(data.rawText, 2600)
			setStatus("AI response was not a valid plan — review raw text.", "warn")
		else
			setStatus("No valid change plan returned.", "bad")
		end
		return
	end
	currentPlan = data.plan
	planBox.Text = HttpService:JSONEncode(data.plan)
	setStatus("Plan ready · review before applying.", "good")
end
local function applyPlan()
	if busy then return end
	if type(currentPlan) ~= "table" or type(currentPlan.changes) ~= "table" then setStatus("Generate a plan first.", "bad"); return end
	local changes = {}
	for _, proposal in ipairs(currentPlan.changes) do if type(proposal)=="table" and proposal.operation ~= "note" then table.insert(changes, proposal) end end
	if #changes == 0 then setStatus("No automatically applicable changes.", "warn"); return end
	if not applyArmed then applyArmed=true; applyButton.Text="Confirm Apply  ·  " .. #changes; setStatus("Review the change set, then confirm.", "warn"); return end
	busy=true; applyArmed=false; applyButton.Text="Applying…"; ChangeHistoryService:SetWaypoint("LUA-X · Before Apply")
	local success, failed, results = 0, 0, {}
	for _, proposal in ipairs(changes) do local ok, result=applyProposal(proposal); if ok then success+=1; table.insert(results,"OK   "..result) else failed+=1; table.insert(results,"FAIL "..result) end end
	ChangeHistoryService:SetWaypoint("LUA-X · After Apply"); busy=false; applyButton.Text="Apply Changes"; planBox.Text=table.concat(results,"\n")
	setStatus(string.format("Applied %d · failed %d · Studio Undo available.", success, failed), failed==0 and "good" or "bad")
	if not disconnected then
		local summary = type(currentPlan) == "table" and type(currentPlan.summary) == "string" and currentPlan.summary or "Plan"
		pcall(function()
			safe("POST", rootUrl() .. "/api/studio/apply", {
				sessionId = sessionId,
				planSummary = summary,
				success = success,
				failed = failed,
				results = results,
			}, 1)
		end)
	end
end

local function codeSegments(text)
	local segments, pos, openIdx = {}, 1, nil
	while true do
		local start = string.find(text, "```", pos, true)
		if not start then break end
		if openIdx == nil then
			if start > pos then table.insert(segments, {code = false, text = string.sub(text, pos, start - 1)}) end
			openIdx = start
			pos = start + 3
		else
			table.insert(segments, {code = true, text = string.sub(text, openIdx + 3, start - 1)})
			openIdx = nil
			pos = start + 3
		end
	end
	if openIdx ~= nil then table.insert(segments, {code = true, text = string.sub(text, openIdx + 3)}) end
	if openIdx == nil and pos <= #text then table.insert(segments, {code = false, text = string.sub(text, pos)}) end
	if #segments == 0 then table.insert(segments, {code = false, text = text}) end
	return segments
end
local function copyCode(text)
	local ok = pcall(function() ClipboardService:SetClipboard(text) end)
	setStatus(ok and "Code copied to clipboard." or "Clipboard unavailable in this Studio version.", ok and "good" or "warn")
end
local function stripLangTag(text)
	local first, rest = text:match("^([^\n]-)\n(.*)$")
	if first and #first <= 16 and first:match("^%a+$") then return rest end
	return text
end
local function renderChat()
	if not chatList then return end
	for _, child in ipairs(chatList:GetChildren()) do child:Destroy() end
	for index, entry in ipairs(chatHistory) do
		local isUser = entry.role == "user"
		local when = type(entry.at) == "number" and os.date("%H:%M", entry.at / 1000) or nil
		local row = ui("Frame", {Size = UDim2.new(1, 0, 0, 0), AutomaticSize = Enum.AutomaticSize.Y, BackgroundTransparency = 1, LayoutOrder = index}, chatList)
		ui("TextLabel", {Size = UDim2.new(1, 0, 0, 12), BackgroundTransparency = 1, Text = (isUser and "YOU" or "LUA-X") .. (when and (" · " .. when) or ""), Font = Enum.Font.GothamBold, TextSize = 8, TextColor3 = isUser and C.accent or C.muted, TextXAlignment = isUser and Enum.TextXAlignment.Right or Enum.TextXAlignment.Left}, row)
		for _, segment in ipairs(codeSegments(entry.text)) do
			local bubble
			if segment.code then
				local codeText = stripLangTag(segment.text)
				bubble = round(ui("Frame", {Position = isUser and UDim2.new(0.18, 0, 0, 0) or UDim2.new(0, 0, 0, 0), Size = isUser and UDim2.new(0.82, 0, 0, 0) or UDim2.new(1, 0, 0, 0), AutomaticSize = Enum.AutomaticSize.Y, BackgroundColor3 = Color3.fromRGB(10, 13, 20), BorderSizePixel = 0}, row), 7)
				stroke(bubble)
				local bar = ui("Frame", {Size = UDim2.new(1, 0, 0, 22), BackgroundColor3 = Color3.fromRGB(15, 19, 28), BorderSizePixel = 0}, bubble)
				ui("UICorner", {CornerRadius = UDim.new(0, 7)}, bar)
				ui("TextLabel", {Position = UDim2.new(0, 8, 0, 4), Size = UDim2.new(1, -60, 0, 14), BackgroundTransparency = 1, Text = "lua · code", Font = Enum.Font.GothamBold, TextSize = 8, TextColor3 = C.muted, TextXAlignment = Enum.TextXAlignment.Left}, bar)
				local copy = round(ui("TextButton", {Position = UDim2.new(1, -52, 0, 2), Size = UDim2.new(0, 46, 0, 18), BackgroundColor3 = C.field, BorderSizePixel = 0, Text = "Copy", Font = Enum.Font.GothamMedium, TextSize = 8, TextColor3 = C.text}, bar), 4)
				local codeScroll = round(ui("ScrollingFrame", {Position = UDim2.new(0, 8, 0, 26), Size = UDim2.new(1, -16, 0, 150), BackgroundColor3 = Color3.fromRGB(8, 10, 16), BorderSizePixel = 0, ScrollBarThickness = 4, CanvasSize = UDim2.new(), AutomaticCanvasSize = Enum.AutomaticSize.Y}, bubble), 4)
				ui("UIPadding", {PaddingTop = UDim.new(0, 6), PaddingBottom = UDim.new(0, 6), PaddingLeft = UDim.new(0, 8), PaddingRight = UDim.new(0, 8)}, codeScroll)
				ui("TextLabel", {Size = UDim2.new(1, 0, 0, 0), AutomaticSize = Enum.AutomaticSize.Y, BackgroundTransparency = 1, Font = Enum.Font.Code, TextSize = 10, TextColor3 = Color3.fromRGB(205, 217, 240), TextWrapped = true, TextXAlignment = Enum.TextXAlignment.Left, TextYAlignment = Enum.TextYAlignment.Top, Text = codeText}, codeScroll)
				copy.MouseButton1Click:Connect(function() copyCode(codeText) end)
				task.defer(function()
					pcall(function()
						if codeScroll then codeScroll.CanvasPosition = Vector2.new(0, 0) end
					end)
				end)
			else
				local cleaned = segment.text:gsub("^%s+", ""):gsub("%s+$", "")
				if cleaned ~= "" then
					bubble = round(ui("TextLabel", {Position = isUser and UDim2.new(0.18, 0, 0, 0) or UDim2.new(0, 0, 0, 0), Size = isUser and UDim2.new(0.82, 0, 0, 0) or UDim2.new(1, 0, 0, 0), AutomaticSize = Enum.AutomaticSize.Y, BackgroundColor3 = isUser and Color3.fromRGB(24, 32, 48) or C.panel, BorderSizePixel = 0, Font = Enum.Font.Gotham, TextSize = 12, TextColor3 = C.text, TextWrapped = true, TextXAlignment = Enum.TextXAlignment.Left, TextYAlignment = Enum.TextYAlignment.Top, Text = cleaned}, row), 7)
					stroke(bubble)
				end
			end
		end
	end
	pcall(function() if chatScroller then chatScroller.CanvasPosition = Vector2.new(0, chatScroller.AbsoluteCanvasSize.Y) end end)
end
local function syncFromServer()
	if disconnected then return end
	local ok, response = safe("GET", rootUrl() .. "/api/studio/chat?sessionId=" .. HttpService:UrlEncode(sessionId), nil, 1)
	if not ok or not response then return end
	local dOk, data = pcall(function() return HttpService:JSONDecode(response.Body) end)
	if not dOk or type(data) ~= "table" or type(data.messages) ~= "table" then return end
	if #data.messages < #chatHistory then return end
	local merged = {}
	for _, message in ipairs(data.messages) do
		if type(message) == "table" and (message.role == "user" or message.role == "assistant") and type(message.content) == "string" then
			table.insert(merged, {role = message.role, text = message.content, at = type(message.at) == "number" and message.at or nil, surface = type(message.surface) == "string" and message.surface or "server"})
			if #merged >= MAX_HISTORY then break end
		end
	end
	chatHistory = merged
	renderChat()
end
local function pollConversation()
	if currentMode ~= "chat" then return end
	if widget and widget.Enabled and not disconnected then
		local ok = pcall(syncFromServer)
		if not ok then warn("[LUA-X] conversation sync failed") end
	end
end
local function sendChat()
	if busy then return end
	local text = tostring(chatInput.Text or ""):gsub("^%s+", ""):gsub("%s+$", "")
	if #text < 2 then return end
	table.insert(chatHistory, {role = "user", text = text})
	chatInput.Text = ""
	renderChat()
	refreshContext()
	busy = true
	if typingLabel then typingLabel.Visible = true end
	setStatus("LUA-X is answering…", "warn")
	local history = {}
	for i = math.max(1, #chatHistory - 10), #chatHistory - 1 do
		local entry = chatHistory[i]
		if type(entry) == "table" and (entry.role == "user" or entry.role == "assistant") then
			table.insert(history, {role = entry.role, content = entry.text})
		end
	end
	local payload = {prompt=text, projectId=tostring(game.PlaceId), mode="chat", context=currentContext, history=history}
	if not disconnected then payload.sessionId = sessionId; payload.surface = "plugin" end
	local ok, response = safe("POST", saveEndpoint(), payload, 3)
	busy = false
	if typingLabel then typingLabel.Visible = false end
	if not ok then
		if response and response.StatusCode == 401 then
			table.insert(chatHistory, {role = "assistant", text = "Authorization rejected — add your LUA-X API token in the Backend Connection card and Save Token."})
		else
			table.insert(chatHistory, {role = "assistant", text = "Backend " .. tostring(response and response.StatusCode or "error") .. ": " .. (response and bodyError(response) or "unreachable")})
		end
		task.defer(syncFromServer)
	else
		local dOk, data = pcall(function() return HttpService:JSONDecode(response.Body) end)
		if dOk and type(data) == "table" and type(data.response) == "string" and data.response ~= "" then
			table.insert(chatHistory, {role = "assistant", text = data.response})
			if type(data.plan) == "table" and type(data.plan.changes) == "table" and #data.plan.changes > 0 then
				currentPlan = data.plan
				setMode("build")
				planBox.Text = HttpService:JSONEncode(data.plan)
				setStatus("Plan ready · review before applying.", "good")
				table.insert(chatHistory, {role = "assistant", text = "Build plan ready — switch to Build · Plan to review and apply it."})
			end
			task.defer(syncFromServer)
		elseif dOk and type(data) == "table" and data.error then
			table.insert(chatHistory, {role = "assistant", text = "LUA-X: " .. tostring(data.error)})
		else
			table.insert(chatHistory, {role = "assistant", text = "Backend returned an unexpected response."})
		end
	end
	renderChat()
	setStatus("Chat answered.", "good")
end

local function buildWidget()
	if widget then return true end
	local info = DockWidgetPluginGuiInfo.new(Enum.InitialDockState.Float, false, true, 620, 900, 460, 700)
	local ok, result = pcall(function() return plugin:CreateDockWidgetPluginGuiAsync("LUAXStudio", info) end)
	if ok then widget=result else local legacyOk, legacy=pcall(function() return plugin:CreateDockWidgetPluginGui("LUAXStudio", info) end); if not legacyOk then warn("[LUA-X] widget error", result, legacy); return false end; widget=legacy end
	widget.Title = "LUA-X Studio"
	local scroll = ui("ScrollingFrame", {Size=UDim2.fromScale(1,1),CanvasSize=UDim2.new(),AutomaticCanvasSize=Enum.AutomaticSize.Y,ScrollBarThickness=5,BackgroundColor3=C.bg,BorderSizePixel=0}, widget)
	ui("UIPadding", {PaddingTop=UDim.new(0,14),PaddingBottom=UDim.new(0,14),PaddingLeft=UDim.new(0,14),PaddingRight=UDim.new(0,14)}, scroll)
	ui("UIListLayout", {Padding=UDim.new(0,10),SortOrder=Enum.SortOrder.LayoutOrder}, scroll)
	local hero=round(stroke(ui("Frame",{Size=UDim2.new(1,0,0,94),BackgroundColor3=C.panel,BorderSizePixel=0,LayoutOrder=1},scroll)))
	ui("TextLabel",{Position=UDim2.new(0,16,0,13),Size=UDim2.new(1,-200,0,28),BackgroundTransparency=1,Text="LUA-X",Font=Enum.Font.GothamBold,TextSize=22,TextColor3=C.text,TextXAlignment=Enum.TextXAlignment.Left},hero)
	ui("TextLabel",{Position=UDim2.new(0,16,0,47),Size=UDim2.new(1,-200,0,20),BackgroundTransparency=1,Text="AI-native Roblox engineering · chat + build · v" .. PLUGIN_VERSION,Font=Enum.Font.Gotham,TextSize=11,TextColor3=C.muted,TextXAlignment=Enum.TextXAlignment.Left},hero)
	local conn=round(ui("Frame",{Position=UDim2.new(1,-188,0,14),Size=UDim2.new(0,172,0,56),BackgroundColor3=C.field,BorderSizePixel=0},hero),12)
	connectionDot=round(ui("Frame",{Position=UDim2.new(0,12,0.5,-5),Size=UDim2.new(0,10,0,10),BackgroundColor3=C.bad,BorderSizePixel=0},conn),5)
	connectionLabel=ui("TextLabel",{Position=UDim2.new(0,30,0,4),Size=UDim2.new(1,-35,0,14),BackgroundTransparency=1,Text="Studio offline",Font=Enum.Font.GothamMedium,TextSize=10,TextColor3=C.text,TextXAlignment=Enum.TextXAlignment.Left},conn)
	sessionLabel=ui("TextLabel",{Position=UDim2.new(0,30,0,22),Size=UDim2.new(1,-35,0,14),BackgroundTransparency=1,Text="Session "..string.sub(sessionId,1,9).."…",Font=Enum.Font.Code,TextSize=9,TextColor3=C.muted,TextXAlignment=Enum.TextXAlignment.Left},conn)
	local card=round(stroke(ui("Frame",{Size=UDim2.new(1,0,0,196),BackgroundColor3=C.panel,BorderSizePixel=0,LayoutOrder=2},scroll)))
	ui("TextLabel",{Position=UDim2.new(0,13,0,9),Size=UDim2.new(1,-26,0,18),BackgroundTransparency=1,Text="STUDIO CONNECTION",Font=Enum.Font.GothamBold,TextSize=9,TextColor3=C.muted,TextXAlignment=Enum.TextXAlignment.Left},card)
	local rowY = 32
	local function connRow(y, title, box)
		ui("TextLabel",{Position=UDim2.new(0,13,0,y),Size=UDim2.new(0,120,0,18),BackgroundTransparency=1,Text=title,Font=Enum.Font.GothamMedium,TextSize=10,TextColor3=C.muted,TextXAlignment=Enum.TextXAlignment.Left},card)
		return ui("TextLabel",{Position=UDim2.new(0,138,0,y),Size=UDim2.new(1,-152,0,18),BackgroundTransparency=1,Text=box,Font=Enum.Font.GothamMedium,TextSize=10,TextColor3=C.text,TextXAlignment=Enum.TextXAlignment.Left},card)
	end
	connCardStatus=connRow(rowY,"Status","Offline"); rowY=rowY+19
	connCardProject=connRow(rowY,"Project",tostring(game.Name)); rowY=rowY+19
	connCardPlace=connRow(rowY,"Place ID",tostring(game.PlaceId)); rowY=rowY+19
	connCardSession=connRow(rowY,"Session",string.sub(sessionId,1,8).."…"); rowY=rowY+19
	connCardWebsite=connRow(rowY,"Website","—"); rowY=rowY+24
	connButton=round(ui("TextButton",{Position=UDim2.new(0,13,0,rowY),Size=UDim2.new(.5,-17,0,26),BackgroundColor3=C.field,BorderSizePixel=0,Text="Disconnect",Font=Enum.Font.GothamMedium,TextSize=10,TextColor3=C.text},card),7)
	connDiagLabel=ui("TextLabel",{Position=UDim2.new(0,13,0,rowY+32),Size=UDim2.new(1,-26,0,60),BackgroundTransparency=1,Text="Run diagnostics to check API health, permissions, and session registration.",Font=Enum.Font.Code,TextSize=9,TextColor3=C.muted,TextWrapped=true,TextXAlignment=Enum.TextXAlignment.Left,TextYAlignment=Enum.TextYAlignment.Top},card)
	local metrics=round(stroke(ui("Frame",{Size=UDim2.new(1,0,0,60),BackgroundColor3=C.panel,BorderSizePixel=0,LayoutOrder=3},scroll)))
	local p1=ui("Frame",{Position=UDim2.new(0,0,0,0),Size=UDim2.new(.34,-1,1,0),BackgroundTransparency=1},metrics); local p2=ui("Frame",{Position=UDim2.new(.34,0,0,0),Size=UDim2.new(.33,-1,1,0),BackgroundTransparency=1},metrics); local p3=ui("Frame",{Position=UDim2.new(.67,0,0,0),Size=UDim2.new(.33,0,1,0),BackgroundTransparency=1},metrics)
	for _,f in ipairs({p1,p2,p3}) do ui("TextLabel",{Position=UDim2.new(0,13,0,8),Size=UDim2.new(1,-26,0,16),BackgroundTransparency=1,Font=Enum.Font.GothamMedium,TextSize=9,TextColor3=C.muted,TextXAlignment=Enum.TextXAlignment.Left},f); ui("TextLabel",{Position=UDim2.new(0,13,0,28),Size=UDim2.new(1,-26,0,20),BackgroundTransparency=1,Font=Enum.Font.GothamBold,TextSize=12,TextColor3=C.text,TextXAlignment=Enum.TextXAlignment.Left},f) end
	p1:FindFirstChildOfClass("TextLabel").Text="PROJECT"; p1:GetChildren()[2].Text=tostring(game.PlaceId); p2:FindFirstChildOfClass("TextLabel").Text="SELECTION"; selectionLabel=p2:GetChildren()[2]; selectionLabel.Text="0 selected"; p3:FindFirstChildOfClass("TextLabel").Text="ACTIVITY"; activityLabel=p3:GetChildren()[2]; activityLabel.Text="Ready"
	local net=round(stroke(ui("Frame",{Size=UDim2.new(1,0,0,182),BackgroundColor3=C.panel,BorderSizePixel=0,LayoutOrder=4},scroll)))
	ui("TextLabel",{Position=UDim2.new(0,13,0,9),Size=UDim2.new(1,-26,0,18),BackgroundTransparency=1,Text="BACKEND CONNECTION",Font=Enum.Font.GothamBold,TextSize=9,TextColor3=C.muted,TextXAlignment=Enum.TextXAlignment.Left},net)
	endpointBox=round(ui("TextBox",{Position=UDim2.new(0,13,0,34),Size=UDim2.new(1,-26,0,32),BackgroundColor3=C.field,BorderSizePixel=0,ClearTextOnFocus=false,Font=Enum.Font.Code,TextSize=10,TextColor3=C.text,TextXAlignment=Enum.TextXAlignment.Left,Text=type(plugin:GetSetting(ENDPOINT_KEY))=="string" and plugin:GetSetting(ENDPOINT_KEY) or DEFAULT_ENDPOINT},net),7)
	tokenBox=round(ui("TextBox",{Position=UDim2.new(0,13,0,138),Size=UDim2.new(1,-96,0,28),BackgroundColor3=C.field,BorderSizePixel=0,ClearTextOnFocus=false,Font=Enum.Font.Code,TextSize=10,TextColor3=C.text,TextXAlignment=Enum.TextXAlignment.Left,PlaceholderText="LUA-X API token (optional)",Text=token()},net),7)
	local saveToken=round(ui("TextButton",{Position=UDim2.new(1,-78,0,138),Size=UDim2.new(0,65,0,28),BackgroundColor3=C.field,BorderSizePixel=0,Text="Save Token",Font=Enum.Font.GothamMedium,TextSize=10,TextColor3=C.text},net),7)
	websiteChip=round(ui("TextLabel",{Position=UDim2.new(0,13,0,73),Size=UDim2.new(.5,-17,0,24),BackgroundColor3=C.field,BorderSizePixel=0,Text="Website: —",Font=Enum.Font.GothamMedium,TextSize=9,TextColor3=C.muted},net),7)
	aiChip=round(ui("TextLabel",{Position=UDim2.new(.5,3,0,73),Size=UDim2.new(.5,-16,0,24),BackgroundColor3=C.field,BorderSizePixel=0,Text="AI: —",Font=Enum.Font.GothamMedium,TextSize=9,TextColor3=C.muted},net),7)
	local test=round(ui("TextButton",{Position=UDim2.new(0,13,0,105),Size=UDim2.new(.5,-17,0,25),BackgroundColor3=C.field,BorderSizePixel=0,Text="Run Diagnostics",Font=Enum.Font.GothamMedium,TextSize=10,TextColor3=C.text},net),7)
	local save=round(ui("TextButton",{Position=UDim2.new(.5,3,0,105),Size=UDim2.new(.5,-16,0,25),BackgroundColor3=C.field,BorderSizePixel=0,Text="Save Endpoint",Font=Enum.Font.GothamMedium,TextSize=10,TextColor3=C.text},net),7)
	local modebar=round(stroke(ui("Frame",{Size=UDim2.new(1,0,0,42),BackgroundColor3=C.panel,BorderSizePixel=0,LayoutOrder=5},scroll)))
	chatModeButton=round(ui("TextButton",{Position=UDim2.new(0,12,0,8),Size=UDim2.new(.5,-16,0,26),BackgroundColor3=C.accent,BorderSizePixel=0,Text="Chat",Font=Enum.Font.GothamBold,TextSize=10,TextColor3=C.text},modebar),6)
	buildModeButton=round(ui("TextButton",{Position=UDim2.new(.5,4,0,8),Size=UDim2.new(.5,-16,0,26),BackgroundColor3=C.field,BorderSizePixel=0,Text="Build · Plan",Font=Enum.Font.GothamBold,TextSize=10,TextColor3=C.muted},modebar),6)
	chatPanel=round(stroke(ui("Frame",{Size=UDim2.new(1,0,0,440),BackgroundColor3=C.panel,BorderSizePixel=0,LayoutOrder=6},scroll)))
	ui("TextLabel",{Position=UDim2.new(0,13,0,9),Size=UDim2.new(1,-26,0,18),BackgroundTransparency=1,Text="CHAT",Font=Enum.Font.GothamBold,TextSize=9,TextColor3=C.muted,TextXAlignment=Enum.TextXAlignment.Left},chatPanel)
	chatSyncLabel=ui("TextLabel",{Position=UDim2.new(0,13,0,9),Size=UDim2.new(1,-26,0,18),BackgroundTransparency=1,Text="· local only",Font=Enum.Font.GothamMedium,TextSize=8,TextColor3=C.muted,TextXAlignment=Enum.TextXAlignment.Right},chatPanel)
	chatScroller=round(ui("ScrollingFrame",{Position=UDim2.new(0,13,0,32),Size=UDim2.new(1,-26,0,278),BackgroundColor3=C.bg,BorderSizePixel=0,ScrollBarThickness=4,CanvasSize=UDim2.new(),AutomaticCanvasSize=Enum.AutomaticSize.Y},chatPanel),6)
	chatList=ui("UIListLayout",{Padding=UDim.new(0,8),SortOrder=Enum.SortOrder.LayoutOrder},chatScroller)
	ui("UIPadding",{PaddingTop=UDim.new(0,8),PaddingBottom=UDim.new(0,8),PaddingLeft=UDim.new(0,10),PaddingRight=UDim.new(0,10)},chatScroller)
	typingLabel=ui("TextLabel",{Position=UDim2.new(0,13,0,314),Size=UDim2.new(1,-26,0,16),BackgroundTransparency=1,Text="LUA-X is thinking…",Font=Enum.Font.Code,TextSize=9,TextColor3=C.muted,TextXAlignment=Enum.TextXAlignment.Left,Visible=false},chatPanel)
	chatInput=round(ui("TextBox",{Position=UDim2.new(0,13,0,336),Size=UDim2.new(1,-86,0,56),BackgroundColor3=C.field,BorderSizePixel=0,ClearTextOnFocus=false,Font=Enum.Font.Gotham,TextSize=12,TextColor3=C.text,PlaceholderText="Ask LUA-X anything… (Enter to send, Shift+Enter for new line)",TextWrapped=true,TextXAlignment=Enum.TextXAlignment.Left,TextYAlignment=Enum.TextYAlignment.Top,MultiLine=true},chatPanel),6)
	chatSend=round(ui("TextButton",{Position=UDim2.new(1,-70,0,336),Size=UDim2.new(0,58,0,56),BackgroundColor3=C.accent,BorderSizePixel=0,Text="Send",Font=Enum.Font.GothamBold,TextSize=11,TextColor3=C.text},chatPanel),6)
	buildPanel=round(stroke(ui("Frame",{Size=UDim2.new(1,0,0,432),BackgroundColor3=C.panel,BorderSizePixel=0,LayoutOrder=7},scroll)))
	ui("TextLabel",{Position=UDim2.new(0,13,0,9),Size=UDim2.new(1,-26,0,18),BackgroundTransparency=1,Text="LUA-X ARCHITECT — BUILD · PLAN",Font=Enum.Font.GothamBold,TextSize=9,TextColor3=C.muted,TextXAlignment=Enum.TextXAlignment.Left},buildPanel)
	ui("TextLabel",{Position=UDim2.new(0,13,0,28),Size=UDim2.new(1,-26,0,20),BackgroundTransparency=1,Text="Describe the system. LUA-X returns a reviewable change set — scripts, UI, animation, VFX, sound, geometry.",Font=Enum.Font.Gotham,TextSize=11,TextColor3=C.text,TextXAlignment=Enum.TextXAlignment.Left},buildPanel)
	promptBox=round(ui("TextBox",{Position=UDim2.new(0,13,0,52),Size=UDim2.new(1,-26,0,62),BackgroundColor3=C.field,BorderSizePixel=0,ClearTextOnFocus=false,Font=Enum.Font.Gotham,TextSize=12,TextColor3=C.text,PlaceholderText="Example: Add a secure sprint system with speed lines VFX to the selected controller…",TextWrapped=true,TextXAlignment=Enum.TextXAlignment.Left,TextYAlignment=Enum.TextYAlignment.Top,MultiLine=true},buildPanel),8)
	local gen=round(ui("TextButton",{Position=UDim2.new(0,13,0,122),Size=UDim2.new(1,-26,0,34),BackgroundColor3=C.accent,BorderSizePixel=0,Text="Generate Plan",Font=Enum.Font.GothamBold,TextSize=11,TextColor3=C.text},buildPanel),7)
	planBox=round(ui("TextBox",{Position=UDim2.new(0,13,0,164),Size=UDim2.new(1,-26,0,210),BackgroundColor3=C.field,BorderSizePixel=0,ClearTextOnFocus=false,Font=Enum.Font.Code,TextSize=10,TextColor3=C.text,TextWrapped=true,TextXAlignment=Enum.TextXAlignment.Left,TextYAlignment=Enum.TextYAlignment.Top,MultiLine=true,Text="No plan yet."},buildPanel),8)
	applyButton=round(ui("TextButton",{Position=UDim2.new(0,13,0,386),Size=UDim2.new(1,-26,0,36),BackgroundColor3=C.good,BorderSizePixel=0,Text="Apply Changes",Font=Enum.Font.GothamBold,TextSize=11,TextColor3=C.text},buildPanel),7)
	local ctx=round(stroke(ui("Frame",{Size=UDim2.new(1,0,0,205),BackgroundColor3=C.panel,BorderSizePixel=0,LayoutOrder=8},scroll)))
	ui("TextLabel",{Position=UDim2.new(0,13,0,9),Size=UDim2.new(1,-26,0,18),BackgroundTransparency=1,Text="PROJECT CONTEXT",Font=Enum.Font.GothamBold,TextSize=9,TextColor3=C.muted,TextXAlignment=Enum.TextXAlignment.Left},ctx)
	contextBox=round(ui("TextBox",{Position=UDim2.new(0,13,0,34),Size=UDim2.new(1,-26,0,130),BackgroundColor3=C.field,BorderSizePixel=0,ClearTextOnFocus=false,Font=Enum.Font.Code,TextSize=10,TextColor3=C.muted,TextWrapped=true,TextXAlignment=Enum.TextXAlignment.Left,TextYAlignment=Enum.TextYAlignment.Top,MultiLine=true,Text="No context yet."},ctx),8)
	local refresh=round(ui("TextButton",{Position=UDim2.new(0,13,1,-37),Size=UDim2.new(.5,-17,0,25),BackgroundColor3=C.field,BorderSizePixel=0,Text="Refresh Context",Font=Enum.Font.GothamMedium,TextSize=10,TextColor3=C.text},ctx),7)
	local verify=round(ui("TextButton",{Position=UDim2.new(.5,3,1,-37),Size=UDim2.new(.5,-16,0,25),BackgroundColor3=C.field,BorderSizePixel=0,Text="Verify State",Font=Enum.Font.GothamMedium,TextSize=10,TextColor3=C.text},ctx),7)
	statusLabel=ui("TextLabel",{Size=UDim2.new(1,0,0,42),BackgroundTransparency=1,Text="Connected bridge starting…",Font=Enum.Font.GothamMedium,TextSize=10,TextWrapped=true,TextColor3=C.muted,TextXAlignment=Enum.TextXAlignment.Left,LayoutOrder=9},scroll)
	statusDot=round(ui("Frame",{Size=UDim2.new(0,8,0,8),BackgroundColor3=C.muted,BorderSizePixel=0,Visible=false},scroll),4)

	setMode("chat")
	connButton.MouseButton1Click:Connect(function() if disconnected then reconnectNow() else disconnectNow() end end)
	test.MouseButton1Click:Connect(function() setStatus("Running diagnostics…", "warn"); task.defer(function() local ok = startupDiagnostics(); setStatus(ok and "Diagnostics complete · all checks passed." or "Diagnostics complete · see last error.", ok and "good" or "bad") end); refreshRemoteStatus() end)
	save.MouseButton1Click:Connect(function() saveEndpoint(); setStatus("Endpoint saved.","good") end)
	saveToken.MouseButton1Click:Connect(function() plugin:SetSetting(TOKEN_KEY, tostring(tokenBox.Text or "")); setStatus("Token saved · requests send it as Bearer authorization.","good") end)
	refresh.MouseButton1Click:Connect(function() refreshContext(); setStatus("Context synced.","good") end); verify.MouseButton1Click:Connect(verifyLocal); gen.MouseButton1Click:Connect(generatePlan); applyButton.MouseButton1Click:Connect(applyPlan)
	chatModeButton.MouseButton1Click:Connect(function() setMode("chat"); setStatus("Chat mode.","good") end)
	buildModeButton.MouseButton1Click:Connect(function() setMode("build"); setStatus("Build · Plan mode.","good") end)
	chatSend.MouseButton1Click:Connect(sendChat)
	UserInputService.InputBegan:Connect(function(input, gameProcessed)
		if gameProcessed then return end
		if input.KeyCode == Enum.KeyCode.Enter and chatInput and chatInput:IsFocused() then
			local shiftDown = UserInputService:IsKeyDown(Enum.KeyCode.LeftShift) or UserInputService:IsKeyDown(Enum.KeyCode.RightShift)
			if not shiftDown then sendChat() end
		end
	end)
	chatInput.FocusLost:Connect(function() if typingLabel then typingLabel.Visible = false end end)
	Selection.SelectionChanged:Connect(function() if widget and widget.Enabled then refreshContext() end end)
	refreshContext()
	refreshRemoteStatus()
	renderChat()
	task.spawn(function() local ok = pcall(startupDiagnostics); if not ok then warn("[LUA-X] startup diagnostics failed") end end)
	return true
end

local function showErrorWidget(message)
	warn("[LUA-X] widget error: " .. tostring(message))
	local errWidget = plugin:CreateDockWidgetPluginGui("LUAXError", DockWidgetPluginGuiInfo.new(Enum.InitialDockState.Float, false, true, 360, 180, 320, 160))
	errWidget.Title = "LUA-X Studio · startup error"
	local err = round(ui("Frame", {Size=UDim2.fromScale(1,1), BackgroundColor3=C.bg, BorderSizePixel=0}, errWidget))
	ui("UIPadding", {PaddingTop=UDim.new(0,14),PaddingBottom=UDim.new(0,14),PaddingLeft=UDim.new(0,14),PaddingRight=UDim.new(0,14)}, err)
	ui("TextLabel",{Size=UDim2.new(1,0,0,22),BackgroundTransparency=1,Text="LUA-X failed to start",Font=Enum.Font.GothamBold,TextSize=14,TextColor3=C.bad,TextXAlignment=Enum.TextXAlignment.Left},err)
	errorLabel=ui("TextLabel",{Position=UDim2.new(0,0,0,28),Size=UDim2.new(1,0,1,-28),BackgroundTransparency=1,Text=trim(tostring(message), 400),Font=Enum.Font.Code,TextSize=9,TextColor3=C.text,TextWrapped=true,TextXAlignment=Enum.TextXAlignment.Left,TextYAlignment=Enum.TextYAlignment.Top},err)
	errWidget.Enabled = true
	return errWidget
end

toolbarButton.Click:Connect(function()
	local ok, err = pcall(function()
		if buildWidget() then
			widget.Enabled = not widget.Enabled
			if widget.Enabled then refreshContext(); setStatus("LUA-X Studio ready.","good"); task.defer(pollConversation) end
		end
	end)
	if not ok then
		pcall(showErrorWidget, err)
		warn("[LUA-X] startup failed: " .. tostring(err))
	end
end)

task.delay(2.5, function()
	local ok, err = pcall(function()
		if buildWidget() then
			widget.Enabled = true
			refreshContext(); setStatus("LUA-X Studio ready.", "good"); task.defer(pollConversation)
		end
	end)
	if not ok then
		pcall(showErrorWidget, err)
		warn("[LUA-X] auto-open failed: " .. tostring(err))
	end
end)

task.spawn(function() local okReg=pcall(registerSession); if not okReg then warn("[LUA-X] register failed") end; task.wait(1); while true do if not disconnected then local ok=pcall(heartbeat); if not ok then warn("[LUA-X] heartbeat failed") end end; task.wait(HEARTBEAT_SECONDS) end end)
task.spawn(function() while true do if not disconnected then local ok=pcall(pollConnectionRequests); if not ok then warn("[LUA-X] connect request poll failed") end end; task.wait(CONNECT_POLL_SECONDS) end end)
task.spawn(function() while true do if widget and widget.Enabled and not disconnected then local ok=pcall(pollCommands); if not ok then warn("[LUA-X] command poll failed") end end; task.wait(COMMAND_SECONDS) end end)
task.spawn(function() while true do local ok=pcall(pollConversation); if not ok then warn("[LUA-X] conversation poll failed") end; task.wait(CHAT_POLL_SECONDS) end end)
task.spawn(function() while true do task.wait(30); local ok=pcall(refreshRemoteStatus); if not ok then warn("[LUA-X] remote status refresh failed") end end end)
task.spawn(function() while true do task.wait(8); local ok=pcall(pushContext); if not ok then warn("[LUA-X] context push failed") end end end)
task.spawn(function() pcall(refreshContext) end)

print("[LUA-X] Connected Studio bridge v" .. PLUGIN_VERSION .. " active (session " .. sessionId .. ")")