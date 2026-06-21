const BOT_TOKEN = '8514433988:AAHvGhmxdIICzzEfXlfe2OIjB_Ynn3gLJao';
const SUPABASE_URL = 'https://sqyppamdxahvvkoxovpu.supabase.co';
const SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNxeXBwYW1keGFodnZrb3hvdnB1Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MDE2NDYzOCwiZXhwIjoyMDk1NzQwNjM4fQ.CjCybI9bSk1uYbjWl8clQDPPzB7exzUa029DUtPQen8';
const APP_URL = 'https://omschicken-u5dn.vercel.app';

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

// Загрузка транзакций за период (MM.YYYY) или всех, сортировка в JS (date — строка DD.MM.YYYY)
async function getTxs(userId, period = null) {
  let url = `${SUPABASE_URL}/rest/v1/transactions?user_id=eq.${userId}&limit=2000`;
  if (period) url += `&period=eq.${period}`;
  const r = await fetch(url, { headers: adminHeaders });
  const data = await r.json();
  return Array.isArray(data) ? data.sort((a, b) => parseDMY(b.date) - parseDMY(a.date)) : [];
}

async function findUserByTelegram(telegramId) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/telegram_users?telegram_id=eq.${telegramId}&limit=1`, {
    headers: adminHeaders
  });
  const data = await r.json();
  return data[0] || null;
}

async function linkUser(telegramId, code) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/telegram_codes?code=eq.${code}&limit=1`, {
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
  await fetch(`${SUPABASE_URL}/rest/v1/telegram_codes?code=eq.${code}`, {
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
        form.append('apikey', 'K83953490988957');
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
          // Берём первую компанию пользователя для company_id
          const compResp = await fetch(`${SUPABASE_URL}/rest/v1/companies?user_id=eq.${linkedUserEarly.user_id}&limit=1`, { headers: adminHeaders });
          const compData = await compResp.json();
          const companyId = compData[0]?.id || null;
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
        const txs = await getTxs(userId, period === 'all' ? null : period);
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
    const period = currentPeriod();
    const txs = await getTxs(userId, period);
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
      [{text: '🌐 Открыть OMSFIN', url: APP_URL},
       {text: '🌐 Открыть OMSFIN', url: APP_URL}]
    ]});

    // /help
    if (text === '/help') {
      await sendMessage(chatId,
        '📋 <b>Команды OMSFIN:</b>\n\n' +
        '/stats — Финансовая сводка за месяц\n' +
        '/nds — Расчёт НДС за квартал\n' +
        '/top — Топ покупателей\n' +
        '/expenses — Топ расходов\n' +
        '/last — Последние 10 операций\n' +
        '/balance — Баланс\n' +
        '/help — Это сообщение\n\n' +
        '📷 Или просто отправь <b>фото чека</b> — добавлю операцию автоматически!',
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
      const allQTxs = (await Promise.all(qPeriods.map(p => getTxs(userId, p)))).flat();
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

    // /top — топ покупателей
    if (text === '/top' || text.includes('топ') || text.includes('покупател')) {
      const allTxs = await getTxs(userId);
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

    // Любой другой текст
    await sendMessage(chatId,
      `Не понял команду 🤔\n\nНапиши /help чтобы увидеть все команды.\n\nИли отправь 📷 <b>фото чека</b> — добавлю операцию автоматически!`,
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
