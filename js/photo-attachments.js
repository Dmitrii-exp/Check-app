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
