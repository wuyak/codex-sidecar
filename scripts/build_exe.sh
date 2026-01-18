#!/usr/bin/env bash
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "${here}/.." && pwd)"

cd "${repo_root}"

python="${PYTHON:-python3}"

if ! command -v "${python}" >/dev/null 2>&1; then
  echo "[build_exe] 找不到 Python：${python}" >&2
  exit 1
fi

echo "[build_exe] 安装 PyInstaller…"
"${python}" -m pip install --upgrade pip pyinstaller >/dev/null

echo "[build_exe] 构建单文件可执行…"
mkdir -p build/pyinstaller dist

# PyInstaller 的 --add-data 分隔符：
# - Linux/macOS:  src:dest
# - Windows:      src;dest   （见 build_exe.ps1）
"${python}" -m PyInstaller \
  --noconfirm \
  --clean \
  --specpath build/pyinstaller \
  --workpath build/pyinstaller \
  --distpath dist \
  --onefile \
  --name codex-sidecar \
  --add-data "ui:ui" \
  "${repo_root}/scripts/entrypoint.py"

echo "[build_exe] 完成：dist/codex-sidecar"

