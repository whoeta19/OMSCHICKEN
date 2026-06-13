const SUPABASE_URL = 'https://sqyppamdxahvvkoxovpu.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNxeXBwYW1keGFodnZrb3hvdnB1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODAxNjQ2MzgsImV4cCI6MjA5NTc0MDYzOH0.tezDMDqlkzlWG0t8zBFyb3tJylFCeySgPByVKLkdlsM';
const SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNxeXBwYW1keGFodnZrb3hvdnB1Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MDE2NDYzOCwiZXhwIjoyMDk1NzQwNjM4fQ.CjCybI9bSk1uYbjWl8clQDPPzB7exzUa029DUtPQen8';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const headers = {
    'apikey': SUPABASE_KEY,
    'Authorization': 'Bearer ' + SUPABASE_KEY,
    'Content-Type': 'application/json',
    'Prefer': 'return=minimal'
  };

  const adminHeaders = {
    'apikey': SERVICE_KEY,
    'Authorization': 'Bearer ' + SERVICE_KEY,
    'Content-Type': 'application/json'
  };

  try {
    if (req.method === 'GET') {
      const r = await fetch(`${SUPABASE_URL}/rest/v1/transactions?order=date.desc&limit=5000`, {
        headers: {...headers, 'Prefer': 'return=representation'}
      });
      const data = await r.json();
      return res.status(200).json(Array.isArray(data) ? data : []);
    }

    if (req.method === 'POST') {
      const payload = Array.isArray(req.body) ? req.body : [req.body];
      const batchSize = 50;
      for (let i = 0; i < payload.length; i += batchSize) {
        const batch = payload.slice(i, i + batchSize);
        await fetch(`${SUPABASE_URL}/rest/v1/transactions`, {
          method: 'POST',
          headers,
          body: JSON.stringify(batch)
        });
      }
      return res.status(200).json({ ok: true, count: payload.length });
    }

    if (req.method === 'PATCH') {
      const { id, category } = req.body;
      await fetch(`${SUPABASE_URL}/rest/v1/transactions?id=eq.${id}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ category, is_personal: ['personal','food'].includes(category) })
      });
      return res.status(200).json({ ok: true });
    }

    if (req.method === 'DELETE') {
      const { month } = req.body || {};
      if (month) {
        // Удаляем только операции конкретного месяца (формат: "05.2026")
        const [m, y] = month.split('.');
        const dateFrom = `${y}-${m}-01`;
        const dateTo = `${y}-${m}-31`;
        await fetch(`${SUPABASE_URL}/rest/v1/transactions?date=gte.${dateFrom}&date=lte.${dateTo}`, {
          method: 'DELETE',
          headers: adminHeaders
        });
      } else {
        // Удаляем все
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
