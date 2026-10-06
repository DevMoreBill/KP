// Сборка: одно изделие КП из нескольких элементов (например, ДГУ + насос + контейнер + шасси + глушитель).
// Позиция КП хранит состав в x.kit.parts: [{id, name, qty, cost (коп., за ед.), costCur, sup (поставщик), desc, rows:[{k,v}],
//   photo, catId, attrs:{cat, maker, model}}]. Элемент — из каталога (копия описания, характеристик, фото, закупки) или свой
//   (контейнер под требования заказчика и т. п.).
// • Закупка изделия (x.cost, ₽) — сумма закупок элементов по курсам КП; цена для заказчика — одна, как у обычной позиции.
// • Документ КП: элементы — блоками описания с фото и своими таблицами характеристик (kitDocItem) — в любом шаблоне.
// • Экономика сделки: каждый элемент — отдельная строка закупки со своим поставщиком (kitLines): разные сроки и условия оплаты.
'use strict';

const KIT_PRESETS = ['Контейнер', 'Шасси (прицеп)', 'Глушитель', 'Шкаф АВР', 'Топливный бак', 'Система подогрева', 'Насосный агрегат', 'Монтажный комплект'];

const kitParts = x => (x && x.kit && Array.isArray(x.kit.parts)) ? x.kit.parts : [];
const isKit = x => kitParts(x).length > 0;

function kitNewPart(o={}){ return { id:uid(), name:'', qty:1, cost:0, costCur:'RUB', sup:'', desc:'', rows:[], ...o }; }

// закупка изделия за единицу, коп. ₽; NaN — нет курса валюты элемента
function kitCost(x){
  let s=0; for (const p of kitParts(x)){ if (!p.cost) continue; const c=p.costCur||'RUB', r=c==='RUB'?1:rateOf(c); if (!(r>0)) return NaN; s+=p.cost*(+p.qty||0)*r; }
  return Math.round(s);
}
function kitSync(x){ if (!isKit(x)) return false; const c=kitCost(x); if (!Number.isFinite(c)) return false;
  const ch=x.cost!==c || (x.costCur||'RUB')!=='RUB'; x.cost=c; x.costCur='RUB'; return ch; }

// элемент из позиции каталога: название, закупка, поставщик (производитель), суть описания, основные характеристики, фото
function kitFromCat(doc){
  const a=doc.attrs||{}, feats=(doc.features||[]).filter(f=>f.text);
  const desc=feats.map(f=>(f.label&&!/^(описание|о серии|назначение)$/i.test(f.label)?f.label+': ':'')+f.text.trim()).join(' ').slice(0,700);
  const rows=(doc.groups||[]).flatMap(g=>(g.rows||[]).filter(r=>r.k&&r.v)).slice(0,14).map(r=>({k:r.k, v:r.v}));
  return kitNewPart({ name:doc.name||'', catId:doc.id, cost:doc.cost||0, costCur:doc.costCur||'RUB', sup:a.maker||'', desc, rows,
    photo:doc.photo&&doc.photo.src?{src:doc.photo.src, w:doc.photo.w, h:doc.photo.h}:null, attrs:{cat:a.cat||'', maker:a.maker||'', model:a.model||''} });
}

// позиция для документа: состав — блоками описания (с фото) и таблицами характеристик элементов
function kitDocItem(x){
  if (!isKit(x)) return x;
  const parts=kitParts(x).filter(p=>String(p.name||'').trim());
  const q=p=>(+p.qty||1)>1?` × ${p.qty}`:'';
  const list={id:'kit_all', label:'Состав изделия', text:parts.map(p=>`${p.name.trim()}${q(p)}`).join('; ')+'.'};
  const feats=parts.map(p=>{ const rowTxt=(p.rows||[]).filter(r=>r.k&&r.v).slice(0,5).map(r=>`${r.k} — ${r.v}`).join('; ');
    return {id:'kit_'+p.id, label:p.name.trim()+q(p), text:String(p.desc||'').trim() || (rowTxt?rowTxt+'.':'')}; }).filter(f=>f.text);
  const groups=parts.filter(p=>(p.rows||[]).some(r=>r.k&&r.v)).map(p=>({name:p.name.trim(), rows:p.rows.filter(r=>r.k&&r.v).map(r=>({k:r.k, v:r.v, hl:false}))}));
  const gal=parts.filter(p=>p.photo&&p.photo.src&&feats.some(f=>f.id==='kit_'+p.id)).map(p=>({id:'kitg_'+p.id, src:p.photo.src, w:p.photo.w, h:p.photo.h, caption:p.name.trim(), slot:'', at:'feat:kit_'+p.id, on:true}));
  return { ...x, page:true, spec:x.spec||('В составе: '+parts.map(p=>p.name.trim()).join(', ')).slice(0,200),
    features:[...(x.features||[]).filter(f=>f.label||f.text), list, ...feats], groups:[...(x.groups||[]), ...groups], gallery:[...(x.gallery||[]), ...gal] };
}

// строки закупки для экономики сделки: элемент сборки — своя строка (своя валюта и поставщик); обычная позиция — как есть
function kitLines(st=S){
  const out=[];
  (st.items||[]).forEach((x,i)=>{ if (!String(x.name||'').trim() && !x.cost) return;
    if (!isKit(x)){ out.push({id:x.id, i, name:x.name, qty:+x.qty||0, cost:x.cost||0, costCur:x.costCur||'RUB', maker:attrsOf(x).maker||'', item:x}); return; }
    kitParts(x).forEach((p,j)=>{ if (!String(p.name||'').trim() && !p.cost) return;
      out.push({id:x.id+'~'+p.id, i, j, part:p, name:p.name||'Элемент', of:x.name, qty:(+x.qty||0)*(+p.qty||0), cost:p.cost||0, costCur:p.costCur||'RUB',
        maker:p.sup||(p.attrs&&p.attrs.maker)||'', item:{id:x.id+'~'+p.id, catId:p.catId||'', name:p.name, attrs:{...(p.attrs||{}), cat:(p.attrs&&p.attrs.cat)||attrsOf(x).cat}}}); }); });
  return out;
}

// груз для логистики: обычная позиция — как есть; сборка — элементами (каждый едет от своего поставщика).
// Характеристики элемента — его таблица (та же ссылка: габариты и масса, вписанные в логистике, сохраняются в элементе)
function kitCargo(st=S){
  return (st.items||[]).flatMap(x=>!isKit(x) ? [x] : kitParts(x).map(p=>{ p.rows=p.rows||[];
    return {id:x.id+'~'+p.id, name:`${p.name||'Элемент'} (${x.name})`, qty:(+x.qty||0)*(+p.qty||0), groups:[{name:p.name, rows:p.rows}], cost:p.cost, costCur:p.costCur||'RUB', price:0, catId:p.catId||''}; }));
}

// ---------- вкладка «Состав» в карточке позиции
function edKit(x,i){
  const P=`items.${i}.kit.parts`, parts=kitParts(x), cost=kitCost(x);
  const card=(p,j)=>{ const ct=p._costText ?? (p.cost?String(p.cost/100).replace('.',','):'');
    return `<div class="kit-card" data-kitj="${j}">
    <div class="kit-h"><span class="kit-n">${j+1}</span>
      <input type="text" data-p="${P}.${j}.name" value="${esc(p.name)}" placeholder="Например, контейнер 20 футов под ДГУ" aria-label="Название элемента" class="kit-nm${p.name?'':' need'}">
      <button class="icon" type="button" data-a="kitMv" data-i="${i}" data-j="${j}" data-d="-1" ${j?'':'disabled'} aria-label="Выше">↑</button><button class="icon" type="button" data-a="kitMv" data-i="${i}" data-j="${j}" data-d="1" ${j<parts.length-1?'':'disabled'} aria-label="Ниже">↓</button>
      <button class="icon" type="button" data-a="kitDel" data-i="${i}" data-j="${j}" aria-label="Убрать элемент">✕</button></div>
    <div class="kit-g">
      <label class="f"><span>Кол-во</span><input type="text" inputmode="numeric" data-p="${P}.${j}.qty" value="${esc(p.qty)}"></label>
      <label class="f"><span>Закупка за ед.</span><span class="kit-cost"><input type="text" inputmode="decimal" data-kitcost="${i}.${j}" value="${esc(ct)}" placeholder="цена из счёта"><select data-kitcur="${i}.${j}" aria-label="Валюта закупки">${DEAL_CURS.map(c=>`<option${(p.costCur||'RUB')===c?' selected':''}>${c}</option>`).join('')}</select></span></label>
      <label class="f kit-sup"><span>Поставщик${tip('У кого покупаем этот элемент. В «Экономике сделки» элементы с разными поставщиками попадут в разные карточки — со своими сроками и условиями оплаты.')}</span><input type="text" data-p="${P}.${j}.sup" value="${esc(p.sup)}" list="kitSupL" placeholder="Производитель или поставщик" autocomplete="off"></label>
    </div>
    <div class="kit-b">
      <div class="kit-ph">${p.photo&&p.photo.src?`<img src="${esc(p.photo.src)}" alt=""><button class="icon x" type="button" data-a="kitPhotoDel" data-i="${i}" data-j="${j}" aria-label="Убрать фото">✕</button>`:`<button type="button" class="kit-phb" data-a="kitPhoto" data-i="${i}" data-j="${j}">+ фото</button>`}</div>
      <label class="f kit-desc"><span>Техническое описание${p.catId?' <small class="muted">из каталога</small>':''}</span><textarea rows="3" data-p="${P}.${j}.desc" placeholder="Назначение, конструкция, комплектация элемента — попадёт в КП блоком описания">${esc(p.desc||'')}</textarea></label></div>
    <details class="kit-rows"${(p.rows||[]).length?' open':''}><summary>Характеристики элемента <span class="muted">${(p.rows||[]).length?(p.rows.length+' '+plural(p.rows.length,'строка','строки','строк')):'— таблица в КП под описанием'}</span></summary>
      ${(p.rows||[]).map((r,k)=>`<div class="kit-row"><input type="text" data-p="${P}.${j}.rows.${k}.k" value="${esc(r.k)}" placeholder="Параметр"><input type="text" data-p="${P}.${j}.rows.${k}.v" value="${esc(r.v)}" placeholder="Значение"><button class="icon" type="button" data-a="kitRowDel" data-i="${i}" data-j="${j}" data-k="${k}" aria-label="Убрать строку">✕</button></div>`).join('')}
      <button class="btn ghost" type="button" data-a="kitRowAdd" data-i="${i}" data-j="${j}">+ строка</button></details>
  </div>`; };
  const sups=[...new Set([...(typeof DL!=='undefined'&&DL.sups||[]).map(s=>s.name), ...catCache.map(c=>attrsOf(c).maker)].filter(Boolean))].slice(0,400);
  return `<div class="ed-sec"><p class="sub">Состав изделия${tip('Когда КП — это одно готовое изделие из нескольких единиц оборудования: например, ДГУ, насос и контейнер под требования заказчика. Цена для заказчика — одна (вкладка «Основное» и шаг «Цены»), а закупка, поставщики и описание — по каждому элементу.')}</p>
    ${parts.length?'':`<p class="muted">Добавьте элементы — из каталога или свои. В КП изделие будет одной строкой с одной ценой, а на странице оборудования — состав и описание каждого элемента. В «Экономике сделки» у каждого элемента — свой поставщик, сроки и оплата.</p>`}
    <div class="kit-l">${parts.map(card).join('')}</div>
    <datalist id="kitSupL">${sups.map(s=>`<option value="${esc(s)}">`).join('')}</datalist>
    <div class="row kit-add"><button class="btn" type="button" data-a="kitCat" data-i="${i}">+ Из каталога</button><button class="btn ghost" type="button" data-a="kitAdd" data-i="${i}">+ Свой элемент</button>
      <span class="chips">${KIT_PRESETS.map(n=>`<button class="chip" type="button" data-a="kitAdd" data-i="${i}" data-n="${esc(n)}">+ ${esc(n)}</button>`).join('')}</span></div>
    ${parts.length?`<div class="kit-sum"><span>Закупка изделия${parts.some(p=>p.costCur&&p.costCur!=='RUB')?' (по курсам КП)':''}</span><b>${Number.isFinite(cost)?money(cost)+' ₽':'нет курса валюты — укажите в шаге «Цены»'}</b>
      ${parts.some(p=>!p.cost)?`<small class="warn-t">не указана закупка: ${parts.filter(p=>!p.cost).map(p=>esc(p.name||'без названия')).join(', ')}</small>`:''}</div>`:''}</div>`;
}

// выбор позиции каталога для элемента сборки
function kitPickCat(i){
  const d=$('#dlg'); d.classList.add('wide');
  const draw=q=>{ const n=norm(q||''), list=catCache.filter(x=>!n || norm(x.name+' '+(attrsOf(x).maker||'')+' '+(attrsOf(x).model||'')).includes(n)).slice(0,60);
    return list.map(x=>`<button type="button" class="kit-pick" data-cid="${esc(x.id)}">${x.photo&&x.photo.src?`<img src="${esc(x.photo.src)}" alt="">`:'<span class="kit-noimg"></span>'}<span><b>${esc(x.name)}</b><small class="muted">${esc(typeById(attrsOf(x).cat).name)}${x.cost?' · закупка '+money(x.cost)+' '+(x.costCur||'RUB'):''}</small></span></button>`).join('') || '<p class="muted">Ничего не найдено — добавьте свой элемент.</p>'; };
  d.innerHTML=`<div class="dlg-h"><h3>Элемент сборки из каталога</h3><button class="icon" type="button" data-close aria-label="Закрыть">✕</button></div>
    <div class="dlg-b"><input type="search" id="kitQ" placeholder="Модель, производитель, название" autocomplete="off"><div class="kit-pl" id="kitPL">${draw('')}</div></div>`;
  d.showModal(); d.querySelector('[data-close]').onclick=()=>d.close();
  $('#kitQ').oninput=e=>{ $('#kitPL').innerHTML=draw(e.target.value); }; setTimeout(()=>$('#kitQ')?.focus(), 30);
  $('#kitPL').onclick=async e=>{ const b=e.target.closest('[data-cid]'); if (!b) return; const lite=catCache.find(x=>x.id===b.dataset.cid);
    let doc=lite; try{ doc=await api('/api/catalog/'+encodeURIComponent(lite.id)); }catch(_){}
    const it=S.items[i]; it.kit=it.kit||{parts:[]}; it.kit.parts.push(kitFromCat(doc)); kitSync(it); d.close(); renderForm(); persist(); toast('Элемент добавлен: '+doc.name); };
}

// действия вкладки «Состав» (вызываются из общего обработчика кнопок data-a)
function kitAction(a, i, b){
  const it=S.items[i]; if (!it) return false; it.kit=it.kit||{parts:[]}; const P=it.kit.parts, j=+b.dataset.j;
  if (a==='kitAdd'){ P.push(kitNewPart({name:b.dataset.n||''})); it.page=true; return true; }
  if (a==='kitCat'){ kitPickCat(i); return 'async'; }
  if (a==='kitDel'){ if (!confirm(`Убрать из состава «${P[j].name||'элемент'}»?`)) return 'async'; P.splice(j,1); kitSync(it); return true; }
  if (a==='kitMv'){ const k=j+(+b.dataset.d); if (P[k]){ [P[j],P[k]]=[P[k],P[j]]; } return true; }
  if (a==='kitRowAdd'){ (P[j].rows=P[j].rows||[]).push({k:'',v:''}); return true; }
  if (a==='kitRowDel'){ P[j].rows.splice(+b.dataset.k,1); return true; }
  if (a==='kitPhotoDel'){ P[j].photo=null; return true; }
  if (a==='kitPhoto'){ const f=$('#filePick'); f.value=''; f.multiple=false;
    f.onchange=async()=>{ const fl=f.files[0]; if (!fl) return; try{ P[j].photo=await prepGallery(fl); renderForm(); persist(); }catch(e){ toast('Не удалось открыть изображение'); } }; f.click(); return 'async'; }
  return false;
}

document.addEventListener('input', e=>{ const t=e.target; if (t.dataset.kitcost==null) return;
  const [i,j]=t.dataset.kitcost.split('.').map(Number), it=S.items[i], p=kitParts(it)[j]; if (!p) return;
  const n=dNum(t.value); p._costText=t.value; t.classList.toggle('bad', Number.isNaN(n)); if (!Number.isNaN(n)) p.cost=n==null?0:Math.round(n*100);
  kitSync(it); updateLive(); persist(); if (typeof dealRender==='function') dealRender(); });
document.addEventListener('focusout', e=>{ const t=e.target; if (t.dataset.kitcost==null) return;
  const [i,j]=t.dataset.kitcost.split('.').map(Number), p=kitParts(S.items[i])[j]; if (p && !Number.isNaN(dNum(p._costText))) delete p._costText; renderForm(); if (typeof dealRender==='function') dealRender(); });
document.addEventListener('change', e=>{ const t=e.target;
  if (t.dataset.kitcur!=null){ const [i,j]=t.dataset.kitcur.split('.').map(Number), it=S.items[i], p=kitParts(it)[j]; if (!p) return;
    p.costCur=t.value; if (t.value!=='RUB' && !(rateOf(t.value)>0)) loadCBR(); kitSync(it); renderForm(); persist(); if (typeof dealRender==='function') dealRender(); return; }
  if (/^items\.\d+\.kit\.parts\.\d+\.qty$/.test(t.dataset.p||'')){ const it=S.items[+t.dataset.p.split('.')[1]]; kitSync(it); renderForm(); persist(); } });
