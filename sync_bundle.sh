#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
SRC_BACKEND="$ROOT/backend"
SRC_FRONTEND="$ROOT/frontend"
BUNDLE_BACKEND="$ROOT/bundle/backend"
BUNDLE_FRONTEND="$ROOT/bundle/frontend"

# Files to exclude from frontend (dev-only, not needed at runtime)
EXCLUDE=(package.json smoke_test.mjs project_save_test.mjs deck-stage.js)

# Validate before updating any release files.
for required in plotly-2.27.0.min.js LICENSE-plotly.txt; do
  if [[ ! -s "$SRC_FRONTEND/vendor/$required" ]]; then
    echo "Missing bundled Plotly asset: frontend/vendor/$required" >&2
    exit 1
  fi
done

echo "Syncing bundle..."

# ── Backend ──────────────────────────────────────────────────────────────────
cp "$SRC_BACKEND/project_archive.py" "$BUNDLE_BACKEND/project_archive.py"
cp "$SRC_BACKEND/main.py"          "$BUNDLE_BACKEND/main.py"
cp "$SRC_BACKEND/requirements.txt" "$BUNDLE_BACKEND/requirements.txt"
echo "  backend/main.py"
echo "  backend/requirements.txt"

# ── Frontend root files ───────────────────────────────────────────────────────
for f in "$SRC_FRONTEND"/*; do
  name="$(basename "$f")"
  [[ -d "$f" ]] && continue
  for ex in "${EXCLUDE[@]}"; do [[ "$name" == "$ex" ]] && continue 2; done
  cp "$f" "$BUNDLE_FRONTEND/$name"
  echo "  frontend/$name"
done

# ── Frontend JS ───────────────────────────────────────────────────────────────
mkdir -p "$BUNDLE_FRONTEND/js"
for f in "$SRC_FRONTEND/js"/*.js; do
  name="$(basename "$f")"
  cp "$f" "$BUNDLE_FRONTEND/js/$name"
  echo "  frontend/js/$name"
done

echo ""
# Vendored browser dependencies must ship with every release.
mkdir -p "$BUNDLE_FRONTEND/vendor"
cp "$SRC_FRONTEND/vendor/"* "$BUNDLE_FRONTEND/vendor/"
echo "  frontend/vendor (Plotly and license)"

echo "Bundle is up to date."
