<#
.SYNOPSIS
    Installs the LUA-X Roblox Studio plugin into the Studio local Plugins directory.
.DESCRIPTION
    Roblox Studio exposes the configured local plugin directory. On most current
    Windows installs this is %LOCALAPPDATA%\Roblox\Plugins, but some installs use
    %USERPROFILE%\Documents\Roblox\Plugins or a custom location exposed via
    Plugins -> Manage Plugins -> Open Plugins Folder.

    FIX FOR "NOT SHOWING": This installer now hardens the plugin so it never fails
    silently (toolbar wraps in pcall, fallback text button), and when run WITHOUT
    -PluginsDir it installs to BOTH common locations so you cannot put it in the
    wrong place. If Studio still shows nothing, use Open Plugins Folder and pass
    that exact path via -PluginsDir.

    The canonical source plugin is studio-plugin\LUA-X-connected.lua; the installed
    local plugin is written as LUA-X.lua for compatibility with the normal local-plugin
    workflow. There is no other plugin implementation.
.NOTES
    Close Roblox Studio BEFORE running this installer, then reopen Studio afterward.
#>
[CmdletBinding()]
param(
    [string]$PluginPath = (Join-Path $PSScriptRoot 'studio-plugin\LUA-X-connected.lua'),
    [string]$PluginsDir = $null,
    [switch]$All
)

$ErrorActionPreference = 'Stop'

if (-not (Test-Path -LiteralPath $PluginPath -PathType Leaf)) {
    throw "Plugin file not found: $PluginPath"
}

# Warn if Studio is still running — file will not be picked up until restart.
$studioProc = Get-Process -Name "RobloxStudioBeta" -ErrorAction SilentlyContinue
if ($studioProc) {
    Write-Host 'WARNING: Roblox Studio is still running. Close it completely before installing.' -ForegroundColor Yellow
    Write-Host 'The plugin will not appear until you fully exit and reopen Studio.' -ForegroundColor Yellow
    Write-Host ''
}

function Install-ToDir([string]$dir) {
    if ([string]::IsNullOrWhiteSpace($dir)) { return $null }
    $full = [System.IO.Path]::GetFullPath($dir)
    New-Item -ItemType Directory -Path $full -Force | Out-Null
    $target = Join-Path $full 'LUA-X.lua'

    # Clean stale blocked variants: LUA-X.lua.txt, LUA-X (1).lua, Zone.Identifier
    foreach ($bad in @("LUA-X.lua.txt", "LUA-X (1).lua", "LUA-X - Copy.lua")) {
        $badPath = Join-Path $full $bad
        if (Test-Path -LiteralPath $badPath) { try { Remove-Item -LiteralPath $badPath -Force -ErrorAction SilentlyContinue; Write-Host "Removed stale $bad" -ForegroundColor DarkYellow } catch {} }
    }

    $content = [System.IO.File]::ReadAllText($PluginPath)
    $content = $content -replace "`r`n", "`n"
    $content = $content -replace "`r", "`n"
    $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($target, $content, $utf8NoBom)

    try { Unblock-File -LiteralPath $target -ErrorAction SilentlyContinue } catch {}
    # Also clear Zone.Identifier ADS explicitly
    try { Remove-Item -LiteralPath "$target:Zone.Identifier" -Force -ErrorAction SilentlyContinue } catch {}

    $bytes = [System.IO.File]::ReadAllBytes($target)
    $bomOk = -not ($bytes.Length -ge 3 -and $bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF)
    $nameOk = $target.EndsWith('LUA-X.lua', [System.StringComparison]::OrdinalIgnoreCase)
    $hash = (Get-FileHash -Algorithm SHA256 -LiteralPath $target).Hash.Substring(0,12)

    Write-Host ''
    Write-Host 'LUA-X plugin installed.' -ForegroundColor Green
    Write-Host "  File:      $target"
    Write-Host "  Size:      $($bytes.Length) bytes  SHA256:$hash"
    Write-Host "  Encoding:  $($(if ($bomOk) { 'UTF-8 (no BOM) - OK' } else { 'UTF-8 BOM - BAD' }))"
    Write-Host "  Filename:  $($(if ($nameOk) { 'LUA-X.lua - OK' } else { 'LUA-X.lua - BAD' }))"
    if (-not $bomOk -or -not $nameOk) { Write-Host '  Validation: FAILED' -ForegroundColor Red } else { Write-Host '  Validation: OK' -ForegroundColor Green }

    return $target
}

$installed = @()

if (-not [string]::IsNullOrWhiteSpace($PluginsDir)) {
    # Explicit dir — install exactly there (user used Open Plugins Folder)
    $installed += Install-ToDir $PluginsDir
} else {
    # No explicit dir — install to BOTH common locations so "wrong folder" can never happen
    $common = @(
        (Join-Path $env:LOCALAPPDATA 'Roblox\Plugins'),
        (Join-Path $env:USERPROFILE 'Documents\Roblox\Plugins')
    )
    # Also detect if Documents is redirected (OneDrive)
    $oneDriveDocs = Join-Path $env:USERPROFILE 'OneDrive\Documents\Roblox\Plugins'
    if (Test-Path -LiteralPath (Split-Path $oneDriveDocs -Parent) -PathType Container) { $common += $oneDriveDocs }

    foreach ($d in ($common | Select-Object -Unique)) {
        try { $installed += Install-ToDir $d } catch { Write-Host "Could not install to $d : $($_.Exception.Message)" -ForegroundColor Yellow }
    }

    # If -All is passed, also search registry for custom Plugins folder? Best-effort: list both anyway
    if ($All) { Write-Host "Installed to all common locations. If Studio still shows nothing, use Open Plugins Folder path." -ForegroundColor Cyan }
}

Write-Host ''
Write-Host 'Next steps:' -ForegroundColor Cyan
Write-Host '  1. Close Roblox Studio COMPLETELY (check Task Manager -> RobloxStudioBeta.exe).'
Write-Host '  2. Reopen Roblox Studio.'
Write-Host '  3. Open the Plugins tab -> you MUST see LUA-X toolbar button.' -ForegroundColor Green
Write-Host '  4. If still missing: Plugins -> Manage Plugins -> see LUA-X Enabled?'
Write-Host '     Also: Manage Plugins -> Open Plugins Folder -> verify LUA-X.lua is there.'
Write-Host ''
Write-Host 'If still missing, run with exact folder Studio opened:' -ForegroundColor Yellow
Write-Host '  .\install-plugin.ps1 -PluginsDir "<folder opened by Studio>"' -ForegroundColor Yellow
Write-Host 'Example: .\install-plugin.ps1 -PluginsDir "$env:LOCALAPPDATA\Roblox\Plugins"' -ForegroundColor Yellow
Write-Host ''

# Manage Plugins check hint
Write-Host 'Installed files:' -ForegroundColor DarkCyan
foreach ($f in $installed) { if ($f) { Write-Host "  $f" } }

# Final robustness: show which folders were actually used
if (-not (Test-Path -LiteralPath (Join-Path $env:LOCALAPPDATA 'Roblox\Plugins\LUA-X.lua')) -and -not (Test-Path -LiteralPath (Join-Path $env:USERPROFILE 'Documents\Roblox\Plugins\LUA-X.lua'))) {
    Write-Host 'WARNING: No file found after install — check permissions.' -ForegroundColor Red
    exit 1
}
exit 0
