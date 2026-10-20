import { createClient } from 'npm:@supabase/supabase-js@2.114.0';

const cors = {'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, apikey, content-type, x-client-info','Access-Control-Allow-Methods':'POST, OPTIONS','Cache-Control':'no-store'};
const reply = (value: unknown, status=200) => new Response(JSON.stringify(value),{status,headers:{...cors,'Content-Type':'application/json'}});
const escape = (s: string) => s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const hash = async (s: string) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s))),b=>b.toString(16).padStart(2,'0')).join('');
Deno.serve(async req => {
 if(req.method==='OPTIONS')return new Response(null,{headers:cors});
 if(req.method!=='POST')return reply({error:'Метод не поддерживается'},405);
 const url=Deno.env.get('SUPABASE_URL')!, key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
 const client=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:(input,init)=>fetch(input,{...init,signal:AbortSignal.timeout(18000)})}});
 let createdUser: string|null=null, accepted=false;
 try {
  const raw=await req.text();if(raw.length>16000)throw new Error('Слишком большой запрос');
  const body=JSON.parse(raw), mode=body.mode;
  const rpc=async(name:string,args:Record<string,unknown>)=>{const {data,error}=await client.rpc(name,args);if(error)throw error;return data;};
  if(['info','accept'].includes(mode)){
   if(typeof body.token!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(body.token))throw new Error('Приглашение недействительно или истекло');
   const digest=await hash(body.token);
   const invitation=await rpc('resolve_company_invitation',{p_token_hash:digest});
   if(mode==='info')return reply({email:invitation.email,company_name:invitation.company_name,department_name:invitation.department_name,existing_account:!!invitation.existing_user_id});
   const name=String(body.name||'').trim(), password=body.password;
   if(!name||name.length>100)throw new Error('Укажите имя (до 100 символов)');
   if(typeof password!=='string'||password.length<8||password.length>256)throw new Error('Пароль должен содержать от 8 до 256 символов');
   const authClient=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:(input,init)=>fetch(input,{...init,signal:AbortSignal.timeout(18000)})}});
   let actor=invitation.existing_user_id;
   if(actor){
    // Existing accounts must prove knowledge of their password; invitations never reset it.
    const {error}=await authClient.auth.signInWithPassword({email:invitation.email,password});
    if(error)throw new Error('Не удалось войти. Введите действующий пароль аккаунта или восстановите его на странице входа.');
   }else{
    if(body.password_repeat!==password)throw new Error('Пароли не совпадают');
    const {data,error}=await client.auth.admin.createUser({email:invitation.email,password,email_confirm:true,user_metadata:{name}});
    if(error||!data.user)throw new Error('Не удалось создать аккаунт. Повторите попытку или войдите в существующий аккаунт.');
    actor=data.user.id;createdUser=actor;
   }
   await rpc('accept_company_email_invitation',{p_actor:actor,p_token_hash:digest,p_name:name});accepted=true;
   const {data,error}=await authClient.auth.signInWithPassword({email:invitation.email,password});
   if(error||!data.session)return reply({accepted:true,sign_in_required:true});
   return reply({accepted:true,session:{access_token:data.session.access_token,refresh_token:data.session.refresh_token}});
  }
  if(!['create','send','list','revoke'].includes(mode))throw new Error('Неизвестное действие');
  const bearer=req.headers.get('Authorization')?.replace(/^Bearer\s+/i,'');
  if(!bearer)return reply({error:'Войдите в аккаунт'},401);
  const {data:identity,error:authError}=await client.auth.getUser(bearer);
  if(authError||!identity.user)return reply({error:'Сессия истекла. Войдите снова'},401);
  const args={p_actor:identity.user.id,p_mode:mode,p_email:typeof body.email==='string'?body.email.trim().toLowerCase():null,p_department:body.department_id||null,p_invitation:body.invitation_id||null};
  if(mode!=='send')return reply({data:await rpc('company_invitation_admin',args)});
  const bytes=crypto.getRandomValues(new Uint8Array(32));
  const token=btoa(String.fromCharCode(...bytes)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
  const digest=await hash(token);
  const invitation=await rpc('company_invitation_admin',{...args,p_token_hash:digest});
  const link='https://app-check.ru/app/#invite_token='+token;
  let delivered=false;
  try{
   const response=await fetch('https://api.resend.com/emails',{method:'POST',signal:AbortSignal.timeout(18000),headers:{Authorization:'Bearer '+Deno.env.get('RESEND_API_KEY'),'Content-Type':'application/json'},body:JSON.stringify({
    from:'Check App <noreply@sale-trener.ru>',to:[invitation.email],subject:'Приглашение в '+invitation.company_name+' — Check App',
    text:`Вас пригласили в ${invitation.company_name}, подразделение ${invitation.department_name}. Откройте ссылку и задайте имя и пароль: ${link}\nВы присоединитесь как сотрудник. Ссылка действует 7 дней.`,
    html:`<html lang="ru"><body style="font-family:Arial,sans-serif;color:#172033;padding:24px"><h1>Check App</h1><h2>Приглашение в ${escape(invitation.company_name)}</h2><p>Подразделение: ${escape(invitation.department_name)}.</p><p>Откройте ссылку, укажите имя и создайте пароль. Для существующего аккаунта используйте действующий пароль.</p><p><a style="display:inline-block;padding:16px 24px;background:#6350ed;color:white;border-radius:12px" href="${link}">Присоединиться к компании</a></p><p>Вы получите роль сотрудника. Ссылка действует 7 дней и используется один раз.</p><p>Если кнопка не открывается: <a href="${link}">${link}</a></p><p>Если вы не ожидали приглашение, проигнорируйте письмо.</p></body></html>`
   })});
   if(!response.ok)throw new Error('Почтовый сервис не принял письмо');
   delivered=true;
  }finally{await rpc('company_invitation_admin',{...args,p_mode:'finish',p_token_hash:digest,p_delivered:delivered});}
  return reply({data:{id:invitation.id,status:'pending',email:invitation.email}});
 }catch(error){
  if(createdUser&&!accepted){
   const {data,error:readError}=await client.from('profiles').select('id').eq('id',createdUser).maybeSingle();
   if(!readError&&!data)await client.auth.admin.deleteUser(createdUser);
  }
  // Never log request bodies, invitation capabilities, sessions or passwords.
  const message=error instanceof Error?error.message:String((error as {message?:string})?.message||'Не удалось выполнить действие');
  const translated:Record<string,string>={'Network manager required':'Доступ только руководителю сети','Invitation invalid or expired':'Приглашение недействительно или истекло','Employee already belongs to this company':'Этот сотрудник уже состоит в компании','Account already belongs to another company':'Аккаунт уже состоит в другой компании','Invitation rate limit reached':'Лимит приглашений. Повторите через час','Invitation is being sent':'Письмо уже отправляется. Подождите','Invitation cooldown':'Повторная отправка доступна через минуту','Invitation is closed':'Приглашение закрыто','Invalid department':'Выберите подразделение компании'};
  return reply({error:translated[message]||message},400);
 }
});
