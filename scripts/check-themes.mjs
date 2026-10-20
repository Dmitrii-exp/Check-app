import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile} from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
const require=createRequire(import.meta.url);let chromium;try{({chromium}=require('playwright'));}catch{({chromium}=require(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES+'/playwright'));}
const root=process.cwd();const html=(await readFile('app/index.html','utf8')).replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,s=>s.includes('js/theme.js')?s:'');
const server=http.createServer(async(req,res)=>{try{const name=new URL(req.url,'http://localhost').pathname;if(name==='/app/'){res.setHeader('Content-Type','text/html');res.end(html);return;}const file=path.resolve(root,'.'+name);if(!file.startsWith(root+path.sep))throw Error();res.setHeader('Content-Type',file.endsWith('.css')?'text/css':file.endsWith('.js')?'text/javascript':'application/octet-stream');res.end(await readFile(file));}catch{res.writeHead(404);res.end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const url='http://127.0.0.1:'+server.address().port+'/app/';let browser;
try{
 browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_EXECUTABLE,args:['--no-sandbox','--disable-dev-shm-usage']});
 const context=await browser.newContext({viewport:{width:390,height:844}});const page=await context.newPage();await page.emulateMedia({reducedMotion:'reduce'});const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.route('https://fonts.googleapis.com/**',r=>r.abort());await page.goto(url);
 assert.equal(await page.evaluate(()=>document.documentElement.dataset.theme),'dark');
 await page.locator('#auth-screen [data-theme-choice="light"]').click();assert.equal(await page.evaluate(()=>document.documentElement.dataset.theme),'light');assert.equal(await page.evaluate(()=>getComputedStyle(document.body).backgroundColor),'rgb(244, 246, 251)');assert.equal(await page.evaluate(()=>getComputedStyle(document.body).color),'rgb(23, 36, 56)');
 await page.reload();assert.equal(await page.evaluate(()=>document.documentElement.dataset.theme),'light');assert.equal(await page.locator('#auth-screen [data-theme-choice="light"]').getAttribute('aria-pressed'),'true');
 await page.screenshot({path:'/tmp/check-theme-light-login.png'});
 await page.evaluate(()=>{
 const today=new Date().toISOString().slice(0,10);window.themeCalls=[];
 const rows={companies:{id:'company',name:'Тестовая сеть'},profiles:[{id:'owner',company_id:'company',department_id:null,name:'Дмитрий',role:'manager'},{id:'worker',company_id:'company',department_id:'dep',name:'Иван',role:'employee'}],departments:[{id:'dep',name:'Основное'}],equipment:[{id:'machine',name:'Шиномонтажный станок',code:'K2-01',location:'Цех',department_id:'dep'}],maintenance_actions:[{id:'action',name:'Проверить давление',equipment_id:'machine',department_id:'dep',frequency:7}],tasks:[{id:'task',title:'Проверить давление',date:today,equipment_id:'machine',department_id:'dep',action_id:'action',status:'pending',equip_name:'Шиномонтажный станок'}],completions:[],subscriptions:{plan_id:'free'},consumable_requests:[{id:'supply',item_name:'Перчатки',quantity:2,unit:'уп.',status:'needed',created_by:'owner',department_id:'dep',created_at:new Date().toISOString()}]};
 const from=table=>{const b={select(){return b},eq(){return b},order(){return b},limit(){return b},maybeSingle:async()=>({data:table==='profiles'?rows.profiles[0]:rows[table]}),single:async()=>({data:rows[table]}),then(resolve){return Promise.resolve({data:rows[table]||[]}).then(resolve)}};return b;};
 window.supabase={createClient:()=>({auth:{getSession:async()=>({data:{session:null}}),getUser:async()=>({data:{user:{id:'owner',email:'owner@test.invalid'}}}),onAuthStateChange:()=>({}),signOut:async()=>({})},from,rpc:async(name)=>{themeCalls.push(name);return{data:name==='get_current_work_limits'?{max_departments:1,max_equipment:5,work_active:true,active_department_ids:['dep'],active_equipment_ids:['machine']}:name==='is_super_admin'||name==='current_company_is_unlimited'?false:0};},functions:{invoke:async()=>({data:{data:[]}})}})};
 });
 for(const file of ['js/photo-attachments.js','js/consumables.js','js/team.js','js/app.js','js/calendar-core.js'])await page.addScriptTag({path:file});
 await page.evaluate(async()=>{await hydrateCurrentUser();enterApp();});
 // Dashboard navigation uses the same scope as the global selector.
 await page.evaluate(()=>{
   const c=getCompany();c.subscription={planId:'standard',expiresAt:'2099-01-01'};c.workLimits.active_department_ids.push('dep2');c.workLimits.active_equipment_ids.push('machine2','machine3');
   c.departments.push({id:'dep2',name:'Второе подразделение с очень длинным названием для мобильного экрана'});
   c.equipment.push({id:'machine2',name:'Компрессор',departmentId:'dep2'},{id:'machine3',name:'Подъемник',departmentId:'dep2'});
   c.tasks.push({id:'task2',title:'Проверить компрессор',date:todayStr(),departmentId:'dep2',equipmentId:'machine2',status:'pending'});
   renderDashboard();
 });
 assert.equal(await page.locator('#dashboard-dept-select option').count(),2);
 await page.locator('#dashboard-dept-select').selectOption('dep2');
 assert.equal(await page.locator('#dept-select').inputValue(),'dep2');
 assert.equal(await page.locator('#stat-equipment').textContent(),'2');
 assert.match(await page.locator('#dash-today-list').textContent(),/Проверить компрессор/);
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 await page.locator('#dept-select').selectOption('dep');
 assert.equal(await page.locator('#dashboard-dept-select').inputValue(),'dep');
 assert.equal(await page.locator('#stat-equipment').textContent(),'1');
 await page.locator('#dashboard-dept-select').focus();await page.keyboard.press('ArrowDown');await page.keyboard.press('Enter');
 assert.equal(await page.locator('#dept-select').inputValue(),'dep2');
 await page.evaluate(()=>{getCompany().subscription={planId:'free'};getCompany().workLimits.active_department_ids=['dep'];renderDashboard();});
 assert.equal(await page.locator('#dashboard-dept-select option[value="dep2"]').isDisabled(),true);
 assert.equal(await page.locator('#dashboard-dept-select').inputValue(),'dep');
 await page.evaluate(()=>{
   const u=getUser();u.role='responsible';u.departmentId='dep';renderDashboard();onDeptChange('dep2');
 });
 assert.equal(await page.locator('#dashboard-dept-control').isVisible(),false);
 assert.equal(await page.evaluate(()=>getActiveDeptId()),'dep');
 await page.evaluate(()=>{getUser().role='manager';const c=getCompany();const saved=c.departments;c.departments=[];renderDashboard();window.savedDepartments=saved;});
 assert.equal(await page.locator('#dashboard-dept-select').isDisabled(),true);
 await page.evaluate(()=>{getCompany().departments=window.savedDepartments;renderDashboard();});
 for(const theme of ['light','dark']){
  await page.evaluate(()=>showPage('cabinet'));await page.locator('#page-cabinet [data-theme-choice="'+theme+'"]').click();
  assert.equal(await page.locator('#auth-screen [data-theme-choice="'+theme+'"]').getAttribute('aria-pressed'),'true');
  for(const name of ['calendar','dashboard','today','equipment','actions','consumables','team','history','reports','cabinet']){
   await page.evaluate(name=>name==='calendar'?openCalendar():showPage(name),name);await page.waitForTimeout(60);
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'horizontal overflow: '+name);
   if(name==='dashboard')await page.screenshot({path:'/tmp/check-theme-'+theme+'-dashboard.png'});
  }

  const contrasts=await page.evaluate(()=>{
    const rgb=s=>s.match(/[\d.]+/g).map(Number),lum=a=>a.slice(0,3).map(x=>{x/=255;return x<=.04045?x/12.92:((x+.055)/1.055)**2.4;}).reduce((s,x,i)=>s+x*[.2126,.7152,.0722][i],0);
    const body=rgb(getComputedStyle(document.body).backgroundColor);
    return [['text-muted','bg-surface'],['text-subtle','bg-raised'],['text-brand','bg-canvas'],['text-success','bg-emerald-500/20'],['text-warning','bg-amber-500/20'],['text-danger','bg-rose-500/10'],['text-info','bg-sky-500/15'],['text-white','bg-primary-600']].map(([text,bg])=>{const el=document.createElement('div');el.className=text+' '+bg;el.textContent='Контраст';document.body.append(el);const style=getComputedStyle(el),fg=rgb(style.color),back=rgb(style.backgroundColor),alpha=back[3]??1,blended=back.slice(0,3).map((x,i)=>x*alpha+body[i]*(1-alpha));const a=lum(fg),b=lum(blended);el.remove();return{text,bg,ratio:(Math.max(a,b)+.05)/(Math.min(a,b)+.05)};});
  });
  for(const c of contrasts)assert.ok(c.ratio>=4.5,theme+' '+c.text+' on '+c.bg+': '+c.ratio.toFixed(2));
  await page.evaluate(()=>{showPage('equipment');openEquipModal();});
  const bg=await page.locator('#modal-equip > div').evaluate(el=>getComputedStyle(el).backgroundColor);assert.equal(bg,theme==='light'?'rgb(255, 255, 255)':'rgb(19, 30, 45)');await page.evaluate(()=>closeEquipModal());
  await page.evaluate(()=>{showPage('team');openTeamRole('worker');});assert.equal(await page.locator('#team-role-dialog').evaluate(el=>getComputedStyle(el).backgroundColor),bg);await page.keyboard.press('Escape');
  await page.evaluate(()=>{showPage('cabinet');return doLogout();});assert.equal(await page.evaluate(()=>document.documentElement.dataset.theme),theme);await page.evaluate(async()=>{await hydrateCurrentUser();enterApp();});
 }
 assert.deepEqual(errors,[]);
 // Preference also synchronizes between already-open tabs.
 const second=await context.newPage();await second.route('https://fonts.googleapis.com/**',r=>r.abort());await second.goto(url);
 await page.evaluate(()=>{document.getElementById('app-screen').classList.add('hidden');document.getElementById('auth-screen').classList.remove('hidden');});await page.locator('#auth-screen [data-theme-choice="light"]').click();await second.waitForFunction(()=>document.documentElement.dataset.theme==='light');
 const blocked=await browser.newContext();await blocked.addInitScript(()=>{Storage.prototype.setItem=function(){throw new DOMException('Blocked','SecurityError');};});const blockedPage=await blocked.newPage();await blockedPage.route('https://fonts.googleapis.com/**',r=>r.abort());await blockedPage.goto(url);await blockedPage.locator('#auth-screen [data-theme-choice="light"]').click();assert.equal(await blockedPage.evaluate(()=>document.documentElement.dataset.theme),'light');assert.match(await blockedPage.locator('#auth-screen [data-theme-status]').textContent(),/Не удалось сохранить/);await blocked.close();
 console.log('PASS: dashboard department switching/synchronized counts/tasks, long names, frozen/empty/role guards; theme persistence/reload, both controls synchronized, device preference survives logout, cross-tab changes, light/dark page matrix and dialogs, contrast-oriented semantic palette, no mobile overflow or JS errors (mocked data)');
}finally{if(browser)await browser.close();server.close();}
