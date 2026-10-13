// Мастер «Добавить оборудование» — один порядок для КП и для каталога:
//   1) что добавляем: найти в каталоге (только в КП) · станция в контейнере (насосная, компрессорная, ДГУ) · единица оборудования;
//   2а) единица — как заполнить карточку: по ссылке на страницу товара, с помощью ИИ, таблицей из паспорта / Excel, вручную;
//   2б) станция — что нужно заказчику (главные требования) → «Подобрать станцию»; контейнер — строкой, другой — по ссылке;
//   3) карточка открывается сразу на нужной вкладке (в каталоге — карточка каталога).
'use strict';

const NW = { where:'kp', cat:'', q:'', url:'', name:'', busy:false };

function newEquip(where, pre){
  if (where==='catalog' && !can('catAdd')) return cannot('catAdd');
  Object.assign(NW, { where:where||'kp', cat:'', q:'', url:'', name:'', busy:false }); NewStation.reset();
  if (pre==='station') NW.cat='station';
  else if (pre && TYPES.some(t=>t.id===pre)) NW.cat=pre;
  const d=$('#dlg'); d.className='wide nw'; nwDraw(); if (!d.open) d.showModal();
  setTimeout(()=>($('#nwQ')||$('#nwName')||$('#nwUrl')||$('[data-nsr]'))?.focus(), 40);
}

const nwStations = () => TYPES.filter(t=>t.station);

function nwDraw(){
  const d=$('#dlg'), t=NW.cat && NW.cat!=='station' ? typeById(NW.cat) : null;
  const back=NW.cat?`<button class="btn ghost" type="button" data-nw="back">← Назад</button>`:'';
  let body;
  if (!NW.cat) body=nwStart();
  else if (NW.cat==='station') body=`<p class="muted nw-lead">Какую станцию собираем? Комплектуем только станции в контейнере.</p>${nwStationCards()}${nwTz()}`;
  else if (t.station) body=NewStation.html(t);
  else body=nwUnit(t);
  d.innerHTML=`<div class="dlg-h"><h3>${NW.where==='catalog'?'Новая позиция каталога':'Добавить оборудование'}${t?` <small class="muted">· ${esc(t.station?t.item:t.name)}</small>`:''}</h3>${back}<button class="icon" type="button" data-close aria-label="Закрыть">✕</button></div>
    <div class="dlg-b">${body}</div>`;
}

function nwStationCards(){
  const ic={st_pump:'💧', st_comp:'💨', st_dgu:'⚡'};
  return `<div class="nw-cards">${nwStations().map(t=>`<button type="button" class="nw-card st" data-nwcat="${esc(t.id)}"><i>${ic[t.id]||'▣'}</i><b>${esc(t.item)}</b><small>${esc(t.coverTitle||t.name)}: контейнер, ${esc((t.station.mainLabel||'').toLowerCase())}, обвязка и системы — одним изделием</small></button>`).join('')}</div>`;
}

// станция по ТЗ заказчика: вид станции, требования, контейнер и оборудование — из файла ТЗ (features/tz-import.js)
const nwTz = () => NW.where==='kp' ? `<div class="nw-tz"><button class="btn" type="button" data-nw="tz">📄 По ТЗ заказчика</button><span class="muted">PDF, Word, Excel — найдём требования, подберём контейнер и оборудование; всё проверите перед созданием</span></div>` : '';

function nwStart(){
  const groups=[...new Set(TYPES.filter(t=>!t.station && (NW.where==='catalog' || t.role!=='accessory')).map(t=>t.group||'Прочее'))];
  const cnt=new Map(); catCache.forEach(x=>{ const c=attrsOf(x).cat; cnt.set(c,(cnt.get(c)||0)+1); });
  return `${NW.where==='kp'?`<div class="nw-sec"><p class="nw-h">Есть в каталоге?</p><input type="search" id="nwQ" value="${esc(NW.q)}" placeholder="Модель, производитель, мощность — Enter добавит первую" autocomplete="off"><div class="nw-res" id="nwRes">${nwFound()}</div></div>`:''}
    ${FEAT.on('stations')?`<div class="nw-sec"><p class="nw-h">Станция в контейнере <span class="muted">— комплектуем сами</span></p>${nwStationCards()}${nwTz()}</div>`:''}
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

// станция: «Что нужно заказчику» → «Подобрать станцию» (решение ПНЕВМОТЕХ 13.10: прежний экран — 8 карточек контейнеров и
// список всего каталога — «избыточен, перегружен, неинформативен»). Главные требования — те же поля, что в «Подборе станции»
// (StationQuick.KEYS); контейнер — строкой (блок-контейнер по оборудованию в габарите перевозки, утепление и климат — из
// «Умолчаний»), другой — по ссылке; подбор — тот же, что у кнопки «Подобрать оборудование» (TzPick); выбрать основное
// оборудование вручную — окно каталога с фильтрами по требованиям и «★ Рекомендуем» первым (KitNeed.mainPreset)
class NewStation {
  static S = { ctype:'block', ins:'', climate:'', req:{}, cont:false };
  static pv = null;      // предпросмотр: {key, x — подобранная станция (ещё не в КП), busy}
  static WAIT = 700;     // пауза ввода перед подбором для предпросмотра, мс
  static reset(){ this.S={ ctype:'block', ins:DEF('st.ins')||'100 мм', climate:DEF('st.climate')||'УХЛ1', req:{}, cont:false }; this.pv=null; clearTimeout(this.t); }
  static kind(t){ return /comp/.test(t.id) ? 'comp' : /dgu/.test(t.id) ? 'dgu' : /pump/.test(t.id) ? 'pump' : ''; }
  /** контейнер одной строкой */
  static cont(){
    const S=this.S, c=ctypeOf(S.ctype), flex=!!StationGeo.FLEX[S.ctype], n=StationLayout.n;
    return `${c.name}${flex ? ` — размер по оборудованию, в габарите перевозки (ширина до ${n(StationGeo.ROAD_W)} мм)` : c.size ? ` (${c.size})` : ''}; утепление ${S.ins}; ${S.climate}`;
  }
  static html(t){
    const S=this.S, k=this.kind(t), F=StationQuick.KEYS[k]||[], need=(StationQuick.NEED[k]||[])[0];
    const fld=([key, label, ph, mode='decimal'])=>{ const bad=ReqNum.check(key, S.req[key]??'');
      return `<label class="f"><span>${esc(label)}${key===need ? ' *' : ''}</span><input type="text" inputmode="${mode}" data-nsr="${esc(key)}" value="${esc(S.req[key]??'')}" placeholder="${esc(ph)}" autocomplete="off"${bad ? ' class="bad"' : ''}>${bad ? `<small class="err">${esc(bad)}</small>` : ''}</label>`; };
    const opt=(v, l, on)=>`<option value="${esc(v)}"${on ? ' selected' : ''}>${esc(l)}</option>`;
    return `<p class="muted nw-lead">Что нужно заказчику (* — обязательно) — программа подберёт оборудование из каталога, контейнер, компоновку и изображения для КП. Всё можно поправить в карточке станции.</p>
      <div class="ns-g">${F.map(fld).join('')}</div>
      <div class="ns-c"><span class="muted">Контейнер:</span> <span>${esc(this.cont())}</span> <button class="link" type="button" data-nw="nsCont">${S.cont ? 'скрыть' : 'другой'}</button></div>
      ${S.cont ? `<div class="ns-row"><label class="f"><span>Тип</span><select id="nsCt">${CONTAINER_TYPES.map(c=>opt(c.id, c.name, S.ctype===c.id)).join('')}</select></label>
        <label class="f"><span>Утепление</span><select id="nsIns">${CONTAINER_INS.map(v=>opt(v, v, v===S.ins)).join('')}</select></label>
        <label class="f"><span>Климатическое исполнение</span><select id="nsCl">${CLIMATES.map(c=>opt(c[0], c[0]+' — '+c[1], c[0]===S.climate)).join('')}</select></label></div>` : ''}
      <div class="ns-pv" id="nsPv">${this.pvHtml(t)}</div>
      <div class="row nw-go"><button class="btn primary" type="button" data-nw="nsPick"${NW.busy ? ' disabled' : ''}>${NW.busy ? 'Подбираю…' : this.ready() ? 'Взять в КП' : 'Подобрать станцию'}</button>
        ${NW.where==='kp' ? '<button class="btn" type="button" data-nw="tz">📄 По ТЗ заказчика</button>' : ''}</div>
      <p class="muted ns-alt"><button class="link" type="button" data-nw="nsMain">Выбрать ${esc((t.station.mainLabel||'оборудование').toLowerCase())} вручную</button> · <button class="link" type="button" data-nw="mkStation">пустая станция</button> — состав и требования в карточке</p>`;
  }
  /** поле требования → состояние (ошибка — под полем, без перерисовки всего окна); после паузы — предпросмотр */
  static input(el){ const k=el.dataset.nsr; this.S.req[k]=el.value; const bad=ReqNum.check(k, el.value);
    el.classList.toggle('bad', !!bad); let s=el.parentNode.querySelector('small.err'); if (bad){ if (!s){ s=document.createElement('small'); s.className='err'; el.after(s); } s.textContent=bad; } else if (s) s.remove();
    this.later(); }
  static change(el){ const S=this.S;
    if (el.id==='nsCt'){ S.ctype=el.value; const c=ctypeOf(S.ctype); if (c.ins) S.ins=c.ins; if (c.climate) S.climate=c.climate; }
    else if (el.id==='nsIns') S.ins=el.value; else if (el.id==='nsCl') S.climate=el.value;
    nwDraw(); this.later(); }

  // ---- предпросмотр: размер контейнера и 3D-вид сразу, до карточки (решение ПНЕВМОТЕХ 13.10, 3.86) — тот же подбор, что у
  // «Подобрать оборудование», на станции, которая ещё не в КП; «Взять в КП» добавляет её как есть
  static key(){ const S=this.S; return JSON.stringify([NW.cat, S.req, S.ctype, S.ins, S.climate]); }
  static ready(){ return !!(this.pv && this.pv.x && !this.pv.busy && this.pv.key===this.key()); }
  static later(){ clearTimeout(this.t); this.t=setTimeout(()=>this.preview(), this.WAIT); }
  static async preview(){
    const t=NW.cat && typeById(NW.cat); if (!t || !t.station || NW.where!=='kp') return;
    const k=this.kind(t), need=(StationQuick.NEED[k]||[])[0], key=this.key();
    if (ReqNum.errors({ req:this.S.req }).length || !(ReqNum.num(this.S.req[need])>0)){ this.pv=null; this.pvDraw(t); return; }
    if (this.pv && this.pv.key===key) return;
    const pv=this.pv={ key, x:null, busy:true }; this.pvDraw(t);
    try{ const x=this.make(t), note=await TzPick.assemble(x, StationQuick.query(x)); StationReq.ensure(x).pick=String(note||'').slice(0, 900); pv.x=x; }
    catch(e){ pv.err=String(e && e.message || e); }
    pv.busy=false; if (this.pv===pv) this.pvDraw(t);
  }
  static pvDraw(t){ const el=$('#nsPv'); if (!el) return; el.innerHTML=this.pvHtml(t);
    const b=document.querySelector('#dlg.nw [data-nw="nsPick"]'); if (b && !NW.busy) b.textContent=this.ready() ? 'Взять в КП' : 'Подобрать станцию'; }
  /** итог подбора: состав коротко, контейнер с размером, главное замечание, 3D-вид */
  static pvHtml(t){
    const pv=this.pv; if (!pv || pv.key!==this.key()) return '';
    if (pv.busy) return '<p class="muted ns-pv-w">Подбираю станцию…</p>';
    if (pv.err || !pv.x) return `<p class="msg err">Не получилось подобрать: ${esc(pv.err||'')}</p>`;
    const x=pv.x, plan=StationUi.on(x) ? StationUi.plan(x) : null, c=kitContainer(x), n=StationLayout.n;
    const size=plan && plan.geo && plan.geo.ext ? `${n(plan.geo.ext[0])} × ${n(plan.geo.ext[1])} × ${n(plan.geo.ext[2])} мм` : '';
    const miss=String(StationReq.of(x).pick||'').match(/В каталоге нет: ([^]*?)(?: — добавьте вручную|$)/);
    const bad=plan && plan.level==='error' ? (plan.issues.find(i=>i.level==='error')||{}).text : '', wide=plan && (plan.issues||[]).find(i=>i.wide);
    const mode=plan && plan.mode && plan.mode.ends ? 'без продольного прохода (компрессор у торца)' : plan && plan.mode && plan.mode.tight ? 'проход «в крайнем случае»' : plan && plan.mode && plan.mode.cross ? 'агрегат поперёк' : '';
    const img=plan && plan.level!=='error' && plan.geo && plan.geo.ext ? `<img src="${esc(StationUi.url(StationView3D.svg(plan, StationUi.meta(x, plan))))}" alt="3D-вид станции">` : '';
    return `<div class="ns-pv-b"><div class="ns-pv-t"><b>${esc(String(x.name||t.item))}</b>
        ${StationQuick.lines(x).map(l=>`<div>${esc(l)}</div>`).join('')}
        ${c ? `<div class="muted">${esc(ctypeOf(c.ctype).name)}${size ? ', '+esc(size) : ''}${mode ? ' — '+esc(mode) : ''}</div>` : ''}
        ${bad ? `<p class="msg err">✕ ${esc(bad)}</p>` : wide ? `<p class="msg warn">⚠ ${esc(wide.text.split('.')[0])}</p>` : ''}
        ${miss ? `<p class="msg warn">⚠ В каталоге не нашлось: ${esc(miss[1])}</p>` : ''}</div>${img}</div>`;
  }
  /** новая станция: контейнер, элементы по умолчанию, требования */
  static make(t){
    const it=newItem(); it.attrs={ cat:t.id }; it.page=true; it.features=[]; it.kit={ parts:[] };
    const req=Object.fromEntries(Object.entries(this.S.req).map(([k, v])=>[k, String(v).trim()]).filter(([, v])=>v)); if (Object.keys(req).length) it.req=req;
    const c=kitNewContainer(this.S.ctype); contApply(c, { ins:this.S.ins, climate:this.S.climate }); it.kit.parts.push(c);
    StationDefaults.add(it, t.id);      // глушитель и бак ДГУ, трубопроводная обвязка
    kitSync(it); stationFill(it); stationAutoName(it);
    return it;
  }
  /** проверка ввода: ошибка — подсказка и фокус на поле; need — главное поле обязательно */
  static ok(t, need){
    const k=this.kind(t), bad=ReqNum.errors({ req:this.S.req }); if (bad.length){ toast(`Исправьте «${bad[0].label}»: ${bad[0].text}`); $(`[data-nsr="${bad[0].key}"]`)?.focus(); return false; }
    const n=(StationQuick.NEED[k]||[]); if (need && n.length && !(ReqNum.num(this.S.req[n[0]])>0)){ toast('Укажите '+n[1]+' — без неё станцию не подобрать'); $(`[data-nsr="${n[0]}"]`)?.focus(); return false; }
    return true;
  }
  /** «Подобрать станцию»: станция в КП и сразу подбор оборудования (как «Подобрать оборудование» в карточке); подобранная в
   *  предпросмотре — «Взять в КП» как есть */
  static async pick(t){ if (!this.ok(t, true)) return;
    if (this.ready()){ const x=this.pv.x; this.pv=null; nwFinish(x, 'kit', ()=>StationImages.soon(x)); return; }
    const it=this.make(t); nwFinish(it, 'kit', NW.where==='kp' ? i=>StationQuick.pick(i) : null); }
  /** «Выбрать вручную»: станция и окно каталога основного оборудования (по требованиям — рекомендуемый первым) */
  static main(t){ if (!this.ok(t, false)) return; const it=this.make(t);
    nwFinish(it, 'kit', i=>{ if (NW.where!=='kp') return; kitPickCat(i, t.station.main, 'main', '', KitNeed.mainPreset(S.items[i]) || { test:c=>!TzPick.mobile(c), need:'Укажите производительность в «Подборе станции» — покажем подходящие и рекомендуемый первым. Сейчас — все стационарные.' }); }); }
  static empty(t){ nwFinish(this.make(t), 'kit'); }
}

// новая позиция → в КП (карточка позиции) или в каталог (карточка каталога), открыть на вкладке tab
function nwFinish(it, tab, after){
  const d=$('#dlg'); d.close(); d.className='';
  if (NW.where==='catalog'){
    const src=it._src, props=it._srcProps, url=it._srcUrl, imgs=it._srcImgs;
    const doc=itemToDoc(it, { id:uid()+uid(), prices:[] });
    openCatEditor(doc, typeof cwAfterSave==='function'?cwAfterSave:null, true);
    const x=S.items[0]; Object.assign(x, {_src:src, _srcProps:props, _srcUrl:url, _srcImgs:imgs, _aiStep:it._aiStep, _aiMsg:it._aiMsg});
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

document.addEventListener('click', e=>{
  const d=e.target.closest('#dlg.nw'); if (!d) return;
  if (e.target.closest('[data-close]')){ d.close(); d.className=''; return; }
  const c=e.target.closest('[data-nwcat]'); if (c){ NW.cat=c.dataset.nwcat; nwDraw(); setTimeout(()=>($('#nwName')||document.querySelector('#dlg [data-nsr]'))?.focus(),30); return; }
  const h=e.target.closest('[data-nwadd]'); if (h){ const x=catCache.find(z=>z.id===h.dataset.nwadd); d.close(); d.className=''; if (x) addFromCatalog(x); return; }
  const go=e.target.closest('[data-nwgo]'); if (go){ NW.name=($('#nwName')||{}).value||NW.name; nwMakeUnit(go.dataset.nwgo); return; }
  const b=e.target.closest('[data-nw]'); if (!b) return;
  if (b.dataset.nw==='back'){ const t=typeById(NW.cat); NW.cat = NW.cat!=='station' && t.station ? 'station' : ''; nwDraw(); return; }
  if (b.dataset.nw==='newtype'){ d.close(); d.className=''; cwNewType(id=>newEquip('catalog', id)); return; }
  const st=typeById(NW.cat);
  if (b.dataset.nw==='nsCont'){ NewStation.S.cont=!NewStation.S.cont; nwDraw(); return; }
  if (b.dataset.nw==='nsPick') return NewStation.pick(st);
  if (b.dataset.nw==='nsMain') return NewStation.main(st);
  if (b.dataset.nw==='mkStation') return NewStation.empty(st);
  if (b.dataset.nw==='tz'){ d.close(); d.className=''; TzImport.pick(null); }
});
document.addEventListener('input', e=>{ if (!e.target.closest('#dlg.nw')) return; const t=e.target;
  if (t.id==='nwQ'){ NW.q=t.value; $('#nwRes').innerHTML=nwFound(); }
  if (t.dataset.nsr) NewStation.input(t);
  if (t.id==='nwName') NW.name=t.value;
  if (t.id==='nwUrl') NW.url=t.value; });
document.addEventListener('change', e=>{ if (!e.target.closest('#dlg.nw')) return;
  if (/^ns(Ct|Ins|Cl)$/.test(e.target.id)) NewStation.change(e.target); });
document.addEventListener('keydown', e=>{ if (!e.target.closest || !e.target.closest('#dlg.nw') || e.key!=='Enter') return;
  if (e.target.id==='nwQ'){ const x=quickMatches(NW.q)[0]; if (x){ e.preventDefault(); const d=$('#dlg'); d.close(); d.className=''; addFromCatalog(x); } }
  if (e.target.id==='nwUrl'){ e.preventDefault(); NW.name=($('#nwName')||{}).value||NW.name; nwMakeUnit('url'); }
  if (e.target.dataset.nsr){ e.preventDefault(); NewStation.pick(typeById(NW.cat)); } });
// событие close приходит позже самого закрытия: окно могли уже открыть снова (тем же мастером) — тогда не трогаем
document.addEventListener('close', e=>{ if (e.target.id==='dlg' && !e.target.open && e.target.classList.contains('nw')) e.target.className=''; }, true);
