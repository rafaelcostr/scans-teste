# Menu inicial - duplo clique em INICIAR.bat na pasta do projeto.
$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $ProjectRoot

. (Join-Path $PSScriptRoot "load-dotenv.ps1")

function Show-Header {
  Clear-Host
  Write-Host ""
  Write-Host "  DEX Scanner - inicializador" -ForegroundColor Cyan
  Write-Host "  Pasta: $ProjectRoot" -ForegroundColor DarkGray
  if ($env:PORT) {
    $script:MenuPort = $env:PORT
  } else {
    $script:MenuPort = "3000"
  }
  Write-Host "  Painel (se ligado): http://localhost:$script:MenuPort" -ForegroundColor DarkGray
  Write-Host ""
}

function Wait-Enter {
  Write-Host ""
  Write-Host "Prima Enter para voltar ao menu..." -ForegroundColor Gray
  $null = Read-Host
}

function Start-Painel {
  Show-Header
  Write-Host "A iniciar servidor (painel)..." -ForegroundColor Green
  Write-Host "Feche esta janela com Ctrl+C para parar." -ForegroundColor Yellow
  Write-Host ""
  & (Join-Path $PSScriptRoot "start-scanner.ps1")
}

function Start-SimulacaoBase {
  Show-Header
  Write-Host "Simulação PAPER em Base (sem saldo, sem tx)..." -ForegroundColor Green
  if (-not $env:RPC_BASE) {
    Write-Host ""
    Write-Host "AVISO: RPC_BASE não definido no .env — só verá snapshot do scan." -ForegroundColor Yellow
    Write-Host "Duplo clique em CRIAR-ENV.bat ou edite .env com RPC_BASE=https://mainnet.base.org" -ForegroundColor Yellow
    Write-Host ""
  }
  node scripts/executor-simulate.js --chain=base
  Wait-Enter
}

function Start-SimulacaoBaseLearn {
  Show-Header
  Write-Host "Simulação PAPER Base (modo aprendizagem: MIN_NET_PROFIT_USD=0)..." -ForegroundColor Green
  $env:MIN_NET_PROFIT_USD = "0"
  if (-not $env:RPC_BASE) {
    Write-Host "AVISO: defina RPC_BASE no .env (use CRIAR-ENV.bat)." -ForegroundColor Yellow
  }
  node scripts/executor-simulate.js --chain=base --learn
  Wait-Enter
}

function Start-SimulacaoServidor {
  Show-Header
  if ($env:PORT) {
    $port = $env:PORT
  } else {
    $port = "3000"
  }
  Write-Host "Simulação PAPER a partir do último scan no servidor (porta $port)..." -ForegroundColor Green
  Write-Host "O painel tem de estar a correr (opção 1 noutra janela)." -ForegroundColor Yellow
  Write-Host ""
  node scripts/executor-simulate.js --from-server
  Wait-Enter
}

function Start-PaperLoop {
  Show-Header
  Write-Host "Paper loop continuo (scan -> enqueue -> tick -> PnL)..." -ForegroundColor Green
  Write-Host "O painel tem de estar a correr (opção 1 noutra janela)." -ForegroundColor Yellow
  Write-Host "Feche esta janela com Ctrl+C para parar." -ForegroundColor Yellow
  Write-Host ""
  & (Join-Path $PSScriptRoot "start-paper-loop.ps1")
}

function Abrir-PainelBrowser {
  if ($env:PORT) {
    $port = $env:PORT
  } else {
    $port = "3000"
  }
  Start-Process "http://localhost:$port/"
}

function Run-Tests {
  Show-Header
  Write-Host "A correr npm test..." -ForegroundColor Green
  npm test
  Wait-Enter
}

while ($true) {
  Show-Header
  Write-Host "  1  Iniciar painel (servidor + scan automático)" -ForegroundColor White
  Write-Host "  2  Abrir painel no browser (http://localhost)" -ForegroundColor White
  Write-Host "  3  Simulação paper — Base (sem MetaMask / sem saldo)" -ForegroundColor White
  Write-Host "  3b Simulação paper — Base modo aprendizagem (--learn)" -ForegroundColor DarkGray
  Write-Host "  4  Simulação paper — último scan do servidor" -ForegroundColor White
  Write-Host "  5  Iniciar paper loop contínuo (PnL por dias)" -ForegroundColor White
  Write-Host "  6  Correr testes (npm test)" -ForegroundColor White
  Write-Host "  0  Sair" -ForegroundColor White
  Write-Host ""
  $op = Read-Host "Escolha"

  switch ($op) {
    "1" { Start-Painel; break }
    "2" { Abrir-PainelBrowser; Wait-Enter }
    "3" { Start-SimulacaoBase }
    "3b" { Start-SimulacaoBaseLearn }
    "4" { Start-SimulacaoServidor }
    "5" { Start-PaperLoop; break }
    "6" { Run-Tests }
    "0" { exit 0 }
    default {
      Write-Host "Opção inválida." -ForegroundColor Red
      Start-Sleep -Seconds 1
    }
  }
}
