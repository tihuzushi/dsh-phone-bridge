# Builds the built-in tailnet node that the plugin ships for Windows.
#
#   pwsh -File native/build-tsnet-forwarder.ps1
#
# The source is plain Go on top of tailscale.com/tsnet. The module requirements
# come from a local checkout of tailscale.com (the same patched tree the Android
# app uses), because this machine builds offline: `-TailscaleSource` points at
# it and the module cache supplies every dependency.
param(
  [string]$TailscaleSource = 'F:\documents\HARNESS-Code\harness-phone-v2\native\tailscale-patched',
  [string]$Go = 'F:\documents\HARNESS-Code\_android-toolchain\go\bin\go.exe',
  [string]$Gopath = 'F:\documents\HARNESS-Code\_android-toolchain\gopath',
  [string]$Out = ''
)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
if (-not $Out) { $Out = Join-Path $root 'native\win32-x64\dsh-tsnet.exe' }

if (-not (Test-Path $Go)) { throw "go not found: $Go" }
if (-not (Test-Path $TailscaleSource)) { throw "tailscale source not found: $TailscaleSource" }

$env:GOPATH = $Gopath
$env:GOPROXY = 'off'
$env:GOFLAGS = '-mod=mod'
$env:GOTOOLCHAIN = 'local'
$env:CGO_ENABLED = '0'

$pkgDir = Join-Path $TailscaleSource 'cmd\dsh-tsnet'
New-Item -ItemType Directory -Force -Path $pkgDir | Out-Null
Copy-Item (Join-Path $PSScriptRoot 'tsnet-forwarder\main.go') (Join-Path $pkgDir 'main.go') -Force

# The local tree pins x/net v0.60.0 while the offline module cache only has
# v0.61.0. Bump it for the build, then put the file back exactly as it was.
$gomod = Join-Path $TailscaleSource 'go.mod'
$backup = "$gomod.dshbuild"
Copy-Item $gomod $backup -Force
try {
  $text = [System.IO.File]::ReadAllText($gomod)
  if ($text -match 'golang.org/x/net v0\.60\.0') {
    [System.IO.File]::WriteAllText($gomod, $text.Replace('golang.org/x/net v0.60.0', 'golang.org/x/net v0.61.0'), [System.Text.UTF8Encoding]::new($false))
  }
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $Out) | Out-Null
  Push-Location $TailscaleSource
  try {
    & $Go build -trimpath -ldflags '-s -w' -o $Out .\cmd\dsh-tsnet
    if ($LASTEXITCODE -ne 0) { throw "go build failed ($LASTEXITCODE)" }
  } finally { Pop-Location }
} finally {
  Move-Item $backup $gomod -Force
  Remove-Item $pkgDir -Recurse -Force -ErrorAction SilentlyContinue
}

$file = Get-Item $Out
"built {0} ({1:N1} MB)" -f $Out, ($file.Length / 1MB)
"sha256 {0}" -f (Get-FileHash $Out -Algorithm SHA256).Hash
