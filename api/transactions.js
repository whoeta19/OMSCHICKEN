const SUPABASE_URL = 'https://sqyppamdxahvvkoxovpu.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNxeXBwYW1keGFodnZrb3hvdnB1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODAxNjQ2MzgsImV4cCI6MjA5NTc0MDYzOH0.tezDMDqlkzlWG0t8zBFyb3tJylFCeySgPByVKLkdlsM';
const SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNxeXBwYW1keGFodnZrb3hvdnB1Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MDE2NDYzOCwiZXhwIjoyMDk1NzQwNjM4fQ.CjCybI9bSk1uYbjWl8clQDPPzB7exzUa029DUtPQen8';

const adminHeaders = {
  'apikey': SERVICE_KEY,
  'Authorization': 'Bearer ' + SERVICE_KEY,
  'Content-Type': 'application/json'
};

// Роли, которым разрешено изменять финансовые данные (создание/правка/удаление транзакций)
const WRITE_ROLES = ['director', 'accountant'];
// Чтение разрешено всем участникам компании, включая employee (нужно для привязки сумм в документах)
const READ_ROLES = ['director', 'accountant', 'employee'];

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
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const authHeader = req.headers.authorization || '';
  const userToken = authHeader.replace('Bearer ', '').trim();

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

  // company_id приходит по-разному в зависимости от метода и формы тела запроса
  function extractCompanyId(body) {
    if (!body) return null;
    if (Array.isArray(body)) return body[0]?.company_id || null;
    return body.company_id || null;
  }
  const companyId = req.method === 'GET'
    ? req.query.company_id
    : extractCompanyId(req.body);

  // Если указана компания — проверяем, что пользователь в ней состоит, и какая у него роль.
  // Без company_id (старые клиенты / одиночный режим без команды) — пускаем по user_id, как раньше.
  let role = null;
  if (companyId) {
    role = await getUserRole(companyId, userId);
    if (!role) {
      return res.status(403).json({ error: 'Вы не состоите в этой компании' });
    }
  }

  try {
    if (req.method === 'GET') {
      if (companyId && !READ_ROLES.includes(role)) {
        return res.status(403).json({ error: 'Недостаточно прав для просмотра операций' });
      }

      let filter;
      if (companyId) {
        filter = `?company_id=eq.${companyId}&order=date.desc&limit=5000`;
      } else if (userId) {
        filter = `?user_id=eq.${userId}&order=date.desc&limit=5000`;
      } else {
        filter = `?order=date.desc&limit=5000`;
      }

      const r = await fetch(`${SUPABASE_URL}/rest/v1/transactions${filter}`, {
        headers: {...adminHeaders, 'Prefer': 'return=representation'}
      });
      const data = await r.json();
      return res.status(200).json(Array.isArray(data) ? data : []);
    }

    if (req.method === 'POST') {
      if (companyId && !WRITE_ROLES.includes(role)) {
        return res.status(403).json({ error: 'Недостаточно прав для добавления операций' });
      }

      const payload = Array.isArray(req.body) ? req.body : [req.body];
      const payloadWithUser = payload.map(t => {
        const enriched = { ...t };
        delete enriched.company_id; // company_id не должен попадать дважды через spread ниже
        if (userId) enriched.user_id = userId;
        if (companyId) enriched.company_id = companyId;
        return enriched;
      });

      // Дедупликация по хэшу — если транзакция с таким же отпечатком (дата+сумма+описание)
      // уже сохранена для этой компании/пользователя, не вставляем её повторно.
      // Это защищает от задвоения при повторной или частично перекрывающейся загрузке выписки.
      const hashes = payloadWithUser.map(t => t.hash).filter(Boolean);
      let existingHashes = new Set();
      if (hashes.length) {
        const scopeFilter = companyId ? `company_id=eq.${companyId}` : (userId ? `user_id=eq.${userId}` : null);
        if (scopeFilter) {
          const hashList = hashes.map(h => `"${h}"`).join(',');
          const checkR = await fetch(`${SUPABASE_URL}/rest/v1/transactions?${scopeFilter}&hash=in.(${hashList})&select=hash`, {
            headers: { ...adminHeaders, 'Prefer': 'return=representation' }
          });
          const existing = await checkR.json();
          if (Array.isArray(existing)) existingHashes = new Set(existing.map(e => e.hash));
        }
      }

      const toInsert = payloadWithUser.filter(t => !t.hash || !existingHashes.has(t.hash));
      const skipped = payloadWithUser.length - toInsert.length;

      const batchSize = 50;
      for (let i = 0; i < toInsert.length; i += batchSize) {
        const batch = toInsert.slice(i, i + batchSize);
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
      return res.status(200).json({ ok: true, inserted: toInsert.length, skipped, count: payload.length });
    }

    if (req.method === 'PATCH') {
      if (companyId && !WRITE_ROLES.includes(role)) {
        return res.status(403).json({ error: 'Недостаточно прав для изменения операций' });
      }

      const { id, category } = req.body;
      await fetch(`${SUPABASE_URL}/rest/v1/transactions?id=eq.${id}`, {
        method: 'PATCH',
        headers: adminHeaders,
        body: JSON.stringify({ category, is_personal: ['personal','food'].includes(category) })
      });
      return res.status(200).json({ ok: true });
    }

    if (req.method === 'DELETE') {
      if (companyId && !WRITE_ROLES.includes(role)) {
        return res.status(403).json({ error: 'Недостаточно прав для удаления операций' });
      }

      const { period } = req.body || {};
      if (period && companyId) {
        await fetch(`${SUPABASE_URL}/rest/v1/transactions?period=eq.${encodeURIComponent(period)}&company_id=eq.${companyId}`, {
          method: 'DELETE',
          headers: adminHeaders
        });
      } else if (period && userId) {
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

