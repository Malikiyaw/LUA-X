@echo off
REM Fix-LUA-X.bat — double-click to fix "plugin not showing" with ZERO Studio navigation
REM This kills Studio, installs LUA-X to EVERY possible Plugins folder, unblocks, verifies.

echo.
echo === LUA-X ONE-CLICK FIX ===
echo Closing Roblox Studio (so file can be replaced)...
taskkill /F /IM RobloxStudioBeta.exe >nul 2>&1
timeout /t 2 /nobreak >nul

echo Installing LUA-X to all known Plugins folders...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install.ps1" -ErrorAction Stop
if errorlevel 1 (
  echo.
  echo [FAIL] install.ps1 failed. Trying explicit path...
  powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install.ps1" -PluginsDir "%LOCALAPPDATA%\Roblox\Plugins"
)

echo.
echo === VERIFY ===
powershell -NoProfile -Command "Get-ChildItem -Path \"$env:LOCALAPPDATA\Roblox\Plugins\LUA-X.lua\",\"$env:USERPROFILE\Documents\Roblox\Plugins\LUA-X.lua\" -ErrorAction SilentlyContinue | Format-Table FullName,Length,LastWriteTime -AutoSize"
echo.
echo === DONE ===
echo 1. Reopen Roblox Studio MANUALLY (double-click Studio icon)
echo 2. Top bar: click "Plugins" tab — you MUST see "LUA-X" button there now
echo 3. If still not there: Plugins -^> Manage Plugins -^> check LUA-X is Enabled
echo.
echo If still invisible, copy the Output below and send it to support.
echo Press any key to close...
pause >nul
