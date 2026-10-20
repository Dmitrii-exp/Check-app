import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile} from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
const require=createRequire(import.meta.url);let playwright;try{playwright=require('playwright');}catch{playwright=require(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES+'/playwright');}
const root=process.cwd(), html=(await readFile('app/index.html','utf8')).replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'');
const server=http.createServer(async(req,res)=>{try{if(req.url.startsWith('/app/')){res.setHeader('content-type','text/html');res.end(html);return;}const p=path.resolve(root,'.'+new URL(req.url,'http://localhost').pathname);if(!p.startsWith(root+path.sep))throw Error();res.end(await readFile(p));}catch{res.writeHead(404);res.end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser;
try{
 browser=await playwright.chromium.launch({headless:true,executablePath:process.env.CHROMIUM_EXECUTABLE,args:['--no-sandbox','--disable-dev-shm-usage','--use-gl=angle','--use-angle=swiftshader']});
 const page=await browser.newPage({viewport:{width:390,height:844}});const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.route('https://fonts.googleapis.com/**',r=>r.abort());
 await page.goto('http://127.0.0.1:'+server.address().port+'/app/');await page.addStyleTag({path:'css/tailwind.css'});await page.addStyleTag({content:(await readFile('css/styles.css','utf8')).replace(/@import[^;]+;/g,'')});
 await page.evaluate(()=>{
 window.teamTest={calls:[],failCreate:true,roleError:true,session:null};
 window.teamRows={companies:{id:'company',name:'Тестовая сеть'},profiles:[{id:'owner',company_id:'company',name:'Дмитрий',role:'manager',department_id:null},{id:'worker',company_id:'company',name:'Иван',role:'employee',department_id:'dep'}],departments:[{id:'dep',name:'Основное',invite_code:'never-visible'}],equipment:[],maintenance_actions:[],tasks:[],completions:[],subscriptions:{plan_id:'free'}};
 const builder=table=>{const b={select(){return b},eq(){return b},order(){return b},maybeSingle(){return Promise.resolve({data:table==='profiles'?teamRows.profiles[0]:teamRows[table]})},single(){return Promise.resolve({data:teamRows[table]})},then(resolve){return Promise.resolve({data:teamRows[table]||[]}).then(resolve)}};return b};
 window.supabase={createClient:()=>({auth:{getSession:async()=>({data:{session:null}}),getUser:async()=>({data:{user:{id:'owner',email:'owner@test.invalid'}}}),onAuthStateChange:()=>({}),setSession:async session=>{teamTest.session=session;return{};}},from:builder,rpc:async(name,args)=>{
 teamTest.calls.push({name,args});if(name==='set_company_member_role'){if(teamTest.roleError)return{error:{message:'Cannot demote the last network manager'}};teamRows.profiles.find(u=>u.id===args.p_user_id).role=args.p_role;return{data:{}};}
 if(name==='get_current_work_limits')return{data:{max_departments:1,max_equipment:5,work_active:true,active_department_ids:['dep'],active_equipment_ids:[]}};return{data:name==='is_super_admin'||name==='current_company_is_unlimited'?false:0};
 },functions:{invoke:async(name,{body})=>{teamTest.calls.push(body);if(body.mode==='create'&&teamTest.failCreate)return{error:{context:new Response(JSON.stringify({error:'Тестовая ошибка сети'}))}};
 if(body.mode==='info')return{data:{email:'worker@test.invalid',company_name:'Тестовая сеть',department_name:'Основное',existing_account:false}};
 if(body.mode==='accept')return{data:{session:{access_token:'mock-access',refresh_token:'mock-refresh'}}};
 return{data:{data:body.mode==='list'?[]:{id:'invitation',email:body.email||'worker@test.invalid',department_name:'Основное'}}};}}})};
 });
 for(const file of ['js/photo-attachments.js','js/consumables.js','js/team.js','js/app.js'])await page.addScriptTag({path:file});
 await page.evaluate(async()=>{await hydrateCurrentUser();enterApp();showPage('team');});
 await page.fill('#team-invite-email','worker@test.invalid');await page.click('#team-invite-prepare');await page.waitForFunction(()=>!teamInviteBusy);assert.match(await page.locator('#team-invite-status').textContent(),/ошибка сети/);assert.equal(await page.inputValue('#team-invite-email'),'worker@test.invalid');
 await page.evaluate(()=>teamTest.failCreate=false);await page.click('#team-invite-prepare');await page.waitForFunction(()=>!!preparedTeamInvitation);assert.equal(await page.locator('#team-invite-send').isVisible(),true);assert.equal(await page.locator('body').textContent().then(s=>s.includes('never-visible')),false);
 await page.click('#team-invite-send');await page.waitForFunction(()=>!teamInviteBusy);assert.match(await page.locator('#team-invite-status').textContent(),/отправлено/);
 await page.locator('[data-team-role="owner"]').click();assert.equal(await page.evaluate(()=>document.activeElement.id),'team-role-cancel');await page.selectOption('#team-role','employee');await page.click('#team-role-save');await page.waitForFunction(()=>!teamRoleBusy);assert.match(await page.locator('#team-role-status').textContent(),/последнего руководителя сети/);await page.keyboard.press('Escape');assert.equal(await page.locator('#team-role-dialog').isVisible(),false);
 await page.locator('[data-team-role="worker"]').click();await page.selectOption('#team-role','responsible');await page.evaluate(()=>teamTest.roleError=false);await page.click('#team-role-save');await page.waitForFunction(()=>!teamRoleBusy);assert.equal(await page.locator('#team-role-dialog').isVisible(),false);assert.match(await page.locator('#team-list').textContent(),/Руководитель подразделения/);
 await page.screenshot({path:'/tmp/check-team-mobile.png',fullPage:true});
 await page.evaluate(()=>{const c=getCompany();c.users[0].role='employee';c.users[0].departmentId='dep';db.currentUser.role='employee';enterApp();showPage('cabinet');});assert.equal(await page.locator('#cab-subscription-details').isVisible(),false);assert.equal(await page.locator('#cab-delete-company').isVisible(),false);
 await page.evaluate(()=>showPage('team'));assert.equal(await page.locator('#page-team').isVisible(),false);await page.evaluate(()=>openEquipModal());assert.equal(await page.locator('#modal-equip').isVisible(),false);
 await page.evaluate(()=>{document.getElementById('app-screen').classList.add('hidden');document.getElementById('auth-screen').classList.remove('hidden');location.hash='invite_token='+'a'.repeat(43);return initEmailInvitation();});assert.equal(await page.evaluate(()=>location.hash),'');assert.equal(await page.locator('#email-invite-repeat').isVisible(),true);assert.equal(await page.inputValue('#email-invite-email'),'worker@test.invalid');
 await page.fill('#email-invite-name','Иван');await page.fill('#email-invite-password','test-password-123');await page.fill('#email-invite-repeat','test-password-other');await page.click('#email-invite-submit');assert.match(await page.locator('#email-invite-status').textContent(),/Пароли не совпадают/);assert.equal(await page.evaluate(()=>teamTest.calls.filter(x=>x.mode==='accept').length),0);
 await page.fill('#email-invite-repeat','test-password-123');await page.click('#email-invite-submit');await page.waitForFunction(()=>teamTest.session);assert.equal(await page.evaluate(()=>teamTest.session.access_token),'mock-access');
 assert.deepEqual(errors,[]);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 console.log('PASS: mobile invitations prepare/error retry/send, no shared code, role dialog keyboard/cancel/last-owner error/save, employee page and equipment guards, hidden billing/deletion, invitation password confirmation and session');
}finally{if(browser)await browser.close();server.close();}
