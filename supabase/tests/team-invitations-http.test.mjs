import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {stripTypeScriptTypes} from 'node:module';

let handler, sentMail, draftHash, calls=[], newUserDeleted=false, existing=false, passwordFails=false, mailFails=false, acceptFails=false;
globalThis.Deno={env:{get:name=>({SUPABASE_URL:'https://test.invalid',SUPABASE_SERVICE_ROLE_KEY:'server-only',RESEND_API_KEY:'server-only'})[name]},serve:fn=>handler=fn};
globalThis.__createClient=()=>({from:()=>({select(){return this},eq(){return this},maybeSingle:async()=>({data:null})}),auth:{getUser:async token=>({data:{user:token==='owner-session'?{id:'owner'}:null}}),admin:{createUser:async args=>{assert.equal(args.email_confirm,true);assert.equal(args.email,'invited@test.invalid');return{data:{user:{id:'new-user'}}};},deleteUser:async()=>{newUserDeleted=true;return{};}},signInWithPassword:async()=>passwordFails?{error:{message:'invalid'}}:{data:{session:{access_token:'test-access',refresh_token:'test-refresh'}}}},rpc:async(name,args)=>{
 calls.push({name,args});
 if(name==='resolve_company_invitation')return{data:{id:'invitation',email:'invited@test.invalid',company_id:'company',company_name:'Test <company>',department_name:'Main',existing_user_id:existing?'existing-user':null}};
 if(name==='accept_company_email_invitation')return acceptFails?{error:{message:'Account already belongs to another company'}}:{data:{role:'employee'}};
 if(args.p_actor!=='owner')return{error:{message:'Network manager required'}};
 if(args.p_mode==='send')draftHash=args.p_token_hash;
 return{data:{id:'invitation',email:'invited@test.invalid',department_name:'Main',company_name:'Test <company>'}};
}});
globalThis.fetch=async(url,options)=>{assert.equal(url,'https://api.resend.com/emails');sentMail=JSON.parse(options.body);return new Response('{}',{status:mailFails?500:200});};
const source=(await readFile('supabase/functions/company-invitations/index.ts','utf8')).replace(/import \{ createClient \} from [^;]+;/,'const createClient=globalThis.__createClient;');
const compiled=stripTypeScriptTypes(source,{mode:'transform'});
await import('data:text/javascript;base64,'+Buffer.from(compiled).toString('base64'));
const request=async(body,token)=>{const r=await handler(new Request('https://test.invalid',{method:'POST',headers:{'content-type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:JSON.stringify(body)}));return{status:r.status,body:await r.json()};};
assert.equal((await request({mode:'send',invitation_id:'invitation'})).status,401);
assert.equal((await request({mode:'info',token:'short'})).status,400);
const info=await request({mode:'info',token:'a'.repeat(43)});assert.equal(info.body.email,'invited@test.invalid');assert.equal('existing_user_id' in info.body,false);
const sent=await request({mode:'send',invitation_id:'invitation'},'owner-session');assert.equal(sent.status,200);assert.deepEqual(Object.keys(sent.body.data).sort(),['email','id','status']);assert.match(draftHash,/^[a-f0-9]{64}$/);assert.deepEqual(sentMail.to,['invited@test.invalid']);assert.match(sentMail.html,/Test &lt;company&gt;/);assert.match(sentMail.text,/https:\/\/app-check.ru\/app\/#invite_token=[A-Za-z0-9_-]{43}/);assert.equal(JSON.stringify(sent.body).includes('invite_token'),false);
mailFails=true;assert.equal((await request({mode:'send',invitation_id:'invitation'},'owner-session')).status,400);assert.equal(calls.at(-1).args.p_delivered,false);mailFails=false;
assert.equal((await request({mode:'accept',token:'a'.repeat(43),name:'Name',password:'test-password',password_repeat:'wrong'})).status,400);
const accepted=await request({mode:'accept',token:'a'.repeat(43),name:'Name',password:'test-password',password_repeat:'test-password',role:'manager',email:'attacker@test.invalid'});assert.equal(accepted.body.session.access_token,'test-access');assert.equal(calls.findLast(x=>x.name==='accept_company_email_invitation').args.p_actor,'new-user');assert.equal('p_role' in calls.findLast(x=>x.name==='accept_company_email_invitation').args,false);
existing=true;passwordFails=true;let before=calls.filter(x=>x.name==='accept_company_email_invitation').length;assert.equal((await request({mode:'accept',token:'a'.repeat(43),name:'Name',password:'wrong-password'})).status,400);assert.equal(calls.filter(x=>x.name==='accept_company_email_invitation').length,before);passwordFails=false;existing=false;acceptFails=true;
assert.equal((await request({mode:'accept',token:'a'.repeat(43),name:'Name',password:'test-password',password_repeat:'test-password'})).status,400);assert.equal(newUserDeleted,true);
console.log('PASS: invitation Edge authentication, email binding, HTML escaping, link privacy, delivery failure recovery, password checks, supplied role ignored, orphan Auth cleanup (stubbed Auth/Resend)');
