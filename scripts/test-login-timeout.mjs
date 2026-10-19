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
 browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_EXECUTABLE ? {executablePath:process.env.CHROMIUM_EXECUTABLE,args:['--no-sandbox','--disable-dev-shm-usage','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']} : {})});
 const page=await browser.newPage();
 await page.route('https://fonts.googleapis.com/**',r=>r.abort());
 await page.goto('http://127.0.0.1:'+server.address().port+'/app/');
 await page.clock.install();
 await page.evaluate(()=>{
  window.loginTest={mode:'auth',entered:0,calls:0};
  const company='22222222-2222-4222-8222-222222222222',user='11111111-1111-4111-8111-111111111111';
  const rows={profiles:{id:user,company_id:company,role:'manager'},companies:{id:company,name:'Test'},departments:[],equipment:[],maintenance_actions:[],tasks:[],completions:[],subscriptions:null};
  window.supabase={createClient:()=>({auth:{
   getSession:async()=>({data:{session:null}}),
   onAuthStateChange:()=>({}),
   getUser:async()=>({data:{user:{id:user,email:'test@example.invalid'}}}),
   signInWithPassword:async()=>{loginTest.calls++;if(loginTest.mode==='auth')return new Promise(r=>loginTest.resolve=r);return {data:{},error:null};},
   signOut:async()=>({})
  },from(table){let singular=false;const q={select(){return q},eq(){return q},order(){return q},single(){singular=true;return q},maybeSingle(){singular=true;return q},then(resolve,reject){
   if(loginTest.mode===table)return new Promise(r=>loginTest.resolve=r).then(resolve,reject);
   return Promise.resolve({data:table==='profiles' ? (singular ? rows.profiles : [rows.profiles]) : rows[table],error:null}).then(resolve,reject);
  }};return q},rpc:async()=>{if(loginTest.mode==='rpc')return new Promise(r=>loginTest.resolve=r);return {data:false,error:null};}})};
 });
 await page.addScriptTag({path:'js/app.js'});
 await page.evaluate(()=>{enterApp=()=>{loginTest.entered++};document.getElementById('login-email').value='test@example.invalid';document.getElementById('login-password').value='test-password';});
 page.setDefaultTimeout(5000);
 for(const mode of ['auth','profiles','companies','equipment','rpc']) {
  console.log('Testing',mode);
  await page.evaluate(mode=>{loginTest.mode=mode;void doLogin()},mode);
  assert.equal(await page.locator('#login-submit').isDisabled(),true);
  await page.clock.fastForward(31000);
  assert.equal(await page.locator('#login-submit').isEnabled(),true);
  assert.match(await page.locator('#auth-error').textContent(),/30 секунд/);
  assert.equal(await page.locator('#login-spinner').evaluate(x=>x.classList.contains('hidden')),true);
  assert.equal(await page.evaluate(()=>loginTest.entered),0);
  // Complete a stale request; it must never open the app after timeout.
  await page.evaluate(mode=>{loginTest.resolve({data:mode==='auth'?{}:mode==='profiles'?{id:'u',company_id:'c',role:'manager'}:mode==='companies'?{id:'c'}:mode==='rpc'?false:[],error:null})},mode);
  await page.evaluate(()=>new Promise(r=>queueMicrotask(r)));
  assert.equal(await page.evaluate(()=>loginTest.entered),0);
 }
 await page.evaluate(()=>{loginTest.mode='success';void doLogin()});
 await page.waitForFunction(()=>loginTest.entered===1);
 assert.equal(await page.locator('#login-submit').isEnabled(),true);
 // Stalled automatic restore also terminates and releases its state.
 await page.evaluate(()=>{supabaseClient.auth.getSession=()=>new Promise(()=>{});void restoreWebsiteSession()});
 await page.clock.fastForward(31000);
 await page.waitForFunction(()=>restoringWebsiteSession===null);
 // Real fetch is aborted and preserves the caller's AbortSignal.
 await page.evaluate(()=>{window.originalFetch=window.fetch;window.fetch=(_url,opts)=>new Promise((resolve,reject)=>{opts.signal.addEventListener('abort',()=>reject(new Error('aborted')),{once:true});});window.fetchCheck=fetchWithTimeout('/auth/v1/stalled').then(()=>false,()=>true)});
 await page.clock.fastForward(21000);
 assert.equal(await page.evaluate(()=>window.fetchCheck),true);
 await page.evaluate(()=>{window.upstream=new AbortController();window.fetchCheck=fetchWithTimeout('/cancelled',{signal:upstream.signal}).then(()=>false,()=>true);upstream.abort()});
 assert.equal(await page.evaluate(()=>window.fetchCheck),true);
 console.log('PASS: stalled password/profile/company/equipment/RPC and restore release UI; late responses cannot enter; retry succeeds; fetch timeout and caller abort propagate');
} finally {if(browser)await browser.close();server.close();}
