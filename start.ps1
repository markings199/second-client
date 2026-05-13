param(
  [int]$Port = 5500,
  [switch]$NoOpen,
  [switch]$KillExisting
)

$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$serveDir = Join-Path $root 'steelforge'

if (-not (Test-Path (Join-Path $serveDir 'index.html'))) {
  Write-Host "ERROR: steelforge\index.html not found at $serveDir" -ForegroundColor Red
  Write-Host "Run this script from the repo root (C:\Civil Engineering Department)." -ForegroundColor Red
  exit 1
}

function Get-PortHolders([int]$p) {
  Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction SilentlyContinue |
    ForEach-Object {
      $proc = Get-Process -Id $_.OwningProcess -ErrorAction SilentlyContinue
      [PSCustomObject]@{
        PID         = $_.OwningProcess
        Address     = $_.LocalAddress
        ProcessName = $proc.ProcessName
        Path        = $proc.Path
      }
    }
}

$holders = Get-PortHolders $Port
if ($holders) {
  Write-Host "Port $Port is already in use:" -ForegroundColor Yellow
  $holders | Format-Table -AutoSize | Out-String | Write-Host
  Write-Host "Most likely cause: another VS Code / Cursor window has Live Server running on this port from a different folder." -ForegroundColor Yellow
  Write-Host "(That's why the browser shows a directory listing for an unrelated folder.)" -ForegroundColor Yellow
  Write-Host ""

  $ans = if ($KillExisting) { 'y' } else { Read-Host "Kill the existing process(es) and continue? [y/N]" }
  if ($ans -match '^(y|yes)$') {
    foreach ($h in $holders) {
      try {
        Stop-Process -Id $h.PID -Force -ErrorAction Stop
        Write-Host "Killed PID $($h.PID) ($($h.ProcessName))" -ForegroundColor DarkYellow
      } catch {
        Write-Host "Failed to kill PID $($h.PID): $_" -ForegroundColor Red
      }
    }
    Start-Sleep -Milliseconds 600
    $still = Get-PortHolders $Port
    if ($still) {
      Write-Host "Port $Port still in use after kill attempt. Aborting." -ForegroundColor Red
      $still | Format-Table -AutoSize | Out-String | Write-Host
      exit 1
    }
  } else {
    Write-Host "Aborting. Stop the other server (or pass -KillExisting / use a different -Port) and try again." -ForegroundColor Red
    exit 1
  }
}

$python = Get-Command python -ErrorAction SilentlyContinue
if (-not $python) { $python = Get-Command py -ErrorAction SilentlyContinue }
if (-not $python) {
  Write-Host "ERROR: Python is not on PATH. Install Python 3, or run 'py -m http.server $Port' manually from $serveDir." -ForegroundColor Red
  exit 1
}

$url = "http://127.0.0.1:$Port/"
Write-Host "Serving $serveDir at $url" -ForegroundColor Green
Write-Host "Press Ctrl+C to stop." -ForegroundColor DarkGray

if (-not $NoOpen) { Start-Process $url | Out-Null }

Push-Location $serveDir
try {
  & $python.Source -m http.server $Port
} finally {
  Pop-Location
}
