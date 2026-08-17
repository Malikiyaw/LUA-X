-- LUA-X Studio Plugin — v0.12.0-studio
-- Bridges Roblox Studio to the LUA-X backend so the website can see
-- whether your Studio session is online. The real chat lives on the
-- website; this plugin keeps the connection alive and answers pings.

local HttpService = game:GetService("HttpService")
local TweenService = game:GetService("TweenService")

local DEFAULT_BASE = "https://lua-x-api.vercel.app"
local SETTINGS_KEY = "LUA_X_API_BASE"
local HEARTBEAT_INTERVAL = 8
local POLL_INTERVAL = 4
local PLUGIN_VERSION = "0.12.0-studio"
local MAX_LOG = 80

local TOOLBAR_NAME = "LUA-X"
local PLUGIN_NAME = "LUA-X Studio Bridge"

local toolbar = plugin:CreateToolbar(TOOLBAR_NAME)
local toolbarButton = toolbar:CreateButton(PLUGIN_NAME, "Link this Studio session to the LUA-X website", "rbxassetid://14978048121")
toolbarButton.ClickableWhenViewportHidden = true

-- ----------------------------------------------------------------------------
-- Widget state
-- ----------------------------------------------------------------------------
local widget = nil
local root = nil
local statusOrb = nil
local statusPill = nil
local statusPillText = nil
local placeValue = nil
local sessionValue = nil
local endpointBox = nil
local testButton = nil
local connectButton = nil
local connectText = nil
local pingButton = nil
local pingText = nil
local logBox = nil
local flashOverlay = nil

local sessionId = nil
local connected = false
local connecting = false
local stopped = true
local heartbeatTask = nil
local pollTask = nil
local pulseTween = nil
local shimmerTween = nil
local logLines = {}

local function ui(class, props, parent)
	local inst = Instance.new(class)
	for k, v in pairs(props) do
		inst[k] = v
	end
	if parent then
		inst.Parent = parent
	end
	return inst
end

local function trim(s, maxLen)
	s = tostring(s or "")
	s = s:gsub("^%s+", ""):gsub("%s+$", "")
	if maxLen and #s > maxLen then
		s = s:sub(1, maxLen) .. "..."
	end
	return s
end

-- ----------------------------------------------------------------------------
-- Settings
-- ----------------------------------------------------------------------------
local function baseUrl()
	local raw = endpointBox and endpointBox.Text or ""
	raw = trim(raw):gsub("/+$", "")
	if raw == "" then
		raw = DEFAULT_BASE
	end
	return raw
end

local function saveSetting()
	if plugin:GetSetting(SETTINGS_KEY) ~= baseUrl() then
		plugin:SetSetting(SETTINGS_KEY, baseUrl())
	end
end

-- ----------------------------------------------------------------------------
-- Network
-- ----------------------------------------------------------------------------
local function request(method, path, body, timeoutSec)
	local url = baseUrl() .. path
	local options = {
		Url = url,
		Method = method,
		Headers = {
			["Accept"] = "application/json",
		},
		Timeout = timeoutSec or 10,
	}
	if body then
		options.Headers["Content-Type"] = "application/json"
		options.Body = HttpService:JSONEncode(body)
	end
	local ok, response = pcall(function()
		return HttpService:RequestAsync(options)
	end)
	if not ok then
		return nil, "network error: " .. tostring(response)
	end
	if not response.Success then
		return nil, "HTTP " .. tostring(response.StatusCode) .. " " .. trim(response.Body or response.StatusMessage, 120)
	end
	local decodeOk, decoded = pcall(function()
		return HttpService:JSONDecode(response.Body)
	end)
	if not decodeOk then
		return nil, "invalid JSON response"
	end
	return decoded, nil
end

local function heartbeatBody()
	return {
		projectId = tostring(game.PlaceId),
		sessionId = sessionId,
		placeName = tostring(game.Name),
		pluginVersion = PLUGIN_VERSION,
	}
end

-- ----------------------------------------------------------------------------
-- Logs
-- ----------------------------------------------------------------------------
local function log(message)
	local stamp = os.date("%H:%M:%S")
	table.insert(logLines, 1, string.format("• %s  %s", stamp, message))
	if #logLines > MAX_LOG then
		table.remove(logLines)
	end
	if logBox then
		logBox.Text = table.concat(logLines, "\n")
	end
end

-- ----------------------------------------------------------------------------
-- State visuals
-- ----------------------------------------------------------------------------
local C_OFFLINE = Color3.fromRGB(138, 147, 166)
local C_CONNECTING = Color3.fromRGB(245, 194, 107)
local C_CONNECTED = Color3.fromRGB(95, 224, 160)
local C_CARD = Color3.fromRGB(22, 26, 36)
local C_CARD_DARK = Color3.fromRGB(13, 16, 23)

local function stopPulse()
	if pulseTween then
		pulseTween:Cancel()
		pulseTween = nil
	end
	statusOrb.BackgroundTransparency = 0
end

local function pulse(color, fast)
	stopPulse()
	statusOrb.BackgroundColor3 = color
	pulseTween = TweenService:Create(
		statusOrb,
		TweenInfo.new(fast and 0.8 or 1.4, Enum.EasingStyle.Sine, Enum.EasingDirection.InOut, -1, fast and 0.35 or 0.0),
		{ BackgroundTransparency = 0.35 }
	)
	pulseTween:Play()
end

local function setState(state, note)
	if state == "connected" then
		pulse(C_CONNECTED, false)
		statusPillText.Text = "●  Connected — Studio is linked"
		statusPillText.TextColor3 = C_CONNECTED
		statusPill.BorderColor3 = C_CONNECTED
		connectText.Text = "Disconnect from LUA-X"
		pingButton.Active = true
		pingButton.Visible = true
		pingButton.BackgroundTransparency = 0
		pingButton.TextTransparency = 0
		pingText.TextColor3 = Color3.fromRGB(225, 230, 240)
	elseif state == "connecting" then
		pulse(C_CONNECTING, true)
		statusPillText.Text = "●  Connecting to LUA-X backend…"
		statusPillText.TextColor3 = C_CONNECTING
		statusPill.BorderColor3 = C_CONNECTING
		connectText.Text = "Connecting…"
		pingButton.Active = false
		pingButton.BackgroundTransparency = 0.55
		pingButton.TextTransparency = 0.55
	else
		stopPulse()
		statusOrb.BackgroundColor3 = C_OFFLINE
		statusPillText.Text = "●  Offline — click Connect to link Studio"
		statusPillText.TextColor3 = C_OFFLINE
		statusPill.BorderColor3 = Color3.fromRGB(42, 48, 64)
		connectText.Text = "Connect to LUA-X"
		pingButton.Active = false
		pingButton.BackgroundTransparency = 0.55
		pingButton.TextTransparency = 0.55
	end
	if note then
		log(note)
	end
end

-- ----------------------------------------------------------------------------
-- Animations
-- ----------------------------------------------------------------------------
local function startShimmer(gradient)
	if shimmerTween then
		shimmerTween:Cancel()
	end
	gradient.Offset = Vector2.new(-1.1, 0)
	shimmerTween = TweenService:Create(
		gradient,
		TweenInfo.new(2.4, Enum.EasingStyle.Linear, Enum.EasingDirection.Out, -1),
		{ Offset = Vector2.new(1.1, 0) }
	)
	shimmerTween:Play()
end

local function bindHover(button, baseColor)
	local tween = nil
	button.MouseEnter:Connect(function()
		if tween then
			tween:Cancel()
		end
		tween = TweenService:Create(button, TweenInfo.new(0.15, Enum.EasingStyle.Quad, Enum.EasingDirection.Out), {
			BackgroundColor3 = baseColor:Lerp(Color3.new(1, 1, 1), 0.1),
		})
		tween:Play()
	end)
	button.MouseLeave:Connect(function()
		if tween then
			tween:Cancel()
		end
		tween = TweenService:Create(button, TweenInfo.new(0.2, Enum.EasingStyle.Quad, Enum.EasingDirection.Out), {
			BackgroundColor3 = baseColor,
		})
		tween:Play()
	end)
end

local function pingFlash()
	if not flashOverlay then
		return
	end
	flashOverlay.BackgroundTransparency = 1
	local fadeIn = TweenService:Create(flashOverlay, TweenInfo.new(0.1, Enum.EasingStyle.Quad, Enum.EasingDirection.Out), {
		BackgroundTransparency = 0.82,
	})
	local fadeOut = TweenService:Create(flashOverlay, TweenInfo.new(0.45, Enum.EasingStyle.Quad, Enum.EasingDirection.In), {
		BackgroundTransparency = 1,
	})
	fadeIn:Play()
	fadeIn.Completed:Connect(function()
		fadeOut:Play()
	end)
end

-- ----------------------------------------------------------------------------
-- Backend actions
-- ----------------------------------------------------------------------------
local function heartbeat()
	local body, err = request("POST", "/api/studio/heartbeat", heartbeatBody())
	return body ~= nil, err
end

local function notifyDisconnect()
	pcall(request, "POST", "/api/studio/disconnect", { sessionId = sessionId })
end

local function handleCommand(command)
	if not command or command.type ~= "ping" then
		return
	end
	log("◉ Ping received from the LUA-X website")
	pingFlash()
	local ok, err = heartbeat()
	if not ok then
		log("Ping reply failed: " .. tostring(err))
	end
end

local function loopHeartbeat()
	while not stopped and connected do
		task.wait(HEARTBEAT_INTERVAL)
		local ok, err = heartbeat()
		if not ok then
			log("Heartbeat failed: " .. tostring(err))
		end
	end
end

local function loopPoll()
	while not stopped and connected do
		task.wait(POLL_INTERVAL)
		local path = "/api/studio/command?sessionId=" .. HttpService:UrlEncode(sessionId)
		local body, err = request("GET", path, nil, 8)
		if not body then
			if connected then
				log("Command poll failed: " .. tostring(err))
			end
		elseif body.command then
			handleCommand(body.command)
		end
	end
end

local function startLoops()
	stopped = false
	heartbeatTask = task.spawn(loopHeartbeat)
	pollTask = task.spawn(loopPoll)
end

local function stopLoops()
	stopped = true
	if heartbeatTask then
		task.cancel(heartbeatTask)
		heartbeatTask = nil
	end
	if pollTask then
		task.cancel(pollTask)
		pollTask = nil
	end
end

local function doConnect()
	if connecting or connected then
		return
	end
	connecting = true
	sessionId = HttpService:GenerateGUID(false)
	sessionValue.Text = string.sub(sessionId, 1, 13) .. "…"
	setState("connecting")
	saveSetting()

	local body, err = request("POST", "/api/studio/heartbeat", heartbeatBody())
	connecting = false
	if not body then
		sessionValue.Text = "—"
		setState("offline")
		log("Connect failed: " .. tostring(err))
		return
	end

	connected = true
	setState("connected", "Connected · session " .. sessionId)
	startLoops()
end

local function doDisconnect()
	stopLoops()
	connected = false
	notifyDisconnect()
	setState("offline")
	log("Disconnected from LUA-X")
end

-- ----------------------------------------------------------------------------
-- Widget construction
-- ----------------------------------------------------------------------------
local function buildWidget()
	widget = plugin:CreateDockWidgetPluginGui(
		"LUA_X_StudioBridge",
		DockWidgetPluginGuiInfo.new(
			Enum.InitialDockState.Floating,
			false,
			false,
			340,
			560,
			340,
			560
		)
	)
	widget.Title = PLUGIN_NAME

	-- Blurred backdrop
	local blur = ui("UIBlur", {
		Size = UDim2.fromScale(1, 1),
		Enabled = true,
		SizeScale = 14,
	}, widget)

	-- Main card
	root = ui("Frame", {
		Size = UDim2.new(1, -16, 1, -16),
		Position = UDim2.fromOffset(8, 8),
		BackgroundColor3 = C_CARD,
		BorderSizePixel = 0,
	}, widget)
	local rootCorner = ui("UICorner", { CornerRadius = UDim.new(0, 16) }, root)
	local rootStroke = ui("UIStroke", {
		Thickness = 1,
		Color = Color3.fromRGB(60, 70, 92),
		Transparency = 0.4,
	}, root)
	local rootGradient = ui("UIGradient", {
		Rotation = 90,
		Color = ColorSequence.new({
			ColorSequenceKeypoint.new(0, Color3.fromRGB(24, 29, 40)),
			ColorSequenceKeypoint.new(1, Color3.fromRGB(13, 16, 23)),
		}),
	}, root)
	local padding = ui("UIPadding", {
		PaddingTop = UDim.new(0, 12),
		PaddingBottom = UDim.new(0, 12),
		PaddingLeft = UDim.new(0, 14),
		PaddingRight = UDim.new(0, 14),
	}, root)

	-- Ping flash overlay
	flashOverlay = ui("Frame", {
		Size = UDim2.fromScale(1, 1),
		BackgroundColor3 = Color3.fromRGB(255, 255, 255),
		BackgroundTransparency = 1,
		ZIndex = 10,
		BorderSizePixel = 0,
	}, widget)
	ui("UICorner", { CornerRadius = UDim.new(0, 16) }, flashOverlay)

	local list = ui("UIListLayout", {
		SortOrder = Enum.SortOrder.LayoutOrder,
		Padding = UDim.new(0, 10),
		HorizontalAlignment = Enum.HorizontalAlignment.Center,
	}, root)

	-- Header ------------------------------------------------------------
	local header = ui("Frame", {
		Size = UDim2.new(1, 0, 0, 46),
		BackgroundTransparency = 1,
		LayoutOrder = 1,
	}, root)
	local logo = ui("Frame", {
		Size = UDim2.fromOffset(46, 46),
		Position = UDim2.fromOffset(0, 0),
		BackgroundColor3 = Color3.fromRGB(88, 101, 242),
		BorderSizePixel = 0,
	}, header)
	local logoCorner = ui("UICorner", { CornerRadius = UDim.new(0, 12) }, logo)
	local logoGradient = ui("UIGradient", {
		Rotation = 60,
		Color = ColorSequence.new({
			ColorSequenceKeypoint.new(0, Color3.fromRGB(88, 101, 242)),
			ColorSequenceKeypoint.new(1, Color3.fromRGB(170, 82, 255)),
		}),
	}, logo)
	ui("TextLabel", {
		Size = UDim2.fromScale(1, 1),
		Text = "X",
		Font = Enum.Font.GothamBold,
		TextSize = 22,
		TextColor3 = Color3.fromRGB(255, 255, 255),
		BackgroundTransparency = 1,
		TextXAlignment = Enum.TextXAlignment.Center,
		TextYAlignment = Enum.TextYAlignment.Center,
	}, logo)

	local wordmark = ui("Frame", {
		Size = UDim2.new(1, -56, 0, 46),
		Position = UDim2.fromOffset(56, 0),
		BackgroundTransparency = 1,
	}, header)
	ui("TextLabel", {
		Size = UDim2.new(1, 0, 0, 22),
		Position = UDim2.fromOffset(0, 0),
		Text = "LUA-X STUDIO",
		Font = Enum.Font.GothamBold,
		TextSize = 15,
		TextColor3 = Color3.fromRGB(238, 241, 250),
		BackgroundTransparency = 1,
		TextXAlignment = Enum.TextXAlignment.Left,
	}, wordmark)
	ui("TextLabel", {
		Size = UDim2.new(1, 0, 0, 16),
		Position = UDim2.fromOffset(0, 24),
		Text = "Roblox Studio bridge",
		Font = Enum.Font.Gotham,
		TextSize = 11,
		TextColor3 = Color3.fromRGB(120, 130, 152),
		BackgroundTransparency = 1,
		TextXAlignment = Enum.TextXAlignment.Left,
	}, wordmark)

	local orbHalo = ui("Frame", {
		Size = UDim2.fromOffset(20, 20),
		Position = UDim2.new(1, -24, 0, 0),
		AnchorPoint = Vector2.new(1, 0),
		BackgroundColor3 = C_OFFLINE,
		BackgroundTransparency = 0.55,
		BorderSizePixel = 0,
	}, header)
	ui("UICorner", { CornerRadius = UDim.new(1, 0) }, orbHalo)
	statusOrb = ui("Frame", {
		Size = UDim2.fromOffset(12, 12),
		Position = UDim2.new(1, -20, 0, 4),
		AnchorPoint = Vector2.new(1, 0),
		BackgroundColor3 = C_OFFLINE,
		BorderSizePixel = 0,
	}, header)
	ui("UICorner", { CornerRadius = UDim.new(1, 0) }, statusOrb)

	-- Status pill --------------------------------------------------------
	statusPill = ui("Frame", {
		Size = UDim2.new(1, 0, 0, 34),
		BackgroundColor3 = Color3.fromRGB(18, 21, 30),
		BorderSizePixel = 1,
		BorderColor3 = Color3.fromRGB(42, 48, 64),
		LayoutOrder = 2,
	}, root)
	ui("UICorner", { CornerRadius = UDim.new(1, 0) }, statusPill)
	statusPillText = ui("TextLabel", {
		Size = UDim2.fromScale(1, 1),
		Text = "●  Offline — click Connect to link Studio",
		Font = Enum.Font.GothamMedium,
		TextSize = 12.5,
		TextColor3 = C_OFFLINE,
		BackgroundTransparency = 1,
	}, statusPill)

	-- Session card -------------------------------------------------------
	local sessionCard = ui("Frame", {
		Size = UDim2.new(1, 0, 0, 88),
		BackgroundColor3 = C_CARD_DARK,
		BorderSizePixel = 0,
		LayoutOrder = 3,
	}, root)
	ui("UICorner", { CornerRadius = UDim.new(0, 12) }, sessionCard)
	ui("UIPadding", {
		PaddingTop = UDim.new(0, 8),
		PaddingBottom = UDim.new(0, 8),
		PaddingLeft = UDim.new(0, 12),
		PaddingRight = UDim.new(0, 12),
	}, sessionCard)
	local sessionList = ui("UIListLayout", {
		SortOrder = Enum.SortOrder.LayoutOrder,
		Padding = UDim.new(0, 6),
	}, sessionCard)

	local function sessionRow(labelText, order)
		local row = ui("Frame", {
			Size = UDim2.new(1, 0, 0, 20),
			BackgroundTransparency = 1,
			LayoutOrder = order,
		}, sessionCard)
		ui("TextLabel", {
			Size = UDim2.fromOffset(70, 20),
			Text = labelText,
			Font = Enum.Font.GothamBold,
			TextSize = 10,
			TextColor3 = Color3.fromRGB(110, 120, 142),
			BackgroundTransparency = 1,
			TextXAlignment = Enum.TextXAlignment.Left,
		}, row)
		local value = ui("TextLabel", {
			Size = UDim2.new(1, -78, 0, 20),
			Position = UDim2.fromOffset(78, 0),
			Text = "—",
			Font = Enum.Font.Gotham,
			TextSize = 11.5,
			TextColor3 = Color3.fromRGB(210, 216, 230),
			BackgroundTransparency = 1,
			TextXAlignment = Enum.TextXAlignment.Left,
			TextTruncate = Enum.TextTruncate.AtEnd,
		}, row)
		return value
	end

	placeValue = sessionRow("PLACE", 1)
	sessionValue = sessionRow("SESSION", 2)
	local endpointValue = sessionRow("ENDPOINT", 3)

	-- Endpoint row -------------------------------------------------------
	local endpointRow = ui("Frame", {
		Size = UDim2.new(1, 0, 0, 38),
		BackgroundTransparency = 1,
		LayoutOrder = 4,
	}, root)
	endpointBox = ui("TextBox", {
		Size = UDim2.new(1, -62, 1, 0),
		Position = UDim2.fromOffset(0, 0),
		Text = DEFAULT_BASE,
		PlaceholderText = "https://…",
		Font = Enum.Font.Code,
		TextSize = 11,
		TextColor3 = Color3.fromRGB(200, 206, 220),
		PlaceholderColor3 = Color3.fromRGB(90, 98, 118),
		BackgroundColor3 = Color3.fromRGB(18, 21, 30),
		BorderSizePixel = 0,
		TextXAlignment = Enum.TextXAlignment.Left,
	}, endpointRow)
	ui("UICorner", { CornerRadius = UDim.new(0, 10) }, endpointBox)
	ui("UIPadding", {
		PaddingLeft = UDim.new(0, 10),
		PaddingRight = UDim.new(0, 10),
	}, endpointBox)
	testButton = ui("TextButton", {
		Size = UDim2.new(0, 56, 1, 0),
		Position = UDim2.new(1, 0, 0, 0),
		AnchorPoint = Vector2.new(1, 0),
		Text = "Test",
		Font = Enum.Font.GothamMedium,
		TextSize = 12,
		TextColor3 = Color3.fromRGB(225, 230, 240),
		BackgroundColor3 = Color3.fromRGB(35, 41, 56),
		BorderSizePixel = 0,
	}, endpointRow)
	ui("UICorner", { CornerRadius = UDim.new(0, 10) }, testButton)

	-- Connect button -----------------------------------------------------
	connectButton = ui("TextButton", {
		Size = UDim2.new(1, 0, 0, 54),
		Text = "",
		BackgroundColor3 = Color3.fromRGB(88, 101, 242),
		BorderSizePixel = 0,
		LayoutOrder = 5,
		AutoButtonColor = false,
	}, root)
	ui("UICorner", { CornerRadius = UDim.new(0, 14) }, connectButton)
	local connectGlow = ui("UIStroke", {
		Thickness = 1.5,
		Color = Color3.fromRGB(150, 160, 255),
		Transparency = 0.35,
	}, connectButton)
	local connectGradient = ui("UIGradient", {
		Rotation = 55,
		Color = ColorSequence.new({
			ColorSequenceKeypoint.new(0, Color3.fromRGB(88, 101, 242)),
			ColorSequenceKeypoint.new(0.5, Color3.fromRGB(124, 92, 255)),
			ColorSequenceKeypoint.new(1, Color3.fromRGB(88, 101, 242)),
		}),
	}, connectButton)
	connectText = ui("TextLabel", {
		Size = UDim2.fromScale(1, 1),
		Text = "Connect to LUA-X",
		Font = Enum.Font.GothamBold,
		TextSize = 15,
		TextColor3 = Color3.fromRGB(255, 255, 255),
		BackgroundTransparency = 1,
	}, connectButton)

	-- Ping button --------------------------------------------------------
	pingButton = ui("TextButton", {
		Size = UDim2.new(1, 0, 0, 44),
		Text = "",
		BackgroundColor3 = Color3.fromRGB(30, 35, 48),
		BorderSizePixel = 1,
		BorderColor3 = Color3.fromRGB(60, 70, 92),
		LayoutOrder = 6,
		AutoButtonColor = false,
	}, root)
	ui("UICorner", { CornerRadius = UDim.new(0, 12) }, pingButton)
	pingText = ui("TextLabel", {
		Size = UDim2.fromScale(1, 1),
		Text = "◉  Ping Studio",
		Font = Enum.Font.GothamMedium,
		TextSize = 13.5,
		TextColor3 = Color3.fromRGB(200, 206, 220),
		BackgroundTransparency = 1,
	}, pingButton)

	-- Log card -----------------------------------------------------------
	local logCard = ui("Frame", {
		Size = UDim2.new(1, 0, 1, -388),
		MinimumSize = UDim2.fromOffset(0, 80),
		BackgroundColor3 = Color3.fromRGB(10, 12, 17),
		BorderSizePixel = 0,
		LayoutOrder = 7,
	}, root)
	ui("UICorner", { CornerRadius = UDim.new(0, 12) }, logCard)
	ui("UIStroke", {
		Thickness = 1,
		Color = Color3.fromRGB(45, 52, 70),
		Transparency = 0.5,
	}, logCard)
	ui("UIPadding", {
		PaddingTop = UDim.new(0, 8),
		PaddingBottom = UDim.new(0, 8),
		PaddingLeft = UDim.new(0, 10),
		PaddingRight = UDim.new(0, 10),
	}, logCard)
	local logScroll = ui("ScrollingFrame", {
		Size = UDim2.fromScale(1, 1),
		BackgroundTransparency = 1,
		BorderSizePixel = 0,
		ScrollBarThickness = 4,
		ScrollBarImageColor3 = Color3.fromRGB(70, 80, 104),
		AutomaticCanvasSize = Enum.AutomaticSize.Y,
		CanvasSize = UDim2.new(0, 0, 0, 0),
	}, logCard)
	logBox = ui("TextLabel", {
		Size = UDim2.new(1, 0, 0, 0),
		AutomaticSize = Enum.AutomaticSize.Y,
		Text = "",
		Font = Enum.Font.Code,
		TextSize = 11,
		TextColor3 = Color3.fromRGB(150, 160, 182),
		BackgroundTransparency = 1,
		TextXAlignment = Enum.TextXAlignment.Left,
		TextYAlignment = Enum.TextYAlignment.Top,
		TextWrapped = true,
		RichText = false,
	}, logScroll)

	-- Footer hint --------------------------------------------------------
	ui("TextLabel", {
		Size = UDim2.new(1, 0, 0, 18),
		Text = "The chat lives on the website → lua-x-api.vercel.app",
		Font = Enum.Font.Gotham,
		TextSize = 10,
		TextColor3 = Color3.fromRGB(105, 115, 138),
		BackgroundTransparency = 1,
		LayoutOrder = 8,
		TextTruncate = Enum.TextTruncate.AtEnd,
	}, root)

	-- Events -------------------------------------------------------------
	connectButton.MouseButton1Click:Connect(function()
		if connected then
			doDisconnect()
		else
			doConnect()
		end
	end)

	pingButton.MouseButton1Click:Connect(function()
		log("Ping sent · waiting for web…")
	end)

	testButton.MouseButton1Click:Connect(function()
		saveSetting()
		log("Testing " .. baseUrl() .. " …")
		local body, err = request("GET", "/api/health", nil, 8)
		if body then
			log("Backend OK · " .. trim(body.message or "healthy", 60))
		else
			log("Test failed: " .. tostring(err))
		end
	end)

	endpointBox.FocusLost:Connect(function()
		endpointValue.Text = baseUrl()
		saveSetting()
	end)

	bindHover(testButton, Color3.fromRGB(35, 41, 56))
	bindHover(pingButton, Color3.fromRGB(30, 35, 48))
	startShimmer(connectGradient)

	-- Init ---------------------------------------------------------------
	placeValue.Text = tostring(game.Name)
	endpointValue.Text = DEFAULT_BASE
	local saved = plugin:GetSetting(SETTINGS_KEY)
	if type(saved) == "string" and saved ~= "" then
		endpointBox.Text = saved
		endpointValue.Text = saved
	end
	connectText.TextColor3 = Color3.fromRGB(255, 255, 255)
	setState("offline")
	log("LUA-X bridge v" .. PLUGIN_VERSION .. " loaded")
	log("Waiting for you to connect")
end

-- ----------------------------------------------------------------------------
-- Entry
-- ----------------------------------------------------------------------------
toolbarButton.Click:Connect(function()
	if not widget then
		buildWidget()
	end
	widget.Enabled = not widget.Enabled
	toolbarButton:SetActive(widget.Enabled)
end)

plugin.Unloading:Connect(function()
	stopLoops()
	connected = false
	if sessionId then
		pcall(request, "POST", "/api/studio/disconnect", { sessionId = sessionId })
	end
end)