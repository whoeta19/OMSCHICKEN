export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { inn } = req.query;
  if (!inn) return res.status(400).json({error: 'No INN'});

  try {
    // API ФНС ЕГРЮЛ
    const r = await fetch(`https://egrul.itsoft.ru/${inn}.json`);
    if (r.ok) {
      const data = await r.json();
      return res.status(200).json({source: 'egrul', data});
    }
  } catch(e) {}

  try {
    // Запасной — API СБИС
    const r = await fetch(`https://api.sber.ru/prod/sberbusiness/rusProfile/v1/companies/${inn}`, {
      headers: {'Accept': 'application/json'}
    });
    if (r.ok) {
      const data = await r.json();
      return res.status(200).json({source: 'sber', data});
    }
  } catch(e) {}

  try {
    // Ещё один запасной — открытый API
    const r = await fetch(`https://www.rusprofile.ru/ajax.php?action=getCompanyByInn&inn=${inn}`, {
      headers: {'Accept': 'application/json', 'Referer': 'https://www.rusprofile.ru/'}
    });
    if (r.ok) {
      const data = await r.json();
      return res.status(200).json({source: 'rusprofile', data});
    }
  } catch(e) {}

  return res.status(404).json({error: 'Not found'});
}
