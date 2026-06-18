import sys

with open('index.html', 'r') as f:
    content = f.read()

# Find parseAndProcess function start
start = content.find('async function parseAndProcess(text)')
if start < 0:
    print("ERROR: parseAndProcess not found")
    sys.exit(1)

# Find the end of the function by finding next function
# We need to replace everything from start to the progress/api code
end_marker = "  if (txs.length===0) { showToast"
end = content.find(end_marker, start)
if end < 0:
    print("ERROR: end marker not found")
    sys.exit(1)

old_section = content[start:end]
print(f"Found section of {len(old_section)} chars")

new_section = '''async function parseAndProcess(text) {
  // Определяем банк
  function detectBank(t) {
    if (t.includes('statement_unid') || t.includes('Date_val')) return 'alfa';
    const lines2 = t.split('\\n');
    for (let i = 1; i < Math.min(4, lines2.length); i++) {
      if (lines2[i].includes(';;') && lines2[i].split(';').length > 10) return 'vtb';
    }
    return 'tbank';
  }

  const bank = detectBank(text);
  const lines = text.split('\\n').filter(l => l.trim());
  const txs = [];
  let monthKey = null;

  if (bank === 'vtb') {
    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(';').map(c => c.replace(/^"|"$/g,'').replace(/""/g,'"').trim());
      if (cols.length < 8) continue;
      const dateStr = cols[2] || '';
      if (!dateStr.match(/\\d{2}\\.\\d{2}\\.\\d{4}/)) continue;
      const amountRaw = (cols[7] || '0').replace(',', '.');
      const amount = parseFloat(amountRaw);
      if (isNaN(amount) || amount === 0) continue;
      if (!monthKey) { const p = dateStr.split('.'); monthKey = p[1] + '.' + p[2]; }
      const description = (cols[9] || '').substring(0, 100);
      const myInn = '5800015301';
      const receiver = (cols[12] || '').trim();
      const sender = (cols[18] || '').trim();
      const receiverInn = (cols[13] || '').trim();
      const senderInn = (cols[19] || '').trim();
      let name = '';
      if (amount > 0) {
        name = senderInn !== myInn ? sender : (receiver || description.substring(0, 60));
      } else {
        name = receiverInn !== myInn ? receiver : (sender || description.substring(0, 60));
      }
      name = name.replace(/ООО "ОМСЧИКЕН"|ООО ОМСЧИКЕН/gi, '').trim() || description.substring(0, 60);
      const category = classify(name, description, amount);
      txs.push({name, amount, date: dateStr, description, category, period: monthKey, is_personal: ['personal','food'].includes(category)});
    }
  } else if (bank === 'alfa') {
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
  } else {
    // Т-Банк
    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(';').map(c => c.replace(/^"|"$/g,'').replace(/""/g,'"').trim());
      if (cols.length < 8) continue;
      const type = cols[1] || '';
      const dateStr = cols[2] || '';
      const amountRaw = (cols[5] || '0').replace(',','.');
      const amount = parseFloat(amountRaw) * (type==='Дебет'?-1:1);
      if (isNaN(amount)||amount===0) continue;
      if (!monthKey && dateStr.includes('.')) {
        const p = dateStr.split('.');
        if (p.length >= 3) monthKey = p[1] + '.' + p[2];
      }
      const description = cols[7] || '';
      const counterparty = (cols[24]||'').replace(/^АО "ТБанк"$|^ТБанк$/gi,'').trim();
      const name = counterparty.length>2 ? counterparty : description;
      const category = classify(name, description, amount);
      txs.push({name, amount, date:dateStr, description, category, period:monthKey, is_personal:['personal','food'].includes(category)});
    }
  }

'''

content = content[:start] + new_section + content[end:]

with open('index.html', 'w') as f:
    f.write(content)

print("Done!")
