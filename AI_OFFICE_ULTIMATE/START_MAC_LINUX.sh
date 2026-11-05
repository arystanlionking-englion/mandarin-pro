#!/usr/bin/env bash
set -e
cd -- "$(dirname -- "$0")"
if ! command -v node >/dev/null; then
 echo 'Install Node.js 24 LTS from https://nodejs.org/'
 exit 1
fi
echo 'Open http://127.0.0.1:8787/ai-office/ in your browser.'
exec node server/index.mjs
