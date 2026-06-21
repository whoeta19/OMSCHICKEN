(function () {
  var pages = [
    { href: '/',             label: 'Дашборд',     icon: '🏠' },
    { href: '/analytics',   label: 'Аналитика',   icon: '📈' },
    { href: '/vat',         label: 'НДС',          icon: '🧾' },
    { href: '/declarations',label: 'Декларации',   icon: '📋' },
    { href: '/payroll',     label: 'Зарплата',     icon: '👥' },
    { href: '/docs',        label: 'Документы',    icon: '📄' },
    { href: '/tools',       label: 'Инструменты',  icon: '⚡' },
    { href: '/counterparty',label: 'Контрагенты',  icon: '🔍' },
  ];

  function render() {
    var cur = window.location.pathname;
    var accent = '#ff6b00';
    var muted  = 'rgba(255,255,255,0.4)';
    var border = 'rgba(255,255,255,0.07)';

    var nav = document.createElement('nav');
    nav.id  = 'omsnav';
    nav.style.cssText =
      'background:#080808;border-bottom:1px solid ' + border + ';' +
      'overflow-x:auto;-webkit-overflow-scrolling:touch;scrollbar-width:none;';

    var inner = document.createElement('div');
    inner.style.cssText =
      'display:flex;gap:2px;padding:6px 16px;white-space:nowrap;min-width:max-content;';

    pages.forEach(function (p) {
      var isActive = p.href === '/'
        ? cur === '/'
        : cur === p.href || cur.startsWith(p.href + '/');

      var a = document.createElement('a');
      a.href = p.href;
      a.style.cssText =
        'display:inline-flex;align-items:center;gap:5px;' +
        'padding:6px 11px;border-radius:8px;' +
        'font-size:12px;font-family:Inter,sans-serif;text-decoration:none;' +
        'transition:background 0.15s,color 0.15s;' +
        'color:'      + (isActive ? accent : muted) + ';' +
        'background:' + (isActive ? 'rgba(255,107,0,0.1)' : 'transparent') + ';' +
        'font-weight:' + (isActive ? '600' : '400') + ';';
      a.innerHTML = '<span>' + p.icon + '</span><span>' + p.label + '</span>';

      a.addEventListener('mouseenter', function () {
        if (!isActive) { a.style.color = '#fff'; a.style.background = 'rgba(255,255,255,0.05)'; }
      });
      a.addEventListener('mouseleave', function () {
        if (!isActive) { a.style.color = muted; a.style.background = 'transparent'; }
      });

      inner.appendChild(a);
    });

    nav.appendChild(inner);

    var header = document.querySelector('header');
    if (header) {
      header.insertAdjacentElement('afterend', nav);
    } else {
      document.body.prepend(nav);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', render);
  } else {
    render();
  }
})();
