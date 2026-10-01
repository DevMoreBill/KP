// Менеджеры: справочник в базе программы (общий для отдела), выбор менеджера в разделе «Менеджер».
// Выбранный менеджер запоминается на этом устройстве; правки контактов выбранного менеджера сохраняются в базу сами.
'use strict';

let MGRS = [];

const MGR_KEYS = ['name','position','phone','ext','mobile','email','site','address','hours','folder'];

const mgrFields = m => Object.fromEntries(MGR_KEYS.map(k=>[k, m && m[k]!=null ? String(m[k]) : '']));

function mgrRemember(id){ try{ if (id) localStorage.setItem('kp.managerId', id); else localStorage.removeItem('kp.managerId'); }catch(e){} }

async function loadManagers(){
  try{ MGRS = await api('/api/managers'); }catch(e){ MGRS=[]; return; }
  // переход с прежних версий: контакты, которые помнил этот браузер, становятся записью справочника
  if (!MGRS.length && String(S.manager?.name||'').trim()){ await saveManager(true); return; }
  let m = S.managerId ? MGRS.find(x=>x.id===S.managerId) : null;
  if (!m && !S.managerId && String(S.manager?.name||'').trim()) m = MGRS.find(x=>norm(x.name)===norm(S.manager.name));
  if (!m && !String(S.manager?.name||'').trim()){ let id=''; try{ id=localStorage.getItem('kp.managerId')||''; }catch(e){} m = MGRS.find(x=>x.id===id) || (MGRS.length===1 ? MGRS[0] : null); }
  if (m){ S.managerId=m.id; S.manager={...S.manager, ...mgrFields(m)}; mgrRemember(m.id); }
}

function selectManager(id){
  const m=MGRS.find(x=>x.id===id); if (!m) return;
  S.managerId=m.id; S.manager={...S.manager, ...mgrFields(m)}; mgrRemember(m.id);
  renderForm(); persist(); toast('Менеджер: '+m.name);
}

function newManager(){
  S.managerId=''; S.manager={...DEF_MANAGER, name:'', position:'', ext:'', mobile:'', email:'', folder:''}; mgrRemember('');
  renderForm(); persist(); setTimeout(()=>$('[data-p="manager.name"]')?.focus(), 30);
}

// silent — без уведомлений (автосохранение и перенос из браузера)
async function saveManager(silent){
  if (!String(S.manager.name||'').trim()){ if (!silent) toast('Укажите ФИО менеджера'); return false; }
  const id=S.managerId || uid()+uid();
  try{ const doc=await api('/api/managers/'+id,{method:'PUT',headers:{'Content-Type':'application/json; charset=utf-8'},body:JSON.stringify(mgrFields(S.manager))});
    const k=MGRS.findIndex(x=>x.id===id); if (k>=0) MGRS[k]=doc; else MGRS.push(doc);
    MGRS.sort((a,b)=>String(a.name).localeCompare(String(b.name),'ru'));
    const wasNew=!S.managerId; S.managerId=id; mgrRemember(id);
    if (wasNew){ persist(); if (STEP==='mgr') renderForm(); }
    const st=$('#mgrStat'); if (st) st.textContent='Сохранено в справочнике менеджеров';
    if (!silent) toast(wasNew?'Менеджер добавлен в справочник':'Сохранено');
    return true; }
  catch(e){ if (!silent) toast('Не удалось сохранить менеджера: '+(e.message||e)); return false; }
}

async function deleteManager(){
  const m=MGRS.find(x=>x.id===S.managerId); if (!m) return;
  if (!confirm(`Удалить «${m.name}» из справочника менеджеров?\nВ уже сохранённых КП контакты останутся.`)) return;
  try{ await api('/api/managers/'+m.id,{method:'DELETE'}); }catch(e){ return toast('Не удалось удалить: '+(e.message||e)); }
  MGRS=MGRS.filter(x=>x.id!==m.id); S.managerId=''; mgrRemember(''); renderForm(); persist(); toast('Удалено из справочника');
}

function managerBar(){
  const cur=MGRS.find(x=>x.id===S.managerId);
  return `<div class="mgrbar"><label class="f"><span>Менеджер в КП</span><select id="mgrSel" aria-label="Выбор менеджера">
      ${cur?'':`<option value="" selected>${String(S.manager.name||'').trim()?esc(S.manager.name)+' — не в справочнике':'— новый менеджер —'}</option>`}
      ${MGRS.map(m=>`<option value="${esc(m.id)}"${m.id===S.managerId?' selected':''}>${esc(m.name)}${m.position?' — '+esc(m.position):''}</option>`).join('')}</select></label>
    <div class="row">${cur?'':'<button class="btn primary" type="button" data-a="mgrSave">Сохранить в справочник</button>'}
      <button class="btn" type="button" data-a="mgrNew">+ Новый менеджер</button>
      ${cur?'<button class="btn ghost danger" type="button" data-a="mgrDel">Удалить из справочника</button>':''}</div>
    <p class="muted" id="mgrStat" style="grid-column:1/-1;margin:0">${cur?'Справочник общий для всех сотрудников: правки контактов сохраняются в нём автоматически.':'Новый менеджер: сохраните его в справочник — в следующих КП его можно будет выбрать из списка.'}</p></div>`;
}

let mgrT=null;
document.addEventListener('input', e=>{ const p=e.target.dataset?.p||''; if (!p.startsWith('manager.') || !S.managerId) return;
  clearTimeout(mgrT); const st=$('#mgrStat'); if (st) st.textContent='Сохраняю…'; mgrT=setTimeout(()=>saveManager(true), 900); });

document.addEventListener('change', e=>{ if (e.target.id!=='mgrSel') return; if (e.target.value) selectManager(e.target.value); else newManager(); });

document.addEventListener('click', e=>{ const b=e.target.closest('[data-a]'); if (!b) return;
  if (b.dataset.a==='mgrNew') newManager(); else if (b.dataset.a==='mgrSave') saveManager(false); else if (b.dataset.a==='mgrDel') deleteManager(); });
