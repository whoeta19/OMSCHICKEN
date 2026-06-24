const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const authHeader = req.headers.authorization || '';
  const userToken = authHeader.replace('Bearer ', '').trim();
  
  const headers = {
    'apikey': SUPABASE_KEY,
    'Authorization': 'Bearer ' + (userToken || SUPABASE_KEY),
    'Content-Type': 'application/json',
    'Prefer': 'return=representation'
  };

  try {
    if (req.method === 'GET') {
      const r = await fetch(`${SUPABASE_URL}/rest/v1/companies?order=created_at.asc`, { headers });
      const data = await r.json();
      return res.status(200).json(Array.isArray(data) ? data : []);
    }

    if (req.method === 'POST') {
      // Получаем user_id
      let userId = null;
      if (userToken) {
        const ur = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
          headers: { 'apikey': SUPABASE_KEY, 'Authorization': 'Bearer ' + userToken }
        });
        const ud = await ur.json();
        userId = ud.id || null;
      }
      const body = { ...req.body, user_id: userId };
      const r = await fetch(`${SUPABASE_URL}/rest/v1/companies`, {
        method: 'POST',
        headers,
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
        headers,
        body: JSON.stringify(updates)
      });
      const data = await r.json();
      return res.status(200).json(data);
    }

    if (req.method === 'DELETE') {
      const action = req.query.action;

      // Удаление аккаунта (152-ФЗ право на забвение)
      if (action === 'delete_account') {
        if (!userToken) return res.status(401).json({ error: 'Не авторизован' });
        const ur = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
          headers: { 'apikey': SUPABASE_KEY, 'Authorization': 'Bearer ' + userToken }
        });
        const ud = await ur.json();
        const userId = ud.id;
        if (!userId) return res.status(401).json({ error: 'Пользователь не найден' });

        const svcH = { 'apikey': SERVICE_KEY, 'Authorization': 'Bearer ' + SERVICE_KEY, 'Content-Type': 'application/json' };
        // Удаляем данные пользователя
        await fetch(`${SUPABASE_URL}/rest/v1/transactions?user_id=eq.${userId}`, { method: 'DELETE', headers: svcH });
        await fetch(`${SUPABASE_URL}/rest/v1/company_members?user_id=eq.${userId}`, { method: 'DELETE', headers: svcH });
        await fetch(`${SUPABASE_URL}/rest/v1/audit_log?user_id=eq.${userId}`, { method: 'DELETE', headers: svcH });
        // Удаляем самого пользователя из Auth
        await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${userId}`, { method: 'DELETE', headers: svcH });
        return res.status(200).json({ ok: true });
      }

      const { id } = req.body;
      await fetch(`${SUPABASE_URL}/rest/v1/companies?id=eq.${id}`, {
        method: 'DELETE',
        headers
      });
      return res.status(200).json({ ok: true });
    }
  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
}
