<#
.SYNOPSIS
    Installs the LUA-X Roblox Studio plugin into the correct local Plugins folder.
.DESCRIPTION
    Roblox Studio loads local plugins ONLY from <Documents>\Roblox\Plugins with a
    .plugin.lua suffix. This script locates the real Documents folder (OneDrive-safe),
    creates Roblox\Plugins if needed, and installs studio-plugin\LUA-X.plugin.lua
    with correct UTF-8 (no BOM) encoding.
.NOTES
    Restart Roblox Studio after running this script.
#>
[CmdletBinding()]
param(
    [string]$PluginPath = (Join-Path $PSScriptRoot 'studio-plugin\LUA-X.plugin.lua')
)

$ErrorActionPreference = 'Stop'

function Get-DocumentsPath {
    $regPath = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\User Shell Folders'
    try {
        $personal = (Get-ItemProperty -Path $regPath -Name 'Personal' -ErrorAction Stop).Personal
    } catch {
        $personal = $null
    }
    if ($personal) {
        $personal = [Environment]::ExpandEnvironmentVariables($personal)
    }
    if ([string]::IsNullOrWhiteSpace($personal) -or -not (Test-Path -LiteralPath $personal)) {
        $personal = [Environment]::GetFolderPath('MyDocuments')
    }
    return $personal
}

if (-not (Test-Path -LiteralPath $PluginPath)) {
    Write-Error "Plugin file not found: $PluginPath"
    exit 1
}

$documents = Get-DocumentsPath
$pluginsDir = Join-Path $documents 'Roblox\Plugins'
$target = Join-Path $pluginsDir 'LUA-X.plugin.lua'

New-Item -ItemType Directory -Path $pluginsDir -Force | Out-Null

$content = [System.IO.File]::ReadAllText($PluginPath)
$content = $content -replace "`r`n", "`n"
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($target, $content, $utf8NoBom)

try {
    Unblock-File -LiteralPath $target -ErrorAction SilentlyContinue
} catch {
    # Unblock-File is not available on all Windows editions; ignore.
}

$bytes = [System.IO.File]::ReadAllBytes($target)
$bomOk = -not ($bytes.Length -ge 3 -and $bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF)
$nameOk = $target.EndsWith('.plugin.lua', [System.StringComparison]::OrdinalIgnoreCase)

Write-Host ''
Write-Host 'LUA-X plugin installed.' -ForegroundColor Green
Write-Host "  File:   $target"
Write-Host "  Size:   $($bytes.Length) bytes"
Write-Host "  Encoding: $($(if ($bomOk) { 'UTF-8 (no BOM) - OK' } else { 'UTF-8 BOM - BAD' }))"
Write-Host "  Filename: $($(if ($nameOk) { 'LUA-X.plugin.lua - OK' } else { 'missing .plugin.lua suffix - BAD' }))"
Write-Host ''
if (-not $bomOk -or -not $nameOk) {
    Write-Host 'Installation has an encoding or naming problem. Delete the file above and rerun this script.' -ForegroundColor Yellow
    exit 1
}
Write-Host 'Next steps:' -ForegroundColor Cyan
Write-Host '  1. Close Roblox Studio completely and reopen it.'
Write-Host '  2. Open the Plugins tab and click LUA-X to open the dock.'
Write-Host '  3. If the backend is configured, click Test Connection in the plugin.'
exit 0