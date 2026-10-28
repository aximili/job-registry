# Job Registry: downloads the default local AI into the ai folder:
# PrismML's llama-server (CUDA 12.4 build for NVIDIA cards) and the
# Bonsai 2 27B model. About 8 GB in total.
# Run it with download-ai.bat. If a download stops, run it again: it carries
# on where it stopped. Each file is checked against its published SHA-256.
# Keep this file plain ASCII: Windows PowerShell 5.1 misreads other characters.

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$aiDir = Join-Path $root 'ai'
$downloads = Join-Path $aiDir 'downloads'
$llamaDir = Join-Path $aiDir 'llama.cpp'
$modelsDir = Join-Path $aiDir 'models'

function Stop-Download([string]$message) {
  Write-Host ''
  Write-Host $message -ForegroundColor Red
  exit 1
}

# The release that Bonsai-demo pins. The CUDA 13.3 build can exit without a
# message on some Windows PCs, so this uses CUDA 12.4.
$release = 'https://github.com/PrismML-Eng/llama.cpp/releases/download/prism-b10777-e3de715'
$files = @(
  @{
    Name   = 'llama-prism-b10777-e3de715-bin-win-cuda-12.4-x64.zip'
    Url    = "$release/llama-prism-b10777-e3de715-bin-win-cuda-12.4-x64.zip"
    Sha256 = 'fa5874a1412e251a6efb13f289e97bacbbb4e7fc6714c1836b4fc6c1dc863462'
    Folder = $downloads
    Unzip  = $true
  },
  @{
    Name   = 'cudart-llama-bin-win-cuda-12.4-x64.zip'
    Url    = "$release/cudart-llama-bin-win-cuda-12.4-x64.zip"
    Sha256 = '8c79a9b226de4b3cacfd1f83d24f962d0773be79f1e7b75c6af4ded7e32ae1d6'
    Folder = $downloads
    Unzip  = $true
  },
  @{
    Name   = 'Ternary-Bonsai-2-27B-PQ2_0.gguf'
    Url    = 'https://huggingface.co/prism-ml/Ternary-Bonsai-2-27B-gguf/resolve/main/Ternary-Bonsai-2-27B-PQ2_0.gguf'
    Sha256 = '3907dc1658db1f78a9826bf8d5bcb8dc65db0d466388937af57f2294fae62ec1'
    Folder = $modelsDir
    Unzip  = $false
  }
)

# curl.exe comes with Windows 10 and 11. It can resume a broken download.
$curl = Join-Path $env:SystemRoot 'System32\curl.exe'
if (-not (Test-Path -LiteralPath $curl)) {
  Stop-Download 'This needs curl.exe, which comes with Windows 10 and 11. Update Windows, then run download-ai.bat again.'
}

# Downloading is fine while the app runs: it doesn't use these files until
# they're unpacked. $changed notes whether anything new arrived.
$changed = $false
foreach ($f in $files) {
  [System.IO.Directory]::CreateDirectory($f.Folder) | Out-Null
  $target = Join-Path $f.Folder $f.Name
  $ok = $false
  if (Test-Path -LiteralPath $target) {
    Write-Host "Checking $($f.Name)..."
    $ok = ((Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash -eq $f.Sha256)
  }
  if (-not $ok) {
    Write-Host ''
    Write-Host "Downloading $($f.Name)..."
    & $curl -L --fail --retry 3 -C - -o $target $f.Url
    if ($LASTEXITCODE -ne 0) {
      Stop-Download "Downloading $($f.Name) stopped. Run download-ai.bat again to carry on where it stopped."
    }
    Write-Host "Checking $($f.Name)..."
    $hash = (Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash
    if ($hash -ne $f.Sha256) {
      Remove-Item -LiteralPath $target -Force
      Stop-Download "$($f.Name) didn't download correctly, so it was deleted. Run download-ai.bat again."
    }
    $changed = $true
  }
}

# Unpacking replaces llama-server's files, so the app (and its llama-server)
# must be stopped first. Nothing to unpack if nothing changed. unpacked.txt
# records which zips were unpacked, so a newer build is always unpacked.
$serverExe = Join-Path $llamaDir 'llama-server.exe'
$stamp = Join-Path $llamaDir 'unpacked.txt'
$wanted = ($files | Where-Object { $_.Unzip } | ForEach-Object { $_.Name }) -join ','
$unpacked = ''
if (Test-Path -LiteralPath $stamp) { $unpacked = (Get-Content -LiteralPath $stamp -Raw).Trim() }
if ($changed -or -not (Test-Path -LiteralPath $serverExe) -or ($unpacked -ne $wanted)) {
  $node = Get-Command node -ErrorAction SilentlyContinue
  if ($node) {
    $port = & node (Join-Path $root 'scripts\port.mjs')
    if (-not $port) { $port = '4777' }
    $running = $false
    try {
      Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 -Uri "http://127.0.0.1:$port/api/v1/health" | Out-Null
      $running = $true
    } catch {
      $running = $false
    }
    if ($running) {
      Stop-Download 'The download is done. Job Registry is running, so run stop.bat, then run download-ai.bat again to unpack it (it will not download again).'
    }
  }
  foreach ($f in $files) {
    if (-not $f.Unzip) { continue }
    Write-Host "Unpacking $($f.Name)..."
    [System.IO.Directory]::CreateDirectory($llamaDir) | Out-Null
    Expand-Archive -LiteralPath (Join-Path $f.Folder $f.Name) -DestinationPath $llamaDir -Force
  }
  Set-Content -LiteralPath $stamp -Value $wanted -Encoding Ascii
}

if (-not (Test-Path -LiteralPath $serverExe)) {
  Stop-Download 'llama-server.exe is missing after unpacking. Delete the ai\downloads folder and run download-ai.bat again.'
}

Write-Host ''
Write-Host 'The AI is ready. Start Job Registry and press Test connection in Settings.' -ForegroundColor Green
