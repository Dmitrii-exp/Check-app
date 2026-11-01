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
 for(const file of ['js/photo-attachments.js','js/consumables.js','js/team.js','js/interface.js','js/app.js','js/calendar-core.js'])await page.addScriptTag({path:file});
 await page.evaluate(async()=>{await hydrateCurrentUser();enterApp();});

 // Test new navigation against the existing role-filtered pages and handlers.
 const output=process.env.CHECK_MOBILE_UI_SHOTS;
 if(output)await (await import('node:fs/promises')).mkdir(output,{recursive:true});
 for(const width of [320,390,768,1440]){
  await page.setViewportSize({width,height:844});
  for(const theme of ['light','dark']){
   await page.evaluate(()=>showPage('cabinet'));
   await page.locator('#page-cabinet [data-theme-choice="'+theme+'"]').click();
   await page.evaluate(()=>showPage('dashboard'));
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'overflow: '+width+' '+theme);
   if(width<768){
    assert.equal(await page.locator('#manager-nav').isVisible(),false);
    assert.equal(await page.locator('#dashboard-dept-control').isVisible(),false);
    assert.equal(await page.locator('#dept-select').isVisible(),true);
    assert.equal(await page.locator('#mobile-navigation').isVisible(),true);
    assert.equal(await page.locator('[data-mobile-slot="home"]').getAttribute('aria-current'),'page');
    assert.equal(await page.locator('#mobile-initials').textContent(),'Д');
    assert.ok((await page.locator('#mobile-navigation').boundingBox()).y>=700);
    await page.locator('#mobile-more-open').click();
    assert.equal(await page.locator('#mobile-more').evaluate(el=>el.open),true);
    assert.equal(await page.evaluate(()=>document.activeElement.id),'mobile-more-close');
    assert.match(await page.locator('#mobile-user-email').textContent(),/owner@test.invalid/);
    for(let i=0;i<8;i++){await page.keyboard.press('Tab');assert.equal(await page.evaluate(()=>document.getElementById('mobile-more').contains(document.activeElement)),true);}
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#mobile-more').evaluate(el=>el.open),false);
    assert.equal(await page.evaluate(()=>document.activeElement.id),'mobile-more-open');
    await page.locator('[data-mobile-slot="calendar"]').click();
    assert.equal(await page.locator('#page-calendar').isVisible(),true);
    assert.equal(await page.locator('[data-mobile-slot="calendar"]').getAttribute('aria-current'),'page');
    await page.locator('[data-mobile-slot="tasks"]').click();
    assert.equal(await page.locator('#page-today').isVisible(),true);
    assert.equal(await page.locator('[data-mobile-slot="tasks"]').getAttribute('aria-current'),'page');
    await page.locator('#today-list [data-maintenance-task="task"]').click();
    assert.equal(await page.locator('#modal-complete').isVisible(),true);
    assert.match(await page.locator('#complete-task-info').textContent(),/Проверить давление/);
    assert.equal(await page.evaluate(()=>getCompany().tasks[0].status),'pending');
    await page.evaluate(()=>closeCompleteModal());
    for(const route of ['equipment','actions','consumables','team','history','reports','cabinet','one-time']){
     await page.locator('#mobile-more-open').click();
     await page.locator('#mobile-more-items [data-interface-route="'+route+'"]').click();
     assert.equal(await page.locator('#page-'+route).isVisible(),true,route);
     assert.equal(await page.locator('#mobile-more').evaluate(el=>el.open),false);
     assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'route overflow: '+width+' '+route);
     assert.equal(await page.locator('#mobile-more-open').getAttribute('aria-current'),'page');
    }
    await page.locator('[data-mobile-slot="home"]').click();
   }else{
    assert.equal(await page.locator('#mobile-navigation').isVisible(),false);
    assert.equal(await page.locator('#manager-nav').isVisible(),true);
   }
   await page.evaluate(()=>scrollTo(0,0));
   if(output&&[390,1440].includes(width))await page.screenshot({path:output+'/app-'+theme+'-'+width+'.png'});
  }
 }
 await page.setViewportSize({width:390,height:844});
 await page.evaluate(()=>{const u=getUser();u.role='employee';u.departmentId='dep';db.currentUser.role='employee';enterApp();});
 assert.equal(await page.locator('#dept-bar').isVisible(),false);
 assert.deepEqual(await page.locator('#mobile-navigation [data-mobile-label]').allTextContents(),['Сегодня','Разовые','Расходники']);
 await page.locator('#mobile-more-open').click();
 assert.deepEqual(await page.locator('#mobile-more-items [data-interface-route]').evaluateAll(els=>els.map(el=>el.dataset.interfaceRoute)),['today','one-time','consumables','cabinet']);
 assert.equal(await page.locator('#mobile-more-items [data-create-department]').count(),0);
 await page.keyboard.press('Escape');await page.locator('[data-mobile-slot="calendar"]').click();assert.equal(await page.locator('#page-one-time').isVisible(),true);
 await page.locator('[data-mobile-slot="tasks"]').click();assert.equal(await page.locator('#page-consumables').isVisible(),true);
 await page.evaluate(()=>showPage('team'));assert.equal(await page.locator('#page-team').isVisible(),false);
 await page.evaluate(()=>{getUser().role='responsible';getUser().departmentId='dep';db.currentUser.role='responsible';enterApp();});
 await page.locator('#mobile-more-open').click();assert.equal(await page.locator('#mobile-more-items [data-interface-route="team"]').count(),0);assert.equal(await page.locator('#mobile-more-items [data-create-department]').count(),0);
 await page.keyboard.press('Escape');
 await page.evaluate(()=>{getUser().role='manager';db.currentUser.role='manager';isSuperAdmin=true;enterApp();});
 await page.locator('#mobile-more-open').click();assert.equal(await page.locator('#mobile-more-items [data-create-department]').count(),1);
 await page.locator('#mobile-more-items [data-interface-route="super-admin"]').click();assert.equal(await page.locator('#page-super-admin').isVisible(),true);
 await page.evaluate(()=>{getCompany().tasks=[];showPage('dashboard');});assert.match(await page.locator('#dash-today-list').textContent(),/Задач нет/);assert.equal(await page.locator('#stat-today').textContent(),'0');
 await page.locator('#mobile-more-open').click();await page.locator('#mobile-more-logout').click();await page.waitForFunction(()=>document.getElementById('app-screen').classList.contains('hidden'));
 assert.equal(await page.locator('#mobile-more').evaluate(el=>el.open),false);assert.equal(await page.locator('#mobile-navigation').isVisible(),false);
 assert.deepEqual(errors,[]);
 console.log('PASS: mobile navigation and all More destinations, task completion delegates without writing data, one department selector, role-filtered employee/lead/admin menus, focus trap/Escape/restore, empty state/logout; 320/390/768/1440px, both themes, no overflow or JS errors (stub data)');
}finally{if(browser)await browser.close();server.close();}
