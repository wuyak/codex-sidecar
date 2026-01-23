param(
  [string]$Python = "python"
)

$ErrorActionPreference = "Stop"

$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Resolve-Path (Join-Path $here "..")
Set-Location $repoRoot

Write-Host "[build_exe] 安装 PyInstaller…"
& $Python -m pip install --upgrade pip pyinstaller | Out-Null

Write-Host "[build_exe] 构建单文件可执行…"
New-Item -ItemType Directory -Force -Path "build\\pyinstaller" | Out-Null
New-Item -ItemType Directory -Force -Path "dist" | Out-Null

# PyInstaller 的 --add-data 分隔符：
# - Windows: src;dest
& $Python -m PyInstaller `
  --noconfirm `
  --clean `
  --specpath "build\\pyinstaller" `
  --workpath "build\\pyinstaller" `
  --distpath "dist" `
  --onefile `
  --name "codex-sidecar" `
  --add-data "ui;ui" `
  "scripts\\entrypoint.py"

Write-Host "[build_exe] 完成：dist\\codex-sidecar.exe"

