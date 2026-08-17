-- LUA-X Chat Plugin
-- A simple chat interface connecting Roblox Studio to the LUA-X backend.
-- Local-plugin entrypoint. The toolbar is created first so backend/UI errors cannot hide the plugin.

local HttpService = game:GetService("HttpService")

local DEFAULT_ENDPOINT = "https://lua-x-api.vercel.app/api/ai/generate"
local SETTINGS_KEY = "LUA_X_API_ENDPOINT"
local MAX_PROMPT = 12000
local MAX_RESPONSE = 12000

-- IMPORTANT: create the toolbar before any widget/network initialization.
local toolbar = plugin:CreateToolbar("LUA-X")
local toolbarButton = toolbar:CreateButton(
	"LUA-X",
	"Open LUA-X Chat",
	"rbxassetid://14978048121"
)
toolbarButton.ClickableWhenViewportHidden = true

local widget = nil
local statusLabel = nil
local endpointBox = nil
local chatList = nil
local inputBox = nil
local sendButton = nil
local busy = false

local function ui(className, properties, parent)
	local object = Instance.new(className)
	for key, value in pairs(properties or {}) do
		object[key] = value
	end
	object.Parent = parent
	return object
end

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

local function saveEndpoint()
	local endpoint = normalizeEndpoint(endpointBox.Text)
	endpointBox.Text = endpoint
	plugin:SetSetting(SETTINGS_KEY, endpoint)
	return endpoint
end

local function addMessage(text, kind)
	local isUser = kind == "user"
	local isError = kind == "error"

	local row = ui("Frame", {
		Size = UDim2.new(1, 0, 0, 0),
		AutomaticSize = Enum.AutomaticSize.Y,
		BackgroundTransparency = 1,
	}, chatList)

	local bubble = ui("Frame", {
		AnchorPoint = isUser and Vector2.new(1, 0) or Vector2.new(0, 0),
		Position = isUser and UDim2.new(1, 0, 0, 0) or UDim2.new(0, 0, 0, 0),
		Size = UDim2.new(0.85, 0, 0, 0),
		AutomaticSize = Enum.AutomaticSize.Y,
		BackgroundColor3 = isError and Color3.fromRGB(120, 44, 44) or (isUser and Color3.fromRGB(62, 78, 214) or Color3.fromRGB(30, 34, 44)),
		BorderSizePixel = 0,
	}, row)
	ui("UICorner", { CornerRadius = UDim.new(0, 12) }, bubble)
	ui("UIPadding", {
		PaddingTop = UDim.new(0, 8),
		PaddingBottom = UDim.new(0, 8),
		PaddingLeft = UDim.new(0, 12),
		PaddingRight = UDim.new(0, 12),
	}, bubble)
	ui("TextLabel", {
		Size = UDim2.new(1, 0, 0, 0),
		AutomaticSize = Enum.AutomaticSize.Y,
		BackgroundTransparency = 1,
		Text = trim(text, MAX_RESPONSE),
		Font = isUser and Enum.Font.Gotham or Enum.Font.Code,
		TextSize = isUser and 13 or 12,
		TextColor3 = Color3.fromRGB(238, 241, 250),
		TextXAlignment = Enum.TextXAlignment.Left,
		TextYAlignment = Enum.TextYAlignment.Top,
		TextWrapped = true,
	}, bubble)

	task.defer(function()
		if chatList and chatList:IsDescendantOf(game) then
			chatList.CanvasPosition = Vector2.new(0, chatList.AbsoluteCanvasSize.Y)
		end
	end)
end

local function sendMessage()
	if busy then
		return
	end
	local prompt = tostring(inputBox.Text or ""):gsub("^%s+", ""):gsub("%s+$", "")
	if #prompt < 2 then
		setStatus("Type a message first.", "bad")
		return
	end
	if #prompt > MAX_PROMPT then
		setStatus("Message is too long.", "bad")
		return
	end

	local endpoint = saveEndpoint()
	addMessage(prompt, "user")
	inputBox.Text = ""
	busy = true
	sendButton.Text = "…"
	setStatus("LUA-X is thinking…")

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
				mode = "chat",
			}),
		})
	end)

	busy = false
	sendButton.Text = "Send"

	if not ok then
		addMessage("Request failed. Enable HTTP requests in Studio security settings and check the endpoint.", "error")
		setStatus("Request failed. See Studio Output for details.", "bad")
		warn("LUA-X chat error:", response)
		return
	end
	if not response.Success then
		addMessage("Backend " .. tostring(response.StatusCode) .. ": " .. trim(response.Body or response.StatusMessage, 400), "error")
		setStatus("Backend " .. tostring(response.StatusCode), "bad")
		return
	end

	local decodeOk, body = pcall(function()
		return HttpService:JSONDecode(response.Body)
	end)
	if not decodeOk or type(body) ~= "table" then
		addMessage("LUA-X returned an invalid response.", "error")
		setStatus("Invalid backend response.", "bad")
		return
	end
	if body.error then
		addMessage("LUA-X: " .. tostring(body.error), "error")
		setStatus("Backend error.", "bad")
		return
	end

	local reply = type(body.response) == "string" and body.response or nil
	if not reply then
		reply = type(body.plan) == "table" and type(body.plan.summary) == "string"
			and body.plan.summary
			or "No response from backend."
	end
	addMessage(reply, "assistant")
	setStatus("LUA-X is online.", "good")
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
		setStatus("Connection failed. Enable HTTP requests and check the endpoint.", "bad")
		warn("LUA-X connection error:", response)
		return
	end
	if not response.Success then
		setStatus("Backend " .. tostring(response.StatusCode) .. ": " .. trim(response.Body or response.StatusMessage, 220), "bad")
		return
	end
	setStatus("LUA-X backend is reachable.", "good")
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
		return plugin:CreateDockWidgetPluginGuiAsync("LUAXChat", info)
	end)
	if ok then
		widget = result
	else
		local legacyOk, legacyResult = pcall(function()
			return plugin:CreateDockWidgetPluginGui("LUAXChat", info)
		end)
		if not legacyOk then
			warn("LUA-X widget creation failed:", result, legacyResult)
			return false
		end
		widget = legacyResult
	end

	widget.Title = "LUA-X Chat"

	local root = ui("Frame", {
		Size = UDim2.new(1, 1),
		BackgroundColor3 = Color3.fromRGB(17, 19, 25),
		BorderSizePixel = 0,
	}, widget)
	ui("UIPadding", {
		PaddingTop = UDim.new(0, 10),
		PaddingBottom = UDim.new(0, 10),
		PaddingLeft = UDim.new(0, 10),
		PaddingRight = UDim.new(0, 10),
	}, root)
	ui("UIListLayout", { Padding = UDim.new(0, 8) }, root)

	-- Header: title + connection status
	local header = ui("Frame", { Size = UDim2.new(1, 0, 0, 36), BackgroundTransparency = 1 }, root)
	ui("TextLabel", {
		Size = UDim2.new(0.6, 0, 1, 0),
		BackgroundTransparency = 1,
		Text = "LUA-X Chat",
		Font = Enum.Font.GothamBold,
		TextSize = 18,
		TextColor3 = Color3.fromRGB(245, 247, 255),
		TextXAlignment = Enum.TextXAlignment.Left,
	}, header)
	statusLabel = ui("TextLabel", {
		Size = UDim2.new(0.4, 0, 1, 0),
		BackgroundTransparency = 1,
		Text = "LUA-X loaded successfully.",
		Font = Enum.Font.Gotham,
		TextSize = 11,
		TextWrapped = true,
		TextColor3 = Color3.fromRGB(105, 215, 143),
		TextXAlignment = Enum.TextXAlignment.Right,
	}, header)

	-- Endpoint row
	local endpointRow = ui("Frame", { Size = UDim2.new(1, 0, 0, 36), BackgroundTransparency = 1 }, root)
	endpointBox = ui("TextBox", {
		Size = UDim2.new(0.78, -4, 1, 0),
		BackgroundColor3 = Color3.fromRGB(29, 32, 41),
		BorderSizePixel = 0,
		ClearTextOnFocus = false,
		Font = Enum.Font.Code,
		TextSize = 11,
		TextColor3 = Color3.fromRGB(232, 235, 245),
		TextXAlignment = Enum.TextXAlignment.Left,
	}, endpointRow)
	local saved = plugin:GetSetting(SETTINGS_KEY)
	endpointBox.Text = type(saved) == "string" and saved ~= "" and saved or DEFAULT_ENDPOINT
	local testButton = ui("TextButton", {
		Size = UDim2.new(0.22, -4, 1, 0),
		Position = UDim2.new(0.78, 0, 0, 0),
		BackgroundColor3 = Color3.fromRGB(39, 43, 54),
		BorderSizePixel = 0,
		Text = "Test",
		Font = Enum.Font.GothamMedium,
		TextSize = 12,
		TextColor3 = Color3.fromRGB(235, 239, 250),
	}, endpointRow)

	-- Chat area
	chatList = ui("ScrollingFrame", {
		Size = UDim2.new(1, 0, 1, -176),
		Position = UDim2.new(0, 0, 0, 0),
		BackgroundColor3 = Color3.fromRGB(23, 26, 33),
		BorderSizePixel = 0,
		ScrollBarThickness = 6,
		CanvasSize = UDim2.new(),
		AutomaticCanvasSize = Enum.AutomaticSize.Y,
	}, root)
	ui("UIPadding", {
		PaddingTop = UDim.new(0, 10),
		PaddingBottom = UDim.new(0, 10),
		PaddingLeft = UDim.new(0, 6),
		PaddingRight = UDim.new(0, 6),
	}, chatList)
	ui("UIListLayout", { Padding = UDim.new(0, 8) }, chatList)

	-- Input row
	local inputRow = ui("Frame", { Size = UDim2.new(1, 0, 0, 54), BackgroundTransparency = 1 }, root)
	inputBox = ui("TextBox", {
		Size = UDim2.new(1, -62, 1, 0),
		BackgroundColor3 = Color3.fromRGB(29, 32, 41),
		BorderSizePixel = 0,
		ClearTextOnFocus = false,
		Font = Enum.Font.Gotham,
		TextSize = 13,
		TextColor3 = Color3.fromRGB(239, 242, 250),
		PlaceholderText = "Ask LUA-X… (Enter to send)",
		TextWrapped = true,
		TextXAlignment = Enum.TextXAlignment.Left,
		TextYAlignment = Enum.TextYAlignment.Top,
	}, inputRow)
	sendButton = ui("TextButton", {
		Size = UDim2.new(0, 54, 1, 0),
		Position = UDim2.new(1, -54, 0, 0),
		BackgroundColor3 = Color3.fromRGB(72, 92, 255),
		BorderSizePixel = 0,
		Text = "Send",
		Font = Enum.Font.GothamBold,
		TextSize = 13,
		TextColor3 = Color3.fromRGB(255, 255, 255),
	}, inputRow)

	testButton.MouseButton1Click:Connect(testConnection)
	sendButton.MouseButton1Click:Connect(sendMessage)
	inputBox.FocusLost:Connect(function(enterPressed)
		if enterPressed then
			sendMessage()
		end
	end)

	addMessage("Hi, I'm LUA-X. Ask me to write Luau code, design a Roblox system, or solve a scripting problem.", "assistant")
	setStatus("LUA-X loaded. Backend: " .. DEFAULT_ENDPOINT, "good")
	return true
end

toolbarButton.Click:Connect(function()
	if not buildWidget() then
		return
	end
	widget.Enabled = not widget.Enabled
end)

-- Nothing network-related runs during plugin startup.
print("[LUA-X] Studio chat plugin loaded. Click the LUA-X button in Plugins to open it.")
