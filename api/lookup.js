// Объединённый прокси для проверки контрагентов — раньше было два отдельных файла
// (dadata.js + egrul.js), слиты в один, чтобы не превышать лимит serverless-функций
// на бесплатном тарифе Vercel (12 штук).
//
// Использование с фронтенда:
//   GET  /api/lookup?provider=egrul&inn=1234567890
//   GET  /api/lookup?provider=dadata&action=findById&inn=1234567890
//   GET  /api/lookup?provider=dadata&action=suggest&query=Рога+и+копыта
//
// Переменные окружения в Vercel (для dadata):
//   DADATA_TOKEN_FINDBYID — токен с правами на findById (поиск по ИНН)
//   DADATA_TOKEN_SUGGEST  — токен с правами на suggest (поиск по названию)
//   DADATA_TOKEN — общий fallback, если раздельные токены не заданы

const DADATA_TOKEN_FINDBYID = process.env.DADATA_TOKEN_FINDBYID || process.env.DADATA_TOKEN;
const DADATA_TOKEN_SUGGEST = process.env.DADATA_TOKEN_SUGGEST || process.env.DADATA_TOKEN;

async function handleEgrul(req, res) {
  const { inn } = req.query;
  if (!inn) return res.status(400).json({ error: 'Не указан ИНН' });

  try {
    // API ФНС ЕГРЮЛ
    const r = await fetch(`https://egrul.itsoft.ru/${inn}.json`);
    if (r.ok) {
      const data = await r.json();
      return res.status(200).json({ source: 'egrul', data });
    }
  } catch (e) {}

  try {
    // Запасной — API СБИС
    const r = await fetch(`https://api.sber.ru/prod/sberbusiness/rusProfile/v1/companies/${inn}`, {
      headers: { 'Accept': 'application/json' }
    });
    if (r.ok) {
      const data = await r.json();
      return res.status(200).json({ source: 'sber', data });
    }
  } catch (e) {}

  try {
    // Ещё один запасной — открытый API
    const r = await fetch(`https://www.rusprofile.ru/ajax.php?action=getCompanyByInn&inn=${inn}`, {
      headers: { 'Accept': 'application/json', 'Referer': 'https://www.rusprofile.ru/' }
    });
    if (r.ok) {
      const data = await r.json();
      return res.status(200).json({ source: 'rusprofile', data });
    }
  } catch (e) {}

  return res.status(404).json({ error: 'Not found' });
}

async function handleDadata(req, res) {
  const { action, inn, query } = req.query;

  if (action === 'findById') {
    if (!DADATA_TOKEN_FINDBYID) return res.status(500).json({ error: 'DADATA_TOKEN_FINDBYID не настроен на сервере' });
    if (!inn) return res.status(400).json({ error: 'inn is required' });
    const r = await fetch('https://suggestions.dadata.ru/suggestions/api/4_1/rs/findById/party', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Token ' + DADATA_TOKEN_FINDBYID
      },
      body: JSON.stringify({ query: inn, count: 1 })
    });
    const data = await r.json();
    return res.status(200).json(data);
  }

  if (action === 'suggest') {
    if (!DADATA_TOKEN_SUGGEST) return res.status(500).json({ error: 'DADATA_TOKEN_SUGGEST не настроен на сервере' });
    if (!query) return res.status(400).json({ error: 'Не указан запрос' });
    const r = await fetch('https://suggestions.dadata.ru/suggestions/api/4_1/rs/suggest/party', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Token ' + DADATA_TOKEN_SUGGEST
      },
      body: JSON.stringify({ query, count: 5 })
    });
    const data = await r.json();
    return res.status(200).json(data);
  }

  return res.status(400).json({ error: 'Неизвестное действие' });
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { provider } = req.query;

  try {
    if (provider === 'egrul') return await handleEgrul(req, res);
    if (provider === 'dadata') return await handleDadata(req, res);
    if (provider === 'currency') return await handleCurrency(req, res);
    return res.status(400).json({ error: 'Unknown provider. Use provider=egrul|dadata|currency' });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}

async function handleCurrency(req, res) {
  const r = await fetch('https://www.cbr-xml-daily.ru/daily_json.js', {
    headers: { 'User-Agent': 'OMSFIN/1.0' }
  });
  if (!r.ok) return res.status(502).json({ error: 'ЦБ API недоступен' });
  const data = await r.json();
  // Возвращаем только нужные валюты + дату
  const currencies = {};
  const want = ['USD', 'EUR', 'CNY', 'GBP', 'TRY', 'KZT', 'BYR', 'AED'];
  for (const code of want) {
    const cur = data.Valute?.[code];
    if (cur) currencies[code] = {
      name: cur.Name,
      rate: cur.Value / cur.Nominal,
      nominal: cur.Nominal,
      previous: cur.Previous / cur.Nominal
    };
  }
  return res.status(200).json({
    date: data.Date,
    currencies,
    source: 'cbr.ru'
  });
}
