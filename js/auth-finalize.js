// Check App — finalise registration after email-link confirmation
(function () {
  'use strict';

  let running = false;
  let finishedUserId = null;

  async function finalizeAuth() {
    if (running || typeof supabaseClient === 'undefined' || !supabaseClient?.auth) return;
    running = true;
    try {
      const { data, error } = await supabaseClient.auth.getSession();
      if (error || !data?.session?.user) return;

      const user = data.session.user;
      if (finishedUserId === user.id) return;

      const { data: profile, error: profileError } = await supabaseClient
        .from('profiles')
        .select('id')
        .eq('id', user.id)
        .maybeSingle();
      if (profileError) throw profileError;

      if (!profile) {
        const meta = user.user_metadata || {};
        let rpcError = null;

        if (meta.signup_mode === 'invite' && meta.invite_code && meta.name) {
          ({ error: rpcError } = await supabaseClient.rpc('join_company_by_invite', {
            p_invite_code: String(meta.invite_code).trim().toUpperCase(),
            p_name: String(meta.name).trim(),
            p_phone: null
          }));
        } else if (meta.signup_mode === 'register' && meta.company_name && meta.name) {
          ({ error: rpcError } = await supabaseClient.rpc('bootstrap_company', {
            p_company_name: String(meta.company_name).trim(),
            p_department_name: 'Основное',
            p_invite_code: meta.invite_code || generateCode(),
            p_name: String(meta.name).trim(),
            p_phone: null
          }));
        } else {
          return;
        }

        if (rpcError) throw rpcError;
      }

      const ok = typeof hydrateCurrentUser === 'function' && await hydrateCurrentUser();
      if (!ok || !db?.currentUser) return;

      finishedUserId = user.id;
      try { sessionStorage.removeItem('checkapp_pending_registration'); } catch (_) {}
      if (typeof closeOtpModal === 'function') closeOtpModal();
      if (typeof enterApp === 'function') enterApp();
    } catch (e) {
      console.error('[Check App] registration finalization error:', e);
    } finally {
      running = false;
    }
  }

  document.addEventListener('DOMContentLoaded', finalizeAuth);
  setTimeout(finalizeAuth, 300);
  setTimeout(finalizeAuth, 1000);
  setTimeout(finalizeAuth, 2500);
})();
