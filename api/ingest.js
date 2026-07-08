// ═══════════════════════════════════════════════════════════════════════════
// OMSFIN · Слой 1 — Универсальный приёмник данных «всё попадает само»
// ═══════════════════════════════════════════════════════════════════════════
// Один файл, чтобы не выйти за лимит Vercel Hobby (12 функций).
//
//   POST /api/ingest?source=pos&secret=SECRET   — вебхук кассы (ККТ)
//        касса пробила чек → операции появляются в дашборде за секунды.
//        Каждая позиция чека = отдельная операция. Дедуп по (source, source_id).
//
//   GET  /api/ingest?action=process-queue        — дренаж очереди сбоев (ретраи)
//        Authorization: Bearer <CRON_SECRET>. Vercel Hobby гоняет cron раз в
//        сутки — как страховка; для минутного дренажа наведи внешний бесплатный
//        cron (cron-job.org) на этот URL с тем же секретом.
//
// Банковский вебхук уже живёт в transactions.js (?action=webhook) — не дублируем.
// ═══════════════════════════════════════════════════════════════════════════

import OMSCALC from '../js/calc.js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const CRON_SECRET = process.env.CRON_SECRET;
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

const adminHeaders = {
  'apikey': SERVICE_KEY,
  'Authorization': 'Bearer ' + SERVICE_KEY,
  'Content-Type': 'application/json',
};

// Москва — все бизнес-даты (Vercel исполняет в UTC).
function mskNow() {
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Moscow' }));
}

// Нормализация даты события в набор форматов проекта.
// Принимает ISO ('2026-06-01T10:30:00') или 'DD.MM.YYYY HH:MM:SS' (АТОЛ).
function normalizeDate(raw) {
  let d = null;
  if (raw) {
    const s = String(raw).trim();
    const m = s.match(/^(\d{2})\.(\d{2})\.(\d{4})/); // DD.MM.YYYY ...
    if (m) d = new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
    else { const t = new Date(s); if (!isNaN(t.getTime())) d = t; }
  }
  if (!d || isNaN(d.getTime())) d = mskNow();
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  return {
    date: `${dd}.${mm}.${yyyy}`,             // DD.MM.YYYY (legacy transactions.date)
    period: `${mm}.${yyyy}`,                  // MM.YYYY (legacy transactions.period)
    accountingPeriod: `${yyyy}-${mm}`,        // YYYY-MM (новое accounting_period)
    occurredAt: d.toISOString(),
  };
}

// Секрет вебхука → { company_id, user_id } из company_settings.
async function resolveCompany(secret) {
  if (!secret) return null;
  const r = await fetch(
    `${SUPABASE_URL}/rest/v1/company_settings?webhook_secret=eq.${encodeURIComponent(secret)}&limit=1`,
    { headers: adminHeaders }
  );
  const rows = await r.json().catch(() => []);
  if (!Array.isArray(rows) || !rows.length) return null;
  return { company_id: rows[0].company_id || null, user_id: rows[0].user_id || null };
}

// Разбор чека → массив строк transactions (legacy + новые поля Слоя 0).
// Дедуп по source_id уже отфильтрован вызывающим (existingIds).
function receiptToTransactions(receipt, company, existingIds) {
  const dt = normalizeDate(receipt.occurredAt);
  const sign = receipt.isReturn ? -1 : 1; // возврат уменьшает выручку
  const rows = [];
  receipt.positions.forEach((p, i) => {
    const sourceId = `${receipt.sourceId || 'noid'}#${i}`;
    if (existingIds && existingIds.has(sourceId)) return; // уже загружено
    const amountKop = sign * Math.abs(Math.round(p.amountKop));
    const amountRub = amountKop / 100;
    const vatRate = p.vatRate == null ? null : p.vatRate;
    const vatKop = vatRate ? Math.round(OMSCALC.vatFromGross(Math.abs(amountRub), vatRate) * 100) * sign : null;
    rows.push({
      // legacy-поля (чтобы операция сразу видна в существующем дашборде)
      company_id: company.company_id,
      user_id: company.user_id,
      date: dt.date,
      period: dt.period,
      amount: amountRub,
      name: p.name,
      category: 'income',            // касса = выручка; ИИ уточнит на Слое 2
      description: `Касса · ${receipt.format} · ${p.qty} шт`,
      hash: `pos_${receipt.sourceId || ''}_${i}`,
      // новые поля Слоя 0
      source: 'pos',
      source_id: sourceId,
      type: 'income',
      amount_kopeykas: amountKop,
      vat_rate: vatRate,
      vat_kopeykas: vatKop,
      occurred_at: dt.occurredAt,
      accounting_period: dt.accountingPeriod,
      raw_data: { format: receipt.format, position: p },
    });
  });
  return rows;
}

// Какие source_id этого чека уже есть в БД (для дедупа).
async function existingSourceIds(companyId, sourceIdList) {
  if (!companyId || !sourceIdList.length) return new Set();
  const inList = sourceIdList.map((s) => `"${encodeURIComponent(s)}"`).join(',');
  const r = await fetch(
    `${SUPABASE_URL}/rest/v1/transactions?company_id=eq.${encodeURIComponent(companyId)}&source=eq.pos&source_id=in.(${inList})&select=source_id`,
    { headers: adminHeaders }
  );
  const rows = await r.json().catch(() => []);
  return new Set(Array.isArray(rows) ? rows.map((x) => x.source_id) : []);
}

async function insertTransactions(rows) {
  if (!rows.length) return { ok: true, inserted: 0 };
  const r = await fetch(`${SUPABASE_URL}/rest/v1/transactions`, {
    method: 'POST',
    headers: { ...adminHeaders, 'Prefer': 'return=minimal' },
    body: JSON.stringify(rows),
  });
  if (!r.ok) {
    const err = await r.text().catch(() => '');
    return { ok: false, error: err.slice(0, 300) };
  }
  return { ok: true, inserted: rows.length };
}

// Обработка одного сырого чека: разбор → дедуп → вставка операций.
async function processReceipt(payload, company) {
  const receipt = OMSCALC.parsePosReceipt(payload);
  if (!receipt || !receipt.positions.length) {
    return { ok: true, inserted: 0, skipped: 0, note: 'не распознан формат чека' };
  }
  const allIds = receipt.positions.map((_, i) => `${receipt.sourceId || 'noid'}#${i}`);
  const seen = await existingSourceIds(company.company_id, allIds);
  const rows = receiptToTransactions(receipt, company, seen);
  const ins = await insertTransactions(rows);
  if (!ins.ok) throw new Error(ins.error || 'ошибка вставки операций');
  return { ok: true, inserted: rows.length, skipped: allIds.length - rows.length };
}

// Положить сырьё в очередь (страховка при сбое синхронной обработки).
async function enqueue(company, source, payload, error) {
  await fetch(`${SUPABASE_URL}/rest/v1/processing_queue`, {
    method: 'POST',
    headers: adminHeaders,
    body: JSON.stringify({
      company_id: company ? company.company_id : null,
      source, raw_data: payload, status: 'pending', attempts: 1,
      error: error ? String(error).slice(0, 300) : null,
    }),
  }).catch(() => {});
}

// Уведомить директоров компании в Telegram (после 3 провалов обработки).
async function notifyDirectors(companyId, text) {
  if (!BOT_TOKEN || !companyId) return;
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/company_members?company_id=eq.${companyId}&role=eq.director&select=user_id`, { headers: adminHeaders });
    const dirs = await r.json();
    for (const d of (Array.isArray(dirs) ? dirs : [])) {
      const tg = await fetch(`${SUPABASE_URL}/rest/v1/telegram_users?user_id=eq.${d.user_id}&limit=1`, { headers: adminHeaders });
      const rows = await tg.json();
      if (Array.isArray(rows) && rows[0]) {
        await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: rows[0].telegram_id, text, parse_mode: 'HTML' }),
        });
      }
    }
  } catch (e) { /* уведомление не должно ронять обработку */ }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (!SUPABASE_URL || !SERVICE_KEY) {
    return res.status(503).json({ error: 'Сервис не настроен (env)' });
  }

  const action = req.query.action || '';
  const source = req.query.source || '';

  // ── Дренаж очереди сбоев (cron / внешний пингер) ──────────────────────────
  if (action === 'process-queue') {
    const auth = (req.headers.authorization || '').replace('Bearer ', '').trim();
    if (!CRON_SECRET || auth !== CRON_SECRET) return res.status(401).json({ error: 'Не авторизован' });

    const nowIso = mskNow().toISOString();
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/processing_queue?status=in.(pending,failed)&or=(next_retry_at.is.null,next_retry_at.lte.${nowIso})&order=created_at.asc&limit=20`,
      { headers: { ...adminHeaders, 'Prefer': 'return=representation' } }
    );
    const jobs = await r.json().catch(() => []);
    let done = 0, failed = 0;
    for (const job of (Array.isArray(jobs) ? jobs : [])) {
      try {
        const company = { company_id: job.company_id, user_id: null };
        const result = await processReceipt(job.raw_data, company);
        await fetch(`${SUPABASE_URL}/rest/v1/processing_queue?id=eq.${job.id}`, {
          method: 'PATCH', headers: adminHeaders,
          body: JSON.stringify({ status: 'done', result }),
        });
        done++;
      } catch (e) {
        failed++;
        const attempts = (job.attempts || 0) + 1;
        const patch = {
          attempts, error: String(e.message || e).slice(0, 300),
          status: attempts >= 3 ? 'failed' : 'pending',
          next_retry_at: new Date(Date.now() + 5 * 60000).toISOString(),
        };
        await fetch(`${SUPABASE_URL}/rest/v1/processing_queue?id=eq.${job.id}`, {
          method: 'PATCH', headers: adminHeaders, body: JSON.stringify(patch),
        });
        if (attempts >= 3) {
          await notifyDirectors(job.company_id, `⚠️ <b>OMSFIN: не удалось обработать входящие данные</b>\n\nИсточник: ${job.source}\nОшибка: ${String(e.message || e).slice(0, 120)}\n\nПроверьте в системе.`);
        }
      }
    }
    return res.status(200).json({ ok: true, processed: (jobs || []).length, done, failed });
  }

  // ── Вебхук кассы (ККТ) ────────────────────────────────────────────────────
  if (req.method === 'POST' && source === 'pos') {
    const secret = req.query.secret || '';
    const company = await resolveCompany(secret);
    if (!company) return res.status(401).json({ error: 'Неверный секрет вебхука' });

    const payload = req.body || {};
    try {
      // Быстрый путь: разобрать и вставить синхронно (< 2с для обычного чека).
      const result = await processReceipt(payload, company);
      return res.status(200).json(result);
    } catch (e) {
      // Сбой → в очередь на ретрай, касса получает ok (чек не потеряется).
      await enqueue(company, 'pos', payload, e.message || e);
      return res.status(200).json({ ok: true, queued: true, note: 'обработка отложена (ретрай)' });
    }
  }

  return res.status(400).json({ error: 'Укажите ?source=pos (POST) или ?action=process-queue (GET)' });
}
