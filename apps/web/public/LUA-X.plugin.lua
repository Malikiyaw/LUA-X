-- LUA-X Studio Plugin
-- Local-plugin entrypoint. The toolbar is created first so backend/UI errors cannot hide the plugin.

local HttpService = game:GetService("HttpService")
local Selection = game:GetService("Selection")
local ChangeHistoryService = game:GetService("ChangeHistoryService")
local ScriptEditorService = game:GetService("ScriptEditorService")

local DEFAULT_ENDPOINT = "https://lua-x-api.vercel.app/api/ai/generate"
local SETTINGS_KEY = "LUA_X_API_ENDPOINT"
local MAX_SCRIPTS = 12
local MAX_SOURCE = 4500
local MAX_CONTEXT = 14000

-- IMPORTANT: create the toolbar before any widget/network initialization.
local toolbar = plugin:CreateToolbar("LUA-X")
local toolbarButton = toolbar:CreateButton(
	"LUA-X",
	"Open LUA-X Studio",
	"rbxassetid://14978048121"
)
toolbarButton.ClickableWhenViewportHidden = true

local widget = nil
local statusLabel = nil
local endpointBox = nil
local promptBox = nil
local contextBox = nil
local planBox = nil
local generateButton = nil
local applyButton = nil
local currentPlan = nil
local currentContext = {}
local applyArmed = false
local busy = false

local function trim(text, limit)
	text = tostring(text or "")
	if #text <= limit then
		return text
	end
	return string.sub(text, 1, limit) .. "\n… [truncated]"
end

local function setStatus(text, kind)
	if not statusLabel then
		return
	end
	statusLabel.Text = text
	if kind == "good" then
		statusLabel.TextColor3 = Color3.fromRGB(105, 215, 143)
	elseif kind == "bad" then
		statusLabel.TextColor3 = Color3.fromRGB(246, 122, 122)
	else
		statusLabel.TextColor3 = Color3.fromRGB(165, 173, 190)
	end
end

local function ui(className, properties, parent)
	local object = Instance.new(className)
	for key, value in pairs(properties or {}) do
		object[key] = value
	end
	object.Parent = parent
	return object
end

local function normalizeEndpoint(value)
	local text = tostring(value or ""):gsub("^%s+", ""):gsub("%s+$", "")
	if text == "" then
		return DEFAULT_ENDPOINT
	end
	while string.sub(text, -1) == "/" do
		text = string.sub(text, 1, -2)
	end
	if string.match(text, "/api/ai/generate$") then
		return text
	end
	if string.match(text, "/api$") then
		return text .. "/ai/generate"
	end
	return text .. "/api/ai/generate"
end

local function healthEndpoint(generateUrl)
	return string.gsub(generateUrl, "/api/ai/generate$", "/api/health")
end

local function pathOf(instance)
	local parts = {}
	local current = instance
	while current and current ~= game do
		table.insert(parts, 1, current.Name)
		current = current.Parent
	end
	if #parts == 0 then
		return "game"
	end
	return "game." .. table.concat(parts, ".")
end

local function findPath(path)
	local normalized = tostring(path or ""):gsub("^game%.?", "")
	if normalized == "" then
		return game
	end
	local current = game
	for _, part in ipairs(string.split(normalized, ".")) do
		if part == "" then
			return nil
		end
		current = current:FindFirstChild(part)
		if not current then
			return nil
		end
	end
	return current
end

local function readSource(object)
	local ok, source = pcall(function()
		return object.Source
	end)
	if ok and type(source) == "string" then
		return source
	end
	return nil
end

local function selectedScripts()
	local result = {}
	local seen = {}
	for _, item in ipairs(Selection:Get()) do
		if item:IsA("LuaSourceContainer") and not seen[item] then
			table.insert(result, item)
			seen[item] = true
		end
		for _, descendant in ipairs(item:GetDescendants()) do
			if #result >= MAX_SCRIPTS then
				break
			end
			if descendant:IsA("LuaSourceContainer") and not seen[descendant] then
				table.insert(result, descendant)
				seen[descendant] = true
			end
		end
		if #result >= MAX_SCRIPTS then
			break
		end
	end
	return result
end

local function refreshContext()
	if not widget then
		return
	end
	local selection = Selection:Get()
	local instances = {}
	for _, item in ipairs(selection) do
		table.insert(instances, pathOf(item) .. " [" .. item.ClassName .. "]")
	end

	local scripts = selectedScripts()
	local files = {}
	local snippets = {}
	for _, object in ipairs(scripts) do
		table.insert(files, pathOf(object))
		local source = readSource(object)
		if source then
			table.insert(snippets, "-- " .. pathOf(object) .. "\n" .. trim(source, MAX_SOURCE))
		end
	end

	local architecture = trim(table.concat(snippets, "\n\n"), MAX_CONTEXT)
	currentContext = {
		relevantFiles = files,
		relevantInstances = instances,
		architecture = architecture,
		constraints = {
			"Use the current Roblox Studio selection as context.",
			"Do not place provider API keys in generated Studio code.",
			"Prefer minimal, reversible, reviewable changes.",
			"Do not claim runtime verification unless evidence exists.",
		},
	}

	local lines = {
		"Selections: " .. tostring(#selection),
		"Scripts in context: " .. tostring(#scripts),
		"",
		"Instances:",
		#instances > 0 and table.concat(instances, "\n") or "(none)",
	}
	if #files > 0 then
		table.insert(lines, "")
		table.insert(lines, "Scripts:")
		table.insert(lines, table.concat(files, "\n"))
	end
	if architecture ~= "" then
		table.insert(lines, "")
		table.insert(lines, "Source context:")
		table.insert(lines, architecture)
	end
	contextBox.Text = trim(table.concat(lines, "\n"), MAX_CONTEXT)
	setStatus(string.format("Context ready: %d selection(s), %d script(s).", #selection, #scripts), "good")
end

local function saveEndpoint()
	local endpoint = normalizeEndpoint(endpointBox.Text)
	endpointBox.Text = endpoint
	plugin:SetSetting(SETTINGS_KEY, endpoint)
	return endpoint
end

local function testConnection()
	if busy then
		return
	end
	busy = true
	local endpoint = saveEndpoint()
	setStatus("Testing LUA-X backend…")
	local ok, response = pcall(function()
		return HttpService:RequestAsync({
			Url = healthEndpoint(endpoint),
			Method = "GET",
			Headers = { ["Accept"] = "application/json" },
		})
	end)
	busy = false
	if not ok then
		setStatus("Connection failed. Enable Allow HTTP Requests and check the endpoint.", "bad")
		warn("LUA-X connection error:", response)
		return
	end
	if not response.Success then
		setStatus("Backend " .. tostring(response.StatusCode) .. ": " .. trim(response.Body or response.StatusMessage, 220), "bad")
		return
	end
	setStatus("LUA-X backend is reachable.", "good")
end

local function generatePlan()
	if busy then
		return
	end
	local prompt = tostring(promptBox.Text or ""):gsub("^%s+", ""):gsub("%s+$", "")
	if #prompt < 2 then
		setStatus("Describe the change first.", "bad")
		return
	end
	busy = true
	applyArmed = false
	applyButton.Text = "Apply Script Changes"
	local endpoint = saveEndpoint()
	refreshContext()
	setStatus("LUA-X is generating a structured plan…")

	local ok, response = pcall(function()
		return HttpService:RequestAsync({
			Url = endpoint,
			Method = "POST",
			Headers = {
				["Content-Type"] = "application/json",
				["Accept"] = "application/json",
			},
			Body = HttpService:JSONEncode({
				prompt = prompt,
				projectId = tostring(game.PlaceId),
				mode = "build",
				context = currentContext,
			}),
		})
	end)
	busy = false
	if not ok then
		setStatus("Request failed. See Studio Output for details.", "bad")
		warn("LUA-X generate error:", response)
		return
	end
	if not response.Success then
		setStatus("API " .. tostring(response.StatusCode) .. ": " .. trim(response.Body or response.StatusMessage, 260), "bad")
		return
	end

	local decodeOk, body = pcall(function()
		return HttpService:JSONDecode(response.Body)
	end)
	if not decodeOk or type(body) ~= "table" then
		setStatus("LUA-X returned invalid JSON.", "bad")
		return
	end
	if body.error then
		setStatus("LUA-X: " .. tostring(body.error), "bad")
		return
	end
	if type(body.plan) ~= "table" or type(body.plan.changes) ~= "table" then
		setStatus("LUA-X returned no valid change list.", "bad")
		return
	end

	currentPlan = body.plan
	planBox.Text = HttpService:JSONEncode(body.plan)
	setStatus("Plan ready. Review it, then click Apply twice to confirm.", "good")
end

local function writeSource(object, source)
	local ok, errorMessage = pcall(function()
		ScriptEditorService:UpdateSourceAsync(object, function()
			return source
		end)
	end)
	if ok then
		return true, "ok"
	end
	local fallbackOk, fallbackError = pcall(function()
		object.Source = source
	end)
	if fallbackOk then
		return true, "ok"
	end
	return false, tostring(fallbackError or errorMessage)
end

local function applyProposal(proposal)
	local operation = proposal.operation
	local target = proposal.target
	local content = proposal.content
	if operation ~= "update_script" and operation ~= "create_script" then
		return false, "deferred: " .. tostring(operation)
	end
	if type(target) ~= "string" or target == "" then
		return false, "missing target"
	end
	if type(content) ~= "string" then
		return false, "missing script content"
	end

	if operation == "update_script" then
		local object = findPath(target)
		if not object then
			return false, "script not found: " .. target
		end
		if not object:IsA("LuaSourceContainer") then
			return false, "target is not a script: " .. target
		end
		local ok, errorMessage = writeSource(object, content)
		if ok then
			return true, "updated " .. target
		end
		return false, "failed " .. target .. ": " .. errorMessage
	end

	local parts = string.split(target, ".")
	local name = table.remove(parts)
	local parent = findPath(table.concat(parts, "."))
	if not name or name == "" or not parent then
		return false, "invalid create target: " .. target
	end
	if parent:FindFirstChild(name) then
		return false, "already exists: " .. target
	end
	local scriptObject = Instance.new("Script")
	scriptObject.Name = name
	scriptObject.Parent = parent
	local ok, errorMessage = writeSource(scriptObject, content)
	if not ok then
		scriptObject:Destroy()
		return false, "failed " .. target .. ": " .. errorMessage
	end
	return true, "created " .. target
end

local function applyPlan()
	if busy then
		return
	end
	if type(currentPlan) ~= "table" or type(currentPlan.changes) ~= "table" then
		setStatus("Generate a plan before applying changes.", "bad")
		return
	end

	local applicable = {}
	local deferred = 0
	for _, proposal in ipairs(currentPlan.changes) do
		if type(proposal) == "table" and (proposal.operation == "update_script" or proposal.operation == "create_script") then
			table.insert(applicable, proposal)
		else
			deferred += 1
		end
	end
	if #applicable == 0 then
		setStatus("No automatically applicable script changes are in this plan.")
		return
	end
	if not applyArmed then
		applyArmed = true
		applyButton.Text = string.format("Confirm Apply (%d)", #applicable)
		setStatus("Review the plan. Click Apply again to confirm.")
		return
	end

	busy = true
	applyArmed = false
	applyButton.Text = "Applying…"
	ChangeHistoryService:SetWaypoint("LUA-X - Before Apply")
	local successCount = 0
	local failCount = 0
	local results = {}
	for _, proposal in ipairs(applicable) do
		local ok, message = applyProposal(proposal)
		if ok then
			successCount += 1
			table.insert(results, "✓ " .. message)
		else
			failCount += 1
			table.insert(results, "✗ " .. message)
		end
	end
	ChangeHistoryService:SetWaypoint("LUA-X - After Apply")
	busy = false
	applyButton.Text = "Apply Script Changes"
	planBox.Text = table.concat(results, "\n")
	if failCount == 0 then
		setStatus(string.format("Applied %d change(s); %d deferred.", successCount, deferred), "good")
	else
		setStatus(string.format("Applied %d; failed %d; deferred %d. Use Studio Undo to revert.", successCount, failCount, deferred), "bad")
	end
end

local function verifyLocal()
	local selection = Selection:Get()
	local scriptCount = #selectedScripts()
	local changeCount = 0
	if type(currentPlan) == "table" and type(currentPlan.changes) == "table" then
		changeCount = #currentPlan.changes
	end
	planBox.Text = table.concat({
		"LUA-X local verification",
		"Selection count: " .. tostring(#selection),
		"Script context count: " .. tostring(scriptCount),
		"Plan changes: " .. tostring(changeCount),
		"Endpoint: " .. normalizeEndpoint(endpointBox.Text),
		"",
		"This verifies plugin state only; it does not claim a runtime playtest passed.",
	}, "\n")
	setStatus("Plugin-side verification complete.", "good")
end

local function buildWidget()
	if widget then
		return true
	end

	local info = DockWidgetPluginGuiInfo.new(
		Enum.InitialDockState.Float,
		false,
		true,
		560,
		760,
		400,
		460
	)

	local ok, result = pcall(function()
		return plugin:CreateDockWidgetPluginGuiAsync("LUAXStudio", info)
	end)
	if ok then
		widget = result
	else
		local legacyOk, legacyResult = pcall(function()
			return plugin:CreateDockWidgetPluginGui("LUAXStudio", info)
		end)
		if not legacyOk then
			warn("LUA-X widget creation failed:", result, legacyResult)
			return false
		end
		widget = legacyResult
	end

	widget.Title = "LUA-X Studio"

	local root = ui("ScrollingFrame", {
		Size = UDim2.fromScale(1, 1),
		CanvasSize = UDim2.new(),
		AutomaticCanvasSize = Enum.AutomaticSize.Y,
		ScrollBarThickness = 6,
		BackgroundColor3 = Color3.fromRGB(17, 19, 25),
		BorderSizePixel = 0,
	}, widget)
	ui("UIPadding", {PaddingTop = UDim.new(0, 14), PaddingBottom = UDim.new(0, 14), PaddingLeft = UDim.new(0, 14), PaddingRight = UDim.new(0, 14)}, root)
	ui("UIListLayout", {Padding = UDim.new(0, 9), SortOrder = Enum.SortOrder.LayoutOrder}, root)
	ui("TextLabel", {Size = UDim2.new(1, 0, 0, 34), BackgroundTransparency = 1, Text = "LUA-X", Font = Enum.Font.GothamBold, TextSize = 25, TextColor3 = Color3.fromRGB(245, 247, 255), TextXAlignment = Enum.TextXAlignment.Left, LayoutOrder = 1}, root)
	ui("TextLabel", {Size = UDim2.new(1, 0, 0, 40), BackgroundTransparency = 1, Text = "AI-native Roblox engineering", Font = Enum.Font.Gotham, TextSize = 13, TextColor3 = Color3.fromRGB(166, 173, 190), TextXAlignment = Enum.TextXAlignment.Left, LayoutOrder = 2}, root)
	ui("TextLabel", {Size = UDim2.new(1, 0, 0, 20), BackgroundTransparency = 1, Text = "Backend endpoint", Font = Enum.Font.GothamMedium, TextSize = 12, TextColor3 = Color3.fromRGB(190, 197, 214), TextXAlignment = Enum.TextXAlignment.Left, LayoutOrder = 3}, root)
	endpointBox = ui("TextBox", {Size = UDim2.new(1, 0, 0, 38), BackgroundColor3 = Color3.fromRGB(29, 32, 41), BorderSizePixel = 0, ClearTextOnFocus = false, Font = Enum.Font.Code, TextSize = 12, TextColor3 = Color3.fromRGB(232, 235, 245), TextXAlignment = Enum.TextXAlignment.Left, LayoutOrder = 4}, root)
	local saved = plugin:GetSetting(SETTINGS_KEY)
	endpointBox.Text = type(saved) == "string" and saved ~= "" and saved or DEFAULT_ENDPOINT

	local connectionRow = ui("Frame", {Size = UDim2.new(1, 0, 0, 36), BackgroundTransparency = 1, LayoutOrder = 5}, root)
	ui("UIListLayout", {FillDirection = Enum.FillDirection.Horizontal, Padding = UDim.new(0, 8)}, connectionRow)
	local testButton = ui("TextButton", {Size = UDim2.new(0.5, -4, 1, 0), BackgroundColor3 = Color3.fromRGB(39, 43, 54), BorderSizePixel = 0, Text = "Test Connection", Font = Enum.Font.GothamMedium, TextSize = 12, TextColor3 = Color3.fromRGB(235, 239, 250)}, connectionRow)
	local saveButton = ui("TextButton", {Size = UDim2.new(0.5, -4, 1, 0), BackgroundColor3 = Color3.fromRGB(39, 43, 54), BorderSizePixel = 0, Text = "Save Endpoint", Font = Enum.Font.GothamMedium, TextSize = 12, TextColor3 = Color3.fromRGB(235, 239, 250)}, connectionRow)

	ui("TextLabel", {Size = UDim2.new(1, 0, 0, 20), BackgroundTransparency = 1, Text = "Describe the change", Font = Enum.Font.GothamMedium, TextSize = 12, TextColor3 = Color3.fromRGB(190, 197, 214), TextXAlignment = Enum.TextXAlignment.Left, LayoutOrder = 6}, root)
	promptBox = ui("TextBox", {Size = UDim2.new(1, 0, 0, 115), BackgroundColor3 = Color3.fromRGB(29, 32, 41), BorderSizePixel = 0, ClearTextOnFocus = false, Font = Enum.Font.Gotham, TextSize = 13, TextColor3 = Color3.fromRGB(239, 242, 250), PlaceholderText = "Example: Add a sprint system to the selected controller with server validation.", TextWrapped = true, TextXAlignment = Enum.TextXAlignment.Left, TextYAlignment = Enum.TextYAlignment.Top, MultiLine = true, LayoutOrder = 7}, root)
	local actionRow = ui("Frame", {Size = UDim2.new(1, 0, 0, 38), BackgroundTransparency = 1, LayoutOrder = 8}, root)
	ui("UIListLayout", {FillDirection = Enum.FillDirection.Horizontal, Padding = UDim.new(0, 8)}, actionRow)
	local refreshButton = ui("TextButton", {Size = UDim2.new(0.5, -4, 1, 0), BackgroundColor3 = Color3.fromRGB(39, 43, 54), BorderSizePixel = 0, Text = "Refresh Context", Font = Enum.Font.GothamMedium, TextSize = 13, TextColor3 = Color3.fromRGB(235, 239, 250)}, actionRow)
	generateButton = ui("TextButton", {Size = UDim2.new(0.5, -4, 1, 0), BackgroundColor3 = Color3.fromRGB(72, 92, 255), BorderSizePixel = 0, Text = "Generate Plan", Font = Enum.Font.GothamBold, TextSize = 13, TextColor3 = Color3.fromRGB(255, 255, 255)}, actionRow)
	statusLabel = ui("TextLabel", {Size = UDim2.new(1, 0, 0, 44), BackgroundTransparency = 1, Text = "LUA-X loaded successfully.", Font = Enum.Font.Gotham, TextSize = 12, TextWrapped = true, TextColor3 = Color3.fromRGB(105, 215, 143), TextXAlignment = Enum.TextXAlignment.Left, LayoutOrder = 9}, root)
	contextBox = ui("TextBox", {Size = UDim2.new(1, 0, 0, 190), BackgroundColor3 = Color3.fromRGB(23, 26, 33), BorderSizePixel = 0, ClearTextOnFocus = false, Font = Enum.Font.Code, TextSize = 11, TextColor3 = Color3.fromRGB(201, 208, 223), Text = "No context loaded.", TextWrapped = true, TextXAlignment = Enum.TextXAlignment.Left, TextYAlignment = Enum.TextYAlignment.Top, MultiLine = true, LayoutOrder = 10}, root)
	planBox = ui("TextBox", {Size = UDim2.new(1, 0, 0, 320), BackgroundColor3 = Color3.fromRGB(23, 26, 33), BorderSizePixel = 0, ClearTextOnFocus = false, Font = Enum.Font.Code, TextSize = 11, TextColor3 = Color3.fromRGB(209, 216, 233), Text = "No plan yet.", TextWrapped = true, TextXAlignment = Enum.TextXAlignment.Left, TextYAlignment = Enum.TextYAlignment.Top, MultiLine = true, LayoutOrder = 11}, root)
	applyButton = ui("TextButton", {Size = UDim2.new(1, 0, 0, 44), BackgroundColor3 = Color3.fromRGB(43, 154, 91), BorderSizePixel = 0, Text = "Apply Script Changes", Font = Enum.Font.GothamBold, TextSize = 13, TextColor3 = Color3.fromRGB(255, 255, 255), LayoutOrder = 12}, root)
	local verifyButton = ui("TextButton", {Size = UDim2.new(1, 0, 0, 38), BackgroundColor3 = Color3.fromRGB(39, 43, 54), BorderSizePixel = 0, Text = "Run Local Verification", Font = Enum.Font.GothamMedium, TextSize = 13, TextColor3 = Color3.fromRGB(235, 239, 250), LayoutOrder = 13}, root)

	testButton.MouseButton1Click:Connect(testConnection)
	saveButton.MouseButton1Click:Connect(function()
		saveEndpoint()
		setStatus("Endpoint saved.", "good")
	end)
	refreshButton.MouseButton1Click:Connect(refreshContext)
	generateButton.MouseButton1Click:Connect(generatePlan)
	applyButton.MouseButton1Click:Connect(applyPlan)
	verifyButton.MouseButton1Click:Connect(verifyLocal)
	Selection.SelectionChanged:Connect(function()
		if widget and widget.Enabled then
			refreshContext()
		end
	end)

	refreshContext()
	return true
end

toolbarButton.Click:Connect(function()
	if not buildWidget() then
		return
	end
	widget.Enabled = not widget.Enabled
	if widget.Enabled then
		refreshContext()
	end
end)

-- Nothing network-related runs during plugin startup.
print("[LUA-X] Studio plugin loaded. Click the LUA-X button in Plugins to open it.")