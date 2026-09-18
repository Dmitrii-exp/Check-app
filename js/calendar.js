// Check App — calendar loader + authentication helpers
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

  // app.js owns registration/login. These small helpers only handle
  // invitation UI/redirects and finalisation after email-link confirmation.
  loadScript('js/calendar-core.js?v=20260918-03', function () {
    loadScript('js/invite-registration.js', function () {
      loadScript('js/auth-finalize.js');
    });
  });
})();
