#!/usr/bin/env bash
set -eu

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BACKEND_DIR="$SCRIPT_DIR/backend"
APP_URL="http://localhost:8002"
VENV_DIR="$BACKEND_DIR/venv"
REQ_FILE="$BACKEND_DIR/requirements.txt"
REQ_STAMP="$VENV_DIR/.requirements.installed.txt"

fail() {
  echo ""
  echo "ERROR: $1"
  echo ""
  exit 1
}

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || fail "$2"
}

cd "$BACKEND_DIR"

need_cmd python3 "python3 was not found on PATH. Install Python 3 and re-run ./start.sh"

if [ ! -d "$VENV_DIR" ]; then
  echo "Creating Python virtual environment…"
  if ! python3 -m venv "$VENV_DIR" 2>/dev/null; then
    fail "Could not create the virtual environment. Install python3-venv and re-run ./start.sh"
  fi
fi

ACTIVATE_SCRIPT="$VENV_DIR/bin/activate"
[ -f "$ACTIVATE_SCRIPT" ] || fail "Virtual environment is incomplete. Delete backend/venv and re-run ./start.sh"

# shellcheck disable=SC1090
source "$ACTIVATE_SCRIPT"

need_cmd python "Virtual environment Python is missing. Delete backend/venv and re-run ./start.sh"

if [ ! -f "$REQ_STAMP" ] || ! cmp -s "$REQ_FILE" "$REQ_STAMP"; then
  echo "Installing dependencies…"
  python -m pip install -q --upgrade pip || fail "Failed to upgrade pip in backend/venv"
  python -m pip install -q -r "$REQ_FILE" || fail "Failed to install backend dependencies from requirements.txt"
  cp "$REQ_FILE" "$REQ_STAMP"
else
  echo "Dependencies already up to date."
fi

if ! python - <<'PY' >/dev/null 2>&1
import uvicorn
PY
then
  fail "uvicorn is not available in backend/venv. Delete backend/venv and re-run ./start.sh"
fi

echo ""
echo "  Starting Multi-Experiment Calcium Analyzer"
echo "  Open $APP_URL in your browser"
echo ""

uvicorn main:app --host 0.0.0.0 --port 8002 --reload
