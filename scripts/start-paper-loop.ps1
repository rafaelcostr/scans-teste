# Arranca o loop de paper trading.
# Uso: duplo clique INICIAR-Paper-Loop.bat com o painel já ligado.

$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $ProjectRoot

. (Join-Path $PSScriptRoot "load-dotenv.ps1")

if (-not $env:PORT) { $env:PORT = "3000" }
if (-not $env:EXECUTOR_BASE_URL) {
  $env:EXECUTOR_BASE_URL = "http://127.0.0.1:$($env:PORT)"
}

Write-Host ""
Write-Host "DEX Scanner - paper loop" -ForegroundColor Cyan
Write-Host "Pasta:  $ProjectRoot" -ForegroundColor Gray
Write-Host "API:    $env:EXECUTOR_BASE_URL" -ForegroundColor Green
Write-Host "Log:    $($env:PAPER_TRADES_FILE)" -ForegroundColor Green
Write-Host ""

if (-not $env:EXECUTOR_API_KEY) {
  Write-Host "ERRO: EXECUTOR_API_KEY não definido no .env." -ForegroundColor Red
  exit 1
}

Write-Host "Deixe o painel ligado noutra janela. Ctrl+C para parar." -ForegroundColor Gray
Write-Host ""

npm run paper:loop
