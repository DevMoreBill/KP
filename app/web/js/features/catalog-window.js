// Окно каталога: отбор сверху, фильтры и категории слева, список с отметками, карточка-предпросмотр справа.
// Пакетные действия над отмеченными позициями: добавить в КП, перенести в другую категорию.
// Перенос — также перетаскиванием позиций на категорию. Размер окна меняется за угол, «⤢» — на весь экран.
//
// Устройство (классы):
//   CatalogIndex  — поиск: нормализация текста, поисковая строка позиции, атрибуты, наличие (статические методы)
//   CatalogFilter — условия отбора (поиск, категория, производитель, поставщик, параметры); FI — каталог, FO — опции позиции
//   CatalogSorter — сортировки: поле + направление, цены в рублях по курсу ЦБ
//   CatalogPanes  — размер окна и ширина панелей (границы перетаскиваются)
//   FeedBadge     — РРЦ и наличие у поставщика (значки в списке и карточке)
//   CatalogWindow — само окно (CW): состояние, отрисовка, действия, события
// Для других модулей — прежние имена: openCatalog, cwRedraw, cwAfterSave, cwNote, cwNewType, CW.mod, feedStockTxt.
'use strict';

// ---------- поиск: «DVK30-13» = «DVK D 30-13», «5.5» = «5,5», «далгакиран» = «Dalgakiran», латинская «C» в «СА11» = кириллическая
class CatalogIndex {
  static TR = {а:'a',б:'b',в:'v',г:'g',д:'d',е:'e',ж:'zh',з:'z',и:'i',й:'i',к:'k',л:'l',м:'m',н:'n',о:'o',п:'p',р:'r',с:'s',т:'t',у:'u',ф:'f',х:'h',ц:'c',ч:'ch',ш:'sh',щ:'sch',ъ:'',ы:'y',ь:'',э:'e',ю:'yu',я:'ya'};
  static HG = {а:'a',в:'b',е:'e',к:'k',м:'m',н:'h',о:'o',р:'p',с:'c',т:'t',у:'y',х:'x'};
  static tr(s){ return s.replace(/[а-я]/g, c=>CatalogIndex.TR[c]??c); }
  static fold(s){ return s.replace(/[авекмнорстух]/g, c=>CatalogIndex.HG[c]).replace(/[\s\-./,_()×x*]+/g,''); }
  /** атрибуты позиции и их нормализованные значения — с запоминанием на позиции */
  static attrs(x){ return x._a || (x._a = attrsOf(x)); }
  static nv(x, k){ const c=x._nv||(x._nv={}); return k in c ? c[k] : (c[k]=norm(CatalogIndex.attrs(x)[k])); }
  /** позиция изменилась — запомненное сбрасывается, совпадения с поиском считаются заново */
  static forget(x){ delete x._a; delete x._nv; delete x._hay; delete x._sup; FI.dropQuery(); FO.dropQuery(); }
  // облегчённая карточка несёт src / art, полная (после сохранения) — feed.id / feed.sku
  static src(x){ return x.src || x.feed?.id || ''; }
  static art(x){ return x.art || x.feed?.sku || CatalogIndex.attrs(x).article || ''; }
  static inStock(x){ const st=x.stock; return !!st && !st.gone && (st.qty!=null ? st.qty>0 : !!st.available); }
  /** поисковая строка позиции (один раз): текст, свёрнутый текст, транслит, модель без пробелов и знаков */
  static hay(x){ if (x._hay) return x._hay; const a=CatalogIndex.attrs(x), fold=CatalogIndex.fold;
    const plain=norm([x.name, x.spec, x.st||'', CatalogIndex.art(x), CW.supplierOf(x), ...Object.values(a), ...(x.groups||[]).flatMap(g=>(g.rows||[]).map(r=>r.k+' '+r.v))].join(' '));
    // модель без одиночных букв-исполнений: «DVK D 30-13» → «dvk3013», чтобы «DVK30-13» находил её
    const m=norm([a.model, x.name, CatalogIndex.art(x)].filter(Boolean).join(' ')), model=fold(m), model2=fold(m.replace(/(^|\s)[a-zа-яё](?=\s)/g,' '));
    return (x._hay={ plain, fold:fold(plain), tr:CatalogIndex.tr(plain), model, model2, m0:fold(norm(a.model||'')), name:norm(x.name) }); }
  /** слово запроса с готовыми «свёрнутой» формой и транслитом — считаются один раз на запрос, а не для каждой позиции */
  static word(w){ return {w, f:CatalogIndex.fold(w), t:CatalogIndex.tr(w)}; }
  static wordHit(h, q){ if (h.plain.includes(q.w)) return true; if (q.f.length>=2 && (h.fold.includes(q.f) || h.model2.includes(q.f))) return true;
    return q.t!==q.w && h.tr.includes(q.t); }
}

// ---------- условия отбора
class CatalogFilter {
  static NOSUP = 'Не указан';
  static rngOn(r){ return !!r && ((r.min??'')!=='' || (r.max??'')!==''); }
  constructor(){ Object.assign(this, { q:'', cat:'', maker:'', series:'', sup:'', f:{}, rng:{}, priced:false, stock:false, sort:'best', dir:1 }); }
  dropQuery(){ this._qs=null; }
  /** выбрана категория: её параметры (фильтры, диапазоны, серия) — заново */
  setCategory(cat){ this.cat=cat; this.f={}; this.rng={}; this.series=''; }
  resetParams(){ Object.assign(this, {series:'', f:{}, rng:{}}); }
  resetAll(){ Object.assign(this, {maker:'', series:'', sup:'', f:{}, rng:{}, priced:false, stock:false, q:''}); }
  /** включены фильтры по параметрам категории (кнопка «сбросить» над фильтрами) */
  isFiltered(){ return !!(this.series||Object.values(this.f).some(Boolean)||Object.values(this.rng).some(CatalogFilter.rngOn)); }
  /** сколько условий отбора включено (фильтры и строка поиска; категория — нет) */
  count(){ return [this.maker, this.series, this.sup, this.priced, this.stock, String(this.q||'').trim()].filter(Boolean).length
    + Object.values(this.f).filter(Boolean).length + Object.values(this.rng).filter(CatalogFilter.rngOn).length; }
  /** позиция подходит под все условия, кроме skip (счётчики вариантов фильтра не учитывают сам фильтр) */
  pass(x, skip, win){ const a=CatalogIndex.attrs(x), nv=CatalogIndex.nv;
    if (win.optFor!=null && !this.cat && !win.kindOk(x)) return false;
    if (skip!=='cat' && this.cat && a.cat!==this.cat) return false;
    for (const k of ['maker','series']) if (k!==skip && this[k] && nv(x,k)!==norm(this[k])) return false;
    for (const k in this.f) if (k!==skip && this.f[k] && nv(x,k)!==norm(this.f[k])) return false;
    for (const k in this.rng){ if (k===skip) continue; const r=this.rng[k]; if(!r) continue; const v=numOf(a[k]);
      if (r.min!==''&&r.min!=null && !(v>=+r.min)) return false; if (r.max!==''&&r.max!=null && !(v<=+r.max)) return false; }
    if (skip!=='sup' && this.sup && norm(win.supplierOf(x)||CatalogFilter.NOSUP)!==norm(this.sup)) return false;
    if (this.priced && !x.price) return false;
    if (this.stock && !CatalogIndex.inStock(x)) return false;
    if (this.q && !this.qHit(x)) return false;
    return true; }
  /** совпадение с поиском — один раз на позицию для текущего текста (счётчики фильтров спрашивают по многу раз) */
  qHit(x){
    if (this._qs!==this.q){ this._qs=this.q; this._qw=norm(this.q).split(' ').filter(Boolean).map(CatalogIndex.word); this._qf=CatalogIndex.fold(norm(this.q)); this._qm=new Map(); }
    let ok=this._qm.get(x.id); if (ok!==undefined) return ok;
    const h=CatalogIndex.hay(x), srv=CatalogSearch.ids(this.q);    // srv — найденное сервером по характеристикам
    ok = this._qw.every(w=>CatalogIndex.wordHit(h,w)) || (this._qf.length>=3 && (h.fold.includes(this._qf) || h.model2.includes(this._qf))) || (!!srv && srv.has(x.id));
    this._qm.set(x.id, ok); return ok; }
  /** пришёл ответ сервера по характеристикам: найденное им отмечается совпадением, остальное уже посчитано —
   *  список не пересчитывается заново (на 25 000 позициях второй полный проход удваивал время поиска). → сколько добавилось, −1 — пересчитать */
  addServer(q, ids){ if (this._qs!==q || !this._qm) return -1; let n=0; for (const id of ids) if (this._qm.get(id)===false){ this._qm.set(id, true); n++; } return n; }
  /** насколько позиция подходит к запросу: модель начинается с запроса → 0, запрос целиком в названии → 1, остальное → 2 */
  rel(x){ const q=norm(this.q); if (!q) return 2; const f=this._qs===this.q ? this._qf : CatalogIndex.fold(q), h=CatalogIndex.hay(x);
    if (f.length>=2 && (h.m0.startsWith(f) || h.model.includes(f) || h.model2.includes(f))) return 0; return h.name.includes(q) ? 1 : 2; }
}

const FI = new CatalogFilter();     // каталог: позиции КП
const FO = new CatalogFilter();     // опции позиции

// ---------- сортировка: поле + направление (↑ / ↓); позиции без значения — всегда в конце
class CatalogSorter {
  static SORTS = [['best','Рекомендуемые',1,'Сначала в наличии и с ценой, затем по основному параметру категории (при поиске — сначала точные совпадения модели)'],
    ['price','Цена',1,'В рублях по курсу ЦБ; без цены — закупочная цена, иначе в конце'],['stock','Наличие',-1,'Больше всего на складе — первыми'],
    ['name','Название',1,'По алфавиту, номера моделей — по возрастанию чисел'],['kp','Популярные в КП',-1,'Чаще всего попадали в коммерческие предложения'],
    ['upd','Обновлённые',-1,'Недавно изменённые позиции']];
  static COLL = new Intl.Collator('ru', {numeric:true});     // сравнение названий: как localeCompare(…, 'ru', {numeric}), но в разы быстрее
  static def(k){ const z=CatalogSorter.SORTS.find(x=>x[0]===k); return z ? z[2] : 1; }
  static stockN(x){ const st=x.stock; if (!st || st.gone) return null; return st.qty!=null ? (st.qty>0?st.qty:null) : st.available ? 1 : null; }
  constructor(win){ this.win=win; this.fx=null; this.fxLoading=false; }      // fx — курсы ЦБ к рублю: цены в разных валютах сравниваются в рублях
  fields(){ const F=this.win.F, t=F.cat?typeById(F.cat):null; return t ? t.fields.filter(f=>f.num) : []; }
  rub(v, cur){ if (!v) return null; cur=cur||'RUB'; if (cur==='RUB') return v; const r=+(this.fx?.[cur]) || +String(S.pricing?.rates?.[cur]||'').replace(',','.');
    return r>0 ? v*r : null; }
  priceRub(x){ return x.price ? this.rub(x.price, x.priceCur) : x.cost ? this.rub(x.cost, x.costCur) : null; }
  loadFx(){ if (this.fx || this.fxLoading) return; this.fxLoading=true;
    api('/api/cbr').then(r=>{ if (r && (r.EUR||r.USD)){ this.fx=r; if (this.win.F.sort==='price') this.win.list(); } }).catch(()=>{}).finally(()=>{ this.fxLoading=false; }); }
  /** сравнение позиций для текущей сортировки */
  compare(){ const F=this.win.F, s=F.sort, d=F.dir||1, ord=new Map(TYPES.map((t,i)=>[t.id,i])), A=CatalogIndex.attrs;
    const byName=(p,q)=>CatalogSorter.COLL.compare(String(p.name), String(q.name));
    const num=(f)=>{ const m=new Map(); return x=>{ if (!m.has(x.id)){ const v=f(x); m.set(x.id, v==null||!isFinite(v)||v===0?null:v); } return m.get(x.id); }; };
    const cmp=(g)=>(p,q)=>{ const a=g(p), b=g(q); return a==null ? (b==null?0:1) : b==null ? -1 : (a-b)*d; };
    const by=g=>{ const c=cmp(num(g)); return (p,q)=>c(p,q)||byName(p,q); };
    if (s==='name') return (p,q)=>byName(p,q)*d;
    if (s==='price') return by(x=>this.priceRub(x));
    if (s==='stock') return by(CatalogSorter.stockN);
    if (s==='kp') return by(x=>x.pricesCount||(x.prices||[]).length);
    if (s==='upd') return by(x=>Date.parse(x.updatedAt||'')||null);
    if (s.startsWith('f:')){ const k=s.slice(2); return by(x=>numOf(A(x)[k])); }
    // рекомендуемые: точные совпадения → в наличии с ценой → с ценой → остальные; внутри — по категориям (порядок разделов) и основному параметру
    const q=String(F.q||'').trim(), rel=num(x=>q?F.rel(x)+1:null), main=num(x=>{ const a=A(x), t=typeById(a.cat); return numOf(a[t.main||'kw']); });
    const tier=x=>(x.price||x.cost ? 0 : 2) + (CatalogIndex.inStock(x) ? 0 : 1), cm=cmp(main);
    return (p,q2)=> (q ? (rel(p)-rel(q2)) : 0) || tier(p)-tier(q2) || (ord.get(A(p).cat)??999)-(ord.get(A(q2).cat)??999) || cm(p,q2) || byName(p,q2); }
  /** список сортировок (плюс числовые параметры выбранной категории) и кнопка направления */
  renderBox(){ const F=this.win.F, sel=$('#cwSort'), dir=$('#cwDir'), SORTS=CatalogSorter.SORTS; if (!sel) return;
    const fl=this.fields(); if (!SORTS.some(x=>x[0]===F.sort) && !(F.sort.startsWith('f:') && fl.some(f=>'f:'+f.key===F.sort))){ F.sort='best'; F.dir=1; }
    morph(sel, SORTS.map(([k,l,,h])=>`<option value="${k}" title="${esc(h)}"${F.sort===k?' selected':''}>${l}</option>`).join('')
      + (fl.length?`<optgroup label="Параметры: ${esc(typeById(F.cat).name)}">${fl.map(f=>`<option value="f:${esc(f.key)}"${F.sort==='f:'+f.key?' selected':''}>${esc(f.label)}${f.unit?', '+esc(f.unit):''}</option>`).join('')}</optgroup>`:''));
    sel.value=F.sort; const up=F.dir>0;
    dir.textContent = F.sort==='name' ? (up?'А→Я':'Я→А') : up?'↑ по возрастанию':'↓ по убыванию';
    dir.title='Сменить направление сортировки'; dir.setAttribute('aria-label', up?'По возрастанию — сменить на убывание':'По убыванию — сменить на возрастание');
    dir.hidden = F.sort==='best'; }
}

// ---------- размер окна и ширина панелей: фильтры | список | карточка — границы перетаскиваются мышью (или стрелками),
// двойной щелчок — как было; всё запоминается в браузере
class CatalogPanes {
  static PANE = { nav:[200,560], pv:[300,900] };
  static MIDMIN = 380;
  constructor(d){ this.d=d; }
  static read(key){ try{ return JSON.parse(localStorage.getItem(key)||'{}')||{}; }catch(e){ return {}; } }
  loadSize(){ const d=this.d, z=CatalogPanes.read('kp.catwin2');
    d.classList.toggle('max', !!z.max);
    if (z.w && z.h){ d.style.width=Math.min(z.w, innerWidth)+'px'; d.style.height=Math.min(z.h, innerHeight)+'px'; } else { d.style.width=''; d.style.height=''; } }
  saveSize(){ const d=this.d; try{ const o=CatalogPanes.read('kp.catwin2'), max=d.classList.contains('max');
    const z = max ? {...o, max:true} : {max:false, w:Math.round(d.offsetWidth), h:Math.round(d.offsetHeight)}; localStorage.setItem('kp.catwin2', JSON.stringify(z)); }catch(e){} }
  layout(){ const d=this.d, w=d.clientWidth; d.classList.toggle('narrow', w<1100); d.classList.toggle('tiny', w<760); this.pos(); }
  load(){ const z=CatalogPanes.read('kp.cwpanes');
    for (const k in CatalogPanes.PANE) if (z[k]) this.d.style.setProperty('--cw-'+k, z[k]+'px'); else this.d.style.removeProperty('--cw-'+k); }
  save(){ const z={}; for (const k in CatalogPanes.PANE){ const v=parseInt(this.d.style.getPropertyValue('--cw-'+k)); if (v) z[k]=v; }
    try{ localStorage.setItem('kp.cwpanes', JSON.stringify(z)); }catch(e){} }
  reset(k){ this.d.style.removeProperty('--cw-'+k); this.pos(); this.save(); }
  /** положение границ и широкой карточки — по фактическим размерам панелей */
  pos(){ const d=this.d, b=d.querySelector('.cw-b'); if (!b) return; const br=b.getBoundingClientRect();
    const nav=d.querySelector('.cw-nav'), pv=d.querySelector('.cw-pv');
    d.querySelectorAll('.cw-split').forEach(sp=>{ const k=sp.dataset.split, el=k==='nav'?nav:pv; const r=el?.getBoundingClientRect();
      const show = r && r.width>0 && !d.classList.contains('tiny') && !(k==='pv' && d.classList.contains('narrow')) && !d.classList.contains('pvwide');
      sp.hidden=!show; if (!show) return;
      sp.style.left=Math.round((k==='nav' ? r.right : r.left) - br.left - 4)+'px'; sp.setAttribute('aria-valuenow', Math.round(r.width)); });
    if (d.classList.contains('pvwide') && pv) pv.style.left = (d.classList.contains('tiny') || !nav ? 0 : Math.round(nav.getBoundingClientRect().width))+'px'; else if (pv) pv.style.left=''; }
  set(k, w){ const d=this.d, b=d.querySelector('.cw-b').getBoundingClientRect(), [lo,hi]=CatalogPanes.PANE[k];
    const other = k==='nav' ? (d.classList.contains('narrow') ? 0 : d.querySelector('.cw-pv').getBoundingClientRect().width) : d.querySelector('.cw-nav').getBoundingClientRect().width;
    w=Math.round(Math.max(lo, Math.min(hi, b.width-other-CatalogPanes.MIDMIN, w))); d.style.setProperty('--cw-'+k, w+'px'); this.pos(); }
  bind(){ const d=this.d;
    d.addEventListener('pointerdown', e=>{ const sp=e.target.closest?.('.cw-split'); if (!sp || e.button!==0) return; e.preventDefault();
      const k=sp.dataset.split, b=d.querySelector('.cw-b'); sp.setPointerCapture(e.pointerId); d.classList.add('resizing');
      const mv=ev=>{ const r=b.getBoundingClientRect(); this.set(k, k==='nav' ? ev.clientX-r.left : r.right-ev.clientX); };
      const up=()=>{ sp.removeEventListener('pointermove',mv); sp.removeEventListener('pointerup',up); sp.removeEventListener('pointercancel',up); d.classList.remove('resizing'); this.save(); };
      sp.addEventListener('pointermove',mv); sp.addEventListener('pointerup',up); sp.addEventListener('pointercancel',up); });
    d.addEventListener('keydown', e=>{ const sp=e.target.closest?.('.cw-split'); if (!sp || !['ArrowLeft','ArrowRight','Home'].includes(e.key)) return; e.preventDefault();
      const k=sp.dataset.split; if (e.key==='Home') return this.reset(k);
      const el=d.querySelector(k==='nav'?'.cw-nav':'.cw-pv'), st=(e.key==='ArrowRight')===(k==='nav') ? 24 : -24;
      this.set(k, el.getBoundingClientRect().width+st); this.save(); }); }
}

// ---------- РРЦ и наличие у поставщика (позиции из товарного фида, feeds.py)
class FeedBadge {
  static stockText(st){ if (!st) return ''; if (st.gone) return 'нет в фиде';
    const n=v=>String(v).replace('.',',');
    if (st.qty!=null){
      if (st.qty>0) return `в наличии ${n(st.qty)} шт.${st.transit?` + ${n(st.transit)} в пути`:''}`;
      if (st.transit) return `в пути ${n(st.transit)} шт.${st.eta?' ('+st.eta+')':''}`;
      if (st.prod) return `в производстве ${n(st.prod)} шт.`;
      return st.available ? 'под заказ' : 'нет в наличии'; }
    return st.available ? 'в наличии' : 'нет в наличии'; }
  /** подробности остатков: склады, в пути / в производстве, ожидаемая дата, акция — для подсказки */
  static stockTip(st){ if (!st) return '';
    const out=[], n=v=>String(v).replace('.',',');
    (st.wh||[]).forEach(([w,q])=>out.push(`${w}: ${n(q)} шт.`));
    if (st.transit) out.push(`в пути: ${n(st.transit)} шт.${st.eta?' — ожидается '+st.eta:''}`);
    if (st.prod) out.push(`в производстве: ${n(st.prod)} шт.${st.eta&&!st.transit?' — ожидается '+st.eta:''}`);
    if (st.promo) out.push(`акция: ${st.promo}`);
    return out.join('; '); }
  static html(x){ const r=x.rrc, st=x.stock; if ((!r && !st) || !FEAT.on('feedInfo')) return '';
    const up=r&&r.prev&&r.price>r.prev, dn=r&&r.prev&&r.price<r.prev, ok=st&&!st.gone&&(st.qty!=null?st.qty>0:st.available), tip=FeedBadge.stockTip(st);
    return `<span class="fd-b">${r?`<span class="fd-rrc" title="Рекомендованная розничная цена поставщика${r.at?' на '+esc(r.at):''}${r.prev?`; прежняя ${money(r.prev)} ${curSh(r.cur||'RUB')}${r.prevAt?' ('+esc(r.prevAt)+')':''}`:''}">РРЦ ${money(r.price)} ${curSh(r.cur||'RUB')}${up?' <i class="up">▲</i>':dn?' <i class="dn">▼</i>':''}</span>`:''}${st?`<span class="fd-st ${ok?'ok':st.gone?'gone':(st.transit||st.prod)?'wait':'no'}" title="Наличие у поставщика${st.at?' на '+esc(st.at):''}${tip?': '+esc(tip):''}">${esc(FeedBadge.stockText(st))}</span>`:''}${st&&st.promo&&!st.gone?`<span class="fd-promo" title="${esc(st.promo)}">акция</span>`:''}</span>`; }
}
const feedStockTxt = st => FeedBadge.stockText(st);      // для раздела «Цены» (pricing.js)

// ---------- окно каталога
class CatalogWindow {
  static PAGE = 60;           // строк списка за раз: остальные — при прокрутке (150 строк сразу тормозили слабые ПК)
  constructor(){
    // режим (позиции КП или опции позиции), отметки, открытая карточка, последний перенос (для отмены)
    Object.assign(this, { pend:new Set(), mod:false, optFor:null, F:FI, sel:new Set(), active:null, limit:CatalogWindow.PAGE, docs:[], view:[], lastCk:null, undo:null, note:'', busy:'', drag:null,
      src:{}, sups:[], tab:'' });      // src — фиды-источники (id → поставщик), sups — справочник поставщиков, tab — вкладка слева (flt / cats)
    this.sorter = new CatalogSorter(this);
    this.panes = null;
  }

  dlg(){ let d=$('#catdlg'); if(!d){ d=document.createElement('dialog'); d.id='catdlg'; d.className='catwin'; d.setAttribute('aria-label','Каталог'); document.body.appendChild(d); }
    if (!this.panes || this.panes.d!==d) this.panes=new CatalogPanes(d); return d; }

  // ---------- данные
  /** поставщик позиции: фид-источник (или поставщик, к которому фид привязан), иначе — по производителю из справочника */
  supplierOf(x){ if (x._sup!==undefined) return x._sup; let s='';
    const src=CatalogIndex.src(x); if (src) s=(this.src[src]||{}).name||src;
    else { const m=norm(CatalogIndex.attrs(x).maker); if (m){ const z=this.sups.find(z=>norm(z.name)===m) || this.sups.find(z=>(z.makers||[]).some(k=>norm(k)===m)); s=z?z.name:''; } }
    return (x._sup=s); }
  kindOk(x){ if (this.optFor==null) return true; const t=typeById(CatalogIndex.attrs(x).cat); return t.role==='accessory' || x.kind==='option'; }
  pass(x, skip){ return this.F.pass(x, skip, this); }
  doc(id){ return this.docs.find(z=>z.id===id); }
  /** поисковые строки всех позиций — заранее, в простое браузера, пачками (первый поиск — без задержки) */
  warm(){ const docs=this.docs; let i=0; const idle=window.requestIdleCallback||(f=>setTimeout(()=>f({timeRemaining:()=>8}),30));
    const step=dl=>{ if (docs!==this.docs) return; while (i<docs.length && dl.timeRemaining()>2) CatalogIndex.hay(docs[i++]); if (i<docs.length) idle(step); };
    idle(step); }
  /** режим модерации и товары, правки которых ждут решения администратора */
  async loadPending(){ try{ const r=await api('/api/catalog/pending'); this.mod=!!r.moderation; this.pend=new Set(r.ids||[]); }catch(e){} }
  /** поставщики позиций: фиды-источники и справочник поставщиков (для фильтра «Поставщик» и поиска по нему) */
  async loadSources(){
    const [src, sups] = await Promise.all([api('/api/catalog/sources').catch(()=>({})), api('/api/suppliers').catch(()=>[])]);
    const s2 = src && typeof src==='object' && !Array.isArray(src) ? src : {}, u2 = Array.isArray(sups) ? sups : [], key=JSON.stringify([s2, u2]);
    if (key===this.srcKey) return;            // поставщики не менялись — готовые поисковые строки остаются
    this.srcKey=key; this.src=s2; this.sups=u2;
    for (const L of new Set([this.docs, catCache])) L.forEach(x=>{ delete x._sup; delete x._hay; });
    FI.dropQuery(); FO.dropQuery(); }
  /** после запуска, в простое: поставщики и поисковые строки — первый поиск в каталоге без задержки */
  async prewarm(){ this.sorter.loadFx(); await this.loadSources(); if (!$('#catdlg')?.open){ this.docs=catCache; this.warm(); } }
  async reload(){ await refreshCat(); await this.loadPending(); this.docs=catCache; renderForm(); }

  // ---------- левая панель: фильтры по параметрам категории
  facet(key, label, inF){ const F=this.F, cnt=new Map();
    this.docs.filter(x=>this.pass(x,key)).forEach(x=>{ const v=CatalogIndex.attrs(x)[key]; if(v==null||v==='') return; const n=CatalogIndex.nv(x,key); const c=cnt.get(n)||{v:String(v),n:0}; c.n++; cnt.set(n,c); });
    const cur=inF?F.f[key]:F[key];
    const opts=[...cnt.values()].sort((p,q)=>String(p.v).localeCompare(String(q.v),'ru',{numeric:true}));
    if (!opts.length && !cur) return '';
    return `<label class="f"><span>${esc(label)}</span><select data-f="${key}" data-in="${inF?1:''}"><option value="">Все</option>${opts.map(o=>`<option value="${esc(o.v)}"${norm(cur)===norm(o.v)?' selected':''}>${esc(o.v)} (${o.n})</option>`).join('')}${cur&&!cnt.has(norm(cur))?`<option selected>${esc(cur)}</option>`:''}</select></label>`; }
  range(f){ const F=this.F, r=F.rng[f.key]||{min:'',max:''}, chips=f.chips||[];
    const has=this.docs.some(x=>this.pass(x,f.key)&&numOf(CatalogIndex.attrs(x)[f.key])!=null); if(!has && r.min===''&&r.max==='') return '';
    return `<div class="f"><span class="muted">${esc(f.label)}${f.unit?', '+esc(f.unit):''}</span><div class="kw"><input type="text" inputmode="decimal" data-rk="${esc(f.key)}" data-rs="min" placeholder="от" value="${esc(r.min??'')}"><input type="text" inputmode="decimal" data-rk="${esc(f.key)}" data-rs="max" placeholder="до" value="${esc(r.max??'')}"></div>
      ${chips.length?`<div class="chips">${chips.map(([lo,hi])=>{ const on=String(r.min)===String(lo||'')&&String(r.max)===String(hi??''); return `<button class="chip${on?' on':''}" type="button" data-rc="${esc(f.key)}" data-lo="${lo||''}" data-hi="${hi??''}">${hi==null?'от '+fnum(lo):(lo?fnum(lo)+'–'+fnum(hi):'до '+fnum(hi))}</button>`; }).join('')}</div>`:''}</div>`; }

  // ---------- верхняя панель: категория, производитель, поставщик, «с ценой», «в наличии» — видны всегда, без прокрутки
  counts(key, val){ const m=new Map(); this.docs.forEach(x=>{ if (!this.kindOk(x) || !this.pass(x,key)) return; const v=val(x); if (v==null||v==='') return;
    const k=norm(v); const c=m.get(k)||{v:String(v),n:0}; c.n++; m.set(k,c); }); return m; }
  selHtml(key, label, m, cur, all){ const opts=[...m.values()].sort((p,q)=>String(p.v).localeCompare(String(q.v),'ru',{numeric:true}));
    const has=!cur||m.has(norm(cur));
    return `<label class="cw-sel${cur?' on':''}"><span>${label}</span><select data-top="${key}" aria-label="${label}"><option value="">${all}</option>${opts.map(o=>`<option value="${esc(o.v)}"${norm(cur)===norm(o.v)?' selected':''}>${esc(o.v)} · ${o.n}</option>`).join('')}${has?'':`<option selected>${esc(cur)} · 0</option>`}</select></label>`; }
  bar(){ const F=this.F, el=$('#cwBar'); if (!el) return; const A=CatalogIndex.attrs;
    const cc=this.counts('cat', x=>A(x).cat), groups=[...new Set(TYPES.map(t=>t.group||'Прочее'))];
    const cat=`<label class="cw-sel cw-selcat${F.cat?' on':''}"><span>Категория</span><select data-top="cat" aria-label="Категория"><option value="">Все категории · ${[...cc.values()].reduce((a,c)=>a+c.n,0)}</option>${groups.map(g=>{
        const ts=TYPES.filter(t=>(t.group||'Прочее')===g && ((cc.get(norm(t.id))||{}).n || F.cat===t.id)); if (!ts.length) return '';
        return `<optgroup label="${esc(g)}">${ts.map(t=>`<option value="${esc(t.id)}"${F.cat===t.id?' selected':''}>${esc(t.name)} · ${(cc.get(norm(t.id))||{}).n||0}</option>`).join('')}</optgroup>`; }).join('')}</select></label>`;
    const sup=this.counts('sup', x=>this.supplierOf(x)||CatalogFilter.NOSUP);
    morph(el, cat + this.selHtml('maker','Производитель', this.counts('maker', x=>A(x).maker), F.maker, 'Все производители')
      + this.selHtml('sup','Поставщик', sup, F.sup, 'Все поставщики')
      + `<div class="cw-togs"><label class="cw-tog${F.priced?' on':''}"><input type="checkbox" id="cwPriced" ${F.priced?'checked':''}> С ценой</label>
         <label class="cw-tog${F.stock?' on':''}" title="Есть на складе поставщика (по фиду или файлу остатков)"><input type="checkbox" id="cwStock" ${F.stock?'checked':''}> В наличии</label></div>`); }

  // ---------- выбранные условия — плашками с крестиком над списком
  chips(){ const F=this.F, t=F.cat?typeById(F.cat):null, out=[];
    const chip=(key,txt)=>out.push(`<button type="button" class="cw-chip" data-chip="${esc(key)}" title="Убрать условие">${esc(txt)}<i aria-hidden="true">✕</i></button>`);
    if (String(F.q||'').trim()) chip('q', '«'+F.q.trim()+'»');
    if (t) chip('cat', t.name);
    if (F.maker) chip('maker', F.maker); if (F.sup) chip('sup', 'Поставщик: '+F.sup); if (F.series) chip('series', 'Серия '+F.series);
    for (const k in F.f) if (F.f[k]){ const f=t?.fields.find(z=>z.key===k); chip('f:'+k, (f?f.label+': ':'')+F.f[k]); }
    for (const k in F.rng){ const r=F.rng[k]; if (!CatalogFilter.rngOn(r)) continue; const f=t?.fields.find(z=>z.key===k)||{label:k};
      chip('r:'+k, `${f.label}: ${(r.min??'')!==''?'от '+fnum(+r.min):''}${(r.min??'')!==''&&(r.max??'')!==''?' ':''}${(r.max??'')!==''?'до '+fnum(+r.max):''}${f.unit?' '+f.unit:''}`); }
    if (F.priced) chip('priced', 'С ценой'); if (F.stock) chip('stock', 'В наличии');
    return out.length ? out.join('') + `<button type="button" class="lnk cw-clr" data-cw="resetall">Сбросить всё</button>` : ''; }

  // ---------- отрисовка: слева вкладки «Фильтры» (параметры категории — сразу сверху) и «Категории» (дерево, перенос перетаскиванием)
  nav(){
    const F=this.F, cnt=new Map(); let all=0;
    this.docs.forEach(x=>{ if(!this.kindOk(x)) return; const c=CatalogIndex.attrs(x).cat; cnt.set(c,(cnt.get(c)||0)+1); all++; });
    const t=F.cat?typeById(F.cat):null, tab=this.tab||(t?'flt':'cats');
    const nf=[F.series].filter(Boolean).length+Object.values(F.f).filter(Boolean).length+Object.values(F.rng).filter(CatalogFilter.rngOn).length;
    const tabs=`<div class="cw-tabs" role="tablist"><button type="button" role="tab" class="${tab==='flt'?'on':''}" aria-selected="${tab==='flt'}" data-tab="flt">Фильтры${nf?` <b>${nf}</b>`:''}</button>
      <button type="button" role="tab" class="${tab==='cats'?'on':''}" aria-selected="${tab==='cats'}" data-tab="cats">Категории</button></div>`;
    let body;
    if (tab==='cats'){
      const groups=[...new Set(TYPES.map(t=>t.group||'Прочее'))];
      let fold={}, hideZero=false; try{ fold=JSON.parse(localStorage.getItem('kp.cwfold')||'{}')||{}; hideZero=localStorage.getItem('kp.cwzero')==='1'; }catch(e){}
      const cats=groups.map(g=>{ const ts=TYPES.filter(t=>(t.group||'Прочее')===g && (this.optFor==null || t.role==='accessory' || cnt.get(t.id) || F.cat===t.id) && (!hideZero || cnt.get(t.id) || F.cat===t.id));
        const total=ts.reduce((a,t)=>a+(cnt.get(t.id)||0),0), shut=!!fold[g] && !ts.some(t=>t.id===F.cat);
        return ts.length ? `<button type="button" class="cw-grp${shut?' shut':''}" data-cwfold="${esc(g)}" aria-expanded="${!shut}" title="${shut?'Развернуть':'Свернуть'} раздел"><span>${esc(g)}</span><i>${total}</i></button>`+(shut?'':ts.map(t=>{ const n=cnt.get(t.id)||0;
          return `<button type="button" class="cw-cat${F.cat===t.id?' on':''}${n?'':' zero'}" data-cat="${esc(t.id)}" data-dropcat="${esc(t.id)}" title="${esc(t.name)}"><span>${esc(t.name)}</span><i>${n}</i></button>`; }).join('')) : ''; }).join('');
      body=`${this.optFor==null?'<p class="cw-hint">Позиции можно перетащить мышью на другую категорию.</p>':''}<div class="cw-cats">
          <button type="button" class="cw-cat all${!F.cat?' on':''}" data-cat=""><span>Все позиции</span><i>${all}</i></button>${cats}
          ${this.optFor==null?'<button type="button" class="cw-cat add" data-cw="newtype">+ Новая категория</button>':''}
          <label class="cw-chk cw-zero"><input type="checkbox" data-cwzero ${hideZero?'checked':''}> Скрыть пустые категории</label></div>
        ${this.optFor==null?`<p class="cw-cap"><button type="button" class="lnk cw-tset" data-cw="types" title="Параметры, фильтры, ключевые параметры на титуле, быстрые опции">⚙ Настроить категории</button></p>`:''}`;
    } else {
      let flt=this.facet('series','Серия');
      if (t){ for (const f of t.fields) if (f.range) flt+=this.range(f); for (const f of t.fields) if (f.facet) flt+=this.facet(f.key,f.label,true); }
      const top=[...cnt.entries()].filter(([,n])=>n).sort((p,q)=>q[1]-p[1]).slice(0,10);
      body=`<p class="cw-cap">${t?esc(t.name):'Все категории'} ${F.isFiltered()?'<button type="button" class="lnk" data-cw="reset">сбросить</button>':''}</p>
        <div class="cw-flt">${flt}
          ${t?'':`<p class="cw-hint" style="margin:0">Выберите категорию — появятся фильтры по её параметрам: мощность, давление, производительность…</p>
            <div class="cw-qcat">${top.map(([id,n])=>`<button type="button" class="chip" data-cat="${esc(id)}">${esc(typeById(id).name)} <i>${n}</i></button>`).join('')}</div>`}
          ${t&&this.optFor==null?`<button type="button" class="lnk cw-tset2" data-cw="types">⚙ Какие параметры показывать в фильтрах</button>`:''}</div>`;
    }
    morph($('#cwNav'), tabs + body + `<div class="cw-navok"><button class="btn primary" type="button" data-cw="nav" id="cwNavOk">Показать позиции</button></div>`);
  }

  // ---------- список
  tags(x){ const a=CatalogIndex.attrs(x), t=typeById(a.cat), out=[];
    const kp=t.fields.filter(f=>f.kpi&&a[f.key]!=null&&a[f.key]!=='').slice(0,3).map(f=>fmtField(f,a[f.key]));
    if (kp.length) out.push(`<span class="tag kwt">${esc(kp.join(' · '))}</span>`);
    const fac=t.fields.filter(f=>f.facet&&!f.kpi&&a[f.key]&&String(a[f.key])!=='Нет').slice(0,3);
    for (const f of fac){ const v=String(a[f.key])==='Да' ? f.label : f.key==='engine'&&a.engineModel ? a[f.key]+' '+a.engineModel : fmtField(f,a[f.key]); out.push(`<span class="tag">${esc(v)}</span>`); }
    if (!this.F.cat) out.push(`<span class="tag tt">${esc(t.name)}</span>`);
    return out.length?`<div class="tags">${out.join('')}</div>`:''; }
  inKp(id){ if (this.optFor!=null) return (S.items[this.optFor]?.options||[]).some(o=>o.catId===id); return S.items.some(it=>it.catId===id); }
  addLabel(id, long){ const inn=this.inKp(id);
    if (this.optFor!=null) return inn ? '✓ Добавлено' : (long?'Добавить опцией':'Опцией');
    return inn ? (long?'Уже в КП: ещё 1 шт.':'✓ +1 шт.') : (long?'Добавить в КП':'В КП'); }
  /** ссылка из данных — только на сайт (http/https), не javascript: и не file: */
  static webUrl(u){ return /^https?:\/\//i.test(String(u||'')); }
  static priceHtml(x){ return x.price ? `${money(x.price)} ${curSh(x.priceCur||'RUB')}` : x.cost ? `<small>закупка</small>${money(x.cost)} ${curSh(x.costCur||'RUB')}` : '<small>без цены</small>'; }
  row(x){ const id=x.id, n=x.pricesCount||(x.prices||[]).length, inn=this.inKp(id);
    return `<div class="cw-row${this.sel.has(id)?' sel':''}${this.active===id?' act':''}" data-id="${esc(id)}" draggable="${this.optFor==null}">
      <label class="ck" title="Отметить (Shift — диапазон)"><input type="checkbox" data-ck ${this.sel.has(id)?'checked':''} aria-label="Отметить"></label>
      ${x.photo?`<img src="${esc(x.photo.src)}" alt="" loading="lazy">`:'<i class="ph"></i>'}
      <div class="cw-mn"><b>${esc(x.name)}</b>${this.pend.has(id)?'<span class="modb">На модерации</span>':''}${this.tags(x)}</div>
      <div class="cw-pr">${CatalogWindow.priceHtml(x)}${FeedBadge.html(x)}${n?`<small>в КП ${n} ${plural(n,'раз','раза','раз')}</small>`:''}</div>
      <button class="btn sm${inn?' in':''}" type="button" data-add title="${inn?(this.optFor!=null?'Уже добавлено':'Уже в КП — увеличить количество'):''}">${this.addLabel(id)}</button></div>`; }
  list(){
    const F=this.F;
    const list=this.docs.filter(x=>this.pass(x));
    if (F.sort==='price') this.sorter.loadFx();
    list.sort(this.sorter.compare()); this.sorter.renderBox();
    this.view=list;
    $('#cwCnt').innerHTML = this.docs.length ? `Найдено: <b>${list.length}</b> из ${this.docs.length}` : '';
    morph($('#cwChips'), this.chips()); this.bar();
    const all=$('#cwAll'); const k=list.filter(x=>this.sel.has(x.id)).length; all.checked=!!list.length && k===list.length; all.indeterminate=k>0 && k<list.length;
    const ok=$('#cwNavOk'); if (ok) ok.textContent = list.length ? `Показать: ${list.length}` : 'Ничего не найдено';
    morph($('#cwList'), list.length ? list.slice(0,this.limit).map(x=>this.row(x)).join('')
        + (list.length>this.limit?`<div class="cw-more"><button class="btn" type="button" data-more>Показать ещё (${list.length-this.limit})</button></div>`:'')
      : `<p class="empty">${this.docs.length?'Ничего не найдено — ослабьте фильтры или выберите «Все позиции».':'Каталог пуст. Добавьте позицию, загрузите файл каталога или импортируйте таблицу из Excel (меню «Ещё»).'}</p>`);    this.autoMore();
  }
  /** следующая порция строк списка */
  more(){ this.limit+=CatalogWindow.PAGE*2; this.list(); }
  /** строки дорисовываются сами, когда прокрутка подходит к концу списка («Показать ещё» — на случай без прокрутки) */
  autoMore(){ this.io?.disconnect(); const box=$('#cwList'), m=box?.querySelector('.cw-more'); if (!m || !window.IntersectionObserver) return;
    this.io=new IntersectionObserver(es=>{ if (es.some(e=>e.isIntersecting)){ this.io.disconnect(); this.more(); } }, {root:box, rootMargin:'0px 0px 600px 0px'});
    this.io.observe(m); }
  /** обновить фильтры и список (после смены условий) */
  refresh(){ this.nav(); this.list(); }

  // ---------- подвал: подсказка, пакетные действия, «Готово»
  foot(){
    const f=$('#cwF'); if(!f) return; const n=this.sel.size;
    if (this.busy){ f.className='cw-f busy'; f.innerHTML=`<span class="spin"></span><b>${esc(this.busy)}</b>`; return; }
    if (n){ f.className='cw-f bulk'; f.innerHTML=`<b>Отмечено: ${n}</b>
        <button class="btn primary" type="button" data-bulk="add">${this.optFor!=null?'Добавить опциями':'Добавить в КП'}</button>
        ${this.optFor==null?'<button class="btn" type="button" data-bulk="move">Перенести в категорию…</button>':''}
<span class="sp"></span>
        <button class="btn ghost" type="button" data-bulk="clear">Снять отметки</button>`; return; }
    const k = this.optFor!=null ? (S.items[this.optFor]?.options||[]).filter(o=>o.name).length : S.items.filter(x=>x.name).length;
    f.className='cw-f'; f.innerHTML=`<span class="muted cw-note">${esc(this.note||'Отметьте галочками несколько позиций — появятся пакетные действия.'+(matchMedia('(pointer:coarse)').matches?'':' Позиции можно перетащить мышью на категорию слева.'))}</span>
      ${this.undo?'<button class="btn ghost" type="button" data-cw="undo">Отменить перенос</button>':''}<span class="sp"></span>
      <span class="muted">${this.optFor!=null?'Опций у позиции':'Позиций в КП'}: <b>${k}</b></span><button class="btn primary" type="button" data-cw="done">${this.optFor!=null?'Готово':'Готово — к КП'}</button>`; }
  say(t){ this.note=t||''; this.foot(); }
  setBusy(t){ this.busy=t||''; this.foot(); }
  redraw(){ if (!$('#cwList')) return; this.nav(); this.list(); this.foot(); this.preview(); }

  // ---------- карточка-предпросмотр
  card(x, loading){
    const a=attrsOf(x), t=typeById(a.cat);
    const kpi=t.fields.filter(f=>f.kpi&&a[f.key]!=null&&a[f.key]!=='').map(f=>`<div class="pv-k"><b>${esc(fmtField(f,a[f.key]))}</b><span>${esc(f.label)}</span></div>`).join('');
    const params=[['Производитель',a.maker],['Серия',a.series],['Модель',a.model],...t.fields.filter(f=>!f.kpi).map(f=>[f.label,fmtField(f,a[f.key])])].filter(([,v])=>v!=null&&v!=='');
    const feats=(x.features||[]).filter(f=>f.label||f.text), groups=(x.groups||[]).filter(g=>(g.rows||[]).some(r=>r.k||r.v));
    const gal=(x.gallery||[]).filter(g=>g.src&&g.on!==false), hist=(x.prices||[]).slice(0,5), n=x.pricesCount||(x.prices||[]).length;
    return `<div class="pv-mtop"><button class="btn pv-back" type="button" data-pv="close"><span aria-hidden="true">‹</span> К списку</button></div>
    <div class="pv-scroll">
      <div class="pv-photo">${x.photo?`<img src="${esc(x.photo.src)}" alt="" title="${esc(x.name||'')}">`:'<span>нет фото</span>'}</div>
      ${x.photoFrom&&x.photo?`<p class="muted pv-pf">Фото — от похожей модели того же производителя («${esc(x.photoFrom.name||'')}»). Своё фото — «Редактировать» → «Описание и фото».</p>`:''}
      <div class="pv-ttl"><h4>${esc(x.name||'Без названия')}</h4>${x.logo?`<img class="pv-logo" src="${esc(x.logo.src)}" alt="">`:''}</div>${x.spec?`<p class="muted pv-spec">${esc(x.spec)}</p>`:''}
      ${this.optFor==null?`<label class="pv-cat"><span>Категория</span><select data-pvcat>${typeOptionsHtml(a.cat)}</select></label>`:''}
      <div class="pv-price"><b>${x.price?money(x.price)+' '+curSh(x.priceCur||'RUB'):'Цена не указана'}</b>${x.cost?`<span>закупка ${money(x.cost)} ${curSh(x.costCur||'RUB')}${x.costDisc&&x.costDisc.pct&&x.costSrc==='feed'?` (−${String(x.costDisc.pct).replace('.',',')} %)`:''}</span>`:''}${FeedBadge.html(x)}</div>
      ${x.stock&&!x.stock.gone&&FeedBadge.stockTip(x.stock)?`<p class="pv-stock">${esc(FeedBadge.stockTip(x.stock))}</p>`:''}
      ${x.feed?`<p class="muted pv-pf">Из фида поставщика${x.feed.sku?' · артикул '+esc(x.feed.sku):''}${CatalogWindow.webUrl(x.feed.url)?` · <a href="${esc(x.feed.url)}" target="_blank" rel="noopener">страница товара</a>`:''}. ${x.feed.files?'Цены и наличие обновляются из прайса и остатков поставщика.':'РРЦ и наличие проверяются раз в день.'}</p>`:''}
      ${kpi?`<div class="pv-kpi">${kpi}</div>`:''}
      ${params.length?`<table class="pv-t">${params.map(([k,v])=>`<tr><td>${esc(k)}</td><td>${esc(v)}</td></tr>`).join('')}</table>`:''}
      ${loading?'<p class="muted">Загружаю описание и характеристики…</p>':''}
      ${feats.length?`<p class="pv-cap">Описание</p>${feats.map(f=>`<p class="pv-f">${f.label?`<b>${esc(f.label)}.</b>${/^• /.test(f.text||'')?'<br>':' '}`:''}${esc(f.text||'')}</p>`).join('')}`:''}
      ${groups.length?`<p class="pv-cap">Характеристики</p>${groups.map((g,k)=>`<details class="pv-g"${k===0?' open':''}><summary>${esc(g.name||'Основные')} <i>${g.rows.filter(r=>r.k||r.v).length}</i></summary><table class="pv-t">${g.rows.filter(r=>r.k||r.v).map(r=>`<tr${r.hl?' class="hl"':''}><td>${esc(r.k)}</td><td>${esc(r.v)}</td></tr>`).join('')}</table></details>`).join('')}`:''}
      ${gal.length?`<p class="pv-cap">Изображения <i>${gal.length}</i></p><div class="pv-gal">${gal.map(g=>`<img src="${esc(g.src)}" alt="" title="${esc(g.caption||'')}" loading="lazy">`).join('')}</div>`:''}
      ${hist.length?`<p class="pv-cap">В коммерческих предложениях <i>${n}</i></p><table class="pv-t pv-h">${hist.map(p=>`<tr><td>${esc(KPGen.ruDate(p.date))}${p.number?`<br><small>№ ${esc(p.number)}</small>`:''}</td><td>${esc(p.client||'')}</td><td>${p.price?money(p.price)+' '+curSh(p.cur||'RUB'):''}</td></tr>`).join('')}</table>`:''}
      ${!loading&&!feats.length&&!groups.length?'<p class="muted pv-empty">Описания и характеристик пока нет — нажмите «Редактировать».</p>':''}
    </div>
    <div class="pv-acts"><div class="pv-main"><button class="btn primary" type="button" data-pv="add">${this.addLabel(x.id,true)}</button><button class="btn" type="button" data-pv="edit">Редактировать</button></div>
      <div class="pv-sub">${this.optFor==null?'<button class="btn ghost" type="button" data-pv="dup" title="Создать копию позиции и открыть её на редактирование">Создать копию</button>':''}<span class="sp"></span><button class="btn ghost pv-w" type="button" data-pv="wide" title="Карточка крупно, на месте списка (двойной щелчок по позиции). Esc — назад к списку">${this.dlg().classList.contains('pvwide')?'Свернуть карточку':'⤢ Крупно'}</button><button class="btn ghost pv-x" type="button" data-pv="close">Закрыть карточку</button></div></div>`;
  }
  async preview(){
    const pv=$('#cwPv'), d=this.dlg(); if(!pv) return; const id=this.active;
    d.classList.toggle('pvon', !!id);
    const light=id && this.doc(id);
    if (!light){ this.active=null; d.classList.remove('pvon','pvwide');
      pv.innerHTML=`<div class="cw-pv0"><b>Карточка позиции</b><p>Нажмите на позицию в списке — здесь появятся фото, параметры, описание, характеристики и история цен.</p>
        <p>Двойной щелчок — карточка крупно, на месте списка. Изменить позицию — кнопка «Редактировать» в карточке.</p><p>Отметьте галочками несколько позиций, чтобы добавить их в КП сразу, перенести в другую категорию или удалить.</p></div>`; return; }
    if (pv.dataset.id!==id){ pv.innerHTML=this.card(light,!!light._light); pv.dataset.id=id; }
    const full=await fullDoc(light); if (this.active!==id) return;
    const sc=pv.querySelector('.pv-scroll')?.scrollTop||0; morph(pv, this.card(full,false)); const s2=pv.querySelector('.pv-scroll'); if(s2) s2.scrollTop=sc;
  }
  /** изображение крупно поверх окна каталога; закрывается щелчком или Esc */
  zoom(src, caption){ const d=this.dlg(); d.querySelector('.cw-lb')?.remove();
    const z=document.createElement('div'); z.className='cw-lb'; z.innerHTML=`<img src="${esc(src)}" alt=""><p>${esc(caption||'Щелчок — закрыть')}</p>`; d.appendChild(z); }
  /** карточка крупно: занимает место списка, панель фильтров остаётся; Esc, «‹ К списку» или «Свернуть» — назад */
  wide(on, id){ const d=this.dlg(); if (id) this.activate(id); if (on && !this.active) return;
    d.classList.toggle('pvwide', !!on); this.panes.pos(); this.preview();
    if (!on && this.active) document.querySelector(`#cwList .cw-row[data-id="${CSS.escape(this.active)}"]`)?.scrollIntoView({block:'nearest'}); }
  activate(id){ this.active=id; document.querySelectorAll('#cwList .cw-row').forEach(r=>r.classList.toggle('act', r.dataset.id===id)); this.preview(); }

  // ---------- действия
  static qtyUp(it){ const old=+it.qty||0; it.qty=old+1; (it.options||[]).forEach(o=>{ if(o.unit!=='усл.' && +o.qty===old) o.qty=it.qty; }); }
  async add(ids){
    const take=id=>fullDoc(this.doc(id));
    if (this.optFor!=null){ const it=S.items[this.optFor]; if(!it) return; it.options=it.options||[]; let n=0;
      for (const id of ids){ if (it.options.some(o=>o.catId===id)) continue; const x=await take(id); if(!x) continue; const a=attrsOf(x);
        it.options.push(newOpt(it,{ name:x.name, short:x.short||(a.cat==='ats'?'АВР':(a.model||'')), unit:x.unit||'шт.', price:x.price||0, catId:x.id })); n++; }
      renderForm(); persist(); this.sel.clear(); this.list(); this.say(n?`Добавлено опций: ${n}`:'Эти позиции уже добавлены опциями'); this.preview(); return; }
    let n=0, m=0, k=0;
    for (const id of ids){ if (ids.length>3) this.setBusy(`Добавляю в КП: ${++k} из ${ids.length}`);
      const ex=S.items.find(it=>it.catId===id); if (ex){ CatalogWindow.qtyUp(ex); m++; continue; }
      const x=await take(id); if(!x) continue;
      const it=newItem(); fillFromCat(it,x);
      const blank=S.items.length===1 && !S.items[0].name && !S.items[0].price;
      if (blank) S.items=[it]; else S.items.push(it); n++; }
    this.setBusy('');
    if (STEP!=='equip'){ STEP='equip'; try{ localStorage.setItem('kp.step','equip'); }catch(e){} }
    renderForm(); persist(); if (ids.length>1) this.sel.clear(); this.list();
    this.say([n?`Добавлено в КП: ${n} ${plural(n,'позиция','позиции','позиций')}`:'', m?`количество увеличено у ${m}`:''].filter(Boolean).join('; ')+'. Можно добавить ещё или нажать «Готово — к КП».'); this.preview();
  }
  async move(ids, cat){
    const t=typeById(cat), todo=ids.filter(id=>{ const x=this.doc(id); return x && CatalogIndex.attrs(x).cat!==cat; });
    if (!todo.length) return this.say(`Позиции уже в категории «${t.name}»`);
    const undo=[]; let k=0, fail=0, pend=0;
    for (const id of todo){ this.setBusy(`Переношу в «${t.name}»: ${++k} из ${todo.length}`);
      try{ const full=await store().get(id); if(!full||!full.id) throw 0; const prev=(full.attrs||{}).cat;
        full.attrs={...(full.attrs||{}), cat}; if ((await store().put(full))._pending) pend++; else undo.push({id, prev}); }catch(e){ fail++; } }
    this.undo = undo.length ? {list:undo, name:t.name} : null; this.sel.clear(); this.busy='';
    await this.reload(); this.note=`Перенесено в «${t.name}»: ${undo.length} ${plural(undo.length,'позиция','позиции','позиций')}`+(pend?`, отправлено на модерацию: ${pend}`:'')+(fail?`, не удалось: ${fail}`:''); this.redraw();
  }
  async undoMove(){ const u=this.undo; if(!u) return; this.undo=null; let k=0;
    for (const {id,prev} of u.list){ this.setBusy(`Возвращаю: ${++k} из ${u.list.length}`);
      try{ const full=await store().get(id); const a={...(full.attrs||{})}; if (prev) a.cat=prev; else delete a.cat; full.attrs=a; await store().put(full); }catch(e){} }
    this.busy=''; await this.reload(); this.note='Перенос отменён'; this.redraw(); }
  typeButtons(attr){
    const groups=[...new Set(TYPES.map(t=>t.group||'Прочее'))];
    return groups.map(g=>`<p class="sub" style="margin:12px 0 6px">${esc(g)}</p><div class="tpick">${TYPES.filter(t=>(t.group||'Прочее')===g).map(t=>`<button type="button" class="btn${t.id===this.F.cat?' primary':''}" ${attr}="${esc(t.id)}">${esc(t.name)}</button>`).join('')}</div>`).join(''); }
  moveDlg(ids){
    const d=$('#dlg'); d.classList.remove('wide');
    d.innerHTML=`<div class="dlg-h"><h3>Перенести ${ids.length} ${plural(ids.length,'позицию','позиции','позиций')} в категорию</h3><button class="icon" type="button" data-close aria-label="Закрыть">✕</button></div>
     <div class="dlg-b">${this.typeButtons('data-mv')}
     <div class="row" style="margin-top:16px"><button class="btn" type="button" data-mvnew>+ Новая категория…</button><span class="muted">Нужной категории нет — создайте её, и позиции сразу перенесутся.</span></div></div>`;
    d.showModal(); d.querySelector('[data-close]').onclick=()=>d.close();
    d.querySelector('.dlg-b').onclick=e=>{ const b=e.target.closest('[data-mv]'); if (b){ d.close(); this.move(ids, b.dataset.mv); return; }
      if (e.target.closest('[data-mvnew]')){ d.close(); this.newType(id=>this.move(ids,id), this.mainCat(ids)); } };
  }
  /** самая частая категория среди позиций — образец для новой категории при переносе */
  mainCat(ids){ const c=new Map(); ids.forEach(id=>{ const x=this.doc(id); if(x){ const k=CatalogIndex.attrs(x).cat; c.set(k,(c.get(k)||0)+1); } }); return [...c.entries()].sort((a,b)=>b[1]-a[1])[0]?.[0]; }
  /** новая категория; base — категория-образец: параметры, фильтры и раздел новой категории берутся у неё */
  newType(then, base){
    const d=$('#dlg'); d.classList.remove('wide');
    const groups=[...new Set(TYPES.map(t=>t.group||'Прочее'))];
    base=base||this.F.cat||(this.active&&this.doc(this.active)&&CatalogIndex.attrs(this.doc(this.active)).cat)||(TYPES.find(t=>t.role!=='accessory'&&!t.station)||{}).id||'other';
    d.innerHTML=`<div class="dlg-h"><h3>Новая категория</h3><button class="icon" type="button" data-close aria-label="Закрыть">✕</button></div>
     <div class="dlg-b"><div class="grid">
       <label class="f"><span class="req">Название категории</span><input type="text" id="ntName" placeholder="Например: Спиральные компрессоры" autocomplete="off"></label>
       <div class="grid g2"><label class="f"><span>Раздел</span><select id="ntGroup">${groups.map(g=>`<option${g===(typeById(base).group||'Прочее')?' selected':''}>${esc(g)}</option>`).join('')}<option value="__new">+ новый раздел…</option></select></label>
         <label class="f" id="ntGroupNewL" style="display:none"><span>Название раздела</span><input type="text" id="ntGroupNew" placeholder="Например: Подготовка воздуха" autocomplete="off"></label></div>
       <label class="f"><span>Параметры и фильтры — как у категории</span><select id="ntBase">${typeOptionsHtml(base)}</select></label></div>
     <p class="muted">Из выбранной категории копируются параметры (мощность, давление, производительность…), фильтры каталога и быстрые опции. Тонкая настройка — «Ещё» → «Категории оборудования».</p>
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
        await loadTypes(); catCache.forEach(CatalogIndex.forget); }
      catch(e){ $('#ntSave').disabled=false; return err('Не удалось сохранить категорию: '+(e.message||e)); }
      d.close(); renderForm(); this.redraw(); this.say(`Создана категория «${name}»`); if (then) then(t.id); };
    setTimeout(()=>$('#ntName').focus(),30);
  }
  /** позиция сохранена в редакторе: обновить каталог, открыть её карточку */
  async afterSave(doc){ await this.reload(); this.active=doc.id; const pv=$('#cwPv'); if (pv) pv.dataset.id=''; this.note=`Сохранено: ${doc.name}`; this.redraw();
    requestAnimationFrame(()=>document.querySelector(`#cwList .cw-row[data-id="${CSS.escape(doc.id)}"]`)?.scrollIntoView({block:'nearest'})); }
  async edit(id){ if (!can('catEdit')) return cannot('catEdit'); const x=await fullDoc(this.doc(id)); if (!x) return; openCatEditor(x, cwAfterSave); }
  async dup(id){ if (!can('catAdd')) return cannot('catAdd'); const x=await fullDoc(this.doc(id)); if (!x || x._light) return this.say('Не удалось загрузить позицию');
    const c=JSON.parse(JSON.stringify(x)); c.id=uid()+uid(); c.name=x.name+' (копия)'; c.prices=[]; delete c.pricesCount; openCatEditor(c, cwAfterSave, true); }
  async importFile(f){
    try{ const j=JSON.parse(await f.text()); const items=Array.isArray(j)?j:j.items; if(!Array.isArray(items)) throw 0;
      // новые категории из файла (types): добавляются к своим типам; категории с уже существующим id не меняются
      let nt=0;
      if (Array.isArray(j.types)){
        const add=j.types.filter(t=>t && /^[a-z][a-z0-9_]{1,30}$/.test(t.id||'') && t.name && Array.isArray(t.fields) && t.fields.every(fl=>fl&&fl.key&&fl.label) && !TYPES.some(x=>x.id===t.id));
        if (add.length){ this.setBusy('Добавляю категории: '+add.map(t=>t.name).join(', '));
          await api('/api/types',{method:'PUT',headers:{'Content-Type':'application/json; charset=utf-8'},body:JSON.stringify({version:1,types:[...userTypesList(), ...add]})});
          await loadTypes(); catCache.forEach(CatalogIndex.forget); nt=add.length; }
      }
      const ex=new Map((await store().list()).map(z=>[z.id,z])); let n=0, pend=0;
      for (const x of items){ if(!(x&&x.id&&x.name)) continue; const o=ex.get(x.id); this.setBusy(`Загружаю каталог: ${++n} из ${items.length}`);
        if (o){ if(!x.price && o.price) x.price=o.price; if((!x.prices||!x.prices.length) && o.prices&&o.prices.length) x.prices=o.prices; if(!x.options&&o.options) x.options=o.options; }
        if ((await store().put(x))._pending) pend++; }
      // удалять позиции (в том числе дубликаты из списка remove) может только администратор — в «Настройках»
      const rm=Array.isArray(j.remove)?j.remove.length:0;
      this.busy=''; await this.reload(); this.note=`Загружено позиций: ${n}`+(nt?`, новых категорий: ${nt}`:'')+(pend?`, на модерации: ${pend}`:'')+(rm?`; дубликаты к удалению (${rm}) удаляет администратор в «Настройках»`:''); this.redraw(); }
    catch(e){ this.busy=''; this.say('Это не файл каталога КП'); }
  }
  async exportFile(){ const all=(await store().full()).map(x=>{ const y={...x}; delete y._a; delete y._nv; delete y._hay; delete y._sup; return y; }); if(!all.length) return this.say('Каталог пуст');
    saveFile(`Каталог_КП_Пневмотех_${today()}.json`, new Blob([JSON.stringify({format:'kp-catalog',version:1,items:all})],{type:'application/json'})); }
  close(){ const d=this.dlg(); if (d.open) d.close(); }

  // ---------- окно
  async open(mode={}){
    const optFor = Number.isInteger(mode.opt) ? mode.opt : null;
    Object.assign(this, { optFor, F: optFor!=null ? FO : FI, active:null, limit:CatalogWindow.PAGE, lastCk:null, note:'', busy:'', tab:'' }); this.sel.clear();
    const F=this.F; if (mode.cat!=null){ F.cat=mode.cat; F.f={}; F.rng={}; }
    const d=this.dlg(); d.classList.remove('navon','pvon','pvwide'); this.panes.loadSize(); this.panes.load();
    d.innerHTML=`<div class="cw-h"><button class="btn cw-navbtn" type="button" data-cw="nav" aria-label="Категории и фильтры" title="Категории и фильтры"><span aria-hidden="true">☰</span><span class="cw-lbl2"> Фильтры</span></button>
       <h3>${optFor!=null?'Опции для позиции '+(optFor+1):'Каталог'}</h3>
       <div class="cw-q"><input type="search" id="cwQ" placeholder="Модель, артикул, производитель, поставщик или характеристика" autocomplete="off" value="${esc(F.q)}" aria-label="Поиск по каталогу" title="Можно без пробелов и дефисов: «DVK3013» найдёт DVK D 30-13; «/» — перейти к поиску"><kbd aria-hidden="true">/</kbd></div>
       ${optFor==null?'<button class="btn" type="button" data-cw="new" title="Новая позиция каталога">+<span class="cw-lbl"> Позиция</span></button>':''}
       <details class="cw-menu"><summary class="btn" title="Импорт, выгрузка, категории оборудования">Ещё<span class="cw-lbl"> ▾</span></summary><div>
         ${FEAT.on('catImport')?'<button type="button" data-cw="xls">Импорт из Excel…</button><button type="button" data-cw="imp">Загрузить файл каталога (.json)…</button>':''}<button type="button" data-cw="exp">Выгрузить каталог в файл</button>
         <hr><button type="button" data-cw="types">Категории оборудования…</button></div></details>
       <button class="icon" type="button" data-cw="max" aria-label="Во весь экран" title="Во весь экран / обычный размер. Размер окна можно менять, потянув за правый нижний угол">⤢</button>
       <button class="icon" type="button" data-cw="close" aria-label="Закрыть">✕</button></div>
     <div class="cw-fb" id="cwBar" role="group" aria-label="Отбор по категории, производителю, поставщику"></div>
     <div class="cw-b"><nav class="cw-nav" id="cwNav" aria-label="Категории и фильтры"></nav>
       <section class="cw-mid"><div class="cw-chips" id="cwChips" aria-live="polite"></div><div class="cw-tb"><label class="ck" title="Отметить все найденные"><input type="checkbox" id="cwAll" aria-label="Отметить все найденные"></label><span class="muted" id="cwCnt"></span><span class="sp"></span>
           <label class="cw-sortl" for="cwSort">Сортировка</label><select id="cwSort" aria-label="Сортировка"></select><button class="btn sm cw-dir" type="button" id="cwDir"></button></div>
         <div class="cw-list" id="cwList"><p class="empty">Загружаю…</p></div></section>
       <aside class="cw-pv" id="cwPv" aria-label="Карточка позиции"></aside>
       <div class="cw-split" data-split="nav" role="separator" aria-orientation="vertical" aria-label="Ширина панели фильтров" tabindex="0" title="Потяните, чтобы изменить ширину панели фильтров. Двойной щелчок — как было"></div>
       <div class="cw-split" data-split="pv" role="separator" aria-orientation="vertical" aria-label="Ширина карточки позиции" tabindex="0" title="Потяните, чтобы изменить ширину карточки. Двойной щелчок — как было"></div></div>
     <div class="cw-f" id="cwF"></div>`;
    if (!d.open) d.showModal();
    this.bind(d); this.panes.layout();
    this.docs = catCache.length ? catCache : await store().list().catch(()=>[]);
    FI.dropQuery(); FO.dropQuery(); await Promise.all([this.loadPending(), this.loadSources()]);
    this.warm();
    this.redraw();
    setTimeout(()=>{ if (matchMedia('(pointer:fine)').matches) $('#cwQ')?.focus(); },30);
  }

  // ---------- события окна (вешаются один раз на элемент окна)
  bind(d){
    if (d._bound) return; d._bound=true; this.panes.bind();
    let szT=null; new ResizeObserver(()=>{ if(!d.open) return; this.panes.layout(); clearTimeout(szT); szT=setTimeout(()=>{ if (d.open && !d.classList.contains('max')) this.panes.saveSize(); },500); }).observe(d);
    let qT=null;
    d.addEventListener('input', e=>{ const t=e.target, F=this.F;
      if (t.id==='cwQ'){ F.q=t.value; this.limit=CatalogWindow.PAGE; clearTimeout(qT); qT=setTimeout(()=>{ this.refresh(); const q=F.q;
          // поиск по характеристикам — на сервере: ответ пришёл, запрос тот же → список с найденным по характеристикам
          if (!CatalogSearch.has(q)) CatalogSearch.ask(q).then(s=>{ if (s && s.size && F.q===q && $('#catdlg')?.open){ const n=F.addServer(q, s); if (n<0) F.dropQuery(); if (n) this.refresh(); } }); }, this.docs.length>2000?180:60); return; }
      if (t.dataset.rk){ const r=F.rng[t.dataset.rk]||(F.rng[t.dataset.rk]={min:'',max:''}); r[t.dataset.rs]=t.value.replace(',','.').replace(/[^\d.]/g,''); this.list(); } });
    d.addEventListener('change', e=>{ const t=e.target, F=this.F;
      if (t.dataset.cwzero!=null){ try{ localStorage.setItem('kp.cwzero', t.checked?'1':'0'); }catch(_){} return this.nav(); }
      if (t.id==='cwSort'){ F.sort=t.value; F.dir=CatalogSorter.def(t.value); this.list(); $('#cwList').scrollTop=0; return; }
      if (t.dataset.f!=null){ if (t.dataset.in) F.f[t.dataset.f]=t.value; else F[t.dataset.f]=t.value; this.limit=CatalogWindow.PAGE; this.refresh(); return; }
      if (t.id==='cwPriced'){ F.priced=t.checked; this.limit=CatalogWindow.PAGE; this.refresh(); return; }
      if (t.id==='cwStock'){ F.stock=t.checked; this.limit=CatalogWindow.PAGE; this.refresh(); return; }
      if (t.dataset.top){ const k=t.dataset.top; this.limit=CatalogWindow.PAGE;
        if (k==='cat'){ F.setCategory(t.value); this.tab=t.value?'flt':''; } else F[k]=t.value;
        this.refresh(); $('#cwList').scrollTop=0; return; }
      if (t.id==='cwAll'){ this.view.forEach(x=>t.checked?this.sel.add(x.id):this.sel.delete(x.id)); this.list(); this.foot(); return; }
      if (t.dataset.pvcat!=null && this.active){ this.move([this.active], t.value); return; } });
    d.addEventListener('click', e=>this.onClick(e, d));
    // двойной щелчок по позиции — карточка крупно (на месте списка); по границе панелей — ширина как была
    d.addEventListener('dblclick', e=>{ const sp=e.target.closest('.cw-split'); if (sp) return this.panes.reset(sp.dataset.split);
      const row=e.target.closest('.cw-row'); if (row && !e.target.closest('button,label,input')){ getSelection()?.removeAllRanges(); this.wide(true, row.dataset.id); } });
    d.addEventListener('cancel', e=>{ const lb=d.querySelector('.cw-lb'); if (lb){ e.preventDefault(); lb.remove(); return; }
      if (d.classList.contains('pvwide')){ e.preventDefault(); this.wide(false); } });
    d.addEventListener('keydown', e=>{
      if (e.key==='/' && FEAT.on('hotkeys') && !e.ctrlKey && !e.metaKey && !e.altKey && !e.target.closest?.('input,textarea,select,[contenteditable]')){ e.preventDefault(); const q=$('#cwQ'); q?.focus(); q?.select(); return; }
      if (e.target.id==='cwQ' && e.key==='Escape' && e.target.value){ e.preventDefault(); e.stopPropagation(); e.target.value=''; this.F.q=''; this.refresh(); return; }
      if (e.target.id==='cwQ' && e.key==='Enter'){ e.preventDefault(); const x=this.view[0]; if (x) this.activate(x.id); }
      if ((e.key==='ArrowDown'||e.key==='ArrowUp') && (e.target.id==='cwQ' || e.target.closest?.('.cw-list')) && this.view.length){
        e.preventDefault(); const ids=this.view.slice(0,this.limit).map(x=>x.id); let k=ids.indexOf(this.active); k = k<0 ? 0 : Math.max(0, Math.min(ids.length-1, k+(e.key==='ArrowDown'?1:-1)));
        this.activate(ids[k]); document.querySelector(`#cwList .cw-row[data-id="${CSS.escape(ids[k])}"]`)?.scrollIntoView({block:'nearest'}); } });
    // перенос перетаскиванием: позиция (или все отмеченные, если тянут отмеченную) → категория слева
    d.addEventListener('dragstart', e=>{ const row=e.target.closest?.('.cw-row'); if (!row || this.optFor!=null) return;
      const id=row.dataset.id; this.drag = this.sel.has(id) ? [...this.sel] : [id];
      if (this.tab!=='cats' && !d.classList.contains('narrow')){ this.tab='cats'; setTimeout(()=>this.nav()); }      // цели переноса — во вкладке «Категории»
      e.dataTransfer.effectAllowed='move'; e.dataTransfer.setData('text/plain', this.drag.length>1 ? `${this.drag.length} позиций` : (this.doc(id)?.name||''));
      d.classList.add('dragging'); });
    d.addEventListener('dragend', ()=>{ this.drag=null; d.classList.remove('dragging'); d.querySelectorAll('.cw-cat.over').forEach(b=>b.classList.remove('over')); });
    ['dragover','dragleave','drop'].forEach(ev=>d.addEventListener(ev, e=>{ const b=e.target.closest?.('[data-dropcat]'); if (!b || !this.drag) return;
      e.preventDefault(); b.classList.toggle('over', ev==='dragover');
      if (ev==='drop'){ const ids=this.drag; this.drag=null; d.classList.remove('dragging'); this.move(ids, b.dataset.dropcat); } }));
  }
  onClick(e, d){
    const t=e.target, F=this.F;
    const menu=d.querySelector('.cw-menu'); if (menu && menu.open && !t.closest('.cw-menu summary')) menu.open=false;
    const ck=t.closest('[data-ck]');
    if (ck){ const row=ck.closest('.cw-row'), id=row.dataset.id, ids=this.view.map(x=>x.id), on=ck.checked;
      if (e.shiftKey && this.lastCk && ids.includes(this.lastCk)){ const [a,b]=[ids.indexOf(this.lastCk), ids.indexOf(id)].sort((p,q)=>p-q); ids.slice(a,b+1).forEach(z=>on?this.sel.add(z):this.sel.delete(z)); }
      else on?this.sel.add(id):this.sel.delete(id);
      this.lastCk=id; this.list(); this.foot(); return; }
    if (t.closest('.ck')) return;
    const fg=t.closest('[data-cwfold]'); if (fg){ let fold={}; try{ fold=JSON.parse(localStorage.getItem('kp.cwfold')||'{}')||{}; }catch(e){}
      fold[fg.dataset.cwfold]=!fold[fg.dataset.cwfold]; try{ localStorage.setItem('kp.cwfold', JSON.stringify(fold)); }catch(e){} return this.nav(); }
    if (t.closest('#cwDir')){ F.dir=-(F.dir||1); this.list(); $('#cwList').scrollTop=0; return; }
    const tab=t.closest('[data-tab]'); if (tab){ this.tab=tab.dataset.tab; this.nav(); return; }
    const chip=t.closest('[data-chip]'); if (chip){ const k=chip.dataset.chip; this.limit=CatalogWindow.PAGE;
      if (k==='q'){ F.q=''; const q=$('#cwQ'); if (q) q.value=''; }
      else if (k==='cat'){ F.setCategory(''); this.tab=''; }
      else if (k==='priced'||k==='stock') F[k]=false;
      else if (k.startsWith('f:')) F.f[k.slice(2)]='';
      else if (k.startsWith('r:')) F.rng[k.slice(2)]={min:'',max:''};
      else F[k]='';
      this.refresh(); return; }
    const cat=t.closest('[data-cat]'); if (cat){ F.setCategory(cat.dataset.cat); this.limit=CatalogWindow.PAGE; this.tab=F.cat?'flt':'cats';
      if (!F.cat) d.classList.remove('navon'); this.refresh(); $('#cwList').scrollTop=0; return; }
    if (t.closest('[data-more]')){ this.more(); return; }
    const add=t.closest('[data-add]'); if (add){ return this.add([add.closest('.cw-row').dataset.id]); }
    const rc=t.closest('[data-rc]'); if (rc){ const k=rc.dataset.rc, r=F.rng[k]||{min:'',max:''}; const same=String(r.min)===rc.dataset.lo&&String(r.max)===rc.dataset.hi;
      F.rng[k]= same?{min:'',max:''}:{min:rc.dataset.lo,max:rc.dataset.hi}; this.refresh(); return; }
    const bk=t.closest('[data-bulk]'); if (bk){ const ids=[...this.sel];
      if (bk.dataset.bulk==='add') return this.add(ids); if (bk.dataset.bulk==='move') return this.moveDlg(ids);
      if (bk.dataset.bulk==='clear'){ this.sel.clear(); this.list(); this.foot(); } return; }
    const pv=t.closest('[data-pv]'); if (pv && this.active){ const a=pv.dataset.pv, id=this.active;
      if (a==='add') return this.add([id]); if (a==='edit') return this.edit(id); if (a==='dup') return this.dup(id);
      if (a==='wide') return this.wide(!d.classList.contains('pvwide'));
      if (a==='close'){ if (d.classList.contains('pvwide')) return this.wide(false); this.active=null; this.activate(null); } return; }
    const zi=t.closest('.pv-photo>img:first-child, .pv-gal img'); if (zi){ this.zoom(zi.src, zi.title||''); return; }
    if (t.closest('.cw-lb')){ t.closest('.cw-lb').remove(); return; }
    const row=t.closest('.cw-row'); if (row){ this.activate(row.dataset.id); return; }
    const c=t.closest('[data-cw]'); if (!c) return;
    switch (c.dataset.cw){
      case 'close': return this.close();
      case 'done': this.close(); if (this.optFor==null && STEP!=='equip') goStep('equip'); return;
      case 'max': d.classList.toggle('max'); this.panes.saveSize(); return;
      case 'nav': d.classList.toggle('navon'); return;
      case 'reset': F.resetParams(); this.refresh(); return;
      case 'resetall': { F.resetAll(); const q=$('#cwQ'); if (q) q.value=''; this.limit=CatalogWindow.PAGE; this.refresh(); return; }
      case 'undo': return this.undoMove();
      case 'newtype': return this.newType(id=>{ F.cat=id; F.f={}; F.rng={}; this.redraw(); });
      case 'new': return newEquip('catalog', F.cat||'');
      case 'xls': return openXlsImport(F.cat);
      case 'types': return openTypesEditor(F.cat || undefined);
      case 'exp': return this.exportFile();
      case 'imp': { const f=document.createElement('input'); f.type='file'; f.accept='.json,application/json'; f.hidden=true;
        f.onchange=()=>{ const file=f.files[0]; f.remove(); if (file) this.importFile(file); }; d.appendChild(f); f.click(); return; }
    }
  }
}

const CW = new CatalogWindow();

// ---------- точки входа для других модулей (прежние имена)
function openCatalog(mode={}){ return CW.open(mode); }
function cwRedraw(){ CW.redraw(); }
function cwNote(t){ CW.say(t); }
function cwNewType(then, base){ return CW.newType(then, base); }
const cwAfterSave = doc => CW.afterSave(doc);

// после окон поверх каталога (типы оборудования, импорт из Excel) — обновить категории и список
document.addEventListener('close', e=>{ if (e.target.id==='dlg' && $('#catdlg')?.open && !CW.busy) CW.redraw(); }, true);
