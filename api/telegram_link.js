const SUPABASE_URL = 'https://sqyppamdxahvvkoxovpu.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNxeXBwYW1keGFodnZrb3hvdnB1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODAxNjQ2MzgsImV4cCI6MjA5NTc0MDYzOH0.tezDMDqlkzlWG0t8zBFyb3tJylFCeySgPByVKLkdlsM';
const SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNxeXBwYW1keGFodnZrb3hvdnB1Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MDE2NDYzOCwiZXhwIjoyMDk1NzQwNjM4fQ.CjCybI9bSk1uYbjWl8clQDPPzB7exzUa029DUtPQen8';

const adminHeaders = {
  'apikey': SERVICE_KEY,
  'Authorization': 'Bearer ' + SERVICE_KEY,
  'Content-Type': 'application/json'
};

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const authHeader = req.headers.authorization || '';
  const userToken = authHeader.replace('Bearer ', '').trim();

  let userId = null;
  if (userToken) {
    try {
      const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
        headers: { 'apikey': SUPABASE_KEY, 'Authorization': 'Bearer ' + userToken }
      });
      const d = await r.json();
      userId = d.id || null;
      if (d.error) console.error('Auth error:', d.error, d.message);
    } catch(e) {
      console.error('Auth exception:', e.message);
    }
  }

  // Если токен не прошёл — возвращаем debug info
  if (!userId) {
    return res.status(401).json({ 
      error: 'Unauthorized', 
      hasToken: !!userToken,
      tokenStart: userToken ? userToken.substring(0,20) : null
    });
  }

  if (req.method === 'POST') {
    // Генерируем код привязки
    const code = Math.random().toString(36).substring(2, 8).toUpperCase();
    
    // Удаляем старые коды пользователя
    await fetch(`${SUPABASE_URL}/rest/v1/telegram_codes?user_id=eq.${userId}`, {
      method: 'DELETE',
      headers: adminHeaders
    });
    
    // Сохраняем новый код
    await fetch(`${SUPABASE_URL}/rest/v1/telegram_codes`, {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({ code, user_id: userId })
    });
    
    return res.status(200).json({ code, bot: 'omsfin_bot' });
  }

  if (req.method === 'GET') {
    // Проверяем привязан ли Telegram
    const r = await fetch(`${SUPABASE_URL}/rest/v1/telegram_users?user_id=eq.${userId}&limit=1`, {
      headers: { ...adminHeaders, 'Prefer': 'return=representation' }
    });
    const data = await r.json();
    return res.status(200).json({ linked: data.length > 0, telegram_id: data[0]?.telegram_id });
  }
}
