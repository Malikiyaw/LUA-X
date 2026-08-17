-- LUA-X Studio Plugin 1.0
-- Connected Roblox Studio bridge: presence, command polling, AI planning, safe script apply.

local HttpService = game:GetService("HttpService")
local Selection = game:GetService("Selection")
local ChangeHistoryService = game:GetService("ChangeHistoryService")
local ScriptEditorService = game:GetService("ScriptEditorService")

local DEFAULT_ENDPOINT = "https://lua-x-api.vercel.app/api/ai/generate"
local DEFAULT_API_ROOT = "https://lua-x-api.vercel.app"
local ENDPOINT_KEY = "LUA_X_API_ENDPOINT"
local SESSION_KEY = "LUA_X_STUDIO_SESSION"
local MAX_SCRIPTS = 16
local MAX_SOURCE = 5000
local MAX_CONTEXT = 16000
local HEARTBEAT_SECONDS = 5
local COMMAND_SECONDS = 2

local COLORS = {
	bg = Color3.fromRGB(10, 12, 18),
	panel = Color3.fromRGB(18, 21, 30),
	panel2 = Color3.fromRGB(23, 27, 38),
	field = Color3.fromRGB(28, 32, 44),
	stroke = Color3.fromRGB(45, 51, 68),
	text = Color3.fromRGB(245, 247, 255),
	muted = Color3.fromRGB(155, 164, 182),
	accent = Color3.fromRGB(82, 103, 255),
	accent2 = Color3.fromRGB(118, 93, 255),
	good = Color3.fromRGB(82, 214, 135),
	warn = Color3.fromRGB(245, 190, 82),
	bad = Color3.fromRGB(245, 103, 112),
}

local toolbar = plugin:CreateToolbar("LUA-X")
local toolbarButton = toolbar:CreateButton("LUA-X", "Open the connected LUA-X Studio bridge", "rbxassetid://14978048121")
toolbarButton.ClickableWhenViewportHidden = true

local widget
local root
local statusLabel
local statusDot
local connectionLabel
local connectionDot
local endpointBox
local promptBox
local contextBox
local planBox
local generateButton
local applyButton
local projectLabel
local selectionLabel
local activityLabel

local busy = false
local applyArmed = false
local currentPlan = nil
local currentContext = {}
local heartbeatRunning = false
local commandRunning = false
local sessionId = plugin:GetSetting(SESSION_KEY)
if type(sessionId) ~= "string" or sessionId == "" then
	sessionId = HttpService:GenerateGUID(false)
	plugin:SetSetting(SESSION_KEY, sessionId)
end

local function trim(text, limit)
	local s = tostring(text or "")
	if #s <= limit then return s end
	return string.sub(s, 1, limit) .. "\n… [truncated]"
end

local function setStatus(text, kind)
	if statusLabel then statusLabel.Text = text end
	local color = COLORS.muted
	if kind == "good" then color = COLORS.good elseif kind == "bad" then color = COLORS.bad elseif kind == "warn" then color = COLORS.warn end
	if statusLabel then statusLabel.TextColor3 = color end
	if statusDot then statusDot.BackgroundColor3 = color end
end

local function setConnected(connected, detail)
	if connectionLabel then connectionLabel.Text = connected and ("Studio connected · " .. (detail or "online")) or "Studio offline" end
	if connectionDot then connectionDot.BackgroundColor3 = connected and COLORS.good or COLORS.bad end
end

local function ui(className, props, parent)
	local object = Instance.new(className)
	for key, value in pairs(props or {}) do object[key] = value end
	object.Parent = parent
	return object
end

local function round(object, radius)
	ui("UICorner", {CornerRadius = UDim.new(0, radius or 10)}, object)
	return object
end

local function outline(object, color)
	ui("UIStroke", {Color = color or COLORS.stroke, Thickness = 1, Transparency = 0.15}, object)
	return object
end

local function normalizeEndpoint(value)
	local text = tostring(value or ""):gsub("^%s+", ""):gsub("%s+$", "")
	if text == "" then return DEFAULT_ENDPOINT end
	while string.sub(text, -1) == "/" do text = string.sub(text, 1, -2) end
	if string.match(text, "/api/ai/generate$") then return text end
	if string.match(text, "/api$") then return text .. "/ai/generate" end
	return text .. "/api/ai/generate"
end

local function apiRoot()
	local endpoint = normalizeEndpoint(endpointBox and endpointBox.Text or DEFAULT_ENDPOINT)
	return string.gsub(endpoint, "/api/ai/generate$", "")
end

local function http(method, url, body)
	local request = {
		Url = url,
		Method = method,
		Headers = { ["Accept"] = "application/json" },
	}
	if body ~= nil then
		request.Headers["Content-Type"] = "application/json"
		request.Body = HttpService:JSONEncode(body)
	end
	return HttpService:RequestAsync(request)
end

local function parseErrorBody(response)
	local raw = tostring(response.Body or response.StatusMessage or "Request failed")
	local ok, data = pcall(function() return HttpService:JSONDecode(raw) end)
	if ok and type(data) == "table" then
		local err = data.error
		if type(err) == "table" then
			if type(err.message) == "string" then return err.message end
			if type(err.code) == "string" then return "Provider error " .. err.code end
		end
		if type(err) == "string" then return err end
		if type(data.detail) == "string" then return data.detail end
	end
	return trim(raw, 320)
end

local function safeRequest(method, url, body, attempts)
	local last
	for attempt = 1, (attempts or 2) do
		local ok, response = pcall(function() return http(method, url, body) end)
		if ok and response then
			if response.Success then return true, response end
			last = response
			if response.StatusCode < 500 and response.StatusCode ~= 429 then break end
		else
			last = response
		end
		task.wait(math.min(1.5, 0.35 * attempt))
	end
	return false, last
end

local function pathOf(instance)
	local parts = {}
	local current = instance
	while current and current ~= game do
		table.insert(parts, 1, current.Name)
		current = current.Parent
	end
	return #parts > 0 and ("game." .. table.concat(parts, ".")) or "game"
end

local function findPath(path)
	local normalized = tostring(path or ""):gsub("^game%.?", "")
	if normalized == "" then return game end
	local current = game
	for _, part in ipairs(string.split(normalized, ".")) do
		if part == "" then return nil end
		current = current:FindFirstChild(part)
		if not current then return nil end
	end
	return current
end

local function readSource(object)
	local ok, value = pcall(function() return object.Source end)
	return ok and type(value) == "string" and value or nil
end

local function selectedScripts()
	local result, seen = {}, {}
	for _, item in ipairs(Selection:Get()) do
		if item:IsA("LuaSourceContainer") and not seen[item] then table.insert(result, item); seen[item] = true end
		for _, descendant in ipairs(item:GetDescendants()) do
			if #result >= MAX_SCRIPTS then break end
			if descendant:IsA("LuaSourceContainer") and not seen[descendant] then table.insert(result, descendant); seen[descendant] = true end
		end
		if #result >= MAX_SCRIPTS then break end
	end
	return result
end

local function refreshContext()
	local selection = Selection:Get()
	local instances, files, snippets = {}, {}, {}
	for _, item in ipairs(selection) do table.insert(instances, pathOf(item) .. " [" .. item.ClassName .. "]") end
	for _, object in ipairs(selectedScripts()) do
		table.insert(files, pathOf(object))
		local source = readSource(object)
		if source then table.insert(snippets, "-- " .. pathOf(object) .. "\n" .. trim(source, MAX_SOURCE)) end
	end
	currentContext = {
		relevantFiles = files,
		relevantInstances = instances,
		architecture = trim(table.concat(snippets, "\n\n"), MAX_CONTEXT),
		constraints = {
			"Use the current Roblox Studio selection as context.",
			"Never put provider API keys in generated Studio code.",
			"Prefer minimal, reversible, reviewable changes.",
			"Do not claim runtime verification without evidence.",
		},
	}
	if contextBox then
		contextBox.Text = table.concat({
			"SELECTION   " .. tostring(#selection),
			"SCRIPTS     " .. tostring(#files),
			"",
			"INSTANCES",
			#instances > 0 and table.concat(instances, "\n") or "(none)",
			#files > 0 and ("\nSCRIPTS\n" .. table.concat(files, "\n")) or "",
		}, "\n")
	end
	if selectionLabel then selectionLabel.Text = tostring(#selection) .. " selected" end
end

local function saveEndpoint()
	local value = normalizeEndpoint(endpointBox.Text)
	endpointBox.Text = value
	plugin:SetSetting(ENDPOINT_KEY, value)
	return value
end

local function heartbeat()
	local ok, response = safeRequest("POST", apiRoot() .. "/api/studio/heartbeat", {
		projectId = tostring(game.PlaceId),
		sessionId = sessionId,
		placeName = tostring(game.Name),
		pluginVersion = "1.0.0",
	}, 2)
	if ok then
		local bodyOk, body = pcall(function() return HttpService:JSONDecode(response.Body) end)
		setConnected(true, bodyOk and type(body) == "table" and body.projectId and ("Place " .. tostring(body.projectId)) or "online")
		return
	end
	setConnected(false)
end

local function handleCommand(command)
	if type(command) ~= "table" then return end
	local kind = command.type
	if kind == "ping" then
		setStatus("Website handshake received.", "good")
	elseif kind == "build" and type(command.prompt) == "string" then
		promptBox.Text = command.prompt
		setStatus("Build request received from LUA-X web.", "good")
		task.defer(function()
			if generateButton then generateButton:Activate() end
		end)
	elseif kind == "refresh_context" then
		refreshContext()
		setStatus("Context refreshed from website.", "good")
	end
end

local function pollCommands()
	local ok, response = safeRequest("GET", apiRoot() .. "/api/studio/command?sessionId=" .. HttpService:UrlEncode(sessionId), nil, 1)
	if not ok or not response then return end
	local decodedOk, body = pcall(function() return HttpService:JSONDecode(response.Body) end)
	if decodedOk and type(body) == "table" and body.command then handleCommand(body.command) end
end

local function applyProposal(proposal)
	local operation, target, content = proposal.operation, proposal.target, proposal.content
	if operation ~= "update_script" and operation ~= "create_script" then return false, "deferred: " .. tostring(operation) end
	if type(target) ~= "string" or target == "" then return false, "missing target" end
	if type(content) ~= "string" then return false, "missing script content" end
	if operation == "update_script" then
		local object = findPath(target)
		if not object or not object:IsA("LuaSourceContainer") then return false, "script not found: " .. target end
		local ok, err = pcall(function()
			ScriptEditorService:UpdateSourceAsync(object, function() return content end)
		end)
		if not ok then ok, err = pcall(function() object.Source = content end) end
		return ok, ok and ("updated " .. target) or tostring(err)
	end
	local parts = string.split(target, ".")
	local name = table.remove(parts)
	local parent = findPath(table.concat(parts, "."))
	if not name or not parent or parent:FindFirstChild(name) then return false, "invalid or existing target: " .. target end
	local scriptObject = Instance.new("Script")
	scriptObject.Name = name
	scriptObject.Parent = parent
	local ok, err = pcall(function() ScriptEditorService:UpdateSourceAsync(scriptObject, function() return content end) end)
	if not ok then ok, err = pcall(function() scriptObject.Source = content end) end
	if not ok then scriptObject:Destroy(); return false, tostring(err) end
	return true, "created " .. target
end

local function generatePlan()
	if busy then return end
	local prompt = tostring(promptBox.Text or ""):gsub("^%s+", ""):gsub("%s+$", "")
	if #prompt < 2 then setStatus("Describe the change first.", "bad"); return end
	busy = true
	applyArmed = false
	if applyButton then applyButton.Text = "Apply Changes" end
	local endpoint = saveEndpoint()
	refreshContext()
	setStatus("LUA-X is thinking…", "warn")
	local ok, response = safeRequest("POST", endpoint, {
		prompt = prompt,
		projectId = tostring(game.PlaceId),
		mode = "build",
		context = currentContext,
	}, 3)
	busy = false
	if not ok then
		local message = response and parseErrorBody(response) or "Network request failed."
		setStatus("Backend " .. tostring(response and response.StatusCode or "error") .. ": " .. message, "bad")
		warn("[LUA-X] Generate request failed:", message)
		return
	end
	local decodeOk, body = pcall(function() return HttpService:JSONDecode(response.Body) end)
	if not decodeOk or type(body) ~= "table" then setStatus("LUA-X returned invalid JSON.", "bad"); return end
	if body.error then setStatus("LUA-X: " .. tostring(body.error), "bad"); return end
	if type(body.plan) ~= "table" or type(body.plan.changes) ~= "table" then setStatus("No valid change plan returned.", "bad"); return end
	currentPlan = body.plan
	planBox.Text = HttpService:JSONEncode(body.plan)
	setStatus("Plan ready · review before applying.", "good")
end

local function applyPlan()
	if busy then return end
	if type(currentPlan) ~= "table" or type(currentPlan.changes) ~= "table" then setStatus("Generate a plan first.", "bad"); return end
	local changes = {}
	for _, proposal in ipairs(currentPlan.changes) do
		if type(proposal) == "table" and (proposal.operation == "update_script" or proposal.operation == "create_script") then table.insert(changes, proposal) end
	end
	if #changes == 0 then setStatus("No script changes can be applied automatically.", "warn"); return end
	if not applyArmed then
		applyArmed = true
		applyButton.Text = "Confirm Apply  ·  " .. tostring(#changes)
		setStatus("Review the plan, then confirm once more.", "warn")
		return
	end
	busy = true
	applyArmed = false
	applyButton.Text = "Applying…"
	ChangeHistoryService:SetWaypoint("LUA-X · Before Apply")
	local good, failed = 0, 0
	local results = {}
	for _, proposal in ipairs(changes) do
		local ok, result = applyProposal(proposal)
		if ok then good += 1; table.insert(results, "✓ " .. result) else failed += 1; table.insert(results, "✗ " .. result) end
	end
	ChangeHistoryService:SetWaypoint("LUA-X · After Apply")
	busy = false
	applyButton.Text = "Apply Changes"
	planBox.Text = table.concat(results, "\n")
	setStatus(string.format("Applied %d · failed %d · Undo available in Studio.", good, failed), failed == 0 and "good" or "bad")
end

local function verifyLocal()
	local selectionCount = #Selection:Get()
	local scriptCount = #selectedScripts()
	local changeCount = type(currentPlan) == "table" and type(currentPlan.changes) == "table" and #currentPlan.changes or 0
	planBox.Text = table.concat({
		"LUA-X VERIFICATION",
		"",
		"Backend:    " .. normalizeEndpoint(endpointBox.Text),
		"Session:    " .. sessionId,
		"Place ID:   " .. tostring(game.PlaceId),
		"Selection:  " .. tostring(selectionCount),
		"Scripts:    " .. tostring(scriptCount),
		"Plan ops:   " .. tostring(changeCount),
		"",
		"Plugin health is verified. This does not claim a Play Test passed.",
	}, "\n")
	setStatus("Studio-side verification complete.", "good")
end

local function buildWidget()
	if widget then return true end
	local info = DockWidgetPluginGuiInfo.new(Enum.InitialDockState.Float, false, true, 620, 820, 460, 620)
	local ok, result = pcall(function() return plugin:CreateDockWidgetPluginGuiAsync("LUAXStudio", info) end)
	if ok then widget = result else
		local legacyOk, legacy = pcall(function() return plugin:CreateDockWidgetPluginGui("LUAXStudio", info) end)
		if not legacyOk then warn("[LUA-X] Widget creation failed", result, legacy); return false end
		widget = legacy
	end
	widget.Title = "LUA-X Studio"

	root = ui("ScrollingFrame", {Size = UDim2.fromScale(1,1), CanvasSize = UDim2.new(), AutomaticCanvasSize = Enum.AutomaticSize.Y, ScrollBarThickness = 5, BackgroundColor3 = COLORS.bg, BorderSizePixel = 0}, widget)
	ui("UIPadding", {PaddingTop=UDim.new(0,14),PaddingBottom=UDim.new(0,16),PaddingLeft=UDim.new(0,14),PaddingRight=UDim.new(0,14)}, root)
	ui("UIListLayout", {Padding=UDim.new(0,10),SortOrder=Enum.SortOrder.LayoutOrder}, root)

	local hero = round(outline(ui("Frame", {Size=UDim2.new(1,0,0,92),BackgroundColor3=COLORS.panel,BorderSizePixel=0,LayoutOrder=1}, root)))
	ui("UIGradient", {Color=ColorSequence.new({ColorSequenceKeypoint.new(0,COLORS.panel2),ColorSequenceKeypoint.new(1,COLORS.panel)})}, hero)
	ui("TextLabel", {Position=UDim2.new(0,16,0,12),Size=UDim2.new(1,-32,0,30),BackgroundTransparency=1,Text="LUA-X  /  ROBLOX ENGINEERING",Font=Enum.Font.GothamBold,TextSize=18,TextColor3=COLORS.text,TextXAlignment=Enum.TextXAlignment.Left}, hero)
	ui("TextLabel", {Position=UDim2.new(0,16,0,46),Size=UDim2.new(0.7,0,0,20),BackgroundTransparency=1,Text="Project-aware AI build system",Font=Enum.Font.Gotham,TextSize=12,TextColor3=COLORS.muted,TextXAlignment=Enum.TextXAlignment.Left}, hero)
	local conn = round(ui("Frame", {Position=UDim2.new(1,-184,0,18),Size=UDim2.new(0,164,0,42),BackgroundColor3=Color3.fromRGB(14,18,26),BorderSizePixel=0}, hero), 12)
	connectionDot = round(ui("Frame", {Position=UDim2.new(0,11,0.5,-5),Size=UDim2.new(0,10,0,10),BackgroundColor3=COLORS.bad,BorderSizePixel=0}, conn), 5)
	connectionLabel = ui("TextLabel", {Position=UDim2.new(0,29,0,0),Size=UDim2.new(1,-36,1,0),BackgroundTransparency=1,Text="Studio offline",Font=Enum.Font.GothamMedium,TextSize=11,TextColor3=COLORS.text,TextXAlignment=Enum.TextXAlignment.Left}, conn)

	local metrics = round(outline(ui("Frame", {Size=UDim2.new(1,0,0,64),BackgroundColor3=COLORS.panel,BorderSizePixel=0,LayoutOrder=2}, root)))
	ui("UIListLayout", {FillDirection=Enum.FillDirection.Horizontal,Padding=UDim.new(0,1)}, metrics)
	local m1 = ui("Frame", {Size=UDim2.new(0.33,-1,1,0),BackgroundTransparency=1}, metrics)
	ui("TextLabel", {Position=UDim2.new(0,14,0,10),Size=UDim2.new(1,-28,0,18),BackgroundTransparency=1,Text="PROJECT",Font=Enum.Font.GothamMedium,TextSize=9,TextColor3=COLORS.muted,TextXAlignment=Enum.TextXAlignment.Left}, m1)
	projectLabel = ui("TextLabel", {Position=UDim2.new(0,14,0,31),Size=UDim2.new(1,-28,0,20),BackgroundTransparency=1,Text=tostring(game.PlaceId),Font=Enum.Font.GothamBold,TextSize=13,TextColor3=COLORS.text,TextXAlignment=Enum.TextXAlignment.Left}, m1)
	local m2 = m1:Clone(); m2.Parent=metrics; m2.Position=UDim2.new(0.33,0,0,0); m2.Size=UDim2.new(0.33,-1,1,0); m2:FindFirstChildOfClass("TextLabel").Text="SELECTION"; m2:FindFirstChildOfClass("TextLabel").NextSelection = nil
	selectionLabel = m2:FindFirstChildOfClass("TextLabel"); selectionLabel.Position=UDim2.new(0,14,0,31); selectionLabel.Size=UDim2.new(1,-28,0,20); selectionLabel.Text="0 selected"
	local m3 = m1:Clone(); m3.Parent=metrics; m3.Position=UDim2.new(0.66,0,0,0); m3.Size=UDim2.new(0.34,0,1,0); m3:FindFirstChildOfClass("TextLabel").Text="ACTIVITY"; activityLabel=m3:FindFirstChildOfClass("TextLabel"); activityLabel.Position=UDim2.new(0,14,0,31); activityLabel.Size=UDim2.new(1,-28,0,20); activityLabel.Text="Ready"

	local endpointCard = round(outline(ui("Frame", {Size=UDim2.new(1,0,0,112),BackgroundColor3=COLORS.panel,BorderSizePixel=0,LayoutOrder=3}, root)))
	ui("TextLabel", {Position=UDim2.new(0,14,0,10),Size=UDim2.new(1,-28,0,18),BackgroundTransparency=1,Text="CONNECTION",Font=Enum.Font.GothamBold,TextSize=10,TextColor3=COLORS.muted,TextXAlignment=Enum.TextXAlignment.Left}, endpointCard)
	endpointBox = round(ui("TextBox", {Position=UDim2.new(0,14,0,35),Size=UDim2.new(1,-28,0,34),BackgroundColor3=COLORS.field,BorderSizePixel=0,ClearTextOnFocus=false,Font=Enum.Font.Code,TextSize=11,TextColor3=COLORS.text,TextXAlignment=Enum.TextXAlignment.Left,Text=type(plugin:GetSetting(ENDPOINT_KEY))=="string" and plugin:GetSetting(ENDPOINT_KEY) or DEFAULT_ENDPOINT}, endpointCard), 7)
	local epRow = ui("Frame", {Position=UDim2.new(0,14,0,76),Size=UDim2.new(1,-28,0,24),BackgroundTransparency=1}, endpointCard)
	ui("UIListLayout", {FillDirection=Enum.FillDirection.Horizontal,Padding=UDim.new(0,6)}, epRow)
	local test = round(ui("TextButton", {Size=UDim2.new(0.5,-3,1,0),BackgroundColor3=COLORS.field,BorderSizePixel=0,Text="Test Backend",Font=Enum.Font.GothamMedium,TextSize=11,TextColor3=COLORS.text}, epRow), 7)
	local save = round(ui("TextButton", {Size=UDim2.new(0.5,-3,1,0),BackgroundColor3=COLORS.field,BorderSizePixel=0,Text="Save Endpoint",Font=Enum.Font.GothamMedium,TextSize=11,TextColor3=COLORS.text}, epRow), 7)

	local composer = round(outline(ui("Frame", {Size=UDim2.new(1,0,0,222),BackgroundColor3=COLORS.panel,BorderSizePixel=0,LayoutOrder=4}, root)))
	ui("TextLabel", {Position=UDim2.new(0,14,0,10),Size=UDim2.new(0.6,0,0,18),BackgroundTransparency=1,Text="LUA-X ARCHITECT",Font=Enum.Font.GothamBold,TextSize=10,TextColor3=COLORS.muted,TextXAlignment=Enum.TextXAlignment.Left}, composer)
	ui("TextLabel", {Position=UDim2.new(0,14,0,29),Size=UDim2.new(1,-28,0,18),BackgroundTransparency=1,Text="Turn an intent into a reviewable Studio change set.",Font=Enum.Font.Gotham,TextSize=11,TextColor3=COLORS.text,TextXAlignment=Enum.TextXAlignment.Left}, composer)
	promptBox = round(ui("TextBox", {Position=UDim2.new(0,14,0,56),Size=UDim2.new(1,-28,0,102),BackgroundColor3=COLORS.field,BorderSizePixel=0,ClearTextOnFocus=false,Font=Enum.Font.Gotham,TextSize=12,TextColor3=COLORS.text,PlaceholderText="Describe what you want to build…",TextWrapped=true,TextXAlignment=Enum.TextXAlignment.Left,TextYAlignment=Enum.TextYAlignment.Top,MultiLine=true}, composer), 8)
	generateButton = round(ui("TextButton", {Position=UDim2.new(0,14,1,-54),Size=UDim2.new(1,-28,0,40),BackgroundColor3=COLORS.accent,BorderSizePixel=0,Text="Generate Plan",Font=Enum.Font.GothamBold,TextSize=12,TextColor3=COLORS.text}, composer), 8)

	local contextCard = round(outline(ui("Frame", {Size=UDim2.new(1,0,0,208),BackgroundColor3=COLORS.panel,BorderSizePixel=0,LayoutOrder=5}, root)))
	ui("TextLabel", {Position=UDim2.new(0,14,0,10),Size=UDim2.new(1,-28,0,18),BackgroundTransparency=1,Text="PROJECT CONTEXT",Font=Enum.Font.GothamBold,TextSize=10,TextColor3=COLORS.muted,TextXAlignment=Enum.TextXAlignment.Left}, contextCard)
	contextBox = round(ui("TextBox", {Position=UDim2.new(0,14,0,36),Size=UDim2.new(1,-28,0,132),BackgroundColor3=COLORS.field,BorderSizePixel=0,ClearTextOnFocus=false,Font=Enum.Font.Code,TextSize=10,TextColor3=COLORS.muted,TextWrapped=true,TextXAlignment=Enum.TextXAlignment.Left,TextYAlignment=Enum.TextYAlignment.Top,MultiLine=true,Text="No context loaded."}, contextCard), 8)
	local refresh = round(ui("TextButton", {Position=UDim2.new(0,14,1,-36),Size=UDim2.new(0.5,-3,0,26),BackgroundColor3=COLORS.field,BorderSizePixel=0,Text="Refresh Context",Font=Enum.Font.GothamMedium,TextSize=10,TextColor3=COLORS.text}, contextCard), 7)
	local verify = round(ui("TextButton", {Position=UDim2.new(0.5,3,1,-36),Size=UDim2.new(0.5,-17,0,26),BackgroundColor3=COLORS.field,BorderSizePixel=0,Text="Verify State",Font=Enum.Font.GothamMedium,TextSize=10,TextColor3=COLORS.text}, contextCard), 7)

	local planCard = round(outline(ui("Frame", {Size=UDim2.new(1,0,0,398),BackgroundColor3=COLORS.panel,BorderSizePixel=0,LayoutOrder=6}, root)))
	ui("TextLabel", {Position=UDim2.new(0,14,0,10),Size=UDim2.new(1,-28,0,18),BackgroundTransparency=1,Text="PLAN / CHANGE SET",Font=Enum.Font.GothamBold,TextSize=10,TextColor3=COLORS.muted,TextXAlignment=Enum.TextXAlignment.Left}, planCard)
	planBox = round(ui("TextBox", {Position=UDim2.new(0,14,0,36),Size=UDim2.new(1,-28,0,292),BackgroundColor3=COLORS.field,BorderSizePixel=0,ClearTextOnFocus=false,Font=Enum.Font.Code,TextSize=10,TextColor3=COLORS.text,TextWrapped=true,TextXAlignment=Enum.TextXAlignment.Left,TextYAlignment=Enum.TextYAlignment.Top,MultiLine=true,Text="No plan yet."}, planCard), 8)
	applyButton = round(ui("TextButton", {Position=UDim2.new(0,14,1,-56),Size=UDim2.new(1,-28,0,42),BackgroundColor3=COLORS.good,BorderSizePixel=0,Text="Apply Changes",Font=Enum.Font.GothamBold,TextSize=12,TextColor3=COLORS.text}, planCard), 8)

	statusLabel = ui("TextLabel", {Size=UDim2.new(1,0,0,42),BackgroundTransparency=1,Text="Starting connected Studio bridge…",Font=Enum.Font.GothamMedium,TextSize=11,TextWrapped=true,TextColor3=COLORS.muted,TextXAlignment=Enum.TextXAlignment.Left,LayoutOrder=7}, root)
	statusDot = round(ui("Frame", {Size=UDim2.new(0,0,0,0),Visible=false,BackgroundColor3=COLORS.muted,BorderSizePixel=0}, root), 5)

	test.MouseButton1Click:Connect(function()
		local ok, response = safeRequest("GET", apiRoot() .. "/api/health", nil, 2)
		if ok then setStatus("Backend online and responding.", "good") else setStatus("Backend error: " .. (response and parseErrorBody(response) or "unreachable"), "bad") end
	end)
	save.MouseButton1Click:Connect(function() saveEndpoint(); setStatus("Endpoint saved.", "good") end)
	refresh.MouseButton1Click:Connect(refreshContext)
	verify.MouseButton1Click:Connect(verifyLocal)
	generateButton.MouseButton1Click:Connect(generatePlan)
	applyButton.MouseButton1Click:Connect(applyPlan)
	Selection.SelectionChanged:Connect(function() if widget and widget.Enabled then refreshContext() end end)

	refreshContext()
	return true
end

toolbarButton.Click:Connect(function()
	if not buildWidget() then return end
	widget.Enabled = not widget.Enabled
	if widget.Enabled then refreshContext(); setStatus("LUA-X Studio is ready.", "good") end
end)

if not heartbeatRunning then
	heartbeatRunning = true
	task.spawn(function()
		while heartbeatRunning do
			heartbeat()
			task.wait(HEARTBEAT_SECONDS)
		end
	end)
end

if not commandRunning then
	commandRunning = true
	task.spawn(function()
		while commandRunning do
			if widget and widget.Enabled then pollCommands() end
			task.wait(COMMAND_SECONDS)
		end
	end)
end

print("[LUA-X] Connected Studio bridge started · session " .. sessionId)
