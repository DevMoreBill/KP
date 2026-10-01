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

// окно каталога — features/catalog-window.js, правка позиции каталога — features/catalog-edit.js

async function saveCatalog(i){
  const it=S.items[i]; if(!it.name.trim()) return toast('Сначала укажите наименование');
  const id = it.catId || uid()+uid();
  const doc={ id, name:it.name, spec:it.spec, price:it.price, pageTitle:it.pageTitle, photoCaption:it.photoCaption,
    features:it.features, groups:it.groups, hint:it.hint||null, photo:it.photo||null, logo:it.logo||null, updatedAt:new Date().toISOString() };
  try{ const sv=await store().put(doc); if(sv&&sv.photo) it.photo=sv.photo; if(sv&&sv.logo) it.logo=sv.logo; it.catId=id; await refreshCat(); toast(store().persistent?'Позиция сохранена в каталог':'Сохранено до закрытия страницы — выгрузите каталог в файл'); }
  catch(e){ toast('Не удалось сохранить в каталог'); }
  renderForm(); persist();
}
