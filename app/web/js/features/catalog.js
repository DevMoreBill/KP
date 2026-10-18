// Каталог: хранилище на сервере, окно подбора с фильтрами, подстановка позиции в КП, пополнение каталога.
'use strict';

// поиск и список каталога — «Настройки → Значения программы → Каталог, фото, фиды, ИИ»
DefRegistry.add([['catsearch', 'Поиск и список каталога', 'cat', 'Окно каталога и строка «Быстро добавить из каталога» в разделе «Оборудование».']], [
  ['cat.page', 'catsearch', 'Строк каталога за раз', 'num', '60', {unit:'шт.', req:true, min:20, max:500,
    hint:'Сколько позиций окно каталога показывает сразу; следующие подгружаются при прокрутке вниз. Больше — меньше подгрузок, но на слабом компьютере и телефоне список открывается медленнее (150 строк уже заметно тормозили). Пример: 60.'}],
  ['cat.qDelay', 'catsearch', 'Задержка поиска в каталоге', 'num', '180', {unit:'мс', req:true, min:0, max:2000,
    hint:'Сколько программа ждёт после последней нажатой клавиши, прежде чем искать в большом каталоге (больше 2000 позиций). 1000 мс = 1 секунда. Меньше — список обновляется быстрее, но на слабом компьютере набор может «подтормаживать». В маленьком каталоге поиск идёт почти сразу (не дольше 60 мс).'}],
  ['cat.quickN', 'catsearch', 'Подсказок в «Быстро добавить из каталога»', 'num', '8', {unit:'шт.', req:true, min:3, max:30,
    hint:'Сколько найденных моделей показывать под строкой быстрого добавления в разделе «Оборудование». Enter добавляет первую.'}],
  ['cat.priceKeep', 'catsearch', 'Хранить цен из прошлых КП', 'num', '50', {unit:'шт.', req:true, min:5, max:500,
    hint:'Сколько последних цен модели (из сохранённых КП) каталог помнит у каждой позиции — для подсказки «В прошлых КП» в разделе «Цены и валюта». Более старые цены забываются при следующем сохранении КП с этой моделью.'}],
]);

const CatSrv = {
  async list(){ return await api('/api/catalog'); },
  async get(id){ return await api('/api/catalog/'+encodeURIComponent(id)); },
  async full(){ return await api('/api/catalog?full=1'); },
  // auto — сохранение КП обновляет цены и историю (без модерации); при включённой модерации ответ {pending:true}
  async put(doc, auto){ doc={...doc, photo:await ImgUpload.put(doc.photo, imgPlace(doc,'photo')), logo:await ImgUpload.put(doc.logo, imgPlace(doc,'logo')), gallery: doc.gallery ? await Promise.all(doc.gallery.map(async g=>({...g, ...(await ImgUpload.put(g, imgPlace(doc,'gallery',g)))}))) : doc.gallery,
      draw: doc.draw ? await DrawPic.upload(doc.draw, doc) : doc.draw};
    // _rev — с какой правки позиции начинали: если её успели изменить, сервер ответит «конфликт» (api спросит, перезаписать ли)
    const r=await api('/api/catalog/'+doc.id,{method:'PUT',headers:{'Content-Type':'application/json; charset=utf-8',...(auto?{'X-KP-Edit':'auto'}:{}),...(doc._rev!=null?{'X-KP-Rev':String(doc._rev)}:{})},body:JSON.stringify({...doc,_rev:undefined})});
    if (r && r.pending) doc._pending=true;
    if (r && r.rev!=null) doc._rev=r.rev;
    return doc; } };

const store = () => CatSrv;

async function fullDoc(x){ if (!x || !x._light) return x; try{ const d=await store().get(x.id); return d||x; }catch(e){ return x; } }

let catCache = [];

// поиск карточки каталога по id и по названию (CatFind): словари строятся один раз на список catCache — подсказки цены
// (история цен, РРЦ) спрашивают при каждом нажатии клавиши, перебор 7000+ карточек с norm() на каждой заметно тормозил.
// Карточки на месте не меняются (обновлённый каталог — новый массив, refreshCat), поэтому словари сверяются только со списком.
class CatFind {
  static _of = null;
  static _id = new Map();
  static _name = new Map();
  static _sync(){
    if (this._of===catCache && this._n===catCache.length) return;
    this._of=catCache; this._n=catCache.length; this._id=new Map(); this._name=new Map();
    for (const x of catCache){ if (!this._id.has(x.id)) this._id.set(x.id, x); const k=norm(x.name); if (!this._name.has(k)) this._name.set(k, x); }
  }
  /** карточка по id (как catCache.find(x=>x.id===id)) */
  static id(id){ if (id==null || id==='') return null; this._sync(); return this._id.get(id) || null; }
  /** первая карточка с тем же названием без учёта регистра, «ё» и кавычек (как catCache.find(x=>norm(x.name)===norm(name))) */
  static name(name){ this._sync(); return this._name.get(norm(name)) || null; }
}

// каталог: из IndexedDB + изменения с сервера (CatalogCache); не вышло — целиком с сервера
async function refreshCat(){ try{ catCache = await CatalogCache.load(); }catch(e){ try{ catCache = await store().list(); }catch(_){ catCache=[]; } }
  CatAttrs.mark(catCache); CatalogSearch.drop(); renderDatalist(); warmCat(); }

function warmCat(){ let k=0; const L=catCache; const step=()=>{ const end=performance.now()+12; while(k<L.length && performance.now()<end){ const x=L[k++]; if(!x._a) x._a=attrsOf(x); } if(k<L.length) (window.requestIdleCallback||setTimeout)(step); }; (window.requestIdleCallback||setTimeout)(step); }

// подсказки названий опций и услуг (поле опции позиции): опции категорий и аксессуары из каталога
function renderDatalist(){
  let o=$('#optNames'); if(!o){ o=document.createElement('datalist'); o.id='optNames'; document.body.appendChild(o); }
  const names=new Set(TYPES.flatMap(t=>(t.options||[]).map(o=>Array.isArray(o)?o[0]:o.name))); catCache.forEach(x=>{ if(typeById(detectCat(x)).role==='accessory') names.add(x.name); });   // detectCat ≡ attrsOf(x).cat, без разбора характеристик
  o.innerHTML=[...names].map(n=>`<option value="${esc(n)}">`).join(''); }

function fillFromCat(it, x){
  RecentModels.add(x);          // «Недавно добавленные модели» в едином поиске
  it.gallery = JSON.parse(JSON.stringify(x.gallery||[])).map(g=>({...g,id:g.id||uid()}));
  if (!x.hint) x={...x, hint:CoverHint.of(x)};
  if (!(x.groups||[]).length) x={...x, groups:groupsFromAttrs(x)};
  Object.assign(it,{ name:x.name||it.name, spec:x.spec||'', price:x.price||0, pageTitle:x.pageTitle||'', photoCaption:x.photoCaption||'',
    features:JSON.parse(JSON.stringify(CatFeatures.forKp(x.features))), groups:JSON.parse(JSON.stringify(x.groups||[])), hint:x.hint||null, catId:x.id, photo:x.photo||null, logo:x.logo||null,
    attrs:{...(x.attrs||{})}, options:JSON.parse(JSON.stringify(x.options||[])).map(o=>({...o,id:uid(),qty:o.unit==='усл.'?1:(+it.qty||1)})) });
  delete it._priceText; delete it._costText;
  // другое оборудование — без следов прежнего: адрес страницы, фото со страницы, черновик автозаполнения
  ['pageUrl','photoSource','photoFrom','feed','_src','_srcProps','_srcImgs','_srcUrl','_ans','_ansBase','_aiMsg','_aiStep','_sa','_saSpec','_saG','_autoNameV'].forEach(k=>delete it[k]);
  if (x.kit && Array.isArray(x.kit.parts) && x.kit.parts.length) it.kit=JSON.parse(JSON.stringify(x.kit)); else delete it.kit;     // сборка из каталога — со своим составом
  it.cost=x.cost||0; it.costCur=x.costCur||'RUB'; it.margin=x.margin; it.mmode=x.mmode; it.priceManual=false;
  const pc=x.priceCur||'RUB';
  if (it.price && pc!==kpCur()){ const r1=rateOf(pc), r2=rateOf(kpCur()); it.price = (r1>0&&r2>0) ? Math.round(it.price*r1/r2) : 0; }
  if (it.cost && !it.price) applyCalc(it);
  if (!it.logo) autoLogo(it);                        // логотип производителя из каталога, если у модели его нет            // у модели нет цены — по закупке и марже из каталога
  it.page = !!(it.photo || it.groups.length || it.features.some(f=>f.text));
  coverSync();
}

async function syncCatalog(number){
  // каталог уже в браузере (IndexedDB + изменения с сервера); не вышло — целиком с сервера
  let list=[]; try{ list = await CatalogCache.load(); }catch(e){ try{ list = await store().list(); }catch(_){} }
  // поиск позиции — по словарям (перебор 20 000 карточек на каждую строку КП занимал десятки мс), полные карточки позиций
  // КП — заранее и параллельно, а не по одной перед каждой записью
  const byId=new Map(list.map(d=>[d.id, d])), byName=new Map();
  for (const d of list){ const k=norm(d.name); if (!byName.has(k)) byName.set(k, d); }
  const find=(id, name)=>byId.get(id) || byName.get(norm(name));
  const full=new Map(), want=new Map();
  for (const it of S.items) if (it.name.trim() && it.price){ const d=find(it.catId, it.name); if (d) want.set(d.id, d); }
  await Promise.all([...want.values()].map(async d=>{ try{ full.set(d.id, await fullDoc(d)); }catch(e){ /* возьмётся ниже по одной */ } }));
  for (const it of S.items){
    if (!it.name.trim() || !it.price) continue;
    const light=find(it.catId, it.name), doc = light ? (full.get(light.id) || await fullDoc(light)) : await fullDoc(undefined);
    const base = doc ? JSON.parse(JSON.stringify(doc)) : { id: uid()+uid(), prices: [] };
    Object.assign(base, { name:it.name, spec:it.spec||base.spec||'', price:it.price, priceCur:kpCur(), cost:it.cost||base.cost||0, costCur:it.cost?(it.costCur||'RUB'):(base.costCur||'RUB'), margin:it.margin ?? base.margin, mmode:it.mmode||base.mmode, pageTitle:it.pageTitle||base.pageTitle||'',
      photoCaption:it.photoCaption||base.photoCaption||'',
      features: (it.features||[]).some(f=>f.text) ? it.features : (base.features||[]),
      groups: (it.groups||[]).some(g=>(g.rows||[]).some(r=>r.k||r.v)) ? it.groups : (base.groups||[]),
      hint: it.hint||base.hint||null, photo: it.photo||base.photo||null, logo: it.logo||base.logo||null, gallery: (it.gallery&&it.gallery.length)?it.gallery.map(({id,src,w,h,caption,slot,wide,on,at})=>({id,src,w,h,caption,slot,wide,on,at})):(base.gallery||[]), updatedAt: new Date().toISOString(),
      attrs: {...(base.attrs||{}), ...Object.fromEntries(Object.entries(it.attrs||{}).filter(([,v])=>v!==''&&v!=null))} });
    if (base.photoFrom && (!doc || JSON.stringify(base.photo||null)!==JSON.stringify(doc.photo||null))) delete base.photoFrom;
    base.prices = (base.prices||[]).filter(p => !number || p.number!==number);
    base.prices.unshift({ date:S.date, client:S.client, price:it.price, cur:kpCur(), cost:it.cost||0, costCur:it.costCur||'RUB', qty:+it.qty, number:number||'' });
    base.prices = base.prices.slice(0, Math.round(DEFN('cat.priceKeep', 50)));
    const saved = await store().put(base, true);
    it.catId = base.id;
    if (saved){ if (saved.photo) it.photo = saved.photo; if (saved.logo) it.logo = saved.logo; if (saved.gallery && it.gallery && saved.gallery.length===it.gallery.length) it.gallery=it.gallery.map((g,k)=>({...g, src:saved.gallery[k].src})); }
    for (const o of (it.options||[])){
      if (!o.name.trim() || !o.price) continue;
      const od = await fullDoc(find(o.catId, o.name));   // полная позиция, а не карточка списка
      const ob = od ? JSON.parse(JSON.stringify(od)) : { id: uid()+uid(), kind:'option', prices: [], features:[], groups:[] };   // новая — всегда опция
      Object.assign(ob,{ name:o.name, price:o.price, spec:ob.spec||'', updatedAt:new Date().toISOString(), short:o.short||ob.short||'', unit:o.unit||'шт.' });
      ob.prices=(ob.prices||[]).filter(p=>!number||p.number!==number); ob.prices.unshift({date:S.date,client:S.client,price:o.price,qty:+o.qty,number:number||''}); ob.prices=ob.prices.slice(0, Math.round(DEFN('cat.priceKeep', 50)));
      await store().put(ob, true); o.catId=ob.id; byId.set(ob.id, ob); if (!byName.has(norm(ob.name))) byName.set(norm(ob.name), ob);
    }
  }
  await refreshCat();
}

// окно каталога — features/catalog-window.js, правка позиции каталога — features/catalog-edit.js

async function saveCatalog(i){
  const it=S.items[i]; if(!it.name.trim()) return toast('Сначала укажите наименование');
  const need=CatFind.id(it.catId) ? 'catEdit' : 'catAdd'; if (!can(need)) return cannot(need);
  const id = it.catId || uid()+uid();
  // карточка каталога — целиком (категория и параметры, закупка, история цен, галерея), поверх — поля редактора позиции
  const cur = it.catId && CatFind.id(it.catId) ? await fullDoc(CatFind.id(it.catId)) : null;
  if (cur && cur._light) return toast('Карточка каталога не загрузилась — повторите, когда будет связь с сервером');
  const doc={ ...(cur ? JSON.parse(JSON.stringify(cur)) : {}), id, name:it.name, spec:it.spec, price:it.price, pageTitle:it.pageTitle, photoCaption:it.photoCaption,
    features:it.features, groups:it.groups, hint:it.hint||null, photo:it.photo||null, logo:it.logo||null, updatedAt:new Date().toISOString(),
    ...(isKit(it)?{kit:{parts:kitParts(it).map(({_costText,...p})=>p)}, cost:it.cost, costCur:'RUB', attrs:it.attrs}:{}) };
  try{ const sv=await store().put(doc); if(sv&&sv.photo) it.photo=sv.photo; if(sv&&sv.logo) it.logo=sv.logo; it.catId=id; await refreshCat(); toast(sv._pending?'Отправлено на модерацию — изменения появятся после одобрения администратором':'Позиция сохранена в каталог'); }
  catch(e){ toast('Не удалось сохранить в каталог: '+(e.message||e)); }
  renderForm(); persist();
}

// разовое сообщение после обновления каталога (app/catalog_migrate.py) и раскладки изображений по папкам (app/images.py)
function showMigrationNotice(list){
  const ms=(list||[]).filter(m=>m&&m.report&&!m.report.empty); if (!ms.length) return false;
  const key=ms.map(m=>m.id+'@'+m.at).join('|');
  try{ if (localStorage.getItem('kp.migSeen')===key) return false; }catch(e){}
  const r=(ms.find(m=>m.id==='catalog-structure-2026-10')||{}).report, im=(ms.find(m=>m.id==='images-ascii-2026-10')||{}).report;
  const bk=ms.map(m=>m.backup).filter(Boolean)[0];
  const moved=r?Object.entries(r.moved||{}):[];
  const d=$('#dlg'); d.classList.remove('wide');
  d.innerHTML=`<div class="dlg-h"><h3>Каталог обновлён</h3><button class="icon" type="button" data-close aria-label="Закрыть">✕</button></div>
   <div class="dlg-b">${r?`<p style="margin-top:0">Новые категории: дизельные и спиральные компрессоры, осушители рефрижераторные и адсорбционные, магистральные фильтры, ресиверы, запасные части и ЗИП. У каждой категории — свои параметры, фильтры и шаблон характеристик.</p>
   ${moved.length?`<p class="sub">Перенесено по категориям</p><ul class="mig">${moved.map(([k,v])=>`<li>${esc(k)} — <b>${v}</b></li>`).join('')}</ul>`:''}
   <ul class="mig"><li>Параметров заполнено из таблиц характеристик: <b>${r.attrsFilled||0}</b></li>
     <li>Фото от похожей модели того же производителя: <b>${r.photos||0}</b>${r.logos?`, логотипов: <b>${r.logos}</b>`:''}</li>
     ${r.noPhotoCount?`<li>Без фото (нет похожей модели того же производителя): <b>${r.noPhotoCount}</b> — ${esc((r.noPhoto||[]).slice(0,5).join('; '))}${r.noPhotoCount>5?'…':''}</li>`:''}</ul>`:''}
   ${im?`<p class="sub">Изображения разложены по папкам</p><ul class="mig"><li>Папка data\\img: раздел / категория / производитель латиницей (например, compressors\\screw-compressors\\dalgakiran), логотипы — logos; папок: <b>${im.folders}</b>, файлов: <b>${im.files}</b>${im.unused?`, без ссылок: <b>${im.unused}</b> (папка unused)`:''}</li></ul>`:''}
   <p class="muted">Перед обновлением сделана копия базы${bk?': '+esc(bk):''}.</p>
   <div class="row" style="justify-content:flex-end"><button class="btn" type="button" data-close>Понятно</button><button class="btn primary" type="button" data-mig="cat">Открыть каталог</button></div></div>`;
  const seen=()=>{ try{ localStorage.setItem('kp.migSeen', key); }catch(e){} };
  d.showModal(); d.querySelectorAll('[data-close]').forEach(b=>b.onclick=()=>{ seen(); d.close(); });
  d.querySelector('[data-mig]').onclick=()=>{ seen(); d.close(); openCatalog({}); };
  return true;
}
