// Check App — calendar loader + invite registration
(function () {
  'use strict';
  function loadScript(src, done) {
    const s = document.createElement('script');
    s.src = src;
    s.async = false;
    s.onload = () => done && done();
    s.onerror = () => console.error('[Check App] Failed to load ' + src);
    document.head.appendChild(s);
  }
  loadScript('js/calendar-core.js', function () {
    loadScript('js/invite-registration.js');
  });
})();
