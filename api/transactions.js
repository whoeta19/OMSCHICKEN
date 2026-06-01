const SUPABASE_URL = 'https://sqyppamdxahvvkoxovpu.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNxeXBwYW1keGFodnZrb3hvdnB1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODAxNjQ2MzgsImV4cCI6MjA5NTc0MDYzOH0.tezDMDqlkzlWG0t8zBFyb3tJylFCeySgPByVKLkdlsM';
const SERVICE_KEY = 'sb_secret_Q7qPb5ULFfGmQTklEEKcOA_snNxwVcR';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  const headers = {'apikey': SUPABASE_KEY,'Authorization': 'Bearer ' + SUPABASE_KEY,'Content-Type': 'application/json','Prefer': 'return=minimal'};
  try {
    if (req.method === 'GET') {
      const r = await fetch(`${SUPABASE_URL}/rest/v1/transactions?order=date.desc&limit=500`, {headers: {...headers, 'Prefer': 'return=representation'}});
      const data = await r.json();
      return res.status(200).json(Array.isArray(data) ? data : []);
    }
    if (req.method === 'POST') {
      const payload = Array.isArray(req.body) ? req.body : [req.body];
      for (let i = 0; i < payload.length; i += 50) {
        await fetch(`${SUPABASE_URL}/rest/v1/transactions`, {method: 'POST', headers, body: JSON.stringify(payload.slice(i, i + 50))});
      }
      return res.status(200).json({ ok: true });
    }
    if (req.method === 'DELETE') {
      await fetch(`${SUPABASE_URL}/rest/v1/rpc/truncate_transactions`, {method: 'POST', headers: {'apikey': SERVICE_KEY,'Authorization': 'Bearer ' + SERVICE_KEY,'Content-Type': 'application/json'}, body: '{}'});
      return res.status(200).json({ ok: true });
    }
  } catch(e) { return res.status(500).json({ error: e.message }); }
}
