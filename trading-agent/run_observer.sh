#!/usr/bin/env bash
# Observer-mode runner. Sets up the venv on first run, then collects data and
# logs paper trade ideas. NO real money, NO broker calls. Run after market close.
set -euo pipefail

cd "$(dirname "$0")"

if [ ! -d ".venv" ]; then
  echo "[setup] creating virtualenv + installing deps (first run only)..."
  python3 -m venv .venv
  ./.venv/bin/pip install --quiet --upgrade pip
  ./.venv/bin/pip install --quiet -r requirements.txt
fi

echo "[observer] $(date '+%Y-%m-%d %H:%M:%S') running daily scan..."
./.venv/bin/python observer.py "$@"
echo "[observer] done. Journal: logs/journal.csv"
