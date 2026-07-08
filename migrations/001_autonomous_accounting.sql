-- ═══════════════════════════════════════════════════════════════════════════
-- OMSFIN · Слой 0 — Фундамент данных для автономной бухгалтерии
-- ═══════════════════════════════════════════════════════════════════════════
-- Запуск: Supabase Dashboard → SQL Editor → вставить целиком → Run.
-- Идемпотентно (IF NOT EXISTS везде) — можно запускать повторно без вреда.
--
-- ПРИНЦИП: аддитивно. Существующая таблица transactions НЕ пересоздаётся —
-- на неё завязаны ~15 файлов и живые данные (date строкой DD.MM.YYYY,
-- amount в рублях, period MM.YYYY). Добавляем только новые колонки и таблицы.
-- Старый код продолжает работать без единого изменения.
--
-- ДЕНЬГИ: новые денежные поля — bigint в КОПЕЙКАХ (amount_kopeykas).
-- Старое поле transactions.amount (рубли) остаётся как есть для совместимости.
--
-- МУЛЬТИТЕНАНТНОСТЬ: каждая новая таблица имеет company_id — иначе повторим
-- класс IDOR-багов, который вычищался всю предыдущую сессию.
-- ═══════════════════════════════════════════════════════════════════════════

-- ─── 1. Расширение существующей transactions (аддитивно) ────────────────────
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS occurred_at        timestamptz;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS source             text;      -- pos|bank|manual|telegram|invoice
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS source_id          text;      -- внешний id источника (дедуп)
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS type               text;      -- income|expense|transfer|salary|tax|loan
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS subcategory        text;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS amount_kopeykas    bigint;    -- дубль amount в копейках (для точных расчётов)
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS currency           text DEFAULT 'RUB';
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS vat_rate           smallint;  -- 0|10|22
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS vat_kopeykas       bigint;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS counterparty_id    uuid;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS employee_id        uuid;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS document_id        uuid;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS raw_data           jsonb;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS ai_category_confidence real; -- 0.0..1.0
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS ai_flags           jsonb;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS reviewed_by        uuid;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS reviewed_at        timestamptz;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS accounting_period  text;      -- YYYY-MM (не путать с period MM.YYYY)

-- source_id уникален в рамках источника и компании — жёсткая дедупликация на уровне БД.
-- Частичный уникальный индекс: срабатывает только когда source_id задан.
CREATE UNIQUE INDEX IF NOT EXISTS uq_transactions_source
  ON transactions(company_id, source, source_id)
  WHERE source_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_transactions_counterparty ON transactions(counterparty_id);
CREATE INDEX IF NOT EXISTS idx_transactions_acc_period   ON transactions(company_id, accounting_period);
CREATE INDEX IF NOT EXISTS idx_transactions_type         ON transactions(company_id, type);

-- ─── 2. Контрагенты ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS counterparties (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id               uuid NOT NULL,
  inn                      text,
  kpp                      text,
  name                     text,
  type                     text,            -- ul|ip|fl
  bank_accounts            jsonb DEFAULT '[]'::jsonb,
  contact                  jsonb DEFAULT '{}'::jsonb,
  total_income_kopeykas    bigint DEFAULT 0,
  total_expense_kopeykas   bigint DEFAULT 0,
  last_transaction_at      timestamptz,
  risk_score               smallint,        -- 0..100
  egrul_data               jsonb,
  created_at               timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_counterparties_company ON counterparties(company_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_counterparties_inn
  ON counterparties(company_id, inn) WHERE inn IS NOT NULL;

-- ─── 3. Документы ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS documents (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id           uuid NOT NULL,
  type                 text,               -- invoice|act|contract|waybill|payslip
  number               text,
  date                 date,
  counterparty_id      uuid,
  amount_kopeykas      bigint,
  vat_kopeykas         bigint,
  status               text DEFAULT 'draft', -- draft|sent|signed|paid|overdue
  linked_transactions  jsonb DEFAULT '[]'::jsonb,
  file_url             text,
  raw_text             text,
  created_at           timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_documents_company ON documents(company_id);
CREATE INDEX IF NOT EXISTS idx_documents_status  ON documents(company_id, status);
CREATE INDEX IF NOT EXISTS idx_documents_cp      ON documents(counterparty_id);

-- ─── 4. Сотрудники — расширяем существующую таблицу employees аддитивно ──────
ALTER TABLE employees ADD COLUMN IF NOT EXISTS inn              text;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS salary_kopeykas  bigint;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS dismiss_date     date;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS terminal_ids     jsonb DEFAULT '[]'::jsonb;

-- ─── 5. Терминалы (кассы) ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS terminals (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   uuid NOT NULL,
  external_id  text,               -- id кассы у провайдера (Эвотор/АТОЛ/…)
  name         text,
  location     text,
  employee_id  uuid,
  created_at   timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_terminals_company ON terminals(company_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_terminals_external
  ON terminals(company_id, external_id) WHERE external_id IS NOT NULL;

-- ─── 6. Бюджеты ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS budgets (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        uuid NOT NULL,
  period            text,          -- MM.YYYY
  category          text,
  planned_kopeykas  bigint DEFAULT 0,
  actual_kopeykas   bigint DEFAULT 0,  -- пересчитывается триггером (Слой 3)
  created_at        timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_budgets_company ON budgets(company_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_budgets_period_cat
  ON budgets(company_id, period, category);

-- ─── 7. Налоговый календарь ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tax_events (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id           uuid NOT NULL,
  type                 text,          -- nds|usn|ndfl|vznosy|pribyl|…
  period               text,          -- MM.YYYY или квартал
  due_date             date,
  amount_kopeykas      bigint,
  status               text DEFAULT 'planned', -- planned|calculated|paid|overdue
  linked_transactions  jsonb DEFAULT '[]'::jsonb,
  created_at           timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_tax_events_company ON tax_events(company_id);
CREATE INDEX IF NOT EXISTS idx_tax_events_due     ON tax_events(company_id, due_date);

-- ─── 8. Очередь обработки (асинхронный конвейер Слоя 1) ──────────────────────
CREATE TABLE IF NOT EXISTS processing_queue (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid,
  created_at  timestamptz DEFAULT now(),
  source      text,               -- pos|bank|telegram|statement|document
  raw_data    jsonb,
  status      text DEFAULT 'pending', -- pending|processing|done|failed
  attempts    smallint DEFAULT 0,
  error       text,
  result      jsonb,
  next_retry_at timestamptz        -- для отложенного повтора (retry через 5 мин)
);
-- Индекс под выборку воркером: pending, готовые к обработке, старые вперёд.
CREATE INDEX IF NOT EXISTS idx_queue_pickup
  ON processing_queue(status, created_at)
  WHERE status IN ('pending', 'failed');

-- ─── 9. ИИ-кеш (агрессивная дедупликация запросов к Claude) ─────────────────
CREATE TABLE IF NOT EXISTS ai_cache (
  hash         text PRIMARY KEY,   -- хеш(company_id + action + нормализованный вход)
  prompt_hash  text,
  result       jsonb,
  created_at   timestamptz DEFAULT now(),
  tokens_used  integer DEFAULT 0
);

-- ─── 10. Учёт расхода токенов ИИ (защита от перерасхода) ────────────────────
CREATE TABLE IF NOT EXISTS ai_usage (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid,
  date            date DEFAULT (now() AT TIME ZONE 'Europe/Moscow')::date,
  action          text,           -- classify|extract|analyze|forecast|audit
  tokens_in       integer DEFAULT 0,
  tokens_out      integer DEFAULT 0,
  requests_count  integer DEFAULT 1,
  cost_rub        numeric(12,2) DEFAULT 0,
  created_at      timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ai_usage_day ON ai_usage(date);
CREATE INDEX IF NOT EXISTS idx_ai_usage_company_day ON ai_usage(company_id, date);

-- ═══════════════════════════════════════════════════════════════════════════
-- Готово. Триггеры автоматического учёта (Слой 3) и RLS — отдельными
-- миграциями, когда согласуем архитектуру функций (лимит Vercel).
-- ═══════════════════════════════════════════════════════════════════════════
