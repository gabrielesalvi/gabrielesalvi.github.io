#!/usr/bin/env bash
# Build pulito (senza bozze) + controllo + commit + push. Il push su main È la pubblicazione.
# Uso: ./pubblica.sh "messaggio di commit"
set -euo pipefail
cd "$(dirname "$0")"
PY=~/.openclaw/.venv/bin/python3
msg="${1:?serve un messaggio di commit}"
$PY build.py
$PY strumenti/controlla.py
git add build.py pubblica.sh README.md .gitignore .github src public strumenti
git commit -m "$msg"
git push
