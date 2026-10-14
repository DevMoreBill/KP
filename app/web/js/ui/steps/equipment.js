// Раздел 2 «Оборудование»: карточки позиций, быстрый поиск по каталогу.
'use strict';

function stepItems(){
  const n=S.items.length, units=S.items.reduce((s,x)=>s+(+x.qty||0),0);
  const quick=`<div class="qadd"><input type="text" id="quickAdd" placeholder="Быстрый поиск по каталогу: модель, производитель, мощность…  (Enter — добавить первую)" autocomplete="off" aria-label="Быстрый поиск по каталогу"><div id="qaList" class="qa-list" hidden></div></div>`;
  if (!n){
    const cnt=new Map(); catCache.forEach(x=>{ const c=attrsOf(x).cat; cnt.set(c,(cnt.get(c)||0)+1); });
    const stTiles=TYPES.filter(t=>t.station).map(t=>`<button type="button" class="tile st" data-a="addStation" data-cat="${esc(t.id)}"><b>${esc(t.item)}</b><span>в контейнере — собрать</span></button>`).join('');
    const tiles=TYPES.filter(t=>t.role!=='accessory' && !t.station).map(t=>{ const k=cnt.get(t.id)||0;
      return `<button type="button" class="tile${k?'':' zero'}" data-a="catOf" data-cat="${esc(t.id)}"><b>${esc(t.name)}</b><span>${k?`в каталоге: ${k}`:'каталог пуст — добавить вручную'}</span></button>`; }).join('');
    return `<section class="step" id="st-items"><h2><span class="n">2</span>Оборудование${tip('Найдите модель в строке поиска или выберите вид оборудования — фото, характеристики и титул подставятся из каталога. Станцию в контейнере (насосную, компрессорную, ДГУ) собирают из контейнера, основного оборудования и систем. Чего нет в каталоге — «+ Новое оборудование»: по ссылке на сайт, с помощью любого ИИ, таблицей или вручную.')}</h2>
    ${quick}
    <p class="sub tiles-h">Станции в контейнере</p><div class="tiles">${stTiles}</div>
    <p class="sub tiles-h">Оборудование из каталога</p>
    <div class="tiles">${tiles}<button type="button" class="tile add" data-a="addItem"><b>+ Новое оборудование</b><span>нет в каталоге — заполнить по ссылке, с ИИ или вручную</span></button></div></section>`;
  }
  return `<section class="step" id="st-items"><h2><span class="n">2</span>Оборудование${tip('<p>«Изменить» — описание, фото, характеристики и опции позиции.</p><p>«Страница оборудования» — отдельный лист в КП с фото и характеристиками.</p><p>Цены, закупка и скидка — в разделе «Цены и валюта».</p>')}</h2>
  <div class="eq-bar"><button class="btn primary" type="button" data-a="openCatalog">+ Из каталога</button><button class="btn" type="button" data-a="addItem" title="Нет в каталоге: по ссылке на сайт, с помощью ИИ, таблицей или вручную">+ Новое оборудование</button>${FEAT.on('stations')?'<button class="btn" type="button" data-a="addStation">+ Станция в контейнере</button>':''}
    <span class="muted">${n} ${plural(n,'позиция','позиции','позиций')} · ${units} ед.</span></div>
  ${quick}
  ${S.items.map((x,i)=>itemCard(x,i)).join('')}</section>`;
}

function itemCard(x,i){
  const P=`items.${i}`, t=typeById(attrsOf(x).cat);
  const nf=(x.features||[]).filter(f=>f.label||f.text).length;
  const nr=(x.groups||[]).reduce((s,g)=>s+(g.rows||[]).filter(r=>r.k||r.v).length,0);
  const chk=(tab,label,ok,need)=>`<button type="button" class="rd ${ok?'ok':(need?'warn':'')}" data-a="${tab==='price'?'toPrice':'edit'}" data-i="${i}" data-tab="${tab}" title="${ok?'Заполнено':'Не заполнено — нажмите, чтобы добавить'}">${ok?'✓':(need?'!':'+')} ${label}</button>`;
  const opts=(x.options||[]).filter(o=>o.name);
  // показываем только то, чего не хватает: заполненное не отвлекает
  const miss=[chk('desc','Фото',!!x.photo,x.page),chk('desc','Описание',nf>0,x.page),chk('spec','Характеристики',nr>0,x.page),chk('price','Цена',x.price>0,true)].filter((h,k)=>!h.includes('class="rd ok"'));
  return `<div class="item" id="item-${x.id}">
   <div class="icard">
     <button type="button" class="ithumb" data-a="edit" data-i="${i}" data-tab="desc" data-thumb="${i}" title="Нажмите — фото и описание. Главное фото можно перетащить сюда или вставить (Ctrl+V), наведя курсор">${x.photo?`<img src="${esc(x.photo.src)}" alt="">`:'<span>+ фото</span>'}</button>
     <div class="imain">
       <div class="itop"><span class="item-no">${i+1}</span><span class="ttype">${esc(t.item||t.name)}</span></div>
       <textarea class="iname" rows="${x.name.length>60?2:1}" data-p="${P}.name" placeholder="Наименование позиции" aria-label="Наименование">${esc(x.name)}</textarea>
       <div class="ikp">${esc(mainLine(x,4)||x.spec||'Параметры не заполнены')}</div>
       ${miss.length?`<div class="ready">${miss.join('')}</div>`:''}
       <div class="iopts">${opts.map((o)=>{ const j=(x.options||[]).indexOf(o); return `<span class="oitem">${esc(o.short||o.name)}${+o.qty>1?' × '+esc(o.qty):''}${o.price?' · '+money(o.price*(+o.qty||1)):' · включено'}<button type="button" data-a="delOpt" data-i="${i}" data-j="${j}" aria-label="Убрать опцию">✕</button></span>`; }).join('')}
         <button type="button" class="chip sm" data-a="edit" data-i="${i}" data-tab="opts">+ Опции и услуги</button>
         ${StationUi.chip(x,i)}${canKit(x)?`<button type="button" class="chip sm${isKit(x)?' on':''}" data-a="edit" data-i="${i}" data-tab="kit" title="Контейнер, основное оборудование, обвязка и системы: у каждого элемента — своё описание, закупка и поставщик">${isKit(x)?`Состав станции: ${kitParts(x).length} ${plural(kitParts(x).length,'элемент','элемента','элементов')}`:'+ Состав станции'}</button>`:''}</div>
     </div>
     <div class="iside">
       <label class="f"><span>Количество, шт.</span><div class="qty"><button type="button" data-a="qty" data-i="${i}" data-d="-1" aria-label="Меньше">−</button><input type="text" inputmode="numeric" data-p="${P}.qty" value="${esc(x.qty)}" class="${+x.qty>=1&&Number.isInteger(+x.qty)?'':'bad'}"><button type="button" data-a="qty" data-i="${i}" data-d="1" aria-label="Больше">+</button></div></label>
       <div class="f"><span>Цена за ед., ${curSh(kpCur())}</span><button type="button" class="pricebox${x.price?'':' empty'}" data-a="toPrice">${x.price?fmtPrice(x.price):'задать цену'}</button></div>
       <div class="isum">Сумма: <b data-sum="${i}">${money(itemSum(x))}</b></div>
     </div>
   </div>
   <div class="ifoot">
     <button class="btn primary" type="button" data-a="edit" data-i="${i}" data-tab="main">Изменить</button>
     <button class="btn ghost" type="button" data-a="dupItem" data-i="${i}" title="Добавить копию позиции — например, для варианта с другой опцией">Дублировать</button>
     <button class="sw" type="button" role="switch" aria-checked="${!!x.page}" data-a="togglePage" data-i="${i}" title="Отдельная страница с фото, описанием и характеристиками"><i></i>Страница оборудования</button>
     <span style="flex:1"></span>
     <button class="icon" type="button" data-a="up" data-i="${i}" aria-label="Выше" ${i===0?'disabled':''}>↑</button>
     <button class="icon" type="button" data-a="down" data-i="${i}" aria-label="Ниже" ${i===S.items.length-1?'disabled':''}>↓</button>
     <button class="icon" type="button" data-a="delItem" data-i="${i}" aria-label="Удалить позицию">✕</button>
   </div>
  </div>`;
}

// строка быстрого поиска карточки — один раз на карточку и её разбор (карточки каталога на месте не меняются, разбор
// сбрасывается при смене категорий): без запоминания каждое нажатие клавиши нормализовало текст 7000+ карточек
class QuickFind {
  static HAY = new WeakMap();
  static hay(x, a){ const c=this.HAY.get(x); if (c && c.a===a) return c.h;
    const h=norm([x.name,x.spec,a.maker,a.model,a.series,a.engine,a.alternator].join(' ')); this.HAY.set(x, {a, h}); return h; }
}

function quickMatches(q){
  const w=norm(q).split(' ').filter(Boolean); if(!w.length) return [];
  const res=[];
  for (const x of catCache){ const a=attrsOf(x); if (typeById(a.cat).role==='accessory') continue;
    const hay=QuickFind.hay(x, a);
    if (w.every(v=>hay.includes(v))) res.push(x); if (res.length>=40) break; }
  const mv=x=>numOf(attrsOf(x)[typeById(attrsOf(x).cat).main||'kw'])??9e9;
  return res.sort((p,q)=>String(attrsOf(p).cat).localeCompare(attrsOf(q).cat)||mv(p)-mv(q)).slice(0,8);
}

async function addFromCatalog(x){
  x=await fullDoc(x); const it=newItem(); fillFromCat(it,x);
  const blank=S.items.length===1 && !S.items[0].name.trim() && !S.items[0].price;
  if (blank) S.items=[it]; else S.items.push(it);
  renderForm(); persist(); toast('Добавлено: '+x.name);
  setTimeout(()=>document.getElementById('item-'+it.id)?.scrollIntoView({behavior:'smooth',block:'center'}),60);
}

document.addEventListener('input', e=>{ if (e.target.id!=='quickAdd') return; const L=$('#qaList'); const res=quickMatches(e.target.value);
  L.hidden=!e.target.value.trim(); L.innerHTML = res.length ? res.map((x,k)=>`<button type="button" data-qa="${esc(x.id)}" class="${k===0?'first':''}">${x.photo?`<img src="${esc(x.photo.src)}" alt="">`:'<i></i>'}<span><b>${esc(x.name)}</b><small>${esc(mainLine(x,3)||x.spec||'')}${x.price?' · '+money(x.price)+' '+curSh(x.priceCur||'RUB'):''}</small></span><em>Добавить</em></button>`).join('')
    : `<p class="muted" style="margin:10px 14px">Ничего не найдено. <button class="btn ghost" type="button" data-a="openCatalog">Открыть каталог с фильтрами</button></p>`; });

document.addEventListener('keydown', e=>{ if (e.target.id!=='quickAdd') return;
  if (e.key==='Enter'){ const x=quickMatches(e.target.value)[0]; if (x){ e.preventDefault(); e.target.value=''; addFromCatalog(x); setTimeout(()=>$('#quickAdd')?.focus(),80); } }
  if (e.key==='Escape'){ e.target.value=''; $('#qaList').hidden=true; } });

document.addEventListener('click', e=>{ const b=e.target.closest('[data-qa]'); if (b){ const x=CatFind.id(b.dataset.qa); if (x) addFromCatalog(x); return; }
  if (!e.target.closest('.qadd')){ const L=$('#qaList'); if (L) L.hidden=true; } });
