// ═══════════════════════════════════════════════════════════════════════════
// OMSFIN · Слой 2 — ИИ-агент. ЕДИНСТВЕННАЯ точка вызова Claude.
// ═══════════════════════════════════════════════════════════════════════════
// Прямые вызовы Anthropic из других файлов запрещены — всё сюда.
//
//   POST /api/ai   body: { action, ...payload }
//   Authorization: Bearer <user-token>  ИЛИ  Bearer <CRON_SECRET> (внутренний вызов)
//
//   action=classify  {description, amount, company_id}  → {category,type,confidence,vat_rate}
//                    keyword-first (calc.js): при confidence>=0.75 Claude НЕ вызывается.
//   action=analyze   {question, context}                → текстовый ответ на русском
//   action=forecast  {currentKop, events, context}      → прогноз + разрыв (calc.projectBalance)
//   action=audit     {aggregates}                       → список аномалий
//   action=extract   {text} | {image_base64, media_type}→ реквизиты документа (JSON)
//
// Защита от перерасхода: кеш (ai_cache), лог (ai_usage), при >150k токенов/день
// classify уходит в keyword-only, тяжёлые действия отвечают «лимит исчерпан».
// ═══════════════════════════════════════════════════════════════════════════

import OMSCALC from '../js/calc.js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const CRON_SECRET = process.env.CRON_SECRET;
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;

const MODEL = 'claude-opus-4-8';
const DAILY_TOKEN_SOFT = 50000;    // мягкий порог → уведомление (не реализуем алерт здесь)
const DAILY_TOKEN_HARD = 150000;   // жёсткий → classify keyword-only, тяжёлые действия off

const adminHeaders = {
  'apikey': SERVICE_KEY,
  'Authorization': 'Bearer ' + SERVICE_KEY,
  'Content-Type': 'application/json',
};

function mskNow() { return new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Moscow' })); }
function mskDate() { const d = mskNow(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }

// Стабильный хеш для ключей кеша (djb2).
function hashStr(s) {
  let h = 5381;
  const str = String(s);
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0;
  return 'h' + (h >>> 0).toString(36);
}

// Сумма токенов ИИ за сегодня (защита от перерасхода).
async function todayTokens() {
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/ai_usage?date=eq.${mskDate()}&select=tokens_in,tokens_out`, { headers: adminHeaders });
    const rows = await r.json();
    if (!Array.isArray(rows)) return 0;
    return rows.reduce((s, x) => s + (x.tokens_in || 0) + (x.tokens_out || 0), 0);
  } catch (e) { return 0; }
}

async function logUsage(companyId, action, usage) {
  const tin = usage?.input_tokens || 0, tout = usage?.output_tokens || 0;
  // Opus 4.8: $5/1M вход, $25/1M выход. Курс ~95 ₽/$ (грубая оценка для мониторинга).
  const costRub = ((tin * 5 + tout * 25) / 1e6) * 95;
  await fetch(`${SUPABASE_URL}/rest/v1/ai_usage`, {
    method: 'POST', headers: adminHeaders,
    body: JSON.stringify({ company_id: companyId || null, action, tokens_in: tin, tokens_out: tout, requests_count: 1, cost_rub: Math.round(costRub * 100) / 100 }),
  }).catch(() => {});
}

async function cacheGet(hash) {
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/ai_cache?hash=eq.${encodeURIComponent(hash)}&limit=1`, { headers: adminHeaders });
    const rows = await r.json();
    return Array.isArray(rows) && rows[0] ? rows[0].result : null;
  } catch (e) { return null; }
}
async function cacheSet(hash, promptHash, result, tokens) {
  await fetch(`${SUPABASE_URL}/rest/v1/ai_cache`, {
    method: 'POST', headers: { ...adminHeaders, 'Prefer': 'resolution=merge-duplicates' },
    body: JSON.stringify({ hash, prompt_hash: promptHash, result, tokens_used: tokens || 0 }),
  }).catch(() => {});
}

// Единственный вызов Claude. content — строка или массив блоков (для vision).
async function callClaude({ system, content, maxTokens = 1024, companyId, action }) {
  if (!ANTHROPIC_KEY) throw new Error('ANTHROPIC_API_KEY не настроен');
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: MODEL, max_tokens: maxTokens,
      system: system || undefined,
      messages: [{ role: 'user', content }],
    }),
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data?.error?.message || `Claude ${r.status}`);
  await logUsage(companyId, action, data.usage);
  const text = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('').trim();
  return { text, usage: data.usage };
}

// Достать первый JSON-объект из ответа модели (защита от обёрток/текста вокруг).
function parseJsonLoose(text) {
  if (!text) return null;
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch (e) { return null; }
}

// ─── ACTION: classify ───────────────────────────────────────────────────────
async function actClassify(body, companyId, degraded) {
  const description = String(body.description || '');
  const kw = OMSCALC.keywordCategory(description);
  // Высокая уверенность ИЛИ режим экономии → без Claude.
  if (kw.confidence >= 0.75 || degraded) {
    return { ...kw, source: degraded ? 'keyword-degraded' : 'keyword', needs_review: kw.confidence < 0.75 };
  }
  const key = hashStr('classify:' + (companyId || '') + ':' + description.toLowerCase().slice(0, 120));
  const cached = await cacheGet(key);
  if (cached) return { ...cached, source: 'cache' };

  const system = 'Ты — бухгалтер РФ. Классифицируй банковскую операцию по описанию. ' +
    'Ответь ТОЛЬКО JSON без пояснений: {"category":"income|chicken|salary|tax|office|transport|bank|transit|unknown","type":"income|expense|transfer|salary|tax","confidence":0.0-1.0,"vat_rate":0|10|22|null}. ' +
    'chicken = закупка товара/сырья. НДС 2026: базовая ставка 22%, льготная 10% (сырое мясо/базовые продукты).';
  const { text } = await callClaude({ system, content: `Описание операции: "${description}"`, maxTokens: 200, companyId, action: 'classify' });
  const parsed = parseJsonLoose(text) || kw;
  const result = {
    category: parsed.category || kw.category,
    type: parsed.type || kw.type,
    confidence: typeof parsed.confidence === 'number' ? parsed.confidence : kw.confidence,
    vat_rate: parsed.vat_rate === undefined ? null : parsed.vat_rate,
    needs_review: (parsed.confidence || 0) < 0.75,
  };
  await cacheSet(key, hashStr(description), result, 200);
  return { ...result, source: 'ai' };
}

// ─── ACTION: analyze ─────────────────────────────────────────────────────────
async function actAnalyze(body, companyId) {
  const question = String(body.question || '').slice(0, 500);
  const context = JSON.stringify(body.context || {}).slice(0, 6000);
  const system = 'Ты — финансовый аналитик для малого бизнеса РФ. Отвечай на русском, конкретно, ' +
    'с цифрами, без воды, до ~150 слов. Опирайся ТОЛЬКО на переданные агрегаты.';
  const { text } = await callClaude({ system, content: `Вопрос: ${question}\n\nДанные компании (агрегаты): ${context}`, maxTokens: 700, companyId, action: 'analyze' });
  return { answer: text };
}

// ─── ACTION: forecast ────────────────────────────────────────────────────────
async function actForecast(body, companyId) {
  const currentKop = Math.round(Number(body.currentKop || 0));
  const events = Array.isArray(body.events) ? body.events : [];
  const proj = OMSCALC.projectBalance(currentKop, events);
  let narrative = null;
  if (body.explain && ANTHROPIC_KEY) {
    const system = 'Ты — финансовый советник. Кратко (до 80 слов), на русском, объясни прогноз и риск кассового разрыва.';
    const ctx = { endBalance: proj.endBalanceKop / 100, firstNegativeDay: proj.firstNegativeDayOffset, eventsCount: events.length, context: body.context || {} };
    const { text } = await callClaude({ system, content: `Прогноз: ${JSON.stringify(ctx)}`, maxTokens: 300, companyId, action: 'forecast' });
    narrative = text;
  }
  return {
    firstNegativeDayOffset: proj.firstNegativeDayOffset,
    endBalanceKop: proj.endBalanceKop,
    timeline: proj.timeline,
    narrative,
  };
}

// ─── ACTION: audit ───────────────────────────────────────────────────────────
async function actAudit(body, companyId) {
  const aggregates = JSON.stringify(body.aggregates || {}).slice(0, 6000);
  const system = 'Ты — аудитор. По переданным агрегатам операций найди аномалии (без категории, ' +
    'необычно крупные, вероятные дубли, нетипичные контрагенты). Ответь ТОЛЬКО JSON: ' +
    '{"anomalies":[{"title":"...","detail":"...","severity":"low|med|high"}]}. Если чисто — пустой массив.';
  const { text } = await callClaude({ system, content: `Агрегаты периода: ${aggregates}`, maxTokens: 900, companyId, action: 'audit' });
  const parsed = parseJsonLoose(text);
  return { anomalies: (parsed && Array.isArray(parsed.anomalies)) ? parsed.anomalies : [] };
}

// ─── ACTION: extract (документ: текст или изображение) ───────────────────────
async function actExtract(body, companyId) {
  const system = 'Ты извлекаешь реквизиты из бухгалтерского документа РФ (счёт/акт/накладная/УПД). ' +
    'Ответь ТОЛЬКО JSON: {"doc_type":"invoice|act|contract|waybill|payslip|unknown","number":"","date":"DD.MM.YYYY","counterparty_name":"","counterparty_inn":"","amount_rub":0,"vat_rub":0,"positions":[{"name":"","sum_rub":0}]}.';
  let content;
  if (body.image_base64) {
    content = [
      { type: 'image', source: { type: 'base64', media_type: body.media_type || 'image/jpeg', data: body.image_base64 } },
      { type: 'text', text: 'Извлеки реквизиты этого документа.' },
    ];
  } else {
    content = `Текст документа:\n${String(body.text || '').slice(0, 8000)}`;
  }
  const { text } = await callClaude({ system, content, maxTokens: 1200, companyId, action: 'extract' });
  return parseJsonLoose(text) || { doc_type: 'unknown', error: 'не удалось распознать' };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Только POST' });
  if (!SUPABASE_URL || !SERVICE_KEY) return res.status(503).json({ error: 'Сервис не настроен' });

  // Авторизация: пользовательский токен ИЛИ внутренний CRON_SECRET.
  const token = (req.headers.authorization || '').replace('Bearer ', '').trim();
  let userId = null, internal = false;
  if (token && CRON_SECRET && token === CRON_SECRET) internal = true;
  else if (token) {
    try {
      const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { 'apikey': SUPABASE_KEY, 'Authorization': 'Bearer ' + token } });
      const d = await r.json();
      userId = d.id || null;
    } catch (e) { /* ниже 401 */ }
  }
  if (!internal && !userId) return res.status(401).json({ error: 'Не авторизован' });

  const body = req.body || {};
  const action = body.action || req.query.action || '';
  const companyId = body.company_id || null;

  try {
    const used = await todayTokens();
    const degraded = used >= DAILY_TOKEN_HARD;

    if (action === 'classify') {
      return res.status(200).json(await actClassify(body, companyId, degraded));
    }
    // Тяжёлые действия при исчерпании лимита — отказ (защита бюджета).
    if (degraded) return res.status(429).json({ error: 'Дневной лимит ИИ исчерпан — попробуйте завтра', tokens_today: used });

    if (action === 'analyze')  return res.status(200).json(await actAnalyze(body, companyId));
    if (action === 'forecast') return res.status(200).json(await actForecast(body, companyId));
    if (action === 'audit')    return res.status(200).json(await actAudit(body, companyId));
    if (action === 'extract')  return res.status(200).json(await actExtract(body, companyId));

    return res.status(400).json({ error: 'Неизвестное действие. classify|analyze|forecast|audit|extract' });
  } catch (e) {
    // Классификация никогда не должна ронять конвейер — падаем в keyword.
    if (action === 'classify') {
      return res.status(200).json({ ...OMSCALC.keywordCategory(body.description || ''), source: 'keyword-fallback', error: String(e.message || e).slice(0, 120) });
    }
    return res.status(500).json({ error: String(e.message || e).slice(0, 200) });
  }
}
