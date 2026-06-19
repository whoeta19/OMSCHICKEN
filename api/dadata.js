// Прокси к Dadata API — токены хранятся на сервере (переменные окружения),
// не в клиентском JS, чтобы не светить их в исходниках браузера.
//
// Использование с фронтенда:
//   GET  /api/dadata?action=findById&inn=1234567890
//   GET  /api/dadata?action=suggest&query=Рога+и+копыта
//
// Требуются переменные окружения в Vercel:
//   DADATA_TOKEN_FINDBYID — токен с правами на findById (поиск по ИНН)
//   DADATA_TOKEN_SUGGEST  — токен с правами на suggest (поиск по названию)
// Если задана только DADATA_TOKEN — используется для обоих действий (fallback).

const DADATA_TOKEN_FINDBYID = process.env.DADATA_TOKEN_FINDBYID || process.env.DADATA_TOKEN;
const DADATA_TOKEN_SUGGEST = process.env.DADATA_TOKEN_SUGGEST || process.env.DADATA_TOKEN;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { action, inn, query } = req.query;

  try {
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
      if (!query) return res.status(400).json({ error: 'query is required' });
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

    return res.status(400).json({ error: 'Unknown action. Use action=findById or action=suggest' });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
