// Редактор справочника типов оборудования.
'use strict';

function openTypesEditor(){
  const d=$('#dlg'); d.classList.add('wide');
  d.innerHTML=`<div class="dlg-h"><h3>Типы оборудования</h3><button class="icon" type="button" data-close aria-label="Закрыть">✕</button></div>
   <div class="dlg-b"><p class="muted" style="margin-top:0">Тип задаёт, какие параметры есть у оборудования, по каким из них работают фильтры каталога, что выводится на титуле и какие опции предлагаются. Добавить новый тип можно без программирования: нажмите «+ Новый тип» и поправьте поля по образцу.</p>
   <div class="tlist">${TYPES.map(t=>`<div class="trow"><b>${esc(t.name)}</b><span class="muted">${esc(t.group||'')} · ${t.fields.length} параметров · основной: ${esc((t.fields.find(f=>f.key===t.main)||{}).label||t.main||'—')}</span>
     <button class="btn ghost" type="button" data-tedit="${esc(t.id)}">Изменить</button></div>`).join('')}</div>
   <div class="row" style="margin-top:12px"><button class="btn" type="button" id="tNew">+ Новый тип</button><span style="flex:1"></span>${ADMIN.on?'<button class="btn ghost danger" type="button" id="tReset">Вернуть стандартные типы</button>':''}</div>
   <div id="tEd"></div></div>`;
  d.showModal(); d.querySelector('[data-close]').onclick=()=>{ d.close(); d.classList.remove('wide'); };
  const save=async(list)=>{
    const payload={version:1,types:list};
    await api('/api/types',{method:'PUT',headers:{'Content-Type':'application/json; charset=utf-8'},body:JSON.stringify(payload)});
    await loadTypes(); catCache.forEach(x=>delete x._a); renderForm(); openTypesEditor(); toast('Справочник типов сохранён'); };
  const edit=(t)=>{
    $('#tEd').innerHTML=`<p class="sub" style="margin-top:16px">${esc(t.name||'Новый тип')}</p>
      <p class="muted">Формат JSON. <b>fields</b> — параметры: key (латиницей), label, unit, num (число), range (фильтр «от–до»), facet (фильтр-список), values (варианты), kpi (на титул), group (группа в таблице характеристик). <b>options</b> — быстрые опции: [«полное название», «кнопка», «шт. или усл.»].</p>
      <textarea id="tJson" rows="18" spellcheck="false" style="font-family:ui-monospace,Consolas,monospace;font-size:13px">${esc(JSON.stringify(t,null,2))}</textarea>
      <div class="row" style="margin-top:8px"><button class="btn primary" type="button" id="tSave">Сохранить тип</button>${ADMIN.on&&t.id&&!((TYPES_BUILTIN&&TYPES_BUILTIN.types)||[]).some(b=>b.id===t.id)?'<button class="btn ghost" type="button" id="tDel">Удалить тип</button>':''}<span class="muted" id="tErr"></span></div>`;
    $('#tSave').onclick=async()=>{ let j; try{ j=JSON.parse($('#tJson').value); }catch(e){ $('#tErr').textContent='Ошибка в JSON: '+e.message; return; }
      if (!/^[a-z][a-z0-9_]{1,30}$/.test(j.id||'')) { $('#tErr').textContent='id — латиница, цифры и «_», начинается с буквы'; return; }
      if (!j.name || !Array.isArray(j.fields)) { $('#tErr').textContent='Нужны поля name и fields'; return; }
      if (j.fields.some(f=>!f.key||!f.label)) { $('#tErr').textContent='У каждого параметра нужны key и label'; return; }
      const list=userTypesList().filter(x=>x.id!==j.id); list.push(j); await save(list); };
    const del=$('#tDel'); if (del) del.onclick=async()=>{ if(!confirm('Удалить тип? Позиции этого типа останутся в каталоге как «Прочее».')) return; await save(userTypesList().filter(x=>x.id!==t.id)); };
    $('#tJson').focus(); };
  d.querySelector('.tlist').onclick=e=>{ const b=e.target.closest('[data-tedit]'); if(b) edit(typeById(b.dataset.tedit)); };
  $('#tNew').onclick=()=>edit({id:'new_type',group:'Компрессоры',name:'Новый тип',item:'Оборудование',coverTitle:'Оборудование',role:'equipment',main:'kw',match:'',
     fields:[{key:'kw',label:'Мощность',unit:'кВт',num:true,range:true,kpi:true,group:'Основные'}],options:[['Доставка до объекта','доставка','усл.']]});
  if ($('#tReset')) $('#tReset').onclick=async()=>{ if(!confirm('Удалить все свои изменения типов и вернуть стандартные?')) return; await save([]); };
}
