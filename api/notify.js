const BOT_TOKEN = '8514433988:AAHvGhmxdIICzzEfXlfe2OIjB_Ynn3gLJao';
const SUPABASE_URL = 'https://sqyppamdxahvvkoxovpu.supabase.co';
const SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNxeXBwYW1keGFodnZrb3hvdnB1Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MDE2NDYzOCwiZXhwIjoyMDk1NzQwNjM4fQ.CjCybI9bSk1uYbjWl8clQDPPzB7exzUa029DUtPQen8';

const adminHeaders = {
  'apikey': SERVICE_KEY,
  'Authorization': 'Bearer ' + SERVICE_KEY,
  'Content-Type': 'application/json'
};

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

export default async function handler(req, res) {
  // Проверяем что это cron запрос от Vercel
  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}` && req.method !== 'GET') {
    return res.status(401).json({error: 'Unauthorized'});
  }

  const now = new Date();
  const day = now.getDate();
  const month = now.getMonth();
  const year = now.getFullYear();
  
  // Определяем текущий квартал
  const quarter = Math.floor(month / 3) + 1;
  const quarterEndMonth = quarter * 3; // месяц конца квартала (1-12)
  
  // Дата уплаты НДС — 25-е число следующего за кварталом месяца
  const vatDeadlines = [
    new Date(year, 3, 25), // 25 апреля (Q1)
    new Date(year, 6, 25), // 25 июля (Q2)  
    new Date(year, 9, 25), // 25 октября (Q3)
    new Date(year + 1, 0, 25), // 25 января (Q4)
  ];
  
  // Ближайший дедлайн НДС
  const nextVatDeadline = vatDeadlines.find(d => d > now);
  const daysToVat = nextVatDeadline ? Math.ceil((nextVatDeadline - now) / (1000*60*60*24)) : null;
  
  // Конец месяца
  const lastDayOfMonth = new Date(year, month + 1, 0).getDate();
  const daysToMonthEnd = lastDayOfMonth - day;
  
  try {
    // Получаем всех пользователей с привязанным Telegram
    const r = await fetch(`${SUPABASE_URL}/rest/v1/telegram_users?select=telegram_id,user_id`, {
      headers: {...adminHeaders, 'Prefer': 'return=representation'}
    });
    const users = await r.json();
    
    if (!Array.isArray(users) || !users.length) {
      return res.status(200).json({ok: true, message: 'No users with Telegram'});
    }
    
    let notified = 0;
    
    for (const user of users) {
      const {telegram_id, user_id} = user;
      
      // Получаем транзакции пользователя
      const txR = await fetch(`${SUPABASE_URL}/rest/v1/transactions?user_id=eq.${user_id}&limit=5000`, {
        headers: {...adminHeaders, 'Prefer': 'return=representation'}
      });
      const txs = await txR.json();
      if (!Array.isArray(txs) || !txs.length) continue;
      
      const income = txs.filter(t=>t.amount>0&&t.category==='income').reduce((s,t)=>s+Number(t.amount),0);
      const purchases = txs.filter(t=>t.amount<0&&t.category==='chicken').reduce((s,t)=>s+Math.abs(Number(t.amount)),0);
      const vatToPay = Math.round((income * 10/110) - (purchases * 10/110));
      
      const messages = [];
      
      // НДС напоминание
      if (daysToVat !== null && [30, 14, 7, 3, 1].includes(daysToVat) && vatToPay > 0) {
        messages.push(
          `🧾 <b>Напоминание об уплате НДС</b>\n\n` +
          `До срока уплаты осталось: <b>${daysToVat} ${daysToVat === 1 ? 'день' : daysToVat < 5 ? 'дня' : 'дней'}</b>\n` +
          `Срок: <b>${nextVatDeadline.toLocaleDateString('ru-RU')}</b>\n` +
          `НДС к уплате: <b>${fmt(vatToPay)}</b>\n\n` +
          `Уплачивается тремя частями по ${fmt(vatToPay/3)}\n\n` +
          `<a href="https://omschicken-u5dn.vercel.app/vat">Открыть расчёт НДС →</a>`
        );
      }
      
      // Конец месяца — напоминание загрузить выписку
      if (daysToMonthEnd <= 2) {
        messages.push(
          `📊 <b>Конец месяца</b>\n\n` +
          `Не забудь загрузить выписку из банка за ${now.toLocaleDateString('ru-RU', {month:'long', year:'numeric'})}.\n\n` +
          `<a href="https://omschicken-u5dn.vercel.app">Открыть OMSFIN →</a>`
        );
      }
      
      // Зарплата — 25-е число
      if (day === 23) {
        messages.push(
          `👥 <b>Напоминание о зарплате</b>\n\n` +
          `Через 2 дня — 25-е число.\n` +
          `Не забудь выплатить зарплату сотрудникам.\n\n` +
          `<a href="https://omschicken-u5dn.vercel.app">Открыть OMSFIN →</a>`
        );
      }
      
      // Отправляем все уведомления
      for (const msg of messages) {
        await sendTelegram(telegram_id, msg);
        notified++;
      }
    }
    
    return res.status(200).json({
      ok: true,
      users: users.length,
      notified,
      daysToVat,
      daysToMonthEnd
    });
    
  } catch(e) {
    return res.status(500).json({error: e.message});
  }
}
