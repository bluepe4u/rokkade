#!/usr/bin/env sh
cd "$(dirname "$0")"
if command -v node >/dev/null 2>&1; then exec node server.js "$@"; fi
if command -v python3 >/dev/null 2>&1; then exec python3 serve.py "$@"; fi
echo "Install Node.js (https://nodejs.org) or Python 3 (https://python.org) and try again."; exit 1
