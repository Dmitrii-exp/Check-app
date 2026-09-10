// Check App — employee invitation registration flow + auth hardening
(function () {
  'use strict';

  const PUBLIC_URL = 'https://www.app-check.ru/';
  const INVITE_PARAM = 'invite';
  let signupResendUntil = 0;
  let recoveryResendUntil = 0;
  let inviteClickBound = false;

  function inviteCodeFromUrl() {
    try {
      return String(new URLSearchParams(window.location.search).get(INVITE_PARAM) || '').trim().toUpperCase();
    } catch (_) { return ''; }
  }

  function hasInvite() { return !!inviteCodeFromUrl(); }

  function hideLegacyInviteUI() {
    document.getElementById('tab-invite')?.remove();
    const form = document.getElementById('form-invite');
    if (form) form.classList.add('hidden');
  }

  function submitInviteRegistration() {
    const code = inviteCodeFromUrl();
    if (!code) return false;

    const name = document.getElementById('reg-name')?.value.trim() || '';
    const email = document.getElementById('reg-email')?.value.trim().toLowerCase() || '';
    const password = document.getElementById('reg-password')?.value || '';

    if (!name || !email || password.length < 8) {
      showError('Укажите имя, Email и пароль минимум из 8 символов.');
      return true;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      showError('Введите корректный Email.');
      return true;
    }

    const codeInput = document.getElementById('invite-code');
    const inviteName = document.getElementById('invite-name');
    const inviteEmail = document.getElementById('invite-email');
    const invitePassword = document.getElementById('invite-password');

    if (!codeInput || !inviteName || !inviteEmail || !invitePassword || typeof window.doJoinByInvite !== 'function') {
      showError('Не удалось подготовить регистрацию по приглашению. Обновите страницу и попробуйте снова.');
      return true;
    }

    codeInput.value = code;
    inviteName.value = name;
    inviteEmail.value = email;
    invitePassword.value = password;
    window.doJoinByInvite();
    return true;
  }

  function bindInviteRegisterButton() {
    if (!hasInvite() || inviteClickBound) return;
    inviteClickBound = true;

    // Do not rely on replacing the global doRegister(). Inline onclick handlers
    // can resolve the original function binding. Capture the click and stop it
    // before the legacy company-registration handler receives it.
    document.addEventListener('click', function (event) {
      const target = event.target?.closest?.('#form-register button[onclick="doRegister()"]');
      if (!target) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      submitInviteRegistration();
    }, true);
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
      if (companyWrap) companyWrap.classList.add('hidden');
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

    bindInviteRegisterButton();

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

  function installAuthRedirectFix() {
    try {
      if (typeof supabaseClient === 'undefined' || !supabaseClient?.auth || supabaseClient.auth.__checkAppInviteAuthFixInstalled) return;
      const auth = supabaseClient.auth;
      const originalVerifyOtp = auth.verifyOtp.bind(auth);
      const originalSignUp = auth.signUp.bind(auth);
      const originalResend = auth.resend.bind(auth);
      const originalReset = auth.resetPasswordForEmail.bind(auth);

      auth.verifyOtp = function (params) {
        if (params?.type === 'signup' && params.email && params.token) return originalVerifyOtp({ ...params, type: 'email' });
        return originalVerifyOtp(params);
      };
      auth.signUp = function (credentials) {
        return originalSignUp({ ...(credentials || {}), options: { ...((credentials || {}).options || {}), emailRedirectTo: PUBLIC_URL } });
      };
      auth.resend = function (credentials) {
        if (credentials?.type === 'signup') return originalResend({ ...credentials, options: { ...(credentials.options || {}), emailRedirectTo: PUBLIC_URL } });
        return originalResend(credentials);
      };
      auth.resetPasswordForEmail = function (email, options) {
        return originalReset(email, { ...(options || {}), redirectTo: PUBLIC_URL });
      };
      auth.__checkAppInviteAuthFixInstalled = true;
    } catch (e) { console.error('[Check App] Auth redirect fix failed', e); }
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
      b.disabled = true; b.textContent = 'Отправляем…';
      try {
        const { error } = await supabaseClient.auth.resend({ type: 'signup', email, options: { emailRedirectTo: PUBLIC_URL } });
        if (error) throw error;
        signupResendUntil = Date.now() + 60000;
        b.textContent = 'Повторить через 60 сек.';
        if (typeof pendingEmail !== 'undefined') pendingEmail = pendingEmail || { mode: hasInvite() ? 'invite' : 'register', email, name: document.getElementById('reg-name')?.value.trim() || '', company: '', code: inviteCodeFromUrl() };
        setTimeout(() => { b.disabled = false; b.textContent = 'Не получили письмо? Отправить ещё раз'; }, 60000);
        if (typeof openEmailConfirmationModal === 'function') openEmailConfirmationModal(email);
        toast('Новое письмо отправлено. Используйте последнюю ссылку/код.');
      } catch (e) {
        b.disabled = false; b.textContent = 'Не получили письмо? Отправить ещё раз';
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
    b.id = 'checkapp-recovery-resend'; b.type = 'button';
    b.className = 'w-full mt-3 py-2 text-sm text-primary-400 hover:text-primary-300 transition';
    b.textContent = 'Отправить ссылку ещё раз';
    b.onclick = async function () {
      const email = document.getElementById('password-reset-email')?.value.trim().toLowerCase() || '';
      if (!email) return showError('Введите Email.');
      if (Date.now() < recoveryResendUntil) return;
      b.disabled = true; b.textContent = 'Отправляем…';
      try {
        const { error } = await supabaseClient.auth.resetPasswordForEmail(email, { redirectTo: PUBLIC_URL });
        if (error) throw error;
        recoveryResendUntil = Date.now() + 60000;
        b.textContent = 'Повторить через 60 сек.';
        toast('Новая ссылка отправлена. Используйте последнюю ссылку.');
        setTimeout(() => { b.disabled = false; b.textContent = 'Отправить ссылку ещё раз'; }, 60000);
      } catch (e) {
        b.disabled = false; b.textContent = 'Отправить ссылку ещё раз';
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
        const ta = document.createElement('textarea'); ta.value = link; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove(); toast('Ссылка-приглашение скопирована');
      });
    };
    setTimeout(setupManagerInviteLink, 300);
    setTimeout(setupManagerInviteLink, 1000);
  }

  function boot() {
    installAuthRedirectFix();
    hideLegacyInviteUI();
    if (hasInvite()) setupInviteRegistration();
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
