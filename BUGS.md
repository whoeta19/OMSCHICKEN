# BUGS.md — полный аудит OMSFIN (Контур 2, мастер-проход)

Дата: 04.07.2026. Каждая запись: файл:строка · суть · серьёзность.

---

## КЛАСС A — ДАННЫЕ (критично, ломает цифры)

### A1. Сортировка «MM.YYYY» строкой — неверный хронологический порядок
- **calendar.html:378** — `Object.keys(byMonth).sort()` — ключи вида «MM.YYYY» (например «01.2026», «12.2025»). **БАГ**: строковая сортировка ставит «12.2025» после «01.2026» в ASCII, но хронологически «12.2025» раньше → неверный порядок истории платежей.
- **index.html:3756** — `Object.entries(byMonth).sort(([a],[b])=>a.localeCompare(b))` — тот же баг: «12.2025» > «01.2026» лексически, но хронологически раньше. Неверный порядок тренда в AI-ответчике.
- **Лечение:** `sort((a,b)=>parsePeriod(a)-parsePeriod(b))` из utils.js.
- **analytics.html:534** — `Object.keys(byYear).sort()` — ключи «2025», «2026» — строковая сортировка здесь корректна (ISO-год, 4 цифры). Не баг, зафиксировано.

### A2. Float-арифметика в налоговых расчётах
- **declarations.html:789,794** — `totalSales * 10/110` во float → ошибка на копейки при больших суммах.
- **declarations.html:866,867** — аналогично, НДС из reduce-суммы.
- **declarations.html:937,941,1400,1401** — то же, дублирующийся блок расчёта НДС.
- **vat.html:617** — `Math.round(amount * 10 / 110)` — Math.round спасает в большинстве случаев, но не всегда при больших суммах.
- **Лечение (Контур 3):** Использовать `OMSCALC.vatFromGross(gross, 10)` и `OMSCALC.toKop()` для суммирования.

### A3. Дублирование расчётных массивов НДФЛ (не совпадение с calc.js)
- **tools.html:530-542** — локальный массив `NDFL_BRACKETS` (копия 1 из 2 на странице). Если ставки поменяются — надо менять в 3 местах (calc.js + 2 в tools.html).
- **tools.html:756-762** — второй дубль. При расхождении с calc.js дадут разные цифры.
- **Лечение:** Заменить на `OMSCALC.ndflProgressive(income)`.

### A4. Захардкоженный НДС 10% (известное упрощение)
- **declarations.html, vat.html** — все расчёты НДС используют 10/110. Корректно для ОМСЧИКЕН (сырое мясо), но TODO для мультиставки при расширении. Не срочный баг.

---

## КЛАСС B — НАДЁЖНОСТЬ (критично, ломает работу)

### B1. XSS — item.name и item.category без escapeHtml в warehouse
- **warehouse.html:381** — `${item.name}` в innerHTML напрямую. Имя товара вводит пользователь → `<img src=x onerror=alert(1)>` выполнится у всех пользователей компании.
- **warehouse.html:382** — `${item.category || ''}` — аналогично.
- **Серьёзность:** Высокая — хранимый XSS.

### B2. Двойная отправка форм (нет disabled при submit)
- **settings.html:624** — `saveRequisites()` — нет disabled на кнопке во время запроса.
- **settings.html:939** — `saveNotifications()` — аналогично.
- **warehouse.html:452** — `saveItem()` — нет защиты.
- **warehouse.html:528** — `saveMove()` — нет защиты.
- **docs.html:509** — `saveHistory()` — нет защиты.
- **onboarding.html:134** — `saveRequisites()` — нет защиты. Критично: дублирует компанию.
- **analytics.html:999** — `saveBudgetEdit()` — нет защиты.

### B3. fetch без .ok или без try/catch
- **login.html:152** — Telegram auth fetch — `.ok` не проверяется. При 5xx форма зависнет.
- **login.html:160** — `/auth/v1/verify` — аналогично.
- **vat.html:354** — `await fetch(url)` внутри try/catch есть, но нет проверки `r.ok` — при 401/500 парсит тело как успешный ответ.
- **declarations.html:684** — аналогично.
- **counterparty.html:736** — аналогично.

### B4. Накопление setInterval при повторном вызове
- **index.html:4423** — `setInterval(tick, 1000)` внутри функции без clearInterval и без глобального флага. При повторном вызове функции таймеры умножаются → нарастающий tick-шторм.

---

## КЛАСС C — UX-БАГИ (средне)

### C1. confirm() вместо кастомного диалога — 8 мест
- **index.html:2534** — `confirm('Удалить ВСЕ данные за все месяцы?')`
- **index.html:2547** — `confirm('Удалить операции за ${lastUploadedPeriod}...')`
- **payroll.html:257** — `confirm('Уволить сотрудника?')`
- **settings.html:903** — `confirm('Убрать этого участника...')`
- **settings.html:956** — `confirm('Удалить аккаунт безвозвратно?')`
- **settings.html:957** — второй confirm для удаления аккаунта
- **settings.html:1208** — `confirm('Старый URL перестанет работать.')`
- **warehouse.html:487** — `confirm('Удалить товар...')`

### C2. Нет skeleton-состояния при загрузке
- **vat.html** — пустой экран до загрузки данных.
- **warehouse.html** — таблица товаров без skeleton.
- **counterparty.html** — история платежей без skeleton.
- **declarations.html** — таблицы расчётов без индикации.

### C3. Технические тексты ошибок
- **vat.html, declarations.html** — при ошибке API: `❌ Ошибка 401` вместо «Войдите заново» или «Попробуйте ещё раз».

---

## КЛАСС D — МОБИЛЬНЫЙ (средне)

### D1. Таблицы без горизонтального скролла
- **declarations.html:1499** — таблица РСВ без обёртки `overflow-x:auto` → вылезает за viewport на мобиле.
- **docs.html:467** — таблица позиций документа без скролл-контейнера.

### D2. Мелкие тап-цели (<44px)
- **index.html** — кнопки «✕» удаления правил категоризации (~28px).
- **settings.html** — кнопка удаления участника команды (~32px).
- **payroll.html** — кнопка «Уволить» в строке таблицы.

---

## КЛАСС E — КОД (мелочь но важно)

### E1. console.log в production коде
- Не найдено ни одного — чисто ✅

### E2. Дубль форматтера fmt2 в index.html
- **index.html:4612** — `function fmt2(n)` — локальный дубль `fmtMoney`. Заменить.

### E3. parseDMYtoDate не в utils.js
- **index.html:3057** — `parseDMYtoDate()` возвращает `Date` (не timestamp). Полезная функция, но изолирована в index.html. Добавить в utils.js как `toDMYDate()`.

---

## Итоговый счёт по приоритетам

| Класс | Найдено | Самое опасное |
|-------|---------|---------------|
| A — Данные | 4 пункта | A1: неверный порядок месяцев |
| B — Надёжность | 4 пункта | B1: XSS склад; B4: tick-шторм |
| C — UX | 3 пункта | C1: 8 confirm() |
| D — Мобильный | 2 пункта | D1: таблицы без скролла |
| E — Код | 2 пункта | E2: дубль |

---

## План исправлений

1. **Коммит B→A (критично):** B1 XSS warehouse + A1 сортировка MM.YYYY
2. **Коммит B2:** disabled на кнопках при submit (settings, warehouse, onboarding, docs)
3. **Коммит B3:** .ok + try/catch в vat.html, declarations.html, counterparty.html, login.html
4. **Коммит B4:** фикс накопления setInterval
5. **Коммит C1:** 8 confirm() → кастомный диалог confirm из utils.js
6. **Коммит C2:** skeleton-состояния на vat, warehouse, counterparty, declarations
7. **Коммит D:** overflow-x:auto на таблицы; min-height:44px на мелкие кнопки
8. **Коммит E:** fmt2→fmtMoney; NDFL_BRACKETS→OMSCALC; toDMYDate в utils.js
