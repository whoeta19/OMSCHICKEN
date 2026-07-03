// OMSFIN — эффекты: scroll reveal + анимация чисел.
// Лёгкий, без библиотек. Уважает prefers-reduced-motion.

(function () {
  'use strict';
  var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ── Scroll reveal: элементы с [data-reveal] появляются при входе в viewport,
  //    внутри одного родителя — stagger 60ms.
  function initReveal() {
    var els = document.querySelectorAll('[data-reveal]');
    if (!els.length) return;
    if (reduced || !('IntersectionObserver' in window)) {
      els.forEach(function (el) { el.classList.add('revealed'); });
      return;
    }
    els.forEach(function (el) { el.classList.add('reveal'); });
    var io = new IntersectionObserver(function (entries) {
      var visible = entries.filter(function (e) { return e.isIntersecting; });
      visible.forEach(function (e, i) {
        setTimeout(function () { e.target.classList.add('revealed'); }, i * 60);
        io.unobserve(e.target);
      });
    }, { threshold: 0.08 });
    els.forEach(function (el) { io.observe(el); });
  }

  // ── Анимация чисел: элемент с [data-animate-num] — текст вида "1 234 567 ₽"
  //    анимируется от 0 за 0.8s. Вызывать animateNumber(el, value, suffix).
  var _nf = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 });
  function animateNumber(el, value, suffix) {
    if (!el) return;
    suffix = suffix === undefined ? ' ₽' : suffix;
    value = Number(value) || 0;
    if (reduced) { el.textContent = _nf.format(Math.round(value)) + suffix; return; }
    var start = null, dur = 800;
    function frame(ts) {
      if (!start) start = ts;
      var p = Math.min((ts - start) / dur, 1);
      // easeOutCubic
      var eased = 1 - Math.pow(1 - p, 3);
      el.textContent = _nf.format(Math.round(value * eased)) + suffix;
      if (p < 1) requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }

  window.OMSFX = { animateNumber: animateNumber, initReveal: initReveal };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initReveal);
  else initReveal();
})();
