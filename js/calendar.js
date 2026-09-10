// Check App — informational maintenance calendar
(function () {
  'use strict';

  let month = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  let selected = null;

  const pad = n => String(n).padStart(2, '0');
  const iso = (y, m, d) => `${y}-${pad(m + 1)}-${pad(d)}`;
  const parse = s => { const [y,m,d] = String(s).split('-').map(Number); return new Date(y, (m || 1)-1, d || 1); };
  const addDays = (s, n) => { const d = parse(s); d.setDate(d.getDate()+n); return iso(d.getFullYear(),d.getMonth(),d.getDate()); };
  const title = d => { const s=d.toLocaleDateString('ru-RU',{month:'long',year:'numeric'}); return s.charAt(0).toUpperCase()+s.slice(1); };

  function company(){ return typeof getCompany === 'function' ? getCompany() : null; }
  function dept(){ return typeof getActiveDeptId === 'function' ? getActiveDeptId() : null; }
  function actions(){
    const c=company(), id=dept(); if(!c) return [];
    return (c.actions||[]).filter(a => a.departmentId===id && (!isDepartmentActive || isDepartmentActive(a.departmentId)) && (!isEquipmentActive || isEquipmentActive(a.equipmentId)));
  }
  function tasks(date){
    const c=company(); if(!c) return [];
    const saved=(typeof getDeptTasks==='function' ? getDeptTasks(date) : (c.tasks||[]).filter(t=>t.date===date && t.departmentId===dept())) || [];
    const ids=new Set(saved.map(t=>t.actionId).filter(Boolean));
    const today=typeof todayStr==='function' ? todayStr() : iso(new Date().getFullYear(),new Date().getMonth(),new Date().getDate());
    if(date < today) return saved;
    const out=[...saved];
    actions().forEach(a=>{
      if(ids.has(a.id)) return;
      const freq=Math.max(1,Number(a.frequency)||1);
      const last=(c.completions||[]).filter(x=>x.actionId===a.id).sort((x,y)=>String(y.date).localeCompare(String(x.date)))[0];
      let first=last ? addDays(last.date,freq) : today;
      if(first<today) first=today;
      if(date<first) return;
      const diff=Math.round((parse(date)-parse(first))/86400000);
      if(diff%freq) return;
      const e=(c.equipment||[]).find(x=>x.id===a.equipmentId);
      out.push({id:`calendar-${a.id}-${date}`,actionId:a.id,equipmentId:a.equipmentId,departmentId:a.departmentId,date,status:'planned',title:a.name,equipName:e?.name||'—',equipCode:e?.code||'',description:a.description||'',forecast:true});
    });
    return out;
  }

  function ensureNav(){
    const app=document.getElementById('app-screen'); if(!app) return;
    let nav=document.getElementById('calendar-nav');
    if(!nav){
      nav=document.createElement('nav'); nav.id='calendar-nav';
      nav.className='bg-slate-900 border-b border-slate-800';
      nav.innerHTML='<div class="max-w-5xl mx-auto px-2 flex overflow-x-auto scroll-thin"><button type="button" data-calendar-open class="nav-btn flex-shrink-0 px-4 py-3 text-sm font-medium border-b-2 border-primary-500 text-primary-400 hover:text-white transition">📅 Календарь</button></div>';
      const deptBar=document.getElementById('dept-bar');
      const manager=document.getElementById('manager-nav');
      if(deptBar?.parentNode===app) deptBar.insertAdjacentElement('afterend',nav);
      else if(manager?.parentNode===app) manager.insertAdjacentElement('beforebegin',nav);
      else app.insertBefore(nav,app.querySelector('main'));
    }
    const b=nav.querySelector('[data-calendar-open]');
    if(b && !b.dataset.bound){ b.dataset.bound='1'; b.addEventListener('click',open); }
  }

  function ensureFloatingAccess(){
    let b=document.getElementById('calendar-floating-access');
    if(!b){
      b=document.createElement('button'); b.id='calendar-floating-access'; b.type='button'; b.textContent='📅 Календарь';
      b.setAttribute('aria-label','Открыть календарь');
      b.style.cssText='position:fixed;right:18px;bottom:18px;z-index:9999;padding:12px 18px;border-radius:14px;border:1px solid #38bdf8;background:#0ea5e9;color:#fff;font-weight:700;font-size:14px;box-shadow:0 8px 24px rgba(0,0,0,.35);cursor:pointer;display:none;';
      b.onclick=open; document.body.appendChild(b);
    }
    const app=document.getElementById('app-screen');
    b.style.display=app && !app.classList.contains('hidden') ? 'block' : 'none';
  }

  function ensurePage(){
    const main=document.querySelector('#app-screen main'); if(!main) return;
    if(document.getElementById('page-calendar')) return;
    const p=document.createElement('div'); p.id='page-calendar'; p.className='page hidden space-y-5 fade-in';
    p.innerHTML=`<div class="flex items-center justify-between gap-3 flex-wrap"><div><h1 class="text-2xl sm:text-3xl font-bold">Календарь</h1><p class="text-sm text-slate-400 mt-1">Информационный календарь плановых работ и обслуживания</p></div><button type="button" id="calendar-today-btn" class="px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-sm">Сегодня</button></div>
      <div class="grid grid-cols-1 lg:grid-cols-[1.2fr_0.9fr] gap-5 items-start"><section class="bg-slate-900 border border-slate-800 rounded-2xl p-4 sm:p-5"><div class="flex items-center justify-between mb-5"><button type="button" id="calendar-prev" class="w-10 h-10 rounded-xl bg-slate-800 border border-slate-700 text-xl">‹</button><div id="calendar-month-title" class="font-semibold"></div><button type="button" id="calendar-next" class="w-10 h-10 rounded-xl bg-slate-800 border border-slate-700 text-xl">›</button></div><div class="grid grid-cols-7 gap-2 text-center text-xs font-medium text-slate-500 mb-2"><div>Пн</div><div>Вт</div><div>Ср</div><div>Чт</div><div>Пт</div><div>Сб</div><div>Вс</div></div><div id="calendar-grid" class="grid grid-cols-7 gap-2"></div><div class="flex flex-wrap gap-4 mt-5 pt-4 border-t border-slate-800 text-xs text-slate-400"><span class="flex items-center gap-2"><i class="w-5 h-5 rounded-md bg-white border border-slate-300"></i>Задач нет</span><span class="flex items-center gap-2"><i class="w-5 h-5 rounded-md bg-sky-500"></i>Есть задача</span></div></section>
      <section class="bg-slate-900 border border-slate-800 rounded-2xl p-4 sm:p-5"><div class="flex items-center justify-between mb-4"><div><h2 id="calendar-selected-title" class="font-semibold text-lg">Выберите дату</h2><p class="text-xs text-slate-500 mt-1">Информация о работах</p></div><span id="calendar-selected-count" class="text-xs px-2.5 py-1 rounded-full bg-slate-800 text-slate-400">0</span></div><div id="calendar-task-list" class="space-y-3"></div><div id="calendar-empty" class="text-center py-10 text-slate-500 text-sm">На выбранную дату задач нет</div></section></div>`;
    main.appendChild(p);
    bind();
  }

  function bind(){
    const p=document.getElementById('page-calendar'); if(!p || p.dataset.bound) return; p.dataset.bound='1';
    document.getElementById('calendar-prev').onclick=()=>{month=new Date(month.getFullYear(),month.getMonth()-1,1);selected=null;render();};
    document.getElementById('calendar-next').onclick=()=>{month=new Date(month.getFullYear(),month.getMonth()+1,1);selected=null;render();};
    document.getElementById('calendar-today-btn').onclick=()=>{const d=new Date();month=new Date(d.getFullYear(),d.getMonth(),1);selected=todayStr();render();};
  }

  function render(){
    ensurePage(); ensureNav(); ensureFloatingAccess(); bind();
    const grid=document.getElementById('calendar-grid'), mt=document.getElementById('calendar-month-title'); if(!grid||!mt) return;
    mt.textContent=title(month); grid.innerHTML='';
    const y=month.getFullYear(),m=month.getMonth(), days=new Date(y,m+1,0).getDate(), first=(new Date(y,m,1).getDay()+6)%7, today=todayStr();
    for(let i=0;i<first;i++){const x=document.createElement('div');x.className='aspect-square min-h-[42px]';grid.appendChild(x);}
    for(let d=1;d<=days;d++){
      const ds=iso(y,m,d), has=tasks(ds).length, b=document.createElement('button'); b.type='button'; b.className='aspect-square min-h-[42px] rounded-xl border font-semibold text-sm flex items-center justify-center relative '+(has?'bg-sky-500 border-sky-400 text-white':'bg-white border-slate-300 text-slate-900')+(selected===ds?' ring-2 ring-primary-400 ring-offset-2 ring-offset-slate-900':''); b.textContent=d; if(ds===today)b.title='Сегодня'; b.onclick=()=>{selected=ds;render();}; grid.appendChild(b);
    }
    if(!selected || parse(selected).getMonth()!==m || parse(selected).getFullYear()!==y) selected=today.startsWith(`${y}-${pad(m+1)}`)?today:iso(y,m,1);
    const list=document.getElementById('calendar-task-list'), empty=document.getElementById('calendar-empty'), st=document.getElementById('calendar-selected-title'), count=document.getElementById('calendar-selected-count'); const ts=tasks(selected); st.textContent=formatDate(selected); count.textContent=ts.length; empty.classList.toggle('hidden',!!ts.length); list.innerHTML=ts.map(t=>`<div class="bg-slate-800/60 border border-slate-700 rounded-xl p-4"><div class="font-semibold">${esc(t.title)}</div><div class="text-sm text-slate-400 mt-1">${esc(t.equipName||'—')}</div>${t.equipCode?`<div class="text-xs text-slate-500 mt-1">${esc(t.equipCode)}</div>`:''}<div class="mt-3 text-[11px] px-2.5 py-1 rounded-full inline-block ${t.status==='done'?'bg-emerald-500/20 text-emerald-400':t.forecast?'bg-sky-500/15 text-sky-300':'bg-amber-500/20 text-amber-400'}">${t.status==='done'?'✓ Выполнено':t.forecast?'Запланировано':'Ожидает'}</div></div>`).join('');
  }

  function open(){
    ensurePage(); ensureNav(); ensureFloatingAccess(); document.querySelectorAll('.page').forEach(x=>x.classList.add('hidden')); document.getElementById('page-calendar')?.classList.remove('hidden'); render();
  }

  function boot(){
    ensurePage(); ensureNav(); ensureFloatingAccess();
    const old=window.showPage;
    if(typeof old==='function'&&!old.__calendarWrapped){
      const wrap=function(page){if(page==='calendar'){open();return;}return old(page);};
      wrap.__calendarWrapped=true; window.showPage=wrap;
    }
  }
  document.addEventListener('DOMContentLoaded',boot);
  boot();
  setTimeout(boot,100); setTimeout(boot,500); setTimeout(boot,1500); setInterval(boot,2000);
  window.openCalendar=open;
})();

// Auth hotfix: Supabase's current JavaScript API verifies email signup OTPs with type:'email'.
(function () {
  'use strict';
  const PUBLIC_AUTH_URL = 'https://www.app-check.ru/';

  function installOtpFix() {
    try {
      if (typeof supabaseClient === 'undefined' || !supabaseClient?.auth) return;
      const auth = supabaseClient.auth;
      if (auth.__checkAppOtpFixInstalled) return;
      const originalVerifyOtp = auth.verifyOtp.bind(auth);
      const originalSignUp = auth.signUp.bind(auth);
      const originalResend = auth.resend.bind(auth);
      const originalResetPasswordForEmail = auth.resetPasswordForEmail.bind(auth);

      auth.verifyOtp = function (params) {
        if (params && params.type === 'signup' && params.email && params.token) return originalVerifyOtp({ ...params, type: 'email' });
        return originalVerifyOtp(params);
      };

      // Always send production auth links to the real Check App domain.
      // This prevents local development URLs such as http://localhost:3000/
      // from being embedded into confirmation/recovery emails.
      auth.signUp = function (credentials) {
        const next = { ...(credentials || {}), options: { ...((credentials || {}).options || {}), emailRedirectTo: PUBLIC_AUTH_URL } };
        return originalSignUp(next);
      };

      auth.resend = function (credentials) {
        if (credentials?.type === 'signup') {
          return originalResend({ ...credentials, options: { ...(credentials.options || {}), emailRedirectTo: PUBLIC_AUTH_URL } });
        }
        return originalResend(credentials);
      };

      auth.resetPasswordForEmail = function (email, options) {
        return originalResetPasswordForEmail(email, { ...(options || {}), redirectTo: PUBLIC_AUTH_URL });
      };

      auth.__checkAppOtpFixInstalled = true;
    } catch (e) { console.error('[Check App] Auth compatibility fix failed', e); }
  }
  installOtpFix(); setTimeout(installOtpFix,100); setTimeout(installOtpFix,500);
})();

// Password recovery UI and Supabase password reset flow.
(function () {
  'use strict';
  let recoveryMode = false;
  let resetCooldownUntil = 0;
  let signupResendCooldownUntil = 0;
  function ensureButton() {
    const form = document.getElementById('form-login');
    if (!form || document.getElementById('forgot-password-btn')) return;
    const b = document.createElement('button');
    b.id = 'forgot-password-btn'; b.type = 'button'; b.textContent = 'Забыли пароль?';
    b.className = 'w-full mt-1 py-2 text-sm text-primary-400 hover:text-primary-300 transition';
    b.onclick = openResetModal;
    form.appendChild(b);
  }
  function ensureSignupResendButtons() {
    const configs = [
      { formId:'form-register', buttonId:'resend-signup-email-btn', inputId:'reg-email', mode:'register' },
      { formId:'form-invite', buttonId:'resend-invite-email-btn', inputId:'invite-email', mode:'invite' }
    ];
    configs.forEach(({formId,buttonId,inputId,mode})=>{
      const form=document.getElementById(formId); if(!form || document.getElementById(buttonId)) return;
      const b=document.createElement('button'); b.id=buttonId; b.type='button'; b.textContent='Не получили письмо? Отправить ещё раз';
      b.className='w-full py-2 text-sm text-primary-400 hover:text-primary-300 transition';
      b.onclick=()=>resendSignupConfirmation(mode,inputId,b);
      form.appendChild(b);
    });
  }
  function ensureModal() {
    if (document.getElementById('password-reset-modal')) return;
    const d = document.createElement('div');
    d.id='password-reset-modal'; d.className='fixed inset-0 bg-slate-950/90 backdrop-blur-sm z-[200] hidden items-center justify-center p-4';
    d.innerHTML=`<div class="w-full max-w-md bg-slate-900 border border-slate-700 rounded-2xl p-6 shadow-2xl"><div class="text-center"><div id="password-reset-title" class="text-xl font-bold text-white">Восстановление пароля</div><p id="password-reset-message" class="text-slate-400 text-sm mt-2">Введите email, на который отправить ссылку для восстановления.</p></div><div id="password-reset-email-wrap" class="mt-6"><label class="block text-xs font-medium text-slate-400 mb-1.5">Email</label><input id="password-reset-email" type="email" autocomplete="email" placeholder="you@company.ru" class="w-full bg-slate-950 border border-slate-700 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500" /></div><div id="password-reset-password-wrap" class="hidden mt-6 space-y-3"><div><label class="block text-xs font-medium text-slate-400 mb-1.5">Новый пароль</label><input id="password-reset-password" type="password" placeholder="минимум 8 символов" class="w-full bg-slate-950 border border-slate-700 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500" /></div><div><label class="block text-xs font-medium text-slate-400 mb-1.5">Повторите пароль</label><input id="password-reset-password2" type="password" placeholder="повторите пароль" class="w-full bg-slate-950 border border-slate-700 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500" /></div></div><p id="password-reset-status" class="text-sm text-center mt-4 min-h-[20px]"></p><div class="grid grid-cols-2 gap-3 mt-5"><button type="button" onclick="closePasswordResetModal()" class="py-3 rounded-xl border border-slate-700 text-slate-300 hover:bg-slate-800 transition">Отмена</button><button id="password-reset-submit" type="button" onclick="submitPasswordReset()" class="py-3 rounded-xl bg-primary-600 hover:bg-primary-500 text-white font-semibold transition">Отправить</button></div><button id="password-reset-resend" type="button" class="w-full mt-3 py-2 text-sm text-primary-400 hover:text-primary-300 transition">Отправить ссылку ещё раз</button></div>`;
    document.body.appendChild(d);
    document.getElementById('password-reset-resend').onclick=()=>resendPasswordReset();
  }
  function openResetModal() {
    ensureModal(); recoveryMode=false;
    document.getElementById('password-reset-title').textContent='Восстановление пароля';
    document.getElementById('password-reset-message').textContent='Введите email, на который отправить ссылку для восстановления.';
    document.getElementById('password-reset-email-wrap').classList.remove('hidden');
    document.getElementById('password-reset-password-wrap').classList.add('hidden');
    document.getElementById('password-reset-submit').textContent='Отправить';
    document.getElementById('password-reset-resend').classList.add('hidden');
    document.getElementById('password-reset-status').textContent='';
    const loginEmail=document.getElementById('login-email'); if(loginEmail?.value) document.getElementById('password-reset-email').value=loginEmail.value.trim().toLowerCase();
    const d=document.getElementById('password-reset-modal'); d.classList.remove('hidden'); d.classList.add('flex');
  }
  window.closePasswordResetModal=function(){ const d=document.getElementById('password-reset-modal'); if(d)d.classList.add('hidden'); };
  async function sendPasswordReset(email,status){
    try {
      const {error}=await supabaseClient.auth.resetPasswordForEmail(email,{redirectTo:'https://www.app-check.ru/'});
      if(error) throw error;
      resetCooldownUntil=Date.now()+60000;
      status.className='text-sm text-center mt-4 min-h-[20px] text-emerald-400'; status.textContent='Письмо отправлено. Проверьте почту и Спам. Новую ссылку можно запросить через 60 секунд.';
      const resend=document.getElementById('password-reset-resend');
      if(resend){resend.classList.remove('hidden'); startCooldown(resend,()=>resetCooldownUntil);}
      return true;
    } catch(error){
      console.error('[Check App] Password reset request failed:',error);
      status.className='text-sm text-center mt-4 min-h-[20px] text-red-400'; status.textContent=error?.message||'Не удалось отправить письмо.';
      return false;
    }
  }
  function startCooldown(button,getUntil){
    if(!button || button.dataset.cooldown==='1') return;
    button.dataset.cooldown='1';
    const tick=()=>{
      const left=Math.max(0,Math.ceil((getUntil()-Date.now())/1000));
      if(left>0){button.disabled=true;button.textContent=`Повторить через ${left} сек.`;setTimeout(tick,1000);}
      else{button.disabled=false;button.textContent='Отправить ссылку ещё раз';button.dataset.cooldown='0';}
    };
    tick();
  }
  window.submitPasswordReset=async function(){
    ensureModal(); const status=document.getElementById('password-reset-status');
    if(recoveryMode){
      const p=document.getElementById('password-reset-password').value, p2=document.getElementById('password-reset-password2').value;
      if(p.length<8){status.textContent='Пароль должен содержать минимум 8 символов.';return;}
      if(p!==p2){status.textContent='Пароли не совпадают.';return;}
      const {error}=await supabaseClient.auth.updateUser({password:p});
      if(error){status.textContent=error.message||'Не удалось изменить пароль.';return;}
      status.className='text-sm text-center mt-4 min-h-[20px] text-emerald-400'; status.textContent='Пароль изменён. Теперь можно войти.';
      setTimeout(()=>{window.closePasswordResetModal();window.location.hash='';window.location.reload();},1200); return;
    }
    const email=document.getElementById('password-reset-email').value.trim().toLowerCase();
    if(!email){status.textContent='Введите email.';return;}
    status.textContent='Отправляем письмо…';
    await sendPasswordReset(email,status);
  };
  async function resendPasswordReset(){
    ensureModal();
    const status=document.getElementById('password-reset-status');
    const email=document.getElementById('password-reset-email').value.trim().toLowerCase();
    if(!email){status.textContent='Введите email.';return;}
    if(Date.now()<resetCooldownUntil){startCooldown(document.getElementById('password-reset-resend'),()=>resetCooldownUntil);return;}
    status.textContent='Отправляем новую ссылку…';
    await sendPasswordReset(email,status);
  }
  async function resendSignupConfirmation(mode,inputId,button){
    const email=document.getElementById(inputId)?.value?.trim().toLowerCase();
    if(!email){showError('Сначала укажите Email.');return;}
    if(Date.now()<signupResendCooldownUntil){startSignupCooldown(button);return;}
    button.disabled=true; button.textContent='Отправляем…';
    try{
      const {error}=await supabaseClient.auth.resend({type:'signup',email,options:{emailRedirectTo:'https://www.app-check.ru/'}});
      if(error) throw error;
      signupResendCooldownUntil=Date.now()+60000;
      const company=document.getElementById('reg-company')?.value?.trim()||'';
      const name=document.getElementById('reg-name')?.value?.trim()||document.getElementById('invite-name')?.value?.trim()||'';
      const code=mode==='register' ? (pendingEmail?.code || '') : (document.getElementById('invite-code')?.value?.trim()||pendingEmail?.code||'');
      pendingEmail={mode,email,name,company,code};
      openEmailConfirmationModal(email);
      const status=document.getElementById('otp-status');
      if(status){status.textContent='Новое письмо отправлено. Используйте только последнюю ссылку/код.';status.className='text-sm text-center mt-4 min-h-[20px] text-emerald-400';}
      startSignupCooldown(button);
    }catch(e){
      console.error('[Check App] signup resend failed:',e);
      button.disabled=false;button.textContent='Не получили письмо? Отправить ещё раз';
      showError(e?.message||'Не удалось отправить письмо повторно.');
    }
  }
  function startSignupCooldown(button){
    if(!button)return;
    button.disabled=true;
    const tick=()=>{const left=Math.max(0,Math.ceil((signupResendCooldownUntil-Date.now())/1000));if(left>0){button.textContent=`Повторить через ${left} сек.`;setTimeout(tick,1000);}else{button.disabled=false;button.textContent='Не получили письмо? Отправить ещё раз';}};
    tick();
  }
  function openRecovery(){
    ensureModal(); recoveryMode=true;
    document.getElementById('password-reset-title').textContent='Новый пароль';
    document.getElementById('password-reset-message').textContent='Введите новый пароль для аккаунта.';
    document.getElementById('password-reset-email-wrap').classList.add('hidden');
    document.getElementById('password-reset-password-wrap').classList.remove('hidden');
    document.getElementById('password-reset-submit').textContent='Изменить пароль';
    document.getElementById('password-reset-resend').classList.add('hidden');
    document.getElementById('password-reset-status').textContent='';
    const d=document.getElementById('password-reset-modal'); d.classList.remove('hidden'); d.classList.add('flex');
  }
  function checkRecovery(){ const hash=window.location.hash||'', search=window.location.search||''; if(/type=recovery/.test(hash)||/type=recovery/.test(search)) openRecovery(); }
  function installRecoveryListener(){
    try {
      if (typeof supabaseClient === 'undefined' || !supabaseClient?.auth || supabaseClient.auth.__checkAppRecoveryListenerInstalled) return;
      const { data } = supabaseClient.auth.onAuthStateChange((event) => {
        if (event === 'PASSWORD_RECOVERY') openRecovery();
      });
      supabaseClient.auth.__checkAppRecoveryListenerInstalled = true;
      supabaseClient.auth.__checkAppRecoveryListenerSubscription = data?.subscription || null;
    } catch (e) {
      console.error('[Check App] Recovery listener failed:', e);
    }
  }
  document.addEventListener('DOMContentLoaded',()=>{ensureButton();ensureSignupResendButtons();ensureModal();installRecoveryListener();checkRecovery();setTimeout(()=>{ensureButton();ensureSignupResendButtons();installRecoveryListener();checkRecovery();},300);setTimeout(()=>{installRecoveryListener();checkRecovery();},1200);});
  setTimeout(ensureButton,100); setTimeout(ensureButton,500); setTimeout(ensureSignupResendButtons,100); setTimeout(ensureSignupResendButtons,500); setTimeout(installRecoveryListener,100); setTimeout(installRecoveryListener,500);
})();
