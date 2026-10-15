#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_NAME="JeffOrderTool"
RELEASE_ROOT="${JEFF_DESKTOP_RELEASE_ROOT:-${ROOT_DIR}/release}"
APP_DIR="${JEFF_DESKTOP_APP_DIR:-${RELEASE_ROOT}/${APP_NAME}}"
ARCHIVE_DIR="${JEFF_DESKTOP_ARCHIVE_DIR:-${ROOT_DIR}/release-archives}"
VERSION="$(node -p "require('./package.json').version")"
ARCHIVE_PATH="${ARCHIVE_DIR}/${APP_NAME}-macOS-v${VERSION}.zip"

cd "$ROOT_DIR"
npm run build:desktop:mac
if [[ ! -d "$APP_DIR" ]]; then
  echo "macOS 桌面版目录不存在：$APP_DIR" >&2
  exit 1
fi

mkdir -p "$ARCHIVE_DIR"
rm -f "$ARCHIVE_PATH"
if command -v ditto >/dev/null 2>&1; then
  # ditto preserves executable bits and macOS resource forks in the archive.
  ditto -c -k --sequesterRsrc --keepParent "$APP_DIR" "$ARCHIVE_PATH"
else
  (cd "$RELEASE_ROOT" && zip -qr "$ARCHIVE_PATH" "$APP_NAME")
fi

echo "macOS 桌面版压缩包已生成：$ARCHIVE_PATH"
