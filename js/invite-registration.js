// Check App — employee invitation registration flow
(function () {
  'use strict';

  const PUBLIC_URL = 'https://www.app-check.ru/';
  const INVITE_PARAM = 'invite';
  let signupResendUntil = 0;
  let recoveryResendUntil = 0;
  let registrationBusy = false;
  let registrationClickBound = false;

  function inviteCodeFromUrl() {
    try {
      return String(new URLSearchParams(window.location.search).get(INVITE_PARAM) || '').trim().toUpperCase();
    } catch (_) { return ''; }
  }

  function hasInvite() { return !!inviteCodeFromUrl(); }

  function hideLegacyInviteUI() {
    document.getElementById('tab-invite')?.remove();
    document.getElementById('form-invite')?.classList.add('hidden');
  }

  function savePendingRegistration(meta) {
    if (typeof pendingEmail !== 'undefined') pendingEmail = meta;
    try {
      sessionStorage.setItem('checkapp_pending_registration', JSON.stringify(meta));
    } catch (_) {}
  }

  function showLoginForExistingAccount(email) {
    try {
      document.getElementById('login-email').value = email;
      if (typeof switchAuthTab === 'function') switchAuthTab('login');
      else {
        document.getElementById('form-register')?.classList.add('hidden');
        document.getElementById('form-login')?.classList.remove('hidden');
      }
    } catch (_) {}
    document.getElementById('auth-error')?.classList.add('hidden');
    toast('Этот Email уже подтверждён. Войдите в аккаунт — повторная регистрация не нужна.');
  }

  async function finalizeRegistration(session, meta) {
    if (!session?.user) return false;
    let rpcError = null;

    if (meta.mode === 'invite' && meta.code && meta.name) {
      ({ error: rpcError } = await supabaseClient.rpc('join_company_by_invite', {
        p_invite_code: String(meta.code).trim().toUpperCase(),
        p_name: String(meta.name).trim(),
        p_phone: null
      }));
    } else if (meta.mode === 'register' && meta.company && meta.name) {
      ({ error: rpcError } = await supabaseClient.rpc('bootstrap_company', {
        p_company_name: String(meta.company).trim(),
        p_department_name: 'Основное',
        p_invite_code: meta.code || (typeof generateCode === 'function' ? generateCode() : ''),
        p_name: String(meta.name).trim(),
        p_phone: null
      }));
    }

    if (rpcError) throw rpcError;
    const ok = typeof hydrateCurrentUser === 'function' && await hydrateCurrentUser();
    if (!ok || !db?.currentUser) return false;
    try { sessionStorage.removeItem('checkapp_pending_registration'); } catch (_) {}
    if (typeof closeOtpModal === 'function') closeOtpModal();
    if (typeof enterApp === 'function') enterApp();
    return true;
  }

  async function submitRegistration() {
    if (registrationBusy) return true;
    if (typeof ensureSupabase !== 'function' || !ensureSupabase()) return true;

    const inviteCode = inviteCodeFromUrl();
    const name = document.getElementById('reg-name')?.value.trim() || '';
    const company = document.getElementById('reg-company')?.value.trim() || '';
    const email = document.getElementById('reg-email')?.value.trim().toLowerCase() || '';
    const password = document.getElementById('reg-password')?.value || '';

    if (!name || !email || password.length < 8 || (!inviteCode && !company)) {
      showError(inviteCode
        ? 'Укажите имя, Email и пароль минимум из 8 символов.'
        : 'Заполните название компании, имя, Email и пароль минимум из 8 символов.');
      return true;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      showError('Введите корректный Email.');
      return true;
    }

    const meta = {
      mode: inviteCode ? 'invite' : 'register',
      email,
      name,
      company,
      code: inviteCode
    };
    savePendingRegistration(meta);
    registrationBusy = true;

    try {
      const { data, error } = await supabaseClient.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: PUBLIC_URL,
          data: {
            name,
            company_name: company,
            signup_mode: meta.mode,
            invite_code: inviteCode
          }
        }
      });

      if (error) {
        const message = String(error.message || '').toLowerCase();
        if (message.includes('already registered') || message.includes('already exists')) {
          showLoginForExistingAccount(email);
          return true;
        }
        throw error;
      }

      const user = data?.user;
      const session = data?.session;

      if (session) {
        await finalizeRegistration(session, meta);
        return true;
      }

      // Supabase deliberately returns an obfuscated user with no identities
      // when signUp() is called for an already-confirmed account.
      if (user && Array.isArray(user.identities) && user.identities.length === 0) {
        showLoginForExistingAccount(email);
        return true;
      }

      // New account OR existing unconfirmed account: keep the same Email,
      // wait for confirmation, and allow unlimited user retries subject only
      // to Supabase's server-side email rate limits.
      savePendingRegistration({ ...meta, userId: user?.id || null });
      if (typeof openEmailConfirmationModal === 'function') openEmailConfirmationModal(email);
      toast('Письмо подтверждения отправлено. Если не пришло — используйте «Отправить ещё раз».');
      return true;
    } catch (e) {
      console.error('[Check App] registration failed:', e);
      showError(e?.message || 'Не удалось создать аккаунт.');
      return true;
    } finally {
      registrationBusy = false;
    }
  }

  function bindRegistrationButton() {
    const registerButton = document.querySelector('#form-register button[onclick="doRegister()"]');
    if (!registerButton) return;
    if (registrationClickBound && registerButton.dataset.checkappBound === '1') return;

    registerButton.dataset.checkappBound = '1';
    registerButton.onclick = function (event) {
      event.preventDefault();
      event.stopPropagation();
      submitRegistration();
      return false;
    };
    registrationClickBound = true;
    console.info('[Check App] Registration button bound to same-email registration flow.');
  }

  function setupInviteRegistration() {
    hideLegacyInviteUI();
    const tabRegister = document.getElementById('tab-register');
    const form = document.getElementById('form-register');
    const companyWrap = document.getElementById('reg-company')?.closest('div');
    const nameInput = document.getElementById('reg-name');
    const registerButton = form?.querySelector('button[onclick="doRegister()"]');
    if (!form || !tabRegister) return;

    if (hasInvite()) {
      tabRegister.textContent = 'Регистрация сотрудника';
      tabRegister.classList.remove('text-slate-400');
      tabRegister.classList.add('bg-primary-600', 'text-white');
      companyWrap?.classList.add('hidden');
      const nameLabel = nameInput?.previousElementSibling;
      if (nameLabel) nameLabel.textContent = 'Ваше имя';
      if (nameInput) nameInput.placeholder = 'Пётр Петров';
      if (registerButton) registerButton.textContent = 'Создать аккаунт';
      form.classList.remove('hidden');
      document.getElementById('form-login')?.classList.add('hidden');
      document.getElementById('auth-error')?.classList.add('hidden');
      if (!document.getElementById('invite-registration-note')) {
        const note = document.createElement('div');
        note.id = 'invite-registration-note';
        note.className = 'mb-4 rounded-xl border border-primary-500/20 bg-primary-500/10 px-4 py-3 text-sm text-primary-200';
        note.textContent = 'Вас пригласили в компанию. После регистрации вы автоматически будете подключены к нужному подразделению.';
        form.insertBefore(note, form.firstElementChild);
      }
    }

    bindRegistrationButton();

    const originalSwitch = window.switchAuthTab;
    if (typeof originalSwitch === 'function' && !originalSwitch.__checkAppInviteWrapped) {
      const wrappedSwitch = function (tab) {
        if (tab === 'invite') tab = 'register';
        return originalSwitch(tab);
      };
      wrappedSwitch.__checkAppInviteWrapped = true;
      window.switchAuthTab = wrappedSwitch;
    }
  }

  function installSignupResend() {
    const form = document.getElementById('form-register');
    if (!form || document.getElementById('invite-signup-resend')) return;
    const b = document.createElement('button');
    b.id = 'invite-signup-resend';
    b.type = 'button';
    b.className = 'w-full py-2 text-sm text-primary-400 hover:text-primary-300 transition';
    b.textContent = 'Не получили письмо? Отправить ещё раз';
    b.onclick = async function () {
      const email = document.getElementById('reg-email')?.value.trim().toLowerCase() || '';
      if (!email) return showError('Сначала укажите Email.');
      if (Date.now() < signupResendUntil) return;
      b.disabled = true;
      b.textContent = 'Отправляем…';
      try {
        const { error } = await supabaseClient.auth.resend({
          type: 'signup',
          email,
          options: { emailRedirectTo: PUBLIC_URL }
        });
        if (error) throw error;
        signupResendUntil = Date.now() + 60000;
        b.textContent = 'Повторить через 60 сек.';
        const meta = {
          mode: hasInvite() ? 'invite' : 'register',
          email,
          name: document.getElementById('reg-name')?.value.trim() || '',
          company: document.getElementById('reg-company')?.value.trim() || '',
          code: inviteCodeFromUrl()
        };
        savePendingRegistration(meta);
        if (typeof openEmailConfirmationModal === 'function') openEmailConfirmationModal(email);
        toast('Новое письмо отправлено. Используйте последнюю ссылку/код.');
        setTimeout(() => {
          b.disabled = false;
          b.textContent = 'Не получили письмо? Отправить ещё раз';
        }, 60000);
      } catch (e) {
        b.disabled = false;
        b.textContent = 'Не получили письмо? Отправить ещё раз';
        showError(e?.message || 'Не удалось отправить письмо повторно.');
      }
    };
    form.appendChild(b);
  }

  function installRecoveryResend() {
    const modal = document.getElementById('password-reset-modal');
    if (!modal || document.getElementById('checkapp-recovery-resend')) return;
    const submit = document.getElementById('password-reset-submit');
    if (!submit) return;
    const b = document.createElement('button');
    b.id = 'checkapp-recovery-resend';
    b.type = 'button';
    b.className = 'w-full mt-3 py-2 text-sm text-primary-400 hover:text-primary-300 transition';
    b.textContent = 'Отправить ссылку ещё раз';
    b.onclick = async function () {
      const email = document.getElementById('password-reset-email')?.value.trim().toLowerCase() || '';
      if (!email) return showError('Введите Email.');
      if (Date.now() < recoveryResendUntil) return;
      b.disabled = true;
      b.textContent = 'Отправляем…';
      try {
        const { error } = await supabaseClient.auth.resetPasswordForEmail(email, { redirectTo: PUBLIC_URL });
        if (error) throw error;
        recoveryResendUntil = Date.now() + 60000;
        b.textContent = 'Повторить через 60 сек.';
        toast('Новая ссылка отправлена. Используйте последнюю ссылку.');
        setTimeout(() => {
          b.disabled = false;
          b.textContent = 'Отправить ссылку ещё раз';
        }, 60000);
      } catch (e) {
        b.disabled = false;
        b.textContent = 'Отправить ссылку ещё раз';
        showError(e?.message || 'Не удалось отправить ссылку повторно.');
      }
    };
    submit.insertAdjacentElement('afterend', b);
  }

  function setupManagerInviteLink() {
    const display = document.getElementById('invite-code-display');
    if (!display) return;
    const select = document.getElementById('invite-dept-select');
    const company = typeof window.getCompany === 'function' ? window.getCompany() : null;
    const dept = company && select ? company.departments?.find(d => d.id === select.value) : null;
    const code = dept?.inviteCode || '';
    if (!code) return;
    display.textContent = PUBLIC_URL + '?invite=' + encodeURIComponent(code);
    display.title = 'Ссылка-приглашение сотруднику';
    display.classList.remove('tracking-widest');
    display.classList.add('text-sm', 'break-all');
    const button = display.parentElement?.querySelector('button');
    if (button) button.textContent = 'Копировать ссылку';
  }

  function installManagerInviteLink() {
    const originalUpdate = window.updateInviteCodeDisplay;
    if (typeof originalUpdate === 'function' && !originalUpdate.__checkAppInviteWrapped) {
      const wrapped = function () {
        const result = originalUpdate();
        setTimeout(setupManagerInviteLink, 0);
        return result;
      };
      wrapped.__checkAppInviteWrapped = true;
      window.updateInviteCodeDisplay = wrapped;
    }
    window.copyInviteCode = function () {
      setupManagerInviteLink();
      const link = document.getElementById('invite-code-display')?.textContent?.trim() || '';
      if (!link || !link.startsWith(PUBLIC_URL)) return showError('Не удалось сформировать ссылку приглашения.');
      navigator.clipboard?.writeText(link).then(() => toast('Ссылка-приглашение скопирована')).catch(() => {
        const ta = document.createElement('textarea');
        ta.value = link;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        ta.remove();
        toast('Ссылка-приглашение скопирована');
      });
    };
    setTimeout(setupManagerInviteLink, 300);
    setTimeout(setupManagerInviteLink, 1000);
  }

  function boot() {
    hideLegacyInviteUI();
    setupInviteRegistration();
    installSignupResend();
    installRecoveryResend();
    installManagerInviteLink();
  }

  document.addEventListener('DOMContentLoaded', boot);
  setTimeout(boot, 100);
  setTimeout(boot, 500);
  setTimeout(boot, 1200);
  setInterval(boot, 2000);
})();
