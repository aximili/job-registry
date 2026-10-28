# Job Registry: one-time setup on Windows. Run setup.bat, which calls this.
# Keep this file plain ASCII: Windows PowerShell 5.1 misreads other characters.

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

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

# 2. Packages and the dashboard
Write-Host 'Installing packages. This can take a few minutes...'
& npm ci
if ($LASTEXITCODE -ne 0) { Stop-Setup 'Installing packages failed. See the messages above.' }
Write-Host 'Building the dashboard...'
& npm run build
if ($LASTEXITCODE -ne 0) { Stop-Setup 'Building the dashboard failed. See the messages above.' }

# 3. Folders and settings
foreach ($dir in @('data', 'data\backups', 'data\logs', 'data\files')) {
  New-Item -ItemType Directory -Force -Path (Join-Path $root $dir) | Out-Null
}
$settings = Join-Path $root 'config\settings.json'
if (-not (Test-Path $settings)) {
  Copy-Item (Join-Path $root 'config\settings.example.json') $settings
  Write-Host 'Created config\settings.json.'
}

# 4. Shortcuts
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

Write-Host ''
Write-Host 'All set. Double-click start.bat or the Desktop shortcut.' -ForegroundColor Green
