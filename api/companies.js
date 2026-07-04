const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // Healthcheck — проверка конфигурации и реальной связи с Supabase (без авторизации)
  if (req.method === 'GET' && req.query.action === 'health') {
    let auth_reachable = null, auth_status = null;
    if (SUPABASE_URL && SUPABASE_KEY) {
      try {
        const hr = await fetch(`${SUPABASE_URL}/auth/v1/health`, { headers: { 'apikey': SUPABASE_KEY } });
        auth_status = hr.status;
        auth_reachable = hr.ok;
      } catch (e) { auth_reachable = false; auth_status = String(e.message).slice(0, 80); }
    }
    return res.status(200).json({
      ok: true,
      supabase_url: !!SUPABASE_URL,
      service_key: !!SERVICE_KEY,
      anon_key: !!SUPABASE_KEY,
      auth_reachable,
      auth_status
    });
  }

  if (!SUPABASE_URL || !SERVICE_KEY) {
    return res.status(503).json({ error: 'Сервис временно недоступен: не настроены переменные окружения (SUPABASE_URL / SUPABASE_SERVICE_KEY)' });
  }

  const authHeader = req.headers.authorization || '';
  const userToken = authHeader.replace('Bearer ', '').trim();

  // Получаем user_id из токена (нужен для фильтрации компаний по членству).
  // Обращение к Supabase из serverless-функции иногда падает разовым сетевым
  // сбоем (не связанным с валидностью токена) — поэтому пробуем дважды,
  // прежде чем считать пользователя неавторизованным.
  let userId = null, authReason = userToken ? '' : 'нет токена';
  if (userToken) {
    for (let attempt = 0; attempt < 3 && !userId; attempt++) {
      try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 4000);
        const ur = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
          headers: { 'apikey': SUPABASE_KEY, 'Authorization': 'Bearer ' + userToken },
          signal: ctrl.signal
        });
        clearTimeout(timer);
        const ud = await ur.json();
        userId = ud.id || null;
        if (!userId) authReason = ud.error_code || ud.msg || ud.error || ('auth ' + ur.status);
      } catch(e) {
        console.error('auth attempt', attempt, e?.message);
        authReason = 'auth недоступен';
        if (attempt < 2) await new Promise(r => setTimeout(r, 300 * (attempt + 1)));
      }
    }
  }
  if (!userId) return res.status(401).json({ error: 'Не авторизован', reason: authReason });

  const svcHeaders = {
    'apikey': SERVICE_KEY,
    'Authorization': 'Bearer ' + SERVICE_KEY,
    'Content-Type': 'application/json',
    'Prefer': 'return=representation'
  };

  try {
    if (req.method === 'GET') {
      // Получаем все company_id где пользователь является участником
      const mR = await fetch(`${SUPABASE_URL}/rest/v1/company_members?user_id=eq.${userId}&select=company_id,role`, {
        headers: svcHeaders
      });
      const members = await mR.json();
      if (!Array.isArray(members) || members.length === 0) {
        return res.status(200).json([]);
      }
      const ids = members.map(m => m.company_id).join(',');
      const cR = await fetch(`${SUPABASE_URL}/rest/v1/companies?id=in.(${ids})&order=created_at.asc`, {
        headers: svcHeaders
      });
      const companies = await cR.json();
      if (!Array.isArray(companies)) return res.status(200).json([]);
      // Добавляем роль пользователя к каждой компании
      const roleMap = {};
      members.forEach(m => { roleMap[m.company_id] = m.role; });
      return res.status(200).json(companies.map(c => ({ ...c, my_role: roleMap[c.id] || null })));
    }

    if (req.method === 'POST') {
      const body = { ...req.body, user_id: userId };
      const r = await fetch(`${SUPABASE_URL}/rest/v1/companies`, {
        method: 'POST',
        headers: svcHeaders,
        body: JSON.stringify(body)
      });
      const data = await r.json();

      // Создатель компании автоматически становится её директором
      const newCompany = Array.isArray(data) ? data[0] : data;
      if (newCompany?.id && userId) {
        await fetch(`${SUPABASE_URL}/rest/v1/company_members`, {
          method: 'POST',
          headers: {
            'apikey': SERVICE_KEY,
            'Authorization': 'Bearer ' + SERVICE_KEY,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ company_id: newCompany.id, user_id: userId, role: 'director' })
        });
      }

      return res.status(200).json(data);
    }

    if (req.method === 'PATCH') {
      const { id, ...updates } = req.body;
      const r = await fetch(`${SUPABASE_URL}/rest/v1/companies?id=eq.${id}`, {
        method: 'PATCH',
        headers: svcHeaders,
        body: JSON.stringify(updates)
      });
      const data = await r.json();
      return res.status(200).json(data);
    }

    if (req.method === 'DELETE') {
      const action = req.query.action;

      // Удаление аккаунта (152-ФЗ право на забвение)
      if (action === 'delete_account') {
        await fetch(`${SUPABASE_URL}/rest/v1/transactions?user_id=eq.${userId}`, { method: 'DELETE', headers: svcHeaders });
        await fetch(`${SUPABASE_URL}/rest/v1/company_members?user_id=eq.${userId}`, { method: 'DELETE', headers: svcHeaders });
        await fetch(`${SUPABASE_URL}/rest/v1/audit_log?user_id=eq.${userId}`, { method: 'DELETE', headers: svcHeaders });
        await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${userId}`, { method: 'DELETE', headers: svcHeaders });
        return res.status(200).json({ ok: true });
      }

      const { id } = req.body;
      await fetch(`${SUPABASE_URL}/rest/v1/companies?id=eq.${id}`, {
        method: 'DELETE',
        headers: svcHeaders
      });
      return res.status(200).json({ ok: true });
    }
  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
}
