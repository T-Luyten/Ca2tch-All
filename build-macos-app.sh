#!/usr/bin/env bash
# Builds Ca2tchAll.app — a double-clickable macOS app that starts Ca2tchAll.
# Re-run this script if you move the project folder.
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
APP_DIR="$PROJECT_DIR/Ca2tchAll.app"
ICON_SRC="$PROJECT_DIR/frontend/logo.png"

echo "Building Ca2tchAll.app…"
rm -rf "$APP_DIR"
mkdir -p "$APP_DIR/Contents/MacOS" "$APP_DIR/Contents/Resources"

# --- Icon ---
ICONSET="$(mktemp -d)/Ca2tchAll.iconset"
mkdir -p "$ICONSET"
for size in 16 32 128 256 512; do
  dbl=$((size * 2))
  sips -z "$size" "$size" "$ICON_SRC" --out "$ICONSET/icon_${size}x${size}.png" >/dev/null
  sips -z "$dbl" "$dbl" "$ICON_SRC" --out "$ICONSET/icon_${size}x${size}@2x.png" >/dev/null
done
iconutil -c icns "$ICONSET" -o "$APP_DIR/Contents/Resources/Ca2tchAll.icns"

# --- Info.plist ---
cat > "$APP_DIR/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleExecutable</key><string>ca2tchall</string>
  <key>CFBundleIconFile</key><string>Ca2tchAll</string>
  <key>CFBundleIdentifier</key><string>com.ca2tchall.app</string>
  <key>CFBundleName</key><string>Ca2tchAll</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>1.1.0</string>
</dict>
</plist>
PLIST

# --- Launcher (project path baked in; bundle-relative fallback) ---
cat > "$APP_DIR/Contents/MacOS/ca2tchall" <<LAUNCHER
#!/bin/bash
PROJECT_DIR="$PROJECT_DIR"
if [ ! -f "\$PROJECT_DIR/start-mac.command" ]; then
  PROJECT_DIR="\$(cd "\$(dirname "\$0")/../../.." && pwd)"
fi
open -a Terminal "\$PROJECT_DIR/start-mac.command"
LAUNCHER
chmod +x "$APP_DIR/Contents/MacOS/ca2tchall"
chmod +x "$PROJECT_DIR/start-mac.command"

# --- Also place a copy in ~/Applications for Spotlight / Dock ---
mkdir -p "$HOME/Applications"
rm -rf "$HOME/Applications/Ca2tchAll.app"
cp -R "$APP_DIR" "$HOME/Applications/Ca2tchAll.app"

echo ""
echo "  Done. You now have:"
echo "    $APP_DIR"
echo "    $HOME/Applications/Ca2tchAll.app"
echo "  Double-click either one to start Ca2tchAll."
echo "  Drag it to the Dock for one-click access."
