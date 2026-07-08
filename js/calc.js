// OMSFIN — чистая расчётная логика (налоги 2026, деньги, детекторы банков).
// БЕЗ DOM и fetch — только функции вход→выход, чтобы гонять тестами (tests/run.js).
// Работает и в браузере (window.OMSCALC), и в Node (module.exports).
//
// ЖЕЛЕЗНОЕ ПРАВИЛО: новая расчётная логика добавляется ТОЛЬКО сюда,
// и в том же коммите — тест на неё в tests/run.js.

(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory();
  else root.OMSCALC = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ═══ ДЕНЬГИ ══════════════════════════════════════════════════════════
  // Все расчёты — в копейках (целые числа), чтобы исключить float-ошибки
  // вида 0.1+0.2=0.30000000000000004. Наружу отдаём рубли.

  function toKop(rub) { return Math.round(Number(rub) * 100); }
  function toRub(kop) { return kop / 100; }
  // Округление денежной суммы в рублях до копеек — единственное место округления
  function roundMoney(rub) { return toRub(toKop(rub)); }
  // Округление до целого рубля (как в декларациях)
  function roundRub(rub) { return Math.round(Number(rub) || 0); }

  // ═══ НДС (ставки 2026: 10% льготная, 22% базовая) ════════════════════
  // НДС, «сидящий внутри» суммы с НДС: gross * rate / (100 + rate)
  function vatFromGross(gross, ratePct) {
    const g = toKop(gross);
    return toRub(Math.round(g * ratePct / (100 + ratePct)));
  }
  // НДС сверху на сумму без НДС
  function vatOnNet(net, ratePct) {
    const n = toKop(net);
    return toRub(Math.round(n * ratePct / 100));
  }

  // ═══ НДФЛ: прогрессивная шкала 2026 (зарплата, нарастающим итогом) ═══
  // 13% до 2.4 млн · 15% до 5 млн · 18% до 20 млн · 20% до 50 млн · 22% свыше
  const NDFL_BRACKETS = [
    { upTo: 2400000, rate: 0.13 },
    { upTo: 5000000, rate: 0.15 },
    { upTo: 20000000, rate: 0.18 },
    { upTo: 50000000, rate: 0.20 },
    { upTo: Infinity, rate: 0.22 },
  ];
  function ndflProgressive(yearlyIncome) {
    let taxKop = 0, prevCap = 0;
    const incomeKop = toKop(yearlyIncome);
    for (const b of NDFL_BRACKETS) {
      const capKop = b.upTo === Infinity ? Infinity : toKop(b.upTo);
      if (incomeKop <= prevCap) break;
      const taxable = Math.min(incomeKop, capKop) - prevCap;
      taxKop += Math.round(taxable * b.rate);
      prevCap = capKop;
    }
    return toRub(taxKop);
  }

  // ═══ НДФЛ с дивидендов: своя двухступенчатая шкала (НЕ складывается с зарплатной) ═══
  // 13% до 2.4 млн/год, 15% свыше
  function ndflDividends(yearlyDividends) {
    const d = toKop(yearlyDividends);
    const cap = toKop(2400000);
    if (d <= cap) return toRub(Math.round(d * 0.13));
    return toRub(Math.round(cap * 0.13) + Math.round((d - cap) * 0.15));
  }

  // ═══ Страховые взносы 2026: единый тариф 30% до предельной базы, 15.1% сверх ═══
  // Предельная база: 2 979 000 ₽/год на сотрудника. Льготы МСП отменены.
  const CONTRIB_LIMIT = 2979000;
  function insuranceContributions(yearlyPerPerson) {
    const y = toKop(yearlyPerPerson);
    const cap = toKop(CONTRIB_LIMIT);
    if (y <= cap) return toRub(Math.round(y * 0.30));
    return toRub(Math.round(cap * 0.30) + Math.round((y - cap) * 0.151));
  }
  // ФОТ на несколько сотрудников (равные оклады): persons человек, fot — суммарный годовой
  function insuranceContributionsFot(fot, persons) {
    persons = Math.max(1, Math.round(persons || 1));
    const perPerson = Number(fot) / persons;
    return roundMoney(insuranceContributions(perPerson) * persons);
  }

  // ═══ Налог на прибыль 2026: 25% (8% фед + 17% рег) ═══════════════════
  function profitTax(base) {
    if (base <= 0) return 0;
    const b = toKop(base);
    return toRub(Math.round(b * 0.25));
  }
  function profitTaxSplit(base) {
    if (base <= 0) return { fed: 0, reg: 0, total: 0 };
    const b = toKop(base);
    const fed = Math.round(b * 0.08);
    const reg = Math.round(b * 0.17);
    return { fed: toRub(fed), reg: toRub(reg), total: toRub(fed + reg) };
  }

  // ═══ УСН «доходы минус расходы» 15% ══════════════════════════════════
  function usnTax(income, expense) {
    const base = Math.max(0, toKop(income) - toKop(expense));
    return toRub(Math.round(base * 0.15));
  }

  // ═══ Детекторы форматов банковских выписок ═══════════════════════════
  // Вынесены из index.html, чтобы покрыть тестами на реальных образцах строк.

  function isBankTBank(t) {
    const head = t.substring(0, 500).toLowerCase();
    return head.includes('тбанк') || head.includes('тинькофф') || head.includes('tbank') || head.includes('операционный день');
  }

  function isBankAlfa(t) {
    const lines = t.split('\n');
    for (let i = 0; i < Math.min(5, lines.length); i++) {
      const l = lines[i].toLowerCase();
      if (l.includes('d_c') && l.includes('sum_rur')) return true;
    }
    return false;
  }

  function isBankVTB(t) {
    const lines = t.split('\n');
    for (let i = 1; i < Math.min(4, lines.length); i++) {
      const parts = lines[i].split(';');
      if (parts.length > 10 && parts[0] !== '' && parts[1] === '' && parts[2] && parts[2].match(/\d{2}\.\d{2}\.\d{4}/)) return true;
    }
    return false;
  }

  // Формат «Кредит/Дебет» (Зенит, МКБ): заголовок "Номер счёта;Тип операции..."
  function isBankKreditDebet(t) {
    const first = t.split('\n')[0].toLowerCase();
    return first.includes('номер сч') && first.includes('тип операции');
  }

  function isBankSber(t) {
    if (isBankTBank(t)) return false;
    if (isBankKreditDebet(t)) return false;
    const head = t.substring(0, 800).toLowerCase();
    return head.includes('сбербанк') || head.includes('sberbank') ||
      head.includes('дата проведения') ||
      (head.includes('плательщик') && head.includes('получатель') && head.includes('назначение платежа'));
  }

  // ═══ ПАРСЕР КАССОВЫХ ЧЕКОВ (Слой 1: касса → операции сами) ═══════════
  // Нормализует вебхук ККТ в единый вид. Всегда отдаёт суммы в КОПЕЙКАХ.
  // Форматы: Эвотор (деньги в копейках), АТОЛ/МТС/Эйвери/generic (в рублях,
  // массив items). Сырой payload всегда сохраняется в raw_data вызывающим —
  // форматы ККТ в реальности плавают, парсер покрывает документированные формы.

  function _vatFromTag(tag) {
    if (tag == null) return null;
    const s = String(tag).toLowerCase().replace(/[^0-9a-zа-я]/g, '');
    if (s.indexOf('22') >= 0 || s.indexOf('20') >= 0) return 22;
    if (s.indexOf('10') >= 0) return 10;
    if (s.indexOf('0') >= 0 || s.indexOf('none') >= 0 || s.indexOf('no') >= 0 || s.indexOf('без') >= 0) return 0;
    return null;
  }

  function parsePosReceipt(payload) {
    if (!payload || typeof payload !== 'object') return null;

    // ── Эвотор: data.positions, деньги в КОПЕЙКАХ ──
    const evData = payload.data && Array.isArray(payload.data.positions) ? payload.data : null;
    if (evData) {
      const positions = evData.positions.map(function (p) {
        const kop = p.result != null ? p.result
          : (p.sum != null ? p.sum : (Number(p.price || 0) * Number(p.quantity || 1)));
        return {
          name: String(p.name || p.productName || 'Товар').slice(0, 200),
          amountKop: Math.round(Number(kop)),
          qty: Number(p.quantity || p.qty || 1),
          vatRate: _vatFromTag(p.tax && (p.tax.type || p.tax)),
        };
      }).filter(function (x) { return x.amountKop; });
      if (positions.length) return {
        format: 'evotor',
        sourceId: String(evData.id || payload.id || ''),
        occurredAt: evData.dateTime || evData.date || null,
        isReturn: /back|return|payback|возврат/i.test(String(evData.type || payload.type || '')),
        positions: positions,
      };
    }

    // ── АТОЛ / МТС Касса / Эйвери / generic: items[], деньги в РУБЛЯХ ──
    const rc = payload.receipt || payload;
    const items = Array.isArray(rc.items) ? rc.items
      : (Array.isArray(payload.items) ? payload.items : null);
    if (items && items.length) {
      const positions = items.map(function (p) {
        const rub = p.sum != null ? Number(p.sum) : (Number(p.price || 0) * Number(p.quantity || 1));
        return {
          name: String(p.name || 'Товар').slice(0, 200),
          amountKop: Math.round(rub * 100),
          qty: Number(p.quantity || 1),
          vatRate: _vatFromTag(p.vat && (p.vat.type || p.vat)),
        };
      }).filter(function (x) { return x.amountKop; });
      if (positions.length) return {
        format: payload.receipt ? 'atol' : 'generic',
        sourceId: String(payload.external_id || rc.external_id || rc.id || payload.id || ''),
        occurredAt: payload.timestamp || rc.timestamp || rc.date || null,
        isReturn: /back|return|возврат/i.test(String(rc.operation || rc.type || payload.type || '')),
        positions: positions,
      };
    }

    return null;
  }

  return {
    toKop, toRub, roundMoney, roundRub,
    vatFromGross, vatOnNet,
    ndflProgressive, ndflDividends,
    insuranceContributions, insuranceContributionsFot, CONTRIB_LIMIT,
    profitTax, profitTaxSplit, usnTax,
    isBankTBank, isBankAlfa, isBankVTB, isBankKreditDebet, isBankSber,
    parsePosReceipt,
  };
});
