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
try {
 browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_EXECUTABLE?{executablePath:process.env.CHROMIUM_EXECUTABLE,args:['--no-sandbox','--disable-dev-shm-usage','--use-gl=angle','--use-angle=swiftshader']}: {})});
 const page=await browser.newPage({viewport:{width:390,height:844}});
 await page.route('https://fonts.googleapis.com/**',r=>r.abort());await page.goto('http://127.0.0.1:'+server.address().port+'/app/#token_hash=test-one-time-hash&type=recovery');
 await page.evaluate(()=>{window.resetTest={updates:0,signOuts:0};window.supabase={createClient:()=>({auth:{verifyOtp:async args=>{resetTest.verified=args.token_hash==='test-one-time-hash'&&args.type==='recovery';return{error:null}},getSession:async()=>({data:{session:null}}),onAuthStateChange:cb=>{resetTest.callback=cb;return{}},updateUser:async data=>{resetTest.updates++;resetTest.validPassword=data.password==='temporary-test-password';return{error:null}},signOut:async()=>{resetTest.signOuts++;return{error:null}}}})}});
 await page.addStyleTag({path:'css/tailwind.css'});await page.addScriptTag({path:'js/app.js'});
 await page.waitForFunction(()=>resetTest.verified===true);
 assert.equal(await page.evaluate(()=>window.location.hash),'');
 assert.equal(await page.locator('#recovery-password-step').isVisible(),true);assert.equal(await page.locator('#recovery-email-step').isVisible(),false);
 await page.fill('#recovery-new-password','temporary-test-password');await page.fill('#recovery-repeat-password','different-test-password');await page.click('#recovery-save');
 assert.match(await page.locator('#recovery-message').textContent(),/Пароли не совпадают/);assert.equal(await page.evaluate(()=>resetTest.updates),0);
 await page.fill('#recovery-repeat-password','temporary-test-password');await page.click('#recovery-save');
 await page.waitForFunction(()=>resetTest.signOuts===1);assert.equal(await page.evaluate(()=>resetTest.validPassword),true);assert.equal(await page.locator('#password-recovery-modal').isVisible(),false);
 await page.evaluate(async()=>{supabaseClient.auth.verifyOtp=async()=>({error:new Error('expired')});window.location.hash='token_hash=expired&type=recovery';await handlePasswordRecoveryLink()});
 assert.equal(await page.locator('#recovery-password-step').isVisible(),false);assert.match(await page.locator('#recovery-message').textContent(),/недействительна или истекла/);
 console.log('PASS: recovery link opens two password fields; mismatch prevents update; confirmed password saves, signs out and returns to login (Auth stub)');
}finally{if(browser)await browser.close();server.close();}
