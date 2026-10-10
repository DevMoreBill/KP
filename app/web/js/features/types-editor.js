// Категории оборудования (справочник типов): слева — список по разделам каталога, справа — форма категории.
// Параметры — таблицей с галочками (число, фильтр, на титул, основной), быстрые опции и кнопки фото — списками;
// JSON остаётся в «Для опытных». Свои категории и правки встроенных хранятся на сервере (/api/types).
'use strict';

const TY = { cur:null, id:'', dirty:false, q:'' };
const tyClone = o => JSON.parse(JSON.stringify(o));
const tyKey = s => (translit(s)||'param').replace(/-+(.)/g, (m,c)=>c.toUpperCase()).replace(/[^a-zA-Z0-9]/g,'').replace(/^\d+/,'').slice(0,30) || 'param';
const tyBuiltin = id => ((TYPES_BUILTIN&&TYPES_BUILTIN.types)||[]).find(t=>t.id===id) || null;
// правило распознавания простое (слова и «любое окончание»), если в нём нет групп, якорей и прочих знаков регулярных выражений
const tyMatchSimple = m => !/[()^$.[\]{}?+*\\]/.test(String(m||'').replace(/\\S\*|\\s\+/g,''));
const tyOpt = o => Array.isArray(o) ? [o[0]||'', o[1]||'', o[2]||''] : [o&&o.name||'', o&&o.short||'', o&&o.unit||''];

function openTypesEditor(id){
  const d=$('#dlg'); d.classList.add('wide','typesed');
  if (!d._tyBound){ d._tyBound=true; tyBind(d); }
  tyPick(id || TY.id || (TYPES[0]||{}).id);
  if (!d.open) d.showModal();       // окно — после содержимого: фокус сразу внутри окна, а не на странице за ним
}

function tyPick(id){
  if (TY.dirty && TY.cur && TY.cur.id!==id && !confirm('Изменения категории не сохранены. Перейти к другой?')) return tyRender();
  const t=TYPES.find(x=>x.id===id); TY.id=id; TY.cur=t?tyClone(t):null; TY.dirty=false;
  if (TY.cur){ TY.cur.fields=TY.cur.fields||[]; TY.cur.options=(TY.cur.options||[]).map(tyOpt); TY.cur.gallerySlots=TY.cur.gallerySlots||[]; }
  tyRender();
}

function tyRender(){
  const d=$('#dlg'); if (!d.classList.contains('typesed')) return;
  const groups=[...new Set(TYPES.map(t=>t.group||'Прочее'))], q=TY.q.trim().toLowerCase();
  const own=new Set(userTypesList().map(t=>t.id));
  const list=groups.map(g=>{ const ts=TYPES.filter(t=>(t.group||'Прочее')===g && (!q || (t.name+' '+g).toLowerCase().includes(q)));
    return ts.length ? `<div class="ty-g"><b>${esc(g)}</b>${ts.map(t=>`<button type="button" class="ty-it${t.id===TY.id?' on':''}" data-typick="${esc(t.id)}"><span>${esc(t.name)}</span>
      <small>${t.fields.length} парам.${own.has(t.id)?(tyBuiltin(t.id)?' · изменена':' · своя'):''}${t.role==='accessory'?' · комплектующие':''}</small></button>`).join('')}</div>` : ''; }).join('');
  const body = d.querySelector('.ty-form'), top = body ? body.scrollTop : 0;
  d.innerHTML=`<div class="dlg-h"><h3>Категории оборудования</h3><span class="muted ty-sub">Параметры, фильтры каталога, ключевые параметры на титуле, быстрые опции</span><button class="icon" type="button" data-tyx="close" aria-label="Закрыть">✕</button></div>
    <div class="ty-wrap"><aside class="ty-list"><input type="search" class="ty-q" placeholder="Найти категорию" value="${esc(TY.q)}" data-tyq>
      <div class="ty-ls">${list||'<p class="muted">Не найдено</p>'}</div>
      <div class="ty-acts"><button class="btn" type="button" data-tyx="new">+ Новая категория</button>${TY.cur?'<button class="btn ghost" type="button" data-tyx="copy">Копия выбранной</button>':''}
      ${ADMIN.on&&userTypesList().length?'<button class="btn ghost danger" type="button" data-tyx="resetall">Вернуть все стандартные</button>':''}</div></aside>
    <div class="ty-form">${TY.cur?tyFormHTML(TY.cur):'<p class="muted">Выберите категорию слева.</p>'}</div></div>
    ${TY.cur?`<div class="ty-foot"><span class="${TY.dirty?'warn':'muted'}" id="tyState">${TY.dirty?'Есть несохранённые изменения':'Изменений нет'}</span><span class="sp"></span>
      ${TY.dirty?'<button class="btn ghost" type="button" data-tyx="undo">Отменить изменения</button>':''}
      ${ADMIN.on&&TY.cur.id&&TYPES.some(t=>t.id===TY.cur.id)&&!tyBuiltin(TY.cur.id)?'<button class="btn ghost danger" type="button" data-tyx="del">Удалить категорию</button>':''}
      ${ADMIN.on&&tyBuiltin(TY.cur.id)&&own.has(TY.cur.id)?'<button class="btn ghost" type="button" data-tyx="factory">Вернуть стандартную</button>':''}
      <button class="btn primary" type="button" data-tyx="save">Сохранить категорию</button></div>`:''}`;
  const nb=d.querySelector('.ty-form'); if (nb) nb.scrollTop=top;
}

function tyFormHTML(t){
  const groups=[...new Set(TYPES.map(x=>x.group||'Прочее'))], fgroups=[...new Set(TYPES.flatMap(x=>x.fields.map(f=>f.group).filter(Boolean)))];
  const inp=(path, val, o={})=>`<input type="text" data-ty="${path}" value="${esc(val??'')}"${o.ph?` placeholder="${esc(o.ph)}"`:''}${o.list?` list="${o.list}"`:''}>`;
  const lbl=(t1, html, hint)=>`<label class="ty-f"><span>${t1}</span>${html}${hint?`<small class="muted">${hint}</small>`:''}</label>`;
  const fieldRow=(f,i)=>`<tr data-tyrow="${i}">
      <td class="ty-mv"><button class="icon" type="button" data-tyfmv="-1" data-i="${i}" ${i?'':'disabled'} title="Выше">↑</button><button class="icon" type="button" data-tyfmv="1" data-i="${i}" ${i<t.fields.length-1?'':'disabled'} title="Ниже">↓</button></td>
      <td>${inp(`fields.${i}.label`, f.label, {ph:'Например, Мощность'})}<small class="muted ty-key" title="Код параметра в базе (латиницей)">${esc(f.key||'')}</small></td>
      <td>${inp(`fields.${i}.unit`, f.unit, {ph:'—'})}</td>
      <td>${inp(`fields.${i}.group`, f.group, {ph:'Основные', list:'tyFG'})}</td>
      <td class="c"><input type="checkbox" data-tyb="fields.${i}.num" ${f.num?'checked':''} title="Числовое значение (можно сравнивать, фильтр «от–до»)"></td>
      <td class="c"><input type="checkbox" data-tyfilter="${i}" ${f.facet||f.range?'checked':''} title="Фильтр в каталоге: для чисел — «от–до», для текста — список значений"></td>
      <td class="c"><input type="checkbox" data-tyb="fields.${i}.kpi" ${f.kpi?'checked':''} title="Ключевой параметр: крупно на титуле КП и в карточке"></td>
      <td class="c"><input type="radio" name="tymain" data-tymain="${esc(f.key||'')}" ${t.main===f.key?'checked':''} title="Основной параметр: по нему сортируется и подписывается оборудование"></td>
      <td>${inp(`fields.${i}.values`, (f.values||[]).join(', '), {ph:'варианты через запятую'})}</td>
      <td><button class="icon" type="button" data-tyfdel="${i}" title="Удалить параметр">✕</button></td></tr>`;
  return `<datalist id="tyGroups">${groups.map(g=>`<option value="${esc(g)}">`).join('')}</datalist><datalist id="tyFG">${fgroups.map(g=>`<option value="${esc(g)}">`).join('')}</datalist>
    <section class="ty-sec"><h4>Основное</h4><div class="ty-grid">
      ${lbl('Название категории', inp('name', t.name, {ph:'Винтовые компрессоры'}), 'Так категория называется в каталоге и фильтрах')}
      ${lbl('Раздел каталога', inp('group', t.group, {ph:'Компрессоры', list:'tyGroups'}), 'Категории одного раздела стоят рядом')}
      ${lbl('Одна позиция называется', inp('item', t.item, {ph:'Винтовой компрессор'}), 'В единственном числе — для подписей и карточки')}
      ${lbl('Заголовок на титуле КП', inp('coverTitle', t.coverTitle, {ph:'Винтовые компрессоры'}), 'Крупная строка над моделью на первой странице')}
      ${tyMatchSimple(t.match) ? lbl('Слова для распознавания', inp('match', String(t.match||'').split('|').filter(Boolean).map(x=>x.replace(/\\S\*/g,'*').replace(/\\s\+?/g,' ')).join(', '), {ph:'винтов*, компрессор'}), 'Через запятую; * — любое окончание («винтов* компрессор»). По ним позиция сама попадает в эту категорию по названию') : lbl('Правило распознавания', inp('matchRe', t.match), 'Регулярное выражение (без учёта регистра): по нему позиция сама попадает в эту категорию по названию')}
      <div class="ty-f"><span>Что это</span><span class="ty-seg">${[['equipment','Оборудование'],['accessory','Комплектующие и опции']].map(([v,l])=>`<button type="button" data-tyrole="${v}" class="${(t.role||'equipment')===v?'on':''}">${l}</button>`).join('')}</span><small class="muted">Комплектующие не выводятся отдельной страницей и титулом</small></div>
    </div>${TYPES.some(x=>x.id===t.id)?`<p class="muted ty-id">Код категории: <code>${esc(t.id)}</code></p>`:''}</section>
    <section class="ty-sec"><h4>Параметры <small class="muted">— характеристики оборудования этой категории</small></h4>
      <div class="ty-tw"><table class="ty-t"><thead><tr><th></th><th>Параметр</th><th>Ед.</th><th>Группа в таблице</th><th title="Числовое значение">Число</th><th title="Фильтр в каталоге">Фильтр</th><th title="Ключевой параметр на титуле">На титул</th><th title="Основной параметр">Основной</th><th>Варианты значений</th><th></th></tr></thead>
      <tbody>${t.fields.map(fieldRow).join('')}</tbody></table></div>
      <button class="btn ghost" type="button" data-tyx="addf">+ Параметр</button>
      <p class="muted ty-hint"><b>Число</b> — значение можно сравнивать (мощность, давление). <b>Фильтр</b> — по параметру можно отбирать в каталоге. <b>На титул</b> — показывается крупно на титуле КП. <b>Основной</b> — главный параметр категории.</p></section>
    <section class="ty-sec"><h4>Быстрые опции <small class="muted">— добавляются к позиции одной кнопкой</small></h4>
      ${t.options.map((o,i)=>`<div class="ty-opt">${inp(`options.${i}.0`, o[0], {ph:'Полное название, как в КП'})}${inp(`options.${i}.1`, o[1], {ph:'Коротко'})}
        <select data-ty="options.${i}.2"><option value=""${!o[2]?' selected':''}>шт.</option><option value="усл."${o[2]==='усл.'?' selected':''}>услуга</option></select>
        <button class="icon" type="button" data-tyodel="${i}" title="Удалить">✕</button></div>`).join('')||'<p class="muted">Нет быстрых опций.</p>'}
      <button class="btn ghost" type="button" data-tyx="addo">+ Опция</button></section>
    <section class="ty-sec"><h4>Кнопки фото <small class="muted">— быстрые подписи дополнительных изображений в карточке</small></h4>
      ${lbl('', inp('gallerySlots', t.gallerySlots.join(', '), {ph:'Контроллер, Двигатель, Габаритный чертёж'}), 'Через запятую. Изображения со словами «схема», «чертёж» выводятся на всю ширину страницы.')}</section>
    <details class="ty-sec ty-json"><summary>Для опытных: категория в формате JSON</summary>
      <textarea rows="14" spellcheck="false" data-tyjson>${esc(JSON.stringify(tyOut(t), null, 2))}</textarea>
      <div class="row"><button class="btn ghost" type="button" data-tyx="json">Применить JSON</button><span class="muted" id="tyErr"></span></div></details>`;
}

// категория для сохранения: опции — массивы, ключи параметров — латиницей и без повторов
function tyOut(t){
  const o=tyClone(t), used=new Set();
  o.fields=(o.fields||[]).filter(f=>String(f.label||'').trim()).map(f=>{ let k=f.key||tyKey(f.label), base=k, n=1; while (used.has(k)) k=base+(++n); used.add(k); f.key=k;
    delete f._new; for (const b of ['num','range','facet','kpi']) if (!f[b]) delete f[b];
    if (!f.unit) delete f.unit; if (!f.values || !f.values.length) delete f.values; return f; });
  o.options=(o.options||[]).map(tyOpt).filter(x=>x[0].trim()).map(x=>x[2]?x:[x[0],x[1]]);
  if (!o.fields.some(f=>f.key===o.main)) o.main=(o.fields[0]||{}).key||'';
  return o;
}

function tyMark(){ TY.dirty=true; const s=$('#tyState'); if (s){ s.textContent='Есть несохранённые изменения'; s.className='warn'; } }

async function tySaveList(list, note){
  await api('/api/types',{method:'PUT',headers:{'Content-Type':'application/json; charset=utf-8'},body:JSON.stringify({version:1,types:list})});
  await loadTypes(); catCache.forEach(x=>delete x._a); renderForm(); TY.dirty=false;
  if (typeof cwRedraw==='function' && $('#catdlg')?.open) cwRedraw();      // открыт каталог — категории и фильтры обновляются сразу toast(note||'Справочник категорий сохранён');
}

function tyBind(d){
  d.addEventListener('input', e=>{ if (!d.classList.contains('typesed')) return; const el=e.target;
    if (el.dataset.tyq!=null){ TY.q=el.value; const pos=el.selectionStart; tyRender(); const q=d.querySelector('[data-tyq]'); q.focus(); q.setSelectionRange(pos,pos); return; }
    if (!TY.cur) return;
    const p=el.dataset.ty; if (!p) return;
    let v=el.value;
    if (p==='match') v=v.split(',').map(x=>x.trim().replace(/[.+?^${}()|[\]\\]/g,'\\$&').replace(/\*/g,'\\S*').replace(/ +/g,'\\s+')).filter(Boolean).join('|');
    if (p==='matchRe'){ try{ new RegExp(v,'i'); el.classList.remove('bad'); }catch(_){ el.classList.add('bad'); return; } setPath(TY.cur, 'match', v); return tyMark(); }
    if (p==='gallerySlots') v=v.split(',').map(x=>x.trim()).filter(Boolean);
    if (/^fields\.\d+\.values$/.test(p)) v=v.split(',').map(x=>x.trim()).filter(Boolean);
    setPath(TY.cur, p, v);
    const m=/^fields\.(\d+)\.label$/.exec(p); if (m){ const f=TY.cur.fields[+m[1]]; if (f._new){ f.key=tyKey(v); const k=el.closest('td').querySelector('.ty-key'); if (k) k.textContent=f.key; } }
    tyMark(); });
  d.addEventListener('change', e=>{ if (!d.classList.contains('typesed') || !TY.cur) return; const el=e.target;
    if (el.dataset.tyb){ setPath(TY.cur, el.dataset.tyb, el.checked);
      const m=/^fields\.(\d+)\.num$/.exec(el.dataset.tyb); if (m){ const f=TY.cur.fields[+m[1]]; if (f.facet||f.range){ f.range=!!el.checked; f.facet=!el.checked; } }
      return tyMark(); }
    if (el.dataset.tyfilter!=null){ const f=TY.cur.fields[+el.dataset.tyfilter]; f.range=el.checked&&!!f.num; f.facet=el.checked&&!f.num; return tyMark(); }
    if (el.dataset.tymain!=null){ TY.cur.main=el.dataset.tymain; return tyMark(); }
    if (el.tagName==='SELECT' && el.dataset.ty){ setPath(TY.cur, el.dataset.ty, el.value); return tyMark(); } });
  d.addEventListener('click', async e=>{ if (!d.classList.contains('typesed')) return; const b=e.target.closest('button'); if (!b) return;
    try{
      if (b.dataset.typick) return tyPick(b.dataset.typick);
      if (b.dataset.tyrole){ TY.cur.role=b.dataset.tyrole; tyMark(); return tyRender(); }
      if (b.dataset.tyfmv){ const i=+b.dataset.i, j=i+(+b.dataset.tyfmv), a=TY.cur.fields; [a[i],a[j]]=[a[j],a[i]]; tyMark(); return tyRender(); }
      if (b.dataset.tyfdel!=null){ const f=TY.cur.fields[+b.dataset.tyfdel]; if (f.label && !confirm(`Удалить параметр «${f.label}»? Значения у позиций каталога останутся, но не будут показываться.`)) return; TY.cur.fields.splice(+b.dataset.tyfdel,1); tyMark(); return tyRender(); }
      if (b.dataset.tyodel!=null){ TY.cur.options.splice(+b.dataset.tyodel,1); tyMark(); return tyRender(); }
      const a=b.dataset.tyx; if (!a) return;
      if (a==='close'){ if (TY.dirty && !confirm('Закрыть без сохранения изменений категории?')) return; TY.dirty=false; d.close(); d.classList.remove('wide','typesed'); return; }
      if (a==='addf'){ TY.cur.fields.push({key:'', label:'', group:'Основные', _new:true}); tyMark(); tyRender(); const r=d.querySelectorAll('.ty-t tbody tr'); r[r.length-1]?.querySelector('input')?.focus(); return; }
      if (a==='addo'){ TY.cur.options.push(['','','']); tyMark(); tyRender(); const r=d.querySelectorAll('.ty-opt'); r[r.length-1]?.querySelector('input')?.focus(); return; }
      if (a==='undo'){ TY.dirty=false; return tyPick(TY.id); }
      if (a==='new' || a==='copy'){
        if (TY.dirty && !confirm('Изменения текущей категории не сохранены. Продолжить?')) return;
        const base = a==='copy' && TY.cur ? tyClone(TY.cur) : {group:(TY.cur&&TY.cur.group)||'Прочее', name:'', item:'', coverTitle:'', role:'equipment', main:'', match:'', fields:[{key:'', label:'', group:'Основные', _new:true}], options:[], gallerySlots:[]};
        if (a==='copy'){ base.name=(base.name||'')+' (копия)'; }
        base.id=''; TY.cur=base; TY.id=''; TY.dirty=true; tyRender(); d.querySelector('[data-ty="name"]')?.focus(); return; }
      if (a==='json'){ let j; try{ j=JSON.parse(d.querySelector('[data-tyjson]').value); }catch(err){ $('#tyErr').textContent='Ошибка в JSON: '+err.message; return; }
        j.options=(j.options||[]).map(tyOpt); j.fields=j.fields||[]; j.gallerySlots=j.gallerySlots||[]; TY.cur=j; tyMark(); return tyRender(); }
      if (a==='save'){
        const t=tyOut(TY.cur); t.name=String(t.name||'').trim();
        if (!t.name) return toast('Укажите название категории');
        if (!t.fields.length) return toast('Добавьте хотя бы один параметр');
        t.group=String(t.group||'').trim()||'Прочее'; t.item=t.item||t.name; t.coverTitle=t.coverTitle||t.name;
        if (!t.id){ let id=(translit(t.name)||'type').replace(/-/g,'_').replace(/^[^a-z]+/,'').slice(0,28)||'type', n=1; const base=id; while (TYPES.some(x=>x.id===id)) id=base+'_'+(++n); t.id=id; }
        if (!/^[a-z][a-z0-9_]{1,30}$/.test(t.id)) return toast('Код категории — латиница, цифры и «_»');
        if (!t.folder) t.folder=t.id.replace(/_/g,'-');
        const list=userTypesList().filter(x=>x.id!==t.id); list.push(t);
        TY.id=t.id; await tySaveList(list, `Категория «${t.name}» сохранена`); return tyPick(t.id); }
      if (a==='del'){ if (!confirm(`Удалить категорию «${TY.cur.name}»? Позиции этой категории останутся в каталоге как «Прочее».`)) return;
        await tySaveList(userTypesList().filter(x=>x.id!==TY.cur.id), 'Категория удалена'); TY.id=''; return tyPick((TYPES[0]||{}).id); }
      if (a==='factory'){ if (!confirm('Вернуть стандартный вариант этой категории? Ваши правки категории пропадут.')) return;
        await tySaveList(userTypesList().filter(x=>x.id!==TY.cur.id), 'Стандартная категория восстановлена'); return tyPick(TY.cur.id); }
      if (a==='resetall'){ if (!confirm('Удалить все свои категории и изменения и вернуть стандартные?')) return; await tySaveList([], 'Стандартные категории восстановлены'); return tyPick((TYPES[0]||{}).id); }
    }catch(err){ toast('Не сохранено: '+(err.message||err)); }
  });
  d.addEventListener('cancel', e=>{ if (!d.classList.contains('typesed')) return; if (TY.dirty && !confirm('Закрыть без сохранения изменений категории?')){ e.preventDefault(); return; } TY.dirty=false; d.classList.remove('wide','typesed'); });
}
