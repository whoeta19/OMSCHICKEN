(function () {
  if (document.getElementById('omsnav')) return;

  var pages = [
    { href: '/',              label: 'Дашборд',     icon: '🏠' },
    { href: '/analytics',    label: 'Аналитика',   icon: '📈' },
    { href: '/vat',          label: 'НДС',          icon: '🧾' },
    { href: '/declarations', label: 'Декларации',   icon: '📋' },
    { href: '/payroll',      label: 'Зарплата',     icon: '👥' },
    { href: '/docs',         label: 'Документы',    icon: '📄' },
    { href: '/tools',        label: 'Инструменты',  icon: '⚡' },
    { href: '/counterparty', label: 'Контрагенты',  icon: '🔍' },
    { href: '/calendar',    label: 'Календарь',    icon: '📅' },
    { href: '/warehouse',   label: 'Склад',         icon: '📦' },
  ];

  function injectStyles() {
    if (document.getElementById('omsnav-style')) return;
    var s = document.createElement('style');
    s.id = 'omsnav-style';
    s.textContent =
      '#omsnav{background:var(--surface,#0f0f0f);border-bottom:1px solid var(--border,rgba(255,255,255,0.06));' +
      'overflow-x:auto;-webkit-overflow-scrolling:touch;scrollbar-width:none;' +
      'position:sticky;top:0;z-index:90;transition:background 0.25s ease,border-color 0.25s ease;}' +
      '#omsnav::-webkit-scrollbar{display:none;}' +
      '#omsnav-inner{display:flex;gap:3px;padding:4px 14px;white-space:nowrap;min-width:max-content;}' +
      '#omsnav a{display:inline-flex;align-items:center;gap:4px;padding:5px 10px;border-radius:6px;' +
      'font-size:11.5px;font-family:Inter,sans-serif;text-decoration:none;' +
      'transition:background 0.15s,color 0.15s;color:var(--muted,rgba(255,255,255,0.35));background:transparent;font-weight:400;}' +
      '#omsnav a:hover{color:var(--text,#f5f5f5);background:rgba(128,128,128,0.08);}' +
      '#omsnav a.active{color:var(--accent,#ff6b00);background:rgba(128,128,128,0.08);font-weight:600;}' +
      'body.light #omsnav a.active{color:var(--accent);background:rgba(229,80,0,0.07);}' +
      'body.light #omsnav a:hover{color:var(--text);background:rgba(0,0,0,0.05);}' +
      'body.aurora #omsnav a.active{color:#a78bfa;background:rgba(167,139,250,0.1);}' +
      'body.blue #omsnav a.active{color:#60a5fa;background:rgba(59,130,246,0.1);}';
    document.head.appendChild(s);
  }

  function render() {
    if (document.getElementById('omsnav')) return;
    injectStyles();

    var cur = window.location.pathname;
    var nav = document.createElement('nav');
    nav.id = 'omsnav';
    var inner = document.createElement('div');
    inner.id = 'omsnav-inner';

    pages.forEach(function (p) {
      var isActive = p.href === '/'
        ? cur === '/' || cur === ''
        : cur === p.href || cur.startsWith(p.href + '/');
      var a = document.createElement('a');
      a.href = p.href;
      if (isActive) a.className = 'active';
      a.innerHTML = '<span style="font-size:13px;line-height:1">' + p.icon + '</span><span>' + p.label + '</span>';
      inner.appendChild(a);
    });

    nav.appendChild(inner);
    var header = document.querySelector('header');
    if (header) header.insertAdjacentElement('afterend', nav);
    else document.body.prepend(nav);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', render);
  else render();
})();
