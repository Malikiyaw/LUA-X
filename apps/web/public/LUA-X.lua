-- LUA-X Studio Plugin 1.2.1
-- Stable connected bridge: heartbeat, website commands, AI planning, safe script apply,
-- connection card, disconnect/reconnect, and startup diagnostics.

local HttpService = game:GetService("HttpService")
local Selection = game:GetService("Selection")
local ChangeHistoryService = game:GetService("ChangeHistoryService")
local ScriptEditorService = game:GetService("ScriptEditorService")

local PLUGIN_VERSION = "1.2.1"
local DEFAULT_ENDPOINT = "https://lua-x-api.vercel.app/api/ai/generate"
local ENDPOINT_KEY = "LUA_X_API_ENDPOINT"
local SESSION_KEY = "LUA_X_STUDIO_SESSION"
local HEARTBEAT_SECONDS = 4
local COMMAND_SECONDS = 2
local CONNECT_POLL_SECONDS = 2
local MAX_SCRIPTS = 16
local MAX_SOURCE = 5000
local MAX_CONTEXT = 16000

local C = {
	bg = Color3.fromRGB(9, 11, 17), panel = Color3.fromRGB(17, 20, 29), field = Color3.fromRGB(26, 30, 41),
	stroke = Color3.fromRGB(45, 51, 68), text = Color3.fromRGB(245, 247, 255), muted = Color3.fromRGB(153, 162, 181),
	accent = Color3.fromRGB(80, 101, 255), good = Color3.fromRGB(76, 210, 132), warn = Color3.fromRGB(240, 185, 79), bad = Color3.fromRGB(244, 101, 110),
}

local toolbar = plugin:CreateToolbar("LUA-X")
local toolbarButton = toolbar:CreateButton("LUA-X", "Open connected LUA-X Studio", "rbxassetid://14978048121")
toolbarButton.ClickableWhenViewportHidden = true

local widget, statusLabel, statusDot, connectionLabel, connectionDot, sessionLabel
local endpointBox, promptBox, contextBox, planBox, applyButton, selectionLabel, activityLabel
local websiteChip, aiChip, errorLabel
local connCardDot, connCardStatus, connCardProject, connCardPlace, connCardSession, connCardWebsite, connDiagLabel, connButton
local currentPlan, currentContext = nil, {}
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
end
local function request(method, url, payload)
	local options = {Url = url, Method = method, Headers = {Accept = "application/json"}}
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
local function refreshContext()
	local selected = Selection:Get()
	local instances, files, sourceParts = {}, {}, {}
	for _, item in ipairs(selected) do table.insert(instances, pathOf(item) .. " [" .. item.ClassName .. "]") end
	for _, script in ipairs(selectedScripts()) do
		table.insert(files, pathOf(script))
		local source = readSource(script)
		if source then table.insert(sourceParts, "-- " .. pathOf(script) .. "\n" .. trim(source, MAX_SOURCE)) end
	end
	currentContext = {
		relevantFiles = files, relevantInstances = instances, architecture = trim(table.concat(sourceParts, "\n\n"), MAX_CONTEXT),
		constraints = {"Use the current Roblox Studio selection as context.", "Never expose provider API keys.", "Prefer minimal reversible changes.", "Never claim runtime verification without evidence."},
	}
	if contextBox then contextBox.Text = table.concat({"SELECTIONS  " .. #selected, "SCRIPTS     " .. #files, "", "INSTANCES", #instances > 0 and table.concat(instances, "\n") or "(none)", #files > 0 and ("\nSCRIPTS\n" .. table.concat(files, "\n")) or ""}, "\n") end
	if selectionLabel then selectionLabel.Text = tostring(#selected) .. " selected" end
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
		capabilities = {"chat", "context", "build", "apply", "verify"},
		context = {selection=#Selection:Get(), scripts=#(type(context.relevantFiles)=="table" and context.relevantFiles or {})},
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
	table.insert(lines, hOk and "API health: online" or "API health: unreachable")
	local aOk, aResponse = safe("GET", rootUrl() .. "/api/ai/status", nil, 1)
	local aiReady = false
	if aOk and aResponse then
		local dOk, data = pcall(function() return HttpService:JSONDecode(aResponse.Body) end)
		aiReady = dOk and type(data) == "table" and data.configured == true
	end
	table.insert(lines, aiReady and "AI backend: ready" or "AI backend: not configured")
	local regOk = registerSession()
	table.insert(lines, regOk and "Session registration: ok" or "Session registration: failed")
	table.insert(lines, "HTTP Requests: " .. (hOk and "enabled" or "check Game Settings → Security"))
	if connDiagLabel then connDiagLabel.Text = table.concat(lines, "\n") end
	return regOk
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
local function applyProposal(proposal)
	local op, target, content = proposal.operation, proposal.target, proposal.content
	if op ~= "update_script" and op ~= "create_script" then return false, "deferred: " .. tostring(op) end
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

local function generatePlan()
	if busy then return end
	local prompt = tostring(promptBox.Text or ""):gsub("^%s+", ""):gsub("%s+$", "")
	if #prompt < 2 then setStatus("Describe the change first.", "bad"); return end
	busy = true; applyArmed = false; applyButton.Text = "Apply Changes"; refreshContext(); setStatus("LUA-X is generating a structured plan…", "warn")
	local ok, response = safe("POST", saveEndpoint(), {prompt=prompt, projectId=tostring(game.PlaceId), mode="build", context=currentContext}, 3)
	busy = false
	if not ok then setStatus("Backend " .. tostring(response and response.StatusCode or "error") .. ": " .. (response and bodyError(response) or "unreachable"), "bad"); warn("[LUA-X] " .. (response and bodyError(response) or "request failed")); return end
	local dOk, data = pcall(function() return HttpService:JSONDecode(response.Body) end)
	if not dOk or type(data) ~= "table" then setStatus("Backend returned invalid JSON.", "bad"); return end
	if data.error then setStatus("LUA-X: " .. tostring(data.error), "bad"); return end
	if type(data.plan) ~= "table" or type(data.plan.changes) ~= "table" then setStatus("No valid change plan returned.", "bad"); return end
	currentPlan = data.plan
	planBox.Text = HttpService:JSONEncode(data.plan)
	setStatus("Plan ready · review before applying.", "good")
end
local function applyPlan()
	if busy then return end
	if type(currentPlan) ~= "table" or type(currentPlan.changes) ~= "table" then setStatus("Generate a plan first.", "bad"); return end
	local changes = {}
	for _, proposal in ipairs(currentPlan.changes) do if type(proposal)=="table" and (proposal.operation=="update_script" or proposal.operation=="create_script") then table.insert(changes, proposal) end end
	if #changes == 0 then setStatus("No automatically applicable script changes.", "warn"); return end
	if not applyArmed then applyArmed=true; applyButton.Text="Confirm Apply  ·  " .. #changes; setStatus("Review the change set, then confirm.", "warn"); return end
	busy=true; applyArmed=false; applyButton.Text="Applying…"; ChangeHistoryService:SetWaypoint("LUA-X · Before Apply")
	local success, failed, results = 0, 0, {}
	for _, proposal in ipairs(changes) do local ok, result=applyProposal(proposal); if ok then success+=1; table.insert(results,"✓ "..result) else failed+=1; table.insert(results,"✗ "..result) end end
	ChangeHistoryService:SetWaypoint("LUA-X · After Apply"); busy=false; applyButton.Text="Apply Changes"; planBox.Text=table.concat(results,"\n")
	setStatus(string.format("Applied %d · failed %d · Studio Undo available.", success, failed), failed==0 and "good" or "bad")
end
local function verifyLocal()
	local count = #Selection:Get(); local scripts = #selectedScripts(); local ops = type(currentPlan)=="table" and type(currentPlan.changes)=="table" and #currentPlan.changes or 0
	planBox.Text = table.concat({"LUA-X VERIFICATION","","Plugin:    LUA-X " .. PLUGIN_VERSION,"Endpoint: " .. endpoint(),"Session:  " .. sessionId,"Place:    " .. tostring(game.PlaceId),"Selected: " .. count,"Scripts:  " .. scripts,"Plan ops: " .. ops,"","Plugin health verified. Runtime playtest not claimed."},"\n")
	setStatus("Studio-side verification complete.", "good")
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
	ui("TextLabel",{Position=UDim2.new(0,16,0,47),Size=UDim2.new(1,-200,0,20),BackgroundTransparency=1,Text="AI-native Roblox engineering · connected bridge · v" .. PLUGIN_VERSION,Font=Enum.Font.Gotham,TextSize=11,TextColor3=C.muted,TextXAlignment=Enum.TextXAlignment.Left},hero)
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
	local net=round(stroke(ui("Frame",{Size=UDim2.new(1,0,0,150),BackgroundColor3=C.panel,BorderSizePixel=0,LayoutOrder=4},scroll)))
	ui("TextLabel",{Position=UDim2.new(0,13,0,9),Size=UDim2.new(1,-26,0,18),BackgroundTransparency=1,Text="BACKEND CONNECTION",Font=Enum.Font.GothamBold,TextSize=9,TextColor3=C.muted,TextXAlignment=Enum.TextXAlignment.Left},net)
	endpointBox=round(ui("TextBox",{Position=UDim2.new(0,13,0,34),Size=UDim2.new(1,-26,0,32),BackgroundColor3=C.field,BorderSizePixel=0,ClearTextOnFocus=false,Font=Enum.Font.Code,TextSize=10,TextColor3=C.text,TextXAlignment=Enum.TextXAlignment.Left,Text=type(plugin:GetSetting(ENDPOINT_KEY))=="string" and plugin:GetSetting(ENDPOINT_KEY) or DEFAULT_ENDPOINT},net),7)
	websiteChip=round(ui("TextLabel",{Position=UDim2.new(0,13,0,73),Size=UDim2.new(.5,-17,0,24),BackgroundColor3=C.field,BorderSizePixel=0,Text="Website: —",Font=Enum.Font.GothamMedium,TextSize=9,TextColor3=C.muted},net),7)
	aiChip=round(ui("TextLabel",{Position=UDim2.new(.5,3,0,73),Size=UDim2.new(.5,-16,0,24),BackgroundColor3=C.field,BorderSizePixel=0,Text="AI: —",Font=Enum.Font.GothamMedium,TextSize=9,TextColor3=C.muted},net),7)
	local test=round(ui("TextButton",{Position=UDim2.new(0,13,0,105),Size=UDim2.new(.5,-17,0,25),BackgroundColor3=C.field,BorderSizePixel=0,Text="Run Diagnostics",Font=Enum.Font.GothamMedium,TextSize=10,TextColor3=C.text},net),7)
	local save=round(ui("TextButton",{Position=UDim2.new(.5,3,0,105),Size=UDim2.new(.5,-16,0,25),BackgroundColor3=C.field,BorderSizePixel=0,Text="Save Endpoint",Font=Enum.Font.GothamMedium,TextSize=10,TextColor3=C.text},net),7)
	local comp=round(stroke(ui("Frame",{Size=UDim2.new(1,0,0,220),BackgroundColor3=C.panel,BorderSizePixel=0,LayoutOrder=5},scroll)))
	ui("TextLabel",{Position=UDim2.new(0,13,0,9),Size=UDim2.new(1,-26,0,18),BackgroundTransparency=1,Text="LUA-X ARCHITECT",Font=Enum.Font.GothamBold,TextSize=9,TextColor3=C.muted,TextXAlignment=Enum.TextXAlignment.Left},comp)
	ui("TextLabel",{Position=UDim2.new(0,13,0,28),Size=UDim2.new(1,-26,0,20),BackgroundTransparency=1,Text="Describe the system. LUA-X will build a reviewable change set.",Font=Enum.Font.Gotham,TextSize=11,TextColor3=C.text,TextXAlignment=Enum.TextXAlignment.Left},comp)
	promptBox=round(ui("TextBox",{Position=UDim2.new(0,13,0,55),Size=UDim2.new(1,-26,0,106),BackgroundColor3=C.field,BorderSizePixel=0,ClearTextOnFocus=false,Font=Enum.Font.Gotham,TextSize=12,TextColor3=C.text,PlaceholderText="Example: Add a secure sprint system to the selected controller…",TextWrapped=true,TextXAlignment=Enum.TextXAlignment.Left,TextYAlignment=Enum.TextYAlignment.Top,MultiLine=true},comp),8)
	local gen=round(ui("TextButton",{Position=UDim2.new(0,13,1,-50),Size=UDim2.new(1,-26,0,38),BackgroundColor3=C.accent,BorderSizePixel=0,Text="Generate Plan",Font=Enum.Font.GothamBold,TextSize=11,TextColor3=C.text},comp),8)
	local ctx=round(stroke(ui("Frame",{Size=UDim2.new(1,0,0,205),BackgroundColor3=C.panel,BorderSizePixel=0,LayoutOrder=6},scroll)))
	ui("TextLabel",{Position=UDim2.new(0,13,0,9),Size=UDim2.new(1,-26,0,18),BackgroundTransparency=1,Text="PROJECT CONTEXT",Font=Enum.Font.GothamBold,TextSize=9,TextColor3=C.muted,TextXAlignment=Enum.TextXAlignment.Left},ctx)
	contextBox=round(ui("TextBox",{Position=UDim2.new(0,13,0,34),Size=UDim2.new(1,-26,0,130),BackgroundColor3=C.field,BorderSizePixel=0,ClearTextOnFocus=false,Font=Enum.Font.Code,TextSize=10,TextColor3=C.muted,TextWrapped=true,TextXAlignment=Enum.TextXAlignment.Left,TextYAlignment=Enum.TextYAlignment.Top,MultiLine=true,Text="No context yet."},ctx),8)
	local refresh=round(ui("TextButton",{Position=UDim2.new(0,13,1,-37),Size=UDim2.new(.5,-17,0,25),BackgroundColor3=C.field,BorderSizePixel=0,Text="Refresh Context",Font=Enum.Font.GothamMedium,TextSize=10,TextColor3=C.text},ctx),7)
	local verify=round(ui("TextButton",{Position=UDim2.new(.5,3,1,-37),Size=UDim2.new(.5,-16,0,25),BackgroundColor3=C.field,BorderSizePixel=0,Text="Verify State",Font=Enum.Font.GothamMedium,TextSize=10,TextColor3=C.text},ctx),7)
	local plan=round(stroke(ui("Frame",{Size=UDim2.new(1,0,0,395),BackgroundColor3=C.panel,BorderSizePixel=0,LayoutOrder=7},scroll)))
	ui("TextLabel",{Position=UDim2.new(0,13,0,9),Size=UDim2.new(1,-26,0,18),BackgroundTransparency=1,Text="PLAN / CHANGE SET",Font=Enum.Font.GothamBold,TextSize=9,TextColor3=C.muted,TextXAlignment=Enum.TextXAlignment.Left},plan)
	planBox=round(ui("TextBox",{Position=UDim2.new(0,13,0,34),Size=UDim2.new(1,-26,0,292),BackgroundColor3=C.field,BorderSizePixel=0,ClearTextOnFocus=false,Font=Enum.Font.Code,TextSize=10,TextColor3=C.text,TextWrapped=true,TextXAlignment=Enum.TextXAlignment.Left,TextYAlignment=Enum.TextYAlignment.Top,MultiLine=true,Text="No plan yet."},plan),8)
	applyButton=round(ui("TextButton",{Position=UDim2.new(0,13,1,-55),Size=UDim2.new(1,-26,0,40),BackgroundColor3=C.good,BorderSizePixel=0,Text="Apply Changes",Font=Enum.Font.GothamBold,TextSize=11,TextColor3=C.text},plan),8)
	statusLabel=ui("TextLabel",{Size=UDim2.new(1,0,0,42),BackgroundTransparency=1,Text="Connected bridge starting…",Font=Enum.Font.GothamMedium,TextSize=10,TextWrapped=true,TextColor3=C.muted,TextXAlignment=Enum.TextXAlignment.Left,LayoutOrder=8},scroll)
	statusDot=round(ui("Frame",{Size=UDim2.new(0,8,0,8),BackgroundColor3=C.muted,BorderSizePixel=0,Visible=false},scroll),4)

	connButton.MouseButton1Click:Connect(function() if disconnected then reconnectNow() else disconnectNow() end end)
	test.MouseButton1Click:Connect(function() setStatus("Running diagnostics…", "warn"); task.defer(function() local ok = startupDiagnostics(); setStatus(ok and "Diagnostics complete · all checks passed." or "Diagnostics complete · see last error.", ok and "good" or "bad") end); refreshRemoteStatus() end)
	save.MouseButton1Click:Connect(function() saveEndpoint(); setStatus("Endpoint saved.","good") end)
	refresh.MouseButton1Click:Connect(function() refreshContext(); setStatus("Context synced.","good") end); verify.MouseButton1Click:Connect(verifyLocal); gen.MouseButton1Click:Connect(generatePlan); applyButton.MouseButton1Click:Connect(applyPlan)
	Selection.SelectionChanged:Connect(function() if widget and widget.Enabled then refreshContext() end end)
	refreshContext()
	refreshRemoteStatus()
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
			if widget.Enabled then refreshContext(); setStatus("LUA-X Studio ready.","good") end
		end
	end)
	if not ok then
		pcall(showErrorWidget, err)
		warn("[LUA-X] startup failed: " .. tostring(err))
	end
end)

task.spawn(function() local okReg=pcall(registerSession); if not okReg then warn("[LUA-X] register failed") end; task.wait(1); while true do if not disconnected then local ok=pcall(heartbeat); if not ok then warn("[LUA-X] heartbeat failed") end end; task.wait(HEARTBEAT_SECONDS) end end)
task.spawn(function() while true do if not disconnected then local ok=pcall(pollConnectionRequests); if not ok then warn("[LUA-X] connect request poll failed") end end; task.wait(CONNECT_POLL_SECONDS) end end)
task.spawn(function() while true do if widget and widget.Enabled and not disconnected then local ok=pcall(pollCommands); if not ok then warn("[LUA-X] command poll failed") end end; task.wait(COMMAND_SECONDS) end end)
task.spawn(function() while true do task.wait(30); local ok=pcall(refreshRemoteStatus); if not ok then warn("[LUA-X] remote status refresh failed") end end end)
task.spawn(function() pcall(refreshContext) end)

print("[LUA-X] Connected Studio bridge v" .. PLUGIN_VERSION .. " active · session " .. sessionId)