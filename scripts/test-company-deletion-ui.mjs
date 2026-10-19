import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile} from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import os from 'node:os';
const require=createRequire(import.meta.url);
let playwright;
try { playwright=require('playwright'); } catch(error) {
 if(!process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES) throw new Error('Install Playwright and Chromium before running this test.');
 playwright=require(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES+'/playwright');
}
const {chromium}=playwright;
const root=process.cwd();
const html=(await readFile('app/index.html','utf8')).replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'');
const server=http.createServer(async(req,res)=>{try{const url=new URL(req.url,'http://localhost');if(url.pathname==='/app/'){res.setHeader('content-type','text/html');res.end(html);return;}const p=path.resolve(root,'.'+url.pathname);if(!p.startsWith(root+path.sep))throw Error();const data=await readFile(p);res.setHeader('content-type',p.endsWith('.css')?'text/css':'application/octet-stream');res.end(data);}catch{res.writeHead(404);res.end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
let browser;
try{
 browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_EXECUTABLE ? {executablePath:process.env.CHROMIUM_EXECUTABLE,args:['--no-sandbox','--disable-dev-shm-usage','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']} : {})});
 const page=await browser.newPage({viewport:{width:1280,height:900}});
 await page.route('https://fonts.googleapis.com/**',r=>r.abort());
 await page.goto('http://127.0.0.1:'+server.address().port+'/app/');
 await page.evaluate(()=>{
  window.deleteTest={mode:'error',calls:0,signOuts:0};
  window.supabase={createClient:()=>({auth:{getSession:async()=>({data:{session:null}}),getUser:async()=>({data:{user:null}}),onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}}),signOut:async()=>{window.deleteTest.signOuts++;return{};}},functions:{invoke:async(name,options)=>{
   window.deleteTest.calls++;
   if(window.deleteTest.mode==='pending') return new Promise(resolve=>window.deleteTest.resolve=resolve);
   if(window.deleteTest.mode==='complete')return {data:{complete:true}};
   return {error:{context:new Response(JSON.stringify({error:'Тест: соединение прервано',pending:true}),{status:503})}};
  }}})};
 });
 await page.addStyleTag({path:'css/tailwind.css'});
 await page.addStyleTag({content:(await readFile('css/styles.css','utf8')).replace(/^@import.*;\n/gm,'')});
 await page.addScriptTag({path:'js/company-deletion.js'});
 await page.addScriptTag({path:'js/app.js'});
 await page.evaluate(()=>{
  const company={id:'22222222-2222-4222-8222-222222222222',name:'Тестовая компания',departments:[],equipment:[],actions:[],tasks:[],completions:[],subscription:{planId:'free',expiresAt:null},users:[{id:'11111111-1111-4111-8111-111111111111',role:'manager',name:'Руководитель'}]};
  db={companies:{[company.id]:company},currentUser:{company:company.id,id:company.users[0].id}};
  document.getElementById('auth-screen').classList.add('hidden');document.getElementById('app-screen').classList.remove('hidden');document.getElementById('page-cabinet').classList.remove('hidden');renderCabinet();
  document.dispatchEvent(new Event('DOMContentLoaded'));
 });
 assert.equal(await page.locator('#cab-delete-company').isVisible(),true);
 await page.click('#delete-company-open');
 assert.equal(await page.locator('#delete-company-dialog').evaluate(x=>x.open),true);
 assert.equal(await page.locator('#delete-company-cancel').evaluate(x=>x===document.activeElement),true);
 for(let i=0;i<6;i++){await page.keyboard.press('Tab');assert.equal(await page.evaluate(()=>document.getElementById('delete-company-dialog').contains(document.activeElement)),true);}
 await page.fill('#delete-company-confirmation','удалить');assert.equal(await page.locator('#delete-company-submit').isDisabled(),true);
 await page.fill('#delete-company-confirmation','УДАЛИТЬ');assert.equal(await page.locator('#delete-company-submit').isEnabled(),true);
 await page.click('#delete-company-submit');await page.waitForFunction(()=>document.getElementById('delete-company-status').textContent.includes('соединение прервано'));
 assert.equal(await page.inputValue('#delete-company-confirmation'),'УДАЛИТЬ');assert.equal(await page.locator('#delete-company-submit').isEnabled(),true);
 await page.keyboard.press('Escape');assert.equal(await page.locator('#delete-company-dialog').evaluate(x=>x.open),false);
 await page.evaluate(()=>{getCompany().users[0].role='employee';renderCabinet();openCompanyDeletion();});
 assert.equal(await page.locator('#cab-delete-company').isVisible(),false);assert.equal(await page.locator('#delete-company-dialog').evaluate(x=>x.open),false);
 await page.evaluate(()=>{getCompany().users[0].role='manager';renderCabinet();});
 await page.setViewportSize({width:390,height:844});await page.click('#delete-company-open');
 const box=await page.locator('#delete-company-dialog').boundingBox();assert.ok(box.x>=0 && box.x+box.width<=391 && box.y>=0 && box.y+box.height<=845);
 await page.screenshot({path:process.env.COMPANY_DELETION_SCREENSHOT || path.join(os.tmpdir(),'check-app-company-deletion-mobile.png')});
 await page.fill('#delete-company-confirmation','УДАЛИТЬ');await page.evaluate(()=>window.deleteTest.mode='pending');await page.click('#delete-company-submit');
 assert.equal(await page.locator('#delete-company-cancel').isDisabled(),true);await page.keyboard.press('Escape');assert.equal(await page.locator('#delete-company-dialog').evaluate(x=>x.open),true);
 await page.evaluate(()=>window.deleteTest.resolve({error:{context:new Response(JSON.stringify({error:'Тест: соединение прервано',pending:true}),{status:503})}}));
 await page.waitForFunction(()=>!document.getElementById('delete-company-submit').disabled);
 await page.evaluate(()=>window.deleteTest.mode='complete');
 await Promise.all([page.waitForEvent('framenavigated'),page.click('#delete-company-submit')]);
 assert.equal(await page.evaluate(()=>sessionStorage.getItem('checkapp_company_deleted')),'1');
 console.log('PASS: owner-only visibility, literal confirmation, keyboard focus, mobile layout, busy lock, recoverable error and success logout/reload');
}finally{if(browser)await browser.close();server.close();}
