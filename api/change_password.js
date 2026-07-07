const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY;
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

  // КРИТИЧНО: userId должен приходить из подписи, проверенной Supabase Auth, а не
  // из декодированного без проверки JWT payload — раньше здесь брался payload.sub
  // напрямую, без валидации подписи токена. Это позволяло подделать любой
  // JSON.stringify->base64 payload с чужим user_id (подпись никто не проверял)
  // и сменить пароль произвольному пользователю — полный захват аккаунта.
  let userId = null;
  try {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { 'apikey': SUPABASE_KEY, 'Authorization': 'Bearer ' + userToken }
    });
    if (!r.ok) return res.status(401).json({error: 'Сессия истекла, войдите снова'});
    const d = await r.json();
    userId = d.id || null;
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
