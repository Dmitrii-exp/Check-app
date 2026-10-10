// Consumables requests — shared Supabase data, secured by database RLS.
let consumablesFilter = 'active';
let consumablesRows = [];
let consumablesRequestVersion = 0;
let consumablesSaving = false;
const consumablesLabels = {needed:'Нужно купить',ordered:'Заказано',purchased:'Закуплено'};
function consumablesEscape(value) {
  return String(value ?? '').replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','"':'&quot;',"'":'&#39;'}[c]));
}
function consumablesScope() {
  const company=getCompany(), user=getUser();
  return {companyId:company?.id, departmentId:getActiveDeptId(), manager:user?.role==='manager', userId:user?.id};
}
function setConsumablesFilter(filter) {
  consumablesFilter=filter;
  document.querySelectorAll('[data-consumables-filter]').forEach(el=>{
    const selected=el.dataset.consumablesFilter===filter;
    el.classList.toggle('border-blue-500',selected);
    el.classList.toggle('border-[#354359]',!selected);
    el.classList.toggle('text-blue-300',selected);
  });
  paintConsumables();
}
function openConsumableModal() {
  const {departmentId}=consumablesScope();
  if(!departmentId){toast('Сначала выберите подразделение');return;}
  document.getElementById('consumable-photo').value='';
  document.getElementById('consumable-photo-preview').classList.add('hidden');
  document.getElementById('consumables-modal').classList.remove('hidden');
  document.getElementById('consumable-name').focus();
}
function closeConsumableModal() {
  if(consumablesSaving)return;
  document.getElementById('consumables-modal').classList.add('hidden');
}
async function saveConsumable(event) {
  event.preventDefault();
  if(consumablesSaving)return;
  const scope=consumablesScope();
  if(!scope.companyId || !scope.departmentId || !scope.userId){toast('Нет доступа к подразделению');return;}
  const name=document.getElementById('consumable-name').value.trim();
  const quantity=Number(document.getElementById('consumable-quantity').value);
  const unit=document.getElementById('consumable-unit').value;
  const comment=document.getElementById('consumable-comment').value.trim();
  if(name.length<2 || !Number.isFinite(quantity) || quantity<=0 || quantity>1000000){toast('Проверьте название и количество');return;}
  const btn=document.getElementById('consumable-save');
  consumablesSaving=true;btn.disabled=true;btn.textContent='Сохранение…';
  let photoPath=null;
  try {
    const recordId=crypto.randomUUID();
    photoPath=await checkUploadPhoto('consumable-photos',scope.companyId,recordId,document.getElementById('consumable-photo').files?.[0]);
    const {error}=await supabaseClient.from('consumable_requests').insert({
      id:recordId,photo_path:photoPath,
      company_id:scope.companyId,department_id:scope.departmentId,created_by:scope.userId,
      item_name:name,quantity,unit,comment
    });
    if(error)throw error;
    document.getElementById('consumables-modal').classList.add('hidden');
    document.getElementById('consumable-name').value='';
    document.getElementById('consumable-quantity').value='1';
    document.getElementById('consumable-comment').value='';
    toast('Расходник добавлен в список закупки');
    await renderConsumables();
  }catch(error){if(photoPath)await checkRemovePhoto('consumable-photos',photoPath);console.error('Consumables save',error);toast('Не удалось сохранить заявку: '+(error.message||'Ошибка сети'));}
  finally{consumablesSaving=false;btn.disabled=false;btn.textContent='Добавить';}
}
async function renderConsumables() {
  const scope=consumablesScope();
  const list=document.getElementById('consumables-list');
  if(!list)return;
  const version=++consumablesRequestVersion;
  if(!scope.companyId || !scope.departmentId){list.innerHTML='<p class="text-center text-[#a8b5c8] py-8">Выберите подразделение</p>';return;}
  list.innerHTML='<p class="text-center text-[#a8b5c8] py-8">Загрузка заявок…</p>';
  try{
    const {data,error}=await supabaseClient.from('consumable_requests')
      .select('id,item_name,quantity,unit,comment,status,created_by,created_at,department_id,photo_path')
      .eq('company_id',scope.companyId).eq('department_id',scope.departmentId)
      .order('created_at',{ascending:false}).limit(500);
    if(error)throw error;
    if(version!==consumablesRequestVersion || scope.departmentId!==consumablesScope().departmentId)return;
    consumablesRows=data||[];
    paintConsumables();
  }catch(error){
    console.error('Consumables load',error);
    list.textContent='Не удалось загрузить заявки. Проверьте подключение и повторно откройте вкладку.';
  }
}
function paintConsumables(){
  const list=document.getElementById('consumables-list');if(!list)return;
  const scope=consumablesScope();
  const counts={needed:0,ordered:0,purchased:0};
  consumablesRows.forEach(r=>{if(counts[r.status]!==undefined)counts[r.status]++;});
  for(const key of Object.keys(counts)){const el=document.getElementById('consumables-'+key+'-count');if(el)el.textContent=counts[key];}
  const badge=document.getElementById('consumables-nav-count');
  if(badge){badge.textContent=counts.needed;badge.classList.toggle('hidden',counts.needed===0);}
  const rows=consumablesRows.filter(r=>consumablesFilter==='all'||(consumablesFilter==='active'?r.status!=='purchased':r.status===consumablesFilter));
  if(!rows.length){list.innerHTML='<p class="text-center text-[#a8b5c8] py-10">В этом списке пока нет заявок</p>';return;}
  list.innerHTML=rows.map(r=>{
    const editable=scope.manager || (r.created_by===scope.userId && r.status==='needed');
    const colors={needed:'text-amber-400',ordered:'text-blue-400',purchased:'text-emerald-400'};
    const owner=getCompany()?.users?.find(u=>u.id===r.created_by);
    const statusControls=scope.manager?'<div class="flex flex-wrap gap-2 mt-3">'+
      Object.entries(consumablesLabels).map(([status,label])=>'<button type="button" data-consumable-id="'+consumablesEscape(r.id)+'" data-new-status="'+status+'" '+(r.status===status?'disabled ':'')+'class="px-3 py-1.5 rounded-xl border text-xs '+(r.status===status?'border-blue-500 bg-blue-600/20 text-blue-300':'border-slate-600 text-slate-300')+'">'+label+'</button>').join('')+'</div>':'';
    return '<article class="bg-[#131e2d] rounded-2xl border border-[#263448] p-4 space-y-2"><div class="flex items-start justify-between gap-2"><h3 class="font-semibold break-words">'+consumablesEscape(r.item_name)+'</h3><span class="text-xs whitespace-nowrap '+(colors[r.status]||'text-[#a8b5c8]')+'">'+consumablesEscape(consumablesLabels[r.status]||r.status)+'</span></div>'+
      (r.photo_path?'<img class="hidden w-24 h-24 rounded-xl object-cover" alt="Фото расходника" data-check-photo-bucket="consumable-photos" data-check-photo-path="'+consumablesEscape(r.photo_path)+'">':'')+
      '<div class="text-sm text-slate-300">'+consumablesEscape(r.quantity)+' '+consumablesEscape(r.unit)+'</div>'+
      (r.comment?'<p class="text-sm text-[#a8b5c8] whitespace-pre-wrap break-words">'+consumablesEscape(r.comment)+'</p>':'')+
      '<div class="text-xs text-[#8191a8]">'+consumablesEscape(owner?.name||'Сотрудник')+' · '+new Date(r.created_at).toLocaleDateString('ru-RU')+'</div>'+
      statusControls+(scope.manager?'<button type="button" data-consumable-delete="'+consumablesEscape(r.id)+'" class="text-xs text-rose-400 mt-2">Удалить заявку</button>':'')+'</article>';
  }).join('');
  void checkShowSignedPhotos(list);
  list.querySelectorAll('[data-new-status]').forEach(btn=>btn.addEventListener('click',()=>changeConsumableStatus(btn.dataset.consumableId,btn.dataset.newStatus)));
  list.querySelectorAll('[data-consumable-delete]').forEach(btn=>btn.addEventListener('click',()=>deleteConsumable(btn.dataset.consumableDelete)));
}
async function changeConsumableStatus(id,status){
  if(getUser()?.role!=='manager'||!consumablesLabels[status])return;
  const scope=consumablesScope();
  try{
    const {data,error}=await supabaseClient.from('consumable_requests').update({status})
      .eq('id',id).eq('company_id',scope.companyId).eq('department_id',scope.departmentId).select('id');
    if(error)throw error;
    if(!data?.length)throw new Error('Заявка не найдена или доступ запрещён');
    toast('Статус обновлён');await renderConsumables();
  }catch(error){console.error(error);toast('Не удалось обновить статус');}
}
async function deleteConsumable(id){
  if(getUser()?.role!=='manager'||!confirm('Удалить заявку без возможности восстановления?'))return;
  const scope=consumablesScope();
  try{
    const {data,error}=await supabaseClient.from('consumable_requests').delete()
      .eq('id',id).eq('company_id',scope.companyId).eq('department_id',scope.departmentId).select('id');
    if(error)throw error;
    if(!data?.length)throw new Error('Заявка не найдена');
    toast('Заявка удалена');await renderConsumables();
  }catch(error){console.error(error);toast('Не удалось удалить заявку');}
}
