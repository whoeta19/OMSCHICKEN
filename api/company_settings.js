const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

const adminHeaders = {
  'apikey': SERVICE_KEY,
  'Authorization': 'Bearer ' + SERVICE_KEY,
  'Content-Type': 'application/json'
};

const WRITE_ROLES = ['director', 'accountant'];

async function getUserRole(companyId, userId) {
  if (!companyId || !userId) return null;
  const r = await fetch(`${SUPABASE_URL}/rest/v1/company_members?company_id=eq.${companyId}&user_id=eq.${userId}&limit=1`, {
    headers: { ...adminHeaders, 'Prefer': 'return=representation' }
  });
  const d = await r.json();
  return d[0]?.role || null;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const authHeader = req.headers.authorization || '';
  const userToken = authHeader.replace('Bearer ', '').trim();

  // Получаем user_id
  let userId = null;
  if (userToken) {
    try {
      const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
        headers: { 'apikey': SUPABASE_KEY, 'Authorization': 'Bearer ' + userToken }
      });
      const d = await r.json();
      userId = d.id || null;
    } catch(e) { console.error(e); }
  }

  if (!userId) return res.status(401).json({ error: 'Не авторизован' });

  const companyId = req.method === 'GET' ? req.query.company_id : req.body?.company_id;

  try {
    // Компания указана — реквизиты, штамп/подпись, склад и т.п. общие для всей
    // команды (director/accountant/employee), а не приватные для каждого логина.
    // Без company_id (личный аккаунт без команды) — прежнее поведение по user_id.
    if (companyId) {
      const role = await getUserRole(companyId, userId);
      if (!role) return res.status(403).json({ error: 'Вы не состоите в этой компании' });
      const safeCompanyId = encodeURIComponent(companyId);

      if (req.method === 'GET') {
        const r = await fetch(`${SUPABASE_URL}/rest/v1/company_settings?company_id=eq.${safeCompanyId}&limit=1`, {
          headers: { ...adminHeaders, 'Prefer': 'return=representation' }
        });
        const data = await r.json();
        return res.status(200).json(data[0] || {});
      }

      if (req.method === 'POST') {
        if (!WRITE_ROLES.includes(role)) return res.status(403).json({ error: 'Недостаточно прав для изменения настроек компании' });
        const { company_id, ...rest } = req.body;
        const body = { ...rest, company_id: companyId, updated_at: new Date().toISOString() };

        const check = await fetch(`${SUPABASE_URL}/rest/v1/company_settings?company_id=eq.${safeCompanyId}&limit=1`, {
          headers: { ...adminHeaders, 'Prefer': 'return=representation' }
        });
        const existing = await check.json();

        if (existing && existing[0]) {
          const r = await fetch(`${SUPABASE_URL}/rest/v1/company_settings?company_id=eq.${safeCompanyId}`, {
            method: 'PATCH',
            headers: { ...adminHeaders, 'Prefer': 'return=representation' },
            body: JSON.stringify(body)
          });
          const data = await r.json();
          return res.status(200).json(data[0] || {});
        } else {
          const r = await fetch(`${SUPABASE_URL}/rest/v1/company_settings`, {
            method: 'POST',
            headers: { ...adminHeaders, 'Prefer': 'return=representation' },
            body: JSON.stringify(body)
          });
          const data = await r.json();
          return res.status(200).json(data[0] || {});
        }
      }
    }

    if (req.method === 'GET') {
      const r = await fetch(`${SUPABASE_URL}/rest/v1/company_settings?user_id=eq.${userId}&limit=1`, {
        headers: { ...adminHeaders, 'Prefer': 'return=representation' }
      });
      const data = await r.json();
      return res.status(200).json(data[0] || {});
    }

    if (req.method === 'POST') {
      const body = { ...req.body, user_id: userId, updated_at: new Date().toISOString() };

      const check = await fetch(`${SUPABASE_URL}/rest/v1/company_settings?user_id=eq.${userId}&limit=1`, {
        headers: { ...adminHeaders, 'Prefer': 'return=representation' }
      });
      const existing = await check.json();

      if (existing && existing[0]) {
        const r = await fetch(`${SUPABASE_URL}/rest/v1/company_settings?user_id=eq.${userId}`, {
          method: 'PATCH',
          headers: { ...adminHeaders, 'Prefer': 'return=representation' },
          body: JSON.stringify(body)
        });
        const data = await r.json();
        return res.status(200).json(data[0] || {});
      } else {
        const r = await fetch(`${SUPABASE_URL}/rest/v1/company_settings`, {
          method: 'POST',
          headers: { ...adminHeaders, 'Prefer': 'return=representation' },
          body: JSON.stringify(body)
        });
        const data = await r.json();
        return res.status(200).json(data[0] || {});
      }
    }
  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
}
