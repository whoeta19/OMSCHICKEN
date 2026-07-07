import crypto from 'crypto';

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const APP_URL = 'https://omschicken-u5dn.vercel.app';

// Верификация подписи Telegram WebApp initData (HMAC-SHA256)
function verifyTgInitData(initData) {
  try {
    const params = new URLSearchParams(initData);
    const hash = params.get('hash');
    if (!hash) return null;
    params.delete('hash');
    const dataCheckString = Array.from(params.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${v}`)
      .join('\n');
    const secretKey = crypto.createHmac('sha256', 'WebAppData').update(BOT_TOKEN).digest();
    const expected = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');
    if (expected !== hash) return null;
    return JSON.parse(params.get('user') || 'null');
  } catch { return null; }
}

const adminHeaders = {
  'apikey': SERVICE_KEY,
  'Authorization': 'Bearer ' + SERVICE_KEY,
  'Content-Type': 'application/json'
};

async function sendMessage(chatId, text, keyboard = null) {
  const body = { chat_id: chatId, text, parse_mode: 'HTML' };
  if (keyboard) body.reply_markup = keyboard;
  await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify(body)
  });
}

async function answerCallback(callbackQueryId, text) {
  await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/answerCallbackQuery`, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({ callback_query_id: callbackQueryId, text })
  });
}

// Парсинг DD.MM.YYYY в timestamp для правильной сортировки
function parseDMY(str) {
  if (!str) return 0;
  const [dd, mm, yyyy] = str.split('.').map(Number);
  return new Date(yyyy, mm - 1, dd).getTime();
}

// Загрузка транзакций за период (MM.YYYY) или всех, сортировка в JS (date — строка DD.MM.YYYY).
// companyId в приоритете — иначе бухгалтер/сотрудник, привязавший СВОЙ телеграм,
// видел бы только операции, загруженные под его собственным user_id (пусто/чужое),
// а не общие данные компании. Без companyId (личный аккаунт без команды) — по user_id.
async function getTxs(userId, period = null, companyId = null) {
  let url = companyId
    ? `${SUPABASE_URL}/rest/v1/transactions?company_id=eq.${companyId}&limit=2000`
    : `${SUPABASE_URL}/rest/v1/transactions?user_id=eq.${userId}&limit=2000`;
  if (period) url += `&period=eq.${period}`;
  const r = await fetch(url, { headers: adminHeaders });
  const data = await r.json();
  return Array.isArray(data) ? data.sort((a, b) => parseDMY(b.date) - parseDMY(a.date)) : [];
}

// Компания пользователя через company_members (не companies.user_id — тот принадлежит
// только создателю). Если пользователь состоит в нескольких компаниях, берём первую —
// у бота нет команды переключения компании, это осознанное упрощение.
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

async function findUserByTelegram(telegramId) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/telegram_users?telegram_id=eq.${telegramId}&limit=1`, {
    headers: adminHeaders
  });
  const data = await r.json();
  return data[0] || null;
}

async function linkUser(telegramId, code) {
  // code приходит из текста команды /start <code> в Telegram — недоверенный пользовательский
  // ввод. Валидируем формат (ожидаемый код — короткий alphanumeric) до подстановки в фильтр,
  // чтобы посторонние символы (& " и т.п.) не сломали синтаксис PostgREST-запроса.
  if (!code || !/^[A-Za-z0-9]{4,16}$/.test(code)) return null;
  const safeCode = encodeURIComponent(code);

  const r = await fetch(`${SUPABASE_URL}/rest/v1/telegram_codes?code=eq.${safeCode}&limit=1`, {
    headers: adminHeaders
  });
  const data = await r.json();
  if (!data[0]) return null;
  const userId = data[0].user_id;
  await fetch(`${SUPABASE_URL}/rest/v1/telegram_users`, {
    method: 'POST',
    headers: adminHeaders,
    body: JSON.stringify({telegram_id: String(telegramId), user_id: userId})
  });
  await fetch(`${SUPABASE_URL}/rest/v1/telegram_codes?code=eq.${safeCode}`, {
    method: 'DELETE',
    headers: adminHeaders
  });
  return userId;
}

function fmt(n) {
  return Math.abs(n).toLocaleString('ru-RU', {maximumFractionDigits:0}) + ' ₽';
}

// Текущий период MM.YYYY
function currentPeriod() {
  const now = new Date();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  return `${mm}.${now.getFullYear()}`;
}

// Текущий квартал: массив периодов MM.YYYY
function currentQuarterPeriods() {
  const now = new Date();
  const q = Math.floor(now.getMonth() / 3);
  const year = now.getFullYear();
  return [q*3+1, q*3+2, q*3+3].map(m => `${String(m).padStart(2,'0')}.${year}`);
}

function calcVat(txs) {
  const income = txs.filter(t=>t.amount>0).reduce((s,t)=>s+Number(t.amount),0);
  const expense = txs.filter(t=>t.amount<0).reduce((s,t)=>s+Math.abs(Number(t.amount)),0);
  // НДС: начисленный с доходов, к вычету с расходов (10%)
  const vatOut = income * 10/110;
  const vatIn  = expense * 10/110;
  return { income, expense, profit: income - expense, vatOut, vatIn, vatToPay: Math.max(0, vatOut - vatIn) };
}

// Кнопка "Открыть приложение"
function appKeyboard(extra = []) {
  return {
    inline_keyboard: [
      ...extra,
      [{text: '🌐 Открыть OMSFIN', url: APP_URL}]
    ]
  };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // GET /api/telegram?action=tg-auth&initData=... — автологин через Telegram WebApp
  if (req.method === 'GET' && req.query.action === 'tg-auth') {
    const initData = req.query.initData || '';
    const tgUser = verifyTgInitData(initData);
    if (!tgUser) return res.status(401).json({ error: 'invalid_signature' });

    // Ищем привязанного пользователя
    const r = await fetch(`${SUPABASE_URL}/rest/v1/telegram_users?telegram_id=eq.${tgUser.id}&limit=1`, {
      headers: adminHeaders
    });
    const rows = await r.json();
    if (!rows[0]) return res.status(404).json({ error: 'not_linked' });

    const userId = rows[0].user_id;
    // Получаем email пользователя через admin API
    const uResp = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${userId}`, {
      headers: { 'apikey': SERVICE_KEY, 'Authorization': 'Bearer ' + SERVICE_KEY }
    });
    const uData = await uResp.json();
    if (!uData.email) return res.status(500).json({ error: 'no_email' });

    // Генерируем magic link
    const linkResp = await fetch(`${SUPABASE_URL}/auth/v1/admin/generate_link`, {
      method: 'POST',
      headers: { 'apikey': SERVICE_KEY, 'Authorization': 'Bearer ' + SERVICE_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'magiclink', email: uData.email })
    });
    const linkData = await linkResp.json();
    if (!linkData.action_link) return res.status(500).json({ error: 'link_failed' });

    return res.status(200).json({ action_link: linkData.action_link });
  }

  if (req.method !== 'POST') return res.status(200).json({ok: true});

  const update = req.body;
  const message = update.message || update.callback_query?.message;
  if (!message) return res.status(200).json({ok: true});

  const chatId = message.chat.id;
  const telegramId = (update.message?.from?.id || update.callback_query?.from?.id || chatId);
  const text = (update.message?.text || '').trim();
  const callbackData = update.callback_query?.data;
  const photos = update.message?.photo;

  const isStartCmd = text.startsWith('/start');
  const linkedUserEarly = isStartCmd ? null : await findUserByTelegram(telegramId);

  try {
    // ── Фото чека — OCR ──────────────────────────────────────────────────────
    if (photos && photos.length > 0) {
      if (!linkedUserEarly) {
        await sendMessage(chatId,
          '⚠️ Аккаунт не привязан. Перейди в OMSFIN → Настройки → Привязать Telegram',
          appKeyboard()
        );
        return res.status(200).json({ok: true});
      }
      const fileId = photos[photos.length - 1].file_id;
      await sendMessage(chatId, '🔍 Читаю чек, подожди секунду...');

      try {
        const fileResp = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/getFile?file_id=${fileId}`);
        const fileData = await fileResp.json();
        const filePath = fileData.result?.file_path;
        if (!filePath) throw new Error('no file_path');

        const fileUrl = `https://api.telegram.org/file/bot${BOT_TOKEN}/${filePath}`;
        const imgResp = await fetch(fileUrl);
        const imgBuffer = await imgResp.arrayBuffer();

        const form = new FormData();
        form.append('apikey', process.env.OCR_SPACE_API_KEY || 'helloworld');
        form.append('language', 'rus');
        form.append('isOverlayRequired', 'false');
        form.append('file', new Blob([imgBuffer]), 'check.jpg');

        const ocrResp = await fetch('https://api.ocr.space/parse/image', { method: 'POST', body: form });
        const ocrData = await ocrResp.json();
        const ocrText = ocrData.ParsedResults?.[0]?.ParsedText || '';

        const amountMatch = ocrText.match(/(?:итого|итог|к\s*оплате|сумма)[:\s]*([0-9\s]+[,.]?[0-9]*)/i);
        const amount = amountMatch
          ? parseFloat(amountMatch[1].replace(/\s/g, '').replace(',', '.'))
          : null;

        const dateMatch = ocrText.match(/(\d{2})[.\/\-](\d{2})[.\/\-](\d{2,4})/);
        let txDate = new Date().toLocaleDateString('ru-RU').replace(/\//g, '.');
        if (dateMatch) {
          const y = dateMatch[3].length === 2 ? '20' + dateMatch[3] : dateMatch[3];
          txDate = `${dateMatch[1]}.${dateMatch[2]}.${y}`;
        }

        const lines = ocrText.split('\n').map(l => l.trim()).filter(Boolean);
        const merchant = lines[0]?.substring(0, 40) || 'Чек';

        if (!amount || isNaN(amount) || amount <= 0) {
          await sendMessage(chatId,
            `❓ Не удалось распознать сумму на чеке.\n\nРаспознанный текст:\n<code>${ocrText.substring(0, 300)}</code>\n\nДобавь операцию вручную.`,
            appKeyboard([[{text: '➕ Добавить вручную', url: APP_URL}]])
          );
        } else {
          const [, mm, yyyy] = txDate.split('.');
          const period = `${mm}.${yyyy}`;
          const companyId = await getUserCompanyId(linkedUserEarly.user_id);
          const txBody = { user_id: linkedUserEarly.user_id, date: txDate, amount: -amount, name: merchant, category: 'unknown', period };
          if (companyId) txBody.company_id = companyId;
          const txResp = await fetch(`${SUPABASE_URL}/rest/v1/transactions`, {
            method: 'POST',
            headers: {...adminHeaders, 'Prefer': 'return=representation'},
            body: JSON.stringify(txBody)
          });
          const txData = await txResp.json();
          const txId = txData[0]?.id;
          await sendMessage(chatId,
            `🧾 <b>Чек добавлен!</b>\n\n📅 Дата: ${txDate}\n🏪 Продавец: ${merchant}\n💳 Сумма: <b>-${fmt(amount)}</b>`,
            txId ? {inline_keyboard: [[{text: '↩️ Отменить', callback_data: `ocr_undo:${txId}`}]]} : null
          );
        }
      } catch(ocrErr) {
        console.error('OCR error:', ocrErr);
        await sendMessage(chatId, '❌ Не смог прочитать чек. Попробуй сделать более чёткое фото.');
      }
      return res.status(200).json({ok: true});
    }

    // ── Callback-кнопки ──────────────────────────────────────────────────────
    if (callbackData) {
      if (callbackData.startsWith('ocr_undo:')) {
        const txId = callbackData.slice('ocr_undo:'.length);
        await fetch(`${SUPABASE_URL}/rest/v1/transactions?id=eq.${txId}`, {
          method: 'DELETE', headers: adminHeaders
        });
        await answerCallback(update.callback_query.id, '↩️ Операция удалена');
        await sendMessage(chatId, '↩️ Операция удалена из базы.');
        return res.status(200).json({ok: true});
      }

      // Выбор периода для команд: stats:MM.YYYY, nds:quarter, expenses:MM.YYYY
      if (callbackData.startsWith('stats:') || callbackData.startsWith('expenses:')) {
        const [cmd, period] = callbackData.split(':');
        const userId = linkedUserEarly?.user_id;
        if (!userId) return res.status(200).json({ok: true});
        const companyId = await getUserCompanyId(userId);
        const txs = await getTxs(userId, period === 'all' ? null : period, companyId);
        const { income, expense, profit } = calcVat(txs);
        const label = period === 'all' ? 'за всё время' : `за ${period}`;
        if (cmd === 'stats') {
          const profitEmoji = profit >= 0 ? '✅' : '❌';
          await sendMessage(chatId,
            `📊 <b>Сводка ${label}</b>\n\n` +
            `💰 Доход: <b>${fmt(income)}</b>\n` +
            `📤 Расход: <b>${fmt(expense)}</b>\n` +
            `${profitEmoji} Прибыль: <b>${fmt(profit)}</b>\n` +
            `📈 Операций: ${txs.length}`,
            appKeyboard()
          );
        } else {
          const byName = {};
          txs.filter(t=>t.amount<0).forEach(t=>{
            byName[t.name] = (byName[t.name]||0) + Math.abs(Number(t.amount));
          });
          const top = Object.entries(byName).sort(([,a],[,b])=>b-a).slice(0,7);
          await sendMessage(chatId,
            `📤 <b>Топ расходов ${label}:</b>\n\n` +
            (top.length ? top.map(([name,val],i)=>`${i+1}. ${name.substring(0,28)}\n    ${fmt(val)}`).join('\n\n') : 'Расходов нет'),
            appKeyboard()
          );
        }
        await answerCallback(update.callback_query.id, '');
        return res.status(200).json({ok: true});
      }
    }

    // ── /start ───────────────────────────────────────────────────────────────
    if (text.startsWith('/start ')) {
      const code = text.split(' ')[1];
      const userId = await linkUser(telegramId, code);
      if (userId) {
        await sendMessage(chatId,
          '✅ <b>Аккаунт привязан!</b>\n\nТеперь я буду присылать уведомления о НДС, зарплате и дедлайнах.\n\n' +
          'Напиши /help чтобы увидеть все команды.',
          appKeyboard()
        );
      } else {
        await sendMessage(chatId, '❌ Код привязки не найден или уже использован. Получи новый в настройках OMSFIN.',
          appKeyboard()
        );
      }
      return res.status(200).json({ok: true});
    }

    if (text === '/start') {
      // Регистрируем команды в Telegram при первом старте
      fetch(`https://api.telegram.org/bot${BOT_TOKEN}/setMyCommands`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ commands: [
          {command: 'stats',    description: 'Финансовая сводка за месяц'},
          {command: 'quarter',  description: 'Сводка за квартал'},
          {command: 'nds',      description: 'НДС за текущий квартал'},
          {command: 'deadline', description: 'Ближайшие налоговые дедлайны'},
          {command: 'top',      description: 'Топ покупателей'},
          {command: 'expenses', description: 'Топ расходов'},
          {command: 'last',     description: 'Последние операции'},
          {command: 'balance',  description: 'Баланс'},
          {command: 'salary',   description: 'Зарплата и НДФЛ за месяц'},
          {command: 'help',     description: 'Список команд'},
        ]})
      }).catch(() => {});

      await sendMessage(chatId,
        '👋 <b>Привет! Я бот OMSFIN</b>\n\n' +
        'Слежу за финансами твоего бизнеса прямо в Telegram.\n\n' +
        '🔗 Чтобы начать:\n1. Зайди в OMSFIN → Настройки\n2. Нажми «Привязать Telegram»\n3. Я всё сделаю сам!\n\n' +
        'Или нажми кнопку ниже 👇',
        {inline_keyboard: [
          [{text: '⚙️ Открыть Настройки', url: `${APP_URL}/settings`}]
        ]}
      );
      return res.status(200).json({ok: true});
    }

    // ── Проверка привязки ────────────────────────────────────────────────────
    const linkedUser = linkedUserEarly;
    if (!linkedUser) {
      await sendMessage(chatId,
        '⚠️ Аккаунт не привязан.\n\nПерейди в OMSFIN → Настройки → Привязать Telegram',
        appKeyboard([[{text: '⚙️ Настройки', url: `${APP_URL}/settings`}]])
      );
      return res.status(200).json({ok: true});
    }

    const userId = linkedUser.user_id;
    const companyId = await getUserCompanyId(userId);
    const period = currentPeriod();
    const txs = await getTxs(userId, period, companyId);
    const { income, expense, profit, vatOut, vatIn, vatToPay } = calcVat(txs);

    // Кнопки выбора периода для /stats
    const prevMonth = (() => {
      const d = new Date(); d.setMonth(d.getMonth() - 1);
      return `${String(d.getMonth()+1).padStart(2,'0')}.${d.getFullYear()}`;
    })();
    const periodButtons = (cmd) => ({inline_keyboard: [
      [{text: `📅 ${period} (текущий)`, callback_data: `${cmd}:${period}`},
       {text: `📅 ${prevMonth}`, callback_data: `${cmd}:${prevMonth}`}],
      [{text: '📅 За всё время', callback_data: `${cmd}:all`}],
      [{text: '🌐 Открыть OMSFIN', url: APP_URL}]
    ]});

    // /help
    if (text === '/help') {
      await sendMessage(chatId,
        '📋 <b>Команды OMSFIN:</b>\n\n' +
        '/stats — Сводка за месяц\n' +
        '/quarter — Сводка за квартал\n' +
        '/nds — НДС за квартал\n' +
        '/deadline — Налоговые дедлайны\n' +
        '/top — Топ покупателей\n' +
        '/expenses — Топ расходов\n' +
        '/last — Последние операции\n' +
        '/balance — Баланс\n' +
        '/salary — Зарплата и НДФЛ\n\n' +
        '📷 Отправь <b>фото чека</b> — добавлю операцию\n' +
        '✏️ Или напиши: <i>«потратил 3000 на бензин»</i>',
        appKeyboard()
      );
      return res.status(200).json({ok: true});
    }

    // /stats
    if (text === '/stats' || text.includes('сводк') || text.includes('статистик') || text.includes('отчет')) {
      const profitEmoji = profit >= 0 ? '✅' : '❌';
      await sendMessage(chatId,
        `📊 <b>Сводка за ${period}</b>\n\n` +
        `💰 Доход: <b>${fmt(income)}</b>\n` +
        `📤 Расход: <b>${fmt(expense)}</b>\n` +
        `${profitEmoji} Прибыль: <b>${fmt(profit)}</b>\n` +
        `🧾 НДС к уплате: <b>${fmt(vatToPay)}</b>\n` +
        `📈 Операций: ${txs.length}\n\n` +
        `Выбери другой период 👇`,
        periodButtons('stats')
      );
      return res.status(200).json({ok: true});
    }

    // /nds
    if (text === '/nds' || text.includes('ндс') || text.includes('налог')) {
      const qPeriods = currentQuarterPeriods();
      const allQTxs = (await Promise.all(qPeriods.map(p => getTxs(userId, p, companyId)))).flat();
      const { vatOut: qVatOut, vatIn: qVatIn, vatToPay: qVatToPay } = calcVat(allQTxs);

      const now = new Date();
      const quarter = Math.floor(now.getMonth() / 3) + 1;
      const quarterEndMonth = quarter * 3;
      const quarterEnd = new Date(now.getFullYear(), quarterEndMonth, 25);
      const daysLeft = Math.ceil((quarterEnd - now) / (1000*60*60*24));

      await sendMessage(chatId,
        `🧾 <b>НДС · ${quarter} квартал ${now.getFullYear()}</b>\n\n` +
        `НДС начисленный: ${fmt(qVatOut)}\n` +
        `НДС к вычету: ${fmt(qVatIn)}\n` +
        `━━━━━━━━━━━━\n` +
        `💳 К уплате: <b>${fmt(qVatToPay)}</b>\n\n` +
        `⏰ До срока уплаты: <b>${daysLeft} дней</b>\n` +
        `Платите тремя частями по ${fmt(qVatToPay/3)}`,
        appKeyboard()
      );
      return res.status(200).json({ok: true});
    }

    // /quarter — сводка за квартал
    if (text === '/quarter' || text.includes('кварт')) {
      const qPeriods = currentQuarterPeriods();
      const allQTxs = (await Promise.all(qPeriods.map(p => getTxs(userId, p, companyId)))).flat();
      const { income: qIn, expense: qEx, profit: qPr, vatToPay: qVat } = calcVat(allQTxs);
      const now = new Date();
      const quarter = Math.floor(now.getMonth() / 3) + 1;
      const profitEmoji = qPr >= 0 ? '✅' : '❌';
      await sendMessage(chatId,
        `📊 <b>Квартал Q${quarter} ${now.getFullYear()}</b> (${qPeriods.join(', ')})\n\n` +
        `💰 Доход: <b>${fmt(qIn)}</b>\n` +
        `📤 Расход: <b>${fmt(qEx)}</b>\n` +
        `${profitEmoji} Прибыль: <b>${fmt(qPr)}</b>\n` +
        `🧾 НДС к уплате: <b>${fmt(qVat)}</b>\n` +
        `📈 Операций: ${allQTxs.length}`,
        appKeyboard()
      );
      return res.status(200).json({ok: true});
    }

    // /deadline — налоговый календарь
    if (text === '/deadline' || text.includes('дедлайн') || text.includes('срок') || text.includes('календар')) {
      const now = new Date();
      const q = Math.floor(now.getMonth() / 3) + 1;
      const year = now.getFullYear();

      // Дедлайны текущего и следующего квартала
      const deadlines = [];
      const addDeadline = (label, date) => {
        const d = new Date(date);
        const diff = Math.ceil((d - now) / (1000*60*60*24));
        if (diff > -30) deadlines.push({ label, date: d, diff });
      };

      // НДС — 25-е числа: апрель (Q1), июль (Q2), октябрь (Q3), январь+1 (Q4)
      const vatMonths = [3, 6, 9, 0]; // 0-indexed
      vatMonths.forEach((m, i) => {
        const y = m === 0 ? year + 1 : year;
        addDeadline(`🧾 НДС за Q${i+1} (1-й платёж)`, new Date(y, m, 25));
      });

      // 6-НДФЛ — 25 апреля, июля, октября, 25 февраля
      [[year,3,25],[year,6,25],[year,9,25],[year+1,1,25]].forEach(([y,m,d]) => {
        addDeadline(`📑 6-НДФЛ`, new Date(y, m, d));
      });

      // РСВ — те же сроки
      [[year,3,25],[year,6,25],[year,9,25],[year+1,1,25]].forEach(([y,m,d]) => {
        addDeadline(`📋 РСВ`, new Date(y, m, d));
      });

      // Взносы — 15-е следующего месяца каждый месяц
      for (let i = 0; i < 3; i++) {
        const d = new Date(now.getFullYear(), now.getMonth() + i + 1, 15);
        addDeadline(`💼 Страх. взносы (${d.toLocaleString('ru-RU',{month:'long'})})`, d);
      }

      // Фильтр: только ближайшие 60 дней, сортировка
      const upcoming = deadlines
        .filter(d => d.diff >= 0 && d.diff <= 60)
        .sort((a, b) => a.diff - b.diff)
        .slice(0, 8);

      if (!upcoming.length) {
        await sendMessage(chatId, '✅ В ближайшие 60 дней крупных дедлайнов нет.', appKeyboard());
      } else {
        const lines = upcoming.map(d => {
          const status = d.diff === 0 ? '🔴 СЕГОДНЯ' : d.diff <= 5 ? `🔴 через ${d.diff} дн` : d.diff <= 14 ? `🟡 через ${d.diff} дн` : `🟢 через ${d.diff} дн`;
          return `${d.label}\n   ${d.date.toLocaleDateString('ru-RU')} · ${status}`;
        });
        await sendMessage(chatId,
          `📅 <b>Ближайшие дедлайны:</b>\n\n${lines.join('\n\n')}`,
          appKeyboard([[{text: '📑 Открыть декларации', url: `${APP_URL}/declarations`}]])
        );
      }
      return res.status(200).json({ok: true});
    }

    // /top — топ покупателей
    if (text === '/top' || text.includes('топ') || text.includes('покупател')) {
      const allTxs = await getTxs(userId, null, companyId);
      const byName = {};
      allTxs.filter(t=>t.amount>0).forEach(t=>{
        byName[t.name] = (byName[t.name]||0) + Number(t.amount);
      });
      const top = Object.entries(byName).sort(([,a],[,b])=>b-a).slice(0,7);
      await sendMessage(chatId,
        `💰 <b>Топ покупателей за всё время:</b>\n\n` +
        (top.length ? top.map(([name,val],i)=>`${i+1}. ${name.substring(0,28)}\n    ${fmt(val)}`).join('\n\n') : 'Покупателей нет'),
        appKeyboard()
      );
      return res.status(200).json({ok: true});
    }

    // /expenses — топ расходов
    if (text === '/expenses' || text.includes('расход') || text.includes('трат')) {
      await sendMessage(chatId,
        `📤 <b>Топ расходов за ${period} или другой период:</b>`,
        periodButtons('expenses')
      );
      return res.status(200).json({ok: true});
    }

    // /last — последние операции (уже отсортированы по дате desc)
    if (text === '/last' || text.includes('последн') || text.includes('операци')) {
      const last = txs.slice(0, 10);
      await sendMessage(chatId,
        `📋 <b>Последние операции (${period}):</b>\n\n` +
        (last.length
          ? last.map(t=>`${t.date||'—'} · ${(t.name||'').substring(0,22)}\n${t.amount>0?'➕':'➖'} <b>${fmt(t.amount)}</b>`).join('\n\n')
          : 'Операций нет'),
        appKeyboard()
      );
      return res.status(200).json({ok: true});
    }

    // /balance
    if (text === '/balance' || text.includes('баланс')) {
      await sendMessage(chatId,
        `💼 <b>Баланс за ${period}:</b>\n\n` +
        `Доходы: +${fmt(income)}\n` +
        `Расходы: -${fmt(expense)}\n` +
        `━━━━━━━━━━━━\n` +
        `${profit>=0?'✅':'❌'} Итого: <b>${profit>=0?'+':''}${profit>=0?fmt(profit):'-'+fmt(profit)}</b>`,
        periodButtons('stats')
      );
      return res.status(200).json({ok: true});
    }

    // /salary — зарплатная сводка
    if (text === '/salary' || text.includes('зарплат') || text.includes('ндфл') || text.includes('сотрудник')) {
      const salaryTxs = txs.filter(t => t.category === 'salary' && t.amount < 0);
      const fot = salaryTxs.reduce((s,t) => s + Math.abs(Number(t.amount)), 0);

      // Прогрессивный НДФЛ 2026 (начисление с начала года — берём за текущий месяц как оценку)
      function ndflProg(income) {
        if (income <= 2400000)  return Math.round(income * 0.13);
        if (income <= 5000000)  return 312000 + Math.round((income - 2400000) * 0.15);
        if (income <= 20000000) return 702000 + Math.round((income - 5000000) * 0.18);
        if (income <= 50000000) return 3402000 + Math.round((income - 20000000) * 0.20);
        return 9402000 + Math.round((income - 50000000) * 0.22);
      }

      const ndfl = ndflProg(fot);
      const vznosy = fot <= 2979000 ? Math.round(fot * 0.30) : Math.round(2979000 * 0.30 + (fot - 2979000) * 0.151);
      const total = fot + vznosy;

      if (!salaryTxs.length) {
        await sendMessage(chatId,
          `💼 <b>Зарплата за ${period}</b>\n\nОпераций с категорией «Зарплата» не найдено.\nЗагрузите выписку и разметьте операции в OMSFIN.`,
          appKeyboard([[{text: '💼 Открыть OMSFIN', url: APP_URL}]])
        );
      } else {
        await sendMessage(chatId,
          `💼 <b>Зарплата за ${period}</b>\n\n` +
          `👷 Выплат сотрудникам: <b>${salaryTxs.length}</b>\n` +
          `💰 ФОТ (начислено): <b>${fmt(fot)}</b>\n` +
          `📑 НДФЛ (~13-22%): <b>~${fmt(ndfl)}</b>\n` +
          `🛡 Взносы (30%): <b>~${fmt(vznosy)}</b>\n` +
          `━━━━━━━━━━━━\n` +
          `💳 Итого расходов: <b>${fmt(total)}</b>\n\n` +
          `⚠️ НДФЛ рассчитан по прогрессивной шкале 2026 как оценка. Уточните у бухгалтера.`,
          appKeyboard([[{text: '📑 Зарплатный модуль', url: `${APP_URL}/declarations`}]])
        );
      }
      return res.status(200).json({ok: true});
    }

    // ── Натуральный язык: добавление операции ────────────────────────────────
    // "потратил 3000 на бензин", "получил 50000 от Ромашки", "заплатил 1500"
    const nlAmount = text.match(/(\d[\d\s]*[\d](?:[.,]\d{1,2})?)\s*(?:р|руб|₽)?/i);
    const nlIsExpense = /потратил|купил|заплатил|оплатил|списали|расход|трат/i.test(text);
    const nlIsIncome  = /получил|пришло|поступил|заработал|доход|выручк/i.test(text);

    if (nlAmount && (nlIsExpense || nlIsIncome)) {
      const amount = parseFloat(nlAmount[1].replace(/\s/g, '').replace(',', '.'));
      if (amount > 0 && amount < 100_000_000) {
        // Пытаемся вытащить название: "на X" или "от X"
        const nameMatch = text.match(/(?:на|от|у|в)\s+([а-яёА-ЯЁa-zA-Z][^,.\n]{2,30})/i);
        const name = nameMatch ? nameMatch[1].trim() : (nlIsExpense ? 'Расход' : 'Доход');

        const today = new Date().toLocaleDateString('ru-RU').replace(/\//g, '.');
        const [, mm, yyyy] = today.split('.');
        const txPeriod = `${mm}.${yyyy}`;

        const txBody = {
          user_id: userId,
          date: today,
          amount: nlIsExpense ? -amount : amount,
          name: name.substring(0, 60),
          category: 'unknown',
          period: txPeriod
        };
        if (companyId) txBody.company_id = companyId;

        const txResp = await fetch(`${SUPABASE_URL}/rest/v1/transactions`, {
          method: 'POST',
          headers: {...adminHeaders, 'Prefer': 'return=representation'},
          body: JSON.stringify(txBody)
        });
        const txData = await txResp.json();
        const txId = txData[0]?.id;

        await sendMessage(chatId,
          `✅ <b>Операция добавлена!</b>\n\n` +
          `${nlIsExpense ? '📤 Расход' : '📥 Доход'}: <b>${fmt(amount)}</b>\n` +
          `🏷 Название: ${name.substring(0, 40)}\n` +
          `📅 Дата: ${today}`,
          txId ? {inline_keyboard: [[{text: '↩️ Отменить', callback_data: `ocr_undo:${txId}`}], [{text: '🌐 Открыть OMSFIN', url: APP_URL}]]} : appKeyboard()
        );
        return res.status(200).json({ok: true});
      }
    }

    // Любой другой текст
    await sendMessage(chatId,
      `Не понял команду 🤔\n\nНапиши /help чтобы увидеть все команды.\n\nИли попробуй:\n• <i>«потратил 3000 на бензин»</i>\n• <i>«получил 50000 от Ромашки»</i>\n• 📷 Отправь фото чека`,
      appKeyboard([[
        {text: '📊 /stats', callback_data: `stats:${period}`},
        {text: '📤 /expenses', callback_data: `expenses:${period}`}
      ]])
    );

  } catch(e) {
    console.error('Bot error:', e);
    await sendMessage(chatId, '❌ Произошла ошибка. Попробуй позже.');
  }

  return res.status(200).json({ok: true});
}
