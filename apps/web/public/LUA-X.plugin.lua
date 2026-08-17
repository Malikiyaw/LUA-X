--!strict
-- LUA-X Roblox Studio plugin
-- Place this file in the Roblox Studio Plugins folder, then restart Studio.
-- API/provider secrets stay on the LUA-X backend.

local HttpService = game:GetService("HttpService")
local Selection = game:GetService("Selection")
local ChangeHistoryService = game:GetService("ChangeHistoryService")
local ScriptEditorService = game:GetService("ScriptEditorService")

local DEFAULT_ENDPOINT = "https://lua-x-api.vercel.app/api/ai/generate"
local SETTINGS_KEY = "LUA_X_API_ENDPOINT"
local MAX_CONTEXT = 14000

local toolbar = plugin:CreateToolbar("LUA-X")
local button = toolbar:CreateButton("LUA-X", "Open LUA-X Studio", "rbxassetid://0")
button.ClickableWhenViewportHidden = true

local widget = plugin:CreateDockWidgetPluginGui(
	"LUAXStudio",
	DockWidgetPluginGuiInfo.new(Enum.InitialDockState.Float, true, false, 520, 720, 360, 420)
)
widget.Title = "LUA-X Studio"

local function ui(className: string, props: {[string]: any}, parent: Instance): Instance
	local object = Instance.new(className)
	for key, value in pairs(props) do object[key] = value end
	object.Parent = parent
	return object
end

local root = ui("ScrollingFrame", {
	Size = UDim2.fromScale(1, 1), CanvasSize = UDim2.new(), AutomaticCanvasSize = Enum.AutomaticSize.Y,
	ScrollBarThickness = 6, BackgroundColor3 = Color3.fromRGB(18, 20, 26), BorderSizePixel = 0,
}, widget) :: ScrollingFrame
ui("UIPadding", {PaddingTop = UDim.new(0, 14), PaddingBottom = UDim.new(0, 14), PaddingLeft = UDim.new(0, 14), PaddingRight = UDim.new(0, 14)}, root)
ui("UIListLayout", {Padding = UDim.new(0, 10), SortOrder = Enum.SortOrder.LayoutOrder}, root)

ui("TextLabel", {
	Size = UDim2.new(1, 0, 0, 34), BackgroundTransparency = 1, Text = "LUA-X",
	Font = Enum.Font.GothamBold, TextSize = 25, TextColor3 = Color3.fromRGB(245, 247, 255),
	TextXAlignment = Enum.TextXAlignment.Left, LayoutOrder = 1,
}, root)
ui("TextLabel", {
	Size = UDim2.new(1, 0, 0, 38), BackgroundTransparency = 1,
	Text = "AI-native Roblox engineering · understand → plan → build → verify",
	Font = Enum.Font.Gotham, TextSize = 13, TextWrapped = true, TextColor3 = Color3.fromRGB(166, 173, 190),
	TextXAlignment = Enum.TextXAlignment.Left, LayoutOrder = 2,
}, root)
ui("TextLabel", {
	Size = UDim2.new(1, 0, 0, 20), BackgroundTransparency = 1, Text = "Backend endpoint",
	Font = Enum.Font.GothamMedium, TextSize = 12, TextColor3 = Color3.fromRGB(190, 197, 214),
	TextXAlignment = Enum.TextXAlignment.Left, LayoutOrder = 3,
}, root)

local endpoint = ui("TextBox", {
	Size = UDim2.new(1, 0, 0, 38), BackgroundColor3 = Color3.fromRGB(29, 32, 41), BorderSizePixel = 0,
	ClearTextOnFocus = false, Font = Enum.Font.Code, TextSize = 12, TextColor3 = Color3.fromRGB(232, 235, 245),
	TextXAlignment = Enum.TextXAlignment.Left, LayoutOrder = 4,
}, root) :: TextBox
local savedEndpoint = plugin:GetSetting(SETTINGS_KEY)
endpoint.Text = if typeof(savedEndpoint) == "string" and savedEndpoint ~= "" then savedEndpoint else DEFAULT_ENDPOINT

ui("TextLabel", {
	Size = UDim2.new(1, 0, 0, 20), BackgroundTransparency = 1, Text = "Describe the change",
	Font = Enum.Font.GothamMedium, TextSize = 12, TextColor3 = Color3.fromRGB(190, 197, 214),
	TextXAlignment = Enum.TextXAlignment.Left, LayoutOrder = 5,
}, root)
local prompt = ui("TextBox", {
	Size = UDim2.new(1, 0, 0, 120), BackgroundColor3 = Color3.fromRGB(29, 32, 41), BorderSizePixel = 0,
	ClearTextOnFocus = false, Font = Enum.Font.Gotham, TextSize = 13, TextColor3 = Color3.fromRGB(239, 242, 250),
	PlaceholderText = "Example: Add a sprint system to the selected controller with server validation and tests.",
	TextWrapped = true, TextXAlignment = Enum.TextXAlignment.Left, TextYAlignment = Enum.TextYAlignment.Top,
	MultiLine = true, LayoutOrder = 6,
}, root) :: TextBox

local controls = ui("Frame", {Size = UDim2.new(1, 0, 0, 38), BackgroundTransparency = 1, LayoutOrder = 7}, root) :: Frame
ui("UIListLayout", {FillDirection = Enum.FillDirection.Horizontal, HorizontalAlignment = Enum.HorizontalAlignment.Left, VerticalAlignment = Enum.VerticalAlignment.Center, Padding = UDim.new(0, 8)}, controls)
local generate = ui("TextButton", {
	Size = UDim2.new(0.5, -4, 1, 0), BackgroundColor3 = Color3.fromRGB(72, 92, 255), BorderSizePixel = 0,
	Text = "Generate Plan", Font = Enum.Font.GothamBold, TextSize = 13, TextColor3 = Color3.fromRGB(255, 255, 255), LayoutOrder = 1,
}, controls) :: TextButton
local refresh = ui("TextButton", {
	Size = UDim2.new(0.5, -4, 1, 0), BackgroundColor3 = Color3.fromRGB(39, 43, 54), BorderSizePixel = 0,
	Text = "Refresh Context", Font = Enum.Font.GothamMedium, TextSize = 13, TextColor3 = Color3.fromRGB(235, 239, 250), LayoutOrder = 2,
}, controls) :: TextButton

local status = ui("TextLabel", {
	Size = UDim2.new(1, 0, 0, 40), BackgroundTransparency = 1,
	Text = "Ready. Select scripts/models, then describe the change.", Font = Enum.Font.Gotham, TextSize = 12,
	TextWrapped = true, TextColor3 = Color3.fromRGB(150, 158, 177), TextXAlignment = Enum.TextXAlignment.Left, LayoutOrder = 8,
}, root) :: TextLabel
local contextBox = ui("TextBox", {
	Size = UDim2.new(1, 0, 0, 140), BackgroundColor3 = Color3.fromRGB(24, 27, 34), BorderSizePixel = 0,
	ClearTextOnFocus = false, Font = Enum.Font.Code, TextSize = 11, TextColor3 = Color3.fromRGB(201, 208, 223),
	Text = "No project context loaded.", TextWrapped = true, TextXAlignment = Enum.TextXAlignment.Left, TextYAlignment = Enum.TextYAlignment.Top,
	MultiLine = true, LayoutOrder = 9,
}, root) :: TextBox
ui("TextLabel", {
	Size = UDim2.new(1, 0, 0, 24), BackgroundTransparency = 1, Text = "Plan Preview", Font = Enum.Font.GothamBold,
	TextSize = 14, TextColor3 = Color3.fromRGB(238, 241, 249), TextXAlignment = Enum.TextXAlignment.Left, LayoutOrder = 10,
}, root)
local planBox = ui("TextBox", {
	Size = UDim2.new(1, 0, 0, 260), BackgroundColor3 = Color3.fromRGB(24, 27, 34), BorderSizePixel = 0,
	ClearTextOnFocus = false, Font = Enum.Font.Code, TextSize = 11, TextColor3 = Color3.fromRGB(209, 216, 233),
	Text = "No plan yet.", TextWrapped = true, TextXAlignment = Enum.TextXAlignment.Left, TextYAlignment = Enum.TextYAlignment.Top,
	MultiLine = true, LayoutOrder = 11,
}, root) :: TextBox
local apply = ui("TextButton", {
	Size = UDim2.new(1, 0, 0, 42), BackgroundColor3 = Color3.fromRGB(43, 154, 91), BorderSizePixel = 0,
	Text = "Apply Script Changes", Font = Enum.Font.GothamBold, TextSize = 13, TextColor3 = Color3.fromRGB(255, 255, 255), LayoutOrder = 12,
}, root) :: TextButton

local selectedContext: {[string]: any} = {}
local currentPlan: {[string]: any}? = nil

local function setStatus(text: string, state: string?)
	status.Text = text
	status.TextColor3 = if state == "good" then Color3.fromRGB(109, 215, 143) elseif state == "bad" then Color3.fromRGB(246, 122, 122) else Color3.fromRGB(150, 158, 177)
end
local function trim(text: string, maxLength: number): string
	if #text <= maxLength then return text end
	return string.sub(text, 1, maxLength) .. "\n… [truncated]"
end
local function pathOf(instance: Instance): string
	local parts = {}
	local current: Instance? = instance
	while current and current ~= game do table.insert(parts, 1, current.Name); current = current.Parent end
	return table.concat(parts, ".")
end
local function readSource(object: LuaSourceContainer): string?
	local ok, source = pcall(function() return object.Source end)
	if ok and typeof(source) == "string" then return source end
	local okUpdate, result = pcall(function() return ScriptEditorService:UpdateSourceAsync(object, function(existing) return existing end) end)
	if okUpdate and typeof(result) == "string" then return result end
	return nil
end

local function refreshContext()
	local files, instances, snippets = {}, {}, {}
	for _, item in ipairs(Selection:Get()) do
		local itemPath = pathOf(item)
		table.insert(instances, itemPath)
		if item:IsA("LuaSourceContainer") then
			table.insert(files, itemPath)
			local source = readSource(item)
			if source then table.insert(snippets, "-- " .. itemPath .. "\n" .. trim(source, 5000)) end
		end
	end
	selectedContext = {
		relevantFiles = files,
		relevantInstances = instances,
		architecture = trim(table.concat(snippets, "\n\n"), MAX_CONTEXT),
		constraints = {"LUA-X Studio plugin", "Never expose provider API keys in Studio", "Prefer reversible and reviewable changes"},
	}
	contextBox.Text = "Selected instances:\n" .. (#instances > 0 and table.concat(instances, "\n") or "(none)")
	if #snippets > 0 then contextBox.Text ..= "\n\nSelected source:\n" .. trim(table.concat(snippets, "\n\n"), 9000) end
	setStatus(string.format("Context refreshed: %d selection(s), %d script(s).", #instances, #files), "good")
end

local function generatePlan()
	local api = endpoint.Text:gsub("%s+$", "")
	if api == "" then api = DEFAULT_ENDPOINT end
	endpoint.Text = api
	plugin:SetSetting(SETTINGS_KEY, api)
	local requestText = prompt.Text:gsub("^%s+", ""):gsub("%s+$", "")
	if #requestText < 2 then setStatus("Describe the change first.", "bad"); return end

	refreshContext()
	setStatus("LUA-X is planning the change…")
	generate.Active = false
	apply.Active = false
	local ok, response = pcall(function()
		return HttpService:RequestAsync({
			Url = api, Method = "POST",
			Headers = {["Content-Type"] = "application/json", ["Accept"] = "application/json"},
			Body = HttpService:JSONEncode({prompt = requestText, projectId = tostring(game.PlaceId), context = selectedContext}),
		})
	end)
	generate.Active = true
	apply.Active = true
	if not ok then setStatus("Request failed: " .. tostring(response), "bad"); return end
	if not response.Success then
		setStatus("API " .. tostring(response.StatusCode) .. ": " .. trim(response.Body or response.StatusMessage or "unknown error", 220), "bad")
		return
	end
	local decodedOk, decoded = pcall(function() return HttpService:JSONDecode(response.Body) end)
	if not decodedOk or typeof(decoded) ~= "table" then setStatus("Invalid JSON returned by LUA-X.", "bad"); return end
	if decoded.error then setStatus("LUA-X: " .. tostring(decoded.error), "bad"); return end
	if typeof(decoded.plan) ~= "table" then setStatus("Response did not contain a valid plan.", "bad"); return end
	currentPlan = decoded.plan
	planBox.Text = HttpService:JSONEncode(currentPlan)
	setStatus("Plan ready. Review it before applying.", "good")
end

local function findPath(path: string): Instance?
	local current: Instance = game
	for _, part in ipairs(string.split(path, ".")) do
		local child = current:FindFirstChild(part)
		if not child then return nil end
		current = child
	end
	return current
end
local function updateScript(object: LuaSourceContainer, source: string): (boolean, string)
	local ok, err = pcall(function() ScriptEditorService:UpdateSourceAsync(object, function() return source end) end)
	return ok, if ok then "ok" else tostring(err)
end
local function applyProposal(proposal: {[string]: any}): (boolean, string)
	local op, target, content = proposal.operation, proposal.target, proposal.content
	if typeof(target) ~= "string" or target == "" then return false, "missing target" end
	if op ~= "update_script" and op ~= "create_script" then return false, "deferred: " .. tostring(op) end
	if typeof(content) ~= "string" then return false, "missing script content" end
	if op == "update_script" then
		local object = findPath(target)
		if not object or not object:IsA("LuaSourceContainer") then return false, "script not found: " .. target end
		local ok, err = updateScript(object, content)
		return ok, if ok then "updated " .. target else "failed " .. target .. ": " .. err
	end
	local parts = string.split(target, ".")
	local name = table.remove(parts)
	local parent = findPath(table.concat(parts, "."))
	if not name or name == "" or not parent then return false, "invalid create target: " .. target end
	if parent:FindFirstChild(name) then return false, "already exists: " .. target end
	local scriptObject = Instance.new("Script")
	scriptObject.Name = name
	scriptObject.Parent = parent
	local ok, err = updateScript(scriptObject, content)
	if not ok then scriptObject:Destroy(); return false, "failed " .. target .. ": " .. err end
	return true, "created " .. target
end

local function applyPlan()
	if typeof(currentPlan) ~= "table" or typeof(currentPlan.changes) ~= "table" then setStatus("Generate a plan before applying changes.", "bad"); return end
	local scriptChanges, deferred = {}, 0
	for _, proposal in ipairs(currentPlan.changes) do
		if typeof(proposal) == "table" and (proposal.operation == "update_script" or proposal.operation == "create_script") then table.insert(scriptChanges, proposal) else deferred += 1 end
	end
	if #scriptChanges == 0 then setStatus("No automatically applicable script changes were proposed."); return end

	ChangeHistoryService:SetWaypoint("LUA-X - Before Apply")
	local results, failed = {}, 0
	for _, proposal in ipairs(scriptChanges) do
		local ok, message = applyProposal(proposal)
		if not ok then failed += 1 end
		table.insert(results, (if ok then "✓ " else "✗ ") .. message)
	end
	ChangeHistoryService:SetWaypoint("LUA-X - After Apply")
	planBox.Text = table.concat(results, "\n") .. "\n\n" .. planBox.Text
	setStatus(string.format("Applied %d script change(s); %d failed; %d deferred.", #scriptChanges, failed, deferred), if failed == 0 then "good" else "bad")
end

button.Click:Connect(function() widget.Enabled = not widget.Enabled; if widget.Enabled then refreshContext() end end)
generate.MouseButton1Click:Connect(generatePlan)
refresh.MouseButton1Click:Connect(refreshContext)
apply.MouseButton1Click:Connect(applyPlan)
Selection.SelectionChanged:Connect(function() if widget.Enabled then refreshContext() end end)
widget.Enabled = false
refreshContext()
