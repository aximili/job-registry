# Job Registry: one-time setup on Windows. Run setup.bat, which calls this.
# Keep this file plain ASCII: Windows PowerShell 5.1 misreads other characters.

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $root

function Stop-Setup([string]$message) {
  Write-Host ''
  Write-Host $message -ForegroundColor Red
  exit 1
}

Write-Host "Setting up Job Registry in $root"
Write-Host ''

# 1. Node.js 24 or later
$nodeVersion = $null
try { $nodeVersion = (& node -v) 2>$null } catch { $nodeVersion = $null }
$needNode = 'Job Registry needs Node.js 24 or later. Install it with: winget install OpenJS.NodeJS.LTS, then run setup.bat again.'
if (-not $nodeVersion) { Stop-Setup $needNode }
$major = [int]($nodeVersion.TrimStart('v').Split('.')[0])
if ($major -lt 24) { Stop-Setup $needNode }
Write-Host "Found Node.js $nodeVersion."

# 2. The app must be stopped: setup replaces the database driver it is using.
$port = & node (Join-Path $root 'scripts\port.mjs')
if (-not $port) { $port = '4777' }
$running = $false
try {
  Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 -Uri "http://127.0.0.1:$port/api/v1/health" | Out-Null
  $running = $true
} catch {
  $running = $false
}
if ($running) { Stop-Setup 'Job Registry is running. Run stop.bat first, then run setup.bat again.' }

# 3. Packages and the dashboard
Write-Host 'Installing packages. This can take a few minutes...'
& npm ci
if ($LASTEXITCODE -ne 0) { Stop-Setup 'Installing packages failed. See the messages above.' }
Write-Host 'Building the dashboard...'
& npm run build
if ($LASTEXITCODE -ne 0) { Stop-Setup 'Building the dashboard failed. See the messages above.' }
Write-Host 'Building the browser extension...'
& npm run ext:build
if ($LASTEXITCODE -ne 0) { Stop-Setup 'Building the browser extension failed. See the messages above.' }

# 4. Folders and settings
# Paths are used literally throughout, so a folder name with [ ] in it works.
foreach ($dir in @('data', 'data\backups', 'data\logs', 'data\files')) {
  [System.IO.Directory]::CreateDirectory((Join-Path $root $dir)) | Out-Null
}
$settings = Join-Path $root 'config\settings.json'
if (-not (Test-Path -LiteralPath $settings)) {
  Copy-Item -LiteralPath (Join-Path $root 'config\settings.example.json') -Destination $settings
  Write-Host 'Created config\settings.json.'
}

# 5. Shortcuts
$shell = New-Object -ComObject WScript.Shell
function New-StartShortcut([string]$path, [string]$arguments, [int]$windowStyle) {
  $link = $shell.CreateShortcut($path)
  $link.TargetPath = Join-Path $root 'start.bat'
  $link.Arguments = $arguments
  $link.WorkingDirectory = $root
  $link.WindowStyle = $windowStyle
  $link.Description = 'Job Registry'
  $link.Save()
}

Write-Host ''
$answer = Read-Host 'Create a Desktop shortcut? (Y/n)'
if ($answer -eq '' -or $answer -match '^[Yy]') {
  New-StartShortcut (Join-Path ([Environment]::GetFolderPath('Desktop')) 'Job Registry.lnk') '' 1
  Write-Host 'Desktop shortcut created.'
}

$answer = Read-Host 'Start Job Registry when you log in? (y/N)'
if ($answer -match '^[Yy]') {
  # 7 = minimised. --no-browser: start quietly, ready for when a recruiter calls.
  New-StartShortcut (Join-Path ([Environment]::GetFolderPath('Startup')) 'Job Registry.lnk') '--no-browser' 7
  Write-Host 'Job Registry will start when you log in.'
}

# 6. The AI (optional): run as its own PowerShell, so a failed download
# doesn't stop setup. It can be run again later with download-ai.bat.
Write-Host ''
$answer = Read-Host 'Download the AI now (Bonsai 2, about 8 GB)? (y/N)'
if ($answer -match '^[Yy]') {
  & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'download-ai.ps1')
  if ($LASTEXITCODE -ne 0) {
    Write-Host 'The AI download did not finish. Run download-ai.bat later to carry on.' -ForegroundColor Yellow
  }
} else {
  Write-Host 'You can download it later with download-ai.bat, or use Ollama or LM Studio (see README).'
}

Write-Host ''
Write-Host 'All set. Double-click start.bat or the Desktop shortcut.' -ForegroundColor Green
