$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'build-env.ps1')

$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

pnpm run build

Set-Location (Join-Path $root 'src-tauri')
cargo build --release --features tauri/custom-protocol

$targetDir = Join-Path $root 'src-tauri\target\x86_64-pc-windows-gnu\release'
$releaseDir = Join-Path $root 'release'
New-Item -ItemType Directory -Path $releaseDir -Force | Out-Null

Copy-Item (Join-Path $targetDir 'isla.exe') (Join-Path $releaseDir 'Isla.exe') -Force
Copy-Item (Join-Path $targetDir 'WebView2Loader.dll') (Join-Path $releaseDir 'WebView2Loader.dll') -Force

Write-Host "Packaged Isla.exe + WebView2Loader.dll into $releaseDir"
