// Contactdrempel: WhatsApp-float, altijd zichtbaar tijdens scrollen.
// Verbergt alleen zodra de footer of het contactformulier in beeld komt,
// zodat de knop daar niet overheen valt.
(function () {
  var wa = document.querySelector('.whatsapp-float');
  if (!wa) return;

  var noFloatZones = document.querySelectorAll('footer, .contact-wrap');

  function update() {
    var nearZone = false;
    noFloatZones.forEach(function (el) {
      var r = el.getBoundingClientRect();
      if (r.top < window.innerHeight && r.bottom > 0) nearZone = true;
    });
    wa.classList.toggle('wa-hidden', nearZone);
  }

  if (noFloatZones.length && 'IntersectionObserver' in window) {
    var zoneObserver = new IntersectionObserver(function (entries) {
      update();
    }, { rootMargin: '0px 0px -5% 0px' });
    noFloatZones.forEach(function (el) { zoneObserver.observe(el); });
  } else {
    window.addEventListener('scroll', update, { passive: true });
  }

  window.addEventListener('resize', update);
  update();
})();
