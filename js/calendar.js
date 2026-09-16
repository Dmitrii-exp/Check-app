// Check App — calendar loader + authentication/registration flow
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

  // Keep the existing calendar code untouched. Load the authentication flow
  // afterwards so it can safely use the existing Supabase/auth functions.
  loadScript('js/calendar-core.js', function () {
    loadScript('js/auth-registration.js', function () {
      loadScript('js/invite-registration.js');
    });
  });
})();
