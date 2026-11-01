// Read-only department exports. No task, membership, payment or Auth state is changed.
(function (root) {
  'use strict';
  const mime = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  const normalize = value => String(value || '').trim().replace(/\s+/g, ' ').toLocaleLowerCase('ru-RU');
  const day = value => value ? String(value).slice(0, 10) : '';
  const date = value => /^\d{4}-\d{2}-\d{2}$/.test(day(value)) ? new Date(day(value) + 'T00:00:00Z') : null;
  const number = value => value == null ? null : Number(value);
  let exporting = false, libraryPromise = null;

  function buildData({company, department, profiles, equipment, tasks, completions, oneTimeTasks, asOf, generatedAt}) {
    const scoped = rows => rows.filter(row => row.company_id === company.id && row.department_id === department.id);
    const people = profiles.filter(p => p.company_id === company.id);
    const person = id => people.find(p => p.id === id);
    const names = new Map();
    for (const p of people) { const key = normalize(p.name); names.set(key, [...(names.get(key) || []), p]); }
    const groups = new Map();
    function account(id) {
      const p = person(id);
      return {key: 'user:' + id, name: p?.name || 'Сотрудник отсутствует в списке', basis: p ? 'Учётная запись сотрудника' : 'Сохранённое назначение / автор отчёта'};
    }
    function executor(name, authorId) {
      if (!normalize(name)) return authorId ? account(authorId) : {key: 'unknown-executor', name: 'Исполнитель не сохранён', basis: 'Выполнение без данных фотоотчёта'};
      const matches = names.get(normalize(name)) || [];
      if (matches.length === 1) return account(matches[0].id);
      return {key: 'name:' + normalize(name), name: String(name).trim(), basis: 'Имя из результата задачи, без подтверждённой привязки к аккаунту'};
    }
    function unassigned() { return {key: 'unassigned', name: 'Без персонального назначения', basis: 'Общая задача подразделения'}; }
    function group(identity) {
      if (!groups.has(identity.key)) groups.set(identity.key, {...identity, done: 0, pending: 0, blocked: 0});
      return groups.get(identity.key);
    }
    for (const p of people.filter(p => p.department_id === department.id && p.role !== 'manager')) group(account(p.id));
    const done = [], pending = [];
    const reports = new Map();
    for (const c of [...scoped(completions)].sort((a, b) => String(a.created_at || a.date).localeCompare(String(b.created_at || b.date)))) reports.set(c.task_id || 'legacy:' + c.id, c);
    const consumed = new Set();
    function addDone(item, identity) { group(identity).done++; done.push({...item, executor: identity.name, key: identity.key}); }
    function addPending(item, identity) { const g = group(identity); g.pending++; if (item.status === 'Не выполнено') g.blocked++; pending.push({...item, executor: identity.name, key: identity.key}); }
    function maintenance(t, c) {
      const e = scoped(equipment).find(e => e.id === (c?.equipment_id || t?.equipment_id));
      return {id: t?.id || c?.task_id || c?.id, type: 'ТО', title: c?.title || t?.title || '', equipment: c?.equip_name || t?.equip_name || e?.name || '', code: t?.equip_code || e?.code || '', due: t?.date || '', threshold: number(t?.due_engine_hours)};
    }
    for (const t of scoped(tasks)) {
      const c = reports.get(t.id);
      if (c || t.status === 'done') {
        if (c) consumed.add(c.id);
        addDone({...maintenance(t, c), completed: c?.date || '', author: person(c?.user_id)?.name || '', comment: c?.comment || (c ? '' : 'Дата и исполнитель фотоотчёта не сохранены'), hours: number(c?.engine_hours)}, executor(c?.worker_name, c?.user_id));
      } else if (t.date <= asOf) {
        addPending({...maintenance(t), status: t.status === 'blocked' ? 'Не выполнено' : 'Ожидает', overdue: Math.max(0, Math.floor((date(asOf) - date(t.date)) / 86400000)), comment: t.blocked_comment || '', reporter: t.blocked_worker_name || ''}, t.assigned_user_id ? account(t.assigned_user_id) : normalize(t.blocked_worker_name) ? executor(t.blocked_worker_name) : unassigned());
      }
    }
    for (const c of reports.values()) if (!consumed.has(c.id)) {
      addDone({...maintenance(null, c), completed: c.date, author: person(c.user_id)?.name || '', comment: c.comment || '', hours: number(c.engine_hours)}, executor(c.worker_name, c.user_id));
    }
    for (const t of scoped(oneTimeTasks)) {
      const base = {id: t.id, type: 'Разовая', title: t.description, equipment: '', code: '', due: t.due_date, threshold: null};
      if (t.status === 'done') addDone({...base, completed: day(t.completed_at), author: person(t.assigned_user_id)?.name || '', comment: t.report_comment || '', hours: null}, account(t.assigned_user_id));
      else if (t.due_date <= asOf) addPending({...base, status: 'Ожидает', overdue: Math.max(0, Math.floor((date(asOf) - date(t.due_date)) / 86400000)), comment: t.report_comment || '', reporter: ''}, account(t.assigned_user_id));
    }
    done.sort((a, b) => b.completed.localeCompare(a.completed) || a.id.localeCompare(b.id));
    pending.sort((a, b) => a.due.localeCompare(b.due) || a.id.localeCompare(b.id));
    const summary = [...groups.values()].sort((a, b) => b.done - a.done || a.name.localeCompare(b.name, 'ru'));
    return {company, department, asOf, generatedAt, done, pending, summary};
  }

  function workbook(data, ExcelJS) {
    const book = new ExcelJS.Workbook();
    book.creator = 'Check App'; book.created = new Date(data.generatedAt); book.calcProperties.fullCalcOnLoad = true;
    const created = new Date(data.generatedAt).toLocaleString('ru-RU', {timeZone: 'Europe/Moscow'});
    const sheets = {};
    function sheet(name, headers, widths, note) {
      const ws = book.addWorksheet(name, {views: [{state: 'frozen', ySplit: 7}], properties: {defaultRowHeight: 22}});
      ws.columns = widths.map(width => ({width}));
      const visible = name === 'Сводка' ? 6 : 13;
      for (let row = 1; row <= 5; row++) ws.mergeCells(row, 1, row, visible);
      ws.getCell('A1').value = name === 'Сводка' ? 'Выполнение задач подразделения' : name + ' задачи';
      ws.getCell('A1').font = {name: 'Calibri', size: 18, bold: true, color: {argb: 'FF172438'}};
      ws.getRow(1).height = 32;
      ws.getCell('A2').value = data.company.name;
      ws.getCell('A3').value = 'Подразделение: ' + data.department.name;
      ws.getCell('A4').value = 'Сформировано: ' + created + ' МСК. Данные за всё время.';
      ws.getCell('A5').value = note;
      ws.getCell('A5').alignment = {wrapText: true, vertical: 'top'}; ws.getRow(5).height = 34;
      headers.forEach((value, i) => { const cell = ws.getCell(7, i + 1); cell.value = value; cell.font = {name: 'Calibri', size: 11, bold: true, color: {argb: 'FFFFFFFF'}}; cell.fill = {type: 'pattern', pattern: 'solid', fgColor: {argb: 'FF253754'}}; cell.alignment = {wrapText: true, vertical: 'middle'}; });
      ws.getRow(7).height = 42;
      ws.autoFilter = {from: {row: 7, column: 1}, to: {row: 7, column: visible}};
      return ws;
    }
    sheets.summary = sheet('Сводка', ['Сотрудник / исполнитель', 'Основание учёта', 'Выполнено', 'Не выполнено', 'Из них отмечено «Не выполнено»', 'Всего', 'Ключ'], [33, 57, 17, 18, 27, 16, 10], 'Невыполненные — открытые задачи, включая «Ожидает». Указанные вручную имена без однозначного совпадения с аккаунтом учитываются отдельно.');
    sheets.done = sheet('Выполненные', ['№', 'Тип', 'Задача', 'Оборудование', 'Код', 'Плановый срок', 'Дата выполнения', 'Фактический исполнитель', 'Отчёт отправил', 'Комментарий', 'Порог ТО, м·ч', 'Наработка при выполнении, м·ч', 'Идентификатор задачи', 'Ключ'], [7, 13, 48, 30, 16, 18, 19, 28, 28, 48, 18, 23, 39, 10], 'Исполнитель берётся из фотоотчёта. Учётная запись отправителя указана отдельно.');
    sheets.pending = sheet('Невыполненные', ['№', 'Тип', 'Задача', 'Оборудование', 'Код', 'Плановый срок', 'Статус', 'Ответственный', 'Просрочка, дней', 'Причина / комментарий', 'Сообщил о невыполнении', 'Порог ТО, м·ч', 'Идентификатор задачи', 'Ключ'], [7, 13, 48, 30, 16, 18, 19, 28, 18, 48, 28, 20, 39, 10], 'Открытые задачи со сроком по ' + data.asOf + '. Будущие задачи не включены. Задачи без назначения и имени исполнителя учитываются отдельно.');
    data.done.forEach((r, i) => sheets.done.addRow([i + 1, r.type, r.title, r.equipment, r.code, date(r.due), date(r.completed), r.executor, r.author, r.comment, r.threshold, r.hours, r.id, r.key]));
    data.pending.forEach((r, i) => sheets.pending.addRow([i + 1, r.type, r.title, r.equipment, r.code, date(r.due), r.status, r.executor, r.overdue, r.comment, r.reporter, r.threshold, r.id, r.key]));

    const doneEnd = Math.max(8, 7 + data.done.length), pendingEnd = Math.max(8, 7 + data.pending.length);
    data.summary.forEach((r, i) => {
      const row = i + 8;
      sheets.summary.addRow([r.name, r.basis,
        {formula: `COUNTIF('Выполненные'!$N$8:$N$${doneEnd},$G${row})`, result: r.done},
        {formula: `COUNTIF('Невыполненные'!$N$8:$N$${pendingEnd},$G${row})`, result: r.pending},
        {formula: `COUNTIFS('Невыполненные'!$N$8:$N$${pendingEnd},$G${row},'Невыполненные'!$G$8:$G$${pendingEnd},"Не выполнено")`, result: r.blocked},
        {formula: `SUM(C${row}:D${row})`, result: r.done + r.pending}, r.key]);
    });
    const totalRow = sheets.summary.addRow(['Итого', '', ...['done', 'pending', 'blocked'].map((key, i) => ({formula: data.summary.length ? `SUM(${String.fromCharCode(67 + i)}8:${String.fromCharCode(67 + i)}${7 + data.summary.length})` : '0', result: data.summary.reduce((sum, r) => sum + r[key], 0)})), {formula: data.summary.length ? `SUM(F8:F${7 + data.summary.length})` : '0', result: data.done.length + data.pending.length}]);
    totalRow.font = {bold: true, color: {argb: 'FF253754'}};
    for (const ws of Object.values(sheets)) {
      ws.eachRow((row, index) => {
        if (index < 8) return;
        let lines = 1; row.eachCell((cell, column) => { if (typeof cell.value === 'string') lines = Math.max(lines, Math.ceil(cell.value.length / Math.max(8, ws.getColumn(column).width - 2))); });
        row.height = Math.min(409, Math.max(30, lines * 15));
        row.eachCell(cell => { cell.alignment = {vertical: 'top', wrapText: true}; if (!cell.font?.bold) cell.font = {name: 'Calibri', size: 11, color: {argb: 'FF172438'}}; if (index % 2 === 0) cell.fill = {type: 'pattern', pattern: 'solid', fgColor: {argb: 'FFF4F6FB'}}; });
      });
      ws.autoFilter = {from: {row: 7, column: 1}, to: {row: Math.max(7, ws.rowCount - (ws === sheets.summary ? 1 : 0)), column: ws === sheets.summary ? 6 : 13}};
      ws.pageSetup = {orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9};
    }
    for (const ws of [sheets.done, sheets.pending]) { ws.getColumn(6).numFmt = 'dd.mm.yyyy'; ws.getColumn(14).hidden = true; }
    sheets.done.getColumn(7).numFmt = 'dd.mm.yyyy'; sheets.done.getColumn(11).numFmt = '#,##0.0'; sheets.done.getColumn(12).numFmt = '#,##0.0'; sheets.pending.getColumn(12).numFmt = '#,##0.0'; sheets.summary.getColumn(7).hidden = true;
    for (let i = 3; i <= 6; i++) sheets.summary.getColumn(i).numFmt = '#,##0';
    return book;
  }

  async function readAll(client, table, companyId, departmentId) {
    const rows = []; let cursor = null, total = null;
    for (;;) {
      let query = client.from(table).select('*', cursor ? {} : {count: 'exact'}).eq('company_id', companyId);
      if (departmentId) query = query.eq('department_id', departmentId);
      if (cursor) query = query.gt('id', cursor);
      const {data, error, count} = await query.order('id').range(0, 499);
      if (error) throw error;
      if (!Array.isArray(data)) throw new Error('Сервер вернул некорректные данные отчёта');
      if (total == null && typeof count === 'number') total = count;
      if (!data.length) {
        if (total != null && rows.length < total) throw new Error('Данные изменились во время выгрузки. Повторите скачивание.');
        return rows;
      }
      if (data.at(-1).id === cursor) throw new Error('Не удалось продолжить загрузку отчёта');
      rows.push(...data); cursor = data.at(-1).id;
      if (total != null && rows.length >= total) return rows;
    }
  }

  function loadLibrary() {
    if (root.ExcelJS) return Promise.resolve(root.ExcelJS);
    if (!libraryPromise) libraryPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script'); script.src = 'js/exceljs.min.js?v=4.4.0';
      script.onload = () => root.ExcelJS ? resolve(root.ExcelJS) : reject(new Error('Не загрузился модуль Excel'));
      script.onerror = () => { script.remove(); reject(new Error('Не удалось загрузить модуль Excel. Проверьте интернет и повторите.')); };
      document.head.appendChild(script);
    }).catch(error => { libraryPromise = null; throw error; });
    return libraryPromise;
  }
  async function saveFile(buffer, filename) {
    if (root.Capacitor?.isNativePlatform?.()) {
      const plugin = name => root.Capacitor.Plugins?.[name] || root.Capacitor.registerPlugin?.(name);
      const filesystem = plugin('Filesystem'), share = plugin('Share');
      if (!filesystem || !share) throw new Error('Для сохранения Excel установите последнюю версию APK');
      const bytes = new Uint8Array(buffer); let binary = '';
      for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
      const {uri} = await filesystem.writeFile({path: 'reports/' + Date.now() + '-' + filename, data: btoa(binary), directory: 'CACHE', recursive: true});
      await share.share({title: 'Отчёт Check App', dialogTitle: 'Сохранить отчёт Excel', files: [uri]});
      return 'Файл Excel передан в меню сохранения.';
    }
    const url = URL.createObjectURL(new Blob([buffer], {type: mime}));
    const link = document.createElement('a'); link.href = url; link.download = filename; document.body.appendChild(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    return 'Файл Excel передан для скачивания.';
  }
  root.checkRenderReportExport = function () {
    if (exporting) return;
    const user = getUser(), company = getCompany(), select = document.getElementById('report-export-department');
    const allowed = company.departments.filter(d => user.role === 'manager' || (user.role === 'responsible' && d.id === user.departmentId));
    select.replaceChildren(...allowed.map(d => new Option(d.name, d.id)));
    if (allowed.some(d => d.id === getActiveDeptId())) select.value = getActiveDeptId();
    select.disabled = allowed.length < 2;
    document.getElementById('report-export-button').disabled = !allowed.length;
  };
  root.checkDownloadReport = async function () {
    if (exporting) return;
    const company = getCompany(), user = getUser(), select = document.getElementById('report-export-department');
    const department = company.departments.find(d => d.id === select.value);
    const status = document.getElementById('report-export-status'), button = document.getElementById('report-export-button');
    if (!department || !['manager', 'responsible'].includes(user?.role) || (user.role === 'responsible' && department.id !== user.departmentId)) { status.textContent = 'Нет доступа к выбранному подразделению'; return; }
    exporting = true; button.disabled = select.disabled = true; button.setAttribute('aria-busy', 'true'); status.textContent = 'Загружаем задачи подразделения…';
    const sessionIsCurrent = () => getUser()?.id === user.id && getCompany()?.id === company.id;
    try {
      const [tasks, completions, oneTimeTasks, profiles, equipment] = await Promise.all([
        ...['tasks', 'completions', 'one_time_tasks'].map(table => readAll(supabaseClient, table, company.id, department.id)),
        readAll(supabaseClient, 'profiles', company.id), readAll(supabaseClient, 'equipment', company.id, department.id)
      ]);
      if (!sessionIsCurrent()) throw new Error('Аккаунт изменился. Повторите выгрузку после входа.');
      status.textContent = 'Формируем Excel…';
      const data = buildData({company, department, tasks, completions, oneTimeTasks, profiles, equipment, asOf: todayStr(), generatedAt: new Date().toISOString()});
      const book = workbook(data, await loadLibrary());
      const buffer = await book.xlsx.writeBuffer();
      if (!sessionIsCurrent()) throw new Error('Аккаунт изменился. Повторите выгрузку после входа.');
      const name = department.name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-').slice(0, 70).replace(/[. ]+$/g, '') || 'Подразделение';
      status.textContent = await saveFile(buffer, 'Отчёт_' + name + '_' + data.asOf + '.xlsx');
    } catch (error) {
      status.textContent = /cancel|отмен/i.test(error.message || '') ? 'Сохранение отменено. Можно скачать отчёт повторно.' : 'Отчёт не скачан: ' + (error.message || 'Проверьте интернет и повторите.');
    } finally {
      exporting = false; button.setAttribute('aria-busy', 'false'); checkRenderReportExport();
      if (department) select.value = department.id;
    }
  };
  root.CheckReportExport = {buildData, workbook, readAll, saveFile};
})(typeof window === 'undefined' ? globalThis : window);
