// Мастер «Добавить оборудование» — один порядок для КП и для каталога:
//   1) что добавляем: найти в каталоге (только в КП) · станция в контейнере (насосная, компрессорная, ДГУ) · единица оборудования;
//   2а) единица — как заполнить карточку: по ссылке на страницу товара, с помощью ИИ, таблицей из паспорта / Excel, вручную;
//   2б) станция — контейнер (тип, утепление, климат) и основное оборудование из каталога подходящего вида;
//   3) карточка открывается сразу на нужной вкладке (в каталоге — карточка каталога).
'use strict';

const NW = { where:'kp', cat:'', ctype:'block', ins:'100 мм', climate:'УХЛ1', main:null, q:'', pf:null, url:'', name:'', busy:false };

function newEquip(where, pre){
  if (where==='catalog' && !can('catAdd')) return cannot('catAdd');
  Object.assign(NW, { where:where||'kp', cat:'', ctype:'block', ins:'100 мм', climate:'УХЛ1', main:null, q:'', pf:null, url:'', name:'', busy:false });
  if (pre==='station') NW.cat='station';
  else if (pre && TYPES.some(t=>t.id===pre)) NW.cat=pre;
  const d=$('#dlg'); d.className='wide nw'; nwDraw(); if (!d.open) d.showModal();
  setTimeout(()=>($('#nwQ')||$('#nwName')||$('#nwUrl'))?.focus(), 40);
}

const nwStations = () => TYPES.filter(t=>t.station);

function nwDraw(){
  const d=$('#dlg'), t=NW.cat && NW.cat!=='station' ? typeById(NW.cat) : null;
  const back=NW.cat?`<button class="btn ghost" type="button" data-nw="back">← Назад</button>`:'';
  let body;
  if (!NW.cat) body=nwStart();
  else if (NW.cat==='station') body=`<p class="muted nw-lead">Какую станцию собираем? Комплектуем только станции в контейнере.</p>${nwStationCards()}`;
  else if (t.station) body=nwStation(t);
  else body=nwUnit(t);
  d.innerHTML=`<div class="dlg-h"><h3>${NW.where==='catalog'?'Новая позиция каталога':'Добавить оборудование'}${t?` <small class="muted">· ${esc(t.station?t.item:t.name)}</small>`:''}</h3>${back}<button class="icon" type="button" data-close aria-label="Закрыть">✕</button></div>
    <div class="dlg-b">${body}</div>`;
}

function nwStationCards(){
  const ic={st_pump:'💧', st_comp:'💨', st_dgu:'⚡'};
  return `<div class="nw-cards">${nwStations().map(t=>`<button type="button" class="nw-card st" data-nwcat="${esc(t.id)}"><i>${ic[t.id]||'▣'}</i><b>${esc(t.item)}</b><small>${esc(t.coverTitle||t.name)}: контейнер, ${esc((t.station.mainLabel||'').toLowerCase())}, обвязка и системы — одним изделием</small></button>`).join('')}</div>`;
}

function nwStart(){
  const groups=[...new Set(TYPES.filter(t=>!t.station && (NW.where==='catalog' || t.role!=='accessory')).map(t=>t.group||'Прочее'))];
  const cnt=new Map(); catCache.forEach(x=>{ const c=attrsOf(x).cat; cnt.set(c,(cnt.get(c)||0)+1); });
  return `${NW.where==='kp'?`<div class="nw-sec"><p class="nw-h">Есть в каталоге?</p><input type="search" id="nwQ" value="${esc(NW.q)}" placeholder="Модель, производитель, мощность — Enter добавит первую" autocomplete="off"><div class="nw-res" id="nwRes">${nwFound()}</div></div>`:''}
    <div class="nw-sec"><p class="nw-h">Станция в контейнере <span class="muted">— комплектуем сами</span></p>${nwStationCards()}</div>
    <div class="nw-sec"><p class="nw-h">Единица оборудования <span class="muted">— ${NW.where==='kp'?'нет в каталоге: заведём карточку':'выберите категорию'}</span></p>
      ${groups.map(g=>`<div class="nw-grp"><span>${esc(g)}</span><div class="tpick">${TYPES.filter(t=>!t.station && (NW.where==='catalog' || t.role!=='accessory') && (t.group||'Прочее')===g).map(t=>`<button type="button" class="btn" data-nwcat="${esc(t.id)}">${esc(t.name)}${cnt.get(t.id)?` <small class="muted">${cnt.get(t.id)}</small>`:''}</button>`).join('')}</div></div>`).join('')}
      ${NW.where==='catalog'?'<button class="btn ghost" type="button" data-nw="newtype">+ Новая категория…</button>':'<p class="muted">Нужной категории нет? Её можно добавить в каталоге: «Каталог» → «+ Новая позиция» → «+ Новая категория…».</p>'}</div>`;
}

function nwFound(){
  if (!NW.q.trim()) return '';
  const res=quickMatches(NW.q);
  return res.length ? res.map(x=>`<button type="button" class="nw-hit" data-nwadd="${esc(x.id)}">${x.photo?`<img src="${esc(x.photo.src)}" alt="">`:'<i></i>'}<span><b>${esc(x.name)}</b><small>${esc(mainLine(x,3)||x.spec||'')}</small></span><em>В КП</em></button>`).join('')
    : '<p class="muted">В каталоге не нашлось — заведите карточку ниже: выберите категорию.</p>';
}

// единица оборудования: как заполнить карточку
function nwUnit(t){
  const opt=(k, ic, title, text, extra)=>`<div class="nw-opt${k==='ai'?' rec':''}"><button type="button" class="nw-optb" data-nwgo="${k}"><i>${ic}</i><span><b>${title}</b><small>${text}</small></span></button>${extra||''}</div>`;
  return `<label class="f nw-name"><span>Наименование или модель <small class="muted">— можно заполнить позже</small></span><input type="text" id="nwName" value="${esc(NW.name)}" placeholder="${esc(t.item)} …, например «Grundfos CR 32-4»" autocomplete="off"></label>
    <p class="nw-h">Как заполнить карточку?</p>
    <div class="nw-opts">
      ${opt('url','🔗','По ссылке на сайт','Программа скачает со страницы текст и характеристики, дальше — ИИ или сразу в таблицу.',
        `<div class="nw-url"><input type="url" id="nwUrl" value="${esc(NW.url)}" placeholder="https://… страница товара" autocomplete="off"><button class="btn primary" type="button" data-nwgo="url"${NW.busy?' disabled':''}>${NW.busy?'Загружаю…':'Загрузить'}</button></div>`)}
      ${opt('ai','✨','С помощью ИИ — рекомендуем', AI_DIRECT.enabled ? `${esc(AI_DIRECT.provider)} прямо в программе: вставьте текст паспорта, загрузите ТЗ или укажите модель — описание и характеристики разложатся по полям одной кнопкой.` : 'ChatGPT, Claude, Алиса, GigaChat, DeepSeek — любой. Вставьте текст паспорта или только модель: ИИ разложит описание и характеристики по полям.')}
      ${opt('paste','📋','Таблицей из паспорта или Excel','Скопируйте два столбца «параметр — значение» — строки станут таблицей характеристик.')}
      ${opt('manual','✎','Вручную','Пустая карточка: параметры категории, описание, фото и характеристики.')}
    </div>`;
}

// станция: контейнер и основное оборудование
function nwStation(t){
  const cats=t.station.main||[];
  if (!NW.pf || NW.pfFor!==t.id){ NW.pf=pfNew(cats); NW.pfFor=t.id; }
  const m=NW.main && catCache.find(x=>x.id===NW.main);
  return `<p class="muted nw-lead">${esc(t.item)} — одно изделие для заказчика: одна строка и одна цена в КП, а закупка, поставщики и описание — по каждому элементу. Остальные элементы (${esc(t.station.parts.slice(0,3).map(z=>Array.isArray(z)?z[0]:z).join(', '))}…) добавите в карточке одним нажатием.</p>
    <p class="nw-h">1. Контейнер</p>
    <div class="kit-cts">${CONTAINER_TYPES.map(c=>`<button type="button" class="kit-ctb${NW.ctype===c.id?' on':''}" data-nwct="${c.id}"><b>${esc(c.name)}</b><small>${esc(c.size)}</small></button>`).join('')}</div>
    <div class="nw-row"><label class="f"><span>Утепление</span><select id="nwIns">${CONTAINER_INS.map(v=>`<option${v===NW.ins?' selected':''}>${v}</option>`).join('')}</select></label>
      <label class="f"><span>Климатическое исполнение</span><select id="nwCl">${CLIMATES.map(c=>`<option value="${c[0]}"${c[0]===NW.climate?' selected':''}>${c[0]} — ${esc(c[1])}</option>`).join('')}</select></label></div>
    <p class="nw-h">2. ${esc(t.station.mainLabel)} <span class="muted">— из каталога или позже</span></p>
    ${m?`<div class="nw-chosen">${m.photo?`<img src="${esc(m.photo.src)}" alt="">`:''}<b>${esc(m.name)}</b><button class="btn ghost" type="button" data-nw="unmain">Другое</button></div>`
      :`<div id="nwPf">${pfHtml(NW.pf, cats)}</div><div class="nw-res nw-mlist" id="nwMl">${nwMainList(cats)}</div>`}
    <div class="row nw-go"><button class="btn primary" type="button" data-nw="mkStation"${NW.busy?' disabled':''}>Создать станцию</button><span class="muted">Откроется карточка станции на вкладке «Состав станции».</span></div>`;
}

function nwMainList(cats){
  const r=pfList(NW.pf, cats, 30);
  return `<p class="muted pf-n">Подходит: ${r.n}${r.n>30?' — показаны первые 30, уточните фильтры':''}</p>`+(r.list.map(x=>`<button type="button" class="nw-hit" data-nwmain="${esc(x.id)}">${x.photo?`<img src="${esc(x.photo.src)}" alt="">`:'<i></i>'}<span><b>${esc(x.name)}</b><small>${esc(mainLine(x,3)||'')}</small></span><em>Выбрать</em></button>`).join('')
    || '<p class="muted">Подходящего нет — измените фильтры или добавьте своё в карточке станции.</p>');
}

// новая позиция → в КП (карточка позиции) или в каталог (карточка каталога), открыть на вкладке tab
function nwFinish(it, tab, after){
  const d=$('#dlg'); d.close(); d.className='';
  if (NW.where==='catalog'){
    const src=it._src, props=it._srcProps, url=it._srcUrl;
    const doc=itemToDoc(it, { id:uid()+uid(), prices:[] });
    openCatEditor(doc, typeof cwAfterSave==='function'?cwAfterSave:null, true);
    const x=S.items[0]; Object.assign(x, {_src:src, _srcProps:props, _srcUrl:url, _aiStep:it._aiStep, _aiMsg:it._aiMsg});
    EDIT.tab=tab; renderEditor(); if (after) after(0); return;
  }
  const blank=S.items.length===1 && !S.items[0].name.trim() && !S.items[0].price && !isKit(S.items[0]);
  if (blank) S.items=[it]; else S.items.push(it);
  if (STEP!=='equip') STEP='equip';
  renderForm(); persist(); openEditor(S.items.indexOf(it), tab); if (after) after(S.items.indexOf(it));
}

async function nwMakeUnit(how){
  const t=typeById(NW.cat), it=newItem(); it.attrs={cat:t.id}; it.page=true; it.name=NW.name.trim(); it.features=[];
  if (how==='url'){
    const url=String(($('#nwUrl')||{}).value||NW.url).trim(); NW.url=url;
    if (!/^https?:\/\/./.test(url)) return toast('Вставьте ссылку на страницу товара (начинается с http)');
    NW.busy=true; nwDraw(); it._srcUrl=url;
    const ok=await aiFetchInto(it); NW.busy=false;
    if (!ok){ nwDraw(); return toast(it._aiMsg||'Страница не прочитана'); }
    return nwFinish(it, 'ai');
  }
  if (how==='ai'){ it._aiStep=1; return nwFinish(it, 'ai'); }
  if (how==='paste') return nwFinish(it, 'spec', i=>openPaste(i));
  it.features=[{id:uid(), label:'', text:''}];
  return nwFinish(it, 'main');
}

async function nwMakeStation(){
  const t=typeById(NW.cat), it=newItem(); it.attrs={cat:t.id}; it.page=true; it.features=[]; it.kit={parts:[]};
  NW.busy=true; nwDraw();
  try{
    if (NW.main){ const lite=catCache.find(x=>x.id===NW.main); let doc=lite; try{ doc=await api('/api/catalog/'+encodeURIComponent(lite.id)); }catch(_){}
      const p=kitFromCat(doc); p.role='main'; it.kit.parts.push(p); if (!it.photo && p.photo) it.photo={...p.photo}; }
    const c=kitNewContainer(NW.ctype); contApply(c, {ins:NW.ins, climate:NW.climate}); it.kit.parts.push(c);
    kitSync(it); stationFill(it); stationAutoName(it);
  } finally { NW.busy=false; }
  nwFinish(it, 'kit');
}

document.addEventListener('click', e=>{
  const d=e.target.closest('#dlg.nw'); if (!d) return;
  if (e.target.closest('[data-close]')){ d.close(); d.className=''; return; }
  const c=e.target.closest('[data-nwcat]'); if (c){ NW.cat=c.dataset.nwcat; nwDraw(); setTimeout(()=>($('#nwName')||document.querySelector('#dlg [data-pf="q"]'))?.focus(),30); return; }
  const h=e.target.closest('[data-nwadd]'); if (h){ const x=catCache.find(z=>z.id===h.dataset.nwadd); d.close(); d.className=''; if (x) addFromCatalog(x); return; }
  const ct=e.target.closest('[data-nwct]'); if (ct){ NW.ctype=ct.dataset.nwct; const cc=ctypeOf(NW.ctype); if (cc.ins) NW.ins=cc.ins; if (cc.climate) NW.climate=cc.climate; nwDraw(); return; }
  const mn=e.target.closest('[data-nwmain]'); if (mn){ NW.main=mn.dataset.nwmain; nwDraw(); return; }
  const go=e.target.closest('[data-nwgo]'); if (go){ NW.name=($('#nwName')||{}).value||NW.name; nwMakeUnit(go.dataset.nwgo); return; }
  const b=e.target.closest('[data-nw]'); if (!b) return;
  if (b.dataset.nw==='back'){ const t=typeById(NW.cat); NW.cat = NW.cat!=='station' && t.station ? 'station' : ''; nwDraw(); return; }
  if (b.dataset.nw==='newtype'){ d.close(); d.className=''; cwNewType(id=>newEquip('catalog', id)); return; }
  if (b.dataset.nw==='unmain'){ NW.main=null; nwDraw(); return; }
  if (b.dataset.nw==='mkStation') nwMakeStation();
});
document.addEventListener('input', e=>{ if (!e.target.closest('#dlg.nw')) return; const t=e.target;
  if (t.id==='nwQ'){ NW.q=t.value; $('#nwRes').innerHTML=nwFound(); }
  if (t.dataset.pf && t.tagName==='INPUT'){ pfSet(NW.pf, t); $('#nwMl').innerHTML=nwMainList(typeById(NW.cat).station.main); }
  if (t.id==='nwName') NW.name=t.value;
  if (t.id==='nwUrl') NW.url=t.value; });
document.addEventListener('change', e=>{ if (!e.target.closest('#dlg.nw')) return;
  if (e.target.id==='nwIns') NW.ins=e.target.value; if (e.target.id==='nwCl') NW.climate=e.target.value;
  const t=e.target; if (t.dataset.pf && t.tagName==='SELECT'){ const cats=typeById(NW.cat).station.main; if (pfSet(NW.pf, t)) $('#nwPf').innerHTML=pfHtml(NW.pf, cats); $('#nwMl').innerHTML=nwMainList(cats); } });
document.addEventListener('keydown', e=>{ if (!e.target.closest || !e.target.closest('#dlg.nw') || e.key!=='Enter') return;
  if (e.target.id==='nwQ'){ const x=quickMatches(NW.q)[0]; if (x){ e.preventDefault(); const d=$('#dlg'); d.close(); d.className=''; addFromCatalog(x); } }
  if (e.target.id==='nwUrl'){ e.preventDefault(); NW.name=($('#nwName')||{}).value||NW.name; nwMakeUnit('url'); } });
// событие close приходит позже самого закрытия: окно могли уже открыть снова (тем же мастером) — тогда не трогаем
document.addEventListener('close', e=>{ if (e.target.id==='dlg' && !e.target.open && e.target.classList.contains('nw')) e.target.className=''; }, true);
