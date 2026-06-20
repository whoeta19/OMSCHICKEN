const SUPABASE_URL = 'https://sqyppamdxahvvkoxovpu.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNxeXBwYW1keGFodnZrb3hvdnB1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODAxNjQ2MzgsImV4cCI6MjA5NTc0MDYzOH0.tezDMDqlkzlWG0t8zBFyb3tJylFCeySgPByVKLkdlsM';
const SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNxeXBwYW1keGFodnZrb3hvdnB1Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MDE2NDYzOCwiZXhwIjoyMDk1NzQwNjM4fQ.CjCybI9bSk1uYbjWl8clQDPPzB7exzUa029DUtPQen8';

const adminHeaders = {
  'apikey': SERVICE_KEY,
  'Authorization': 'Bearer ' + SERVICE_KEY,
  'Content-Type': 'application/json'
};

const WRITE_ROLES = ['director', 'accountant'];
const READ_ROLES = ['director', 'accountant']; // зарплатные данные — без employee, это чувствительные данные о доходах коллег

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

// НДФЛ — прогрессивная шкала 2026: 13% до 2.4 млн/год, 15% до 5 млн, 18% до 20 млн,
// 20% до 50 млн, 22% свыше. Повышенная ставка применяется только к сумме превышения порога,
// расчёт идёт нарастающим итогом с начала года.
const NDFL_BRACKETS = [
  { upTo: 2400000, rate: 0.13 },
  { upTo: 5000000, rate: 0.15 },
  { upTo: 20000000, rate: 0.18 },
  { upTo: 50000000, rate: 0.20 },
  { upTo: Infinity, rate: 0.22 },
];

function calcNdfl(salaryGross, employeeYearTotalBefore = 0) {
  const totalAfter = employeeYearTotalBefore + salaryGross;
  let ndfl = 0;
  let prevBracketEnd = 0;

  for (const bracket of NDFL_BRACKETS) {
    const bracketStart = Math.max(prevBracketEnd, employeeYearTotalBefore);
    const bracketEnd = Math.min(bracket.upTo, totalAfter);
    if (bracketEnd > bracketStart) {
      ndfl += (bracketEnd - bracketStart) * bracket.rate;
    }
    prevBracketEnd = bracket.upTo;
    if (totalAfter <= bracket.upTo) break;
  }

  return Math.round(ndfl);
}

// Страховые взносы — единый тариф 2026: 30% до базы 2 979 000 ₽/год на сотрудника, 15.1% сверх.
function calcPayroll(salaryGross, employeeYearTotal = 0) {
  const ndfl = calcNdfl(salaryGross, employeeYearTotal);
  const salaryNet = salaryGross - ndfl;

  const LIMIT = 2979000;
  let contributions;
  const totalAfterThisMonth = employeeYearTotal + salaryGross;
  if (totalAfterThisMonth <= LIMIT) {
    contributions = Math.round(salaryGross * 0.30);
  } else if (employeeYearTotal >= LIMIT) {
    contributions = Math.round(salaryGross * 0.151);
  } else {
    const belowLimit = LIMIT - employeeYearTotal;
    const aboveLimit = salaryGross - belowLimit;
    contributions = Math.round(belowLimit * 0.30 + aboveLimit * 0.151);
  }

  return { ndfl, salaryNet, contributions };
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

  const resource = req.query.resource || 'employees'; // 'employees' | 'payroll'

  try {
    // ───────────────────────── EMPLOYEES ─────────────────────────────────
    if (resource === 'employees') {
      const companyId = req.method === 'GET' ? req.query.company_id : req.body?.company_id;
      if (!companyId) return res.status(400).json({ error: 'company_id required' });

      const role = await getUserRole(companyId, userId);
      if (!role || !READ_ROLES.includes(role)) return res.status(403).json({ error: 'Недостаточно прав' });

      if (req.method === 'GET') {
        const r = await fetch(`${SUPABASE_URL}/rest/v1/employees?company_id=eq.${companyId}&order=created_at.asc`, {
          headers: { ...adminHeaders, 'Prefer': 'return=representation' }
        });
        const data = await r.json();
        return res.status(200).json(Array.isArray(data) ? data : []);
      }

      if (req.method === 'POST') {
        if (!WRITE_ROLES.includes(role)) return res.status(403).json({ error: 'Недостаточно прав' });
        const { full_name, position, salary, hire_date } = req.body;
        if (!full_name || !salary) return res.status(400).json({ error: 'full_name and salary required' });

        const r = await fetch(`${SUPABASE_URL}/rest/v1/employees`, {
          method: 'POST',
          headers: { ...adminHeaders, 'Prefer': 'return=representation' },
          body: JSON.stringify({ company_id: companyId, full_name, position, salary, hire_date: hire_date || null })
        });
        const data = await r.json();
        return res.status(200).json(data[0] || data);
      }

      if (req.method === 'PATCH') {
        if (!WRITE_ROLES.includes(role)) return res.status(403).json({ error: 'Недостаточно прав' });
        const { id, ...updates } = req.body;
        if (!id) return res.status(400).json({ error: 'id required' });

        await fetch(`${SUPABASE_URL}/rest/v1/employees?id=eq.${id}`, {
          method: 'PATCH',
          headers: adminHeaders,
          body: JSON.stringify(updates)
        });
        return res.status(200).json({ ok: true });
      }

      if (req.method === 'DELETE') {
        if (!WRITE_ROLES.includes(role)) return res.status(403).json({ error: 'Недостаточно прав' });
        const { id } = req.body;
        if (!id) return res.status(400).json({ error: 'id required' });

        // Мягкое удаление — переводим в неактивные, история выплат должна остаться
        await fetch(`${SUPABASE_URL}/rest/v1/employees?id=eq.${id}`, {
          method: 'PATCH',
          headers: adminHeaders,
          body: JSON.stringify({ is_active: false })
        });
        return res.status(200).json({ ok: true });
      }
    }

    // ───────────────────────── PAYROLL RUNS ──────────────────────────────
    if (resource === 'payroll') {
      const companyId = req.method === 'GET' ? req.query.company_id : req.body?.company_id;
      if (!companyId) return res.status(400).json({ error: 'company_id required' });

      const role = await getUserRole(companyId, userId);
      if (!role || !READ_ROLES.includes(role)) return res.status(403).json({ error: 'Недостаточно прав' });

      if (req.method === 'GET') {
        const period = req.query.period;
        const filter = period
          ? `?company_id=eq.${companyId}&period=eq.${encodeURIComponent(period)}&order=created_at.desc`
          : `?company_id=eq.${companyId}&order=created_at.desc&limit=500`;
        const r = await fetch(`${SUPABASE_URL}/rest/v1/payroll_runs${filter}`, {
          headers: { ...adminHeaders, 'Prefer': 'return=representation' }
        });
        const data = await r.json();
        return res.status(200).json(Array.isArray(data) ? data : []);
      }

      if (req.method === 'POST') {
        // action=calculate — начислить зарплату всем активным сотрудникам за период (без выплаты)
        // action=mark_paid — отметить начисление как выплаченное
        if (!WRITE_ROLES.includes(role)) return res.status(403).json({ error: 'Недостаточно прав' });

        const { action, period } = req.body;

        if (action === 'calculate') {
          if (!period) return res.status(400).json({ error: 'period required' });

          // Не начисляем повторно за тот же период
          const existingR = await fetch(`${SUPABASE_URL}/rest/v1/payroll_runs?company_id=eq.${companyId}&period=eq.${encodeURIComponent(period)}&limit=1`, {
            headers: { ...adminHeaders, 'Prefer': 'return=representation' }
          });
          const existing = await existingR.json();
          if (existing.length) return res.status(400).json({ error: `Начисление за ${period} уже существует` });

          const empR = await fetch(`${SUPABASE_URL}/rest/v1/employees?company_id=eq.${companyId}&is_active=eq.true`, {
            headers: { ...adminHeaders, 'Prefer': 'return=representation' }
          });
          const employees = await empR.json();
          if (!employees.length) return res.status(400).json({ error: 'Нет активных сотрудников' });

          const year = period.split('.')[1];
          const runs = [];
          for (const emp of employees) {
            // Сумма начислений сотруднику с начала года (для расчёта порога взносов)
            const yearR = await fetch(`${SUPABASE_URL}/rest/v1/payroll_runs?employee_id=eq.${emp.id}&period=like.*.${year}`, {
              headers: { ...adminHeaders, 'Prefer': 'return=representation' }
            });
            const yearRuns = await yearR.json();
            const yearTotal = (yearRuns || []).reduce((s, r) => s + Number(r.salary_gross), 0);

            const { ndfl, salaryNet, contributions } = calcPayroll(Number(emp.salary), yearTotal);
            runs.push({
              company_id: companyId,
              employee_id: emp.id,
              period,
              salary_gross: emp.salary,
              ndfl,
              salary_net: salaryNet,
              contributions,
              status: 'planned'
            });
          }

          const r = await fetch(`${SUPABASE_URL}/rest/v1/payroll_runs`, {
            method: 'POST',
            headers: { ...adminHeaders, 'Prefer': 'return=representation' },
            body: JSON.stringify(runs)
          });
          const data = await r.json();
          return res.status(200).json({ ok: true, count: runs.length, runs: data });
        }

        if (action === 'mark_paid') {
          const { id } = req.body;
          if (!id) return res.status(400).json({ error: 'id required' });

          await fetch(`${SUPABASE_URL}/rest/v1/payroll_runs?id=eq.${id}`, {
            method: 'PATCH',
            headers: adminHeaders,
            body: JSON.stringify({ status: 'paid', paid_at: new Date().toISOString() })
          });
          return res.status(200).json({ ok: true });
        }

        return res.status(400).json({ error: 'Unknown action' });
      }

      if (req.method === 'DELETE') {
        if (!WRITE_ROLES.includes(role)) return res.status(403).json({ error: 'Недостаточно прав' });
        const { id } = req.body;
        if (!id) return res.status(400).json({ error: 'id required' });

        await fetch(`${SUPABASE_URL}/rest/v1/payroll_runs?id=eq.${id}`, {
          method: 'DELETE',
          headers: adminHeaders
        });
        return res.status(200).json({ ok: true });
      }
    }

    return res.status(400).json({ error: 'Unknown resource' });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
