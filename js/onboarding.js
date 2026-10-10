// Check App interactive onboarding; uses only existing sections and actions.
(function () {
  'use strict';
  const slides = [
    {title:'Создайте подразделение', section:'Подразделение', action:'+ Создать', detail:'На верхней панели нажмите «+ Создать» и укажите название подразделения. Для разных объектов можно создать отдельные подразделения.', hint:'Подразделение: Основное    + Создать'},
    {title:'Откройте оборудование', section:'Оборудование', action:'Оборудование', detail:'Перейдите во вкладку «Оборудование». Здесь хранится список техники выбранного подразделения.', hint:'Главная  ·  Сегодня  ·  Оборудование'},
    {title:'Добавьте оборудование', section:'Добавить оборудование', action:'Сохранить', detail:'Нажмите «+ Добавить», заполните название, инвентарный номер / ID и расположение. Затем нажмите «Сохранить».', fields:[['Название','Шиномонтажный станок'],['Инвентарный номер / ID','183821'],['Расположение','Основное']]},
    {title:'Настройте действия ТО', section:'Добавить действие ТО', action:'Сохранить', detail:'Выберите оборудование, укажите название и описание работ, затем установите периодичность и сохраните действие.', fields:[['Оборудование','Шиномонтажный станок'],['Название действия','Смазка узлов'],['Описание','Смазка движущихся механизмов и узлов'],['Периодичность','Раз в неделю']]},
    {title:'Пригласите сотрудника', section:'Команда', action:'Копировать', detail:'Откройте «Команда», выберите подразделение, скопируйте код приглашения и передайте его сотруднику. Кнопка «Новый» создаёт новый код.', fields:[['Подразделение для приглашения','Основное'],['Код приглашения','Код из вашего кабинета']]},
    {title:'Вход сотрудника по коду', section:'Вход по коду', action:'По коду', detail:'Сотрудник открывает экран входа, выбирает вкладку «По коду» и вводит полученный код. Он получает доступ к данным своего подразделения.', fields:[['Код приглашения','Введите код руководителя']]},
    {title:'Найдите задачи на сегодня', section:'Сегодня / Календарь', action:'Сегодня', detail:'Во вкладке «Сегодня» отображаются задачи на текущий день. Календарь помогает просматривать запланированные работы.', hint:'Календарь  ·  Сегодня  ·  Задачи на сегодня'},
    {title:'Подтвердите выполнение', section:'Выполнить задачу', action:'Сохранить', detail:'Укажите фактического исполнителя, выберите «Выполнено» или «Не выполнено». При выполнении обязательно прикрепите фото, затем сохраните результат.', fields:[['Имя фактического исполнителя','Иван'],['Статус','Выполнено / Не выполнено'],['Фото-фиксация','Обязательна для выполненной задачи'],['Комментарий','Дополнительная информация']]},
    {title:'Просмотрите историю', section:'История работ', action:'История', detail:'Откройте «История», используйте фильтры «Все», «Выполнено», «Не выполнено». При необходимости откройте карточку задачи.', hint:'Все  ·  Выполнено  ·  Не выполнено'},
    {title:'Контролируйте результаты', section:'Отчёты', action:'Отчёты', detail:'В разделе «Отчёты» проверяйте результаты обслуживания и просроченные работы. Сотрудник видит только данные своего подразделения.', hint:'Команда  ·  История  ·  Отчёты  ·  Кабинет'}
  ];
  let current = 0;
  let activeUserId = null;
  function safe(s) {return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
  function storageKey(id) {return 'checkapp:onboarding:v1:' + id;}
  function render() {
    const slide = slides[current];
    const content = document.getElementById('onboarding-content');
    if (!content) return;
    const rows = slide.fields ? slide.fields.map(([label,value],i)=>'<div class="mb-3"><div class="text-xs text-[#a8b5c8] mb-1">'+safe(label)+'</div><div class="rounded-xl border border-blue-500/70 bg-[#1c2a3d] p-3 text-white text-sm"><span class="text-blue-400 mr-2">'+(i+1)+'.</span>'+safe(value)+'</div></div>').join('') : '<div class="rounded-2xl border border-blue-500/70 bg-[#1c2a3d] p-4 text-sm text-blue-200 text-center">'+safe(slide.hint || slide.action)+'</div>';
    content.innerHTML = '<div class="rounded-2xl border border-[#354359] bg-[#0c1229] p-4 min-h-[220px]"><div class="text-xs text-blue-400 mb-4">CHECK APP · '+safe(slide.section)+'</div><div class="text-white font-bold text-xl mb-5">'+safe(slide.section)+'</div>'+rows+'<div class="mt-4 rounded-xl bg-blue-600 text-center py-2.5 font-semibold text-white">'+safe(slide.action)+'</div></div><div class="mt-4 rounded-2xl border border-blue-500/50 bg-blue-950/60 p-3 text-sm text-blue-100"><span class="font-semibold">Шаг '+(current+1)+':</span> '+safe(slide.detail)+'</div>';
    document.getElementById('onboarding-title').textContent = (current+1)+'. '+slide.title;
    document.getElementById('onboarding-description').textContent = slide.detail;
    document.getElementById('onboarding-count').textContent = (current+1)+' / '+slides.length;
    document.getElementById('onboarding-prev').disabled = current === 0;
    document.getElementById('onboarding-prev').classList.toggle('opacity-40', current === 0);
    document.getElementById('onboarding-next').textContent = current === slides.length-1 ? 'ОК' : 'Далее →';
    document.getElementById('onboarding-skip').classList.toggle('hidden',current === slides.length-1);
    document.getElementById('onboarding-dots').innerHTML = slides.map((_,i)=>'<button type="button" data-step="'+i+'" class="h-2 w-2 rounded-full '+(i===current?'bg-blue-600':'bg-slate-200')+'" aria-label="Слайд '+(i+1)+'"></button>').join('');
    document.querySelectorAll('#onboarding-dots button').forEach(btn=>btn.addEventListener('click',()=>{current=Number(btn.dataset.step);render();}));
  }
  window.openOnboardingTour = function(manual) {
    const overlay = document.getElementById('onboarding-overlay');
    if (!overlay) return;
    current=0;render();
    overlay.classList.remove('hidden');
    if (manual) overlay.dataset.manual='true';
  };
  window.closeOnboardingTour = function() {
    document.getElementById('onboarding-overlay')?.classList.add('hidden');
    if (activeUserId) {try {localStorage.setItem(storageKey(activeUserId),'done');} catch(e) {console.warn(e);}}
  };
  window.changeOnboardingSlide = function(delta) {
    if (delta>0 && current===slides.length-1) return window.closeOnboardingTour();
    current=Math.max(0,Math.min(slides.length-1,current+delta));render();
  };
  window.maybeShowFirstLoginTour = function(userId, createdAt) {
    if (!userId) return;
    activeUserId=userId;
    // Never unexpectedly interrupt pre-existing users.
    if (!createdAt || Date.parse(createdAt)<Date.parse('2026-10-09T00:00:00Z')) return;
    try {if (localStorage.getItem(storageKey(userId))) return;} catch(e) {return;}
    window.openOnboardingTour(false);
  };
})();
