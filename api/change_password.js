const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({error: 'Метод не поддерживается'});

  const authHeader = req.headers.authorization || '';
  const userToken = authHeader.replace('Bearer ', '').trim();
  if (!userToken) return res.status(401).json({error: 'Не авторизован'});

  // Декодируем JWT без верификации чтобы получить user_id
  let userId = null;
  try {
    const payload = JSON.parse(Buffer.from(userToken.split('.')[1], 'base64').toString());
    userId = payload.sub;
    // Проверяем не истёк ли токен
    if (payload.exp && payload.exp < Math.floor(Date.now()/1000)) {
      return res.status(401).json({error: 'Сессия истекла, войдите снова'});
    }
  } catch(e) {
    return res.status(401).json({error: 'Неверный токен'});
  }

  if (!userId) return res.status(401).json({error: 'Пользователь не найден'});

  const { password } = req.body;
  if (!password || password.length < 6) return res.status(400).json({error: 'Пароль слишком короткий (минимум 6 символов)'});

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
