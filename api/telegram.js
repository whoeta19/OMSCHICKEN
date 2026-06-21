const BOT_TOKEN = '8514433988:AAHvGhmxdIICzzEfXlfe2OIjB_Ynn3gLJao';
const SUPABASE_URL = 'https://sqyppamdxahvvkoxovpu.supabase.co';
const SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNxeXBwYW1keGFodnZrb3hvdnB1Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MDE2NDYzOCwiZXhwIjoyMDk1NzQwNjM4fQ.CjCybI9bSk1uYbjWl8clQDPPzB7exzUa029DUtPQen8';

const adminHeaders = {
  'apikey': SERVICE_KEY,
  'Authorization': 'Bearer ' + SERVICE_KEY,
  'Content-Type': 'application/json'
};

async function sendMessage(chatId, text, keyboard = null) {
  const body = {
    chat_id: chatId,
    text,
    parse_mode: 'HTML',
  };
  if (keyboard) body.reply_markup = keyboard;
  
  await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify(body)
  });
}

async function getStats(userId) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/transactions?user_id=eq.${userId}&limit=5000`, {
    headers: {...adminHeaders, 'Prefer': 'return=representation'}
  });
  return await r.json();
}

async function findUserByTelegram(telegramId) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/telegram_users?telegram_id=eq.${telegramId}&limit=1`, {
    headers: {...adminHeaders, 'Prefer': 'return=representation'}
  });
  const data = await r.json();
  return data[0] || null;
}

async function linkUser(telegramId, code) {
  // Находим пользователя по коду привязки
  const r = await fetch(`${SUPABASE_URL}/rest/v1/telegram_codes?code=eq.${code}&limit=1`, {
    headers: {...adminHeaders, 'Prefer': 'return=representation'}
  });
  const data = await r.json();
  if (!data[0]) return null;
  
  const userId = data[0].user_id;
  
  // Сохраняем связку telegram_id → user_id
  await fetch(`${SUPABASE_URL}/rest/v1/telegram_users`, {
    method: 'POST',
    headers: adminHeaders,
    body: JSON.stringify({telegram_id: String(telegramId), user_id: userId})
  });
  
  // Удаляем использованный код
  await fetch(`${SUPABASE_URL}/rest/v1/telegram_codes?code=eq.${code}`, {
    method: 'DELETE',
    headers: adminHeaders
  });
  
  return userId;
}

function fmt(n) {
  return Math.abs(n).toLocaleString('ru-RU', {maximumFractionDigits:0}) + ' ₽';
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(200).json({ok: true});
  
  const update = req.body;
  const message = update.message || update.callback_query?.message;
  if (!message) return res.status(200).json({ok: true});
  
  const chatId = message.chat.id;
  const telegramId = message.from?.id || chatId;
  const text = (update.message?.text || '').trim();
  const callbackData = update.callback_query?.data;
  const photos = update.message?.photo;
  
  // Проверяем привязку до любых действий (нужен linkedUser для OCR тоже)
  const linkedUserEarly = await findUserByTelegram(telegramId);

  try {
    // Фото чека — OCR
    if (photos && photos.length > 0) {
      if (!linkedUserEarly) {
        await sendMessage(chatId,
          '⚠️ Аккаунт не привязан. Перейди в OMSFIN → Настройки → Привязать Telegram',
          {inline_keyboard: [[{text: '🌐 Привязать аккаунт', url: 'https://omschicken-u5dn.vercel.app/settings'}]]}
        );
        return res.status(200).json({ok: true});
      }
      const fileId = photos[photos.length - 1].file_id; // наибольшее разрешение
      await sendMessage(chatId, '🔍 Читаю чек, подожди секунду...');

      try {
        // Получаем путь к файлу
        const fileResp = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/getFile?file_id=${fileId}`);
        const fileData = await fileResp.json();
        const filePath = fileData.result?.file_path;
        if (!filePath) throw new Error('no file_path');

        const fileUrl = `https://api.telegram.org/file/bot${BOT_TOKEN}/${filePath}`;

        // Загружаем изображение как blob
        const imgResp = await fetch(fileUrl);
        const imgBuffer = await imgResp.arrayBuffer();
        const imgBlob = new Blob([imgBuffer]);

        // Отправляем на OCR.space (бесплатный тариф, 500 запросов/месяц)
        const form = new FormData();
        form.append('apikey', 'K83953490988957'); // free API key
        form.append('language', 'rus');
        form.append('isOverlayRequired', 'false');
        form.append('file', imgBlob, 'check.jpg');

        const ocrResp = await fetch('https://api.ocr.space/parse/image', {
          method: 'POST',
          body: form
        });
        const ocrData = await ocrResp.json();
        const ocrText = ocrData.ParsedResults?.[0]?.ParsedText || '';

        // Ищем сумму в тексте: "ИТОГО", "ИТОГ", "Сумма", "К ОПЛАТЕ" + число
        const amountMatch = ocrText.match(/(?:итого|итог|к\s*оплате|сумма)[:\s]*([0-9\s]+[,.]?[0-9]*)/i);
        const amount = amountMatch
          ? parseFloat(amountMatch[1].replace(/\s/g, '').replace(',', '.'))
          : null;

        // Ищем дату
        const dateMatch = ocrText.match(/(\d{2})[.\/\-](\d{2})[.\/\-](\d{2,4})/);
        let txDate = new Date().toLocaleDateString('ru-RU').replace(/\//g, '.');
        if (dateMatch) {
          const y = dateMatch[3].length === 2 ? '20' + dateMatch[3] : dateMatch[3];
          txDate = `${dateMatch[1]}.${dateMatch[2]}.${y}`;
        }

        // Ищем название магазина (первая непустая строка)
        const lines = ocrText.split('\n').map(l => l.trim()).filter(Boolean);
        const merchant = lines[0]?.substring(0, 40) || 'Чек';

        if (!amount || isNaN(amount) || amount <= 0) {
          await sendMessage(chatId,
            `❓ Не удалось распознать сумму на чеке.\n\nРаспознанный текст:\n<code>${ocrText.substring(0, 300)}</code>\n\nДобавь операцию вручную в приложении.`,
            {inline_keyboard: [[{text: '➕ Добавить вручную', url: 'https://omschicken-u5dn.vercel.app'}]]}
          );
        } else {
          // Сохраняем в pending — ждём подтверждения
          const key = `ocr_${telegramId}_${Date.now()}`;
          await fetch(`${SUPABASE_URL}/rest/v1/telegram_ocr_pending`, {
            method: 'POST',
            headers: adminHeaders,
            body: JSON.stringify({
              key, user_id: linkedUser?.user_id, telegram_id: String(telegramId),
              amount: -amount, name: merchant, date: txDate,
              category: 'other', created_at: new Date().toISOString()
            })
          }).catch(() => {}); // таблица может не существовать — не критично

          // callback_data содержит только safe-поля без произвольных строк
          await sendMessage(chatId,
            `🧾 <b>Чек распознан!</b>\n\n` +
            `📅 Дата: ${txDate}\n` +
            `🏪 Продавец: ${merchant}\n` +
            `💳 Сумма: <b>-${fmt(amount)}</b>\n\n` +
            `Добавить эту операцию в OMSFIN?`,
            {inline_keyboard: [[
              {text: '✅ Добавить', callback_data: `ocr_confirm:${key}`},
              {text: '❌ Отмена', callback_data: 'ocr_cancel'}
            ]]}
          );
        }
      } catch(ocrErr) {
        console.error('OCR error:', ocrErr);
        await sendMessage(chatId, '❌ Не смог прочитать чек. Попробуй сделать более чёткое фото.');
      }
      return res.status(200).json({ok: true});
    }

    // Callback — подтверждение OCR операции
    if (callbackData?.startsWith('ocr_confirm:')) {
      const key = callbackData.slice('ocr_confirm:'.length);

      // Читаем данные из pending-записи (там нет проблем с : в merchant)
      const pendingResp = await fetch(
        `${SUPABASE_URL}/rest/v1/telegram_ocr_pending?key=eq.${encodeURIComponent(key)}&limit=1`,
        {headers: adminHeaders}
      );
      const pending = await pendingResp.json();
      const p = pending[0];

      if (!p) {
        await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/answerCallbackQuery`, {
          method: 'POST', headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({callback_query_id: update.callback_query.id, text: '❌ Запись не найдена'})
        });
        return res.status(200).json({ok: true});
      }

      await fetch(`${SUPABASE_URL}/rest/v1/transactions`, {
        method: 'POST',
        headers: {...adminHeaders, 'Prefer': 'return=minimal'},
        body: JSON.stringify({
          user_id: p.user_id,
          date: p.date,
          amount: p.amount,
          name: p.name,
          category: p.category || 'other',
          period: p.date.split('.').slice(1).join('.')
        })
      });

      // Удаляем pending-запись
      await fetch(`${SUPABASE_URL}/rest/v1/telegram_ocr_pending?key=eq.${encodeURIComponent(key)}`,
        {method: 'DELETE', headers: adminHeaders}
      ).catch(() => {});

      await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/answerCallbackQuery`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({callback_query_id: update.callback_query.id, text: '✅ Операция добавлена!'})
      });
      await sendMessage(chatId, `✅ Операция добавлена!\n\n${p.name} · -${fmt(Math.abs(p.amount))}`);
      return res.status(200).json({ok: true});
    }

    if (callbackData === 'ocr_cancel') {
      await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/answerCallbackQuery`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({callback_query_id: update.callback_query.id, text: 'Отменено'})
      });
      return res.status(200).json({ok: true});
    }

    // Команда /start с кодом привязки
    if (text.startsWith('/start ')) {
      const code = text.split(' ')[1];
      const userId = await linkUser(telegramId, code);
      if (userId) {
        await sendMessage(chatId, 
          '✅ <b>Аккаунт привязан!</b>\n\nТеперь я буду присылать тебе уведомления о НДС, зарплате и финансовые отчёты.\n\nНапиши /help чтобы увидеть все команды.');
      } else {
        await sendMessage(chatId, '❌ Код привязки не найден или уже использован. Получи новый код в настройках OMSFIN.');
      }
      return res.status(200).json({ok: true});
    }
    
    // Команда /start без кода
    if (text === '/start') {
      await sendMessage(chatId,
        '👋 <b>Привет! Я бот OMSFIN</b>\n\nЯ помогаю следить за финансами твоего бизнеса прямо в Telegram.\n\n' +
        '🔗 Чтобы начать, привяжи аккаунт:\n1. Зайди в OMSFIN → Настройки\n2. Нажми "Привязать Telegram"\n3. Нажми кнопку и я всё сделаю сам!\n\n' +
        'Или напиши /help',
        {inline_keyboard: [[{text: '🌐 Открыть OMSFIN', url: 'https://omschicken-u5dn.vercel.app/settings'}]]}
      );
      return res.status(200).json({ok: true});
    }
    
    // Проверяем привязан ли аккаунт (используем уже загруженный выше)
    const linkedUser = linkedUserEarly;
    if (!linkedUser) {
      await sendMessage(chatId,
        '⚠️ Аккаунт не привязан.\n\nПерейди в OMSFIN → Настройки → Привязать Telegram',
        {inline_keyboard: [[{text: '🌐 Привязать аккаунт', url: 'https://omschicken-u5dn.vercel.app/settings'}]]}
      );
      return res.status(200).json({ok: true});
    }
    
    const userId = linkedUser.user_id;
    const txs = await getStats(userId);
    
    const income = txs.filter(t=>t.amount>0).reduce((s,t)=>s+Number(t.amount),0);
    const expense = txs.filter(t=>t.amount<0).reduce((s,t)=>s+Math.abs(Number(t.amount)),0);
    const profit = income - expense;
    const vatSales = txs.filter(t=>t.amount>0&&t.category==='income').reduce((s,t)=>s+Number(t.amount),0) * 10/110;
    const vatPurchases = txs.filter(t=>t.amount<0&&t.category==='chicken').reduce((s,t)=>s+Math.abs(Number(t.amount)),0) * 10/110;
    const vatToPay = vatSales - vatPurchases;
    
    // /help
    if (text === '/help') {
      await sendMessage(chatId,
        '📋 <b>Команды OMSFIN:</b>\n\n' +
        '/stats — Финансовая сводка\n' +
        '/nds — Расчёт НДС\n' +
        '/top — Топ контрагентов\n' +
        '/last — Последние операции\n' +
        '/balance — Баланс\n' +
        '/help — Это сообщение'
      );
      return res.status(200).json({ok: true});
    }
    
    // /stats или "сводка" или "статистика"
    if (text === '/stats' || text.includes('сводк') || text.includes('статистик') || text.includes('отчет')) {
      const profitEmoji = profit >= 0 ? '✅' : '❌';
      await sendMessage(chatId,
        `📊 <b>Финансовая сводка</b>\n\n` +
        `💰 Доход: <b>${fmt(income)}</b>\n` +
        `📤 Расход: <b>${fmt(expense)}</b>\n` +
        `${profitEmoji} Прибыль: <b>${fmt(profit)}</b>\n` +
        `🧾 НДС к уплате: <b>${fmt(vatToPay)}</b>\n\n` +
        `📈 Операций: ${txs.length}`,
        {inline_keyboard: [[{text: '🌐 Открыть приложение', url: 'https://omschicken-u5dn.vercel.app'}]]}
      );
      return res.status(200).json({ok: true});
    }
    
    // /nds
    if (text === '/nds' || text.includes('ндс') || text.includes('налог')) {
      const now = new Date();
      const quarter = Math.floor(now.getMonth() / 3) + 1;
      const quarterEndMonth = quarter * 3;
      const quarterEnd = new Date(now.getFullYear(), quarterEndMonth, 25);
      const daysLeft = Math.ceil((quarterEnd - now) / (1000*60*60*24));
      
      await sendMessage(chatId,
        `🧾 <b>НДС · ${quarter} квартал</b>\n\n` +
        `НДС начисленный: ${fmt(vatSales)}\n` +
        `НДС к вычету: ${fmt(vatPurchases)}\n` +
        `━━━━━━━━━━━━\n` +
        `💳 К уплате: <b>${fmt(vatToPay)}</b>\n\n` +
        `⏰ До срока уплаты: <b>${daysLeft} дней</b>\n` +
        `Платите тремя частями по ${fmt(vatToPay/3)}`
      );
      return res.status(200).json({ok: true});
    }
    
    // /top
    if (text === '/top' || text.includes('топ') || text.includes('покупател')) {
      const byName = {};
      txs.filter(t=>t.amount>0).forEach(t=>{
        byName[t.name] = (byName[t.name]||0) + Number(t.amount);
      });
      const top = Object.entries(byName).sort(([,a],[,b])=>b-a).slice(0,5);
      
      await sendMessage(chatId,
        `💰 <b>Топ покупателей:</b>\n\n` +
        top.map(([name,val],i)=>`${i+1}. ${name.substring(0,30)}\n    ${fmt(val)}`).join('\n\n')
      );
      return res.status(200).json({ok: true});
    }
    
    // /last
    if (text === '/last' || text.includes('последн') || text.includes('операци')) {
      const last = txs.slice(0,5);
      await sendMessage(chatId,
        `📋 <b>Последние операции:</b>\n\n` +
        last.map(t=>`${t.date||'—'} · ${t.name.substring(0,25)}\n${t.amount>0?'➕':'➖'} ${fmt(t.amount)}`).join('\n\n')
      );
      return res.status(200).json({ok: true});
    }
    
    // /balance
    if (text === '/balance' || text.includes('баланс')) {
      await sendMessage(chatId,
        `💼 <b>Баланс:</b>\n\n` +
        `Доходы: +${fmt(income)}\n` +
        `Расходы: -${fmt(expense)}\n` +
        `━━━━━━━━━━━━\n` +
        `${profit>=0?'✅':'❌'} Итого: <b>${profit>=0?'+':''}${fmt(profit)}</b>`
      );
      return res.status(200).json({ok: true});
    }
    
    // Любой другой текст — помощь
    await sendMessage(chatId,
      `Не понял команду 🤔\n\nНапиши /help чтобы увидеть все команды.\n\nИли попробуй:\n• "сводка"\n• "ндс"\n• "топ покупателей"\n• "последние операции"`,
      {inline_keyboard: [[{text: '📊 Открыть OMSFIN', url: 'https://omschicken-u5dn.vercel.app'}]]}
    );
    
  } catch(e) {
    console.error('Bot error:', e);
    await sendMessage(chatId, '❌ Произошла ошибка. Попробуй позже.');
  }
  
  return res.status(200).json({ok: true});
}
