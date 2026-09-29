// Каталог: хранилище на сервере, окно подбора с фильтрами, подстановка позиции в КП, пополнение каталога.
'use strict';

const CatSrv = { persistent:true,
  async list(){ return await api('/api/catalog'); },
  async get(id){ return await api('/api/catalog/'+encodeURIComponent(id)); },
  async full(){ return await api('/api/catalog?full=1'); },
  async put(doc){ doc={...doc, photo:await uploadImg(doc.photo), logo:await uploadImg(doc.logo), gallery: doc.gallery ? await Promise.all(doc.gallery.map(async g=>({...g, ...(await uploadImg(g))}))) : doc.gallery};
    await api('/api/catalog/'+doc.id,{method:'PUT',headers:{'Content-Type':'application/json; charset=utf-8'},body:JSON.stringify(doc)}); return doc; },
  async del(id){ await api('/api/catalog/'+id,{method:'DELETE'}); } };

const store = () => CatSrv;

async function fullDoc(x){ if (!x || !x._light) return x; try{ const d=await store().get(x.id); return d||x; }catch(e){ return x; } }

let catCache = [];

async function refreshCat(){ try{ catCache = await store().list(); }catch(e){ catCache=[]; } renderDatalist(); warmCat(); }

function warmCat(){ let k=0; const L=catCache; const step=(dl)=>{ const end=performance.now()+12; while(k<L.length && performance.now()<end){ const x=L[k++]; if(!x._a) x._a=attrsOf(x); } if(k<L.length) (window.requestIdleCallback||setTimeout)(step); }; (window.requestIdleCallback||setTimeout)(step); }

function renderDatalist(){ let d=$('#catNames'); if(!d){ d=document.createElement('datalist'); d.id='catNames'; document.body.appendChild(d); }
  d.innerHTML = catCache.map(x=>`<option value="${esc(x.name)}">`).join('');
  let o=$('#optNames'); if(!o){ o=document.createElement('datalist'); o.id='optNames'; document.body.appendChild(o); }
  const names=new Set(TYPES.flatMap(t=>(t.options||[]).map(o=>Array.isArray(o)?o[0]:o.name))); catCache.forEach(x=>{ if(typeById(attrsOf(x).cat).role==='accessory') names.add(x.name); });
  o.innerHTML=[...names].map(n=>`<option value="${esc(n)}">`).join(''); }

function fillFromCat(it, x){
  it.gallery = JSON.parse(JSON.stringify(x.gallery||[])).map(g=>({...g,id:g.id||uid()}));
  if (!x.hint) x={...x, hint:autoHint(x)};
  if (!(x.groups||[]).length) x={...x, groups:groupsFromAttrs(x)};
  Object.assign(it,{ name:x.name||it.name, spec:x.spec||'', price:x.price||0, pageTitle:x.pageTitle||'', photoCaption:x.photoCaption||'',
    features:JSON.parse(JSON.stringify(x.features||[])), groups:JSON.parse(JSON.stringify(x.groups||[])), hint:x.hint||null, catId:x.id, photo:x.photo||null, logo:x.logo||null,
    attrs:{...(x.attrs||{})}, options:JSON.parse(JSON.stringify(x.options||[])).map(o=>({...o,id:uid(),qty:o.unit==='усл.'?1:(+it.qty||1)})) });
  delete it._priceText; delete it._costText;
  it.cost=x.cost||0; it.costCur=x.costCur||'RUB'; it.margin=x.margin; it.mmode=x.mmode; it.priceManual=false;
  const pc=x.priceCur||'RUB';
  if (it.price && pc!==kpCur()){ const r1=rateOf(pc), r2=rateOf(kpCur()); it.price = (r1>0&&r2>0) ? Math.round(it.price*r1/r2) : 0; }
  if (it.cost) applyCalc(it);
  it.page = !!(it.photo || it.groups.length || it.features.some(f=>f.text));
  if (it.hint && (!S.cover.model || !S.cover.touched)) applyCover(it.hint,false);
}

async function syncCatalog(number){
  let list=[]; try{ list = await store().list(); }catch(e){}
  for (const it of S.items){
    if (!it.name.trim() || !it.price) continue;
    const doc = await fullDoc(list.find(d=>d.id===it.catId) || list.find(d=>norm(d.name)===norm(it.name)));
    const base = doc ? JSON.parse(JSON.stringify(doc)) : { id: uid()+uid(), prices: [] };
    const has = arr => Array.isArray(arr) && arr.length;
    Object.assign(base, { name:it.name, spec:it.spec||base.spec||'', price:it.price, priceCur:kpCur(), cost:it.cost||base.cost||0, costCur:it.cost?(it.costCur||'RUB'):(base.costCur||'RUB'), margin:it.margin ?? base.margin, mmode:it.mmode||base.mmode, pageTitle:it.pageTitle||base.pageTitle||'',
      photoCaption:it.photoCaption||base.photoCaption||'',
      features: (it.features||[]).some(f=>f.text) ? it.features : (base.features||[]),
      groups: (it.groups||[]).some(g=>(g.rows||[]).some(r=>r.k||r.v)) ? it.groups : (base.groups||[]),
      hint: it.hint||base.hint||null, photo: it.photo||base.photo||null, logo: it.logo||base.logo||null, gallery: (it.gallery&&it.gallery.length)?it.gallery.map(({id,src,w,h,caption,slot,wide,on,at})=>({id,src,w,h,caption,slot,wide,on,at})):(base.gallery||[]), updatedAt: new Date().toISOString(),
      attrs: {...(base.attrs||{}), ...Object.fromEntries(Object.entries(it.attrs||{}).filter(([,v])=>v!==''&&v!=null))} });
    if (!base.kind && attrsOf(base).type==='Опция') base.kind='option';
    base.prices = (base.prices||[]).filter(p => !number || p.number!==number);
    base.prices.unshift({ date:S.date, client:S.client, price:it.price, cur:kpCur(), cost:it.cost||0, costCur:it.costCur||'RUB', qty:+it.qty, number:number||'' });
    base.prices = base.prices.slice(0,50);
    const saved = await store().put(base);
    it.catId = base.id;
    if (saved){ if (saved.photo) it.photo = saved.photo; if (saved.logo) it.logo = saved.logo; if (saved.gallery && it.gallery && saved.gallery.length===it.gallery.length) it.gallery=it.gallery.map((g,k)=>({...g, src:saved.gallery[k].src})); }
    for (const o of (it.options||[])){
      if (!o.name.trim() || !o.price) continue;
      const od = list.find(d=>d.id===o.catId) || list.find(d=>norm(d.name)===norm(o.name));
      const ob = od ? JSON.parse(JSON.stringify(od)) : { id: uid()+uid(), kind:'option', prices: [], features:[], groups:[] };
      if (!od && !allPresets().some(p=>norm(p.name)===norm(o.name)) && !/авр|автоматическ/i.test(o.name)) ob.kind='option';
      Object.assign(ob,{ name:o.name, price:o.price, spec:ob.spec||'', updatedAt:new Date().toISOString(), short:o.short||ob.short||'', unit:o.unit||'шт.' });
      if (!od && allPresets().some(p=>norm(p.name)===norm(o.name))) ob.kind='option';
      ob.prices=(ob.prices||[]).filter(p=>!number||p.number!==number); ob.prices.unshift({date:S.date,client:S.client,price:o.price,qty:+o.qty,number:number||''}); ob.prices=ob.prices.slice(0,50);
      await store().put(ob); o.catId=ob.id; list.push(ob);
    }
  }
  await refreshCat();
}

const FI = { q:'', cat:'', maker:'', series:'', f:{}, rng:{}, priced:false, sort:'main' };

const FO = { q:'', cat:'', maker:'', series:'', f:{}, rng:{}, priced:false, sort:'name' };

async function openCatalog(mode={}){
  const optFor = Number.isInteger(mode.opt) ? mode.opt : null;
  const d=$('#dlg'); d.classList.add('wide');
  const F = optFor!=null ? FO : FI;
  if (mode.cat!=null) { F.cat=mode.cat; F.f={}; F.rng={}; }
  d.innerHTML=`<div class="dlg-h"><h3>${optFor!=null?'Опции и комплектующие для позиции '+(optFor+1):'Подбор оборудования'}</h3>
     <button class="btn" type="button" id="catXls">Импорт из Excel</button><button class="btn" type="button" id="catExp">Выгрузить</button><button class="btn" type="button" id="catImp">Загрузить</button>
     <button class="icon" type="button" data-close aria-label="Закрыть">✕</button></div>
   <div class="dlg-b"><div class="cattabs" id="catTabs"></div><div class="pick"><div class="flt" id="flt"></div>
   <div><div class="res-h"><input type="text" id="catQ" placeholder="Поиск: модель, производитель, любое значение характеристик" autocomplete="off" value="${esc(F.q)}">
     <select id="catSort" style="width:auto" aria-label="Сортировка"><option value="main">По основному параметру</option><option value="name">По названию</option><option value="recent">Недавно в КП</option><option value="price">По цене</option></select></div>
     <div class="muted" id="catCnt"></div><div id="catList"><p class="empty">Загружаю…</p></div></div></div>
     <p class="muted" style="margin:14px 0 0">Каталог пополняется при каждом сохранении КП. «Импорт из Excel» — массовое добавление позиций любого типа по шаблону.</p></div>`;
  d.showModal(); d.querySelector('[data-close]').onclick=()=>{ d.close(); d.classList.remove('wide'); };
  $('#catSort').value=F.sort;
  let docs=[];
  const A=x=>x._a||(x._a=attrsOf(x));
  const NV=(x,k)=>{ const c=x._nv||(x._nv={}); return k in c ? c[k] : (c[k]=norm(A(x)[k])); };   // нормализованные значения — считаются один раз
  let LIMIT=100;
  const T=()=>F.cat?typeById(F.cat):null;
  const pass=(x,skip)=>{ const a=A(x), t=typeById(a.cat);
    if (optFor!=null && !F.cat && t.role!=='accessory' && x.kind!=='option') return false;
    if (skip!=='cat' && F.cat && a.cat!==F.cat) return false;
    for (const k of ['maker','series']) if (k!==skip && F[k] && NV(x,k)!==norm(F[k])) return false;
    for (const k in F.f) if (k!==skip && F.f[k] && NV(x,k)!==norm(F.f[k])) return false;
    for (const k in F.rng){ if (k===skip) continue; const r=F.rng[k]; if(!r) continue; const v=numOf(a[k]);
      if (r.min!==''&&r.min!=null && !(v>=+r.min)) return false; if (r.max!==''&&r.max!=null && !(v<=+r.max)) return false; }
    if (F.priced && !x.price) return false;
    if (F.q){ if (!F._qw || F._qs!==F.q){ F._qs=F.q; F._qw=norm(F.q).split(' ').filter(Boolean); } const hay=x._hay||(x._hay=norm([x.name,x.spec,x.st||'',...Object.values(a),...(x.groups||[]).flatMap(g=>(g.rows||[]).map(r=>r.k+' '+r.v))].join(' '))); if(!F._qw.every(w=>hay.includes(w))) return false; }
    return true; };
  const facet=(key,label,inF)=>{ const cnt=new Map(); docs.filter(x=>pass(x,key)).forEach(x=>{ const v=A(x)[key]; if(v==null||v==='') return; const n=NV(x,key); const c=cnt.get(n)||{v:String(v),n:0}; c.n++; cnt.set(n,c); });
    const cur=inF?F.f[key]:F[key];
    const opts=[...cnt.values()].sort((p,q)=>String(p.v).localeCompare(String(q.v),'ru',{numeric:true}));
    if (!opts.length && !cur) return '';
    return `<label class="f"><span>${esc(label)}</span><select data-f="${key}" data-in="${inF?1:''}"><option value="">Все</option>${opts.map(o=>`<option value="${esc(o.v)}"${norm(cur)===norm(o.v)?' selected':''}>${esc(o.v)} (${o.n})</option>`).join('')}${cur&&!cnt.has(norm(cur))?`<option selected>${esc(cur)}</option>`:''}</select></label>`; };
  const rangeF=(f)=>{ const r=F.rng[f.key]||{min:'',max:''}; const chips=f.chips||[];
    const has=docs.some(x=>pass(x,f.key)&&numOf(A(x)[f.key])!=null); if(!has && r.min===''&&r.max==='') return '';
    return `<div><span class="muted">${esc(f.label)}${f.unit?', '+esc(f.unit):''}</span><div class="kw"><input type="text" inputmode="decimal" data-rk="${f.key}" data-rs="min" placeholder="от" value="${esc(r.min??'')}"><input type="text" inputmode="decimal" data-rk="${f.key}" data-rs="max" placeholder="до" value="${esc(r.max??'')}"></div>
      ${chips.length?`<div class="chips">${chips.map(([lo,hi])=>{ const on=String(r.min)===String(lo||'')&&String(r.max)===String(hi??''); return `<button class="chip${on?' on':''}" type="button" data-rc="${f.key}" data-lo="${lo||''}" data-hi="${hi??''}">${hi==null?'от '+fnum(lo):(lo?fnum(lo)+'–'+fnum(hi):'до '+fnum(hi))}</button>`; }).join('')}</div>`:''}</div>`; };
  const drawTabs=()=>{
    const cnt=new Map(); docs.forEach(x=>{ if (optFor!=null && typeById(A(x).cat).role!=='accessory' && x.kind!=='option') return; const c=A(x).cat; cnt.set(c,(cnt.get(c)||0)+1); });
    const groups=[...new Set(TYPES.map(t=>t.group||'Прочее'))];
    $('#catTabs').innerHTML=`<button type="button" class="ctab${!F.cat?' on':''}" data-cat="">Все типы <i>${[...cnt.values()].reduce((s,v)=>s+v,0)}</i></button>`+
      groups.map(g=>{ const ts=TYPES.filter(t=>(t.group||'Прочее')===g && (cnt.get(t.id)||F.cat===t.id));
        return ts.length?`<span class="cgrp">${esc(g)}:</span>`+ts.map(t=>`<button type="button" class="ctab${F.cat===t.id?' on':''}" data-cat="${esc(t.id)}">${esc(t.name)} <i>${cnt.get(t.id)||0}</i></button>`).join(''):''; }).join('')+
      `<button type="button" class="ctab add" data-newtype="1" title="Добавить позицию нового типа вручную">+ позиция вручную</button>`;
  };
  const drawF=()=>{
    const t=T();
    let html = facet('maker','Производитель') + facet('series','Серия');
    if (t){ for (const f of t.fields){ if (f.range) html+=rangeF(f); } for (const f of t.fields){ if (f.facet) html+=facet(f.key,f.label,true); } }
    else html += `<p class="muted" style="margin:0">Выберите тип оборудования вверху — появятся фильтры по его параметрам (мощность, производительность, давление, напор…).</p>`;
    $('#flt').innerHTML = html + `<label class="row muted" style="gap:8px"><input type="checkbox" id="fPriced" style="width:auto" ${F.priced?'checked':''}> Только с ценой</label>
       <button class="btn ghost" type="button" id="fReset">Сбросить фильтры</button>`;
  };
  const tags=x=>{ const a=A(x), t=typeById(a.cat), out=[];
    const kp=t.fields.filter(f=>f.kpi&&a[f.key]!=null&&a[f.key]!=='').slice(0,3).map(f=>fmtField(f,a[f.key]));
    if (kp.length) out.push(`<span class="tag kwt">${esc(kp.join(' · '))}</span>`);
    const fac=t.fields.filter(f=>f.facet&&!f.kpi&&a[f.key]&&String(a[f.key])!=='Нет').slice(0,4);
    for (const f of fac){ const v=String(a[f.key])==='Да' ? f.label : f.key==='engine'&&a.engineModel ? a[f.key]+' '+a.engineModel : fmtField(f,a[f.key]);
      out.push(`<span class="tag">${esc(v)}</span>`); }
    if (!F.cat) out.push(`<span class="tag tt">${esc(t.name)}</span>`);
    return out.length?`<div class="tags">${out.join('')}</div>`:''; };
  const mainVal=x=>{ const a=A(x), t=typeById(a.cat); return numOf(a[t.main||'kw']); };
  const draw=()=>{
    let list=docs.filter(x=>pass(x));
    const s=F.sort;
    list.sort((p,q)=> s==='name' ? String(p.name).localeCompare(q.name,'ru',{numeric:true}) : s==='price' ? (p.price||9e15)-(q.price||9e15) :
      s==='recent' ? String(q.prices?.[0]?.date||q.updatedAt||'').localeCompare(String(p.prices?.[0]?.date||p.updatedAt||'')) :
      (String(A(p).cat).localeCompare(String(A(q).cat))) || ((mainVal(p)??9e9)-(mainVal(q)??9e9)) || String(p.name).localeCompare(q.name,'ru',{numeric:true}));
    $('#catCnt').textContent = docs.length ? `Найдено: ${list.length} из ${docs.length}` : '';
    const btn = optFor!=null ? 'Добавить опцией' : 'Добавить в КП';
    $('#catList').innerHTML = list.length ? list.slice(0,LIMIT).map(x=>`<div class="cat">${x.photo?`<img src="${x.photo.src}" alt="" loading="lazy">`:'<div class="ph"></div>'}
      <div><b>${esc(x.name)}</b><span>${x.price?money(x.price)+' '+curSh(x.priceCur||'RUB'):(x.cost?'закупка '+money(x.cost)+' '+curSh(x.costCur||'RUB'):'цена не указана')}${x.spec?' · '+esc(x.spec):''}</span>${tags(x)}${(x.prices&&x.prices.length)?`<div class="hist">В КП: ${x.prices.length} ${plural(x.prices.length,'раз','раза','раз')} · последнее ${esc(KPGen.ruDate(x.prices[0].date))}, ${esc(x.prices[0].client||'')}${x.prices[0].number?' (№ '+esc(x.prices[0].number)+')':''}</div>`:''}</div>
      <div class="row"><button class="btn primary" type="button" data-add="${esc(x.id)}">${btn}</button><button class="icon" type="button" data-rm="${esc(x.id)}" aria-label="Удалить из каталога">✕</button></div></div>`).join('')
      + (list.length>LIMIT?`<div style="text-align:center;margin:12px 0"><button class="btn" type="button" data-more="1">Показать ещё (${list.length-LIMIT})</button></div>`:'')
      : `<p class="empty">${docs.length?'Ничего не найдено — ослабьте фильтры.':'Каталог пуст. Сохраните позицию в каталог, загрузите файл каталога или импортируйте таблицу из Excel.'}</p>`;
  };
  const redraw=()=>{ drawTabs(); drawF(); draw(); };
  const load=async()=>{ docs = catCache.length ? catCache : await store().list(); redraw(); };
  let qT=null; $('#catQ').oninput=e=>{ F.q=e.target.value; LIMIT=100; clearTimeout(qT); qT=setTimeout(redraw, docs.length>2000?180:60); };
  $('#catSort').onchange=e=>{ F.sort=e.target.value; draw(); };
  $('#catTabs').onclick=e=>{ const b=e.target.closest('[data-cat]'); if(b){ F.cat=b.dataset.cat; F.f={}; F.rng={}; redraw(); return; }
    if (e.target.closest('[data-newtype]')){ d.close(); d.classList.remove('wide'); pickTypeAndAdd(F.cat); } };
  $('#flt').onchange=e=>{ const t=e.target; if(t.dataset.f){ if(t.dataset.in) F.f[t.dataset.f]=t.value; else F[t.dataset.f]=t.value; redraw(); } else if(t.id==='fPriced'){ F.priced=t.checked; redraw(); } };
  $('#flt').oninput=e=>{ const t=e.target; if(t.dataset.rk){ const r=F.rng[t.dataset.rk]||(F.rng[t.dataset.rk]={min:'',max:''}); r[t.dataset.rs]=t.value.replace(',','.').replace(/[^\d.]/g,''); draw(); } };
  $('#flt').onclick=e=>{ const c=e.target.closest('[data-rc]'); if(c){ const k=c.dataset.rc, r=F.rng[k]||{min:'',max:''}; const same=String(r.min)===c.dataset.lo&&String(r.max)===c.dataset.hi;
      F.rng[k]= same?{min:'',max:''}:{min:c.dataset.lo,max:c.dataset.hi}; redraw(); }
    if (e.target.id==='fReset'){ Object.assign(F,{q:'',maker:'',series:'',f:{},rng:{},priced:false}); $('#catQ').value=''; redraw(); } };
  $('#catXls').onclick=()=>{ d.close(); d.classList.remove('wide'); openXlsImport(F.cat); };
  $('#catExp').onclick=async()=>{ const all=(await (store().full?store().full():store().list())).map(x=>{ const y={...x}; delete y._a; return y; }); if(!all.length) return toast('Каталог пуст');
    saveFile(`Каталог_КП_Пневмотех_${today()}.json`, new Blob([JSON.stringify({format:'kp-catalog',version:1,items:all})],{type:'application/json'})); };
  $('#catImp').onclick=()=>{ const f=document.createElement('input'); f.type='file'; f.accept='.json,application/json';
    f.onchange=async()=>{ try{ const j=JSON.parse(await f.files[0].text()); f.remove(); const items=Array.isArray(j)?j:j.items; if(!Array.isArray(items)) throw 0;
      const ex=new Map((await store().list()).map(z=>[z.id,z])); let n=0;
      for(const x of items){ if(!(x&&x.id&&x.name)) continue; const o=ex.get(x.id);
        if(o){ if(!x.price && o.price) x.price=o.price; if((!x.prices||!x.prices.length) && o.prices&&o.prices.length) x.prices=o.prices; if(!x.options&&o.options) x.options=o.options; }
        await store().put(x); n++; }
      // удаление дубликатов, перечисленных в файле каталога (цены и история переносятся в оставшуюся позицию)
      let rmN=0; const rmList=Array.isArray(j.remove)?j.remove:[];
      const byId=new Map(items.map(z=>[z.id,z]));
      for (const id of rmList){ const o=ex.get(id); if(!o) continue;
        const keepId=(j.merge&&j.merge[id])||null; const k=keepId&&byId.get(keepId);
        if (k && o.prices && o.prices.length){ k.prices=[...(o.prices||[]),...(k.prices||[])].slice(0,50); if(!k.price&&o.price) k.price=o.price; await store().put(k); }
        await store().del(id); rmN++; }
      toast(`Загружено позиций: ${n}`+(rmN?`, удалено дубликатов: ${rmN}`:'')); await refreshCat(); load(); }catch(e){ toast('Это не файл каталога КП'); } };
    f.hidden=true; d.appendChild(f); f.click(); };
  $('#catList').onclick=async e=>{
    if (e.target.closest('[data-more]')){ LIMIT+=200; draw(); return; }
    const add=e.target.closest('[data-add]'), rm=e.target.closest('[data-rm]');
    if (rm){ if(!confirm('Удалить позицию из каталога?')) return; await store().del(rm.dataset.rm); await refreshCat(); load(); return; }
    if (!add) return;
    const x=await fullDoc(docs.find(z=>z.id===add.dataset.add));
    if (optFor!=null){
      const it=S.items[optFor]; it.options=it.options||[];
      const a=A(x); it.options.push(newOpt(it,{ name:x.name, short:x.short || (a.cat==='ats'?'АВР':(a.model||'')), unit:x.unit||'шт.', price:x.price||0, catId:x.id }));
      d.close(); d.classList.remove('wide'); renderForm(); persist(); toast('Опция добавлена'); return;
    }
    const it=newItem(); fillFromCat(it,x);
    const blank = S.items.length===1 && !S.items[0].name && !S.items[0].price;
    if (blank) S.items=[it]; else S.items.push(it);
    if (STEP!=='equip'){ STEP='equip'; try{ localStorage.setItem('kp.step','equip'); }catch(e){} }
    d.close(); d.classList.remove('wide'); renderForm(); persist(); toast('Позиция добавлена');
  };
  load();
}

async function saveCatalog(i){
  const it=S.items[i]; if(!it.name.trim()) return toast('Сначала укажите наименование');
  const id = it.catId || uid()+uid();
  const doc={ id, name:it.name, spec:it.spec, price:it.price, pageTitle:it.pageTitle, photoCaption:it.photoCaption,
    features:it.features, groups:it.groups, hint:it.hint||null, photo:it.photo||null, logo:it.logo||null, updatedAt:new Date().toISOString() };
  try{ const sv=await store().put(doc); if(sv&&sv.photo) it.photo=sv.photo; if(sv&&sv.logo) it.logo=sv.logo; it.catId=id; await refreshCat(); toast(store().persistent?'Позиция сохранена в каталог':'Сохранено до закрытия страницы — выгрузите каталог в файл'); }
  catch(e){ toast('Не удалось сохранить в каталог'); }
  renderForm(); persist();
}
