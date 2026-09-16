// Check App — standalone registration flow inspired by SaleTrening2
(function () {
  'use strict';

  const PUBLIC_URL = 'https://www.app-check.ru/';
  const INVITE_PARAM = 'invite';
  let registrationBusy = false;

  function getInviteCode() {
    try {
      return String(new URLSearchParams(window.location.search).get(INVITE_PARAM) || '').trim().toUpperCase();
    } catch (_) {
      return '';
    }
  }

  function hasInvite() {
    return !!getInviteCode();
  }

  function setStatus(text, ok) {
    if (typeof window.showError === 'function' && !ok) {
      window.showError(text);
      return;
    }
    const el = document.getElementById('auth-error');
    if (!el) return;
    el.textContent = text || '';
    el.classList.remove('hidden', 'text-red-400', 'text-emerald-400');
    el.classList.add(ok ? 'text-emerald-400' : 'text-red-400');
  }

  function clearStatus() {
    const el = document.getElementById('auth-error');
    if (!el) return;
    el.textContent = '';
    el.classList.add('hidden');
  }

  function replaceRegisterSubmit() {
    const form = document.getElementById('form-register');
    if (!form || form.dataset.saletrainingStyleReady) return;

    const company = document.getElementById('reg-company');
    const name = document.getElementById('reg-name');
    const email = document.getElementById('reg-email');
    const password = document.getElementById('reg-password');
    const originalButton = form.querySelector('button[onclick="doRegister()"]');
    if (!name || !email || !password || !originalButton) return;

    form.dataset.saletrainingStyleReady = '1';

    if (hasInvite()) {
      company?.closest('div')?.classList.add('hidden');
      const label = name.previousElementSibling;
      if (label) label.textContent = 'Ваше имя';
      name.placeholder = 'Иван Иванов';
      originalButton.textContent = 'Создать аккаунт';
    } else {
      originalButton.textContent = 'Зарегистрироваться';
    }

    // Remove dependency on the old inline handler. We bind directly and keep
    // the same visual markup/classes already used by Check App.
    const button = originalButton.cloneNode(true);
    originalButton.replaceWith(button);
    button.removeAttribute('onclick');
    button.type = 'button';
    button.addEventListener('click', submitRegistration);
  }

  async function submitRegistration() {
    if (registrationBusy) return;
    registrationBusy = true;
    clearStatus();

    const inviteCode = getInviteCode();
    const name = document.getElementById('reg-name')?.value.trim() || '';
    const email = document.getElementById('reg-email')?.value.trim().toLowerCase() || '';
    const password = document.getElementById('reg-password')?.value || '';
    const company = document.getElementById('reg-company')?.value.trim() || '';
    const button = document.getElementById('form-register')?.querySelector('button:not([type="submit"])') ||
      document.getElementById('form-register')?.querySelector('button');

    try {
      if (typeof supabaseClient === 'undefined' || !supabaseClient?.auth) {
        throw new Error('Не загрузился модуль Supabase.');
      }
      if (!name || !email || password.length < 8) {
        throw new Error('Заполните имя, Email и пароль минимум из 8 символов.');
      }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        throw new Error('Введите корректный Email.');
      }
      if (!inviteCode && !company) {
        throw new Error('Название компании обязательно.');
      }

      if (button) {
        button.disabled = true;
        button.textContent = 'Создаю аккаунт…';
      }

      const metadata = inviteCode
        ? { name, signup_mode: 'invite', invite_code: inviteCode }
        : { name, company_name: company, signup_mode: 'register' };

      const redirectTo = PUBLIC_URL;
      const { data, error } = await supabaseClient.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: redirectTo,
          data: metadata
        }
      });

      if (error) throw error;
      if (!data?.user) throw new Error('Supabase не вернул пользователя.');

      // Important: preserve all registration context through refresh/email flow.
      window.__checkAppPendingRegistration = {
        mode: inviteCode ? 'invite' : 'register',
        email,
        name,
        company,
        code: inviteCode
      };
      try {
        sessionStorage.setItem('checkapp_pending_registration', JSON.stringify(window.__checkAppPendingRegistration));
      } catch (_) {}

      if (!data.session) {
        if (typeof window.openEmailConfirmationModal === 'function') {
          window.pendingEmail = window.__checkAppPendingRegistration;
          window.openEmailConfirmationModal(email);
        } else {
          setStatus('Регистрация создана. Проверьте Email и подтвердите адрес.', true);
        }
        return;
      }

      await finishRegistration(window.__checkAppPendingRegistration);
    } catch (error) {
      console.error('[Check App] registration error:', error);
      setStatus(error?.message || 'Не удалось зарегистрироваться.');
    } finally {
      registrationBusy = false;
      if (button) {
        button.disabled = false;
        button.textContent = hasInvite() ? 'Создать аккаунт' : 'Зарегистрироваться';
      }
    }
  }

  async function finishRegistration(pending) {
    if (!pending) return;

    if (pending.mode === 'invite') {
      const { error } = await supabaseClient.rpc('join_company_by_invite', {
        p_invite_code: pending.code,
        p_name: pending.name,
        p_phone: null
      });
      if (error) throw error;
    } else {
      // Mirror SaleTrening2's second stage: account is created first,
      // company/workspace is initialized immediately afterwards.
      const { error } = await supabaseClient.rpc('bootstrap_company', {
        p_company_name: pending.company,
        p_department_name: 'Основное',
        p_invite_code: typeof generateCode === 'function' ? generateCode() : undefined,
        p_name: pending.name,
        p_phone: null
      });
      if (error) throw error;
    }

    const ok = typeof hydrateCurrentUser === 'function' ? await hydrateCurrentUser() : false;
    if (!ok || !db?.currentUser) {
      throw new Error('Аккаунт создан, но профиль ещё не готов. Войдите повторно через форму «Войти».');
    }

    try { sessionStorage.removeItem('checkapp_pending_registration'); } catch (_) {}
    window.__checkAppPendingRegistration = null;

    if (typeof enterApp === 'function') {
      enterApp();
    } else {
      setStatus('Регистрация завершена. Теперь можно войти.', true);
    }
  }

  function restorePendingRegistration() {
    if (window.__checkAppPendingRegistration) return window.__checkAppPendingRegistration;
    try {
      const raw = sessionStorage.getItem('checkapp_pending_registration');
      if (raw) return JSON.parse(raw);
    } catch (_) {}
    return null;
  }

  function installEmailConfirmationContinuation() {
    const originalVerify = window.verifyEmailOtp;
    if (typeof originalVerify !== 'function' || originalVerify.__checkAppSaleFlow) return;

    const wrapped = async function () {
      const result = await originalVerify.apply(this, arguments);
      return result;
    };
    wrapped.__checkAppSaleFlow = true;
    window.verifyEmailOtp = wrapped;

    // The existing Check App OTP handler already creates the profile from
    // pendingEmail. We only ensure pending data survives page/reload paths.
    const pending = restorePendingRegistration();
    if (pending && !window.pendingEmail) window.pendingEmail = pending;
  }

  function applyInviteView() {
    if (!hasInvite()) return;
    const tabRegister = document.getElementById('tab-register');
    const tabLogin = document.getElementById('tab-login');
    const form = document.getElementById('form-register');
    const login = document.getElementById('form-login');
    const tabInvite = document.getElementById('tab-invite');
    if (tabInvite) tabInvite.remove();
    tabRegister?.classList.add('bg-primary-600', 'text-white');
    tabRegister?.classList.remove('text-slate-400');
    if (tabRegister) tabRegister.textContent = 'Регистрация сотрудника';
    login?.classList.add('hidden');
    form?.classList.remove('hidden');
    tabLogin?.classList.remove('bg-primary-600', 'text-white');
    tabLogin?.classList.add('text-slate-400');
  }

  function boot() {
    applyInviteView();
    replaceRegisterSubmit();
    installEmailConfirmationContinuation();
  }

  document.addEventListener('DOMContentLoaded', boot);
  setTimeout(boot, 50);
  setTimeout(boot, 250);
  setTimeout(boot, 1000);
  setInterval(boot, 2000);
})();
