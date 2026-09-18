// Check App — finalise registration after email-link confirmation.
// Registration business logic lives in js/app.js. This file only reacts to
// a Supabase-authenticated redirect and hands the session to that logic.
(function () {
  'use strict';

  let running = false;

  async function finalizeFromAuthRedirect() {
    if (running || typeof supabaseClient === 'undefined' || !supabaseClient?.auth) return;

    let pending = false;
    try {
      pending = !!sessionStorage.getItem('checkapp_pending_registration');
    } catch (_) {}

    // Existing normal sessions are handled by app.js. We only finalize a
    // registration that was explicitly left unfinished.
    if (!pending) return;

    running = true;
    try {
      const { data, error } = await supabaseClient.auth.getSession();
      if (error) throw error;
      if (!data?.session?.user) return;

      if (typeof finalizePendingRegistration !== 'function') {
        throw new Error('Модуль регистрации ещё не загрузился.');
      }

      await finalizePendingRegistration(data.session);
    } catch (e) {
      console.error('[Check App] auth redirect finalization error:', e);
      showError?.(e?.message || 'Не удалось завершить регистрацию.');
    } finally {
      running = false;
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    setTimeout(finalizeFromAuthRedirect, 0);
  });
})();
