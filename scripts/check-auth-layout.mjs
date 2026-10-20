// Browser geometry check of the built app, with no Auth requests or credentials.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile} from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
const require=createRequire(import.meta.url);let chromium;try{({chromium}=require('playwright'));}catch{({chromium}=require(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES+'/playwright'));}
const root=path.resolve('dist-mobile');
const html=(await readFile(root+'/index.html','utf8')).replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'');
const server=http.createServer(async(req,res)=>{try{const p=new URL(req.url,'http://localhost').pathname;if(p==='/'){res.setHeader('content-type','text/html');res.end(html);return;}const file=path.resolve(root,'.'+p);if(!file.startsWith(root+path.sep))throw Error();res.setHeader('content-type',file.endsWith('.css')?'text/css':'text/javascript');res.end(await readFile(file));}catch{res.writeHead(404);res.end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_EXECUTABLE,args:['--no-sandbox','--disable-dev-shm-usage']});
try{
 const page=await browser.newPage();await page.route('https://fonts.googleapis.com/**',r=>r.abort());
 await page.goto('http://127.0.0.1:'+server.address().port+'/');
 await page.evaluate(()=>{window.supabase={createClient:()=>({auth:{getSession:async()=>({data:{session:null}}),onAuthStateChange:()=>({})}})};});
 await page.addScriptTag({path:'js/app.js'});
 for(const viewport of [{width:390,height:844},{width:320,height:568},{width:1440,height:900},{width:390,height:360}]){
  await page.setViewportSize(viewport);await page.locator('#login-email').focus();
  const geometry=await page.evaluate(()=>{const box=id=>{const b=document.getElementById(id).getBoundingClientRect();return{x:b.x,y:b.y,w:b.width,h:b.height,bottom:b.bottom}};const logo=document.querySelector('.auth-logo').getBoundingClientRect();return{logoCenter:logo.x+logo.width/2,panelCenter:document.querySelector('.auth-panel').getBoundingClientRect().x+document.querySelector('.auth-panel').getBoundingClientRect().width/2,button:box('login-submit'),email:box('login-email'),password:box('login-password'),version:document.getElementById('auth-version').textContent,overflow:document.documentElement.scrollWidth>innerWidth};});
  assert.ok(Math.abs(geometry.logoCenter-geometry.panelCenter)<1);assert.equal(geometry.button.h,52);assert.equal(geometry.email.h,52);assert.equal(geometry.password.h,52);assert.equal(geometry.overflow,false);assert.match(geometry.version,/Версия 1\.2\.7/);
  await page.locator('#login-submit').scrollIntoViewIfNeeded();assert.equal(await page.locator('#login-submit').isVisible(),true);
  if(viewport.width===390&&viewport.height===844){await page.evaluate(()=>scrollTo(0,0));await page.screenshot({path:'/tmp/check-auth-mobile.png'});}
  if(viewport.width===1440)await page.screenshot({path:'/tmp/check-auth-desktop.png'});
 }
 await page.setViewportSize({width:390,height:844});await page.fill('#login-password','test-only-password');await page.getByRole('button',{name:'Показать пароль',exact:true}).first().click();assert.equal(await page.locator('#login-password').getAttribute('type'),'text');await page.getByRole('button',{name:'Скрыть пароль',exact:true}).click();assert.equal(await page.locator('#login-password').getAttribute('type'),'password');
 const before=await page.locator('#login-submit').boundingBox();await page.evaluate(()=>setLoginLoading(true));assert.equal((await page.locator('#login-submit').boundingBox()).height,before.height);await page.evaluate(()=>setLoginLoading(false));
 await page.locator('#tab-register').click();assert.equal(await page.locator('#form-register').isVisible(),true);assert.equal((await page.locator('#form-register button[type="submit"]').boundingBox()).height,52);
 await page.locator('#tab-invite').click();assert.equal(await page.locator('#form-invite').isVisible(),true);
 // Simulate unavailable/stale utility CSS: the auth owner's geometry still holds.
 await page.evaluate(()=>{document.querySelector('link[href*="tailwind.css"]').remove();switchAuthTab('login');});assert.equal((await page.locator('#login-submit').boundingBox()).height,52);assert.equal((await page.locator('#login-email').boundingBox()).height,52);
 console.log('PASS: built auth layout at 320/390/1440px and shortened viewport; centered logo/version; 52px controls; no overflow; password visibility, tabs and stable loading; layout survives missing utility CSS');
}finally{await browser.close();server.close();}
