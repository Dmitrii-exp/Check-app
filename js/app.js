// =========================
    // Supabase connection
    // =========================
    const SUPABASE_URL = 'https://qaxoufarhpagcjkhptga.supabase.co';
    const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_ZMXWb57L46oreSiZJvCe5Q_JXG-IC-u';
    const supabaseClient = (window.supabase && typeof window.supabase.createClient === 'function')
      ? window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY)
      : null;
    function ensureSupabase(){
      if (supabaseClient) return true;
      showError('Не загрузился модуль Supabase. Скачайте файл на компьютер и откройте его обычным браузером с доступом в интернет. Не запускайте его во встроенном просмотрщике ChatGPT.');
      return false;
    }

    const STORAGE_KEY = 'checkapp_v3';

    const PLANS = {
      free:     { id:'free',     name:'Бесплатная', maxDepts:1,  maxEquip:5,  price:0,    days:0 },
      lite:     { id:'lite',     name:'Лайт',       maxDepts:1,  maxEquip:10, price:490,  days:30 },
      standard: { id:'standard', name:'Стандарт',   maxDepts:3,  maxEquip:10, price:1290, days:30 },
      standard_plus: { id:'standard_plus', name:'Стандарт+', maxDepts:5, maxEquip:15, price:2090, days:30 },
      premium:  { id:'premium',  name:'Премиум',    maxDepts:10, maxEquip:20, price:3690, days:30 },
      ultra:    { id:'ultra',    name:'Ультра',     maxDepts:20, maxEquip:25, price:6490, days:30 }
    };

    let db = loadDB();
    let currentPhotoBase64 = null;
    let currentPhotoFile = null;
    let currentCompleteTaskId = null;
    let currentDeptId = null;
    let cloudSyncTimer = null;
    let cloudSyncBusy = false;

    function loadDB() {
      // Business data is now loaded from Supabase after authentication.
      // localStorage is kept only for harmless UI compatibility; it is no longer
      // the source of truth for companies, users, equipment or tasks.
      return { companies: {}, currentUser: null };
    }

    function saveDB() {
      clearTimeout(cloudSyncTimer);
      cloudSyncTimer = setTimeout(() => syncCurrentCompany().catch(console.error), 250);
    }

    function uid() {
      if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
      throw new Error('Криптографический генератор UUID недоступен в этом браузере.');
    }

    function normalizePhone(phone) {
      return String(phone || '').replace(/[^0-9+]/g, '');
    }

    function cloudError(error, fallback='Ошибка синхронизации с сервером.') {
      if (error) {
        console.error('Supabase:', error);
        toast(error.message || fallback);
        return true;
      }
      return false;
    }

    async function hydrateCurrentUser() {
      const { data: authData } = await supabaseClient.auth.getUser();
      const authUser = authData?.user;
      if (!authUser) return false;

      const { data: profile, error: profileError } = await supabaseClient
        .from('profiles').select('*').eq('id', authUser.id).maybeSingle();

      if (profileError) throw profileError;
      if (!profile) return false;

      const { data: company, error: companyError } = await supabaseClient
        .from('companies').select('*').eq('id', profile.company_id).single();
      if (companyError) throw companyError;

      const [
        { data: departments, error: dErr },
        { data: equipment, error: eErr },
        { data: actions, error: aErr },
        { data: tasks, error: tErr },
        { data: completions, error: cErr },
        { data: subscriptions, error: sErr },
        { data: profiles, error: pErr }
      ] = await Promise.all([
        supabaseClient.from('departments').select('*').eq('company_id', company.id).order('created_at'),
        supabaseClient.from('equipment').select('*').eq('company_id', company.id).order('created_at'),
        supabaseClient.from('maintenance_actions').select('*').eq('company_id', company.id).order('created_at'),
        supabaseClient.from('tasks').select('*').eq('company_id', company.id).order('date'),
        supabaseClient.from('completions').select('*').eq('company_id', company.id).order('date', { ascending:false }),
        supabaseClient.from('subscriptions').select('*').eq('company_id', company.id).maybeSingle(),
        supabaseClient.from('profiles').select('*').eq('company_id', company.id).order('created_at')
      ]);
      const firstError = [dErr,eErr,aErr,tErr,cErr,sErr,pErr].find(Boolean);
      if (firstError) throw firstError;

      db.companies[company.id] = {
        id: company.id,
        name: company.name,
        departments: (departments || []).map(d => ({id:d.id, name:d.name, inviteCode:d.invite_code})),
        equipment: (equipment || []).map(e => ({id:e.id, name:e.name, code:e.code || '', location:e.location || '', departmentId:e.department_id})),
        actions: (actions || []).map(a => ({id:a.id, equipmentId:a.equipment_id, name:a.name, description:a.description || '', frequency:a.frequency, departmentId:a.department_id})),
        tasks: (tasks || []).map(t => ({id:t.id, actionId:t.action_id, equipmentId:t.equipment_id, assignedUserId:t.assigned_user_id, departmentId:t.department_id, date:t.date, status:t.status, title:t.title, equipName:t.equip_name || '', equipCode:t.equip_code || '', description:t.description || ''})),
        completions: (completions || []).map(c => ({id:c.id, taskId:c.task_id, actionId:c.action_id, equipmentId:c.equipment_id, departmentId:c.department_id, userId:c.user_id, title:c.title, equipName:c.equip_name || '', date:c.date, time:c.time || '', photoPath:c.photo_path || '', photo:'', comment:c.comment || ''})),
        users: (profiles || []).map(u => ({id:u.id, name:u.name, email:(u.id === authUser.id ? (authUser.email || '') : ''), phone:u.phone || '', role:u.role, departmentId:u.department_id})),
        subscription: subscriptions ? {planId:subscriptions.plan_id, startedAt:subscriptions.started_at, expiresAt:subscriptions.expires_at} : {planId:'free', expiresAt:null}
      };
      db.currentUser = { company: company.id, email: authUser.email || '', role: profile.role, id: authUser.id };
      try {
        const { data: adminData, error: adminError } = await supabaseClient.rpc('is_super_admin');
        isSuperAdmin = !adminError && adminData === true;
      } catch (_) { isSuperAdmin = false; }
      try {
        const { data: unlimitedData, error: unlimitedError } = await supabaseClient.rpc('current_company_is_unlimited');
        isUnlimitedCompany = !unlimitedError && unlimitedData === true;
      } catch (_) { isUnlimitedCompany = false; }
      currentDeptId = profile.role === 'manager'
        ? ((departments || [])[0]?.id || null)
        : profile.department_id;
      return true;
    }

    async function syncCurrentCompany() {
      if (cloudSyncBusy) return;
      const companyId = db.currentUser?.company;
      const c = companyId ? db.companies[companyId] : null;
      if (!c) return;
      cloudSyncBusy = true;
      try {
        const operations = [
          ['компанию', supabaseClient.from('companies').upsert({id:c.id, name:c.name}, {onConflict:'id'})],
          ['подразделения', c.departments?.length ? supabaseClient.from('departments').upsert(c.departments.map(d => ({id:d.id, company_id:c.id, name:d.name, invite_code:d.inviteCode})), {onConflict:'id'}) : null],
          ['профили', c.users?.length ? supabaseClient.from('profiles').upsert(c.users.map(u => ({id:u.id, company_id:c.id, department_id:u.departmentId || null, name:u.name, phone:u.phone || null, role:u.role})), {onConflict:'id'}) : null],
          ['оборудование', c.equipment?.length ? supabaseClient.from('equipment').upsert(c.equipment.map(e => ({id:e.id, company_id:c.id, department_id:e.departmentId, name:e.name, code:e.code || null, location:e.location || null})), {onConflict:'id'}) : null],
          ['регламенты', c.actions?.length ? supabaseClient.from('maintenance_actions').upsert(c.actions.map(a => ({id:a.id, company_id:c.id, department_id:a.departmentId, equipment_id:a.equipmentId, name:a.name, description:a.description || null, frequency:a.frequency})), {onConflict:'id'}) : null],
          ['задания', c.tasks?.length ? supabaseClient.from('tasks').upsert(c.tasks.map(t => ({id:t.id, company_id:c.id, department_id:t.departmentId, action_id:t.actionId || null, equipment_id:t.equipmentId || null, assigned_user_id:t.assignedUserId || null, date:t.date, status:t.status, title:t.title, equip_name:t.equipName || null, equip_code:t.equipCode || null, description:t.description || null})), {onConflict:'id'}) : null],
          ['выполнения', c.completions?.length ? supabaseClient.from('completions').upsert(c.completions.map(x => ({id:x.id, company_id:c.id, department_id:x.departmentId, task_id:x.taskId || null, action_id:x.actionId || null, equipment_id:x.equipmentId || null, user_id:x.userId, title:x.title, equip_name:x.equipName || null, date:x.date, time:x.time || null, photo_path:x.photoPath || null, comment:x.comment || null})), {onConflict:'id'}) : null],
          ['подписку', c.subscription ? supabaseClient.from('subscriptions').upsert({company_id:c.id, plan_id:c.subscription.planId || 'free', started_at:c.subscription.startedAt || new Date().toISOString(), expires_at:c.subscription.expiresAt || null}, {onConflict:'company_id'}) : null]
        ];
        for (const [label, promise] of operations) {
          if (!promise) continue;
          const { error } = await promise;
          if (error) {
            console.error('Ошибка синхронизации ' + label, error);
            toast('Не удалось сохранить ' + label + ': ' + error.message);
            return false;
          }
        }
        return true;
      } finally {
        cloudSyncBusy = false;
      }
    }
    function todayStr() { return new Date().toISOString().slice(0, 10); }
    function formatDate(d) { return new Date(d).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' }); }
    function showError(msg) {
      const el = document.getElementById('auth-error');
      el.textContent = msg; el.classList.remove('hidden');
      setTimeout(() => el.classList.add('hidden'), 4000);
    }
    function toast(msg) {
      const t = document.createElement('div');
      t.className = 'fixed bottom-6 left-1/2 -translate-x-1/2 bg-slate-800 text-white text-sm px-5 py-3 rounded-xl shadow-xl z-50 fade-in';
      t.textContent = msg; document.body.appendChild(t);
      setTimeout(() => t.remove(), 2500);
    }
    function esc(str) {
      if (!str) return '';
      return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    }
    function generateCode() {
      const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
      const bytes = new Uint32Array(8);
      crypto.getRandomValues(bytes);
      let code = '';
      for (let i = 0; i < 8; i++) {
        if (i === 4) code += '-';
        code += chars[bytes[i] % chars.length];
      }
      return code;
    }

    function getCompany() { return db.companies[db.currentUser?.company]; }
    function getUser() {
      const c = getCompany();
      return c?.users?.find(u => u.id === db.currentUser?.id) || c?.users?.find(u => normalizePhone(u.phone) === normalizePhone(db.currentUser?.phone));
    }
    function getActiveDeptId() {
      const user = getUser();
      if (user.role === 'employee' || user.role === 'responsible') return user.departmentId;
      return currentDeptId;
    }
    function getDeptEquipment() {
      const deptId = getActiveDeptId();
      const all = getCompany().equipment.filter(e => e.departmentId === deptId);
      const plan = getPlan();
      // return all, but we'll mark which are active
      return all.map((e, i) => ({ ...e, _active: i < plan.maxEquip, _index: i }));
    }
    function getDeptActions() { return getCompany().actions.filter(a => a.departmentId === getActiveDeptId()); }
    function getDeptTasks(date) {
      return getCompany().tasks.filter(t => {
        if (t.date !== date || t.departmentId !== getActiveDeptId()) return false;
        // hide pending tasks for frozen equipment
        if (t.status === 'pending' && !isEquipmentActive(t.equipmentId)) return false;
        return true;
      });
    }
    function getDeptCompletions() { return getCompany().completions.filter(c => c.departmentId === getActiveDeptId()); }
    function getDeptUsers() { return getCompany().users.filter(u => u.departmentId === getActiveDeptId() && u.role !== 'manager'); }

    function getPlan() {
      const c = getCompany();
      if (isUnlimitedCompany) return { ...(PLANS.ultra || PLANS.free), maxDepts: 999999, maxEquip: 999999, name: 'OWNER — Безлимит' };
      const sub = c.subscription || { planId: 'free', expiresAt: null };
      // check expiry
      if (sub.planId !== 'free' && sub.expiresAt) {
        if (new Date(sub.expiresAt) < new Date()) {
          // expired -> free
          return PLANS.free;
        }
      }
      return PLANS[sub.planId] || PLANS.free;
    }

    function isSubActive() {
      const c = getCompany();
      const sub = c.subscription || { planId: 'free' };
      if (sub.planId === 'free') return true;
      if (!sub.expiresAt) return false;
      return new Date(sub.expiresAt) >= new Date();
    }

    function getDaysLeft() {
      const c = getCompany();
      const sub = c.subscription || { planId: 'free' };
      if (sub.planId === 'free' || !sub.expiresAt) return null;
      const diff = Math.ceil((new Date(sub.expiresAt) - new Date()) / (1000*60*60*24));
      return Math.max(0, diff);
    }

    function getActiveEquipmentForDept(deptId) {
      const c = getCompany();
      const plan = getPlan();
      const all = c.equipment.filter(e => e.departmentId === deptId);
      // sort by creation order (id roughly), keep first maxEquip
      return all.slice(0, plan.maxEquip);
    }

    function isEquipmentActive(equipId) {
      const c = getCompany();
      const equip = c.equipment.find(e => e.id === equipId);
      if (!equip) return false;
      const active = getActiveEquipmentForDept(equip.departmentId);
      return active.some(e => e.id === equipId);
    }

    function getActiveDepartments() {
      const c = getCompany();
      const plan = getPlan();
      // first N departments stay active
      return c.departments.slice(0, plan.maxDepts);
    }

    function isDepartmentActive(deptId) {
      return getActiveDepartments().some(d => d.id === deptId);
    }



    function switchAuthTab(tab) {
      ['login', 'register', 'invite'].forEach(t => {
        document.getElementById('form-' + t).classList.toggle('hidden', t !== tab);
        const btn = document.getElementById('tab-' + t);
        if (t === tab) { btn.classList.add('bg-primary-600', 'text-white'); btn.classList.remove('text-slate-400'); }
        else { btn.classList.remove('bg-primary-600', 'text-white'); btn.classList.add('text-slate-400'); }
      });
    }


    let pendingEmail = null;
    let isSuperAdmin = false;
    let isUnlimitedCompany = false;
    let adminCompanies = [];

    const AUTH_PUBLIC_URL = 'https://www.app-check.ru/';

    function inviteCodeFromUrl() {
      try {
        const params = new URLSearchParams(window.location.search);
        return String(
          params.get('invite') ||
          params.get('code') ||
          document.getElementById('invite-code')?.value ||
          ''
        ).trim().toUpperCase();
      } catch (_) {
        return String(document.getElementById('invite-code')?.value || '').trim().toUpperCase();
      }
    }

    function savePendingRegistration(meta) {
      pendingEmail = meta;
      try {
        sessionStorage.setItem('checkapp_pending_registration', JSON.stringify(meta));
      } catch (_) {}
    }

    function loadPendingRegistration(user) {
      try {
        const raw = sessionStorage.getItem('checkapp_pending_registration');
        if (raw) {
          const meta = JSON.parse(raw);
          if (meta?.email) return meta;
        }
      } catch (_) {}

      const meta = user?.user_metadata || {};
      if (user?.email && meta?.signup_mode) {
        return {
          mode: meta.signup_mode,
          email: String(user.email).toLowerCase(),
          name: String(meta.name || ''),
          company: String(meta.company_name || ''),
          code: String(meta.invite_code || '')
        };
      }
      return null;
    }

    function openEmailConfirmationModal(email) {
      const message = document.getElementById('otp-message');
      if (message) {
        message.textContent = `Код подтверждения отправлен на ${email}. Введите 6-значный код из письма.`;
      }
      const code = document.getElementById('otp-code');
      if (code) code.value = '';
      const status = document.getElementById('otp-status');
      if (status) {
        status.textContent = '';
        status.className = 'text-sm text-center mt-4 min-h-[20px]';
      }
      const modal = document.getElementById('otp-modal');
      if (modal) {
        modal.classList.remove('hidden');
        modal.classList.add('flex');
      }
      setTimeout(() => code?.focus(), 100);
    }

    async function finalizePendingRegistration(session, metaOverride = null) {
      const sessionUser = session?.user;
      if (!sessionUser) throw new Error('Сессия подтверждения не получена.');

      const meta = metaOverride || loadPendingRegistration(sessionUser);
      if (!meta?.mode) throw new Error('Не найдены данные незавершённой регистрации.');

      const { data: existingProfile, error: profileLookupError } = await supabaseClient
        .from('profiles')
        .select('id')
        .eq('id', sessionUser.id)
        .maybeSingle();

      if (profileLookupError) throw profileLookupError;

      // Если профиль уже существует, регистрацию второй раз не выполняем.
      if (!existingProfile) {
        let rpcError = null;

        if (meta.mode === 'invite' && meta.code && meta.name) {
          ({ error: rpcError } = await supabaseClient.rpc('join_company_by_invite', {
            p_invite_code: String(meta.code).trim().toUpperCase(),
            p_name: String(meta.name).trim(),
            p_phone: null
          }));
        } else if (meta.mode === 'register' && meta.company && meta.name) {
          ({ error: rpcError } = await supabaseClient.rpc('bootstrap_company', {
            p_company_name: String(meta.company).trim(),
            p_department_name: 'Основное',
            p_invite_code: meta.code || generateCode(),
            p_name: String(meta.name).trim(),
            p_phone: null
          }));
        } else {
          throw new Error('Данные регистрации неполные. Откройте ссылку приглашения заново.');
        }

        if (rpcError) throw rpcError;
      }

      const ok = await hydrateCurrentUser();
      if (!ok || !db?.currentUser) {
        throw new Error('Профиль создан, но приложение не смогло загрузить его. Повторите вход.');
      }

      try {
        sessionStorage.removeItem('checkapp_pending_registration');
      } catch (_) {}
      pendingEmail = null;

      closeOtpModal();
      enterApp();
      return true;
    }

    async function verifyEmailOtp() {
      if (!ensureSupabase()) return;

      const codeEl = document.getElementById('otp-code');
      const statusEl = document.getElementById('otp-status');
      const btn = document.getElementById('otp-submit');
      const code = (codeEl?.value || '').trim().replace(/\s+/g, '');
      const email = pendingEmail?.email;

      const setStatus = (text, ok = false) => {
        if (!statusEl) return;
        statusEl.textContent = text || '';
        statusEl.className = 'text-sm text-center mt-4 min-h-[20px] ' + (ok ? 'text-emerald-400' : 'text-red-400');
      };

      if (!email) return setStatus('Данные регистрации потеряны. Откройте ссылку приглашения заново.');
      if (!/^\d{6}$/.test(code)) {
        setStatus('Введите 6-значный код из письма.');
        codeEl?.focus();
        return;
      }

      btn.disabled = true;
      btn.textContent = 'Проверяем...';
      setStatus('Проверяем код…', true);

      try {
        const { data, error } = await supabaseClient.auth.verifyOtp({
          email,
          token: code,
          type: 'email'
        });

        if (error) throw error;

        const session = data?.session || (await supabaseClient.auth.getSession()).data?.session;
        if (!session?.user) {
          throw new Error('Код принят, но сессия не создана. Повторите вход.');
        }

        setStatus('Email подтверждён. Подключаем вас к компании…', true);
        await finalizePendingRegistration(session, pendingEmail);
      } catch (e) {
        console.error('[Check App] verifyEmailOtp error:', e);
        setStatus(e?.message || 'Код неверный или просрочен.');
      } finally {
        btn.disabled = false;
        btn.textContent = 'Подтвердить';
      }
    }

    async function resendEmailOtp() {
      if (!ensureSupabase()) return;

      const email = pendingEmail?.email;
      if (!email) return showError('Не найден Email регистрации.');

      const btn = document.getElementById('otp-resend');
      btn.disabled = true;
      btn.textContent = 'Отправляем...';

      try {
        const { error } = await supabaseClient.auth.resend({
          type: 'signup',
          email,
          options: { emailRedirectTo: AUTH_PUBLIC_URL }
        });
        if (error) throw error;

        const code = document.getElementById('otp-code');
        if (code) code.value = '';

        const message = document.getElementById('otp-message');
        if (message) message.textContent = `Новый код отправлен на ${email}. Используйте последний полученный код.`;

        const status = document.getElementById('otp-status');
        if (status) {
          status.textContent = 'Новый код отправлен.';
          status.className = 'text-sm text-center mt-4 min-h-[20px] text-emerald-400';
        }
      } catch (e) {
        console.error('[Check App] resendEmailOtp error:', e);
        showError(e?.message || 'Не удалось отправить новый код.');
      } finally {
        btn.disabled = false;
        btn.textContent = 'Отправить код ещё раз';
      }
    }

    function closeOtpModal() {
      const modal = document.getElementById('otp-modal');
      modal?.classList.add('hidden');
      modal?.classList.remove('flex');
      const code = document.getElementById('otp-code');
      if (code) code.value = '';
    }

    function goToLoginAfterEmail() {
      const email = pendingEmail?.email ||
        document.getElementById('reg-email')?.value?.trim().toLowerCase() ||
        document.getElementById('invite-email')?.value?.trim().toLowerCase() || '';

      closeOtpModal();
      switchAuthTab('login');
      if (email) document.getElementById('login-email').value = email;
    }

    async function doRegister() {
      if (!ensureSupabase()) return;

      const inviteCode = inviteCodeFromUrl();
      const inviteMode = !document.getElementById('form-invite')?.classList.contains('hidden');
      const company = document.getElementById('reg-company')?.value.trim() || '';
      const name = (inviteMode
        ? document.getElementById('invite-name')?.value
        : document.getElementById('reg-name')?.value)?.trim() || '';
      const email = (inviteMode
        ? document.getElementById('invite-email')?.value
        : document.getElementById('reg-email')?.value)?.trim().toLowerCase() || '';
      const password = (inviteMode
        ? document.getElementById('invite-password')?.value
        : document.getElementById('reg-password')?.value) || '';

      if (!name || !email || password.length < 8 || (inviteMode && !inviteCode) || (!inviteMode && !inviteCode && !company)) {
        return showError(inviteMode
          ? 'Укажите код приглашения, имя, Email и пароль минимум из 8 символов.'
          : 'Заполните название компании, имя, Email и пароль минимум из 8 символов.');
      }

      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return showError('Введите корректный Email.');
      }

      const meta = {
        mode: inviteCode ? 'invite' : 'register',
        email,
        name,
        company,
        code: inviteCode || generateCode()
      };

      savePendingRegistration(meta);

      try {
        // Единственная точка создания/возобновления регистрации.
        const { data, error } = await supabaseClient.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: AUTH_PUBLIC_URL,
            data: {
              name,
              company_name: company,
              signup_mode: meta.mode,
              invite_code: meta.code
            }
          }
        });

        // Если Supabase явно говорит, что пользователь уже существует,
        // сначала пробуем отправить ему новое письмо подтверждения.
        if (error) {
          const resend = await supabaseClient.auth.resend({
            type: 'signup',
            email,
            options: { emailRedirectTo: AUTH_PUBLIC_URL }
          });

          if (!resend.error) {
            openEmailConfirmationModal(email);
            toast('Код подтверждения повторно отправлен на Email.');
            return;
          }

          // Возможно, Email уже подтверждён. Тогда пробуем продолжить
          // незавершённую регистрацию по введённому паролю.
          const login = await supabaseClient.auth.signInWithPassword({ email, password });
          if (!login.error && login.data?.session?.user) {
            await finalizePendingRegistration(login.data.session, meta);
            return;
          }

          throw error;
        }

        const user = data?.user;
        const session = data?.session;

        if (!user) throw new Error('Supabase не вернул пользователя.');

        // Автоконфигурация без подтверждения — редкий случай.
        if (session) {
          await finalizePendingRegistration(session, meta);
          return;
        }

        // Supabase маскирует уже подтверждённый аккаунт пустым identities.
        // В этом случае не создаём новую регистрацию: пробуем продолжить
        // незавершённую регистрацию по введённому паролю.
        if (Array.isArray(user.identities) && user.identities.length === 0) {
          const login = await supabaseClient.auth.signInWithPassword({ email, password });

          if (!login.error && login.data?.session?.user) {
            await finalizePendingRegistration(login.data.session, meta);
            return;
          }

          try { sessionStorage.removeItem('checkapp_pending_registration'); } catch (_) {}
          pendingEmail = null;
          document.getElementById('login-email').value = email;
          switchAuthTab('login');
          showError('Этот Email уже зарегистрирован. Введите пароль от существующего аккаунта.');
          return;
        }

        // Новый аккаунт или ранее начатая, но не завершённая регистрация.
        // signUp отправляет confirmation сам. Если Auth user создан раньше,
        // дополнительно запрашиваем новый код; сервер сам соблюдает rate limit.
        savePendingRegistration({ ...meta, userId: user.id || null });

        const createdAt = user.created_at ? Date.parse(user.created_at) : Date.now();
        const isPreviouslyCreated = Number.isFinite(createdAt) && (Date.now() - createdAt > 65000);

        if (isPreviouslyCreated) {
          const resend = await supabaseClient.auth.resend({
            type: 'signup',
            email,
            options: { emailRedirectTo: AUTH_PUBLIC_URL }
          });
          if (resend.error) {
            console.warn('[Check App] resend after previous signup:', resend.error);
          }
        }

        openEmailConfirmationModal(email);
        toast('Код подтверждения отправлен на Email.');
      } catch (e) {
        console.error('[Check App] registration failed:', e);
        showError(e?.message || 'Не удалось продолжить регистрацию.');
      }
    }

    async function doLogin() {
      if (!ensureSupabase()) return;
      const email = document.getElementById('login-email').value.trim().toLowerCase();
      const password = document.getElementById('login-password').value;
      if (!email || !password) return showError('Введите Email и пароль.');
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return showError('Введите корректный Email.');

      try {
        const { error } = await supabaseClient.auth.signInWithPassword({ email, password });
        if (error) throw error;

        let ok = await hydrateCurrentUser();

        // Если регистрация проходила с подтверждением email, сессия появилась
        // только после входа. В этом случае создаём компанию/профиль из
        // user_metadata, сохранённых при signUp().
        if (!ok) {
          const { data: userData, error: userError } = await supabaseClient.auth.getUser();
          if (userError) throw userError;

          const meta = userData.user?.user_metadata || {};
          if (meta.signup_mode === 'register' && meta.company_name && meta.name) {
            const { error: bootstrapError } = await supabaseClient.rpc('bootstrap_company', {
              p_company_name: meta.company_name,
              p_department_name: 'Основное',
              p_invite_code: meta.invite_code || generateCode(),
              p_name: meta.name,
              p_phone: null
            });
            if (bootstrapError) throw bootstrapError;
          } else if (meta.signup_mode === 'invite' && meta.invite_code && meta.name) {
            const { error: joinError } = await supabaseClient.rpc('join_company_by_invite', {
              p_invite_code: meta.invite_code,
              p_name: meta.name,
              p_phone: null
            });
            if (joinError) throw joinError;
          }

          ok = await hydrateCurrentUser();
        }

        if (!ok) {
          await supabaseClient.auth.signOut();
          throw new Error('Профиль пользователя не найден.');
        }

        // Компания определяется по профилю пользователя в Supabase.
        enterApp();
      } catch (e) {
        console.error(e);
        showError(e.message || 'Ошибка входа.');
      }
    }

    async function doLogout() {
      await supabaseClient.auth.signOut();
      db = loadDB();
      currentDeptId = null;
      document.getElementById('app-screen').classList.add('hidden');
      document.getElementById('auth-screen').classList.remove('hidden');
    }

    function enterApp() {
      document.getElementById('auth-screen').classList.add('hidden');
      document.getElementById('app-screen').classList.remove('hidden');
      const c = getCompany(); const user = getUser();
      document.getElementById('header-company').textContent = c.name;
      const roleLabel = user.role === 'manager' ? ' · Руководитель' : (user.role === 'responsible' ? ' · Ответственный' : ' · Сотрудник');
      document.getElementById('header-user').textContent = user.name + roleLabel;
      // ensure subscription object exists
      if (!c.subscription) {
        c.subscription = { planId: 'free', expiresAt: null, startedAt: new Date().toISOString() };
        saveDB();
      }
      const isManager = user.role === 'manager';
      const isResponsible = user.role === 'responsible';
      const isStaff = isManager || isResponsible;
      document.getElementById('manager-nav').classList.toggle('hidden', !isStaff);
      document.getElementById('nav-super-admin')?.classList.toggle('hidden', !isSuperAdmin);
      document.getElementById('dept-bar').classList.toggle('hidden', !isManager);
      // кабинет и команда — только руководитель компании
      document.querySelectorAll('.nav-btn[data-page="cabinet"]').forEach(btn => {
        btn.classList.toggle('hidden', !isManager);
      });
      document.querySelectorAll('.nav-btn[data-page="team"]').forEach(btn => {
        btn.classList.toggle('hidden', !isManager);
      });
      if (isManager) {
        renderDeptSelect();
        if (!currentDeptId && c.departments.length) currentDeptId = c.departments[0].id;
      }
      generateTodayTasks();
      if (isStaff) showPage('dashboard'); else showPage('today');
    }

    function renderDeptSelect() {
      const c = getCompany();
      const plan = getPlan();
      const sel = document.getElementById('dept-select');
      sel.innerHTML = c.departments.map((d, i) => {
        const active = i < plan.maxDepts;
        return `<option value="${d.id}" ${d.id === currentDeptId ? 'selected' : ''} ${!active ? 'disabled' : ''}>${esc(d.name)}${active ? '' : ' (заморожено)'}</option>`;
      }).join('');
      // if current is frozen, switch to first
      if (currentDeptId && !isDepartmentActive(currentDeptId) && c.departments.length) {
        currentDeptId = c.departments[0].id;
        sel.value = currentDeptId;
      }
      const invSel = document.getElementById('invite-dept-select');
      if (invSel) {
        invSel.innerHTML = c.departments.map((d, i) => {
          const active = i < plan.maxDepts;
          return `<option value="${d.id}" ${d.id === currentDeptId ? 'selected' : ''} ${!active ? 'disabled' : ''}>${esc(d.name)}${active ? '' : ' (заморожено)'}</option>`;
        }).join('');
        invSel.onchange = updateInviteCodeDisplay;
      }
      updateInviteCodeDisplay();
    }

    function onDeptChange() {
      currentDeptId = document.getElementById('dept-select').value;
      generateTodayTasks();
      const page = document.querySelector('.nav-btn.border-primary-500')?.dataset?.page || 'dashboard';
      showPage(page);
    }

    function updateInviteCodeDisplay() {
      const c = getCompany();
      const sel = document.getElementById('invite-dept-select');
      if (!sel) return;
      const dept = c.departments.find(d => d.id === sel.value);
      document.getElementById('invite-code-display').textContent = dept ? dept.inviteCode : '—';
    }

    function showPage(page) {
      const user = getUser();
      if (page === 'cabinet' && user.role !== 'manager') {
        toast('Доступ только у руководителя компании');
        page = 'dashboard';
      }
      if (page === 'super-admin' && !isSuperAdmin) {
        toast('Доступ только у SUPER ADMIN');
        page = 'dashboard';
      }
      document.querySelectorAll('.page').forEach(p => p.classList.add('hidden'));
      document.getElementById('page-' + page).classList.remove('hidden');
      document.querySelectorAll('.nav-btn').forEach(btn => {
        const isActive = btn.dataset.page === page;
        btn.classList.toggle('border-primary-500', isActive);
        btn.classList.toggle('text-primary-400', isActive);
        btn.classList.toggle('border-transparent', !isActive);
        btn.classList.toggle('text-slate-400', !isActive);
      });
      if (page === 'dashboard') renderDashboard();
      if (page === 'today') renderToday();
      if (page === 'equipment') renderEquipment();
      if (page === 'actions') renderActions();
      if (page === 'team') renderTeam();
      if (page === 'history') renderHistory();
      if (page === 'reports') renderReports();
      if (page === 'cabinet') renderCabinet();
      if (page === 'super-admin') renderSuperAdmin();
    }

    async function renderSuperAdmin() {
      if (!isSuperAdmin) return;
      await loadAdminCompanies();
    }

    async function loadAdminCompanies() {
      if (!isSuperAdmin || !ensureSupabase()) return;
      const list = document.getElementById('admin-companies-list');
      if (list) list.innerHTML = '<div class="text-center py-10 text-slate-500 text-sm">Загрузка компаний…</div>';
      try {
        const { data, error } = await supabaseClient.rpc('list_companies_for_super_admin');
        if (error) throw error;
        adminCompanies = Array.isArray(data) ? data : [];
        filterAdminCompanies();
      } catch (e) {
        console.error('[Check App] loadAdminCompanies:', e);
        if (list) list.innerHTML = `<div class="bg-rose-500/10 border border-rose-500/20 text-rose-300 rounded-xl p-4 text-sm">${esc(e?.message || 'Не удалось загрузить компании.')}</div>`;
      }
    }

    function filterAdminCompanies() {
      const list = document.getElementById('admin-companies-list');
      if (!list) return;
      const q = (document.getElementById('admin-company-search')?.value || '').trim().toLowerCase();
      const rows = adminCompanies.filter(c =>
        !q ||
        String(c.company_name || '').toLowerCase().includes(q) ||
        String(c.owner_email || '').toLowerCase().includes(q)
      );
      if (!rows.length) {
        list.innerHTML = '<div class="text-center py-10 text-slate-500 text-sm">Компании не найдены</div>';
        return;
      }
      list.innerHTML = rows.map(c => {
        const active = c.is_unlimited === true;
        const plan = c.plan_id || 'free';
        return `<div class="bg-slate-900 rounded-2xl border ${active ? 'border-amber-500/40' : 'border-slate-800'} p-5">
          <div class="flex items-start justify-between gap-4 flex-wrap">
            <div class="min-w-0">
              <div class="font-semibold text-lg">${esc(c.company_name || 'Без названия')}</div>
              <div class="text-sm text-slate-400 mt-1">${esc(c.owner_email || '—')}</div>
              <div class="text-xs text-slate-500 mt-2 font-mono break-all">${esc(c.company_id)}</div>
            </div>
            <div class="flex items-center gap-2">
              <span class="text-xs px-2.5 py-1 rounded-full ${active ? 'bg-amber-500/15 text-amber-300' : 'bg-slate-800 text-slate-400'}">
                ${active ? '♾ Безлимит' : 'Тариф: ' + esc(plan)}
              </span>
            </div>
          </div>
          <div class="mt-4 flex flex-wrap items-center gap-3">
            ${active
              ? `<button onclick="revokeUnlimited('${c.company_id}')" class="bg-rose-600 hover:bg-rose-500 px-4 py-2.5 rounded-xl text-sm font-medium">Отозвать безлимит</button>`
              : `<button onclick="grantUnlimited('${c.company_id}')" class="bg-amber-600 hover:bg-amber-500 text-white px-4 py-2.5 rounded-xl text-sm font-medium">Выдать безлимит</button>`}
          </div>
          ${active && c.note ? `<div class="text-xs text-slate-500 mt-3">Комментарий: ${esc(c.note)}</div>` : ''}
        </div>`;
      }).join('');
    }

    async function grantUnlimited(companyId) {
      if (!isSuperAdmin || !ensureSupabase()) return;
      const note = prompt('Комментарий к выдаче безлимита:', 'Бесплатный безлимитный доступ');
      if (note === null) return;
      try {
        const { error } = await supabaseClient.rpc('grant_unlimited_company', {
          p_company_id: companyId,
          p_note: note
        });
        if (error) throw error;
        toast('Безлимит выдан');
        await loadAdminCompanies();
      } catch (e) {
        console.error('[Check App] grantUnlimited:', e);
        toast(e?.message || 'Не удалось выдать безлимит');
      }
    }

    async function revokeUnlimited(companyId) {
      if (!isSuperAdmin || !ensureSupabase()) return;
      if (!confirm('Отозвать безлимит у этой компании?')) return;
      try {
        const { error } = await supabaseClient.rpc('revoke_unlimited_company', { p_company_id: companyId });
        if (error) throw error;
        toast('Безлимит отозван');
        await loadAdminCompanies();
      } catch (e) {
        console.error('[Check App] revokeUnlimited:', e);
        toast(e?.message || 'Не удалось отозвать безлимит');
      }
    }

    function generateTodayTasks() {
      const c = getCompany(); const today = todayStr();
      c.tasks = c.tasks.filter(t => t.date === today || t.status === 'done');
      c.actions.forEach(action => {
        if (c.tasks.some(t => t.actionId === action.id && t.date === today)) return;
        const last = c.completions.filter(comp => comp.actionId === action.id).sort((a,b) => b.date.localeCompare(a.date))[0];
        let shouldCreate = true;
        if (last) {
          const daysSince = Math.floor((new Date(today) - new Date(last.date)) / (1000*60*60*24));
          shouldCreate = daysSince >= action.frequency;
        }
        if (shouldCreate) {
          // only create if equipment is within plan limits
          if (!isEquipmentActive(action.equipmentId)) return;
          if (!isDepartmentActive(action.departmentId)) return;
          const equip = c.equipment.find(e => e.id === action.equipmentId);
          c.tasks.push({
            id: uid(), actionId: action.id, equipmentId: action.equipmentId, departmentId: action.departmentId,
            date: today, status: 'pending', title: action.name,
            equipName: equip ? equip.name : '—', equipCode: equip ? equip.code : '', description: action.description || ''
          });
        }
      });
      saveDB();
    }

    function renderDashboard() {
      const c = getCompany(); const today = todayStr();
      const dept = c.departments.find(d => d.id === currentDeptId);
      document.getElementById('dash-dept-name').textContent = dept ? '· ' + dept.name : '';
      const tasks = getDeptTasks(today);
      document.getElementById('stat-equipment').textContent = getDeptEquipment().length;
      document.getElementById('stat-today').textContent = tasks.length;
      document.getElementById('stat-done').textContent = tasks.filter(t => t.status === 'done').length;
      document.getElementById('stat-pending').textContent = tasks.filter(t => t.status === 'pending').length;
      const list = document.getElementById('dash-today-list');
      if (!tasks.length) { list.innerHTML = '<p class="text-slate-500 text-sm">Задач нет</p>'; return; }
      list.innerHTML = tasks.map(t => `
        <div class="flex items-center justify-between bg-slate-800/50 rounded-xl px-4 py-3">
          <div><div class="font-medium text-sm">${esc(t.title)}</div><div class="text-xs text-slate-400">${esc(t.equipName)}</div></div>
          <span class="text-xs px-2.5 py-1 rounded-full ${t.status==='done'?'bg-emerald-500/20 text-emerald-400':'bg-amber-500/20 text-amber-400'}">${t.status==='done'?'Выполнено':'Ожидает'}</span>
        </div>`).join('');
    }

    function renderToday() {
      const today = todayStr();
      document.getElementById('today-date').textContent = formatDate(today);
      const user = getUser();
      const label = document.getElementById('today-dept-label');
      if (user.role === 'employee') {
        const dept = getCompany().departments.find(d => d.id === user.departmentId);
        label.textContent = dept ? dept.name : ''; label.classList.remove('hidden');
      } else label.classList.add('hidden');
      const tasks = getDeptTasks(today);
      const list = document.getElementById('today-list');
      const empty = document.getElementById('today-empty');
      if (!tasks.length) { list.innerHTML = ''; empty.classList.remove('hidden'); return; }
      empty.classList.add('hidden');
      list.innerHTML = tasks.map(t => {
        const isDone = t.status === 'done';
        return `<div class="bg-slate-900 border border-slate-800 rounded-2xl p-4 ${isDone?'opacity-60':''}">
          <div class="flex items-start justify-between gap-3">
            <div class="flex-1"><div class="font-semibold">${esc(t.title)}</div>
            <div class="text-sm text-slate-400 mt-0.5">${esc(t.equipName)}</div>
            ${t.description?`<div class="text-xs text-slate-500 mt-2">${esc(t.description)}</div>`:''}</div>
            ${isDone?`<span class="text-xs px-2.5 py-1 rounded-full bg-emerald-500/20 text-emerald-400">✓ Выполнено</span>`
              :`<button onclick="openCompleteModal('${t.id}')" class="bg-primary-600 hover:bg-primary-500 text-white text-sm font-medium px-4 py-2 rounded-xl">Выполнить</button>`}
          </div></div>`;
      }).join('');
    }

    function renderEquipment() {
      const items = getDeptEquipment();
      const list = document.getElementById('equip-list');
      const plan = getPlan();
      if (!items.length) { list.innerHTML = '<p class="text-slate-500 text-sm py-8 text-center">Нет оборудования</p>'; return; }
      list.innerHTML = items.map(e => `
        <div class="bg-slate-900 border border-slate-800 rounded-2xl p-4 flex items-center justify-between ${e._active ? '' : 'opacity-50'}">
          <div>
            <div class="font-semibold">${esc(e.name)} ${e._active ? '' : '<span class="text-xs text-rose-400 font-normal">· заморожено</span>'}</div>
            <div class="text-sm text-slate-400">${esc(e.code||'—')} · ${esc(e.location||'—')}</div>
          </div>
          ${e._active ? `<button onclick="deleteEquipment('${e.id}')" class="text-slate-500 hover:text-rose-400 text-sm px-2 py-1">Удалить</button>` : '<span class="text-xs text-slate-500">нет доступа</span>'}
        </div>`).join('');
    }

    function renderActions() {
      const items = getDeptActions();
      const list = document.getElementById('actions-list');
      const equipAll = getCompany().equipment;
      if (!items.length) { list.innerHTML = '<p class="text-slate-500 text-sm py-8 text-center">Нет действий</p>'; return; }
      const freqLabels = {1:'Каждый день',2:'Раз в 2 дня',3:'Раз в 3 дня',7:'Раз в неделю',14:'Раз в 2 недели',30:'Раз в месяц'};
      list.innerHTML = items.map(a => {
        const equip = equipAll.find(e => e.id === a.equipmentId);
        return `<div class="bg-slate-900 border border-slate-800 rounded-2xl p-4 flex items-center justify-between">
          <div><div class="font-semibold">${esc(a.name)}</div>
          <div class="text-sm text-slate-400">${equip?esc(equip.name):'—'} · ${freqLabels[a.frequency]||a.frequency+' дн.'}</div></div>
          <button onclick="deleteAction('${a.id}')" class="text-slate-500 hover:text-rose-400 text-sm px-2 py-1">Удалить</button>
        </div>`;
      }).join('');
    }

    function renderTeam() {
      renderDeptSelect();
      const users = getDeptUsers();
      const me = getUser();
      const list = document.getElementById('team-list');
      if (!users.length) { list.innerHTML = '<p class="text-slate-500 text-sm py-4 text-center">Нет сотрудников в этом подразделении</p>'; return; }
      list.innerHTML = users.map(u => {
        const isResp = u.role === 'responsible';
        const roleBadge = isResp
          ? '<span class="text-xs px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-400">Ответственный</span>'
          : '<span class="text-xs px-2 py-0.5 rounded-full bg-slate-700 text-slate-300">Сотрудник</span>';
        let actions = '';
        if (me.role === 'manager') {
          if (isResp) {
            actions = `<button onclick="setResponsible('${u.id}', false)" class="text-xs text-slate-400 hover:text-white px-3 py-1.5 rounded-lg hover:bg-slate-800">Снять</button>`;
          } else {
            actions = `<button onclick="setResponsible('${u.id}', true)" class="text-xs text-primary-400 hover:text-primary-300 px-3 py-1.5 rounded-lg hover:bg-primary-500/10">Назначить ответственным</button>`;
          }
          actions += `<button onclick="removeEmployee('${u.id}')" class="text-xs text-rose-400 hover:text-rose-300 px-3 py-1.5 rounded-lg hover:bg-rose-500/10">Удалить</button>`;
        }
        return `<div class="bg-slate-900 border border-slate-800 rounded-xl px-4 py-3">
          <div class="flex items-center justify-between gap-2">
            <div>
              <div class="font-medium text-sm flex items-center gap-2 flex-wrap">${esc(u.name)} ${roleBadge}</div>
              <div class="text-xs text-slate-400 mt-0.5">${esc(u.phone)}</div>
            </div>
          </div>
          ${actions ? `<div class="flex flex-wrap gap-2 mt-3">${actions}</div>` : ''}
        </div>`;
      }).join('');
    }

    async function renderHistory() {
      const comps = [...getDeptCompletions()].sort((a,b) => b.date.localeCompare(a.date));
      const list = document.getElementById('history-list');
      const empty = document.getElementById('history-empty');
      if (!comps.length) { list.innerHTML = ''; empty.classList.remove('hidden'); return; }
      empty.classList.add('hidden');
      const c = getCompany();
      list.innerHTML = comps.map(comp => {
        const user = c.users.find(u => u.id === comp.userId);
        return `<div class="bg-slate-900 border border-slate-800 rounded-2xl p-4">
          <div class="font-semibold">${esc(comp.title)}</div>
          <div class="text-sm text-slate-400">${esc(comp.equipName)} · ${formatDate(comp.date)} ${comp.time||''}</div>
          <div class="text-xs text-slate-500 mt-1">Выполнил: ${user?esc(user.name):'—'}</div>
          ${comp.comment ? `<div class="text-sm text-slate-300 mt-2 bg-slate-800/60 rounded-lg px-3 py-2">💬 ${esc(comp.comment)}</div>` : ''}
          ${comp.photoPath ? `<div class="text-xs text-primary-400 mt-3" id="photo-${comp.id}">Загрузка фото…</div>` : ''}
        </div>`;
      }).join('');

      for (const comp of comps) {
        if (!comp.photoPath) continue;
        const { data, error } = await supabaseClient.storage.from('equipment-photos').createSignedUrl(comp.photoPath, 3600);
        const el = document.getElementById('photo-' + comp.id);
        if (!el) continue;
        if (error || !data?.signedUrl) {
          el.textContent = 'Фото недоступно';
          el.className = 'text-xs text-rose-400 mt-3';
        } else {
          el.outerHTML = `<img src="${esc(data.signedUrl)}" class="rounded-xl max-h-48 object-cover cursor-pointer mt-3" onclick="openPhotoModal(this.src)" alt="Фото выполненной работы" />`;
        }
      }
    }

    function renderReports() {
      const c = getCompany(); const today = todayStr(); const todayDate = new Date(today);
      const deptActions = getDeptActions(); const deptComps = getDeptCompletions();
      const overdue = [];
      deptActions.forEach(action => {
        const equip = c.equipment.find(e => e.id === action.equipmentId);
        const last = deptComps.filter(comp => comp.actionId === action.id).sort((a,b) => b.date.localeCompare(a.date))[0];
        let daysOverdue = 0, statusText = '';
        if (!last) { daysOverdue = action.frequency; statusText = 'Никогда не выполнялось'; }
        else {
          const daysSince = Math.floor((todayDate - new Date(last.date)) / (1000*60*60*24));
          if (daysSince >= action.frequency) { daysOverdue = daysSince - action.frequency + 1; statusText = 'Последний раз: ' + formatDate(last.date); }
          else return;
        }
        overdue.push({ actionName: action.name, equipName: equip?equip.name:'—', daysOverdue, statusText, frequency: action.frequency });
      });
      overdue.sort((a,b) => b.daysOverdue - a.daysOverdue);
      document.getElementById('overdue-count').textContent = overdue.length;
      const overdueList = document.getElementById('overdue-list');
      const overdueEmpty = document.getElementById('overdue-empty');
      if (!overdue.length) { overdueList.innerHTML = ''; overdueEmpty.classList.remove('hidden'); }
      else {
        overdueEmpty.classList.add('hidden');
        overdueList.innerHTML = overdue.map(item => `
          <div class="bg-slate-800/60 rounded-xl px-4 py-3 flex justify-between gap-3">
            <div><div class="font-medium text-sm">${esc(item.actionName)}</div>
            <div class="text-xs text-slate-400">${esc(item.equipName)}</div>
            <div class="text-xs text-slate-500 mt-1">${item.statusText}</div></div>
            <div class="text-right"><div class="text-sm font-semibold text-rose-400">${item.daysOverdue} дн.</div></div>
          </div>`).join('');
      }
      const employees = getDeptUsers();
      const stats = employees.map(user => {
        const userComps = deptComps.filter(comp => comp.userId === user.id);
        return { user, total: userComps.length, lastDate: userComps.length ? userComps.sort((a,b)=>b.date.localeCompare(a.date))[0].date : null };
      }).sort((a,b) => b.total - a.total);
      const statsEl = document.getElementById('employee-stats');
      const statsEmpty = document.getElementById('employee-stats-empty');
      if (!stats.length || stats.every(s => s.total === 0)) { statsEl.innerHTML = ''; statsEmpty.classList.remove('hidden'); }
      else {
        statsEmpty.classList.add('hidden');
        statsEl.innerHTML = stats.map(s => `
          <div class="bg-slate-800/60 rounded-xl px-4 py-3 flex justify-between">
            <div><div class="font-medium text-sm">${esc(s.user.name)}</div>
            <div class="text-xs text-slate-400">${s.lastDate?'последний: '+formatDate(s.lastDate):'нет работ'}</div></div>
            <div class="text-lg font-bold text-primary-400">${s.total}</div>
          </div>`).join('');
      }
      const comps = [...deptComps].sort((a,b) => b.date.localeCompare(a.date));
      const tasksList = document.getElementById('employee-tasks-list');
      const tasksEmpty = document.getElementById('employee-tasks-empty');
      if (!comps.length) { tasksList.innerHTML = ''; tasksEmpty.classList.remove('hidden'); }
      else {
        tasksEmpty.classList.add('hidden');
        tasksList.innerHTML = comps.map(comp => {
          const user = c.users.find(u => u.id === comp.userId);
          return `<div class="bg-slate-800/60 rounded-xl px-4 py-3">
            <div class="font-medium text-sm">${esc(comp.title)}</div>
            <div class="text-xs text-slate-400">${esc(comp.equipName)}</div>
            <div class="text-xs text-slate-500 mt-1"><span class="text-primary-400">${user?esc(user.name):'—'}</span> · ${formatDate(comp.date)}</div>
            ${comp.comment ? `<div class="text-xs text-slate-300 mt-2">💬 ${esc(comp.comment)}</div>` : ''}
          </div>`;
        }).join('');
      }
    }

    function openDeptModal() {
      if (getUser().role !== 'manager') return toast('Только руководитель компании');
      document.getElementById('dept-name').value = '';
      document.getElementById('modal-dept').classList.remove('hidden');
    }
    function closeDeptModal() { document.getElementById('modal-dept').classList.add('hidden'); }
    function saveDepartment() {
      const name = document.getElementById('dept-name').value.trim();
      if (!name) return toast('Укажите название');
      const c = getCompany();
      const plan = getPlan();
      if (c.departments.length >= plan.maxDepts) {
        return toast('Лимит подразделений по тарифу «' + plan.name + '»: ' + plan.maxDepts + '. Перейдите в Кабинет для смены тарифа.');
      }
      const id = uid();
      c.departments.push({ id, name, inviteCode: generateCode() });
      currentDeptId = id; saveDB(); closeDeptModal();
      renderDeptSelect(); generateTodayTasks(); showPage('dashboard');
      toast('Подразделение создано');
    }

    function openEquipModal() {
      if (!getActiveDeptId()) return toast('Сначала создайте подразделение');
      document.getElementById('equip-name').value = '';
      document.getElementById('equip-code').value = '';
      document.getElementById('equip-location').value = '';
      document.getElementById('modal-equip').classList.remove('hidden');
    }
    function closeEquipModal() { document.getElementById('modal-equip').classList.add('hidden'); }
    function saveEquipment() {
      const name = document.getElementById('equip-name').value.trim();
      if (!name) return toast('Укажите название');
      const plan = getPlan();
      const deptId = getActiveDeptId();
      const count = getCompany().equipment.filter(e => e.departmentId === deptId).length;
      if (count >= plan.maxEquip) {
        return toast('Лимит оборудования по тарифу «' + plan.name + '»: ' + plan.maxEquip + ' на подразделение. Смените тариф в Кабинете.');
      }
      getCompany().equipment.push({
        id: uid(), name,
        code: document.getElementById('equip-code').value.trim(),
        location: document.getElementById('equip-location').value.trim(),
        departmentId: deptId
      });
      saveDB(); closeEquipModal(); renderEquipment(); toast('Добавлено');
    }
    async function deleteEquipment(id) {
      if (!confirm('Удалить оборудование и связанные регламенты?')) return;
      const c = getCompany();
      const actionIds = c.actions.filter(a => a.equipmentId === id).map(a => a.id);
      const taskIds = c.tasks.filter(t => t.equipmentId === id).map(t => t.id);
      const completionIds = c.completions.filter(x => x.equipmentId === id).map(x => x.id);
      const { error: ce } = await supabaseClient.from('completions').delete().in('id', completionIds.length ? completionIds : ['00000000-0000-0000-0000-000000000000']);
      if (ce) return toast('Ошибка удаления: ' + ce.message);
      const { error: te } = await supabaseClient.from('tasks').delete().in('id', taskIds.length ? taskIds : ['00000000-0000-0000-0000-000000000000']);
      if (te) return toast('Ошибка удаления: ' + te.message);
      const { error: ae } = await supabaseClient.from('maintenance_actions').delete().in('id', actionIds.length ? actionIds : ['00000000-0000-0000-0000-000000000000']);
      if (ae) return toast('Ошибка удаления: ' + ae.message);
      const { error: ee } = await supabaseClient.from('equipment').delete().eq('id', id);
      if (ee) return toast('Ошибка удаления оборудования: ' + ee.message);
      c.equipment = c.equipment.filter(e => e.id !== id);
      c.actions = c.actions.filter(a => a.equipmentId !== id);
      c.tasks = c.tasks.filter(t => t.equipmentId !== id);
      c.completions = c.completions.filter(x => x.equipmentId !== id);
      saveDB(); renderEquipment(); toast('Оборудование удалено');
    }

    function openActionModal() {
      const equip = getDeptEquipment();
      if (!equip.length) return toast('Сначала добавьте оборудование');
      document.getElementById('action-equip').innerHTML = equip.map(e => `<option value="${e.id}">${esc(e.name)}</option>`).join('');
      document.getElementById('action-name').value = '';
      document.getElementById('action-desc').value = '';
      document.getElementById('action-freq').value = '7';
      document.getElementById('modal-action').classList.remove('hidden');
    }
    function closeActionModal() { document.getElementById('modal-action').classList.add('hidden'); }
    function saveAction() {
      const name = document.getElementById('action-name').value.trim();
      if (!name) return toast('Укажите название');
      getCompany().actions.push({
        id: uid(),
        equipmentId: document.getElementById('action-equip').value,
        name, description: document.getElementById('action-desc').value.trim(),
        frequency: parseInt(document.getElementById('action-freq').value, 10),
        departmentId: getActiveDeptId()
      });
      saveDB(); generateTodayTasks(); closeActionModal(); renderActions(); toast('Добавлено');
    }
    async function deleteAction(id) {
      if (!confirm('Удалить регламент и связанные задания?')) return;
      const c = getCompany();
      const { error: ce } = await supabaseClient.from('completions').delete().eq('action_id', id);
      if (ce) return toast('Ошибка удаления: ' + ce.message);
      const { error: te } = await supabaseClient.from('tasks').delete().eq('action_id', id);
      if (te) return toast('Ошибка удаления: ' + te.message);
      const { error: ae } = await supabaseClient.from('maintenance_actions').delete().eq('id', id);
      if (ae) return toast('Ошибка удаления: ' + ae.message);
      c.actions = c.actions.filter(a => a.id !== id);
      c.tasks = c.tasks.filter(t => t.actionId !== id);
      c.completions = c.completions.filter(x => x.actionId !== id);
      saveDB(); renderActions(); toast('Регламент удалён');
    }

    function openCompleteModal(taskId) {
      currentCompleteTaskId = taskId; currentPhotoBase64 = null; currentPhotoFile = null;
      const task = getCompany().tasks.find(t => t.id === taskId);
      document.getElementById('complete-task-info').textContent = task.title + ' · ' + task.equipName;
      document.getElementById('complete-comment').value = '';
      document.getElementById('photo-preview').classList.add('hidden');
      document.getElementById('photo-placeholder').classList.remove('hidden');
      document.getElementById('modal-complete').classList.remove('hidden');
    }
    function closeCompleteModal() { document.getElementById('modal-complete').classList.add('hidden'); }
    function handlePhoto(e) {
      const file = e.target.files[0]; if (!file) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        currentPhotoBase64 = ev.target.result;
        currentPhotoFile = file;
        const img = document.getElementById('photo-preview');
        img.src = currentPhotoBase64; img.classList.remove('hidden');
        document.getElementById('photo-placeholder').classList.add('hidden');
      };
      reader.readAsDataURL(file);
    }
    async function submitComplete() {
      if (!currentPhotoFile) return toast('Прикрепите фото');
      const c = getCompany();
      const task = c.tasks.find(t => t.id === currentCompleteTaskId);
      const user = getUser();
      if (!task || !user) return toast('Задача или пользователь не найдены');

      try {
        const now = new Date();
        const ext = (currentPhotoFile.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g,'') || 'jpg';
        const path = c.id + '/' + task.departmentId + '/' + task.id + '/' + Date.now() + '.' + ext;
        const { error: uploadError } = await supabaseClient.storage.from('equipment-photos').upload(path, currentPhotoFile, {
          upsert: false,
          contentType: currentPhotoFile.type || 'image/jpeg'
        });
        if (uploadError) throw uploadError;

        task.status = 'done';
        c.completions.push({
          id: uid(), taskId: task.id, actionId: task.actionId, equipmentId: task.equipmentId,
          departmentId: task.departmentId, userId: user.id, title: task.title, equipName: task.equipName,
          date: todayStr(), time: now.toLocaleTimeString('ru-RU', {hour:'2-digit',minute:'2-digit'}),
          photoPath: path, photo: '', comment: document.getElementById('complete-comment').value.trim()
        });
        saveDB();

        closeCompleteModal();
        const successEl = document.getElementById('modal-success');
        successEl.classList.remove('hidden');
        successEl.style.display = 'flex';
      } catch (e) {
        console.error(e);
        toast(e.message || 'Не удалось загрузить фото');
      }
    }
    function closeSuccessModal() {
      const successEl = document.getElementById('modal-success');
      successEl.classList.add('hidden');
      successEl.style.display = '';
      showPage('today');
    }

    function copyInviteCode() {
      const code = document.getElementById('invite-code-display').textContent;
      if (code && code !== '—') navigator.clipboard.writeText(code).then(() => toast('Скопировано'));
    }
    function regenerateInvite() {
      const c = getCompany();
      const sel = document.getElementById('invite-dept-select');
      const dept = c.departments.find(d => d.id === sel.value);
      if (!dept) return;
      dept.inviteCode = generateCode(); saveDB(); updateInviteCodeDisplay(); toast('Новый код');
    }
    function setResponsible(userId, make) {
      const c = getCompany();
      const user = c.users.find(u => u.id === userId);
      if (!user) return;
      if (make) {
        // only one responsible per department — demote previous
        c.users.forEach(u => {
          if (u.departmentId === user.departmentId && u.role === 'responsible') u.role = 'employee';
        });
        user.role = 'responsible';
        toast(user.name + ' назначен ответственным');
      } else {
        user.role = 'employee';
        toast('Ответственный снят');
      }
      saveDB();
      renderTeam();
    }
    async function removeEmployee(userId) {
      if (!confirm('Удалить сотрудника? Он больше не сможет войти в приложение.')) return;
      const { error } = await supabaseClient.from('profiles').delete().eq('id', userId);
      if (error) return toast('Ошибка удаления сотрудника: ' + error.message);
      getCompany().users = getCompany().users.filter(u => u.id !== userId);
      saveDB(); renderTeam(); toast('Сотрудник удалён');
    }


    let pendingPlanId = null;

    function renderCabinet() {
      if (getUser().role !== 'manager') { showPage('dashboard'); return; }
      const c = getCompany();
      const sub = c.subscription || { planId: 'free', expiresAt: null };
      const plan = getPlan();
      const days = getDaysLeft();
      document.getElementById('cab-plan-name').textContent = plan.name;
      const daysEl = document.getElementById('cab-days-left');
      if (plan.id === 'free') {
        daysEl.textContent = '∞';
        daysEl.className = 'text-2xl font-bold text-slate-400';
        document.getElementById('btn-renew').classList.add('hidden');
      } else {
        daysEl.textContent = days !== null ? days : '0';
        daysEl.className = 'text-2xl font-bold ' + (days > 7 ? 'text-emerald-400' : days > 0 ? 'text-amber-400' : 'text-rose-400');
        document.getElementById('btn-renew').classList.remove('hidden');
      }
      document.getElementById('cab-limits').textContent =
        'Лимиты: до ' + plan.maxDepts + ' подразд. · до ' + plan.maxEquip + ' оборуд. в каждом · Сейчас: ' +
        c.departments.length + ' подразд., ' + c.equipment.length + ' оборуд. всего';

      // plans list
      const list = document.getElementById('plans-list');
      list.innerHTML = Object.values(PLANS).map(p => {
        const isCurrent = plan.id === p.id && isSubActive();
        return `<div class="bg-slate-900 border ${isCurrent ? 'border-primary-500' : 'border-slate-800'} rounded-2xl p-5">
          <div class="flex items-center justify-between mb-2">
            <div class="font-bold text-lg">${p.name}</div>
            ${isCurrent ? '<span class="text-xs bg-primary-500/20 text-primary-400 px-2 py-1 rounded-full">текущий</span>' : ''}
          </div>
          <div class="text-2xl font-bold mb-1">${p.price ? p.price + ' ₽' : '0 ₽'}<span class="text-sm font-normal text-slate-400">${p.price ? '/мес' : ''}</span></div>
          <div class="text-sm text-slate-400 mb-4">до ${p.maxDepts} подразд. · до ${p.maxEquip} оборуд. в каждом</div>
          ${p.id === 'free' ? '' : `<button onclick="startPay('${p.id}')" class="w-full py-2.5 rounded-xl text-sm font-medium ${isCurrent ? 'bg-slate-800 text-slate-400' : 'bg-primary-600 hover:bg-primary-500 text-white'} transition">${isCurrent ? 'Продлить на 30 дней' : 'Выбрать'}</button>`}
        </div>`;
      }).join('');
    }

    function startPay(planId) {
      if (getUser().role !== 'manager') return;
      pendingPlanId = planId;
      const p = PLANS[planId];
      document.getElementById('pay-confirm-text').textContent =
        'Тариф «' + p.name + '» — ' + p.price + ' ₽. После оплаты доступ откроется на 30 дней.';
      document.getElementById('pay-confirm').classList.remove('hidden');
      document.getElementById('plans-section').classList.add('hidden');
    }
    function cancelPay() {
      pendingPlanId = null;
      document.getElementById('pay-confirm').classList.add('hidden');
    }
    function confirmPay() {
      if (getUser().role !== 'manager') return;
      if (!pendingPlanId) return;
      const p = PLANS[pendingPlanId];
      const c = getCompany();
      const now = new Date();
      const expires = new Date(now.getTime() + p.days * 24 * 60 * 60 * 1000);
      c.subscription = {
        planId: p.id,
        startedAt: now.toISOString(),
        expiresAt: expires.toISOString()
      };
      saveDB();
      pendingPlanId = null;
      document.getElementById('pay-confirm').classList.add('hidden');
      generateTodayTasks();
      renderCabinet();
      toast('Подписка «' + p.name + '» активирована на 30 дней');
    }
    function renewCurrentPlan() {
      const c = getCompany();
      const sub = c.subscription || { planId: 'free' };
      if (sub.planId === 'free') return;
      startPay(sub.planId);
      document.getElementById('plans-section').classList.add('hidden');
    }



    const INFO_HELP = `
      <p class="font-semibold text-white">Быстрый старт</p>
      <ol class="list-decimal list-inside space-y-2 text-slate-300">
        <li>Создайте <b>подразделения</b> (кнопка «+ Создать» сверху).</li>
        <li>В каждом подразделении добавьте <b>оборудование</b>.</li>
        <li>Назначьте <b>действия ТО</b> и периодичность (раз в день, неделю и т.д.).</li>
        <li>В разделе <b>Команда</b> выберите подразделение, скопируйте код и отправьте сотруднику.</li>
        <li>Сотрудник входит по вкладке «По коду» и видит только свои задачи.</li>
        <li>При выполнении задачи сотрудник <b>обязательно прикрепляет фото</b>.</li>
        <li>В <b>Отчётах</b> и <b>Истории</b> смотрите, что сделано и что просрочено.</li>
      </ol>
      <p class="text-slate-400 mt-3">Сотрудники не видят другие подразделения. Руководитель переключается между ними в верхней панели.</p>
    `;

    const INFO_ABOUT = `
      <p><b class="text-white">Check App</b> — приложение для контроля технического обслуживания оборудования.</p>
      <p class="font-semibold text-white mt-3">Для кого</p>
      <p>Для руководителей сервисных служб, мастерских, производств и сетей точек, где нужно следить, чтобы ТО выполнялось вовремя и с подтверждением.</p>
      <p class="font-semibold text-white mt-3">Какие задачи закрывает</p>
      <ul class="list-disc list-inside space-y-1">
        <li>Планирование регулярных работ по оборудованию</li>
        <li>Выдача задач сотрудникам по подразделениям</li>
        <li>Фото-фиксация выполненных работ</li>
        <li>Контроль просрочек и дисциплины выполнения</li>
        <li>Разделение доступа: каждое подразделение видит только своё</li>
      </ul>
      <p class="font-semibold text-white mt-3">Удалённый контроль</p>
      <p>Руководитель видит статус задач, историю и фото из любого места — без звонков и бумажных журналов. Сотрудник в поле отмечает работу с телефона и сразу прикладывает снимок.</p>
      <p class="font-semibold text-white mt-3">Выгода</p>
      <ul class="list-disc list-inside space-y-1">
        <li>Прозрачность: видно, кто и когда выполнил работу</li>
        <li>Порядок в регламентах ТО по всем точкам</li>
        <li>Меньше забытых и «сделанных на словах» работ</li>
        <li>Единая картина по подразделениям в одном месте</li>
      </ul>
    `;

    function openInfoModal(type) {
      const title = document.getElementById('info-modal-title');
      const body = document.getElementById('info-modal-body');
      if (type === 'help') {
        title.textContent = 'Инструкция';
        body.innerHTML = INFO_HELP;
      } else {
        title.textContent = 'О приложении';
        body.innerHTML = INFO_ABOUT;
      }
      document.getElementById('modal-info').classList.remove('hidden');
    }
    function closeInfoModal() {
      document.getElementById('modal-info').classList.add('hidden');
    }

    function openPhotoModal(src) {
      document.getElementById('photo-viewer-img').src = src;
      document.getElementById('modal-photo').classList.remove('hidden');
    }
    function closePhotoModal() { document.getElementById('modal-photo').classList.add('hidden'); }

    (async function initCloudApp() {
      try {
        const { data: { session } } = await supabaseClient.auth.getSession();
        if (!session) return;
        const ok = await hydrateCurrentUser();
        if (ok) enterApp();
      } catch (e) {
        console.error('Check App initialization error:', e);
        showError('Не удалось загрузить данные из Supabase.');
      }
    })();
  
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && pendingOtp && !document.getElementById('otp-modal').classList.contains('hidden')) {
        event.preventDefault();
        verifyPendingOtp();
      }
    });
