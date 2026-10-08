// Окно каталога: категории и фильтры слева, список с отметками, карточка-предпросмотр справа.
// Пакетные действия над отмеченными позициями: добавить в КП, перенести в другую категорию, удалить.
// Перенос — также перетаскиванием позиций на категорию. Размер окна меняется за угол, «⤢» — на весь экран.
'use strict';

const FI = { q:'', cat:'', maker:'', series:'', sup:'', f:{}, rng:{}, priced:false, stock:false, sort:'best', dir:1 };

const FO = { q:'', cat:'', maker:'', series:'', sup:'', f:{}, rng:{}, priced:false, stock:false, sort:'best', dir:1 };

// состояние окна: режим (позиции КП или опции позиции), отметки, открытая карточка, последний перенос (для отмены)
const CW = { pend:new Set(), mod:false, optFor:null, F:FI, sel:new Set(), active:null, limit:150, docs:[], view:[], lastCk:null, undo:null, note:'', busy:'', drag:null,
  src:{}, sups:[], tab:'', fx:null };   // fx — курсы ЦБ к рублю: цены в разных валютах сравниваются в рублях      // src — фиды-источники (id → поставщик), sups — справочник поставщиков, tab — вкладка слева (flt / cats)

const cwA = x => x._a || (x._a = attrsOf(x));

const cwNV = (x,k) => { const c=x._nv||(x._nv={}); return k in c ? c[k] : (c[k]=norm(cwA(x)[k])); };

function cwForget(x){ delete x._a; delete x._nv; delete x._hay; delete x._sup; }

// ---------- поиск: «DVK30-13» = «DVK D 30-13», «5.5» = «5,5», «далгакиран» = «Dalgakiran», латинская «C» в «СА11» = кириллическая
const CW_TR={а:'a',б:'b',в:'v',г:'g',д:'d',е:'e',ж:'zh',з:'z',и:'i',й:'i',к:'k',л:'l',м:'m',н:'n',о:'o',п:'p',р:'r',с:'s',т:'t',у:'u',ф:'f',х:'h',ц:'c',ч:'ch',ш:'sh',щ:'sch',ъ:'',ы:'y',ь:'',э:'e',ю:'yu',я:'ya'};
const CW_HG={а:'a',в:'b',е:'e',к:'k',м:'m',н:'h',о:'o',р:'p',с:'c',т:'t',у:'y',х:'x'};
const cwTr = s => s.replace(/[а-я]/g, c=>CW_TR[c]??c);
const cwFold = s => s.replace(/[авекмнорстух]/g, c=>CW_HG[c]).replace(/[\s\-./,_()×x*]+/g,'');
// облегчённая карточка несёт src / art, полная (после сохранения) — feed.id / feed.sku
const cwSrc = x => x.src || x.feed?.id || '';
const cwArt = x => x.art || x.feed?.sku || cwA(x).article || '';
function cwHay(x){ if (x._hay) return x._hay; const a=cwA(x);
  const plain=norm([x.name, x.spec, x.st||'', cwArt(x), cwSup(x), ...Object.values(a), ...(x.groups||[]).flatMap(g=>(g.rows||[]).map(r=>r.k+' '+r.v))].join(' '));
  // модель без одиночных букв-исполнений: «DVK D 30-13» → «dvk3013», чтобы «DVK30-13» находил её
  const m=norm([a.model, x.name, cwArt(x)].filter(Boolean).join(' ')), model=cwFold(m), model2=cwFold(m.replace(/(^|\s)[a-zа-яё](?=\s)/g,' '));
  return (x._hay={ plain, fold:cwFold(plain), tr:cwTr(plain), model, model2 }); }
function cwWordHit(h, w){ if (h.plain.includes(w)) return true; const f=cwFold(w); if (f.length>=2 && (h.fold.includes(f) || h.model2.includes(f))) return true;
  const t=cwTr(w); return t!==w && h.tr.includes(t); }
// насколько позиция подходит к запросу: модель начинается с запроса → 0, запрос целиком в названии → 1, остальное → 2
function cwRel(x){ const F=CW.F, q=norm(F.q), f=cwFold(q); if (!q) return 2; const h=cwHay(x);
  if (f.length>=2 && (cwFold(norm(cwA(x).model||'')).startsWith(f) || h.model.includes(f) || h.model2.includes(f))) return 0; return norm(x.name).includes(q) ? 1 : 2; }

// ---------- поставщик позиции: фид-источник (или поставщик, к которому фид привязан), иначе — по производителю из справочника
function cwSup(x){ if (x._sup!==undefined) return x._sup; let s='';
  const src=cwSrc(x); if (src) s=(CW.src[src]||{}).name||src;
  else { const m=norm(cwA(x).maker); if (m){ const z=CW.sups.find(z=>norm(z.name)===m) || CW.sups.find(z=>(z.makers||[]).some(k=>norm(k)===m)); s=z?z.name:''; } }
  return (x._sup=s); }
const CW_NOSUP='Не указан';
function cwInStock(x){ const st=x.stock; return !!st && !st.gone && (st.qty!=null ? st.qty>0 : !!st.available); }

function cwDlg(){ let d=$('#catdlg'); if(!d){ d=document.createElement('dialog'); d.id='catdlg'; d.className='catwin'; d.setAttribute('aria-label','Каталог'); document.body.appendChild(d); } return d; }

// ---------- размер окна: запоминается в браузере
function cwSize(d){ let z={}; try{ z=JSON.parse(localStorage.getItem('kp.catwin2')||'{}')||{}; }catch(e){}
  d.classList.toggle('max', !!z.max);
  if (z.w && z.h){ d.style.width=Math.min(z.w, innerWidth)+'px'; d.style.height=Math.min(z.h, innerHeight)+'px'; } else { d.style.width=''; d.style.height=''; } }

function cwSaveSize(d){ try{ const o=JSON.parse(localStorage.getItem('kp.catwin2')||'{}')||{}; const max=d.classList.contains('max');
  const z = max ? {...o, max:true} : {max:false, w:Math.round(d.offsetWidth), h:Math.round(d.offsetHeight)}; localStorage.setItem('kp.catwin2', JSON.stringify(z)); }catch(e){} }

function cwLayout(d){ const w=d.clientWidth; d.classList.toggle('narrow', w<1100); d.classList.toggle('tiny', w<760); cwSplitPos(d); }

// ---------- ширина панелей: фильтры | список | карточка — границы перетаскиваются мышью (или стрелками), двойной щелчок — как было
const CW_PANE={ nav:[200,560], pv:[300,900] }, CW_MIDMIN=380;
function cwPanesLoad(d){ let z={}; try{ z=JSON.parse(localStorage.getItem('kp.cwpanes')||'{}')||{}; }catch(e){}
  for (const k in CW_PANE) if (z[k]) d.style.setProperty('--cw-'+k, z[k]+'px'); else d.style.removeProperty('--cw-'+k); }
function cwPanesSave(d){ const z={}; for (const k in CW_PANE){ const v=parseInt(d.style.getPropertyValue('--cw-'+k)); if (v) z[k]=v; }
  try{ localStorage.setItem('kp.cwpanes', JSON.stringify(z)); }catch(e){} }
function cwSplitPos(d){ const b=d.querySelector('.cw-b'); if (!b) return; const br=b.getBoundingClientRect();
  const nav=d.querySelector('.cw-nav'), pv=d.querySelector('.cw-pv');
  d.querySelectorAll('.cw-split').forEach(sp=>{ const k=sp.dataset.split, el=k==='nav'?nav:pv; const r=el?.getBoundingClientRect();
    const show = r && r.width>0 && !d.classList.contains('tiny') && !(k==='pv' && d.classList.contains('narrow')) && !d.classList.contains('pvwide');
    sp.hidden=!show; if (!show) return;
    sp.style.left=Math.round((k==='nav' ? r.right : r.left) - br.left - 4)+'px'; sp.setAttribute('aria-valuenow', Math.round(r.width)); });
  if (d.classList.contains('pvwide') && pv) pv.style.left = (d.classList.contains('tiny') || !nav ? 0 : Math.round(nav.getBoundingClientRect().width))+'px'; else if (pv) pv.style.left=''; }
function cwSplitSet(d, k, w){ const b=d.querySelector('.cw-b').getBoundingClientRect(), [lo,hi]=CW_PANE[k];
  const other = k==='nav' ? (d.classList.contains('narrow') ? 0 : d.querySelector('.cw-pv').getBoundingClientRect().width) : d.querySelector('.cw-nav').getBoundingClientRect().width;
  w=Math.round(Math.max(lo, Math.min(hi, b.width-other-CW_MIDMIN, w))); d.style.setProperty('--cw-'+k, w+'px'); cwSplitPos(d); }
function cwSplitBind(d){
  d.addEventListener('pointerdown', e=>{ const sp=e.target.closest?.('.cw-split'); if (!sp || e.button!==0) return; e.preventDefault();
    const k=sp.dataset.split, b=d.querySelector('.cw-b'); sp.setPointerCapture(e.pointerId); d.classList.add('resizing');
    const mv=ev=>{ const r=b.getBoundingClientRect(); cwSplitSet(d, k, k==='nav' ? ev.clientX-r.left : r.right-ev.clientX); };
    const up=()=>{ sp.removeEventListener('pointermove',mv); sp.removeEventListener('pointerup',up); sp.removeEventListener('pointercancel',up); d.classList.remove('resizing'); cwPanesSave(d); };
    sp.addEventListener('pointermove',mv); sp.addEventListener('pointerup',up); sp.addEventListener('pointercancel',up); });
  d.addEventListener('keydown', e=>{ const sp=e.target.closest?.('.cw-split'); if (!sp || !['ArrowLeft','ArrowRight','Home'].includes(e.key)) return; e.preventDefault();
    const k=sp.dataset.split; if (e.key==='Home'){ d.style.removeProperty('--cw-'+k); cwSplitPos(d); cwPanesSave(d); return; }
    const el=d.querySelector(k==='nav'?'.cw-nav':'.cw-pv'), st=(e.key==='ArrowRight')===(k==='nav') ? 24 : -24;
    cwSplitSet(d, k, el.getBoundingClientRect().width+st); cwPanesSave(d); }); }

// ---------- фильтрация
function cwKindOk(x){ if (CW.optFor==null) return true; const t=typeById(cwA(x).cat); return t.role==='accessory' || x.kind==='option'; }

function cwPass(x, skip){ const F=CW.F, a=cwA(x);
  if (CW.optFor!=null && !F.cat && !cwKindOk(x)) return false;
  if (skip!=='cat' && F.cat && a.cat!==F.cat) return false;
  for (const k of ['maker','series']) if (k!==skip && F[k] && cwNV(x,k)!==norm(F[k])) return false;
  for (const k in F.f) if (k!==skip && F.f[k] && cwNV(x,k)!==norm(F.f[k])) return false;
  for (const k in F.rng){ if (k===skip) continue; const r=F.rng[k]; if(!r) continue; const v=numOf(a[k]);
    if (r.min!==''&&r.min!=null && !(v>=+r.min)) return false; if (r.max!==''&&r.max!=null && !(v<=+r.max)) return false; }
  if (skip!=='sup' && F.sup && norm(cwSup(x)||CW_NOSUP)!==norm(F.sup)) return false;
  if (F.priced && !x.price) return false;
  if (F.stock && !cwInStock(x)) return false;
  if (F.q){ if (!F._qw || F._qs!==F.q){ F._qs=F.q; F._qw=norm(F.q).split(' ').filter(Boolean); }
    const h=cwHay(x); if (!F._qw.every(w=>cwWordHit(h,w))){ const f=cwFold(norm(F.q)); if (f.length<3 || !(h.fold.includes(f) || h.model2.includes(f))) return false; } }
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

const cwRngOn = r => r && ((r.min??'')!=='' || (r.max??'')!=='');
function cwFiltered(){ const F=CW.F; return !!(F.series||Object.values(F.f).some(Boolean)||Object.values(F.rng).some(cwRngOn)); }
// сколько условий отбора включено (фильтры и строка поиска; категория — нет)
function cwFilterCount(){ const F=CW.F; return [F.maker, F.series, F.sup, F.priced, F.stock, String(F.q||'').trim()].filter(Boolean).length + Object.values(F.f).filter(Boolean).length
  + Object.values(F.rng).filter(cwRngOn).length; }

// ---------- верхняя панель: категория, производитель, поставщик, «с ценой», «в наличии» — видны всегда, без прокрутки
function cwCounts(key, val){ const m=new Map(); CW.docs.forEach(x=>{ if (!cwKindOk(x) || !cwPass(x,key)) return; const v=val(x); if (v==null||v==='') return;
  const k=norm(v); const c=m.get(k)||{v:String(v),n:0}; c.n++; m.set(k,c); }); return m; }
function cwSel(key, label, m, cur, all){ const opts=[...m.values()].sort((p,q)=>String(p.v).localeCompare(String(q.v),'ru',{numeric:true}));
  const has=!cur||m.has(norm(cur));
  return `<label class="cw-sel${cur?' on':''}"><span>${label}</span><select data-top="${key}" aria-label="${label}"><option value="">${all}</option>${opts.map(o=>`<option value="${esc(o.v)}"${norm(cur)===norm(o.v)?' selected':''}>${esc(o.v)} · ${o.n}</option>`).join('')}${has?'':`<option selected>${esc(cur)} · 0</option>`}</select></label>`; }
function cwBar(){ const F=CW.F, el=$('#cwBar'); if (!el) return;
  const cc=cwCounts('cat', x=>cwA(x).cat), groups=[...new Set(TYPES.map(t=>t.group||'Прочее'))];
  const cat=`<label class="cw-sel cw-selcat${F.cat?' on':''}"><span>Категория</span><select data-top="cat" aria-label="Категория"><option value="">Все категории · ${[...cc.values()].reduce((a,c)=>a+c.n,0)}</option>${groups.map(g=>{
      const ts=TYPES.filter(t=>(t.group||'Прочее')===g && ((cc.get(norm(t.id))||{}).n || F.cat===t.id)); if (!ts.length) return '';
      return `<optgroup label="${esc(g)}">${ts.map(t=>`<option value="${esc(t.id)}"${F.cat===t.id?' selected':''}>${esc(t.name)} · ${(cc.get(norm(t.id))||{}).n||0}</option>`).join('')}</optgroup>`; }).join('')}</select></label>`;
  const sup=cwCounts('sup', x=>cwSup(x)||CW_NOSUP);
  morph(el, cat + cwSel('maker','Производитель', cwCounts('maker', x=>cwA(x).maker), F.maker, 'Все производители')
    + cwSel('sup','Поставщик', sup, F.sup, 'Все поставщики')
    + `<div class="cw-togs"><label class="cw-tog${F.priced?' on':''}"><input type="checkbox" id="cwPriced" ${F.priced?'checked':''}> С ценой</label>
       <label class="cw-tog${F.stock?' on':''}" title="Есть на складе поставщика (по фиду или файлу остатков)"><input type="checkbox" id="cwStock" ${F.stock?'checked':''}> В наличии</label></div>`); }

// ---------- выбранные условия — плашками с крестиком над списком
function cwChips(){ const F=CW.F, t=F.cat?typeById(F.cat):null, out=[];
  const chip=(key,txt)=>out.push(`<button type="button" class="cw-chip" data-chip="${esc(key)}" title="Убрать условие">${esc(txt)}<i aria-hidden="true">✕</i></button>`);
  if (String(F.q||'').trim()) chip('q', '«'+F.q.trim()+'»');
  if (t) chip('cat', t.name);
  if (F.maker) chip('maker', F.maker); if (F.sup) chip('sup', 'Поставщик: '+F.sup); if (F.series) chip('series', 'Серия '+F.series);
  for (const k in F.f) if (F.f[k]){ const f=t?.fields.find(z=>z.key===k); chip('f:'+k, (f?f.label+': ':'')+F.f[k]); }
  for (const k in F.rng){ const r=F.rng[k]; if (!cwRngOn(r)) continue; const f=t?.fields.find(z=>z.key===k)||{label:k};
    chip('r:'+k, `${f.label}: ${(r.min??'')!==''?'от '+fnum(+r.min):''}${(r.min??'')!==''&&(r.max??'')!==''?' ':''}${(r.max??'')!==''?'до '+fnum(+r.max):''}${f.unit?' '+f.unit:''}`); }
  if (F.priced) chip('priced', 'С ценой'); if (F.stock) chip('stock', 'В наличии');
  return out.length ? out.join('') + `<button type="button" class="lnk cw-clr" data-cw="resetall">Сбросить всё</button>` : ''; }

// ---------- отрисовка: слева вкладки «Фильтры» (параметры категории — сразу сверху) и «Категории» (дерево, перенос перетаскиванием)
function cwNav(){
  const F=CW.F, cnt=new Map(); let all=0;
  CW.docs.forEach(x=>{ if(!cwKindOk(x)) return; const c=cwA(x).cat; cnt.set(c,(cnt.get(c)||0)+1); all++; });
  const t=F.cat?typeById(F.cat):null, tab=CW.tab||(t?'flt':'cats');
  const nf=[F.series].filter(Boolean).length+Object.values(F.f).filter(Boolean).length+Object.values(F.rng).filter(cwRngOn).length;
  const tabs=`<div class="cw-tabs" role="tablist"><button type="button" role="tab" class="${tab==='flt'?'on':''}" aria-selected="${tab==='flt'}" data-tab="flt">Фильтры${nf?` <b>${nf}</b>`:''}</button>
    <button type="button" role="tab" class="${tab==='cats'?'on':''}" aria-selected="${tab==='cats'}" data-tab="cats">Категории</button></div>`;
  let body;
  if (tab==='cats'){
    const groups=[...new Set(TYPES.map(t=>t.group||'Прочее'))];
    let fold={}, hideZero=false; try{ fold=JSON.parse(localStorage.getItem('kp.cwfold')||'{}')||{}; hideZero=localStorage.getItem('kp.cwzero')==='1'; }catch(e){}
    const cats=groups.map(g=>{ const ts=TYPES.filter(t=>(t.group||'Прочее')===g && (CW.optFor==null || t.role==='accessory' || cnt.get(t.id) || F.cat===t.id) && (!hideZero || cnt.get(t.id) || F.cat===t.id));
      const total=ts.reduce((a,t)=>a+(cnt.get(t.id)||0),0), shut=!!fold[g] && !ts.some(t=>t.id===F.cat);
      return ts.length ? `<button type="button" class="cw-grp${shut?' shut':''}" data-cwfold="${esc(g)}" aria-expanded="${!shut}" title="${shut?'Развернуть':'Свернуть'} раздел"><span>${esc(g)}</span><i>${total}</i></button>`+(shut?'':ts.map(t=>{ const n=cnt.get(t.id)||0;
        return `<button type="button" class="cw-cat${F.cat===t.id?' on':''}${n?'':' zero'}" data-cat="${esc(t.id)}" data-dropcat="${esc(t.id)}" title="${esc(t.name)}"><span>${esc(t.name)}</span><i>${n}</i></button>`; }).join('')) : ''; }).join('');
    body=`${CW.optFor==null?'<p class="cw-hint">Позиции можно перетащить мышью на другую категорию.</p>':''}<div class="cw-cats">
        <button type="button" class="cw-cat all${!F.cat?' on':''}" data-cat=""><span>Все позиции</span><i>${all}</i></button>${cats}
        ${CW.optFor==null?'<button type="button" class="cw-cat add" data-cw="newtype">+ Новая категория</button>':''}
        <label class="cw-chk cw-zero"><input type="checkbox" data-cwzero ${hideZero?'checked':''}> Скрыть пустые категории</label></div>
      ${CW.optFor==null?`<p class="cw-cap"><button type="button" class="lnk cw-tset" data-cw="types" title="Параметры, фильтры, ключевые параметры на титуле, быстрые опции">⚙ Настроить категории</button></p>`:''}`;
  } else {
    let flt=cwFacet('series','Серия');
    if (t){ for (const f of t.fields) if (f.range) flt+=cwRange(f); for (const f of t.fields) if (f.facet) flt+=cwFacet(f.key,f.label,true); }
    const top=[...cnt.entries()].filter(([,n])=>n).sort((p,q)=>q[1]-p[1]).slice(0,10);
    body=`<p class="cw-cap">${t?esc(t.name):'Все категории'} ${cwFiltered()?'<button type="button" class="lnk" data-cw="reset">сбросить</button>':''}</p>
      <div class="cw-flt">${flt}
        ${t?'':`<p class="cw-hint" style="margin:0">Выберите категорию — появятся фильтры по её параметрам: мощность, давление, производительность…</p>
          <div class="cw-qcat">${top.map(([id,n])=>`<button type="button" class="chip" data-cat="${esc(id)}">${esc(typeById(id).name)} <i>${n}</i></button>`).join('')}</div>`}
        ${t&&CW.optFor==null?`<button type="button" class="lnk cw-tset2" data-cw="types">⚙ Какие параметры показывать в фильтрах</button>`:''}</div>`;
  }
  morph($('#cwNav'), tabs + body + `<div class="cw-navok"><button class="btn primary" type="button" data-cw="nav" id="cwNavOk">Показать позиции</button></div>`);
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

// РРЦ и наличие у поставщика (позиции из товарного фида, feeds.py)
function feedStockTxt(st){ if (!st) return ''; if (st.gone) return 'нет в фиде';
  const n=v=>String(v).replace('.',',');
  if (st.qty!=null){
    if (st.qty>0) return `в наличии ${n(st.qty)} шт.${st.transit?` + ${n(st.transit)} в пути`:''}`;
    if (st.transit) return `в пути ${n(st.transit)} шт.${st.eta?' ('+st.eta+')':''}`;
    if (st.prod) return `в производстве ${n(st.prod)} шт.`;
    return st.available ? 'под заказ' : 'нет в наличии'; }
  return st.available ? 'в наличии' : 'нет в наличии'; }
// подробности остатков: склады, в пути / в производстве, ожидаемая дата, акция — для подсказки
function feedStockTip(st){ if (!st) return '';
  const out=[], n=v=>String(v).replace('.',',');
  (st.wh||[]).forEach(([w,q])=>out.push(`${w}: ${n(q)} шт.`));
  if (st.transit) out.push(`в пути: ${n(st.transit)} шт.${st.eta?' — ожидается '+st.eta:''}`);
  if (st.prod) out.push(`в производстве: ${n(st.prod)} шт.${st.eta&&!st.transit?' — ожидается '+st.eta:''}`);
  if (st.promo) out.push(`акция: ${st.promo}`);
  return out.join('; '); }
function feedBadges(x){ const r=x.rrc, st=x.stock; if (!r && !st) return '';
  const up=r&&r.prev&&r.price>r.prev, dn=r&&r.prev&&r.price<r.prev, ok=st&&!st.gone&&(st.qty!=null?st.qty>0:st.available);
  return `<span class="fd-b">${r?`<span class="fd-rrc" title="Рекомендованная розничная цена поставщика${r.at?' на '+esc(r.at):''}${r.prev?`; прежняя ${money(r.prev)} ${curSh(r.cur||'RUB')}${r.prevAt?' ('+esc(r.prevAt)+')':''}`:''}">РРЦ ${money(r.price)} ${curSh(r.cur||'RUB')}${up?' <i class="up">▲</i>':dn?' <i class="dn">▼</i>':''}</span>`:''}${st?`<span class="fd-st ${ok?'ok':st.gone?'gone':(st.transit||st.prod)?'wait':'no'}" title="Наличие у поставщика${st.at?' на '+esc(st.at):''}${feedStockTip(st)?': '+esc(feedStockTip(st)):''}">${esc(feedStockTxt(st))}</span>`:''}${st&&st.promo&&!st.gone?`<span class="fd-promo" title="${esc(st.promo)}">акция</span>`:''}</span>`; }
function cwPriceHtml(x){ return x.price ? `${money(x.price)} ${curSh(x.priceCur||'RUB')}` : x.cost ? `<small>закупка</small>${money(x.cost)} ${curSh(x.costCur||'RUB')}` : '<small>без цены</small>'; }

function cwRow(x){ const id=x.id, n=x.pricesCount||(x.prices||[]).length, inn=cwInKp(id);
  return `<div class="cw-row${CW.sel.has(id)?' sel':''}${CW.active===id?' act':''}" data-id="${esc(id)}" draggable="${CW.optFor==null}">
    <label class="ck" title="Отметить (Shift — диапазон)"><input type="checkbox" data-ck ${CW.sel.has(id)?'checked':''} aria-label="Отметить"></label>
    ${x.photo?`<img src="${esc(x.photo.src)}" alt="" loading="lazy">`:'<i class="ph"></i>'}
    <div class="cw-mn"><b>${esc(x.name)}</b>${CW.pend.has(id)?'<span class="modb">На модерации</span>':''}${cwTags(x)}</div>
    <div class="cw-pr">${cwPriceHtml(x)}${feedBadges(x)}${n?`<small>в КП ${n} ${plural(n,'раз','раза','раз')}</small>`:''}</div>
    <button class="btn sm${inn?' in':''}" type="button" data-add title="${inn?(CW.optFor!=null?'Уже добавлено':'Уже в КП — увеличить количество'):''}">${cwAddLabel(id)}</button></div>`; }

// ---------- сортировка: поле + направление (↑ / ↓); позиции без значения — всегда в конце
const CW_SORTS=[['best','Рекомендуемые',1,'Сначала в наличии и с ценой, затем по основному параметру категории (при поиске — сначала точные совпадения модели)'],
  ['price','Цена',1,'В рублях по курсу ЦБ; без цены — закупочная цена, иначе в конце'],['stock','Наличие',-1,'Больше всего на складе — первыми'],
  ['name','Название',1,'По алфавиту, номера моделей — по возрастанию чисел'],['kp','Популярные в КП',-1,'Чаще всего попадали в коммерческие предложения'],
  ['upd','Обновлённые',-1,'Недавно изменённые позиции']];
function cwSortFields(){ const t=CW.F.cat?typeById(CW.F.cat):null; return t ? t.fields.filter(f=>f.num) : []; }
function cwSortDef(k){ const z=CW_SORTS.find(x=>x[0]===k); return z ? z[2] : 1; }
function cwSortBox(){ const F=CW.F, sel=$('#cwSort'), dir=$('#cwDir'); if (!sel) return;
  const fl=cwSortFields(); if (!CW_SORTS.some(x=>x[0]===F.sort) && !(F.sort.startsWith('f:') && fl.some(f=>'f:'+f.key===F.sort))){ F.sort='best'; F.dir=1; }
  morph(sel, CW_SORTS.map(([k,l,,h])=>`<option value="${k}" title="${esc(h)}"${F.sort===k?' selected':''}>${l}</option>`).join('')
    + (fl.length?`<optgroup label="Параметры: ${esc(typeById(F.cat).name)}">${fl.map(f=>`<option value="f:${esc(f.key)}"${F.sort==='f:'+f.key?' selected':''}>${esc(f.label)}${f.unit?', '+esc(f.unit):''}</option>`).join('')}</optgroup>`:''));
  sel.value=F.sort; const up=F.dir>0;
  dir.textContent = F.sort==='name' ? (up?'А→Я':'Я→А') : up?'↑ по возрастанию':'↓ по убыванию';
  dir.title='Сменить направление сортировки'; dir.setAttribute('aria-label', up?'По возрастанию — сменить на убывание':'По убыванию — сменить на возрастание');
  dir.hidden = F.sort==='best'; }
function cwRub(v, cur){ if (!v) return null; cur=cur||'RUB'; if (cur==='RUB') return v; const r=+(CW.fx?.[cur]) || +String(S.pricing?.rates?.[cur]||'').replace(',','.');
  return r>0 ? v*r : null; }
function cwPriceRub(x){ return x.price ? cwRub(x.price, x.priceCur) : x.cost ? cwRub(x.cost, x.costCur) : null; }
function cwStockN(x){ const st=x.stock; if (!st || st.gone) return null; return st.qty!=null ? (st.qty>0?st.qty:null) : st.available ? 1 : null; }
function cwLoadFx(){ if (CW.fx || CW.fxLoading) return; CW.fxLoading=true;
  api('/api/cbr').then(r=>{ if (r && (r.EUR||r.USD)){ CW.fx=r; if (CW.F.sort==='price') cwList(); } }).catch(()=>{}).finally(()=>{ CW.fxLoading=false; }); }
function cwSorter(){ const F=CW.F, s=F.sort, d=F.dir||1, ord=new Map(TYPES.map((t,i)=>[t.id,i]));
  const byName=(p,q)=>String(p.name).localeCompare(q.name,'ru',{numeric:true});
  const num=(f)=>{ const m=new Map(); return x=>{ if (!m.has(x.id)){ const v=f(x); m.set(x.id, v==null||!isFinite(v)||v===0?null:v); } return m.get(x.id); }; };
  const cmp=(g)=>(p,q)=>{ const a=g(p), b=g(q); return a==null ? (b==null?0:1) : b==null ? -1 : (a-b)*d; };
  if (s==='name') return (p,q)=>byName(p,q)*d;
  if (s==='price'){ const c=cmp(num(cwPriceRub)); return (p,q)=>c(p,q)||byName(p,q); }
  if (s==='stock'){ const c=cmp(num(cwStockN)); return (p,q)=>c(p,q)||byName(p,q); }
  if (s==='kp'){ const c=cmp(num(x=>x.pricesCount||(x.prices||[]).length)); return (p,q)=>c(p,q)||byName(p,q); }
  if (s==='upd'){ const c=cmp(num(x=>Date.parse(x.updatedAt||'')||null)); return (p,q)=>c(p,q)||byName(p,q); }
  if (s.startsWith('f:')){ const k=s.slice(2), c=cmp(num(x=>numOf(cwA(x)[k]))); return (p,q)=>c(p,q)||byName(p,q); }
  // рекомендуемые: точные совпадения → в наличии с ценой → с ценой → остальные; внутри — по категориям (порядок разделов) и основному параметру
  const q=String(F.q||'').trim(), rel=num(x=>q?cwRel(x)+1:null), main=num(x=>{ const a=cwA(x), t=typeById(a.cat); return numOf(a[t.main||'kw']); });
  const tier=x=>(x.price||x.cost ? 0 : 2) + (cwInStock(x) ? 0 : 1), cm=cmp(main);
  return (p,q2)=> (q ? (rel(p)-rel(q2)) : 0) || tier(p)-tier(q2) || (ord.get(cwA(p).cat)??999)-(ord.get(cwA(q2).cat)??999) || cm(p,q2) || byName(p,q2); }

function cwList(){
  const F=CW.F;
  const list=CW.docs.filter(x=>cwPass(x));
  if (F.sort==='price') cwLoadFx();
  list.sort(cwSorter()); cwSortBox();
  CW.view=list;
  $('#cwCnt').innerHTML = CW.docs.length ? `Найдено: <b>${list.length}</b> из ${CW.docs.length}` : '';
  morph($('#cwChips'), cwChips()); cwBar();
  const all=$('#cwAll'); const k=list.filter(x=>CW.sel.has(x.id)).length; all.checked=!!list.length && k===list.length; all.indeterminate=k>0 && k<list.length;
  const ok=$('#cwNavOk'); if (ok) ok.textContent = list.length ? `Показать: ${list.length}` : 'Ничего не найдено';
  morph($('#cwList'), list.length ? list.slice(0,CW.limit).map(cwRow).join('')
      + (list.length>CW.limit?`<div class="cw-more"><button class="btn" type="button" data-more>Показать ещё (${list.length-CW.limit})</button></div>`:'')
    : `<p class="empty">${CW.docs.length?'Ничего не найдено — ослабьте фильтры или выберите «Все позиции».':'Каталог пуст. Добавьте позицию, загрузите файл каталога или импортируйте таблицу из Excel (меню «Ещё»).'}</p>`);
}

function cwFoot(){
  const f=$('#cwF'); if(!f) return; const n=CW.sel.size;
  if (CW.busy){ f.className='cw-f busy'; f.innerHTML=`<span class="spin"></span><b>${esc(CW.busy)}</b>`; return; }
  if (n){ f.className='cw-f bulk'; f.innerHTML=`<b>Отмечено: ${n}</b>
      <button class="btn primary" type="button" data-bulk="add">${CW.optFor!=null?'Добавить опциями':'Добавить в КП'}</button>
      ${CW.optFor==null?'<button class="btn" type="button" data-bulk="move">Перенести в категорию…</button>':''}
<span class="sp"></span>
      <button class="btn ghost" type="button" data-bulk="clear">Снять отметки</button>`; return; }
  const k = CW.optFor!=null ? (S.items[CW.optFor]?.options||[]).filter(o=>o.name).length : S.items.filter(x=>x.name).length;
  f.className='cw-f'; f.innerHTML=`<span class="muted cw-note">${esc(CW.note||'Отметьте галочками несколько позиций — появятся пакетные действия.'+(matchMedia('(pointer:coarse)').matches?'':' Позиции можно перетащить мышью на категорию слева.'))}</span>
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
  return `<div class="pv-mtop"><button class="btn pv-back" type="button" data-pv="close"><span aria-hidden="true">‹</span> К списку</button></div>
  <div class="pv-scroll">
    <div class="pv-photo">${x.photo?`<img src="${esc(x.photo.src)}" alt="" title="${esc(x.name||'')}">`:'<span>нет фото</span>'}</div>
    ${x.photoFrom&&x.photo?`<p class="muted pv-pf">Фото — от похожей модели того же производителя («${esc(x.photoFrom.name||'')}»). Своё фото — «Редактировать» → «Описание и фото».</p>`:''}
    <div class="pv-ttl"><h4>${esc(x.name||'Без названия')}</h4>${x.logo?`<img class="pv-logo" src="${esc(x.logo.src)}" alt="">`:''}</div>${x.spec?`<p class="muted pv-spec">${esc(x.spec)}</p>`:''}
    ${CW.optFor==null?`<label class="pv-cat"><span>Категория</span><select data-pvcat>${typeOptionsHtml(a.cat)}</select></label>`:''}
    <div class="pv-price"><b>${x.price?money(x.price)+' '+curSh(x.priceCur||'RUB'):'Цена не указана'}</b>${x.cost?`<span>закупка ${money(x.cost)} ${curSh(x.costCur||'RUB')}${x.costDisc&&x.costDisc.pct&&x.costSrc==='feed'?` (−${String(x.costDisc.pct).replace('.',',')} %)`:''}</span>`:''}${feedBadges(x)}</div>
    ${x.stock&&!x.stock.gone&&feedStockTip(x.stock)?`<p class="pv-stock">${esc(feedStockTip(x.stock))}</p>`:''}
    ${x.feed?`<p class="muted pv-pf">Из фида поставщика${x.feed.sku?' · артикул '+esc(x.feed.sku):''}${x.feed.url?` · <a href="${esc(x.feed.url)}" target="_blank" rel="noopener">страница товара</a>`:''}. ${x.feed.files?'Цены и наличие обновляются из прайса и остатков поставщика.':'РРЦ и наличие проверяются раз в день.'}</p>`:''}
    ${kpi?`<div class="pv-kpi">${kpi}</div>`:''}
    ${params.length?`<table class="pv-t">${params.map(([k,v])=>`<tr><td>${esc(k)}</td><td>${esc(v)}</td></tr>`).join('')}</table>`:''}
    ${loading?'<p class="muted">Загружаю описание и характеристики…</p>':''}
    ${feats.length?`<p class="pv-cap">Описание</p>${feats.map(f=>`<p class="pv-f">${f.label?`<b>${esc(f.label)}.</b>${/^• /.test(f.text||'')?'<br>':' '}`:''}${esc(f.text||'')}</p>`).join('')}`:''}
    ${groups.length?`<p class="pv-cap">Характеристики</p>${groups.map((g,k)=>`<details class="pv-g"${k===0?' open':''}><summary>${esc(g.name||'Основные')} <i>${g.rows.filter(r=>r.k||r.v).length}</i></summary><table class="pv-t">${g.rows.filter(r=>r.k||r.v).map(r=>`<tr${r.hl?' class="hl"':''}><td>${esc(r.k)}</td><td>${esc(r.v)}</td></tr>`).join('')}</table></details>`).join('')}`:''}
    ${gal.length?`<p class="pv-cap">Изображения <i>${gal.length}</i></p><div class="pv-gal">${gal.map(g=>`<img src="${esc(g.src)}" alt="" title="${esc(g.caption||'')}" loading="lazy">`).join('')}</div>`:''}
    ${hist.length?`<p class="pv-cap">В коммерческих предложениях <i>${n}</i></p><table class="pv-t pv-h">${hist.map(p=>`<tr><td>${esc(KPGen.ruDate(p.date))}${p.number?`<br><small>№ ${esc(p.number)}</small>`:''}</td><td>${esc(p.client||'')}</td><td>${p.price?money(p.price)+' '+curSh(p.cur||'RUB'):''}</td></tr>`).join('')}</table>`:''}
    ${!loading&&!feats.length&&!groups.length?'<p class="muted pv-empty">Описания и характеристик пока нет — нажмите «Редактировать».</p>':''}
  </div>
  <div class="pv-acts"><div class="pv-main"><button class="btn primary" type="button" data-pv="add">${cwAddLabel(x.id,true)}</button><button class="btn" type="button" data-pv="edit">Редактировать</button></div>
    <div class="pv-sub">${CW.optFor==null?'<button class="btn ghost" type="button" data-pv="dup" title="Создать копию позиции и открыть её на редактирование">Создать копию</button>':''}<span class="sp"></span><button class="btn ghost pv-w" type="button" data-pv="wide" title="Карточка крупно, на месте списка (двойной щелчок по позиции). Esc — назад к списку">${cwDlg().classList.contains('pvwide')?'Свернуть карточку':'⤢ Крупно'}</button><button class="btn ghost pv-x" type="button" data-pv="close">Закрыть карточку</button></div></div>`;
}

async function cwPreview(){
  const pv=$('#cwPv'), d=cwDlg(); if(!pv) return; const id=CW.active;
  d.classList.toggle('pvon', !!id);
  const light=id && CW.docs.find(z=>z.id===id);
  if (!light){ CW.active=null; d.classList.remove('pvon','pvwide');
    pv.innerHTML=`<div class="cw-pv0"><b>Карточка позиции</b><p>Нажмите на позицию в списке — здесь появятся фото, параметры, описание, характеристики и история цен.</p>
      <p>Двойной щелчок — карточка крупно, на месте списка. Изменить позицию — кнопка «Редактировать» в карточке.</p><p>Отметьте галочками несколько позиций, чтобы добавить их в КП сразу, перенести в другую категорию или удалить.</p></div>`; return; }
  if (pv.dataset.id!==id){ pv.innerHTML=cwCard(light,!!light._light); pv.dataset.id=id; }
  const full=await fullDoc(light); if (CW.active!==id) return;
  const sc=pv.querySelector('.pv-scroll')?.scrollTop||0; morph(pv, cwCard(full,false)); const s2=pv.querySelector('.pv-scroll'); if(s2) s2.scrollTop=sc;
}

// изображение крупно поверх окна каталога; закрывается щелчком или Esc
function cwZoom(src, caption){ const d=cwDlg(); d.querySelector('.cw-lb')?.remove();
  const z=document.createElement('div'); z.className='cw-lb'; z.innerHTML=`<img src="${esc(src)}" alt=""><p>${esc(caption||'Щелчок — закрыть')}</p>`; d.appendChild(z); }

// карточка крупно: занимает место списка, панель фильтров остаётся; Esc, «‹ К списку» или «Свернуть» — назад
function cwWide(on, id){ const d=cwDlg(); if (id) cwActivate(id); if (on && !CW.active) return;
  d.classList.toggle('pvwide', !!on); cwSplitPos(d); cwPreview();
  if (!on && CW.active) document.querySelector(`#cwList .cw-row[data-id="${CSS.escape(CW.active)}"]`)?.scrollIntoView({block:'nearest'}); }

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

// режим модерации и товары, правки которых ждут решения администратора
async function cwLoadPending(){ try{ const r=await api('/api/catalog/pending'); CW.mod=!!r.moderation; CW.pend=new Set(r.ids||[]); }catch(e){} }

async function cwReload(){ await refreshCat(); await cwLoadPending(); CW.docs=catCache; renderForm(); }

async function cwMove(ids, cat){
  const t=typeById(cat), todo=ids.filter(id=>{ const x=CW.docs.find(z=>z.id===id); return x && cwA(x).cat!==cat; });
  if (!todo.length) return cwNote(`Позиции уже в категории «${t.name}»`);
  const undo=[]; let k=0, fail=0, pend=0;
  for (const id of todo){ cwBusy(`Переношу в «${t.name}»: ${++k} из ${todo.length}`);
    try{ const full=await store().get(id); if(!full||!full.id) throw 0; const prev=(full.attrs||{}).cat;
      full.attrs={...(full.attrs||{}), cat}; if ((await store().put(full))._pending) pend++; else undo.push({id, prev}); }catch(e){ fail++; } }
  CW.undo = undo.length ? {list:undo, name:t.name} : null; CW.sel.clear(); CW.busy='';
  await cwReload(); CW.note=`Перенесено в «${t.name}»: ${undo.length} ${plural(undo.length,'позиция','позиции','позиций')}`+(pend?`, отправлено на модерацию: ${pend}`:'')+(fail?`, не удалось: ${fail}`:''); cwRedraw();
}

async function cwUndo(){ const u=CW.undo; if(!u) return; CW.undo=null; let k=0;
  for (const {id,prev} of u.list){ cwBusy(`Возвращаю: ${++k} из ${u.list.length}`);
    try{ const full=await store().get(id); const a={...(full.attrs||{})}; if (prev) a.cat=prev; else delete a.cat; full.attrs=a; await store().put(full); }catch(e){} }
  CW.busy=''; await cwReload(); CW.note='Перенос отменён'; cwRedraw(); }

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
  base=base||CW.F.cat||(CW.active&&CW.docs.find(z=>z.id===CW.active)&&cwA(CW.docs.find(z=>z.id===CW.active)).cat)||(TYPES.find(t=>t.role!=='accessory'&&!t.station)||{}).id||'other';
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

const cwAfterSave = async doc => { await cwReload(); CW.active=doc.id; const pv=$('#cwPv'); if (pv) pv.dataset.id=''; CW.note=`Сохранено: ${doc.name}`; cwRedraw();
  requestAnimationFrame(()=>document.querySelector(`#cwList .cw-row[data-id="${CSS.escape(doc.id)}"]`)?.scrollIntoView({block:'nearest'})); };

async function cwEdit(id){ if (!can('catEdit')) return cannot('catEdit'); const x=await fullDoc(CW.docs.find(z=>z.id===id)); if (!x) return; openCatEditor(x, cwAfterSave); }


async function cwDup(id){ if (!can('catAdd')) return cannot('catAdd'); const x=await fullDoc(CW.docs.find(z=>z.id===id)); if (!x || x._light) return cwNote('Не удалось загрузить позицию');
  const c=JSON.parse(JSON.stringify(x)); c.id=uid()+uid(); c.name=x.name+' (копия)'; c.prices=[]; delete c.pricesCount; openCatEditor(c, cwAfterSave, true); }

async function cwImportFile(f){
  try{ const j=JSON.parse(await f.text()); const items=Array.isArray(j)?j:j.items; if(!Array.isArray(items)) throw 0;
    // новые категории из файла (types): добавляются к своим типам; категории с уже существующим id не меняются
    let nt=0;
    if (Array.isArray(j.types)){
      const add=j.types.filter(t=>t && /^[a-z][a-z0-9_]{1,30}$/.test(t.id||'') && t.name && Array.isArray(t.fields) && t.fields.every(fl=>fl&&fl.key&&fl.label) && !TYPES.some(x=>x.id===t.id));
      if (add.length){ cwBusy('Добавляю категории: '+add.map(t=>t.name).join(', '));
        await api('/api/types',{method:'PUT',headers:{'Content-Type':'application/json; charset=utf-8'},body:JSON.stringify({version:1,types:[...userTypesList(), ...add]})});
        await loadTypes(); catCache.forEach(cwForget); nt=add.length; }
    }
    const ex=new Map((await store().list()).map(z=>[z.id,z])); let n=0, pend=0;
    for (const x of items){ if(!(x&&x.id&&x.name)) continue; const o=ex.get(x.id); cwBusy(`Загружаю каталог: ${++n} из ${items.length}`);
      if (o){ if(!x.price && o.price) x.price=o.price; if((!x.prices||!x.prices.length) && o.prices&&o.prices.length) x.prices=o.prices; if(!x.options&&o.options) x.options=o.options; }
      if ((await store().put(x))._pending) pend++; }
    // удалять позиции (в том числе дубликаты из списка remove) может только администратор — в «Настройках»
    const rm=Array.isArray(j.remove)?j.remove.length:0;
    CW.busy=''; await cwReload(); CW.note=`Загружено позиций: ${n}`+(nt?`, новых категорий: ${nt}`:'')+(pend?`, на модерации: ${pend}`:'')+(rm?`; дубликаты к удалению (${rm}) удаляет администратор в «Настройках»`:''); cwRedraw(); }
  catch(e){ CW.busy=''; cwNote('Это не файл каталога КП'); }
}

async function cwExport(){ const all=(await store().full()).map(x=>{ const y={...x}; delete y._a; delete y._nv; delete y._hay; delete y._sup; return y; }); if(!all.length) return cwNote('Каталог пуст');
  saveFile(`Каталог_КП_Пневмотех_${today()}.json`, new Blob([JSON.stringify({format:'kp-catalog',version:1,items:all})],{type:'application/json'})); }

function cwClose(){ const d=cwDlg(); if (d.open) d.close(); }

// ---------- окно
async function openCatalog(mode={}){
  const optFor = Number.isInteger(mode.opt) ? mode.opt : null;
  Object.assign(CW, { optFor, F: optFor!=null ? FO : FI, active:null, limit:150, lastCk:null, note:'', busy:'', tab:'' }); CW.sel.clear();
  const F=CW.F; if (mode.cat!=null){ F.cat=mode.cat; F.f={}; F.rng={}; }
  const d=cwDlg(); d.classList.remove('navon','pvon','pvwide'); cwSize(d); cwPanesLoad(d);
  d.innerHTML=`<div class="cw-h"><button class="btn cw-navbtn" type="button" data-cw="nav" aria-label="Категории и фильтры" title="Категории и фильтры"><span aria-hidden="true">☰</span><span class="cw-lbl2"> Фильтры</span></button>
     <h3>${optFor!=null?'Опции для позиции '+(optFor+1):'Каталог'}</h3>
     <div class="cw-q"><input type="search" id="cwQ" placeholder="Модель, артикул, производитель, поставщик или характеристика" autocomplete="off" value="${esc(F.q)}" aria-label="Поиск по каталогу" title="Можно без пробелов и дефисов: «DVK3013» найдёт DVK D 30-13; «/» — перейти к поиску"><kbd aria-hidden="true">/</kbd></div>
     ${optFor==null?'<button class="btn" type="button" data-cw="new" title="Новая позиция каталога">+<span class="cw-lbl"> Позиция</span></button>':''}
     <details class="cw-menu"><summary class="btn" title="Импорт, выгрузка, типы оборудования">Ещё<span class="cw-lbl"> ▾</span></summary><div>
       <button type="button" data-cw="xls">Импорт из Excel…</button><button type="button" data-cw="imp">Загрузить файл каталога (.json)…</button><button type="button" data-cw="exp">Выгрузить каталог в файл</button>
       <hr><button type="button" data-cw="types">Типы оборудования…</button></div></details>
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
  cwBind(d); cwLayout(d);
  CW.docs = catCache.length ? catCache : await store().list().catch(()=>[]);
  await Promise.all([cwLoadPending(), cwLoadSources()]);
  cwRedraw();
  setTimeout(()=>{ if (matchMedia('(pointer:fine)').matches) $('#cwQ')?.focus(); },30);
}

// поставщики позиций: фиды-источники и справочник поставщиков (для фильтра «Поставщик» и поиска по нему)
async function cwLoadSources(){
  const [src, sups] = await Promise.all([api('/api/catalog/sources').catch(()=>({})), api('/api/suppliers').catch(()=>[])]);
  CW.src = src && typeof src==='object' && !Array.isArray(src) ? src : {}; CW.sups = Array.isArray(sups) ? sups : [];
  CW.docs.forEach(x=>{ delete x._sup; delete x._hay; }); }

function cwBind(d){
  if (d._bound) return; d._bound=true; cwSplitBind(d);
  let szT=null; new ResizeObserver(()=>{ if(!d.open) return; cwLayout(d); clearTimeout(szT); szT=setTimeout(()=>{ if (d.open && !d.classList.contains('max')) cwSaveSize(d); },500); }).observe(d);
  let qT=null;
  d.addEventListener('input', e=>{ const t=e.target, F=CW.F;
    if (t.id==='cwQ'){ F.q=t.value; CW.limit=150; clearTimeout(qT); qT=setTimeout(()=>{ cwNav(); cwList(); }, CW.docs.length>2000?180:60); return; }
    if (t.dataset.rk){ const r=F.rng[t.dataset.rk]||(F.rng[t.dataset.rk]={min:'',max:''}); r[t.dataset.rs]=t.value.replace(',','.').replace(/[^\d.]/g,''); cwList(); } });
  d.addEventListener('change', e=>{ const t=e.target, F=CW.F;
    if (t.dataset.cwzero!=null){ try{ localStorage.setItem('kp.cwzero', t.checked?'1':'0'); }catch(_){} return cwNav(); }
    if (t.id==='cwSort'){ F.sort=t.value; F.dir=cwSortDef(t.value); cwList(); $('#cwList').scrollTop=0; return; }
    if (t.dataset.f!=null){ if (t.dataset.in) F.f[t.dataset.f]=t.value; else F[t.dataset.f]=t.value; CW.limit=150; cwNav(); cwList(); return; }
    if (t.id==='cwPriced'){ F.priced=t.checked; CW.limit=150; cwNav(); cwList(); return; }
    if (t.id==='cwStock'){ F.stock=t.checked; CW.limit=150; cwNav(); cwList(); return; }
    if (t.dataset.top){ const k=t.dataset.top; CW.limit=150;
      if (k==='cat'){ F.cat=t.value; F.f={}; F.rng={}; F.series=''; CW.tab=t.value?'flt':''; } else F[k]=t.value;
      cwNav(); cwList(); $('#cwList').scrollTop=0; return; }
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
    const fg=t.closest('[data-cwfold]'); if (fg){ let fold={}; try{ fold=JSON.parse(localStorage.getItem('kp.cwfold')||'{}')||{}; }catch(e){}
      fold[fg.dataset.cwfold]=!fold[fg.dataset.cwfold]; try{ localStorage.setItem('kp.cwfold', JSON.stringify(fold)); }catch(e){} return cwNav(); }
    if (t.closest('#cwDir')){ F.dir=-(F.dir||1); cwList(); $('#cwList').scrollTop=0; return; }
    const tab=t.closest('[data-tab]'); if (tab){ CW.tab=tab.dataset.tab; cwNav(); return; }
    const chip=t.closest('[data-chip]'); if (chip){ const k=chip.dataset.chip; CW.limit=150;
      if (k==='q'){ F.q=''; const q=$('#cwQ'); if (q) q.value=''; }
      else if (k==='cat'){ F.cat=''; F.f={}; F.rng={}; F.series=''; CW.tab=''; }
      else if (k==='priced'||k==='stock') F[k]=false;
      else if (k.startsWith('f:')) F.f[k.slice(2)]='';
      else if (k.startsWith('r:')) F.rng[k.slice(2)]={min:'',max:''};
      else F[k]='';
      cwNav(); cwList(); return; }
    const cat=t.closest('[data-cat]'); if (cat){ F.cat=cat.dataset.cat; F.f={}; F.rng={}; F.series=''; CW.limit=150; CW.tab=F.cat?'flt':'cats';
      if (!F.cat) d.classList.remove('navon'); cwNav(); cwList(); $('#cwList').scrollTop=0; return; }
    if (t.closest('[data-more]')){ CW.limit+=300; cwList(); return; }
    const add=t.closest('[data-add]'); if (add){ return cwAdd([add.closest('.cw-row').dataset.id]); }
    const rc=t.closest('[data-rc]'); if (rc){ const k=rc.dataset.rc, r=F.rng[k]||{min:'',max:''}; const same=String(r.min)===rc.dataset.lo&&String(r.max)===rc.dataset.hi;
      F.rng[k]= same?{min:'',max:''}:{min:rc.dataset.lo,max:rc.dataset.hi}; cwNav(); cwList(); return; }
    const bk=t.closest('[data-bulk]'); if (bk){ const ids=[...CW.sel];
      if (bk.dataset.bulk==='add') return cwAdd(ids); if (bk.dataset.bulk==='move') return cwMoveDlg(ids);
      if (bk.dataset.bulk==='clear'){ CW.sel.clear(); cwList(); cwFoot(); } return; }
    const pv=t.closest('[data-pv]'); if (pv && CW.active){ const a=pv.dataset.pv, id=CW.active;
      if (a==='add') return cwAdd([id]); if (a==='edit') return cwEdit(id); if (a==='dup') return cwDup(id);
      if (a==='wide') return cwWide(!d.classList.contains('pvwide'));
      if (a==='close'){ if (d.classList.contains('pvwide')) return cwWide(false); CW.active=null; cwActivate(null); } return; }
    const zi=t.closest('.pv-photo>img:first-child, .pv-gal img'); if (zi){ cwZoom(zi.src, zi.title||''); return; }
    if (t.closest('.cw-lb')){ t.closest('.cw-lb').remove(); return; }
    const row=t.closest('.cw-row'); if (row){ cwActivate(row.dataset.id); return; }
    const c=t.closest('[data-cw]'); if (!c) return;
    switch (c.dataset.cw){
      case 'close': return cwClose();
      case 'done': cwClose(); if (CW.optFor==null && STEP!=='equip') goStep('equip'); return;
      case 'max': d.classList.toggle('max'); cwSaveSize(d); return;
      case 'nav': d.classList.toggle('navon'); return;
      case 'reset': Object.assign(F,{series:'',f:{},rng:{}}); cwNav(); cwList(); return;
      case 'resetall': { Object.assign(F,{maker:'',series:'',sup:'',f:{},rng:{},priced:false,stock:false,q:''}); const q=$('#cwQ'); if (q) q.value=''; CW.limit=150; cwNav(); cwList(); return; }
      case 'undo': return cwUndo();
      case 'newtype': return cwNewType(id=>{ F.cat=id; F.f={}; F.rng={}; cwRedraw(); });
      case 'new': return newEquip('catalog', F.cat||'');
      case 'xls': return openXlsImport(F.cat);
      case 'types': return openTypesEditor(F.cat || undefined);
      case 'exp': return cwExport();
      case 'imp': { const f=document.createElement('input'); f.type='file'; f.accept='.json,application/json'; f.hidden=true;
        f.onchange=()=>{ const file=f.files[0]; f.remove(); if (file) cwImportFile(file); }; d.appendChild(f); f.click(); return; }
    } });
  // двойной щелчок по позиции — карточка крупно (на месте списка); по границе панелей — ширина как была
  d.addEventListener('dblclick', e=>{ const sp=e.target.closest('.cw-split'); if (sp){ d.style.removeProperty('--cw-'+sp.dataset.split); cwSplitPos(d); cwPanesSave(d); return; }
    const row=e.target.closest('.cw-row'); if (row && !e.target.closest('button,label,input')){ getSelection()?.removeAllRanges(); cwWide(true, row.dataset.id); } });
  d.addEventListener('cancel', e=>{ const lb=d.querySelector('.cw-lb'); if (lb){ e.preventDefault(); lb.remove(); return; }
    if (d.classList.contains('pvwide')){ e.preventDefault(); cwWide(false); } });
  d.addEventListener('keydown', e=>{
    if (e.key==='/' && !e.ctrlKey && !e.metaKey && !e.altKey && !e.target.closest?.('input,textarea,select,[contenteditable]')){ e.preventDefault(); const q=$('#cwQ'); q?.focus(); q?.select(); return; }
    if (e.target.id==='cwQ' && e.key==='Escape' && e.target.value){ e.preventDefault(); e.stopPropagation(); e.target.value=''; CW.F.q=''; cwNav(); cwList(); return; }
    if (e.target.id==='cwQ' && e.key==='Enter'){ e.preventDefault(); const x=CW.view[0]; if (x) cwActivate(x.id); }
    if ((e.key==='ArrowDown'||e.key==='ArrowUp') && (e.target.id==='cwQ' || e.target.closest?.('.cw-list')) && CW.view.length){
      e.preventDefault(); const ids=CW.view.slice(0,CW.limit).map(x=>x.id); let k=ids.indexOf(CW.active); k = k<0 ? 0 : Math.max(0, Math.min(ids.length-1, k+(e.key==='ArrowDown'?1:-1)));
      cwActivate(ids[k]); document.querySelector(`#cwList .cw-row[data-id="${CSS.escape(ids[k])}"]`)?.scrollIntoView({block:'nearest'}); } });
  // перенос перетаскиванием: позиция (или все отмеченные, если тянут отмеченную) → категория слева
  d.addEventListener('dragstart', e=>{ const row=e.target.closest?.('.cw-row'); if (!row || CW.optFor!=null) return;
    const id=row.dataset.id; CW.drag = CW.sel.has(id) ? [...CW.sel] : [id];
    if (CW.tab!=='cats' && !d.classList.contains('narrow')){ CW.tab='cats'; setTimeout(cwNav); }      // цели переноса — во вкладке «Категории»
    e.dataTransfer.effectAllowed='move'; e.dataTransfer.setData('text/plain', CW.drag.length>1 ? `${CW.drag.length} позиций` : (CW.docs.find(z=>z.id===id)?.name||''));
    d.classList.add('dragging'); });
  d.addEventListener('dragend', ()=>{ CW.drag=null; d.classList.remove('dragging'); d.querySelectorAll('.cw-cat.over').forEach(b=>b.classList.remove('over')); });
  ['dragover','dragleave','drop'].forEach(ev=>d.addEventListener(ev, e=>{ const b=e.target.closest?.('[data-dropcat]'); if (!b || !CW.drag) return;
    e.preventDefault(); b.classList.toggle('over', ev==='dragover');
    if (ev==='drop'){ const ids=CW.drag; CW.drag=null; d.classList.remove('dragging'); cwMove(ids, b.dataset.dropcat); } }));
}

// после окон поверх каталога (типы оборудования, импорт из Excel) — обновить категории и список
document.addEventListener('close', e=>{ if (e.target.id==='dlg' && $('#catdlg')?.open && !CW.busy) cwRedraw(); }, true);
