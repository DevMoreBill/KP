// Карточка позиции (окно с вкладками): основное, описание и фото, характеристики, опции, автозаполнение.
'use strict';

function optsBlock(x,i){
  const P=`items.${i}`, opts=x.options||[];
  const rows = opts.map((o,j)=>{ const pt=o._priceText ?? (o.price?money(o.price):'');
    return `<div class="opt"><input type="text" data-p="${P}.options.${j}.name" value="${esc(o.name)}" placeholder="Наименование опции или услуги" list="optNames" autocomplete="off" aria-label="Опция">
    <input type="text" inputmode="numeric" data-p="${P}.options.${j}.qty" value="${esc(o.qty)}" class="${+o.qty>=1?'':'bad'}" aria-label="Количество" title="Количество, ${esc(o.unit||'шт.')}">
    <input type="text" inputmode="decimal" class="num${Number.isNaN(parsePrice(pt))?' bad':''}" data-oprice="${i}.${j}" value="${esc(pt)}" placeholder="включено" aria-label="Цена за единицу">
    <span class="s" data-osum="${i}.${j}">${o.price?money((+o.qty||0)*o.price):'—'}</span>
    <button class="icon" type="button" data-a="delOpt" data-i="${i}" data-j="${j}" aria-label="Удалить опцию">✕</button></div>`; }).join('');
  const have=new Set(opts.map(o=>norm(o.name)));
  const PR=presetsFor(x);
  const chips=PR.map((p,k)=>`<button class="chip${have.has(norm(p.name))?' on':''}" type="button" data-a="optPreset" data-i="${i}" data-k="${k}" aria-pressed="${have.has(norm(p.name))}">${esc(p.short)}</button>`).join('');
  return `<div class="opts"><p class="sub">Дополнительное оборудование и услуги ${opts.length?`<span class="muted">${opts.length} ${plural(opts.length,'опция','опции','опций')}</span>`:''}</p>
   <div class="chips">${chips}</div>${rows}
   <div class="row"><button class="btn ghost" type="button" data-a="addOpt" data-i="${i}">+ своя опция</button>
   ${opts.length?'<span class="muted">Пустая цена — «включено в стоимость».</span>':''}</div></div>`;
}

function attrsBlock(x,i){
  const P=`items.${i}.attrs`, a=x.attrs||{}, auto=attrsOf(x), cat=auto.cat, t=typeById(cat);
  const inp=(f)=>{ const val=a[f.key]??''; const ph=auto[f.key]!=null&&auto[f.key]!==''?String(auto[f.key]):'';
    if (f.values&&f.values.length) return `<label class="f"><span>${esc(f.label)}${f.unit?', '+esc(f.unit):''}</span><select data-p="${P}.${f.key}"><option value="">${ph?esc(ph)+' (авто)':'—'}</option>${f.values.map(v=>`<option${String(val)===String(v)?' selected':''}>${esc(v)}</option>`).join('')}</select></label>`;
    return `<label class="f"><span>${esc(f.label)}${f.unit?', '+esc(f.unit):''}</span><input type="text" ${f.num?'inputmode="decimal"':''} data-p="${P}.${f.key}" value="${esc(val)}" placeholder="${esc(ph)}" autocomplete="off"></label>`; };
  // параметры — по группам категории (основные, двигатель, комплектация, применимость…)
  const grp=new Map(); for (const f of t.fields){ const g=f.group||'Основные'; if(!grp.has(g)) grp.set(g,[]); grp.get(g).push(f); }
  return `<div><div class="sub">Категория и параметры${tip(`Набор параметров зависит от категории «${esc(t.name)}». Они работают в фильтрах каталога, на титуле и в карточке. Пустые поля заполняются из характеристик — серым показано, что будет подставлено.`)} <button class="btn ghost" type="button" data-a="autoAttrs" data-i="${i}">Определить по характеристикам</button>
      <button class="btn ghost" type="button" data-a="attrsToGroups" data-i="${i}">Сформировать таблицу характеристик</button></div>
   <div class="attrs"><label class="f"><span>Категория</span><select data-p="${P}.cat" data-retype="${i}">${typeOptionsHtml(cat)}</select></label>
   ${inp({key:'maker',label:'Производитель'})}${inp({key:'series',label:'Серия'})}${inp({key:'model',label:'Модель'})}</div>
   ${[...grp.entries()].map(([g,fs])=>`<p class="agrp">${esc(g)}</p><div class="attrs">${fs.map(inp).join('')}</div>`).join('')}</div>`;
}

// место для картинки: нажать — файл; перетащить файл или картинку с сайта; Ctrl+V или «Вставить из буфера»
function drop(img, kind, i, text, small){
  return `<div class="drop" data-drop="${kind}" data-i="${i}" tabindex="0" role="button" aria-label="${kind==='logo'?'Загрузить логотип':'Загрузить фото'}" style="${small?'min-height:80px':''}">
    ${img?`<img src="${esc(img.src)}" alt=""><button class="icon x" type="button" data-a="rmImg" data-k="${kind}" data-i="${i}" aria-label="Убрать">✕</button>`:`<span>${text}</span>`}</div>
    <div class="imgbar"><button type="button" class="lnk" data-a="pickImg" data-k="${kind}" data-i="${i}">Выбрать файл</button><button type="button" class="lnk" data-imgpaste>Вставить из буфера</button>${kind==='logo'&&img&&img.auto?`<span class="muted">по производителю «${esc(img.auto)}»</span>`:''}</div>`;
}

let EDIT=null;

const ED_TABS=[['main','Основное'],['kit','Состав станции'],['layout','Компоновка'],['ai','✨ Заполнить с ИИ'],['desc','Описание и фото'],['spec','Характеристики'],['opts','Опции и услуги']];
// вкладки позиции: «Состав станции» — только у станций в контейнере (и у сборок, заведённых раньше), «Компоновка» — у станций
const edTabs = x => { const st=!!stationOf(x), T=ED_TABS.filter(([k])=>(k!=='kit' || canKit(x)) && (k!=='layout' || StationUi.on(x)) && (k!=='ai' || (FEAT.on('ai') && !st)));
  return st ? [...T.filter(([k])=>k==='kit' || k==='layout'), ...T.filter(([k])=>k!=='kit' && k!=='layout')] : T; };   // станция: состав и компоновка — первыми

function featId(f){ if(!f.id) f.id=uid(); return f.id; }

function linkOf(x,g){
  if (g.at && g.at.startsWith('feat:')){ const f=(x.features||[]).find(f=>f.id===g.at.slice(5)); if (f) return {kind:'feat',f}; }
  if (g.at && g.at.startsWith('group:')){ const nm=g.at.slice(6); if ((x.groups||[]).some(gr=>gr.name===nm)) return {kind:'group',name:nm}; }
  if (g.at===undefined || g.at===''){
    const c=norm(g.caption||g.slot||''); if (c){
      const f=(x.features||[]).find(f=>f.label && (norm(f.label)===c || c.startsWith(norm(f.label)))); if (f && !(x.gallery||[]).some(o=>o!==g && o.at==='feat:'+featId(f))) return {kind:'feat',f,auto:true};
      const gr=(x.groups||[]).find(gr=>gr.name && norm(gr.name)===c); if (gr) return {kind:'group',name:gr.name,auto:true}; } }
  return {kind:'free'};
}

function featImage(x,f){ return (x.gallery||[]).find(g=>{ const L=linkOf(x,g); return L.kind==='feat' && L.f===f; }); }

function openEditor(i, tab){
  if (S.items[i] && autoLogo(S.items[i])) persist();
  EDIT={i, tab: tab||(S.items[i] && stationOf(S.items[i]) ? 'kit' : 'main')}; const d=$('#edlg'); renderEditor(); if(!d.open) d.showModal();
}

function closeEditor(){ const d=$('#edlg'); EDIT=null; if(d.open) d.close(); renderForm(); persist(); StationImages.syncAll().then(ch=>{ if (ch) renderForm(); }); }

function renderEditor(){
  const d=$('#edlg'); if(!EDIT) return; const i=EDIT.i, x=S.items[i]; if(!x){ closeEditor(); return; }
  if (!edTabs(x).some(([k])=>k===EDIT.tab)) EDIT.tab='main';
  const focusP=document.activeElement?.dataset?.p; const sc=d.querySelector('.ed-b')?.scrollTop||0;
  const body = EDIT.tab==='main'?edMain(x,i): EDIT.tab==='kit'?KitView.render(x,i): EDIT.tab==='layout'?StationUi.tab(x,i): EDIT.tab==='desc'?edDesc(x,i): EDIT.tab==='spec'?edSpec(x,i): EDIT.tab==='opts'?edOpts(x,i): edAI(x,i);
  const head = CATED ? `<h3><span class="ed-cat">Каталог</span>${esc(x.name||'Новая позиция')}</h3><button class="btn" type="button" data-catcancel>Отмена</button>${CW.mod&&!ADMIN.on?'<span class="muted ed-modnote">Изменения будут отправлены на модерацию</span>':''}<button class="btn primary" type="button" data-catsave>${catSaveLabel()}</button>`
    : `<h3>${i+1}. ${esc(x.name||'Новая позиция')}</h3>${S.items.length>1?`<button class="btn ghost" type="button" data-ednav="-1" ${i===0?'disabled':''} title="Предыдущая позиция">←</button><button class="btn ghost" type="button" data-ednav="1" ${i===S.items.length-1?'disabled':''} title="Следующая позиция">→</button>`:''}<button class="btn primary" type="button" data-edclose>Готово</button>`;
  d.classList.toggle('catmode', !!CATED);
  const act=document.activeElement, tabSw=d.dataset.tab!==EDIT.tab; d.dataset.tab=EDIT.tab;
  morph(d, `<div class="dlg-h">${head}</div>
    <div class="ed-tabs">${edTabs(x).map(([k,l])=>`<button type="button" class="ed-tab${EDIT.tab===k?' on':''}" data-edtab="${k}">${l}</button>`).join('')}</div>
    <div class="ed-b">${body}</div>`);
  const b=d.querySelector('.ed-b'); b.scrollTop=tabSw?0:sc;
  const tb=d.querySelector('.ed-tabs'), on=tb.querySelector('.ed-tab.on'); if (on && tb.scrollWidth>tb.clientWidth) tb.scrollLeft=on.offsetLeft-(tb.clientWidth-on.offsetWidth)/2;
  if (focusP && !act.isConnected){ const el=d.querySelector(`[data-p="${CSS.escape(focusP)}"]`); if(el){ el.focus(); try{ const n=el.value.length; el.setSelectionRange(n,n);}catch(e){} } }
}

function edMain(x,i){
  const P=`items.${i}`;
  return `<div class="ed-sec"><div class="grid g2">${field('Наименование в КП',`${P}.name`,{req:1})}${field('Заголовок страницы оборудования',`${P}.pageTitle`,{ph:x.name||'Как в наименовании'})}</div>
    <div class="grid" style="margin-top:12px">${field('Краткие характеристики — строка под названием в таблице КП',`${P}.spec`,{ph:'Двигатель · альтернатор · мощность · габариты'})}</div>
    ${CATED?'':`<div class="row" style="margin-top:12px"><button class="sw" type="button" role="switch" aria-checked="${!!x.page}" data-a="togglePage" data-i="${i}"><i></i>Отдельная страница оборудования в КП (фото, описание, характеристики)</button></div>`}</div>
   ${CATED?catPriceBlock(x):''}
   <div class="ed-sec">${attrsBlock(x,i)}</div>
   ${CATED?'':`<div class="ed-sec row"><button class="btn" type="button" data-a="saveCat" data-i="${i}">Сохранить позицию в каталог</button>${tip('Фото, описание, характеристики, изображения и цена будут доступны в следующих КП.')}</div>`}`;
}

function imgBox(src, attrs, text){ return `<div class="ibox" ${attrs} tabindex="0" role="button">${src?`<img src="${esc(src)}" alt="">`:`<span>${text}</span>`}</div>`; }

// выбор главного фото среди изображений позиции (фото со страницы поставщика, загруженные вручную)
function edMainPick(x,i){
  const free=edFreeGal(x).filter(j=>x.gallery[j] && x.gallery[j].src && x.gallery[j].gen!=='stdraw' && x.gallery[j].gen!=='stschema'); if (!free.length) return '';   // чертёж и схема станции — не фото
  return `<div class="mainpick"><span class="muted">Главное фото — выбрать из изображений позиции:</span>
    <div class="mainpick-l">${free.map(j=>`<button type="button" class="mainpick-i" data-a="galMain" data-i="${i}" data-j="${j}" title="Сделать главным"><img src="${esc(x.gallery[j].src)}" alt=""></button>`).join('')}</div></div>`;
}
// главное фото ↔ изображение галереи: выбранное становится главным, прежнее главное — на его место в галерее
function edSetMain(it, j){
  const g=(it.gallery||[])[j]; if (!g || !g.src) return false;
  const old=it.photo, oldSrc=it.photoSource;
  it.photo={src:g.src, w:g.w, h:g.h}; it.photoSource=g.source||null; delete it.photoFrom;
  if (old && old.src) it.gallery[j]={id:uid(), src:old.src, w:old.w, h:old.h, caption:'', slot:'', wide:g.wide||'', on:g.on!==false, at:g.at, ...(oldSrc?{source:oldSrc}:{})};
  else it.gallery.splice(j,1);
  return true;
}

// станция: главное фото — общий вид изделия (титул и строка КП); можно взять фото любого элемента состава
function edStationPhoto(x,i){
  if (!(typeof stationOf==='function' && stationOf(x))) return '';
  const ps=kitParts(x).map((p,j)=>({p,j})).filter(o=>o.p.photo && o.p.photo.src), cur=x.photo && x.photo.src;
  const from=cur ? ps.find(o=>o.p.photo.src===cur) : null;
  return `<div class="st-ph"><p class="st-phn"><b>Это фото станции целиком</b> — оно стоит в строке КП и на титульном листе. Лучше всего — общий вид станции или контейнера.
      ${from?`Сейчас — фото элемента «${esc(from.p.name||'без названия')}» из состава.`:x.photo&&x.photo.gen==='st3d'?'Сейчас — 3D-вид с вкладки «Компоновка»: он сам обновляется при изменении состава и контейнера.':cur?'Сейчас — своё фото.':StationUi.on(x)?'Фото пока нет — 3D-вид станции вставляется с вкладки «Компоновка».':'Фото пока нет.'}
      Фото компрессора, насоса, осушителя и других элементов — на вкладке «Состав станции»: в КП они стоят рядом с описанием элемента.</p>
    ${ps.length?`<div class="st-phl"><span class="muted">Взять фото элемента состава:</span>${ps.map(({p,j})=>`<button type="button" class="st-phi${p.photo.src===cur?' on':''}" data-a="stPhoto" data-i="${i}" data-j="${j}" title="${esc(p.name||'')}"><img src="${esc(p.photo.src)}" alt=""><small>${esc(p.role==='container'?'контейнер':p.name||'элемент')}</small></button>`).join('')}</div>`:''}</div>`;
}

function edDesc(x,i){
  const P=`items.${i}`, t=typeById(attrsOf(x).cat);
  const slots=(t.gallerySlots||[]).filter(s=>!WIDE_RX.test(s));
  const have=new Set((x.features||[]).map(f=>norm(f.label)));
  const blocks=(x.features||[]).map((f,j)=>{ featId(f); const im=featImage(x,f); const gi=im?(x.gallery||[]).indexOf(im):-1;
    return `<div class="fblock" data-fj="${j}">
      <div class="fimg">${imgBox(im&&im.src,`data-fimg="${i}" data-fid="${esc(f.id)}"`,'+ фото к блоку<br><small>нажмите, перетащите или Ctrl+V</small>')}<button type="button" class="lnk imgp" data-imgpaste="${esc('[data-fimg="'+i+'"][data-fid="'+f.id+'"]')}">Вставить из буфера</button>
        ${im?`<div class="row" style="gap:4px;justify-content:center"><label class="row muted" style="gap:4px"><input type="checkbox" data-gon="${i}" data-j="${gi}" ${im.on===false?'':'checked'} style="width:auto">в КП</label><button class="icon" type="button" data-a="galDel" data-i="${i}" data-j="${gi}" aria-label="Убрать фото">✕</button></div>`:''}</div>
      <div class="ftext"><div class="fhead"><input type="text" data-p="${P}.features.${j}.label" value="${esc(f.label)}" placeholder="Заголовок блока (Двигатель, Альтернатор…)" style="font-weight:600">
        <span class="ed-hdl" draggable="true" data-edrag="feat" data-i="${i}" data-j="${j}" title="Перетащите блок выше или ниже" aria-hidden="true">⠿</span>
        <button class="icon" type="button" data-a="featMv" data-i="${i}" data-j="${j}" data-d="-1" aria-label="Блок выше" title="Выше" ${j===0?'disabled':''}>↑</button><button class="icon" type="button" data-a="featMv" data-i="${i}" data-j="${j}" data-d="1" aria-label="Блок ниже" title="Ниже" ${j===(x.features||[]).length-1?'disabled':''}>↓</button><button class="icon" type="button" data-a="delFeat" data-i="${i}" data-j="${j}" aria-label="Удалить блок">✕</button></div>
        <textarea data-p="${P}.features.${j}.text" rows="3" placeholder="Описание: одно-два предложения">${esc(f.text)}</textarea></div></div>`; }).join('');
  const free=(x.gallery||[]).map((g,j)=>({g,j,L:linkOf(x,g)})).filter(o=>o.L.kind!=='feat');
  const groups=(x.groups||[]).map(g=>g.name).filter(Boolean);
  const gcards=free.map(({g,j,L},n)=>`<div class="gcard${g.on===false?' off':''}" data-gj="${j}"><div class="gmv"><span class="ed-hdl" draggable="true" data-edrag="gal" data-i="${i}" data-j="${j}" title="Перетащите, чтобы поменять порядок" aria-hidden="true">⠿</span>
      <button class="icon" type="button" data-a="galMv" data-i="${i}" data-j="${j}" data-d="-1" aria-label="Раньше" title="Раньше" ${n===0?'disabled':''}>↑</button><button class="icon" type="button" data-a="galMv" data-i="${i}" data-j="${j}" data-d="1" aria-label="Позже" title="Позже" ${n===free.length-1?'disabled':''}>↓</button></div><img src="${esc(g.src)}" alt="">
      <input type="text" data-p="${P}.gallery.${j}.caption" value="${esc(g.caption||'')}" placeholder="${L.kind==='group'?esc(L.name):'Подпись под изображением'}">
      <label class="f"><span>Где показать</span><select data-gat="${i}" data-j="${j}"><option value="free"${L.kind==='free'?' selected':''}>Раздел «Фото и схемы»</option>
        ${groups.map(n=>`<option value="group:${esc(n)}"${L.kind==='group'&&L.name===n?' selected':''}>К характеристикам: ${esc(n)}</option>`).join('')}
        ${(x.features||[]).filter(f=>f.label).map(f=>`<option value="feat:${featId(f)}">К описанию: ${esc(f.label)}</option>`).join('')}</select></label>
      <div class="gctl"><select data-p="${P}.gallery.${j}.wide" aria-label="Ширина"><option value=""${!g.wide?' selected':''}>Ширина: авто</option><option value="half"${g.wide==='half'?' selected':''}>Половина</option><option value="full"${g.wide==='full'?' selected':''}>Вся ширина</option></select>
        <label class="row muted" style="gap:4px"><input type="checkbox" data-gon="${i}" data-j="${j}" ${g.on===false?'':'checked'} style="width:auto">в КП</label><span style="flex:1"></span>
        <button class="lnk" type="button" data-a="galMain" data-i="${i}" data-j="${j}" title="Сделать главным фото позиции (текущее главное встанет на его место)">★ Главное</button>
        <button class="icon" type="button" data-a="galDel" data-i="${i}" data-j="${j}" aria-label="Удалить">✕</button></div></div>`).join('');
  const schemeSlots=(t.gallerySlots||[]).filter(s=>WIDE_RX.test(s));
  const isSt=typeof stationOf==='function' && !!stationOf(x);
  return `<div class="ed-sec"><p class="sub">${isSt?'Главное фото станции и логотип':'Главное фото и логотип'}</p>${edStationPhoto(x,i)}
     <div class="media2"><div>${drop(x.photo,'photo',i,`<b>${isSt?'Главное фото станции':'Главное фото'}</b><br>нажмите, перетащите файл или картинку с сайта,<br>или вставьте из буфера (Ctrl+V).<br><small>Белые поля обрежутся сами.</small>`)}${edMainPick(x,i)}${field('Подпись под фото',`${P}.photoCaption`,{ph:'Исполнение в кожухе'})}</div>
       <div>${drop(x.logo,'logo',i,attrsOf(x).maker?(logoFor(attrsOf(x).maker)?'Логотип производителя':'Логотип производителя (PNG) — у «'+esc(attrsOf(x).maker)+'» в каталоге логотипа нет'):'Логотип подставится сам, если указать производителя (точное совпадение с каталогом)',true)}</div></div></div>
   <div class="ed-sec"><div class="sub">${isSt?'Описание станции по узлам':'Описание узлов'}${tip("У каждого блока — своё фото: в КП текст и фото стоят рядом."+(isSt?" Для станции — например, «Контейнер снаружи», «Внутри контейнера»; элементы состава описываются на вкладке «Состав станции».":""))}</div>
     ${blocks||'<p class="muted">Добавьте блоки описания — например, «Двигатель», «Альтернатор», «Контроллер».</p>'}
     <div class="chips">${slots.filter(s=>!have.has(norm(s))).map(s=>`<button class="chip" type="button" data-a="addFeatL" data-i="${i}" data-l="${esc(s)}">+ ${esc(s)}</button>`).join('')}<button class="chip" type="button" data-a="addFeatL" data-i="${i}" data-l="">+ свой блок</button></div></div>
   <div class="ed-sec"><div class="sub">Схемы, чертежи и другие фото${tip("Выводятся после характеристик; можно привязать к группе характеристик. Перетащите файлы или вставьте из буфера (Ctrl+V).")}</div>
     <div class="gal" data-gal="${i}" tabindex="0">${gcards||'<p class="muted" style="margin:0">Перетащите сюда файлы или картинки с сайта, или вставьте из буфера (Ctrl+V). Схемы и чертежи в PNG сохраняются без потери чёткости.</p>'}</div>
     <div class="chips" style="margin-top:8px">${schemeSlots.map(s=>`<button class="chip" type="button" data-a="galAdd" data-i="${i}" data-slot="${esc(s)}">+ ${esc(s)}</button>`).join('')}<button class="chip" type="button" data-a="galAdd" data-i="${i}" data-slot="">+ изображение</button><button class="chip" type="button" data-imgpaste='[data-gal="${i}"]'>Вставить из буфера</button><button class="chip" type="button" data-a="galPage" data-i="${i}" title="${x.feed&&x.feed.url?'Все фото со страницы товара: '+esc(x.feed.url)+' (Shift+клик — другая ссылка)':'Все фото со страницы товара на сайте поставщика — по ссылке'}">⤓ Фото с сайта поставщика</button></div></div>${DrawPic.forItem(x, i)}`;
}

function edSpec(x,i){
  const P=`items.${i}`;
  const groups=(x.groups||[]).map((g,j)=>`<div class="grp"><div class="grp-h"><input type="text" data-p="${P}.groups.${j}.name" value="${esc(g.name)}" placeholder="Группа (Двигатель, Альтернатор…)"><button class="icon" type="button" data-a="delGrp" data-i="${i}" data-j="${j}" aria-label="Удалить группу">✕</button></div>
      ${g.rows.map((rw,k)=>`<div class="srow"><input type="text" data-p="${P}.groups.${j}.rows.${k}.k" value="${esc(rw.k)}" placeholder="Параметр"><input type="text" data-p="${P}.groups.${j}.rows.${k}.v" value="${esc(rw.v)}" placeholder="Значение"><button class="icon star" type="button" aria-pressed="${!!rw.hl}" data-a="star" data-i="${i}" data-j="${j}" data-k="${k}" aria-label="Ключевой параметр" title="Выделить синим">★</button><button class="icon" type="button" data-a="delRow" data-i="${i}" data-j="${j}" data-k="${k}" aria-label="Удалить строку">✕</button></div>`).join('')}
      <button class="btn ghost" type="button" data-a="addRow" data-i="${i}" data-j="${j}">+ строка</button></div>`).join('');
  const tn=typeById(attrsOf(x).cat).name;
  return `<div class="ed-sec"><div class="row" style="margin-bottom:10px"><button class="btn" type="button" data-a="specTpl" data-i="${i}" title="Группы и строки характеристик, принятые для категории «${esc(tn)}»; заполненное не меняется">Шаблон категории «${esc(tn)}»</button><button class="btn" type="button" data-a="paste" data-i="${i}">Вставить таблицу из Excel</button><button class="btn" type="button" data-a="attrsToGroups" data-i="${i}">Сформировать из параметров</button><span class="muted">★ — выделить параметр синим в КП</span></div>
    ${groups||`<p class="muted">Характеристик пока нет. Нажмите «Шаблон категории» — появятся строки, принятые для «${esc(tn)}»; или вставьте таблицу из Excel, сформируйте из параметров на вкладке «Основное», используйте автозаполнение.</p>`}
    <button class="btn ghost" type="button" data-a="addGrp" data-i="${i}">+ группа</button></div>`;
}

function edOpts(x,i){ return `<div class="ed-sec">${optsBlock(x,i)}</div>`; }

function edAI(x,i){
  const P=`items.${i}`, r=AiFill.parse(x), props=(x._srcProps||[]).length, has=!!String(x._src||'').trim(), st0=typeById(attrsOf(x).cat).station;
  const st=x._aiStep||(r?3:has?2:1), cls=n=>`ai-st${st===n?' cur':''}${st>n?' done':''}`;
  const srcLen=String(x._src||'').length, direct=AI_DIRECT.enabled, busy=AI_DIRECT.busy[x.id];
  const head=(n, t, note)=>`<div class="ai-sh"><span class="ai-sn">${st>n?'✓':n}</span><b>${t}</b>${note?`<span class="ai-stc">${note}</span>`:''}</div>`;
  return `<div class="ed-sec ai3">
    <div class="ai-hero"><span class="ai-ic" aria-hidden="true">✨</span>
      <div><h4>Автозаполнение карточки</h4><p>Дайте источник — ИИ разложит данные по полям: ${st0?'описание станции, требования к контейнеру, недостающие элементы состава':'наименование, описание, характеристики, параметры для фильтров'}. Перед заполнением вы увидите, что изменится.</p></div>
      <span class="ai-mode${direct?' on':''}" title="${direct?'Запрос уходит в нейросеть с компьютера-сервера — включает администратор в «Настройки → Нейросеть»':'Запрос копируется в любой ИИ-чат: ChatGPT, Claude, Алиса, GigaChat, DeepSeek'}">${direct?`● ${esc(AI_DIRECT.provider)} в программе`:'Через ИИ-чат'}</span></div>
    <ol class="ai-steps">
    <li class="${cls(1)}">${head(1, 'Откуда взять данные', has?`загружено ${srcLen.toLocaleString('ru-RU')} знаков${props?` · характеристик: ${props}`:''}`:'можно пропустить — хватит модели в наименовании')}
      <div class="ai-src">
        <div class="ai-srcc ai-srcu"><span class="ai-srct">🔗 Страница товара на сайте</span>
          <div class="ai-url"><input type="url" data-p="${P}._srcUrl" value="${esc(x._srcUrl||x.pageUrl||'')}" placeholder="https://… ссылка на страницу товара" autocomplete="off"><button class="btn primary" type="button" data-a="aiFetch" data-i="${i}">Загрузить</button></div>
          <small class="muted">Возьмём описание, все вкладки страницы, таблицы характеристик и фото товара.</small></div>
        <label class="ai-srcc ai-srcf"><span class="ai-srct">📄 Файл</span><span class="ai-fileb">Выбрать PDF, Word или .txt</span><small class="muted">${st0?'ТЗ заказчика — ИИ разложит требования к контейнеру и добавит недостающие элементы.':'Паспорт, каталог, ТЗ — текст из файла уйдёт в запрос.'}</small><input type="file" accept=".pdf,.docx,.txt,.csv,.md" hidden data-aifile="${i}"></label>
      </div>
      <details class="ai-txt"${has?' open':''}><summary>${has?'Текст для ИИ — можно поправить':'✍ Вставить текст вручную: описание, таблицу из паспорта или PDF'}</summary>
        <textarea data-p="${P}._src" rows="6" placeholder="Вставьте текст. Можно ничего не вставлять — тогда ИИ ищет данные по модели «${esc(x.name||'из наименования')}».">${esc(x._src||'')}</textarea></details>
      ${props?`<div class="ai-props"><span>Со страницы взято характеристик: <b>${props}</b>.</span><button class="btn ghost" type="button" data-a="aiProps" data-i="${i}">Перенести в «Характеристики» без ИИ</button></div>`:''}
      ${(x._srcImgs||[]).length?pageImgsHtml(i, x._srcImgs, 'ai'):''}</li>
    ${direct?`<li class="${cls(2)}">${head(2, 'Заполнить с помощью нейросети', `${esc(AI_DIRECT.provider)} · ответ — в шаге 3`)}
      <div class="row"><button class="btn primary ai-go" type="button" data-a="aiAuto" data-i="${i}"${busy?' disabled':''}>${busy?'<span class="ai-spin" aria-hidden="true"></span> Заполняю…':`✨ Заполнить автоматически`}</button><span class="muted">Обычно 10–40 секунд.</span></div>
      <details class="ai-pr"><summary>или через ИИ-чат в браузере (можно приложить скриншот или PDF)</summary>${aiSitesHtml('aiCopy', i)}<textarea rows="8" readonly>${esc(AiFill.promptNow(x))}</textarea></details></li>`
    :`<li class="${cls(2)}">${head(2, 'Отправьте запрос в ИИ', 'кнопка копирует запрос и открывает сайт')}
      <p class="ai-how">Нажмите кнопку с названием ИИ → в открывшейся вкладке вставьте <kbd>Ctrl</kbd>+<kbd>V</kbd> и отправьте. Можно приложить скриншот или PDF паспорта.</p>
      ${aiSitesHtml('aiCopy', i)}
      <details class="ai-pr"><summary>Показать запрос</summary><textarea rows="8" readonly>${esc(AiFill.promptNow(x))}</textarea></details></li>`}
    <li class="${cls(3)}">${head(3, direct?'Проверьте и заполните':'Вставьте ответ ИИ и заполните', r&&r.kind!=='bad'?'ответ распознан':'')}
      <textarea data-p="${P}._ans" data-aians="${i}" rows="5" placeholder="${direct?'Здесь появится ответ нейросети (или вставьте ответ чата)':'Ctrl+V — ответ ИИ целиком (кнопка «Копировать» под ответом в чате)'}">${esc(x._ans||'')}</textarea>
      <div class="ai-prev" data-aiprev="${i}">${AiFill.summary(x, r)}</div>
      <div class="row ai-apply"><button class="btn primary" type="button" data-a="aiApply" data-i="${i}" data-aiok="${i}" ${r&&r.kind!=='bad'?'':'disabled'}>Заполнить карточку</button>
        <label class="row muted" style="gap:6px"><input type="checkbox" data-aikeep="${i}" ${(x._aiKeep ?? DEF('ai.keep'))?'checked':''} style="width:auto">не менять уже заполненное</label></div></li></ol>
    ${x._aiMsg?`<p class="ai-msg" data-aistat="${i}">${esc(x._aiMsg)}</p>`:''}</div>`;
}

async function addFeatImage(i, fid, files){
  const it=S.items[i], f=(files||[]).find(f=>f.type&&f.type.startsWith('image/')); if(!f) return toast('Нужен файл изображения');
  try{ const im=await prepGallery(f); it.gallery=(it.gallery||[]).filter(g=>g.at!=='feat:'+fid);
    const ft=(it.features||[]).find(z=>z.id===fid);
    it.gallery.push({id:uid(), ...im, caption:ft?ft.label:'', slot:'', at:'feat:'+fid, on:true}); it.page=true; renderForm(); persist(); toast('Фото добавлено к блоку описания'); }catch(e){ toast('Не удалось открыть изображение'); }
}

document.addEventListener('click', e=>{
  const d=e.target.closest('#edlg'); if(!d) return;
  if (e.target.closest('[data-edclose]')) return closeEditor();
  const t=e.target.closest('[data-edtab]'); if (t){ EDIT.tab=t.dataset.edtab; renderEditor(); return; }
  const nv=e.target.closest('[data-ednav]'); if (nv){ const k=EDIT.i+(+nv.dataset.ednav); if (S.items[k]){ EDIT.i=k; renderEditor(); d.querySelector('.ed-b').scrollTop=0; } return; }
  const fz=e.target.closest('[data-fimg]'); if (fz && !e.target.closest('[data-a]')){ const f=$('#filePick'); f.value=''; f.multiple=false; f.onchange=()=>f.files[0]&&addFeatImage(+fz.dataset.fimg, fz.dataset.fid, [f.files[0]]); f.click(); }
});

document.addEventListener('close', e=>{ if (e.target.id!=='edlg' || e.target.open) return;     // закрытие пришло позже повторного открытия — не сбрасывать
  if (CATED){ S.items=CATED.items; CATED=null; EDIT=null; renderForm(); return; }   // окно закрыто не кнопками карточки каталога — правки не сохраняются
  if (EDIT){ EDIT=null; renderForm(); persist(); } }, true);

document.addEventListener('change', e=>{ const t=e.target; if (t.dataset.gat==null) return;
  const x=S.items[+t.dataset.gat], g=x.gallery[+t.dataset.j]; g.at = t.value==='free' ? 'free' : t.value; renderForm(); persist(); });


// порядок блоков описания и изображений: перетаскивание за «⠿» (и стрелки ↑↓ — ui/events.js)
function edMoveFeat(it, from, to){ const a=it.features||[]; if (from===to || to<0 || to>=a.length) return false; const [x]=a.splice(from,1); a.splice(to,0,x); return true; }
// изображения: переставляется среди «своих» (не привязанных к блокам описания) — порядок в КП тот же
function edMoveGal(it, from, to){ const g=it.gallery||[]; if (from===to || !g[from] || !g[to]) return false; const [x]=g.splice(from,1); g.splice(to,0,x); return true; }
function edFreeGal(it){ return (it.gallery||[]).map((g,j)=>({g,j})).filter(o=>linkOf(it,o.g).kind!=='feat').map(o=>o.j); }
const ED_DND = { kind:'', i:-1, j:-1 };
document.addEventListener('dragstart', e=>{ const h=e.target.closest && e.target.closest('[data-edrag]'); if (!h) return;
  Object.assign(ED_DND, { kind:h.dataset.edrag, i:+h.dataset.i, j:+h.dataset.j }); e.dataTransfer.effectAllowed='move';
  try{ e.dataTransfer.setData('application/x-kp-move', h.dataset.edrag); }catch(_){}
  const box=h.closest('.fblock,.gcard'); if (box){ box.classList.add('dragging'); try{ e.dataTransfer.setDragImage(box, 20, 20); }catch(_){} } }, true);
const edDropBox = e => { if (!ED_DND.kind) return null; const b=e.target.closest && e.target.closest(ED_DND.kind==='feat'?'.fblock[data-fj]':'.gcard[data-gj]'); return b; };
document.addEventListener('dragover', e=>{ if (!ED_DND.kind) return; e.preventDefault(); e.stopPropagation(); const b=edDropBox(e);
  document.querySelectorAll('.drop-b,.drop-a').forEach(x=>{ if (x!==b) x.classList.remove('drop-b','drop-a'); });
  if (!b) return; const r=b.getBoundingClientRect(), after = ED_DND.kind==='feat' ? e.clientY>r.top+r.height/2 : e.clientX>r.left+r.width/2;
  b.classList.toggle('drop-a', after); b.classList.toggle('drop-b', !after); }, true);
document.addEventListener('drop', e=>{ if (!ED_DND.kind) return; e.preventDefault(); e.stopPropagation();
  const b=edDropBox(e), it=S.items[ED_DND.i]; const kind=ED_DND.kind, from=ED_DND.j; ED_DND.kind='';
  document.querySelectorAll('.dragging,.drop-b,.drop-a').forEach(x=>x.classList.remove('dragging','drop-b','drop-a'));
  if (!b || !it) return;
  const r=b.getBoundingClientRect(), after = kind==='feat' ? e.clientY>r.top+r.height/2 : e.clientX>r.left+r.width/2;
  let ok=false;
  if (kind==='feat'){ let to=+b.dataset.fj+(after?1:0); if (to>from) to--; ok=edMoveFeat(it, from, to); }
  else { const free=edFreeGal(it), fi=free.indexOf(from); let ti=free.indexOf(+b.dataset.gj)+(after?1:0); if (ti>fi) ti--; ok=fi>=0 && ti>=0 && ti<free.length && edMoveGal(it, from, free[ti]); }
  if (ok){ renderForm(); persist(); } }, true);
document.addEventListener('dragend', ()=>{ if (!ED_DND.kind) return; ED_DND.kind=''; document.querySelectorAll('.dragging,.drop-b,.drop-a').forEach(x=>x.classList.remove('dragging','drop-b','drop-a')); }, true);
