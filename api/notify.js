const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

const adminHeaders = {
  'apikey': SERVICE_KEY,
  'Authorization': 'Bearer ' + SERVICE_KEY,
  'Content-Type': 'application/json'
};

const BASE_URL = 'https://omschicken-u5dn.vercel.app';
const REMIND_DAYS = [30, 14, 7, 3, 1];

// Vercel исполняет cron в UTC — new Date() на границе суток по Москве (21:00-00:00 UTC)
// даёт неверный день, из-за чего REMIND_DAYS мог сработать не в тот день или пропустить
// напоминание о налоговом дедлайне. Тот же mskNow(), что в utils.js/telegram.js.
function mskNow() {
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Moscow' }));
}

async function sendTelegram(chatId, text) {
  await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({chat_id: chatId, text, parse_mode: 'HTML'})
  });
}

function fmt(n) {
  return Math.abs(n).toLocaleString('ru-RU', {maximumFractionDigits: 0}) + ' ₽';
}

function declDays(n) {
  if (n === 1) return 'день';
  if (n >= 2 && n <= 4) return 'дня';
  return 'дней';
}

// Компания пользователя через company_members (не companies.user_id — тот
// принадлежит только создателю компании, не всем её участникам).
async function getUserCompanyId(userId) {
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/company_members?user_id=eq.${userId}&limit=1&select=company_id`, {
      headers: adminHeaders
    });
    const d = await r.json();
    return d[0]?.company_id || null;
  } catch (e) {
    return null;
  }
}

function daysUntil(date, now) {
  return Math.ceil((date - now) / (1000 * 60 * 60 * 24));
}

function nearestDeadline(deadlines, now) {
  const next = deadlines.find(d => d > now);
  if (!next) return { deadline: null, days: null };
  return { deadline: next, days: daysUntil(next, now) };
}

const RESEND_API_KEY = process.env.RESEND_API_KEY || '';
const FROM_EMAIL = 'OMSFIN <noreply@omsfin.ru>';

async function sendEmail(to, subject, html) {
  if (!RESEND_API_KEY) return { ok: false, error: 'RESEND_API_KEY не настроен' };
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + RESEND_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: FROM_EMAIL, to, subject, html })
  });
  const data = await r.json();
  return r.ok ? { ok: true, id: data.id } : { ok: false, error: data.message };
}

export default async function handler(req, res) {
  // Транзакционный email — POST ?action=email, Bearer-токен пользователя
  if (req.method === 'POST' && req.query.action === 'email') {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.replace('Bearer ', '');
    if (!token) return res.status(401).json({ error: 'Нет токена' });

    // Получаем email пользователя из Supabase auth
    const userR = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { 'apikey': SERVICE_KEY, 'Authorization': 'Bearer ' + token }
    });
    if (!userR.ok) return res.status(401).json({ error: 'Неверный токен' });
    const user = await userR.json();
    const email = user.email;
    if (!email) return res.status(400).json({ error: 'Email не найден' });

    const { subject, html, text } = req.body || {};
    if (!subject) return res.status(400).json({ error: 'subject обязателен' });

    const body = html || `<pre>${text || ''}</pre>`;
    const result = await sendEmail(email, subject, body);
    return res.status(result.ok ? 200 : 500).json(result);
  }

  // Тестовая отправка email — GET ?action=test_email
  if (req.method === 'GET' && req.query.action === 'test_email') {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.replace('Bearer ', '');
    if (!token) return res.status(401).json({ error: 'Нет токена' });
    const userR = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { 'apikey': SERVICE_KEY, 'Authorization': 'Bearer ' + token }
    });
    if (!userR.ok) return res.status(401).json({ error: 'Неверный токен' });
    const user = await userR.json();
    if (!user.email) return res.status(400).json({ error: 'Email не найден' });
    const result = await sendEmail(user.email, 'OMSFIN — тест уведомлений',
      `<div style="font-family:Inter,sans-serif;max-width:480px;margin:0 auto;padding:24px">
        <div style="font-size:20px;font-weight:700;margin-bottom:8px">OMS<span style="color:#ff6b00">FIN</span></div>
        <p>Email-уведомления работают ✅</p>
        <p style="color:#666;font-size:13px">Ты будешь получать напоминания о налоговых сроках и важных событиях.</p>
      </div>`
    );
    return res.status(result.ok ? 200 : 500).json(result);
  }

  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({error: 'Не авторизован'});
  }

  const now = mskNow();
  const day = now.getDate();
  const month = now.getMonth();
  const year = now.getFullYear();

  // ─── Дедлайны по налогам ───────────────────────────────────────────────────

  // НДС — уплата 25-го числа месяца, следующего за кварталом
  const vatDeadlines = [
    new Date(year, 3, 25),
    new Date(year, 6, 25),
    new Date(year, 9, 25),
    new Date(year + 1, 0, 25),
  ];

  // 6-НДФЛ — сдача до 25-го числа месяца после квартала (+ годовой 25 февраля)
  const ndflDeadlines = [
    new Date(year, 1, 25),
    new Date(year, 3, 25),
    new Date(year, 6, 25),
    new Date(year, 9, 25),
    new Date(year + 1, 1, 25),
  ];

  // РСВ — те же сроки что и 6-НДФЛ
  const rsvDeadlines = [
    new Date(year, 1, 25),
    new Date(year, 3, 25),
    new Date(year, 6, 25),
    new Date(year, 9, 25),
    new Date(year + 1, 1, 25),
  ];

  // ЕФС-1 (СФР) — те же сроки
  const efs1Deadlines = [
    new Date(year, 1, 25),
    new Date(year, 3, 25),
    new Date(year, 6, 25),
    new Date(year, 9, 25),
    new Date(year + 1, 1, 25),
  ];

  // Налог на прибыль — авансы до 28-го числа месяца после квартала
  const profitDeadlines = [
    new Date(year, 2, 28),
    new Date(year, 3, 28),
    new Date(year, 6, 28),
    new Date(year, 9, 28),
    new Date(year + 1, 2, 28),
  ];

  const vat    = nearestDeadline(vatDeadlines, now);
  const ndfl   = nearestDeadline(ndflDeadlines, now);
  const rsv    = nearestDeadline(rsvDeadlines, now);
  const efs1   = nearestDeadline(efs1Deadlines, now);
  const profit = nearestDeadline(profitDeadlines, now);

  const lastDayOfMonth = new Date(year, month + 1, 0).getDate();
  const daysToMonthEnd = lastDayOfMonth - day;

  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/telegram_users?select=telegram_id,user_id&limit=5000`, {
      headers: {...adminHeaders, 'Prefer': 'return=representation'}
    });
    const users = await r.json();

    if (!Array.isArray(users) || !users.length) {
      return res.status(200).json({ok: true, message: 'No users with Telegram'});
    }

    let notified = 0;

    for (const user of users) {
      const {telegram_id, user_id} = user;

      // company_id в приоритете — иначе для бухгалтера/сотрудника, привязавшего
      // свой Telegram, напоминание считалось бы по их личным транзакциям
      // (обычно пусто), а не по реальным данным компании.
      const companyId = await getUserCompanyId(user_id);
      const scopeFilter = companyId ? `company_id=eq.${companyId}` : `user_id=eq.${user_id}`;

      // Загружаем транзакции только за текущий квартал для НДС
      const qStart = month - (month % 3); // первый месяц квартала (0-indexed)
      const qPeriods = [qStart, qStart+1, qStart+2].map(m => `${String(m+1).padStart(2,'0')}.${year}`);
      const qFilter = `period=in.(${qPeriods.join(',')})`;
      const txR = await fetch(`${SUPABASE_URL}/rest/v1/transactions?${scopeFilter}&${qFilter}&limit=5000`, {
        headers: adminHeaders
      });
      const txs = await txR.json();

      const messages = [];

      // ── НДС ───────────────────────────────────────────────────────────────
      if (vat.days !== null && REMIND_DAYS.includes(vat.days)) {
        let vatToPay = 0;
        if (Array.isArray(txs) && txs.length) {
          // Только продажи (category='income') и профильные закупки (category='chicken') —
          // так же, как в vat.html/declarations.html. Займы, транзит, зарплата и т.п.
          // НДС не облагаются и не должны попадать ни в начисление, ни в вычет.
          const income    = txs.filter(t => t.amount > 0 && t.category === 'income').reduce((s, t) => s + Number(t.amount), 0);
          const purchases = txs.filter(t => t.amount < 0 && t.category === 'chicken').reduce((s, t) => s + Math.abs(Number(t.amount)), 0);
          vatToPay = Math.max(0, Math.round((income * 10 / 110) - (purchases * 10 / 110)));
        }
        if (vatToPay > 0) {
          messages.push(
            `🧾 <b>Напоминание: уплата НДС</b>\n\n` +
            `До срока: <b>${vat.days} ${declDays(vat.days)}</b>\n` +
            `Срок: <b>${vat.deadline.toLocaleDateString('ru-RU')}</b>\n` +
            `НДС к уплате: <b>${fmt(vatToPay)}</b>\n` +
            `Уплачивается тремя частями по ${fmt(vatToPay / 3)}\n\n` +
            `<a href="${BASE_URL}/vat.html">Открыть расчёт НДС →</a>`
          );
        }
      }

      // ── 6-НДФЛ ────────────────────────────────────────────────────────────
      if (ndfl.days !== null && REMIND_DAYS.includes(ndfl.days)) {
        messages.push(
          `👤 <b>Напоминание: сдача 6-НДФЛ</b>\n\n` +
          `До срока: <b>${ndfl.days} ${declDays(ndfl.days)}</b>\n` +
          `Срок сдачи: <b>${ndfl.deadline.toLocaleDateString('ru-RU')}</b>\n\n` +
          `Расчёт сумм налога на доходы физических лиц.\n` +
          `Сдаётся в ФНС за каждый квартал.\n\n` +
          `<a href="${BASE_URL}/declarations.html">Открыть декларации →</a>`
        );
      }

      // ── РСВ ───────────────────────────────────────────────────────────────
      if (rsv.days !== null && REMIND_DAYS.includes(rsv.days)) {
        messages.push(
          `📋 <b>Напоминание: сдача РСВ</b>\n\n` +
          `До срока: <b>${rsv.days} ${declDays(rsv.days)}</b>\n` +
          `Срок сдачи: <b>${rsv.deadline.toLocaleDateString('ru-RU')}</b>\n\n` +
          `Расчёт по страховым взносам.\n` +
          `Сдаётся в ФНС за каждый квартал.\n\n` +
          `<a href="${BASE_URL}/declarations.html">Открыть декларации →</a>`
        );
      }

      // ── ЕФС-1 (СФР) ───────────────────────────────────────────────────────
      if (efs1.days !== null && REMIND_DAYS.includes(efs1.days)) {
        messages.push(
          `🏥 <b>Напоминание: сдача ЕФС-1 (СФР)</b>\n\n` +
          `До срока: <b>${efs1.days} ${declDays(efs1.days)}</b>\n` +
          `Срок сдачи: <b>${efs1.deadline.toLocaleDateString('ru-RU')}</b>\n\n` +
          `Единая форма сведений (СФР).\n` +
          `Включает взносы на травматизм и сведения о застрахованных.\n\n` +
          `<a href="${BASE_URL}/declarations.html">Открыть декларации →</a>`
        );
      }

      // ── Налог на прибыль ──────────────────────────────────────────────────
      if (profit.days !== null && REMIND_DAYS.includes(profit.days)) {
        messages.push(
          `💼 <b>Напоминание: налог на прибыль</b>\n\n` +
          `До срока уплаты аванса: <b>${profit.days} ${declDays(profit.days)}</b>\n` +
          `Срок: <b>${profit.deadline.toLocaleDateString('ru-RU')}</b>\n\n` +
          `Авансовый платёж по налогу на прибыль организаций.\n` +
          `Ставка: 25% от прибыли (с 2025 года).\n\n` +
          `<a href="${BASE_URL}/declarations.html">Открыть декларации →</a>`
        );
      }

      // ── Конец месяца ──────────────────────────────────────────────────────
      if (daysToMonthEnd <= 2) {
        messages.push(
          `📊 <b>Конец месяца</b>\n\n` +
          `Не забудь загрузить выписку из банка за ${now.toLocaleDateString('ru-RU', {month: 'long', year: 'numeric'})}.\n\n` +
          `<a href="${BASE_URL}">Открыть OMSFIN →</a>`
        );
      }

      // ── Зарплата ──────────────────────────────────────────────────────────
      if (day === 23) {
        messages.push(
          `👥 <b>Напоминание: зарплата</b>\n\n` +
          `Через 2 дня — 25-е число.\n` +
          `Не забудь выплатить зарплату сотрудникам.\n\n` +
          `<a href="${BASE_URL}">Открыть OMSFIN →</a>`
        );
      }

      for (const msg of messages) {
        await sendTelegram(telegram_id, msg);
        notified++;
      }

      // Email-дублирование (раз в неделю — только если день ≤3 до дедлайна)
      if (RESEND_API_KEY && messages.length) {
        const hasUrgentDeadline = [vat.days, ndfl.days, rsv.days, efs1.days, profit.days]
          .some(d => d !== null && REMIND_DAYS.includes(d) && d <= 3);
        const urgentMessages = hasUrgentDeadline ? messages : [];
        if (urgentMessages.length) {
          try {
            const emailR = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${user_id}`, {
              headers: { 'apikey': SERVICE_KEY, 'Authorization': 'Bearer ' + SERVICE_KEY }
            });
            const emailData = await emailR.json();
            const userEmail = emailData.email;
            if (userEmail) {
              const htmlBody = urgentMessages.map(m =>
                '<p style="margin-bottom:16px">' + m.replace(/<[^>]+>/g,'') + '</p>'
              ).join('');
              await sendEmail(userEmail, '⚠️ OMSFIN — срочные налоговые напоминания',
                `<div style="font-family:Inter,sans-serif;max-width:480px;margin:0 auto;padding:24px;background:#0f0f0f;color:#f5f5f5;border-radius:12px">
                  <div style="font-size:18px;font-weight:700;margin-bottom:16px">OMS<span style="color:#ff6b00">FIN</span></div>
                  ${htmlBody}
                  <a href="${BASE_URL}" style="display:inline-block;margin-top:16px;background:#ff6b00;color:#fff;padding:10px 20px;border-radius:8px;text-decoration:none;font-weight:600">Открыть OMSFIN</a>
                </div>`
              );
            }
          } catch(e) { console.error(e); }
        }
      }
    }

    // ─── Email onboarding-цепочка ─────────────────────────────────────────────
    // Для каждого пользователя: проверяем company_settings.onboarding_emails_sent
    // Шаг 0 (день 1): приветствие — при первом запуске крона после регистрации
    // Шаг 1 (день 3): советы по работе с выписками и категориями
    // Шаг 2 (день 7): налоговые возможности и напоминание об НДС
    if (RESEND_API_KEY) {
      try {
        const allSettingsR = await fetch(`${SUPABASE_URL}/rest/v1/company_settings?select=user_id,onboarding_emails_sent,created_at&limit=1000`, {
          headers: adminHeaders
        });
        const allSettings = await allSettingsR.json();
        if (Array.isArray(allSettings)) {
          for (const s of allSettings) {
            const sent = s.onboarding_emails_sent || 0;
            if (sent >= 3) continue;
            const createdAt = new Date(s.created_at);
            const daysSince = Math.floor((now - createdAt) / 86400000);
            let emailStep = -1;
            if (sent === 0 && daysSince >= 0) emailStep = 0;
            else if (sent === 1 && daysSince >= 3) emailStep = 1;
            else if (sent === 2 && daysSince >= 7) emailStep = 2;
            if (emailStep < 0) continue;

            const uR = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${s.user_id}`, {
              headers: { 'apikey': SERVICE_KEY, 'Authorization': 'Bearer ' + SERVICE_KEY }
            });
            const uData = await uR.json();
            if (!uData.email) continue;

            const emailTemplates = [
              {
                subject: '👋 Добро пожаловать в OMSFIN',
                html: `<div style="font-family:Inter,sans-serif;max-width:520px;margin:0 auto;padding:28px 24px;color:#f5f5f5;background:#0f0f0f;border-radius:14px">
                  <div style="font-size:22px;font-weight:900;margin-bottom:16px;font-family:sans-serif">OMS<span style="color:#ff6b00">FIN</span></div>
                  <p style="font-size:16px;font-weight:600;margin-bottom:8px">Кабинет готов — начни за 2 минуты</p>
                  <p style="color:#999;font-size:13px;line-height:1.7;margin-bottom:20px">Загрузи CSV-выписку из банка — и получишь полную картину финансов: доходы, расходы, НДС, прогноз.</p>
                  <div style="background:#1a1a1a;border-radius:10px;padding:16px;margin-bottom:20px">
                    <p style="font-size:13px;font-weight:600;margin-bottom:8px">🏦 Поддерживаемые банки:</p>
                    <p style="color:#888;font-size:12px">Т-Банк, Сбер Бизнес, Альфа-Банк, ВТБ, 1С (XML и КлиентБанк), Excel</p>
                  </div>
                  <a href="${BASE_URL}" style="display:inline-block;background:#ff6b00;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:700;font-size:13px">Открыть OMSFIN →</a>
                </div>`
              },
              {
                subject: '💡 3 функции OMSFIN, о которых ты мог не знать',
                html: `<div style="font-family:Inter,sans-serif;max-width:520px;margin:0 auto;padding:28px 24px;color:#f5f5f5;background:#0f0f0f;border-radius:14px">
                  <div style="font-size:22px;font-weight:900;margin-bottom:20px;font-family:sans-serif">OMS<span style="color:#ff6b00">FIN</span></div>
                  <div style="margin-bottom:16px;padding:14px;background:#1a1a1a;border-radius:10px"><p style="font-weight:600;margin-bottom:4px">🤖 Автоматические правила</p><p style="color:#888;font-size:12px;line-height:1.6">Задай правило: если в названии "Яндекс" → категория "Реклама". Экономит часы ручной разметки.</p></div>
                  <div style="margin-bottom:16px;padding:14px;background:#1a1a1a;border-radius:10px"><p style="font-weight:600;margin-bottom:4px">📱 Telegram-бот</p><p style="color:#888;font-size:12px;line-height:1.6">Команды /stats /nds /top /last прямо в мессенджере. Привяжи в Настройках → Telegram.</p></div>
                  <div style="margin-bottom:20px;padding:14px;background:#1a1a1a;border-radius:10px"><p style="font-weight:600;margin-bottom:4px">🏦 Автоимпорт из банка</p><p style="color:#888;font-size:12px;line-height:1.6">Настрой вебхук в Т-Банк Бизнес — операции будут появляться автоматически без загрузки файлов.</p></div>
                  <a href="${BASE_URL}/settings" style="display:inline-block;background:#ff6b00;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:700;font-size:13px">Настроить →</a>
                </div>`
              },
              {
                subject: '🧾 Не забудь про НДС — OMSFIN считает за тебя',
                html: `<div style="font-family:Inter,sans-serif;max-width:520px;margin:0 auto;padding:28px 24px;color:#f5f5f5;background:#0f0f0f;border-radius:14px">
                  <div style="font-size:22px;font-weight:900;margin-bottom:20px;font-family:sans-serif">OMS<span style="color:#ff6b00">FIN</span></div>
                  <p style="font-size:15px;font-weight:600;margin-bottom:12px">Налоговый календарь 2026 уже встроен</p>
                  <p style="color:#999;font-size:13px;line-height:1.7;margin-bottom:20px">OMSFIN автоматически напоминает о сроках: НДС 25-го, 6-НДФЛ, РСВ, страховые взносы. Все дедлайны с учётом актуального законодательства 2026 года.</p>
                  <div style="background:#1a1a1a;border-radius:10px;padding:16px;margin-bottom:20px">
                    <p style="font-size:12px;color:#888;line-height:1.8">✅ НДС 10%/22% с расчётом к уплате<br>✅ УСН 6% и 15% с авансовыми платежами<br>✅ Прогрессивный НДФЛ 2026<br>✅ Страховые взносы 30% (без льготы МСП)</p>
                  </div>
                  <a href="${BASE_URL}/calendar" style="display:inline-block;background:#ff6b00;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:700;font-size:13px">Открыть налоговый календарь →</a>
                </div>`
              }
            ];

            await sendEmail(uData.email, emailTemplates[emailStep].subject, emailTemplates[emailStep].html);
            // Обновляем счётчик
            await fetch(`${SUPABASE_URL}/rest/v1/company_settings?user_id=eq.${s.user_id}`, {
              method: 'PATCH',
              headers: { ...adminHeaders, 'Prefer': 'return=minimal' },
              body: JSON.stringify({ onboarding_emails_sent: sent + 1 })
            });
          }
        }
      } catch(e) { console.error(e); }
    }

    return res.status(200).json({
      ok: true,
      users: users.length,
      notified,
      deadlines: {
        vat:    { date: vat.deadline,    days: vat.days    },
        ndfl:   { date: ndfl.deadline,   days: ndfl.days   },
        rsv:    { date: rsv.deadline,    days: rsv.days    },
        efs1:   { date: efs1.deadline,   days: efs1.days   },
        profit: { date: profit.deadline, days: profit.days },
      }
    });

  } catch (e) {
    return res.status(500).json({error: e.message});
  }
}
