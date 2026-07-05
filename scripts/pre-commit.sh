#!/bin/sh
# OMSFIN pre-commit: тесты + запрещённые паттерны + лимит serverless-функций.
# Установка: cp scripts/pre-commit.sh .git/hooks/pre-commit && chmod +x .git/hooks/pre-commit

set -e
cd "$(git rev-parse --show-toplevel)"

echo "pre-commit: node tests/run.js"
node tests/run.js || { echo "БЛОК: тесты упали — коммит запрещён"; exit 1; }

# Staged-файлы (только добавленные/изменённые, только код)
STAGED=$(git diff --cached --name-only --diff-filter=ACM | grep -E '\.(html|js)$' | grep -v '^tests/' || true)

fail=0
for f in $STAGED; do
  [ -f "$f" ] || continue

  # 1) alert( в продакшн-коде — только тосты
  if grep -n 'alert(' "$f" | grep -v 'showToast\|// *alert\|windowAlert' >/dev/null 2>&1; then
    echo "БЛОК [$f]: alert( — используйте showToast"
    grep -n 'alert(' "$f" | grep -v 'showToast' | head -3
    fail=1
  fi

  # 2) .sort() рядом с date без parseDMY/parsePeriod (та же строка)
  if grep -n '\.sort(' "$f" | grep -i 'date\|\.period' | grep -v 'parseDMY\|parsePeriod\|parseDMYtoDate' >/dev/null 2>&1; then
    echo "БЛОК [$f]: сортировка дат/периодов без parseDMY/parsePeriod"
    grep -n '\.sort(' "$f" | grep -i 'date\|\.period' | grep -v 'parseDMY\|parsePeriod' | head -3
    fail=1
  fi

  # 3) console.log (не error/warn) в продакшн-коде
  if grep -n 'console\.log(' "$f" >/dev/null 2>&1; then
    echo "БЛОК [$f]: console.log в продакшн-коде — уберите или замените на console.error"
    grep -n 'console\.log(' "$f" | head -3
    fail=1
  fi

  # 4) new Date() в налоговых/бизнес контекстах вместо mskNow()
  # Ищем: const now = new Date() или new Date().getMonth()/getFullYear() — но не в autoTheme и не в export-именах
  if grep -n 'const now = new Date()\|new Date()\.getMonth\|new Date()\.getFullYear\|new Date()\.getDate' "$f" \
     | grep -v 'autoTheme\|getHours' >/dev/null 2>&1; then
    echo "ПРЕДУПРЕЖДЕНИЕ [$f]: new Date() в бизнес-логике — проверьте, нужен ли mskNow() (Железное правило #7)"
    grep -n 'const now = new Date()\|new Date()\.getMonth\|new Date()\.getFullYear' "$f" | grep -v 'autoTheme\|getHours' | head -3
  fi
done

# 4) Лимит Vercel Hobby: максимум 12 serverless-функций в /api
API_COUNT=$(ls api/*.js 2>/dev/null | wc -l | tr -d ' ')
if [ "$API_COUNT" -gt 12 ]; then
  echo "БЛОК: в /api $API_COUNT файлов (лимит Vercel Hobby — 12). Объедините ресурсы через ?resource=/?action= в существующем файле."
  fail=1
fi

if [ "$fail" -ne 0 ]; then
  echo ""
  echo "Коммит заблокирован pre-commit хуком. Исправьте и повторите."
  exit 1
fi
echo "pre-commit: OK (api: $API_COUNT/12)"
