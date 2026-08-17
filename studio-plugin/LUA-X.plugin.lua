--!strict
-- LUA-X Roblox Studio Plugin
-- Install: place this file in Roblox Studio's local Plugins folder, then restart Studio.
-- The plugin talks to the LUA-X API; NVIDIA/API secrets stay on the server.

local HttpService = game:GetService("HttpService")
local Selection = game:GetService("Selection")
local ChangeHistoryService = game:GetService("ChangeHistoryService")
local ScriptEditorService = game:GetService("ScriptEditorService")
local StudioService = game:GetService("StudioService")

local PLUGIN_NAME = "LUA-X"
local DEFAULT_ENDPOINT = "https://lua-x-api.vercel.app/api/ai/generate"
local SETTINGS_KEY = "LUA_X_API_ENDPOINT"
local MAX_CONTEXT = 14000

local toolbar = plugin:CreateToolbar(PLUGIN_NAME)
local openButton = toolbar:CreateButton("LUA-X", "Open the LUA-X Roblox development studio", "rbxassetid://4458901886")
openButton.ClickableWhenViewportHidden = true

local widgetInfo = DockWidgetPluginGuiInfo.new(
    Enum.InitialDockState.Float,
    true,
    false,
    520,
    720,
    360,
    420
)

local widget = plugin:CreateDockWidgetPluginGui("LUAXStudio", widgetInfo)
widget.Title = "LUA-X Studio"
widget.Name = "LUA-X Studio"

local function make(className: string, props: {[string]: any}, parent: Instance?): Instance
    local object = Instance.new(className)
    for key, value in pairs(props) do
        object[key] = value
    end
    if parent then
        object.Parent = parent
    end
    return object
end

local root = make("ScrollingFrame", {
    Size = UDim2.fromScale(1, 1),
    CanvasSize = UDim2.new(0, 0, 0, 0),
    AutomaticCanvasSize = Enum.AutomaticSize.Y,
    ScrollBarThickness = 6,
    BackgroundColor3 = Color3.fromRGB(18, 20, 26),
    BorderSizePixel = 0,
}, widget) :: ScrollingFrame

local padding = make("UIPadding", {
    PaddingTop = UDim.new(0, 14),
    PaddingBottom = UDim.new(0, 14),
    PaddingLeft = UDim.new(0, 14),
    PaddingRight = UDim.new(0, 14),
}, root)

local layout = make("UIListLayout", {
    Padding = UDim.new(0, 10),
    SortOrder = Enum.SortOrder.LayoutOrder,
}, root)

local title = make("TextLabel", {
    Size = UDim2.new(1, 0, 0, 34),
    BackgroundTransparency = 1,
    Text = "LUA-X",
    Font = Enum.Font.GothamBold,
    TextSize = 25,
    TextColor3 = Color3.fromRGB(245, 247, 255),
    TextXAlignment = Enum.TextXAlignment.Left,
    LayoutOrder = 1,
}, root) :: TextLabel

local subtitle = make("TextLabel", {
    Size = UDim2.new(1, 0, 0, 40),
    BackgroundTransparency = 1,
    Text = "AI-native Roblox engineering · plan → build → review → apply",
    Font = Enum.Font.Gotham,
    TextSize = 13,
    TextWrapped = true,
    TextColor3 = Color3.fromRGB(166, 173, 190),
    TextXAlignment = Enum.TextXAlignment.Left,
    LayoutOrder = 2,
}, root) :: TextLabel

local endpointLabel = make("TextLabel", {
    Size = UDim2.new(1, 0, 0, 20),
    BackgroundTransparency = 1,
    Text = "LUA-X API endpoint",
    Font = Enum.Font.GothamMedium,
    TextSize = 12,
    TextColor3 = Color3.fromRGB(190, 197, 214),
    TextXAlignment = Enum.TextXAlignment.Left,
    LayoutOrder = 3,
}, root) :: TextLabel

local endpointBox = make("TextBox", {
    Size = UDim2.new(1, 0, 0, 38),
    BackgroundColor3 = Color3.fromRGB(29, 32, 41),
    BorderSizePixel = 0,
    ClearTextOnFocus = false,
    Font = Enum.Font.Code,
    TextSize = 12,
    TextColor3 = Color3.fromRGB(232, 235, 245),
    PlaceholderText = DEFAULT_ENDPOINT,
    TextXAlignment = Enum.TextXAlignment.Left,
    LayoutOrder = 4,
}, root) :: TextBox

local savedEndpoint = plugin:GetSetting(SETTINGS_KEY)
endpointBox.Text = if typeof(savedEndpoint) == "string" and savedEndpoint ~= "" then savedEndpoint else DEFAULT_ENDPOINT

local promptLabel = make("TextLabel", {
    Size = UDim2.new(1, 0, 0, 20),
    BackgroundTransparency = 1,
    Text = "What should LUA-X build or change?",
    Font = Enum.Font.GothamMedium,
    TextSize = 12,
    TextColor3 = Color3.fromRGB(190, 197, 214),
    TextXAlignment = Enum.TextXAlignment.Left,
    LayoutOrder = 5,
}, root) :: TextLabel

local promptBox = make("TextBox", {
    Size = UDim2.new(1, 0, 0, 120),
    BackgroundColor3 = Color3.fromRGB(29, 32, 41),
    BorderSizePixel = 0,
    ClearTextOnFocus = false,
    Font = Enum.Font.Gotham,
    TextSize = 13,
    TextColor3 = Color3.fromRGB(239, 242, 250),
    PlaceholderText = "Example: Add a sprint system to the selected character controller. Include cooldown, server validation, and tests.",
    TextWrapped = true,
    TextXAlignment = Enum.TextXAlignment.Left,
    TextYAlignment = Enum.TextYAlignment.Top,
    MultiLine = true,
    LayoutOrder = 6,
}, root) :: TextBox

local controls = make("Frame", {
    Size = UDim2.new(1, 0, 0, 38),
    BackgroundTransparency = 1,
    LayoutOrder = 7,
}, root) :: Frame

make("UIListLayout", {
    FillDirection = Enum.FillDirection.Horizontal,
    HorizontalAlignment = Enum.HorizontalAlignment.Left,
    VerticalAlignment = Enum.VerticalAlignment.Center,
    Padding = UDim.new(0, 8),
}, controls)

local generateButton = make("TextButton", {
    Size = UDim2.new(0.5, -4, 1, 0),
    BackgroundColor3 = Color3.fromRGB(72, 92, 255),
    BorderSizePixel = 0,
    Text = "Generate Plan",
    Font = Enum.Font.GothamBold,
    TextSize = 13,
    TextColor3 = Color3.fromRGB(255, 255, 255),
    LayoutOrder = 1,
}, controls) :: TextButton

local contextButton = make("TextButton", {
    Size = UDim2.new(0.5, -4, 1, 0),
    BackgroundColor3 = Color3.fromRGB(39, 43, 54),
    BorderSizePixel = 0,
    Text = "Refresh Context",
    Font = Enum.Font.GothamMedium,
    TextSize = 13,
    TextColor3 = Color3.fromRGB(235, 239, 250),
    LayoutOrder = 2,
}, controls) :: TextButton

local status = make("TextLabel", {
    Size = UDim2.new(1, 0, 0, 40),
    BackgroundTransparency = 1,
    Text = "Ready. Select a Script or Model, then describe the change.",
    Font = Enum.Font.Gotham,
    TextSize = 12,
    TextWrapped = true,
    TextColor3 = Color3.fromRGB(150, 158, 177),
    TextXAlignment = Enum.TextXAlignment.Left,
    LayoutOrder = 8,
}, root) :: TextLabel

local contextBox = make("TextBox", {
    Size = UDim2.new(1, 0, 0, 110),
    BackgroundColor3 = Color3.fromRGB(24, 27, 34),
    BorderSizePixel = 0,
    ClearTextOnFocus = false,
    Font = Enum.Font.Code,
    TextSize = 11,
    TextColor3 = Color3.fromRGB(201, 208, 223),
    Text = "No project context loaded.",
    TextWrapped = true,
    TextXAlignment = Enum.TextXAlignment.Left,
    TextYAlignment = Enum.TextYAlignment.Top,
    MultiLine = true,
    LayoutOrder = 9,
}, root) :: TextBox

local planLabel = make("TextLabel", {
    Size = UDim2.new(1, 0, 0, 24),
    BackgroundTransparency = 1,
    Text = "Plan Preview",
    Font = Enum.Font.GothamBold,
    TextSize = 14,
    TextColor3 = Color3.fromRGB(238, 241, 249),
    TextXAlignment = Enum.TextXAlignment.Left,
    LayoutOrder = 10,
}, root) :: TextLabel

local planBox = make("TextBox", {
    Size = UDim2.new(1, 0, 0, 250),
    BackgroundColor3 = Color3.fromRGB(24, 27, 34),
    BorderSizePixel = 0,
    ClearTextOnFocus = false,
    Font = Enum.Font.Code,
    TextSize = 11,
    TextColor3 = Color3.fromRGB(209, 216, 233),
    Text = "No plan yet.",
    TextWrapped = true,
    TextXAlignment = Enum.TextXAlignment.Left,
    TextYAlignment = Enum.TextYAlignment.Top,
    MultiLine = true,
    LayoutOrder = 11,
}, root) :: TextBox

local applyButton = make("TextButton", {
    Size = UDim2.new(1, 0, 0, 42),
    BackgroundColor3 = Color3.fromRGB(43, 154, 91),
    BorderSizePixel = 0,
    Text = "Apply Safe Script Changes",
    Font = Enum.Font.GothamBold,
    TextSize = 13,
    TextColor3 = Color3.fromRGB(255, 255, 255),
    LayoutOrder = 12,
}, root) :: TextButton

local selectedContext: {[string]: any} = {}
local currentPlan: {[string]: any}? = nil

local function setStatus(message: string, good: boolean?)
    status.Text = message
    status.TextColor3 = if good == true then Color3.fromRGB(109, 215, 143) elseif good == false then Color3.fromRGB(246, 122, 122) else Color3.fromRGB(150, 158, 177)
end

local function trim(text: string, maxLength: number): string
    if #text <= maxLength then return text end
    return string.sub(text, 1, maxLength) .. "\n… [truncated]"
end

local function getInstancePath(instance: Instance): string
    local parts = {}
    local current: Instance? = instance
    while current and current ~= game do
        table.insert(parts, 1, current.Name)
        current = current.Parent
    end
    return table.concat(parts, ".")
end

local function safeReadSource(scriptObject: LuaSourceContainer): string?
    local ok, result = pcall(function()
        return ScriptEditorService:UpdateSourceAsync(scriptObject, function(source)
            return source
        end)
    end)
    if ok and typeof(result) == "string" then
        return result
    end

    local okSource, source = pcall(function()
        return scriptObject.Source
    end)
    if okSource and typeof(source) == "string" then
        return source
    end
    return nil
end

local function loadContext()
    local selected = Selection:Get()
    local relevantFiles = {}
    local relevantInstances = {}
    local architectureParts = {}

    for _, item in ipairs(selected) do
        table.insert(relevantInstances, getInstancePath(item))
        if item:IsA("LuaSourceContainer") then
            table.insert(relevantFiles, getInstancePath(item))
            local source = safeReadSource(item)
            if source then
                table.insert(architectureParts, "-- " .. getInstancePath(item) .. "\n" .. trim(source, 5000))
            end
        end
    end

    selectedContext = {
        relevantFiles = relevantFiles,
        relevantInstances = relevantInstances,
        architecture = trim(table.concat(architectureParts, "\n\n"), MAX_CONTEXT),
        constraints = {
            "LUA-X Studio plugin",
            "Do not expose provider API keys in Studio",
            "Prefer reversible, reviewable script changes",
        },
    }

    local pieces = {
        "Selected instances:",
        if #relevantInstances > 0 then table.concat(relevantInstances, "\n") else "(none)",
    }
    if #architectureParts > 0 then
        table.insert(pieces, "\nSelected script context:\n" .. trim(table.concat(architectureParts, "\n\n"), 8000))
    end

    contextBox.Text = table.concat(pieces, "\n")
    setStatus(string.format("Context refreshed: %d selection(s), %d script(s).", #relevantInstances, #relevantFiles), true)
end

local function requestPlan()
    local endpoint = endpointBox.Text:gsub("%s+$", "")
    if endpoint == "" then
        endpoint = DEFAULT_ENDPOINT
        endpointBox.Text = endpoint
    end
    plugin:SetSetting(SETTINGS_KEY, endpoint)

    local prompt = promptBox.Text:gsub("^%s+", ""):gsub("%s+$", "")
    if #prompt < 2 then
        setStatus("Enter a real build/change request first.", false)
        return
    end

    loadContext()
    setStatus("LUA-X is planning the change…", nil)
    generateButton.Active = false
    applyButton.Active = false

    local body = {
        prompt = prompt,
        projectId = tostring(game.PlaceId),
        context = selectedContext,
    }

    local ok, response = pcall(function()
        return HttpService:RequestAsync({
            Url = endpoint,
            Method = "POST",
            Headers = {
                ["Content-Type"] = "application/json",
                ["Accept"] = "application/json",
            },
            Body = HttpService:JSONEncode(body),
        })
    end)

    generateButton.Active = true
    applyButton.Active = true

    if not ok then
        setStatus("Request failed: " .. tostring(response), false)
        return
    end

    if not response.Success then
        setStatus(string.format("API error %d: %s", response.StatusCode, trim(response.StatusMessage or response.Body or "Unknown error", 220)), false)
        return
    end

    local decodedOk, decoded = pcall(function()
        return HttpService:JSONDecode(response.Body)
    end)
    if not decodedOk or typeof(decoded) ~= "table" then
        setStatus("LUA-X returned invalid JSON.", false)
        return
    end

    if decoded.error then
        setStatus("LUA-X: " .. tostring(decoded.error), false)
        return
    end

    currentPlan = decoded.plan
    if typeof(currentPlan) ~= "table" then
        setStatus("LUA-X response did not contain a valid plan.", false)
        return
    end

    planBox.Text = HttpService:JSONEncode(currentPlan)
    setStatus("Plan ready. Review it, then apply safe script changes.", true)
end

local function findByPath(path: string): Instance?
    local parts = string.split(path, ".")
    if #parts == 0 then return nil end

    local current: Instance = game
    for _, part in ipairs(parts) do
        local nextChild = current:FindFirstChild(part)
        if not nextChild then
            return nil
        end
        current = nextChild
    end
    return current
end

local function applyScriptProposal(proposal: {[string]: any}): (boolean, string)
    local operation = proposal.operation
    local target = proposal.target
    local content = proposal.content

    if typeof(target) ~= "string" or target == "" then
        return false, "Missing change target."
    end

    if operation ~= "update_script" and operation ~= "create_script" then
        return false, "Only script mutations are automatically applicable in this plugin build: " .. tostring(operation)
    end

    if typeof(content) ~= "string" then
        return false, "Script change has no content: " .. target
    end

    if operation == "update_script" then
        local existing = findByPath(target)
        if not existing or not existing:IsA("LuaSourceContainer") then
            return false, "Script not found: " .. target
        end

        local ok, err = pcall(function()
            ScriptEditorService:UpdateSourceAsync(existing, function()
                return content
            end)
        end)
        if not ok then
            return false, "Failed to update " .. target .. ": " .. tostring(err)
        end
        return true, "Updated " .. target
    end

    local parts = string.split(target, ".")
    local scriptName = table.remove(parts)
    if not scriptName or scriptName == "" then
        return false, "Invalid create_script target: " .. target
    end
    local parent = findByPath(table.concat(parts, "."))
    if not parent then
        return false, "Parent not found for " .. target
    end
    if parent:FindFirstChild(scriptName) then
        return false, "Target already exists: " .. target
    end

    local scriptObject = Instance.new("Script")
    scriptObject.Name = scriptName
    scriptObject.Parent = parent
    local ok, err = pcall(function()
        ScriptEditorService:UpdateSourceAsync(scriptObject, function()
            return content
        end)
    end)
    if not ok then
        scriptObject:Destroy()
        return false, "Failed to create " .. target .. ": " .. tostring(err)
    end
    return true, "Created " .. target
end

local function applyPlan()
    if typeof(currentPlan) ~= "table" or typeof(currentPlan.changes) ~= "table" then
        setStatus("Generate a plan before applying changes.", false)
        return
    end

    local changes = currentPlan.changes
    local automatic = {}
    local deferred = {}
    for _, proposal in ipairs(changes) do
        if typeof(proposal) == "table" and (proposal.operation == "update_script" or proposal.operation == "create_script") then
            table.insert(automatic, proposal)
        else
            table.insert(deferred, proposal)
        end
    end

    if #automatic == 0 then
        setStatus("No safely applicable script changes were proposed. Review the plan above.", nil)
        return
    end

    local confirmed = StudioService:PromptSaveSelection()
    if confirmed == nil then
        -- PromptSaveSelection returns a tuple on some Studio versions; if unavailable, continue below.
    end

    local yes = false
    local okConfirm, result = pcall(function()
        return StudioService:PromptSaveSelection()
    end)
    if okConfirm and result == Enum.PromptSaveResult.Saved then
        yes = true
    elseif okConfirm and result == Enum.PromptSaveResult.Cancelled then
        yes = false
    else
        -- The save-selection prompt is not used as an authorization gate. The plugin's visible Apply button is.
        yes = true
    end

    if not yes then
        setStatus("Apply cancelled.", nil)
        return
    end

    ChangeHistoryService:SetWaypoint("LUA-X: Before Apply")
    local messages = {}
    local successCount = 0
    local failureCount = 0

    for _, proposal in ipairs(automatic) do
        local ok, message = applyScriptProposal(proposal)
        table.insert(messages, (if ok then "✓ " else "✗ ") .. message)
        if ok then successCount += 1 else failureCount += 1 end
    end

    ChangeHistoryService:SetWaypoint("LUA-X: After Apply")
    if #deferred > 0 then
        table.insert(messages, string.format("%d non-script change(s) left for manual review.", #deferred))
    end

    planBox.Text = table.concat(messages, "\n") .. "\n\n" .. planBox.Text
    setStatus(string.format("Applied %d script change(s); %d failed; %d deferred.", successCount, failureCount, #deferred), failureCount == 0)
end

openButton.Click:Connect(function()
    widget.Enabled = not widget.Enabled
    if widget.Enabled then
        loadContext()
    end
end)

generateButton.MouseButton1Click:Connect(requestPlan)
contextButton.MouseButton1Click:Connect(loadContext)
applyButton.MouseButton1Click:Connect(applyPlan)

Selection.SelectionChanged:Connect(function()
    if widget.Enabled then
        loadContext()
    end
end)

widget.Enabled = false
loadContext()
