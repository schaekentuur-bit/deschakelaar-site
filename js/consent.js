/* ============================================================
   De Schakelaar — eigen consent-banner (vervangt Cookiebot)
   Regelt: banner tonen, keuze opslaan, tracking-scripts pas ná
   toestemming laden. Geen enkel trackingscript laadt vóór consent.
   ============================================================ */
(function () {
  'use strict';

  var STORAGE_KEY     = 'schakelaar_consent';
  var POLICY_VERSION  = 1; // ophogen zodra het cookiebeleid wijzigt -> vraagt opnieuw

  var GA4_ID       = 'G-GN0DRNNMR5';
  var ADS_ID       = 'AW-18200989510';
  var META_PIXEL_ID = '2807720619589029';

  var COOKIE_POLICY_URL = '/privacyverklaring.html';

  /* ---------- Opslag ---------- */

  function readConsent() {
    var raw;
    try { raw = localStorage.getItem(STORAGE_KEY); } catch (e) { return null; }
    if (!raw) return null;
    var data;
    try { data = JSON.parse(raw); } catch (e) { return null; }
    if (!data || data.version !== POLICY_VERSION) return null;
    return data;
  }

  function writeConsent(statistics, marketing) {
    var data = {
      version: POLICY_VERSION,
      date: new Date().toISOString(),
      necessary: true,
      statistics: !!statistics,
      marketing: !!marketing
    };
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); } catch (e) { /* localStorage niet beschikbaar */ }
    return data;
  }

  /* ---------- Trackingscripts pas ná consent ---------- */

  function applyConsent(consent) {
    if (consent.statistics || consent.marketing) {
      window.dataLayer = window.dataLayer || [];
      window.gtag = window.gtag || function () { window.dataLayer.push(arguments); };
      gtag('js', new Date());

      var gtagScript = document.createElement('script');
      gtagScript.async = true;
      gtagScript.src = 'https://www.googletagmanager.com/gtag/js?id=' + (consent.statistics ? GA4_ID : ADS_ID);
      document.head.appendChild(gtagScript);

      if (consent.statistics) gtag('config', GA4_ID);
      if (consent.marketing)  gtag('config', ADS_ID);
    }

    if (consent.marketing) {
      /* Meta Pixel basissnippet — zelf-injecterend, daarom pas hier uitgevoerd (na consent) */
      !function (f, b, e, v, n, t, s) {
        if (f.fbq) return;
        n = f.fbq = function () { n.callMethod ? n.callMethod.apply(n, arguments) : n.queue.push(arguments); };
        if (!f._fbq) f._fbq = n;
        n.push = n; n.loaded = true; n.version = '2.0'; n.queue = [];
        t = b.createElement(e); t.async = true; t.src = v;
        s = b.getElementsByTagName(e)[0]; s.parentNode.insertBefore(t, s);
      }(window, document, 'script', 'https://connect.facebook.net/en_US/fbevents.js');
      fbq('init', META_PIXEL_ID);
      fbq('track', 'PageView');
    }
  }

  window.SchakelaarConsent = {
    get: readConsent,
    hasStatistics: function () { var c = readConsent(); return !!(c && c.statistics); },
    hasMarketing:  function () { var c = readConsent(); return !!(c && c.marketing); },
    openSettings: function () { showBanner(true); }
  };
  window.openCookieSettings = window.SchakelaarConsent.openSettings;

  /* ---------- Banner: stijl ---------- */

  function injectStyle() {
    if (document.getElementById('schakelaar-consent-style')) return;
    var css = ''
      + '#schakelaar-consent{position:fixed;left:0;right:0;bottom:0;z-index:9999;'
      + 'background:#fff;border-top:1px solid rgba(27,46,75,0.12);'
      + 'box-shadow:0 -8px 32px rgba(27,46,75,0.16);'
      + 'font-family:"DM Sans",sans-serif;color:#1B2E4B;'
      + 'padding:20px 20px calc(20px + env(safe-area-inset-bottom));'
      + 'max-height:88vh;overflow-y:auto;}'
      + '#schakelaar-consent.sc-hidden{display:none;}'
      + '#schakelaar-consent .sc-inner{max-width:720px;margin:0 auto;}'
      + '#schakelaar-consent h2{font-family:"Syne",sans-serif;font-size:17px;font-weight:700;margin:0 0 8px;}'
      + '#schakelaar-consent p{font-size:13px;line-height:1.6;color:rgba(27,46,75,0.65);margin:0 0 16px;}'
      + '#schakelaar-consent a{color:#6DBF4A;text-decoration:underline;}'
      + '.sc-actions{display:flex;flex-direction:column;gap:10px;}'
      + '.sc-btn{font-family:"DM Sans",sans-serif;font-size:14px;font-weight:600;padding:13px 20px;'
      + 'border-radius:10px;border:none;cursor:pointer;text-align:center;width:100%;transition:opacity .15s;}'
      + '.sc-btn:hover{opacity:0.88;}'
      + '.sc-btn-reject{background:#1B2E4B;color:#fff;}'
      + '.sc-btn-accept{background:#6DBF4A;color:#fff;}'
      + '.sc-btn-settings{background:transparent;color:#1B2E4B;border:1.5px solid rgba(27,46,75,0.18);}'
      + '.sc-btn-save{background:#6DBF4A;color:#fff;}'
      + '.sc-categories{display:flex;flex-direction:column;gap:2px;margin-bottom:16px;border:1px solid rgba(27,46,75,0.1);border-radius:10px;overflow:hidden;}'
      + '.sc-cat{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;padding:14px 16px;background:#F6F8FA;border-bottom:1px solid rgba(27,46,75,0.08);}'
      + '.sc-cat:last-child{border-bottom:none;}'
      + '.sc-cat-text{flex:1;}'
      + '.sc-cat-title{font-size:13px;font-weight:600;margin-bottom:3px;}'
      + '.sc-cat-desc{font-size:12px;color:rgba(27,46,75,0.55);line-height:1.5;}'
      + '.sc-switch{position:relative;width:40px;height:22px;flex-shrink:0;margin-top:2px;}'
      + '.sc-switch input{opacity:0;width:100%;height:100%;position:absolute;margin:0;cursor:pointer;}'
      + '.sc-switch .sc-track{position:absolute;inset:0;background:rgba(27,46,75,0.2);border-radius:20px;transition:background .15s;}'
      + '.sc-switch .sc-thumb{position:absolute;top:2px;left:2px;width:18px;height:18px;background:#fff;border-radius:50%;transition:transform .15s;box-shadow:0 1px 3px rgba(0,0,0,0.25);}'
      + '.sc-switch input:checked ~ .sc-track{background:#6DBF4A;}'
      + '.sc-switch input:checked ~ .sc-thumb{transform:translateX(18px);}'
      + '.sc-switch input:disabled{cursor:default;}'
      + '.sc-switch input:disabled ~ .sc-track{background:rgba(27,46,75,0.3);}'
      + 'body.schakelaar-consent-open .whatsapp-float,'
      + 'body.schakelaar-consent-open .sticky-cta-bar{display:none!important;}'
      + '@media (min-width:600px){'
      + '  .sc-actions{flex-direction:row;justify-content:flex-end;}'
      + '  .sc-btn{width:auto;min-width:140px;}'
      + '}';
    var style = document.createElement('style');
    style.id = 'schakelaar-consent-style';
    style.textContent = css;
    document.head.appendChild(style);
  }

  /* ---------- Banner: HTML ---------- */

  var bannerEl = null;

  function buildBanner() {
    if (bannerEl) return bannerEl;
    var el = document.createElement('div');
    el.id = 'schakelaar-consent';
    el.className = 'sc-hidden';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-label', 'Cookievoorkeuren');
    document.body.appendChild(el);
    bannerEl = el;
    return el;
  }

  function renderSimple() {
    var el = buildBanner();
    el.innerHTML =
      '<div class="sc-inner">' +
        '<h2>We respecteren je privacy</h2>' +
        '<p>We gebruiken alleen noodzakelijke cookies om de site te laten werken. Voor statistieken en marketing (zoals Google Ads en Meta) vragen we eerst je toestemming. Lees ons <a href="' + COOKIE_POLICY_URL + '" target="_blank" rel="noopener">cookiebeleid</a>.</p>' +
        '<div class="sc-actions">' +
          '<button type="button" class="sc-btn sc-btn-reject" data-sc="reject">Weigeren</button>' +
          '<button type="button" class="sc-btn sc-btn-settings" data-sc="settings">Instellingen</button>' +
          '<button type="button" class="sc-btn sc-btn-accept" data-sc="accept">Accepteren</button>' +
        '</div>' +
      '</div>';
    wireSimple(el);
  }

  function renderSettings(current) {
    var el = buildBanner();
    var stats = !!(current && current.statistics);
    var mark  = !!(current && current.marketing);
    el.innerHTML =
      '<div class="sc-inner">' +
        '<h2>Cookie-instellingen</h2>' +
        '<p>Kies per categorie of je toestemming geeft. Noodzakelijke cookies staan altijd aan, die zijn nodig om de site te laten werken.</p>' +
        '<div class="sc-categories">' +
          '<div class="sc-cat">' +
            '<div class="sc-cat-text"><div class="sc-cat-title">Noodzakelijk</div><div class="sc-cat-desc">Nodig voor de basiswerking van de website. Kan niet worden uitgeschakeld.</div></div>' +
            '<label class="sc-switch"><input type="checkbox" checked disabled><span class="sc-track"></span><span class="sc-thumb"></span></label>' +
          '</div>' +
          '<div class="sc-cat">' +
            '<div class="sc-cat-text"><div class="sc-cat-title">Statistieken</div><div class="sc-cat-desc">Google Analytics (GA4) — inzicht in websitegebruik.</div></div>' +
            '<label class="sc-switch"><input type="checkbox" id="sc-cat-statistics"' + (stats ? ' checked' : '') + '><span class="sc-track"></span><span class="sc-thumb"></span></label>' +
          '</div>' +
          '<div class="sc-cat">' +
            '<div class="sc-cat-text"><div class="sc-cat-title">Marketing</div><div class="sc-cat-desc">Google Ads en Meta (Facebook/Instagram) Pixel — voor advertentiemeting.</div></div>' +
            '<label class="sc-switch"><input type="checkbox" id="sc-cat-marketing"' + (mark ? ' checked' : '') + '><span class="sc-track"></span><span class="sc-thumb"></span></label>' +
          '</div>' +
        '</div>' +
        '<div class="sc-actions">' +
          '<button type="button" class="sc-btn sc-btn-reject" data-sc="reject">Alles weigeren</button>' +
          '<button type="button" class="sc-btn sc-btn-save" data-sc="save">Voorkeuren opslaan</button>' +
        '</div>' +
      '</div>';
    wireSettings(el);
  }

  function wireSimple(el) {
    el.querySelector('[data-sc="reject"]').onclick = function () { choose(false, false); };
    el.querySelector('[data-sc="accept"]').onclick = function () { choose(true, true); };
    el.querySelector('[data-sc="settings"]').onclick = function () { renderSettings(readConsent()); };
  }

  function wireSettings(el) {
    el.querySelector('[data-sc="reject"]').onclick = function () { choose(false, false); };
    el.querySelector('[data-sc="save"]').onclick = function () {
      var stats = document.getElementById('sc-cat-statistics').checked;
      var mark  = document.getElementById('sc-cat-marketing').checked;
      choose(stats, mark);
    };
  }

  function choose(statistics, marketing) {
    writeConsent(statistics, marketing);
    /* Herlaad de pagina: garandeert een schone, voorspelbare staat waarin
       consent.js bij het laden de nieuwe keuze leest en toepast — zonder
       kans op dubbel geïnjecteerde scripts of half toegepaste wijzigingen. */
    window.location.reload();
  }

  function showBanner(isSettings) {
    injectStyle();
    document.body.classList.add('schakelaar-consent-open');
    if (isSettings) renderSettings(readConsent());
    else renderSimple();
    bannerEl.classList.remove('sc-hidden');
  }

  /* ---------- Init ---------- */

  var existing = readConsent();
  if (existing) {
    applyConsent(existing);
  } else {
    if (document.body) showBanner(false);
    else document.addEventListener('DOMContentLoaded', function () { showBanner(false); });
  }
})();
