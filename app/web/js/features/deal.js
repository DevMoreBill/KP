// Окно «Экономика сделки» — здесь вводится закупка и подбирается цена продажи. Расчёт — js/features/deal-calc.js,
// выгрузка в Excel — js/features/deal-xlsx.js. Документ КП не меняется: данные — в S.deal; цены позиций КП меняются
// только кнопкой «Перенести цены в КП». Закупка позиции хранится у позиции (cost, costCur) — её сохраняет каталог.
// Видят только автор КП и администратор (на сервере расчёт чужого КП не отдаётся и не перезаписывается — app/admin.py).
// Внешние данные: курсы ЦБ (раздел «Цены»), ключевая ставка ЦБ (/api/cbr/keyrate) — стоимость денег.
// Справочники в базе (общие для отдела): поставщики (/api/suppliers) и коды ТН ВЭД / пошлины (/api/customs).
// Будущий модуль логистики: dealSetLogistics(idПоставщика, {abroad:{v,cur}, ru:{v}, ship, note}).
'use strict';

const DL = { cal:{}, calLoading:{}, ex:false, exKp:null, exDeal:null, key:null, keyErr:'', sups:null, cus:null, saveT:{} };
const DL_DEF_KEYS = { money:'money', tax:'tax', 'target.v':'target', 'target.type':'targetType' };
const DL_KEY_SPREAD = 3;                       // стоимость денег по умолчанию: ключевая ставка ЦБ + 3 п.п. годовых

function dealDefaults(){ try{ return JSON.parse(localStorage.getItem('kp.dealDef')||'{}')||{}; }catch(e){ return {}; } }

function dealRememberDefault(path, v){ const k=DL_DEF_KEYS[path]; if (!k) return; try{ const o=dealDefaults(); o[k]=v; localStorage.setItem('kp.dealDef', JSON.stringify(o)); }catch(e){} }

// расчёт виден автору КП (кто его создал на своём устройстве) и администратору; новое несохранённое КП — своё
function dealAllowed(st=S){
  if (ADMIN.on || !st.kpId) return true;
  const me=meId(); if (!me) return false;
  return st.authorId ? st.authorId===me : st.managerId===me;
}

const dlMoneyAuto = () => DL.key && DL.key.rate>0 ? (DL.key.rate+DL_KEY_SPREAD)/12 : 2;

// ---------- коды ТН ВЭД и пошлины позиции: вручную в этом КП → по модели (база) → по категории (база) → справочно
function dlHsOf(x, d=S.deal){
  const a=attrsOf(x), cus=DL.cus||{}, ref=dealHsAuto(a.cat,a);
  const chain=[[d&&d.hs&&d.hs[x.id],'вручную'], [x.catId&&cus['item:'+x.catId],'по модели'], [cus['cat:'+a.cat],'по категории'], [ref,'справочно']];
  const get=f=>{ for (const [o,src] of chain) if (o && o[f]!=null && String(o[f]).trim()!=='') return [String(o[f]).trim(), src]; return ['', '']; };
  const [code, cs]=get('code'), [duty, ds]=get('duty');
  return {code, duty, src:ds||cs};                                  // источник — по ставке (она влияет на расчёт)
}

// производственный календарь РФ (/api/calendar, данные isdayoff.ru / xmlcalendar.ru): '1' — нерабочий день
function dlCalYears(iso){ const y=+String(iso||'').slice(0,4); return y ? [y, y+1, y+2] : []; }
function dlCalLoad(iso){ const need=dlCalYears(iso).filter(y=>!DL.cal[y] && !DL.calLoading[y]); if (!need.length) return;
  need.forEach(y=>{ DL.calLoading[y]=true;
    api('/api/calendar?year='+y).then(r=>{ if (r && r.days) DL.cal[y]=r; }).catch(()=>{}).finally(()=>{ delete DL.calLoading[y]; dealRender(); renderSide(); }); }); }
function dlCalOff(startIso, day){ if (!startIso) return false; const [y,m,d]=startIso.split('-').map(Number), t=new Date(Date.UTC(y,m-1,d+(+day||0)));
  const cy=t.getUTCFullYear(), c=DL.cal[cy]; if (!c) return false; const doy=Math.round((t-Date.UTC(cy,0,1))/864e5); return c.days[doy]==='1'; }
const dlCalReady = iso => dlCalYears(iso).every(y=>DL.cal[y]);

// рабочие дни по производственному календарю (от даты договора); без календаря — приблизительно
const dlAddWorkFn = d0 => (b,n)=>{ let x=b, c=0, g=0; while (c<n && g++<5000){ x++; if (!dlCalOff(d0,x)) c++; } return x; };
function dlCalFns(){ const d0=dlD0(); return d0 && dlCalReady(d0) ? {addWork:dlAddWorkFn(d0)} : {}; }
function dlCountWork(base, target){ if (!(target>base)) return 0; const d0=dlD0();
  if (d0 && dlCalReady(d0)){ let c=0; for (let x=base+1; x<=target; x++) if (!dlCalOff(d0,x)) c++; return c; }
  return Math.round((target-base)*5/7); }

// данные конструктора для расчёта
function dealKpInputs(st=S){
  const e=kpEconomics(st), P=st.pricing||{}, r=e.cur==='RUB'?1:dNum(P.rates&&P.rates[e.cur]);
  const d0=st.deal&&/^\d{4}-\d{2}-\d{2}$/.test(st.deal.start||'')?st.deal.start:'';
  if (d0 && !dlCalReady(d0)) dlCalLoad(d0);
  const cal = d0 && dlCalReady(d0) ? { isOff:day=>dlCalOff(d0,day), workShift:day=>{ let x=day, g=0; while (dlCalOff(d0,x) && g++<20) x++; return x; }, addWork:dlAddWorkFn(d0) } : {};
  return { ...cal, sumRub: r>0 ? e.sum/100*r : 0, sumNoRate: !(r>0), cur:e.cur, vat:+st.vat||0, rates:{...(P.rates||{})}, costNoVat:!!P.costNoVat, moneyAuto:dlMoneyAuto(),
    items:(st.items||[]).filter(x=>String(x.name||'').trim()||x.cost).map(x=>{ const h=dlHsOf(x, st.deal);
      return {id:x.id, name:x.name, qty:+x.qty||0, cost:(x.cost||0)/100, cur:x.costCur||'RUB', cat:attrsOf(x).cat, maker:attrsOf(x).maker||'', catId:x.catId||'',
        code:h.code, duty:dNum(h.duty), hsSrc:h.src}; }) };
}

// ---------- справочники
async function dlLoadDirs(){
  const jobs=[];
  if (!DL.sups) jobs.push(api('/api/suppliers').then(r=>{ DL.sups=Array.isArray(r)?r:[]; }).catch(()=>{ DL.sups=[]; }));
  if (!DL.cus) jobs.push(api('/api/customs').then(r=>{ DL.cus=r||{}; }).catch(()=>{ DL.cus={}; }));
  if (!DL.key && !DL.keyErr) api('/api/cbr/keyrate').then(r=>{ if (r && r.rate>0) DL.key=r; else DL.keyErr=(r&&r.error)||'нет данных'; dealRender(); }).catch(e=>{ DL.keyErr=e.message||'нет связи'; });
  await Promise.race([Promise.all(jobs), new Promise(r=>setTimeout(r,2500))]);
}

const dlNorm = s => String(s||'').trim().toLowerCase();

function dlDir(name){ const n=dlNorm(name); if (!n || !DL.sups) return null;
  return DL.sups.find(x=>dlNorm(x.name)===n) || DL.sups.find(x=>(x.makers||[]).some(m=>dlNorm(m)===n)) || null; }

const DL_SUP_KEYS=['country','cur','vatIn','noVat','adv','pay','prod','ship','prodK','shipK','cusMode','ivat','ins','fx'];

// подставить условия поставщика из справочника (название, страна, валюта, аванс, сроки, таможня, комиссии)
function dlApplyDir(s, p){ if (!p) return false;
  for (const k of DL_SUP_KEYS) if (p[k]!=null && p[k]!=='') s[k]=typeof p[k]==='object' ? JSON.parse(JSON.stringify(p[k])) : p[k];
  s.name=p.name; s.dirId=p.id; const lc=p.cur||p.logCur; if (lc && lc!=='RUB') s.log.cur=lc; if (s.cusMode==='sum' && (p.cusCur||p.cur)) s.cus.cur=p.cusCur||p.cur;
  s._dir=dlNorm(p.name); return true; }

// страна → таможенный режим, НДС, валюта
function dlApplyCountry(s){ const p=dealCountryPreset(s.country); if (!p) return;
  s.cusMode=p.cusMode; s.vatIn=p.vatIn; s.cur=p.cur; if (p.cur!=='RUB'){ s.log.cur=p.cur; } }

// сохранить поставщика в справочник (по названию; общий для отдела)
function dlSaveSupplier(s){
  if (DL.ex || !String(s.name||'').trim()) return;
  clearTimeout(DL.saveT[s.id]);
  DL.saveT[s.id]=setTimeout(async()=>{ const id=s.dirId || ('sup_'+uid()+uid()).slice(0,24);
    const kp=dealKpInputs(), makers=[...new Set(kp.items.filter(x=>dlSupOf(x.id)===s.id).map(x=>x.maker).filter(Boolean))];
    const doc={ name:s.name.trim(), ...Object.fromEntries(DL_SUP_KEYS.map(k=>[k,s[k]??''])), makers };
    try{ const saved=await api('/api/suppliers/'+id,{method:'PUT',headers:{'Content-Type':'application/json; charset=utf-8'},body:JSON.stringify(doc)});
      s.dirId=id; DL.sups=(DL.sups||[]).filter(x=>x.id!==id).concat(saved); persist(); }catch(e){} }, 1200);
}

function dlSupOf(itemId){ const d=S.deal; if (!d) return ''; const s=d.map&&d.map[itemId]; return d.sup.some(x=>x.id===s) ? s : d.sup[0].id; }

// новый расчёт: поставщики — по производителям позиций (из справочника, если есть), страна задаёт таможню и валюту
function dealEnsure(){
  if (S.deal && S.deal.v){ dealUpgrade(S.deal); if (!S.deal.hs) S.deal.hs={}; return S.deal; }
  const def=dealDefaults(), d=dealBlank(def); d.hs={}; if (def.target) d.target={type:def.targetType||'margin', v:def.target};
  const its=(S.items||[]).filter(x=>String(x.name||'').trim());
  const makers=[...new Set(its.map(x=>attrsOf(x).maker||''))];
  d.sup=[]; d.map={};
  makers.forEach((mk,k)=>{ const s=dealNewSupplier('s'+(k+1), def); s.name=mk;
    const p=dlDir(mk); if (p) dlApplyDir(s,p);
    else { const cur=its.find(x=>(attrsOf(x).maker||'')===mk && x.cost)?.costCur; if (cur && cur!=='RUB'){ s.country=''; s.cusMode='calc'; s.log.cur=cur; s.cur=cur; }
      else if (cur==='RUB'){ s.country='Россия'; dlApplyCountry(s); } }
    d.sup.push(s); its.filter(x=>(attrsOf(x).maker||'')===mk).forEach(x=>{ d.map[x.id]=s.id; }); });
  if (!d.sup.length) d.sup=[dealNewSupplier('s1', def)];
  S.deal=d; return d;
}

const dlKp = () => DL.ex ? DL.exKp : dealKpInputs();
const dlDeal = () => DL.ex ? DL.exDeal : dealEnsure();

function dlGet(d, path){ return path.split('.').reduce((o,k)=>o==null?o:o[k], d); }

function dlSet(d, path, v){ const ks=path.split('.'), last=ks.pop(); let o=d; for (const k of ks){ if (o[k]==null) o[k]={}; o=o[k]; } o[last]=v; }

const dlRub = n => n==null||!Number.isFinite(n) ? '—' : n.toLocaleString('ru-RU',{minimumFractionDigits:2, maximumFractionDigits:2})+' ₽';

const dlRub0 = n => n==null||!Number.isFinite(n) ? '—' : Math.round(n).toLocaleString('ru-RU')+' ₽';

const dlPct = n => n==null||!Number.isFinite(n) ? '—' : n.toLocaleString('ru-RU',{minimumFractionDigits:2, maximumFractionDigits:2})+' %';

const dlIn = n => n==null||!Number.isFinite(n) ? '' : String(Math.round(n*100)/100).replace('.',',');

// даты графика: день 0 — дата отсчёта (подписание договора), её вводят вручную; день ↔ дата пересчитываются
const dlD0 = () => { const v=String((dlDeal()||{}).start||''); return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : ''; };
function dlDayIso(day){ const s=dlD0(); if (!s) return ''; const [y,m,d]=s.split('-').map(Number); const t=new Date(Date.UTC(y,m-1,d+(+day||0))); return t.toISOString().slice(0,10); }
const dlIsoRu = iso => iso ? iso.split('-').reverse().join('.') : '';
const dlDayRu = day => dlIsoRu(dlDayIso(day));
function dlIsoDay(iso){ const s=dlD0(); if (!s||!iso) return null; return Math.round((Date.parse(iso+'T00:00:00Z')-Date.parse(s+'T00:00:00Z'))/864e5); }


// ---------- подбор цен позиций под цену КП: распределение по закупке (одинаковая наценка), иначе по текущим ценам
function dlPlan(Srub){
  const cur=kpCur(), r=rateOf(cur); if (!(r>0)) return null;
  const its=S.items.filter(x=>String(x.name||'').trim()); if (!its.length) return null;
  const target=Math.round(Srub/r*100);
  const rub=x=>x.cost>0 && rateOf(x.costCur||'RUB')>0 ? x.cost*rateOf(x.costCur||'RUB')*(+x.qty||0) : 0;
  let w=its.map(rub), basis='пропорционально закупке — у всех позиций одна наценка';
  if (w.some(v=>!(v>0))){ w=its.map(x=>(x.price||0)*(+x.qty||0)); basis='пропорционально текущим ценам'; }
  if (w.some(v=>!(v>0))){ w=its.map(x=>+x.qty||1); basis='поровну на единицу'; }
  const W=w.reduce((a,b)=>a+b,0), vat=+S.vat||0;
  const tot=pr=>totals(S.items.map(x=>{ const k=its.indexOf(x); return {qty:+x.qty||0, price:k>=0?pr[k]:(x.price||0), disc:x.disc, options:(x.options||[]).filter(o=>o.name).map(o=>({qty:+o.qty||0, price:o.price||0}))}; }), vat).sum;
  const prices=X=>its.map((x,k)=>Math.max(0, roundTo(w[k]/W*X/(+x.qty||1))));
  const t1=tot(prices(target)), t2=tot(prices(target*1.1));
  const X = t2!==t1 ? target+(target-t1)*(target*0.1)/(t2-t1) : target;
  const p=prices(X);
  return { its, prices:p, total:tot(p), target, basis, cur };
}

async function dealApplyPrice(Srub){
  const pl=dlPlan(Srub); if (!pl){ toast(rateOf(kpCur())>0?'В КП нет позиций':'Нет курса валюты КП — укажите его в разделе «Цены»'); return; }
  const ok=await stConfirm('Перенести цены в КП?', `Итог КП с НДС: ${money(totalsS().sum)} → ${money(pl.total)} ${curSh(pl.cur)}. Цена распределена по позициям ${pl.basis}; опции и скидки не меняются.`, 'Перенести цены');
  if (!ok) return;
  pl.its.forEach((x,k)=>{ x.price=pl.prices[k]; x.priceManual=true; delete x._priceText; });
  const d=dealEnsure(); d.over.price=''; d.touched=true;
  renderForm(); persist(); dealRender();
  toast(`Цены позиций перенесены: итог КП ${money(pl.total)} ${curSh(pl.cur)}`);
}

// модуль расчёта логистики (будущий) заполняет логистику поставщика
function dealSetLogistics(supId, o={}){
  const d=dealEnsure(), s=d.sup.find(x=>x.id===supId)||d.sup[0];
  if (o.abroad) s.log={v:String(o.abroad.v??''), cur:o.abroad.cur||'RUB', src:'module'};
  if (o.ru) s.logRu={v:String(o.ru.v??''), src:'module'};
  if (o.ship!=null) s.ship=String(o.ship);
  if (o.note) s.logNote=String(o.note);
  d.touched=true; persist(); dealRender(); renderSide();
}

async function openDeal(){
  if (!dealAllowed()){ toast('Экономика сделки доступна автору КП и администратору'); return; }
  DL.ex=false; DL.open=undefined;
  let d=$('#dealdlg'); if (!d){ d=document.createElement('dialog'); d.id='dealdlg'; d.className='dealwin'; d.setAttribute('aria-label','Экономика сделки'); document.body.appendChild(d); dealBind(d); }
  // окно открывается сразу, содержимое — после загрузки справочников (повторное открытие тоже рисуется заново)
  if (!d.open){ d.innerHTML='<div class="dlg-h"><h3>Экономика сделки</h3><button class="icon" type="button" data-dlx="close" aria-label="Закрыть">✕</button></div><p class="empty">Загружаю…</p>'; d.showModal(); }
  await dlLoadDirs(); dealEnsure();
  d.innerHTML=''; dealRender(true);
}

// ---------- элементы формы
function dlQ(text){ return `<details class="dl-q"><summary aria-label="Пояснение">?</summary><div>${text}</div></details>`; }

function dlField(label, path, o={}){
  const d=dlDeal(), c=o.calc, raw=dlGet(d,path), e=c&&c.err[path];
  let val=raw??'', badge='';
  if (o.kp!==undefined){ const own=raw!=null&&raw!==''; val= own?raw:dlIn(o.kp);
    badge = own ? `<button type="button" class="dl-badge own" data-dlx="reset" data-path="${path}" title="Вернуть значение из КП">изменено · ↺</button>`
      : `<span class="dl-badge kp">${DL.ex?'пример':esc(o.kpLabel||'из КП')}</span>`; }
  if (o.auto!==undefined){ const own=raw!=null&&raw!=='';
    if (!own){ val=dlIn(o.auto); badge=`<span class="dl-badge kp" title="${esc(o.autoTitle||'')}">${esc(o.autoLabel||'авто')}</span>`; }
    else badge=`<button type="button" class="dl-badge own" data-dlx="reset" data-path="${path}" title="Вернуть расчёт">вручную · ↺</button>`; }
  if (o.unknown && (raw==null||raw==='')) badge=`<span class="dl-badge warn">неизвестно</span>`;
  if (o.src==='module') badge=`<span class="dl-badge kp">из расчёта логистики</span>`;
  const cur = o.cur ? `<select data-dl="${o.cur}" aria-label="Валюта">${DEAL_CURS.map(k=>`<option${(dlGet(d,o.cur)||'RUB')===k?' selected':''}>${k}</option>`).join('')}</select>` : '';
  const inp = o.select ? `<select data-dl="${path}" aria-label="${esc(label)}">${o.select.map(([v,t])=>`<option value="${esc(v)}"${String(raw??o.select[0][0])===String(v)?' selected':''}>${esc(t)}</option>`).join('')}</select>`
    : `<input type="text" inputmode="${o.text?'text':o.int?'numeric':'decimal'}" data-dl="${path}" value="${esc(val)}" placeholder="${esc(o.ph??'0')}" autocomplete="off"${o.list?` list="${o.list}"`:''}${e?' aria-invalid="true"':''}${o.text?' class="tx"':''}>`;
  const dd = o.date ? dlDateIn(path, o.date.base, o.date.val, label, o.date.kind===false?'':dlGet(d, path+'K')) : '';
  return `<label class="f dl-f${e?' bad':''}${o.cls?' '+o.cls:''}${dd?' dd':''}"><span>${esc(label)}${o.unit?` <i>${esc(o.unit)}</i>`:''}${badge}${o.q?dlQ(o.q):''}</span>
    ${dd?`<span class="dl-ddr"><span class="dl-in">${inp}${o.date.kind===false?'<i>дн.</i>':dlDayKind(path)}</span>${dd}</span>`:`<span class="dl-in${cur?' cur':''}">${inp}${cur}</span>`}
    ${e?`<small class="dl-err">${esc(e)}</small>`:o.hint?`<small class="muted">${o.hint}</small>`:''}</label>`;
}

// выбор даты вместо количества дней: base — день события, от которого считаются дни; хранится по-прежнему в днях
function dlDateIn(path, base, val, label, kind){
  const iso = dlD0() && Number.isFinite(+val) ? dlDayIso(dealAddDays(dlCalFns(), +base||0, +val||0, kind)) : '';
  return `<span class="dl-ddt"><em>или дата</em><input type="date" data-dldd="${esc(path)}" data-base="${+base||0}" data-kind="${kind==='work'?'work':''}" value="${iso}" aria-label="${esc(label)}: дата"${DL.ex?' disabled':''}></span>`;
}
// микро-меню «календарные / рабочие дни» у срока; путь вида — путь срока + «K»
function dlDayKind(path){ const k=dlGet(dlDeal(), path+'K')==='work';
  return `<select class="dl-dk" data-dl="${esc(path)}K" aria-label="Календарные или рабочие дни" title="Календарные или рабочие дни"${DL.ex?' disabled':''}><option value="">кал. дн.</option><option value="work"${k?' selected':''}>раб. дн.</option></select>`; }

// поле с выпадающим списком: ввод с подсказками по первым буквам или выбор из списка (кнопка «▾», стрелки, Enter)
function dlComboItems(path){
  if (/\.name$/.test(path)){
    const sups=(DL.sups||[]).map(x=>({v:x.name, tag:'из справочника', sub:[x.country, x.adv!=null&&x.adv!==''?`аванс ${x.adv} %`:'', (+x.prod||0)+(+x.ship||0)?`срок ${(+x.prod||0)+(+x.ship||0)} дн.`:''].filter(Boolean).join(' · ')}));
    const have=new Set(sups.map(x=>dlNorm(x.v)));
    const mk=[...new Set(dlKp().items.map(x=>x.maker).filter(Boolean))].filter(m=>!have.has(dlNorm(m)));
    return [...sups, ...mk.map(m=>({v:m, tag:'производитель', sub:'из номенклатуры — будет новым поставщиком'}))]; }
  return DEAL_COUNTRIES.filter(([n])=>!/^росс/i.test(n)).map(([n,cur])=>{ const p=dealCountryPreset(n)||{};
    return {v:n, sub:p.cusMode==='none'?'без таможни · цены с НДС':p.cusMode==='eaeu'?`ЕАЭС · без пошлины · ${cur}`:`импорт · таможня по ТН ВЭД · ${cur}`}; });
}

function dlCombo(label, path, o={}){
  const d=dlDeal(), val=dlGet(d,path)??'', open=DL.combo===path, q=dlNorm(val);
  let items=open?dlComboItems(path):[];
  if (open && q && !DL.comboAll) items=items.filter(x=>dlNorm(x.v).includes(q)||dlNorm(x.sub).includes(q));
  if (open){ DL.comboList=items.map(x=>x.v); if (DL.comboIx>=items.length) DL.comboIx=items.length-1; }
  const id='cb-'+path.replace(/\./g,'-');
  return `<div class="f dl-f dl-combo${open?' open':''}${o.cls?' '+o.cls:''}"><span><label for="${id}">${esc(label)}</label>${o.q?dlQ(o.q):''}</span>
    <span class="dl-cb"><input id="${id}" type="text" class="tx" data-dl="${path}" data-combo="${path}" value="${esc(val)}" placeholder="${esc(o.ph||'')}" autocomplete="off" role="combobox" aria-autocomplete="list" aria-expanded="${open}">
      <button type="button" class="dl-cbb" data-dlx="combo" data-path="${path}" tabindex="-1" aria-label="Показать список">▾</button></span>
    ${open?`<ul class="dl-cbl" role="listbox">${items.length?items.map((x,i)=>`<li role="option"${i===DL.comboIx?' aria-selected="true"':''}><button type="button" data-dlx="pick" data-path="${path}" data-v="${esc(x.v)}" tabindex="-1"><b>${esc(x.v)}</b>${x.tag?`<em>${esc(x.tag)}</em>`:''}${x.sub?`<small>${esc(x.sub)}</small>`:''}</button></li>`).join('')
      :`<li class="none">Нет в списке${val?` — «${esc(val)}» сохранится как ${/\.name$/.test(path)?'новый поставщик':'страна'}`:''}</li>`}</ul>`:''}
  </div>`;
}

// изменены название или страна поставщика: подстановка из справочника, таможня и валюта по стране
function dlSupChanged(p){ const d=dlDeal(), m=/^sup\.(\d+)\.(name|country)$/.exec(p); if (!m || DL.ex) return; const s=d.sup[+m[1]];
  if (m[2]==='name' && dlNorm(s.name)!==s._dir){ const dir=dlDir(s.name); if (dir && dlApplyDir(s, dir)) toast('Поставщик из справочника: условия подставлены'); }
  if (m[2]==='country') dlApplyCountry(s); }

function dlComboPick(path, v){ const d=dlDeal(); dlSet(d, path, v); dlSupChanged(path); DL.combo=null; DL.comboIx=-1;
  const m=/^sup\.(\d+)\./.exec(path); if (m && !DL.ex) dlSaveSupplier(d.sup[+m[1]]); if (!DL.ex){ S.deal.touched=true; persist(); renderSide(); } dealRender(); }

// раскрывающийся блок «Ещё…»: открыт, если пользователь его открыл (DL.more), иначе — по умолчанию (def)
const dlMore = (key, def) => ((DL.more && key in DL.more) ? DL.more[key] : def) ? ' open' : '';

const dlFilled = (...v) => v.some(x=>x!=null && String(x).trim()!=='' && String(x).trim()!=='0');

// шаг — карточка-аккордеон; tot: [подпись, сумма, пояснение] — итог шага; id — шаг в DL.nav (номер, следующий шаг)
// свёрнутый шаг — одна строка: что заполнено (DL.si[id].sum) и отметка «заполнено / нужно заполнить / необязательно»
function dlStep(n, title, sub, body, cls='', tot=null, id=''){
  const nav=(DL.nav||{})[id], num=nav?nav.n:n;
  if (id && DL.open!==id && !DL.all) return '';   // DL.all — все шаги сразу (для проверок)
  const head=`<span class="dl-n">${num}</span><div><h4>${title}</h4>${sub?`<p>${sub}</p>`:''}</div>`;
  const go=nav ? `<div class="dl-next">${nav.prev?`<button type="button" class="btn" data-dlx="step" data-id="${nav.prev}">← ${esc(nav.prevT)}</button>`:'<span></span>'}${nav.next?`<button type="button" class="btn primary" data-dlx="step" data-id="${nav.next}">Далее: ${esc(nav.nextT)} →</button>`:''}</div>` : '';
  return `<section class="dl-step ${cls}"${id?` data-stepid="${id}" role="tabpanel"`:''}><div class="dl-sh">${head}</div>${body}${tot?dlTot(...tot):''}</section>${go}`;
}

// состояние и краткий итог каждого шага — для свёрнутых карточек и выбора шага, который открыть первым
function dlStepInfo(c){
  const d=dlDeal(), b=c.base||c.lo, si={}, d0=dlD0();
  const when=day=>d0?dlDayRu(day):`день ${day}`;
  const its=DL.ex?[]:(S.items||[]).filter(x=>String(x.name||'').trim()), noCost=its.filter(x=>!(x.cost>0)).length;
  si.buy={ st: noCost||d.sup.some(x=>!String(x.name||'').trim())?'need':'ok',
    sum: noCost ? `Нет цены закупки у ${noCost} из ${its.length} поз.` : c.sup.filter(x=>x.equip>0||c.sup.length===1).map(x=>`${x.name}${x.country?' ('+x.country+')':''}: ${dlRub0(x.equip)}, готово — ${when(x.rdy)}, у заказчика — ${when(x.arr)}`).join(' · ') };
  const noDuty=c.sup.some(x=>x.noDuty.length);
  si.cus={ st: noDuty||c.unknown.length?'need':'ok',
    sum: noDuty ? 'Укажите ставку пошлины у позиций' : c.unknown.length ? 'Укажите ввозной НДС к вычету' : c.Tsum ? `Платим на таможне ${dlRub0(c.Tsum)}, в себестоимость ${dlRub0(c.sup.reduce((a,x)=>a+x.T-(x.vi||0),0))}` : 'Таможни нет' };
  const inn=c.rows.filter(r=>r.inflow&&r.amount>0);
  si.cust={ st:'ok', sum: inn.map(r=>{ const t=c.trs[r.stage]; return `${(t&&t.name)||dlPctTxt(r.pct||0)}${t&&t.name?' '+dlPctTxt(r.pct||0):''} — ${when(r.day)}`; }).join(' · ') || 'Оплата заказчика' };
  const mnt=[c.M?`монтаж ${dlRub0(c.M)}`:'', c.E?`прочие ${dlRub0(c.E)}`:'', c.W+c.Bn?`резерв и бонусы ${dlRub0(c.W+c.Bn)}`:'', c.BG?`банковская гарантия ${dlRub0(c.BG)}`:'', b.K?`наличные ${dlRub0(b.K)}`:''].filter(Boolean);
  si.mnt={ st: mnt.length?'ok':'opt', sum: mnt.length ? mnt.join(' · ') : 'Монтаж, ПНР, банковская гарантия, наличные — если есть' };
  si.price={ st: c.S>0?'ok':'need', sum: c.S>0 ? `${dlRub0(c.S)} с НДС ${dlIn(c.v)} %` : 'Нет цены для заказчика' };
  si.money={ st:'opt', sum:`Деньги ${dlIn(c.i)} % в месяц · налог на прибыль ${dlIn(c.taxP)} %` };
  const peak=c.rows.reduce((m,r)=>Math.min(m,r.balance),0);
  si.sched={ st:'info', sum:`${c.Tend} ${plural(c.Tend,'день','дня','дней')} до последней оплаты · финансирование ${dlRub0(c.F)}${peak<0?` · пик вложений ${dlRub0(-peak)}`:''}` };
  return si;
}

const dlTot=(lab, v, note)=>`<div class="dl-stot"><span>${note?`<small>${note}</small>`:''}</span><div><small>${esc(lab)}</small><b>${dlRub0(v)}</b></div></div>`;

// ---------- шаг 1: закупка
function dlPurchase(c){
  const d=dlDeal(), multi=d.sup.length>1, ex=DL.ex;
  d.sup.forEach(s=>{ if (!Array.isArray(s.pay)||!s.pay.length) s.pay=JSON.parse(JSON.stringify(dealSupPay(s))); });
  const cards=d.sup.map((s,k)=>{ const cs=c.sup[k], P=`sup.${k}`, ru=/^росс/i.test(s.country||''), eaeu=s.cusMode==='eaeu';
    const known=dlDir(s.name), isNew=String(s.name||'').trim() && !known;
    const where = s.where==='ru'||s.where==='imp' ? s.where : ru ? 'ru' : s.country ? 'imp' : '';
    const items = ex ? '' : (()=>{ const its=S.items.filter(x=>String(x.name||'').trim() && dlSupOf(x.id)===s.id);
      if (!its.length) return `<p class="muted dl-noitems">${multi?'Позиций нет — у позиции выберите этого поставщика в другой карточке.':'В КП нет позиций.'}</p>`;
      return `<table class="dl-it"><thead><tr><th>Позиция</th><th class="num">Кол-во</th><th>Цена закупки за ед.</th><th class="num">Сумма, ₽</th>${multi?'<th>Поставщик</th>':''}</tr></thead><tbody>
        ${its.map(x=>{ const i=S.items.indexOf(x), r=rateOf(x.costCur||'RUB'), sum=x.cost?x.cost/100*(+x.qty||0)*(r||0)*(cs.noVat?1+c.v/100:1):0;
          return `<tr${x.cost?'':' class="need"'}><td class="c-nm"><b>${esc(x.name)}</b>${attrsOf(x).maker?`<small>${esc(attrsOf(x).maker)}</small>`:''}</td><td class="num">${esc(x.qty)}</td>
            <td class="c-cost"><span class="dl-in cur"><input type="text" inputmode="decimal" data-cost-i="${i}" value="${esc(x._costText ?? (x.cost?dlIn(x.cost/100):''))}" placeholder="цена из счёта" aria-label="Цена закупки за единицу"${x.cost?'':' class="need"'}><select data-costcur-i="${i}" aria-label="Валюта закупки">${DEAL_CURS.map(k=>`<option${(x.costCur||'RUB')===k?' selected':''}>${k}</option>`).join('')}</select></span></td>
            <td class="num c-sum">${x.cost?dlRub0(sum):'—'}</td>
            ${multi?`<td><select data-dlmap="${esc(x.id)}" aria-label="Поставщик позиции">${d.sup.map((z,j)=>`<option value="${esc(z.id)}"${z.id===s.id?' selected':''}>${esc(c.sup[j].name)}</option>`).join('')}</select></td>`:''}</tr>`; }).join('')}
        </tbody></table>`; })();
    const moreSum = [cs.equip&&dNum(s.extra&&s.extra.v)?`прочая закупка ${dlIn(dNum(s.extra.v))} ${(s.extra&&s.extra.cur)||'RUB'}`:'', dNum(s.ins)?`страхование ${dlIn(dNum(s.ins))} %`:'', dNum(s.fx)?`комиссия ${dlIn(dNum(s.fx))} %`:'', cs.brk?`брокер ${dlRub0(cs.brk)}`:''].filter(Boolean).map(esc).join(', ');
    return `<div class="dl-card dl-sup">
      <div class="dl-suph">
        ${dlCombo('Поставщик', P+'.name', {ph:'Начните вводить или выберите из списка ▾', q:'Производитель, дистрибьютор или импортёр. Список — поставщики из справочника и производители позиций КП; можно вписать любого.'})}
        <div class="f dl-f dl-where"><span>Где покупаем${dlQ('В России — поставщик сам ввёз оборудование и продаёт его здесь (цены с НДС, таможни нет). Ввозим сами — покупаем за границей и сами растаможиваем: укажите, откуда везём.')}</span>
          <span class="dl-seg"><button type="button" class="${where==='ru'?'on':''}" data-dlx="where" data-k="${k}" data-v="ru">В России</button><button type="button" class="${where==='imp'?'on':''}" data-dlx="where" data-k="${k}" data-v="imp">Ввозим сами</button></span></div>
        ${where==='imp'?dlCombo('Откуда везём', P+'.country', {ph:'Страна отгрузки, например Китай', q:'Страна, откуда везём оборудование: Беларусь, Казахстан и др. ЕАЭС — без пошлины; остальные — пошлина по коду ТН ВЭД.'}):''}
        ${multi?`<button type="button" class="icon dl-del" data-dlx="delsup" data-k="${k}" aria-label="Убрать поставщика" title="Убрать поставщика: его позиции перейдут к первому">✕</button>`:''}</div>
      <p class="dl-dirn">${known&&!ex?`<span class="ok-t">✓ Из справочника</span> — условия подставлены, изменения сохраняются в справочник.`:isNew&&!ex?'Новый поставщик — сохранится в справочник, в следующий раз выберите его из списка.':'Введите первые буквы или нажмите «▾» — список поставщиков из справочника и производителей позиций.'}
        ${where==='ru'?' · покупаем в России: таможни нет, НДС поставщика — к вычету':where==='imp'&&s.country?` · ${eaeu?'из ЕАЭС: без пошлины, НДС при ввозе — к вычету':'ввозим сами: таможня — на вкладке «Таможня»'}`:where==='imp'?' · укажите, откуда везём':' · выберите, где покупаем'}</p>
      ${items}
      ${ru?`<div class="dl-inl"><span class="dl-lab">Цены в счёте</span><span class="dl-seg"><button type="button" class="${!cs.noVat?'on':''}" data-dlx="novat" data-k="${k}" data-v="0">с НДС</button><button type="button" class="${cs.noVat?'on':''}" data-dlx="novat" data-k="${k}" data-v="1">без НДС</button></span>${dlQ('НДС поставщика уменьшает НДС к уплате (вычет). Если в счёте цены без НДС, программа добавит НДС к платежу и учтёт его в вычете.')}</div>`:''}
      <div class="dl-sub"><h5>Сроки поставки</h5>
        <div class="dl-g">${dlField('Готово к отгрузке через', P+'.prod', {calc:c, int:true, date:{base:0, val:cs.prod}, q:'Сколько дней от заказа (подписания договора) до готовности оборудования на складе поставщика. Можно выбрать дату — дни посчитаются сами.'})}${dlField('Доставка до заказчика', P+'.ship', {calc:c, int:true, date:{base:cs.rdy, val:cs.ship}, q:'Сколько дней едет груз от склада поставщика до объекта заказчика, включая таможню. Дата — когда груз будет у заказчика.'})}</div>
        <p class="dl-tl"><span>Заказ — <b>день 0</b>${dlD0()?` · ${dlDayRu(0)}`:''}</span><i>→</i><span>Готово к отгрузке — <b>день ${cs.rdy}</b>${dlD0()?` · ${dlDayRu(cs.rdy)}`:''}</span><i>→</i><span>У заказчика — <b>день ${cs.arr}</b>${dlD0()?` · ${dlDayRu(cs.arr)}`:''}</span></p></div>
      <div class="dl-sub"><h5>Оплата поставщику ${dlQ('Доли от стоимости оборудования (с комиссией за перевод). Последний этап — остаток до 100 %. Перевозка, страхование, таможня и брокер оплачиваются перед отгрузкой.')}</h5>${dlSupPay(c, k)}</div>
      <div class="dl-sub"><h5>Стоимость перевозки</h5>
        <div class="dl-g">${ru?'':dlField('Перевозка до границы РФ', P+'.log.v', {calc:c, cur:P+'.log.cur', src:s.log&&s.log.src, q:'Сколько стоит довезти груз от поставщика до границы ЕАЭС. Входит в таможенную стоимость.'})}
        ${dlField(ru?'Доставка до объекта':'Доставка по России', P+'.logRu.v', {calc:c, unit:'₽', src:s.logRu&&s.logRu.src, q:'Сколько стоит довезти груз по России '+(ru?'от склада поставщика':'от границы')+' до объекта заказчика. Платится при поставке; НДС перевозчика — к вычету.'})}</div></div>
      <details class="dl-more" data-more="sup${k}"${dlMore('sup'+k, false)}><summary>Ещё расходы по поставщику <span class="muted">— ${moreSum||'опции, страхование, комиссия за перевод, брокер'}</span></summary>
        <div class="dl-g">${dlField('Прочая закупка у поставщика', P+'.extra.v', {calc:c, cur:P+'.extra.cur', q:'Опции, ЗИП и всё, чего нет в позициях КП.'})}
          ${ru?'':dlField('Страхование груза', P+'.ins', {calc:c, unit:'% от оборудования', ph:'0,3'})}
          ${ru?'':dlField('Комиссия банка или агента', P+'.fx', {calc:c, unit:'%', ph:'1,5', q:'Комиссия за перевод и конвертацию — процент от платежей поставщику в валюте.'})}
          ${dlField('Брокер, СВХ, сертификация', P+'.brk.v', {calc:c, unit:'₽'})}
          ${cs.Lru+cs.brk>0?dlField('НДС к вычету по услугам в России', P+'.voRu', {calc:c, unit:'₽', auto:cs.ruSuggest, autoLabel:`авто ${c.v}/${100+c.v}`, q:'НДС в счетах перевозчика и брокера. Если они без НДС — впишите 0.'}):''}
          ${s.vatIn?dlField('НДС поставщика к вычету', P+'.vo', {calc:c, unit:'₽', auto:cs.suggest, autoLabel:`авто ${c.v}/${100+c.v}`, q:'НДС в стоимости оборудования — сверьте со счётом-фактурой.'}):''}</div></details>
      <div class="dl-supf"><span>Закупка у поставщика</span><b>${dlRub(cs.equip)}</b></div>
    </div>`; }).join('');
  return dlStep(1, 'Закупка', 'Что и у кого покупаем. Цена — как в счёте поставщика, в его валюте.',
    `${cards}${ex?'':`<button type="button" class="btn dl-add" data-dlx="addsup">+ Ещё поставщик</button>`}`, '', ['Итого закупка и доставка', c.sup.reduce((a,x)=>a+x.cash-x.T,0), 'оборудование, перевозка, страхование, комиссии, брокер — без таможни'], 'buy');
}

// этапы оплаты поставщику: название, доля, событие + дней; итог — сумма и день (дата)
const DL_SP_PRESETS = {
  ready100: ['100 % перед отгрузкой', [{name:'Оплата', ev:'ready', off:'0'}]],
  a30:      ['Аванс 30 % + остаток', [{name:'Аванс', pct:'30', ev:'order', off:'0'}, {name:'Остаток', ev:'ready', off:'0'}]],
  a305020:  ['30 % / 50 % / остаток после ПНР', [{name:'Аванс', pct:'30', ev:'order', off:'0'}, {name:'Перед отгрузкой', pct:'50', ev:'ready', off:'0'}, {name:'После шефмонтажа и ПНР', ev:'pnr', off:'0'}]],
  pre100:   ['100 % при заказе', [{name:'Предоплата', ev:'order', off:'0'}]],
};
function dlSupPay(c, k){
  const d=dlDeal(), s=d.sup[k], cs=c.sup[k], P=`sup.${k}`, n=s.pay.length, base=cs.equip+cs.fxE;
  const spBase={order:0, ready:cs.rdy, delivery:cs.arr, pnr:c.pnrEnd};
  const rows=s.pay.map((t,j)=>{ const st=cs.stages[j]||{p:0}, last=j===n-1, row=c.rows.find(r=>r.key===`sp:${s.id}:${j}`), e=c.err[`${P}.pay.${j}.pct`]||c.err[`${P}.pay.${j}.off`];
    const day=row?row.day:null;
    return `<div class="dl-tr${e?' bad':''}${last?' last':''}" data-dnd="sp:${k}" data-i="${j}">${dlMoveCtl(`sp:${k}`, j, n)}<span class="dl-trn">${j+1}</span>
      <input type="text" class="tx dl-trname" data-dl="${P}.pay.${j}.name" value="${esc(t.name||'')}" placeholder="${j===0&&!last?'Аванс':last&&n>1?'Остаток':'Оплата'}" aria-label="Название этапа">
      ${last?`<span class="dl-trp">${n>1?'остаток':'всё'}<b>${dlIn(st.p)} %</b></span>`:`<span class="dl-in dl-tram"><input type="text" inputmode="decimal" data-dl="${P}.pay.${j}.pct" value="${esc(t.pct??'')}" placeholder="0" aria-label="Доля этапа, %"><i>%</i></span>`}
      <span class="dl-trw"><em>Когда:</em><select data-dl="${P}.pay.${j}.ev" aria-label="Когда">${Object.entries(DEAL_SUP_EVENTS).map(([v,l])=>`<option value="${v}"${(t.ev||'ready')===v?' selected':''}>${l}</option>`).join('')}</select><span class="dl-in dl-troff"><i>+</i><input type="text" inputmode="numeric" data-dl="${P}.pay.${j}.off" value="${esc(t.off??'')}" placeholder="0" aria-label="Дней после события">${dlDayKind(`${P}.pay.${j}.off`)}</span>${dlDateIn(`${P}.pay.${j}.off`, spBase[t.ev||'ready']||0, st.off||0, 'Оплата поставщику', t.offK)}</span>
      <span class="dl-trr"><b>${dlRub0(base*st.p/100)}</b><small>${day!=null?`день ${day}${dlD0()?` · ${dlDayRu(day)}`:''}`:'—'}</small></span>
      ${n>1?`<button type="button" class="icon" data-dlx="delsp" data-k="${k}" data-j="${j}" aria-label="Убрать этап">✕</button>`:'<span></span>'}</div>`; }).join('');
  return `<div class="dl-trp-l"><span class="muted">Быстро:</span>${Object.entries(DL_SP_PRESETS).map(([v,[t]])=>`<button type="button" class="chip" data-dlx="sppreset" data-k="${k}" data-v="${v}">${esc(t)}</button>`).join('')}</div>
    <div class="dl-trs">${rows}</div>${c.err[P+'.pay']?`<small class="dl-err">${esc(c.err[P+'.pay'])}</small>`:''}
    <div class="dl-trf"><button type="button" class="btn" data-dlx="addsp" data-k="${k}">+ Этап оплаты поставщику</button></div>`;
}

// ---------- шаг 2: таможня
function dlCustoms(c){
  const d=dlDeal(), ex=DL.ex;
  const blocks=d.sup.map((s,k)=>{ const cs=c.sup[k], P=`sup.${k}`; if (cs.mode==='none' && /^росс/i.test(s.country||'')) return '';
    const modeSeg=`<span class="dl-seg"><button type="button" class="${cs.mode==='calc'?'on':''}" data-dlx="cusmode" data-k="${k}" data-v="calc">Рассчитать</button><button type="button" class="${cs.mode==='eaeu'?'on':''}" data-dlx="cusmode" data-k="${k}" data-v="eaeu">ЕАЭС</button><button type="button" class="${cs.mode==='sum'?'on':''}" data-dlx="cusmode" data-k="${k}" data-v="sum">Сумма целиком</button><button type="button" class="${cs.mode==='none'?'on':''}" data-dlx="cusmode" data-k="${k}" data-v="none">Нет</button></span>`;
    let body='';
    if (cs.mode==='calc'){
      const rows = ex ? '' : S.items.filter(x=>String(x.name||'').trim() && dlSupOf(x.id)===s.id).map(x=>{ const h=dlHsOf(x), ln=cs.lines.find(l=>l.id===x.id);
        return `<tr><td class="c-nm"><b>${esc(x.name)}</b><small>${esc(typeById(attrsOf(x).cat).name)}</small></td>
          <td><input type="text" class="hs" data-hs-i="${esc(x.id)}" data-f="code" value="${esc(h.code)}" placeholder="0000 00" aria-label="Код ТН ВЭД"></td>
          <td><span class="dl-in"><input type="text" inputmode="decimal" class="hs-d" data-hs-i="${esc(x.id)}" data-f="duty" value="${esc(h.duty)}" placeholder="?" aria-label="Ставка пошлины, %"><i>%</i></span></td>
          <td class="c-src">${h.src?`<span class="dl-badge ${h.src==='справочно'?'warn':'kp'}" title="${esc(h.src==='справочно'?(dealHsAuto(attrsOf(x).cat,attrsOf(x))||{}).note||'':'')}">${esc(h.src)}</span>`:'<span class="dl-badge warn">укажите</span>'}
            <select class="dl-hspick" data-hspick="${esc(x.id)}" aria-label="Взять код и ставку из справочника"><option value="">из справочника…</option>${dlHsCats().map(o=>`<option value="${esc(o.key)}">${esc(o.name)} · ${esc(o.code||'—')} · ${esc(o.duty||'0')} %</option>`).join('')}</select></td>
          <td class="num">${ln?dlRub0(ln.cv):'—'}</td><td class="num">${ln?dlRub0(ln.dutyA):'—'}</td></tr>`; }).join('');
      body=`${rows?`<table class="dl-it dl-hs"><thead><tr><th>Позиция</th><th>Код ТН ВЭД</th><th>Пошлина</th><th></th><th class="num">Тамож. стоимость</th><th class="num">Пошлина, ₽</th></tr></thead><tbody>${rows}</tbody></table>`:''}
        <div class="dl-g g3">${dlField('НДС на ввоз', P+'.ivat', {calc:c, select:[['22','22 %'],['10','10 %'],['0','0 %']]})}
          ${dlField('Таможенный сбор', P+'.fee', {calc:c, unit:'₽', auto:cs.fee, autoLabel:'по шкале', autoTitle:'Сбор за таможенные операции: '+(customsFeeBand(cs.cv)||'по таможенной стоимости')+' ('+CUSTOMS_FEES.title+')', q:'Фиксированная сумма за декларацию — зависит от общей таможенной стоимости партии (цена + доставка до границы + страховка): до 200 тыс. ₽ — 1 231 ₽, до 1,2 млн — 4 924 ₽, до 2,7 млн — 13 541 ₽, до 10 млн — 49 240 ₽, свыше — 73 860 ₽ ('+CUSTOMS_FEES.title+').'})}</div>
        ${dlCusSum(cs)}`;
    } else if (cs.mode==='eaeu'){
      body=`<div class="dl-g g3">${dlField('НДС при ввозе', P+'.ivat', {calc:c, select:[['22','22 %'],['10','10 %'],['0','0 %']]})}</div>
        ${dlCusSum(cs, true)}`;
    } else if (cs.mode==='sum'){
      body=`<div class="dl-g">${dlField('Таможенные платежи целиком', P+'.cus.v', {calc:c, cur:P+'.cus.cur', q:'Пошлина, сбор и ввозной НДС одной суммой — например, по расчёту брокера.'})}
        ${dlField('Из них ввозной НДС к вычету', P+'.vi', {calc:c, unit:'₽', ph:cs.T?'Сумма по декларации':'0', unknown:cs.T>0, hint:cs.T?'Пусто — сумма неизвестна (не ноль). Нет права на вычет — 0.':''})}</div>`;
    } else body='<p class="muted">Таможни нет.</p>';
    return `<div class="dl-card"><div class="dl-ch"><b>${esc(cs.name)}${s.country?` · ${esc(s.country)}`:''}</b>${modeSeg}</div>${body}</div>`; }).join('');
  if (!blocks.trim()) return '';
  return dlStep(2, 'Таможня и ввозные налоги', 'Пошлина — по коду ТН ВЭД каждой позиции; ввозной НДС возвращается вычетом.',
    `${blocks}<p class="dl-foot-n">Коды и ставки — справочные по ЕТТ ЕАЭС; точный код (10 знаков) подтверждает таможенный брокер.
      Исправленный код и ставка запоминаются для модели. ${ex?'':'<button type="button" class="lnk" data-dlx="hsdir">Справочник кодов по категориям</button> · '}<a href="https://www.alta.ru/tnved/" target="_blank" rel="noopener">Проверить ставку на alta.ru ↗</a></p>`, '', ['Итого платим на таможне', c.Tsum, `из них в себестоимость ${dlRub0(c.sup.reduce((a,x)=>a+x.T-(x.vi||0),0))}, остальное — ввозной НДС к вычету`], 'cus');
}

// расчёт таможенных платежей наглядно: из чего складывается сумма к оплате на таможне и что вернётся вычетом
function dlCusSum(cs, eaeu){
  const it=(lab, v, note, cls='')=>`<div class="dl-cx ${cls}"><small>${lab}</small><b>${dlRub0(v)}</b>${note?`<em>${note}</em>`:''}</div>`;
  return `<div class="dl-cus2">
    <div class="dl-cbase">${it(eaeu?'Стоимость оборудования':'Таможенная стоимость', cs.cv, eaeu?'база для НДС':'оборудование + перевозка до границы + страхование')}</div>
    <div class="dl-cpay">${eaeu?'':it(`Пошлина`, cs.dutyA, 'по ставкам позиций → в себестоимость')}${eaeu?'':it('Таможенный сбор', cs.fee, (cs.feeAuto&&customsFeeBand(cs.cv)?customsFeeBand(cs.cv).replace(/ → сбор.*/,'')+' · ':'')+'по шкале ПП РФ № 1637 → в себестоимость')}
      ${it(`НДС при ввозе ${dlIn(cs.ivP)} %`, cs.ivatA, eaeu?'платится в налоговую → вернётся вычетом':`(стоимость + пошлина) × ${dlIn(cs.ivP)} % → вернётся вычетом`, 'vat')}</div>
    <div class="dl-ctot"><small>${eaeu?'Платим НДС при ввозе':'Платим на таможне'}</small><b>${dlRub0(cs.T)}</b><em>из них в себестоимость: <b>${dlRub0(cs.T-cs.ivatA)}</b></em></div></div>
    ${eaeu?'<p class="dl-foot-n">Из стран ЕАЭС пошлины и таможенного сбора нет (Договор о ЕАЭС).</p>':''}`;
}

// ---------- шаги 3–5
// оплата заказчика: этапы с названием, суммой (% или ₽), событием и сдвигом в днях; последний — остаток
const DL_TR_PRESETS = {
  post:  ['100 % после поставки', [{name:'Оплата', ev:'delivery', off:'30'}]],
  a30:   ['Аванс 30 % + остаток', [{name:'Аванс', pct:'30', ev:'sign', off:'5'}, {name:'Окончательный расчёт', ev:'delivery', off:'10'}]],
  a50:   ['Аванс 50 % + остаток', [{name:'Аванс', pct:'50', ev:'sign', off:'5'}, {name:'Окончательный расчёт', ev:'delivery', off:'10'}]],
  a3060: ['30 % + 60 % + 10 %', [{name:'Аванс', pct:'30', ev:'sign', off:'5'}, {name:'Перед отгрузкой', pct:'60', ev:'ready', off:'0'}, {name:'После ПНР', ev:'pnr', off:'10'}]],
  a100:  ['Предоплата 100 %', [{name:'Предоплата', ev:'sign', off:'5'}]],
};

function dlCustomer(c){
  const d=dlDeal(), tr=d.cust.tr, n=tr.length;
  const evSel=(k,t)=>`<select data-dl="cust.tr.${k}.ev" aria-label="Когда">${Object.entries(DEAL_EVENTS).map(([v,l])=>`<option value="${v}"${t.ev===v?' selected':''}>${l}</option>`).join('')}</select>`;
  const rows=tr.map((t,k)=>{ const last=k===n-1, ct=c.trs[k], bySum=!last && t.mode==='sum', e=c.err[`cust.tr.${k}.pct`]||c.err[`cust.tr.${k}.sum`]||c.err[`cust.tr.${k}.off`];
    const row=c.rows.find(r=>r.stage===k), rub=bySum?ct.sum:c.S*(ct.p||0)/100, day=row?row.day:(c.ev[ct.ev]||0)+ct.off;
    const ph=last?(n>1?'Окончательный расчёт':'Оплата'):k===0?'Аванс':'Платёж '+(k+1);
    const amt = last ? `<span class="dl-trp" title="Последний этап — остаток до 100 %">остаток<b>${dlIn(ct.p)} %</b></span>`
      : `<span class="dl-in dl-tram"><input type="text" inputmode="decimal" data-dl="cust.tr.${k}.${bySum?'sum':'pct'}" value="${esc(bySum?t.sum??'':t.pct??'')}" placeholder="0" aria-label="${bySum?'Сумма этапа, ₽':'Доля этапа, %'}"><span class="mtog" role="group" aria-label="Процент или сумма"><button type="button" class="${bySum?'':'on'}" data-dlx="trmode" data-k="${k}" data-v="pct">%</button><button type="button" class="${bySum?'on':''}" data-dlx="trmode" data-k="${k}" data-v="sum">₽</button></span></span>`;
    return `<div class="dl-tr${e?' bad':''}${last?' last':''}" data-dnd="cust" data-i="${k}">${dlMoveCtl('cust', k, n)}
      <span class="dl-trn">${k+1}</span>
      <input type="text" class="tx dl-trname" data-dl="cust.tr.${k}.name" value="${esc(t.name||'')}" placeholder="${esc(ph)}" aria-label="Название этапа">
      ${amt}
      <span class="dl-trw"><em>Когда:</em>${evSel(k,t)}<span class="dl-in dl-troff"><i>+</i><input type="text" inputmode="numeric" data-dl="cust.tr.${k}.off" value="${esc(t.off)}" placeholder="0" aria-label="Дней после события">${dlDayKind(`cust.tr.${k}.off`)}</span>${dlDateIn(`cust.tr.${k}.off`, c.ev[ct.ev]||0, ct.off||0, 'Оплата заказчика', t.offK)}</span>
      <span class="dl-trr"><b>${dlRub0(rub)}</b><small>день ${day}${dlD0()?` · ${dlDayRu(day)}`:''}</small></span>
      ${n>1?`<button type="button" class="icon" data-dlx="deltr" data-k="${k}" aria-label="Убрать этап">✕</button>`:'<span></span>'}</div>`; }).join('');
  return `<div class="dl-trp-l"><span class="muted">Быстро:</span>${Object.entries(DL_TR_PRESETS).map(([k,[t]])=>`<button type="button" class="chip" data-dlx="trpreset" data-v="${k}">${esc(t)}</button>`).join('')}</div>
    <div class="dl-trs">${rows}</div>${c.err['cust.tr']?`<small class="dl-err">${esc(c.err['cust.tr'])}</small>`:''}
    <div class="dl-trf"><button type="button" class="btn" data-dlx="addtr">+ Этап оплаты</button><span class="muted">Сумму этапа можно вписать в процентах или рублях; последний этап — остаток. День 0 — подписание договора, готовность — день ${c.Rdy}, поставка — день ${c.D}${c.pnrDays?`, ПНР — день ${c.pnrEnd}`:''}.</span></div>`;
}

// ---------- условия КП из экономики сделки: срок поставки, этапы оплаты, монтаж и ПНР.
// Подставляются, пока поле пустое или в нём прежняя подстановка; вписанное вручную не меняется
// (в разделе «Условия» — кнопка «↺ Из экономики сделки»). S.condAuto — последняя подстановка по каждому условию.
const DL_COND_MNT='Монтаж, ШМР и ПНР';
function dealCondSuggest(c){
  const out={}, d=dlDeal(), act=c.sup.filter(s=>s.active);
  if (c.D>0){ const allWork=act.length && act.every(s=>s.prodK==='work'&&s.shipK==='work');
    const n=allWork ? Math.max(...act.map(s=>s.prod+s.ship)) : c.D;
    out['Срок поставки']=`${dlDaysTxt(n, allWork?'work':'')} с даты подписания договора`; }
  const EVW={sign:'подписания договора', ready:'уведомления о готовности к отгрузке', delivery:'поставки', pnr:'пусконаладочных работ'};
  const ph=t=>t.off ? `в течение ${dlDaysTxt(t.off, t.offK)} после ${EVW[t.ev]}` : t.ev==='ready' ? 'перед отгрузкой' : t.ev==='sign' ? 'при подписании договора' : `после ${EVW[t.ev]}`;
  const st=c.trs.filter(t=>t.p>0.004);
  if (st.length) out['Условия оплаты'] = st.length===1 ? `100 % ${ph(st[0])}`
    : st.map(t=>`${dlPctTxt(t.p)}${/^(аванс|предоплат)/i.test(t.name)?' — '+t.name.toLowerCase():''} ${ph(t)}`).join('; ');
  if (c.M>0) out[DL_COND_MNT]=`Монтажные и пусконаладочные работы (ШМР, ПНР) входят в стоимость${c.pnrDays?`; срок ПНР — ${dlDaysTxt(c.pnrDays, d.pnrK==='work'?'work':'')} после поставки`:''}`;
  return out;
}
function dealSyncConds(c){
  if (DL.ex || !S.deal || !S.deal.touched || !Array.isArray(S.conditions)) return false;
  const sug=dealCondSuggest(c); S.condAuto=S.condAuto||{}; let ch=false;
  for (const label of ['Срок поставки','Условия оплаты',DL_COND_MNT]){
    const v=sug[label]||''; let cd=S.conditions.find(x=>x.label===label);
    if (!cd){ if (!v) continue; cd={label, value:''}; S.conditions.push(cd); }
    const cur=String(cd.value||'').trim(), prev=S.condAuto[label];
    if (!cur || (prev!=null && cur===prev)){ if (cd.value!==v){ cd.value=v; ch=true; } if (v) S.condAuto[label]=v; else delete S.condAuto[label]; }
  }
  return ch;
}

// перестановка этапов оплаты: перетаскивание за «⠿» или стрелки ↑↓. Этап занимает срок своего нового места
// (события и дни остаются по местам в порядке дат), доли сохраняются; последний этап — остаток до 100 %.
function dlMoveCtl(grp, i, n){
  if (n<2 || DL.ex) return '<span class="dl-mv"></span>';
  return `<span class="dl-mv"><span class="dl-hdl" draggable="true" data-dndh="${grp}" data-i="${i}" title="Перетащите, чтобы переставить этап выше или ниже" aria-hidden="true">⠿</span>
    <button type="button" class="dl-mvb" data-dlx="mv" data-grp="${grp}" data-i="${i}" data-to="${i-1}"${i?'':' disabled'} aria-label="Этап выше">↑</button><button type="button" class="dl-mvb" data-dlx="mv" data-grp="${grp}" data-i="${i}" data-to="${i+1}"${i<n-1?'':' disabled'} aria-label="Этап ниже">↓</button></span>`;
}
function dlMoveStage(grp, from, to){
  const d=dlDeal(), c=dealCalc(dlKp(), d);
  let list, shares, k=-1;
  if (grp==='cust'){ list=d.cust.tr; shares=c.trs.map(t=>t.p); }
  else { k=+grp.split(':')[1]; list=d.sup[k] && d.sup[k].pay; shares=(c.sup[k]||{stages:[]}).stages.map(t=>t.p); }
  if (!list || from===to || to<0 || to>=list.length || from<0 || from>=list.length) return null;
  // название, описывающее срок («Перед отгрузкой», «После ПНР», «Окончательный расчёт»…), остаётся со сроком
  const timeName=n=>/отгруз|пнр|поставк|подписан|оконч|остат|аванс|предоплат|заказ|шефмонтаж/i.test(n||'');
  const slots=list.map(t=>({ev:t.ev, off:t.off, offK:t.offK, ...(timeName(t.name)?{name:t.name}:{})}));
  const items=list.map((t,i)=>({...t, _p:shares[i]||0}));
  const [x]=items.splice(from,1); items.splice(to,0,x);
  items.forEach((t,i)=>{ const keep=!timeName(t.name)?t.name:null; if (timeName(t.name)) t.name='';
    Object.assign(t, slots[i]); if (keep && !timeName(slots[i].name)) t.name=keep; if (!t.offK) delete t.offK;
    if (i===items.length-1){ t.pct=''; if (t.mode==='sum') t.mode='pct'; }
    else if (t.mode!=='sum') t.pct=dlIn(Math.round(t._p*100)/100);
    delete t._p; });
  list.splice(0, list.length, ...items);
  if (k>=0) dlSaveSupplier(d.sup[k]);
  const ev=grp==='cust'?DEAL_EVENTS:DEAL_SUP_EVENTS, m=items[to];
  return `Этап «${m.name||'Оплата'}» перенесён: ${ev[m.ev]||''}${+m.off?` + ${m.off} ${m.offK==='work'?'раб.':''} дн.`:''}`;
}

// график платежей — итог всех сроков. Новая дата платежа (перетаскиванием строки, стрелками или вводом даты)
// переписывает срок, из которого платёж получился: этап оплаты — событие + дни (если дата раньше события — этап
// переходит на более раннее событие), логистика — срок изготовления у поставщика, доставка по России и монтаж —
// срок доставки. Платёж без своего срока (комиссия банка за гарантию) получает дату вручную.
function dlSetRowDay(key, N){
  const d=dlDeal(), kp=dlKp(), c=dealCalc(kp, d);
  if (!(N>=0)) return 'Дата раньше дня 0 — платёж не может быть раньше подписания договора';
  const cnt=(base, kind)=>{ if (kind!=='work') return N-base; let n=dlCountWork(base, N); if (dealAddDays(kp, base, n, 'work') < N) n++; return n; };
  const days={...(d.days||{})}; delete days[key]; d.days=days;     // ручная дата этого платежа больше не нужна
  const manual=()=>{ d.days={...d.days, [key]:String(N)}; return `Дата платежа изменена вручную: ${dlDayRu(N)||'день '+N}`; };
  const pickEv=(evDays, cur)=>{ if (evDays[cur]!=null && evDays[cur]<=N) return cur;
    let best=null; for (const [k,v] of Object.entries(evDays)) if (v!=null && v<=N && (best==null || v>evDays[best])) best=k; return best||cur; };
  const daysTxt=(n,k)=>n ? ` + ${dlDaysTxt(n,k)}` : '';
  let m;
  if ((m=/^c(\d+)$/.exec(key))){ const t=d.cust && d.cust.tr && d.cust.tr[+m[1]]; if (!t) return manual();
    const ev=pickEv(c.ev, t.ev||'delivery'), n=cnt(c.ev[ev], t.offK); if (n<0) return manual();
    t.ev=ev; t.off=String(n);
    return `Оплата заказчика: ${DEAL_EVENTS[ev]}${daysTxt(n,t.offK)}`; }
  if ((m=/^sp:(.+):(\d+)$/.exec(key))){ const k=d.sup.findIndex(x=>x.id===m[1]), cs=c.sup[k]; if (k<0 || !cs) return manual();
    const s=d.sup[k]; if (!Array.isArray(s.pay) || !s.pay.length) s.pay=dealSupPay(s).map(x=>({...x}));
    const t=s.pay[+m[2]]; if (!t) return manual();
    const evDays={order:0, ready:cs.rdy, delivery:cs.arr, pnr:c.pnrEnd}, ev=pickEv(evDays, t.ev||'ready'), n=cnt(evDays[ev], t.offK); if (n<0) return manual();
    t.ev=ev; t.off=String(n); dlSaveSupplier(s);
    return `Оплата поставщику: ${DEAL_SUP_EVENTS[ev]}${daysTxt(n,t.offK)}`; }
  if ((m=/^log:(.+)$/.exec(key))){ const k=d.sup.findIndex(x=>x.id===m[1]); if (k<0) return manual();
    const s=d.sup[k], n=cnt(0, s.prodK); s.prod=String(n); dlSaveSupplier(s);
    return `Срок изготовления${d.sup.length>1?` у «${c.sup[k].name}»`:''}: ${dlDaysTxt(n, s.prodK)} — сдвинуты и платежи, привязанные к готовности и поставке`; }
  if ((m=/^ru:(.+)$/.exec(key)) || key==='mnt'){
    let k = m ? d.sup.findIndex(x=>x.id===m[1]) : -1;
    if (key==='mnt'){ let best=-1; c.sup.forEach((x,i)=>{ if (x.active && (best<0 || x.arr>c.sup[best].arr)) best=i; }); k=best; }
    if (k<0 || !c.sup[k]) return manual();
    const s=d.sup[k], n=cnt(c.sup[k].rdy, s.shipK); if (n<0) return manual();
    s.ship=String(n); dlSaveSupplier(s);
    return `Срок доставки${d.sup.length>1?` у «${c.sup[k].name}»`:''}: ${dlDaysTxt(n, s.shipK)} после готовности — сдвинуты платежи при поставке`; }
  return manual();
}
// ↑ / ↓ у строки графика: на дату соседнего (более раннего / позднего) платежа
function dlRowStep(key, dir){
  const c=dealCalc(dlKp(), dlDeal()), r=c.rows.find(x=>x.key===key); if (!r) return null;
  const ds=[...new Set(c.rows.map(x=>x.day))].sort((a,b)=>a-b), i=ds.indexOf(r.day), j=i+dir;
  if (j<0) return r.day>0 ? dlSetRowDay(key, 0) : null;
  if (j>=ds.length) return null;
  return dlSetRowDay(key, ds[j]);
}

// цена КП, валюта и курсы — правятся здесь же и сразу меняют КП
function dlKpPrice(c){
  const d=dlDeal(), kp=dlKp();
  if (DL.ex) return `<div class="dl-g g3">${dlField('Цена КП с НДС', 'over.price', {calc:c, unit:'₽', kp:kp.sumRub})}${dlField('НДС продажи', 'over.vat', {calc:c, unit:'%', kp:kp.vat})}${c.used.map(cur=>dlField(`Курс ${cur}`, 'rates.'+cur, {calc:c, unit:'₽', kp:dNum(kp.rates[cur])})).join('')}</div>`;
  const cur=kpCur(), csh=curSh(cur), t=totalsS(), P=S.pricing;
  const need=[...new Set([cur, ...c.used])].filter(x=>x!=='RUB');
  const its=S.items.filter(x=>String(x.name||'').trim());
  const rows=its.map(x=>{ const i=S.items.indexOf(x), pt=x._priceText ?? fmtPrice(x.price), dsc=KPGen.unitDisc(x);
    return `<tr><td class="c-nm"><b>${esc(x.name)}</b><small>${esc(x.qty)} шт.${dsc?` · скидка ${money(dsc)} ${csh}/ед.`:''}</small></td>
      <td class="c-cost"><input type="text" inputmode="decimal" class="num" data-kpp-i="${i}" value="${esc(pt)}" placeholder="0,00" aria-label="Цена за единицу с НДС, ${csh}"></td>
      <td class="num">${money(itemSum(x))}</td></tr>`; }).join('');
  const over=d.over.price!==''&&d.over.price!=null;
  return `<div class="dl-g g3">
      <label class="f dl-f"><span>Валюта КП</span><select data-kpcur aria-label="Валюта КП">${CUR_LIST.map(k=>`<option value="${k}"${k===cur?' selected':''}>${k==='RUB'?'Рубли':k==='USD'?'Доллары США':k==='EUR'?'Евро':'Юани'} (${k})</option>`).join('')}</select><small class="muted">Цены переводятся по курсу</small></label>
      <label class="f dl-f"><span>НДС продажи <i>%</i></span><input type="text" inputmode="numeric" data-kpvat value="${esc(S.vat)}" aria-label="НДС продажи, %"><small class="muted">Как в разделе «Условия»</small></label>
      <div class="f dl-f dl-rates"><span>Курс ЦБ РФ${P.rateDate?` на ${esc(KPGen.ruDate(P.rateDate))}`:''}</span>
        ${need.length?need.map(k=>`<span class="dl-in"><i>1 ${k} =</i><input type="text" inputmode="decimal" data-kprate="${k}" value="${esc((d.rates&&d.rates[k])||P.rates[k]||'')}" placeholder="0,0000" aria-label="Курс ${k}"${rateOf(k)>0?'':' class="bad"'}><i>₽</i></span>`).join(''):'<small class="muted">Все цены в рублях — курс не нужен</small>'}
        ${need.length?'<button type="button" class="lnk" data-dlx="cbr">Обновить курс с cbr.ru</button>':''}</div></div>
    ${rows?`<table class="dl-it dl-kpt"><thead><tr><th>Позиция</th><th>Цена за ед. с НДС, ${csh}</th><th class="num">Сумма, ${csh}</th></tr></thead><tbody>${rows}</tbody>
      <tfoot><tr><td><b>Итого КП с НДС</b></td><td></td><td class="num"><b>${money(t.sum)} ${csh}</b>${cur!=='RUB'&&kp.sumRub?`<small>≈ ${dlRub0(kp.sumRub)}</small>`:''}</td></tr></tfoot></table>`:''}
    <details class="dl-more" data-more="over"${dlMore('over', over)}><summary>Прикинуть другую цену без изменения КП</summary>
      <div class="dl-g g3">${dlField('Цена для расчёта с НДС', 'over.price', {calc:c, unit:'₽', kp:kp.sumRub, kpLabel:'= цена КП', q:'Только для расчёта: КП не меняется. Чтобы поставить цену в КП — впишите цены позиций выше или нажмите «Перенести цены в КП» справа.'})}</div></details>`;
}

function dlCalNote(d0){
  const ys=dlCalYears(d0), cs=ys.map(y=>DL.cal[y]).filter(Boolean);
  if (cs.length<ys.length) return '<span class="muted">Загружаю производственный календарь…</span>';
  const ap=cs.some(c=>c.approx);
  return `<span class="muted${ap?' warn-t':''}">Даты платежей — только рабочие (банковские) дни: ${esc(cs[0].src)}${ap?'. Праздники с переносами учтены не полностью.':''}</span>`;
}

const DL_PARTY = { sup:['Поставщик','sup'], log:['Логистика','log'], cust:['Заказчик','cust'], oth:['Прочее','oth'] };
const DL_WD = ['вс','пн','вт','ср','чт','пт','сб'];
const dlWd = day => { const iso=dlDayIso(day); return iso ? DL_WD[new Date(iso+'T00:00:00Z').getUTCDay()] : ''; };

function dlSchedule(c, n=6){
  const d=dlDeal(), d0=dlD0();
  const out=c.rows.filter(r=>!r.inflow), inn=c.rows.filter(r=>r.inflow);
  const sum=f=>c.rows.filter(f).reduce((a,r)=>a+Math.abs(r.amount),0);
  const peak=c.rows.reduce((m,r)=>r.balance<m.v?{v:r.balance, r}:m, {v:0, r:null});
  const tile=(lab,v,sub,cls='')=>`<div class="dl-sx ${cls}"><small>${lab}</small><b>${v}</b>${sub?`<em>${sub}</em>`:''}</div>`;
  const when=day=>`день ${day}${d0?` · ${dlDayRu(day)}`:''}`;
  return dlStep(n, `График платежей · ${c.Tend} ${plural(c.Tend,'день','дня','дней')}${d0?` · до ${dlDayRu(c.Tend)}`:''}`, 'Деньги по дням: кто, когда и сколько платит. В один день сначала поступление от заказчика, потом платежи (кроме постоплаты).', `
    ${Object.keys(d.days||{}).length?'<div class="dl-d0"><span class="muted">Даты некоторых платежей изменены вручную.</span><button type="button" class="btn ghost" data-dlx="resetdays">↺ Вернуть даты по срокам</button></div>':''}
    <div class="dl-sxs">${tile('Платим поставщикам и за логистику', dlRub0(sum(r=>!r.inflow&&r.party!=='oth')), `${out.length} ${plural(out.length,'платёж','платежа','платежей')}`)}
      ${tile('Получаем от заказчика', dlRub0(sum(r=>r.inflow)), `${inn.length} ${plural(inn.length,'платёж','платежа','платежей')}, последний — ${when(c.Tend)}`, 'in')}
      ${tile('Пик вложений своих денег', peak.r?dlRub0(-peak.v):'0 ₽', peak.r?when(peak.r.day):'деньги заказчика покрывают платежи', peak.r?'neg':'')}
      ${tile('Финансирование', dlRub0(c.F), `${dlIn(c.i)} % в месяц`)}</div>
    <div class="dl-tw"><table class="dl-t"><thead><tr><th>${d0?'Дата · день':'День'}</th><th>Кто</th><th>Платёж</th><th class="num">Сумма</th><th class="num">Остаток денег</th><th class="num">Финансирование</th></tr></thead><tbody>
    ${c.rows.map(r=>{ const pt=DL_PARTY[r.party]||DL_PARTY.oth;
      const dayIn = r.fixed?`<span class="dl-day fx">${r.day}</span>`:`<input type="text" inputmode="numeric" class="dl-day" data-dlday="${esc(r.key)}" value="${r.day}" aria-label="День: ${esc(r.label)}" title="${r.manual?'Дата изменена вручную':'По срокам — можно изменить'}">`;
      const dateIn = r.fixed?`<span class="dl-dt">${dlDayRu(r.day)}</span>`:`<input type="date" class="dl-date" data-dldate="${esc(r.key)}" value="${dlDayIso(r.day)}" min="${d0}" aria-label="Дата: ${esc(r.label)}" title="${r.manual?'Дата изменена вручную':'По срокам — можно изменить'}">`;
      const mv = r.fixed || DL.ex ? '' : `<span class="dl-smv"><span class="dl-hdl" draggable="true" data-dnds="${esc(r.key)}" title="Перетащите строку выше или ниже — платёж получит дату нового места, срок пересчитается" aria-hidden="true">⠿</span><button type="button" class="dl-mvb" data-dlx="rowmv" data-key="${esc(r.key)}" data-d="-1" aria-label="Раньше — на дату платежа выше" title="Раньше — на дату платежа выше">↑</button><button type="button" class="dl-mvb" data-dlx="rowmv" data-key="${esc(r.key)}" data-d="1" aria-label="Позже — на дату платежа ниже" title="Позже — на дату платежа ниже">↓</button></span>`;
      return `<tr class="${r.inflow?'in':''}${r.manual?' man':''}" data-skey="${esc(r.key)}" data-sday="${r.day}"><td class="c-day${d0?' c-when':''}">${mv}${d0?`${dateIn}<small class="dl-wd${r.offDay?' bad-t':''}">день ${r.day} · ${dlWd(r.day)}${r.shiftedFrom!=null?` · <span title="По сроку — ${dlDayRu(r.shiftedFrom)} (${dlWd(r.shiftedFrom)}), нерабочий день">↷ с ${dlDayRu(r.shiftedFrom).slice(0,5)}</span>`:''}${r.offDay?' · нерабочий':''}</small>`:dayIn}</td>
      <td class="c-who"><span class="dl-pty ${pt[1]}">${pt[0]}</span></td>
      <td class="c-ev">${esc(r.label)}${r.ev&&(r.party==='log'||r.party==='oth')?`<small>${esc(r.ev)}</small>`:''}</td><td class="num c-pay ${r.inflow?'ok-t':''}">${r.inflow?'+':'−'}${dlRub0(Math.abs(r.amount))}</td><td class="num c-bal ${r.balance<0?'neg':''}">${dlRub0(r.balance)}</td><td class="num c-fin">${r.fin?dlRub0(r.fin)+`<small>${r.days} дн.</small>`:'—'}</td></tr>`; }).join('')}
    </tbody><tfoot><tr><td class="c-day"></td><td class="c-who"></td><td class="c-ev">Стоимость финансирования</td><td class="c-pay"></td><td class="c-bal"></td><td class="num c-fin"><b>${dlRub(c.F)}</b></td></tr></tfoot></table></div>
    <p class="muted">Простой процент на недостающие деньги до последней оплаты заказчика, месяц — 30 дней; оплаты заказчика уменьшают финансирование, доход на свободный остаток не начисляется.</p>
    <p class="muted dl-shint">Перетащите платёж за «⠿» выше или ниже (или ↑ ↓, или выберите дату) — он получит новую дату, а срок, из которого он получился (этап оплаты, срок изготовления или доставки), пересчитается в днях и датах на предыдущих вкладках.</p>`, 'dl-sched', null, 'sched');
}

// ---------- прочие расходы наличными (необязательно): % от чистой прибыли, % от выручки без НДС или сумма — всё «чистыми», на руки
const DL_XC_WHEN=[['end','После последней оплаты заказчика'],['pay','С оплат заказчика — по этапам']];
const DL_XC_MODES=[['net','% от чистой прибыли'],['sale','% от суммы продажи без НДС'],['salevat','% от суммы продажи с НДС'],['sum','Сумма, ₽']];
function dlCash(c){
  const d=dlDeal(), x=c.xc, r=c.base||c.lo, open=!!(d.xc && Object.values(d.xc).some(v=>v!=null && v!==''));
  const unit = x.mode==='sum' ? '₽ на руки' : x.mode==='sale' ? '% выручки без НДС' : x.mode==='salevat' ? '% суммы с НДС' : '% чистой прибыли';
  const how = x.mode==='net' ? `${dlIn(x.v)} % от чистой прибыли сделки ${dlRub0(Math.max(0, r.Pa-r.tax))} (после налога на прибыль, до этих расходов)`
    : x.mode==='sale' ? `${dlIn(x.v)} % от выручки без НДС ${dlRub0(c.R)}` : x.mode==='salevat' ? `${dlIn(x.v)} % от суммы продажи с НДС ${dlRub0(c.S)}` : 'сумма на руки';
  return `<div class="dl-card dl-mb dl-cash"><div class="dl-mbh"><h5>Прочие расходы (наличные)</h5><span class="dl-stc opt">необязательно</span>${r.K>0?`<b class="dl-mbs">${dlRub0(r.K)}</b>`:''}</div>
    <div class="dl-g g3">
      ${dlField('Как считать', 'xc.mode', {calc:c, select:DL_XC_MODES})}
      ${dlField(x.mode==='sum'?'Сумма на руки':'Процент', 'xc.v', {calc:c, unit, ph:x.mode==='sum'?'100 000':'10', q:'Сумма «чистыми» — столько получат на руки наличными, без каких-либо налогов. От чистой прибыли — процент от прибыли сделки после налога на прибыль (до этих расходов); от продажи — процент от суммы продажи без НДС или с НДС (цена КП).'})}
      ${dlField('Стоимость наличных', 'xc.cost', {calc:c, unit:'%', ph:'0', q:'Сколько процентов от перечисленной суммы удерживают за выдачу наличных. Расход компании = сумма на руки ÷ (1 − процент). Если наличные уже есть — оставьте пустым.'})}</div>
    ${x.on||open&&x.when==='pay'?`<div class="dl-g g2">${dlField('Когда выдаются', 'xc.when', {calc:c, select:DL_XC_WHEN, q:'После последней оплаты — наличные не влияют на финансирование. С оплат заказчика — с каждой отмеченной оплаты выдаётся часть, пропорционально её сумме, в день оплаты; деньги уходят раньше — финансирование может вырасти.'})}</div>
    ${x.when==='pay'?dlCashStages(c):''}`:''}
    ${r.K>0?`<p class="dl-cash-r">На руки <b>${dlRub0(r.X)}</b>${x.cost?` · расход компании с получением наличных <b>${dlRub0(r.K)}</b>`:''} <span class="muted">— ${esc(how)}</span></p>`:''}
    <p class="muted dl-mbn">Не уменьшают налог на прибыль — вычитаются из чистой прибыли; в КП не выводятся.</p></div>`;
}

// банковская гарантия: вид, сумма (от аванса, % цены или рублями), срок (днями или датой), ставка банка; комиссия — в расходы
function dlBg(c){
  const d=dlDeal(), gs=Array.isArray(d.bg)?d.bg:[];
  const rows=gs.map((g,k)=>{ const cg=c.bgs[k], P=`bg.${k}`, unit=cg.base==='sum'?'₽':cg.base==='adv'?'% аванса':'% цены КП';
    return `<div class="dl-bg">
      <div class="dl-g g3">${dlField('Вид гарантии', P+'.type', {calc:c, select:Object.entries(DEAL_BG_TYPES)})}
        ${dlField('Сумма гарантии', P+'.base', {calc:c, select:cg.type==='adv'?[['adv','от аванса заказчика'],['pct','% от цены КП'],['sum','в рублях']]:[['pct','% от цены КП'],['sum','в рублях'],['adv','от аванса заказчика']]})}
        ${dlField(cg.base==='sum'?'Сумма':'Процент', P+'.v', {calc:c, unit, ph:cg.base==='adv'?'100':cg.base==='pct'?'10':'500 000'})}</div>
      <div class="dl-g g3">${dlField('Срок гарантии', P+'.days', {calc:c, int:true, auto:cg.daysAuto, autoLabel:cg.type==='adv'?'до поставки':cg.type==='perf'?'до конца ПНР':'год', date:{base:0, val:cg.days, kind:false}})}
        ${dlField('Ставка банка', P+'.rate', {calc:c, unit:'% годовых', ph:String(DEAL_BG_RATE).replace('.',','), q:'Комиссия банка за гарантию — процент годовых от суммы гарантии за её срок. По умолчанию '+String(DEAL_BG_RATE).replace('.',',')+' %; рынок 2026: обычно 1–3,5 %, в среднем около 2,2 % (Сбербанк — от 2 %, ВТБ — от 3,7 %). Впишите ставку своего банка.'})}
        ${dlField('Минимальная комиссия', P+'.min', {calc:c, unit:'₽', ph:'0', q:'Если у банка есть минимальная комиссия за гарантию — впишите её.'})}</div>
      <p class="dl-bgr"><span>Сумма гарантии <b>${dlRub0(cg.amount)}</b> · комиссия банка <b>${dlRub0(cg.fee)}</b> <span class="muted">— при подписании договора, уменьшает прибыль</span></span><button type="button" class="lnk" data-dlx="delbg" data-k="${k}">Убрать</button></p></div>`; }).join('');
  return `<div class="dl-card dl-mb"><div class="dl-mbh"><h5>Банковская гарантия</h5><span class="dl-stc opt">необязательно</span>${c.BG>0?`<b class="dl-mbs">${dlRub0(c.BG)}</b>`:''}</div>
    ${rows || '<p class="muted dl-mbn">Если заказчик просит безотзывную банковскую гарантию — на возврат аванса, исполнения договора или гарантийных обязательств, — добавьте её: комиссия банка войдёт в расходы.</p>'}
    ${DL.ex?'':'<div><button type="button" class="btn" data-dlx="addbg">+ Банковская гарантия</button></div>'}</div>`;
}

// с каких оплат заказчика выдаются наличные: отметки по этапам и сумма с каждой
function dlCashStages(c){
  const x=c.xc, ins=c.rows.filter(r=>r.inflow && r.amount>0), xs=c.rows.filter(r=>String(r.key).startsWith('xc:'));
  if (!ins.length) return '';
  return `<div class="dl-cst" role="group" aria-label="С каких оплат заказчика">${ins.map(r=>{ const on=x.off[r.stage]!==false, t=c.trs[r.stage], xr=xs.find(z=>z.from===r.key);
    return `<label class="dl-cst-r${on?'':' off'}"><input type="checkbox" data-xcst="${r.stage}"${on?' checked':''}><span>${esc((t&&t.name)||(r.stage===0&&c.trs.length>1?'Аванс':t&&t.last&&c.trs.length>1?'Окончательная оплата':'Оплата'))} ${dlPctTxt(r.pct||0)} <small class="muted">день ${r.day}</small></span><b>${xr?'−'+dlRub0(-xr.amount):'—'}</b></label>`; }).join('')}
    ${x.from.length?'':'<p class="muted">Ни одна оплата не отмечена — наличные выдаются после последней оплаты заказчика.</p>'}</div>`;
}

// ---------- правая колонка: подбор цены и итог
function dlResult(c){
  const d=dlDeal(), kp=dlKp(), b=c.base, lo=c.lo, hi=c.hi, unk=c.unknown.length>0, bad=!c.ok || c.warn.some(w=>w.bad), r=b||lo;
  const noCost=c.warn.filter(w=>/не указана цена закупки/.test(w.t)).length;
  const tg=d.target||{type:'margin',v:''}, tv=dNum(tg.v);
  const need = tv!=null && !Number.isNaN(tv) ? dealSolve(kp, d, tg.type, tv) : null;
  const be = dealSolve(kp, d, 'profit', 0);
  const unit = tg.type==='profit'||tg.type==='net' ? '₽' : '%';
  const pl = need!=null && !DL.ex ? dlPlan(need) : null;
  const plan = pl ? `<table class="dl-plan"><thead><tr><th>Позиция</th><th class="num">Цена за ед. с НДС</th></tr></thead><tbody>${pl.its.map((x,k)=>`<tr><td>${esc(x.name)}${+x.qty>1?` <small>× ${esc(x.qty)}</small>`:''}</td><td class="num"><b>${money(pl.prices[k])}</b>${x.price&&x.price!==pl.prices[k]?`<small>сейчас ${money(x.price)}</small>`:''}</td></tr>`).join('')}</tbody></table>` : '';
  const parts = c.parts.map(([n,v])=>`<dt>${esc(n)}</dt><dd${v<0?' class="ok-t"':''}>${dlRub0(v)}${v>0&&r.Ctot>0?`<small>${dlIn(v/r.Ctot*100)} %</small>`:''}</dd>`).join('');
  const P = unk ? null : b.P;
  return `<div class="dl-res">
    ${DL.ex?'':`<div class="dl-price"><h4>Цена продажи</h4>
      <div class="dl-pr"><select data-dl="target.type" aria-label="По какому показателю подобрать цену">${[['margin','Маржинальность'],['markup','Наценка'],['profit','Прибыль до налога'],['net','Чистая прибыль']].map(([v,t])=>`<option value="${v}"${tg.type===v?' selected':''}>${t}</option>`).join('')}</select>
        <span class="dl-in"><input type="text" inputmode="decimal" data-dl="target.v" value="${esc(tg.v||'')}" placeholder="${unit==='%'?'20':'500 000'}" aria-label="Нужное значение"><i>${unit}</i></span></div>
      ${need!=null?`<p class="dl-need"><small>Цена КП с НДС</small><b>${dlRub0(need)}</b><span class="${need<kp.sumRub?'ok-t':'muted'}">${Math.abs(need-kp.sumRub)<1?'совпадает с КП':`${need>=kp.sumRub?'+':'−'}${dlRub0(Math.abs(need-kp.sumRub))} к текущей цене КП`}</span></p>
        ${plan}<button class="btn primary dl-apply" type="button" data-dlx="apply" data-s="${need}">Перенести цены в КП</button>
        <p class="dl-note">${esc(pl?'Распределено '+pl.basis+'.':'')}</p>`
        : tv!=null?'<p class="muted">Цель недостижима при этих расходах.</p>':'<p class="muted">Укажите нужную маржу или прибыль — программа рассчитает цену КП и цены позиций.</p>'}
      <div class="dl-be">Безубыточная цена с НДС: <b>${be!=null?dlRub0(be):'—'}</b>${dlQ('Цена, при которой прибыль после всех расходов и финансирования равна нулю. Ниже — убыток.')}</div></div>`}
    <div class="dl-now"><h4>Итог при текущей цене КП <span class="muted">${dlRub0(c.S)}</span></h4>
      ${bad?'<span class="dl-chip bad">Проверьте данные</span>':unk?'<span class="dl-chip warn">Нужна сумма ввозного НДС</span>':''}${noCost?`<span class="dl-chip warn">Расчёт неполный: нет закупки у ${noCost} поз.</span>`:''}
      <div class="dl-big${P!=null&&P<0?' neg':''}${unk?' rng':''}"><small>${r.K>0?'Прибыль до налога, за вычетом наличных':'Прибыль до налога на прибыль'}</small><b>${unk?`${dlRub0(lo.P)} … ${dlRub0(hi.P)}`:dlRub0(P)}</b>
        ${unk?'':`<p class="dl-note">Чистая прибыль после налога ${dlIn(c.taxP)} %${r.K>0?' и прочих расходов':''}: <b>${dlRub0(b.net)}</b></p>`}${r.K>0?`<p class="dl-note">С учётом прочих расходов наличными ${dlRub0(r.K)}</p>`:''}</div>
      <div class="dl-kpi"><div><small>Маржинальность ${dlQ('Прибыль ÷ выручка без НДС. Сколько копеек прибыли в каждом рубле выручки.')}</small><b>${unk?`${dlPct(lo.margin)} … ${dlPct(hi.margin)}`:dlPct(b.margin)}</b></div>
        <div><small>Наценка ${dlQ('Прибыль ÷ себестоимость (все расходы с финансированием, без НДС к вычету, и прочие расходы наличными).')}</small><b>${unk?`${dlPct(lo.markup)} … ${dlPct(hi.markup)}`:dlPct(b.markup)}</b></div></div>
      <dl class="dl-dl">
        <dt>Выручка без НДС</dt><dd>${dlRub0(c.R)}</dd>
        <dt>Себестоимость с финансированием</dt><dd>${dlRub0(r.Ctot)}</dd>
        <dt>в т. ч. финансирование</dt><dd>${dlRub0(c.F)}</dd>
        <dt>НДС к доплате</dt><dd>${dlRub0(r.payable)}</dd>
        ${r.K>0?`<dt>Прочие расходы (наличные)</dt><dd>${dlRub0(r.K)}${r.K!==r.X?`<small>на руки ${dlRub0(r.X)}</small>`:''}</dd>`:''}
        <dt>Налог на прибыль${r.K>0?' <small class="muted">— без учёта наличных</small>':''}</dt><dd>${dlRub0(r.tax)}</dd>
        <dt>Деньги на счёте после сделки</dt><dd>${dlRub0(r.cashAfter)}</dd></dl>
      ${parts?`<details class="dl-more dl-parts" data-more="parts"${dlMore('parts', false)}><summary>Из чего себестоимость</summary><dl class="dl-dl">${parts}</dl></details>`:''}
      ${c.warn.length?`<ul class="dl-warn">${c.warn.map(w=>`<li class="${w.bad?'bad':''}">${esc(w.t)}</li>`).join('')}</ul>`:''}</div>
  </div>`;
}

function dealRender(force){
  const dlg=$('#dealdlg'); if (!dlg || !dlg.isConnected || !dlg.open && !force) return;
  try{ dealRenderIn(dlg); }
  catch(e){ console.error(e); morph(dlg, `<div class="dlg-h"><h3>Экономика сделки</h3><button class="icon" type="button" data-dlx="close" aria-label="Закрыть">✕</button></div>
    <p class="msg err" style="margin:20px">Не удалось показать расчёт: ${esc(e.message||e)}. Сообщите разработчику; данные КП не изменены.</p>`); }
}

function dealRenderIn(dlg){
  const d=dlDeal(), kp=dlKp(), c=dealCalc(kp,d);
  if (dealSyncConds(c)) persist();
    const keyT = DL.key ? `ключевая ${dlIn(DL.key.rate)} % + ${DL_KEY_SPREAD}` : 'по умолчанию';
  const d0h=dlD0(), calT=d0h?dlCalNote(d0h).replace(/<[^>]+>/g,''):'';
  const head=`<div class="dlg-h"><h3>Экономика сделки${!DL.ex&&S.number?` · КП № ${esc(S.number)}`:''}<small>${esc(S.client||'Получатель не указан')}</small></h3>
      <label class="dl-hd${d0h?'':' empty'}"><span>Дата договора${dlQ('Ориентировочная дата заключения договора (день 0). От неё считаются сроки поставки и даты всех платежей; рабочие (банковские) дни — по производственному календарю РФ.'+(calT?' '+calT+'.':''))}</span><input type="date" data-dlstart value="${esc(d0h)}" aria-label="Дата договора"${DL.ex?' disabled':''}></label>
      <button class="btn" type="button" data-dlx="xlsx">Excel для согласования</button><button class="icon dl-maxb" type="button" data-dlx="max" aria-label="Во весь экран" title="Во весь экран / обычный размер. Размер окна можно менять, потянув за правый нижний угол">⤢</button><button class="icon" type="button" data-dlx="close" aria-label="Закрыть">✕</button></div>`;
  const banner = kp.sumNoRate ? `<div class="dl-ex warn">Нет курса валюты КП (${esc(kp.cur)}) — цена не переведена в рубли. Укажите курс в шаге «Цена КП и валюта».</div>` : '';
  const b=c.base, mini = b ? `<span><small>Прибыль при цене КП</small><b class="${b.P<0?'neg':''}">${dlRub0(b.P)}</b></span><span class="r"><small>Маржинальность</small><b>${dlPct(b.margin)}</b></span>`
    : `<span><small>Прибыль при цене КП</small><b>${dlRub0(c.lo.P)} … ${dlRub0(c.hi.P)}</b></span><span class="r warn-t">нужен ввозной НДС</span>`;
  const otherOpen = dlFilled(d.vo, d.warr, d.bonus), xK=(c.base||c.lo).K;
  const xNote=[c.W+c.Bn?`резерв и бонусы ${dlRub0(c.W+c.Bn)}`:'', c.BG?`банковская гарантия ${dlRub0(c.BG)}`:'', xK?`наличные ${dlRub0(xK)}`:''].filter(Boolean).join(', ');
  // шаги по порядку заполнения; свёрнутые — одной строкой; открыт один (или все — «Развернуть все шаги»)
  const hasCus=d.sup.some((s,k)=>!(c.sup[k].mode==='none' && /^росс/i.test(s.country||'')));
  const DL_TAB_SHORT={money:'Налог', sched:'График'};
  const order=[['buy','Закупка'], ...(hasCus?[['cus','Таможня']]:[]), ['cust','Оплата заказчика'], ['mnt','Расходы'], ['price','Цена КП'], ['money','Деньги и налог'], ['sched','График платежей']];
  DL.nav={}; order.forEach(([id],k)=>{ DL.nav[id]={n:k+1, next:order[k+1]&&order[k+1][0], nextT:order[k+1]&&order[k+1][1], prev:order[k-1]&&order[k-1][0], prevT:order[k-1]&&order[k-1][1]}; });
  DL.si=dlStepInfo(c);
  if (DL.open===undefined || !DL.nav[DL.open]) DL.open=(order.find(([id])=>DL.si[id]&&DL.si[id].st==='need')||order[0])[0];
  const tabs=`<nav class="dl-tabs" role="tablist" aria-label="Шаги расчёта">${order.map(([id,t],k)=>{ const st=(DL.si[id]||{}).st, on=DL.open===id;
    return `<button type="button" role="tab" aria-selected="${on}" class="dl-tab${on?' on':''}${st?' st-'+st:''}" data-dlx="step" data-id="${id}" title="${esc(t+': '+((DL.si[id]||{}).sum||''))}"><span class="dl-tn">${st==='ok'?'✓':st==='need'?'!':k+1}</span><span class="dl-tt">${DL_TAB_SHORT[id]||t}</span></button>`; }).join('')}</nav>`;
  const d0=dlD0();
  const cust=dlCustoms(c);
  const custStep=dlStep(0, 'Оплата заказчика', 'Когда и сколько платит заказчик. Выберите готовый вариант или впишите свои этапы; сроки — днями или датой.', dlCustomer(c), '', ['Итого заплатит заказчик', c.rows.filter(r=>r.inflow).reduce((a,r)=>a+r.amount,0), `${c.trs.filter(t=>t.p>0).length} ${plural(c.trs.filter(t=>t.p>0).length,'платёж','платежа','платежей')}, последний — ${d0?dlDayRu(c.Tend):'день '+c.Tend}`], 'cust');
  morph(dlg, `${head}${banner}<div class="dl-mini">${mini}</div><div class="dl-b"><div class="dl-tabw">${tabs}</div><div class="dl-form">
    ${dlPurchase(c)}
    ${cust}
    ${custStep}
    ${dlStep(0, 'Расходы', 'Всё необязательно: заполните то, что есть в сделке. Пустые поля не учитываются.', `<div class="dl-card dl-mb"><div class="dl-mbh"><h5>Монтаж, ПНР и прочие расходы</h5><span class="dl-stc opt">необязательно</span>${c.M+c.E+c.W+c.Bn>0?`<b class="dl-mbs">${dlRub0(c.M+c.E+c.W+c.Bn)}</b>`:''}</div><div class="dl-g g3">
      ${dlField('Монтаж и ПНР', 'mnt', {calc:c, unit:'₽', hint:'Платёж — при поставке'})}${dlField('ПНР займут', 'pnr', {calc:c, int:true, date:{base:c.D, val:c.pnrDays}, hint:'После поставки — для оплаты «после ПНР»'})}${dlField('Прочие расходы', 'oth', {calc:c, unit:'₽', hint:'Платёж — при поставке'})}</div>
      <details class="dl-more" data-more="oth"${dlMore('oth', otherOpen)}><summary>Ещё <span class="muted">— резерв на гарантию, бонусы с продажи, прочий НДС к вычету</span></summary><div class="dl-g g3">
        ${dlField('Резерв на гарантию', 'warr', {calc:c, unit:'% выручки', ph:'1', q:'Деньги на гарантийные случаи — процент от выручки без НДС.'})}${dlField('Бонусы и комиссии', 'bonus', {calc:c, unit:'% выручки', q:'Агентам, партнёрам, менеджерам — платятся после оплаты заказчика.'})}
        ${dlField('Прочий НДС к вычету', 'vo', {calc:c, unit:'₽', q:'НДС в монтаже и прочих расходах, если подрядчики с НДС.'})}</div></details></div>
      ${dlBg(c)}
      ${dlCash(c)}`, '', ['Итого расходы', c.M+c.E+c.W+c.Bn+c.BG+xK, xNote?'в т. ч. '+xNote:''], 'mnt') }
    ${dlStep(0, 'Цена КП и валюта', DL.ex?'Значения примера.':'Здесь меняются цены КП, валюта и курс — так же, как в разделе «Цены и валюта».', dlKpPrice(c), '', ['Цена КП с НДС', c.S, `выручка без НДС ${dlRub0(c.R)}, НДС ${dlIn(c.v)} % — ${dlRub0(c.VATs)}`], 'price')}
    ${dlStep(0, 'Деньги и налог', 'Обычно менять не нужно: стоимость денег — по ключевой ставке ЦБ, налог на прибыль — 25 %.', `<div class="dl-g g2">
      ${dlField('Стоимость денег', 'money', {calc:c, unit:'% в месяц', auto:kp.moneyAuto, autoLabel:keyT, autoTitle:DL.key?`Ключевая ставка ЦБ РФ ${dlIn(DL.key.rate)} % с ${DL.key.date} + ${DL_KEY_SPREAD} п.п. годовых, делённое на 12`:(DL.keyErr?'Ключевая ставка ЦБ недоступна: '+DL.keyErr:''),
        hint:DL.key?`Ключевая ставка ЦБ ${dlIn(DL.key.rate)} % + ${DL_KEY_SPREAD} п.п. = ${dlIn(DL.key.rate+DL_KEY_SPREAD)} % годовых → ${dlIn((DL.key.rate+DL_KEY_SPREAD)/12)} % в месяц`:'Процент в месяц на деньги, вложенные до оплаты заказчика',
        q:'Сколько стоят деньги, вложенные в сделку до оплаты заказчика: кредит или упущенный доход. По умолчанию — ключевая ставка ЦБ + 3 п.п. в год.'})}
      ${dlField('Налог на прибыль', 'tax', {calc:c, unit:'%', hint:'С 2025 года — 25 % (ст. 284 НК РФ)', q:'Считается с прибыли после всех расходов, включая финансирование. Проценты по кредиту уменьшают налог; если «стоимость денег» — упущенный доход на свои деньги, налоговая её не учитывает, и налог будет немного больше.'})}</div>`, '', ['Итого финансирование и налог', c.F+(c.base||c.lo).tax, `финансирование ${dlRub0(c.F)} + налог на прибыль ${dlRub0((c.base||c.lo).tax)}`], 'money')}
    ${dlSchedule(c, 0)}
    <div class="dl-foot"><span class="muted">Пересчёт — сразу при вводе. Закупка сохраняется в КП и каталоге.</span></div>
  </div><aside class="dl-side">${dlResult(c)}</aside></div>`);
}

// ---------- справочник кодов ТН ВЭД по категориям
// категории справочника ТН ВЭД: встроенные виды оборудования (значение из базы или справочное) и свои (cat:x_…)
function dlHsCats(){
  const cus=DL.cus||{}, out=TYPES.map(t=>{ const o=cus['cat:'+t.id]||{}, def=DEAL_HS[t.id]||{};
    const v=f=>o[f]!=null&&String(o[f])!==''?String(o[f]):(def[f]||'');
    return {key:'cat:'+t.id, id:t.id, name:t.name, code:v('code'), duty:v('duty'), note:o.note||def.note||'', own:false, edited:!!(o.code||o.duty)}; });
  for (const [k,o] of Object.entries(cus)) if (k.startsWith('cat:x_')) out.push({key:k, id:k.slice(4), name:o.name||'Своя категория', code:o.code||'', duty:o.duty||'', note:o.note||'', own:true});
  return out;
}

async function dlHsPut(key, o){
  await api('/api/customs',{method:'PUT',headers:{'Content-Type':'application/json; charset=utf-8'},body:JSON.stringify({key, code:o.code||'', duty:o.duty??'', note:o.note||'', name:o.name||''})});
  DL.cus=DL.cus||{}; if (key.startsWith('cat:x_') && !o.name) delete DL.cus[key]; else DL.cus[key]={...(DL.cus[key]||{}), ...o};
}

function dlHsDir(){
  const dd=$('#dlg'); dd.classList.add('wide');
  const draw=()=>{ const cats=dlHsCats();
    dd.innerHTML=`<div class="dlg-h"><h3>Коды ТН ВЭД и пошлины по категориям</h3><button class="icon" type="button" data-close aria-label="Закрыть">✕</button></div>
    <div class="dlg-b"><p class="muted">Код и ставка категории подставляются всем её моделям. У конкретной модели их можно изменить в «Экономике сделки» или выбрать категорию из этого справочника. Значения справочные (ЕТТ ЕАЭС) — точный код из 10 знаков подтверждает таможенный брокер.</p>
    <table class="dl-it dl-hsdir"><thead><tr><th>Категория</th><th>Код ТН ВЭД</th><th>Пошлина, %</th><th>Пояснение</th><th></th></tr></thead><tbody>
    ${cats.map(o=>`<tr data-key="${esc(o.key)}">
      <td>${o.own?`<input type="text" data-hf="name" value="${esc(o.name)}" placeholder="Название категории">`:`<b>${esc(o.name)}</b>${o.edited?'<small class="ok-t">изменено</small>':''}`}</td>
      <td><input type="text" data-hf="code" value="${esc(o.code)}" placeholder="0000 00"></td>
      <td><input type="text" inputmode="decimal" data-hf="duty" value="${esc(o.duty)}" placeholder="0"></td>
      <td>${o.own?`<input type="text" data-hf="note" value="${esc(o.note)}" placeholder="Что входит">`:`<span class="muted">${esc(o.note)}</span>`}</td>
      <td>${o.own?`<button type="button" class="icon" data-hdel aria-label="Удалить категорию">✕</button>`:o.edited?`<button type="button" class="lnk" data-hreset title="Вернуть справочное значение">↺</button>`:''}</td></tr>`).join('')}
    </tbody></table>
    <div class="row" style="gap:10px;margin-top:12px;align-items:center"><button type="button" class="btn" data-hadd>+ Добавить категорию</button><span class="muted">Изменения сохраняются сразу — в базе, для всего отдела.</span></div></div>`;
  };
  draw(); dd.showModal();
  dd.onclick=async e=>{ const t=e.target;
    if (t.closest('[data-close]')){ dd.close(); dd.classList.remove('wide'); dd.onclick=dd.onchange=null; return dealRender(); }
    if (t.closest('[data-hadd]')){ const key='cat:x_'+uid(); try{ await dlHsPut(key, {name:'Новая категория', code:'', duty:'0'}); draw(); dd.querySelector(`[data-key="${key}"] [data-hf="name"]`)?.select(); }catch(err){ toast('Не удалось добавить: '+(err.message||err)); } return; }
    const tr=t.closest('tr[data-key]'); if (!tr) return; const key=tr.dataset.key;
    if (t.closest('[data-hdel]')){ if (!await stConfirm('Удалить категорию?', 'Категория пропадёт из справочника; у моделей, где её выбрали, код и ставка останутся.', 'Удалить')) return;
      try{ await dlHsPut(key, {name:'', code:'', duty:''}); draw(); }catch(err){ toast('Не удалось удалить: '+(err.message||err)); } return; }
    if (t.closest('[data-hreset]')){ try{ await dlHsPut(key, {code:'', duty:''}); draw(); }catch(err){ toast('Не удалось: '+(err.message||err)); } } };
  dd.onchange=async e=>{ const t=e.target, tr=t.closest('tr[data-key]'); if (!t.dataset.hf || !tr) return;
    const key=tr.dataset.key, o={...(DL.cus[key]||{})}; tr.querySelectorAll('[data-hf]').forEach(i=>{ o[i.dataset.hf]=i.value.trim(); });
    if (key.startsWith('cat:x_') && !o.name){ toast('Укажите название категории'); return; }
    try{ await dlHsPut(key, o); toast('Сохранено в справочнике'); }catch(err){ toast('Не удалось сохранить: '+(err.message||err)); } };
}

// код и ставка позиции: у модели каталога — в базу (для всех следующих сделок), иначе — только в этом КП
async function dlSaveHs(itemId, f, v){
  const x=S.items.find(z=>z.id===itemId); if (!x) return; const d=dealEnsure(), h=dlHsOf(x), o={code:h.code, duty:h.duty}; o[f]=v.trim();
  if (x.catId){ const key='item:'+x.catId; DL.cus=DL.cus||{}; DL.cus[key]={...o};
    api('/api/customs',{method:'PUT',headers:{'Content-Type':'application/json; charset=utf-8'},body:JSON.stringify({key, code:o.code, duty:o.duty, note:''})}).catch(()=>toast('Код не сохранён в справочнике — проверьте связь с сервером')); }
  else { d.hs=d.hs||{}; d.hs[itemId]=o; }
}

// ---------- события окна
function dlWinSize(dlg, save){ try{
  if (save){ localStorage.setItem('kp.dealwin2', JSON.stringify({max:dlg.classList.contains('max'), w:dlg.style.width||'', h:dlg.style.height||''})); return; }
  const o=JSON.parse(localStorage.getItem('kp.dealwin2')||'{}')||{}; dlg.classList.toggle('max', !!o.max); if (o.w) dlg.style.width=o.w; if (o.h) dlg.style.height=o.h; }catch(e){} }

function dealBind(dlg){
  const touch=()=>{ if (DL.ex) return; S.deal.touched=true; persist(); renderSide(); };
  const comboClose=()=>{ if (!DL.combo) return; DL.combo=null; DL.comboIx=-1; dealRender(); };
  dlWinSize(dlg);
  let szT=null; if (window.ResizeObserver) new ResizeObserver(()=>{ if (!dlg.open || isMob() || dlg.classList.contains('max')) return; clearTimeout(szT);
    szT=setTimeout(()=>{ const r=dlg.getBoundingClientRect(); if (r.width>300){ dlg.style.width=Math.round(r.width)+'px'; dlg.style.height=Math.round(r.height)+'px'; dlWinSize(dlg,true); } }, 600); }).observe(dlg);
  dlg.addEventListener('input', e=>{ const t=e.target;
    if (t.dataset.costI!=null){ const x=S.items[+t.dataset.costI], n=dNum(t.value); x._costText=t.value; t.classList.toggle('bad', Number.isNaN(n));
      if (!Number.isNaN(n)) x.cost=n==null?0:Math.round(n*100); touch(); updateLive(); return dealRender(); }
    if (t.dataset.kppI!=null){ const x=S.items[+t.dataset.kppI], k=parsePrice(t.value); x._priceText=t.value; x.price=Number.isNaN(k)?0:k; x.priceManual=true;
      t.classList.toggle('bad', Number.isNaN(k)||!k); d0over(); touch(); updateLive(); return dealRender(); }
    if (t.dataset.kprate!=null){ S.pricing.rates[t.dataset.kprate]=t.value; S.pricing.rateSrc='вручную'; if (S.deal&&S.deal.rates) delete S.deal.rates[t.dataset.kprate]; touch(); updateLive(); return dealRender(); }
    if (t.dataset.kpvat!=null){ S.vat=t.value.replace(/[^\d.,]/g,''); touch(); updateLive(); return dealRender(); }
    if (t.dataset.hsI!=null){ dlSaveHs(t.dataset.hsI, t.dataset.f, t.value); touch(); return dealRender(); }
    const p=t.dataset.dl; if (!p || t.tagName==='SELECT') return;
    const d=dlDeal(); dlSet(d, p, t.value); if (!DL.ex) dealRememberDefault(p, t.value);
    if (t.dataset.combo){ DL.combo=p; DL.comboAll=false; DL.comboIx=-1; }
    dlSupChanged(p);
    if (/^sup\.(\d+)\./.test(p) && !DL.ex) dlSaveSupplier(d.sup[+/^sup\.(\d+)/.exec(p)[1]]);
    touch(); dealRender(); });
  // цена в КП поменялась вручную — «цена для расчёта» больше не нужна
  const d0over=()=>{ if (S.deal && S.deal.over) S.deal.over.price=''; };
  dlg.addEventListener('focusin', e=>{ const t=e.target; if (t.dataset.combo && DL.combo!==t.dataset.combo){ DL.combo=t.dataset.combo; DL.comboAll=true; DL.comboIx=-1; dealRender(); } });
  dlg.addEventListener('focusout', e=>{ const t=e.target;
    if (t.dataset.combo) setTimeout(()=>{ if (!document.activeElement?.closest?.('.dl-combo')) comboClose(); }, 150);
    if (t.dataset.costI!=null){ const x=S.items[+t.dataset.costI]; if (!Number.isNaN(dNum(x._costText))) delete x._costText; persist(); dealRender(); }
    if (t.dataset.kppI!=null){ const x=S.items[+t.dataset.kppI]; if (!Number.isNaN(parsePrice(x._priceText))) delete x._priceText; persist(); renderForm(); dealRender(); } });
  dlg.addEventListener('keydown', e=>{ const t=e.target; if (!t.dataset.combo) return; const n=(DL.comboList||[]).length;
    if (e.key==='ArrowDown'||e.key==='ArrowUp'){ e.preventDefault(); if (DL.combo!==t.dataset.combo){ DL.combo=t.dataset.combo; DL.comboAll=true; }
      DL.comboIx = n ? ((DL.comboIx??-1) + (e.key==='ArrowDown'?1:-1) + n) % n : -1; dealRender();
      dlg.querySelector('.dl-cbl [aria-selected="true"]')?.scrollIntoView({block:'nearest'}); }
    else if (e.key==='Enter'){ e.preventDefault(); if (DL.combo && DL.comboIx>=0 && DL.comboList[DL.comboIx]!=null) dlComboPick(t.dataset.combo, DL.comboList[DL.comboIx]); else comboClose(); }
    else if (e.key==='Escape' && DL.combo){ e.preventDefault(); e.stopPropagation(); comboClose(); }
    else if (e.key==='Tab') comboClose(); });
  dlg.addEventListener('cancel', e=>{ if (DL.combo){ e.preventDefault(); comboClose(); } });
  dlg.addEventListener('mousedown', e=>{ if (e.target.closest('.dl-cbl,.dl-cbb')) e.preventDefault(); });
  dlg.addEventListener('change', e=>{ const t=e.target;
    if (t.dataset.dlstart!=null){ if (DL.ex) return; dlDeal().start=t.value||''; touch(); return dealRender(); }
    if (t.dataset.dldate!=null){ const n=dlIsoDay(t.value); if (n==null||n<0){ toast('Дата раньше дня 0 — укажите дату не раньше подписания договора'); return dealRender(); }
      toast(dlSetRowDay(t.dataset.dldate, n)); touch(); return dealRender(); }
    if (t.dataset.dlday!=null){ const n=dNum(t.value); if (!(Number.isInteger(n) && n>=0)){ toast('День — целое число от 0'); return dealRender(); }
      toast(dlSetRowDay(t.dataset.dlday, n)); touch(); return dealRender(); }
    if (t.dataset.kpcur!=null){ kpSetCur(t.value); touch(); return; }
    if (t.dataset.dldd!=null){ if (DL.ex || !t.value) return; const d=dlDeal();
      if (!dlD0()){ d.start=new Date().toISOString().slice(0,10); toast('Дата договора — сегодня. Её можно изменить вверху окна'); }
      const base=+t.dataset.base||0, day=dlIsoDay(t.value), n=t.dataset.kind==='work' ? (day>=base ? dlCountWork(base, day) : -1) : day-base;
      if (!(n>=0)){ toast(`Дата раньше события, от которого считается срок (${dlDayRu(+t.dataset.base||0)}) — выберите дату позже`); return dealRender(); }
      dlSet(d, t.dataset.dldd, String(n)); const m=/^sup\.(\d+)\./.exec(t.dataset.dldd); if (m) dlSaveSupplier(d.sup[+m[1]]); touch(); return dealRender(); }
    if (t.dataset.xcst!=null){ const d=dlDeal(); d.xc=d.xc||{}; const off={...(d.xc.off||{})}; if (t.checked) delete off[t.dataset.xcst]; else off[t.dataset.xcst]=false; d.xc.off=off; touch(); return dealRender(); }
    if (t.dataset.costcurI!=null){ S.items[+t.dataset.costcurI].costCur=t.value; if (t.value!=='RUB' && !(rateOf(t.value)>0)) loadCBR(); touch(); updateLive(); return dealRender(); }
    if (t.dataset.kpvat!=null || t.dataset.kprate!=null){ renderForm(); return; }
    if (t.dataset.dl && t.tagName==='SELECT'){ dlSet(dlDeal(), t.dataset.dl, t.value); if (!DL.ex) dealRememberDefault(t.dataset.dl, t.value);
      const m=/^sup\.(\d+)\./.exec(t.dataset.dl); if (m && !DL.ex) dlSaveSupplier(dlDeal().sup[+m[1]]); touch(); dealRender(); }
    if (t.dataset.hspick!=null){ const o=dlHsCats().find(z=>z.key===t.value); if (o){ dlSaveHs(t.dataset.hspick, 'code', o.code); dlSaveHs(t.dataset.hspick, 'duty', o.duty); touch(); toast(`Код ${o.code||'—'}, пошлина ${o.duty||0} % — «${o.name}»`); } return dealRender(); }
    if (t.dataset.dlmap){ const d=dlDeal(); d.map={...(d.map||{}), [t.dataset.dlmap]:t.value}; touch(); dealRender(); } });
  // перетаскивание этапов оплаты мышью
  dlg.addEventListener('dragstart', e=>{ const h=e.target.closest&&e.target.closest('[data-dndh]'); if (!h) return;
    DL.drag={grp:h.dataset.dndh, from:+h.dataset.i}; e.dataTransfer.effectAllowed='move'; try{ e.dataTransfer.setData('text/plain', 'stage'); }catch(_){}
    const row=h.closest('.dl-tr'); if (row){ row.classList.add('dragging'); try{ e.dataTransfer.setDragImage(row, 20, 20); }catch(_){} } });
  const dropRow=e=>{ const r=e.target.closest&&e.target.closest('.dl-tr[data-dnd]'); return r && DL.drag && r.dataset.dnd===DL.drag.grp ? r : null; };
  dlg.addEventListener('dragover', e=>{ const r=dropRow(e); if (!r) return; e.preventDefault(); e.dataTransfer.dropEffect='move';
    const b=r.getBoundingClientRect(), after=e.clientY>b.top+b.height/2;
    dlg.querySelectorAll('.dl-tr.drop-b,.dl-tr.drop-a').forEach(x=>{ if (x!==r) x.classList.remove('drop-b','drop-a'); });
    r.classList.toggle('drop-a', after); r.classList.toggle('drop-b', !after); });
  dlg.addEventListener('drop', e=>{ const r=dropRow(e); if (!r) return; e.preventDefault();
    const b=r.getBoundingClientRect(), i=+r.dataset.i, from=DL.drag.from; let to=e.clientY>b.top+b.height/2 ? i+1 : i; if (to>from) to--;
    const msg=dlMoveStage(DL.drag.grp, from, to); DL.drag=null; if (msg){ touch(); toast(msg); } dealRender(); });
  // перетаскивание строк графика платежей: платёж получает дату строки, рядом с которой его отпустили
  dlg.addEventListener('dragstart', e=>{ const h=e.target.closest&&e.target.closest('[data-dnds]'); if (!h) return;
    DL.sdrag=h.dataset.dnds; e.dataTransfer.effectAllowed='move'; try{ e.dataTransfer.setData('text/plain', 'row'); }catch(_){}
    const row=h.closest('tr'); if (row){ row.classList.add('dragging'); try{ e.dataTransfer.setDragImage(row, 20, 20); }catch(_){} } });
  const sRow=e=>{ const r=e.target.closest&&e.target.closest('.dl-t tr[data-skey]'); return r && DL.sdrag ? r : null; };
  dlg.addEventListener('dragover', e=>{ const r=sRow(e); if (!r) return; e.preventDefault(); e.dataTransfer.dropEffect='move';
    const b=r.getBoundingClientRect(), after=e.clientY>b.top+b.height/2;
    dlg.querySelectorAll('.dl-t tr.drop-b,.dl-t tr.drop-a').forEach(x=>{ if (x!==r) x.classList.remove('drop-b','drop-a'); });
    r.classList.toggle('drop-a', after); r.classList.toggle('drop-b', !after);
    r.title = r.dataset.skey===DL.sdrag ? '' : 'Платёж получит дату '+(dlDayRu(+r.dataset.sday)||'день '+r.dataset.sday); });
  dlg.addEventListener('drop', e=>{ const r=sRow(e); if (!r) return; e.preventDefault();
    const key=DL.sdrag; DL.sdrag=null; if (r.dataset.skey===key || DL.ex) return dealRender();
    const msg=dlSetRowDay(key, +r.dataset.sday); touch(); toast(msg); dealRender(); });
  dlg.addEventListener('dragend', ()=>{ DL.sdrag=null; dlg.querySelectorAll('.dl-t tr.dragging,.dl-t tr.drop-b,.dl-t tr.drop-a').forEach(x=>x.classList.remove('dragging','drop-b','drop-a')); });
  dlg.addEventListener('dragend', ()=>{ DL.drag=null; dlg.querySelectorAll('.dl-tr.dragging,.dl-tr.drop-b,.dl-tr.drop-a').forEach(x=>x.classList.remove('dragging','drop-b','drop-a')); });
  dlg.addEventListener('toggle', e=>{ const k=e.target.dataset&&e.target.dataset.more; if (k!=null){ DL.more=DL.more||{}; DL.more[k]=e.target.open; } }, true);
  dlg.addEventListener('click', e=>{ const b=e.target.closest('[data-dlx]');
    if (DL.combo && !e.target.closest('.dl-combo')) comboClose();
    if (!b) return; const d=dlDeal(), a=b.dataset.dlx, k=+b.dataset.k;
    if (a==='close') return dlg.close();
    if (a==='max'){ dlg.classList.toggle('max'); dlWinSize(dlg,true); return; }
    if (a==='combo'){ const p=b.dataset.path; if (DL.combo===p) return comboClose(); DL.combo=p; DL.comboAll=true; DL.comboIx=-1; dealRender(); dlg.querySelector(`[data-combo="${p}"]`)?.focus(); return; }
    if (a==='pick') return dlComboPick(b.dataset.path, b.dataset.v);
    if (a==='cbr') return loadCBR();
    if (a==='xlsx') return dealXlsx();
    if (a==='hsdir') return dlHsDir();
    if (a==='apply') return dealApplyPrice(+b.dataset.s);
    if (a==='reset'){ dlSet(d, b.dataset.path, ''); }
    if (a==='resetdays') d.days={};
    if (a==='mv'){ const msg=dlMoveStage(b.dataset.grp, +b.dataset.i, +b.dataset.to); if (msg){ touch(); toast(msg); } return dealRender(); }
    if (a==='rowmv'){ if (DL.ex) return; const msg=dlRowStep(b.dataset.key, +b.dataset.d); if (msg){ touch(); toast(msg); } return dealRender(); }
    if (a==='step'){ DL.open=b.dataset.id; dealRender();
      // новая вкладка — с начала, без анимации прокрутки; на телефоне вкладки прилипают к верху прокрутки
      const f=dlg.querySelector('.dl-form'), bx=dlg.querySelector('.dl-b'), tw=dlg.querySelector('.dl-tabw'), t=dlg.querySelector('.dl-tabs');
      if (f) f.scrollTop=0; if (bx && tw && bx.scrollTop>tw.offsetTop) bx.scrollTop=tw.offsetTop;
      const on=t&&t.querySelector('.dl-tab.on'); if (on) t.scrollLeft=Math.max(0, on.offsetLeft-t.clientWidth/2+on.offsetWidth/2); return; }
    if (a==='addbg'){ const c=dealCalc(dlKp(), d); d.bg=[...(Array.isArray(d.bg)?d.bg:[]), {type:c.advSum>0?'adv':'perf', rate:String(DEAL_BG_RATE).replace('.',',')}]; }
    if (a==='delbg'){ d.bg=(d.bg||[]).filter((_,j)=>j!==k); }
    if (a==='where'){ const s=d.sup[k]; s.where=b.dataset.v;
      if (b.dataset.v==='ru'){ s.country='Россия'; dlApplyCountry(s); }
      else if (/^росс/i.test(s.country||'')){ s.country=''; s.cusMode='calc'; s.vatIn=false; }
      dlSaveSupplier(s); }
    if (a==='novat'){ d.sup[k].noVat=b.dataset.v==='1'; dlSaveSupplier(d.sup[k]); }
    if (a==='cusmode'){ d.sup[k].cusMode=b.dataset.v; dlSaveSupplier(d.sup[k]); }
    if (a==='trmode'){ const t=d.cust.tr[k], c=dealCalc(dlKp(), d), ct=c.trs[k];
      if (b.dataset.v==='sum' && t.mode!=='sum'){ t.mode='sum'; t.sum=ct&&ct.p?dlIn(Math.round(c.S*ct.p/100)):''; }
      else if (b.dataset.v==='pct' && t.mode==='sum'){ t.mode='pct'; t.pct=ct&&ct.p?dlIn(ct.p):''; } }
    if (a==='trpreset'){ d.cust.tr=JSON.parse(JSON.stringify(DL_TR_PRESETS[b.dataset.v][1])); d.days={}; }
    if (a==='addsp'){ const p=d.sup[k].pay; p.splice(p.length-1, 0, {name:'', pct:'', ev:'ready', off:'0'}); dlSaveSupplier(d.sup[k]); }
    if (a==='delsp'){ d.sup[k].pay.splice(+b.dataset.j, 1); dlSaveSupplier(d.sup[k]); }
    if (a==='sppreset'){ d.sup[k].pay=JSON.parse(JSON.stringify(DL_SP_PRESETS[b.dataset.v][1])); dlSaveSupplier(d.sup[k]); }
    if (a==='addtr'){ const tr=d.cust.tr; tr.splice(tr.length-1, 0, {name:'', pct:'', ev:tr.length>1?'ready':'sign', off:'0'}); }
    if (a==='deltr'){ d.cust.tr.splice(k,1); }
    if (a==='addsup'){ d.sup.push(dealNewSupplier('s'+Date.now().toString(36), dealDefaults())); }
    if (a==='delsup'){ const id=d.sup[k].id; d.sup.splice(k,1); for (const x in d.map) if (d.map[x]===id) delete d.map[x]; }
    touch(); dealRender(); });
}

// блок «Экономика сделки» в правой панели конструктора: текущий расчёт модуля (без открытия окна)
function dealSideBlock(){
  const its=(S.items||[]).filter(x=>String(x.name||'').trim());
  const btn='<button class="btn dl-open" type="button" data-a="deal">Экономика сделки →</button>';
  const lab='<div class="lab">Экономика сделки · в КП не выводится</div>';
  if (!its.length) return '';
  const withCost=its.filter(x=>x.cost>0).length;
  if (!withCost) return `<div class="mrg">${lab}<p class="mrg-n">Закупка не указана — укажите цены поставщика в «Экономике сделки», и здесь появятся прибыль, маржа, таможня и финансирование.</p>${btn}</div>`;
  let c; try{ c=dealCalc(dealKpInputs(), S.deal||dealBlank(dealDefaults())); }catch(e){ return `<div class="mrg">${lab}${btn}</div>`; }
  const b=c.base, r=b||c.lo, unk=!b, p=v=>v==null||!Number.isFinite(v)?'—':v.toFixed(1).replace('.',',')+' %';
  const P=unk?null:b.P, tg=S.deal&&S.deal.target, tv=tg?dNum(tg.v):null;
  const need=tv!=null&&!Number.isNaN(tv)?dealSolve(dealKpInputs(), S.deal, tg.type, tv):null;
  const TG={margin:'маржи',markup:'наценки',profit:'прибыли',net:'чистой прибыли'};
  const warn=c.warn.filter(w=>w.bad).concat(c.warn.filter(w=>!w.bad));
  return `<div class="mrg mrg-deal">${lab}
    <div class="mrg-p${P!=null&&P<0?' neg':''}"><small>Прибыль до налога</small><b>${unk?`${dlRub0(c.lo.P)} … ${dlRub0(c.hi.P)}`:dlRub0(P)}</b></div>
    <dl><dt>Маржинальность / наценка</dt><dd>${unk?'—':`${p(b.margin)} / ${p(b.markup)}`}</dd>
      <dt>Себестоимость</dt><dd>${dlRub0(r.Ctot)}</dd>
      ${c.Tsum?`<dt>Таможня (платим)</dt><dd>${dlRub0(c.Tsum)}</dd>`:''}
      <dt>Финансирование</dt><dd>${dlRub0(c.F)}</dd>
      ${r.K>0?`<dt>Прочие расходы (нал.)</dt><dd>${dlRub0(r.K)}</dd>`:''}
      ${unk?'':`<dt>Чистая прибыль</dt><dd>${dlRub0(b.net)}</dd>`}
      ${need!=null?`<dt>Цена для ${TG[tg.type]||'цели'} ${esc(tg.v)}${tg.type==='profit'||tg.type==='net'?' ₽':' %'}</dt><dd><b>${dlRub0(need)}</b></dd>`:''}</dl>
    ${withCost<its.length?`<p class="mrg-n warn-t">Закупка указана у ${withCost} из ${its.length} позиций</p>`:warn.length?`<p class="mrg-n ${warn[0].bad?'bad-t':'warn-t'}">${esc(warn[0].t)}</p>`:unk?'<p class="mrg-n warn-t">Нужна сумма ввозного НДС</p>':''}
    ${S.deal&&S.deal.touched?'':'<p class="mrg-n muted">Предварительно: условия поставщика — по умолчанию.</p>'}
    ${btn}</div>`;
}

// краткий итог для правой панели и журнала (только если расчёт заполнен)
function dealSummary(st=S){
  if (!st.deal || !st.deal.touched) return null;
  const c=dealCalc(dealKpInputs(st), st.deal), b=c.base;
  return b ? { confirmed:true, profit:Math.round(b.P*100)/100, net:Math.round(b.net*100)/100, margin:b.margin, markup:b.markup }
    : { confirmed:false, lo:Math.round(c.lo.P), hi:Math.round(c.hi.P), marginLo:c.lo.margin, marginHi:c.hi.margin };
}
