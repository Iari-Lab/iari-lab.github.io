/* consent.js: Google Analytics only after an explicit opt-in.
 *
 * Google Analytics sets cookies and sends usage data to Google, which German law
 * (§ 25 TDDDG) and the GDPR (Art. 6(1)(a)) allow only with the visitor's consent.
 * So the gtag.js tag is no longer in the pages: this script loads it only after
 * the visitor presses "Allow", and remembers the answer in localStorage
 * ("iari-analytics-consent" = granted | denied; storing the answer itself is
 * strictly necessary and needs no consent). Any element with data-consent-open
 * (the footer's "Cookie settings") asks again, so consent can be withdrawn as
 * easily as it was given (Art. 7(3) GDPR); declining deletes the _ga cookies.
 * The page's own gtag('event', ...) calls check typeof gtag first, so they do
 * nothing until consent.
 */
(function () {
  'use strict';
  var GA_ID = 'G-NVN5NKC27N';
  var KEY = 'iari-analytics-consent';
  var box = null;

  function read() { try { return localStorage.getItem(KEY); } catch (e) { return null; } }
  function write(v) { try { localStorage.setItem(KEY, v); } catch (e) { /* storage blocked: ask again next visit */ } }

  function loadAnalytics() {
    window['ga-disable-' + GA_ID] = false;
    if (window.__iariAnalytics) return;
    window.__iariAnalytics = true;
    window.dataLayer = window.dataLayer || [];
    window.gtag = function () { window.dataLayer.push(arguments); };
    window.gtag('js', new Date());
    window.gtag('config', GA_ID);
    var s = document.createElement('script');
    s.async = true;
    s.src = 'https://www.googletagmanager.com/gtag/js?id=' + encodeURIComponent(GA_ID);
    document.head.appendChild(s);
  }

  function stopAnalytics() {
    window['ga-disable-' + GA_ID] = true;
    var host = location.hostname, parts = host.split('.'), domains = ['', host];
    for (var i = 1; i < parts.length - 1; i++) domains.push('.' + parts.slice(i).join('.'));
    document.cookie.split(';').forEach(function (c) {
      var name = c.split('=')[0].trim();
      if (name === '_ga' || name === '_gid' || name.indexOf('_ga_') === 0) {
        domains.forEach(function (d) {
          document.cookie = name + '=; Max-Age=0; path=/' + (d ? '; domain=' + d : '');
        });
      }
    });
  }

  function close() { if (box) { box.remove(); box = null; } }

  function choose(v) {
    write(v);
    if (v === 'granted') loadAnalytics(); else stopAnalytics();
    close();
  }

  function open() {
    if (box) return;
    var state = read();
    box = document.createElement('div');
    box.className = 'consent';
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-label', 'Analytics consent');
    box.innerHTML =
      '<p><b>May we count your visit?</b> With your permission we use Google Analytics to see which parts of this ' +
      'site are read. It sets cookies and sends usage data to Google, possibly to the USA. You can change your mind ' +
      'at any time under “Cookie settings” at the bottom of the page. <a href="datenschutz.html#analytics">Privacy notice</a></p>' +
      (state ? '<p class="consent-state">Current setting: ' + (state === 'granted' ? 'allowed' : 'declined') + '.</p>' : '') +
      '<div class="consent-btns"><button type="button" data-v="denied">Decline</button>' +
      '<button type="button" data-v="granted">Allow</button></div>';
    box.addEventListener('click', function (e) {
      var v = e.target && e.target.getAttribute && e.target.getAttribute('data-v');
      if (v) choose(v);
    });
    document.body.appendChild(box);
  }

  // Both buttons look the same: declining must be as easy as allowing.
  var css =
    '.consent{position:fixed;left:16px;right:16px;bottom:16px;z-index:1000;max-width:440px;background:#fff;color:#2d2d2a;' +
    'border:1px solid #e3e3df;border-radius:20px;box-shadow:0 12px 40px rgba(0,0,0,.14);padding:18px 20px;' +
    'font:14px/1.55 Inter,"Helvetica Neue",Arial,sans-serif}' +
    '.consent p{margin:0}.consent b{color:#1c1c1a;font-weight:600}.consent a{color:#d93c0e}' +
    '.consent .consent-state{margin-top:8px;color:#6b6b66}' +
    '.consent-btns{display:flex;gap:10px;margin-top:14px}' +
    '.consent-btns button{flex:1;font:inherit;font-weight:500;padding:10px 14px;border-radius:999px;' +
    'border:1px solid #1c1c1a;background:#1c1c1a;color:#fff;cursor:pointer}' +
    '.consent-btns button:hover{background:#000}' +
    '.consent-btns button:focus-visible{outline:2px solid #ff4a1a;outline-offset:2px}' +
    '@media (min-width:600px){.consent{left:24px;right:auto;bottom:24px}}';

  function init() {
    var st = document.createElement('style');
    st.textContent = css;
    document.head.appendChild(st);
    document.addEventListener('click', function (e) {
      var t = e.target && e.target.closest && e.target.closest('[data-consent-open]');
      if (t) { e.preventDefault(); open(); }
    });
    var state = read();
    if (state === 'granted') loadAnalytics();
    else if (state !== 'denied') open();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
