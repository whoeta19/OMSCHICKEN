#!/usr/bin/env node
// OMSFIN — самотесты чистой логики. Запуск: node tests/run.js
// Без npm-зависимостей. Провал любого теста -> exit 1 (pre-commit блокирует коммит).

'use strict';
const path = require('path');
const calc = require(path.join(__dirname, '..', 'js', 'calc.js'));

let passed = 0, failed = 0;
function eq(actual, expected, name) {
  const ok = Number.isFinite(expected)
    ? Math.abs(actual - expected) < 0.005 // деньги: допуск полкопейки
    : actual === expected;
  if (ok) { passed++; }
  else { failed++; console.error(`  ✗ ${name}\n    ожидалось: ${expected}\n    получено:  ${actual}`); }
}

// ═══ parseDMY / parsePeriod (копия из utils.js — браузерный файл, дублируем эталон) ═══
function parseDMY(str) {
  if (!str) return 0;
  const [dd, mm, yyyy] = String(str).split('.').map(Number);
  if (!dd || !mm || !yyyy) return 0;
  return new Date(yyyy, mm - 1, dd).getTime();
}
function parsePeriod(str) {
  if (!str) return 0;
  const [mm, yyyy] = String(str).split('.').map(Number);
  if (!mm || !yyyy) return 0;
  return yyyy * 100 + mm;
}

console.log('── Даты DD.MM.YYYY');
eq(parseDMY('20.12.2025') < parseDMY('05.01.2026'), true, 'граница года: 20.12.2025 < 05.01.2026');
eq(parseDMY('31.01.2026') < parseDMY('01.02.2026'), true, 'граница месяца');
eq(parseDMY('29.02.2024') > 0, true, 'високосный год валиден');
eq(parseDMY(''), 0, 'пустая строка -> 0');
eq(parseDMY('мусор'), 0, 'мусор -> 0');
eq(parseDMY('2026-01-05'), 0, 'ISO-формат не принимается (не DD.MM.YYYY)');
eq(parsePeriod('12.2025') < parsePeriod('01.2026'), true, 'период: декабрь 2025 < январь 2026');
eq(parsePeriod('bad'), 0, 'битый период -> 0');

console.log('── Деньги (копейки)');
eq(calc.toKop(0.1) + calc.toKop(0.2), 30, '0.1+0.2 в копейках = ровно 30');
eq(calc.roundMoney(0.1 + 0.2), 0.3, 'roundMoney лечит float');
eq(calc.toRub(calc.toKop(1234567.89)), 1234567.89, 'туда-обратно без потерь');
eq(calc.roundRub(99.5), 100, 'roundRub 99.5 -> 100');

console.log('── НДС 2026 (10% льготная, 22% базовая)');
eq(calc.vatFromGross(110, 10), 10, '110 ₽ с НДС 10% -> НДС 10 ₽ (10/110)');
eq(calc.vatFromGross(122, 22), 22, '122 ₽ с НДС 22% -> НДС 22 ₽ (22/122)');
eq(calc.vatFromGross(1100000, 10), 100000, 'миллион сто: НДС 100 000');
eq(calc.vatOnNet(100, 22), 22, 'НДС сверху: 100 + 22%');
eq(calc.vatFromGross(0, 10), 0, 'ноль -> ноль');

console.log('── НДФЛ прогрессивный (13/15/18/20/22, нарастающим итогом)');
eq(calc.ndflProgressive(1000000), 130000, '1 млн -> 13%');
eq(calc.ndflProgressive(2400000), 312000, 'ровно 2.4 млн -> 312 000 (вся база по 13%)');
eq(calc.ndflProgressive(2400001), 312000.15, '2.4 млн + 1₽ -> рубль сверху по 15%');
eq(calc.ndflProgressive(5000000), 312000 + 2600000 * 0.15, 'ровно 5 млн');
eq(calc.ndflProgressive(20000000), 312000 + 390000 + 15000000 * 0.18, 'ровно 20 млн');
eq(calc.ndflProgressive(50000000), 312000 + 390000 + 2700000 + 30000000 * 0.20, 'ровно 50 млн');
eq(calc.ndflProgressive(60000000), 312000 + 390000 + 2700000 + 6000000 + 10000000 * 0.22, '60 млн: хвост по 22%');
eq(calc.ndflProgressive(0), 0, 'ноль дохода');

console.log('── НДФЛ дивиденды (своя шкала 13/15, НЕ зарплатная)');
eq(calc.ndflDividends(2400000), 312000, 'ровно 2.4 млн -> 13%');
eq(calc.ndflDividends(3000000), 312000 + 600000 * 0.15, '3 млн: хвост по 15%');
eq(calc.ndflDividends(1), 0.13, 'один рубль');

console.log('── Страховые взносы 2026 (30% до 2 979 000, 15.1% сверх, МСП-льгот нет)');
eq(calc.insuranceContributions(1000000), 300000, '1 млн -> 30%');
eq(calc.insuranceContributions(2979000), 893700, 'ровно предельная база');
eq(calc.insuranceContributions(3979000), 893700 + 1000000 * 0.151, 'миллион сверх базы по 15.1%');
eq(calc.insuranceContributionsFot(2000000, 2), 600000, 'ФОТ 2 млн на двоих -> 30%');

console.log('── Налог на прибыль 25% (8 фед + 17 рег)');
eq(calc.profitTax(1000000), 250000, '1 млн прибыли -> 250 000');
eq(calc.profitTax(-500), 0, 'убыток -> 0');
const split = calc.profitTaxSplit(1000000);
eq(split.fed, 80000, 'федеральная часть 8%');
eq(split.reg, 170000, 'региональная часть 17%');
eq(split.total, 250000, 'сумма частей = 25%');

console.log('── УСН 15% (доходы минус расходы)');
eq(calc.usnTax(1000000, 400000), 90000, '(1млн - 400к) * 15%');
eq(calc.usnTax(100, 200), 0, 'расход больше дохода -> 0');

console.log('── Детекторы банковских выписок (реальные образцы строк)');
const ALFA_SAMPLE = 'statement_unid\tType_close\tDate\tb_date\tm_date\tcreate_date\tName\tInn\tRch\tname_rch\tBik\tKorch\tType\tname_curr\tbal_curr\tbc_rur\tbc_val\tbd_rur\tbd_val\tsc_rur\tSc_val\tSd_rur\tSd_val\tTc_rur\tTc_val\tTd_rur\tTd_val\td_c\toper\tdate_oper\tnumber\to_date\tsum_rur\n' +
  '\t0\t17.06.2026\t01.06.2026\t17.06.2026\t17.06.2026\tООО Ромашка\t5800015301\t40702810602610007184\tосновной\t044525593\t301018\tRUR\t0\t\t2000,00\t2000,00\t\t\t554641,86\t554641,86\t359819,66\t359819,66\t196822,20\t196822,20\t\t\tC\t01\t17.06.2026\t203\t17.06.2026\t196641,86';
const VTB_SAMPLE = '"Тип";"Идентификатор";"Дата совершения";"Дата списания";"Дата";"Номер";"Тип операции";"Сумма";"Валюта";"Назначение платежа";"БИК";"Счет"\n' +
  '17;;01.01.2026;01.01.2026;01.01.2026;407144;17;-1480.00;RUB;Оплата пакета услуг;044525411;47422810824684002426;Банк;7702070139';
const KREDIT_DEBET_SAMPLE = 'Номер счёта;Тип операции (пополнение/списание);Дата проведения;Номер платежа;Валюта операции;Сумма в валюте счёта\n' +
  '40702810210001915113;Кредит;10.06.2025;61;643;100000,0';
const TBANK_SAMPLE = 'Т-Банк. Операционный день 01.06.2026\nПлательщик;Получатель;Назначение платежа;Сумма';
const SBER_SAMPLE = '"Дата проведения";"Вид";"Сумма";"Плательщик";"ИНН плательщика";"Получатель";"Назначение платежа"\n"01.06.2026";"01";"1000.00";"ООО А";"1";"ООО Б";"за товар"';

eq(calc.isBankAlfa(ALFA_SAMPLE), true, 'Альфа-Бизнес распознан по d_c+sum_rur');
eq(calc.isBankVTB(VTB_SAMPLE), true, 'ВТБ распознан по структуре ;;дата');
eq(calc.isBankKreditDebet(KREDIT_DEBET_SAMPLE), true, 'Кредит/Дебет (Зенит/МКБ) распознан');
eq(calc.isBankTBank(TBANK_SAMPLE), true, 'Т-Банк распознан');
eq(calc.isBankSber(SBER_SAMPLE), true, 'Сбер распознан');
eq(calc.isBankSber(TBANK_SAMPLE), false, 'Т-Банк НЕ путается со Сбером');
eq(calc.isBankSber(KREDIT_DEBET_SAMPLE), false, 'Кредит/Дебет НЕ путается со Сбером (оба содержат «Дата проведения»)');
eq(calc.isBankVTB(KREDIT_DEBET_SAMPLE), false, 'Кредит/Дебет НЕ путается с ВТБ');
eq(calc.isBankAlfa(VTB_SAMPLE), false, 'ВТБ НЕ путается с Альфой');

// ═══ Итог ═══
console.log('');
if (failed) {
  console.error(`ПРОВАЛ: ${failed} из ${passed + failed} тестов упали`);
  process.exit(1);
} else {
  console.log(`OK: все ${passed} тестов зелёные`);
}
