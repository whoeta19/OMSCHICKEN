const SUPABASE_URL = 'https://sqyppamdxahvvkoxovpu.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNxeXBwYW1keGFodnZrb3hvdnB1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODAxNjQ2MzgsImV4cCI6MjA5NTc0MDYzOH0.tezDMDqlkzlWG0t8zBFyb3tJylFCeySgPByVKLkdlsM';
const SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNxeXBwYW1keGFodnZrb3hvdnB1Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MDE2NDYzOCwiZXhwIjoyMDk1NzQwNjM4fQ.CjCybI9bSk1uYbjWl8clQDPPzB7exzUa029DUtPQen8';

const adminHeaders = {
  'apikey': SERVICE_KEY,
  'Authorization': 'Bearer ' + SERVICE_KEY,
  'Content-Type': 'application/json'
};

// Роли и что они означают (для справки, проверка прав реальна на фронтенде + в каждом api/*.js по необходимости)
// director   — полный доступ: настройки, удаление, приглашения, всё
// accountant — операции, декларации, НДС, документы; без настроек/удаления компании/приглашений
// employee   — только создание документов; без доступа к финансовым разделам

function generateCode() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

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

// Проверяет роль текущего пользователя в компании. Возвращает null если не состоит в компании.
async function getUserRole(companyId, userId) {
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
  const userId = await getUserId(userToken);
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  try {
    // ── GET: список участников компании ИЛИ список приглашений ───────────
    if (req.method === 'GET') {
      const { company_id, action } = req.query;
      if (!company_id) return res.status(400).json({ error: 'company_id required' });

      const role = await getUserRole(company_id, userId);
      if (!role) return res.status(403).json({ error: 'Вы не состоите в этой компании' });

      if (action === 'invites') {
        // Только директор видит активные приглашения
        if (role !== 'director') return res.status(403).json({ error: 'Недостаточно прав' });
        const r = await fetch(`${SUPABASE_URL}/rest/v1/invite_codes?company_id=eq.${company_id}&used_by=is.null&order=created_at.desc`, {
          headers: { ...adminHeaders, 'Prefer': 'return=representation' }
        });
        const data = await r.json();
        return res.status(200).json(data);
      }

      // Список участников + их роли (с email через auth admin)
      const r = await fetch(`${SUPABASE_URL}/rest/v1/company_members?company_id=eq.${company_id}&order=created_at.asc`, {
        headers: { ...adminHeaders, 'Prefer': 'return=representation' }
      });
      const members = await r.json();

      // Подтягиваем email для каждого участника
      const withEmails = await Promise.all((members || []).map(async (m) => {
        try {
          const ur = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${m.user_id}`, { headers: adminHeaders });
          const ud = await ur.json();
          return { ...m, email: ud.email || null, is_me: m.user_id === userId };
        } catch (e) {
          return { ...m, email: null, is_me: m.user_id === userId };
        }
      }));

      return res.status(200).json({ members: withEmails, myRole: role });
    }

    // ── POST: создать приглашение (только директор) ──────────────────────
    if (req.method === 'POST') {
      const { company_id, role: inviteRole } = req.body;
      if (!company_id || !inviteRole) return res.status(400).json({ error: 'company_id and role required' });
      if (!['accountant', 'employee'].includes(inviteRole)) {
        return res.status(400).json({ error: 'role must be accountant or employee' });
      }

      const myRole = await getUserRole(company_id, userId);
      if (myRole !== 'director') return res.status(403).json({ error: 'Только директор может приглашать участников' });

      const code = generateCode();
      await fetch(`${SUPABASE_URL}/rest/v1/invite_codes`, {
        method: 'POST',
        headers: adminHeaders,
        body: JSON.stringify({ code, company_id, role: inviteRole, created_by: userId })
      });

      return res.status(200).json({ code });
    }

    // ── PATCH: либо принять приглашение (по коду), либо сменить роль участника ──
    if (req.method === 'PATCH') {
      const { action } = req.body;

      if (action === 'accept_invite') {
        const { code } = req.body;
        if (!code) return res.status(400).json({ error: 'code required' });

        const r = await fetch(`${SUPABASE_URL}/rest/v1/invite_codes?code=eq.${code}&used_by=is.null&limit=1`, {
          headers: { ...adminHeaders, 'Prefer': 'return=representation' }
        });
        const invites = await r.json();
        const invite = invites[0];
        if (!invite) return res.status(404).json({ error: 'Код не найден или уже использован' });

        if (new Date(invite.expires_at) < new Date()) {
          return res.status(400).json({ error: 'Код истёк' });
        }

        // Создаём членство
        await fetch(`${SUPABASE_URL}/rest/v1/company_members`, {
          method: 'POST',
          headers: adminHeaders,
          body: JSON.stringify({ company_id: invite.company_id, user_id: userId, role: invite.role })
        });

        // Отмечаем код использованным
        await fetch(`${SUPABASE_URL}/rest/v1/invite_codes?code=eq.${code}`, {
          method: 'PATCH',
          headers: adminHeaders,
          body: JSON.stringify({ used_by: userId })
        });

        return res.status(200).json({ ok: true, company_id: invite.company_id, role: invite.role });
      }

      if (action === 'change_role') {
        const { company_id, target_user_id, new_role } = req.body;
        if (!company_id || !target_user_id || !new_role) return res.status(400).json({ error: 'missing fields' });
        if (!['accountant', 'employee'].includes(new_role)) return res.status(400).json({ error: 'invalid role' });

        const myRole = await getUserRole(company_id, userId);
        if (myRole !== 'director') return res.status(403).json({ error: 'Только директор может менять роли' });

        await fetch(`${SUPABASE_URL}/rest/v1/company_members?company_id=eq.${company_id}&user_id=eq.${target_user_id}`, {
          method: 'PATCH',
          headers: adminHeaders,
          body: JSON.stringify({ role: new_role })
        });

        return res.status(200).json({ ok: true });
      }

      return res.status(400).json({ error: 'Unknown action' });
    }

    // ── DELETE: убрать участника из компании (только директор, не себя) ──
    if (req.method === 'DELETE') {
      const { company_id, target_user_id } = req.body;
      if (!company_id || !target_user_id) return res.status(400).json({ error: 'missing fields' });

      const myRole = await getUserRole(company_id, userId);
      if (myRole !== 'director') return res.status(403).json({ error: 'Только директор может удалять участников' });
      if (target_user_id === userId) return res.status(400).json({ error: 'Нельзя удалить самого себя' });

      await fetch(`${SUPABASE_URL}/rest/v1/company_members?company_id=eq.${company_id}&user_id=eq.${target_user_id}`, {
        method: 'DELETE',
        headers: adminHeaders
      });

      return res.status(200).json({ ok: true });
    }
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
