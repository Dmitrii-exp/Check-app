// =========================
    // Supabase connection
    // =========================
    const SUPABASE_URL = 'https://qaxoufarhpagcjkhptga.supabase.co';
    const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_ZMXWb57L46oreSiZJvCe5Q_JXG-IC-u';
    // Bound actual network I/O, including session refresh and profile requests.
    async function fetchWithTimeout(input, options = {}) {
      const controller = new AbortController();
      const upstream = options.signal || input?.signal;
      const abort = () => controller.abort();
      if (upstream?.aborted) abort();
      upstream?.addEventListener('abort', abort, { once: true });
      const url = typeof input === 'string' ? input : input.url;
      const timer = setTimeout(abort, /\/(auth|rest)\/v1\//.test(url) ? 20000 : 60000);
      try {
        return await fetch(input, { ...options, signal: controller.signal });
      } finally {
        clearTimeout(timer);
        upstream?.removeEventListener('abort', abort);
      }
    }
    function checkAuthAttempt(signal) {
      if (signal?.aborted) throw signal.reason || new Error('Время ожидания входа истекло. Повторите вход.');
    }
    let activeAuthAttempt = null;
    async function withAuthDeadline(operation, milliseconds = 30000) {
      if (activeAuthAttempt) {
        const superseded = new Error('Вход заменён новой попыткой.');
        superseded.code = 'AUTH_SUPERSEDED';
        activeAuthAttempt.abort(superseded);
      }
      const controller = new AbortController();
      activeAuthAttempt = controller;
      let timer;
      try {
        return await Promise.race([
          Promise.resolve().then(() => operation(controller.signal)),
          new Promise((_, reject) => {
            controller.signal.addEventListener('abort', () => reject(controller.signal.reason), { once: true });
            timer = setTimeout(() => controller.abort(new Error('Не удалось завершить вход за 30 секунд. Проверьте соединение, смените Wi-Fi на мобильную сеть и повторите вход.')), milliseconds);
          })
        ]);
      } finally {
        clearTimeout(timer);
        if (activeAuthAttempt === controller) activeAuthAttempt = null;
      }
    }
    const supabaseClient = (window.supabase && typeof window.supabase.createClient === 'function')
      ? window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
          global: { fetch: fetchWithTimeout },
          auth: {
            persistSession: true,
            autoRefreshToken: true,
            detectSessionInUrl: true,
            storageKey: 'checkapp-auth-session'
          }
        })
      : null;
    function ensureSupabase(){
      if (supabaseClient) return true;
      showError('Не загрузился модуль Supabase. Скачайте файл на компьютер и откройте его обычным браузером с доступом в интернет. Не запускайте его во встроенном просмотрщике ChatGPT.');
      return false;
    }

    const STORAGE_KEY = 'checkapp_v3';

    const PLANS = {
      free:     { id:'free', name:'Бесплатная', maxDepts:1, maxEquip:5, price:0, days:0 },
      lite:     { id:'lite', name:'Лайт', maxDepts:1, maxEquip:15, price:490, days:30 },
      standard: { id:'standard', name:'Стандарт', maxDepts:3, maxEquip:25, price:990, days:30 },
      standard_plus: { id:'standard_plus', name:'Стандарт+', maxDepts:5, maxEquip:25, price:1790, days:30 },
      premium:  { id:'premium', name:'Премиум', maxDepts:10, maxEquip:25, price:2990, days:30 },
      ultra:    { id:'ultra', name:'Ультра', maxDepts:20, maxEquip:25, price:4990, days:30 }
    };

    let db = loadDB();
    let currentPhotoBase64 = null;
    let currentPhotoFile = null;
    let currentCompleteTaskId = null;
    let currentDeptId = null;

    function loadDB() {
      // Business data is now loaded from Supabase after authentication.
      // localStorage is kept only for harmless UI compatibility; it is no longer
      // the source of truth for companies, users, equipment or tasks.
      return { companies: {}, currentUser: null };
    }

    // Each mutation is sent explicitly. Never bulk-upsert a stale client snapshot.

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

    async function hydrateCurrentUser(signal) {
      checkAuthAttempt(signal);
      const { data: authData } = await supabaseClient.auth.getUser();
      checkAuthAttempt(signal);
      const authUser = authData?.user;
      if (!authUser) return false;

      const { data: profile, error: profileError } = await supabaseClient
        .from('profiles').select('*').eq('id', authUser.id).maybeSingle();

      checkAuthAttempt(signal);
      if (profileError) throw profileError;
      if (!profile) {
        if (typeof restorePendingCompanyDeletion === 'function') await restorePendingCompanyDeletion();
        return false;
      }

      const { data: company, error: companyError } = await supabaseClient
        .from('companies').select('*').eq('id', profile.company_id).single();
      checkAuthAttempt(signal);
      if (companyError) throw companyError;

      const {error: dueError} = await supabaseClient.rpc('ensure_due_maintenance_tasks');
      if (dueError) throw dueError;
      const {data: workLimits, error: limitsError} = await supabaseClient.rpc('get_current_work_limits');
      if (limitsError) throw limitsError;
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
        profile.role === 'manager' ? supabaseClient.from('subscriptions').select('*').eq('company_id', company.id).maybeSingle() : Promise.resolve({data:null,error:null}),
        supabaseClient.from('profiles').select('*').eq('company_id', company.id).order('created_at')
      ]);
      checkAuthAttempt(signal);
      const firstError = [dErr,eErr,aErr,tErr,cErr,sErr,pErr].find(Boolean);
      if (firstError) throw firstError;

      db.companies[company.id] = {
        id: company.id,
        name: company.name,
        departments: (departments || []).map(d => ({id:d.id, name:d.name, inviteCode:d.invite_code})),
        equipment: (equipment || []).map(e => ({id:e.id, name:e.name, code:e.code || '', location:e.location || '', photoPath:e.photo_path || null, departmentId:e.department_id})),
        actions: (actions || []).map(a => ({id:a.id, equipmentId:a.equipment_id, name:a.name, description:a.description || '', frequency:a.frequency, departmentId:a.department_id})),
        tasks: (tasks || []).map(t => ({id:t.id, actionId:t.action_id, equipmentId:t.equipment_id, assignedUserId:t.assigned_user_id, departmentId:t.department_id, date:t.date, status:t.status, title:t.title, equipName:t.equip_name || '', equipCode:t.equip_code || '', description:t.description || '', blockedComment:t.blocked_comment || '', blockedWorkerName:t.blocked_worker_name || '', blockedAt:t.blocked_at || null})),
        completions: (completions || []).map(c => ({id:c.id, taskId:c.task_id, actionId:c.action_id, equipmentId:c.equipment_id, departmentId:c.department_id, userId:c.user_id, title:c.title, equipName:c.equip_name || '', date:c.date, time:c.time || '', photoPath:c.photo_path || '', photo:'', comment:c.comment || '', workerName:c.worker_name || ''})),
        users: (profiles || []).map(u => ({id:u.id, name:u.name, email:(u.id === authUser.id ? (authUser.email || '') : ''), phone:u.phone || '', role:u.role, departmentId:u.department_id})),
        workLimits,
        subscription: subscriptions ? {planId:subscriptions.plan_id, startedAt:subscriptions.started_at, expiresAt:subscriptions.expires_at} : null
      };
      db.currentUser = { company: company.id, email: authUser.email || '', role: profile.role, id: authUser.id };
      try {
        const { data: adminData, error: adminError } = await supabaseClient.rpc('is_super_admin');
        checkAuthAttempt(signal);
        isSuperAdmin = !adminError && adminData === true;
      } catch (_) { checkAuthAttempt(signal); isSuperAdmin = false; }
      try {
        if(profile.role !== 'manager') { isUnlimitedCompany=false; } else {
        const { data: unlimitedData, error: unlimitedError } = await supabaseClient.rpc('current_company_is_unlimited');
        checkAuthAttempt(signal);
        isUnlimitedCompany = !unlimitedError && unlimitedData === true; }
      } catch (_) { checkAuthAttempt(signal); isUnlimitedCompany = false; }
      checkAuthAttempt(signal);
      currentDeptId = profile.role === 'manager'
        ? ((departments || [])[0]?.id || null)
        : profile.department_id;
      return true;
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
      t.className = 'fixed bottom-6 left-1/2 -translate-x-1/2 bg-[#1c2a3d] text-white text-sm px-5 py-3 rounded-2xl shadow-xl z-50 fade-in';
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
      // return all, but we'll mark which are active
      return all.map((e, i) => ({ ...e, _active: isEquipmentActive(e.id), _index: i }));
    }
    function getDeptActions() { return getCompany().actions.filter(a => a.departmentId === getActiveDeptId()); }
    function getDeptTasks(date) {
      // An expired paid subscription pauses the task calendar, but never deletes stored tasks.
      if (isPaidSubscriptionExpired()) return [];
      return getCompany().tasks.filter(t => {
        if ((t.date !== date && !(t.date < date && t.status !== 'done')) || t.departmentId !== getActiveDeptId()) return false;
        // hide pending tasks for frozen equipment
        if (t.status !== 'done' && !isEquipmentActive(t.equipmentId)) return false;
        return true;
      });
    }
    function getDeptCompletions() { return getCompany().completions.filter(c => c.departmentId === getActiveDeptId()); }
    function getDeptUsers() { return getCompany().users.filter(u => u.departmentId === getActiveDeptId() && u.role !== 'manager'); }

    function getPlan() {
      const c = getCompany();
      if(getUser()?.role !== 'manager' && c.workLimits) return {id:'work',name:'Доступ к работе',maxDepts:c.workLimits.max_departments,maxEquip:c.workLimits.max_equipment};
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

    function isPaidSubscriptionExpired() {
      if(getUser()?.role !== 'manager' && getCompany()?.workLimits) return !getCompany().workLimits.work_active;
      if (isUnlimitedCompany) return false;
      const sub = getCompany()?.subscription;
      if (!sub || sub.planId === 'free') return false;
      return !sub.expiresAt || new Date(sub.expiresAt).getTime() < Date.now();
    }

    function isSubActive() {
      if(getUser()?.role !== 'manager' && getCompany()?.workLimits) return getCompany().workLimits.work_active;
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
      return c.workLimits ? all.filter(e=>c.workLimits.active_equipment_ids.includes(e.id)) : all.slice(0, plan.maxEquip);
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
      return c.workLimits ? c.departments.filter(d=>c.workLimits.active_department_ids.includes(d.id)) : c.departments.slice(0, plan.maxDepts);
    }

    function isDepartmentActive(deptId) {
      return getActiveDepartments().some(d => d.id === deptId);
    }



    function switchAuthTab(tab) {
      ['login', 'register', 'invite'].forEach(t => {
        document.getElementById('form-' + t).classList.toggle('hidden', t !== tab);
        const btn = document.getElementById('tab-' + t);
        if (t === tab) { btn.classList.add('bg-primary-600', 'text-white'); btn.classList.remove('text-[#a8b5c8]'); }
        else { btn.classList.remove('bg-primary-600', 'text-white'); btn.classList.add('text-[#a8b5c8]'); }
      });
    }


    // Open the registration tab from the public landing page without affecting native login.
    if (window.location.hash === '#register') {
      window.addEventListener('load', () => switchAuthTab('register'), { once: true });
    }

    let pendingEmail = null;
    let isSuperAdmin = false;
    let isUnlimitedCompany = false;
    let adminCompanies = [];

    const AUTH_PUBLIC_URL = 'https://app-check.ru/app/';
    const AUTH_MOBILE_RECOVERY_URL = 'ru.checkapp.mobile://recovery';
    const isNativeCheckApp = () => !!(window.Capacitor?.isNativePlatform?.());

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
        message.textContent = `Код подтверждения отправлен на ${email}. Введите код из письма (6 или 8 цифр).`;
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

        if (meta.mode === 'register' && meta.company && meta.name) {
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
      if (!/^(?:\d{6}|\d{8})$/.test(code)) {
        setStatus('Введите код из письма (6 или 8 цифр).');
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

      if (!document.getElementById('form-invite').classList.contains('hidden')) return acceptEmailInvitation();
      const company = document.getElementById('reg-company').value.trim();
      const name = document.getElementById('reg-name').value.trim();
      const email = document.getElementById('reg-email').value.trim().toLowerCase();
      const password = document.getElementById('reg-password').value;
      if (!company || !name || !email || password.length<8) return showError('Заполните название компании, имя, Email и пароль минимум из 8 символов.');

      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return showError('Введите корректный Email.');
      }

      const meta = {
        mode: 'register',
        email,
        name,
        company,
        code: generateCode()
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

    let passwordRecoveryActive = false;
    function recoveryMessage(message, error = false) {
      const el = document.getElementById('recovery-message');
      el.textContent = message;
      el.className = 'text-sm min-h-[20px] ' + (error ? 'text-red-400' : 'text-emerald-400');
    }
    function openPasswordRecovery(reset = false) {
      const modal = document.getElementById('password-recovery-modal');
      modal.classList.remove('hidden');
      modal.classList.add('flex');
      document.getElementById('recovery-email-step').classList.toggle('hidden', reset);
      document.getElementById('recovery-password-step').classList.toggle('hidden', !reset);
      document.getElementById('recovery-title').textContent = reset ? 'Создание нового пароля' : 'Восстановление пароля';
      document.getElementById('recovery-email').value = document.getElementById('login-email').value.trim();
      document.getElementById('recovery-new-password').value = '';
      document.getElementById('recovery-repeat-password').value = '';
      recoveryMessage('');
      if (reset) passwordRecoveryActive = true;
    }
    function closePasswordRecovery() {
      const modal = document.getElementById('password-recovery-modal');
      modal.classList.add('hidden');
      modal.classList.remove('flex');
    }
    async function sendPasswordRecovery() {
      if (!ensureSupabase()) return;
      const email = document.getElementById('recovery-email').value.trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return recoveryMessage('Введите корректный Email.', true);
      const btn = document.getElementById('recovery-send');
      btn.disabled = true;
      try {
        const { error } = await supabaseClient.auth.resetPasswordForEmail(email, { redirectTo: isNativeCheckApp() ? AUTH_MOBILE_RECOVERY_URL : AUTH_PUBLIC_URL });
        if (error) throw error;
        recoveryMessage('Если учётная запись существует, письмо для восстановления отправлено на указанный Email.');
      } catch (e) {
        recoveryMessage('Не удалось отправить письмо. Повторите попытку позже.', true);
        console.error('[Check App] password recovery send:', e);
      } finally { btn.disabled = false; }
    }
    async function saveRecoveredPassword() {
      if (!ensureSupabase() || !passwordRecoveryActive) return recoveryMessage('Откройте ссылку восстановления из письма.', true);
      const pass = document.getElementById('recovery-new-password').value;
      const repeat = document.getElementById('recovery-repeat-password').value;
      const first = document.getElementById('recovery-new-password');
      const second = document.getElementById('recovery-repeat-password');
      first.classList.remove('border-red-500'); second.classList.remove('border-red-500');
      if (pass.length < 8) { first.classList.add('border-red-500'); return recoveryMessage('Пароль должен содержать минимум 8 символов.', true); }
      if (pass !== repeat) { first.classList.add('border-red-500'); second.classList.add('border-red-500'); return recoveryMessage('Пароли не совпадают.', true); }
      const btn = document.getElementById('recovery-save');
      btn.disabled = true;
      try {
        const { error } = await supabaseClient.auth.updateUser({ password: pass });
        if (error) throw error;
        passwordRecoveryActive = false;
        await supabaseClient.auth.signOut();
        closePasswordRecovery();
        switchAuthTab('login');
        document.getElementById('login-password').value = '';
        toast('Пароль изменён. Войдите с новым паролем.');
      } catch (e) {
        recoveryMessage('Не удалось изменить пароль. Откройте новую ссылку восстановления.', true);
        console.error('[Check App] password recovery update:', e);
      } finally { btn.disabled = false; }
    }
    async function processMobileRecoveryLink(url) {
      if (!url?.startsWith(AUTH_MOBILE_RECOVERY_URL)) return;
      try {
        const parsed = new URL(url);
        const fragment = new URLSearchParams(parsed.hash.replace(/^#/, ''));
        const query = parsed.searchParams;
        const error = fragment.get('error_description') || query.get('error_description');
        if (error) throw new Error(error);
        const accessToken = fragment.get('access_token') || query.get('access_token');
        const refreshToken = fragment.get('refresh_token') || query.get('refresh_token');
        const code = query.get('code');
        if (accessToken && refreshToken) {
          const { error: sessionError } = await supabaseClient.auth.setSession({ access_token: accessToken, refresh_token: refreshToken });
          if (sessionError) throw sessionError;
        } else if (code) {
          const { error: exchangeError } = await supabaseClient.auth.exchangeCodeForSession(code);
          if (exchangeError) throw exchangeError;
        } else {
          throw new Error('Ссылка не содержит данных восстановления.');
        }
        passwordRecoveryActive = true;
        openPasswordRecovery(true);
      } catch (e) {
        openPasswordRecovery();
        recoveryMessage('Ссылка восстановления недействительна или истекла. Запросите новое письмо.', true);
        console.error('[Check App] recovery deep link:', e);
      }
    }
    async function initMobileRecoveryLinks() {
      if (!isNativeCheckApp()) return;
      try {
        const App = window.Capacitor?.Plugins?.App;
        if (!App) throw new Error('Capacitor App plugin unavailable');
        App.addListener('appUrlOpen', ({ url }) => { void processMobileRecoveryLink(url); });
        const launch = await App.getLaunchUrl();
        if (launch?.url) await processMobileRecoveryLink(launch.url);
      } catch (e) {
        console.error('[Check App] mobile link initialization:', e);
      }
    }
    void initMobileRecoveryLinks();

    async function handlePasswordRecoveryLink() {
      const params = new URLSearchParams(window.location.hash.replace(/^#/, ''));
      const tokenHash = params.get('token_hash');
      if (params.get('type') !== 'recovery' || !tokenHash || !ensureSupabase()) return;
      // Do not restore a different saved account while verifying the recovery link.
      passwordRecoveryActive = true;
      window.history.replaceState({}, document.title, window.location.pathname + window.location.search);
      openPasswordRecovery();
      recoveryMessage('Проверяем ссылку восстановления…');
      const button = document.getElementById('recovery-send');
      button.disabled = true;
      try {
        await withAuthDeadline(async signal => {
          const { error } = await supabaseClient.auth.verifyOtp({ token_hash: tokenHash, type: 'recovery' });
          checkAuthAttempt(signal);
          if (error) throw error;
          openPasswordRecovery(true);
        });
      } catch (error) {
        passwordRecoveryActive = false;
        openPasswordRecovery();
        recoveryMessage('Ссылка восстановления недействительна или истекла. Запросите новое письмо.', true);
      } finally { button.disabled = false; }
    }


    if (supabaseClient) {
      supabaseClient.auth.onAuthStateChange((event) => {
        if (event === 'PASSWORD_RECOVERY') {
          passwordRecoveryActive = true;
          openPasswordRecovery(true);
        }
      });
    }

    let loginInProgress = false;
    function setLoginLoading(loading, message = 'Выполняется вход…') {
      const button = document.getElementById('login-submit');
      const spinner = document.getElementById('login-spinner');
      const text = document.getElementById('login-submit-text');
      const status = document.getElementById('login-loading-status');
      if (button) { button.disabled = loading; button.setAttribute('aria-busy', String(loading)); }
      if (spinner) spinner.classList.toggle('hidden', !loading);
      if (text) text.textContent = loading ? 'Подождите…' : 'Войти';
      if (status) { status.classList.toggle('hidden', !loading); status.textContent = message; }
    }
    async function doLogin() {
      if (loginInProgress || !ensureSupabase()) return;
      const email = document.getElementById('login-email').value.trim().toLowerCase();
      const password = document.getElementById('login-password').value;
      if (!email || !password) return showError('Введите Email и пароль.');
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return showError('Введите корректный Email.');

      loginInProgress = true;
      setLoginLoading(true, 'Проверяем данные для входа…');
      try {
        await withAuthDeadline(async (signal) => {
          const authRequest = supabaseClient.auth.signInWithPassword({ email, password });
          const authResult = await authRequest;
          checkAuthAttempt(signal);
          const { error } = authResult;
          if (error) throw error;

          setLoginLoading(true, 'Загружаем вашу компанию и оборудование…');
          let ok = await hydrateCurrentUser(signal);
          if (typeof companyDeletionState !== 'undefined' && companyDeletionState?.pending) return;

          // Если регистрация проходила с подтверждением email, сессия появилась
          // только после входа. В этом случае создаём компанию/профиль из
          // user_metadata, сохранённых при signUp().
          if (!ok) {
            const { data: userData, error: userError } = await supabaseClient.auth.getUser();
            checkAuthAttempt(signal);
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
          } else if (meta.signup_mode === 'invite') {
            throw new Error('Вход по общему коду отключён. Попросите руководителя прислать персональную ссылку на email.');
          }

          checkAuthAttempt(signal);
          setLoginLoading(true, 'Подключаем профиль к компании…');
          ok = await hydrateCurrentUser(signal);
        }

        if (!ok) {
          await supabaseClient.auth.signOut();
          throw new Error('Профиль пользователя не найден.');
        }

        // Компания определяется по профилю пользователя в Supabase.
        checkAuthAttempt(signal);
        enterApp();
        });
      } catch (e) {
        if (e.code === 'AUTH_SUPERSEDED') return;
        console.error(e);
        showError(e.message || 'Ошибка входа.');
      } finally {
        loginInProgress = false;
        setLoginLoading(false);
      }
    }

    async function doLogout() {
      await supabaseClient.auth.signOut();
      db = loadDB();
      currentDeptId = null;
      document.getElementById('app-screen').classList.add('hidden');
      document.getElementById('auth-screen').classList.remove('hidden');
    }

    // Native reminders belong only to the responsible employee for their department.
    // They are re-created on login and whenever the app is opened.
    const MAINTENANCE_NOTIFICATION_IDS_KEY = 'checkapp-maintenance-notification-ids';
    function maintenanceNotificationsSettingKey() {
      return 'checkapp-maintenance-notifications-' + (db.currentUser?.id || 'anonymous');
    }
    function maintenanceNotificationsEnabled() {
      return localStorage.getItem(maintenanceNotificationsSettingKey()) !== 'off';
    }
    function setMaintenanceNotificationsEnabled(enabled) {
      localStorage.setItem(maintenanceNotificationsSettingKey(), enabled ? 'on' : 'off');
      void refreshMaintenanceNotifications().catch(e => console.error('[Check App] notifications:', e));
    }

    function notificationId(taskId) {
      let hash = 2166136261;
      for (const ch of String(taskId)) {
        hash ^= ch.charCodeAt(0);
        hash = Math.imul(hash, 16777619);
      }
      return (hash >>> 1) || 1;
    }
    async function refreshMaintenanceNotifications() {
      const localNotifications = window.Capacitor?.Plugins?.LocalNotifications;
      if (!window.Capacitor?.isNativePlatform?.() || !localNotifications) return;
      const previous = JSON.parse(localStorage.getItem(MAINTENANCE_NOTIFICATION_IDS_KEY) || '[]');
      if (previous.length) await localNotifications.cancel({ notifications: previous.map(id => ({ id })) });
      localStorage.removeItem(MAINTENANCE_NOTIFICATION_IDS_KEY);
      // Previously scheduled notifications were cancelled above; do not schedule new ones.
      if (isPaidSubscriptionExpired()) return;
      const user = getUser();
      if (!user || !maintenanceNotificationsEnabled()) return;
      const permissions = await localNotifications.checkPermissions();
      if (permissions.display !== 'granted') {
        const requested = await localNotifications.requestPermissions();
        if (requested.display !== 'granted') return;
      }
      const now = new Date();
      const tasks = getCompany().tasks.filter(task =>
        (user.role === 'manager' || task.departmentId === user.departmentId) &&
        task.status !== 'done' &&
        isEquipmentActive(task.equipmentId)
      );
      const notifications = tasks.slice(0, 60).map(task => {
        const due = new Date(task.date + 'T09:00:00');
        const late = due.getTime() < now.getTime();
        const when = late ? new Date(now.getTime() + 12000) : due;
        return {
          id: notificationId(task.id),
          title: late ? 'Просрочено техническое обслуживание' : 'Необходимо выполнить ТО',
          body: (task.equipName || 'Оборудование') + ' — ' + task.title,
          schedule: { at: when, allowWhileIdle: true },
          extra: { taskId: task.id, departmentId: task.departmentId }
        };
      });
      if (!notifications.length) return;
      await localNotifications.schedule({ notifications });
      localStorage.setItem(MAINTENANCE_NOTIFICATION_IDS_KEY, JSON.stringify(notifications.map(n => n.id)));
    }

    function enterApp() {
      document.getElementById('auth-screen').classList.add('hidden');
      document.getElementById('app-screen').classList.remove('hidden');
      const c = getCompany(); const user = getUser();
      document.getElementById('header-company').textContent = c.name;
      const roleLabel = user.role === 'manager' ? ' · Руководитель сети' : (user.role === 'responsible' ? ' · Руководитель подразделения' : ' · Сотрудник');
      document.getElementById('header-user').textContent = user.name + roleLabel;
      document.getElementById('header-email').textContent = db.currentUser?.email || user.email || '';
      // ensure subscription object exists
      if (user.role === 'manager' && !c.subscription) {
        c.subscription = { planId: 'free', expiresAt: null, startedAt: new Date().toISOString() };
      }
      const isManager = user.role === 'manager';
      const isResponsible = user.role === 'responsible';
      const isStaff = isManager || isResponsible;
      document.getElementById('manager-nav').classList.remove('hidden');
      // Employees need the Today, Consumables and Cabinet tabs too.
      document.querySelectorAll('.nav-btn').forEach(btn => {
        if (['today','consumables','cabinet','one-time'].includes(btn.dataset.page)) return;
        if (btn.dataset.page === 'super-admin') return;
        btn.classList.toggle('hidden', !isStaff);
      });
      document.getElementById('nav-super-admin')?.classList.toggle('hidden', !isSuperAdmin);
      document.getElementById('dept-bar').classList.toggle('hidden', !isManager);
      // Личный кабинет доступен всем; подписки — только руководителю.
      document.querySelectorAll('.nav-btn[data-page="cabinet"]').forEach(btn => btn.classList.remove('hidden'));
      document.querySelectorAll('.nav-btn[data-page="team"]').forEach(btn => {
        btn.classList.toggle('hidden', !isManager);
      });
      if (isManager) {
        renderDeptSelect();
        if (!currentDeptId && c.departments.length) currentDeptId = c.departments[0].id;
      }
      generateTodayTasks();
      void refreshMaintenanceNotifications().catch(e => console.error('[Check App] notifications:', e));
      if (isStaff) showPage('dashboard'); else showPage('today');
      // Show the guided tour once for each newly registered account, not on every login.
      if (typeof window.maybeShowFirstLoginTour === 'function') {
        void supabaseClient.auth.getSession().then(({data}) => {
          const authUser = data?.session?.user;
          if (authUser) window.maybeShowFirstLoginTour(authUser.id, authUser.created_at);
        }).catch(error => console.warn('[Check App] onboarding:', error));
      }
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

    function updateInviteCodeDisplay() {}

    let oneTimeTasks = [];
    let oneTimeBusy = false;
    async function loadOneTimeTasks() {
      const c = getCompany();
      if (!c) return;
      const {data,error} = await supabaseClient.from('one_time_tasks').select('*').eq('company_id',c.id).order('created_at',{ascending:false}).limit(500);
      if (error) { console.error('Разовые задачи:',error); toast('Не удалось загрузить разовые задачи'); return; }
      oneTimeTasks = data || [];
      renderOneTimeTasks();
    }
    function renderOneTimeTasks() {
      const c = getCompany(), user = getUser(), list = document.getElementById('one-time-list');
      if (!c || !user || !list) return;
      const canAssign = user.role === 'manager' || user.role === 'responsible';
      document.getElementById('one-time-create').classList.toggle('hidden',!canAssign);
      const deptSelect = document.getElementById('one-time-dept');
      const depts = user.role === 'manager' ? c.departments : c.departments.filter(d=>d.id===user.departmentId);
      const selected = deptSelect.value;
      deptSelect.innerHTML = depts.map(d=>'<option value="'+esc(d.id)+'">'+esc(d.name)+'</option>').join('');
      if (depts.some(d=>d.id===selected)) deptSelect.value=selected;
      deptSelect.disabled=user.role!=='manager';
      updateOneTimeEmployees();
      const dueInput=document.getElementById('one-time-date');
      if (!dueInput.value) dueInput.value=todayStr();
      const visible = oneTimeTasks.filter(t => user.role==='manager' || (user.role==='responsible' && t.department_id===user.departmentId) || t.assigned_user_id===user.id);
      list.innerHTML = visible.length ? visible.map(t=>{
        const assignee=c.users.find(u=>u.id===t.assigned_user_id);
        const dept=c.departments.find(d=>d.id===t.department_id);
        const canComplete=t.assigned_user_id===user.id && t.status==='pending';
        return '<article class="bg-[#131e2d] border border-[#263448] rounded-2xl p-4 space-y-2">'+
          '<div class="flex justify-between gap-2"><div class="font-medium whitespace-pre-wrap break-words">'+esc(t.description)+'</div><span class="text-xs shrink-0 '+(t.status==='done'?'text-emerald-400':'text-amber-400')+'">'+(t.status==='done'?'Выполнено':'Ожидает')+'</span></div>'+
          '<div class="text-xs text-[#a8b5c8]">'+esc(dept?.name||'')+' · '+esc(assignee?.name||'')+' · Срок: '+esc(t.due_date)+'</div>'+
          (t.report_comment?'<p class="text-sm text-slate-300 whitespace-pre-wrap">'+esc(t.report_comment)+'</p>':'')+
          (t.photo_path?'<button class="text-primary-400 text-sm underline" onclick="viewOneTimePhoto(\''+t.id+'\')">Посмотреть фотоотчёт</button>':'')+
          (canComplete?'<div><button onclick="openOneTimeReport(\''+t.id+'\')" class="bg-primary-600 px-4 py-2 rounded-xl text-sm">Сдать фотоотчёт</button></div>':'')+
          '</article>';
      }).join(''):'<p class="text-sm text-[#8191a8]">Разовых задач пока нет</p>';
    }
    function updateOneTimeEmployees() {
      const c=getCompany(), user=getUser();
      const dept=document.getElementById('one-time-dept').value;
      const users=c.users.filter(u=>u.departmentId===dept && u.role==='employee');
      document.getElementById('one-time-employee').innerHTML=users.map(u=>'<option value="'+esc(u.id)+'">'+esc(u.name)+'</option>').join('');
    }
    async function createOneTimeTask() {
      if (oneTimeBusy) return;
      const c=getCompany(), user=getUser();
      if (!['manager','responsible'].includes(user.role)) return toast('Нет прав назначать задачи');
      const departmentId=document.getElementById('one-time-dept').value;
      const employeeId=document.getElementById('one-time-employee').value;
      const description=document.getElementById('one-time-description').value.trim();
      const dueDate=document.getElementById('one-time-date').value;
      if (!c.departments.some(d=>d.id===departmentId) || (user.role==='responsible' && departmentId!==user.departmentId)) return toast('Недоступное подразделение');
      if (!c.users.some(u=>u.id===employeeId && u.departmentId===departmentId && u.role==='employee')) return toast('Выберите сотрудника');
      if (!description || description.length>4000 || !/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) return toast('Заполните описание и дату задачи');
      oneTimeBusy=true;
      try {
        const {error}=await supabaseClient.from('one_time_tasks').insert({company_id:c.id,department_id:departmentId,assigned_user_id:employeeId,created_by:user.id,description,due_date:dueDate});
        if(error) throw error;
        document.getElementById('one-time-description').value='';
        toast('Разовая задача назначена');
        await loadOneTimeTasks();
      } catch(e) { console.error(e);toast('Не удалось назначить задачу: '+e.message); }
      finally {oneTimeBusy=false;}
    }
    let oneTimeReportId=null;
    function openOneTimeReport(id) {
      const t=oneTimeTasks.find(x=>x.id===id);
      if(!t || t.assigned_user_id!==getUser().id || t.status!=='pending')return;
      oneTimeReportId=id;
      document.getElementById('one-time-report-title').textContent=t.description;
      document.getElementById('one-time-report-photo').value='';
      document.getElementById('one-time-report-comment').value='';
      document.getElementById('one-time-report-modal').classList.remove('hidden');
    }
    function closeOneTimeReport(){document.getElementById('one-time-report-modal').classList.add('hidden');oneTimeReportId=null;}
    async function submitOneTimeReport(){
      if(oneTimeBusy)return;
      const t=oneTimeTasks.find(x=>x.id===oneTimeReportId),user=getUser(),c=getCompany();
      const file=document.getElementById('one-time-report-photo').files[0];
      if(!t||t.assigned_user_id!==user.id||t.status!=='pending')return toast('Задача недоступна');
      if(!file)return toast('Для выполнения нужен фотоотчёт');
      oneTimeBusy=true;
      try{
        const compressed=await prepareCompletionPhoto(file);
        const path=c.id+'/'+t.department_id+'/one-time/'+t.id+'/'+Date.now()+'.jpg';
        await uploadCompletionPhoto(path,compressed);
        const {data,error}=await supabaseClient.from('one_time_tasks').update({status:'done',photo_path:path,report_comment:document.getElementById('one-time-report-comment').value.trim(),completed_at:new Date().toISOString()}).eq('id',t.id).eq('assigned_user_id',user.id).eq('status','pending').select('id');
        if(error)throw error;
        if(!data?.length)throw new Error('Задача уже обработана');
        closeOneTimeReport();
        toast('Фотоотчёт сохранён');
        await loadOneTimeTasks();
      }catch(e){console.error(e);toast('Не удалось сохранить отчёт: '+e.message);}
      finally{oneTimeBusy=false;}
    }
    async function viewOneTimePhoto(id){
      const t=oneTimeTasks.find(x=>x.id===id);
      if(!t?.photo_path)return;
      const {data,error}=await supabaseClient.storage.from('equipment-photos').createSignedUrl(t.photo_path,300);
      if(error||!data?.signedUrl)return toast('Не удалось открыть фотоотчёт');
      window.open(data.signedUrl,'_blank','noopener,noreferrer');
    }

    function showPage(page) {
      const user = getUser();
      if(page==='team' && user?.role!=='manager') page='today';
      if(user?.role==='employee' && !['today','consumables','cabinet','one-time'].includes(page)) page='today';
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
        btn.classList.toggle('text-[#a8b5c8]', !isActive);
      });
      if (page === 'one-time') void loadOneTimeTasks();
      if (page === 'dashboard') renderDashboard();
      if (page === 'today') renderToday();
      if (page === 'equipment') renderEquipment();
      if (page === 'actions') renderActions();
      if (page === 'team') renderTeam();
      if (page === 'consumables') void renderConsumables();
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
      if (list) list.innerHTML = '<div class="text-center py-10 text-[#8191a8] text-sm">Загрузка компаний…</div>';
      try {
        const { data, error } = await supabaseClient.rpc('list_companies_for_super_admin');
        if (error) throw error;
        adminCompanies = Array.isArray(data) ? data : [];
        filterAdminCompanies();
      } catch (e) {
        console.error('[Check App] loadAdminCompanies:', e);
        if (list) list.innerHTML = `<div class="bg-rose-500/10 border border-rose-500/20 text-rose-300 rounded-2xl p-4 text-sm">${esc(e?.message || 'Не удалось загрузить компании.')}</div>`;
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
        list.innerHTML = '<div class="text-center py-10 text-[#8191a8] text-sm">Компании не найдены</div>';
        return;
      }
      list.innerHTML = rows.map(c => {
        const active = c.is_unlimited === true;
        const plan = c.plan_id || 'free';
        return `<div class="bg-[#131e2d] rounded-2xl border ${active ? 'border-amber-500/40' : 'border-[#263448]'} p-5">
          <div class="flex items-start justify-between gap-4 flex-wrap">
            <div class="min-w-0">
              <div class="font-semibold text-lg">${esc(c.company_name || 'Без названия')}</div>
              <div class="text-sm text-[#a8b5c8] mt-1">${esc(c.owner_email || '—')}</div>
              <div class="text-xs text-[#8191a8] mt-2 font-mono break-all">${esc(c.company_id)}</div>
            </div>
            <div class="flex items-center gap-2">
              <span class="text-xs px-2.5 py-1 rounded-full ${active ? 'bg-amber-500/15 text-amber-300' : 'bg-[#1c2a3d] text-[#a8b5c8]'}">
                ${active ? '♾ Безлимит' : 'Тариф: ' + esc(plan)}
              </span>
            </div>
          </div>
          <div class="mt-4 flex flex-wrap items-center gap-3">
            ${active
              ? `<button onclick="revokeUnlimited('${c.company_id}')" class="bg-rose-600 hover:bg-rose-500 px-4 py-2.5 rounded-2xl text-sm font-medium">Отозвать безлимит</button>`
              : `<button onclick="grantUnlimited('${c.company_id}')" class="bg-amber-600 hover:bg-amber-500 text-white px-4 py-2.5 rounded-2xl text-sm font-medium">Выдать безлимит</button>`}
          </div>
          ${active && c.note ? `<div class="text-xs text-[#8191a8] mt-3">Комментарий: ${esc(c.note)}</div>` : ''}
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

    // Due tasks are generated atomically on the server during hydration.
    function generateTodayTasks() {}

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
      if (!tasks.length) { list.innerHTML = '<p class="text-[#8191a8] text-sm">Задач нет</p>'; return; }
      list.innerHTML = tasks.map(t => `
        <div class="flex items-center justify-between bg-[#1c2a3d]/50 rounded-2xl px-4 py-3">
          <div><div class="font-medium text-sm">${esc(t.title)}</div><div class="text-xs text-[#a8b5c8]">${esc(t.equipName)}</div></div>
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
        return `<div class="bg-[#131e2d] border border-[#263448] rounded-2xl p-4 ${isDone?'opacity-60':''}">
          <div class="flex items-start justify-between gap-3">
            <div class="flex-1"><div class="font-semibold">${esc(t.title)}</div>
            <div class="text-sm text-[#a8b5c8] mt-0.5">${esc(t.equipName)}</div>
            ${t.description?`<div class="text-xs text-[#8191a8] mt-2">${esc(t.description)}</div>`:''}</div>
            ${isDone?`<span class="text-xs px-2.5 py-1 rounded-full bg-emerald-500/20 text-emerald-400">✓ Выполнено</span>`
              :`<button onclick="openCompleteModal('${t.id}')" class="bg-primary-600 hover:bg-primary-500 text-white text-sm font-medium px-4 py-2 rounded-2xl">Выполнить</button>`}
          </div></div>`;
      }).join('');
    }

    function renderEquipment() {
      document.querySelector('#page-equipment button[onclick="openEquipModal()"]')?.classList.toggle('hidden',!canManageDepartment(getActiveDeptId()));
      const items = getDeptEquipment();
      const list = document.getElementById('equip-list');
      const plan = getPlan();
      if (!items.length) { list.innerHTML = '<p class="text-[#8191a8] text-sm py-8 text-center">Нет оборудования</p>'; return; }
      list.innerHTML = items.map(e => `
        <div class="bg-[#131e2d] border border-[#263448] rounded-2xl p-4 flex items-center justify-between ${e._active ? '' : 'opacity-50'}">
          <div class="flex items-center gap-3">
            ${e.photoPath ? `<img class="hidden w-16 h-16 rounded-xl object-cover" data-check-photo-bucket="equipment-photos" data-check-photo-path="${esc(e.photoPath)}" alt="Фото оборудования">` : ''}
            <div>
            <div class="font-semibold">${esc(e.name)} ${e._active ? '' : '<span class="text-xs text-rose-400 font-normal">· заморожено</span>'}</div>
            <div class="text-sm text-[#a8b5c8]">${esc(e.code||'—')} · ${esc(e.location||'—')}</div>
            ${e._active && canManageDepartment(e.departmentId) ? `<button type="button" onclick="checkOpenReplacePhoto('equipment','${e.id}')" class="mt-2 text-xs text-primary-300 hover:text-primary-200">${e.photoPath ? 'Заменить фото' : 'Добавить фото'}</button>` : ''}
            </div>
          </div>
          ${e._active && canManageDepartment(e.departmentId) ? `<button onclick="deleteEquipment('${e.id}')" class="text-[#8191a8] hover:text-rose-400 text-sm px-2 py-1">Удалить</button>` : '<span class="text-xs text-[#8191a8]">нет доступа</span>'}
        </div>`).join('');
      void checkShowSignedPhotos(list);
    }

    function renderActions() {
      document.querySelector('#page-actions button[onclick="openActionModal()"]')?.classList.toggle('hidden',!canManageDepartment(getActiveDeptId()));
      const items = getDeptActions();
      const list = document.getElementById('actions-list');
      const equipAll = getCompany().equipment;
      if (!items.length) { list.innerHTML = '<p class="text-[#8191a8] text-sm py-8 text-center">Нет действий</p>'; return; }
      const freqLabels = {1:'Каждый день',2:'Раз в 2 дня',3:'Раз в 3 дня',7:'Раз в неделю',14:'Раз в 2 недели',30:'Раз в месяц'};
      list.innerHTML = items.map(a => {
        const equip = equipAll.find(e => e.id === a.equipmentId);
        return `<div class="bg-[#131e2d] border border-[#263448] rounded-2xl p-4 flex items-center justify-between">
          <div><div class="font-semibold">${esc(a.name)}</div>
          <div class="text-sm text-[#a8b5c8]">${equip?esc(equip.name):'—'} · ${freqLabels[a.frequency]||a.frequency+' дн.'}</div></div>
          ${canManageDepartment(a.departmentId) ? `<button onclick="deleteAction('${a.id}')" class="text-[#8191a8] hover:text-rose-400 text-sm px-2 py-1">Удалить</button>` : ''}
        </div>`;
      }).join('');
    }

    function renderTeam() { return renderCompanyTeam(); }

    let historyFilter = 'all';

    function setHistoryFilter(value) {
      if (!['all', 'done', 'pending'].includes(value)) return;
      historyFilter = value;
      renderHistory();
    }

    function historyItems() {
      const c = getCompany(), deptId = getActiveDeptId();
      const uniqueCompletions = [...new Map([...getDeptCompletions()].reverse().map(comp => [comp.taskId || comp.id, comp])).values()];
      const done = uniqueCompletions.map(comp => ({ id: comp.id, status: 'done', date: comp.date, time: comp.time || '', title: comp.title, equipName: comp.equipName, userId: comp.userId, comment: comp.comment, workerName: comp.workerName || '', photoPath: comp.photoPath, taskId: comp.taskId, actionId: comp.actionId, equipmentId: comp.equipmentId, completion: comp }));
      const completedIds = new Set(done.map(x => x.taskId).filter(Boolean));
      const pending = c.tasks.filter(t => t.departmentId === deptId && t.status !== 'done' && !completedIds.has(t.id)).map(t => ({ id: t.id, status: 'pending', date: t.date, time: t.blockedAt ? new Date(t.blockedAt).toLocaleTimeString('ru-RU', {hour:'2-digit',minute:'2-digit'}) : '', title: t.title, equipName: t.equipName, userId: t.assignedUserId, workerName: t.blockedWorkerName || '', comment: t.blockedComment || '', photoPath: '', taskId: t.id, actionId: t.actionId, equipmentId: t.equipmentId }));
      return [...done, ...pending].sort((a,b) => (b.date || '').localeCompare(a.date || '') || (b.time || '').localeCompare(a.time || ''));
    }

    function historyDisplayFields(item) {
      const c = getCompany();
      const task = c.tasks.find(t => t.id === item.taskId);
      const equip = c.equipment.find(e => e.id === item.equipmentId);
      const action = c.actions.find(a => a.id === item.actionId);
      const deptId = item.completion?.departmentId || task?.departmentId || equip?.departmentId;
      const dept = c.departments.find(d => d.id === deptId);
      return {
        dateTime: formatDate(item.date) + (item.time ? ' · ' + item.time : ''),
        department: dept?.name || '—',
        room: equip?.location || '—',
        equipment: equip?.name || item.equipName || '—',
        maintenance: action?.name || item.title || '—',
        comment: item.comment || '—'
      };
    }

    function historyDetailsMarkup(item) {
      const c = getCompany(), user = c.users.find(u => u.id === item.userId);
      const fields = historyDisplayFields(item);
      const equip = c.equipment.find(e => e.id === item.equipmentId);
      const action = c.actions.find(a => a.id === item.actionId);
      const overdue = item.status !== 'done' ? Math.max(0, Math.floor((new Date(todayStr() + 'T12:00:00') - new Date(item.date + 'T12:00:00')) / 86400000)) : 0;
      return `<div class="space-y-3 text-sm">
        <div><span class="text-[#a8b5c8]">Статус:</span> <span class="${item.status === 'done' ? 'text-emerald-400' : 'text-amber-400'}">${item.status === 'done' ? 'Выполнено' : 'Не выполнено'}</span></div>
        ${item.status !== 'done' ? `<div class="text-amber-400">Просрочка: ${overdue} дн.</div>` : ''}
        <div><span class="text-[#a8b5c8]">Вид ТО:</span> ${esc(fields.maintenance)}</div>
        <div><span class="text-[#a8b5c8]">Подразделение:</span> ${esc(fields.department)}</div>
        <div><span class="text-[#a8b5c8]">Помещение:</span> ${esc(fields.room)}</div>
        <div><span class="text-[#a8b5c8]">Вид оборудования:</span> ${esc(fields.equipment)}</div>
        ${equip?.code ? `<div><span class="text-[#a8b5c8]">Код:</span> ${esc(equip.code)}</div>` : ''}
        <div><span class="text-[#a8b5c8]">Дата и время:</span> ${esc(fields.dateTime)}</div>
        <div><span class="text-[#a8b5c8]">${item.status === 'done' ? 'Выполнил:' : 'Назначен:'}</span> ${esc(item.workerName || user?.name || '—')}</div>
        ${action?.description ? `<div><span class="text-[#a8b5c8]">Описание:</span> ${esc(action.description)}</div>` : ''}
        <div class="bg-[#1c2a3d]/60 rounded-xl p-3"><span class="text-[#a8b5c8]">Комментарий:</span> ${esc(fields.comment)}</div>
        ${item.status !== 'done' ? `<button type="button" onclick="closeHistoryDetails();openCompleteModal('${item.taskId}')" class="w-full py-3 rounded-2xl bg-primary-600 font-medium">Выполнить задачу</button>` : ''}
        <div id="history-detail-photo">${item.photoPath ? 'Загрузка фото…' : item.status === 'done' ? 'Фото не прикреплено' : 'Фото появится после выполнения'}</div>
      </div>`;
    }

    async function openHistoryDetails(id, status) {
      const item = historyItems().find(x => x.id === id && x.status === status);
      if (!item) return toast('Запись не найдена');
      let modal = document.getElementById('history-detail-modal');
      if (!modal) {
        modal = document.createElement('div');
        modal.id = 'history-detail-modal';
        modal.className = 'fixed inset-0 z-[100] bg-black/75 flex items-center justify-center p-4 hidden';
        modal.innerHTML = '<div role="dialog" aria-modal="true" aria-labelledby="history-detail-title" class="bg-[#131e2d] border border-[#354359] rounded-2xl w-full max-w-lg max-h-[85vh] overflow-y-auto p-5"><div class="flex justify-between items-start gap-3 mb-4"><h2 id="history-detail-title" class="text-xl font-bold">Информация о работе</h2><button type="button" onclick="closeHistoryDetails()" class="px-3 py-1.5 rounded-xl bg-[#1c2a3d]">Закрыть</button></div><div id="history-detail-body"></div></div>';
        document.body.appendChild(modal);
      }
      document.getElementById('history-detail-title').textContent = item.title || 'Информация о работе';
      document.getElementById('history-detail-body').innerHTML = historyDetailsMarkup(item);
      modal.classList.remove('hidden');
      if (item.photoPath) {
        const photo = document.getElementById('history-detail-photo');
        try {
          const { data, error } = await supabaseClient.storage.from('equipment-photos').createSignedUrl(item.photoPath, 3600);
          if (!modal.classList.contains('hidden') && photo?.isConnected) {
            if (error || !data?.signedUrl) { if (photo?.isConnected) photo.textContent = 'Не удалось загрузить фото'; }
            else if (photo?.isConnected) {
              const img = document.createElement('img');
              img.src = data.signedUrl;
              img.alt = 'Фото выполненной работы';
              img.className = 'w-full max-h-[60vh] object-contain rounded-2xl cursor-pointer';
              img.onclick = () => openPhotoModal(img.src);
              photo.replaceChildren(img);
            }
          }
        } catch (_) { if (photo?.isConnected) photo.textContent = 'Не удалось загрузить фото'; }
      }
    }

    function closeHistoryDetails() {
      document.getElementById('history-detail-modal')?.classList.add('hidden');
    }

    function renderHistory() {
      const all = historyItems();
      const items = all.filter(x => historyFilter === 'all' || x.status === historyFilter);
      const list = document.getElementById('history-list'), empty = document.getElementById('history-empty');
      for (const value of ['all', 'done', 'pending']) {
        const button = document.getElementById('history-filter-' + value);
        if (button) {
          const active = historyFilter === value;
          button.classList.toggle('bg-primary-600', active);
          button.classList.toggle('border-primary-500', active);
          button.setAttribute('aria-pressed', String(active));
        }
      }
      empty.classList.toggle('hidden', items.length > 0);
      empty.textContent = historyFilter === 'done' ? 'Выполненных работ нет' : historyFilter === 'pending' ? 'Невыполненных задач нет' : 'Записей нет';
      list.innerHTML = items.map(item => {
        const user = getCompany().users.find(u => u.id === item.userId);
        const fields = historyDisplayFields(item);
        return `<button type="button" onclick="openHistoryDetails('${item.id}', '${item.status}')" class="block w-full text-left bg-[#131e2d] border border-[#263448] rounded-2xl p-4 hover:border-primary-500 transition">
          <div class="flex justify-between items-start gap-2"><div class="font-semibold">${esc(item.title || '—')}</div><span class="text-xs shrink-0 ${item.status === 'done' ? 'text-emerald-400' : 'text-amber-400'}">${item.status === 'done' ? 'Выполнено' : 'Не выполнено'}</span></div>
          <div class="text-sm text-slate-300 mt-2 space-y-1">
            <div><span class="text-[#a8b5c8]">Дата и время:</span> ${esc(fields.dateTime)}</div>
            <div><span class="text-[#a8b5c8]">Подразделение:</span> ${esc(fields.department)}</div>
            <div><span class="text-[#a8b5c8]">Помещение:</span> ${esc(fields.room)}</div>
            <div><span class="text-[#a8b5c8]">Вид оборудования:</span> ${esc(fields.equipment)}</div>
            <div><span class="text-[#a8b5c8]">Вид ТО:</span> ${esc(fields.maintenance)}</div>
            <div class="bg-[#1c2a3d]/60 rounded-xl px-3 py-2 mt-2"><span class="text-[#a8b5c8]">Комментарий:</span> ${esc(fields.comment)}</div>
          </div>
          <div class="text-xs text-[#8191a8] mt-2">${item.status === 'done' ? 'Выполнил' : 'Назначен'}: ${esc(item.workerName || user?.name || '—')}</div>
          ${item.status !== 'done' ? `<div class="text-xs text-amber-400 mt-2">Просрочка: ${Math.max(0,Math.floor((new Date(todayStr() + 'T12:00:00') - new Date(item.date + 'T12:00:00'))/86400000))} дн.</div>` : ''}
          <div class="text-xs text-primary-400 mt-3">Открыть задачу →</div>
        </button>`;
      }).join('');
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
          <div class="bg-[#1c2a3d]/60 rounded-2xl px-4 py-3 flex justify-between gap-3">
            <div><div class="font-medium text-sm">${esc(item.actionName)}</div>
            <div class="text-xs text-[#a8b5c8]">${esc(item.equipName)}</div>
            <div class="text-xs text-[#8191a8] mt-1">${item.statusText}</div></div>
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
          <div class="bg-[#1c2a3d]/60 rounded-2xl px-4 py-3 flex justify-between">
            <div><div class="font-medium text-sm">${esc(s.user.name)}</div>
            <div class="text-xs text-[#a8b5c8]">${s.lastDate?'последний: '+formatDate(s.lastDate):'нет работ'}</div></div>
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
          return `<div class="bg-[#1c2a3d]/60 rounded-2xl px-4 py-3">
            <div class="font-medium text-sm">${esc(comp.title)}</div>
            <div class="text-xs text-[#a8b5c8]">${esc(comp.equipName)}</div>
            <div class="text-xs text-[#8191a8] mt-1"><span class="text-primary-400">${user?esc(user.name):'—'}</span> · ${formatDate(comp.date)}</div>
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
    async function saveDepartment() {
      if(getUser()?.role!=='manager')return toast('Доступ только руководителю сети');
      const name = document.getElementById('dept-name').value.trim();
      if (!name) return toast('Укажите название');
      const c = getCompany();
      const plan = getPlan();
      if (c.departments.length >= plan.maxDepts) {
        return toast('Лимит подразделений по тарифу «' + plan.name + '»: ' + plan.maxDepts + '. Перейдите в Кабинет для смены тарифа.');
      }
      const id = uid();
      const inviteCode=generateCode();
      const {error}=await supabaseClient.from('departments').insert({id,company_id:c.id,name,invite_code:inviteCode});
      if(error)return toast('Не удалось создать подразделение: '+error.message);
      c.departments.push({id,name,inviteCode});
      c.workLimits?.active_department_ids.push(id);
      currentDeptId = id; closeDeptModal();
      renderDeptSelect(); generateTodayTasks(); showPage('dashboard');
      toast('Подразделение создано');
    }

    function openEquipModal() {
      if(!canManageDepartment(getActiveDeptId()))return toast('Недостаточно прав в этом подразделении');
      if (!getActiveDeptId()) return toast('Сначала создайте подразделение');
      document.getElementById('equip-name').value = '';
      document.getElementById('equip-code').value = '';
      document.getElementById('equip-location').value = '';
      document.getElementById('equip-photo').value = '';
      document.getElementById('equip-photo-preview').classList.add('hidden');
      document.getElementById('modal-equip').classList.remove('hidden');
    }
    function closeEquipModal() { document.getElementById('modal-equip').classList.add('hidden'); }
    async function saveEquipment() {
      if(!canManageDepartment(getActiveDeptId()))return toast('Недостаточно прав в этом подразделении');
      const name = document.getElementById('equip-name').value.trim();
      if (!name) return toast('Укажите название');
      const plan = getPlan(), deptId = getActiveDeptId(), c = getCompany();
      if (c.equipment.filter(e => e.departmentId === deptId).length >= plan.maxEquip)
        return toast('Достигнут лимит оборудования по тарифу «' + plan.name + '»');
      const equipment = { id:uid(), name, code:document.getElementById('equip-code').value.trim(),
        location:document.getElementById('equip-location').value.trim(), departmentId:deptId, photoPath:null };
      const file=document.getElementById('equip-photo').files?.[0];
      try {
        if(file) equipment.photoPath=await checkUploadPhoto('equipment-photos',c.id,equipment.id,file);
        const {error}=await supabaseClient.from('equipment').insert({
          id:equipment.id,company_id:c.id,department_id:deptId,name,
          code:equipment.code||null,location:equipment.location||null,photo_path:equipment.photoPath
        });
        if(error)throw error;
        c.equipment.push(equipment);
        c.workLimits?.active_equipment_ids.push(equipment.id);
        closeEquipModal();renderEquipment();toast('Оборудование сохранено');
      } catch(error) {
        if(equipment.photoPath)await checkRemovePhoto('equipment-photos',equipment.photoPath);
        toast('Не удалось сохранить оборудование: '+(error.message||'Ошибка фото'));
      }
    }
        async function deleteEquipment(id) {
      if(!canManageDepartment(getCompany()?.equipment.find(e=>e.id===id)?.departmentId))return toast('Недостаточно прав');
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
      renderEquipment(); toast('Оборудование удалено');
    }

    function openActionModal() {
      if(!canManageDepartment(getActiveDeptId()))return toast('Недостаточно прав в этом подразделении');
      const equip = getDeptEquipment();
      if (!equip.length) return toast('Сначала добавьте оборудование');
      document.getElementById('action-equip').innerHTML = equip.map(e => `<option value="${e.id}">${esc(e.name)}</option>`).join('');
      document.getElementById('action-name').value = '';
      document.getElementById('action-desc').value = '';
      document.getElementById('action-freq').value = '7';
      document.getElementById('modal-action').classList.remove('hidden');
    }
    function closeActionModal() { document.getElementById('modal-action').classList.add('hidden'); }
    async function saveAction() {
      if(!canManageDepartment(getActiveDeptId()))return toast('Недостаточно прав в этом подразделении');
      const name = document.getElementById('action-name').value.trim();
      if (!name) return toast('Укажите название');
      const company = getCompany();
      const action = {id:uid(), equipmentId:document.getElementById('action-equip').value,
        name, description:document.getElementById('action-desc').value.trim(),
        frequency:parseInt(document.getElementById('action-freq').value,10), departmentId:getActiveDeptId()};
      const {error} = await supabaseClient.from('maintenance_actions').insert({
        id:action.id, company_id:company.id, department_id:action.departmentId,
        equipment_id:action.equipmentId, name:action.name, description:action.description || null,
        frequency:action.frequency
      });
      if (error) return toast('Не удалось сохранить ТО: ' + error.message);
      company.actions.push(action);
      closeActionModal(); renderActions();
      try {await hydrateCurrentUser();renderActions();toast('ТО сохранено');}
      catch(error){toast('ТО сохранено. Не удалось обновить задачи: '+error.message);}
    }
    async function deleteAction(id) {
      if(!canManageDepartment(getCompany()?.actions.find(a=>a.id===id)?.departmentId))return toast('Недостаточно прав');
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
      renderActions(); toast('Регламент удалён');
    }

    let completionStatus = 'done';
    function setCompletionStatus(status) {
      completionStatus = status === 'blocked' ? 'blocked' : 'done';
      document.getElementById('complete-photo-section').classList.toggle('hidden', completionStatus === 'blocked');
      document.getElementById('complete-status-done').className = 'rounded-2xl py-3 text-sm ' + (completionStatus === 'done' ? 'bg-emerald-600' : 'bg-[#1c2a3d]');
      document.getElementById('complete-status-blocked').className = 'rounded-2xl py-3 text-sm ' + (completionStatus === 'blocked' ? 'bg-amber-600' : 'bg-[#1c2a3d]');
    }
    function openCompleteModal(taskId) {
      currentCompleteTaskId = taskId; currentPhotoBase64 = null; currentPhotoFile = null;
      document.getElementById('photo-input').value = '';
      document.getElementById('complete-worker-name').value = '';
      setCompletionStatus('done');
      clearCompletionValidation();
      setCompletionSaveState(false);
      const task = getCompany().tasks.find(t => t.id === taskId);
      document.getElementById('complete-task-info').textContent = task.title + ' · ' + task.equipName;
      document.getElementById('complete-comment').value = '';
      document.getElementById('photo-preview').classList.add('hidden');
      document.getElementById('photo-placeholder').classList.remove('hidden');
      document.getElementById('modal-complete').classList.remove('hidden');
    }
    function closeCompleteModal() { clearCompletionValidation(); document.getElementById('modal-complete').classList.add('hidden'); }
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
    let completionValidationTimer;
    function clearCompletionValidation() {
      clearTimeout(completionValidationTimer);
      for (const id of ['complete-worker-name', 'complete-comment', 'complete-photo-dropzone']) {
        const el = document.getElementById(id);
        if (!el) continue;
        el.classList.remove('border-red-500', 'ring-2', 'ring-red-500');
        el.removeAttribute('aria-invalid');
      }
      document.getElementById('complete-validation-toast')?.remove();
    }
    function validateCompletionFields() {
      clearCompletionValidation();
      const missing = [];
      const worker = document.getElementById('complete-worker-name');
      const comment = document.getElementById('complete-comment');
      if (!worker.value.trim()) missing.push(worker);
      if (completionStatus === 'done' && !currentPhotoFile) missing.push(document.getElementById('complete-photo-dropzone'));
      if (completionStatus === 'blocked' && !comment.value.trim()) missing.push(comment);
      if (!missing.length) return true;
      for (const el of missing) {
        el.classList.add('border-red-500', 'ring-2', 'ring-red-500');
        el.setAttribute('aria-invalid', 'true');
      }
      const toastEl = document.createElement('div');
      toastEl.id = 'complete-validation-toast';
      toastEl.setAttribute('role', 'alert');
      toastEl.className = 'fixed bottom-8 left-1/2 -translate-x-1/2 z-[120] bg-red-700 text-white px-5 py-3 rounded-2xl shadow-xl text-sm text-center';
      toastEl.textContent = 'Заполните необходимое поле';
      document.body.appendChild(toastEl);
      completionValidationTimer = setTimeout(() => {
        toastEl.remove();
        for (const el of missing) el.classList.remove('border-red-500', 'ring-2', 'ring-red-500');
      }, 5000);
      return false;
    }
    async function prepareCompletionPhoto(file) {
      if (!file || !file.type.startsWith('image/')) throw new Error('Выберите фотографию');
      const bitmap = await createImageBitmap(file);
      try {
        let maxSide = 1600;
        let quality = 0.78;
        for (let attempt = 0; attempt < 9; attempt++) {
          const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
          const canvas = document.createElement('canvas');
          canvas.width = Math.max(1, Math.round(bitmap.width * scale));
          canvas.height = Math.max(1, Math.round(bitmap.height * scale));
          const ctx = canvas.getContext('2d');
          if (!ctx) throw new Error('Не удалось обработать фотографию');
          ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
          const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', quality));
          if (!blob) throw new Error('Не удалось сжать фотографию');
          if (blob.size <= 300 * 1024) return new File([blob], 'maintenance-photo.jpg', {type:'image/jpeg'});
          if (quality > 0.52) quality -= 0.09;
          else maxSide = Math.max(600, Math.round(maxSide * 0.8));
        }
        throw new Error('Не удалось уменьшить фотографию до 300 КБ. Выберите другое фото.');
      } finally {
        bitmap.close?.();
      }
    }
    async function uploadCompletionPhoto(path, file) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 25000);
      try {
        const {data: sessionData, error: sessionError} = await supabaseClient.auth.getSession();
        if (sessionError || !sessionData?.session?.access_token) throw new Error('Сессия истекла. Войдите заново.');
        const response = await fetch(
          'https://qaxoufarhpagcjkhptga.supabase.co/storage/v1/object/equipment-photos/' + path,
          {
            method:'POST',
            headers:{
              apikey: SUPABASE_PUBLISHABLE_KEY,
              authorization:'Bearer ' + sessionData.session.access_token,
              'x-upsert':'false',
              'content-type':file.type || 'image/jpeg'
            },
            body:file,
            signal:controller.signal
          }
        );
        if (!response.ok) {
          const error = await response.json().catch(() => ({}));
          throw new Error(error.message || error.error || 'Ошибка загрузки фото (' + response.status + ')');
        }
      } catch (error) {
        if (error.name === 'AbortError') throw new Error('Загрузка фото заняла больше 25 секунд. Проверьте интернет и попробуйте снова.');
        throw error;
      } finally {
        clearTimeout(timeout);
      }
    }
    let completionSubmissionBusy = false;
    function setCompletionSaveState(busy, message = '', isError = false) {
      const btn = document.getElementById('complete-save-btn');
      const status = document.getElementById('complete-save-status');
      if (btn) { btn.disabled = busy; btn.textContent = busy ? 'Сохраняем…' : 'Сохранить'; }
      if (status) {
        status.classList.toggle('hidden', !message);
        status.classList.toggle('text-rose-400', isError);
        status.classList.toggle('text-slate-300', !isError);
        status.textContent = message;
      }
    }
    async function submitComplete() {
      if (completionSubmissionBusy) return;
      if (!validateCompletionFields()) return;
      const workerName = document.getElementById('complete-worker-name').value.trim();
      const comment = document.getElementById('complete-comment').value.trim();
      if (!workerName) return toast('Укажите имя исполнителя');
      if (completionStatus === 'done' && !currentPhotoFile) return toast('Прикрепите фото');
      if (completionStatus === 'blocked' && !comment) return toast('Укажите причину невыполнения');
      const c = getCompany();
      const task = c.tasks.find(t => t.id === currentCompleteTaskId);
      const user = getUser();
      if (!task || !user) return toast('Задача или пользователь не найдены');
      if (task.status === 'done' || c.completions.some(x => x.taskId === task.id)) return toast('Эта задача уже выполнена');
      completionSubmissionBusy = true;
      setCompletionSaveState(true, 'Проверяем задачу…');
      try {
        const {data: existing, error: existingError} = await supabaseClient.from('completions').select('id').eq('task_id', task.id).limit(1);
        if (existingError) throw existingError;
        if (existing?.length) return toast('Эта задача уже сохранена как выполненная. Обновите страницу.');
        const now = new Date();
        let path = '';
        if (completionStatus === 'done') {
          setCompletionSaveState(true, 'Загружаем фотографию…');
          let uploadFile = currentPhotoFile;
          try {
            setCompletionSaveState(true, 'Подготавливаем фотографию…');
            uploadFile = await prepareCompletionPhoto(currentPhotoFile);
          } catch (photoError) {
            throw new Error('Не удалось сжать фотографию: ' + (photoError?.message || 'ошибка обработки'));
          }
          path = c.id + '/' + task.departmentId + '/' + task.id + '/' + Date.now() + '.' + (uploadFile.type === 'image/jpeg' ? 'jpg' : ((uploadFile.name.split('.').pop() || 'jpg').toLowerCase()));
          setCompletionSaveState(true, 'Загружаем фотографию (' + Math.max(1, Math.ceil(uploadFile.size / 1024)) + ' КБ)…');
          await uploadCompletionPhoto(path, uploadFile);
          task.status = 'done';
          c.completions.push({
            id: uid(), taskId: task.id, actionId: task.actionId, equipmentId: task.equipmentId,
            departmentId: task.departmentId, userId: user.id, workerName, title: task.title, equipName: task.equipName,
            date: todayStr(), time: now.toLocaleTimeString('ru-RU', {hour:'2-digit',minute:'2-digit'}),
            photoPath: path, photo: '', comment
          });
        } else {
          task.status = 'blocked';
          task.blockedComment = comment;
          task.blockedWorkerName = workerName;
          task.blockedAt = now.toISOString();
        }
        setCompletionSaveState(true, 'Сохраняем результат в базе данных…');
        // Persist completion and task state before displaying success.
        if (completionStatus === 'done') {
          const completion = c.completions[c.completions.length - 1];
          const {error: completionError} = await supabaseClient.from('completions').insert({
            id:completion.id, company_id:c.id, department_id:completion.departmentId,
            task_id:completion.taskId, action_id:completion.actionId, equipment_id:completion.equipmentId,
            user_id:completion.userId, worker_name:completion.workerName,
            title:completion.title, equip_name:completion.equipName, date:completion.date,
            time:completion.time, photo_path:completion.photoPath, comment:completion.comment || null
          });
          if (completionError) {
            c.completions.pop(); task.status = 'pending';
            throw completionError;
          }
        }
        setCompletionSaveState(true, 'Обновляем статус задачи…');
        const {error: taskError} = await supabaseClient.from('tasks').update({
          status:task.status, blocked_comment:task.blockedComment || null,
          blocked_worker_name:task.blockedWorkerName || null, blocked_at:task.blockedAt || null
        }).eq('id',task.id).eq('company_id',c.id);
        if (taskError) throw taskError;
        void refreshMaintenanceNotifications().catch(console.error);

        closeCompleteModal();
        const successEl = document.getElementById('modal-success');
        successEl.querySelector('h3').textContent = completionStatus === 'done' ? 'ГОТОВО' : 'НЕ ВЫПОЛНЕНО';
        successEl.querySelector('p').textContent = completionStatus === 'done' ? 'Задача успешно выполнена' : 'Причина сохранена, задача остаётся открытой';
        successEl.classList.remove('hidden');
        successEl.style.display = 'flex';
      } catch (e) {
        console.error(e);
        setCompletionSaveState(false, 'Ошибка сохранения: ' + (e.message || 'Не удалось сохранить результат ТО'), true);
        toast(e.message || 'Не удалось сохранить результат ТО');
      } finally {
        completionSubmissionBusy = false;
        const btn = document.getElementById('complete-save-btn');
        if (btn) { btn.disabled = false; btn.textContent = 'Сохранить'; }
      }
    }
    function closeSuccessModal() {
      const successEl = document.getElementById('modal-success');
      successEl.classList.add('hidden');
      successEl.style.display = '';
      showPage('today');
    }



    let pendingPlanId = null;

    let changingPassword = false;
    function changePasswordMessage(message, isError = false) {
      const el = document.getElementById('change-password-message');
      if (!el) return;
      el.textContent = message;
      el.className = 'text-sm min-h-[20px] ' + (isError ? 'text-rose-400' : 'text-emerald-400');
    }
    function openChangePassword() {
      const modal = document.getElementById('change-password-modal');
      if (!modal) return;
      document.getElementById('change-password-form').reset();
      changePasswordMessage('');
      modal.classList.remove('hidden');
      modal.classList.add('flex');
      document.getElementById('change-password-current').focus();
    }
    function closeChangePassword() {
      if (changingPassword) return;
      const modal = document.getElementById('change-password-modal');
      if (!modal) return;
      modal.classList.add('hidden');
      modal.classList.remove('flex');
      document.getElementById('change-password-form').reset();
      changePasswordMessage('');
    }
    async function saveChangedPassword() {
      if (changingPassword || !ensureSupabase()) return;
      const current = document.getElementById('change-password-current').value;
      const next = document.getElementById('change-password-new').value;
      const repeat = document.getElementById('change-password-repeat').value;
      if (!current) return changePasswordMessage('Введите текущий пароль.', true);
      if (next.length < 8) return changePasswordMessage('Новый пароль должен содержать минимум 8 символов.', true);
      if (next !== repeat) return changePasswordMessage('Новые пароли не совпадают.', true);
      if (current === next) return changePasswordMessage('Новый пароль должен отличаться от текущего.', true);
      changingPassword = true;
      const btn = document.getElementById('change-password-save');
      btn.disabled = true;
      btn.textContent = 'Проверяем пароль…';
      try {
        const { data: userData, error: userError } = await supabaseClient.auth.getUser();
        if (userError) throw userError;
        const email = userData?.user?.email;
        if (!email) throw new Error('Не удалось определить email текущего пользователя.');
        const { error: signInError } = await supabaseClient.auth.signInWithPassword({ email, password: current });
        if (signInError) throw new Error('Текущий пароль указан неверно.');
        btn.textContent = 'Сохраняем новый пароль…';
        const { error: updateError } = await supabaseClient.auth.updateUser({ password: next });
        if (updateError) throw updateError;
        document.getElementById('change-password-form').reset();
        changePasswordMessage('Пароль успешно изменён. Используйте новый пароль при следующем входе.');
        toast('Пароль успешно изменён');
      } catch (error) {
        console.error('[Check App] change password:', error);
        changePasswordMessage(error?.message || 'Не удалось изменить пароль. Повторите попытку.', true);
      } finally {
        changingPassword = false;
        btn.disabled = false;
        btn.textContent = 'Сохранить новый пароль';
      }
    }

    function renderCabinet() {
      const notificationToggle = document.getElementById('cab-notifications-toggle');
      if (notificationToggle) notificationToggle.checked = maintenanceNotificationsEnabled();
      const manager = getUser().role === 'manager';
      document.getElementById('cab-delete-company')?.classList.toggle('hidden', !manager);
      document.getElementById('cab-subscription-details').classList.toggle('hidden', !manager);
      document.getElementById('cab-choose-plan').classList.toggle('hidden', !manager);
      document.getElementById('plans-section').classList.add('hidden');
      document.getElementById('pay-confirm').classList.add('hidden');
      if (!manager) {document.getElementById('btn-renew').classList.add('hidden');return;}
      const c = getCompany();
      const sub = c.subscription || { planId: 'free', expiresAt: null };
      const plan = getPlan();
      const days = getDaysLeft();
      const expiryDateEl = document.getElementById('cab-expiry-date');
      const expiryWarningEl = document.getElementById('cab-expiry-warning');
      if (expiryDateEl) expiryDateEl.textContent = sub.planId !== 'free' && sub.expiresAt
        ? 'Действует до: ' + new Date(sub.expiresAt).toLocaleString('ru-RU', {day:'2-digit',month:'long',year:'numeric'})
        : 'Бесплатный тариф — без срока окончания';
      if (expiryWarningEl) {
        const warn = sub.planId !== 'free' && days !== null && days <= 3;
        expiryWarningEl.classList.toggle('hidden', !warn);
        expiryWarningEl.textContent = warn
          ? (days === 0 ? 'Подписка закончилась. Автоматические задачи ТО приостановлены. Продлите подписку, чтобы возобновить работу.'
            : 'До окончания подписки осталось ' + days + ' дн. Продлите заранее — оставшиеся дни сохранятся.')
          : '';
      }
      document.getElementById('cab-plan-name').textContent = plan.name;
      const daysEl = document.getElementById('cab-days-left');
      if (plan.id === 'free') {
        daysEl.textContent = '∞';
        daysEl.className = 'text-2xl font-bold text-[#a8b5c8]';
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
        return `<div class="bg-[#131e2d] border ${isCurrent ? 'border-primary-500' : 'border-[#263448]'} rounded-2xl p-5">
          <div class="flex items-center justify-between mb-2">
            <div class="font-bold text-lg">${p.name}</div>
            ${isCurrent ? '<span class="text-xs bg-primary-500/20 text-primary-400 px-2 py-1 rounded-full">текущий</span>' : ''}
          </div>
          <div class="text-2xl font-bold mb-1">${p.price ? p.price + ' ₽' : '0 ₽'}<span class="text-sm font-normal text-[#a8b5c8]">${p.price ? '/мес' : ''}</span></div>
          <div class="text-sm text-[#a8b5c8] mb-4">до ${p.maxDepts} ${p.maxDepts === 1 ? 'подразделения' : (p.maxDepts >= 2 && p.maxDepts <= 4 ? 'подразделения' : 'подразделений')}<br>до ${p.maxEquip} единиц оборудования в каждом</div>
          ${p.id === 'free' ? '' : `<button onclick="startPay('${p.id}')" class="w-full py-2.5 rounded-2xl text-sm font-medium ${isCurrent ? 'bg-[#1c2a3d] text-[#a8b5c8]' : 'bg-primary-600 hover:bg-primary-500 text-white'} transition">${isCurrent ? 'Продлить на 30 дней' : 'Выбрать'}</button>`}
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
      const testBtn = document.getElementById('test-pay-btn');
      if (testBtn) testBtn.classList.toggle('hidden', new URLSearchParams(location.search).get('test-pay') !== '1');
      document.getElementById('plans-section').classList.add('hidden');
    }
    function cancelPay() {
      pendingPlanId = null;
      document.getElementById('pay-confirm').classList.add('hidden');
    }
    async function confirmPay() {
      if (getUser().role !== 'manager') return;
      if (!pendingPlanId) return;
      const planId = pendingPlanId;
      const btn = document.getElementById('pay-confirm-btn');
      if (btn) { btn.disabled = true; btn.textContent = 'Создаём счёт…'; }
      try {
        const { data, error } = await supabaseClient.functions.invoke('create-robokassa-invoice', { body: { planId } });
        if (error) throw error;
        if (!data?.payment_url) throw new Error(data?.error || 'Не удалось создать счёт.');
        pendingPlanId = null;
        document.getElementById('pay-confirm').classList.add('hidden');
        window.location.href = data.payment_url;
      } catch (e) {
        console.error('Robokassa:', e);
        toast(e?.message || 'Не удалось создать платёж.');
        if (btn) { btn.disabled = false; btn.textContent = 'Перейти к оплате'; }
      }
    }
    async function confirmTestPay() {
      if (getUser().role !== 'manager' || !pendingPlanId || new URLSearchParams(location.search).get('test-pay') !== '1') return;
      const btn = document.getElementById('test-pay-btn');
      if (btn) { btn.disabled = true; btn.textContent = 'Создаём тестовый счёт…'; }
      try {
        const { data, error } = await supabaseClient.functions.invoke('create-robokassa-test-invoice', { body: { planId: pendingPlanId } });
        if (error) {
          const detail = await error.context?.json?.().catch(() => null);
          throw new Error(detail?.reason || detail?.error || error.message);
        }
        if (!data?.test || !/^https:\/\/[a-z0-9.-]*robokassa\.ru\//i.test(data?.payment_url || '')) throw new Error('Не получена безопасная тестовая ссылка.');
        window.location.href = data.payment_url;
      } catch (e) {
        console.error('Robokassa test:', e);
        toast(e?.message || 'Не удалось создать тестовый счёт.');
        if (btn) { btn.disabled = false; btn.textContent = 'Тестовая оплата · без списания денег'; }
      }
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
      <p class="text-[#a8b5c8] mt-3">Сотрудники не видят другие подразделения. Руководитель переключается между ними в верхней панели.</p>
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

    async function handlePaymentReturn() {
      const params = new URLSearchParams(window.location.search);
      const payment = params.get('payment');
      if (!payment) return;
      window.history.replaceState({}, document.title, window.location.pathname);
      if (payment === 'success') {
        toast('Платёж принят. Проверяем активацию подписки…');
        for (let i = 0; i < 5; i++) {
          await new Promise(r => setTimeout(r, 1200));
          try {
            const ok = await hydrateCurrentUser();
            if (ok) {
              renderCabinet();
              const sub = getCompany()?.subscription;
              if (sub?.expiresAt && new Date(sub.expiresAt) > new Date()) {
                toast('Подписка активирована');
                return;
              }
            }
          } catch (_) {}
        }
        toast('Оплата прошла. Подписка активируется автоматически в течение нескольких секунд.');
      } else if (payment === 'fail') {
        toast('Оплата не завершена.');
      }
    }

    // Restore the last signed-in account after reopening the website.
    // Supabase persists and refreshes the session; passwords are never stored here.
    let restoringWebsiteSession = null;
    async function restoreWebsiteSession() {
      if (!supabaseClient || passwordRecoveryActive || window.emailInvitationActive || window.location.hash.includes('invite_token=') ||
          window.location.hash.includes('type=recovery') ||
          window.location.search.includes('type=recovery')) return;
      if (!document.getElementById('app-screen').classList.contains('hidden')) return;
      if (loginInProgress) return;
      if (restoringWebsiteSession) return restoringWebsiteSession;
      restoringWebsiteSession = (async () => {
        try {
          await withAuthDeadline(async (signal) => {
            const { data, error } = await supabaseClient.auth.getSession();
            checkAuthAttempt(signal);
            if (loginInProgress) return;
            if (error) throw error;
            if (!data?.session) return;
            // getUser validates and refreshes the current identity before restoring UI.
            const { data: identity, error: identityError } = await supabaseClient.auth.getUser();
            checkAuthAttempt(signal);
            if (loginInProgress) return;
            if (identityError || !identity?.user) return;
            const ok = await hydrateCurrentUser(signal);
            checkAuthAttempt(signal);
            if (ok && !passwordRecoveryActive && !loginInProgress) {
              enterApp();
              await handlePaymentReturn();
            }
          });
        } catch (e) {
          if (e.code === 'AUTH_SUPERSEDED') return;
          console.error('Check App session restoration error:', e);
          showError('Не удалось восстановить вход. Проверьте интернет и попробуйте снова.');
        } finally {
          restoringWebsiteSession = null;
        }
      })();
      return restoringWebsiteSession;
    }
    void restoreWebsiteSession();
    void handlePasswordRecoveryLink();
    if(typeof initEmailInvitation==='function')void initEmailInvitation();
    window.addEventListener('pageshow', event => {
      if (event.persisted) void restoreWebsiteSession();
    });
  
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && pendingOtp && !document.getElementById('otp-modal').classList.contains('hidden')) {
        event.preventDefault();
        verifyPendingOtp();
      }
    });
