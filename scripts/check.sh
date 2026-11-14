#!/usr/bin/env bash
# Tests de Python + tests de web + cada JSON de web/data abre.
set -u
cd "$(dirname "$0")/.."
PY="${AZ_PY:-/home/ale/nasa-space-apps-2026/.venv/bin/python}"
fallo=0
if compgen -G "pipeline/**/test_*.py" >/dev/null || compgen -G "pipeline/*/tests/test_*.py" >/dev/null; then
  "$PY" -m pytest -q pipeline || fallo=1
fi
if compgen -G "web/tests/*.test.mjs" >/dev/null; then
  node --test web/tests/*.test.mjs || fallo=1
fi
while IFS= read -r -d '' f; do
  "$PY" -c "import json,sys; json.load(open(sys.argv[1]))" "$f" || { echo "JSON roto: $f"; fallo=1; }
done < <(find web/data -name '*.json' -print0 2>/dev/null)
"$PY" scripts/check_terrenos.py || fallo=1
echo "CHECK_EXIT=$fallo"
exit $fallo
