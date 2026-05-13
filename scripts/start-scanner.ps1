# Arranca o painel sem ter de colar comandos no PowerShell.
# Uso (na pasta do projeto):  .\scripts\start-scanner.ps1
# Ou:  npm run start:win
#
# NAO cole no terminal: linhas "PS C:\...>", "Node.js v...", erros do Node, nem o prompt ">>".

$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $ProjectRoot

# Porta 3001 evita conflito se algo ja usar a 3000. Para 3000: comente as 2 linhas abaixo.
$env:PORT = "3001"

$env:USE_REAL_CHAIN_DATA = "1"
$env:RPC_ARBITRUM = "https://arb1.arbitrum.io/rpc"

Write-Host ""
Write-Host "Pasta: $ProjectRoot" -ForegroundColor Gray
Write-Host "Painel: http://localhost:$($env:PORT)" -ForegroundColor Cyan
Write-Host "Ctrl+C para parar o servidor." -ForegroundColor Gray
Write-Host ""

npm start
