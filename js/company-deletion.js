// Company deletion: typed confirmation, server-side ownership and resumable cleanup.
let companyDeletionState = null;
let companyDeletionBusy = false;
let companyDeletionPreviousFocus = null;

function companyDeletionMessage(message, error = false) {
  const status = document.getElementById('delete-company-status');
  status.textContent = message;
  status.dataset.error = String(error);
}
function updateCompanyDeletionConfirmation() {
  const field = document.getElementById('delete-company-confirmation');
  field.removeAttribute('aria-invalid');
  document.getElementById('delete-company-submit').disabled = companyDeletionBusy || field.value !== 'УДАЛИТЬ';
}
function showCompanyDeletionDialog() {
  const dialog = document.getElementById('delete-company-dialog');
  companyDeletionPreviousFocus = document.activeElement;
  document.getElementById('delete-company-name').textContent = companyDeletionState.name;
  document.getElementById('delete-company-confirmation').value = '';
  companyDeletionMessage(companyDeletionState.pending ? 'Удаление уже начато. Подтвердите ещё раз, чтобы завершить очистку.' : '');
  updateCompanyDeletionConfirmation();
  if (!dialog.open) dialog.showModal();
  document.getElementById('delete-company-cancel').focus();
}
function openCompanyDeletion() {
  if (companyDeletionBusy || getUser()?.role !== 'manager') return;
  const company = getCompany();
  if (!company?.id) return;
  companyDeletionState = { companyId: company.id, name: company.name,
    pending: companyDeletionState?.companyId === company.id && companyDeletionState.pending };
  showCompanyDeletionDialog();
}
function closeCompanyDeletion() {
  if (companyDeletionBusy) return;
  document.getElementById('delete-company-dialog').close();
  companyDeletionPreviousFocus?.focus?.();
}
async function invokeCompanyDeletion(body) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 45000);
  try {
    const { data, error } = await supabaseClient.functions.invoke('delete-company', { body, signal: controller.signal });
    if (error) {
      const detail = await error.context?.json?.().catch(() => null);
      if (detail?.pending) companyDeletionState.pending = true;
      throw new Error(detail?.error || 'Не получен ответ сервера. Проверьте интернет и повторите подтверждение.');
    }
    return data;
  } finally { clearTimeout(timeout); }
}
async function restorePendingCompanyDeletion() {
  try {
    const data = await invokeCompanyDeletion({ action: 'status' });
    if (!data?.deletion?.pending) return false;
    companyDeletionState = { companyId: data.deletion.company_id, name: data.deletion.name, pending: true };
    showCompanyDeletionDialog();
    return true;
  } catch { return false; }
}
async function submitCompanyDeletion() {
  if (companyDeletionBusy || !companyDeletionState) return;
  const field = document.getElementById('delete-company-confirmation');
  if (field.value !== 'УДАЛИТЬ') {
    field.setAttribute('aria-invalid', 'true');
    companyDeletionMessage('Введите слово УДАЛИТЬ заглавными буквами.', true);
    field.focus(); return;
  }
  companyDeletionBusy = true;
  const submit = document.getElementById('delete-company-submit');
  const cancel = document.getElementById('delete-company-cancel');
  field.disabled = true; submit.disabled = true; cancel.disabled = true;
  submit.setAttribute('aria-busy', 'true');
  companyDeletionMessage('Удаляем компанию, фотографии и аккаунты. Дождитесь завершения.');
  try {
    for (let attempt = 0; attempt < 120; attempt++) {
      const result = await invokeCompanyDeletion({ companyId: companyDeletionState.companyId, confirmation: 'УДАЛИТЬ' });
      if (result?.complete === true) {
        companyDeletionState.pending = false;
        try { await supabaseClient.auth.signOut({ scope: 'local' }); } catch { /* Account is already removed. */ }
        localStorage.removeItem('checkapp-auth-session');
        localStorage.removeItem('checkapp_v3');
        sessionStorage.removeItem('checkapp_pending_registration');
        sessionStorage.setItem('checkapp_company_deleted', '1');
        window.location.reload();
        return;
      }
      if (!result?.pending) throw new Error('Удаление не подтверждено сервером. Повторите попытку.');
      companyDeletionState.pending = true;
      companyDeletionMessage('Продолжаем удаление данных и аккаунтов. Дождитесь завершения.');
    }
    throw new Error('Очистка ещё не завершена. Повторите подтверждение, чтобы продолжить.');
  } catch (error) {
    companyDeletionMessage(error.message || 'Не удалось завершить удаление. Повторите подтверждение.', true);
  } finally {
    companyDeletionBusy = false;
    field.disabled = false; cancel.disabled = false;
    submit.removeAttribute('aria-busy');
    updateCompanyDeletionConfirmation();
  }
}
document.addEventListener('DOMContentLoaded', () => {
  const dialog = document.getElementById('delete-company-dialog');
  dialog?.addEventListener('keydown', event => {
    if (event.key !== 'Tab') return;
    const controls = [...dialog.querySelectorAll('button:not(:disabled), input:not(:disabled)')];
    const first = controls[0], last = controls[controls.length - 1];
    if (!first) { event.preventDefault(); return; }
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  });
  dialog?.addEventListener('cancel', event => {
    if (companyDeletionBusy) event.preventDefault();
    else companyDeletionPreviousFocus?.focus?.();
  });
  if (sessionStorage.getItem('checkapp_company_deleted') === '1') {
    sessionStorage.removeItem('checkapp_company_deleted');
    if (typeof toast === 'function') toast('Компания, данные и аккаунты удалены.');
  }
});
