--!strict
-- LUA-X Studio Plugin
-- AI-native Roblox engineering inside Studio.
--
-- Requirements:
-- 1) Enable Game Settings > Security > Allow HTTP Requests.
-- 2) The configured endpoint must expose POST /api/ai/generate and GET /api/health.
-- 3) Provider secrets stay on the LUA-X backend; none are stored in Studio.

local HttpService = game:GetService("HttpService")
local Selection = game:GetService("Selection")
local ChangeHistoryService = game:GetService("ChangeHistoryService")
local ScriptEditorService = game:GetService("ScriptEditorService")

local DEFAULT_GENERATE_ENDPOINT = "https://lua-x-api.vercel.app/api/ai/generate"
local ENDPOINT_SETTING = "LUA_X_API_ENDPOINT"
local MAX_CONTEXT_BYTES = 14000
local MAX_SCRIPT_COUNT = 12
local MAX_SOURCE_PER_SCRIPT = 4500

local toolbar = plugin:CreateToolbar("LUA-X")
local toolbarButton = toolbar:CreateButton("LUA-X", "Open LUA-X Studio", "rbxassetid://0")
toolbarButton.ClickableWhenViewportHidden = true

local widget = plugin:CreateDockWidgetPluginGui(
	"LUAXStudio",
	DockWidgetPluginGuiInfo.new(Enum.InitialDockState.Float, true, false, 560, 760, 400, 460)
)
widget.Title = "LUA-X Studio"

local function make<T>(className: string, props: {[string]: any}, parent: Instance): T
	local instance = Instance.new(className)
	for key, value in pairs(props) do
		(instance :: any)[key] = value
	end
	instance.Parent = parent
	return instance :: any
end

local root = make<ScrollingFrame>("ScrollingFrame", {
	Size = UDim2.fromScale(1, 1), CanvasSize = UDim2.new(), AutomaticCanvasSize = Enum.AutomaticSize.Y,
	ScrollBarThickness = 6, BackgroundColor3 = Color3.fromRGB(17, 19, 25), BorderSizePixel = 0,
}, widget)
make<UIPadding>("UIPadding", {PaddingTop = UDim.new(0, 14), PaddingBottom = UDim.new(0, 14), PaddingLeft = UDim.new(0, 14), PaddingRight = UDim.new(0, 14)}, root)
make<UIListLayout>("UIListLayout", {Padding = UDim.new(0, 9), SortOrder = Enum.SortOrder.LayoutOrder}, root)
make<TextLabel>("TextLabel", {Size = UDim2.new(1, 0, 0, 34), BackgroundTransparency = 1, Text = "LUA-X", Font = Enum.Font.GothamBold, TextSize = 25, TextColor3 = Color3.fromRGB(245, 247, 255), TextXAlignment = Enum.TextXAlignment.Left, LayoutOrder = 1}, root)
make<TextLabel>("TextLabel", {Size = UDim2.new(1, 0, 0, 38), BackgroundTransparency = 1, Text = "Understand → Plan → Review → Apply → Verify", Font = Enum.Font.Gotham, TextSize = 13, TextWrapped = true, TextColor3 = Color3.fromRGB(166, 173, 190), TextXAlignment = Enum.TextXAlignment.Left, LayoutOrder = 2}, root)
make<TextLabel>("TextLabel", {Size = UDim2.new(1, 0, 0, 20), BackgroundTransparency = 1, Text = "Backend endpoint", Font = Enum.Font.GothamMedium, TextSize = 12, TextColor3 = Color3.fromRGB(190, 197, 214), TextXAlignment = Enum.TextXAlignment.Left, LayoutOrder = 3}, root)
local endpointBox = make<TextBox>("TextBox", {Size = UDim2.new(1, 0, 0, 38), BackgroundColor3 = Color3.fromRGB(29, 32, 41), BorderSizePixel = 0, ClearTextOnFocus = false, Font = Enum.Font.Code, TextSize = 12, TextColor3 = Color3.fromRGB(232, 235, 245), TextXAlignment = Enum.TextXAlignment.Left, LayoutOrder = 4}, root)
local savedEndpoint = plugin:GetSetting(ENDPOINT_SETTING)
endpointBox.Text = if typeof(savedEndpoint) == "string" and savedEndpoint ~= "" then savedEndpoint else DEFAULT_GENERATE_ENDPOINT
local endpointControls = make<Frame>("Frame", {Size = UDim2.new(1, 0, 0, 34), BackgroundTransparency = 1, LayoutOrder = 5}, root)
make<UIListLayout>("UIListLayout", {FillDirection = Enum.FillDirection.Horizontal, Padding = UDim.new(0, 8), VerticalAlignment = Enum.VerticalAlignment.Center}, endpointControls)
local testConnectionButton = make<TextButton>("TextButton", {Size = UDim2.new(0.5, -4, 1, 0), BackgroundColor3 = Color3.fromRGB(39, 43, 54), BorderSizePixel = 0, Text = "Test Connection", Font = Enum.Font.GothamMedium, TextSize = 12, TextColor3 = Color3.fromRGB(235, 239, 250)}, endpointControls)
local saveEndpointButton = make<TextButton>("TextButton", {Size = UDim2.new(0.5, -4, 1, 0), BackgroundColor3 = Color3.fromRGB(39, 43, 54), BorderSizePixel = 0, Text = "Save Endpoint", Font = Enum.Font.GothamMedium, TextSize = 12, TextColor3 = Color3.fromRGB(235, 239, 250)}, endpointControls)
make<TextLabel>("TextLabel", {Size = UDim2.new(1, 0, 0, 20), BackgroundTransparency = 1, Text = "Describe the change", Font = Enum.Font.GothamMedium, TextSize = 12, TextColor3 = Color3.fromRGB(190, 197, 214), TextXAlignment = Enum.TextXAlignment.Left, LayoutOrder = 6}, root)
local promptBox = make<TextBox>("TextBox", {Size = UDim2.new(1, 0, 0, 112), BackgroundColor3 = Color3.fromRGB(29, 32, 41), BorderSizePixel = 0, ClearTextOnFocus = false, Font = Enum.Font.Gotham, TextSize = 13, TextColor3 = Color3.fromRGB(239, 242, 250), PlaceholderText = "Example: Add a sprint system to the selected controller with server validation.", TextWrapped = true, TextXAlignment = Enum.TextXAlignment.Left, TextYAlignment = Enum.TextYAlignment.Top, MultiLine = true, LayoutOrder = 7}, root)
local actionRow = make<Frame>("Frame", {Size = UDim2.new(1, 0, 0, 38), BackgroundTransparency = 1, LayoutOrder = 8}, root)
make<UIListLayout>("UIListLayout", {FillDirection = Enum.FillDirection.Horizontal, Padding = UDim.new(0, 8), VerticalAlignment = Enum.VerticalAlignment.Center}, actionRow)
local refreshButton = make<TextButton>("TextButton", {Size = UDim2.new(0.5, -4, 1, 0), BackgroundColor3 = Color3.fromRGB(39, 43, 54), BorderSizePixel = 0, Text = "Refresh Context", Font = Enum.Font.GothamMedium, TextSize = 13, TextColor3 = Color3.fromRGB(235, 239, 250)}, actionRow)
local generateButton = make<TextButton>("TextButton", {Size = UDim2.new(0.5, -4, 1, 0), BackgroundColor3 = Color3.fromRGB(72, 92, 255), BorderSizePixel = 0, Text = "Generate Plan", Font = Enum.Font.GothamBold, TextSize = 13, TextColor3 = Color3.fromRGB(255, 255, 255)}, actionRow)
local statusLabel = make<TextLabel>("TextLabel", {Size = UDim2.new(1, 0, 0, 44), BackgroundTransparency = 1, Text = "Ready. Select a script or model, then describe the change.", Font = Enum.Font.Gotham, TextSize = 12, TextWrapped = true, TextColor3 = Color3.fromRGB(150, 158, 177), TextXAlignment = Enum.TextXAlignment.Left, LayoutOrder = 9}, root)
make<TextLabel>("TextLabel", {Size = UDim2.new(1, 0, 0, 20), BackgroundTransparency = 1, Text = "Studio Context", Font = Enum.Font.GothamBold, TextSize = 14, TextColor3 = Color3.fromRGB(238, 241, 249), TextXAlignment = Enum.TextXAlignment.Left, LayoutOrder = 10}, root)
local contextBox = make<TextBox>("TextBox", {Size = UDim2.new(1, 0, 0, 180), BackgroundColor3 = Color3.fromRGB(23, 26, 33), BorderSizePixel = 0, ClearTextOnFocus = false, Font = Enum.Font.Code, TextSize = 11, TextColor3 = Color3.fromRGB(201, 208, 223), Text = "No context loaded.", TextWrapped = true, TextXAlignment = Enum.TextXAlignment.Left, TextYAlignment = Enum.TextYAlignment.Top, MultiLine = true, LayoutOrder = 11}, root)
make<TextLabel>("TextLabel", {Size = UDim2.new(1, 0, 0, 20), BackgroundTransparency = 1, Text = "Plan Preview", Font = Enum.Font.GothamBold, TextSize = 14, TextColor3 = Color3.fromRGB(238, 241, 249), TextXAlignment = Enum.TextXAlignment.Left, LayoutOrder = 12}, root)
local planBox = make<TextBox>("TextBox", {Size = UDim2.new(1, 0, 0, 300), BackgroundColor3 = Color3.fromRGB(23, 26, 33), BorderSizePixel = 0, ClearTextOnFocus = false, Font = Enum.Font.Code, TextSize = 11, TextColor3 = Color3.fromRGB(209, 216, 233), Text = "No plan yet.", TextWrapped = true, TextXAlignment = Enum.TextXAlignment.Left, TextYAlignment = Enum.TextYAlignment.Top, MultiLine = true, LayoutOrder = 13}, root)
local applyButton = make<TextButton>("TextButton", {Size = UDim2.new(1, 0, 0, 44), BackgroundColor3 = Color3.fromRGB(43, 154, 91), BorderSizePixel = 0, Text = "Apply Script Changes", Font = Enum.Font.GothamBold, TextSize = 13, TextColor3 = Color3.fromRGB(255, 255, 255), LayoutOrder = 14}, root)
local verifyButton = make<TextButton>("TextButton", {Size = UDim2.new(1, 0, 0, 38), BackgroundColor3 = Color3.fromRGB(39, 43, 54), BorderSizePixel = 0, Text = "Run Local Verification", Font = Enum.Font.GothamMedium, TextSize = 13, TextColor3 = Color3.fromRGB(235, 239, 250), LayoutOrder = 15}, root)

local selectedContext: {[string]: any} = {}
local currentPlan: {[string]: any}? = nil
local applyArmed = false
local requestBusy = false

local function setStatus(text: string, state: string?)
	statusLabel.Text = text
	statusLabel.TextColor3 = if state == "good" then Color3.fromRGB(109, 215, 143) elseif state == "bad" then Color3.fromRGB(246, 122, 122) else Color3.fromRGB(150, 158, 177)
end
local function trim(text: string, maxLength: number): string
	if #text <= maxLength then return text end
	return string.sub(text, 1, maxLength) .. "\n… [truncated]"
end
local function normalizeEndpoint(value: string): string
	local text = value:gsub("^%s+", ""):gsub("%s+$", "")
	if text == "" then return DEFAULT_GENERATE_ENDPOINT end
	while string.sub(text, -1) == "/" do text = string.sub(text, 1, -2) end
	if string.match(text, "/api/ai/generate$") then return text end
	if string.match(text, "/api$") then return text .. "/ai/generate" end
	return text .. "/api/ai/generate"
end
local function healthEndpoint(generateUrl: string): string
	return string.gsub(generateUrl, "/api/ai/generate$", "/api/health")
end
local function saveConfiguredEndpoint(): string
	local normalized = normalizeEndpoint(endpointBox.Text)
	endpointBox.Text = normalized
	plugin:SetSetting(ENDPOINT_SETTING, normalized)
	return normalized
end
local function pathOf(instance: Instance): string
	local parts: {string} = {}
	local current: Instance? = instance
	while current and current ~= game do
		table.insert(parts, 1, current.Name)
		current = current.Parent
	end
	return "game." .. table.concat(parts, ".")
end
local function safeSource(object: LuaSourceContainer): string?
	local ok, source = pcall(function() return object.Source end)
	if ok and typeof(source) == "string" then return source end
	return nil
end
local function collectSelectedScripts(selection: {Instance}): {LuaSourceContainer}
	local scripts: {LuaSourceContainer} = {}
	local seen: {[Instance]: boolean} = {}
	for _, item in ipairs(selection) do
		if item:IsA("LuaSourceContainer") and not seen[item] then
			table.insert(scripts, item); seen[item] = true
		end
		for _, descendant in ipairs(item:GetDescendants()) do
			if #scripts >= MAX_SCRIPT_COUNT then break end
			if descendant:IsA("LuaSourceContainer") and not seen[descendant] then
				table.insert(scripts, descendant); seen[descendant] = true
			end
		end
		if #scripts >= MAX_SCRIPT_COUNT then break end
	end
	return scripts
end
local function refreshContext()
	local selection = Selection:Get()
	local instances: {string} = {}
	for _, item in ipairs(selection) do table.insert(instances, pathOf(item) .. " [" .. item.ClassName .. "]") end
	local scripts = collectSelectedScripts(selection)
	local files: {string} = {}
	local snippets: {string} = {}
	for _, scriptObject in ipairs(scripts) do
		table.insert(files, pathOf(scriptObject))
		local source = safeSource(scriptObject)
		if source then table.insert(snippets, "-- " .. pathOf(scriptObject) .. "\n" .. trim(source, MAX_SOURCE_PER_SCRIPT)) end
	end
	local architecture = trim(table.concat(snippets, "\n\n"), MAX_CONTEXT_BYTES)
	selectedContext = {relevantFiles = files, relevantInstances = instances, architecture = architecture, constraints = {"Roblox Studio context was collected from the current selection.", "Provider credentials must never be placed in generated Studio code.", "Prefer minimal, reversible, reviewable changes.", "Never claim Studio tests passed unless this plugin produced the evidence."}}
	local rendered = {"Selections: " .. tostring(#selection), "Scripts in context: " .. tostring(#scripts), "", "Instances:", if #instances > 0 then table.concat(instances, "\n") else "(none)"}
	if #files > 0 then table.insert(rendered, ""); table.insert(rendered, "Scripts:"); table.insert(rendered, table.concat(files, "\n")) end
	if architecture ~= "" then table.insert(rendered, ""); table.insert(rendered, "Source context:"); table.insert(rendered, architecture) end
	contextBox.Text = trim(table.concat(rendered, "\n"), MAX_CONTEXT_BYTES)
	setStatus(string.format("Context ready: %d selection(s), %d script(s).", #selection, #scripts), "good")
end
local function testConnection()
	if requestBusy then return end
	requestBusy = true; testConnectionButton.Active = false
	local generateUrl = saveConfiguredEndpoint()
	setStatus("Testing LUA-X backend…")
	local ok, response = pcall(function()
		return HttpService:RequestAsync({Url = healthEndpoint(generateUrl), Method = "GET", Headers = {["Accept"] = "application/json"}})
	end)
	testConnectionButton.Active = true; requestBusy = false
	if not ok then setStatus("Connection failed. Enable HTTP Requests and check the endpoint. " .. tostring(response), "bad"); return end
	if not response.Success then setStatus("Backend " .. tostring(response.StatusCode) .. ": " .. trim(response.Body or response.StatusMessage or "unknown error", 260), "bad"); return end
	local parsedOk, parsed = pcall(function() return HttpService:JSONDecode(response.Body) end)
	if not parsedOk or typeof(parsed) ~= "table" then setStatus("Backend responded, but the health payload was invalid.", "bad"); return end
	setStatus("LUA-X backend is reachable and responding.", "good")
end
local function generatePlan()
	if requestBusy then return end
	local requestText = promptBox.Text:gsub("^%s+", ""):gsub("%s+$", "")
	if #requestText < 2 then setStatus("Describe the change first.", "bad"); return end
	requestBusy = true; generateButton.Active = false; applyButton.Active = false; applyArmed = false; applyButton.Text = "Apply Script Changes"
	local api = saveConfiguredEndpoint(); refreshContext(); setStatus("LUA-X is compiling project context and generating a plan…")
	local ok, response = pcall(function()
		return HttpService:RequestAsync({Url = api, Method = "POST", Headers = {["Content-Type"] = "application/json", ["Accept"] = "application/json"}, Body = HttpService:JSONEncode({prompt = requestText, projectId = tostring(game.PlaceId), mode = "build", context = selectedContext})})
	end)
	requestBusy = false; generateButton.Active = true; applyButton.Active = true
	if not ok then setStatus("Request failed: " .. tostring(response), "bad"); return end
	if not response.Success then setStatus("API " .. tostring(response.StatusCode) .. ": " .. trim(response.Body or response.StatusMessage or "unknown error", 320), "bad"); return end
	local decodedOk, decoded = pcall(function() return HttpService:JSONDecode(response.Body) end)
	if not decodedOk or typeof(decoded) ~= "table" then setStatus("LUA-X returned invalid JSON.", "bad"); return end
	if decoded.error ~= nil then setStatus("LUA-X: " .. tostring(decoded.error), "bad"); return end
	if typeof(decoded.plan) ~= "table" or typeof(decoded.plan.changes) ~= "table" then setStatus("LUA-X returned a plan without a valid change list.", "bad"); return end
	currentPlan = decoded.plan; planBox.Text = HttpService:JSONEncode(decoded.plan)
	setStatus(string.format("Plan ready: %d proposed change(s). Review before applying.", #decoded.plan.changes), "good")
end
local function findPath(path: string): Instance?
	local normalized = path:gsub("^game%.?", "")
	if normalized == "" then return game end
	local current: Instance = game
	for _, part in ipairs(string.split(normalized, ".")) do
		if part == "" then return nil end
		local child = current:FindFirstChild(part)
		if not child then return nil end
		current = child
	end
	return current
end
local function updateScript(object: LuaSourceContainer, source: string): (boolean, string)
	local ok, errorMessage = pcall(function() ScriptEditorService:UpdateSourceAsync(object, function() return source end) end)
	if ok then return true, "ok" end
	local fallbackOk, fallbackError = pcall(function() (object :: any).Source = source end)
	if fallbackOk then return true, "ok" end
	return false, tostring(fallbackError or errorMessage)
end
local function applyCreateScript(target: string, content: string): (boolean, string)
	local segments = string.split(target, ".")
	local name = table.remove(segments)
	local parentPath = table.concat(segments, ".")
	if not name or name == "" or parentPath == "" then return false, "invalid create target" end
	local parent = findPath(parentPath)
	if not parent then return false, "parent not found: " .. parentPath end
	if parent:FindFirstChild(name) then return false, "already exists: " .. target end
	local scriptObject = Instance.new("Script"); scriptObject.Name = name; scriptObject.Parent = parent
	local ok, errorMessage = updateScript(scriptObject, content)
	if not ok then scriptObject:Destroy(); return false, "failed " .. target .. ": " .. errorMessage end
	return true, "created " .. target
end
local function applyProposal(proposal: {[string]: any}): (boolean, string)
	local operation, target, content = proposal.operation, proposal.target, proposal.content
	if typeof(operation) ~= "string" then return false, "missing operation" end
	if typeof(target) ~= "string" or target == "" then return false, "missing target" end
	if operation ~= "update_script" and operation ~= "create_script" then return false, "deferred operation: " .. operation end
	if typeof(content) ~= "string" then return false, "missing script content" end
	if operation == "update_script" then
		local object = findPath(target)
		if not object then return false, "script not found: " .. target end
		if not object:IsA("LuaSourceContainer") then return false, "target is not a script: " .. target end
		local ok, errorMessage = updateScript(object, content)
		if ok then return true, "updated " .. target end
		return false, "failed " .. target .. ": " .. errorMessage
	end
	return applyCreateScript(target, content)
end
local function applyPlan()
	if requestBusy then return end
	if typeof(currentPlan) ~= "table" or typeof(currentPlan.changes) ~= "table" then setStatus("Generate a plan before applying changes.", "bad"); return end
	local applicable, deferred = 0, 0
	for _, proposal in ipairs(currentPlan.changes) do
		if typeof(proposal) == "table" and (proposal.operation == "update_script" or proposal.operation == "create_script") then applicable += 1 else deferred += 1 end
	end
	if applicable == 0 then setStatus("This plan contains no automatically applicable script changes."); return end
	if not applyArmed then
		applyArmed = true; applyButton.Text = string.format("Confirm Apply (%d script change(s))", applicable)
		setStatus(string.format("Review the plan carefully. Click Apply again to make %d Studio change(s).", applicable)); return
	end
	applyArmed = false; applyButton.Text = "Applying…"; requestBusy = true; generateButton.Active = false; applyButton.Active = false
	ChangeHistoryService:SetWaypoint("LUA-X - Before Apply")
	local results: {string} = {}; local successful, failed = 0, 0
	for _, proposal in ipairs(currentPlan.changes) do
		if typeof(proposal) == "table" and (proposal.operation == "update_script" or proposal.operation == "create_script") then
			local ok, message = applyProposal(proposal)
			if ok then successful += 1; table.insert(results, "✓ " .. message) else failed += 1; table.insert(results, "✗ " .. message) end
		end
	end
	ChangeHistoryService:SetWaypoint("LUA-X - After Apply")
	requestBusy = false; generateButton.Active = true; applyButton.Active = true; applyButton.Text = "Apply Script Changes"; planBox.Text = table.concat(results, "\n")
	if failed == 0 then setStatus(string.format("Applied %d change(s) successfully. %d deferred operation(s) were left untouched.", successful, deferred), "good") else setStatus(string.format("Applied %d, failed %d, deferred %d. Studio Undo can revert the completed edits.", successful, failed, deferred), "bad") end
end
local function runLocalVerification()
	if requestBusy then return end
	local checks: {string} = {}; local selection = Selection:Get()
	table.insert(checks, "Selection count: " .. tostring(#selection))
	if typeof(currentPlan) == "table" and typeof(currentPlan.changes) == "table" then
		table.insert(checks, "Plan changes: " .. tostring(#currentPlan.changes)); local applicable = 0
		for _, proposal in ipairs(currentPlan.changes) do if typeof(proposal) == "table" and (proposal.operation == "update_script" or proposal.operation == "create_script") then applicable += 1 end end
		table.insert(checks, "Applicable script changes: " .. tostring(applicable))
	else table.insert(checks, "Plan present: no") end
	local scriptCount = 0
	for _, item in ipairs(selection) do
		if item:IsA("LuaSourceContainer") then scriptCount += 1 end
		for _, descendant in ipairs(item:GetDescendants()) do if descendant:IsA("LuaSourceContainer") then scriptCount += 1 end end
	end
	table.insert(checks, "Selected script containers: " .. tostring(scriptCount)); table.insert(checks, "Endpoint: " .. normalizeEndpoint(endpointBox.Text)); table.insert(checks, "HTTP access: requires Studio HTTP Requests permission")
	planBox.Text = table.concat(checks, "\n"); setStatus("Plugin-side verification complete. This does not claim your game passes runtime playtests.", "good")
end

Selection.SelectionChanged:Connect(function() if widget.Enabled then refreshContext() end end)
testConnectionButton.MouseButton1Click:Connect(testConnection)
saveEndpointButton.MouseButton1Click:Connect(function() saveConfiguredEndpoint(); setStatus("Endpoint saved for this plugin installation.", "good") end)
refreshButton.MouseButton1Click:Connect(refreshContext)
generateButton.MouseButton1Click:Connect(generatePlan)
applyButton.MouseButton1Click:Connect(applyPlan)
verifyButton.MouseButton1Click:Connect(runLocalVerification)
toolbarButton.Click:Connect(function() widget.Enabled = not widget.Enabled; if widget.Enabled then refreshContext() end end)
refreshContext()
