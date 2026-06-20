const SUPABASE_URL = 'https://sqyppamdxahvvkoxovpu.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNxeXBwYW1keGFodnZrb3hvdnB1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODAxNjQ2MzgsImV4cCI6MjA5NTc0MDYzOH0.tezDMDqlkzlWG0t8zBFyb3tJylFCeySgPByVKLkdlsM';
const SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNxeXBwYW1keGFodnZrb3hvdnB1Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MDE2NDYzOCwiZXhwIjoyMDk1NzQwNjM4fQ.CjCybI9bSk1uYbjWl8clQDPPzB7exzUa029DUtPQen8';

const adminHeaders = {
  'apikey': SERVICE_KEY,
  'Authorization': 'Bearer ' + SERVICE_KEY,
  'Content-Type': 'application/json'
};

// Человекочитаемые описания действий — используются на фронтенде для отображения
const ACTION_LABELS = {
  transaction_category_changed: 'Изменена категория операции',
  transactions_deleted: 'Удалена выписка за период',
  member_joined: 'Новый участник присоединился',
  member_role_changed: 'Изменена роль участника',
  member_removed: 'Участник удалён из компании'
};

async function getUserId(token) {
  if (!token) return null;
  try {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { 'apikey': SUPABASE_KEY, 'Authorization': 'Bearer ' + token }
    });
    const d = await r.json();
    return d.id || null;
  } catch (e) {
    return null;
  }
}

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
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers.authorization || '';
  const userToken = authHeader.replace('Bearer ', '').trim();
  const userId = await getUserId(userToken);
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  const companyId = req.query.company_id;
  if (!companyId) return res.status(400).json({ error: 'company_id required' });

  const role = await getUserRole(companyId, userId);
  // Журнал действий — чувствительная информация о работе команды, видна только директору
  if (role !== 'director') return res.status(403).json({ error: 'Только директор может просматривать журнал действий' });

  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/audit_log?company_id=eq.${companyId}&order=created_at.desc&limit=200`, {
      headers: { ...adminHeaders, 'Prefer': 'return=representation' }
    });
    const logs = await r.json();
    const logList = Array.isArray(logs) ? logs : [];

    // Подтягиваем email для каждого пользователя, упомянутого в логе
    const userIds = [...new Set(logList.map(l => l.user_id).filter(Boolean))];
    const emailMap = {};
    await Promise.all(userIds.map(async (uid) => {
      try {
        const ur = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${uid}`, { headers: adminHeaders });
        const ud = await ur.json();
        emailMap[uid] = ud.email || null;
      } catch (e) {
        emailMap[uid] = null;
      }
    }));

    const enriched = logList.map(l => ({
      ...l,
      user_email: emailMap[l.user_id] || null,
      action_label: ACTION_LABELS[l.action] || l.action
    }));

    return res.status(200).json({ logs: enriched });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
