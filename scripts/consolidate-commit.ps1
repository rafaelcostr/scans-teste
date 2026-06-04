# Consolida alterações: primeiro commit ou commit com mensagem fixa.
# Uso (na raiz do projeto): npm run git:consolidate
#
# Se o Git não estiver no PATH do PowerShell, este script tenta várias formas de o encontrar.
# Último recurso: ficheiro scripts/git-exe.path (uma linha = caminho absoluto para git.exe).
# Vê scripts/git-exe.path.example

$ErrorActionPreference = "Stop"
Set-Location (Split-Path -Parent $PSScriptRoot)

function Prepend-ToPath {
  param([string]$Dir)
  if ($Dir -and (Test-Path -LiteralPath (Join-Path $Dir "git.exe"))) {
    $script:GitResolvedDir = $Dir
    $env:Path = "$Dir;$env:Path"
    return $true
  }
  return $false
}

function Try-PathSegmentsForGit {
  $chunks = @()
  try {
    $m = (Get-ItemProperty -Path "HKLM:\SYSTEM\CurrentControlSet\Control\Session Manager\Environment" -Name Path -ErrorAction SilentlyContinue).Path
    if ($m) { $chunks += $m }
  } catch {}
  try {
    $u = (Get-ItemProperty -Path "HKCU:\Environment" -Name Path -ErrorAction SilentlyContinue).Path
    if ($u) { $chunks += $u }
  } catch {}
  if ($env:Path) { $chunks += $env:Path }
  $big = $chunks -join ";"
  foreach ($seg in $big -split ";") {
    $t = $seg.Trim().Trim('"')
    if (-not $t) { continue }
    if (Prepend-ToPath $t) { return $true }
  }
  return $false
}

function Try-WhereGit {
  $whereExe = Join-Path $env:SystemRoot "System32\where.exe"
  if (-not (Test-Path -LiteralPath $whereExe)) {
    return $false
  }
  try {
    $out = & $whereExe git 2>$null
    foreach ($line in $out) {
      $p = $line.Trim()
      if ($p -and (Test-Path -LiteralPath $p)) {
        $d = Split-Path -Parent $p
        if (Prepend-ToPath $d) { return $true }
      }
    }
  } catch {}
  return $false
}

function Try-GitForWindowsRegistry {
  $keys = @(
    "HKLM:\SOFTWARE\GitForWindows",
    "HKLM:\SOFTWARE\WOW6432Node\GitForWindows",
    "HKCU:\SOFTWARE\GitForWindows"
  )
  foreach ($rk in $keys) {
    $install = (Get-ItemProperty -Path $rk -ErrorAction SilentlyContinue).InstallPath
    if (-not $install) { continue }
    foreach ($sub in @("cmd", "bin")) {
      $d = Join-Path $install $sub
      if (Prepend-ToPath $d) { return $true }
    }
  }
  return $false
}

function Try-SearchUnderGitFolders {
  $roots = @(
    "$env:ProgramFiles\Git",
    "${env:ProgramFiles(x86)}\Git",
    "$env:LocalAppData\Programs\Git",
    "$env:ProgramData\Git"
  )
  foreach ($root in $roots) {
    if (-not (Test-Path -LiteralPath $root)) { continue }
    $hit = Get-ChildItem -LiteralPath $root -Filter "git.exe" -Recurse -Depth 10 -ErrorAction SilentlyContinue |
      Select-Object -First 1
    if ($hit) {
      if (Prepend-ToPath $hit.DirectoryName) { return $true }
    }
  }
  return $false
}

function Ensure-GitOnPath {
  $script:GitResolvedDir = $null

  if ($env:GIT_EXE_FULL_PATH -and (Test-Path -LiteralPath $env:GIT_EXE_FULL_PATH)) {
    $dir = Split-Path -Parent $env:GIT_EXE_FULL_PATH
    if (Prepend-ToPath $dir) { return $true }
  }

  $pathFile = Join-Path $PSScriptRoot "git-exe.path"
  if (Test-Path -LiteralPath $pathFile) {
    $line = (Get-Content -LiteralPath $pathFile -Encoding UTF8 | Where-Object { $_ -match "\S" -and $_ -notmatch "^\s*#" } | Select-Object -First 1)
    if ($line) {
      $p = $line.Trim().Trim('"')
      if ($p -and (Test-Path -LiteralPath $p) -and $p.ToLower().EndsWith("git.exe")) {
        $dir = Split-Path -Parent $p
        if (Prepend-ToPath $dir) { return $true }
      }
    }
  }

  if (Get-Command git -ErrorAction SilentlyContinue) {
    return $true
  }

  if (Try-PathSegmentsForGit) { return $true }
  if (Try-WhereGit) { return $true }
  if (Try-GitForWindowsRegistry) { return $true }

  $extraDirs = @(
    "$env:ProgramFiles\Git\cmd",
    "$env:ProgramFiles\Git\bin",
    "${env:ProgramFiles(x86)}\Git\cmd",
    "${env:ProgramFiles(x86)}\Git\bin",
    "$env:LocalAppData\Programs\Git\cmd",
    "$env:LocalAppData\Programs\Git\bin",
    "$env:ProgramData\chocolatey\bin",
    "$env:USERPROFILE\scoop\shims",
    "$env:USERPROFILE\scoop\apps\git\current\cmd",
    "C:\msys64\usr\bin",
    "C:\msys64\mingw64\bin"
  )
  foreach ($d in $extraDirs) {
    if (Prepend-ToPath $d) { return $true }
  }

  if (Try-SearchUnderGitFolders) { return $true }

  return $false
}

if (-not (Ensure-GitOnPath)) {
  Write-Host ""
  Write-Host "Git (git.exe) não foi encontrado."
  Write-Host ""
  Write-Host "Opcoes:"
  Write-Host "  1) Instala Git for Windows e escolhe PATH para ""3rd-party software"":"
  Write-Host "     https://git-scm.com/download/win"
  Write-Host "  2) Copia scripts/git-exe.path.example para scripts/git-exe.path"
  Write-Host "     e cola UMA linha com o caminho completo para o teu git.exe (sem #)."
  Write-Host "  3) Num PowerShell da mesma sessao: `$env:GIT_EXE_FULL_PATH = 'C:\...\git.exe'"
  Write-Host ""
  exit 1
}

if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
  Write-Host "Erro: git.exe ainda não acessível após ajuste de PATH."
  exit 1
}

if ($script:GitResolvedDir) {
  Write-Host "Usando Git em: $script:GitResolvedDir"
}

if (-not (Test-Path .git)) {
  git init
}

git add -A
$st = git status --short
if (-not $st) {
  Write-Host "Nada para commitar (working tree limpa)."
  exit 0
}

$title = "feat: dynamic DexScreener filters, history noise hints, test runner"
$body = @(
  "- Add lib/dynamic-quality.js and wire into lib/dynamic-markets.js",
  "- Add lib/scan-history-noise.js, readRecentScanLines, slimMarket dynamic flag",
  "- Attach historyHints in scanner runScan; gasCostUsdForPool chain fallback",
  "- public UI hints; types; public-config flags; .env.example",
  "- scripts/run-node-tests.js; package.json test/typecheck; fix dexscreener and stable tests"
)
$commitArgs = @("commit", "-m", $title)
foreach ($line in $body) { $commitArgs += @("-m", $line) }
& git @commitArgs

Write-Host ""
git branch --show-current
git rev-parse --short HEAD
git log -1 --oneline
