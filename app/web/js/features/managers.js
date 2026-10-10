// Менеджеры: справочник в базе программы (общий для отдела), выбор менеджера в разделе «Менеджер».
// Выбранный менеджер запоминается на этом устройстве; правки контактов выбранного менеджера сохраняются в базу сами.
'use strict';

let MGRS = [];

const MGR_KEYS = ['name','position','phone','ext','mobile','email','site','address','hours','folder'];

const mgrFields = m => Object.fromEntries(MGR_KEYS.map(k=>[k, m && m[k]!=null ? String(m[k]) : '']));

function mgrRemember(id){ try{ if (id) localStorage.setItem('kp.managerId', id); else localStorage.removeItem('kp.managerId'); }catch(e){} }

// кто работает на этом устройстве: менеджер, которого человек сам выбрал или добавил в разделе «Менеджер».
// Открытие чужого КП из журнала его не меняет. По нему — автор новых КП и доступ к «Экономике сделки».
function meId(){ if (typeof AUTH!=='undefined' && AUTH.enabled && AUTH.user) return AUTH.user.id;
  try{ return localStorage.getItem('kp.me') || localStorage.getItem('kp.managerId') || ''; }catch(e){ return ''; } }

function setMe(id){ const was=meId(); try{ if (id) localStorage.setItem('kp.me', id); }catch(e){} if (id && id!==was && typeof FEAT!=='undefined') FEAT.refresh();
  if (id && id!==was && typeof MyPrefs!=='undefined') MyPrefs.load(); }

function meName(){ const m=MGRS.find(x=>x.id===meId()); return m ? m.name : ''; }

async function loadManagers(){
  try{ MGRS = await api('/api/managers'); }catch(e){ MGRS=[]; return; }
  // переход с прежних версий: контакты, которые помнил этот браузер, становятся записью справочника
  if (!MGRS.length && String(S.manager?.name||'').trim()){ await saveManager(true); return; }
  let m = S.managerId ? MGRS.find(x=>x.id===S.managerId) : null;
  if (!m && !S.managerId && String(S.manager?.name||'').trim()) m = MGRS.find(x=>norm(x.name)===norm(S.manager.name));
  if (!m && !String(S.manager?.name||'').trim()){ let id=''; try{ id=localStorage.getItem('kp.managerId')||''; }catch(e){} m = MGRS.find(x=>x.id===id) || MGRS.find(x=>x.id===meId()) || (MGRS.length===1 ? MGRS[0] : null); }   // нет запомненных контактов — «кто я» на этом компьютере
  if (!m && typeof AUTH!=='undefined' && AUTH.enabled && AUTH.user && !S.kpId) m = MGRS.find(x=>x.id===AUTH.user.id);      // вошёл по паролю — менеджер нового КП он сам
  if (m){ S.managerId=m.id; S.manager={...S.manager, ...mgrFields(m)}; mgrRemember(m.id); }
  try{ if (!localStorage.getItem('kp.me') && m && !S.kpId) setMe(m.id); }catch(e){}
}

function selectManager(id){
  const m=MGRS.find(x=>x.id===id); if (!m) return;
  S.managerId=m.id; S.manager={...S.manager, ...mgrFields(m)}; mgrRemember(m.id); setMe(m.id);
  renderForm(); persist(); toast('Менеджер: '+m.name);
}

function newManager(){
  S.managerId=''; S.manager={...defManager(), name:'', position:'', ext:'', mobile:'', email:'', folder:''}; mgrRemember('');
  renderForm(); persist(); setTimeout(()=>$('[data-p="manager.name"]')?.focus(), 30);
}

// дубль: другой менеджер с теми же фамилией и именем, e-mail, мобильным (последние 10 цифр) или добавочным — {m, what} или null
function mgrKeys(m){ const w=String(m.name||'').toLowerCase().replace(/ё/g,'е').replace(/\s+/g,' ').trim().split(' '), mob=String(m.mobile||'').replace(/\D/g,'').slice(-10);
  return { name:w.length>=2?w.slice(0,2).join(' '):'', email:String(m.email||'').trim().toLowerCase(), mobile:mob.length===10?mob:'', ext:String(m.ext||'').replace(/\D/g,'') }; }
function mgrDup(id, m){
  const a=mgrKeys(m), what={name:'фамилия и имя', email:'e-mail', mobile:'мобильный телефон', ext:'добавочный номер'};
  for (const o of MGRS){ if (o.id===id) continue; const b=mgrKeys(o);
    for (const f of ['name','email','mobile','ext']) if (a[f] && a[f]===b[f]) return {m:o, what:what[f]}; }
  return null;
}

// silent — без уведомлений (автосохранение и перенос из браузера)
async function saveManager(silent){
  if (!String(S.manager.name||'').trim()){ if (!silent) toast('Укажите ФИО менеджера'); return false; }
  const id=S.managerId || uid()+uid();
  const dup=mgrDup(S.managerId, S.manager), st0=$('#mgrStat');
  if (dup){
    const msg=`Такой менеджер уже есть в справочнике: ${dup.m.name} (совпадает ${dup.what}).`;
    if (st0){ st0.textContent=msg+(S.managerId?' Изменения не сохранены — исправьте или выберите его в списке.':''); st0.classList.add('warn-t'); }
    if (!S.managerId && !silent && confirm(msg+'\n\nВыбрать его вместо создания нового?')) selectManager(dup.m.id);
    else if (!silent) toast(msg);
    return false; }
  if (st0) st0.classList.remove('warn-t');
  try{ const doc=await api('/api/managers/'+id,{method:'PUT',headers:{'Content-Type':'application/json; charset=utf-8'},body:JSON.stringify(mgrFields(S.manager))});
    const k=MGRS.findIndex(x=>x.id===id); if (k>=0) MGRS[k]=doc; else MGRS.push(doc);
    MGRS.sort((a,b)=>String(a.name).localeCompare(String(b.name),'ru'));
    const wasNew=!S.managerId; S.managerId=id; mgrRemember(id); if (wasNew) setMe(id);
    if (wasNew){ persist(); if (STEP==='mgr') renderForm(); }
    const st=$('#mgrStat'); if (st) st.textContent='Сохранено в справочнике менеджеров';
    if (!silent) toast(wasNew?'Менеджер добавлен в справочник':'Сохранено');
    return true; }
  catch(e){ if (!silent) toast('Не удалось сохранить менеджера: '+(e.message||e)); return false; }
}

// выбор менеджера в разделе «Менеджер» (класс MgrBar): выбран из справочника — правки сохраняются сами; не выбран —
// подсказка, а «Сохранить в справочник» появляется, когда ФИО уже вписано (до этого сохранять нечего)
class MgrBar {
  static html(){ return `<div class="mgrbar">${this.inner()}</div>`; }

  static inner(){
    const cur=MGRS.find(x=>x.id===S.managerId), typed=!!String(S.manager.name||'').trim();
    // КП прежней версии: менеджер записан под старым кодом, а в справочнике есть с тем же ФИО — предложить взять оттуда
    const same=!cur && typed ? MGRS.find(x=>norm(x.name)===norm(S.manager.name)) : null;
    const btns = cur ? '<button class="btn" type="button" data-a="mgrNew">+ Новый менеджер</button>'
      : typed ? '<button class="btn primary" type="button" data-a="mgrSave">Сохранить в справочник</button>' : '';
    const note = cur ? '' : same ? `В справочнике есть «${esc(same.name)}» — <button class="lnk" type="button" data-a="mgrSame" data-id="${esc(same.id)}">взять контакты оттуда</button>.`
      : typed ? 'Сохраните в справочник — в следующих КП достаточно будет выбрать себя из списка.'
      : 'Выберите себя в списке — контакты подставятся. Нет в списке — заполните поля ниже и сохраните в справочник.';
    return `<label class="f"><span>Менеджер в КП</span><select id="mgrSel" aria-label="Выбор менеджера">
        ${cur?'':`<option value="" selected>${typed?esc(S.manager.name)+' — не в справочнике':'— выберите из списка —'}</option>`}
        ${MGRS.map(m=>`<option value="${esc(m.id)}"${m.id===S.managerId?' selected':''}>${esc(m.name)}${m.position?' — '+esc(m.position):''}</option>`).join('')}</select></label>
      <div class="row">${btns}</div>
      <p class="muted" id="mgrStat" style="grid-column:1/-1;margin:0">${note}</p>`;
  }

  /** ФИО вписано или стёрто у менеджера не из справочника — показать или убрать «Сохранить в справочник» */
  static refresh(){ const b=document.querySelector('.mgrbar'); if (b) morph(b, this.inner()); }
}

let mgrT=null;
// ФИО менеджера не из справочника: панель — после записи поля в S (общий обработчик ввода подключается позже)
document.addEventListener('input', e=>{ const p=e.target.dataset?.p||''; if (p==='manager.name' && !S.managerId) return void setTimeout(()=>MgrBar.refresh()); if (!p.startsWith('manager.') || !S.managerId) return;
  clearTimeout(mgrT); const st=$('#mgrStat'); if (st) st.textContent='Сохраняю…'; mgrT=setTimeout(()=>saveManager(true), 900); });

document.addEventListener('change', e=>{ if (e.target.id!=='mgrSel') return; if (e.target.value) selectManager(e.target.value); else newManager(); });
document.addEventListener('click', e=>{ const b=e.target.closest('[data-a="mgrSame"]'); if (b) selectManager(b.dataset.id); });

document.addEventListener('click', e=>{ const b=e.target.closest('[data-a]'); if (!b) return;
  if (b.dataset.a==='mgrNew') newManager(); else if (b.dataset.a==='mgrSave') saveManager(false); });
