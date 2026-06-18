with open('index.html', 'r') as f:
    content = f.read()

old = '''  } else if (bank === 'alfa') {
    for (let i = 2; i < lines.length; i++) {
      const cols = lines[i].split('\\t').map(c => c.trim());
      if (cols.length < 32) continue;
      const dateStr = cols[2] || '';
      if (!dateStr.match(/\\d{2}\\.\\d{2}\\.\\d{4}/)) continue;
      const dc = cols[27] || '';
      if (dc !== 'D' && dc !== 'C') continue;
      const amountRaw = (cols[31] || '0').replace(',', '.');
      const absAmount = parseFloat(amountRaw);
      if (isNaN(absAmount) || absAmount === 0) continue;
      const amount = (dc === 'D') ? -absAmount : absAmount;
      if (!monthKey) { const p = dateStr.split('.'); monthKey = p[1] + '.' + p[2]; }
      const description = (cols[65] || cols[64] || '').substring(0, 100);
      const myInn = '5800015301';
      const payer = (cols[32] || '').trim();
      const payerInn = (cols[33] || '').trim();
      const receiver = (cols[40] || '').trim();
      const receiverInn = (cols[41] || '').trim();
      let name = '';
      if (amount > 0) {
        name = payerInn !== myInn ? payer : receiver;
      } else {
        name = receiverInn !== myInn ? receiver : payer;
      }
      name = name.replace(/ООО "ОМСЧИКЕН"|ОБЩЕСТВО С ОГРАНИЧЕННОЙ ОТВЕТСТВЕННОСТЬЮ "ОМСЧИКЕН"/gi, '').trim() || description.substring(0, 60);
      const category = classify(name, description, amount);
      txs.push({name: name || description.substring(0, 40), amount, date: dateStr, description, category, period: monthKey, is_personal: ['personal','food'].includes(category)});
    }
  }'''

new = '''  } else if (bank === 'alfa') {
    // Альфа: tab-разделитель
    // Ищем индексы колонок по заголовку
    let dcIdx = 27, amtIdx = 31, descIdx = 65, payerIdx = 32, payerInnIdx = 33, recvIdx = 40, recvInnIdx = 41;
    // Заголовок в строке 0 — ищем нужные колонки
    if (lines[0]) {
      const hdr = lines[0].split('\\t').map(c => c.trim().toLowerCase());
      const dc2 = hdr.findIndex(h => h === 'd_c');
      const amt2 = hdr.findIndex(h => h === 'sum_rur' || h === 'sum_val');
      const desc2 = hdr.findIndex(h => h === 'text70');
      const payer2 = hdr.findIndex(h => h === 'plat_name');
      const payerInn2 = hdr.findIndex(h => h === 'plat_inn');
      const recv2 = hdr.findIndex(h => h === 'pol_name');
      const recvInn2 = hdr.findIndex(h => h === 'pol_inn');
      if (dc2 >= 0) dcIdx = dc2;
      if (amt2 >= 0) amtIdx = amt2;
      if (desc2 >= 0) descIdx = desc2;
      if (payer2 >= 0) payerIdx = payer2;
      if (payerInn2 >= 0) payerInnIdx = payerInn2;
      if (recv2 >= 0) recvIdx = recv2;
      if (recvInn2 >= 0) recvInnIdx = recvInn2;
    }
    
    for (let i = 2; i < lines.length; i++) {
      const cols = lines[i].split('\\t').map(c => c.trim());
      if (cols.length < 10) continue;
      const dateStr = cols[2] || '';
      if (!dateStr.match(/\\d{2}\\.\\d{2}\\.\\d{4}/)) continue;
      const dc = cols[dcIdx] || '';
      if (dc !== 'D' && dc !== 'C') continue;
      const amountRaw = (cols[amtIdx] || '0').replace(',', '.');
      const absAmount = parseFloat(amountRaw);
      if (isNaN(absAmount) || absAmount === 0) continue;
      const amount = (dc === 'D') ? -absAmount : absAmount;
      if (!monthKey) { const p = dateStr.split('.'); monthKey = p[1] + '.' + p[2]; }
      const description = (cols[descIdx] || '').substring(0, 100);
      const myInn = '5800015301';
      const payer = (cols[payerIdx] || '').trim();
      const payerInn = (cols[payerInnIdx] || '').trim();
      const receiver = (cols[recvIdx] || '').trim();
      const receiverInn = (cols[recvInnIdx] || '').trim();
      let name = amount > 0 ? (payerInn !== myInn ? payer : receiver) : (receiverInn !== myInn ? receiver : payer);
      name = name.replace(/ООО "ОМСЧИКЕН"|ОБЩЕСТВО С ОГРАНИЧЕННОЙ ОТВЕТСТВЕННОСТЬЮ "ОМСЧИКЕН"/gi, '').trim() || description.substring(0, 60);
      const category = classify(name, description, amount);
      txs.push({name: name || description.substring(0, 40), amount, date: dateStr, description, category, period: monthKey, is_personal: ['personal','food'].includes(category)});
    }
  }'''

if old in content:
    content = content.replace(old, new)
    print("Replaced!")
else:
    print("Not found")

with open('index.html', 'w') as f:
    f.write(content)
print("done")
