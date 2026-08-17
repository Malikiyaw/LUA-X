<#
.SYNOPSIS
    Installs the LUA-X Roblox Studio plugin into the Studio local Plugins directory.
.DESCRIPTION
    Roblox Studio exposes the configured local plugin directory through Studio.PluginsDir.
    On current Windows installs this is commonly under %LOCALAPPDATA%\Roblox\Plugins.

    The installer defaults to %LOCALAPPDATA%\Roblox\Plugins, but accepts -PluginsDir
    so the exact directory opened by Studio can be used without changing this script.

    The source plugin is kept as studio-plugin\LUA-X.plugin.lua in the repository, while
    the installed local plugin is written as LUA-X.lua for compatibility with the normal
    local-plugin workflow.
.NOTES
    Close Roblox Studio before running this installer, then reopen Studio afterward.
#>
[CmdletBinding()]
param(
    [string]$PluginPath = (Join-Path $PSScriptRoot 'studio-plugin\LUA-X.plugin.lua'),
    [string]$PluginsDir = (Join-Path $env:LOCALAPPDATA 'Roblox\Plugins')
)

$ErrorActionPreference = 'Stop'

if (-not (Test-Path -LiteralPath $PluginPath -PathType Leaf)) {
    throw "Plugin file not found: $PluginPath"
}

if ([string]::IsNullOrWhiteSpace($PluginsDir)) {
    throw 'PluginsDir is empty. Pass -PluginsDir with the folder shown by Roblox Studio.'
}

$pluginsDir = [System.IO.Path]::GetFullPath($PluginsDir)
$target = Join-Path $pluginsDir 'LUA-X.lua'

New-Item -ItemType Directory -Path $pluginsDir -Force | Out-Null

$content = [System.IO.File]::ReadAllText($PluginPath)
$content = $content -replace "`r`n", "`n"
$content = $content -replace "`r", "`n"
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($target, $content, $utf8NoBom)

try {
    Unblock-File -LiteralPath $target -ErrorAction SilentlyContinue
} catch {
    # Best effort only; some Windows environments do not provide Unblock-File.
}

$bytes = [System.IO.File]::ReadAllBytes($target)
$bomOk = -not ($bytes.Length -ge 3 -and $bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF)
$nameOk = $target.EndsWith('LUA-X.lua', [System.StringComparison]::OrdinalIgnoreCase)

Write-Host ''
Write-Host 'LUA-X plugin installed.' -ForegroundColor Green
Write-Host "  File:      $target"
Write-Host "  Size:      $($bytes.Length) bytes"
Write-Host "  Encoding:  $($(if ($bomOk) { 'UTF-8 (no BOM) - OK' } else { 'UTF-8 BOM - BAD' }))"
Write-Host "  Filename:  $($(if ($nameOk) { 'LUA-X.lua - OK' } else { 'LUA-X.lua - BAD' }))"
Write-Host ''

if (-not $bomOk -or -not $nameOk) {
    Write-Host 'Installation validation failed. Delete the installed file and rerun the installer.' -ForegroundColor Yellow
    exit 1
}

Write-Host 'Next steps:' -ForegroundColor Cyan
Write-Host '  1. Close Roblox Studio completely if it is open.'
Write-Host '  2. Reopen Roblox Studio.'
Write-Host '  3. Open the Plugins tab and look for the LUA-X toolbar button.'
Write-Host ''
Write-Host 'If LUA-X is still missing, open Plugins > Manage Plugins > Open Plugins Folder in Studio.' -ForegroundColor Yellow
Write-Host 'Then run this installer again with that exact directory:' -ForegroundColor Yellow
Write-Host '  .\install-plugin.ps1 -PluginsDir "<folder opened by Studio>"' -ForegroundColor Yellow
exit 0
