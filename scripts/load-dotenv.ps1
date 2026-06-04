# Carrega variáveis de .env para o processo atual (sem sobrescrever env já definido).
param(
  [string]$EnvPath = (Join-Path (Split-Path -Parent $PSScriptRoot) ".env")
)

if (-not (Test-Path -LiteralPath $EnvPath)) {
  return
}

Get-Content -LiteralPath $EnvPath -Encoding UTF8 | ForEach-Object {
  $line = $_.Trim()
  if (-not $line -or $line.StartsWith("#")) { return }
  $eq = $line.IndexOf("=")
  if ($eq -lt 1) { return }
  $key = $line.Substring(0, $eq).Trim()
  $val = $line.Substring($eq + 1).Trim()
  if ($val.StartsWith('"') -and $val.EndsWith('"')) {
    $val = $val.Substring(1, $val.Length - 2)
  }
  if ($val.StartsWith("'") -and $val.EndsWith("'")) {
    $val = $val.Substring(1, $val.Length - 2)
  }
  if (-not [string]::IsNullOrWhiteSpace($key) -and $null -eq [Environment]::GetEnvironmentVariable($key, "Process")) {
    [Environment]::SetEnvironmentVariable($key, $val, "Process")
  }
}
