// Экспорт в Excel через SheetJS
// Подключается как отдельный скрипт

function exportToExcel(allTx) {
  // Динамически загружаем SheetJS
  const script = document.createElement('script');
  script.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
  script.onload = () => doExport(allTx);
  document.head.appendChild(script);
}

function doExport(allTx) {
  const wb = XLSX.utils.book_new();

  // Лист 1 — Все операции
  const txData = [
    ['Дата', 'Контрагент', 'Сумма', 'Категория', 'Назначение', 'Период']
  ];
  allTx.forEach(t => {
    txData.push([
      t.date || '',
      t.name || '',
      Number(t.amount) || 0,
      getCatName(t.category),
      t.description || '',
      t.period || ''
    ]);
  });
  const ws1 = XLSX.utils.aoa_to_sheet(txData);
  ws1['!cols'] = [{wch:12},{wch:40},{wch:15},{wch:15},{wch:40},{wch:10}];
  XLSX.utils.book_append_sheet(wb, ws1, 'Операции');

  // Лист 2 — Сводка по категориям
  const cats = ['chicken','transport','food','personal','salary','office','bank','unknown'];
  const catNames = {'chicken':'Курятина','transport':'Транспорт','food':'Еда','personal':'Личное','salary':'Зарплата','office':'Офис','bank':'Банк','unknown':'Прочее'};
  const income = allTx.filter(t=>t.amount>0).reduce((s,t)=>s+Number(t.amount),0);
  const expense = allTx.filter(t=>t.amount<0).reduce((s,t)=>s+Math.abs(Number(t.amount)),0);

  const summData = [
    ['Показатель', 'Сумма'],
    ['Общий доход', income],
    ['Общий расход', expense],
    ['Прибыль', income - expense],
    ['', ''],
    ['Категория', 'Расход'],
  ];
  cats.forEach(cat => {
    const val = allTx.filter(t=>t.category===cat&&t.amount<0).reduce((s,t)=>s+Math.abs(Number(t.amount)),0);
    if (val > 0) summData.push([catNames[cat], val]);
  });
  const ws2 = XLSX.utils.aoa_to_sheet(summData);
  ws2['!cols'] = [{wch:20},{wch:15}];
  XLSX.utils.book_append_sheet(wb, ws2, 'Сводка');

  // Лист 3 — НДС
  const sales = allTx.filter(t=>t.amount>0&&t.category==='income');
  const purchases = allTx.filter(t=>t.amount<0&&t.category==='chicken');
  const totalSales = sales.reduce((s,t)=>s+Number(t.amount),0);
  const totalPurchases = purchases.reduce((s,t)=>s+Math.abs(Number(t.amount)),0);
  const vatSales = totalSales * 10 / 110;
  const vatPurchases = totalPurchases * 10 / 110;

  const vatData = [
    ['НДС РАСЧЁТ', ''],
    ['', ''],
    ['Выручка с НДС', totalSales],
    ['НДС начисленный (10%)', vatSales],
    ['Выручка без НДС', totalSales - vatSales],
    ['', ''],
    ['Закупки с НДС', totalPurchases],
    ['НДС к вычету (10%)', vatPurchases],
    ['Закупки без НДС', totalPurchases - vatPurchases],
    ['', ''],
    ['НДС К УПЛАТЕ', vatSales - vatPurchases],
    ['', ''],
    ['КНИГА ПРОДАЖ', '', '', '', ''],
    ['№', 'Дата', 'Покупатель', 'Сумма с НДС', 'НДС 10%', 'Без НДС'],
  ];
  sales.forEach((t,i) => {
    const vat = Number(t.amount) * 10 / 110;
    vatData.push([i+1, t.date||'', t.name||'', Number(t.amount), vat, Number(t.amount)-vat]);
  });
  vatData.push(['', '']);
  vatData.push(['КНИГА ПОКУПОК', '', '', '', '']);
  vatData.push(['№', 'Дата', 'Поставщик', 'Сумма с НДС', 'НДС 10%', 'Без НДС']);
  purchases.forEach((t,i) => {
    const amt = Math.abs(Number(t.amount));
    const vat = amt * 10 / 110;
    vatData.push([i+1, t.date||'', t.name||'', amt, vat, amt-vat]);
  });

  const ws3 = XLSX.utils.aoa_to_sheet(vatData);
  ws3['!cols'] = [{wch:5},{wch:12},{wch:40},{wch:15},{wch:12},{wch:15}];
  XLSX.utils.book_append_sheet(wb, ws3, 'НДС');

  // Скачиваем
  const date = new Date().toISOString().split('T')[0];
  XLSX.writeFile(wb, `ОМСЧИКЕН_${date}.xlsx`);
}

function getCatName(cat) {
  const m = {income:'Доход',chicken:'Курятина',transport:'Транспорт',food:'Еда',personal:'Личное',salary:'Зарплата',office:'Офис',bank:'Банк',unknown:'Прочее'};
  return m[cat] || cat;
}
