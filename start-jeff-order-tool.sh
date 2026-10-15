#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEFAULT_DATA_DIR="${HOME}/Library/Application Support/JeffOrderTool/data"
DATA_DIR="${JEFF_ORDER_DATA_DIR:-$DEFAULT_DATA_DIR}"
PORT="${PORT:-3000}"
HOSTNAME="${HOSTNAME:-0.0.0.0}"

# A package built on macOS carries the matching Node runtime. Keep the system
# fallback for source checkouts and development.
NODE_BIN="${JEFF_NODE_BIN:-}"
if [[ -z "$NODE_BIN" && -x "$ROOT_DIR/runtime/node" ]]; then
  NODE_BIN="$ROOT_DIR/runtime/node"
fi
if [[ -z "$NODE_BIN" ]]; then
  NODE_BIN="$(command -v node || true)"
fi
if [[ -z "$NODE_BIN" || ! -x "$NODE_BIN" ]]; then
  echo "未找到 Node.js。请先安装 Node.js LTS，再运行本脚本。" >&2
  exit 1
fi

mkdir -p "$DATA_DIR"
# A Windows portable package can be copied to the Mac before first launch.
# Import its data once, then keep all mutable files in Application Support.
if [[ -z "${JEFF_ORDER_DATA_DIR:-}" && ! -f "$DATA_DIR/orders.db" && -f "$ROOT_DIR/data/orders.db" ]]; then
  cp -R "$ROOT_DIR/data/." "$DATA_DIR/"
  echo "已将便携版 data 目录迁移到：$DATA_DIR"
fi
export JEFF_ORDER_DATA_DIR="$DATA_DIR"
export JEFF_ORDER_DB_PATH="${JEFF_ORDER_DB_PATH:-${DATA_DIR}/orders.db}"
export JEFF_BACKUP_DIR="${JEFF_BACKUP_DIR:-${DATA_DIR}/backups}"
export JEFF_APP_BASE_DIR="${JEFF_APP_BASE_DIR:-$ROOT_DIR}"
export PORT
export HOSTNAME

if [[ -f "$ROOT_DIR/server/server.js" ]]; then
  SERVER_DIR="$ROOT_DIR/server"
  SERVER_ENTRY="$SERVER_DIR/server.js"
else
  SERVER_DIR="$ROOT_DIR/.next/standalone"
  SERVER_ENTRY="$ROOT_DIR/.next/standalone/server.js"
fi

if [[ ! -f "$SERVER_ENTRY" ]]; then
  echo "找不到 Next.js 服务文件，请先运行 npm run build 或 npm run build:desktop:mac。" >&2
  exit 1
fi

cd "$SERVER_DIR"
"$NODE_BIN" "$SERVER_ENTRY" >"$DATA_DIR/server.log" 2>&1 &
SERVER_PID=$!
trap 'kill "$SERVER_PID" 2>/dev/null || true' EXIT INT TERM

for _ in {1..30}; do
  if curl --silent --fail "http://127.0.0.1:${PORT}/api/health" >/dev/null 2>&1; then
    open "http://127.0.0.1:${PORT}"
    wait "$SERVER_PID"
    exit 0
  fi
  sleep 1
done

echo "服务启动超时，请查看：$DATA_DIR/server.log" >&2
exit 1
