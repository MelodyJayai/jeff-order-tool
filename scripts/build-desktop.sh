#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_NAME="JeffOrderTool"
RELEASE_ROOT="${JEFF_DESKTOP_RELEASE_ROOT:-${ROOT_DIR}/release}"
APP_DIR="${JEFF_DESKTOP_APP_DIR:-${RELEASE_ROOT}/${APP_NAME}}"

cd "$ROOT_DIR"
npm run build

rm -rf "$APP_DIR"
mkdir -p "$APP_DIR/server" "$APP_DIR/data" "$APP_DIR/logs"
cp -R .next/standalone/. "$APP_DIR/server/"
mkdir -p "$APP_DIR/server/.next"
cp -R .next/static "$APP_DIR/server/.next/static"
if [[ -d public ]]; then
  cp -R public "$APP_DIR/server/public"
fi

NODE_BIN="$(command -v node || true)"
if [[ -z "$NODE_BIN" || ! -x "$NODE_BIN" ]]; then
  echo "未找到 Node.js，无法生成 macOS 版运行时。" >&2
  exit 1
fi
mkdir -p "$APP_DIR/runtime"
cp -L "$NODE_BIN" "$APP_DIR/runtime/node"
chmod +x "$APP_DIR/runtime/node"

cp start-jeff-order-tool.sh "$APP_DIR/start-jeff-order-tool.sh"
chmod +x "$APP_DIR/start-jeff-order-tool.sh"
cat > "$APP_DIR/start-jeff-order-tool.command" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
exec "$SCRIPT_DIR/start-jeff-order-tool.sh"
EOF
chmod +x "$APP_DIR/start-jeff-order-tool.command"
cat > "$APP_DIR/README.txt" <<'EOF'
Jeff 订单工具 macOS 版

双击 start-jeff-order-tool.command，或在终端运行：
  ./start-jeff-order-tool.sh

订单数据默认保存在：
  ~/Library/Application Support/JeffOrderTool/data

安装包已附带 Node.js 运行时。云端同步凭据由 macOS 钥匙串保存。
EOF

echo "macOS 桌面版已生成：$APP_DIR"
