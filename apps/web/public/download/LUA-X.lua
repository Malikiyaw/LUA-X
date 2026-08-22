-- LUA-X Studio Plugin 2.1.0
-- Unified twin-AI chat bridge (reference-style single-surface UI):
-- header bar with quick actions, toast stack, collapsible assistant sections,
-- rich-text highlights, plan cards with in-chat two-step Apply, AI follow-up
-- suggestions with keyboard navigation, context chips composer, model pill,
-- manual vision capture, live ARCHITECT/BUILDER status line, and full v2.0
-- systems (vision loop, heartbeat, shared conversations, safe appliers).
--
-- Reliability rules for this file:
--   * NEVER call game:GetService on a service that may not exist at top level without a guard.
--     A single throw here silently kills the whole plugin (it will not appear in Plugins).
--   * Never reference a local function before it is declared: Lua binds those names as
--     nil globals inside earlier closures (this broke the ribbon button before).

-- Safe service acquisition: a missing service must never kill plugin loading.
local function safeGetService(name)
	local ok, service = pcall(function() return game:GetService(name) end)
	if ok and service then return service end
	warn("[LUA-X] Service unavailable (continuing without it): " .. tostring(name))
	return nil
end

local HttpService = safeGetService("HttpService")
local Selection = safeGetService("Selection")
local ChangeHistoryService = safeGetService("ChangeHistoryService")
local ScriptEditorService = safeGetService("ScriptEditorService")
local UserInputService = safeGetService("UserInputService")
local CollectionService = safeGetService("CollectionService")
local StudioCaptureService = safeGetService("StudioCaptureService")

if not HttpService then
	warn("[LUA-X] FATAL: HttpService unavailable - plugin cannot start.")
	return
end

local PLUGIN_VERSION = "2.1.0"
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
	bg = Color3.fromRGB(16, 17, 22), panel = Color3.fromRGB(26, 28, 36), field = Color3.fromRGB(34, 37, 47),
	hover = Color3.fromRGB(42, 46, 58), stroke = Color3.fromRGB(52, 56, 70),
	text = Color3.fromRGB(240, 242, 248), muted = Color3.fromRGB(148, 155, 172), faint = Color3.fromRGB(104, 111, 128),
	accent = Color3.fromRGB(59, 130, 246), accentSoft = Color3.fromRGB(38, 84, 168),
	good = Color3.fromRGB(88, 190, 125), warn = Color3.fromRGB(214, 164, 86), bad = Color3.fromRGB(224, 106, 106),
	userBubble = Color3.fromRGB(31, 40, 62), planCard = Color3.fromRGB(24, 34, 30), chip = Color3.fromRGB(44, 48, 60),
}

-- Robust toolbar creation: Studio silently hides plugins that error at load. Wrap every step in pcall.
local toolbar, toolbarButton
do
	local ok, t = pcall(function() return plugin:CreateToolbar("LUA-X") end)
	if ok and t then toolbar = t else warn("[LUA-X] CreateToolbar failed: " .. tostring(t)); toolbar = nil end
	if toolbar then
		local ok2, btn = pcall(function() return toolbar:CreateButton("LUA-X", "Open connected LUA-X Studio", "rbxassetid://14978048121") end)
		if ok2 and btn then toolbarButton = btn else warn("[LUA-X] CreateButton with icon failed: " .. tostring(btn)) end
		if not toolbarButton then
			-- Fallback: text-only button without icon (icon asset may be blocked)
			local ok3, btn2 = pcall(function() return toolbar:CreateButton("LUA-X", "Open connected LUA-X Studio", "") end)
			if ok3 and btn2 then toolbarButton = btn2; warn("[LUA-X] Created fallback text button") end
		end
		if toolbarButton then pcall(function() toolbarButton.ClickableWhenViewportHidden = true end) end
	end
	if not toolbarButton then warn("[LUA-X] FATAL: toolbar button could not be created — check Output and Manage Plugins") end
	print("[LUA-X] Plugin v" .. PLUGIN_VERSION .. " loaded (toolbar: " .. (toolbarButton and "OK" or "FAILED") .. "). A LUA-X Studio window auto-opens; if you do not see it, open the Plugins tab and click LUA-X / Open LUA-X, or check this Output for [LUA-X] errors.")
end
-- Modern, reliable ribbon entry point. Guarantees a clickable LUA-X action in the
-- Plugins tab even on Studio versions where the legacy toolbar button is suppressed.
-- NOTE: the ActionTriggered/Activation connections are wired at the BOTTOM of this
-- file (after buildWidget and friends exist as locals). Wiring them here would bind
-- those names as nil globals and break the ribbon button.
local openAction
do
	local okA, a = pcall(function() return plugin:CreatePluginAction("LUAX.OpenStudio", "Open LUA-X", "Open the LUA-X Studio dock", "") end)
	if okA and a then openAction = a else warn("[LUA-X] CreatePluginAction unavailable - falling back to legacy toolbar / auto-open window") end
end


local widget, statusLabel, statusDot, connectionLabel, connectionDot, sessionLabel
local endpointBox, tokenBox, contextBox
local websiteChip, aiChip, errorLabel
local connCardDot, connCardStatus, connCardProject, connCardPlace, connCardSession, connCardWebsite, connDiagLabel, connButton
local chatScroller, chatList, chatInput, chatSend, chatSyncLabel
local currentPlan, currentContext = nil, {}
local chatHistory = {}
local busy, applyArmed, disconnected = false, false, false
-- v2.1 unified-chat state
local autoContext = true
local lastSuggestions = {}
local contextChips = {}
local sendChat -- forward-declared; assigned below (web build commands + suggestion clicks use it)
local showToast, chatArea, toastHost, renderChat -- forward-declared v2.1 UI helpers
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
				local count = 0; for _ in pairs(a) do count = count + 1 end
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
local contextDirty = false
local MAX_REMOTES = 24
local function collectRemotes()
	local remotes, seen = {}, 0
	for _, root in ipairs(TREE_ROOTS) do
		if seen >= MAX_REMOTES then break end
		local svc = game:FindService(root)
		if svc then
			for _, desc in ipairs(svc:GetDescendants()) do
				if seen >= MAX_REMOTES then break end
				if desc:IsA("RemoteEvent") or desc:IsA("RemoteFunction") or desc:IsA("UnreliableRemoteEvent") then
					remotes[#remotes + 1] = { path = pathOf(desc), class = desc.ClassName }
					seen = seen + 1
				end
			end
		end
	end
	return remotes
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
	local remotes = collectRemotes()
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
		remotes = remotes,
		screenCaptureAvailable = StudioCaptureService ~= nil,
		constraints = {"Use the current Roblox Studio selection as context.", "workspaceTree is the live Studio explorer — you can see the whole place.", "scripts lists every Lua source LUA-X could read; architecture holds their full source.", "Never expose provider API keys.", "Prefer minimal reversible changes.", "Never claim runtime verification without evidence.", "selectionDetails holds live properties for selected instances; instanceCounts is per-service descendent counts; assetReferences lists rbxasset fields.", "remotes lists existing RemoteEvents/Functions — reuse them before creating duplicates."},
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
local function pushContext()
	if disconnected or contextDirty == false then return end
	contextDirty = false
	local ok, response = safe("POST", rootUrl() .. "/api/studio/context", {sessionId = sessionId, context = type(currentContext) == "table" and currentContext or {}}, 1)
	if not ok then contextDirty = true end
end

-- ===== Real screenshot vision (StudioCaptureService) =====
local VISION_CAPTURE_SECONDS = 20
local VISION_MAX_WIDTH = 512
local visionPermissionAsked = false
local visionLastPostAt = 0

local function visionEncodeFrame(capture)
	local resolution = capture.Resolution
	local width = math.floor(resolution.X)
	local height = math.floor(resolution.Y)
	if width < 8 or height < 8 or width > 4096 or height > 4096 then return nil end
	local okBuffer, pixelBuffer = pcall(function() return capture:GetBuffer() end)
	if not okBuffer or typeof(pixelBuffer) ~= "buffer" then return nil end
	local okLen, bufferLen = pcall(function() return buffer.len(pixelBuffer) end)
	if not okLen or type(bufferLen) ~= "number" or bufferLen < width * height then return nil end
	local bytesPerPixel = math.floor(bufferLen / (width * height) + 0.5)
	if bytesPerPixel ~= 3 and bytesPerPixel ~= 4 then return nil end
	local formatName = ""
	pcall(function() formatName = tostring(capture.BufferFormat) end)
	local bgrLayout = string.find(formatName, "BGRA", 1, true) ~= nil or string.find(formatName, "BGR", 1, true) ~= nil
	local parts = {}
	local rowParts = {}
	for y = 0, height - 1 do
		rowParts = {}
		for x = 0, width - 1 do
			local offset = (y * width + x) * bytesPerPixel
			local r, g, b
			if bgrLayout then
				b = buffer.readu8(pixelBuffer, offset)
				g = buffer.readu8(pixelBuffer, offset + 1)
				r = buffer.readu8(pixelBuffer, offset + 2)
			else
				r = buffer.readu8(pixelBuffer, offset)
				g = buffer.readu8(pixelBuffer, offset + 1)
				b = buffer.readu8(pixelBuffer, offset + 2)
			end
			rowParts[x + 1] = string.char(r, g, b)
		end
		parts[y + 1] = table.concat(rowParts)
	end
	return { data = table.concat(parts), width = width, height = height }
end

local function captureVisionFrame()
	if not StudioCaptureService then return nil end
	if not visionPermissionAsked then
		visionPermissionAsked = true
		local okPerm, granted = pcall(function() return StudioCaptureService:RequestScreenshotPermissionAsync() end)
		if not okPerm or not granted then return nil end
	end
	local canCapture = false
	pcall(function() canCapture = StudioCaptureService:CanCaptureScreenshot() end)
	if not canCapture then return nil end
	local okCap, capture = pcall(function() return StudioCaptureService:CaptureScreenshot({}) end)
	if not okCap or not capture then return nil end
	pcall(function()
		local res = capture.Resolution
		if res and res.X > VISION_MAX_WIDTH then
			local scale = VISION_MAX_WIDTH / res.X
			capture = capture:ScaleAsync(Enum.ResamplerMode.Linear, Vector2.new(VISION_MAX_WIDTH, math.max(64, math.floor(res.Y * scale))))
		end
	end)
	return capture
end

local function postVisionFrame(encoded)
	local payload = {
		sessionId = sessionId,
		width = encoded.width,
		height = encoded.height,
		format = "RGB",
		image = HttpService:Base64Encode(encoded.data),
	}
	return safe("POST", rootUrl() .. "/api/studio/vision", payload, 1)
end

local function captureAndPostVision(force)
	if disconnected or not StudioCaptureService then return end
	if not force and (os.clock() - visionLastPostAt) < VISION_CAPTURE_SECONDS then return end
	visionLastPostAt = os.clock()
	local capture = captureVisionFrame()
	if not capture then return end
	local encoded = visionEncodeFrame(capture)
	if not encoded then return end
	task.spawn(function() pcall(postVisionFrame, encoded) end)
end

-- ===== Live twin-agent activity feed =====
local AGENT_POLL_SECONDS = 3
local lastAgentEventAt = 0
local function pollAgentEvents()
	if disconnected or not widget or not widget.Enabled then return end
	local url = rootUrl() .. "/api/studio/agent-events?sessionId=" .. HttpService:UrlEncode(sessionId)
	if lastAgentEventAt > 0 then url = url .. "&since=" .. tostring(lastAgentEventAt) end
	local ok, response = safe("GET", url, nil, 1)
	if not ok or not response then return end
	local dOk, data = pcall(function() return HttpService:JSONDecode(response.Body) end)
	if not dOk or type(data) ~= "table" or type(data.events) ~= "table" then return end
	for _, event in ipairs(data.events) do
		if type(event) == "table" and type(event.at) == "number" and event.at > lastAgentEventAt then
			lastAgentEventAt = event.at
			local role = type(event.role) == "string" and event.role or "AGENT"
			local message = type(event.message) == "string" and event.message or ""
			if message ~= "" then setStatus("[" .. string.upper(role) .. "] " .. trim(message, 96), "warn") end
		end
	end
end
local function saveEndpoint() local value = endpoint(); endpointBox.Text = value; plugin:SetSetting(ENDPOINT_KEY, value); return value end

local function heartbeatBody()
	local context = type(currentContext) == "table" and currentContext or {}
	local placeIdStr = tostring(game.PlaceId)
	local placeNameStr = tostring(game.Name)
	-- WEPPY-style multi-Studio: clientId per Studio window (sessionId + PlaceId) + targetAlias for routing
	local clientId = sessionId .. "_" .. placeIdStr
	local aliasBase = placeNameStr:lower():gsub("%s+", "-"):gsub("[^%w%-]", ""):sub(1, 16)
	if aliasBase == "" then aliasBase = "studio-" .. string.sub(placeIdStr, -4) else aliasBase = "studio-" .. aliasBase end
	return {
		projectId = placeIdStr,
		sessionId = sessionId,
		placeName = placeNameStr,
		placeId = placeIdStr,
		pluginVersion = PLUGIN_VERSION,
		clientId = clientId,
		targetAlias = aliasBase,
		capabilities = {"chat", "context", "build", "apply", "verify", "instances", "sync", "vision", "multi-studio", "assets", "playtest", "ui-studio", "twin-agent", "lighting", "terrain", "constraints", "attributes", "tags", "keyframes", "remotes-map", "ui-trees"},
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

local function verifyLocal()
	local count = #Selection:Get()
	local scripts = #selectedScripts()
	showToast("Verified · " .. count .. " selected · " .. scripts .. " scripts readable", "good")
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
		showToast("Build request from LUA-X web", "warn")
		setStatus("Build request received from LUA-X web — running twin agents…", "good")
		if sendChat then task.defer(function() pcall(sendChat, "/build " .. tostring(command.prompt)) end) end
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

local MAX_SPEC_DEPTH = 8

local function decodeSpec(content)
	if type(content) ~= "string" or content == "" then return nil end
	local okJson, specData = pcall(HttpService.JSONDecode, HttpService, content)
	if not okJson or type(specData) ~= "table" then return nil end
	return specData
end

-- Accepts "Vector3.new(x, y, z)" style strings or plain {x,y,z}/{[1],[2],[3]} tables.
local function vec3OfValue(value)
	if type(value) == "string" then return resolveValue(value) end
	if type(value) == "table" then
		local x = tonumber(value.x ~= nil and value.x or value[1])
		local y = tonumber(value.y ~= nil and value.y or value[2])
		local z = tonumber(value.z ~= nil and value.z or value[3])
		if x and y and z then return Vector3.new(x, y, z) end
	end
	return nil
end

-- SetAttribute only accepts Roblox attribute types; pre-check so we can report skips.
local function attributeSafe(value)
	local t = typeof(value)
	if t == "number" or t == "boolean" or t == "string" or t == "UDim" or t == "UDim2"
		or t == "BrickColor" or t == "Color3" or t == "Vector2" or t == "Vector3"
		or t == "CFrame" or t == "NumberSequence" or t == "ColorSequence"
		or t == "NumberRange" or t == "Rect" or t == "Font" then
		return true
	end
	return false
end

-- Recursive spec tree: {className, name?, properties?, children?: [spec...]}
-- Children make full UI trees natural (Frame > UICorner/UIStroke/UIListLayout/TextButton…).
local function buildInstanceTree(specData, defaultClass, depth)
	depth = depth or 0
	if depth > MAX_SPEC_DEPTH then return nil, "spec tree too deep" end
	local className = type(specData.className) == "string" and specData.className ~= "" and specData.className or defaultClass
	if not className then return nil, "className required" end
	local okCreate, object = pcall(Instance.new, className)
	if not okCreate or not object then return nil, "unknown class: " .. tostring(className) end
	local properties = type(specData.properties) == "table" and specData.properties or {}
	for key, rawValue in pairs(properties) do
		if key ~= "Parent" and key ~= "children" then
			local okSet, err = pcall(function() object[key] = resolveValue(rawValue) end)
			if not okSet then
				pcall(function() object:Destroy() end)
				return nil, "property " .. tostring(key) .. " failed: " .. tostring(err)
			end
		end
	end
	if type(specData.name) == "string" and specData.name ~= "" then object.Name = specData.name end
	for _, childSpec in ipairs(type(specData.children) == "table" and specData.children or {}) do
		if type(childSpec) == "table" then
			local childObj, childErr = buildInstanceTree(childSpec, nil, depth + 1)
			if childObj then
				childObj.Parent = object
			else
				pcall(function() object:Destroy() end)
				return nil, "child failed: " .. tostring(childErr)
			end
		end
	end
	return object
end

local function applyInstanceSpec(spec, parentPath, defaultClass)
	local specData = decodeSpec(spec)
	if not specData then return false, "invalid instance spec (expect JSON {className, name?, properties, children?})" end
	local parent = findPath(parentPath)
	if not parent then return false, "parent not found: " .. parentPath end
	local object, err = buildInstanceTree(specData, defaultClass, 0)
	if not object then return false, tostring(err) end
	local okParent, parentErr = pcall(function() object.Parent = parent end)
	if not okParent then
		pcall(function() object:Destroy() end)
		return false, "parent failed: " .. tostring(parentErr)
	end
	return true, "created " .. object.ClassName .. " " .. object.Name .. " under " .. parentPath
end

-- configure_lighting: {properties:{ClockTime=14,...}, children:[{className:"Atmosphere", name?, properties:{...}}]}
local function applyLightingSpec(targetPath, content)
	local spec = decodeSpec(content)
	if not spec then return false, "configure_lighting expects JSON {properties?, children?}" end
	local lighting = findPath(targetPath or "")
	if not lighting or not lighting:IsA("Lighting") then
		lighting = game:FindFirstChildOfClass("Lighting")
	end
	if not lighting then return false, "Lighting service not found" end
	local applied = 0
	for key, rawValue in pairs(type(spec.properties) == "table" and spec.properties or {}) do
		local okSet, err = pcall(function() lighting[key] = resolveValue(rawValue) end)
		if okSet then applied = applied + 1 else warn("[LUA-X] Lighting." .. tostring(key) .. ": " .. tostring(err)) end
	end
	local childNotes = {}
	for _, childSpec in ipairs(type(spec.children) == "table" and spec.children or {}) do
		local cname = type(childSpec.className) == "string" and childSpec.className or ""
		if cname ~= "" then
			local wantedName = type(childSpec.name) == "string" and childSpec.name or cname
			local existing = nil
			for _, kid in ipairs(lighting:GetChildren()) do
				if kid.ClassName == cname and kid.Name == wantedName then existing = kid break end
			end
			local childObject = existing
			if not childObject then
				local okNew, newObj = pcall(Instance.new, cname)
				if okNew and newObj then childObject = newObj; childObject.Name = wantedName end
			end
			if childObject then
				local propsApplied = 0
				for k2, v2 in pairs(type(childSpec.properties) == "table" and childSpec.properties or {}) do
					local ok2, err2 = pcall(function() childObject[k2] = resolveValue(v2) end)
					if ok2 then propsApplied = propsApplied + 1 else warn("[LUA-X] " .. cname .. "." .. tostring(k2) .. ": " .. tostring(err2)) end
				end
				if not existing then pcall(function() childObject.Parent = lighting end) end
				childNotes[#childNotes + 1] = cname .. "(" .. propsApplied .. ")"
			end
		end
	end
	local summary = "lighting updated (" .. applied .. " properties"
	if #childNotes > 0 then summary = summary .. "; +" .. table.concat(childNotes, ", ") end
	return true, summary .. ")"
end

-- create_terrain_region: {center:"Vector3.new(...)"|{x,y,z}, size:{x,y,z}|string, material?:name|enum, occupancy?:number}
local function applyTerrainRegion(content)
	local spec = decodeSpec(content)
	if not spec then return false, "create_terrain_region expects JSON {center, size, material?, occupancy?}" end
	local terrain = workspace:FindFirstChildOfClass("Terrain")
	if not terrain then return false, "workspace.Terrain not found" end
	local centerVal = vec3OfValue(spec.center)
	local sizeVal = vec3OfValue(spec.size)
	if typeof(centerVal) ~= "Vector3" then return false, "center must be a Vector3 (e.g. \"Vector3.new(0, 20, 0)\")" end
	if typeof(sizeVal) ~= "Vector3" then return false, "size must be a Vector3" end
	local materialRaw = spec.material
	local material = Enum.Material.Grass
	if type(materialRaw) == "string" then
		if string.match(materialRaw, "^Enum%.") then
			local resolvedEnum = resolveEnum(materialRaw)
			if resolvedEnum then material = resolvedEnum end
		else
			local okMat, mat = pcall(function() return Enum.Material[materialRaw] end)
			if okMat and mat then material = mat end
		end
	end
	local occupancy = tonumber(spec.occupancy) or 1
	if occupancy < 0 then occupancy = 0 elseif occupancy > 1 then occupancy = 1 end
	local okFill, fillErr = pcall(function()
		terrain:FillBlock(CFrame.new(centerVal), sizeVal, material, occupancy)
	end)
	if not okFill then return false, "terrain fill failed: " .. tostring(fillErr) end
	return true, "terrain filled (" .. tostring(material) .. ") at " .. tostring(centerVal) .. " size " .. tostring(sizeVal)
end

local CONSTRAINT_CLASSES = {
	WeldConstraint = true, HingeConstraint = true, PrismaticConstraint = true,
	CylindricalConstraint = true, BallSocketConstraint = true, SpringConstraint = true,
	RopeConstraint = true, RodConstraint = true,
}
-- create_constraint: {className?, part0:"game...", part1:"game...", properties?:{...}}
local function applyConstraintSpec(targetPath, content)
	local spec = decodeSpec(content)
	if not spec then return false, "create_constraint expects JSON {className?, part0, part1, properties?}" end
	local className = type(spec.className) == "string" and spec.className or "WeldConstraint"
	if not CONSTRAINT_CLASSES[className] then return false, "unsupported constraint class: " .. className end
	local part0 = findPath(type(spec.part0) == "string" and spec.part0 or "")
	local part1 = findPath(type(spec.part1) == "string" and spec.part1 or "")
	if not part0 or not part1 then return false, "part0/part1 paths not found" end
	local okNew, constraint = pcall(Instance.new, className)
	if not okNew or not constraint then return false, "cannot create constraint: " .. className end
	local needsAttachments = className ~= "WeldConstraint"
	if needsAttachments then
		local att0 = Instance.new("Attachment"); att0.Name = "LUA-X_Attachment0"; att0.Parent = part0
		local att1 = Instance.new("Attachment"); att1.Name = "LUA-X_Attachment1"; att1.Parent = part1
		constraint.Attachment0 = att0
		constraint.Attachment1 = att1
	end
	local propFailures = {}
	for key, rawValue in pairs(type(spec.properties) == "table" and spec.properties or {}) do
		if key ~= "Parent" and key ~= "Attachment0" and key ~= "Attachment1" and key ~= "Part0" and key ~= "Part1" then
			local okSet, err = pcall(function() constraint[key] = resolveValue(rawValue) end)
			if not okSet then propFailures[#propFailures + 1] = tostring(key) .. ": " .. tostring(err) end
		end
	end
	if className == "WeldConstraint" then
		constraint.Part0 = part0
		constraint.Part1 = part1
	end
	local okParent, parentErr = pcall(function() constraint.Parent = part0 end)
	if not okParent then
		pcall(function() constraint:Destroy() end)
		return false, "constraint parent failed: " .. tostring(parentErr)
	end
	local note = ""
	if #propFailures > 0 then note = " (skipped: " .. table.concat(propFailures, "; ") .. ")" end
	return true, "created " .. className .. " between " .. pathOf(part0) .. " and " .. pathOf(part1) .. note
end

local INSTANCE_OP_DEFAULTS = {
	create_animation = "Animation",
	create_sound = "Sound",
	create_vfx = "ParticleEmitter",
	create_ui = "Frame",
}

-- set_attributes: {attributes:{Damage=25, Team="Red", HomePoint="CFrame.new(...)"?}}
local function applyAttributesSpec(target, content)
	local spec = decodeSpec(content)
	if not spec then return false, "set_attributes expects JSON {attributes:{name:value}}" end
	local object = findPath(target)
	if not object then return false, "instance not found: " .. target end
	local applied, skipped = 0, 0
	for key, rawValue in pairs(type(spec.attributes) == "table" and spec.attributes or {}) do
		local resolved = resolveValue(rawValue)
		if resolved ~= nil and type(resolved) ~= "table" and attributeSafe(resolved) then
			local okSet = pcall(function() object:SetAttribute(key, resolved) end)
			if okSet then applied = applied + 1 else skipped = skipped + 1 end
		else
			skipped = skipped + 1
		end
	end
	return true, "attributes on " .. target .. ": " .. applied .. " set, " .. skipped .. " skipped"
end

-- add_tags / remove_tags: {tags:["Enemy","Interactable"]}
local function applyTagsSpec(target, content, add)
	local spec = decodeSpec(content)
	if not spec then return false, (add and "add_tags" or "remove_tags") .. " expects JSON {tags:[\"Tag\"]}" end
	if not CollectionService then return false, "CollectionService unavailable in this Studio version" end
	local object = findPath(target)
	if not object then return false, "instance not found: " .. target end
	local count = 0
	for _, tag in ipairs(type(spec.tags) == "table" and spec.tags or {}) do
		local tagText = tostring(tag)
		if tagText ~= "" then
			local okTag
			if add then
				okTag = pcall(function() CollectionService:AddTag(object, tagText) end)
			else
				okTag = pcall(function() CollectionService:RemoveTag(object, tagText) end)
			end
			if okTag then count = count + 1 end
		end
	end
	return true, (add and "added " or "removed ") .. count .. " tags on " .. target
end

-- create_keyframes: procedural KeyframeSequence — a real, playable animation that needs no uploaded asset id.
-- Spec: {name?, looped?, priority?, keyframes:[{time:number, joints:{["HumanoidRootPart"]={cframe:"CFrame.new(...)"|[12 numbers], weight?:number}}}]}
local function applyKeyframesSpec(target, content)
	local spec = decodeSpec(content)
	if not spec then return false, "create_keyframes expects JSON {keyframes:[{time, joints:{Joint={cframe}}}]}" end
	local keyframeList = type(spec.keyframes) == "table" and spec.keyframes or {}
	if #keyframeList == 0 then return false, "create_keyframes needs at least one keyframe" end
	local okNew, sequence = pcall(Instance.new, "KeyframeSequence")
	if not okNew or not sequence then return false, "KeyframeSequence unavailable" end
	sequence.Name = type(spec.name) == "string" and spec.name ~= "" and spec.name or ("LUA-X Animation " .. os.time())
	pcall(function() sequence.Loop = spec.looped == true end)
	if type(spec.priority) == "string" then
		local okPrio, prio = pcall(function() return Enum.AnimationPriority[spec.priority] end)
		if okPrio and prio then pcall(function() sequence.Priority = prio end) end
	end
	for _, kf in ipairs(keyframeList) do
		local keyframeTime = tonumber(kf.time) or 0
		local keyframe = Instance.new("Keyframe")
		keyframe.Time = keyframeTime
		for jointName, jointData in pairs(type(kf.joints) == "table" and kf.joints or {}) do
			local cfRaw = nil
			if type(jointData) == "table" then cfRaw = jointData.cframe or jointData.cf end
			local poseCF = nil
			if type(cfRaw) == "table" and #cfRaw >= 12 then
				poseCF = CFrame.new(tonumber(cfRaw[1]) or 0, tonumber(cfRaw[2]) or 0, tonumber(cfRaw[3]) or 0,
					tonumber(cfRaw[4]) or 1, tonumber(cfRaw[5]) or 0, tonumber(cfRaw[6]) or 0,
					tonumber(cfRaw[7]) or 0, tonumber(cfRaw[8]) or 1, tonumber(cfRaw[9]) or 0,
					tonumber(cfRaw[10]) or 0, tonumber(cfRaw[11]) or 0, tonumber(cfRaw[12]) or 1)
			elseif type(cfRaw) == "string" then
				poseCF = resolveValue(cfRaw)
			end
			if poseCF ~= nil and typeof(poseCF) == "CFrame" then
				local pose = Instance.new("Pose")
				pose.Name = tostring(jointName)
				pose.CFrame = poseCF
				pose.Weight = (type(jointData) == "table" and tonumber(jointData.weight)) or 1
				pose.Parent = keyframe
			end
		end
		keyframe.Parent = sequence
	end
	local parent = findPath(target or "")
	if not parent then
		local serverStorage = game:FindFirstChildOfClass("ServerStorage")
		if not serverStorage then serverStorage = game end
		parent = serverStorage:FindFirstChild("LUA-X_Animations")
		if not parent then
			parent = Instance.new("Folder")
			parent.Name = "LUA-X_Animations"
			parent.Parent = serverStorage
		end
	end
	sequence.Parent = parent
	return true, "created KeyframeSequence " .. sequence.Name .. " (" .. #keyframeList .. " keyframes) under " .. pathOf(parent)
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
	if op == "reparent_instance" then
		local spec = decodeSpec(content) or {}
		local toPath = type(spec.to) == "string" and spec.to or ""
		local object = findPath(target)
		local newParent = findPath(toPath)
		if not object or not newParent then return false, "reparent failed: target/destination not found" end
		if newParent == object or object:IsDescendantOf(newParent) then return false, "cannot reparent into own descendant: " .. toPath end
		object.Parent = newParent
		return true, "reparented " .. target .. " -> " .. toPath
	end
	if op == "rename_instance" then
		local spec = decodeSpec(content) or {}
		if type(spec.name) ~= "string" or spec.name == "" then return false, "rename_instance expects JSON {name}" end
		local object = findPath(target)
		if not object then return false, "instance not found: " .. target end
		object.Name = spec.name
		return true, "renamed " .. target .. " -> " .. spec.name
	end
	if op == "clone_instance" then
		local spec = decodeSpec(content) or {}
		local object = findPath(target)
		if not object then return false, "instance not found: " .. target end
		local okClone, copy = pcall(function() return object:Clone() end)
		if not okClone or not copy then return false, "clone failed (Archivable?) for: " .. target end
		copy.Name = type(spec.name) == "string" and spec.name ~= "" and spec.name or (object.Name .. "_Copy")
		local destination = findPath(type(spec.to) == "string" and spec.to or "") or object.Parent
		if not destination then pcall(function() copy:Destroy() end); return false, "clone destination not found" end
		copy.Parent = destination
		return true, "cloned " .. target .. " -> " .. pathOf(copy)
	end
	if op == "configure_lighting" then
		return applyLightingSpec(target, content)
	end
	if op == "create_terrain_region" then
		return applyTerrainRegion(content)
	end
	if op == "create_constraint" then
		return applyConstraintSpec(target, content)
	end
	if op == "set_attributes" then
		return applyAttributesSpec(target, content)
	end
	if op == "add_tags" then
		return applyTagsSpec(target, content, true)
	end
	if op == "remove_tags" then
		return applyTagsSpec(target, content, false)
	end
	if op == "create_keyframes" then
		return applyKeyframesSpec(target, content)
	end
	if INSTANCE_OP_DEFAULTS[op] then
		local spec = type(content) == "string" and content or "{}"
		return applyInstanceSpec(spec, target, INSTANCE_OP_DEFAULTS[op])
	end
	return false, "unsupported operation: " .. tostring(op)
end

-- Two-step armed apply bound to an individual plan card inside the chat.
local function applyPlanCard(plan, button)
	if busy then return end
	if type(plan) ~= "table" or type(plan.changes) ~= "table" then setStatus("No plan on this card.", "bad"); return end
	local changes = {}
	for _, proposal in ipairs(plan.changes) do
		if type(proposal) == "table" and proposal.operation ~= "note" then table.insert(changes, proposal) end
	end
	if #changes == 0 then setStatus("No automatically applicable changes.", "warn"); return end
	if not button.Armed then
		button.Armed = true
		button.Text = "Confirm Apply  ·  " .. #changes
		setStatus("Review the change set, then confirm.", "warn")
		return
	end
	busy = true; button.Armed = false; button.Text = "Applying…"
	pcall(function() ChangeHistoryService:SetWaypoint("LUA-X · Before Apply") end)
	local success, failed, results = 0, 0, {}
	for _, proposal in ipairs(changes) do
		local ok, result = applyProposal(proposal)
		if ok then success = success + 1; table.insert(results, "OK   " .. tostring(result))
		else failed = failed + 1; table.insert(results, "FAIL " .. tostring(result)) end
	end
	pcall(function() ChangeHistoryService:SetWaypoint("LUA-X · After Apply") end)
	busy = false; button.Text = "Apply Changes"
	for _, line in ipairs(results) do
		table.insert(chatHistory, {role = "assistant", text = line, system = true})
	end
	renderChat()
	showToast(string.format("Applied %d · failed %d", success, failed), failed == 0 and "good" or "bad")
	setStatus(string.format("Applied %d · failed %d · Studio Undo available.", success, failed), failed == 0 and "good" or "bad")
	if not disconnected then
		local summary = type(plan.summary) == "string" and plan.summary or "Plan"
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

-- ===== v2.1 unified-chat helpers =====
local function escRich(s)
	local out = tostring(s)
	out = out:gsub("&", "&amp;")
	out = (out:gsub("<", "&lt;"))
	out = (out:gsub(">", "&gt;"))
	return out
end

-- Tint game paths and `code spans` accent-blue for RichText labels.
local function richHighlight(text)
	local out = escRich(text)
	out = (out:gsub("`(.-)`", "<font color=\"#7fb0ff\">%1</font>"))
	out = (out:gsub("(game%.[%w%.]+)", "<font color=\"#7fb0ff\"><u>%1</u></font>"))
	return out
end

function showToast(text, kind)
	if not toastHost then return end
	local color = kind == "good" and C.good or kind == "bad" and C.bad or kind == "warn" and C.warn or C.accent
	local card = round(ui("Frame", {Size = UDim2.new(0, 250, 0, 0), AutomaticSize = Enum.AutomaticSize.Y, BackgroundColor3 = C.panel, BorderSizePixel = 0}, toastHost), 10)
	stroke(card)
	ui("TextLabel", {Position = UDim2.new(0, 12, 0, 9), Size = UDim2.new(1, -24, 0, 0), AutomaticSize = Enum.AutomaticSize.Y, BackgroundTransparency = 1, Text = tostring(text), Font = Enum.Font.GothamMedium, TextSize = 11, TextColor3 = color, TextWrapped = true, TextXAlignment = Enum.TextXAlignment.Left}, card)
	task.delay(4.5, function()
		pcall(function() card:Destroy() end)
	end)
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
-- Roblox has no plugin-accessible clipboard API, so we select the code in a
-- focusable TextBox; Ctrl+C then works natively and never fails.
local copyOverlay, copyBoxText
local function showCopyOverlay(text)
	if not widget then return end
	if not copyOverlay then
		copyOverlay = round(ui("Frame", {Size = UDim2.new(1, -26, 0, 210), BackgroundColor3 = C.bg, BorderSizePixel = 0, Visible = false}, chatArea or widget), 6)
		ui("TextLabel", {Position = UDim2.new(0, 8, 0, 4), Size = UDim2.new(1, -16, 0, 16), BackgroundTransparency = 1, Text = "CODE — press Ctrl+C to copy, then close", Font = Enum.Font.GothamBold, TextSize = 9, TextColor3 = C.accent, TextXAlignment = Enum.TextXAlignment.Left}, copyOverlay)
		copyBoxText = ui("TextBox", {Position = UDim2.new(0, 8, 0, 22), Size = UDim2.new(1, -16, 1, -30), BackgroundColor3 = Color3.fromRGB(8, 10, 16), BorderSizePixel = 0, TextColor3 = Color3.fromRGB(205, 217, 240), Font = Enum.Font.Code, TextSize = 10, ClearTextOnFocus = false, TextWrapped = true, MultiLine = true, TextXAlignment = Enum.TextXAlignment.Left, TextYAlignment = Enum.TextYAlignment.Top, Text = ""}, copyOverlay)
		round(copyBoxText, 5)
	end
	if not copyOverlay or not copyBoxText then return end
	copyOverlay.Visible = true
	copyBoxText.Text = text
	task.defer(function()
		pcall(function()
			copyBoxText:CaptureFocus()
			copyBoxText.SelectionStart = 1
			copyBoxText.CursorPosition = #text + 1
		end)
	end)
end
local function copyCode(text)
	local ok = pcall(showCopyOverlay, text)
	setStatus(ok and "Code selected — press Ctrl+C to copy." or "Select the code block and copy it manually.", ok and "good" or "warn")
end
local function stripLangTag(text)
	local first, rest = text:match("^([^\n]-)\n(.*)$")
	if first and #first <= 16 and first:match("^%a+$") then return rest end
	return text
end
-- ===== v2.1 unified chat renderer =====
local suggestionRows = {}
local suggestionIndex = 0
local chipsRow, chipsHint
local renderChips
local pulseDot, modelPill
local settingsDrawer

local OP_GLYPHS = {
	create_script = "+s", update_script = "~s", delete_script = "-",
	create_instance = "+i", update_instance = "~i",
	create_animation = "A", create_sound = "S", create_vfx = "V", create_ui = "U",
	configure_lighting = "L", create_terrain_region = "T", create_constraint = "C",
	set_attributes = "@", add_tags = "#+", remove_tags = "#-",
	reparent_instance = ">r", rename_instance = ">n", clone_instance = ">c",
	create_keyframes = "K", note = "i",
}
local RISK_COLORS = { low = C.good, medium = C.warn, high = Color3.fromRGB(232, 140, 120), critical = C.bad }

local function timeBadge(entry)
	if type(entry.at) == "number" then
		local ok, stamp = pcall(os.date, "%H:%M", entry.at / 1000)
		if ok and type(stamp) == "string" then return " · " .. stamp end
	end
	return ""
end

local function highlightSuggestions()
	for i, row in ipairs(suggestionRows) do
		pcall(function() row.BackgroundColor3 = (i == suggestionIndex) and C.hover or C.panel end)
	end
end

local function localSuggestions()
	local out = {}
	if type(currentPlan) == "table" and type(currentPlan.summary) == "string" then
		out[#out + 1] = "Explain this plan step by step"
		out[#out + 1] = "Make it exploit-safe"
	end
	local sel = Selection:Get()
	if #sel > 0 and sel[1] ~= nil then
		out[#out + 1] = "Improve the selected " .. sel[1].ClassName
	else
		out[#out + 1] = "What can you build in my game right now?"
	end
	while #out > 3 do table.remove(out, #out) end
	return out
end

function renderChat()
	if not chatList then return end
	suggestionRows = {}
	suggestionIndex = 0
	for _, child in ipairs(chatList:GetChildren()) do child:Destroy() end
	local lastAssistantAt = 0
	for index, entry in ipairs(chatHistory) do
		if entry.role == "assistant" and not entry.system then lastAssistantAt = index end
	end
	for index, entry in ipairs(chatHistory) do
		if entry.role == "user" then
			local row = ui("Frame", {Size = UDim2.new(1, 0, 0, 0), AutomaticSize = Enum.AutomaticSize.Y, BackgroundTransparency = 1, LayoutOrder = index}, chatList)
			local bubble = round(ui("Frame", {Position = UDim2.new(0.10, 0, 0, 0), Size = UDim2.new(0.90, 0, 0, 0), AutomaticSize = Enum.AutomaticSize.Y, BackgroundColor3 = C.userBubble, BorderSizePixel = 0}, row), 9)
			stroke(bubble)
			ui("UIPadding", {PaddingTop = UDim.new(0, 8), PaddingBottom = UDim.new(0, 8), PaddingLeft = UDim.new(0, 11), PaddingRight = UDim.new(0, 11)}, bubble)
			ui("TextLabel", {Size = UDim2.new(1, 0, 0, 12), BackgroundTransparency = 1, Text = "YOU" .. timeBadge(entry), Font = Enum.Font.GothamBold, TextSize = 8, TextColor3 = C.accent, TextXAlignment = Enum.TextXAlignment.Left}, bubble)
			ui("TextLabel", {Size = UDim2.new(1, 0, 0, 0), AutomaticSize = Enum.AutomaticSize.Y, BackgroundTransparency = 1, Text = tostring(entry.text), Font = Enum.Font.Gotham, TextSize = 12, TextColor3 = C.text, TextWrapped = true, TextXAlignment = Enum.TextXAlignment.Left, TextYAlignment = Enum.TextYAlignment.Top}, bubble)
		elseif entry.system then
			local lineText = tostring(entry.text)
			local isFail = string.sub(lineText, 1, 4) == "FAIL"
			ui("TextLabel", {Size = UDim2.new(1, 0, 0, 14), BackgroundTransparency = 1, Text = "· " .. trim(lineText, 170), Font = Enum.Font.Code, TextSize = 9, TextColor3 = isFail and C.bad or C.good, TextXAlignment = Enum.TextXAlignment.Left, LayoutOrder = index}, chatList)
		else
			local bodyText = tostring(entry.text)
			local row = ui("Frame", {Size = UDim2.new(1, 0, 0, 0), AutomaticSize = Enum.AutomaticSize.Y, BackgroundTransparency = 1, LayoutOrder = index}, chatList)
			local section = round(ui("Frame", {Size = UDim2.new(1, 0, 0, 0), AutomaticSize = Enum.AutomaticSize.Y, BackgroundColor3 = C.panel, BorderSizePixel = 0}, row), 9)
			stroke(section)
			local headerBtn = ui("TextButton", {Size = UDim2.new(1, 0, 0, 24), BackgroundTransparency = 1, Text = "", AutoButtonColor = false}, section)
			local chevron = ui("TextLabel", {Position = UDim2.new(1, -20, 0, 6), Size = UDim2.new(0, 14, 0, 12), BackgroundTransparency = 1, Text = "▾", Font = Enum.Font.GothamBold, TextSize = 10, TextColor3 = C.muted}, headerBtn)
			ui("TextLabel", {Position = UDim2.new(0, 11, 0, 6), Size = UDim2.new(1, -58, 0, 13), BackgroundTransparency = 1, Text = "LUA-X · " .. trim((bodyText:gsub("\n.*", "")), 46) .. timeBadge(entry), Font = Enum.Font.GothamBold, TextSize = 9, TextColor3 = C.muted, TextXAlignment = Enum.TextXAlignment.Left, TextTruncate = Enum.TextTruncate.AtEnd}, headerBtn)
			local bodyHolder = ui("Frame", {Position = UDim2.new(0, 0, 0, 24), Size = UDim2.new(1, 0, 0, 0), AutomaticSize = Enum.AutomaticSize.Y, BackgroundTransparency = 1}, section)
			ui("UIListLayout", {Padding = UDim.new(0, 6), SortOrder = Enum.SortOrder.LayoutOrder}, bodyHolder)
			ui("UIPadding", {PaddingLeft = UDim.new(0, 0), PaddingBottom = UDim.new(0, 9)}, bodyHolder)

			if entry.open == nil then entry.open = (#bodyText <= 520) end
			local function setBodyVisible(visible)
				bodyHolder.Visible = visible
				chevron.Text = visible and "▾" or "▸"
			end
			setBodyVisible(entry.open ~= false)
			headerBtn.MouseButton1Click:Connect(function()
				entry.open = not bodyHolder.Visible
				setBodyVisible(entry.open)
			end)

			for segIndex, segment in ipairs(codeSegments(bodyText)) do
				if segment.code then
					local codeText = stripLangTag(segment.text)
					local codeCard = round(ui("Frame", {Size = UDim2.new(1, -20, 0, 150), Position = UDim2.new(0, 10, 0, 0), BackgroundColor3 = Color3.fromRGB(12, 14, 19), BorderSizePixel = 0, LayoutOrder = segIndex}, bodyHolder), 7)
					stroke(codeCard)
					local bar = ui("Frame", {Size = UDim2.new(1, 0, 0, 22), BackgroundColor3 = C.hover, BorderSizePixel = 0}, codeCard)
					ui("UICorner", {CornerRadius = UDim.new(0, 7)}, bar)
					ui("TextLabel", {Position = UDim2.new(0, 8, 0, 4), Size = UDim2.new(1, -110, 0, 14), BackgroundTransparency = 1, Text = "lua · code", Font = Enum.Font.GothamBold, TextSize = 8, TextColor3 = C.muted, TextXAlignment = Enum.TextXAlignment.Left}, bar)
					local copyBtn = round(ui("TextButton", {Position = UDim2.new(1, -52, 0, 2), Size = UDim2.new(0, 44, 0, 18), BackgroundColor3 = C.field, BorderSizePixel = 0, Text = "Copy", Font = Enum.Font.GothamMedium, TextSize = 8, TextColor3 = C.text}, bar), 4)
					copyBtn.MouseButton1Click:Connect(function() copyCode(codeText) end)
					local codeScroll = round(ui("ScrollingFrame", {Position = UDim2.new(0, 8, 0, 26), Size = UDim2.new(1, -16, 1, -34), BackgroundColor3 = Color3.fromRGB(10, 12, 17), BorderSizePixel = 0, ScrollBarThickness = 4, CanvasSize = UDim2.new(), AutomaticCanvasSize = Enum.AutomaticSize.Y}, codeCard), 4)
					ui("UIPadding", {PaddingTop = UDim.new(0, 6), PaddingBottom = UDim.new(0, 6), PaddingLeft = UDim.new(0, 8), PaddingRight = UDim.new(0, 8)}, codeScroll)
					ui("TextLabel", {Size = UDim2.new(1, 0, 0, 0), AutomaticSize = Enum.AutomaticSize.Y, BackgroundTransparency = 1, Font = Enum.Font.Code, TextSize = 10, TextColor3 = Color3.fromRGB(205, 217, 240), TextWrapped = true, TextXAlignment = Enum.TextXAlignment.Left, TextYAlignment = Enum.TextYAlignment.Top, Text = codeText}, codeScroll)
				elseif segment.text:gsub("%s+", "") ~= "" then
					ui("TextLabel", {Position = UDim2.new(0, 11, 0, 0), Size = UDim2.new(1, -22, 0, 0), AutomaticSize = Enum.AutomaticSize.Y, BackgroundTransparency = 1, RichText = true, Text = richHighlight(segment.text:gsub("^%s+", ""):gsub("%s+$", "")), Font = Enum.Font.Gotham, TextSize = 12, TextColor3 = C.text, TextWrapped = true, TextXAlignment = Enum.TextXAlignment.Left, TextYAlignment = Enum.TextYAlignment.Top, LayoutOrder = segIndex}, bodyHolder)
				end
			end

			if type(entry.plan) == "table" and type(entry.plan.changes) == "table" and #entry.plan.changes > 0 then
				local plan = entry.plan
				currentPlan = plan
				local shown = math.min(#plan.changes, 6)
				local cardH = 42 + shown * 16 + (#plan.changes > shown and 13 or 0) + 44
				local card = round(ui("Frame", {Size = UDim2.new(1, -20, 0, cardH), Position = UDim2.new(0, 10, 0, 0), BackgroundColor3 = C.planCard, BorderSizePixel = 0, LayoutOrder = 900}, bodyHolder), 8)
				stroke(card)
				ui("TextLabel", {Position = UDim2.new(0, 11, 0, 8), Size = UDim2.new(1, -22, 0, 14), BackgroundTransparency = 1, Font = Enum.Font.GothamBold, TextSize = 10, TextColor3 = C.good, TextXAlignment = Enum.TextXAlignment.Left, Text = string.format("BUILD PLAN · %d change%s", #plan.changes, #plan.changes == 1 and "" or "s")}, card)
				ui("TextLabel", {Position = UDim2.new(0, 11, 0, 24), Size = UDim2.new(1, -22, 0, 14), BackgroundTransparency = 1, Font = Enum.Font.Gotham, TextSize = 10, TextColor3 = C.muted, TextXAlignment = Enum.TextXAlignment.Left, TextTruncate = Enum.TextTruncate.AtEnd, Text = tostring(plan.summary or "")}, card)
				for ci = 1, shown do
					local ch = plan.changes[ci]
					if type(ch) == "table" then
						local cy = 42 + (ci - 1) * 16
						ui("TextLabel", {Position = UDim2.new(0, 11, 0, cy), Size = UDim2.new(0, 24, 0, 14), BackgroundTransparency = 1, Font = Enum.Font.Code, TextSize = 9, TextColor3 = RISK_COLORS[ch.risk] or C.muted, TextXAlignment = Enum.TextXAlignment.Left, Text = OP_GLYPHS[ch.operation] or "?"}, card)
						ui("TextLabel", {Position = UDim2.new(0, 37, 0, cy), Size = UDim2.new(1, -48, 0, 14), BackgroundTransparency = 1, Font = Enum.Font.GothamMedium, TextSize = 9, TextColor3 = C.text, TextXAlignment = Enum.TextXAlignment.Left, TextTruncate = Enum.TextTruncate.AtEnd, Text = tostring(ch.target)}, card)
					end
				end
				if #plan.changes > shown then
					ui("TextLabel", {Position = UDim2.new(0, 37, 0, 42 + shown * 16), Size = UDim2.new(1, -48, 0, 12), BackgroundTransparency = 1, Font = Enum.Font.Gotham, TextSize = 9, TextColor3 = C.faint, TextXAlignment = Enum.TextXAlignment.Left, Text = "+" .. (#plan.changes - shown) .. " more…"}, card)
				end
				local applyBtn = round(ui("TextButton", {Position = UDim2.new(0, 11, 0, cardH - 36), Size = UDim2.new(1, -22, 0, 28), BackgroundColor3 = C.good, BorderSizePixel = 0, Text = "Apply Changes", Font = Enum.Font.GothamBold, TextSize = 10, TextColor3 = Color3.fromRGB(10, 24, 16)}, card), 7)
				applyBtn.MouseButton1Click:Connect(function() pcall(applyPlanCard, plan, applyBtn) end)
			end

			do
				local actions = round(ui("Frame", {Position = UDim2.new(1, -104, 0, 3), Size = UDim2.new(0, 96, 0, 18), BackgroundColor3 = C.hover, BorderSizePixel = 0, Visible = false}, section), 5)
				local quoteBtn = ui("TextButton", {Size = UDim2.new(0.5, 0, 1, 0), BackgroundTransparency = 1, Text = "Quote", Font = Enum.Font.GothamMedium, TextSize = 8, TextColor3 = C.accent}, actions)
				local copyAllBtn = ui("TextButton", {Position = UDim2.new(0.5, 0, 0, 0), Size = UDim2.new(0.5, 0, 1, 0), BackgroundTransparency = 1, Text = "Copy", Font = Enum.Font.GothamMedium, TextSize = 8, TextColor3 = C.text}, actions)
				section.MouseEnter:Connect(function() actions.Visible = true end)
				section.MouseLeave:Connect(function() actions.Visible = false end)
				quoteBtn.MouseButton1Click:Connect(function()
					table.insert(contextChips, {label = "Quote · " .. trim(bodyText, 18), value = trim(bodyText, 300)})
					showToast("Quoted reply added as focus context", "good")
					renderChips()
				end)
				copyAllBtn.MouseButton1Click:Connect(function() copyCode(bodyText) end)
			end
		end
		if index == lastAssistantAt and #lastSuggestions > 0 then
			local srow = ui("Frame", {Size = UDim2.new(1, 0, 0, 0), AutomaticSize = Enum.AutomaticSize.Y, BackgroundTransparency = 1, LayoutOrder = index + 0.5}, chatList)
			ui("UIListLayout", {Padding = UDim.new(0, 5), SortOrder = Enum.SortOrder.LayoutOrder}, srow)
			ui("TextLabel", {Size = UDim2.new(1, 0, 0, 13), BackgroundTransparency = 1, Text = "SUGGESTED NEXT  (Tab fills · Enter picks)", Font = Enum.Font.GothamBold, TextSize = 8, TextColor3 = C.faint, TextXAlignment = Enum.TextXAlignment.Left}, srow)
			for si, s in ipairs(lastSuggestions) do
				local btn = round(ui("TextButton", {Size = UDim2.new(1, 0, 0, 25), BackgroundColor3 = C.panel, BorderSizePixel = 0, Text = "▸   " .. tostring(s), TextXAlignment = Enum.TextXAlignment.Left, RichText = false, Font = Enum.Font.GothamMedium, TextSize = 11, TextColor3 = C.text, AutoButtonColor = false, LayoutOrder = si}, srow), 7)
				btn.MouseEnter:Connect(function() btn.BackgroundColor3 = C.hover end)
				btn.MouseLeave:Connect(function() btn.BackgroundColor3 = (si == suggestionIndex) and C.hover or C.panel end)
				btn.MouseButton1Click:Connect(function()
					if sendChat then pcall(sendChat, tostring(s)) end
				end)
				table.insert(suggestionRows, btn)
			end
		end
	end
	highlightSuggestions()
	pcall(function() if chatScroller then chatScroller.CanvasPosition = Vector2.new(0, chatScroller.AbsoluteCanvasSize.Y) end end)
end

local function syncFromServer()
	if disconnected then return end
	local ok, response = safe("GET", rootUrl() .. "/api/studio/chat?sessionId=" .. HttpService:UrlEncode(sessionId), nil, 1)
	if not ok or not response then return end
	local dOk, data = pcall(function() return HttpService:JSONDecode(response.Body) end)
	if not dOk or type(data) ~= "table" or type(data.messages) ~= "table" then return end
	local serverCount = 0
	for _, m in ipairs(data.messages) do
		if type(m) == "table" and (m.role == "user" or m.role == "assistant") then serverCount = serverCount + 1 end
	end
	if serverCount < #chatHistory then return end
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
	if widget and widget.Enabled and not disconnected then
		local ok = pcall(syncFromServer)
		if not ok then warn("[LUA-X] conversation sync failed") end
	end
end

function sendChat(textOverride)
	if busy or not chatInput then return end
	local raw = type(textOverride) == "string" and textOverride or tostring(chatInput.Text or "")
	local text = raw:gsub("^%s+", ""):gsub("%s+$", "")
	lastSuggestions = {}
	local mode = "chat"
	if string.sub(text, 1, 6) == "/build" then
		mode = "build"
		text = (string.sub(text, 7):gsub("^%s+", ""))
	end
	if #text < 2 then return end
	table.insert(chatHistory, {role = "user", text = text})
	if type(textOverride) ~= "string" then chatInput.Text = "" end
	renderChat()
	refreshContext()
	busy = true
	setStatus(mode == "build" and "Twin agents building — ARCHITECT planning…" or "LUA-X is answering…", "warn")
	local history = {}
	for i = math.max(1, #chatHistory - 10), #chatHistory - 1 do
		local entry = chatHistory[i]
		if type(entry) == "table" and (entry.role == "user" or entry.role == "assistant") and not entry.system then
			table.insert(history, {role = entry.role, content = entry.text})
		end
	end
	local payloadContext = currentContext
	if not autoContext then
		payloadContext = {
			selection = type(currentContext.selection) == "table" and currentContext.selection or {},
			selectionDetails = type(currentContext.selectionDetails) == "table" and currentContext.selectionDetails or {},
		}
	end
	if #contextChips > 0 then
		local quotes = {}
		for _, chip in ipairs(contextChips) do table.insert(quotes, chip.value) end
		local merged = {}
		for k, v in pairs(payloadContext) do merged[k] = v end
		merged.focusQuotes = quotes
		payloadContext = merged
	end
	local payload = {prompt = text, projectId = tostring(game.PlaceId), mode = mode, context = payloadContext, history = history}
	if not disconnected then payload.sessionId = sessionId; payload.surface = "plugin" end
	local ok, response = safe("POST", saveEndpoint(), payload, 3)
	busy = false
	if not ok then
		if response and response.StatusCode == 401 then
			table.insert(chatHistory, {role = "assistant", text = "Authorization rejected — open ⋯ Settings, paste your LUA-X API token and Save Token."})
		else
			table.insert(chatHistory, {role = "assistant", text = "Backend " .. tostring(response and response.StatusCode or "error") .. ": " .. (response and bodyError(response) or "unreachable")})
		end
	else
		local dOk, data = pcall(function() return HttpService:JSONDecode(response.Body) end)
		if dOk and type(data) == "table" and type(data.response) == "string" and data.response ~= "" then
			local entry = {role = "assistant", text = data.response}
			if type(data.plan) == "table" and type(data.plan.changes) == "table" and #data.plan.changes > 0 then
				entry.plan = data.plan
				currentPlan = data.plan
				showToast("Build plan ready · review & apply", "good")
				setStatus("Plan ready · review before applying.", "good")
			end
			table.insert(chatHistory, entry)
			if type(data.suggestions) == "table" then
				for _, s in ipairs(data.suggestions) do
					if type(s) == "string" and #s > 0 then table.insert(lastSuggestions, string.sub(s, 1, 120)) end
				end
			end
			task.defer(syncFromServer)
		elseif dOk and type(data) == "table" and data.error then
			table.insert(chatHistory, {role = "assistant", text = "LUA-X: " .. tostring(data.error)})
		else
			table.insert(chatHistory, {role = "assistant", text = "Backend returned an unexpected response."})
		end
	end
	if #lastSuggestions == 0 then lastSuggestions = localSuggestions() end
	renderChat()
	if mode ~= "build" then setStatus("Chat answered.", "good") end
end

local settingsDrawer

function renderChips()
	if not chipsRow then return end
	for _, child in ipairs(chipsRow:GetChildren()) do
		if child:IsA("Frame") then child:Destroy() end
	end
	if #contextChips == 0 then
		chipsHint.Visible = true
		return
	end
	chipsHint.Visible = false
	for ci, chip in ipairs(contextChips) do
		local chipFrame = round(ui("Frame", {Size = UDim2.new(0, math.min(240, 40 + #tostring(chip.label) * 5), 0, 20), BackgroundColor3 = C.chip, BorderSizePixel = 0, LayoutOrder = ci}, chipsRow), 10)
		stroke(chipFrame)
		ui("TextLabel", {Position = UDim2.new(0, 9, 0, 3), Size = UDim2.new(1, -26, 0, 14), BackgroundTransparency = 1, Text = tostring(chip.label), Font = Enum.Font.GothamMedium, TextSize = 9, TextColor3 = C.text, TextXAlignment = Enum.TextXAlignment.Left, TextTruncate = Enum.TextTruncate.AtEnd}, chipFrame)
		local removeBtn = ui("TextButton", {Position = UDim2.new(1, -18, 0, 3), Size = UDim2.new(0, 14, 0, 14), BackgroundTransparency = 1, Text = "×", Font = Enum.Font.GothamBold, TextSize = 11, TextColor3 = C.muted}, chipFrame)
		removeBtn.MouseButton1Click:Connect(function()
			table.remove(contextChips, ci)
			renderChips()
		end)
	end
end

local function buildWidget()
	if widget then return true end
	local info = DockWidgetPluginGuiInfo.new(Enum.InitialDockState.Float, false, true, 620, 900, 480, 620)
	local ok, result = pcall(function() return plugin:CreateDockWidgetPluginGuiAsync("LUAXStudio", info) end)
	if ok then
		widget = result
	else
		local legacyOk, legacy = pcall(function() return plugin:CreateDockWidgetPluginGui("LUAXStudio", info) end)
		if not legacyOk then warn("[LUA-X] widget error", result, legacy); return false end
		widget = legacy
	end
	widget.Title = "LUA-X Studio"

	local root = ui("Frame", {Size = UDim2.fromScale(1, 1), BackgroundColor3 = C.bg, BorderSizePixel = 0}, widget)

	-- ===== header bar =====
	local header = ui("Frame", {Size = UDim2.new(1, 0, 0, 46), BackgroundColor3 = C.panel, BorderSizePixel = 0}, root)
	ui("Frame", {Position = UDim2.new(0, 0, 1, -1), Size = UDim2.new(1, 0, 0, 1), BackgroundColor3 = C.stroke, BorderSizePixel = 0}, header)
	ui("TextLabel", {Position = UDim2.new(0, 14, 0, 6), Size = UDim2.new(0, 130, 0, 18), BackgroundTransparency = 1, Text = "LUA-X Chat", Font = Enum.Font.GothamBold, TextSize = 14, TextColor3 = C.text, TextXAlignment = Enum.TextXAlignment.Left}, header)
	sessionLabel = ui("TextLabel", {Position = UDim2.new(0, 14, 0, 26), Size = UDim2.new(0, 230, 0, 12), BackgroundTransparency = 1, Text = "Session " .. string.sub(sessionId, 1, 6) .. "… · v" .. PLUGIN_VERSION, Font = Enum.Font.Code, TextSize = 8, TextColor3 = C.faint, TextXAlignment = Enum.TextXAlignment.Left}, header)
	connectionDot = round(ui("Frame", {Position = UDim2.new(0, 152, 0, 9), Size = UDim2.new(0, 8, 0, 8), BackgroundColor3 = C.bad, BorderSizePixel = 0}, header), 4)
	connectionLabel = ui("TextLabel", {Position = UDim2.new(0, 166, 0, 5), Size = UDim2.new(0, 170, 0, 16), BackgroundTransparency = 1, Text = "Studio offline", Font = Enum.Font.GothamMedium, TextSize = 10, TextColor3 = C.muted, TextXAlignment = Enum.TextXAlignment.Left}, header)

	local function mkHeaderBtn(rightOffset, width, label, color)
		local b = round(ui("TextButton", {Position = UDim2.new(1, rightOffset, 0, 10), Size = UDim2.new(width, 0, 0, 26), BackgroundColor3 = C.field, BorderSizePixel = 0, Text = label, Font = Enum.Font.GothamBold, TextSize = 10, TextColor3 = color or C.text}, header), 7)
		return b
	end
	local closeBtn = mkHeaderBtn(-36, 28, "×")
	local newChatBtn = mkHeaderBtn(-66, 28, "+")
	local refreshBtn = mkHeaderBtn(-116, 42, "SYNC")
	local moreBtn = mkHeaderBtn(-160, 36, "SET")
	local autoPill = mkHeaderBtn(-238, 70, autoContext and "CTX FULL" or "CTX MIN", C.accent)

	-- ===== toast stack (top-right under header) =====
	toastHost = ui("Frame", {Position = UDim2.new(1, -272, 0, 52), Size = UDim2.new(0, 258, 0, 420), BackgroundTransparency = 1, ZIndex = 10}, root)
	ui("UIListLayout", {Padding = UDim.new(0, 8), SortOrder = Enum.SortOrder.LayoutOrder, HorizontalAlignment = Enum.HorizontalAlignment.Right}, toastHost)

	-- ===== chat area =====
	chatArea = ui("Frame", {Position = UDim2.new(0, 0, 0, 47), Size = UDim2.new(1, 0, 1, -47 - 134), BackgroundTransparency = 1}, root)
	chatScroller = ui("ScrollingFrame", {Size = UDim2.fromScale(1, 1), CanvasSize = UDim2.new(), AutomaticCanvasSize = Enum.AutomaticSize.Y, ScrollBarThickness = 4, BackgroundTransparency = 1, BorderSizePixel = 0}, chatArea)
	chatList = ui("UIListLayout", {Padding = UDim.new(0, 10), SortOrder = Enum.SortOrder.LayoutOrder}, chatScroller)
	ui("UIPadding", {PaddingTop = UDim.new(0, 10), PaddingBottom = UDim.new(0, 10), PaddingLeft = UDim.new(0, 12), PaddingRight = UDim.new(0, 12)}, chatScroller)

	-- ===== settings drawer (overlays chat area) =====
	settingsDrawer = ui("ScrollingFrame", {Position = UDim2.new(0, 8, 1, -206), Size = UDim2.new(1, -16, 0, 300), Visible = false, ZIndex = 6, ScrollBarThickness = 4, CanvasSize = UDim2.new(), AutomaticCanvasSize = Enum.AutomaticSize.Y, BackgroundColor3 = C.panel, BorderSizePixel = 0}, root)
	round(settingsDrawer, 10)
	stroke(settingsDrawer)
	do
		local drawerPad = ui("Frame", {Size = UDim2.new(1, -24, 0, 430), Position = UDim2.new(0, 12, 0, 10), BackgroundTransparency = 1}, settingsDrawer)
		ui("TextLabel", {Size = UDim2.new(1, -60, 0, 16), BackgroundTransparency = 1, Text = "SETTINGS · CONNECTION · CONTEXT", Font = Enum.Font.GothamBold, TextSize = 9, TextColor3 = C.muted, TextXAlignment = Enum.TextXAlignment.Left}, drawerPad)
		local drawerClose = round(ui("TextButton", {Position = UDim2.new(1, -50, 0, 0), Size = UDim2.new(0, 50, 0, 18), BackgroundColor3 = C.field, BorderSizePixel = 0, Text = "CLOSE", Font = Enum.Font.GothamBold, TextSize = 9, TextColor3 = C.text}, drawerPad), 5)
		drawerClose.MouseButton1Click:Connect(function() settingsDrawer.Visible = false end)

		connCardStatus = ui("TextLabel", {Position = UDim2.new(0, 0, 0, 26), Size = UDim2.new(0.5, -6, 0, 15), BackgroundTransparency = 1, Text = "Status: Offline", Font = Enum.Font.GothamMedium, TextSize = 10, TextColor3 = C.muted}, drawerPad)
		connCardProject = ui("TextLabel", {Position = UDim2.new(0.5, 6, 0, 26), Size = UDim2.new(0.5, -6, 0, 15), BackgroundTransparency = 1, Text = "Project: " .. tostring(game.Name), Font = Enum.Font.GothamMedium, TextSize = 10, TextColor3 = C.muted}, drawerPad)
		connCardPlace = ui("TextLabel", {Position = UDim2.new(0, 0, 0, 41), Size = UDim2.new(0.5, -6, 0, 15), BackgroundTransparency = 1, Text = "Place: " .. tostring(game.PlaceId), Font = Enum.Font.GothamMedium, TextSize = 10, TextColor3 = C.muted}, drawerPad)
		connCardSession = ui("TextLabel", {Position = UDim2.new(0.5, 6, 0, 41), Size = UDim2.new(0.5, -6, 0, 15), BackgroundTransparency = 1, Text = "Session: " .. string.sub(sessionId, 1, 8) .. "…", Font = Enum.Font.GothamMedium, TextSize = 10, TextColor3 = C.muted}, drawerPad)
		connCardWebsite = ui("TextLabel", {Position = UDim2.new(0, 0, 0, 56), Size = UDim2.new(0.5, -6, 0, 15), BackgroundTransparency = 1, Text = "Website: —", Font = Enum.Font.GothamMedium, TextSize = 10, TextColor3 = C.muted}, drawerPad)

		connButton = round(ui("TextButton", {Position = UDim2.new(0, 0, 0, 76), Size = UDim2.new(0.48, -6, 0, 24), BackgroundColor3 = C.field, BorderSizePixel = 0, Text = "Disconnect", Font = Enum.Font.GothamMedium, TextSize = 10, TextColor3 = C.text}, drawerPad), 6)
		connDiagLabel = ui("TextLabel", {Position = UDim2.new(0, 0, 0, 104), Size = UDim2.new(1, 0, 0, 44), BackgroundTransparency = 1, Text = "Run diagnostics to check API health, permissions, and session registration.", Font = Enum.Font.Code, TextSize = 8, TextColor3 = C.muted, TextWrapped = true, TextXAlignment = Enum.TextXAlignment.Left, TextYAlignment = Enum.TextYAlignment.Top}, drawerPad)

		websiteChip = round(ui("TextLabel", {Position = UDim2.new(0.5, 6, 0, 76), Size = UDim2.new(0.26, -8, 0, 24), BackgroundColor3 = C.field, BorderSizePixel = 0, Text = "Web —", Font = Enum.Font.GothamMedium, TextSize = 9, TextColor3 = C.muted}, drawerPad), 6)
		aiChip = round(ui("TextLabel", {Position = UDim2.new(0.76, 2, 0, 76), Size = UDim2.new(0.24, -2, 0, 24), BackgroundColor3 = C.field, BorderSizePixel = 0, Text = "AI —", Font = Enum.Font.GothamMedium, TextSize = 9, TextColor3 = C.muted}, drawerPad), 6)
		local test = round(ui("TextButton", {Position = UDim2.new(0, 0, 0, 152), Size = UDim2.new(0.48, -6, 0, 24), BackgroundColor3 = C.field, BorderSizePixel = 0, Text = "RUN DIAGNOSTICS", Font = Enum.Font.GothamBold, TextSize = 9, TextColor3 = C.text}, drawerPad), 6)

		ui("TextLabel", {Position = UDim2.new(0, 0, 0, 184), Size = UDim2.new(1, 0, 0, 14), BackgroundTransparency = 1, Text = "BACKEND ENDPOINT", Font = Enum.Font.GothamBold, TextSize = 8, TextColor3 = C.faint, TextXAlignment = Enum.TextXAlignment.Left}, drawerPad)
		endpointBox = round(ui("TextBox", {Position = UDim2.new(0, 0, 0, 198), Size = UDim2.new(1, 0, 0, 26), BackgroundColor3 = C.field, BorderSizePixel = 0, ClearTextOnFocus = false, Font = Enum.Font.Code, TextSize = 9, TextColor3 = C.text, TextXAlignment = Enum.TextXAlignment.Left, Text = type(plugin:GetSetting(ENDPOINT_KEY)) == "string" and plugin:GetSetting(ENDPOINT_KEY) or DEFAULT_ENDPOINT}, drawerPad), 6)
		local save = round(ui("TextButton", {Position = UDim2.new(0, 0, 0, 228), Size = UDim2.new(0.48, -6, 0, 22), BackgroundColor3 = C.field, BorderSizePixel = 0, Text = "SAVE ENDPOINT", Font = Enum.Font.GothamBold, TextSize = 9, TextColor3 = C.text}, drawerPad), 6)
		save.MouseButton1Click:Connect(function() saveEndpoint(); setStatus("Endpoint saved.", "good") end)

		tokenBox = round(ui("TextBox", {Position = UDim2.new(0, 0, 0, 254), Size = UDim2.new(1, -80, 0, 24), BackgroundColor3 = C.field, BorderSizePixel = 0, ClearTextOnFocus = false, Font = Enum.Font.Code, TextSize = 9, TextColor3 = C.text, TextXAlignment = Enum.TextXAlignment.Left, PlaceholderText = "LUA-X API token (optional)", Text = token()}, drawerPad), 6)
		local saveToken = round(ui("TextButton", {Position = UDim2.new(1, -74, 0, 254), Size = UDim2.new(0, 74, 0, 24), BackgroundColor3 = C.field, BorderSizePixel = 0, Text = "SAVE TOKEN", Font = Enum.Font.GothamBold, TextSize = 9, TextColor3 = C.text}, drawerPad), 6)
		saveToken.MouseButton1Click:Connect(function()
			plugin:SetSetting(TOKEN_KEY, tostring(tokenBox.Text or ""))
			setStatus("Token saved · requests send it as Bearer authorization.", "good")
		end)

		ui("TextLabel", {Position = UDim2.new(0, 0, 0, 286), Size = UDim2.new(1, 0, 0, 14), BackgroundTransparency = 1, Text = "PROJECT CONTEXT PREVIEW", Font = Enum.Font.GothamBold, TextSize = 8, TextColor3 = C.faint, TextXAlignment = Enum.TextXAlignment.Left}, drawerPad)
		contextBox = round(ui("TextBox", {Position = UDim2.new(0, 0, 0, 300), Size = UDim2.new(1, 0, 0, 110), BackgroundColor3 = C.field, BorderSizePixel = 0, ClearTextOnFocus = false, Font = Enum.Font.Code, TextSize = 8, TextColor3 = C.muted, TextWrapped = true, TextXAlignment = Enum.TextXAlignment.Left, TextYAlignment = Enum.TextYAlignment.Top, MultiLine = true, Text = "No context yet."}, drawerPad), 6)
		local verify = round(ui("TextButton", {Position = UDim2.new(0, 0, 0, 414), Size = UDim2.new(1, 0, 0, 22), BackgroundColor3 = C.field, BorderSizePixel = 0, Text = "VERIFY STATE", Font = Enum.Font.GothamBold, TextSize = 9, TextColor3 = C.text}, drawerPad), 6)
		verify.MouseButton1Click:Connect(verifyLocal)

		test.MouseButton1Click:Connect(function()
			setStatus("Running diagnostics…", "warn")
			task.defer(function()
				local regOk = startupDiagnostics()
				setStatus(regOk and "Diagnostics complete · all checks passed." or "Diagnostics complete · see last error.", regOk and "good" or "bad")
			end)
			refreshRemoteStatus()
		end)
	end

	-- ===== composer =====
	pulseDot = round(ui("Frame", {Position = UDim2.new(0, 12, 1, -128), Size = UDim2.new(0, 7, 0, 7), BackgroundColor3 = C.accent, BorderSizePixel = 0}, root), 4)
	statusLabel = ui("TextLabel", {Position = UDim2.new(0, 26, 1, -134), Size = UDim2.new(1, -38, 0, 20), BackgroundTransparency = 1, Text = "Connected bridge starting…", Font = Enum.Font.GothamMedium, TextSize = 10, TextColor3 = C.muted, TextXAlignment = Enum.TextXAlignment.Left, TextTruncate = Enum.TextTruncate.AtEnd}, root)
	chipsRow = ui("Frame", {Position = UDim2.new(0, 12, 1, -112), Size = UDim2.new(1, -24, 0, 22), BackgroundTransparency = 1}, root)
	ui("UIListLayout", {Padding = UDim.new(0, 6), FillDirection = Enum.FillDirection.Horizontal, SortOrder = Enum.SortOrder.LayoutOrder}, chipsRow)
	chipsHint = ui("TextLabel", {Size = UDim2.new(1, 0, 1, 0), BackgroundTransparency = 1, Text = "Tip: Quote a reply or press FOCUS SEL to steer the agents' context.", Font = Enum.Font.Gotham, TextSize = 9, TextColor3 = C.faint, TextXAlignment = Enum.TextXAlignment.Left}, chipsRow)

	local inputRow = ui("Frame", {Position = UDim2.new(0, 12, 1, -86), Size = UDim2.new(1, -24, 0, 44), BackgroundTransparency = 1}, root)
	chatInput = round(ui("TextBox", {Size = UDim2.new(1, -50, 1, 0), BackgroundColor3 = C.field, BorderSizePixel = 0, ClearTextOnFocus = false, Font = Enum.Font.Gotham, TextSize = 12, TextColor3 = C.text, PlaceholderText = "Ask AI anything…  (/build forces the strict twin-agent pipeline)", TextWrapped = true, TextXAlignment = Enum.TextXAlignment.Left, TextYAlignment = Enum.TextYAlignment.Top, MultiLine = true}, inputRow), 9)
	stroke(chatInput)
	ui("UIPadding", {PaddingTop = UDim.new(0, 6), PaddingBottom = UDim.new(0, 6), PaddingLeft = UDim.new(0, 10), PaddingRight = UDim.new(0, 10)}, chatInput)
	local sendBtn = round(ui("TextButton", {Position = UDim2.new(1, -44, 0.5, -19), Size = UDim2.new(0, 38, 0, 38), BackgroundColor3 = C.accent, BorderSizePixel = 0, Text = "↑", Font = Enum.Font.GothamBold, TextSize = 16, TextColor3 = Color3.fromRGB(255, 255, 255)}, inputRow), 19)
	sendBtn.MouseButton1Click:Connect(function() pcall(sendChat) end)

	local toolbarRow = ui("Frame", {Position = UDim2.new(0, 12, 1, -38), Size = UDim2.new(1, -24, 0, 26), BackgroundTransparency = 1}, root)
	local attachBtn = round(ui("TextButton", {Size = UDim2.new(0, 84, 1, 0), BackgroundColor3 = C.field, BorderSizePixel = 0, Text = "FOCUS SEL", Font = Enum.Font.GothamBold, TextSize = 9, TextColor3 = C.text}, toolbarRow), 6)
	attachBtn.MouseButton1Click:Connect(function()
		local sel = Selection:Get()
		if #sel == 0 or sel[1] == nil then showToast("Nothing selected", "warn"); return end
		table.insert(contextChips, {label = "Focus · " .. pathOf(sel[1]), value = "Focus on " .. pathOf(sel[1]) .. " (" .. sel[1].ClassName .. ")"})
		renderChips()
		showToast("Selection attached as focus", "good")
	end)
	local visionLabel = StudioCaptureService and "VISION NOW" or "NO VISION API"
	local visionBtn = round(ui("TextButton", {Position = UDim2.new(0, 90, 0, 0), Size = UDim2.new(0, 92, 1, 0), BackgroundColor3 = C.field, BorderSizePixel = 0, Text = visionLabel, Font = Enum.Font.GothamBold, TextSize = 9, TextColor3 = StudioCaptureService and C.text or C.faint}, toolbarRow), 6)
	visionBtn.MouseButton1Click:Connect(function()
		if not StudioCaptureService then showToast("StudioCaptureService unavailable", "warn"); return end
		captureAndPostVision(true)
		showToast("Capturing viewport for the agents…", "warn")
	end)
	modelPill = round(ui("TextLabel", {Position = UDim2.new(0, 190, 0, 0), Size = UDim2.new(0, 210, 1, 0), BackgroundColor3 = C.chip, BorderSizePixel = 0, Text = "AI · loading model…", Font = Enum.Font.GothamMedium, TextSize = 9, TextColor3 = C.muted}, toolbarRow), 6)
	chatSyncLabel = ui("TextLabel", {Position = UDim2.new(1, -110, 0, 0), Size = UDim2.new(0, 110, 1, 0), BackgroundTransparency = 1, Text = "· local only", Font = Enum.Font.GothamMedium, TextSize = 9, TextColor3 = C.muted, TextXAlignment = Enum.TextXAlignment.Right}, toolbarRow)

	-- ===== wiring =====
	closeBtn.MouseButton1Click:Connect(function() widget.Enabled = false end)
	newChatBtn.MouseButton1Click:Connect(function()
		chatHistory = {}
		lastSuggestions = {}
		currentPlan = nil
		renderChat()
		showToast("New chat view — server thread preserved", "good")
	end)
	refreshBtn.MouseButton1Click:Connect(function()
		refreshContext()
		pushContext()
		showToast("Context refreshed & pushed", "good")
	end)
	moreBtn.MouseButton1Click:Connect(function() settingsDrawer.Visible = not settingsDrawer.Visible end)
	autoPill.MouseButton1Click:Connect(function()
		autoContext = not autoContext
		autoPill.Text = autoContext and "CTX FULL" or "CTX MIN"
		autoPill.TextColor3 = autoContext and C.accent or C.muted
		showToast(autoContext and "Full workspace context enabled" or "Selection-only context enabled", "warn")
	end)

	UserInputService.InputBegan:Connect(function(input)
		local kc = input.KeyCode
		if chatInput and chatInput:IsFocused() then
			if kc == Enum.KeyCode.Return or kc == Enum.KeyCode.Enter then
				local shiftDown = UserInputService:IsKeyDown(Enum.KeyCode.LeftShift) or UserInputService:IsKeyDown(Enum.KeyCode.RightShift)
				if not shiftDown then task.defer(function() pcall(sendChat) end) end
			elseif #suggestionRows > 0 then
				if kc == Enum.KeyCode.Down then
					suggestionIndex = math.min(suggestionIndex + 1, #suggestionRows)
					highlightSuggestions()
				elseif kc == Enum.KeyCode.Up then
					suggestionIndex = math.max(suggestionIndex - 1, 1)
					highlightSuggestions()
				elseif kc == Enum.KeyCode.Tab and suggestionIndex >= 1 then
					chatInput.Text = tostring(lastSuggestions[suggestionIndex] or "")
				end
			end
		end
		if kc == Enum.KeyCode.Escape and #suggestionRows > 0 then
			lastSuggestions = {}
			renderChat()
		end
	end)
	Selection.SelectionChanged:Connect(function() if widget and widget.Enabled then refreshContext() end end)

	refreshContext()
	refreshRemoteStatus()
	renderChips()
	renderChat()

	task.spawn(function()
		local regOk = pcall(startupDiagnostics)
		if not regOk then warn("[LUA-X] startup diagnostics failed") end
	end)
	task.spawn(function()
		while true do
			pcall(function()
				local statusOk, statusResponse = safe("GET", rootUrl() .. "/api/ai/status", nil, 1)
				if statusOk and statusResponse then
					local dOk, d = pcall(function() return HttpService:JSONDecode(statusResponse.Body) end)
					if dOk and type(d) == "table" and type(d.model) == "string" then
						modelPill.Text = "AI · " .. tostring(d.model):gsub("^.-/", "") .. (d.agents == nil and "" or "")
						modelPill.TextColor3 = d.configured and C.good or C.warn
					end
				end
			end)
			task.wait(90)
		end
	end)
	task.spawn(function()
		while true do
			pcall(function()
				if pulseDot then pulseDot.BackgroundTransparency = 0.35 end
				task.wait(0.45)
				if pulseDot then pulseDot.BackgroundTransparency = 0.85 end
				task.wait(0.45)
			end)
		end
	end)
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

if toolbarButton then
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
else
	warn("[LUA-X] No toolbar button — open via Plugins → Manage Plugins → LUA-X (check Output for toolbar error)")
end

task.delay(1, function()
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
task.spawn(function() while true do pcall(pollAgentEvents); task.wait(AGENT_POLL_SECONDS) end end)
task.spawn(function() while true do pcall(captureAndPostVision, false); task.wait(VISION_CAPTURE_SECONDS) end end)
task.spawn(function() pcall(refreshContext) end)

-- Ribbon entry points are wired HERE (not at the top of the file) so that
-- buildWidget/setStatus/refreshContext/pollConversation exist as real locals.
-- Wiring earlier binds those names as nil globals and silently breaks the button.
if openAction then
	plugin.ActionTriggered:Connect(function(action)
		if action == openAction then
			local ok, err = pcall(function()
				if buildWidget() then
					widget.Enabled = true
					refreshContext(); setStatus("LUA-X Studio ready.", "good"); task.defer(pollConversation)
				end
			end)
			if not ok then warn("[LUA-X] open action failed: " .. tostring(err)) end
		end
	end)
end
pcall(function()
	plugin.Activation:Connect(function()
		if buildWidget() then widget.Enabled = true; refreshContext(); setStatus("LUA-X Studio ready.", "good") end
	end)
end)

print("[LUA-X] Twin-AI Studio bridge v" .. PLUGIN_VERSION .. " active (session " .. sessionId .. ") (toolbar: " .. (toolbarButton and "OK" or "FAILED") .. ", ribbon action: " .. (openAction and "OK" or "unavailable") .. ", vision: " .. (StudioCaptureService and "OK" or "unavailable") .. ")")
