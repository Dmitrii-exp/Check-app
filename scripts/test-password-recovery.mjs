import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync('js/app.js','utf8');
const start=source.indexOf('    async function sendPasswordRecovery()');
const end=source.indexOf('    async function saveRecoveredPassword()',start);
let email='',message='',calls=[];
const button={disabled:false};
const context=vm.createContext({console,ensureSupabase:()=>true,document:{getElementById:id=>id==='recovery-email'?{value:email}:button},recoveryMessage:m=>message=m,isNativeCheckApp:()=>false,AUTH_PUBLIC_URL:'https://app-check.ru/app/',AUTH_MOBILE_RECOVERY_URL:'checkapp://auth',supabaseClient:{auth:{resetPasswordForEmail:async(e,opts)=>{calls.push({email:e,options:opts});return{error:null};}}}});
vm.runInContext(source.slice(start,end),context);
for(const valid of ['yefimenko.dmitriy.95@gmail.com','expert-26@yandex.ru','sales+test@example.com','  USER@EXAMPLE.COM  ']){
 email=valid;calls=[];message='';await context.sendPasswordRecovery();assert.equal(calls.length,1);assert.equal(calls[0].email,valid.trim().toLowerCase());assert.match(message,/письмо для восстановления отправлено/);assert.equal(button.disabled,false);
}
for(const invalid of ['','no-at-sign','user@example','user name@example.com','user@@example.com']){
 email=invalid;calls=[];await context.sendPasswordRecovery();assert.equal(calls.length,0);assert.match(message,/корректный Email/);
}
console.log('PASS: recovery accepts reported Gmail, Yandex, plus addressing and normalized input; malformed addresses never call Auth');
