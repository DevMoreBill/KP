// Окно каталога: категории и фильтры слева, список с отметками, карточка-предпросмотр справа.
// Пакетные действия над отмеченными позициями: добавить в КП, перенести в другую категорию, удалить.
// Перенос — также перетаскиванием позиций на категорию. Размер окна меняется за угол, «⤢» — на весь экран.
'use strict';

const FI = { q:'', cat:'', maker:'', series:'', f:{}, rng:{}, priced:false, sort:'main' };

const FO = { q:'', cat:'', maker:'', series:'', f:{}, rng:{}, priced:false, sort:'name' };

// состояние окна: режим (позиции КП или опции позиции), отметки, открытая карточка, последний перенос (для отмены)
const CW = { optFor:null, F:FI, sel:new Set(), active:null, limit:150, docs:[], view:[], lastCk:null, undo:null, note:'', busy:'', drag:null };

const cwA = x => x._a || (x._a = attrsOf(x));

const cwNV = (x,k) => { const c=x._nv||(x._nv={}); return k in c ? c[k] : (c[k]=norm(cwA(x)[k])); };

function cwForget(x){ delete x._a; delete x._nv; delete x._hay; }

function cwDlg(){ let d=$('#catdlg'); if(!d){ d=document.createElement('dialog'); d.id='catdlg'; d.className='catwin'; d.setAttribute('aria-label','Каталог'); document.body.appendChild(d); } return d; }

// ---------- размер окна: запоминается в браузере
function cwSize(d){ let z={}; try{ z=JSON.parse(localStorage.getItem('kp.catwin')||'{}')||{}; }catch(e){}
  d.classList.toggle('max', !!z.max);
  if (z.w && z.h){ d.style.width=Math.min(z.w, innerWidth)+'px'; d.style.height=Math.min(z.h, innerHeight)+'px'; } else { d.style.width=''; d.style.height=''; } }

function cwSaveSize(d){ try{ const o=JSON.parse(localStorage.getItem('kp.catwin')||'{}')||{}; const max=d.classList.contains('max');
  const z = max ? {...o, max:true} : {max:false, w:Math.round(d.offsetWidth), h:Math.round(d.offsetHeight)}; localStorage.setItem('kp.catwin', JSON.stringify(z)); }catch(e){} }

function cwLayout(d){ const w=d.clientWidth; d.classList.toggle('narrow', w<1100); d.classList.toggle('tiny', w<760); }

// ---------- фильтрация
function cwKindOk(x){ if (CW.optFor==null) return true; const t=typeById(cwA(x).cat); return t.role==='accessory' || x.kind==='option'; }

function cwPass(x, skip){ const F=CW.F, a=cwA(x);
  if (CW.optFor!=null && !F.cat && !cwKindOk(x)) return false;
  if (skip!=='cat' && F.cat && a.cat!==F.cat) return false;
  for (const k of ['maker','series']) if (k!==skip && F[k] && cwNV(x,k)!==norm(F[k])) return false;
  for (const k in F.f) if (k!==skip && F.f[k] && cwNV(x,k)!==norm(F.f[k])) return false;
  for (const k in F.rng){ if (k===skip) continue; const r=F.rng[k]; if(!r) continue; const v=numOf(a[k]);
    if (r.min!==''&&r.min!=null && !(v>=+r.min)) return false; if (r.max!==''&&r.max!=null && !(v<=+r.max)) return false; }
  if (F.priced && !x.price) return false;
  if (F.q){ if (!F._qw || F._qs!==F.q){ F._qs=F.q; F._qw=norm(F.q).split(' ').filter(Boolean); }
    const hay=x._hay||(x._hay=norm([x.name,x.spec,x.st||'',...Object.values(a),...(x.groups||[]).flatMap(g=>(g.rows||[]).map(r=>r.k+' '+r.v))].join(' ')));
    if (!F._qw.every(w=>hay.includes(w))) return false; }
  return true; }

function cwFacet(key, label, inF){ const F=CW.F, cnt=new Map();
  CW.docs.filter(x=>cwPass(x,key)).forEach(x=>{ const v=cwA(x)[key]; if(v==null||v==='') return; const n=cwNV(x,key); const c=cnt.get(n)||{v:String(v),n:0}; c.n++; cnt.set(n,c); });
  const cur=inF?F.f[key]:F[key];
  const opts=[...cnt.values()].sort((p,q)=>String(p.v).localeCompare(String(q.v),'ru',{numeric:true}));
  if (!opts.length && !cur) return '';
  return `<label class="f"><span>${esc(label)}</span><select data-f="${key}" data-in="${inF?1:''}"><option value="">Все</option>${opts.map(o=>`<option value="${esc(o.v)}"${norm(cur)===norm(o.v)?' selected':''}>${esc(o.v)} (${o.n})</option>`).join('')}${cur&&!cnt.has(norm(cur))?`<option selected>${esc(cur)}</option>`:''}</select></label>`; }

function cwRange(f){ const F=CW.F, r=F.rng[f.key]||{min:'',max:''}, chips=f.chips||[];
  const has=CW.docs.some(x=>cwPass(x,f.key)&&numOf(cwA(x)[f.key])!=null); if(!has && r.min===''&&r.max==='') return '';
  return `<div class="f"><span class="muted">${esc(f.label)}${f.unit?', '+esc(f.unit):''}</span><div class="kw"><input type="text" inputmode="decimal" data-rk="${f.key}" data-rs="min" placeholder="от" value="${esc(r.min??'')}"><input type="text" inputmode="decimal" data-rk="${f.key}" data-rs="max" placeholder="до" value="${esc(r.max??'')}"></div>
    ${chips.length?`<div class="chips">${chips.map(([lo,hi])=>{ const on=String(r.min)===String(lo||'')&&String(r.max)===String(hi??''); return `<button class="chip${on?' on':''}" type="button" data-rc="${f.key}" data-lo="${lo||''}" data-hi="${hi??''}">${hi==null?'от '+fnum(lo):(lo?fnum(lo)+'–'+fnum(hi):'до '+fnum(hi))}</button>`; }).join('')}</div>`:''}</div>`; }

function cwFiltered(){ return CW.F.maker||CW.F.series||Object.values(CW.F.f).some(Boolean)||Object.values(CW.F.rng).some(r=>r&&((r.min??'')!==''||(r.max??'')!==''))||CW.F.priced; }

// ---------- отрисовка
function cwNav(){
  const F=CW.F, cnt=new Map(); let all=0;
  CW.docs.forEach(x=>{ if(!cwKindOk(x)) return; const c=cwA(x).cat; cnt.set(c,(cnt.get(c)||0)+1); all++; });
  const groups=[...new Set(TYPES.map(t=>t.group||'Прочее'))];
  const cats=groups.map(g=>{ const ts=TYPES.filter(t=>(t.group||'Прочее')===g && (CW.optFor==null || t.role==='accessory' || cnt.get(t.id) || F.cat===t.id));
    return ts.length ? `<p class="cw-grp">${esc(g)}</p>`+ts.map(t=>{ const n=cnt.get(t.id)||0;
      return `<button type="button" class="cw-cat${F.cat===t.id?' on':''}${n?'':' zero'}" data-cat="${esc(t.id)}" data-dropcat="${esc(t.id)}"><span>${esc(t.name)}</span><i>${n}</i></button>`; }).join('') : ''; }).join('');
  const t=F.cat?typeById(F.cat):null;
  let flt=cwFacet('maker','Производитель')+cwFacet('series','Серия');
  if (t){ for (const f of t.fields) if (f.range) flt+=cwRange(f); for (const f of t.fields) if (f.facet) flt+=cwFacet(f.key,f.label,true); }
  $('#cwNav').innerHTML=`<p class="cw-cap">Категории</p><div class="cw-cats">
      <button type="button" class="cw-cat all${!F.cat?' on':''}" data-cat=""><span>Все позиции</span><i>${all}</i></button>${cats}
      ${CW.optFor==null?'<button type="button" class="cw-cat add" data-cw="newtype">+ Новая категория</button>':''}</div>
    <p class="cw-cap">Фильтры ${cwFiltered()?'<button type="button" class="lnk" data-cw="reset">сбросить</button>':''}</p>
    <div class="cw-flt">${flt}<label class="cw-chk"><input type="checkbox" id="cwPriced" ${F.priced?'checked':''}> Только с ценой</label>
      ${t?'':'<p class="muted" style="margin:0">Выберите категорию — появятся фильтры по её параметрам (мощность, давление, производительность…).</p>'}</div>`;
}

function cwTags(x){ const a=cwA(x), t=typeById(a.cat), out=[];
  const kp=t.fields.filter(f=>f.kpi&&a[f.key]!=null&&a[f.key]!=='').slice(0,3).map(f=>fmtField(f,a[f.key]));
  if (kp.length) out.push(`<span class="tag kwt">${esc(kp.join(' · '))}</span>`);
  const fac=t.fields.filter(f=>f.facet&&!f.kpi&&a[f.key]&&String(a[f.key])!=='Нет').slice(0,3);
  for (const f of fac){ const v=String(a[f.key])==='Да' ? f.label : f.key==='engine'&&a.engineModel ? a[f.key]+' '+a.engineModel : fmtField(f,a[f.key]); out.push(`<span class="tag">${esc(v)}</span>`); }
  if (!CW.F.cat) out.push(`<span class="tag tt">${esc(t.name)}</span>`);
  return out.length?`<div class="tags">${out.join('')}</div>`:''; }

function cwInKp(id){ if (CW.optFor!=null) return (S.items[CW.optFor]?.options||[]).some(o=>o.catId===id); return S.items.some(it=>it.catId===id); }

function cwAddLabel(id, long){ const inn=cwInKp(id);
  if (CW.optFor!=null) return inn ? '✓ Добавлено' : (long?'Добавить опцией':'Опцией');
  return inn ? (long?'Уже в КП: ещё 1 шт.':'✓ +1 шт.') : (long?'Добавить в КП':'В КП'); }

function cwPriceHtml(x){ return x.price ? `${money(x.price)} ${curSh(x.priceCur||'RUB')}` : x.cost ? `<small>закупка</small>${money(x.cost)} ${curSh(x.costCur||'RUB')}` : '<small>без цены</small>'; }

function cwRow(x){ const id=x.id, n=x.pricesCount||(x.prices||[]).length, inn=cwInKp(id);
  return `<div class="cw-row${CW.sel.has(id)?' sel':''}${CW.active===id?' act':''}" data-id="${esc(id)}" draggable="${CW.optFor==null}">
    <label class="ck" title="Отметить (Shift — диапазон)"><input type="checkbox" data-ck ${CW.sel.has(id)?'checked':''} aria-label="Отметить"></label>
    ${x.photo?`<img src="${esc(x.photo.src)}" alt="" loading="lazy">`:'<i class="ph"></i>'}
    <div class="cw-mn"><b>${esc(x.name)}</b>${cwTags(x)}</div>
    <div class="cw-pr">${cwPriceHtml(x)}${n?`<small>в КП ${n} ${plural(n,'раз','раза','раз')}</small>`:''}</div>
    <button class="btn sm${inn?' in':''}" type="button" data-add title="${inn?(CW.optFor!=null?'Уже добавлено':'Уже в КП — увеличить количество'):''}">${cwAddLabel(id)}</button></div>`; }

function cwList(){
  const F=CW.F, s=F.sort, mainVal=x=>{ const a=cwA(x), t=typeById(a.cat); return numOf(a[t.main||'kw']); };
  const list=CW.docs.filter(x=>cwPass(x));
  list.sort((p,q)=> s==='name' ? String(p.name).localeCompare(q.name,'ru',{numeric:true}) : s==='price' ? (p.price||9e15)-(q.price||9e15) :
    s==='recent' ? String(q.prices?.[0]?.date||q.updatedAt||'').localeCompare(String(p.prices?.[0]?.date||p.updatedAt||'')) :
    (String(cwA(p).cat).localeCompare(String(cwA(q).cat))) || ((mainVal(p)??9e9)-(mainVal(q)??9e9)) || String(p.name).localeCompare(q.name,'ru',{numeric:true}));
  CW.view=list;
  $('#cwCnt').textContent = CW.docs.length ? `Найдено: ${list.length} из ${CW.docs.length}` : '';
  const all=$('#cwAll'); const k=list.filter(x=>CW.sel.has(x.id)).length; all.checked=!!list.length && k===list.length; all.indeterminate=k>0 && k<list.length;
  $('#cwList').innerHTML = list.length ? list.slice(0,CW.limit).map(cwRow).join('')
      + (list.length>CW.limit?`<div class="cw-more"><button class="btn" type="button" data-more>Показать ещё (${list.length-CW.limit})</button></div>`:'')
    : `<p class="empty">${CW.docs.length?'Ничего не найдено — ослабьте фильтры или выберите «Все позиции».':'Каталог пуст. Добавьте позицию, загрузите файл каталога или импортируйте таблицу из Excel (меню «Ещё»).'}</p>`;
}

function cwFoot(){
  const f=$('#cwF'); if(!f) return; const n=CW.sel.size;
  if (CW.busy){ f.className='cw-f busy'; f.innerHTML=`<span class="spin"></span><b>${esc(CW.busy)}</b>`; return; }
  if (n){ f.className='cw-f bulk'; f.innerHTML=`<b>Отмечено: ${n}</b>
      <button class="btn primary" type="button" data-bulk="add">${CW.optFor!=null?'Добавить опциями':'Добавить в КП'}</button>
      ${CW.optFor==null?'<button class="btn" type="button" data-bulk="move">Перенести в категорию…</button>':''}
      <button class="btn ghost danger" type="button" data-bulk="del">Удалить</button><span class="sp"></span>
      <button class="btn ghost" type="button" data-bulk="clear">Снять отметки</button>`; return; }
  const k = CW.optFor!=null ? (S.items[CW.optFor]?.options||[]).filter(o=>o.name).length : S.items.filter(x=>x.name).length;
  f.className='cw-f'; f.innerHTML=`<span class="muted cw-note">${esc(CW.note||'Отметьте галочками несколько позиций — появятся пакетные действия. Позиции можно перетащить мышью на категорию слева.')}</span>
    ${CW.undo?'<button class="btn ghost" type="button" data-cw="undo">Отменить перенос</button>':''}<span class="sp"></span>
    <span class="muted">${CW.optFor!=null?'Опций у позиции':'Позиций в КП'}: <b>${k}</b></span><button class="btn primary" type="button" data-cw="done">${CW.optFor!=null?'Готово':'Готово — к КП'}</button>`; }

function cwNote(t){ CW.note=t||''; cwFoot(); }

function cwBusy(t){ CW.busy=t||''; cwFoot(); }

function cwRedraw(){ if (!$('#cwList')) return; cwNav(); cwList(); cwFoot(); cwPreview(); }

// ---------- карточка-предпросмотр
function cwCard(x, loading){
  const a=attrsOf(x), t=typeById(a.cat);
  const kpi=t.fields.filter(f=>f.kpi&&a[f.key]!=null&&a[f.key]!=='').map(f=>`<div class="pv-k"><b>${esc(fmtField(f,a[f.key]))}</b><span>${esc(f.label)}</span></div>`).join('');
  const params=[['Производитель',a.maker],['Серия',a.series],['Модель',a.model],...t.fields.filter(f=>!f.kpi).map(f=>[f.label,fmtField(f,a[f.key])])].filter(([,v])=>v!=null&&v!=='');
  const feats=(x.features||[]).filter(f=>f.label||f.text), groups=(x.groups||[]).filter(g=>(g.rows||[]).some(r=>r.k||r.v));
  const gal=(x.gallery||[]).filter(g=>g.src&&g.on!==false), hist=(x.prices||[]).slice(0,5), n=x.pricesCount||(x.prices||[]).length;
  return `<div class="pv-scroll">
    <div class="pv-photo">${x.photo?`<img src="${esc(x.photo.src)}" alt="">`:'<span>нет фото</span>'}${x.logo?`<img class="pv-logo" src="${esc(x.logo.src)}" alt="">`:''}</div>
    ${x.photoFrom&&x.photo?`<p class="muted pv-pf">Фото — от похожей модели того же производителя («${esc(x.photoFrom.name||'')}»). Своё фото — «Редактировать» → «Описание и фото».</p>`:''}
    <h4>${esc(x.name||'Без названия')}</h4>${x.spec?`<p class="muted pv-spec">${esc(x.spec)}</p>`:''}
    ${CW.optFor==null?`<label class="pv-cat"><span>Категория</span><select data-pvcat>${typeOptionsHtml(a.cat)}</select></label>`:''}
    <div class="pv-price"><b>${x.price?money(x.price)+' '+curSh(x.priceCur||'RUB'):'Цена не указана'}</b>${x.cost?`<span>закупка ${money(x.cost)} ${curSh(x.costCur||'RUB')}</span>`:''}</div>
    ${kpi?`<div class="pv-kpi">${kpi}</div>`:''}
    ${params.length?`<table class="pv-t">${params.map(([k,v])=>`<tr><td>${esc(k)}</td><td>${esc(v)}</td></tr>`).join('')}</table>`:''}
    ${loading?'<p class="muted">Загружаю описание и характеристики…</p>':''}
    ${feats.length?`<p class="pv-cap">Описание</p>${feats.map(f=>`<p class="pv-f">${f.label?`<b>${esc(f.label)}.</b> `:''}${esc(f.text||'')}</p>`).join('')}`:''}
    ${groups.length?`<p class="pv-cap">Характеристики</p>${groups.map((g,k)=>`<details class="pv-g"${k===0?' open':''}><summary>${esc(g.name||'Основные')} <i>${g.rows.filter(r=>r.k||r.v).length}</i></summary><table class="pv-t">${g.rows.filter(r=>r.k||r.v).map(r=>`<tr${r.hl?' class="hl"':''}><td>${esc(r.k)}</td><td>${esc(r.v)}</td></tr>`).join('')}</table></details>`).join('')}`:''}
    ${gal.length?`<p class="pv-cap">Изображения <i>${gal.length}</i></p><div class="pv-gal">${gal.map(g=>`<img src="${esc(g.src)}" alt="" title="${esc(g.caption||'')}" loading="lazy">`).join('')}</div>`:''}
    ${hist.length?`<p class="pv-cap">В коммерческих предложениях <i>${n}</i></p><table class="pv-t pv-h">${hist.map(p=>`<tr><td>${esc(KPGen.ruDate(p.date))}${p.number?`<br><small>№ ${esc(p.number)}</small>`:''}</td><td>${esc(p.client||'')}</td><td>${p.price?money(p.price)+' '+curSh(p.cur||'RUB'):''}</td></tr>`).join('')}</table>`:''}
    ${!loading&&!feats.length&&!groups.length?'<p class="muted pv-empty">Описания и характеристик пока нет — нажмите «Редактировать».</p>':''}
  </div>
  <div class="pv-acts"><div class="pv-main"><button class="btn primary" type="button" data-pv="add">${cwAddLabel(x.id,true)}</button><button class="btn" type="button" data-pv="edit">Редактировать</button></div>
    <div class="pv-sub">${CW.optFor==null?'<button class="btn ghost" type="button" data-pv="dup" title="Создать копию позиции и открыть её на редактирование">Создать копию</button>':''}<button class="btn ghost danger" type="button" data-pv="del">Удалить из каталога</button><span class="sp"></span><button class="btn ghost pv-x" type="button" data-pv="close">Закрыть карточку</button></div></div>`;
}

async function cwPreview(){
  const pv=$('#cwPv'), d=cwDlg(); if(!pv) return; const id=CW.active;
  d.classList.toggle('pvon', !!id);
  const light=id && CW.docs.find(z=>z.id===id);
  if (!light){ CW.active=null; d.classList.remove('pvon');
    pv.innerHTML=`<div class="cw-pv0"><b>Карточка позиции</b><p>Нажмите на позицию в списке — здесь появятся фото, параметры, описание, характеристики и история цен.</p>
      <p>Двойной щелчок — открыть позицию на редактирование.</p><p>Отметьте галочками несколько позиций, чтобы добавить их в КП сразу, перенести в другую категорию или удалить.</p></div>`; return; }
  if (pv.dataset.id!==id){ pv.innerHTML=cwCard(light,!!light._light); pv.dataset.id=id; }
  const full=await fullDoc(light); if (CW.active!==id) return;
  const sc=pv.querySelector('.pv-scroll')?.scrollTop||0; pv.innerHTML=cwCard(full,false); const s2=pv.querySelector('.pv-scroll'); if(s2) s2.scrollTop=sc;
}

function cwActivate(id){ CW.active=id; document.querySelectorAll('#cwList .cw-row').forEach(r=>r.classList.toggle('act', r.dataset.id===id)); cwPreview(); }

// ---------- действия
function cwQtyUp(it){ const old=+it.qty||0; it.qty=old+1; (it.options||[]).forEach(o=>{ if(o.unit!=='усл.' && +o.qty===old) o.qty=it.qty; }); }

async function cwAdd(ids){
  const take=id=>fullDoc(CW.docs.find(z=>z.id===id));
  if (CW.optFor!=null){ const it=S.items[CW.optFor]; if(!it) return; it.options=it.options||[]; let n=0;
    for (const id of ids){ if (it.options.some(o=>o.catId===id)) continue; const x=await take(id); if(!x) continue; const a=attrsOf(x);
      it.options.push(newOpt(it,{ name:x.name, short:x.short||(a.cat==='ats'?'АВР':(a.model||'')), unit:x.unit||'шт.', price:x.price||0, catId:x.id })); n++; }
    renderForm(); persist(); CW.sel.clear(); cwList(); cwNote(n?`Добавлено опций: ${n}`:'Эти позиции уже добавлены опциями'); cwPreview(); return; }
  let n=0, m=0, k=0;
  for (const id of ids){ if (ids.length>3) cwBusy(`Добавляю в КП: ${++k} из ${ids.length}`);
    const ex=S.items.find(it=>it.catId===id); if (ex){ cwQtyUp(ex); m++; continue; }
    const x=await take(id); if(!x) continue;
    const it=newItem(); fillFromCat(it,x);
    const blank=S.items.length===1 && !S.items[0].name && !S.items[0].price;
    if (blank) S.items=[it]; else S.items.push(it); n++; }
  cwBusy('');
  if (STEP!=='equip'){ STEP='equip'; try{ localStorage.setItem('kp.step','equip'); }catch(e){} }
  renderForm(); persist(); if (ids.length>1) CW.sel.clear(); cwList();
  cwNote([n?`Добавлено в КП: ${n} ${plural(n,'позиция','позиции','позиций')}`:'', m?`количество увеличено у ${m}`:''].filter(Boolean).join('; ')+'. Можно добавить ещё или нажать «Готово — к КП».'); cwPreview();
}

async function cwReload(){ await refreshCat(); CW.docs=catCache; renderForm(); }

async function cwMove(ids, cat){
  const t=typeById(cat), todo=ids.filter(id=>{ const x=CW.docs.find(z=>z.id===id); return x && cwA(x).cat!==cat; });
  if (!todo.length) return cwNote(`Позиции уже в категории «${t.name}»`);
  const undo=[]; let k=0, fail=0;
  for (const id of todo){ cwBusy(`Переношу в «${t.name}»: ${++k} из ${todo.length}`);
    try{ const full=await store().get(id); if(!full||!full.id) throw 0; const prev=(full.attrs||{}).cat;
      full.attrs={...(full.attrs||{}), cat}; await store().put(full); undo.push({id, prev}); }catch(e){ fail++; } }
  CW.undo = undo.length ? {list:undo, name:t.name} : null; CW.sel.clear(); CW.busy='';
  await cwReload(); CW.note=`Перенесено в «${t.name}»: ${undo.length} ${plural(undo.length,'позиция','позиции','позиций')}`+(fail?`, не удалось: ${fail}`:''); cwRedraw();
}

async function cwUndo(){ const u=CW.undo; if(!u) return; CW.undo=null; let k=0;
  for (const {id,prev} of u.list){ cwBusy(`Возвращаю: ${++k} из ${u.list.length}`);
    try{ const full=await store().get(id); const a={...(full.attrs||{})}; if (prev) a.cat=prev; else delete a.cat; full.attrs=a; await store().put(full); }catch(e){} }
  CW.busy=''; await cwReload(); CW.note='Перенос отменён'; cwRedraw(); }

async function cwDelete(ids){
  const one=ids.length===1 && CW.docs.find(z=>z.id===ids[0]);
  if (!confirm(one ? `Удалить из каталога «${one.name}»?\nВ уже сохранённых КП ничего не изменится.` : `Удалить из каталога ${ids.length} ${plural(ids.length,'позицию','позиции','позиций')}?\nВ уже сохранённых КП ничего не изменится.`)) return;
  let k=0, fail=0;
  for (const id of ids){ if (ids.length>3) cwBusy(`Удаляю: ${++k} из ${ids.length}`); try{ await store().del(id); }catch(e){ fail++; } CW.sel.delete(id); if (CW.active===id) CW.active=null; }
  CW.busy=''; await cwReload(); CW.note=`Удалено: ${ids.length-fail}`+(fail?`, не удалось: ${fail}`:''); cwRedraw(); }

function cwTypeButtons(attr){
  const groups=[...new Set(TYPES.map(t=>t.group||'Прочее'))];
  return groups.map(g=>`<p class="sub" style="margin:12px 0 6px">${esc(g)}</p><div class="tpick">${TYPES.filter(t=>(t.group||'Прочее')===g).map(t=>`<button type="button" class="btn${t.id===CW.F.cat?' primary':''}" ${attr}="${esc(t.id)}">${esc(t.name)}</button>`).join('')}</div>`).join(''); }

function cwMoveDlg(ids){
  const d=$('#dlg'); d.classList.remove('wide');
  d.innerHTML=`<div class="dlg-h"><h3>Перенести ${ids.length} ${plural(ids.length,'позицию','позиции','позиций')} в категорию</h3><button class="icon" type="button" data-close aria-label="Закрыть">✕</button></div>
   <div class="dlg-b">${cwTypeButtons('data-mv')}
   <div class="row" style="margin-top:16px"><button class="btn" type="button" data-mvnew>+ Новая категория…</button><span class="muted">Нужной категории нет — создайте её, и позиции сразу перенесутся.</span></div></div>`;
  d.showModal(); d.querySelector('[data-close]').onclick=()=>d.close();
  d.querySelector('.dlg-b').onclick=e=>{ const b=e.target.closest('[data-mv]'); if (b){ d.close(); cwMove(ids, b.dataset.mv); return; }
    if (e.target.closest('[data-mvnew]')){ d.close(); cwNewType(id=>cwMove(ids,id), cwMainCat(ids)); } };
}

// самая частая категория среди позиций — образец для новой категории при переносе
function cwMainCat(ids){ const c=new Map(); ids.forEach(id=>{ const x=CW.docs.find(z=>z.id===id); if(x){ const k=cwA(x).cat; c.set(k,(c.get(k)||0)+1); } }); return [...c.entries()].sort((a,b)=>b[1]-a[1])[0]?.[0]; }

// base — категория-образец: параметры, фильтры и раздел новой категории берутся у неё
function cwNewType(then, base){
  const d=$('#dlg'); d.classList.remove('wide');
  const groups=[...new Set(TYPES.map(t=>t.group||'Прочее'))];
  base=base||CW.F.cat||(CW.active&&CW.docs.find(z=>z.id===CW.active)&&cwA(CW.docs.find(z=>z.id===CW.active)).cat)||(TYPES.find(t=>t.role!=='accessory')||{}).id||'other';
  d.innerHTML=`<div class="dlg-h"><h3>Новая категория</h3><button class="icon" type="button" data-close aria-label="Закрыть">✕</button></div>
   <div class="dlg-b"><div class="grid">
     <label class="f"><span class="req">Название категории</span><input type="text" id="ntName" placeholder="Например: Спиральные компрессоры" autocomplete="off"></label>
     <div class="grid g2"><label class="f"><span>Раздел</span><select id="ntGroup">${groups.map(g=>`<option${g===(typeById(base).group||'Прочее')?' selected':''}>${esc(g)}</option>`).join('')}<option value="__new">+ новый раздел…</option></select></label>
       <label class="f" id="ntGroupNewL" style="display:none"><span>Название раздела</span><input type="text" id="ntGroupNew" placeholder="Например: Подготовка воздуха" autocomplete="off"></label></div>
     <label class="f"><span>Параметры и фильтры — как у категории</span><select id="ntBase">${typeOptionsHtml(base)}</select></label></div>
   <p class="muted">Из выбранной категории копируются параметры (мощность, давление, производительность…), фильтры каталога и быстрые опции. Тонкая настройка — «Ещё» → «Типы оборудования».</p>
   <p class="msg err" id="ntErr" style="text-align:left"></p>
   <div class="row" style="justify-content:flex-end"><button class="btn" type="button" data-close>Отмена</button><button class="btn primary" type="button" id="ntSave">Создать категорию</button></div></div>`;
  d.showModal(); d.querySelectorAll('[data-close]').forEach(b=>b.onclick=()=>d.close());
  const err=t=>{ $('#ntErr').textContent=t; };
  $('#ntGroup').onchange=e=>{ const on=e.target.value==='__new'; $('#ntGroupNewL').style.display=on?'':'none'; if (on) $('#ntGroupNew').focus(); };
  $('#ntName').onkeydown=e=>{ if (e.key==='Enter') $('#ntSave').click(); };
  $('#ntSave').onclick=async()=>{
    const name=$('#ntName').value.replace(/\s+/g,' ').trim(); if (!name) return err('Укажите название категории');
    if (TYPES.some(t=>norm(t.name)===norm(name))) return err('Такая категория уже есть — выберите её в списке');
    const group=$('#ntGroup').value==='__new' ? $('#ntGroupNew').value.replace(/\s+/g,' ').trim() : $('#ntGroup').value; if (!group) return err('Укажите название раздела');
    const b=JSON.parse(JSON.stringify(typeById($('#ntBase').value)));
    const t={...b, id:'u'+Date.now().toString(36), name, group, item:b.item||name, coverTitle:name, match:''}; delete t.hidden;
    $('#ntSave').disabled=true;
    try{ await api('/api/types',{method:'PUT',headers:{'Content-Type':'application/json; charset=utf-8'},body:JSON.stringify({version:1,types:[...userTypesList(), t]})});
      await loadTypes(); catCache.forEach(cwForget); }
    catch(e){ $('#ntSave').disabled=false; return err('Не удалось сохранить категорию: '+(e.message||e)); }
    d.close(); renderForm(); cwRedraw(); cwNote(`Создана категория «${name}»`); if (then) then(t.id); };
  setTimeout(()=>$('#ntName').focus(),30);
}

function cwPickType(then){
  const d=$('#dlg'); d.classList.remove('wide');
  d.innerHTML=`<div class="dlg-h"><h3>Новая позиция каталога — какая категория?</h3><button class="icon" type="button" data-close aria-label="Закрыть">✕</button></div>
   <div class="dlg-b">${cwTypeButtons('data-nt')}<div class="row" style="margin-top:16px"><button class="btn" type="button" data-ntnew>+ Новая категория…</button></div></div>`;
  d.showModal(); d.querySelector('[data-close]').onclick=()=>d.close();
  d.querySelector('.dlg-b').onclick=e=>{ const b=e.target.closest('[data-nt]'); if (b){ d.close(); then(b.dataset.nt); return; }
    if (e.target.closest('[data-ntnew]')){ d.close(); cwNewType(then); } };
}

const cwAfterSave = async doc => { await cwReload(); CW.active=doc.id; const pv=$('#cwPv'); if (pv) pv.dataset.id=''; CW.note=`Сохранено: ${doc.name}`; cwRedraw();
  requestAnimationFrame(()=>document.querySelector(`#cwList .cw-row[data-id="${CSS.escape(doc.id)}"]`)?.scrollIntoView({block:'nearest'})); };

async function cwEdit(id){ const x=await fullDoc(CW.docs.find(z=>z.id===id)); if (!x) return; openCatEditor(x, cwAfterSave); }

function cwNew(cat){ openCatEditor({ id:uid()+uid(), name:'', spec:'', price:0, priceCur:'RUB', attrs:{cat}, features:[{id:uid(),label:'',text:''}], groups:[], gallery:[], prices:[] }, cwAfterSave); }

async function cwDup(id){ const x=await fullDoc(CW.docs.find(z=>z.id===id)); if (!x || x._light) return cwNote('Не удалось загрузить позицию');
  const c=JSON.parse(JSON.stringify(x)); c.id=uid()+uid(); c.name=x.name+' (копия)'; c.prices=[]; delete c.pricesCount; openCatEditor(c, cwAfterSave, true); }

async function cwImportFile(f){
  try{ const j=JSON.parse(await f.text()); const items=Array.isArray(j)?j:j.items; if(!Array.isArray(items)) throw 0;
    const ex=new Map((await store().list()).map(z=>[z.id,z])); let n=0;
    for (const x of items){ if(!(x&&x.id&&x.name)) continue; const o=ex.get(x.id); cwBusy(`Загружаю каталог: ${++n} из ${items.length}`);
      if (o){ if(!x.price && o.price) x.price=o.price; if((!x.prices||!x.prices.length) && o.prices&&o.prices.length) x.prices=o.prices; if(!x.options&&o.options) x.options=o.options; }
      await store().put(x); }
    // удаление дубликатов, перечисленных в файле каталога (цены и история переносятся в оставшуюся позицию)
    let rmN=0; const rmList=Array.isArray(j.remove)?j.remove:[]; const byId=new Map(items.map(z=>[z.id,z]));
    for (const id of rmList){ const o=ex.get(id); if(!o) continue; const keepId=(j.merge&&j.merge[id])||null; const k=keepId&&byId.get(keepId);
      if (k && o.prices && o.prices.length){ k.prices=[...(o.prices||[]),...(k.prices||[])].slice(0,50); if(!k.price&&o.price) k.price=o.price; await store().put(k); }
      await store().del(id); rmN++; }
    CW.busy=''; await cwReload(); CW.note=`Загружено позиций: ${n}`+(rmN?`, удалено дубликатов: ${rmN}`:''); cwRedraw(); }
  catch(e){ CW.busy=''; cwNote('Это не файл каталога КП'); }
}

async function cwExport(){ const all=(await store().full()).map(x=>{ const y={...x}; delete y._a; delete y._nv; delete y._hay; return y; }); if(!all.length) return cwNote('Каталог пуст');
  saveFile(`Каталог_КП_Пневмотех_${today()}.json`, new Blob([JSON.stringify({format:'kp-catalog',version:1,items:all})],{type:'application/json'})); }

function cwClose(){ const d=cwDlg(); if (d.open) d.close(); }

// ---------- окно
async function openCatalog(mode={}){
  const optFor = Number.isInteger(mode.opt) ? mode.opt : null;
  Object.assign(CW, { optFor, F: optFor!=null ? FO : FI, active:null, limit:150, lastCk:null, note:'', busy:'' }); CW.sel.clear();
  const F=CW.F; if (mode.cat!=null){ F.cat=mode.cat; F.f={}; F.rng={}; }
  const d=cwDlg(); d.classList.remove('navon','pvon'); cwSize(d);
  d.innerHTML=`<div class="cw-h"><button class="icon cw-navbtn" type="button" data-cw="nav" aria-label="Категории и фильтры" title="Категории и фильтры">☰</button>
     <h3>${optFor!=null?'Опции для позиции '+(optFor+1):'Каталог'}</h3>
     <div class="cw-q"><input type="search" id="cwQ" placeholder="Поиск: модель, производитель, любое значение характеристик" autocomplete="off" value="${esc(F.q)}" aria-label="Поиск по каталогу"></div>
     ${optFor==null?'<button class="btn" type="button" data-cw="new" title="Новая позиция каталога">+<span class="cw-lbl"> Позиция</span></button>':''}
     <details class="cw-menu"><summary class="btn" title="Импорт, выгрузка, типы оборудования">Ещё<span class="cw-lbl"> ▾</span></summary><div>
       <button type="button" data-cw="xls">Импорт из Excel…</button><button type="button" data-cw="imp">Загрузить файл каталога (.json)…</button><button type="button" data-cw="exp">Выгрузить каталог в файл</button>
       <hr><button type="button" data-cw="types">Типы оборудования…</button></div></details>
     <button class="icon" type="button" data-cw="max" aria-label="Во весь экран" title="Во весь экран / обычный размер. Размер окна можно менять, потянув за правый нижний угол">⤢</button>
     <button class="icon" type="button" data-cw="close" aria-label="Закрыть">✕</button></div>
   <div class="cw-b"><nav class="cw-nav" id="cwNav" aria-label="Категории и фильтры"></nav>
     <section class="cw-mid"><div class="cw-tb"><label class="ck" title="Отметить все найденные"><input type="checkbox" id="cwAll" aria-label="Отметить все найденные"></label><span class="muted" id="cwCnt"></span><span class="sp"></span>
         <select id="cwSort" aria-label="Сортировка"><option value="main">По основному параметру</option><option value="name">По названию</option><option value="recent">Недавно в КП</option><option value="price">По цене</option></select></div>
       <div class="cw-list" id="cwList"><p class="empty">Загружаю…</p></div></section>
     <aside class="cw-pv" id="cwPv" aria-label="Карточка позиции"></aside></div>
   <div class="cw-f" id="cwF"></div>`;
  if (!d.open) d.showModal();
  cwBind(d); cwLayout(d);
  $('#cwSort').value=F.sort;
  CW.docs = catCache.length ? catCache : await store().list().catch(()=>[]);
  cwRedraw();
  setTimeout(()=>{ if (matchMedia('(pointer:fine)').matches) $('#cwQ')?.focus(); },30);
}

function cwBind(d){
  if (d._bound) return; d._bound=true;
  let szT=null; new ResizeObserver(()=>{ if(!d.open) return; cwLayout(d); clearTimeout(szT); szT=setTimeout(()=>{ if (d.open && !d.classList.contains('max')) cwSaveSize(d); },500); }).observe(d);
  let qT=null;
  d.addEventListener('input', e=>{ const t=e.target, F=CW.F;
    if (t.id==='cwQ'){ F.q=t.value; CW.limit=150; clearTimeout(qT); qT=setTimeout(()=>{ cwNav(); cwList(); }, CW.docs.length>2000?180:60); return; }
    if (t.dataset.rk){ const r=F.rng[t.dataset.rk]||(F.rng[t.dataset.rk]={min:'',max:''}); r[t.dataset.rs]=t.value.replace(',','.').replace(/[^\d.]/g,''); cwList(); } });
  d.addEventListener('change', e=>{ const t=e.target, F=CW.F;
    if (t.id==='cwSort'){ F.sort=t.value; cwList(); return; }
    if (t.dataset.f!=null){ if (t.dataset.in) F.f[t.dataset.f]=t.value; else F[t.dataset.f]=t.value; CW.limit=150; cwNav(); cwList(); return; }
    if (t.id==='cwPriced'){ F.priced=t.checked; cwNav(); cwList(); return; }
    if (t.id==='cwAll'){ CW.view.forEach(x=>t.checked?CW.sel.add(x.id):CW.sel.delete(x.id)); cwList(); cwFoot(); return; }
    if (t.dataset.pvcat!=null && CW.active){ cwMove([CW.active], t.value); return; } });
  d.addEventListener('click', async e=>{
    const t=e.target, F=CW.F;
    const menu=d.querySelector('.cw-menu'); if (menu && menu.open && !t.closest('.cw-menu summary')) menu.open=false;
    const ck=t.closest('[data-ck]');
    if (ck){ const row=ck.closest('.cw-row'), id=row.dataset.id, ids=CW.view.map(x=>x.id), on=ck.checked;
      if (e.shiftKey && CW.lastCk && ids.includes(CW.lastCk)){ const [a,b]=[ids.indexOf(CW.lastCk), ids.indexOf(id)].sort((p,q)=>p-q); ids.slice(a,b+1).forEach(z=>on?CW.sel.add(z):CW.sel.delete(z)); }
      else on?CW.sel.add(id):CW.sel.delete(id);
      CW.lastCk=id; cwList(); cwFoot(); return; }
    if (t.closest('.ck')) return;
    const cat=t.closest('[data-cat]'); if (cat){ F.cat=cat.dataset.cat; F.f={}; F.rng={}; CW.limit=150; d.classList.remove('navon'); cwNav(); cwList(); $('#cwList').scrollTop=0; return; }
    if (t.closest('[data-more]')){ CW.limit+=300; cwList(); return; }
    const add=t.closest('[data-add]'); if (add){ return cwAdd([add.closest('.cw-row').dataset.id]); }
    const rc=t.closest('[data-rc]'); if (rc){ const k=rc.dataset.rc, r=F.rng[k]||{min:'',max:''}; const same=String(r.min)===rc.dataset.lo&&String(r.max)===rc.dataset.hi;
      F.rng[k]= same?{min:'',max:''}:{min:rc.dataset.lo,max:rc.dataset.hi}; cwNav(); cwList(); return; }
    const bk=t.closest('[data-bulk]'); if (bk){ const ids=[...CW.sel];
      if (bk.dataset.bulk==='add') return cwAdd(ids); if (bk.dataset.bulk==='move') return cwMoveDlg(ids); if (bk.dataset.bulk==='del') return cwDelete(ids);
      if (bk.dataset.bulk==='clear'){ CW.sel.clear(); cwList(); cwFoot(); } return; }
    const pv=t.closest('[data-pv]'); if (pv && CW.active){ const a=pv.dataset.pv, id=CW.active;
      if (a==='add') return cwAdd([id]); if (a==='edit') return cwEdit(id); if (a==='dup') return cwDup(id); if (a==='del') return cwDelete([id]);
      if (a==='close'){ CW.active=null; cwActivate(null); } return; }
    const row=t.closest('.cw-row'); if (row){ cwActivate(row.dataset.id); return; }
    const c=t.closest('[data-cw]'); if (!c) return;
    switch (c.dataset.cw){
      case 'close': return cwClose();
      case 'done': cwClose(); if (CW.optFor==null && STEP!=='equip') goStep('equip'); return;
      case 'max': d.classList.toggle('max'); cwSaveSize(d); return;
      case 'nav': d.classList.toggle('navon'); return;
      case 'reset': Object.assign(F,{maker:'',series:'',f:{},rng:{},priced:false}); cwNav(); cwList(); return;
      case 'undo': return cwUndo();
      case 'newtype': return cwNewType(id=>{ F.cat=id; F.f={}; F.rng={}; cwRedraw(); });
      case 'new': return F.cat ? cwNew(F.cat) : cwPickType(cwNew);
      case 'xls': return openXlsImport(F.cat);
      case 'types': return openTypesEditor();
      case 'exp': return cwExport();
      case 'imp': { const f=document.createElement('input'); f.type='file'; f.accept='.json,application/json'; f.hidden=true;
        f.onchange=()=>{ const file=f.files[0]; f.remove(); if (file) cwImportFile(file); }; d.appendChild(f); f.click(); return; }
    } });
  d.addEventListener('dblclick', e=>{ const row=e.target.closest('.cw-row'); if (row && !e.target.closest('button,label,input')) cwEdit(row.dataset.id); });
  d.addEventListener('keydown', e=>{ if (e.target.id==='cwQ' && e.key==='Enter'){ e.preventDefault(); const x=CW.view[0]; if (x) cwActivate(x.id); }
    if ((e.key==='ArrowDown'||e.key==='ArrowUp') && (e.target.id==='cwQ' || e.target.closest?.('.cw-list')) && CW.view.length){
      e.preventDefault(); const ids=CW.view.slice(0,CW.limit).map(x=>x.id); let k=ids.indexOf(CW.active); k = k<0 ? 0 : Math.max(0, Math.min(ids.length-1, k+(e.key==='ArrowDown'?1:-1)));
      cwActivate(ids[k]); document.querySelector(`#cwList .cw-row[data-id="${CSS.escape(ids[k])}"]`)?.scrollIntoView({block:'nearest'}); } });
  // перенос перетаскиванием: позиция (или все отмеченные, если тянут отмеченную) → категория слева
  d.addEventListener('dragstart', e=>{ const row=e.target.closest?.('.cw-row'); if (!row || CW.optFor!=null) return;
    const id=row.dataset.id; CW.drag = CW.sel.has(id) ? [...CW.sel] : [id];
    e.dataTransfer.effectAllowed='move'; e.dataTransfer.setData('text/plain', CW.drag.length>1 ? `${CW.drag.length} позиций` : (CW.docs.find(z=>z.id===id)?.name||''));
    d.classList.add('dragging'); });
  d.addEventListener('dragend', ()=>{ CW.drag=null; d.classList.remove('dragging'); d.querySelectorAll('.cw-cat.over').forEach(b=>b.classList.remove('over')); });
  ['dragover','dragleave','drop'].forEach(ev=>d.addEventListener(ev, e=>{ const b=e.target.closest?.('[data-dropcat]'); if (!b || !CW.drag) return;
    e.preventDefault(); b.classList.toggle('over', ev==='dragover');
    if (ev==='drop'){ const ids=CW.drag; CW.drag=null; d.classList.remove('dragging'); cwMove(ids, b.dataset.dropcat); } }));
}

// после окон поверх каталога (типы оборудования, импорт из Excel) — обновить категории и список
document.addEventListener('close', e=>{ if (e.target.id==='dlg' && $('#catdlg')?.open && !CW.busy) cwRedraw(); }, true);
