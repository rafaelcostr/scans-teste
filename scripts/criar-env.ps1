# Cria .env a partir de .env.example (se ainda não existir) e sugere RPC Base para aprendizagem.
$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent $PSScriptRoot
$envPath = Join-Path $ProjectRoot ".env"
$examplePath = Join-Path $ProjectRoot ".env.example"

if (-not (Test-Path -LiteralPath $examplePath)) {
  Write-Host "Ficheiro .env.example não encontrado." -ForegroundColor Red
  exit 1
}

if (Test-Path -LiteralPath $envPath) {
  Write-Host ".env ja existe: $envPath" -ForegroundColor Yellow
  Write-Host "Edite manualmente e adicione as linhas abaixo se faltarem:" -ForegroundColor Gray
} else {
  Copy-Item -LiteralPath $examplePath -Destination $envPath
  Write-Host "Criado: $envPath" -ForegroundColor Green
}

Write-Host ""
Write-Host "Sugestao para aprender (cole no final do .env):" -ForegroundColor Cyan
Write-Host ""
Write-Host "RPC_BASE=https://mainnet.base.org"
Write-Host "MIN_NET_PROFIT_USD=0"
Write-Host "USE_REAL_CHAIN_DATA=1"
Write-Host ""
Write-Host "mainnet.base.org e publico (pode ser lento). Para melhor desempenho use Alchemy (gratis)." -ForegroundColor DarkGray
Write-Host ""
