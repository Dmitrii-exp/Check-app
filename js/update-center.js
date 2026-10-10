(function () {
  'use strict';
  const CURRENT_VERSION = '1.1.0';
  const MANIFEST_URL = 'public/app-updates.json';
  const isNative = () => !!window.Capacitor?.isNativePlatform?.();
  const el = id => document.getElementById(id);
  function versionCompare(a,b) {
    const x=String(a).split('.').map(Number),y=String(b).split('.').map(Number);
    for(let i=0;i<3;i++)if((x[i]||0)!==(y[i]||0))return (x[i]||0)>(y[i]||0)?1:-1;
    return 0;
  }
  async function checkAppUpdates() {
    const status=el('app-update-status'),button=el('app-update-install'),changes=el('app-update-changes');
    if(!status||!button||!changes)return;
    status.textContent='Проверяем обновления…';
    button.classList.add('hidden');
    button.onclick=null;
    try {
      const response=await fetch(MANIFEST_URL+'?t='+Date.now(),{cache:'no-store'});
      if(!response.ok)throw Error('Не удалось получить информацию об обновлениях');
      const data=await response.json();
      if(!Array.isArray(data.changes)||typeof data.latestVersion!=='string')throw Error('Некорректные данные обновления');
      const latest=data.latestVersion;
      el('app-update-latest').textContent='Последняя версия: '+latest;
      changes.replaceChildren();
      for(const change of data.changes){
        const item=document.createElement('li');
        item.textContent=(change.type==='fix'?'Исправлено: ':'Новое: ')+String(change.text||'');
        changes.appendChild(item);
      }
      if(!isNative()){
        status.textContent='Сайт обновляется автоматически. Нажмите «Обновить сейчас», чтобы загрузить актуальную версию.';
        button.textContent='Обновить сейчас';
        button.classList.remove('hidden');
        button.onclick=async()=>{
          button.disabled=true;
          button.textContent='Обновление…';
          try {
            if('serviceWorker' in navigator){
              const registration=await navigator.serviceWorker.getRegistration();
              if(registration)await registration.update();
            }
          }catch(error){console.warn('[Check App] service worker update',error);}
          const url=new URL(location.href);
          url.searchParams.set('updated',Date.now().toString());
          location.replace(url.href);
        };
        return;
      }
      if(!data.published||!data.apkUrl||versionCompare(latest,CURRENT_VERSION)<=0){
        status.textContent='Установлена актуальная версия приложения. Новая APK пока не опубликована.';
        return;
      }
      const url=new URL(data.apkUrl,location.origin);
      if(url.protocol!=='https:'||url.origin!==location.origin||!url.pathname.toLowerCase().endsWith('.apk'))throw Error('Небезопасный адрес обновления');
      status.textContent='Доступна версия '+latest+'. Сохраните работу перед установкой.';
      button.textContent='Установить обновление';
      button.classList.remove('hidden');
      // Android requires user confirmation to install an APK. iOS apps cannot self-install.
      button.onclick=()=>window.open(url.href,'_system');
    }catch(error){
      status.textContent='Не удалось проверить обновления. Проверьте интернет.';
      console.error('[Check App] update check',error);
    }
  }
  window.checkAppUpdates=checkAppUpdates;
  document.addEventListener('DOMContentLoaded',()=>{
    const version=el('app-update-current');
    if(version)version.textContent='Версия приложения: '+CURRENT_VERSION;
    void checkAppUpdates();
  });
})();
