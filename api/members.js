import { randomBytes } from 'node:crypto';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

const adminHeaders = {
  'apikey': SERVICE_KEY,
  'Authorization': 'Bearer ' + SERVICE_KEY,
  'Content-Type': 'application/json'
};

// Роли и что они означают (для справки, проверка прав реальна на фронтенде + в каждом api/*.js по необходимости)
// director   — полный доступ: настройки, удаление, приглашения, всё
// accountant — операции, декларации, НДС, документы; без настроек/удаления компании/приглашений
// employee   — только создание документов; без доступа к финансовым разделам

// Человекочитаемые описания действий журнала — используются на фронтенде для отображения
const ACTION_LABELS = {
  transaction_category_changed: 'Изменена категория операции',
  transactions_deleted: 'Удалена выписка за период',
  member_joined: 'Новый участник присоединился',
  member_role_changed: 'Изменена роль участника',
  member_removed: 'Участник удалён из компании'
};

const ROLE_LABELS = { director: 'Директор', accountant: 'Бухгалтер', employee: 'Сотрудник' };

function generateCode() {
  // Криптостойкий рандом — код открывает доступ к финансовым данным компании,
  // Math.random() предсказуем (не подходит для секретов).
  return randomBytes(6).toString('hex').toUpperCase();
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

// Доверие/прозрачность: изменения состава команды (кто-то присоединился, кому-то
// сменили роль, кого-то удалили) уходят ВСЕМ директорам компании в Telegram —
// это ровно те события, которые директор хочет узнать немедленно, а не только
// при заходе в журнал действий.
async function getEmail(uid) {
  try {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${uid}`, { headers: adminHeaders });
    const d = await r.json();
    return d.email || uid;
  } catch (e) {
    return uid;
  }
}

async function notifyDirectors(companyId, text) {
  if (!BOT_TOKEN || !companyId) return;
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/company_members?company_id=eq.${companyId}&role=eq.director&select=user_id`, {
      headers: { ...adminHeaders, 'Prefer': 'return=representation' }
    });
    const directors = await r.json();
    if (!Array.isArray(directors) || !directors.length) return;
    for (const d of directors) {
      const tgR = await fetch(`${SUPABASE_URL}/rest/v1/telegram_users?user_id=eq.${d.user_id}&limit=1`, {
        headers: { ...adminHeaders, 'Prefer': 'return=representation' }
      });
      const rows = await tgR.json();
      if (!Array.isArray(rows) || !rows.length) continue;
      await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: rows[0].telegram_id, text, parse_mode: 'HTML' })
      });
    }
  } catch (e) {
    // Уведомление не должно ломать основной запрос
  }
}

async function getUserId(token) {
  if (!token) return null;
  try {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { 'apikey': SUPABASE_KEY, 'Authorization': 'Bearer ' + token }
    });
    const d = await r.json();
    return d.id || null;
  } catch (e) {
    return null;
  }
}

// Проверяет роль текущего пользователя в компании. Возвращает null если не состоит в компании.
async function getUserRole(companyId, userId) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/company_members?company_id=eq.${companyId}&user_id=eq.${userId}&limit=1`, {
    headers: { ...adminHeaders, 'Prefer': 'return=representation' }
  });
  const d = await r.json();
  return d[0]?.role || null;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // ── resource=ai: чат с AI-ассистентом (Claude primary, Gemini fallback) ──
  if (req.query.resource === 'ai') {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Только POST запросы' });

    const { message, context, history } = req.body;
    if (!message) return res.status(400).json({ error: 'Не указано сообщение' });

    const ctx = context || {};
    const fmtMoney = (n) => n != null && n !== '' ? Math.round(Number(n)).toLocaleString('ru-RU') + ' ₽' : 'нет данных';

    const systemPrompt = `Ты — OMSFIN Ассистент, эксперт-финансист для малого бизнеса России. Отвечай ТОЛЬКО на русском языке.

## Твоя роль
Ты глубокий финансовый аналитик и налоговый консультант. Анализируй данные пользователя, выявляй аномалии, давай конкретные рекомендации с числами. Не просто отвечай на вопрос — дай инсайт, который пользователь сам не заметил.

## Формат ответа
- Используй <b>жирный</b> для ключевых цифр и выводов
- Структурируй длинные ответы коротким списком (3-5 пунктов)
- Давай ТОЧНЫЕ ссылки на разделы сайта когда уместно
- Не превышай ~200 слов — лучше конкретно и по делу

## ФИНАНСОВЫЕ ДАННЫЕ ПОЛЬЗОВАТЕЛЯ (${ctx.period || 'текущий год'})
Текущий месяц: доход ${fmtMoney(ctx.monthIncome)}, расход ${fmtMoney(ctx.monthExpense)}, прибыль ${fmtMoney(ctx.monthProfit)}
Год: доход ${fmtMoney(ctx.income)}, расход ${fmtMoney(ctx.expense)}, прибыль ${fmtMoney(ctx.profit)}
${ctx.monthDelta != null ? `Динамика доходов к прошлому месяцу: ${ctx.monthDelta > 0 ? '+' : ''}${ctx.monthDelta}%` : ''}
${ctx.monthTrend ? `Тренд: ${ctx.monthTrend}` : ''}
НДС к уплате: ${fmtMoney(ctx.vat)} | Операций: ${ctx.txCount || 0}
Топ расходы по категориям: ${ctx.topCats || '—'}
Топ поставщики/покупатели: ${ctx.topSuppliers || '—'}
${ctx.recentTxs ? `Последние операции: ${ctx.recentTxs}` : ''}
${ctx.anomalies ? `\n⚠️ АНОМАЛИИ: ${ctx.anomalies}` : ''}
${ctx.taxEstimate ? `\nНалоговая нагрузка: ${ctx.taxEstimate}` : ''}
${ctx.marginPct != null ? `Маржинальность: ${ctx.marginPct}%` : ''}
${ctx.cashflowWarning ? `\n🔴 КАССОВЫЙ РАЗРЫВ: ${ctx.cashflowWarning}` : ''}

## РАЗДЕЛЫ САЙТА
- / — главный дашборд: баланс, загрузка банковской выписки, НДС-виджет, закрытие месяца
- /analytics — аналитика: графики по месяцам, категориям, контрагентам, сравнение периодов
- /vat — расчёт и планирование НДС, перенос нагрузки между кварталами
- /declarations — декларации (НДС, 6-НДФЛ, РСВ, налог на прибыль) с экспортом в Excel
- /docs — создание документов: счёт, УПД, ТОРГ-12, счёт-фактура, акт, договор поставки, ПКО, ТТН
- /payroll — зарплатный модуль: сотрудники, начисления, НДФЛ и взносы
- /counterparty — финансовый радар: проверка контрагентов через ЕГРЮЛ, риск-скоринг
- /tools — налоговые калькуляторы: НДС, прибыль, НДФЛ, дивиденды, взносы
- /marketplace — импорт отчётов Wildberries и Ozon
- /settings — настройки: тема интерфейса (тёмная/светлая), Telegram-бот, данные компании

## НАЛОГИ 2026 (актуальные ставки)
- НДС: 10% (базовые продукты питания, мясо птицы и пр.) / 22% (остальное, деликатесы)
- НДФЛ с зарплаты: прогрессия 13% (до 2.4 млн) → 15% → 18% → 20% → 22% (свыше 50 млн)
- НДФЛ с дивидендов: отдельная база, 13% (до 2.4 млн) / 15% (свыше) — НЕ суммируется с зарплатой
- Налог на прибыль: 25% (8% федеральный + 17% региональный)
- Страховые взносы: 30% до 2 979 000 ₽/год на сотрудника, 15.1% сверх базы

## ПРИОРИТЕТНЫЕ СОВЕТЫ ПО СНИЖЕНИЮ НАЛОГОВ
1. НДС: каждый рубль документально подтверждённых покупок снижает НДС — проверь все входящие счета-фактуры
2. Налог на прибыль 25%: максимизируй расходы (аренда, амортизация, ремонт) — каждые 100 000 ₽ расходов экономят 25 000 ₽
3. Взносы: отслеживай предельную базу — после 2 979 000 ₽/год ставка падает вдвое
4. Дивиденды vs зарплата: дивиденды без взносов, только 13-15% НДФЛ отдельной базой
5. Перенос НДС: законно перенести до 1/3 квартального НДС на следующий квартал через /vat

Если вопрос о функции — дай точную ссылку. Если видишь проблему в данных пользователя — назови её первой.`;

    const chatMessages = (Array.isArray(history) ? history.slice(-10) : []).map(h => ({
      role: h.role === 'bot' ? 'assistant' : 'user',
      content: h.text
    }));
    chatMessages.push({ role: 'user', content: message });

    // Сначала пробуем Claude API
    const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
    if (ANTHROPIC_KEY) {
      try {
        const claudeResp = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': ANTHROPIC_KEY,
            'anthropic-version': '2023-06-01'
          },
          body: JSON.stringify({
            model: 'claude-opus-4-8',
            max_tokens: 1024,
            system: systemPrompt,
            messages: chatMessages
          })
        });
        const claudeData = await claudeResp.json();
        if (claudeResp.ok) {
          const reply = claudeData.content?.[0]?.text;
          if (reply) return res.status(200).json({ reply, model: 'claude' });
        }
        // Если Claude вернул ошибку — падаем на Gemini (логируем)
        console.warn('Claude API error, falling back to Gemini:', claudeData.error?.message || claudeResp.status);
      } catch (e) {
        console.warn('Claude API exception, falling back to Gemini:', e.message);
      }
    }

    // Gemini fallback
    const GEMINI_KEY = process.env.GEMINI_API_KEY;
    if (!GEMINI_KEY) return res.status(500).json({ error: 'Ни ANTHROPIC_API_KEY, ни GEMINI_API_KEY не настроены' });

    try {
      const listResp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${GEMINI_KEY}`);
      const listData = await listResp.json();
      if (!listResp.ok) return res.status(500).json({ error: 'Gemini API: ' + (listData.error?.message || listResp.status) });
      const models = (listData.models || [])
        .filter(m => m.supportedGenerationMethods?.includes('generateContent'))
        .map(m => m.name);
      const modelName = models.find(m => m.includes('flash')) || models.find(m => m.includes('pro')) || models[0];
      if (!modelName) return res.status(500).json({ error: 'Нет доступных моделей Gemini' });

      const geminiHistory = (Array.isArray(history) ? history.slice(-8) : []).map(h => ({
        role: h.role === 'bot' ? 'model' : 'user',
        parts: [{ text: h.text }]
      }));
      let contents;
      if (geminiHistory.length > 0) {
        contents = [
          { role: 'user', parts: [{ text: systemPrompt }] },
          { role: 'model', parts: [{ text: 'Понял.' }] },
          ...geminiHistory,
          { role: 'user', parts: [{ text: message }] }
        ];
      } else {
        contents = [{ role: 'user', parts: [{ text: systemPrompt + '\n\nВопрос: ' + message }] }];
      }

      const geminiResp = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/${modelName}:generateContent?key=${GEMINI_KEY}`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ contents, generationConfig: { maxOutputTokens: 1000, temperature: 0.7 } }) }
      );
      const geminiData = await geminiResp.json();
      const reply = geminiData.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!reply) return res.status(500).json({ error: geminiData.error?.message || 'Пустой ответ от Gemini' });
      return res.status(200).json({ reply, model: 'gemini' });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  // Все остальные роуты требуют авторизации
  const authHeader = req.headers.authorization || '';
  const userToken = authHeader.replace('Bearer ', '').trim();
  const userId = await getUserId(userToken);
  if (!userId) return res.status(401).json({ error: 'Не авторизован' });

  if (req.query.resource === 'audit-log') {
    if (req.method !== 'GET') return res.status(405).json({ error: 'Метод не поддерживается' });
    const companyId = req.query.company_id;
    if (!companyId) return res.status(400).json({ error: 'Не указана компания' });

    const role = await getUserRole(companyId, userId);
    if (role !== 'director') return res.status(403).json({ error: 'Только директор может просматривать журнал действий' });

    try {
      const r = await fetch(`${SUPABASE_URL}/rest/v1/audit_log?company_id=eq.${companyId}&order=created_at.desc&limit=200`, {
        headers: { ...adminHeaders, 'Prefer': 'return=representation' }
      });
      const logs = await r.json();
      const logList = Array.isArray(logs) ? logs : [];

      const userIds = [...new Set(logList.map(l => l.user_id).filter(Boolean))];
      const emailMap = {};
      await Promise.all(userIds.map(async (uid) => {
        try {
          const ur = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${uid}`, { headers: adminHeaders });
          const ud = await ur.json();
          emailMap[uid] = ud.email || null;
        } catch (e) {
          emailMap[uid] = null;
        }
      }));

      const enriched = logList.map(l => ({
        ...l,
        user_email: emailMap[l.user_id] || null,
        action_label: ACTION_LABELS[l.action] || l.action
      }));

      return res.status(200).json({ logs: enriched });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  try {
    // ── GET: список участников компании ИЛИ список приглашений ───────────
    if (req.method === 'GET') {
      const { company_id, action } = req.query;
      if (!company_id) return res.status(400).json({ error: 'Не указана компания' });

      const role = await getUserRole(company_id, userId);
      if (!role) return res.status(403).json({ error: 'Вы не состоите в этой компании' });

      if (action === 'invites') {
        // Только директор видит активные приглашения
        if (role !== 'director') return res.status(403).json({ error: 'Недостаточно прав' });
        const r = await fetch(`${SUPABASE_URL}/rest/v1/invite_codes?company_id=eq.${company_id}&used_by=is.null&order=created_at.desc&limit=100`, {
          headers: { ...adminHeaders, 'Prefer': 'return=representation' }
        });
        const data = await r.json();
        return res.status(200).json(data);
      }

      // Список участников + их роли (с email через auth admin)
      const r = await fetch(`${SUPABASE_URL}/rest/v1/company_members?company_id=eq.${company_id}&order=created_at.asc&limit=500`, {
        headers: { ...adminHeaders, 'Prefer': 'return=representation' }
      });
      const members = await r.json();

      // Подтягиваем email для каждого участника
      const withEmails = await Promise.all((members || []).map(async (m) => {
        try {
          const ur = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${m.user_id}`, { headers: adminHeaders });
          const ud = await ur.json();
          return { ...m, email: ud.email || null, is_me: m.user_id === userId };
        } catch (e) {
          return { ...m, email: null, is_me: m.user_id === userId };
        }
      }));

      return res.status(200).json({ members: withEmails, myRole: role });
    }

    // ── POST: создать приглашение (только директор) ──────────────────────
    if (req.method === 'POST') {
      const { company_id, role: inviteRole } = req.body;
      if (!company_id || !inviteRole) return res.status(400).json({ error: 'company_id and role required' });
      if (!['accountant', 'employee'].includes(inviteRole)) {
        return res.status(400).json({ error: 'role must be accountant or employee' });
      }

      const myRole = await getUserRole(company_id, userId);
      if (myRole !== 'director') return res.status(403).json({ error: 'Только директор может приглашать участников' });

      const code = generateCode();
      await fetch(`${SUPABASE_URL}/rest/v1/invite_codes`, {
        method: 'POST',
        headers: adminHeaders,
        body: JSON.stringify({ code, company_id, role: inviteRole, created_by: userId })
      });

      return res.status(200).json({ code });
    }

    // ── PATCH: либо принять приглашение (по коду), либо сменить роль участника ──
    if (req.method === 'PATCH') {
      const { action } = req.body;

      if (action === 'accept_invite') {
        const { code } = req.body;
        if (!code || typeof code !== 'string') return res.status(400).json({ error: 'code required' });
        const safeCode = encodeURIComponent(code);

        // Атомарно: помечаем код использованным ТОЛЬКО если он ещё не использован.
        // PostgREST вернёт обновлённую строку только если WHERE-условие (used_by=is.null)
        // совпало на момент апдейта — это исключает гонку двух параллельных запросов
        // с одним и тем же кодом (ни один SELECT-затем-UPDATE так не защитит).
        const patchR = await fetch(`${SUPABASE_URL}/rest/v1/invite_codes?code=eq.${safeCode}&used_by=is.null`, {
          method: 'PATCH',
          headers: { ...adminHeaders, 'Prefer': 'return=representation' },
          body: JSON.stringify({ used_by: userId })
        });
        const patched = await patchR.json();
        const invite = Array.isArray(patched) ? patched[0] : null;
        if (!invite) return res.status(404).json({ error: 'Код не найден или уже использован' });

        if (new Date(invite.expires_at) < new Date()) {
          // Код истёк — уже отмечен использованным выше, откатывать не нужно:
          // истёкший код не должен быть переиспользован повторно в любом случае.
          return res.status(400).json({ error: 'Код истёк' });
        }

        // Создаём членство
        await fetch(`${SUPABASE_URL}/rest/v1/company_members`, {
          method: 'POST',
          headers: adminHeaders,
          body: JSON.stringify({ company_id: invite.company_id, user_id: userId, role: invite.role })
        });

        logAction(invite.company_id, userId, 'member_joined', { role: invite.role });
        getEmail(userId).then(email => notifyDirectors(invite.company_id,
          `👋 <b>Новый участник в команде</b>\n\n${email} присоединился по инвайту с ролью «${ROLE_LABELS[invite.role] || invite.role}»`));
        return res.status(200).json({ ok: true, company_id: invite.company_id, role: invite.role });
      }

      if (action === 'change_role') {
        const { company_id, target_user_id, new_role } = req.body;
        if (!company_id || !target_user_id || !new_role) return res.status(400).json({ error: 'missing fields' });
        if (!['accountant', 'employee'].includes(new_role)) return res.status(400).json({ error: 'invalid role' });

        const myRole = await getUserRole(company_id, userId);
        if (myRole !== 'director') return res.status(403).json({ error: 'Только директор может менять роли' });

        await fetch(`${SUPABASE_URL}/rest/v1/company_members?company_id=eq.${company_id}&user_id=eq.${target_user_id}`, {
          method: 'PATCH',
          headers: adminHeaders,
          body: JSON.stringify({ role: new_role })
        });

        logAction(company_id, userId, 'member_role_changed', { target_user_id, new_role });
        Promise.all([getEmail(userId), getEmail(target_user_id)]).then(([actorEmail, targetEmail]) =>
          notifyDirectors(company_id, `🔑 <b>Изменена роль участника</b>\n\n${actorEmail} изменил роль ${targetEmail} на «${ROLE_LABELS[new_role] || new_role}»`));
        return res.status(200).json({ ok: true });
      }

      return res.status(400).json({ error: 'Неизвестное действие' });
    }

    // ── DELETE: убрать участника из компании (только директор, не себя) ──
    if (req.method === 'DELETE') {
      const { company_id, target_user_id } = req.body;
      if (!company_id || !target_user_id) return res.status(400).json({ error: 'missing fields' });

      const myRole = await getUserRole(company_id, userId);
      if (myRole !== 'director') return res.status(403).json({ error: 'Только директор может удалять участников' });
      if (target_user_id === userId) return res.status(400).json({ error: 'Нельзя удалить самого себя' });

      await fetch(`${SUPABASE_URL}/rest/v1/company_members?company_id=eq.${company_id}&user_id=eq.${target_user_id}`, {
        method: 'DELETE',
        headers: adminHeaders
      });

      logAction(company_id, userId, 'member_removed', { target_user_id });
      Promise.all([getEmail(userId), getEmail(target_user_id)]).then(([actorEmail, targetEmail]) =>
        notifyDirectors(company_id, `🚪 <b>Участник удалён из компании</b>\n\n${actorEmail} удалил ${targetEmail} из команды`));
      return res.status(200).json({ ok: true });
    }
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
