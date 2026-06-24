const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

const adminHeaders = {
  'apikey': SERVICE_KEY,
  'Authorization': 'Bearer ' + SERVICE_KEY,
  'Content-Type': 'application/json'
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

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Метод не поддерживается' });

  const authHeader = req.headers.authorization || '';
  const userToken = authHeader.replace('Bearer ', '').trim();
  const userId = await getUserId(userToken);
  if (!userId) return res.status(401).json({ error: 'Не авторизован' });

  try {
    // Находим все компании, где пользователь состоит участником (любая роль)
    const memberR = await fetch(`${SUPABASE_URL}/rest/v1/company_members?user_id=eq.${userId}&select=company_id,role`, {
      headers: { ...adminHeaders, 'Prefer': 'return=representation' }
    });
    const memberships = await memberR.json();
    if (!Array.isArray(memberships) || !memberships.length) {
      return res.status(200).json({ companies: [] });
    }

    const now = new Date();
    const currentPeriod = String(now.getMonth() + 1).padStart(2, '0') + '.' + now.getFullYear();

    const companies = await Promise.all(memberships.map(async (m) => {
      // Данные компании
      const compR = await fetch(`${SUPABASE_URL}/rest/v1/companies?id=eq.${m.company_id}&select=id,name,inn`, {
        headers: { ...adminHeaders, 'Prefer': 'return=representation' }
      });
      const compData = await compR.json();
      const company = Array.isArray(compData) ? compData[0] : null;
      if (!company) return null;

      // Транзакции этой компании за текущий месяц
      const txR = await fetch(`${SUPABASE_URL}/rest/v1/transactions?company_id=eq.${m.company_id}&period=eq.${encodeURIComponent(currentPeriod)}&select=amount,category`, {
        headers: { ...adminHeaders, 'Prefer': 'return=representation' }
      });
      const txs = await txR.json();
      const txList = Array.isArray(txs) ? txs : [];

      const income = txList.filter(t => Number(t.amount) > 0).reduce((s, t) => s + Number(t.amount), 0);
      const expense = txList.filter(t => Number(t.amount) < 0).reduce((s, t) => s + Math.abs(Number(t.amount)), 0);

      const salesIncome = txList.filter(t => Number(t.amount) > 0 && t.category === 'income').reduce((s, t) => s + Number(t.amount), 0);
      const purchaseExpense = txList.filter(t => Number(t.amount) < 0 && t.category === 'chicken').reduce((s, t) => s + Math.abs(Number(t.amount)), 0);
      const vatToPay = Math.max(0, Math.round((salesIncome * 10 / 110) - (purchaseExpense * 10 / 110)));

      return {
        id: company.id,
        name: company.name,
        inn: company.inn,
        role: m.role,
        period: currentPeriod,
        income: Math.round(income),
        expense: Math.round(expense),
        profit: Math.round(income - expense),
        vatToPay,
        txCount: txList.length
      };
    }));

    const validCompanies = companies.filter(Boolean);
    return res.status(200).json({ companies: validCompanies });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
