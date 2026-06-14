const SUPABASE_URL = 'https://sqyppamdxahvvkoxovpu.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNxeXBwYW1keGFodnZrb3hvdnB1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODAxNjQ2MzgsImV4cCI6MjA5NTc0MDYzOH0.tezDMDqlkzlWG0t8zBFyb3tJylFCeySgPByVKLkdlsM';
const SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNxeXBwYW1keGFodnZrb3hvdnB1Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MDE2NDYzOCwiZXhwIjoyMDk1NzQwNjM4fQ.CjCybI9bSk1uYbjWl8clQDPPzB7exzUa029DUtPQen8';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const authHeader = req.headers.authorization || '';
  const userToken = authHeader.replace('Bearer ', '').trim();

  // Используем service_role для всех операций — надёжно
  const adminHeaders = {
    'apikey': SERVICE_KEY,
    'Authorization': 'Bearer ' + SERVICE_KEY,
    'Content-Type': 'application/json'
  };

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

  try {
    if (req.method === 'GET') {
      // Фильтруем по user_id если есть
      const filter = userId ? `?user_id=eq.${userId}&order=date.desc&limit=5000` : `?order=date.desc&limit=5000`;
      const r = await fetch(`${SUPABASE_URL}/rest/v1/transactions${filter}`, {
        headers: {...adminHeaders, 'Prefer': 'return=representation'}
      });
      const data = await r.json();
      return res.status(200).json(Array.isArray(data) ? data : []);
    }

    if (req.method === 'POST') {
      const payload = Array.isArray(req.body) ? req.body : [req.body];
      const payloadWithUser = userId ? payload.map(t => ({...t, user_id: userId})) : payload;
      const batchSize = 50;
      for (let i = 0; i < payloadWithUser.length; i += batchSize) {
        const batch = payloadWithUser.slice(i, i + batchSize);
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
      return res.status(200).json({ ok: true, count: payload.length });
    }

    if (req.method === 'PATCH') {
      const { id, category } = req.body;
      await fetch(`${SUPABASE_URL}/rest/v1/transactions?id=eq.${id}`, {
        method: 'PATCH',
        headers: adminHeaders,
        body: JSON.stringify({ category, is_personal: ['personal','food'].includes(category) })
      });
      return res.status(200).json({ ok: true });
    }

    if (req.method === 'DELETE') {
      const { period } = req.body || {};
      if (period && userId) {
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
