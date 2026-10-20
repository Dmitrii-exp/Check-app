(function () {
  'use strict';
  const key='checkapp-interface-theme';
  const valid=value=>value==='light'||value==='dark';
  let selected='dark';
  try{const saved=localStorage.getItem(key);if(valid(saved))selected=saved;}catch(_){}
  function apply(theme,persist=false){
    selected=valid(theme)?theme:'dark';
    document.documentElement.dataset.theme=selected;
    const meta=document.querySelector('meta[name="theme-color"]');
    if(meta)meta.content=selected==='light'?'#f4f6fb':'#090e19';
    let stored=true;
    if(persist)try{localStorage.setItem(key,selected);}catch(_){stored=false;}
    document.querySelectorAll('[data-theme-choice]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.themeChoice===selected)));
    document.querySelectorAll('[data-theme-status]').forEach(status=>{status.textContent=(selected==='light'?'Светлая тема':'Тёмная тема')+(stored?'':'. Не удалось сохранить выбор на устройстве.');status.classList.toggle('theme-sr-only',stored);});
  }
  // Apply before styles/first paint so a saved light theme never flashes dark.
  apply(selected);
  function mount(){
    document.querySelectorAll('[data-theme-control]').forEach(container=>{
      const group=document.createElement('div');group.className='theme-switch';group.setAttribute('role','group');group.setAttribute('aria-label','Тема интерфейса');
      for(const [value,label,icon] of [['dark','Тёмная','☾'],['light','Светлая','☀']]){
        const button=document.createElement('button');button.type='button';button.dataset.themeChoice=value;
        const symbol=document.createElement('span');symbol.setAttribute('aria-hidden','true');symbol.textContent=icon;
        button.append(symbol,document.createTextNode(label));button.addEventListener('click',()=>apply(value,true));group.appendChild(button);
      }
      const status=document.createElement('span');status.className='theme-sr-only';status.dataset.themeStatus='';status.setAttribute('role','status');container.replaceChildren(group,status);
    });apply(selected);
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',mount,{once:true});else mount();
  window.addEventListener('storage',event=>{if(event.key===key)apply(event.newValue);});
})();
