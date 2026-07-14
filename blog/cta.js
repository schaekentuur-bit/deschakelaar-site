// Contactdrempel: WhatsApp-float + sticky mobiele CTA-balk.
// Balk verschijnt op mobiel pas voorbij de hero; beide elementen verdwijnen
// zodra de footer of het contactformulier in beeld komt.
(function () {
  var wa  = document.querySelector('.whatsapp-float');
  var bar = document.querySelector('.sticky-cta-bar');
  if (!wa && !bar) return;

  var hero = document.querySelector('.hero, .hero-split, .hero-zak, .hero-part');
  var noFloatZones = document.querySelectorAll('footer, .contact-wrap');

  var pastHero   = !hero; // geen hero op de pagina? dan meteen actief
  var nearZone   = false;

  function isMobile() { return window.innerWidth <= 640; }

  function update() {
    if (bar) bar.classList.toggle('sticky-visible', isMobile() && pastHero && !nearZone);
    if (wa)  wa.classList.toggle('wa-hidden', nearZone || (isMobile() && pastHero && !!bar));
  }

  if (hero && 'IntersectionObserver' in window) {
    new IntersectionObserver(function (entries) {
      pastHero = !entries[0].isIntersecting;
      update();
    }, { threshold: 0 }).observe(hero);
  } else if (hero) {
    window.addEventListener('scroll', function () {
      pastHero = window.scrollY > hero.offsetHeight * 0.6;
      update();
    }, { passive: true });
  }

  if (noFloatZones.length && 'IntersectionObserver' in window) {
    var zoneObserver = new IntersectionObserver(function (entries) {
      nearZone = entries.some(function (e) { return e.isIntersecting; });
      update();
    }, { rootMargin: '0px 0px -5% 0px' });
    noFloatZones.forEach(function (el) { zoneObserver.observe(el); });
  }

  window.addEventListener('resize', update);
  update();
})();
