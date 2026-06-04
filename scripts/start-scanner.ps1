# Arranca o painel (servidor Node).
# Uso: duplo clique INICIAR-Painel.bat ou opção 1 do INICIAR.bat

$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $ProjectRoot

. (Join-Path $PSScriptRoot "load-dotenv.ps1")

if (-not $env:PORT) { $env:PORT = "3000" }

$port = $env:PORT
Write-Host ""
Write-Host "DEX Scanner - servidor" -ForegroundColor Cyan
Write-Host "Pasta:  $ProjectRoot" -ForegroundColor Gray
Write-Host "Painel: http://localhost:$port" -ForegroundColor Green
if ($env:RPC_BASE) {
  Write-Host "RPC Base: configurado no .env" -ForegroundColor DarkGray
} else {
  Write-Host "RPC: não definido — copie .env.example para .env" -ForegroundColor Yellow
}
Write-Host ""
Write-Host "Ctrl+C para parar." -ForegroundColor Gray
Write-Host ""

npm start
