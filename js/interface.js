// Presentation and navigation only. Existing application handlers own all data.
(function () {
  'use strict';
  const paths = {
    home: '<path d="m3 10 9-7 9 7v11h-6v-7H9v7H3Z"/>',
    calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4m10-4v4M3 11h18m-13 5h2m4 0h2"/>',
    tasks: '<path d="m3 6 1 1 2-3m3 2h12M3 12h3m3 0h12M3 18h3m3 0h12"/>',
    more: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
    tool: '<path d="m14 6 4 4m-6-6a6 6 0 0 0-6 8L3 18a2 2 0 0 0 3 3l6-6a6 6 0 0 0 8-6l-4 3-4-4 3-4Z"/>',
    history: '<path d="M3 10a9 9 0 1 1 1 7M3 4v6h6m3-3v5l3 2"/>',
    camera: '<path d="m8 5 1-2h6l1 2h4v15H4V5Z"/><circle cx="12" cy="12" r="3"/>',
    check: '<path d="m5 12 4 4L19 6"/>',
    team: '<circle cx="9" cy="8" r="3"/><path d="M3 21v-3a6 6 0 0 1 12 0v3m1-16a3 3 0 0 1 0 6m2 3a5 5 0 0 1 3 4v3"/>',
    cabinet: '<circle cx="12" cy="8" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2"/>',
    reports: '<path d="M4 3v18h17M9 16v-5m5 5V7m5 9V4"/>',
    consumables: '<path d="m3 7 9-4 9 4v11l-9 4-9-4Zm0 0 9 4 9-4m-9 4v11M7 5l10 4"/>',
    plus: '<path d="M12 5v14M5 12h14"/>'
  };
  const icon = name => '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (paths[name] || paths.tasks) + '</svg>';
  window.checkInterfaceIcon = icon;
  const dialog = document.getElementById('mobile-more');
  const opener = document.getElementById('mobile-more-open');
  const nav = document.getElementById('mobile-navigation');
  if (!dialog || !opener || !nav) return;

  function currentUser() { return typeof getUser === 'function' ? getUser() : null; }
  function staff() { return ['manager', 'responsible'].includes(currentUser()?.role); }
  function allowed(route) {
    if (route === 'calendar') return staff();
    const source = document.querySelector('#manager-nav [data-page="' + route + '"]');
    return !!source && !source.classList.contains('hidden');
  }
  function closeMenu() {
    if (dialog.open) dialog.close();
    opener.setAttribute('aria-expanded', 'false');
  }
  window.checkCloseInterfaceMenu = closeMenu;
  function go(route) {
    if (!allowed(route)) return;
    closeMenu();
    // showPage keeps its existing role checks; calendar owns its own page.
    if (route === 'calendar') {
      if (typeof openCalendar !== 'function') return;
      openCalendar();
    } else showPage(route);
    const heading = document.querySelector('.page:not(.hidden) h1');
    if (heading) { heading.tabIndex = -1; heading.focus({ preventScroll: true }); }
    window.scrollTo({ top: 0, behavior: 'auto' });
  }
  function refreshShell() {
    const user = currentUser();
    if (!user || document.getElementById('app-screen').classList.contains('hidden')) { closeMenu(); return; }
    const isStaff = staff();
    const routes = isStaff
      ? [['home', 'dashboard', 'Главная', 'home'], ['calendar', 'calendar', 'Календарь', 'calendar'], ['tasks', 'today', 'Задачи', 'tasks']]
      : [['home', 'today', 'Сегодня', 'home'], ['calendar', 'one-time', 'Разовые', 'tasks'], ['tasks', 'consumables', 'Расходники', 'consumables']];
    const selected = document.querySelector('.page:not(.hidden)')?.id.replace('page-', '');
    for (const [slot, route, label, glyph] of routes) {
      const button = nav.querySelector('[data-mobile-slot="' + slot + '"]');
      button.dataset.interfaceRoute = route;
      button.querySelector('[data-mobile-label]').textContent = label;
      button.querySelector('[data-interface-icon]').innerHTML = icon(glyph);
      button.classList.toggle('is-current', selected === route);
      if (selected === route) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current');
    }
    const moreActive = !routes.some(([, route]) => route === selected);
    opener.classList.toggle('is-current', moreActive);
    if (moreActive) opener.setAttribute('aria-current', 'page'); else opener.removeAttribute('aria-current');
    const name = String(user.name || 'Личный кабинет');
    document.getElementById('mobile-initials').textContent = name.split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]).join('').toUpperCase();
    document.getElementById('mobile-user-name').textContent = document.getElementById('header-user').textContent;
    document.getElementById('mobile-user-email').textContent = document.getElementById('header-email').textContent;
    const date = document.getElementById('dashboard-date');
    if (date) date.textContent = 'Сегодня · ' + new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long' }).format(new Date());
  }
  window.checkRefreshShell = refreshShell;

  const menuIcons = { dashboard: 'home', today: 'tasks', 'one-time': 'tasks', equipment: 'tool', actions: 'tool', consumables: 'consumables', team: 'team', history: 'history', reports: 'reports', cabinet: 'cabinet', 'super-admin': 'cabinet' };
  function openMenu() {
    refreshShell();
    if (!currentUser()) return;
    const items = document.getElementById('mobile-more-items');
    items.replaceChildren();
    const sources = [...document.querySelectorAll('#manager-nav [data-page]')].filter(source => allowed(source.dataset.page));
    for (const source of sources) {
      const button = document.createElement('button');
      button.type = 'button'; button.dataset.interfaceRoute = source.dataset.page;
      const symbol = document.createElement('span'); symbol.innerHTML = icon(menuIcons[source.dataset.page]);
      const text = document.createElement('span');
      // Keep counters out of the label; role visibility remains owned by enterApp.
      text.textContent = [...source.childNodes].filter(node => node.nodeType === Node.TEXT_NODE).map(node => node.textContent).join('').trim();
      button.append(symbol, text); items.append(button);
    }
    if (currentUser().role === 'manager') {
      const button = document.createElement('button'); button.type = 'button'; button.dataset.createDepartment = '';
      button.innerHTML = icon('plus'); button.append(document.createTextNode('Создать подразделение')); items.append(button);
    }
    opener.setAttribute('aria-expanded', 'true');
    if (!dialog.open) dialog.showModal();
  }
  document.querySelectorAll('[data-interface-icon]').forEach(el => { el.innerHTML = icon(el.dataset.interfaceIcon); });
  opener.addEventListener('click', openMenu);
  document.getElementById('mobile-more-close').addEventListener('click', closeMenu);
  dialog.addEventListener('close', () => opener.setAttribute('aria-expanded', 'false'));
  dialog.addEventListener('click', event => { if (event.target === dialog) { const box = dialog.getBoundingClientRect(); if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) closeMenu(); } });
  document.getElementById('mobile-more-logout').addEventListener('click', async () => { closeMenu(); try { await doLogout(); } catch (_) { if (typeof toast === 'function') toast('Не удалось выйти. Повторите попытку.'); } });
  document.addEventListener('click', event => {
    const route = event.target.closest('[data-interface-route]');
    if (route) { go(route.dataset.interfaceRoute); return; }
    const complete = event.target.closest('[data-maintenance-task]');
    if (complete) {
      const task = typeof getCompany === 'function' && getCompany()?.tasks.find(task => task.id === complete.dataset.maintenanceTask);
      // Delegate only a currently visible, pending task to the unchanged dialog.
      if (task && task.status !== 'done' && getDeptTasks(todayStr()).some(item => item.id === task.id)) openCompleteModal(task.id);
    }
    if (event.target.closest('[data-create-department]') && currentUser()?.role === 'manager') { closeMenu(); openDeptModal(); }
  });
  const desktop = window.matchMedia('(min-width: 768px)');
  desktop.addEventListener('change', event => { if (event.matches) closeMenu(); });
  document.addEventListener('DOMContentLoaded', refreshShell);
})();
