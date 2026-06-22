const BOT_TOKEN = '8514433988:AAHvGhmxdIICzzEfXlfe2OIjB_Ynn3gLJao';
const SUPABASE_URL = 'https://sqyppamdxahvvkoxovpu.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNxeXBwYW1keGFodnZrb3hvdnB1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODAxNjQ2MzgsImV4cCI6MjA5NTc0MDYzOH0.tezDMDqlkzlWG0t8zBFyb3tJylFCeySgPByVKLkdlsM';
const SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNxeXBwYW1keGFodnZrb3hvdnB1Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MDE2NDYzOCwiZXhwIjoyMDk1NzQwNjM4fQ.CjCybI9bSk1uYbjWl8clQDPPzB7exzUa029DUtPQen8';

const adminHeaders = {
  'apikey': SERVICE_KEY,
  'Authorization': 'Bearer ' + SERVICE_KEY,
  'Content-Type': 'application/json'
};

// Роли, которым разрешено изменять финансовые данные (создание/правка/удаление транзакций)
const WRITE_ROLES = ['director', 'accountant'];
// Чтение разрешено всем участникам компании, включая employee (нужно для привязки сумм в документах)
const READ_ROLES = ['director', 'accountant', 'employee'];

async function getUserRole(companyId, userId) {
  if (!companyId || !userId) return null;
  const r = await fetch(`${SUPABASE_URL}/rest/v1/company_members?company_id=eq.${companyId}&user_id=eq.${userId}&limit=1`, {
    headers: { ...adminHeaders, 'Prefer': 'return=representation' }
  });
  const d = await r.json();
  return d[0]?.role || null;
}

function fmtAmt(n) {
  return Math.abs(n).toLocaleString('ru-RU', {maximumFractionDigits: 0}) + ' ₽';
}

async function notifyBigTx(userId, tx) {
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/telegram_users?user_id=eq.${userId}&limit=1`, {
      headers: {...adminHeaders, 'Prefer': 'return=representation'}
    });
    const rows = await r.json();
    if (!Array.isArray(rows) || !rows.length) return;
    const chatId = rows[0].telegram_id;
    const text = `⚠️ <b>Крупное списание</b>\n\n` +
      `Контрагент: <b>${tx.name || '—'}</b>\n` +
      `Сумма: <b>${fmtAmt(tx.amount)}</b>\n` +
      `Дата: <b>${tx.date || '—'}</b>\n` +
      (tx.description ? `Назначение: ${tx.description}\n` : '') +
      `\n<a href="https://omschicken-u5dn.vercel.app/">Открыть OMSFIN →</a>`;
    await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({chat_id: chatId, text, parse_mode: 'HTML'})
    });
  } catch(e) {}
}

// Записывает значимое действие в audit_log — не блокирует основной запрос при ошибке
async function logAction(companyId, userId, action, details) {
  if (!companyId || !userId) return;
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/audit_log`, {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({ company_id: companyId, user_id: userId, action, details: details || {} })
    });
  } catch (e) {
    // Журналирование не должно ломать основной запрос — молча игнорируем
  }
}

// ─── Парсер 1С выписки (XML формат КВО — кассовые и банковские операции) ────
// Вызывается с ?source=1c, тело запроса — XML-строка (text/xml или text/plain)
// Возвращает массив транзакций в формате OMSFIN для дальнейшей вставки через POST
function parse1CXML(xml) {
  const txs = [];
  // Извлекаем документы ПоступлениеНаСчет / СписаниеСоСчета
  const docRe = /<(ПоступлениеНаСчет|СписаниеСоСчета|Документ)([^>]*)>([\s\S]*?)<\/\1>/g;
  // Также поддерживаем формат обмена платёжками (тег РасчетныйДокумент)
  const lineRe = /<РасчетныйДокумент([^>]*)>([\s\S]*?)<\/РасчетныйДокумент>/g;

  function extractTag(str, tag) {
    const m = str.match(new RegExp(`<${tag}[^>]*>([^<]*)<\\/${tag}>`));
    return m ? m[1].trim() : '';
  }

  function parseDate1C(str) {
    // 1С дата: YYYYMMDD или DD.MM.YYYY
    if (!str) return '';
    if (/^\d{8}$/.test(str)) {
      return `${str.slice(6,8)}.${str.slice(4,6)}.${str.slice(0,4)}`;
    }
    return str; // уже DD.MM.YYYY
  }

  function parsePeriod(date) {
    if (!date) return '';
    const parts = date.split('.');
    if (parts.length === 3) return `${parts[1]}.${parts[2]}`;
    return '';
  }

  // Обрабатываем оба формата
  let m;
  while ((m = docRe.exec(xml)) !== null) {
    const tag = m[1], body = m[3];
    const isIncome = tag === 'ПоступлениеНаСчет';
    const sumStr = extractTag(body, 'Сумма') || extractTag(body, 'СуммаДокумента');
    const sum = parseFloat(sumStr.replace(',', '.')) || 0;
    if (!sum) continue;
    const date = parseDate1C(extractTag(body, 'Дата') || extractTag(body, 'ДатаДокумента'));
    const name = extractTag(body, 'Контрагент') || extractTag(body, 'НаименованиеКонтрагента') || '';
    const inn = extractTag(body, 'ИНН') || extractTag(body, 'ИННКонтрагента') || '';
    const desc = extractTag(body, 'НазначениеПлатежа') || extractTag(body, 'Комментарий') || '';
    const amount = isIncome ? sum : -sum;
    const hash = `1c_${date}_${amount}_${(name+desc).replace(/\s/g,'').slice(0,20)}`;
    txs.push({ date, amount, name, inn, description: desc, period: parsePeriod(date), hash, category: 'unknown', source: '1c' });
  }

  // Формат платёжек
  while ((m = lineRe.exec(xml)) !== null) {
    const attrs = m[1], body = m[2];
    const isIncome = /ВидОперации="Поступление"/.test(attrs) || extractTag(body,'ВидОперации') === 'Поступление';
    const sumStr = extractTag(body, 'Сумма');
    const sum = parseFloat(sumStr.replace(',', '.')) || 0;
    if (!sum) continue;
    const date = parseDate1C(extractTag(body, 'Дата'));
    const name = extractTag(body, 'Контрагент');
    const inn = extractTag(body, 'ИНН');
    const desc = extractTag(body, 'НазначениеПлатежа');
    const amount = isIncome ? sum : -sum;
    const hash = `1c_${date}_${amount}_${(name+desc).replace(/\s/g,'').slice(0,20)}`;
    txs.push({ date, amount, name, inn, description: desc, period: parsePeriod(date), hash, category: 'unknown', source: '1c' });
  }

  return txs;
}


// ─── Импорт из МойСклад API ──────────────────────────────────────────────────
async function handleMoySklad(req, res, userId, companyId) {
  const msToken = req.headers['x-moysklad-token'];
  if (!msToken) return res.status(400).json({ error: 'Заголовок X-MoySklad-Token обязателен' });

  const BASE = 'https://api.moysklad.ru/api/remap/1.2';
  const headers = { 'Authorization': 'Bearer ' + msToken, 'Accept-Encoding': 'gzip' };
  const limit = parseInt(req.query.limit || '200');

  function msDate(str) {
    if (!str) return '';
    const d = new Date(str);
    return `${String(d.getDate()).padStart(2,'0')}.${String(d.getMonth()+1).padStart(2,'0')}.${d.getFullYear()}`;
  }
  function msPeriod(str) {
    if (!str) return '';
    const d = new Date(str);
    return `${String(d.getMonth()+1).padStart(2,'0')}.${d.getFullYear()}`;
  }

  const txs = [];

  for (const [endpoint, sign] of [['/entity/paymentin', 1], ['/entity/paymentout', -1]]) {
    try {
      const r = await fetch(`${BASE}${endpoint}?limit=${limit}&order=moment%2Cdesc`, { headers });
      if (!r.ok) continue;
      const data = await r.json();
      for (const row of (data.rows || [])) {
        const amount = Math.round((row.sum || 0) / 100) * sign;
        if (!amount) continue;
        const date = msDate(row.moment);
        const name = row.agent?.name || '';
        const desc = row.description || row.name || '';
        const hash = `ms_${row.id}`;
        txs.push({ date, amount, name, description: desc, period: msPeriod(row.moment), hash, category: 'unknown', source: 'moysklad',
          ...(userId ? {user_id: userId} : {}),
          ...(companyId ? {company_id: companyId} : {})
        });
      }
    } catch(e) {}
  }

  return res.status(200).json({ ok: true, count: txs.length, transactions: txs });
}
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // Импорт из МойСклад API — возвращает транзакции для предпросмотра/вставки
  if (req.query.source === 'moysklad' && req.method === 'POST') {
    return await handleMoySklad(req, res, userId, companyId);
  }

  // Парсинг 1С выписки — возвращает массив транзакций без сохранения
  if (req.query.source === '1c' && req.method === 'POST') {
    const xmlBody = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
    const parsed = parse1CXML(xmlBody);
    return res.status(200).json({ ok: true, count: parsed.length, transactions: parsed });
  }

  const authHeader = req.headers.authorization || '';
  const userToken = authHeader.replace('Bearer ', '').trim();

  // Получаем user_id из токена
  let userId = null;
  if (userToken) {
    try {
      const userR = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
        headers: { 'apikey': SUPABASE_KEY, 'Authorization': 'Bearer ' + userToken }
      });
      const userData = await userR.json();
      userId = userData.id || null;
    } catch(e) {}
  }

  // company_id приходит по-разному в зависимости от метода и формы тела запроса
  function extractCompanyId(body) {
    if (!body) return null;
    if (Array.isArray(body)) return body[0]?.company_id || null;
    return body.company_id || null;
  }
  const companyId = req.method === 'GET'
    ? req.query.company_id
    : extractCompanyId(req.body);

  // Если указана компания — проверяем, что пользователь в ней состоит, и какая у него роль.
  // Без company_id (старые клиенты / одиночный режим без команды) — пускаем по user_id, как раньше.
  let role = null;
  if (companyId) {
    role = await getUserRole(companyId, userId);
    if (!role) {
      return res.status(403).json({ error: 'Вы не состоите в этой компании' });
    }
  }

  try {
    if (req.method === 'GET') {
      if (companyId && !READ_ROLES.includes(role)) {
        return res.status(403).json({ error: 'Недостаточно прав для просмотра операций' });
      }

      let filter;
      if (companyId) {
        filter = `?company_id=eq.${companyId}&order=date.desc&limit=5000`;
      } else if (userId) {
        filter = `?user_id=eq.${userId}&order=date.desc&limit=5000`;
      } else {
        filter = `?order=date.desc&limit=5000`;
      }

      const r = await fetch(`${SUPABASE_URL}/rest/v1/transactions${filter}`, {
        headers: {...adminHeaders, 'Prefer': 'return=representation'}
      });
      const data = await r.json();
      return res.status(200).json(Array.isArray(data) ? data : []);
    }

    if (req.method === 'POST') {
      if (companyId && !WRITE_ROLES.includes(role)) {
        return res.status(403).json({ error: 'Недостаточно прав для добавления операций' });
      }

      const payload = Array.isArray(req.body) ? req.body : [req.body];
      const payloadWithUser = payload.map(t => {
        const enriched = { ...t };
        delete enriched.company_id; // company_id не должен попадать дважды через spread ниже
        if (userId) enriched.user_id = userId;
        if (companyId) enriched.company_id = companyId;
        return enriched;
      });

      // Дедупликация по хэшу — если транзакция с таким же отпечатком (дата+сумма+описание)
      // уже сохранена для этой компании/пользователя, не вставляем её повторно.
      // Это защищает от задвоения при повторной или частично перекрывающейся загрузке выписки.
      const hashes = payloadWithUser.map(t => t.hash).filter(Boolean);
      let existingHashes = new Set();
      if (hashes.length) {
        const scopeFilter = companyId ? `company_id=eq.${companyId}` : (userId ? `user_id=eq.${userId}` : null);
        if (scopeFilter) {
          // Разбиваем на чанки по 100 — длинный URL с hash=in.(...) вызывает 400 от Supabase
          const chunkSize = 100;
          for (let ci = 0; ci < hashes.length; ci += chunkSize) {
            const chunk = hashes.slice(ci, ci + chunkSize);
            const hashList = chunk.map(h => `"${h}"`).join(',');
            try {
              const checkR = await fetch(`${SUPABASE_URL}/rest/v1/transactions?${scopeFilter}&hash=in.(${hashList})&select=hash`, {
                headers: { ...adminHeaders, 'Prefer': 'return=representation' }
              });
              if (checkR.ok) {
                const existing = await checkR.json();
                if (Array.isArray(existing)) existing.forEach(e => existingHashes.add(e.hash));
              }
            } catch (e) {
              // Если проверка дублей не прошла — пропускаем, вставим как есть
            }
          }
        }
      }

      const toInsert = payloadWithUser.filter(t => !t.hash || !existingHashes.has(t.hash));
      const skipped = payloadWithUser.length - toInsert.length;

      const batchSize = 50;
      for (let i = 0; i < toInsert.length; i += batchSize) {
        const batch = toInsert.slice(i, i + batchSize);
        const r = await fetch(`${SUPABASE_URL}/rest/v1/transactions`, {
          method: 'POST',
          headers: adminHeaders,
          body: JSON.stringify(batch)
        });
        if (!r.ok) {
          const err = await r.text();
          console.error('POST error:', err);
        }
      }
      // Уведомления о крупных списаниях — порог берём из заголовка запроса
      const threshold = parseInt(req.headers['x-big-tx-threshold'] || '0');
      if (threshold > 0 && userId) {
        const bigTxs = toInsert.filter(t => t.amount < 0 && Math.abs(t.amount) >= threshold);
        for (const tx of bigTxs) {
          notifyBigTx(userId, tx);
        }
      }

      return res.status(200).json({ ok: true, inserted: toInsert.length, skipped, count: payload.length });
    }

    if (req.method === 'PATCH') {
      if (companyId && !WRITE_ROLES.includes(role)) {
        return res.status(403).json({ error: 'Недостаточно прав для изменения операций' });
      }

      const { id, category, note, is_recurring, recurring_label } = req.body;
      const patch = {};
      if (category !== undefined) { patch.category = category; patch.is_personal = ['personal','food'].includes(category); }
      if (note !== undefined) patch.note = note;
      if (is_recurring !== undefined) patch.is_recurring = is_recurring;
      if (recurring_label !== undefined) patch.recurring_label = recurring_label;
      await fetch(`${SUPABASE_URL}/rest/v1/transactions?id=eq.${id}`, {
        method: 'PATCH',
        headers: adminHeaders,
        body: JSON.stringify(patch)
      });
      if (companyId && category !== undefined) logAction(companyId, userId, 'transaction_category_changed', { transaction_id: id, new_category: category });
      return res.status(200).json({ ok: true });
    }

    if (req.method === 'DELETE') {
      if (companyId && !WRITE_ROLES.includes(role)) {
        return res.status(403).json({ error: 'Недостаточно прав для удаления операций' });
      }

      const { period } = req.body || {};
      if (period && companyId) {
        await fetch(`${SUPABASE_URL}/rest/v1/transactions?period=eq.${encodeURIComponent(period)}&company_id=eq.${companyId}`, {
          method: 'DELETE',
          headers: adminHeaders
        });
        logAction(companyId, userId, 'transactions_deleted', { period });
      } else if (period && userId) {
        await fetch(`${SUPABASE_URL}/rest/v1/transactions?period=eq.${encodeURIComponent(period)}&user_id=eq.${userId}`, {
          method: 'DELETE',
          headers: adminHeaders
        });
      } else if (period) {
        await fetch(`${SUPABASE_URL}/rest/v1/transactions?period=eq.${encodeURIComponent(period)}`, {
          method: 'DELETE',
          headers: adminHeaders
        });
      } else {
        await fetch(`${SUPABASE_URL}/rest/v1/rpc/truncate_transactions`, {
          method: 'POST',
          headers: adminHeaders,
          body: '{}'
        });
      }
      return res.status(200).json({ ok: true });
    }
  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
}

