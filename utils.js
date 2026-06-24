// Общие утилиты OMSFIN — подключать через <script src="/utils.js">

// Форматирование суммы в рублях
function fmt(n) {
  return Math.abs(n).toLocaleString('ru-RU', { maximumFractionDigits: 0 }) + ' ₽';
}

// Парсинг даты DD.MM.YYYY → timestamp.
// Никогда не сравнивай DD.MM.YYYY строки через > < напрямую — порядок полей ломает сравнение.
function parseDMY(str) {
  if (!str) return 0;
  const [dd, mm, yyyy] = str.split('.').map(Number);
  if (!dd || !mm || !yyyy) return 0;
  return new Date(yyyy, mm - 1, dd).getTime();
}

// Форматирование даты timestamp → DD.MM.YYYY
function toDMY(ts) {
  const d = new Date(ts);
  return String(d.getDate()).padStart(2, '0') + '.' +
    String(d.getMonth() + 1).padStart(2, '0') + '.' + d.getFullYear();
}

// Парсинг периода MM.YYYY → сортируемое число (yyyy*100+mm).
// Нельзя сравнивать MM.YYYY строкой: '01.2026' окажется раньше '12.2025'.
function parsePeriod(str) {
  if (!str) return 0;
  const [mm, yyyy] = str.split('.').map(Number);
  if (!mm || !yyyy) return 0;
  return yyyy * 100 + mm;
}

// Экранирование строки для безопасной вставки в innerHTML.
// Имена контрагентов/компаний приходят из выписок и ЕГРЮЛ — внешние данные,
// без экранирования возможен XSS (имя вида <img src=x onerror=...>).
function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
