// Private photos: company-scoped paths, signed URLs and client-side compression.
const checkPhotoMaxBytes = 5 * 1024 * 1024;
async function checkPreparePhoto(file) {
  if (!file) return null;
  if (!file.type.startsWith('image/')) throw new Error('Выберите изображение');
  if (file.size > 25 * 1024 * 1024) throw new Error('Исходное фото слишком большое (максимум 25 МБ)');
  const image = await createImageBitmap(file);
  try {
    const maxSide = 1600;
    const scale = Math.min(1,maxSide/Math.max(image.width,image.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1,Math.round(image.width*scale));
    canvas.height = Math.max(1,Math.round(image.height*scale));
    canvas.getContext('2d').drawImage(image,0,0,canvas.width,canvas.height);
    const blob = await new Promise((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(new Error('Не удалось обработать фото')),'image/jpeg',0.78));
    if(blob.size>checkPhotoMaxBytes) throw new Error('Фото слишком большое');
    return blob;
  } finally { image.close(); }
}
async function checkUploadPhoto(bucket, companyId, recordId, file) {
  if (!file) return null;
  const blob=await checkPreparePhoto(file);
  const path=companyId+'/'+recordId+'/'+crypto.randomUUID()+'.jpg';
  const {error}=await supabaseClient.storage.from(bucket).upload(path,blob,{contentType:'image/jpeg',upsert:false});
  if(error)throw error;
  return path;
}
async function checkRemovePhoto(bucket,path) {
  if(path)await supabaseClient.storage.from(bucket).remove([path]);
}
async function checkShowSignedPhotos(root=document) {
  const nodes=Array.from(root.querySelectorAll('img[data-check-photo-path]'));
  await Promise.all(nodes.map(async img=>{
    const path=img.dataset.checkPhotoPath, bucket=img.dataset.checkPhotoBucket;
    if(!path||!['equipment-photos','consumable-photos'].includes(bucket))return;
    const {data,error}=await supabaseClient.storage.from(bucket).createSignedUrl(path,900);
    if(!error&&data?.signedUrl&&img.isConnected&&img.dataset.checkPhotoPath===path){
      img.src=data.signedUrl;
      img.classList.remove('hidden');
    }
  }));
}
function checkPhotoInputChanged(input,previewId){
  const preview=document.getElementById(previewId);
  if(!preview)return;
  const file=input.files?.[0];
  if(!file){preview.classList.add('hidden');preview.removeAttribute('src');return;}
  if(!file.type.startsWith('image/')){input.value='';toast('Выберите фотографию');return;}
  const url=URL.createObjectURL(file);
  preview.onload=()=>URL.revokeObjectURL(url);
  preview.src=url;
  preview.classList.remove('hidden');
}

function checkPhotoFromCamera(input,targetId,previewId){const target=document.getElementById(targetId);if(!target||!input.files?.length)return;const transfer=new DataTransfer();transfer.items.add(input.files[0]);target.files=transfer.files;checkPhotoInputChanged(target,previewId);}


let checkReplacePhotoTarget = null;
let checkReplacingPhoto = false;
function checkOpenReplacePhoto(kind,id){
  const company=getCompany(), user=getUser();
  if(!company||!user||!['equipment','consumable'].includes(kind))return;
  let record;
  if(kind==='equipment'){
    record=company.equipment.find(e=>e.id===id&&e.departmentId===getActiveDeptId());
  }else{
    record=consumablesRows.find(e=>e.id===id);
    const allowed=record&&(user.role==='manager'||(record.created_by===user.id&&record.status==='needed'));
    if(!allowed)record=null;
  }
  if(!record)return toast('Нет доступа к этой записи');
  checkReplacePhotoTarget={kind,id,companyId:company.id,departmentId:getActiveDeptId(),oldPath:kind==='equipment'?record.photoPath:record.photo_path};
  const input=document.getElementById('replace-photo-file');
  input.value='';
  const preview=document.getElementById('replace-photo-preview');
  preview.removeAttribute('src');
  preview.classList.add('hidden');
  document.getElementById('modal-replace-photo').classList.remove('hidden');
}
function checkCloseReplacePhoto(){
  if(checkReplacingPhoto)return;
  checkReplacePhotoTarget=null;
  document.getElementById('modal-replace-photo').classList.add('hidden');
}
async function checkSaveReplacePhoto(){
  if(checkReplacingPhoto||!checkReplacePhotoTarget)return;
  const file=document.getElementById('replace-photo-file').files?.[0];
  if(!file)return toast('Выберите фотографию');
  const target=checkReplacePhotoTarget;
  const scope=consumablesScope();
  if(scope.companyId!==target.companyId||scope.departmentId!==target.departmentId)return toast('Подразделение изменилось. Повторите операцию');
  const bucket=target.kind==='equipment'?'equipment-photos':'consumable-photos';
  const table=target.kind==='equipment'?'equipment':'consumable_requests';
  const button=document.getElementById('replace-photo-save');
  let newPath=null,committed=false;
  checkReplacingPhoto=true;
  button.disabled=true;button.textContent='Сохранение…';
  try{
    newPath=await checkUploadPhoto(bucket,target.companyId,target.id,file);
    const {data,error}=await supabaseClient.from(table).update({photo_path:newPath})
      .eq('id',target.id).eq('company_id',target.companyId)
      .eq('department_id',target.departmentId).select('id');
    if(error)throw error;
    if(!data?.length)throw new Error('Запись не найдена или недостаточно прав');
    committed=true;
    if(target.kind==='equipment'){
      const record=getCompany()?.equipment.find(e=>e.id===target.id);
      if(record)record.photoPath=newPath;
      renderEquipment();
    }else{
      const record=consumablesRows.find(e=>e.id===target.id);
      if(record)record.photo_path=newPath;
      paintConsumables();
    }
    checkReplacePhotoTarget=null;
    document.getElementById('modal-replace-photo').classList.add('hidden');
    toast('Фотография заменена');
    if(target.oldPath&&target.oldPath!==newPath){
      try{await checkRemovePhoto(bucket,target.oldPath);}catch(error){console.warn('Old photo cleanup failed',error);}
    }
  }catch(error){
    if(newPath&&!committed){
      try{await checkRemovePhoto(bucket,newPath);}catch(cleanupError){console.warn('Photo rollback failed',cleanupError);}
    }
    toast('Не удалось заменить фото: '+(error.message||'Ошибка сети'));
  }finally{
    checkReplacingPhoto=false;
    button.disabled=false;button.textContent='Сохранить';
  }
}
