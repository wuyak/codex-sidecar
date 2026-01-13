#!/usr/bin/env bash
set -euo pipefail

exec "$(dirname "${BASH_SOURCE[0]}")/tools/codex_thinking_sidecar/ui.sh" "$@"

