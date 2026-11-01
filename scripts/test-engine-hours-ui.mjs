import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile, mkdir} from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
const require = createRequire(import.meta.url);
let chromium;
try { ({chromium} = require('playwright')); } catch { ({chromium} = require(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES + '/playwright')); }
const root = process.cwd();
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
  const page = await browser.newPage({viewport: {width: 390, height: 844}}), errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.route('https://fonts.googleapis.com/**', r => r.abort());
  await page.goto('http://127.0.0.1:' + server.address().port + '/app/');
  await page.evaluate(() => {
    const today = new Date().toISOString().slice(0, 10);
    window.hourCalls = [];
    window.hourRows = {
      companies: {id: 'company', name: 'Тест моточасов'},
      profiles: [{id: 'owner', company_id: 'company', department_id: null, name: 'Дмитрий', role: 'manager'}],
      departments: [{id: 'dep', name: 'Основное'}, {id: 'dep2', name: 'Второе подразделение'}],
      equipment: [{id: 'machine', name: 'Компрессор с длинным названием', code: 'C-01', department_id: 'dep', engine_hours: 3560}, {id: 'machine2', name: 'Станок второго подразделения', department_id: 'dep2', engine_hours: 100}],
      maintenance_actions: [{id: 'hours', name: 'Замена масла', equipment_id: 'machine', department_id: 'dep', frequency: 1, schedule_type: 'hours', hours_interval: 2000, next_due_hours: 4000}, {id: 'days', name: 'Осмотр по дням', equipment_id: 'machine', department_id: 'dep', frequency: 7}],
      tasks: [], completions: [], subscriptions: {plan_id: 'standard', expires_at: '2099-01-01'}, consumable_requests: []
    };
    const from = table => {
      let pending;
      const builder = {
        select() { return builder; }, eq() { return builder; }, order() { return builder; }, limit() { return builder; },
        insert(row) { pending = row; return builder; },
        maybeSingle: async () => ({data: table === 'profiles' ? hourRows.profiles[0] : hourRows[table]}),
        single: async () => ({data: hourRows[table]}),
        then(resolve) {
          if (pending) {
            hourCalls.push({insert: table, row: pending});
            if (pending.schedule_type === 'hours') {
              const equipment = hourRows.equipment.find(e => e.id === pending.equipment_id);
              pending.next_due_hours = Math.max(pending.hours_interval, Math.ceil(equipment.engine_hours / pending.hours_interval) * pending.hours_interval);
            }
            hourRows[table].push(pending);
          }
          return Promise.resolve({data: hourRows[table] || []}).then(resolve);
        }
      };
      return builder;
    };
    window.supabase = {createClient: () => ({auth: {getSession: async () => ({data: {session: null}}), getUser: async () => ({data: {user: {id: 'owner', email: 'owner@test.invalid'}}}), onAuthStateChange: () => ({}), signOut: async () => ({})}, from,
      rpc: async (name, params) => {
        if (name === 'record_equipment_hours') {
          hourCalls.push({rpc: name, params});
          if (window.hourHold) await new Promise(resolve => { window.hourRelease = resolve; });
          if (window.hourFailure) return {error: window.hourFailure};
          const equipment = hourRows.equipment.find(e => e.id === params.p_equipment_id);
          equipment.engine_hours = params.p_hours;
          for (const action of hourRows.maintenance_actions.filter(a => a.equipment_id === equipment.id && a.schedule_type === 'hours' && a.next_due_hours <= params.p_hours)) {
            if (!hourRows.tasks.some(t => t.action_id === action.id && t.status !== 'done')) hourRows.tasks.push({id: 'task-' + action.id, action_id: action.id, equipment_id: equipment.id, department_id: equipment.department_id, date: today, status: 'pending', title: action.name, equip_name: equipment.name, due_engine_hours: action.next_due_hours});
          }
          return {data: {...equipment}};
        }
        return {data: name === 'get_current_work_limits' ? {max_departments: 3, max_equipment: 25, work_active: true, active_department_ids: ['dep', 'dep2'], active_equipment_ids: ['machine', 'machine2']} : name === 'is_super_admin' || name === 'current_company_is_unlimited' ? false : 0};
      }, functions: {invoke: async () => ({data: {data: []}})}
    })};
  });
  for (const file of ['js/photo-attachments.js', 'js/consumables.js', 'js/team.js', 'js/interface.js', 'js/engine-hours.js', 'js/app.js', 'js/calendar-core.js']) await page.addScriptTag({path: file});
  await page.evaluate(async () => { await hydrateCurrentUser(); enterApp(); showPage('actions'); });
  assert.match(await page.locator('#actions-list').textContent(), /440/);
  assert.match(await page.locator('#actions-list').textContent(), /4\s?000/);
  await page.evaluate(() => openActionModal());
  await page.locator('#action-name').fill('Новое ТО');
  await page.locator('#action-schedule-type').selectOption('hours');
  assert.match(await page.locator('#action-hours-preview').textContent(), /440/);
  await page.locator('#action-hours-interval').fill('0'); await page.locator('#action-save').click();
  assert.match(await page.locator('#action-schedule-status').textContent(), /больше нуля/);
  assert.equal(await page.evaluate(() => hourCalls.filter(c => c.insert).length), 0);
  await page.locator('#action-hours-interval').fill('2000'); await page.locator('#action-save').click();
  await page.waitForFunction(() => document.getElementById('modal-action').classList.contains('hidden'));
  assert.equal(await page.evaluate(() => hourCalls.filter(c => c.insert).length), 1);
  await page.evaluate(() => showPage('today'));
  await page.locator('#today-hours-open').click();
  assert.equal(await page.evaluate(() => document.activeElement.id), 'hours-value');
  await page.locator('#hours-value').fill('3559'); await page.locator('#hours-save').click();
  assert.match(await page.locator('#hours-status').textContent(), /меньше/);
  assert.equal(await page.locator('#hours-value').getAttribute('aria-invalid'), 'true');
  assert.equal(await page.evaluate(() => hourCalls.filter(c => c.rpc).length), 0);
  await page.locator('#hours-value').fill('3999,9'); await page.locator('#hours-save').click();
  await page.waitForFunction(() => !document.getElementById('hours-dialog').open);
  assert.equal(await page.locator('#today-list [data-maintenance-task]').count(), 0);
  assert.equal(await page.evaluate(() => document.activeElement.id), 'today-hours-open');
  await page.locator('#today-hours-open').click();
  await page.locator('#hours-value').fill('4000');
  await page.evaluate(() => { window.hourFailure = {message: 'Нет соединения'}; });
  await page.locator('#hours-save').click();
  await page.waitForFunction(() => document.getElementById('hours-status').textContent === 'Нет соединения');
  assert.equal(await page.locator('#hours-value').inputValue(), '4000');
  await page.evaluate(() => { window.hourFailure = null; window.hourHold = true; });
  await page.locator('#hours-save').click();
  await page.waitForFunction(() => typeof hourRelease === 'function');
  assert.equal(await page.locator('#hours-save').isDisabled(), true);
  await page.keyboard.press('Escape'); assert.equal(await page.locator('#hours-dialog').evaluate(e => e.open), true);
  const calls = await page.evaluate(() => hourCalls.filter(c => c.rpc).length);
  await page.evaluate(() => checkSaveHours()); assert.equal(await page.evaluate(() => hourCalls.filter(c => c.rpc).length), calls);
  await page.evaluate(() => { hourRelease(); hourHold = false; });
  await page.waitForFunction(() => !document.getElementById('hours-dialog').open);
  assert.match(await page.locator('#today-list').textContent(), /ТО на 4\s?000 м·ч/);
  await page.locator('#today-list [data-maintenance-task]').first().click();
  assert.equal(await page.locator('#modal-complete').isVisible(), true);
  await page.evaluate(() => closeCompleteModal());
  // A manager's selected department must survive hydration after a reading.
  await page.evaluate(() => { onDeptChange('dep2'); showPage('today'); });
  await page.locator('#today-hours-open').click();
  assert.equal(await page.locator('#hours-equipment option').count(), 1);
  await page.locator('#hours-value').fill('101'); await page.locator('#hours-save').click();
  await page.waitForFunction(() => !document.getElementById('hours-dialog').open);
  assert.equal(await page.evaluate(() => getActiveDeptId()), 'dep2');
  // Employees retain their scope and can enter readings without gaining equipment management.
  await page.evaluate(() => { hourRows.profiles[0].role = 'employee'; hourRows.profiles[0].department_id = 'dep'; });
  await page.evaluate(async () => { await hydrateCurrentUser(); enterApp(); });
  await page.locator('#today-hours-open').click();
  assert.equal(await page.locator('#hours-equipment option').count(), 1);
  await page.locator('#hours-value').fill('4001'); await page.locator('#hours-save').click();
  await page.waitForFunction(() => !document.getElementById('hours-dialog').open);
  assert.equal(await page.evaluate(() => getUser().role), 'employee');
  await page.evaluate(() => showPage('equipment'));
  assert.equal(await page.locator('#page-equipment').isVisible(), false);
  await mkdir('/tmp/check-app-engine-hours', {recursive: true});
  for (const width of [320, 390, 1440]) {
    await page.setViewportSize({width, height: 844});
    for (const theme of ['dark', 'light']) {
      await page.evaluate(theme => { document.documentElement.dataset.theme = theme; showPage('today'); }, theme);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      await page.locator('#today-hours-open').click();
      await page.locator('#hours-value').fill('4010');
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      if (width === 390) await page.screenshot({path: '/tmp/check-app-engine-hours/' + theme + '-reading.png'});
      await page.keyboard.press('Escape'); assert.equal(await page.locator('#hours-dialog').evaluate(e => e.open), false);
      if (width === 390) await page.screenshot({path: '/tmp/check-app-engine-hours/' + theme + '-today.png'});
    }
  }
  assert.deepEqual(errors, []);
  console.log('PASS: hours UI preview/creation, employee input, threshold task, unchanged photo dialog, department scope, validation/error/retry/busy/deduplication/Escape/focus; 320/390/1440px and both themes (mocked API)');
} finally { await browser.close(); server.close(); }
