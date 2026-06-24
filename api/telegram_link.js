const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

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
    // Разбираем тело запроса (Vercel может отдать строкой или объектом)
    let body = req.body;
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch(e) { body = {}; } }
    body = body || {};

    // Серверная отправка сообщения в Telegram пользователя.
    // Токен бота остаётся на сервере — клиенту НЕ передаётся.
    if (body.action === 'send') {
      const text = (body.text || '').toString().slice(0, 4000);
      if (!text) return res.status(400).json({ error: 'Пустое сообщение' });
      if (!BOT_TOKEN) return res.status(500).json({ error: 'TELEGRAM_BOT_TOKEN не настроен' });

      // Берём telegram_id привязанного аккаунта по userId
      const lr = await fetch(`${SUPABASE_URL}/rest/v1/telegram_users?user_id=eq.${userId}&limit=1`, {
        headers: { ...adminHeaders, 'Prefer': 'return=representation' }
      });
      const linked = await lr.json();
      const chatId = linked[0]?.telegram_id;
      if (!chatId) return res.status(400).json({ error: 'Telegram не подключён' });

      const tg = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' })
      });
      const tgData = await tg.json();
      if (!tgData.ok) return res.status(502).json({ error: 'Telegram отклонил сообщение' });
      return res.status(200).json({ ok: true });
    }

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
