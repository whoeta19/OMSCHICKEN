const SUPABASE_URL = 'https://sqyppamdxahvvkoxovpu.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNxeXBwYW1keGFodnZrb3hvdnB1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODAxNjQ2MzgsImV4cCI6MjA5NTc0MDYzOH0.tezDMDqlkzlWG0t8zBFyb3tJylFCeySgPByVKLkdlsM';
const SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNxeXBwYW1keGFodnZrb3hvdnB1Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MDE2NDYzOCwiZXhwIjoyMDk1NzQwNjM4fQ.CjCybI9bSk1uYbjWl8clQDPPzB7exzUa029DUtPQen8';

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

function generateCode() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
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

  // ── resource=ai: чат с Gemini-ассистентом (без auth — контекст передаётся с фронта) ──
  if (req.query.resource === 'ai') {
    if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

    const GEMINI_KEY = process.env.GEMINI_API_KEY;
    if (!GEMINI_KEY) return res.status(500).json({ error: 'GEMINI_API_KEY не настроен' });

    const { message, context, history } = req.body;
    if (!message) return res.status(400).json({ error: 'message required' });

    const ctx = context || {};
    const r = (n) => n ? Math.round(n).toLocaleString('ru-RU') + ' ₽' : 'нет данных';

    // Строим богатый системный промпт
    const systemPrompt = `Ты — ОМС-Ассистент, умный финансовый советник встроенный в OMSFIN — облачный бухгалтерский сервис для малого бизнеса в России.

ФИНАНСЫ ПОЛЬЗОВАТЕЛЯ (${ctx.period || 'текущий год'}):
Текущий месяц: доход ${r(ctx.monthIncome)}, расход ${r(ctx.monthExpense)}, прибыль ${r(ctx.monthProfit)}
Год в целом: доход ${r(ctx.income)}, расход ${r(ctx.expense)}, прибыль ${r(ctx.profit)}
${ctx.prevMonthIncome !== undefined ? `Прошлый месяц: доход ${r(ctx.prevMonthIncome)}, расход ${r(ctx.prevMonthExpense)}` : ''}
${ctx.monthDelta !== undefined ? `Динамика к прошлому месяцу: доход ${ctx.monthDelta > 0 ? '+' : ''}${ctx.monthDelta}%` : ''}
Операций за год: ${ctx.txCount || 0}
НДС к уплате (расчётно): ${r(ctx.vat)}
Топ расходных категорий: ${ctx.topCats || 'нет данных'}
Топ покупатели (доход): ${ctx.topClients || 'нет данных'}
Топ поставщики (расход): ${ctx.topSuppliers || 'нет данных'}
${ctx.monthTrend ? 'Тренд по месяцам (доход): ' + ctx.monthTrend : ''}
${ctx.recentTxs ? 'Последние операции: ' + ctx.recentTxs : ''}

НАЛОГОВЫЕ СТАВКИ 2026:
- НДС: 10% продовольствие (мясо, птица), 22% базовая
- НДФЛ: 13% до 2.4 млн, 15% до 5 млн, 18% до 20 млн, 20% до 50 млн, 22% свыше
- НДФЛ дивиденды: отдельная база — 13% до 2.4 млн, 15% свыше
- Налог на прибыль: 25%
- Страховые взносы: 30% до 2 979 000 ₽/год, 15.1% сверх
- УСН 6% с доходов, УСН 15% доходы-расходы

РАЗДЕЛЫ OMSFIN: Дашборд (/), Аналитика (/analytics), НДС (/vat), Декларации (/declarations), Зарплата (/payroll), Документы (/docs), Инструменты (/tools), Контрагенты (/counterparty)

СТИЛЬ: коротко и конкретно (3-5 предложений), используй цифры пользователя, пиши на русском, <b> для важного, не придумывай данных которых нет.`;

    // Модели пробуем по приоритету без лишнего запроса к ListModels
    const MODELS = [
      'models/gemini-2.0-flash',
      'models/gemini-2.0-flash-lite',
      'models/gemini-1.5-flash',
      'models/gemini-1.5-flash-latest',
      'models/gemini-1.5-pro',
    ];

    try {
      const chatHistory = (Array.isArray(history) ? history.slice(-10) : []).map(h => ({
        role: h.role === 'bot' ? 'model' : 'user',
        parts: [{ text: h.text }]
      }));

      const contents = [
        { role: 'user', parts: [{ text: systemPrompt }] },
        { role: 'model', parts: [{ text: 'Понял, готов помочь с финансами.' }] },
        ...chatHistory,
        { role: 'user', parts: [{ text: message }] }
      ];

      async function tryModel(modelName) {
        const r = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/${modelName}:generateContent?key=${GEMINI_KEY}`,
          { method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contents, generationConfig: { maxOutputTokens: 800, temperature: 0.7 } }) }
        );
        const d = await r.json();
        return d.candidates?.[0]?.content?.parts?.[0]?.text || null;
      }

      let reply = null;
      for (const m of MODELS) {
        try { reply = await tryModel(m); if (reply) break; } catch {}
      }

      // Если все захардкоженные модели не сработали — спрашиваем ListModels
      if (!reply) {
        try {
          const listResp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${GEMINI_KEY}`);
          const listData = await listResp.json();
          const found = (listData.models || [])
            .filter(m => m.supportedGenerationMethods?.includes('generateContent'))
            .map(m => m.name);
          for (const m of found) {
            try { reply = await tryModel(m); if (reply) break; } catch {}
          }
        } catch {}
      }
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  // Все остальные роуты требуют авторизации
  const authHeader = req.headers.authorization || '';
  const userToken = authHeader.replace('Bearer ', '').trim();
  const userId = await getUserId(userToken);
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  if (req.query.resource === 'audit-log') {
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
    const companyId = req.query.company_id;
    if (!companyId) return res.status(400).json({ error: 'company_id required' });

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
      if (!company_id) return res.status(400).json({ error: 'company_id required' });

      const role = await getUserRole(company_id, userId);
      if (!role) return res.status(403).json({ error: 'Вы не состоите в этой компании' });

      if (action === 'invites') {
        // Только директор видит активные приглашения
        if (role !== 'director') return res.status(403).json({ error: 'Недостаточно прав' });
        const r = await fetch(`${SUPABASE_URL}/rest/v1/invite_codes?company_id=eq.${company_id}&used_by=is.null&order=created_at.desc`, {
          headers: { ...adminHeaders, 'Prefer': 'return=representation' }
        });
        const data = await r.json();
        return res.status(200).json(data);
      }

      // Список участников + их роли (с email через auth admin)
      const r = await fetch(`${SUPABASE_URL}/rest/v1/company_members?company_id=eq.${company_id}&order=created_at.asc`, {
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
        if (!code) return res.status(400).json({ error: 'code required' });

        const r = await fetch(`${SUPABASE_URL}/rest/v1/invite_codes?code=eq.${code}&used_by=is.null&limit=1`, {
          headers: { ...adminHeaders, 'Prefer': 'return=representation' }
        });
        const invites = await r.json();
        const invite = invites[0];
        if (!invite) return res.status(404).json({ error: 'Код не найден или уже использован' });

        if (new Date(invite.expires_at) < new Date()) {
          return res.status(400).json({ error: 'Код истёк' });
        }

        // Создаём членство
        await fetch(`${SUPABASE_URL}/rest/v1/company_members`, {
          method: 'POST',
          headers: adminHeaders,
          body: JSON.stringify({ company_id: invite.company_id, user_id: userId, role: invite.role })
        });

        // Отмечаем код использованным
        await fetch(`${SUPABASE_URL}/rest/v1/invite_codes?code=eq.${code}`, {
          method: 'PATCH',
          headers: adminHeaders,
          body: JSON.stringify({ used_by: userId })
        });

        logAction(invite.company_id, userId, 'member_joined', { role: invite.role });
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
        return res.status(200).json({ ok: true });
      }

      return res.status(400).json({ error: 'Unknown action' });
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
      return res.status(200).json({ ok: true });
    }
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
