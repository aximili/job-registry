#!/bin/sh
# Starts Job Registry on macOS or Linux (for development) and opens the dashboard.
# On Windows, use start.bat.
cd "$(dirname "$0")" || exit 1

PORT=$(node scripts/port.mjs)
URL="http://127.0.0.1:${PORT}/"

healthy() {
  node -e "fetch('${URL}api/v1/health').then(r => process.exit(r.ok ? 0 : 1), () => process.exit(1))"
}

if ! healthy; then
  mkdir -p data/logs
  nohup node server/main.ts > data/logs/console.log 2>&1 &
  i=0
  until healthy; do
    i=$((i + 1))
    if [ "$i" -ge 40 ]; then
      echo "The server didn't start. See data/logs for details."
      [ -f data/logs/startup-error.txt ] && cat data/logs/startup-error.txt
      exit 1
    fi
    sleep 0.5
  done
fi

if command -v open > /dev/null 2>&1; then open "$URL"; else xdg-open "$URL"; fi
