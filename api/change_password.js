const SUPABASE_URL = 'https://sqyppamdxahvvkoxovpu.supabase.co';
const SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNxeXBwYW1keGFodnZrb3hvdnB1Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MDE2NDYzOCwiZXhwIjoyMDk1NzQwNjM4fQ.CjCybI9bSk1uYbjWl8clQDPPzB7exzUa029DUtPQen8';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({error: 'Method not allowed'});

  const authHeader = req.headers.authorization || '';
  const userToken = authHeader.replace('Bearer ', '').trim();
  if (!userToken) return res.status(401).json({error: 'No token'});

  // Декодируем JWT без верификации чтобы получить user_id
  let userId = null;
  try {
    const payload = JSON.parse(Buffer.from(userToken.split('.')[1], 'base64').toString());
    userId = payload.sub;
    // Проверяем не истёк ли токен
    if (payload.exp && payload.exp < Math.floor(Date.now()/1000)) {
      return res.status(401).json({error: 'Token expired'});
    }
  } catch(e) {
    return res.status(401).json({error: 'Invalid token format'});
  }

  if (!userId) return res.status(401).json({error: 'No user id'});

  const { password } = req.body;
  if (!password || password.length < 6) return res.status(400).json({error: 'Password too short'});

  try {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${userId}`, {
      method: 'PUT',
      headers: {
        'apikey': SERVICE_KEY,
        'Authorization': 'Bearer ' + SERVICE_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({password})
    });
    const d = await r.json();
    if (d.id) return res.status(200).json({ok: true});
    return res.status(400).json({error: d.message || 'Supabase error', detail: d});
  } catch(e) {
    return res.status(500).json({error: e.message});
  }
}
