const SUPABASE_URL = 'https://sqyppamdxahvvkoxovpu.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNxeXBwYW1keGFodnZrb3hvdnB1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODAxNjQ2MzgsImV4cCI6MjA5NTc0MDYzOH0.tezDMDqlkzlWG0t8zBFyb3tJylFCeySgPByVKLkdlsM';
const SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNxeXBwYW1keGFodnZrb3hvdnB1Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MDE2NDYzOCwiZXhwIjoyMDk1NzQwNjM4fQ.CjCybI9bSk1uYbjWl8clQDPPzB7exzUa029DUtPQen8';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const authHeader = req.headers.authorization || '';
  const userToken = authHeader.replace('Bearer ', '').trim();

  const adminHeaders = {
    'apikey': SERVICE_KEY,
    'Authorization': 'Bearer ' + SERVICE_KEY,
    'Content-Type': 'application/json'
  };

  // Получаем user_id
  let userId = null;
  if (userToken) {
    try {
      const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
        headers: { 'apikey': SUPABASE_KEY, 'Authorization': 'Bearer ' + userToken }
      });
      const d = await r.json();
      userId = d.id || null;
    } catch(e) {}
  }

  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  try {
    if (req.method === 'GET') {
      const r = await fetch(`${SUPABASE_URL}/rest/v1/company_settings?user_id=eq.${userId}&limit=1`, {
        headers: { ...adminHeaders, 'Prefer': 'return=representation' }
      });
      const data = await r.json();
      return res.status(200).json(data[0] || {});
    }

    if (req.method === 'POST') {
      const body = { ...req.body, user_id: userId, updated_at: new Date().toISOString() };
      
      // Проверяем есть ли запись
      const check = await fetch(`${SUPABASE_URL}/rest/v1/company_settings?user_id=eq.${userId}&limit=1`, {
        headers: { ...adminHeaders, 'Prefer': 'return=representation' }
      });
      const existing = await check.json();

      if (existing && existing[0]) {
        // Обновляем
        const r = await fetch(`${SUPABASE_URL}/rest/v1/company_settings?user_id=eq.${userId}`, {
          method: 'PATCH',
          headers: { ...adminHeaders, 'Prefer': 'return=representation' },
          body: JSON.stringify(body)
        });
        const data = await r.json();
        return res.status(200).json(data[0] || {});
      } else {
        // Создаём
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
