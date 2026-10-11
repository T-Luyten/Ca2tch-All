#!/bin/bash
# Double-clickable starter for Ca2tchAll on macOS.
# Starts the server via start.sh and opens the browser once it answers.
DIR="$(cd "$(dirname "$0")" && pwd)"
URL="http://localhost:8002"

# If the server is already running, just open the browser.
if curl -s -o /dev/null --max-time 2 "$URL"; then
  open "$URL"
  exit 0
fi

# Open the browser in the background as soon as the server responds.
(
  for i in $(seq 1 90); do
    if curl -s -o /dev/null --max-time 2 "$URL"; then
      open "$URL"
      exit 0
    fi
    sleep 2
  done
) &

exec bash "$DIR/start.sh"
