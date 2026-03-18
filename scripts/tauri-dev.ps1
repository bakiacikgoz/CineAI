param(
  [Parameter(ValueFromRemainingArguments = $true)]
  [string[]]$TauriArgs
)

$ErrorActionPreference = 'Stop'

function Test-DevServer {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Url
  )

  try {
    $null = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 2
    return $true
  } catch {
    return $false
  }
}

$projectRoot = Split-Path -Parent $PSScriptRoot
$viteCli = Join-Path $projectRoot 'node_modules\vite\bin\vite.js'
$tauriCli = Join-Path $projectRoot 'node_modules\@tauri-apps\cli\tauri.js'
$devConfig = Join-Path $projectRoot 'src-tauri\tauri.dev.windows.json'
$devUrl = 'http://localhost:1420'
$startedVite = $false
$viteProcess = $null

Set-Location $projectRoot

if (-not (Test-Path $viteCli)) {
  throw "Vite CLI bulunamadi: $viteCli"
}

if (-not (Test-Path $tauriCli)) {
  throw "Tauri CLI bulunamadi: $tauriCli"
}

if (-not (Test-Path $devConfig)) {
  throw "Windows dev config bulunamadi: $devConfig"
}

try {
  if (-not (Test-DevServer -Url $devUrl)) {
    $viteProcess = Start-Process `
      -FilePath 'node' `
      -ArgumentList @($viteCli) `
      -WorkingDirectory $projectRoot `
      -PassThru

    $startedVite = $true
    $deadline = (Get-Date).AddSeconds(45)

    while ((Get-Date) -lt $deadline) {
      if ($viteProcess.HasExited) {
        throw "Vite erken kapandi. Exit code: $($viteProcess.ExitCode)"
      }

      if (Test-DevServer -Url $devUrl) {
        break
      }

      Start-Sleep -Milliseconds 500
    }

    if (-not (Test-DevServer -Url $devUrl)) {
      throw 'Vite dev server 45 saniye icinde ayaga kalkmadi.'
    }
  }

  & node $tauriCli dev --config $devConfig @TauriArgs
  exit $LASTEXITCODE
} finally {
  if ($startedVite -and $viteProcess -and -not $viteProcess.HasExited) {
    & taskkill /PID $viteProcess.Id /T /F | Out-Null
  }
}
