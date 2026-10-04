// «Настройки → Справочники и данные»: правка и добавление менеджеров, клиентов и поставщиков прямо в списке (без отдельных окон).
// Поставщик: условия поставки, реквизиты (по ИНН — DaData / ФНС), склады с точным адресом (подсказки и координаты — js/ui/geo-input.js),
// режимом работы и контактами, контактные лица и оборудование (производители и позиции каталога, которые покупаются у него).
// Склады поставщика подставляются в «Экономике сделки» → «Логистика» → «Откуда».
'use strict';

const ST_ED_FIELDS = {
  manager: [['Контакты менеджера', [['name','ФИО',{req:1}],['position','Должность'],['phone','Телефон'],['ext','Добавочный'],['mobile','Мобильный'],['email','E-mail'],['site','Сайт'],['address','Адрес',{wide:1}],['hours','Часы работы']]]],
  client: [['Реквизиты', [['inn','ИНН',{inn:1}],['name','Краткое наименование',{req:1}],['full','Полное наименование',{wide:1}],['kpp','КПП'],['ogrn','ОГРН'],['status','Статус'],['address','Юридический адрес',{wide:1, geo:1}],['director','Руководитель'],['directorPost','Должность руководителя']]],
    ['Контактное лицо', [['contacts.0.name','ФИО'],['contacts.0.post','Должность'],['contacts.0.phone','Телефон'],['contacts.0.email','E-mail']]]],
  supplier: [['Поставщик и условия поставки', [['name','Название',{req:1}],['country','Страна'],['cur','Валюта (RUB, USD, EUR, CNY)'],['adv','Аванс поставщику, %'],['prod','Срок изготовления, дней'],['ship','Срок доставки, дней'],['ins','Страхование, %'],['fx','Комиссия за перевод, %']]],
    ['Реквизиты', [['req.inn','ИНН',{inn:1}],['req.kpp','КПП'],['req.ogrn','ОГРН'],['req.full','Полное наименование',{wide:1}],['req.address','Юридический адрес',{wide:1, geo:1}],['req.director','Руководитель'],['req.directorPost','Должность руководителя'],
      ['req.bank','Банк'],['req.bik','БИК'],['req.account','Расчётный счёт'],['req.corr','Корр. счёт'],['req.phone','Телефон'],['req.email','E-mail'],['req.site','Сайт']]]],
};
const ST_WH = [['name','Склад'],['addr','Адрес склада',{wide:1, geo:1}],['hours','Режим работы'],['contact','Контакт на складе'],['phone','Телефон'],['note','Примечание (въезд, погрузка)',{wide:1}]];
const ST_CT = [['name','ФИО'],['post','Должность'],['phone','Телефон'],['email','E-mail']];
const ST_NEW = { manager:'Новый менеджер', client:'Новый клиент', supplier:'Новый поставщик' };

const stGet = (o, p) => p.split('.').reduce((a,k)=>a==null?a:a[k], o);
function stSet(o, p, v){ const ks=p.split('.'); let a=o; ks.slice(0,-1).forEach((k,i)=>{ if (a[k]==null) a[k]=/^\d+$/.test(ks[i+1])?[]:{}; a=a[k]; }); a[ks[ks.length-1]]=v; }

// открыть редактор: id — запись из списка, null — новая
async function stEdOpen(type, id){
  let src={};
  if (id){
    src = type==='manager' ? (await api('/api/managers')).find(x=>x.id===id) : type==='client' ? await api('/api/clients/'+encodeURIComponent(id)) : (await api('/api/suppliers')).find(x=>x.id===id);
    if (!src) throw new Error('Запись не найдена');
  }
  const doc=JSON.parse(JSON.stringify(src||{}));
  if (type==='supplier'){ doc.req=doc.req||{}; doc.warehouses=doc.warehouses||[]; doc.contacts=doc.contacts||[]; doc.makers=doc.makers||[]; doc.items=doc.items||[];
    if (!doc.warehouses.length && doc.wh) doc.warehouses=[{name:'Основной склад', addr:doc.wh, ...(doc.whGeo&&doc.whGeo.value===doc.wh?{lat:doc.whGeo.lat, lon:doc.whGeo.lon, city:doc.whGeo.city}:{})}]; }
  ST.ed={type, id:id||null, doc, msg:''};
}

function stEdField(doc, [p, label, o={}], pre=''){
  const path=pre+p, v=stGet(doc, path)??'';
  return `<label class="f${o.wide?' wide':''}"><span>${esc(label)}${o.req?' <b class="bad-t">*</b>':''}</span>${o.inn
    ? `<span class="st-inn"><input type="text" inputmode="numeric" data-ef="${path}" value="${esc(v)}" autocomplete="off"><button class="btn ghost sm" type="button" data-edx="inn" data-p="${path}" title="Заполнить реквизиты по ИНН (DaData / ФНС)">Заполнить по ИНН</button></span>`
    : `<input type="text" data-ef="${path}" value="${esc(v)}"${o.geo?` data-geo="sted" placeholder="адрес — выберите из подсказок или вставьте координаты"`:''} autocomplete="off">`}</label>`;
}

function stEdHtml(){
  const E=ST.ed, d=E.doc, t=E.type;
  const secs=ST_ED_FIELDS[t].map(([h,fs])=>`<div class="st-ed-sec"><p class="sub">${esc(h)}</p><div class="st-ed-g">${fs.map(f=>stEdField(d,f)).join('')}</div></div>`).join('');
  let extra='';
  if (t==='supplier'){
    const whs=d.warehouses.map((w,i)=>`<div class="st-ed-item"><div class="st-ed-ih"><b>${esc(w.name||'Склад '+(i+1))}</b>${w.lat!=null?'<span class="geo-ok">точный адрес ✓</span>':w.addr?'<span class="muted">адрес без координат — выберите из подсказок</span>':''}<span class="sp"></span><button class="btn ghost sm" type="button" data-edx="del" data-l="warehouses" data-i="${i}">Удалить</button></div>
      <div class="st-ed-g">${ST_WH.map(f=>stEdField(d,f,`warehouses.${i}.`)).join('')}</div></div>`).join('');
    const cts=d.contacts.map((c,i)=>`<div class="st-ed-item"><div class="st-ed-g c4">${ST_CT.map(f=>stEdField(d,f,`contacts.${i}.`)).join('')}<button class="btn ghost sm st-ed-x" type="button" data-edx="del" data-l="contacts" data-i="${i}" aria-label="Удалить контакт">✕</button></div></div>`).join('');
    const mk=[...new Set(catCache.map(x=>attrsOf(x).maker).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'ru'));
    const byMk=catCache.filter(x=>d.makers.some(m=>dlNormSt(m)===dlNormSt(attrsOf(x).maker)));
    const its=d.items.map(id=>catCache.find(x=>x.id===id)||{id, name:id+' (нет в каталоге)'});
    extra=`<div class="st-ed-sec"><div class="sub">Склады — адрес отгрузки${tip('Склады подставляются в «Экономике сделки» → «Логистика» → «Откуда — склад поставщика». Выберите адрес из подсказок (DaData или OpenStreetMap) или вставьте координаты / ссылку на точку из Google или Яндекс Карт — расстояние посчитается по дорогам.')}</div>
        ${whs||'<p class="muted">Складов нет.</p>'}<button class="btn ghost" type="button" data-edx="add" data-l="warehouses">+ Склад</button></div>
      <div class="st-ed-sec"><p class="sub">Контактные лица</p>${cts||'<p class="muted">Контактов нет.</p>'}<button class="btn ghost" type="button" data-edx="add" data-l="contacts">+ Контакт</button></div>
      <div class="st-ed-sec"><div class="sub">Оборудование у этого поставщика${tip('По производителям и позициям «Экономика сделки» сама относит позиции КП к этому поставщику и подставляет его условия и склад.')}</div>
        <div class="st-chips">${d.makers.map((m,i)=>`<span class="chip">${esc(m)}<button type="button" data-edx="del" data-l="makers" data-i="${i}" aria-label="Убрать">✕</button></span>`).join('')||'<span class="muted">Производители не указаны</span>'}</div>
        <div class="row st-ed-add"><input type="text" id="stEdMk" list="stEdMkL" placeholder="Производитель (бренд)" autocomplete="off"><datalist id="stEdMkL">${mk.map(x=>`<option value="${esc(x)}">`).join('')}</datalist><button class="btn ghost" type="button" data-edx="mk">Добавить производителя</button></div>
        ${byMk.length?`<p class="muted">В каталоге у этих производителей: ${byMk.length} ${plural(byMk.length,'позиция','позиции','позиций')}.</p>`:''}
        <div class="st-chips">${its.map((x,i)=>`<span class="chip">${esc(x.name)}<button type="button" data-edx="del" data-l="items" data-i="${i}" aria-label="Убрать">✕</button></span>`).join('')}</div>
        <div class="row st-ed-add"><input type="text" id="stEdIt" list="stEdItL" placeholder="Позиция каталога (если покупаете не всё у производителя)" autocomplete="off"><datalist id="stEdItL">${catCache.map(x=>`<option value="${esc(x.name)}">`).join('')}</datalist><button class="btn ghost" type="button" data-edx="it">Добавить позицию</button></div></div>`;
  }
  return `<div class="st-ed-h"><b>${E.id?esc(({manager:'Менеджер',client:'Клиент',supplier:'Поставщик'})[t]+': '+(d.name||'')):ST_NEW[t]}</b><span class="sp"></span>
      <button class="btn" type="button" data-edx="cancel">Отмена</button><button class="btn primary" type="button" data-edx="save">Сохранить</button></div>
    ${E.msg?`<p class="msg err">${esc(E.msg)}</p>`:''}${secs}${extra}
    <div class="st-ed-f"><span class="sp"></span><button class="btn" type="button" data-edx="cancel">Отмена</button><button class="btn primary" type="button" data-edx="save">Сохранить</button></div>`;
}
const dlNormSt = s => String(s||'').toLowerCase().replace(/ё/g,'е').replace(/[^a-zа-я0-9]+/g,'');

function stEdDraw(box){ box.innerHTML=stEdHtml(); }

// события редактора — на его контейнере .st-ed (новый при каждой отрисовке списка)
function stEdBind(m, after){
  const box=()=>m;
  m.addEventListener('input', e=>{ const t=e.target; if (!ST.ed || !t.dataset.ef) return; stSet(ST.ed.doc, t.dataset.ef, t.value);
    const w=t.dataset.ef.match(/^warehouses\.(\d+)\.addr$/); if (w){ const x=ST.ed.doc.warehouses[+w[1]]; if (x.geoFor!==t.value){ delete x.lat; delete x.lon; } } });
  m.addEventListener('geo:pick', e=>{ const t=e.target; if (!ST.ed || !t.dataset.ef) return; const g=e.detail; stSet(ST.ed.doc, t.dataset.ef, g.value);
    const w=t.dataset.ef.match(/^warehouses\.(\d+)\.addr$/);
    if (w){ Object.assign(ST.ed.doc.warehouses[+w[1]], {lat:g.lat, lon:g.lon, city:g.city, geoFor:g.value}); stEdDraw(box()); } });
  m.addEventListener('keydown', e=>{ if (e.key!=='Enter' || !ST.ed) return; if (e.target.id==='stEdMk'){ e.preventDefault(); box().querySelector('[data-edx=mk]').click(); } if (e.target.id==='stEdIt'){ e.preventDefault(); box().querySelector('[data-edx=it]').click(); } });
  m.addEventListener('click', async e=>{ const b=e.target.closest('[data-edx]'); if (!b || !ST.ed) return; e.preventDefault(); const E=ST.ed, d=E.doc, a=b.dataset.edx;
    if (a==='cancel'){ ST.ed=null; return after(); }
    if (a==='add'){ d[b.dataset.l].push(b.dataset.l==='warehouses'?{name:d.warehouses.length?'':'Основной склад'}:{}); stEdDraw(box());
      const last=[...box().querySelectorAll(`[data-ef^="${b.dataset.l}.${d[b.dataset.l].length-1}."]`)][b.dataset.l==='warehouses'?1:0]; last?.focus(); return; }
    if (a==='del'){ d[b.dataset.l].splice(+b.dataset.i,1); return stEdDraw(box()); }
    if (a==='mk'){ const v=$('#stEdMk').value.trim(); if (!v) return; if (!d.makers.some(x=>dlNormSt(x)===dlNormSt(v))) d.makers.push(v); stEdDraw(box()); $('#stEdMk')?.focus(); return; }
    if (a==='it'){ const v=$('#stEdIt').value.trim(); const x=catCache.find(c=>c.name===v)||catCache.find(c=>dlNormSt(c.name)===dlNormSt(v)); if (!x) return toast('Такой позиции нет в каталоге');
      if (!d.items.includes(x.id)) d.items.push(x.id); stEdDraw(box()); $('#stEdIt')?.focus(); return; }
    if (a==='inn'){ const p=b.dataset.p, inn=String(stGet(d,p)||'').replace(/\D/g,''); if (!validInn(inn)) return toast('Проверьте ИНН: 10 цифр у организации, 12 — у ИП');
      b.disabled=true; b.textContent='Ищу…';
      try{ const r=await api('/api/party?inn='+inn); if (r.error) throw new Error(r.error);
        const pre=p.startsWith('req.')?'req.':'', put=(k,v)=>{ if (v) stSet(d, pre+k, v); };
        put('inn',r.inn); put('kpp',r.kpp); put('ogrn',r.ogrn); put('full',r.full); put('address',r.address); put('director',r.director); put('directorPost',r.directorPost);
        if (pre){ put('phone',(r.phones||[])[0]); put('email',(r.emails||[])[0]); put('site',r.site); if (!String(d.name||'').trim()) d.name=r.short; if (!d.country) d.country='Россия'; }
        else { d.name=d.name||r.short; put('status',r.status); }
        toast('Реквизиты заполнены: '+(r.source||'реестр')); }
      catch(err){ toast('Не нашли: '+(err.message||err)); }
      return stEdDraw(box()); }
    if (a==='save'){
      if (!String(d.name||'').trim()){ E.msg=t2(E.type)+': заполните название'; return stEdDraw(box()); }
      try{ await stEdSave(E); ST.ed=null; toast('Сохранено'); after(); }
      catch(err){ E.msg='Не сохранено: '+(err.message||err); stEdDraw(box()); } } });
}
const t2 = t => ({manager:'Менеджер',client:'Клиент',supplier:'Поставщик'})[t];

async function stEdSave(E){
  const J={'Content-Type':'application/json; charset=utf-8'}, d=JSON.parse(JSON.stringify(E.doc)), rev=d._rev;
  for (const k of Object.keys(d)) if (typeof d[k]==='string') d[k]=d[k].trim();
  if (E.type==='manager'){ const id=E.id||uid()+uid();
    await api('/api/managers/'+encodeURIComponent(id),{method:'PUT',headers:{...J,...(rev!=null?{'X-KP-Rev':String(rev)}:{})},body:JSON.stringify(Object.fromEntries(MGR_KEYS.map(k=>[k,d[k]??''])))});
    loadManagers().then(renderForm); return; }
  if (E.type==='client'){
    const inn=String(d.inn||'').replace(/\D/g,''), id=E.id || (inn?'inn'+inn:'c'+Date.now().toString(36));
    if (!E.id && inn && await clientById('inn'+inn).catch(()=>null)) throw new Error('клиент с ИНН '+inn+' уже есть в справочнике — найдите его поиском');
    d.contacts=(d.contacts||[]).filter(c=>c && Object.values(c).some(v=>String(v||'').trim())); delete d._rev; d.id=id; d.source=d.source||'Настройки';
    const saved=await api('/api/clients/'+encodeURIComponent(id),{method:'PUT',headers:J,body:JSON.stringify(d)}); if (typeof clientsKeep==='function' && saved) clientsKeep([saved]); return; }
  // поставщик: склад по умолчанию — первый, с координатами — в «Откуда» логистики
  const id=E.id||('sup_'+uid()+uid()).slice(0,24);
  d.warehouses=(d.warehouses||[]).filter(w=>Object.values(w).some(v=>String(v??'').trim())).map(w=>{ const o={...w}; delete o.geoFor; return o; });
  d.contacts=(d.contacts||[]).filter(c=>Object.values(c).some(v=>String(v||'').trim()));
  const w0=d.warehouses.find(w=>w.addr);
  if (w0){ d.wh=w0.addr; d.whGeo=w0.lat!=null?{value:w0.addr, lat:w0.lat, lon:w0.lon, city:w0.city||'', exact:true, src:'справочник поставщиков'}:null; }
  delete d.id; delete d.updatedAt;
  await api('/api/suppliers/'+encodeURIComponent(id),{method:'PUT',headers:{...J,...(rev!=null?{'X-KP-Rev':String(rev)}:{})},body:JSON.stringify(d)});
  if (typeof DL!=='undefined') DL.sups=null;
}
