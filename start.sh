#!/usr/bin/env bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BACKEND_DIR="$SCRIPT_DIR/backend"

cd "$BACKEND_DIR"

if [ ! -d "venv" ]; then
  echo "Creating Python virtual environment…"
  if ! python3 -m venv venv 2>/dev/null; then
    echo ""
    echo "  ERROR: python3-venv is not installed. Run:"
    echo "    sudo apt install python3.12-venv"
    echo "  then re-run ./start.sh"
    echo ""
    exit 1
  fi
fi

source venv/bin/activate

echo "Installing dependencies…"
pip install -q --upgrade pip
pip install -q -r requirements.txt

echo ""
echo "  Starting Multi-Experiment Calcium Analyzer"
echo "  Open http://localhost:8002 in your browser"
echo ""

uvicorn main:app --host 0.0.0.0 --port 8002 --reload
