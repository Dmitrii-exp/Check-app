// Hour readings are committed by a scoped, serialized server RPC, never by a client snapshot.
(function () {
  'use strict';
  const maximum = 999999999.9;
  const format = value => Number(value).toLocaleString('ru-RU', {maximumFractionDigits: 1});
  let busy = false, expected = null, opener = null;
  const byId = id => document.getElementById(id);
  const parse = value => {
    const text = String(value).trim().replace(',', '.');
    return /^\d+(?:\.\d)?$/.test(text) && Number(text) <= maximum ? Number(text) : null;
  };
  const activeEquipment = () => getDeptEquipment().filter(e => e._active);
  const feedback = (id, message) => { const el = byId(id); el.textContent = message; };
  window.checkHourFormat = function (value) { return format(value); };
  window.checkHourScheduleText = function (action, equipment) {
    if (action.nextDueHours == null) return 'Загружаем порог ТО…';
    if (!equipment || equipment.engineHours == null) return 'Сначала внесите показания';
    const remaining = Math.round((Number(action.nextDueHours) - Number(equipment.engineHours)) * 10) / 10;
    return 'ТО на ' + format(action.nextDueHours) + ' м·ч · ' + (remaining > 0 ? 'через ' + format(remaining) + ' м·ч' : remaining < 0 ? 'просрочено на ' + format(-remaining) + ' м·ч' : 'пора выполнять');
  };
  window.checkEquipmentHourSummary = function (equipment) {
    const actions = getCompany().actions.filter(a => a.equipmentId === equipment.id && a.scheduleType === 'hours');
    return `<div class="equipment-hour-summary"><p>Наработка: <strong>${equipment.engineHours == null ? 'не внесена' : format(equipment.engineHours) + ' м·ч'}</strong></p>
      ${actions.map(a => `<p>${esc(a.name)} · ${esc(checkHourScheduleText(a, equipment))}</p>`).join('')}
      ${equipment._active && !isPaidSubscriptionExpired() ? `<button type="button" class="hour-link" onclick="checkOpenHours('${equipment.id}')">Внести моточасы</button>` : ''}</div>`;
  };
  window.checkRenderTodayHours = function () {
    const items = activeEquipment(), section = byId('today-engine-hours');
    section.classList.toggle('hidden', !items.length);
    const tracked = items.filter(e => getCompany().actions.some(a => a.equipmentId === e.id && a.scheduleType === 'hours'));
    byId('today-hours-list').innerHTML = tracked.map(e => `<div class="hour-overview-row"><strong>${esc(e.name)}</strong>${checkEquipmentHourSummary(e)}</div>`).join('');
    byId('today-hours-open').disabled = isPaidSubscriptionExpired();
  };
  window.checkUpdateHoursSelection = function () {
    const equipment = activeEquipment().find(e => e.id === byId('hours-equipment').value);
    expected = equipment?.engineHours ?? null;
    byId('hours-current').textContent = expected == null ? 'Показания ещё не внесены' : 'Сохранено: ' + format(expected) + ' м·ч';
    byId('hours-value').value = '';
    byId('hours-value').removeAttribute('aria-invalid');
    feedback('hours-status', '');
  };
  window.checkOpenHours = function (equipmentId) {
    if (busy) return;
    const equipment = activeEquipment();
    if (!equipment.length) return toast('Нет доступного оборудования');
    const select = byId('hours-equipment');
    select.innerHTML = equipment.map(e => `<option value="${esc(e.id)}">${esc(e.name)}</option>`).join('');
    if (equipment.some(e => e.id === equipmentId)) select.value = equipmentId;
    checkUpdateHoursSelection();
    opener = document.activeElement;
    byId('hours-dialog').showModal();
    byId('hours-value').focus();
  };
  window.checkCloseHours = function () { if (!busy) byId('hours-dialog').close(); };
  window.checkRefreshHourCompletion = async function () {
    const department = getActiveDeptId();
    try {
      await hydrateCurrentUser();
      if (getUser()?.role === 'manager') { currentDeptId = department; renderDeptSelect(); }
    } catch (_) {
      feedback('today-hours-status', 'ТО сохранено. Обновите страницу, чтобы загрузить следующий порог моточасов.');
    }
  };
  window.checkSaveHours = async function () {
    if (busy) return;
    const input = byId('hours-value'), value = parse(input.value);
    let error = value == null ? 'Укажите моточасы от 0 до 999 999 999,9. Допустим один знак после запятой.' : '';
    if (!error && expected != null && value < expected) error = 'Показания не могут быть меньше ' + format(expected) + ' м·ч.';
    input.setAttribute('aria-invalid', String(!!error));
    if (error) { feedback('hours-status', error); input.focus(); return; }
    busy = true;
    const submit = byId('hours-save'), cancel = byId('hours-cancel'), select = byId('hours-equipment');
    submit.disabled = cancel.disabled = input.disabled = select.disabled = true;
    byId('hours-form').setAttribute('aria-busy', 'true');
    feedback('hours-status', 'Сохраняем показания…');
    const department = getActiveDeptId();
    try {
      const {data, error: rpcError} = await supabaseClient.rpc('record_equipment_hours', {
        p_equipment_id: select.value, p_hours: value, p_expected_hours: expected
      });
      if (rpcError) throw rpcError;
      const saved = getCompany().equipment.find(e => e.id === select.value);
      if (saved) { saved.engineHours = Number(data.engine_hours); saved.engineHoursUpdatedAt = data.engine_hours_updated_at; }
      expected = Number(data.engine_hours);
      let warning = '';
      try { await hydrateCurrentUser(); }
      catch (_) { warning = 'Показания сохранены. Обновите страницу, чтобы загрузить актуальные задачи.'; }
      if (getUser()?.role === 'manager') { currentDeptId = department; renderDeptSelect(); }
      renderToday(); renderEquipment(); renderActions();
      if (getUser()?.role !== 'employee') renderDashboard();
      feedback('today-hours-status', warning || 'Сохранено: ' + format(expected) + ' м·ч');
      byId('hours-dialog').close();
      toast(warning || 'Моточасы сохранены');
      void refreshMaintenanceNotifications().catch(console.error);
    } catch (error) {
      feedback('hours-status', error.message || 'Не удалось сохранить. Проверьте интернет и повторите.');
      if (error.code === '40001') {
        try { await hydrateCurrentUser(); if (getUser()?.role === 'manager') { currentDeptId = department; renderDeptSelect(); } } catch (_) {}
      }
    } finally {
      busy = false;
      submit.disabled = cancel.disabled = input.disabled = select.disabled = false;
      byId('hours-form').setAttribute('aria-busy', 'false');
    }
  };
  window.checkSetActionSchedule = function () {
    const hours = byId('action-schedule-type').value === 'hours';
    byId('action-days-field').classList.toggle('hidden', hours);
    byId('action-hours-field').classList.toggle('hidden', !hours);
    feedback('action-schedule-status', '');
    byId('action-hours-interval').removeAttribute('aria-invalid');
    checkPreviewHourSchedule();
  };
  window.checkPreviewHourSchedule = function () {
    const equipment = getCompany().equipment.find(e => e.id === byId('action-equip').value);
    const interval = parse(byId('action-hours-interval').value);
    let text = 'Укажите интервал между ТО в моточасах.';
    if (equipment?.engineHours == null) text = 'Сначала внесите текущие моточасы во вкладке «Оборудование» или «Задачи».';
    else if (interval > 0) {
      const next = Math.max(interval, Math.ceil(Math.round(Number(equipment.engineHours) * 10) / Math.round(interval * 10)) * interval);
      text = 'Сейчас ' + format(equipment.engineHours) + ' м·ч. ' + checkHourScheduleText({nextDueHours: next}, equipment) + '.';
    }
    byId('action-hours-preview').textContent = text;
  };
  window.checkHourActionValues = function () {
    if (byId('action-schedule-type').value !== 'hours') return {schedule_type: 'days'};
    const interval = parse(byId('action-hours-interval').value);
    const equipment = getCompany().equipment.find(e => e.id === byId('action-equip').value);
    const error = equipment?.engineHours == null ? 'Сначала внесите текущие моточасы оборудования.' : !(interval > 0) ? 'Укажите интервал больше нуля, не более одного знака после запятой.' : '';
    feedback('action-schedule-status', error);
    byId('action-hours-interval').setAttribute('aria-invalid', String(!!error));
    if (error) { byId('action-hours-interval').focus(); return null; }
    return {schedule_type: 'hours', hours_interval: interval};
  };
  function bind() {
    byId('hours-dialog').addEventListener('cancel', event => { if (busy) event.preventDefault(); });
    byId('hours-dialog').addEventListener('close', () => {
      const target = opener?.isConnected ? opener : document.querySelector('.page:not(.hidden) h1');
      if (target) { if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1'); target.focus(); }
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bind, {once: true}); else bind();
})();
