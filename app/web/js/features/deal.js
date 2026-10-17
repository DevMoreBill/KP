// Окно «Экономика сделки» — здесь вводится закупка и подбирается цена продажи. Расчёт — js/features/deal-calc.js,
// выгрузка в Excel — js/features/deal-xlsx.js. Документ КП не меняется: данные — в S.deal; цены позиций КП меняются
// только кнопкой «Перенести цены в КП». Закупка позиции хранится у позиции (cost, costCur) — её сохраняет каталог.
// Видят только автор КП и администратор (на сервере расчёт чужого КП не отдаётся и не перезаписывается — app/admin.py).
// Внешние данные: курсы ЦБ (раздел «Цены»), ключевая ставка ЦБ (/api/cbr/keyrate) — стоимость денег.
// Справочники в базе (общие для отдела): поставщики (/api/suppliers) и коды ТН ВЭД / пошлины (/api/customs).
// Логистика поставщика (доставка по России) — js/features/logistics.js пишет её в S.deal.sup[].logRu (src:'module').
'use strict';

const DL = { cal:{}, calLoading:{}, ex:false, exKp:null, exDeal:null, key:null, keyErr:'', sups:null, cus:null, saveT:{} };
const DL_DEF_KEYS = { money:'money', tax:'tax', 'target.v':'target', 'target.type':'targetType' };
const dlSpread = () => DEFN('deal.spread', 3);   // стоимость денег по умолчанию: ключевая ставка ЦБ + п.п. годовых (Настройки → Умолчания)

// последние значения менеджера в этом браузере (стоимость денег, налог, цель); заданное администратором в «Умолчаниях» — главнее
function dealDefaults(){ let o={}; try{ o=JSON.parse(localStorage.getItem('kp.dealDef')||'{}')||{}; }catch(e){ o={}; }
  const set=k=>DEFS_SRV[k] && typeof DEFS_SRV[k]==='object';
  if (set('deal.tax')) delete o.tax; if (set('deal.spread')) delete o.money; if (set('deal.target')){ delete o.target; delete o.targetType; }
  return o; }

function dealRememberDefault(path, v){ const k=DL_DEF_KEYS[path]; if (!k) return; try{ const o=dealDefaults(); o[k]=v; localStorage.setItem('kp.dealDef', JSON.stringify(o)); }catch(e){} }

// расчёт виден автору КП (кто его создал на своём устройстве) и администратору; новое несохранённое КП — своё
function dealAllowed(st=S){
  if (!FEAT.on('deal') || !can('dealView')) return false;
  if (ADMIN.on || !st.kpId) return true;
  const me=meId(); if (!me) return false;
  return st.authorId ? st.authorId===me : st.managerId===me;
}

const dlMoneyAuto = () => DL.key && DL.key.rate>0 ? (DL.key.rate+dlSpread())/12 : DealValues.n('deal.moneyFb', 2);

// производственный календарь РФ (/api/calendar, данные isdayoff.ru / xmlcalendar.ru): '1' — нерабочий день
function dlCalYears(iso){ const y=+String(iso||'').slice(0,4); return y ? [y, y+1, y+2] : []; }
function dlCalLoad(iso){ const need=dlCalYears(iso).filter(y=>!DL.cal[y] && !DL.calLoading[y]); if (!need.length) return;
  need.forEach(y=>{ DL.calLoading[y]=true;
    api('/api/calendar?year='+y).then(r=>{ if (r && r.days) DL.cal[y]=r; }).catch(()=>{}).finally(()=>{ delete DL.calLoading[y]; dealRender(); SidePanel.render(); }); }); }
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
    // строки закупки: обычная позиция — как есть, сборка — по элементам (у каждого своя валюта и поставщик)
    items:kitLines(st).map(l=>{ const x=l.item, h=DealHs.of(x, st.deal);
      return {id:l.id, name:l.of?`${l.of}: ${l.name}`:l.name, qty:l.qty, cost:(l.cost||0)/100, cur:l.costCur||'RUB', cat:attrsOf(x).cat, maker:l.maker||'', catId:x.catId||'', kit:!!l.part, role:(l.part&&l.part.role)||'',
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

const DL_SUP_KEYS=['wh','whGeo','country','cur','vatIn','noVat','adv','pay','prod','ship','prodK','shipK','cusMode','ivat','ins','fx'];

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
    const was=(DL.sups||[]).find(x=>x.id===id);   // номер правки — чтобы не затереть изменения коллеги
    // поля справочника, которых нет в расчёте (реквизиты, склады, контакты, оборудование), — не трогаем
    const doc={ ...(was||{}), name:s.name.trim(), ...Object.fromEntries(DL_SUP_KEYS.map(k=>[k,s[k]??''])), makers:[...new Set([...((was&&was.makers)||[]), ...makers])], ...(was&&was._rev!=null?{_rev:was._rev}:{}) };
    delete doc.id; delete doc.updatedAt;
    try{ const saved=await api('/api/suppliers/'+id,{method:'PUT',headers:{'Content-Type':'application/json; charset=utf-8'},body:JSON.stringify(doc)});
      s.dirId=id; DL.sups=(DL.sups||[]).filter(x=>x.id!==id).concat(saved); persist(); }catch(e){} }, 1200);
}

function dlSupOf(itemId){ const d=S.deal; if (!d) return ''; const s=d.map&&d.map[itemId]; return d.sup.some(x=>x.id===s) ? s : d.sup[0].id; }

// новый расчёт: поставщики — по производителям позиций (из справочника, если есть), страна задаёт таможню и валюту
// строки без выбранного поставщика (новые позиции, элементы сборки): к поставщику с тем же названием, а если его нет и
// у элемента указан поставщик — новая карточка поставщика (условия — из справочника)
function dlAutoMap(d){
  const def=dealDefaults(); d.map=d.map||{};
  for (const l of kitLines(S)){ if (d.map[l.id] && d.sup.some(s=>s.id===d.map[l.id])) continue;
    const mk=String(l.maker||'').trim(); if (!mk) continue;
    let s=d.sup.find(z=>norm(z.name)===norm(mk));
    if (!s && l.part){ const blank=d.sup.length===1 && !String(d.sup[0].name||'').trim() && !Object.values(d.map).includes(d.sup[0].id);
      s=blank ? d.sup[0] : dealNewSupplier('s'+(Math.max(0,...d.sup.map(z=>+String(z.id).replace(/\D/g,'')||0))+1), def);
      s.name=mk; const p=dlDir(mk); if (p) dlApplyDir(s,p); if (!blank) d.sup.push(s); }
    if (s) d.map[l.id]=s.id; }
}

// сборка станции: если в КП есть станция — элементы по умолчанию едут на сборку к поставщику контейнера
function dlAsmAuto(d){
  const parts=kitLines(S).filter(l=>l.part); if (!parts.length) return;
  if (!d.asm) d.asm={on:true, sup:'', days:'10', daysK:'work', cost:{v:''}};
  if (d.asm.on!==false && !d.sup.some(z=>z.id===d.asm.sup)){ const c=parts.find(l=>l.part.role==='container'); if (c) d.asm.sup=dlSupOf(c.id); }
}

function dealEnsure(){
  if (S.deal && S.deal.v){ dealUpgrade(S.deal); if (!S.deal.hs) S.deal.hs={}; dlAutoMap(S.deal); dlAsmAuto(S.deal); dlStartAuto(S.deal); return S.deal; }
  const def=dealDefaults(), d=dealBlank(def); d.hs={}; if (def.target) d.target={type:def.targetType||'margin', v:def.target};
  const its=kitLines(S).filter(x=>String(x.name||'').trim());
  // позиция каталога, закреплённая в справочнике за поставщиком, — к нему; остальные — по производителю (у элемента сборки — по его поставщику)
  const dirOfItem = x => x.item.catId && (DL.sups||[]).find(p=>(p.items||[]).includes(x.item.catId));
  const keyOf = x => { const p=dirOfItem(x); return p ? '\u0001'+p.id : x.maker||''; };
  const keys=[...new Set(its.map(keyOf))];
  d.sup=[]; d.map={};
  keys.forEach((mk,k)=>{ const s=dealNewSupplier('s'+(k+1), def); const pd=mk[0]==='\u0001' ? (DL.sups||[]).find(p=>'\u0001'+p.id===mk) : null; s.name=pd?pd.name:mk;
    const p=pd||dlDir(mk); if (p) dlApplyDir(s,p);
    else { const cur=its.find(x=>keyOf(x)===mk && x.cost)?.costCur;      // страна по умолчанию — из «Умолчаний» (обычно Россия)
      if (cur && cur!=='RUB'){ s.cur=cur; if (!s.country){ s.cusMode='calc'; s.log.cur=cur; } } }
    d.sup.push(s); its.filter(x=>keyOf(x)===mk).forEach(x=>{ d.map[x.id]=s.id; }); });
  if (!d.sup.length) d.sup=[dealNewSupplier('s1', def)];
  S.deal=d; dlAsmAuto(d); dlStartAuto(d); return d;
}

// дата договора по умолчанию — сегодня (startAuto): пока её не указали вручную, каждый день сдвигается на сегодня,
// в шапке окна — напоминание «уточните»
function dlStartAuto(d){ if (DL.ex || !d || (!d.start && !DEF('deal.startToday'))) return;
  if (!d.start){ d.start=today(); d.startAuto=true; } else if (d.startAuto && d.start!==today()) d.start=today(); }

const dlKp = () => DL.ex ? DL.exKp : dealKpInputs();
const dlDeal = () => DL.ex ? DL.exDeal : dealEnsure();

const dlRub = n => n==null||!Number.isFinite(n) ? '—' : n.toLocaleString('ru-RU',{minimumFractionDigits:2, maximumFractionDigits:2})+' ₽';

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

async function openDeal(){
  if (!dealAllowed()){ toast('Экономика сделки доступна автору КП и администратору'); return; }
  DL.ex=false; DL.open=undefined;
  const d=Modal.host('dealdlg', 'dealwin', 'Экономика сделки', dealBind);
  // окно открывается сразу, содержимое — после загрузки справочников (повторное открытие тоже рисуется заново)
  if (!d.open){ d.innerHTML='<div class="dlg-h"><h3>Экономика сделки</h3><button class="icon" type="button" data-dlx="close" aria-label="Закрыть">✕</button></div><p class="empty">Загружаю…</p>'; d.showModal(); }
  await Promise.all([dlLoadDirs(), lgLoadAll()]); dealEnsure();
  d.innerHTML=''; dealRender(true);
}

// ---------- элементы формы
function dlQ(text){ return `<details class="dl-q"><summary aria-label="Пояснение">?</summary><div>${text}</div></details>`; }

function dlField(label, path, o={}){
  const d=dlDeal(), c=o.calc, raw=getPath(d,path), e=c&&c.err[path];
  let val=raw??'', badge='';
  if (o.kp!==undefined){ const own=raw!=null&&raw!==''; val= own?raw:dlIn(o.kp);
    badge = own ? `<button type="button" class="dl-badge own" data-dlx="reset" data-path="${path}" title="Вернуть значение из КП">изменено · ↺</button>`
      : `<span class="dl-badge kp">${DL.ex?'пример':esc(o.kpLabel||'из КП')}</span>`; }
  if (o.auto!==undefined){ const own=raw!=null&&raw!=='';
    if (!own){ val=dlIn(o.auto); badge=`<span class="dl-badge kp" title="${esc(o.autoTitle||'')}">${esc(o.autoLabel||'авто')}</span>`; }
    else badge=`<button type="button" class="dl-badge own" data-dlx="reset" data-path="${path}" title="Вернуть расчёт">вручную · ↺</button>`; }
  if (o.unknown && (raw==null||raw==='')) badge=`<span class="dl-badge warn">неизвестно</span>`;
  if (o.src==='module') badge=`<span class="dl-badge kp">из расчёта логистики</span>`;
  const cur = o.cur ? `<select data-dl="${o.cur}" aria-label="Валюта">${DEAL_CURS.map(k=>`<option${(getPath(d,o.cur)||'RUB')===k?' selected':''}>${k}</option>`).join('')}</select>` : '';
  const inp = o.select ? `<select data-dl="${path}" aria-label="${esc(label)}">${o.select.map(([v,t])=>`<option value="${esc(v)}"${String(raw??o.select[0][0])===String(v)?' selected':''}>${esc(t)}</option>`).join('')}</select>`
    : `<input type="text" inputmode="${o.text?'text':o.int?'numeric':'decimal'}" data-dl="${path}" value="${esc(val)}" placeholder="${esc(o.ph??'0')}" autocomplete="off"${o.list?` list="${o.list}"`:''}${e?' aria-invalid="true"':''}${o.text?' class="tx"':''}>`;
  const dd = o.date ? dlDateIn(path, o.date.base, o.date.val, label, o.date.kind===false?'':getPath(d, path+'K')) : '';
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
function dlDayKind(path){ const k=getPath(dlDeal(), path+'K')==='work';
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
  const d=dlDeal(), val=getPath(d,path)??'', open=DL.combo===path, q=dlNorm(val);
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

function dlComboPick(path, v){ const d=dlDeal(); setPath(d, path, v); dlSupChanged(path); DL.combo=null; DL.comboIx=-1;
  const m=/^sup\.(\d+)\./.exec(path); if (m && !DL.ex) dlSaveSupplier(d.sup[+m[1]]); if (!DL.ex){ S.deal.touched=true; persist(); SidePanel.render(); } dealRender(); }

// раскрывающийся блок «Ещё…»: открыт, если пользователь его открыл (DL.more), иначе — по умолчанию (def)
const dlMore = (key, def) => ((DL.more && key in DL.more) ? DL.more[key] : def) ? ' open' : '';

const dlFilled = (...v) => v.some(x=>x!=null && String(x).trim()!=='' && String(x).trim()!=='0');

// шаг — карточка-аккордеон; tot: [подпись, сумма, пояснение] — итог шага; id — шаг в DL.nav (номер, следующий шаг)
// свёрнутый шаг — одна строка: что заполнено (DL.si[id].sum) и отметка «заполнено / нужно заполнить / необязательно»
function dlStep(n, title, sub, body, cls='', tot=null, id=''){
  const nav=(DL.nav||{})[id], num=nav?nav.n:n;
  if (id && DL.open!==id) return '';
  // пояснение шага — в «?» рядом с названием: шапка шага — одна строка
  const head=`<span class="dl-n">${num}</span><div class="dl-sht"><h4>${title}</h4>${sub?dlQ(sub):''}</div>`;
  const go=nav ? `<div class="dl-next">${nav.prev?`<button type="button" class="btn" data-dlx="step" data-id="${nav.prev}">← ${esc(nav.prevT)}</button>`:'<span></span>'}${nav.next?`<button type="button" class="btn primary" data-dlx="step" data-id="${nav.next}">Далее: ${esc(nav.nextT)} →</button>`:''}</div>` : '';
  return `<section class="dl-step ${cls}"${id?` data-stepid="${id}" role="tabpanel"`:''}><div class="dl-sh">${head}</div>${body}${tot?dlTot(...tot):''}</section>${go}`;
}

// состояние и краткий итог каждого шага — для свёрнутых карточек и выбора шага, который открыть первым
function dlStepInfo(c){
  const d=dlDeal(), b=c.base||c.lo, si={}, d0=dlD0();
  const when=day=>d0?dlDayRu(day):`день ${day}`;
  const its=DL.ex?[]:kitLines(S).filter(x=>String(x.name||'').trim()), noCost=its.filter(x=>!(x.cost>0)).length;
  si.buy={ st: noCost||d.sup.some(x=>!String(x.name||'').trim())?'need':'ok',
    sum: noCost ? `Нет цены закупки у ${noCost} из ${its.length} поз.` : c.sup.filter(x=>x.equip>0||c.sup.length===1).map(x=>`${x.name}${x.country?' ('+x.country+')':''}: ${Fmt.rub(x.equip)}, готово — ${when(x.rdy)}, у заказчика — ${when(x.arr)}`).join(' · ') };
  const lgr=d.sup.map(s=>LG.res[s.id]).filter(Boolean), lgNeed=lgr.some(r=>r.need && !/нет позиций/.test(r.need));
  si.log={ st: DL.ex ? 'ok' : lgNeed ? 'need' : 'ok',
    sum: c.sup.map((x,k)=>{ const r=LG.res[d.sup[k].id], f=LG.fin[d.sup[k].id];
      return `${x.name}: ${r&&r.from&&r.to?`${r.from.name} → ${r.to.name}, ${r.km} км, `:''}${Fmt.rub(x.L+x.Lru+x.ins)}${f&&d.sup[k].lg&&d.sup[k].lg.mode!=='manual'?` (${f.name})`:''}`; }).join(' · ') };
  const noDuty=c.sup.some(x=>x.noDuty.length);
  si.cus={ st: noDuty||c.unknown.length?'need':'ok',
    sum: noDuty ? 'Укажите ставку пошлины у позиций' : c.unknown.length ? 'Укажите ввозной НДС к вычету' : c.Tsum ? `Платим на таможне ${Fmt.rub(c.Tsum)}, в себестоимость ${Fmt.rub(c.sup.reduce((a,x)=>a+x.T-(x.vi||0),0))}` : 'Таможни нет' };
  const inn=c.rows.filter(r=>r.inflow&&r.amount>0);
  si.cust={ st:'ok', sum: inn.map(r=>{ const t=c.trs[r.stage]; return `${(t&&t.name)||dlPctTxt(r.pct||0)}${t&&t.name?' '+dlPctTxt(r.pct||0):''} — ${when(r.day)}`; }).join(' · ') || 'Оплата заказчика' };
  const mnt=[c.M?`монтаж ${Fmt.rub(c.M)}`:'', c.Dc?`документация ${Fmt.rub(c.Dc)}`:'', c.E?`прочие ${Fmt.rub(c.E)}`:'', c.W+c.Bn?`резерв и бонусы ${Fmt.rub(c.W+c.Bn)}`:'', c.BG?`банковская гарантия ${Fmt.rub(c.BG)}`:'', b.K?`наличные ${Fmt.rub(b.K)}`:''].filter(Boolean);
  si.mnt={ st: mnt.length?'ok':'opt', sum: mnt.length ? mnt.join(' · ') : 'Монтаж, ПНР, документация, банковская гарантия, наличные — если есть' };
  si.price={ st: c.S>0?'ok':'need', sum: c.S>0 ? `${Fmt.rub(c.S)} с НДС ${dlIn(c.v)} %` : 'Нет цены для заказчика' };
  si.money={ st:'opt', sum:`Деньги ${dlIn(c.i)} % в месяц · НДС ${dlIn(c.v)} % · налог на прибыль ${dlIn(c.taxP)} %` };
  const peak=c.rows.reduce((m,r)=>Math.min(m,r.balance),0);
  si.sched={ st:'info', sum:`${c.Tend} ${plural(c.Tend,'день','дня','дней')} до последней оплаты · финансирование ${Fmt.rub(c.F)}${peak<0?` · пик вложений ${Fmt.rub(-peak)}`:''}` };
  return si;
}

const dlTot=(lab, v, note)=>`<div class="dl-stot"><span>${note?`<small>${note}</small>`:''}</span><div><small>${esc(lab)}</small><b>${Fmt.rub(v)}</b></div></div>`;

// ---------- обзор «Кратко»: итог простыми словами, чего не хватает, поставщики и сроки на одной ленте, деньги в обороте
const DL_STEP_T = { buy:'Закупка', log:'Логистика', cus:'Таможня', cust:'Оплата заказчика', mnt:'Расходы', price:'Цена КП', money:'Деньги и налог', sched:'График платежей' };
function dlOverview(c){
  if (DL.open!=='sum') return '';
  const b=c.base||c.lo, si=DL.si||{}, d0=dlD0(), when=day=>d0?dlDayRu(day):`день ${day}`;
  const need=Object.entries(si).filter(([id,x])=>x.st==='need' && DL_STEP_T[id] && (DL.nav||{})[id]);
  const needTxt={ log:'укажите склад поставщика и адрес объекта (или свою сумму доставки)', cus:'проверьте коды ТН ВЭД, пошлину и ввозной НДС' };
  const st = need.length ? 'need' : b.P>0 ? 'ok' : 'bad';
  const verdict = st==='need' ? 'Расчёт неполный — заполните отмеченное' : st==='ok' ? 'Сделка прибыльна' : 'Сделка убыточна при этой цене';
  const range = !c.base;
  const tile=(t,v,cls='',sub='')=>`<div class="dlo-t ${cls}"><small>${t}</small><b>${v}</b>${sub?`<span>${sub}</span>`:''}</div>`;
  const per100 = c.R>0 ? `Из каждых 100 ₽ выручки без НДС: <b>${dlIn(Math.max(0,100-b.margin))} ₽</b> — затраты, <b>${dlIn(b.margin)} ₽</b> — прибыль до налога.` : '';
  const head=`<div class="dlo-v st-${st}"><div class="dlo-vh"><span class="dlo-ic">${st==='ok'?'✓':st==='need'?'!':'✕'}</span><h4>${verdict}</h4></div>
    <div class="dlo-tiles">${tile('Цена КП с НДС', Fmt.rub(c.S))}${tile('Прибыль до налога', range?`${Fmt.rub(c.lo.P)} … ${Fmt.rub(c.hi.P)}`:Fmt.rub(b.P), b.P<0?'neg':'pos')}
      ${tile('Маржинальность', dlPct(b.margin), b.margin<0?'neg':'')}${tile('Чистая прибыль', Fmt.rub(b.net), b.net<0?'neg':'', `после налога ${dlIn(c.taxP)} %`)}</div>
    ${per100?`<p class="dlo-p">${per100}</p>`:''}
    ${need.length?`<ul class="dlo-need">${need.map(([id,x])=>`<li><button type="button" class="lnk" data-dlx="step" data-id="${id}">${esc(DL_STEP_T[id])}</button> — ${esc(needTxt[id]||x.sum||'нужно заполнить')}</li>`).join('')}</ul>`:''}</div>`;
  // лента: поставщики (производство → доставка), монтаж и ПНР, оплаты заказчика
  const act=c.sup.filter(s=>s.active||c.sup.length===1), end=Math.max(1, c.Tend||0, c.pnrEnd||0, c.D||0, ...act.map(s=>s.arr));
  const X=day=>Math.max(0,Math.min(100, day/end*100)).toFixed(2)+'%', W=(a,z)=>Math.max(0.8,(z-a)/end*100).toFixed(2)+'%';
  // отрезок ленты: срок внутри (если помещается), подробности — во всплывающей подсказке; подпись даты — под лентой у конца
  const seg=(cls, a, z, title)=>z>a||cls==='pr' ? `<i class="${cls}" style="left:${X(a)};width:${W(a,z)}" title="${esc(title)}: ${z-a} дн."><span>${z-a>0?(z-a)+' дн.':''}</span></i>` : '';
  const endL=(day, text, badge, bt)=>`<em class="${day/end<0.18?'l':''}" style="left:${X(day)}">${text}${badge?` <b class="dlo-crit" title="${esc(bt||'')}">${badge}</b>`:''}</em>`;
  const payTxt=s=>s.stages.filter(t=>t.p>0).map(t=>`${t.name||(t.j===0&&t.ev==='order'?'аванс':t.last&&s.stages.length>1?'остаток':'оплата')} ${dlPctTxt(t.p)} — ${DEAL_SUP_EVENTS[t.ev]}${t.off?` + ${t.off} дн.`:''}`).join('; ');
  const rows=act.map(s=>{ const sup=c.sup.indexOf(s);
    return `<div class="dlo-r"><div class="dlo-rl"><b>${esc(s.name)}</b><small>${s.lines.length?esc(s.lines.map(l=>l.name.replace(/^.*?: /,'')).slice(0,3).join(', ')+(s.lines.length>3?` и ещё ${s.lines.length-3}`:'')):'позиции не выбраны'}</small>
        <small>закупка <b>${Fmt.rub(s.equip)}</b>${s.L+s.Lru+s.T>0?` · доставка и таможня ${Fmt.rub(s.L+s.Lru+s.T)}`:''}</small><small class="muted">${esc(payTxt(s))}</small></div>
      ${s.isAsm?`<div class="dlo-bar" role="img" aria-label="${esc(`${s.name}: контейнер готов ${when(s.cRdy)}, сборка ${when(s.asmStart)} — ${when(s.rdy)}, станция у заказчика ${when(s.arr)}`)}">
        ${seg('pr',0,s.cRdy,'Контейнер')}${seg('wt',s.cRdy,s.asmStart,'Ждём элементы')}${seg('asm',s.asmStart,s.rdy,'Сборка и испытания')}${seg('tr',s.rdy,s.arr,'Доставка станции')}
        ${endL(s.arr, `станция у заказчика ${when(s.arr)}`)}</div>`
      :`<div class="dlo-bar" role="img" aria-label="${esc(`${s.name}: готово к отгрузке ${when(s.rdy)}, ${s.toAsm?'на сборке':'у заказчика'} ${when(s.arr)}`)}">
        ${seg('pr',0,s.rdy,'Производство')}${seg('tr'+(s.toAsm?' toasm':''),s.rdy,s.arr,s.toAsm?'Доставка на сборку':'Доставка')}
        ${endL(s.arr, `${s.toAsm?'на сборке':'у заказчика'} ${when(s.arr)}`, (!c.asm && c.D===s.arr && act.length>1)?'срок изделия':c.asm&&c.asm.late.includes(s)?'последний на сборку':'', c.asm?'Приезжает на сборку последним — от него зависит начало сборки':'Самая долгая поставка — от неё зависит срок всего изделия')}</div>`}
      <button type="button" class="icon dlo-go" data-dlx="step" data-id="buy" data-sup="${sup}" aria-label="Изменить условия поставщика" title="Изменить: закупка, сроки, оплата">›</button></div>`; }).join('');
  const pnr=c.pnrDays>0?`<div class="dlo-r"><div class="dlo-rl"><b>Монтаж и ПНР</b><small>${c.pnrDays} дн. после поставки</small></div><div class="dlo-bar">${seg('pnr',c.D,c.pnrEnd,'Монтаж и ПНР')}${endL(c.pnrEnd, 'готово '+when(c.pnrEnd))}</div><span></span></div>`:'';
  const inn=c.rows.filter(r=>r.inflow&&r.amount>0);
  const cust=`<div class="dlo-r cust"><div class="dlo-rl"><b>Оплата заказчика</b><small>${inn.length} ${plural(inn.length,'платёж','платежа','платежей')}, всего ${Fmt.rub(inn.reduce((a,r)=>a+r.amount,0))}</small></div>
    <div class="dlo-bar">${inn.map(r=>`<span class="dlo-pay${r.day/end>0.9?' r':''}" style="left:${X(r.day)}" title="${esc(`${dlPctTxt(r.pct||0)} — ${Fmt.rub(r.amount)}, ${when(r.day)}`)}">${dlIn(r.pct||0)} %</span>`).join('')}</div>
    <button type="button" class="icon dlo-go" data-dlx="step" data-id="cust" aria-label="Изменить оплату заказчика" title="Изменить оплату заказчика">›</button></div>`;
  // деления оси — без наложения: ближе 7 % ширины к предыдущему не ставятся
  const ticks=[0, ...new Set([...act.map(s=>s.arr), c.Tend].filter(x=>x>0))].sort((a,z)=>a-z).filter((t,k,arr)=>k===0 || t-arr.slice(0,k).reduce((m,x)=>Math.max(m,x),0)>=end*0.07 || t===c.Tend);
  // подпись вплотную к предыдущей (последняя оплата через несколько дней после договора) — второй строкой, без наложения
  const lo=ticks.map((t,k)=>k>0 && (t-ticks[k-1])/end<0.12);
  const axis=`<div class="dlo-r ax"><span></span><div class="dlo-bar">${ticks.map((t,k)=>`<span class="dlo-tk${t/end>0.9?' r':''}${lo[k]&&!lo[k-1]?' lo':''}" style="left:${X(t)}">${d0?dlIsoRu(dlDayIso(t)).slice(0,5):'день '+t}</span>`).join('')}</div><span></span></div>`;
  const peak=c.rows.reduce((m,r)=>Math.min(m,r.balance),0), pk=c.rows.find(r=>r.balance===peak);
  const money=`<div class="dlo-m"><div><small>Своих денег в сделке на пике</small><b>${peak<-0.5?Fmt.rub(-peak):'0 ₽'}</b><span>${peak<-0.5&&pk?when(pk.day):'платежи покрывают оплаты заказчика'}</span></div>
    <div><small>Деньги вернутся</small><b>${when(c.Tend)}</b><span>последняя оплата заказчика</span></div>
    <div><small>Стоимость этих денег</small><b>${Fmt.rub(c.F)}</b><span>${dlIn(c.i)} % в месяц — уже в себестоимости</span></div></div>`;
  return `<section class="dl-step dlo" data-stepid="sum" role="tabpanel">${head}
    <div class="dl-card dlo-tl"><div class="dlo-th"><h5>Поставщики и сроки</h5><span class="muted">${d0?'от даты договора':'дни от подписания договора — укажите дату договора вверху, чтобы видеть даты'}</span>
      <span class="dlo-lg"><i class="pr"></i>производство <i class="tr"></i>доставка${c.asm?' <i class="asm"></i>сборка станции':''}${c.pnrDays>0?' <i class="pnr"></i>ПНР':''}</span></div>
      ${rows}${pnr}${cust}${axis}
      ${c.asm?`<p class="muted dlo-note">Элементы едут на сборку к «${esc(c.asm.A.name)}»: сборка ${when(c.asm.start)} — ${when(c.asm.end)}, станция у заказчика ${when(c.asm.arr)}. Условия — на вкладке «Закупка», маршруты — на вкладке «Логистика».</p>`:act.length>1?`<p class="muted dlo-note">Изделие у заказчика целиком — ${when(c.D)}: по самой долгой поставке. Условия каждого поставщика (оплата, сроки, доставка) — на вкладке «Закупка».</p>`:''}</div>
    ${money}
    <div class="dl-next"><span></span><button type="button" class="btn primary" data-dlx="step" data-id="buy">Подробно: Закупка →</button></div></section>`;
}

// ---------- сборка станции: кто собирает, сколько дней, сколько стоит; элементы других поставщиков едут к нему
function dlAsmCard(c){
  const d=dlDeal(); if (!d.asm || DL.ex && !c.asm) return '';
  const on=d.asm.on!==false, a=c.asm, ex=DL.ex, when=day=>dlD0()?dlDayRu(day):`день ${day}`;
  const seg=`<span class="dl-seg"><button type="button" class="${on?'on':''}" data-dlx="asmon" data-v="1"${ex?' disabled':''}>Через сборку у производителя контейнера</button><button type="button" class="${on?'':'on'}" data-dlx="asmon" data-v="0"${ex?' disabled':''}>Каждый поставщик везёт заказчику</button></span>`;
  const body = !on ? '<p class="muted">Элементы станции едут к заказчику напрямую, срок — по самой долгой поставке.</p>' : `
    <div class="dl-g">${dlField('Кто собирает станцию', 'asm.sup', {select:[['','— выберите поставщика —'], ...d.sup.map((z,k)=>[z.id, c.sup[k].name])], q:'Обычно производитель контейнера: к нему едут все элементы, он монтирует оборудование, обвязку и системы, испытывает и отгружает станцию заказчику.'})}
      ${dlField('Сборка и испытания', 'asm.days', {calc:c, int:true, unit:'дн.', ph:'10', q:'Сколько дней от прихода последнего элемента (и готовности контейнера) до отгрузки собранной станции.'})}
      ${dlField('Сборка, обвязка, испытания', 'asm.cost.v', {calc:c, unit:'₽ с НДС', ph:'в цене контейнера', q:'Если производитель контейнера берёт за сборку отдельно — сумма с НДС. Оплата — после сборки; НДС — к вычету.'})}</div>
    ${a?`<div class="dl-asm">${a.toAsm.map(s=>`<span><b>${esc(s.name)}</b> → на сборке ${when(s.arr)}${a.late.includes(s)?' <em class="warn-t">последним</em>':''}</span>`).join('')}
      <span><b>${esc(a.A.name)}</b>: контейнер готов ${when(a.cRdy)}</span>
      <span class="dl-asm-t">Сборка ${when(a.start)} — ${when(a.end)} → станция у заказчика <b>${when(a.arr)}</b></span></div>`:'<p class="msg warn">Выберите, кто собирает станцию.</p>'}`;
  return `<div class="dl-card dl-asmc"><div class="dl-asmh"><h5>Сборка станции</h5>${seg}${dlQ('Элементы станции (ДГУ, насосы, компрессор, шкафы…) везут на производство контейнера, там станцию собирают и испытывают, потом отправляют заказчику. Сроки поставщиков элементов считаются до производителя контейнера, срок станции — после сборки. Маршруты обеих перевозок — на вкладке «Логистика».')}</div>${body}</div>`;
}

// ---------- шаг 1: закупка
function dlPurchase(c){
  const d=dlDeal(), multi=d.sup.length>1, ex=DL.ex;
  d.sup.forEach(s=>{ if (!Array.isArray(s.pay)||!s.pay.length) s.pay=JSON.parse(JSON.stringify(dealSupPay(s))); });
  const cards=d.sup.map((s,k)=>{ const cs=c.sup[k], P=`sup.${k}`, ru=/^росс/i.test(s.country||''), eaeu=s.cusMode==='eaeu';
    const known=dlDir(s.name), isNew=String(s.name||'').trim() && !known;
    const where = s.where==='ru'||s.where==='imp' ? s.where : ru ? 'ru' : s.country ? 'imp' : '';
    const items = ex ? '' : (()=>{ const its=kitLines(S).filter(x=>String(x.name||'').trim() && dlSupOf(x.id)===s.id);
      if (!its.length) return `<p class="muted dl-noitems">${multi?'Позиций нет — у позиции выберите этого поставщика в другой карточке.':'В КП нет позиций.'}</p>`;
      return `<table class="dl-it"><thead><tr><th>Позиция</th><th class="num">Кол-во</th><th>Цена закупки за ед.</th><th class="num">Сумма, ₽</th>${multi?'<th>Поставщик</th>':''}</tr></thead><tbody>
        ${its.map(x=>{ const r=rateOf(x.costCur||'RUB'), sum=x.cost?x.cost/100*(+x.qty||0)*(r||0)*(cs.noVat?1+c.v/100:1):0;
          const src=x.part||x.item, ct=src._costText ?? (x.cost?dlIn(x.cost/100):''), kc=x.part?`data-kitcost="${x.i}.${x.j}"`:`data-cost-i="${x.i}"`, kk=x.part?`data-kitcur="${x.i}.${x.j}"`:`data-costcur-i="${x.i}"`;
          return `<tr${x.cost?'':' class="need"'}><td class="c-nm"><b>${esc(x.name)}</b>${x.part?`<small>в составе «${esc(x.of)}»</small>`:x.maker?`<small>${esc(x.maker)}</small>`:''}</td><td class="num">${esc(x.qty)}</td>
            <td class="c-cost"><span class="dl-in cur"><input type="text" inputmode="decimal" ${kc} value="${esc(ct)}" placeholder="цена из счёта" aria-label="Цена закупки за единицу"${x.cost?'':' class="need"'}><select ${kk} aria-label="Валюта закупки">${DEAL_CURS.map(k=>`<option${(x.costCur||'RUB')===k?' selected':''}>${k}</option>`).join('')}</select></span></td>
            <td class="num c-sum">${x.cost?Fmt.rub(sum):'—'}</td>
            ${multi?`<td><select data-dlmap="${esc(x.id)}" aria-label="Поставщик позиции">${d.sup.map((z,j)=>`<option value="${esc(z.id)}"${z.id===s.id?' selected':''}>${esc(c.sup[j].name)}</option>`).join('')}</select></td>`:''}</tr>`; }).join('')}
        </tbody></table>`; })();
    const moreSum = [cs.equip&&dNum(s.extra&&s.extra.v)?`прочая закупка ${dlIn(dNum(s.extra.v))} ${(s.extra&&s.extra.cur)||'RUB'}`:'', dNum(s.fx)?`комиссия ${dlIn(dNum(s.fx))} %`:'', cs.brk?`брокер ${Fmt.rub(cs.brk)}`:''].filter(Boolean).map(esc).join(', ');
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
        ${cs.isAsm?`<div class="dl-g">${dlField('Контейнер готов через', P+'.prod', {calc:c, int:true, date:{base:0, val:cs.prod}, q:'Сколько дней от заказа до готовности контейнера у производителя. Сборка начнётся, когда готов контейнер и приехали все элементы.'})}${dlField('Доставка станции заказчику', P+'.ship', {calc:c, int:true, date:{base:cs.rdy, val:cs.ship}, q:'Сколько дней едет собранная станция от производителя контейнера до объекта заказчика.'})}</div>
        <p class="dl-tl"><span>Контейнер готов — <b>день ${cs.cRdy}</b>${dlD0()?` · ${dlDayRu(cs.cRdy)}`:''}</span><i>→</i><span>Сборка — <b>дни ${cs.asmStart}–${cs.rdy}</b></span><i>→</i><span>Станция у заказчика — <b>день ${cs.arr}</b>${dlD0()?` · ${dlDayRu(cs.arr)}`:''}</span></p>`
        :`<div class="dl-g">${dlField('Готово к отгрузке через', P+'.prod', {calc:c, int:true, date:{base:0, val:cs.prod}, q:'Сколько дней от заказа (подписания договора) до готовности оборудования на складе поставщика. Можно выбрать дату — дни посчитаются сами.'})}${dlField(cs.toAsm?`Доставка на сборку к «${c.asm.A.name}»`:'Доставка до заказчика', P+'.ship', {calc:c, int:true, date:{base:cs.rdy, val:cs.ship}, q:cs.toAsm?'Сколько дней едут элементы от склада поставщика до производителя контейнера, где собирают станцию.':'Сколько дней едет груз от склада поставщика до объекта заказчика, включая таможню. Дата — когда груз будет у заказчика.'})}</div>
        <p class="dl-tl"><span>Заказ — <b>день 0</b>${dlD0()?` · ${dlDayRu(0)}`:''}</span><i>→</i><span>Готово к отгрузке — <b>день ${cs.rdy}</b>${dlD0()?` · ${dlDayRu(cs.rdy)}`:''}</span><i>→</i><span>${cs.toAsm?'На сборке':'У заказчика'} — <b>день ${cs.arr}</b>${dlD0()?` · ${dlDayRu(cs.arr)}`:''}</span></p>`}</div>
      <div class="dl-sub"><h5>Оплата поставщику ${dlQ('Доли от стоимости оборудования (с комиссией за перевод). Последний этап — остаток до 100 %. Перевозка, страхование, таможня и брокер оплачиваются перед отгрузкой.')}</h5>${dlSupPay(c, k)}</div>
      <div class="dl-sub dl-lglink"><span>Перевозка${ru?'':', страхование'} и доставка ${cs.toAsm?'на сборку':cs.isAsm?'станции до объекта':'до объекта'} — на вкладке «Логистика»${cs.L+cs.Lru+cs.ins>0?`: <b>${Fmt.rub(cs.L+cs.Lru+cs.ins)}</b>`:''}</span>${ex?'':`<button type="button" class="btn ghost" data-dlx="step" data-id="log">Открыть «Логистику» →</button>`}</div>
      <details class="dl-more" data-more="sup${k}"${dlMore('sup'+k, false)}><summary>Ещё расходы по поставщику <span class="muted">— ${moreSum||'опции, комиссия за перевод, брокер'}</span></summary>
        <div class="dl-g">${dlField('Прочая закупка у поставщика', P+'.extra.v', {calc:c, cur:P+'.extra.cur', q:'Опции, ЗИП и всё, чего нет в позициях КП.'})}
          ${ru?'':dlField('Комиссия банка или агента', P+'.fx', {calc:c, unit:'%', ph:'1,5', q:'Комиссия за перевод и конвертацию — процент от платежей поставщику в валюте.'})}
          ${dlField('Брокер, СВХ, сертификация', P+'.brk.v', {calc:c, unit:'₽'})}
          ${cs.Lru+cs.brk>0?dlField('НДС к вычету по услугам в России', P+'.voRu', {calc:c, unit:'₽', auto:cs.ruSuggest, autoLabel:`авто ${c.v}/${100+c.v}`, q:'НДС в счетах перевозчика и брокера. Если они без НДС — впишите 0.'}):''}
          ${s.vatIn?dlField('НДС поставщика к вычету', P+'.vo', {calc:c, unit:'₽', auto:cs.suggest, autoLabel:`авто ${c.v}/${100+c.v}`, q:'НДС в стоимости оборудования — сверьте со счётом-фактурой.'}):''}</div></details>
      <div class="dl-supf"><span>Закупка у поставщика</span><b>${dlRub(cs.equip)}</b></div>
    </div>`; }).join('');
  return dlStep(1, 'Закупка', 'Что и у кого покупаем. Цена — как в счёте поставщика, в его валюте.',
    `${dlAsmCard(c)}${cards}${ex?'':`<button type="button" class="btn dl-add" data-dlx="addsup">+ Ещё поставщик</button>`}`, '', ['Итого закупка и доставка', c.sup.reduce((a,x)=>a+x.cash-x.T,0), 'оборудование, перевозка, страхование, комиссии, брокер — без таможни'], 'buy');
}

// этапы оплаты поставщику: название, доля, событие + дней; итог — сумма и день (дата)
// готовые варианты: [название, этапы, группа в списке «Быстро заполнить»]
const DL_W='work';
const DL_SP_PRESETS = {
  pre100:   ['100 % при заказе', [{name:'Предоплата', ev:'order', off:'0'}], 'Предоплата'],
  pre100w:  ['100 % в течение 3 раб. дн. после счёта', [{name:'Предоплата', ev:'order', off:'3', offK:DL_W}], 'Предоплата'],
  a10:      ['10 % + 90 % перед отгрузкой', [{name:'Аванс', pct:'10', ev:'order', off:'0'}, {name:'Остаток', ev:'ready', off:'0'}], 'Аванс и остаток перед отгрузкой'],
  a20:      ['20 % + 80 % перед отгрузкой', [{name:'Аванс', pct:'20', ev:'order', off:'0'}, {name:'Остаток', ev:'ready', off:'0'}], 'Аванс и остаток перед отгрузкой'],
  a30:      ['30 % + 70 % перед отгрузкой', [{name:'Аванс', pct:'30', ev:'order', off:'0'}, {name:'Остаток', ev:'ready', off:'0'}], 'Аванс и остаток перед отгрузкой'],
  a50:      ['50 % + 50 % перед отгрузкой', [{name:'Аванс', pct:'50', ev:'order', off:'0'}, {name:'Остаток', ev:'ready', off:'0'}], 'Аванс и остаток перед отгрузкой'],
  a70:      ['70 % + 30 % перед отгрузкой', [{name:'Аванс', pct:'70', ev:'order', off:'0'}, {name:'Остаток', ev:'ready', off:'0'}], 'Аванс и остаток перед отгрузкой'],
  a80:      ['80 % + 20 % по готовности', [{name:'Предоплата', pct:'80', ev:'order', off:'0'}, {name:'По уведомлению о готовности', ev:'ready', off:'0'}], 'Аванс и остаток перед отгрузкой'],
  ready100: ['100 % перед отгрузкой', [{name:'Оплата', ev:'ready', off:'0'}], 'Аванс и остаток перед отгрузкой'],
  a3070d:   ['30 % + 70 % после поставки', [{name:'Аванс', pct:'30', ev:'order', off:'0'}, {name:'После поставки', ev:'delivery', off:'0'}], 'После поставки и отсрочка'],
  a5050d:   ['50 % + 50 % после поставки', [{name:'Аванс', pct:'50', ev:'order', off:'0'}, {name:'После поставки', ev:'delivery', off:'0'}], 'После поставки и отсрочка'],
  del100:   ['100 % после поставки', [{name:'Оплата', ev:'delivery', off:'0'}], 'После поставки и отсрочка'],
  def14:    ['Отсрочка 14 дн. после поставки', [{name:'Оплата с отсрочкой', ev:'delivery', off:'14'}], 'После поставки и отсрочка'],
  def30:    ['Отсрочка 30 дн. после поставки', [{name:'Оплата с отсрочкой', ev:'delivery', off:'30'}], 'После поставки и отсрочка'],
  def45:    ['Отсрочка 45 дн. после поставки', [{name:'Оплата с отсрочкой', ev:'delivery', off:'45'}], 'После поставки и отсрочка'],
  def60:    ['Отсрочка 60 дн. после поставки', [{name:'Оплата с отсрочкой', ev:'delivery', off:'60'}], 'После поставки и отсрочка'],
  a305020:  ['30 / 50 / 20 % — остаток после ПНР', [{name:'Аванс', pct:'30', ev:'order', off:'0'}, {name:'Перед отгрузкой', pct:'50', ev:'ready', off:'0'}, {name:'После шефмонтажа и ПНР', ev:'pnr', off:'0'}], 'Три этапа'],
  a5040d10: ['50 / 40 / 10 % — остаток после ПНР', [{name:'Аванс', pct:'50', ev:'order', off:'0'}, {name:'После поставки', pct:'40', ev:'delivery', off:'0'}, {name:'После ПНР', ev:'pnr', off:'0'}], 'Три этапа'],
  a306010:  ['30 / 60 / 10 % — остаток после поставки', [{name:'Аванс', pct:'30', ev:'order', off:'0'}, {name:'Перед отгрузкой', pct:'60', ev:'ready', off:'0'}, {name:'После поставки', ev:'delivery', off:'0'}], 'Три этапа'],
};
// короткие названия событий в строке этапа (полные — в графике и Excel)
const DL_SP_EV_SHORT = { order:'при заказе', ready:'перед отгрузкой', delivery:'после поставки', pnr:'после ПНР' };
const DL_TR_EV_SHORT = { sign:'после подписания', ready:'при готовности', delivery:'после поставки', pnr:'после ПНР' };

// «Быстро заполнить»: выпадающий список готовых вариантов по группам — компактно, вариантов много
function dlPresetSel(kind, k, presets){
  const groups=[...new Set(Object.values(presets).map(x=>x[2]||''))];
  return `<label class="dl-pre"><span>Быстро заполнить</span><select data-dlpreset="${kind}" data-k="${k}" aria-label="Готовый вариант оплаты"${DL.ex?' disabled':''}><option value="">— готовый вариант —</option>
    ${groups.map(g=>`<optgroup label="${esc(g||'Варианты')}">${Object.entries(presets).filter(([,x])=>(x[2]||'')===g).map(([v,[t]])=>`<option value="${v}">${esc(t)}</option>`).join('')}</optgroup>`).join('')}</select></label>`;
}

// строка этапа оплаты (поставщику и заказчику — одинаково): ⠿ № название · доля · когда + дней (кал./раб.) · дата · сумма
function dlPayRow(o){
  const {grp, j, n, P, t, ev, evs, amt, base, off, dateLab, sum, day, bad, del}=o, last=j===n-1;
  return `<div class="dl-tr pay${bad?' bad':''}${last?' last':''}" data-dnd="${grp}" data-i="${j}">${dlMoveCtl(grp, j, n)}<span class="dl-trn">${j+1}</span>
    <input type="text" class="tx dl-trname" data-dl="${P}.name" value="${esc(t.name||'')}" placeholder="${esc(o.ph)}" aria-label="Название этапа">
    ${amt}
    <span class="dl-trw"><select data-dl="${P}.ev" aria-label="Когда">${Object.entries(evs).map(([v,l])=>`<option value="${v}"${ev===v?' selected':''}>${l}</option>`).join('')}</select><span class="dl-in dl-troff"><i>+</i><input type="text" inputmode="numeric" data-dl="${P}.off" value="${esc(t.off??'')}" placeholder="0" aria-label="Дней после события">${dlDayKind(P+'.off')}</span></span>
    <span class="dl-trr"><b>${Fmt.rub(sum)}</b>${dlD0()&&!DL.ex?dlDateIn(P+'.off', base, off, dateLab, t.offK):`<small>день ${day}</small>`}</span>
    ${n>1?`<button type="button" class="icon" ${del} aria-label="Убрать этап">✕</button>`:'<span></span>'}</div>`;
}
const DL_PAY_HEAD = '<div class="dl-sph" aria-hidden="true"><span></span><span></span><span>Этап</span><span>Доля</span><span>Когда платим · через сколько дней</span><span>Сумма · дата</span><span></span></div>';

function dlSupPay(c, k){
  const d=dlDeal(), s=d.sup[k], cs=c.sup[k], P=`sup.${k}`, n=s.pay.length, base=cs.equip+cs.fxE;
  const spBase={order:0, ready:cs.rdy, delivery:cs.arr, pnr:c.pnrEnd};
  const rows=s.pay.map((t,j)=>{ const st=cs.stages[j]||{p:0}, last=j===n-1, row=c.rows.find(r=>r.key===`sp:${s.id}:${j}`), ev=t.ev||'ready';
    const amt=last ? `<span class="dl-trp">${n>1?'остаток':'всё'}<b>${dlIn(st.p)} %</b></span>`
      : `<span class="dl-in dl-tram"><input type="text" inputmode="decimal" data-dl="${P}.pay.${j}.pct" value="${esc(t.pct??'')}" placeholder="0" aria-label="Доля этапа, %"><i>%</i></span>`;
    return dlPayRow({grp:`sp:${k}`, j, n, P:`${P}.pay.${j}`, t, ev, evs:DL_SP_EV_SHORT, amt, base:spBase[ev]||0, off:st.off||0, dateLab:'Оплата поставщику',
      sum:base*st.p/100, day:row?row.day:dealAddDays(dlCalFns(), spBase[ev]||0, st.off||0, t.offK), bad:c.err[`${P}.pay.${j}.pct`]||c.err[`${P}.pay.${j}.off`],
      ph:j===0&&!last?'Аванс':last&&n>1?'Остаток':'Оплата', del:`data-dlx="delsp" data-k="${k}" data-j="${j}"`}); }).join('');
  return `<div class="dl-pays">${DL_PAY_HEAD}${rows}</div>${c.err[P+'.pay']?`<small class="dl-err">${esc(c.err[P+'.pay'])}</small>`:''}
    <div class="dl-trf"><button type="button" class="btn" data-dlx="addsp" data-k="${k}">+ Этап</button>${dlPresetSel('sp', k, DL_SP_PRESETS)}</div>`;
}

// ---------- шаг 2: таможня
function dlCustoms(c){
  const d=dlDeal(), ex=DL.ex;
  const blocks=d.sup.map((s,k)=>{ const cs=c.sup[k], P=`sup.${k}`; if (cs.mode==='none' && /^росс/i.test(s.country||'')) return '';
    const modeSeg=`<span class="dl-seg"><button type="button" class="${cs.mode==='calc'?'on':''}" data-dlx="cusmode" data-k="${k}" data-v="calc">Рассчитать</button><button type="button" class="${cs.mode==='eaeu'?'on':''}" data-dlx="cusmode" data-k="${k}" data-v="eaeu">ЕАЭС</button><button type="button" class="${cs.mode==='sum'?'on':''}" data-dlx="cusmode" data-k="${k}" data-v="sum">Сумма целиком</button><button type="button" class="${cs.mode==='none'?'on':''}" data-dlx="cusmode" data-k="${k}" data-v="none">Нет</button></span>`;
    let body='';
    if (cs.mode==='calc'){
      // строки закупки поставщика: обычные позиции и элементы станций (у каждого свой код и пошлина)
      const hsCats=ex ? [] : DealHs.cats();
      const rows = ex ? '' : kitLines(S).filter(l=>String(l.name||'').trim() && dlSupOf(l.id)===s.id).map(l=>{ const x=l.item, h=DealHs.of(x), ln=cs.lines.find(z=>z.id===l.id);
        return `<tr><td class="c-nm"><b>${esc(l.name)}</b><small>${l.of?`в составе «${esc(l.of)}» · `:''}${esc(x.role==='container'?'блок-контейнер':typeById(attrsOf(x).cat).name)}</small></td>
          <td><input type="text" class="hs" data-hs-i="${esc(x.id)}" data-f="code" value="${esc(h.code)}" placeholder="0000 00 000 0" aria-label="Код ТН ВЭД"></td>
          <td><span class="dl-in"><input type="text" inputmode="decimal" class="hs-d" data-hs-i="${esc(x.id)}" data-f="duty" value="${esc(h.duty)}" placeholder="?" aria-label="Ставка пошлины, %"><i>%</i></span></td>
          <td class="c-src">${DealHs.badge(x, h)}${ln&&ln.special?`<span class="dl-badge warn" title="${esc(ln.special.src)}: ставка ${ln.special.duty} % для товаров происхождения ${esc(ln.special.country)} по ${esc(ln.special.until.split('-').reverse().join('.'))}. Происхождение другое — впишите свою ставку">${ln.special.duty} % — ${esc(ln.special.country)}</span>`:''}
            <select class="dl-hspick" data-hspick="${esc(x.id)}" aria-label="Взять код и ставку из справочника"><option value="">из справочника…</option>${hsCats.map(o=>`<option value="${esc(o.key)}">${esc(o.name)} · ${esc(o.code||'—')} · ${esc(o.duty===''?'?':o.duty)} %</option>`).join('')}</select></td>
          <td class="num">${ln?Fmt.rub(ln.cv):'—'}</td><td class="num">${ln?Fmt.rub(ln.dutyA):'—'}</td></tr>`; }).join('');
      // прочая закупка у поставщика (опции, ЗИП): своя ставка или средняя по позициям поставщика
      const xl=ex ? null : cs.lines.find(z=>z.id==='extra'), xOwn=String(s.duty??'').trim()!=='';
      const xrow = !xl ? '' : `<tr><td class="c-nm"><b>Прочая закупка у поставщика</b><small>опции, ЗИП — из шага «Закупка»</small></td>
          <td><input type="text" class="hs" data-dl="${P}.hsx" value="${esc(s.hsx||'')}" placeholder="0000 00 000 0" aria-label="Код ТН ВЭД прочей закупки"></td>
          <td><span class="dl-in"><input type="text" inputmode="decimal" class="hs-d${c.err[P+'.duty']?' bad':''}" data-dl="${P}.duty" value="${esc(s.duty??'')}" placeholder="${xl.dutyAuto?esc(dlIn(xl.duty)):'?'}" aria-label="Ставка пошлины прочей закупки, %"><i>%</i></span></td>
          <td class="c-src">${xOwn?'<span class="dl-badge kp">вручную</span>':xl.dutyAuto?'<span class="dl-badge kp" title="Средняя ставка позиций этого поставщика, взвешенная по стоимости. Впишите свою, если прочая закупка облагается иначе.">как у позиций</span>':'<span class="dl-badge warn">укажите</span>'}</td>
          <td class="num">${Fmt.rub(xl.cv)}</td><td class="num">${Fmt.rub(xl.dutyA)}</td></tr>`;
      body=`${rows||xrow?`<div class="dl-tw dl-hsw"><table class="dl-it dl-hs"><thead><tr><th>Позиция</th><th>Код ТН ВЭД</th><th>Пошлина</th><th></th><th class="num">Тамож. стоимость</th><th class="num">Пошлина, ₽</th></tr></thead><tbody>${rows}${xrow}</tbody></table></div>`:''}
        <div class="dl-g g3">${dlField('НДС на ввоз', P+'.ivat', {calc:c, select:[['22','22 %'],['10','10 %'],['0','0 %']]})}
          ${dlField('Таможенный сбор', P+'.fee', {calc:c, unit:'₽', auto:cs.fee, autoLabel:'по шкале', autoTitle:'Сбор за таможенные операции: '+(customsFeeBand(cs.cv)||'по таможенной стоимости')+' ('+CUSTOMS_FEES.title+')', q:'Фиксированная сумма за декларацию — зависит от общей таможенной стоимости партии (цена + доставка до границы + страховка): '+DealValues.feeText()+' ('+CUSTOMS_FEES.title+(DealValues.feeOwn()?'; шкала изменена в «Настройках»':'')+').'})}</div>
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
    `${blocks}<p class="dl-foot-n">Код ТН ВЭД (10 знаков) и ставка подбираются по виду оборудования и его характеристикам — по ЕТТ ЕАЭС (${TnVed.AT});
      «справочно» с пометкой «проверьте» — код зависит от исполнения, его подтверждает таможенный брокер. Исправленный код и ставка запоминаются для модели. ${ex?'':'<button type="button" class="lnk" data-dlx="hsdir">Справочник кодов по категориям</button> · '}<a href="https://www.alta.ru/tnved/" target="_blank" rel="noopener">Проверить ставку на alta.ru ↗</a></p>`, '', ['Итого платим на таможне', c.Tsum, `из них в себестоимость ${Fmt.rub(c.sup.reduce((a,x)=>a+x.T-(x.vi||0),0))}, остальное — ввозной НДС к вычету`], 'cus');
}

// расчёт таможенных платежей наглядно: из чего складывается сумма к оплате на таможне и что вернётся вычетом
function dlCusSum(cs, eaeu){
  const it=(lab, v, note, cls='')=>`<div class="dl-cx ${cls}"><small>${lab}</small><b>${Fmt.rub(v)}</b>${note?`<em>${note}</em>`:''}</div>`;
  return `<div class="dl-cus2">
    <div class="dl-cbase">${it(eaeu?'Стоимость оборудования':'Таможенная стоимость', cs.cv, eaeu?'база для НДС':'оборудование + перевозка до границы + страхование')}</div>
    <div class="dl-cpay">${eaeu?'':it(`Пошлина`, cs.dutyA, 'по ставкам позиций → в себестоимость')}${eaeu?'':it('Таможенный сбор', cs.fee, (cs.feeAuto&&customsFeeBand(cs.cv)?customsFeeBand(cs.cv).replace(/ → сбор.*/,'')+' · ':'')+'по шкале ПП РФ № 1637 → в себестоимость')}
      ${it(`НДС при ввозе ${dlIn(cs.ivP)} %`, cs.ivatA, eaeu?'платится в налоговую → вернётся вычетом':`(стоимость + пошлина) × ${dlIn(cs.ivP)} % → вернётся вычетом`, 'vat')}</div>
    <div class="dl-ctot"><small>${eaeu?'Платим НДС при ввозе':'Платим на таможне'}</small><b>${Fmt.rub(cs.T)}</b><em>из них в себестоимость: <b>${Fmt.rub(cs.T-cs.ivatA)}</b></em></div></div>
    ${eaeu?'<p class="dl-foot-n">Из стран ЕАЭС пошлины и таможенного сбора нет (Договор о ЕАЭС).</p>':''}`;
}

// ---------- шаги 3–5
// оплата заказчика: этапы с названием, суммой (% или ₽), событием и сдвигом в днях; последний — остаток
const DL_TR_PRESETS = {
  a100:    ['Предоплата 100 %', [{name:'Предоплата', ev:'sign', off:'5'}], 'Предоплата'],
  a100w:   ['Предоплата 100 % за 3 раб. дн.', [{name:'Предоплата', ev:'sign', off:'3', offK:DL_W}], 'Предоплата'],
  a30:     ['Аванс 30 % + остаток после поставки', [{name:'Аванс', pct:'30', ev:'sign', off:'5'}, {name:'Окончательный расчёт', ev:'delivery', off:'10'}], 'Аванс и остаток'],
  a50:     ['Аванс 50 % + остаток после поставки', [{name:'Аванс', pct:'50', ev:'sign', off:'5'}, {name:'Окончательный расчёт', ev:'delivery', off:'10'}], 'Аванс и остаток'],
  a70:     ['Аванс 70 % + остаток после поставки', [{name:'Аванс', pct:'70', ev:'sign', off:'5'}, {name:'Окончательный расчёт', ev:'delivery', off:'10'}], 'Аванс и остаток'],
  a30r:    ['Аванс 30 % + 70 % перед отгрузкой', [{name:'Аванс', pct:'30', ev:'sign', off:'5'}, {name:'Окончательный расчёт', ev:'ready', off:'0'}], 'Аванс и остаток'],
  a50r:    ['Аванс 50 % + 50 % перед отгрузкой', [{name:'Аванс', pct:'50', ev:'sign', off:'5'}, {name:'Окончательный расчёт', ev:'ready', off:'0'}], 'Аванс и остаток'],
  a3060:   ['30 / 60 / 10 % — остаток после ПНР', [{name:'Аванс', pct:'30', ev:'sign', off:'5'}, {name:'Перед отгрузкой', pct:'60', ev:'ready', off:'0'}, {name:'Окончательный расчёт', ev:'pnr', off:'10'}], 'Три этапа'],
  a5040:   ['50 / 40 / 10 % — остаток после ПНР', [{name:'Аванс', pct:'50', ev:'sign', off:'5'}, {name:'После поставки', pct:'40', ev:'delivery', off:'10'}, {name:'Окончательный расчёт', ev:'pnr', off:'10'}], 'Три этапа'],
  a304030: ['30 / 40 / 30 % — аванс, отгрузка, поставка', [{name:'Аванс', pct:'30', ev:'sign', off:'5'}, {name:'Перед отгрузкой', pct:'40', ev:'ready', off:'0'}, {name:'Окончательный расчёт', ev:'delivery', off:'10'}], 'Три этапа'],
  a9010:   ['90 % после поставки + 10 % после ПНР', [{name:'После поставки', pct:'90', ev:'delivery', off:'10'}, {name:'Окончательный расчёт', ev:'pnr', off:'10'}], 'Три этапа'],
  post:    ['100 % через 30 дн. после поставки', [{name:'Оплата', ev:'delivery', off:'30'}], 'Постоплата'],
  post10w: ['100 % за 10 раб. дн. после поставки', [{name:'Оплата', ev:'delivery', off:'10', offK:DL_W}], 'Постоплата'],
  post60:  ['Отсрочка 60 дн. после поставки', [{name:'Оплата', ev:'delivery', off:'60'}], 'Постоплата'],
  pnr100:  ['100 % после ПНР', [{name:'Оплата', ev:'pnr', off:'10'}], 'Постоплата'],
  gz:      ['44-ФЗ / 223-ФЗ: за 7 раб. дн. после приёмки', [{name:'Оплата', ev:'delivery', off:'7', offK:DL_W}], 'Госзакупки'],
  gz30:    ['44-ФЗ: аванс 30 % + остаток за 7 раб. дн. после приёмки', [{name:'Аванс', pct:'30', ev:'sign', off:'7', offK:DL_W}, {name:'Окончательный расчёт', ev:'delivery', off:'7', offK:DL_W}], 'Госзакупки'],
};

function dlCustomer(c){
  const d=dlDeal(), tr=d.cust.tr, n=tr.length;
  const rows=tr.map((t,k)=>{ const last=k===n-1, ct=c.trs[k], bySum=!last && t.mode==='sum';
    const row=c.rows.find(r=>r.stage===k), rub=bySum?ct.sum:c.S*(ct.p||0)/100, day=row?row.day:(c.ev[ct.ev]||0)+ct.off;
    const amt = last ? `<span class="dl-trp" title="Последний этап — остаток до 100 %">${n>1?'остаток':'всё'}<b>${dlIn(ct.p)} %</b></span>`
      : `<span class="dl-in dl-tram"><input type="text" inputmode="decimal" data-dl="cust.tr.${k}.${bySum?'sum':'pct'}" value="${esc(bySum?t.sum??'':t.pct??'')}" placeholder="0" aria-label="${bySum?'Сумма этапа, ₽':'Доля этапа, %'}"><span class="mtog" role="group" aria-label="Процент или сумма"><button type="button" class="${bySum?'':'on'}" data-dlx="trmode" data-k="${k}" data-v="pct">%</button><button type="button" class="${bySum?'on':''}" data-dlx="trmode" data-k="${k}" data-v="sum">₽</button></span></span>`;
    return dlPayRow({grp:'cust', j:k, n, P:`cust.tr.${k}`, t, ev:t.ev, evs:DL_TR_EV_SHORT, amt, base:c.ev[ct.ev]||0, off:ct.off||0, dateLab:'Оплата заказчика', sum:rub, day,
      bad:c.err[`cust.tr.${k}.pct`]||c.err[`cust.tr.${k}.sum`]||c.err[`cust.tr.${k}.off`], ph:last?(n>1?'Окончательный расчёт':'Оплата'):k===0?'Аванс':'Платёж '+(k+1), del:`data-dlx="deltr" data-k="${k}"`}); }).join('');
  return `<div class="dl-pays">${DL_PAY_HEAD}${rows}</div>${c.err['cust.tr']?`<small class="dl-err">${esc(c.err['cust.tr'])}</small>`:''}
    <div class="dl-trf"><button type="button" class="btn" data-dlx="addtr">+ Этап</button>${dlPresetSel('tr', 0, DL_TR_PRESETS)}${dlQ(`Сумму этапа можно вписать в процентах или рублях; последний этап — остаток. День 0 — подписание договора, готовность — день ${c.Rdy}, поставка — день ${c.D}${c.pnrDays?`, ПНР — день ${c.pnrEnd}`:''}.`)}</div>`;
}

// ---------- условия КП из экономики сделки: срок поставки, этапы оплаты, монтаж и ПНР.
// Подставляются, пока поле пустое или в нём прежняя подстановка; вписанное вручную не меняется
// (в разделе «Условия» — кнопка «↺ Из экономики сделки»). S.condAuto — последняя подстановка по каждому условию.
const DL_COND_MNT='Монтаж, ШМР и ПНР', DL_COND_DOC='Документация';
const DL_DOC_GEN = { pd:'проектной', rd:'рабочей', id:'исполнительной' };
// когда платит заказчик — словами, как в договоре
function dlCondWhen(t){
  const n=+t.off||0, inN=n ? `в течение ${dlDaysTxt(n, t.offK)} ` : '';
  if (t.ev==='sign') return n ? `${inN}с даты подписания договора` : 'при подписании договора';
  if (t.ev==='ready') return n ? `${inN}после уведомления о готовности оборудования к отгрузке` : 'перед отгрузкой, по уведомлению о готовности оборудования';
  if (t.ev==='pnr') return `${inN}после завершения пусконаладочных работ`;
  return n ? `${inN}после поставки оборудования` : 'по факту поставки оборудования';
}
// название этапа для условий: своё (если осмысленное) или по месту в графике
function dlCondName(t, k, n){
  const nm=String(t.name||'').trim();
  // название, повторяющее событие («Перед отгрузкой», «После поставки»), не пишем — событие и так в тексте
  const dup=nm && dlCondWhen(t).toLowerCase().includes(nm.toLowerCase().replace(/^после /,''));
  if (nm && !dup && !/^(оплата|платёж|платеж)( \d+)?$/i.test(nm)) return nm;
  if (n===1) return '';
  return k===0 && t.ev==='sign' ? 'Аванс' : k===n-1 ? 'Окончательный расчёт' : '';
}
function dealCondSuggest(c){
  const out={}, d=dlDeal(), act=c.sup.filter(s=>s.active), d0=dlD0();
  if (c.D>0){ const allWork=act.length && act.every(s=>s.prodK==='work'&&s.shipK==='work');
    const n=allWork ? Math.max(...act.map(s=>s.prod+s.ship)) : c.D;
    out['Срок поставки']=`${dlDaysTxt(n, allWork?'work':'')} с даты подписания договора${d0&&!d.startAuto?` (ориентировочно до ${dlDayRu(c.D)})`:''}`; }
  const st=c.trs.filter(t=>t.p>0.004);
  if (st.length===1){ const t=st[0], nm=dlCondName(t, 0, 1);
    out['Условия оплаты'] = t.ev==='sign' && !(+t.off) ? '100 % предоплата при подписании договора'
      : `${nm?nm+' ':''}100 % ${t.ev==='sign'&&!nm?'предоплата ':''}${dlCondWhen(t)}`; }
  else if (st.length) out['Условия оплаты'] = st.map((t,k)=>{ const nm=dlCondName(t, k, st.length);
    return `${nm?(k?nm.charAt(0).toLowerCase()+nm.slice(1):nm)+' ':''}${dlPctTxt(t.p)} — ${dlCondWhen(t)}`; }).join('; ');
  if (c.M>0) out[DL_COND_MNT]=`Монтажные и пусконаладочные работы входят в стоимость${c.pnrDays?` и выполняются в течение ${dlDaysTxt(c.pnrDays, d.pnrK==='work'?'work':'')} после поставки оборудования`:''}`;
  const dk=Object.keys(DL_DOC_GEN).filter(k=>d.docK&&d.docK[k]).map(k=>DL_DOC_GEN[k]);
  if (c.Dc>0 || dk.length) out[DL_COND_DOC]=`Разработка ${dk.length?(dk.length>1?dk.slice(0,-1).join(', ')+' и '+dk[dk.length-1]:dk[0]):'проектной, рабочей и исполнительной'} документации входит в стоимость`;
  return out;
}
function dealSyncConds(c){
  if (DL.ex || !S.deal || !S.deal.touched || !Array.isArray(S.conditions)) return false;
  const sug=dealCondSuggest(c); S.condAuto=S.condAuto||{}; let ch=false;
  for (const label of ['Срок поставки','Условия оплаты',DL_COND_MNT,DL_COND_DOC]){
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
  if (DL.ex) return `<div class="dl-g g3">${dlField('Цена КП с НДС', 'over.price', {calc:c, unit:'₽', kp:kp.sumRub})}${c.used.map(cur=>dlField(`Курс ${cur}`, 'rates.'+cur, {calc:c, unit:'₽', kp:dNum(kp.rates[cur])})).join('')}</div>`;
  const cur=kpCur(), csh=curSh(cur), t=totalsS(), P=S.pricing;
  const need=[...new Set([cur, ...c.used])].filter(x=>x!=='RUB');
  const its=S.items.filter(x=>String(x.name||'').trim());
  const rows=its.map(x=>{ const i=S.items.indexOf(x), pt=x._priceText ?? fmtPrice(x.price), dsc=KPGen.unitDisc(x);
    return `<tr><td class="c-nm"><b>${esc(x.name)}</b><small>${esc(x.qty)} шт.${dsc?` · скидка ${money(dsc)} ${csh}/ед.`:''}</small></td>
      <td class="c-cost"><input type="text" inputmode="decimal" class="num" data-kpp-i="${i}" value="${esc(pt)}" placeholder="0,00" aria-label="Цена за единицу с НДС, ${csh}"></td>
      <td class="num">${money(itemSum(x))}</td></tr>`; }).join('');
  const over=d.over.price!==''&&d.over.price!=null;
  return `<div class="dl-g g3">
      <label class="f dl-f"><span>Валюта КП</span><select data-kpcur aria-label="Валюта КП">${CUR_LIST.map(k=>`<option value="${k}"${k===cur?' selected':''}>${k==='RUB'?'Рубли':k==='USD'?'Доллары США':k==='EUR'?'Евро':'Юани'} (${k})</option>`).join('')}</select>${cur!=='RUB'?'<small class="muted">Цены переводятся по курсу</small>':''}</label>
      ${need.length?`<div class="f dl-f dl-rates"><span>Курс ЦБ РФ${P.rateDate?` на ${esc(KPGen.ruDate(P.rateDate))}`:''}</span>
        ${need.map(k=>`<span class="dl-in"><i>1 ${k} =</i><input type="text" inputmode="decimal" data-kprate="${k}" value="${esc((d.rates&&d.rates[k])||P.rates[k]||'')}" placeholder="0,0000" aria-label="Курс ${k}"${rateOf(k)>0?'':' class="bad"'}><i>₽</i></span>`).join('')}
        <button type="button" class="lnk" data-dlx="cbr">Обновить курс с cbr.ru</button></div>`:''}</div>
    ${rows?`<table class="dl-it dl-kpt"><thead><tr><th>Позиция</th><th>Цена за ед. с НДС, ${csh}</th><th class="num">Сумма, ${csh}</th></tr></thead><tbody>${rows}</tbody>
      <tfoot><tr><td><b>Итого КП с НДС</b></td><td></td><td class="num"><b>${money(t.sum)} ${csh}</b>${cur!=='RUB'&&kp.sumRub?`<small>≈ ${Fmt.rub(kp.sumRub)}</small>`:''}</td></tr></tfoot></table>`:''}
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

// ширина столбцов графика платежей (компьютер): тянется за край заголовка, запоминается в браузере
const DL_COLW = [205, 120, 0, 140, 150, 150];
function dlColW(){ let w=null; try{ w=JSON.parse(localStorage.getItem('kp.dlcols')||'null'); }catch(e){}
  return DL_COLW.map((d,k)=>Array.isArray(w) && +w[k]>=50 ? +w[k] : d); }
document.addEventListener('pointerdown', e=>{
  const h=e.target.closest && e.target.closest('.dl-t .dl-cr'); if (!h || e.button!==0) return;
  e.preventDefault(); e.stopPropagation();
  const k=+h.dataset.dlcol, tbl=h.closest('table'), col=tbl.querySelectorAll('col')[k], th=h.closest('th'), x0=e.clientX, w0=th.getBoundingClientRect().width;
  const ws=dlColW(); document.body.classList.add('dl-colresize');
  const mv=ev=>{ const w=Math.max(k===0?168:60, Math.round(w0+ev.clientX-x0)); col.style.width=w+'px'; ws[k]=w; };
  const up=()=>{ removeEventListener('pointermove', mv); removeEventListener('pointerup', up); document.body.classList.remove('dl-colresize');
    try{ localStorage.setItem('kp.dlcols', JSON.stringify(ws)); }catch(_){} };
  addEventListener('pointermove', mv); addEventListener('pointerup', up);
});
document.addEventListener('dblclick', e=>{ const h=e.target.closest && e.target.closest('.dl-t .dl-cr'); if (!h) return;
  const k=+h.dataset.dlcol, ws=dlColW(); ws[k]=DL_COLW[k]; try{ localStorage.setItem('kp.dlcols', JSON.stringify(ws)); }catch(_){}
  const col=h.closest('table').querySelectorAll('col')[k]; col.style.width=DL_COLW[k]?DL_COLW[k]+'px':''; });

function dlSchedule(c, n=6){
  const d=dlDeal(), d0=dlD0();
  const out=c.rows.filter(r=>!r.inflow), inn=c.rows.filter(r=>r.inflow);
  const sum=f=>c.rows.filter(f).reduce((a,r)=>a+Math.abs(r.amount),0);
  const peak=c.rows.reduce((m,r)=>r.balance<m.v?{v:r.balance, r}:m, {v:0, r:null});
  const tile=(lab,v,sub,cls='')=>`<div class="dl-sx ${cls}"><small>${lab}</small><b>${v}</b>${sub?`<em>${sub}</em>`:''}</div>`;
  const when=day=>`день ${day}${d0?` · ${dlDayRu(day)}`:''}`;
  return dlStep(n, `График платежей · ${c.Tend} ${plural(c.Tend,'день','дня','дней')}${d0?` · до ${dlDayRu(c.Tend)}`:''}`, 'Деньги по дням: кто, когда и сколько платит. В один день сначала поступление от заказчика, потом платежи (кроме постоплаты).', `
    ${Object.keys(d.days||{}).length?'<div class="dl-d0"><span class="muted">Даты некоторых платежей изменены вручную.</span><button type="button" class="btn ghost" data-dlx="resetdays">↺ Вернуть даты по срокам</button></div>':''}
    <div class="dl-sxs">${tile('Платим поставщикам и за логистику', Fmt.rub(sum(r=>!r.inflow&&r.party!=='oth')), `${out.length} ${plural(out.length,'платёж','платежа','платежей')}`)}
      ${tile('Получаем от заказчика', Fmt.rub(sum(r=>r.inflow)), `${inn.length} ${plural(inn.length,'платёж','платежа','платежей')}, последний — ${when(c.Tend)}`, 'in')}
      ${tile('Пик вложений своих денег', peak.r?Fmt.rub(-peak.v):'0 ₽', peak.r?when(peak.r.day):'деньги заказчика покрывают платежи', peak.r?'neg':'')}
      ${tile('Финансирование', Fmt.rub(c.F), `${dlIn(c.i)} % в месяц`)}</div>
    <div class="dl-tw"><table class="dl-t dl-tfix"><colgroup>${dlColW().map(w=>`<col${w?` style="width:${w}px"`:''}>`).join('')}</colgroup>
    <thead><tr>${[d0?'Дата · день':'День','Кто','Платёж','Сумма','Остаток денег','Финансирование'].map((t,k)=>`<th${k>2?' class="num"':''}>${t}<i class="dl-cr" data-dlcol="${k}" title="Потяните, чтобы изменить ширину столбца; двойной щелчок — как было" aria-hidden="true"></i></th>`).join('')}</tr></thead><tbody>
    ${c.rows.map(r=>{ const pt=DL_PARTY[r.party]||DL_PARTY.oth;
      const dayIn = r.fixed?`<span class="dl-day fx">${r.day}</span>`:`<input type="text" inputmode="numeric" class="dl-day" data-dlday="${esc(r.key)}" value="${r.day}" aria-label="День: ${esc(r.label)}" title="${r.manual?'Дата изменена вручную':'По срокам — можно изменить'}">`;
      const dateIn = r.fixed?`<span class="dl-dt">${dlDayRu(r.day)}</span>`:`<input type="date" class="dl-date" data-dldate="${esc(r.key)}" value="${dlDayIso(r.day)}" min="${d0}" aria-label="Дата: ${esc(r.label)}" title="${r.manual?'Дата изменена вручную':'По срокам — можно изменить'}">`;
      const mv = r.fixed || DL.ex ? '' : `<span class="dl-smv"><span class="dl-hdl" draggable="true" data-dnds="${esc(r.key)}" title="Перетащите строку выше или ниже — платёж получит дату нового места, срок пересчитается" aria-hidden="true">⠿</span><button type="button" class="dl-mvb" data-dlx="rowmv" data-key="${esc(r.key)}" data-d="-1" aria-label="Раньше — на дату платежа выше" title="Раньше — на дату платежа выше">↑</button><button type="button" class="dl-mvb" data-dlx="rowmv" data-key="${esc(r.key)}" data-d="1" aria-label="Позже — на дату платежа ниже" title="Позже — на дату платежа ниже">↓</button></span>`;
      return `<tr class="${r.inflow?'in':''}${r.manual?' man':''}" data-skey="${esc(r.key)}" data-sday="${r.day}"><td class="c-day${d0?' c-when':''}"><span class="dl-cdr">${mv}${d0?dateIn:dayIn}</span>${d0?`<small class="dl-wd${r.offDay?' bad-t':''}">день ${r.day} · ${dlWd(r.day)}${r.shiftedFrom!=null?` · <span title="По сроку — ${dlDayRu(r.shiftedFrom)} (${dlWd(r.shiftedFrom)}), нерабочий день">↷ с ${dlDayRu(r.shiftedFrom).slice(0,5)}</span>`:''}${r.offDay?' · нерабочий':''}</small>`:''}</td>
      <td class="c-who"><span class="dl-pty ${pt[1]}">${pt[0]}</span></td>
      <td class="c-ev">${esc(r.label)}${r.ev&&(r.party==='log'||r.party==='oth')?`<small>${esc(r.ev)}</small>`:''}</td><td class="num c-pay ${r.inflow?'ok-t':''}">${r.inflow?'+':'−'}${Fmt.rub(Math.abs(r.amount))}</td><td class="num c-bal ${r.balance<0?'neg':''}">${Fmt.rub(r.balance)}</td><td class="num c-fin">${r.fin?Fmt.rub(r.fin)+`<small>${r.days} дн.</small>`:'—'}</td></tr>`; }).join('')}
    </tbody><tfoot><tr><td class="c-day"></td><td class="c-who"></td><td class="c-ev">Стоимость финансирования</td><td class="c-pay"></td><td class="c-bal"></td><td class="num c-fin"><b>${dlRub(c.F)}</b></td></tr></tfoot></table></div>
    <div class="dl-qrow"><span>Как считается финансирование</span>${dlQ('Простой процент на недостающие деньги до последней оплаты заказчика, месяц — '+DealValues.n('deal.monthDays', 30)+' дней; оплаты заказчика уменьшают финансирование, доход на свободный остаток не начисляется.')}<span>Как переносить платежи</span>${dlQ('Перетащите платёж за «⠿» выше или ниже (или ↑ ↓, или выберите дату) — он получит новую дату, а срок, из которого он получился (этап оплаты, срок изготовления или доставки), пересчитается в днях и датах на предыдущих вкладках.')}</div>`, 'dl-sched', null, 'sched');
}

// ---------- прочие расходы наличными (необязательно): % от чистой прибыли, % от выручки без НДС или сумма — всё «чистыми», на руки
const DL_XC_WHEN=[['end','После последней оплаты заказчика'],['pay','С оплат заказчика — по этапам']];
const DL_XC_MODES=[['net','% от чистой прибыли'],['sale','% от суммы продажи без НДС'],['salevat','% от суммы продажи с НДС'],['sum','Сумма, ₽']];
function dlCash(c){
  const d=dlDeal(), x=c.xc, r=c.base||c.lo, open=!!(d.xc && Object.values(d.xc).some(v=>v!=null && v!==''));
  const unit = x.mode==='sum' ? '₽ на руки' : x.mode==='sale' ? '% выручки без НДС' : x.mode==='salevat' ? '% суммы с НДС' : '% чистой прибыли';
  const how = x.mode==='net' ? `${dlIn(x.v)} % от чистой прибыли сделки ${Fmt.rub(Math.max(0, r.Pa-r.tax))} (после налога на прибыль, до этих расходов)`
    : x.mode==='sale' ? `${dlIn(x.v)} % от выручки без НДС ${Fmt.rub(c.R)}` : x.mode==='salevat' ? `${dlIn(x.v)} % от суммы продажи с НДС ${Fmt.rub(c.S)}` : 'сумма на руки';
  return `<div class="dl-card dl-mb dl-cash"><div class="dl-mbh"><h5>Прочие расходы (наличные)</h5>${dlQ('Не уменьшают налог на прибыль — вычитаются из чистой прибыли; в КП не выводятся.')}<span class="dl-stc opt">необязательно</span>${r.K>0?`<b class="dl-mbs">${Fmt.rub(r.K)}</b>`:''}</div>
    <div class="dl-g g3">
      ${dlField('Как считать', 'xc.mode', {calc:c, select:DL_XC_MODES})}
      ${dlField(x.mode==='sum'?'Сумма на руки':'Процент', 'xc.v', {calc:c, unit, ph:x.mode==='sum'?'100 000':'10', q:'Сумма «чистыми» — столько получат на руки наличными, без каких-либо налогов. От чистой прибыли — процент от прибыли сделки после налога на прибыль (до этих расходов); от продажи — процент от суммы продажи без НДС или с НДС (цена КП).'})}
      ${dlField('Стоимость наличных', 'xc.cost', {calc:c, unit:'%', ph:dlIn(DealValues.n('deal.xcCost', 0)), q:'Сколько процентов от перечисленной суммы удерживают за выдачу наличных. Расход компании = сумма на руки ÷ (1 − процент). Пустое поле — значение по умолчанию из «Настроек» ('+dlIn(DealValues.n('deal.xcCost', 0))+' %); если наличные уже есть — впишите 0.'})}</div>
    ${x.on||open&&x.when==='pay'?`<div class="dl-g g2">${dlField('Когда выдаются', 'xc.when', {calc:c, select:DL_XC_WHEN, q:'После последней оплаты — наличные не влияют на финансирование. С оплат заказчика — с каждой отмеченной оплаты выдаётся часть, пропорционально её сумме, в день оплаты; деньги уходят раньше — финансирование может вырасти.'})}</div>
    ${x.when==='pay'?dlCashStages(c):''}`:''}
    ${r.K>0?`<p class="dl-cash-r">На руки <b>${Fmt.rub(r.X)}</b>${x.cost?` · расход компании с получением наличных <b>${Fmt.rub(r.K)}</b>`:''} <span class="muted">— ${esc(how)}</span></p>`:''}
</div>`;
}

// банковская гарантия: вид, сумма (от аванса, % цены или рублями), срок (днями или датой), ставка банка; комиссия — в расходы
function dlBg(c){
  const d=dlDeal(), gs=Array.isArray(d.bg)?d.bg:[];
  const rows=gs.map((g,k)=>{ const cg=c.bgs[k], P=`bg.${k}`, unit=cg.base==='sum'?'₽':cg.base==='adv'?'% аванса':'% цены КП';
    return `<div class="dl-bg">
      <div class="dl-g g3">${dlField('Вид гарантии', P+'.type', {calc:c, select:Object.entries(DEAL_BG_TYPES)})}
        ${dlField('Сумма гарантии', P+'.base', {calc:c, select:cg.type==='adv'?[['adv','от аванса заказчика'],['pct','% от цены КП'],['sum','в рублях']]:[['pct','% от цены КП'],['sum','в рублях'],['adv','от аванса заказчика']]})}
        ${dlField(cg.base==='sum'?'Сумма':'Процент', P+'.v', {calc:c, unit, ph:cg.base==='adv'?dlIn(DealValues.n('deal.bgAdvPct', 100)):cg.base==='pct'?dlIn(DealValues.n('deal.bgPct', 10)):'500 000'})}</div>
      <div class="dl-g g3">${dlField('Срок гарантии', P+'.days', {calc:c, int:true, auto:cg.daysAuto, autoLabel:cg.type==='adv'?'до поставки':cg.type==='perf'?'до конца ПНР':cg.daysAuto===365?'год':cg.daysAuto+' дн.', date:{base:0, val:cg.days, kind:false}})}
        ${dlField('Ставка банка', P+'.rate', {calc:c, unit:'% годовых', ph:String(dealBgRate()).replace('.',','), q:'Комиссия банка за гарантию — процент годовых от суммы гарантии за её срок. По умолчанию '+String(dealBgRate()).replace('.',',')+' %; рынок 2026: обычно 1–3,5 %, в среднем около 2,2 % (Сбербанк — от 2 %, ВТБ — от 3,7 %). Впишите ставку своего банка.'})}
        ${dlField('Минимальная комиссия', P+'.min', {calc:c, unit:'₽', ph:dlIn(DealValues.n('deal.bgMin', 0)), q:'Если у банка есть минимальная комиссия за гарантию — впишите её.'})}</div>
      <p class="dl-bgr"><span>Сумма гарантии <b>${Fmt.rub(cg.amount)}</b> · комиссия банка <b>${Fmt.rub(cg.fee)}</b> <span class="muted">— при подписании договора, уменьшает прибыль</span></span><button type="button" class="lnk" data-dlx="delbg" data-k="${k}">Убрать</button></p></div>`; }).join('');
  return `<div class="dl-card dl-mb"><div class="dl-mbh"><h5>Банковская гарантия</h5>${dlQ('Если заказчик просит безотзывную банковскую гарантию — на возврат аванса, исполнения договора или гарантийных обязательств, — добавьте её: комиссия банка войдёт в расходы.')}<span class="dl-stc opt">необязательно</span>${c.BG>0?`<b class="dl-mbs">${Fmt.rub(c.BG)}</b>`:''}</div>
    ${rows}
    ${DL.ex?'':'<div><button type="button" class="btn" data-dlx="addbg">+ Банковская гарантия</button></div>'}</div>`;
}

// с каких оплат заказчика выдаются наличные: отметки по этапам и сумма с каждой
function dlCashStages(c){
  const x=c.xc, ins=c.rows.filter(r=>r.inflow && r.amount>0), xs=c.rows.filter(r=>String(r.key).startsWith('xc:'));
  if (!ins.length) return '';
  return `<div class="dl-cst" role="group" aria-label="С каких оплат заказчика">${ins.map(r=>{ const on=x.off[r.stage]!==false, t=c.trs[r.stage], xr=xs.find(z=>z.from===r.key);
    return `<label class="dl-cst-r${on?'':' off'}"><input type="checkbox" data-xcst="${r.stage}"${on?' checked':''}><span>${esc((t&&t.name)||(r.stage===0&&c.trs.length>1?'Аванс':t&&t.last&&c.trs.length>1?'Окончательная оплата':'Оплата'))} ${dlPctTxt(r.pct||0)} <small class="muted">день ${r.day}</small></span><b>${xr?'−'+Fmt.rub(-xr.amount):'—'}</b></label>`; }).join('')}
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
  const parts = c.parts.map(([n,v])=>`<dt>${esc(n)}</dt><dd${v<0?' class="ok-t"':''}>${Fmt.rub(v)}${v>0&&r.Ctot>0?`<small>${dlIn(v/r.Ctot*100)} %</small>`:''}</dd>`).join('');
  const P = unk ? null : b.P;
  return `<div class="dl-res">
    ${DL.ex?'':`<div class="dl-price"><h4>Цена продажи${dlQ('Укажите нужную маржинальность, наценку или прибыль — программа рассчитает цену КП и цены позиций; «Перенести цены в КП» подставит их.')}</h4>
      <div class="dl-pr"><select data-dl="target.type" aria-label="По какому показателю подобрать цену">${[['margin','Маржинальность'],['markup','Наценка'],['profit','Прибыль до налога'],['net','Чистая прибыль']].map(([v,t])=>`<option value="${v}"${tg.type===v?' selected':''}>${t}</option>`).join('')}</select>
        <span class="dl-in"><input type="text" inputmode="decimal" data-dl="target.v" value="${esc(tg.v||'')}" placeholder="${unit==='%'?'20':'500 000'}" aria-label="Нужное значение"><i>${unit}</i></span></div>
      ${need!=null?`<p class="dl-need"><small>Цена КП с НДС</small><b>${Fmt.rub(need)}</b><span class="${need<kp.sumRub?'ok-t':'muted'}">${Math.abs(need-kp.sumRub)<1?'совпадает с КП':`${need>=kp.sumRub?'+':'−'}${Fmt.rub(Math.abs(need-kp.sumRub))} к текущей цене КП`}</span></p>
        ${plan}<button class="btn primary dl-apply" type="button" data-dlx="apply" data-s="${need}">Перенести цены в КП</button>
        <p class="dl-note">${esc(pl?'Распределено '+pl.basis+'.':'')}</p>`
        : tv!=null?'<p class="muted dl-pmsg">Цель недостижима при этих расходах.</p>':''}
      <div class="dl-be">Безубыточная цена с НДС: <b>${be!=null?Fmt.rub(be):'—'}</b>${dlQ('Цена, при которой прибыль после всех расходов и финансирования равна нулю. Ниже — убыток.')}</div></div>`}
    <div class="dl-now"><h4>Итог при текущей цене КП <span class="muted">${Fmt.rub(c.S)}</span></h4>
      ${bad?'<span class="dl-chip bad">Проверьте данные</span>':unk?'<span class="dl-chip warn">Нужна сумма ввозного НДС</span>':''}${noCost?`<span class="dl-chip warn">Расчёт неполный: нет закупки у ${noCost} поз.</span>`:''}
      <div class="dl-big${P!=null&&P<0?' neg':''}${unk?' rng':''}"><small>${r.K>0?'Прибыль до налога, за вычетом наличных':'Прибыль до налога на прибыль'}</small><b>${unk?`${Fmt.rub(lo.P)} … ${Fmt.rub(hi.P)}`:Fmt.rub(P)}</b>
        ${unk?'':`<p class="dl-note">Чистая прибыль после налога ${dlIn(c.taxP)} %${r.K>0?' и прочих расходов':''}: <b>${Fmt.rub(b.net)}</b></p>`}${r.K>0?`<p class="dl-note">С учётом прочих расходов наличными ${Fmt.rub(r.K)}</p>`:''}</div>
      <div class="dl-kpi"><div><small>Маржинальность ${dlQ('Прибыль ÷ выручка без НДС. Сколько копеек прибыли в каждом рубле выручки.')}</small><b>${unk?`${dlPct(lo.margin)} … ${dlPct(hi.margin)}`:dlPct(b.margin)}</b></div>
        <div><small>Наценка ${dlQ('Прибыль ÷ себестоимость (все расходы с финансированием, без НДС к вычету, и прочие расходы наличными).')}</small><b>${unk?`${dlPct(lo.markup)} … ${dlPct(hi.markup)}`:dlPct(b.markup)}</b></div></div>
      <dl class="dl-dl">
        <dt>Выручка без НДС</dt><dd>${Fmt.rub(c.R)}</dd>
        <dt>Себестоимость с финансированием</dt><dd>${Fmt.rub(r.Ctot)}</dd>
        <dt>в т. ч. финансирование</dt><dd>${Fmt.rub(c.F)}</dd>
        <dt>НДС к уплате в бюджет${dlQ('НДС с продажи минус НДС к вычету: в цене российских поставщиков, ввозной на таможне, в доставке и услугах в России, прочий. Разбивка — ниже и в шаге «Деньги и налог».')}</dt><dd>${unk?`${Fmt.rub(hi.payable)} … ${Fmt.rub(lo.payable)}`:Fmt.rub(r.payable)}</dd>
        ${r.K>0?`<dt>Прочие расходы (наличные)</dt><dd>${Fmt.rub(r.K)}${r.K!==r.X?`<small>на руки ${Fmt.rub(r.X)}</small>`:''}</dd>`:''}
        <dt>Налог на прибыль${r.K>0?' <small class="muted">— без учёта наличных</small>':''}</dt><dd>${Fmt.rub(r.tax)}</dd>
        <dt>Деньги на счёте после сделки</dt><dd>${Fmt.rub(r.cashAfter)}</dd></dl>
      <details class="dl-more dl-parts" data-more="vat"${dlMore('vat', false)}><summary>Из чего НДС к уплате</summary>${dlVat(c, r)}</details>
      ${parts?`<details class="dl-more dl-parts" data-more="parts"${dlMore('parts', false)}><summary>Из чего себестоимость</summary><dl class="dl-dl">${parts}</dl></details>`:''}
      ${c.warn.length?`<ul class="dl-warn">${c.warn.map(w=>`<li class="${w.bad?'bad':''}">${esc(w.t)}</li>`).join('')}</ul>`:''}</div>
  </div>`;
}

// НДС к уплате в бюджет: НДС с продажи минус вычеты (поставщики в РФ, ввозной на таможне, услуги в России, прочие)
function dlVatRows(c){
  const viSum=c.sup.reduce((a,s)=>a+(s.vi||0),0), unk=c.unknown.length>0;
  const ded=[[`НДС в цене поставщиков`, c.voSup, 'выделенный в счетах российских поставщиков'],
    [`Ввозной НДС на таможне`, viSum, unk?'нет суммы у поставщика с растаможкой «суммой» — укажите ввозной НДС':'уплачен при ввозе, весь к вычету'],
    [`НДС в доставке, брокере и услугах в России`, c.voRuSum, 'в ценах перевозчиков, брокера, СВХ'],
    [`Прочий НДС к вычету`, c.Vo, 'монтаж, ПНР и прочие подрядчики с НДС']].filter(x=>x[1]>0.004 || (x[0].startsWith('Ввозной') && unk));
  return { viSum, unk, ded };
}
function dlVat(c, r, wide){
  const {ded, unk}=dlVatRows(c), lo=c.lo, hi=c.hi;
  const pay = unk ? `${Fmt.rub(hi.payable)} … ${Fmt.rub(lo.payable)}` : Fmt.rub(r.payable);
  return `<table class="dl-vat${wide?' wide':''}"><tbody>
    <tr><td>НДС ${dlIn(c.v)} % с продажи <small>${Fmt.rub(c.S)} × ${dlIn(c.v)} / ${dlIn(100+c.v)}</small></td><td class="num">${Fmt.rub(c.VATs)}</td></tr>
    ${ded.map(([t,v,h])=>`<tr class="ded"><td>− ${esc(t)}${h?` <small>${esc(h)}</small>`:''}</td><td class="num">${v>0.004?'−'+Fmt.rub(v):'?'}</td></tr>`).join('')}
    <tr class="sum"><td>Итого НДС к вычету</td><td class="num">${unk?`${Fmt.rub(lo.VATin)} … ${Fmt.rub(hi.VATin)}`:'−'+Fmt.rub(r.VATin)}</td></tr>
    <tr class="tot"><td><b>НДС к уплате в бюджет</b></td><td class="num"><b>${pay}</b></td></tr>
    ${!unk&&r.excess>0.5?`<tr class="ex"><td>Вычеты больше НДС с продажи — к возмещению из бюджета <small>в остаток денег не включается</small></td><td class="num">${Fmt.rub(r.excess)}</td></tr>`:''}
  </tbody></table>`;
}

function dealRender(force){
  const dlg=$('#dealdlg'); if (!dlg || !dlg.isConnected || !dlg.open && !force) return;
  try{ ItemAttrs.during(()=>dealRenderIn(dlg)); }
  catch(e){ console.error(e); morph(dlg, `<div class="dlg-h"><h3>Экономика сделки</h3><button class="icon" type="button" data-dlx="close" aria-label="Закрыть">✕</button></div>
    <p class="msg err" style="margin:20px">Не удалось показать расчёт: ${esc(e.message||e)}. Сообщите разработчику; данные КП не изменены.</p>`); }
}

function dealRenderIn(dlg){
  const d=dlDeal(); lgSync(d);                 // доставка по России из вкладки «Логистика» — в расчёт
  const kp=dlKp(), c=dealCalc(kp,d);
  if (dealSyncConds(c)) persist();
    const keyT = DL.key ? `ключевая ${dlIn(DL.key.rate)} % + ${dlSpread()}` : 'по умолчанию';
  const d0h=dlD0(), calT=d0h?dlCalNote(d0h).replace(/<[^>]+>/g,''):'';
  // на телефоне шапка — одна строка, дата договора — в строке с прибылью (рабочая зона больше)
  const mob=isMob();
  const sAuto=!DL.ex && d.startAuto;
  const hd=`<label class="dl-hd${d0h?'':' empty'}${sAuto?' auto':''}"><span>Дата договора${sAuto?'<em class="dl-hdw" title="Подставлена сегодняшняя дата — укажите ориентировочную дату подписания договора: от неё считаются сроки и даты платежей">сегодня — уточните</em>':''}${dlQ('Ориентировочная дата заключения договора (день 0). От неё считаются сроки поставки и даты всех платежей; рабочие (банковские) дни — по производственному календарю РФ.'+(calT?' '+calT+'.':''))}</span><input type="date" data-dlstart value="${esc(d0h)}" aria-label="Дата договора"${DL.ex?' disabled':''}></label>`;
  const head=`<div class="dlg-h"><h3>Экономика сделки${!DL.ex&&S.number?` · КП № ${esc(S.number)}`:''}<small>${esc(S.client||'Получатель не указан')}</small></h3>
      ${mob?'':hd}<button class="btn" type="button" data-dlx="xlsx" title="Excel для согласования"><span class="dl-xl-l">Excel для согласования</span><span class="dl-xl-s">Excel</span></button><button class="icon dl-maxb" type="button" data-dlx="max" aria-label="Во весь экран" title="Во весь экран / обычный размер. Размер окна можно менять, потянув за правый нижний угол">⤢</button><button class="icon" type="button" data-dlx="close" aria-label="Закрыть">✕</button></div>`;
  const banner = kp.sumNoRate ? `<div class="dl-ex warn">Нет курса валюты КП (${esc(kp.cur)}) — цена не переведена в рубли. Укажите курс в шаге «Цена КП и валюта».</div>` : '';
  const b=c.base, mini = b ? `<span><small>Прибыль при цене КП</small><b class="${b.P<0?'neg':''}">${Fmt.rub(b.P)}</b></span><span class="r"><small>Маржинальность</small><b>${dlPct(b.margin)}</b></span>`
    : `<span><small>Прибыль при цене КП</small><b>${Fmt.rub(c.lo.P)} … ${Fmt.rub(c.hi.P)}</b></span><span class="r warn-t">нужен ввозной НДС</span>`;
  const otherOpen = dlFilled(d.vo, d.warr, d.bonus), xK=(c.base||c.lo).K;
  const xNote=[c.W+c.Bn?`резерв и бонусы ${Fmt.rub(c.W+c.Bn)}`:'', c.BG?`банковская гарантия ${Fmt.rub(c.BG)}`:'', xK?`наличные ${Fmt.rub(xK)}`:''].filter(Boolean).join(', ');
  // шаги по порядку заполнения; свёрнутые — одной строкой; открыт один (или все — «Развернуть все шаги»)
  const hasCus=d.sup.some((s,k)=>!(c.sup[k].mode==='none' && /^росс/i.test(s.country||'')));
  const DL_TAB_SHORT={sched:'График'};
  const order=[['sum','Кратко'], ['buy','Закупка'], ['log','Логистика'], ...(hasCus?[['cus','Таможня']]:[]), ['cust','Оплата заказчика'], ['mnt','Расходы'], ['price','Цена КП'], ['money','Деньги и налог'], ['sched','График платежей']];
  DL.nav={}; order.forEach(([id],k)=>{ DL.nav[id]={n:k+1, next:order[k+1]&&order[k+1][0], nextT:order[k+1]&&order[k+1][1], prev:order[k-1]&&order[k-1][0], prevT:order[k-1]&&order[k-1][1]}; });
  DL.si=dlStepInfo(c);
  if (DL.open===undefined || !DL.nav[DL.open]) DL.open='sum';     // сначала — обзор: итог, чего не хватает, поставщики и сроки
  const tabs=`<nav class="dl-tabs" role="tablist" aria-label="Шаги расчёта">${order.map(([id,t],k)=>{ const st=(DL.si[id]||{}).st, on=DL.open===id;
    return `<button type="button" role="tab" aria-selected="${on}" class="dl-tab${on?' on':''}${st?' st-'+st:''}" data-dlx="step" data-id="${id}" title="${esc(t+': '+((DL.si[id]||{}).sum||''))}"><span class="dl-tn">${st==='ok'?'✓':st==='need'?'!':k+1}</span><span class="dl-tt">${DL_TAB_SHORT[id]||t}</span></button>`; }).join('')}</nav>`;
  const d0=dlD0();
  const cust=dlCustoms(c);
  const custStep=dlStep(0, 'Оплата заказчика', 'Когда и сколько платит заказчик. Выберите готовый вариант или впишите свои этапы; сроки — днями или датой.', dlCustomer(c), '', ['Итого заплатит заказчик', c.rows.filter(r=>r.inflow).reduce((a,r)=>a+r.amount,0), `${c.trs.filter(t=>t.p>0).length} ${plural(c.trs.filter(t=>t.p>0).length,'платёж','платежа','платежей')}, последний — ${d0?dlDayRu(c.Tend):'день '+c.Tend}`], 'cust');
  dlg.dataset.tab=DL.open;
  morph(dlg, `${head}${banner}<div class="dl-mini">${mob?hd:''}${mini}</div><div class="dl-b"><div class="dl-tabw">${tabs}</div><div class="dl-form">
    ${dlOverview(c)}
    ${dlPurchase(c)}
    ${dlLogistics(c)}
    ${cust}
    ${custStep}
    ${dlStep(0, 'Расходы', 'Всё необязательно: заполните то, что есть в сделке. Пустые поля не учитываются.', `<div class="dl-card dl-mb"><div class="dl-mbh"><h5>Монтаж, ПНР, документация и прочие расходы</h5><span class="dl-stc opt">необязательно</span>${c.M+c.E+c.Dc+c.W+c.Bn>0?`<b class="dl-mbs">${Fmt.rub(c.M+c.E+c.Dc+c.W+c.Bn)}</b>`:''}</div><div class="dl-g g3">
      ${dlField('Монтаж и ПНР', 'mnt', {calc:c, unit:'₽', hint:'Платёж — при поставке'})}${dlField('ПНР займут', 'pnr', {calc:c, int:true, date:{base:c.D, val:c.pnrDays}, hint:'После поставки — для оплаты «после ПНР»'})}${dlField('Прочие расходы', 'oth', {calc:c, unit:'₽', hint:'Платёж — при поставке'})}</div>
      <div class="dl-doc">${dlField('Разработка документации', 'doc', {calc:c, unit:'₽', hint:'Платёж — до отгрузки', q:'Проектная (ПД), рабочая (РД) и исполнительная документация — если её разрабатываете вы или подрядчик. Отмеченные виды попадут в условия КП: «входит в стоимость».'})}
        <div class="dl-dock" role="group" aria-label="Виды документации"><span class="muted">Виды:</span>${Object.entries(DEAL_DOC_KINDS).map(([k,t])=>`<button type="button" class="chip${(d.docK||{})[k]?' on':''}" data-dlx="dock" data-v="${k}" aria-pressed="${!!(d.docK||{})[k]}"${DL.ex?' disabled':''}>${(d.docK||{})[k]?'✓ ':''}${t.charAt(0).toUpperCase()+t.slice(1)}</button>`).join('')}</div></div>
      <details class="dl-more" data-more="oth"${dlMore('oth', otherOpen)}><summary>Ещё <span class="muted">— резерв на гарантию, бонусы с продажи, прочий НДС к вычету</span></summary><div class="dl-g g3">
        ${dlField('Резерв на гарантию', 'warr', {calc:c, unit:'% выручки', ph:'1', q:'Деньги на гарантийные случаи — процент от выручки без НДС.'})}${dlField('Бонусы и комиссии', 'bonus', {calc:c, unit:'% выручки', q:'Агентам, партнёрам, менеджерам — платятся после оплаты заказчика.'})}
        ${dlField('Прочий НДС к вычету', 'vo', {calc:c, unit:'₽', q:'НДС в монтаже и прочих расходах, если подрядчики с НДС.'})}</div></details></div>
      ${dlBg(c)}
      ${dlCash(c)}`, '', ['Итого расходы', c.M+c.E+c.Dc+c.W+c.Bn+c.BG+xK, xNote?'в т. ч. '+xNote:''], 'mnt') }
    ${dlStep(0, 'Цена КП и валюта', DL.ex?'Значения примера.':'Здесь меняются цены КП, валюта и курс — так же, как в разделе «Цены и валюта».', dlKpPrice(c), '', ['Цена КП с НДС', c.S, `выручка без НДС ${Fmt.rub(c.R)}, НДС ${dlIn(c.v)} % — ${Fmt.rub(c.VATs)}`], 'price')}
    ${dlStep(0, 'Деньги и налог', 'Обычно менять не нужно: стоимость денег — по ключевой ставке ЦБ, НДС продажи — как в КП, налог на прибыль — 25 %.', `<div class="dl-card"><div class="dl-g dl-money">
      ${dlField('Стоимость денег', 'money', {calc:c, unit:'% в месяц', auto:kp.moneyAuto, autoLabel:keyT, autoTitle:DL.key?`Ключевая ставка ЦБ РФ ${dlIn(DL.key.rate)} % с ${DL.key.date} + ${dlSpread()} п.п. годовых, делённое на 12`:(DL.keyErr?'Ключевая ставка ЦБ недоступна: '+DL.keyErr:''),
        hint:DL.key?`Ключевая ставка ЦБ ${dlIn(DL.key.rate)} % + ${dlSpread()} п.п. = ${dlIn(DL.key.rate+dlSpread())} % годовых → ${dlIn((DL.key.rate+dlSpread())/12)} % в месяц`:'Процент в месяц на деньги, вложенные до оплаты заказчика',
        q:'Сколько стоят деньги, вложенные в сделку до оплаты заказчика: кредит или упущенный доход. По умолчанию — ключевая ставка ЦБ + '+dlIn(dlSpread())+' п.п. в год (нет ставки ЦБ — '+dlIn(DealValues.n('deal.moneyFb', 2))+' % в месяц).'})}
      ${DL.ex?dlField('НДС продажи', 'over.vat', {calc:c, unit:'%', kp:kp.vat}):`<label class="f dl-f"><span>НДС продажи <i>%</i>${dlQ('Ставка НДС в цене КП — та же, что в разделе «Условия». С 2026 года основная ставка — 22 %.')}</span><span class="dl-in"><input type="text" inputmode="numeric" data-kpvat value="${esc(S.vat)}" aria-label="НДС продажи, %"></span><small class="muted">Как в КП и разделе «Условия»</small></label>`}
      ${dlField('Налог на прибыль', 'tax', {calc:c, unit:'%', hint:'С 2025 года — 25 % (ст. 284 НК РФ)', q:'Считается с прибыли после всех расходов, включая финансирование. Проценты по кредиту уменьшают налог; если «стоимость денег» — упущенный доход на свои деньги, налоговая её не учитывает, и налог будет немного больше.'})}</div></div>
      <div class="dl-card dl-vatsec"><h5>НДС к уплате${dlQ('НДС с продажи минус весь НДС к вычету по сделке. Ставка НДС продажи — из КП. Ввозной НДС платится на таможне и целиком идёт к вычету, поэтому на прибыль не влияет — только на деньги в обороте.')}</h5>${dlVat(c, c.base||c.lo, true)}</div>`, '', ['Итого финансирование и налог', c.F+(c.base||c.lo).tax, `финансирование ${Fmt.rub(c.F)} + налог на прибыль ${Fmt.rub((c.base||c.lo).tax)} · НДС к уплате ${c.unknown.length?`${Fmt.rub(c.hi.payable)} … ${Fmt.rub(c.lo.payable)}`:Fmt.rub((c.base||c.lo).payable)}`], 'money')}
    ${dlSchedule(c, 0)}
    <div class="dl-foot"><span class="muted">Пересчёт — сразу при вводе. Закупка сохраняется в КП и каталоге.</span></div>
  </div><aside class="dl-side">${dlResult(c)}</aside></div>`);
  lgAutoQuote();
}

// ---------- коды ТН ВЭД и пошлины: позиция сделки и справочник категорий
// Позиция: вручную в этом КП → по модели (база) → по категории (база) → справочно (TnVed: 10 знаков по виду и характеристикам).
class DealHs {
  static REF = 'справочно';

  // код и ставка позиции и откуда они (источник — по ставке: она влияет на расчёт); ref — справочное значение для сверки
  static of(x, d=S.deal){
    const a=attrsOf(x), cus=DL.cus||{}, cat=x.role==='container'?'container':a.cat, ref=TnVed.pick(x, a, cat);   // контейнер станции — свой код
    const chain=[[d&&d.hs&&d.hs[x.id],'вручную'], [x.catId&&cus['item:'+x.catId],'по модели'], [cus['cat:'+cat],'по категории'], [ref,DealHs.REF]];
    const get=f=>{ for (const [o,src] of chain) if (o && o[f]!=null && String(o[f]).trim()!=='') return [String(o[f]).trim(), src]; return ['', '']; };
    const [code, cs]=get('code'), [duty, ds]=get('duty');
    return {code, duty, src:ds||cs, ref};
  }

  // отметка источника: справочное — с надёжностью кода; своё, расходящееся со справочным по ставке, — с кнопкой «справочно N %»
  static badge(x, h){
    const r=h.ref, tip=TnVed.title(r);
    if (!h.src) return `<span class="dl-badge warn" title="${esc(tip||'Код и ставка для этого вида оборудования не определены — укажите вручную или возьмите из справочника')}">укажите</span>`;
    if (h.src===DealHs.REF) return `<span class="dl-badge ${r&&r.ok===1?'kp':'warn'}" title="${esc(tip)}">${r&&r.ok===1?'справочно':r&&r.ok===2?'справочно · проверьте':'справочно · уточните'}</span>`;
    const differs = r && r.duty!=='' && dNum(r.duty)!==dNum(h.duty);
    return `<span class="dl-badge kp" title="${esc(tip?'Справочно: '+tip:'')}">${esc(h.src)}</span>`
      + (differs ? `<button type="button" class="lnk dl-hsref" data-dlx="hsref" data-id="${esc(x.id)}" title="${esc('Взять справочный код и ставку:\n'+tip)}">справочно ${esc(r.code)} · ${esc(r.duty)} %</button>` : '');
  }

  // категории справочника: встроенные виды оборудования (значение из базы или справочное) и свои (cat:x_…)
  static cats(){
    const cus=DL.cus||{}, out=[...TYPES, {id:'container', name:'Блок-контейнер (станции)'}].map(t=>{ const o=cus['cat:'+t.id]||{}, def=TnVed.catDefault(t.id)||{};
      const v=f=>o[f]!=null&&String(o[f])!==''?String(o[f]):(def[f]||'');
      return {key:'cat:'+t.id, id:t.id, name:t.name, code:v('code'), duty:v('duty'), note:o.note||def.note||'', ok:def.ok, own:false, edited:!!(o.code||o.duty)}; });
    for (const [k,o] of Object.entries(cus)) if (k.startsWith('cat:x_')) out.push({key:k, id:k.slice(4), name:o.name||'Своя категория', code:o.code||'', duty:o.duty||'', note:o.note||'', own:true});
    return out;
  }

  static async put(key, o){
    await api('/api/customs',{method:'PUT',headers:{'Content-Type':'application/json; charset=utf-8'},body:JSON.stringify({key, code:o.code||'', duty:o.duty??'', note:o.note||'', name:o.name||''})});
    DL.cus=DL.cus||{}; if (key.startsWith('cat:x_') && !o.name) delete DL.cus[key]; else DL.cus[key]={...(DL.cus[key]||{}), ...o};
  }

  // код и ставка строки закупки (позиция или элемент станции): у модели каталога — в базу (для всех следующих сделок), иначе — в этом КП
  static set(lineId, patch){
    const l=kitLines(S).find(z=>z.id===lineId); if (!l) return; const x=l.item, d=dealEnsure(), h=DealHs.of(x), o={code:h.code, duty:h.duty};
    for (const f of ['code','duty']) if (patch[f]!=null) o[f]=String(patch[f]).trim();
    if (x.catId){ const key='item:'+x.catId; DL.cus=DL.cus||{}; DL.cus[key]={...o};
      api('/api/customs',{method:'PUT',headers:{'Content-Type':'application/json; charset=utf-8'},body:JSON.stringify({key, code:o.code, duty:o.duty, note:''})}).catch(()=>toast('Код не сохранён в справочнике — проверьте связь с сервером')); }
    else { d.hs=d.hs||{}; d.hs[lineId]=o; }
  }

  // взять справочный код и ставку (TnVed) для строки
  static useRef(lineId){ const l=kitLines(S).find(z=>z.id===lineId), r=l && DealHs.of(l.item).ref; if (!r) return '';
    DealHs.set(lineId, {code:r.code, duty:r.duty}); return `Код ${r.code||'—'}, пошлина ${r.duty===''?'— уточните':r.duty+' %'} — по справочнику`; }

  static dir(){
    const dd=$('#dlg'); dd.classList.add('wide');
    const okTxt=o=>o.own||o.edited||o.ok==null||/брокер/.test(o.note) ? '' : o.ok===1 ? '' : o.ok===2 ? ' · проверьте у брокера' : ' · ставку уточните у брокера';
    const draw=()=>{ const cats=DealHs.cats();
      dd.innerHTML=`<div class="dlg-h"><h3>Коды ТН ВЭД и пошлины по категориям</h3><button class="icon" type="button" data-close aria-label="Закрыть">✕</button></div>
      <div class="dlg-b"><p class="muted">Код позиции подбирается по виду оборудования и характеристикам (давление, производительность, мощность, объём, исполнение) — коды из 10 знаков и ставки ЕТТ ЕАЭС (${esc(TnVed.AT)}). Значение категории ниже — код по умолчанию; если его изменить, он заменит подбор для всех моделей категории. У конкретной модели код и ставку можно изменить в «Экономике сделки». Окончательно код подтверждает таможенный брокер.</p>
      <table class="dl-it dl-hsdir"><thead><tr><th>Категория</th><th>Код ТН ВЭД</th><th>Пошлина, %</th><th>Пояснение</th><th></th></tr></thead><tbody>
      ${cats.map(o=>`<tr data-key="${esc(o.key)}">
        <td>${o.own?`<input type="text" data-hf="name" value="${esc(o.name)}" placeholder="Название категории">`:`<b>${esc(o.name)}</b>${o.edited?'<small class="ok-t">изменено</small>':''}`}</td>
        <td><input type="text" data-hf="code" value="${esc(o.code)}" placeholder="0000 00 000 0"></td>
        <td><input type="text" inputmode="decimal" data-hf="duty" value="${esc(o.duty)}" placeholder="?"></td>
        <td>${o.own?`<input type="text" data-hf="note" value="${esc(o.note)}" placeholder="Что входит">`:`<span class="muted">${esc(o.note+okTxt(o))}</span>`}</td>
        <td>${o.own?`<button type="button" class="icon" data-hdel aria-label="Удалить категорию">✕</button>`:o.edited?`<button type="button" class="lnk" data-hreset title="Вернуть справочное значение">↺</button>`:''}</td></tr>`).join('')}
      </tbody></table>
      <div class="row" style="gap:10px;margin-top:12px;align-items:center"><button type="button" class="btn" data-hadd>+ Добавить категорию</button><span class="muted">Изменения сохраняются сразу — в базе, для всего отдела.</span></div></div>`;
    };
    draw(); dd.showModal();
    dd.onclick=async e=>{ const t=e.target;
      if (t.closest('[data-close]')){ dd.close(); dd.classList.remove('wide'); dd.onclick=dd.onchange=null; return dealRender(); }
      if (t.closest('[data-hadd]')){ const key='cat:x_'+uid(); try{ await DealHs.put(key, {name:'Новая категория', code:'', duty:'0'}); draw(); dd.querySelector(`[data-key="${key}"] [data-hf="name"]`)?.select(); }catch(err){ toast('Не удалось добавить: '+(err.message||err)); } return; }
      const tr=t.closest('tr[data-key]'); if (!tr) return; const key=tr.dataset.key;
      if (t.closest('[data-hdel]')){ if (!await stConfirm('Удалить категорию?', 'Категория пропадёт из справочника; у моделей, где её выбрали, код и ставка останутся.', 'Удалить')) return;
        try{ await DealHs.put(key, {name:'', code:'', duty:''}); draw(); }catch(err){ toast('Не удалось удалить: '+(err.message||err)); } return; }
      if (t.closest('[data-hreset]')){ try{ await DealHs.put(key, {code:'', duty:''}); draw(); }catch(err){ toast('Не удалось: '+(err.message||err)); } } };
    dd.onchange=async e=>{ const t=e.target, tr=t.closest('tr[data-key]'); if (!t.dataset.hf || !tr) return;
      const key=tr.dataset.key, o={...(DL.cus[key]||{})}; tr.querySelectorAll('[data-hf]').forEach(i=>{ o[i.dataset.hf]=i.value.trim(); });
      if (key.startsWith('cat:x_') && !o.name){ toast('Укажите название категории'); return; }
      try{ await DealHs.put(key, o); toast('Сохранено в справочнике'); }catch(err){ toast('Не удалось сохранить: '+(err.message||err)); } };
  }
}

// ---------- события окна
function dlWinSize(dlg, save){ try{
  if (save){ localStorage.setItem('kp.dealwin2', JSON.stringify({max:dlg.classList.contains('max'), w:dlg.style.width||'', h:dlg.style.height||''})); return; }
  const o=JSON.parse(localStorage.getItem('kp.dealwin2')||'{}')||{}; dlg.classList.toggle('max', !!o.max); if (o.w) dlg.style.width=o.w; if (o.h) dlg.style.height=o.h; }catch(e){} }

function dealBind(dlg){
  const touch=()=>{ if (DL.ex) return; S.deal.touched=true; persist(); SidePanel.render(); };
  // правка цены, закупки, курса или НДС КП: updateLive сама перерисует правую панель и сохранит черновик
  const touchLive=()=>{ if (!DL.ex) S.deal.touched=true; updateLive(); };
  const comboClose=()=>{ if (!DL.combo) return; DL.combo=null; DL.comboIx=-1; dealRender(); };
  dlWinSize(dlg);
  lgBind(dlg, touch);
  let szT=null; if (window.ResizeObserver) new ResizeObserver(()=>{ if (!dlg.open || isMob() || dlg.classList.contains('max')) return; clearTimeout(szT);
    szT=setTimeout(()=>{ const r=dlg.getBoundingClientRect(); if (r.width>300){ dlg.style.width=Math.round(r.width)+'px'; dlg.style.height=Math.round(r.height)+'px'; dlWinSize(dlg,true); } }, 600); }).observe(dlg);
  dlg.addEventListener('input', e=>{ const t=e.target;
    if (t.dataset.costI!=null){ const x=S.items[+t.dataset.costI], n=dNum(t.value); x._costText=t.value; t.classList.toggle('bad', Number.isNaN(n));
      if (!Number.isNaN(n)) x.cost=n==null?0:Math.round(n*100); touchLive(); return dealRender(); }
    if (t.dataset.kppI!=null){ const x=S.items[+t.dataset.kppI], k=parsePrice(t.value); x._priceText=t.value; x.price=Number.isNaN(k)?0:k; x.priceManual=true;
      t.classList.toggle('bad', Number.isNaN(k)||!k); d0over(); touchLive(); return dealRender(); }
    if (t.dataset.kprate!=null){ S.pricing.rates[t.dataset.kprate]=t.value; S.pricing.rateSrc='вручную'; if (S.deal&&S.deal.rates) delete S.deal.rates[t.dataset.kprate]; touchLive(); return dealRender(); }
    if (t.dataset.kpvat!=null){ S.vat=t.value.replace(/[^\d.,]/g,''); touchLive(); return dealRender(); }
    if (t.dataset.hsI!=null){ DealHs.set(t.dataset.hsI, {[t.dataset.f]:t.value}); touch(); return dealRender(); }
    const p=t.dataset.dl; if (!p || t.tagName==='SELECT') return;
    const d=dlDeal(); setPath(d, p, t.value); if (!DL.ex) dealRememberDefault(p, t.value);
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
    if (t.dataset.dlstart!=null){ if (DL.ex) return; const d=dlDeal(); d.start=t.value||''; d.startAuto=false; if (!d.start){ d.start=today(); d.startAuto=true; } touch(); return dealRender(); }
    if (t.dataset.dldate!=null){ const n=dlIsoDay(t.value); if (n==null||n<0){ toast('Дата раньше дня 0 — укажите дату не раньше подписания договора'); return dealRender(); }
      toast(dlSetRowDay(t.dataset.dldate, n)); touch(); return dealRender(); }
    if (t.dataset.dlday!=null){ const n=dNum(t.value); if (!(Number.isInteger(n) && n>=0)){ toast('День — целое число от 0'); return dealRender(); }
      toast(dlSetRowDay(t.dataset.dlday, n)); touch(); return dealRender(); }
    if (t.dataset.kpcur!=null){ kpSetCur(t.value); touch(); return; }
    if (t.dataset.dlpreset!=null){ if (DL.ex || !t.value) return; const d=dlDeal(), k=+t.dataset.k;
      if (t.dataset.dlpreset==='tr'){ const p=DL_TR_PRESETS[t.value]; if (!p) return; d.cust.tr=JSON.parse(JSON.stringify(p[1])); d.days={}; toast('Оплата заказчика: '+p[0]); }
      else { const p=DL_SP_PRESETS[t.value]; if (!p) return; d.sup[k].pay=JSON.parse(JSON.stringify(p[1])); dlSaveSupplier(d.sup[k]); toast('Оплата поставщику: '+p[0]); }
      touch(); return dealRender(); }
    if (t.dataset.dldd!=null){ if (DL.ex || !t.value) return; const d=dlDeal();
      if (!dlD0()){ d.start=today(); d.startAuto=true; toast('Дата договора — сегодня. Её можно изменить вверху окна'); }
      const base=+t.dataset.base||0, day=dlIsoDay(t.value), n=t.dataset.kind==='work' ? (day>=base ? dlCountWork(base, day) : -1) : day-base;
      if (!(n>=0)){ toast(`Дата раньше события, от которого считается срок (${dlDayRu(+t.dataset.base||0)}) — выберите дату позже`); return dealRender(); }
      setPath(d, t.dataset.dldd, String(n)); const m=/^sup\.(\d+)\./.exec(t.dataset.dldd); if (m) dlSaveSupplier(d.sup[+m[1]]); touch(); return dealRender(); }
    if (t.dataset.xcst!=null){ const d=dlDeal(); d.xc=d.xc||{}; const off={...(d.xc.off||{})}; if (t.checked) delete off[t.dataset.xcst]; else off[t.dataset.xcst]=false; d.xc.off=off; touch(); return dealRender(); }
    if (t.dataset.costcurI!=null){ S.items[+t.dataset.costcurI].costCur=t.value; if (t.value!=='RUB' && !(rateOf(t.value)>0)) loadCBR(); touchLive(); return dealRender(); }
    if (t.dataset.kpvat!=null || t.dataset.kprate!=null){ renderForm(); return; }
    if (t.dataset.dl && t.tagName==='SELECT'){ setPath(dlDeal(), t.dataset.dl, t.value); if (!DL.ex) dealRememberDefault(t.dataset.dl, t.value);
      const m=/^sup\.(\d+)\./.exec(t.dataset.dl); if (m && !DL.ex) dlSaveSupplier(dlDeal().sup[+m[1]]); touch(); dealRender(); }
    if (t.dataset.hspick!=null){ const o=DealHs.cats().find(z=>z.key===t.value); if (o){ DealHs.set(t.dataset.hspick, {code:o.code, duty:o.duty}); touch(); toast(`Код ${o.code||'—'}, пошлина ${o.duty===''?'— уточните':o.duty+' %'} — «${o.name}»`); } return dealRender(); }
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
    if (a==='hsdir') return DealHs.dir();
    if (a==='hsref'){ const msg=DealHs.useRef(b.dataset.id); if (msg){ touch(); toast(msg); } return dealRender(); }
    if (a==='apply') return dealApplyPrice(+b.dataset.s);
    if (a==='reset'){ setPath(d, b.dataset.path, ''); }
    if (a==='resetdays') d.days={};
    if (a==='mv'){ const msg=dlMoveStage(b.dataset.grp, +b.dataset.i, +b.dataset.to); if (msg){ touch(); toast(msg); } return dealRender(); }
    if (a==='rowmv'){ if (DL.ex) return; const msg=dlRowStep(b.dataset.key, +b.dataset.d); if (msg){ touch(); toast(msg); } return dealRender(); }
    if (a==='step'){ DL.open=b.dataset.id; dealRender();
      // новая вкладка — с начала, без анимации прокрутки; на телефоне вкладки прилипают к верху прокрутки
      const f=dlg.querySelector('.dl-form'), bx=dlg.querySelector('.dl-b'), tw=dlg.querySelector('.dl-tabw'), t=dlg.querySelector('.dl-tabs');
      if (f) f.scrollTop=0; if (bx && tw && bx.scrollTop>tw.offsetTop) bx.scrollTop=tw.offsetTop;
      const on=t&&t.querySelector('.dl-tab.on'); if (on) t.scrollLeft=Math.max(0, on.offsetLeft-t.clientWidth/2+on.offsetWidth/2); return; }
    if (a==='addbg'){ const c=dealCalc(dlKp(), d); d.bg=[...(Array.isArray(d.bg)?d.bg:[]), {type:c.advSum>0?'adv':'perf', rate:String(dealBgRate()).replace('.',',')}]; }
    if (a==='delbg'){ d.bg=(d.bg||[]).filter((_,j)=>j!==k); }
    if (a==='where'){ const s=d.sup[k]; s.where=b.dataset.v;
      if (b.dataset.v==='ru'){ s.country='Россия'; dlApplyCountry(s); }
      else if (/^росс/i.test(s.country||'')){ s.country=''; s.cusMode='calc'; s.vatIn=false; }
      dlSaveSupplier(s); }
    if (a==='novat'){ d.sup[k].noVat=b.dataset.v==='1'; dlSaveSupplier(d.sup[k]); }
    if (a==='asmon'){ d.asm=d.asm||{}; d.asm.on=b.dataset.v==='1'; dlAsmAuto(d); }
    if (a==='cusmode'){ d.sup[k].cusMode=b.dataset.v; dlSaveSupplier(d.sup[k]); }
    if (a==='trmode'){ const t=d.cust.tr[k], c=dealCalc(dlKp(), d), ct=c.trs[k];
      if (b.dataset.v==='sum' && t.mode!=='sum'){ t.mode='sum'; t.sum=ct&&ct.p?dlIn(Math.round(c.S*ct.p/100)):''; }
      else if (b.dataset.v==='pct' && t.mode==='sum'){ t.mode='pct'; t.pct=ct&&ct.p?dlIn(ct.p):''; } }
    if (a==='addsp'){ const p=d.sup[k].pay; p.splice(p.length-1, 0, {name:'', pct:'', ev:'ready', off:'0'}); dlSaveSupplier(d.sup[k]); }
    if (a==='delsp'){ d.sup[k].pay.splice(+b.dataset.j, 1); dlSaveSupplier(d.sup[k]); }
    if (a==='addtr'){ const tr=d.cust.tr; tr.splice(tr.length-1, 0, {name:'', pct:'', ev:tr.length>1?'ready':'sign', off:'0'}); }
    if (a==='deltr'){ d.cust.tr.splice(k,1); }
    if (a==='dock'){ d.docK={...(d.docK||{})}; d.docK[b.dataset.v]=!d.docK[b.dataset.v]; }
    if (a==='addsup'){ d.sup.push(dealNewSupplier('s'+Date.now().toString(36), dealDefaults())); }
    if (a==='delsup'){ const id=d.sup[k].id; d.sup.splice(k,1); for (const x in d.map) if (d.map[x]===id) delete d.map[x]; }
    touch(); dealRender(); });
}

// краткая экономика сделки в правой панели (под кнопками сохранения): прибыль до налога, маржа, чистая прибыль, цена под цель;
// себестоимость, таможня и финансирование — в раскрывающемся «Себестоимость и расходы». Только автору КП и администратору (dealAllowed).
class DealSide {
  static more = false;          // «Себестоимость и расходы» раскрыто: панель перерисовывается при каждом вводе — помним выбор
  static bound = false;

  static html(){
    if (!this.bound){ this.bound=true; document.addEventListener('toggle', e=>{ if (e.target.classList && e.target.classList.contains('mrg-more')) this.more=e.target.open; }, true); }
    const its=(S.items||[]).filter(x=>String(x.name||'').trim());
    const btn='<button class="btn dl-open" type="button" data-a="deal">Экономика сделки →</button>';
    const lab='<div class="lab">Экономика сделки · в КП не выводится</div>';
    if (!its.length) return '';
    const withCost=its.filter(x=>x.cost>0).length;
    if (!withCost) return `<div class="mrg">${lab}<p class="mrg-n">Укажите закупку в «Экономике сделки» — здесь появятся прибыль, маржа, таможня и финансирование.</p>${btn}</div>`;
    let c; try{ c=dealCalc(dealKpInputs(), S.deal||dealBlank(dealDefaults())); }catch(e){ return `<div class="mrg">${lab}${btn}</div>`; }
    const b=c.base, r=b||c.lo, unk=!b, p=v=>v==null||!Number.isFinite(v)?'—':v.toFixed(1).replace('.',',')+' %';
    const P=unk?null:b.P, tg=S.deal&&S.deal.target, tv=tg?dNum(tg.v):null;
    const need=tv!=null&&!Number.isNaN(tv)?dealSolve(dealKpInputs(), S.deal, tg.type, tv):null;
    const TG={margin:'маржи',markup:'наценки',profit:'прибыли',net:'чистой прибыли'};
    const warn=c.warn.filter(w=>w.bad).concat(c.warn.filter(w=>!w.bad));
    return `<div class="mrg mrg-deal">${lab}
      <div class="mrg-p${P!=null&&P<0?' neg':''}"><small>Прибыль до налога</small><b>${unk?`${Fmt.rub(c.lo.P)} … ${Fmt.rub(c.hi.P)}`:Fmt.rub(P)}</b></div>
      <dl><dt>Маржинальность / наценка</dt><dd>${unk?'—':`${p(b.margin)} / ${p(b.markup)}`}</dd>
        ${unk?'':`<dt>Чистая прибыль</dt><dd>${Fmt.rub(b.net)}</dd>`}
        ${need!=null?`<dt>Цена для ${TG[tg.type]||'цели'} ${esc(tg.v)}${tg.type==='profit'||tg.type==='net'?' ₽':' %'}</dt><dd><b>${Fmt.rub(need)}</b></dd>`:''}</dl>
      <details class="mrg-more"${this.more?' open':''}><summary>Себестоимость и расходы</summary><dl>
        <dt>Себестоимость</dt><dd>${Fmt.rub(r.Ctot)}</dd>
        ${c.Tsum?`<dt>Таможня (платим)</dt><dd>${Fmt.rub(c.Tsum)}</dd>`:''}
        <dt>Финансирование</dt><dd>${Fmt.rub(c.F)}</dd>
        ${r.K>0?`<dt>Прочие расходы (нал.)</dt><dd>${Fmt.rub(r.K)}</dd>`:''}</dl></details>
      ${withCost<its.length?`<p class="mrg-n warn-t">Закупка указана у ${withCost} из ${its.length} позиций</p>`:warn.length?`<p class="mrg-n ${warn[0].bad?'bad-t':'warn-t'}">${esc(warn[0].t)}</p>`:unk?'<p class="mrg-n warn-t">Нужна сумма ввозного НДС</p>':''}
      ${S.deal&&S.deal.touched?'':'<p class="mrg-n muted">Предварительно: условия поставщика — по умолчанию.</p>'}
      ${btn}</div>`;
  }
}

// сроки сделки для графика кабинета менеджера (описание КП, поле plan): день договора и смещения в днях от него —
// готовность, поставка, конец расчётов, оплаты заказчика (доля и подпись, без сумм закупки). Только если расчёт заполнен.
class DealPlan {
  static of(st=S){
    if (!st.deal || !st.deal.touched) return undefined;
    let c; try{ c=dealCalc(dealKpInputs(st), st.deal); }catch(e){ return undefined; }
    if (!c || !Number.isFinite(c.D)) return undefined;
    const r=x=>Number.isFinite(x) ? Math.round(x) : null;
    return { start:/^\d{4}-\d{2}-\d{2}$/.test(st.deal.start||'') ? st.deal.start : '', ready:r(c.Rdy), delivery:r(c.D), end:r(c.Tend),
      pays:(c.rows||[]).filter(x=>x.inflow && x.amount>0 && Number.isFinite(x.day)).slice(0, 8)
        .map(x=>({d:Math.round(x.day), p:Math.round((x.pct||0)*10)/10, t:String(x.label||'').slice(0, 80)})) };
  }
}

// краткий итог для правой панели и журнала (только если расчёт заполнен)
function dealSummary(st=S){
  if (!st.deal || !st.deal.touched) return null;
  const c=dealCalc(dealKpInputs(st), st.deal), b=c.base;
  return b ? { confirmed:true, profit:Math.round(b.P*100)/100, net:Math.round(b.net*100)/100, margin:b.margin, markup:b.markup }
    : { confirmed:false, lo:Math.round(c.lo.P), hi:Math.round(c.hi.P), marginLo:c.lo.margin, marginHi:c.hi.margin };
}
