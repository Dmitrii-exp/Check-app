// Email invitations expose no joining capability to the inviter.
const teamRoleLabels={employee:'Сотрудник',responsible:'Руководитель подразделения',manager:'Руководитель сети'};
let preparedTeamInvitation=null, teamInviteBusy=false, teamRoleTarget=null, teamRoleBusy=false;
let emailInvitationToken=null, emailInvitationInfo=null, emailInvitationBusy=false;
window.emailInvitationActive=false;
function canManageDepartment(id){const u=getUser();return !!id&&!!u&&(u.role==='manager'||(u.role==='responsible'&&u.departmentId===id));}
function teamMessage(id,message,error=false){const el=document.getElementById(id);el.textContent=message;el.classList.toggle('team-error',error);}
async function companyInvitationRequest(body){
 const {data,error}=await supabaseClient.functions.invoke('company-invitations',{body});
 if(error){let message=data?.error;try{message=(await error.context.json()).error||message;}catch(_){}throw new Error(message||'Не удалось связаться с сервером. Повторите попытку.');}
 if(data?.error)throw new Error(data.error);return data;
}
function requireTeamOwner(){return getUser()?.role==='manager';}
function setTeamInviteBusy(busy){teamInviteBusy=busy;['team-invite-email','invite-dept-select','team-invite-prepare','team-invite-send'].forEach(id=>document.getElementById(id).disabled=busy);document.getElementById('team-invite-form').setAttribute('aria-busy',String(busy));}
function clearPreparedTeamInvitation(){if(teamInviteBusy)return;preparedTeamInvitation=null;document.getElementById('team-invite-prepared').classList.add('hidden');}
async function prepareTeamInvitation(){
 if(!requireTeamOwner()||teamInviteBusy)return;
 const form=document.getElementById('team-invite-form');if(!form.reportValidity())return;
 clearPreparedTeamInvitation();setTeamInviteBusy(true);teamMessage('team-invite-status','Подготовка приглашения…');
 try{const response=await companyInvitationRequest({mode:'create',email:document.getElementById('team-invite-email').value.trim(),department_id:document.getElementById('invite-dept-select').value});preparedTeamInvitation=response.data;
 document.getElementById('team-invite-prepared-label').textContent='Приглашение подготовлено для '+preparedTeamInvitation.email+'. Подразделение: '+preparedTeamInvitation.department_name+'.';
 document.getElementById('team-invite-prepared').classList.remove('hidden');teamMessage('team-invite-status','Письмо ещё не отправлено. Нажмите «Отправить приглашение».');
 }catch(e){teamMessage('team-invite-status',e.message,true);}finally{setTeamInviteBusy(false);}
}
async function sendPreparedTeamInvitation(){if(preparedTeamInvitation)await sendTeamInvitation(preparedTeamInvitation.id,true);}
async function sendTeamInvitation(id,prepared=false){
 if(!requireTeamOwner()||teamInviteBusy)return;
 setTeamInviteBusy(true);teamMessage('team-invite-status','Отправляем письмо…');
 try{const response=await companyInvitationRequest({mode:'send',invitation_id:id});teamMessage('team-invite-status','Приглашение отправлено на '+response.data.email+'. Ссылка действует 7 дней.');
 if(prepared){preparedTeamInvitation=null;document.getElementById('team-invite-prepared').classList.add('hidden');}
 await loadTeamInvitations();
 }catch(e){teamMessage('team-invite-status',e.message,true);}finally{setTeamInviteBusy(false);}
}
let teamInvitationsLoading=false;
async function loadTeamInvitations(){
 if(!requireTeamOwner()||teamInvitationsLoading)return;
 teamInvitationsLoading=true;const list=document.getElementById('team-invitations-list');list.textContent='Загрузка приглашений…';
 try{const {data}=await companyInvitationRequest({mode:'list'});const labels={draft:'Подготовлено',sending:'Отправляется',pending:'Отправлено',accepted:'Принято',revoked:'Отозвано'};
 if(!data.length){list.textContent='Приглашений пока нет';return;}
 list.innerHTML=data.map(i=>{const active=['draft','pending'].includes(i.status);const expired=i.status==='pending'&&new Date(i.expires_at)<new Date();return `<div class="team-row"><div class="team-row-copy"><strong>${esc(i.email)}</strong><p>${esc(getCompany().departments.find(d=>d.id===i.department_id)?.name||'Подразделение')} · ${expired?'Истекло':labels[i.status]||'—'}</p></div>${active?`<div class="team-row-actions"><button type="button" data-team-send="${esc(i.id)}" class="team-secondary">${i.status==='draft'?'Отправить':'Отправить повторно'}</button><button type="button" data-team-revoke="${esc(i.id)}" class="team-secondary">Отозвать</button></div>`:''}</div>`;}).join('');
 list.querySelectorAll('[data-team-send]').forEach(b=>b.onclick=()=>sendTeamInvitation(b.dataset.teamSend));
 list.querySelectorAll('[data-team-revoke]').forEach(b=>b.onclick=()=>revokeTeamInvitation(b.dataset.teamRevoke));
 }catch(e){list.textContent=e.message+' Нажмите «Обновить» для повторной попытки.';}finally{teamInvitationsLoading=false;}
}
async function revokeTeamInvitation(id){
 if(!requireTeamOwner()||teamInviteBusy)return;setTeamInviteBusy(true);
 try{await companyInvitationRequest({mode:'revoke',invitation_id:id});teamMessage('team-invite-status','Приглашение отозвано. Ссылка больше не действует.');await loadTeamInvitations();}
 catch(e){teamMessage('team-invite-status',e.message,true);}finally{setTeamInviteBusy(false);}
}
function renderCompanyTeam(){
 if(!requireTeamOwner())return;
 renderDeptSelect();const c=getCompany();
 document.getElementById('team-list').innerHTML=c.users.map(u=>`<div class="team-row"><div class="team-row-copy"><strong>${esc(u.name)}</strong><p>${teamRoleLabels[u.role]||'Сотрудник'}${u.role==='manager'?'': ' · '+esc(c.departments.find(d=>d.id===u.departmentId)?.name||'Подразделение не назначено')}</p></div><div class="team-row-actions"><button type="button" class="team-secondary" data-team-role="${esc(u.id)}">Изменить роль</button>${u.role!=='manager'?`<button type="button" class="team-secondary" data-team-remove="${esc(u.id)}">Удалить из компании</button>`:''}</div></div>`).join('');
 document.querySelectorAll('[data-team-remove]').forEach(b=>b.onclick=()=>removeEmployee(b.dataset.teamRemove));
 document.querySelectorAll('[data-team-role]').forEach(b=>b.onclick=()=>openTeamRole(b.dataset.teamRole));
 document.getElementById('team-invite-email').oninput=clearPreparedTeamInvitation;
 document.getElementById('invite-dept-select').onchange=clearPreparedTeamInvitation;
 void loadTeamInvitations();
}
function updateTeamRoleFields(){const manager=document.getElementById('team-role').value==='manager';document.getElementById('team-role-dept-wrap').classList.toggle('hidden',manager);document.getElementById('team-role-dept').required=!manager;document.getElementById('team-role-help').textContent=manager?'Руководитель сети получит доступ ко всем подразделениям, подписке, приглашениям и удалению компании.':document.getElementById('team-role').value==='responsible'?'Может добавлять оборудование и действия только в выбранном подразделении. Предыдущий руководитель этого подразделения станет сотрудником.':'Может выполнять задания и добавлять записи в расходники своего подразделения. Не может менять оборудование, действия, подписку или роли.';}
function openTeamRole(id){
 if(!requireTeamOwner()||teamRoleBusy)return;const u=getCompany().users.find(u=>u.id===id);if(!u)return;
 teamRoleTarget=id;document.getElementById('team-role-name').textContent=u.name;document.getElementById('team-role').value=u.role;
 document.getElementById('team-role-dept').innerHTML=getCompany().departments.map(d=>`<option value="${esc(d.id)}">${esc(d.name)}</option>`).join('');
 document.getElementById('team-role-dept').value=u.departmentId||getActiveDeptId()||getCompany().departments[0]?.id||'';
 teamMessage('team-role-status','');updateTeamRoleFields();document.getElementById('team-role-dialog').showModal();document.getElementById('team-role-cancel').focus();
}
function closeTeamRole(){if(!teamRoleBusy)document.getElementById('team-role-dialog').close();}
async function saveTeamRole(){
 if(!requireTeamOwner()||!teamRoleTarget||teamRoleBusy)return;
 const dialog=document.getElementById('team-role-dialog');if(!dialog.querySelector('form').reportValidity())return;
 teamRoleBusy=true;dialog.setAttribute('aria-busy','true');['team-role','team-role-dept','team-role-save','team-role-cancel'].forEach(id=>document.getElementById(id).disabled=true);teamMessage('team-role-status','Сохраняем роль…');
 try{const role=document.getElementById('team-role').value;const {error}=await supabaseClient.rpc('set_company_member_role',{p_user_id:teamRoleTarget,p_role:role,p_department_id:role==='manager'?null:document.getElementById('team-role-dept').value});if(error)throw error;
 await hydrateCurrentUser();dialog.close();enterApp();if(requireTeamOwner())showPage('team');toast('Роль обновлена');
 }catch(e){const last=e.message?.includes('last network manager');teamMessage('team-role-status',last?'Нельзя понизить последнего руководителя сети. Сначала назначьте другого руководителя сети.':e.message||'Не удалось сохранить роль',true);}
 finally{teamRoleBusy=false;dialog.removeAttribute('aria-busy');['team-role','team-role-dept','team-role-save','team-role-cancel'].forEach(id=>document.getElementById(id).disabled=false);}
}
async function initEmailInvitation(){
 const params=new URLSearchParams(location.hash.slice(1));const token=params.get('invite_token');if(!token)return;
 window.emailInvitationActive=true;emailInvitationToken=token;history.replaceState({},document.title,location.pathname+location.search);switchAuthTab('invite');
 document.getElementById('email-invite-status').textContent='Проверяем приглашение…';
 try{emailInvitationInfo=await companyInvitationRequest({mode:'info',token});document.getElementById('email-invite-context').textContent=emailInvitationInfo.company_name+' · '+emailInvitationInfo.department_name;
 document.getElementById('email-invite-email').value=emailInvitationInfo.email;document.getElementById('email-invite-fields').classList.remove('hidden');
 const existing=emailInvitationInfo.existing_account;document.getElementById('email-invite-password-label').textContent=existing?'Действующий пароль аккаунта':'Создайте пароль (минимум 8 символов)';document.getElementById('email-invite-password').autocomplete=existing?'current-password':'new-password';document.getElementById('email-invite-repeat-wrap').classList.toggle('hidden',existing);document.getElementById('email-invite-repeat').required=!existing;
 teamMessage('email-invite-status',existing?'У вас уже есть аккаунт. Введите его действующий пароль.':'');document.getElementById('email-invite-name').focus();
 }catch(e){teamMessage('email-invite-status',e.message+' Попросите руководителя отправить новое приглашение.',true);}
}
function leaveEmailInvitation(){if(emailInvitationBusy)return;emailInvitationToken=null;emailInvitationInfo=null;window.emailInvitationActive=false;document.getElementById('email-invite-password').value='';document.getElementById('email-invite-repeat').value='';document.getElementById('email-invite-fields').classList.add('hidden');switchAuthTab('login');}
async function acceptEmailInvitation(){
 if(emailInvitationBusy||!emailInvitationToken||!emailInvitationInfo)return;
 const form=document.getElementById('form-invite');if(!form.reportValidity())return;
 const password=document.getElementById('email-invite-password').value,repeat=document.getElementById('email-invite-repeat').value;
 if(!emailInvitationInfo.existing_account&&password!==repeat)return teamMessage('email-invite-status','Пароли не совпадают',true);
 emailInvitationBusy=true;form.setAttribute('aria-busy','true');form.querySelectorAll('button,input').forEach(b=>b.disabled=true);teamMessage('email-invite-status','Присоединяемся к компании…');
 try{const response=await companyInvitationRequest({mode:'accept',token:emailInvitationToken,name:document.getElementById('email-invite-name').value.trim(),password,password_repeat:repeat});
 emailInvitationToken=null;window.emailInvitationActive=false;document.getElementById('email-invite-password').value='';document.getElementById('email-invite-repeat').value='';
 if(response.sign_in_required){switchAuthTab('login');document.getElementById('login-email').value=emailInvitationInfo.email;toast('Приглашение принято. Войдите с вашим паролем.');return;}
 const {error}=await supabaseClient.auth.setSession(response.session);if(error)throw error;
 await withAuthDeadline(async signal=>{if(!await hydrateCurrentUser(signal))throw new Error('Не удалось загрузить профиль. Войдите на странице входа.');checkAuthAttempt(signal);enterApp();});
 }catch(e){teamMessage('email-invite-status',e.message,true);}finally{emailInvitationBusy=false;form.removeAttribute('aria-busy');form.querySelectorAll('button,input').forEach(b=>b.disabled=false);}
}
document.getElementById('team-role-dialog').addEventListener('cancel',event=>{if(teamRoleBusy)event.preventDefault();});

let teamRemoveTarget=null,teamRemoveBusy=false;
function removeEmployee(id){if(!requireTeamOwner()||teamRemoveBusy)return;const u=getCompany().users.find(u=>u.id===id);if(!u||u.role==='manager')return;teamRemoveTarget=id;document.getElementById('team-remove-name').textContent=u.name;teamMessage('team-remove-status','');document.getElementById('team-remove-dialog').showModal();document.getElementById('team-remove-cancel').focus();}
function closeTeamMemberRemoval(){if(!teamRemoveBusy)document.getElementById('team-remove-dialog').close();}
async function confirmTeamMemberRemoval(){
 if(!requireTeamOwner()||teamRemoveBusy||!teamRemoveTarget)return;
 teamRemoveBusy=true;['team-remove-confirm','team-remove-cancel'].forEach(id=>document.getElementById(id).disabled=true);teamMessage('team-remove-status','Удаляем участника…');
 try{const {data,error}=await supabaseClient.from('profiles').delete().eq('id',teamRemoveTarget).eq('company_id',getCompany().id).select('id');if(error)throw error;if(!data?.length)throw new Error('Участник не найден или недостаточно прав');getCompany().users=getCompany().users.filter(u=>u.id!==teamRemoveTarget);document.getElementById('team-remove-dialog').close();renderCompanyTeam();toast('Участник удалён из компании');}
 catch(e){teamMessage('team-remove-status',e.message||'Не удалось удалить участника',true);}
 finally{teamRemoveBusy=false;['team-remove-confirm','team-remove-cancel'].forEach(id=>document.getElementById(id).disabled=false);}
}
document.getElementById('team-remove-dialog').addEventListener('cancel',event=>{if(teamRemoveBusy)event.preventDefault();});
