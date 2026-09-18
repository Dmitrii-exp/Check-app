// Check App — invitation UI only.
// Authentication and registration are owned entirely by js/app.js.
(function () {
  'use strict';

  function inviteCodeFromUrl() {
    try {
      return String(new URLSearchParams(window.location.search).get('invite') || '').trim().toUpperCase();
    } catch (_) {
      return '';
    }
  }

  function setupInviteUI() {
    const inviteCode = inviteCodeFromUrl();
    const form = document.getElementById('form-register');
    const tabRegister = document.getElementById('tab-register');
    const companyInput = document.getElementById('reg-company');
    const nameInput = document.getElementById('reg-name');
    const button = form?.querySelector('button[onclick="doRegister()"]');

    if (!form || !tabRegister) return;

    if (!inviteCode) return;

    tabRegister.textContent = 'Регистрация сотрудника';
    tabRegister.classList.remove('text-slate-400');
    tabRegister.classList.add('bg-primary-600', 'text-white');

    companyInput?.closest('div')?.classList.add('hidden');

    const nameLabel = nameInput?.previousElementSibling;
    if (nameLabel) nameLabel.textContent = 'Ваше имя';
    if (nameInput) nameInput.placeholder = 'Пётр Петров';

    if (button) button.textContent = 'Создать аккаунт';

    form.classList.remove('hidden');
    document.getElementById('form-login')?.classList.add('hidden');
    document.getElementById('auth-error')?.classList.add('hidden');

    if (!document.getElementById('invite-registration-note')) {
      const note = document.createElement('div');
      note.id = 'invite-registration-note';
      note.className = 'mb-4 rounded-xl border border-primary-500/20 bg-primary-500/10 px-4 py-3 text-sm text-primary-200';
      note.textContent = 'Вы приглашены в компанию. После подтверждения Email вы автоматически будете подключены к нужному подразделению.';
      form.insertBefore(note, form.firstElementChild);
    }
  }

  document.addEventListener('DOMContentLoaded', setupInviteUI);
  setupInviteUI();
})();
