import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile, mkdir} from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
const require = createRequire(import.meta.url), ExcelJS = require('exceljs');
let chromium;
try { ({chromium} = require('playwright')); } catch { ({chromium} = require(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES + '/playwright')); }
const root = path.resolve('dist-mobile');
const html = (await readFile('app/index.html', 'utf8')).replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, s => s.includes('js/theme.js') ? s : '');
const server = http.createServer(async (req, res) => {
  try {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    if (pathname === '/app/') { res.setHeader('Content-Type', 'text/html'); res.end(html); return; }
    const file = path.resolve(root, '.' + pathname);
    if (!file.startsWith(root + path.sep)) throw Error();
    res.setHeader('Content-Type', file.endsWith('.css') ? 'text/css' : 'text/javascript'); res.end(await readFile(file));
  } catch { res.writeHead(404); res.end(); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const browser = await chromium.launch({headless: true, executablePath: process.env.CHROMIUM_EXECUTABLE, args: ['--no-sandbox', '--disable-dev-shm-usage']});
try {
  const page = await browser.newPage({viewport: {width: 390, height: 844}, acceptDownloads: true}), errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.route('https://fonts.googleapis.com/**', r => r.abort());
  await page.goto('http://127.0.0.1:' + server.address().port + '/app/');
  await page.evaluate(() => {
    const today = new Date().toISOString().slice(0, 10);
    window.reportRequests = [];
    window.reportRows = {
      companies: {id: 'c', name: 'Компания'}, departments: [{id: 'd1', company_id: 'c', name: 'Первое подразделение'}, {id: 'd2', company_id: 'c', name: 'Второе подразделение'}, {id: 'empty', company_id: 'c', name: 'Пустое подразделение'}],
      profiles: [{id: 'owner', company_id: 'c', department_id: null, name: 'Руководитель', role: 'manager'}, {id: 'worker', company_id: 'c', department_id: 'd1', name: 'Иван', role: 'employee'}, {id: 'worker2', company_id: 'c', department_id: 'd2', name: 'Павел', role: 'employee'}],
      equipment: [{id: 'e1', company_id: 'c', department_id: 'd1', name: 'Первый станок', code: '0012'}, {id: 'e2', company_id: 'c', department_id: 'd2', name: 'Второй станок'}],
      tasks: [{id: 't1', company_id: 'c', department_id: 'd1', equipment_id: 'e1', date: today, title: 'Выполненное ТО', status: 'done'}, {id: 't2', company_id: 'c', department_id: 'd1', equipment_id: 'e1', date: today, title: 'Общее открытое ТО', status: 'pending'}],
      completions: [{id: 'r1', company_id: 'c', department_id: 'd1', task_id: 't1', equipment_id: 'e1', title: 'Выполненное ТО', date: today, user_id: 'owner', worker_name: 'Иван'}], maintenance_actions: [],
      subscriptions: {plan_id: 'standard', expires_at: '2099-01-01'}, consumable_requests: [],
      one_time_tasks: [...Array.from({length: 501}, (_, i) => ({id: String(i).padStart(4, '0'), company_id: 'c', department_id: 'd1', assigned_user_id: 'worker', description: 'Разовая работа ' + i, due_date: today, status: 'pending'})), {id: 'other', company_id: 'c', department_id: 'd2', assigned_user_id: 'worker2', description: 'Задача второго подразделения', due_date: today, status: 'pending'}]
    };
    const from = table => {
      const filters = []; let cursor = null;
      const selected = () => Array.isArray(reportRows[table]) ? reportRows[table].filter(row => filters.every(([key, value]) => row[key] === value) && (!cursor || row.id > cursor)) : reportRows[table];
      const q = {select() { return q; }, eq(key, value) { filters.push([key, value]); return q; }, order() { return q; }, gt(key, value) { cursor = value; return q; }, limit() { return q; },
        maybeSingle: async () => ({data: table === 'profiles' ? reportRows.profiles[0] : selected()}), single: async () => ({data: selected()}), then(resolve) { return Promise.resolve({data: selected() || []}).then(resolve); },
        async range(start, end) {
          reportRequests.push({table, filters: [...filters], start, end});
          if (window.reportHold && table === 'tasks') await new Promise(resolve => { window.releaseReport = resolve; });
          if (window.reportFailure && table === 'completions') return {error: {message: 'Нет соединения'}};
          return {data: selected().slice(start, end + 1), count: selected().length};
        }
      }; return q;
    };
    window.supabase = {createClient: () => ({auth: {getSession: async () => ({data: {session: null}}), getUser: async () => ({data: {user: {id: 'owner', email: 'owner@test.invalid'}}}), onAuthStateChange: () => ({}), signOut: async () => ({})}, from,
      rpc: async name => ({data: name === 'get_current_work_limits' ? {max_departments: 3, max_equipment: 25, work_active: true, active_department_ids: ['d1', 'd2', 'empty'], active_equipment_ids: ['e1', 'e2']} : name === 'is_super_admin' || name === 'current_company_is_unlimited' ? false : 0}), functions: {invoke: async () => ({data: {data: []}})}
    })};
  });
  for (const file of ['js/photo-attachments.js', 'js/consumables.js', 'js/team.js', 'js/interface.js', 'js/engine-hours.js', 'js/report-export.js', 'js/app.js', 'js/calendar-core.js']) await page.addScriptTag({path: file});
  await page.evaluate(async () => { await hydrateCurrentUser(); enterApp(); showPage('reports'); });
  assert.equal(await page.locator('#report-export-department').inputValue(), 'd1');
  const firstDownload = page.waitForEvent('download'); await page.locator('#report-export-button').click();
  const first = await firstDownload; assert.match(first.suggestedFilename(), /Первое подразделение.*\.xlsx$/);
  const book = new ExcelJS.Workbook(); await book.xlsx.readFile(await first.path());
  const summary = book.getWorksheet('Сводка'), last = summary.lastRow;
  assert.equal(last.getCell(3).result, 1); assert.equal(last.getCell(4).result, 502);
  assert.equal(book.getWorksheet('Невыполненные').rowCount, 509);
  assert.equal(await page.evaluate(() => reportRequests.filter(r => r.table === 'one_time_tasks').length), 2);
  await page.locator('#report-export-department').selectOption('d2');
  const otherDownload = page.waitForEvent('download'); await page.locator('#report-export-button').click();
  const other = await otherDownload, second = new ExcelJS.Workbook(); await second.xlsx.readFile(await other.path());
  assert.match(other.suggestedFilename(), /Второе подразделение/); assert.equal(second.getWorksheet('Сводка').lastRow.getCell(4).result, 1);
  assert.equal(second.getWorksheet('Выполненные').rowCount, 7);
  assert.equal(second.getWorksheet('Невыполненные').getCell('C8').value, 'Задача второго подразделения');
  await page.evaluate(() => { reportFailure = true; }); await page.locator('#report-export-button').click();
  await page.waitForFunction(() => document.getElementById('report-export-status').textContent.includes('Нет соединения'));
  assert.equal(await page.locator('#report-export-department').inputValue(), 'd2');
  assert.equal(await page.locator('#report-export-button').isDisabled(), false);
  await page.evaluate(() => { reportFailure = false; reportHold = true; });
  const pendingDownload = page.waitForEvent('download'); await page.locator('#report-export-button').click();
  await page.waitForFunction(() => typeof releaseReport === 'function');
  assert.equal(await page.locator('#report-export-button').isDisabled(), true);
  const calls = await page.evaluate(() => reportRequests.length); await page.evaluate(() => checkDownloadReport()); assert.equal(await page.evaluate(() => reportRequests.length), calls);
  await page.evaluate(() => { reportHold = false; releaseReport(); }); await pendingDownload;
  await page.waitForFunction(() => !document.getElementById('report-export-button').disabled);
  await page.locator('#report-export-department').selectOption('empty');
  const emptyDownload = page.waitForEvent('download'); await page.locator('#report-export-button').click();
  const empty = new ExcelJS.Workbook(); await empty.xlsx.readFile(await (await emptyDownload).path());
  assert.equal(empty.getWorksheet('Сводка').lastRow.getCell(3).result, 0); assert.equal(empty.getWorksheet('Сводка').lastRow.getCell(4).result, 0);
  await mkdir('/tmp/check-app-report-export', {recursive: true});
  for (const width of [320, 390, 1440]) {
    await page.setViewportSize({width, height: 844});
    for (const theme of ['light', 'dark']) {
      await page.evaluate(theme => { document.documentElement.dataset.theme = theme; }, theme);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      await page.evaluate(() => scrollTo(0, 0));
      if (width === 390) await page.screenshot({path: '/tmp/check-app-report-export/' + theme + '-report-screen.png'});
    }
  }
  await page.evaluate(() => { getUser().role = 'responsible'; getUser().departmentId = 'd1'; showPage('reports'); });
  assert.equal(await page.locator('#report-export-department option').count(), 1);
  assert.equal(await page.locator('#report-export-department').isDisabled(), true);
  await page.evaluate(() => { getUser().role = 'employee'; });
  const before = await page.evaluate(() => reportRequests.length); await page.evaluate(() => checkDownloadReport());
  assert.equal(await page.evaluate(() => reportRequests.length), before); assert.match(await page.locator('#report-export-status').textContent(), /Нет доступа/);
  assert.deepEqual(errors, []);
  console.log('PASS: actual browser XLSX downloads and totals, department isolation, 501-row pagination, lazy local library, empty/error/retry/busy/double-click, manager/lead/employee scope, 320/390/1440px and both themes (mocked Auth/API)');
} finally { await browser.close(); server.close(); }
