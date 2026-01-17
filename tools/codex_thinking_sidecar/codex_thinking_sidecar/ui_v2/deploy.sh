#!/usr/bin/env bash
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# ui_v2 -> codex_thinking_sidecar -> tools/codex_thinking_sidecar -> tools -> repo root
repo_root="$(cd "${here}/../../../../" && pwd)"

dist_dir="${here}/dist"

cache_dir="${NPM_CACHE_DIR:-${repo_root}/.npm-cache}"

echo "[ui-v2] repo: ${repo_root}"
echo "[ui-v2] cache: ${cache_dir}"
echo "[ui-v2] build: ${dist_dir}"

mkdir -p "${cache_dir}"
cd "${here}"
export npm_config_cache="${cache_dir}"

if [ ! -d "${here}/node_modules" ]; then
  npm install
fi

npm run build

if [ ! -d "${dist_dir}" ]; then
  echo "[ui-v2] ERROR: build output missing: ${dist_dir}" >&2
  exit 1
fi

echo "[ui-v2] OK: built. Open http://127.0.0.1:8787/ui-v2"
