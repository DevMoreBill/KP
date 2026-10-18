#!/bin/bash
# Сеанс Claude Code в облаке: инструменты проверок tests/run_all.py — pyflakes (как в CI) и ESLint (через npx, версия —
# tests/run_all.py ESLINT). Программа сама — только стандартная библиотека Python, ставить нечего.
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "${CLAUDE_PROJECT_DIR:-$(dirname "$0")/../..}"

# pyflakes — та же версия, что в .github/workflows/build-exe.yml
if ! python3 -c "import pyflakes, sys; sys.exit(0 if pyflakes.__version__ == '4.0.0' else 1)" 2>/dev/null; then
  python3 -m pip install --quiet --disable-pip-version-check pyflakes==4.0.0
fi

# ESLint — заранее в кэш npm (run_all.py вызывает «npx --yes eslint@…»)
ESLINT=$(python3 -c "import re; print(re.search(r\"ESLINT = '([^']+)'\", open('tests/run_all.py', encoding='utf-8').read()).group(1))")
if command -v npx >/dev/null 2>&1; then
  npx --yes "$ESLINT" --version >/dev/null
fi
