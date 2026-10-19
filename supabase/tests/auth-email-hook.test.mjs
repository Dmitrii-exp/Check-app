import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
// Install test tooling outside the application bundle; this test never sends email.
const tooling=process.env.CHECK_APP_TEST_TOOLING || '../../../browser-tools/node_modules/';
const ts=require(tooling+'typescript');
const {Webhook}=require(tooling+'standardwebhooks');
const source=readFileSync('supabase/functions/send-auth-email/index.ts','utf8');
const withoutImports=source.replace(/^import .* from .*;\n/gm,'');
const script=ts.transpileModule(withoutImports,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText;
let handler;const emails=[];
const secret=Buffer.from('test-only-hook-secret-32-bytes-long').toString('base64');
const context=vm.createContext({Webhook,Resend:class {emails={send:async message=>{emails.push(message);return {error:null}}}},Deno:{env:{get:key=>({RESEND_API_KEY:'test-only',SEND_EMAIL_HOOK_SECRET:'v1,whsec_'+secret,SUPABASE_URL:'https://qaxoufarhpagcjkhptga.supabase.co'})[key]},serve:fn=>handler=fn},URL,URLSearchParams,Request,Response,console});
vm.runInContext(script,context);
async function request(action,extras={},valid=true){
 const payload=JSON.stringify({user:{email:'test@example.invalid'},email_data:{email_action_type:action,token:'12345678',token_hash:'test-recovery-hash',redirect_to:'https://untrusted.invalid',...extras}});
 const id='test-event-id',now=new Date(),wh=new Webhook(secret);
 const headers={'webhook-id':id,'webhook-timestamp':String(Math.floor(now.getTime()/1000)),'webhook-signature':valid?wh.sign(id,now,payload):'v1,bad','content-type':'application/json'};
 return handler(new Request('https://example.invalid/hook',{method:'POST',headers,body:payload}));
}
assert.equal((await request('recovery')).status,200);
const recovery=emails.pop();assert.match(recovery.subject,/Восстановление пароля/);assert.doesNotMatch(recovery.subject,/регистрации/);
assert.match(recovery.html,/Создать новый пароль/);assert.doesNotMatch(recovery.html,/12345678|Введите этот код|Спасибо за регистрацию/);
const link=recovery.text.match(/https:\/\/\S+/)[0];const parsed=new URL(link);assert.equal(parsed.origin,'https://app-check.ru');assert.equal(parsed.pathname,'/app/');assert.equal(parsed.search,'');const fragment=new URLSearchParams(parsed.hash.slice(1));assert.equal(fragment.get('type'),'recovery');assert.equal(fragment.get('token_hash'),'test-recovery-hash');
assert.equal((await request('signup')).status,200);const signup=emails.pop();assert.match(signup.subject,/Подтверждение регистрации/);assert.match(signup.html,/12345678/);
assert.equal((await request('recovery',{},false)).status,401);assert.equal(emails.length,0);
assert.equal((await request('recovery',{token_hash:''})).status,401);assert.equal(emails.length,0);
assert.equal((await handler(new Request('https://example.invalid/hook'))).status,400);
console.log('PASS: signed recovery sends link (no OTP), trusted redirect, unchanged signup code; forged signature and missing hash send nothing');
