#!/bin/sh
# OMSFIN smoke-тест деплоя: одна команда — полная проверка, что прод жив.
# Использование: sh scripts/smoke.sh [https://домен]  (по умолчанию прод)

BASE="${1:-https://omschicken-u5dn.vercel.app}"
fail=0

check_page() { # url, маркер, имя
  body=$(curl -s --max-time 15 "$BASE$1")
  if [ -z "$body" ]; then echo "✗ $3 — пустой ответ"; fail=1; return; fi
  if echo "$body" | grep -q "$2"; then echo "✓ $3"; else echo "✗ $3 — маркер «$2» не найден"; fail=1; fi
}

check_api() { # url, имя (ждём валидный JSON и не-5xx)
  code=$(curl -s -o /tmp/oms_smoke_body -w '%{http_code}' --max-time 15 "$BASE$1")
  body=$(cat /tmp/oms_smoke_body)
  case "$code" in
    5*) echo "✗ API $2 — HTTP $code"; fail=1; return;;
    000) echo "✗ API $2 — нет ответа"; fail=1; return;;
  esac
  # Валидный JSON? (401/403 с JSON-ошибкой — норм для неавторизованного smoke)
  if echo "$body" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{JSON.parse(d);process.exit(0)}catch(e){process.exit(1)}})"; then
    echo "✓ API $2 (HTTP $code, JSON ok)"
  else
    echo "✗ API $2 — не JSON: $(echo "$body" | head -c 80)"; fail=1
  fi
}

echo "── Smoke-тест: $BASE"
echo "── Страницы (200 + маркер)"
check_page "/"                    "bento-top"          "Дашборд"
check_page "/analytics"           "cashflowAlertTop"   "Аналитика"
check_page "/docs"                "generic-form"       "Документы"
check_page "/declarations"        "deadlineHero"       "Декларации"
check_page "/vat"                 "summaryContent"     "НДС"
check_page "/payroll"             "payrollHero"        "Зарплата"
check_page "/counterparty"        "searchInput"        "Контрагенты"
check_page "/calendar"            "next3Cards"         "Календарь"
check_page "/settings"            "settings-nav"       "Настройки"
check_page "/tools"               "tools-grid"         "Инструменты"
check_page "/warehouse"           "statValue"          "Склад"
check_page "/marketplace"         "uploadZone"         "Маркетплейсы"
check_page "/login"               "loginEmail"         "Вход"
check_page "/landing"             "hero"               "Лендинг"
check_page "/utils.js"            "safeFetch"          "utils.js (core)"
check_page "/js/calc.js"          "ndflProgressive"    "calc.js"
check_page "/styles/design-system.css" "glass"         "design-system.css"

echo "── API (валидный JSON, не 5xx)"
check_api "/api/companies?action=health" "companies health"
check_api "/api/companies"               "companies (401 без токена — ок)"
check_api "/api/transactions"            "transactions (401 без токена — ок)"

echo ""
if [ "$fail" -ne 0 ]; then echo "SMOKE: ПРОВАЛ"; exit 1; else echo "SMOKE: всё живое"; fi
