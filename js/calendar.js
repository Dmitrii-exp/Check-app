// Check App calendar module
(function () {
  'use strict';

  let calendarMonth = new Date();
  calendarMonth = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth(), 1);
  let selectedDate = null;

  function isoDate(year, monthIndex, day) {
    return `${year}-${String(monthIndex + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }

  function parseIsoDate(value) {
    const [y, m, d] = String(value || '').split('-').map(Number);
    return new Date(y, (m || 1) - 1, d || 1);
  }

  function addDays(dateString, days) {
    const d = parseIsoDate(dateString);
    d.setDate(d.getDate() + Number(days || 0));
    return isoDate(d.getFullYear(), d.getMonth(), d.getDate());
  }

  function monthTitle(date) {
    const value = date.toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' });
    return value.charAt(0).toUpperCase() + value.slice(1);
  }

  function activeActionsForDepartment() {
    const company = getCompany();
    const deptId = getActiveDeptId();
    return (company?.actions || []).filter(action =>
      action.departmentId === deptId &&
      isDepartmentActive(action.departmentId) &&
      isEquipmentActive(action.equipmentId)
    );
  }

  function persistedTasksForDate(dateString) {
    return getDeptTasks(dateString);
  }

  function projectedTasksForDate(dateString) {
    const company = getCompany();
    const today = todayStr();
    if (!company || dateString < today) return [];

    const persisted = persistedTasksForDate(dateString);
    const persistedActionIds = new Set(persisted.map(task => task.actionId).filter(Boolean));
    const result = [];

    activeActionsForDepartment().forEach(action => {
      if (persistedActionIds.has(action.id)) return;

      const completions = (company.completions || [])
        .filter(item => item.actionId === action.id)
        .sort((a, b) => String(b.date).localeCompare(String(a.date)));
      const last = completions[0];
      const frequency = Math.max(1, Number(action.frequency) || 1);

      let firstDue = last ? addDays(last.date, frequency) : today;
      if (firstDue < today) firstDue = today;
      if (dateString < firstDue) return;

      const due = parseIsoDate(firstDue);
      const target = parseIsoDate(dateString);
      const diffDays = Math.round((target - due) / 86400000);
      if (diffDays < 0 || diffDays % frequency !== 0) return;

      const equipment = (company.equipment || []).find(item => item.id === action.equipmentId);
      result.push({
        id: `forecast-${action.id}-${dateString}`,
        actionId: action.id,
        equipmentId: action.equipmentId,
        departmentId: action.departmentId,
        date: dateString,
        status: 'planned',
        title: action.name,
        equipName: equipment?.name || '—',
        equipCode: equipment?.code || '',
        description: action.description || '',
        _forecast: true
      });
    });

    return result;
  }

  function tasksForCalendarDate(dateString) {
    return [...persistedTasksForDate(dateString), ...projectedTasksForDate(dateString)];
  }

  function hasCalendarTask(dateString) {
    return tasksForCalendarDate(dateString).length > 0;
  }

  function injectCalendarUI() {
    if (!document.getElementById('page-calendar')) {
      const main = document.querySelector('#app-screen main');
      if (main) {
        const page = document.createElement('div');
        page.id = 'page-calendar';
        page.className = 'page hidden space-y-5 fade-in';
        page.innerHTML = `
          <div class="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <h1 class="text-2xl sm:text-3xl font-bold tracking-tight">Календарь</h1>
              <p class="text-sm text-slate-400 mt-1">Плановые работы и обслуживание оборудования</p>
            </div>
            <button type="button" id="calendar-today-btn" class="px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-sm font-medium transition">Сегодня</button>
          </div>

          <div class="grid grid-cols-1 lg:grid-cols-[1.2fr_0.9fr] gap-5 items-start">
            <section class="bg-slate-900 border border-slate-800 rounded-2xl p-4 sm:p-5 shadow-sm">
              <div class="flex items-center justify-between gap-3 mb-5">
                <button type="button" id="calendar-prev" aria-label="Предыдущий месяц" class="w-10 h-10 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xl transition">‹</button>
                <div id="calendar-month-title" class="font-semibold text-center text-base sm:text-lg"></div>
                <button type="button" id="calendar-next" aria-label="Следующий месяц" class="w-10 h-10 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xl transition">›</button>
              </div>

              <div class="grid grid-cols-7 gap-1.5 sm:gap-2 text-center text-[11px] sm:text-xs font-medium text-slate-500 mb-2">
                <div>Пн</div><div>Вт</div><div>Ср</div><div>Чт</div><div>Пт</div><div>Сб</div><div>Вс</div>
              </div>
              <div id="calendar-grid" class="grid grid-cols-7 gap-1.5 sm:gap-2"></div>

              <div class="flex flex-wrap gap-x-5 gap-y-2 mt-5 pt-4 border-t border-slate-800 text-xs text-slate-400">
                <div class="flex items-center gap-2"><span class="w-5 h-5 rounded-md bg-white border border-slate-300"></span><span>Задач нет</span></div>
                <div class="flex items-center gap-2"><span class="w-5 h-5 rounded-md bg-sky-500 border border-sky-400"></span><span>Есть задача</span></div>
                <div class="flex items-center gap-2"><span class="w-2 h-2 rounded-full bg-amber-400"></span><span>Сегодня</span></div>
              </div>
            </section>

            <section class="bg-slate-900 border border-slate-800 rounded-2xl p-4 sm:p-5 shadow-sm lg:sticky lg:top-24">
              <div class="flex items-center justify-between gap-3 mb-4">
                <div>
                  <h2 id="calendar-selected-title" class="font-semibold text-lg">Выберите дату</h2>
                  <p class="text-xs text-slate-500 mt-1">Список работ на выбранный день</p>
                </div>
                <span id="calendar-selected-count" class="text-xs px-2.5 py-1 rounded-full bg-slate-800 text-slate-400">0</span>
              </div>
              <div id="calendar-task-list" class="space-y-3"></div>
              <div id="calendar-empty" class="text-center py-10 px-4 text-slate-500 text-sm">На выбранную дату задач нет</div>
            </section>
          </div>`;
        main.appendChild(page);
      }
    }

    // Calendar is a common navigation tab and must be visible for every authenticated role.
    // The existing manager navigation remains role-restricted in app.js.
    const managerNav = document.getElementById('manager-nav');
    if (managerNav && !document.getElementById('calendar-nav')) {
      const calendarNav = document.createElement('nav');
      calendarNav.id = 'calendar-nav';
      calendarNav.className = 'bg-slate-900 border-b border-slate-800';
      calendarNav.innerHTML = `
        <div class="max-w-5xl mx-auto px-2 flex overflow-x-auto scroll-thin">
          <button type="button" data-page="calendar" class="nav-btn flex-shrink-0 px-4 py-3 text-sm font-medium border-b-2 border-primary-500 text-primary-400 hover:text-white transition">📅 Календарь</button>
        </div>`;
      managerNav.parentNode.insertBefore(calendarNav, managerNav);
      calendarNav.querySelector('[data-page="calendar"]')?.addEventListener('click', () => window.showPage('calendar'));
    }

    bindCalendarControls();
  }

  function bindCalendarControls() {
    const page = document.getElementById('page-calendar');
    if (!page || page.dataset.bound === '1') return;
    page.dataset.bound = '1';

    document.getElementById('calendar-prev')?.addEventListener('click', () => {
      calendarMonth = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() - 1, 1);
      selectedDate = null;
      renderCalendar();
    });
    document.getElementById('calendar-next')?.addEventListener('click', () => {
      calendarMonth = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() + 1, 1);
      selectedDate = null;
      renderCalendar();
    });
    document.getElementById('calendar-today-btn')?.addEventListener('click', () => {
      const now = new Date();
      calendarMonth = new Date(now.getFullYear(), now.getMonth(), 1);
      selectedDate = todayStr();
      renderCalendar();
    });
  }

  function renderCalendar() {
    injectCalendarUI();
    const title = document.getElementById('calendar-month-title');
    const grid = document.getElementById('calendar-grid');
    if (!title || !grid || !getCompany()) return;

    title.textContent = monthTitle(calendarMonth);
    grid.innerHTML = '';

    const year = calendarMonth.getFullYear();
    const month = calendarMonth.getMonth();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const firstWeekday = (new Date(year, month, 1).getDay() + 6) % 7;
    const today = todayStr();

    for (let i = 0; i < firstWeekday; i++) {
      const spacer = document.createElement('div');
      spacer.className = 'aspect-square min-h-[42px]';
      grid.appendChild(spacer);
    }

    for (let day = 1; day <= daysInMonth; day++) {
      const dateString = isoDate(year, month, day);
      const hasTask = hasCalendarTask(dateString);
      const isSelected = selectedDate === dateString;
      const isToday = today === dateString;
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.date = dateString;
      button.setAttribute('aria-label', `${formatDate(dateString)}${hasTask ? ', есть задачи' : ', задач нет'}`);
      button.className = [
        'aspect-square min-h-[42px] rounded-xl border font-semibold text-sm transition flex items-center justify-center relative',
        hasTask ? 'bg-sky-500 border-sky-400 text-white hover:bg-sky-400' : 'bg-white border-slate-300 text-slate-900 hover:bg-slate-100',
        isSelected ? 'ring-2 ring-primary-400 ring-offset-2 ring-offset-slate-900' : '',
        isToday && !hasTask ? 'after:absolute after:bottom-1 after:w-1.5 after:h-1.5 after:rounded-full after:bg-amber-400' : '',
        isToday && hasTask ? 'after:absolute after:bottom-1 after:w-1.5 after:h-1.5 after:rounded-full after:bg-amber-300' : ''
      ].join(' ');
      button.textContent = String(day);
      button.addEventListener('click', () => {
        selectedDate = dateString;
        renderCalendar();
      });
      grid.appendChild(button);
    }

    if (!selectedDate || parseIsoDate(selectedDate).getMonth() !== month || parseIsoDate(selectedDate).getFullYear() !== year) {
      selectedDate = today.startsWith(`${year}-${String(month + 1).padStart(2, '0')}`) ? today : isoDate(year, month, 1);
    }

    renderSelectedDate();
  }

  function renderSelectedDate() {
    const list = document.getElementById('calendar-task-list');
    const empty = document.getElementById('calendar-empty');
    const title = document.getElementById('calendar-selected-title');
    const count = document.getElementById('calendar-selected-count');
    if (!list || !empty || !title || !count || !selectedDate) return;

    const tasks = tasksForCalendarDate(selectedDate);
    title.textContent = formatDate(selectedDate);
    count.textContent = String(tasks.length);

    if (!tasks.length) {
      list.innerHTML = '';
      empty.classList.remove('hidden');
      return;
    }

    empty.classList.add('hidden');
    list.innerHTML = tasks.map(task => {
      const isDone = task.status === 'done';
      const isPlanned = task._forecast === true;
      const canComplete = !isDone && !isPlanned && task.date === todayStr();
      const badge = isDone
        ? '<span class="text-[11px] px-2.5 py-1 rounded-full bg-emerald-500/20 text-emerald-400">✓ Выполнено</span>'
        : isPlanned
          ? '<span class="text-[11px] px-2.5 py-1 rounded-full bg-sky-500/15 text-sky-300">Запланировано</span>'
          : '<span class="text-[11px] px-2.5 py-1 rounded-full bg-amber-500/20 text-amber-400">Ожидает</span>';

      return `<div class="bg-slate-800/60 border border-slate-700 rounded-xl p-4 hover:border-slate-600 transition ${isDone ? 'opacity-60' : ''}">
        <div class="flex items-start gap-3">
          <div class="w-10 h-10 flex-shrink-0 rounded-lg bg-sky-500/10 text-sky-400 flex items-center justify-center text-lg">🔧</div>
          <div class="min-w-0 flex-1">
            <div class="font-semibold leading-snug">${esc(task.title)}</div>
            <div class="text-sm text-slate-400 mt-1">${esc(task.equipName || '—')}</div>
            ${task.equipCode ? `<div class="text-[11px] text-slate-500 mt-1">${esc(task.equipCode)}</div>` : ''}
            ${task.description ? `<div class="text-xs text-slate-500 mt-2 leading-relaxed">${esc(task.description)}</div>` : ''}
            <div class="flex items-center gap-2 flex-wrap mt-3">
              ${badge}
              ${canComplete ? `<button type="button" onclick="openCompleteModal('${task.id}')" class="bg-primary-600 hover:bg-primary-500 text-white text-xs font-medium px-3 py-1.5 rounded-lg transition">Выполнить</button>` : ''}
            </div>
          </div>
        </div>
      </div>`;
    }).join('');
  }

  function showCalendarPage() {
    document.querySelectorAll('.page').forEach(page => page.classList.add('hidden'));
    document.getElementById('page-calendar')?.classList.remove('hidden');
    document.querySelectorAll('.nav-btn').forEach(btn => {
      const active = btn.dataset.page === 'calendar';
      btn.classList.toggle('border-primary-500', active);
      btn.classList.toggle('text-primary-400', active);
      btn.classList.toggle('border-transparent', !active);
      btn.classList.toggle('text-slate-400', !active);
    });
    renderCalendar();
  }

  injectCalendarUI();

  const originalShowPage = window.showPage;
  if (typeof originalShowPage === 'function') {
    window.showPage = function (page) {
      if (page === 'calendar') {
        showCalendarPage();
        return;
      }
      return originalShowPage(page);
    };
  }

  window.renderCalendar = renderCalendar;
})();
