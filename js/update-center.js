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
      // Signed APK releases are published on GitHub; never advertise a debug build.
      const releaseResponse=await fetch('https://api.github.com/repos/Dmitrii-exp/Check-app/releases/latest',{cache:'no-store',headers:{Accept:'application/vnd.github+json'}});
      if(releaseResponse.status===404){
        status.textContent='Новая подписанная версия Android пока не опубликована.';
        return;
      }
      if(!releaseResponse.ok)throw Error('Не удалось проверить Android-релизы');
      const release=await releaseResponse.json();
      const releaseVersion=String(release.tag_name||'').replace(/^v/,'');
      const apk=Array.isArray(release.assets)?release.assets.find(asset=>asset.name==='Check-App-v'+releaseVersion+'.apk'):null;
      if(!/^\\d+\\.\\d+\\.\\d+$/.test(releaseVersion)||versionCompare(releaseVersion,CURRENT_VERSION)<=0||!apk){
        status.textContent='Установлена актуальная версия Android.';
        return;
      }
      const url=new URL(apk.browser_download_url);
      if(url.protocol!=='https:'||url.hostname!=='github.com'||!url.pathname.startsWith('/Dmitrii-exp/Check-app/releases/download/')||!url.pathname.endsWith('.apk'))throw Error('Некорректный адрес APK');
      status.textContent='Доступна версия '+releaseVersion+'. Android попросит подтвердить установку.';
      const notes=String(release.body||'').split('\\n').filter(line=>line.startsWith('- '));
      if(notes.length){
        changes.replaceChildren();
        for(const line of notes){const item=document.createElement('li');item.textContent=line.slice(2);changes.appendChild(item);}
      }
      button.textContent='Установить обновление';
      button.classList.remove('hidden');
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
