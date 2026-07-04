// Общие утилиты OMSFIN — подключать через <script src="/utils.js">
// Это ЕДИНСТВЕННЫЙ источник истины для: parseDMY, toDMY, parsePeriod,
// escapeHtml, showToast, fmtMoney, mskNow, safeFetch, showSkeleton, hideSkeleton.
// Не объявляй эти функции повторно на страницах — используй из этого файла.

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

// Тост-уведомление. Самодостаточно: создаёт элемент и стили, если их нет на странице.
// Не переопределяет showToast, объявленный на самой странице (там свой #toast и CSS).
if (typeof window !== 'undefined' && typeof window.showToast !== 'function') {
  window.showToast = function (msg) {
    var t = document.getElementById('toast');
    if (!t) {
      if (!document.getElementById('oms-toast-style')) {
        var s = document.createElement('style');
        s.id = 'oms-toast-style';
        s.textContent =
          '#toast{position:fixed;bottom:20px;right:16px;left:16px;max-width:420px;margin:0 auto;' +
          'background:rgba(15,15,15,0.95);backdrop-filter:blur(20px);' +
          'border:1px solid rgba(255,107,0,0.25);border-radius:14px;padding:13px 18px;' +
          'font-size:13px;color:var(--text,#f5f5f5);font-family:Inter,sans-serif;' +
          'transform:translateY(100px);opacity:0;transition:all 0.35s cubic-bezier(0.4,0,0.2,1);' +
          'z-index:9999;box-shadow:0 20px 40px rgba(0,0,0,0.5);pointer-events:none;}' +
          '#toast.show{transform:translateY(0);opacity:1;}';
        document.head.appendChild(s);
      }
      t = document.createElement('div');
      t.id = 'toast';
      document.body.appendChild(t);
    }
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(t._hideTimer);
    t._hideTimer = setTimeout(function () { t.classList.remove('show'); }, 3000);
  };
}

// ═══ Деньги: единое форматирование (только отсюда!) ═══════════════════
const _omsNf0 = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 });
const _omsNf2 = new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
// fmtMoney(1234567.8) -> '1 234 568 ₽' (знак суммы СОХРАНЯЕТСЯ)
function fmtMoney(rub) { return _omsNf0.format(Math.round(Number(rub) || 0)) + ' ₽'; }
function fmtMoney2(rub) { return _omsNf2.format(Number(rub) || 0) + ' ₽'; }

// ═══ Московское время: налоговые дедлайны считаем ТОЛЬКО по МСК ═══════
// new Date() у пользователя во Владивостоке даст «дедлайн прошёл» на 7 часов
// раньше реального срока. mskNow() возвращает Date, чьи «локальные» поля
// (getDate/getMonth/...) соответствуют московскому времени.
function mskNow() {
  const now = new Date();
  const mskString = now.toLocaleString('en-US', { timeZone: 'Europe/Moscow' });
  return new Date(mskString);
}

// ═══ safeFetch: таймаут + response.ok + единая обработка ошибок ════════
// Использование: const data = await safeFetch('/api/...', opts)
//   -> при не-2xx или таймауте бросает Error с человеческим message
//   -> возвращает распарсенный JSON
async function safeFetch(url, opts = {}, timeoutMs = 15000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { ...opts, signal: ctrl.signal });
    if (!r.ok) {
      let msg = 'Ошибка ' + r.status;
      try { const d = await r.json(); msg = d.error || d.msg || msg; } catch (e) {}
      throw new Error(msg);
    }
    const ct = r.headers.get('content-type') || '';
    return ct.includes('json') ? r.json() : r.text();
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('Сервер не ответил за ' + Math.round(timeoutMs / 1000) + ' сек — попробуйте ещё раз');
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

// ═══ Алиасы для совместимости с заданием ══════════════════════════════
// toKopeyki / fromKopeyki — обёртки над calc.js (если подключён) или встроенные
function toKopeyki(rub) {
  return Math.round(Number(rub) * 100);
}
function fromKopeyki(kop) {
  const rub = (kop || 0) / 100;
  return new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(rub) + ' ₽';
}
// formatMoney — псевдоним fmtMoney для новых страниц
function formatMoney(rub) { return fmtMoney(rub); }

// ═══ Skeleton-заглушки при загрузке данных ════════════════════════════
// showSkeleton(el, rows) — заполняет контейнер shimmer-строками
// hideSkeleton(el) — очищает (вызывается перед вставкой реальных данных)
function showSkeleton(container, rows) {
  if (!container) return;
  rows = rows || 4;
  container.innerHTML = Array.from({ length: rows }, () =>
    '<div class="skeleton" style="height:44px;border-radius:10px;margin-bottom:8px"></div>'
  ).join('');
}
function hideSkeleton(container) {
  if (!container) return;
  container.innerHTML = '';
}
