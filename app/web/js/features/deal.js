// Окно «Экономика сделки» — здесь вводится закупка и подбирается цена продажи. Расчёт — js/features/deal-calc.js,
// выгрузка в Excel — js/features/deal-xlsx.js. Документ КП не меняется: данные — в S.deal; цены позиций КП меняются
// только кнопкой «Перенести цены в КП». Закупка позиции хранится у позиции (cost, costCur) — её сохраняет каталог.
// Видят только автор КП и администратор (на сервере расчёт чужого КП не отдаётся и не перезаписывается — app/admin.py).
// Внешние данные: курсы ЦБ (раздел «Цены»), ключевая ставка ЦБ (/api/cbr/keyrate) — стоимость денег.
// Справочники в базе (общие для отдела): поставщики (/api/suppliers) и коды ТН ВЭД / пошлины (/api/customs).
// Будущий модуль логистики: dealSetLogistics(idПоставщика, {abroad:{v,cur}, ru:{v}, ship, note}).
'use strict';

const DL = { ex:false, exKp:null, exDeal:null, key:null, keyErr:'', sups:null, cus:null, saveT:{} };
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

// данные конструктора для расчёта
function dealKpInputs(st=S){
  const e=kpEconomics(st), P=st.pricing||{}, r=e.cur==='RUB'?1:dNum(P.rates&&P.rates[e.cur]);
  return { sumRub: r>0 ? e.sum/100*r : 0, sumNoRate: !(r>0), cur:e.cur, vat:+st.vat||0, rates:{...(P.rates||{})}, costNoVat:!!P.costNoVat, moneyAuto:dlMoneyAuto(),
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

const DL_SUP_KEYS=['country','cur','vatIn','noVat','adv','prod','ship','cusMode','ivat','ins','fx'];

// подставить условия поставщика из справочника (название, страна, валюта, аванс, сроки, таможня, комиссии)
function dlApplyDir(s, p){ if (!p) return false;
  for (const k of DL_SUP_KEYS) if (p[k]!=null && p[k]!=='') s[k]=p[k];
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

function dealExample(){
  const d=dealBlank({adv:'20',prod:'40',ship:'40',defer:'30',money:'2'}); d.hs={};
  Object.assign(d.sup[0],{name:'Поставщик из Китая', country:'Китай', cusMode:'sum', extra:{v:'196000',cur:'CNY'}, log:{v:'13500',cur:'CNY'}, cus:{v:'48000',cur:'CNY'}, vi:''});
  d.mnt='100000'; d.oth='0'; d.vo='0'; d.money='2';
  return { kp:{sumRub:4356000, vat:22, rates:{CNY:'12,4'}, costNoVat:false, items:[], moneyAuto:2}, deal:d };
}

const dlKp = () => DL.ex ? DL.exKp : dealKpInputs();
const dlDeal = () => DL.ex ? DL.exDeal : dealEnsure();

function dlGet(d, path){ return path.split('.').reduce((o,k)=>o==null?o:o[k], d); }

function dlSet(d, path, v){ const ks=path.split('.'), last=ks.pop(); let o=d; for (const k of ks){ if (o[k]==null) o[k]={}; o=o[k]; } o[last]=v; }

const dlRub = n => n==null||!Number.isFinite(n) ? '—' : n.toLocaleString('ru-RU',{minimumFractionDigits:2, maximumFractionDigits:2})+' ₽';

const dlRub0 = n => n==null||!Number.isFinite(n) ? '—' : Math.round(n).toLocaleString('ru-RU')+' ₽';

const dlPct = n => n==null||!Number.isFinite(n) ? '—' : n.toLocaleString('ru-RU',{minimumFractionDigits:2, maximumFractionDigits:2})+' %';

const dlIn = n => n==null||!Number.isFinite(n) ? '' : String(Math.round(n*100)/100).replace('.',',');

const dlThousands = s => String(s).replace(/\B(?=(\d{3})+(?!\d))/g,' ');

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
  DL.ex=false;
  let d=$('#dealdlg'); if (!d){ d=document.createElement('dialog'); d.id='dealdlg'; d.className='dealwin'; d.setAttribute('aria-label','Экономика сделки'); document.body.appendChild(d); dealBind(d); }
  if (!S.deal){ d.innerHTML='<div class="dlg-h"><h3>Экономика сделки</h3></div><p class="empty">Загружаю справочники…</p>'; if (!d.open) d.showModal(); }
  await dlLoadDirs(); dealEnsure();
  d.innerHTML=''; dealRender(); if (!d.open) d.showModal();
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
  return `<label class="f dl-f${e?' bad':''}${o.cls?' '+o.cls:''}"><span>${esc(label)}${o.unit?` <i>${esc(o.unit)}</i>`:''}${badge}${o.q?dlQ(o.q):''}</span>
    <span class="dl-in${cur?' cur':''}">${inp}${cur}</span>
    ${e?`<small class="dl-err">${esc(e)}</small>`:o.hint?`<small class="muted">${o.hint}</small>`:''}</label>`;
}

const dlFilled = (...v) => v.some(x=>x!=null && String(x).trim()!=='' && String(x).trim()!=='0');

function dlStep(n, title, sub, body, cls=''){ return `<section class="dl-step ${cls}"><div class="dl-sh"><span class="dl-n">${n}</span><div><h4>${title}</h4>${sub?`<p>${sub}</p>`:''}</div></div>${body}</section>`; }

// ---------- шаг 1: закупка
function dlPurchase(c){
  const d=dlDeal(), multi=d.sup.length>1, ex=DL.ex;
  const cards=d.sup.map((s,k)=>{ const cs=c.sup[k], P=`sup.${k}`, ru=/^росс/i.test(s.country||''), eaeu=s.cusMode==='eaeu';
    const known=dlDir(s.name), isNew=String(s.name||'').trim() && !known;
    const items = ex ? '' : (()=>{ const its=S.items.filter(x=>String(x.name||'').trim() && dlSupOf(x.id)===s.id);
      if (!its.length) return `<p class="muted dl-noitems">${multi?'Позиций нет — у позиции выберите этого поставщика в другой карточке.':'В КП нет позиций.'}</p>`;
      return `<table class="dl-it"><thead><tr><th>Позиция</th><th class="num">Кол-во</th><th>Цена закупки за ед.</th><th class="num">Сумма, ₽</th>${multi?'<th>Поставщик</th>':''}</tr></thead><tbody>
        ${its.map(x=>{ const i=S.items.indexOf(x), r=rateOf(x.costCur||'RUB'), sum=x.cost?x.cost/100*(+x.qty||0)*(r||0)*(cs.noVat?1+c.v/100:1):0;
          return `<tr${x.cost?'':' class="need"'}><td class="c-nm"><b>${esc(x.name)}</b>${attrsOf(x).maker?`<small>${esc(attrsOf(x).maker)}</small>`:''}</td><td class="num">${esc(x.qty)}</td>
            <td class="c-cost"><span class="dl-in cur"><input type="text" inputmode="decimal" data-cost-i="${i}" value="${esc(x._costText ?? (x.cost?dlIn(x.cost/100):''))}" placeholder="цена из счёта" aria-label="Цена закупки за единицу"${x.cost?'':' class="need"'}><select data-costcur-i="${i}" aria-label="Валюта закупки">${DEAL_CURS.map(k=>`<option${(x.costCur||'RUB')===k?' selected':''}>${k}</option>`).join('')}</select></span></td>
            <td class="num c-sum">${x.cost?dlRub0(sum):'—'}</td>
            ${multi?`<td><select data-dlmap="${esc(x.id)}" aria-label="Поставщик позиции">${d.sup.map((z,j)=>`<option value="${esc(z.id)}"${z.id===s.id?' selected':''}>${esc(c.sup[j].name)}</option>`).join('')}</select></td>`:''}</tr>`; }).join('')}
        </tbody></table>`; })();
    const moreOpen = dlFilled(s.extra&&s.extra.v, s.ins, s.fx, s.brk&&s.brk.v, s.voRu, s.vo);
    return `<div class="dl-card dl-sup">
      <div class="dl-suph">
        ${dlField('Поставщик', P+'.name', {text:true, ph:'Название — производитель, дистрибьютор, импортёр', list:'dlSupList', cls:'w2'})}
        ${dlField('Страна', P+'.country', {text:true, ph:'Например, Китай', list:'dlCountryList'})}
        ${multi?`<button type="button" class="icon dl-del" data-dlx="delsup" data-k="${k}" aria-label="Убрать поставщика" title="Убрать поставщика: его позиции перейдут к первому">✕</button>`:''}</div>
      <p class="dl-dirn">${known&&!ex?`<span class="ok-t">✓ Из справочника</span> — условия подставлены, изменения сохраняются в справочник.`:isNew&&!ex?'Новый поставщик — сохранится в справочник, в следующий раз выберите его из списка.':'Начните вводить название — список подскажет поставщиков из справочника и производителей позиций.'}
        ${s.country?` · ${ru?'поставка по России, без таможни':eaeu?'ЕАЭС: без пошлины, НДС при ввозе — к вычету':'импорт: таможня рассчитывается в шаге 2'}`:''}</p>
      ${items}
      ${ru?`<div class="dl-inl"><span class="dl-lab">Цены в счёте</span><span class="dl-seg"><button type="button" class="${!cs.noVat?'on':''}" data-dlx="novat" data-k="${k}" data-v="0">с НДС</button><button type="button" class="${cs.noVat?'on':''}" data-dlx="novat" data-k="${k}" data-v="1">без НДС</button></span>${dlQ('НДС поставщика уменьшает НДС к уплате (вычет). Если в счёте цены без НДС, программа добавит НДС к платежу и учтёт его в вычете.')}</div>`:''}
      <div class="dl-g g3">${dlField('Аванс поставщику', P+'.adv', {calc:c, unit:'%', q:'Доля от стоимости оборудования, которую платим при заказе (день 0). Остаток — при готовности к отгрузке.'})}
        ${dlField('Изготовление', P+'.prod', {calc:c, unit:'дней', int:true})}${dlField('Доставка', P+'.ship', {calc:c, unit:'дней', int:true, q:'От готовности до поставки заказчику, включая таможню.'})}</div>
      <div class="dl-g">${ru?'':dlField('Логистика до границы', P+'.log.v', {calc:c, cur:P+'.log.cur', src:s.log&&s.log.src, q:'Перевозка от поставщика до границы ЕАЭС. Входит в таможенную стоимость.'})}
        ${dlField('Доставка по России', P+'.logRu.v', {calc:c, unit:'₽', src:s.logRu&&s.logRu.src, q:'От границы или склада до объекта заказчика. Платится при поставке; НДС перевозчика — к вычету.'})}</div>
      <details class="dl-more"${moreOpen?' open':''}><summary>Ещё расходы по поставщику <span class="muted">— опции, страхование, комиссия за перевод, брокер</span></summary>
        <div class="dl-g">${dlField('Прочая закупка у поставщика', P+'.extra.v', {calc:c, cur:P+'.extra.cur', q:'Опции, ЗИП и всё, чего нет в позициях КП.'})}
          ${ru?'':dlField('Страхование груза', P+'.ins', {calc:c, unit:'% от оборудования', ph:'0,3'})}
          ${ru?'':dlField('Комиссия банка или агента', P+'.fx', {calc:c, unit:'%', ph:'1,5', q:'Комиссия за перевод и конвертацию — процент от платежей поставщику в валюте.'})}
          ${dlField('Брокер, СВХ, сертификация', P+'.brk.v', {calc:c, unit:'₽'})}
          ${cs.Lru+cs.brk>0?dlField('НДС к вычету по услугам в России', P+'.voRu', {calc:c, unit:'₽', auto:cs.ruSuggest, autoLabel:`авто ${c.v}/${100+c.v}`, q:'НДС в счетах перевозчика и брокера. Если они без НДС — впишите 0.'}):''}
          ${s.vatIn?dlField('НДС поставщика к вычету', P+'.vo', {calc:c, unit:'₽', auto:cs.suggest, autoLabel:`авто ${c.v}/${100+c.v}`, q:'НДС в стоимости оборудования — сверьте со счётом-фактурой.'}):''}</div></details>
      <div class="dl-supf"><span>Закупка у поставщика</span><b>${dlRub(cs.equip)}</b></div>
    </div>`; }).join('');
  return dlStep(1, 'Закупка', 'Что и у кого покупаем. Цена — как в счёте поставщика, в его валюте.',
    `<datalist id="dlSupList">${[...new Set([...(DL.sups||[]).map(x=>x.name), ...dlKp().items.map(x=>x.maker).filter(Boolean)])].map(n=>`<option value="${esc(n)}">`).join('')}</datalist>
     <datalist id="dlCountryList">${DEAL_COUNTRIES.map(([n])=>`<option value="${esc(n)}">`).join('')}</datalist>
     ${cards}${ex?'':`<button type="button" class="btn dl-add" data-dlx="addsup">+ Ещё поставщик</button>`}`);
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
          <td>${h.src?`<span class="dl-badge ${h.src==='справочно'?'warn':'kp'}" title="${esc(h.src==='справочно'?(dealHsAuto(attrsOf(x).cat,attrsOf(x))||{}).note||'':'')}">${esc(h.src)}</span>`:'<span class="dl-badge warn">укажите</span>'}</td>
          <td class="num">${ln?dlRub0(ln.cv):'—'}</td><td class="num">${ln?dlRub0(ln.dutyA):'—'}</td></tr>`; }).join('');
      body=`${rows?`<table class="dl-it dl-hs"><thead><tr><th>Позиция</th><th>Код ТН ВЭД</th><th>Пошлина</th><th></th><th class="num">Тамож. стоимость</th><th class="num">Пошлина, ₽</th></tr></thead><tbody>${rows}</tbody></table>`:''}
        <div class="dl-g g3">${dlField('НДС на ввоз', P+'.ivat', {calc:c, select:[['22','22 %'],['10','10 %'],['0','0 %']]})}
          ${dlField('Таможенный сбор', P+'.fee', {calc:c, unit:'₽', auto:cs.fee, autoLabel:'по шкале', autoTitle:'Сбор за таможенные операции по таможенной стоимости: '+CUSTOMS_FEES.title, q:'Фиксированная сумма по таможенной стоимости партии ('+CUSTOMS_FEES.title+').'})}</div>
        <p class="dl-break">Таможенная стоимость ${dlRub0(cs.cv)} + пошлина ${dlRub0(cs.dutyA)} → ввозной НДС ${dlRub0(cs.ivatA)} <span class="muted">(вернётся вычетом)</span>; сбор ${dlRub0(cs.fee)}. <b>Платим на таможне: ${dlRub0(cs.T)}</b></p>`;
    } else if (cs.mode==='eaeu'){
      body=`<div class="dl-g g3">${dlField('НДС при ввозе', P+'.ivat', {calc:c, select:[['22','22 %'],['10','10 %'],['0','0 %']]})}</div>
        <p class="dl-break">Из стран ЕАЭС пошлины и сбора нет. НДС при ввозе ${dlRub0(cs.ivatA)} платится в налоговую и <b>возвращается вычетом</b>.</p>`;
    } else if (cs.mode==='sum'){
      body=`<div class="dl-g">${dlField('Таможенные платежи целиком', P+'.cus.v', {calc:c, cur:P+'.cus.cur', q:'Пошлина, сбор и ввозной НДС одной суммой — например, по расчёту брокера.'})}
        ${dlField('Из них ввозной НДС к вычету', P+'.vi', {calc:c, unit:'₽', ph:cs.T?'Сумма по декларации':'0', unknown:cs.T>0, hint:cs.T?'Пусто — сумма неизвестна (не ноль). Нет права на вычет — 0.':''})}</div>`;
    } else body='<p class="muted">Таможни нет.</p>';
    return `<div class="dl-card"><div class="dl-ch"><b>${esc(cs.name)}${s.country?` · ${esc(s.country)}`:''}</b>${modeSeg}</div>${body}</div>`; }).join('');
  if (!blocks.trim()) return '';
  return dlStep(2, 'Таможня и ввозные налоги', 'Пошлина — по коду ТН ВЭД каждой позиции; ввозной НДС возвращается вычетом.',
    `${blocks}<p class="dl-foot-n">Коды и ставки — справочные по ЕТТ ЕАЭС; точный код (10 знаков) подтверждает таможенный брокер.
      Исправленный код и ставка запоминаются для модели. ${ex?'':'<button type="button" class="lnk" data-dlx="hsdir">Справочник кодов по категориям</button> · '}<a href="https://www.alta.ru/tnved/" target="_blank" rel="noopener">Проверить ставку на alta.ru ↗</a></p>`);
}

// ---------- шаги 3–5
function dlCustomer(c){
  const d=dlDeal(), tr=d.cust.tr, n=tr.length;
  const evSel=(k,t)=>`<select data-dl="cust.tr.${k}.ev" aria-label="Событие">${Object.entries(DEAL_EVENTS).map(([v,l])=>`<option value="${v}"${t.ev===v?' selected':''}>${l}</option>`).join('')}</select>`;
  const rows=tr.map((t,k)=>{ const last=k===n-1, e=c.err[`cust.tr.${k}.pct`]||c.err[`cust.tr.${k}.off`];
    return `<div class="dl-tr${e?' bad':''}">
      ${last?`<span class="dl-trp" title="Последний этап — остаток до 100 %">${dlIn(c.trs[k].p)} %</span>`:`<span class="dl-in"><input type="text" inputmode="decimal" data-dl="cust.tr.${k}.pct" value="${esc(t.pct)}" placeholder="0" aria-label="Доля этапа, %"><i>%</i></span>`}
      ${evSel(k,t)}<span class="dl-in"><i>+</i><input type="text" inputmode="numeric" data-dl="cust.tr.${k}.off" value="${esc(t.off)}" placeholder="0" aria-label="Дней после события"><i>дн.</i></span>
      ${n>1?`<button type="button" class="icon" data-dlx="deltr" data-k="${k}" aria-label="Убрать этап">✕</button>`:'<span></span>'}</div>`; }).join('');
  return `<div class="dl-trs">${rows}</div>${c.err['cust.tr']?`<small class="dl-err">${esc(c.err['cust.tr'])}</small>`:''}
    <div class="dl-trf"><button type="button" class="btn ghost" data-dlx="addtr">+ Этап оплаты</button><span class="muted">Последний этап — остаток до 100 %. Готовность — день ${c.Rdy}, поставка — день ${c.D}${c.pnrDays?`, ПНР — день ${c.D+c.pnrDays}`:''}.</span></div>`;
}

function dlSchedule(c){
  const d=dlDeal();
  return `<details class="dl-step dl-sched"${d._schedOpen===false?'':' open'}><summary class="dl-sh"><span class="dl-n">6</span><div><h4>График платежей · ${c.Tend} ${plural(c.Tend,'день','дня','дней')}</h4><p>Деньги по дням: кто, когда и сколько платит. Финансирование — проценты на недостающие деньги.</p></div></summary>
    ${Object.keys(d.days||{}).length?'<button type="button" class="btn ghost" data-dlx="resetdays">↺ Даты по срокам</button>':''}
    <div class="dl-tw"><table class="dl-t"><thead><tr><th>День</th><th>Событие</th><th class="num">Платёж</th><th class="num">Остаток денег</th><th class="num">Финансирование</th></tr></thead><tbody>
    ${c.rows.map(r=>`<tr class="${r.inflow?'in':''}${r.manual?' man':''}"><td class="c-day">${r.fixed?`<span class="dl-day fx">${r.day}</span>`:`<input type="text" inputmode="numeric" class="dl-day" data-dl="days.${r.key}" value="${r.day}" aria-label="День: ${esc(r.label)}" title="${r.manual?'Дата изменена вручную':'По срокам — можно изменить'}">`}</td>
      <td class="c-ev">${esc(r.label)}</td><td class="num c-pay">${r.inflow?'+':'−'}${dlRub0(Math.abs(r.amount))}</td><td class="num c-bal ${r.balance<0?'neg':''}">${dlRub0(r.balance)}</td><td class="num c-fin">${r.fin?dlRub0(r.fin)+`<small>${r.days} дн.</small>`:'—'}</td></tr>`).join('')}
    </tbody><tfoot><tr><td class="c-day"></td><td class="c-ev">Стоимость финансирования</td><td class="c-pay"></td><td class="c-bal"></td><td class="num c-fin"><b>${dlRub(c.F)}</b></td></tr></tfoot></table></div>
    <p class="muted">Простой процент на недостающие деньги до последней оплаты заказчика, месяц — 30 дней; оплаты заказчика уменьшают финансирование, доход на свободный остаток не начисляется. День строки можно изменить.</p></details>`;
}

// ---------- правая колонка: подбор цены и итог
function dlResult(c){
  const d=dlDeal(), kp=dlKp(), b=c.base, lo=c.lo, hi=c.hi, unk=c.unknown.length>0, bad=!c.ok || c.warn.some(w=>w.bad), r=b||lo;
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
      ${bad?'<span class="dl-chip bad">Проверьте данные</span>':unk?'<span class="dl-chip warn">Нужна сумма ввозного НДС</span>':''}
      <div class="dl-big${P!=null&&P<0?' neg':''}${unk?' rng':''}"><small>Прибыль до налога на прибыль</small><b>${unk?`${dlRub0(lo.P)} … ${dlRub0(hi.P)}`:dlRub0(P)}</b>
        ${unk?'':`<p class="dl-note">Чистая прибыль после налога ${dlIn(c.taxP)} %: <b>${dlRub0(b.net)}</b></p>`}</div>
      <div class="dl-kpi"><div><small>Маржинальность ${dlQ('Прибыль ÷ выручка без НДС. Сколько копеек прибыли в каждом рубле выручки.')}</small><b>${unk?`${dlPct(lo.margin)} … ${dlPct(hi.margin)}`:dlPct(b.margin)}</b></div>
        <div><small>Наценка ${dlQ('Прибыль ÷ себестоимость (все расходы с финансированием, без НДС к вычету).')}</small><b>${unk?`${dlPct(lo.markup)} … ${dlPct(hi.markup)}`:dlPct(b.markup)}</b></div></div>
      <dl class="dl-dl">
        <dt>Выручка без НДС</dt><dd>${dlRub0(c.R)}</dd>
        <dt>Себестоимость с финансированием</dt><dd>${dlRub0(r.Ctot)}</dd>
        <dt>в т. ч. финансирование</dt><dd>${dlRub0(c.F)}</dd>
        <dt>НДС к доплате</dt><dd>${dlRub0(r.payable)}</dd>
        <dt>Налог на прибыль</dt><dd>${dlRub0(r.tax)}</dd>
        <dt>Деньги на счёте после сделки</dt><dd>${dlRub0(r.cashAfter)}</dd></dl>
      ${parts?`<details class="dl-more dl-parts"><summary>Из чего себестоимость</summary><dl class="dl-dl">${parts}</dl></details>`:''}
      ${c.warn.length?`<ul class="dl-warn">${c.warn.map(w=>`<li class="${w.bad?'bad':''}">${esc(w.t)}</li>`).join('')}</ul>`:''}</div>
  </div>`;
}

function dealRender(){
  const dlg=$('#dealdlg'); if (!dlg || !dlg.isConnected || !dlg.open && !dlg.innerHTML) return;
  const d=dlDeal(), kp=dlKp(), c=dealCalc(kp,d);
  const rates=c.used.map(cur=>dlField(`Курс ${cur}`, 'rates.'+cur, {calc:c, unit:'₽', kp:dNum(kp.rates[cur]), kpLabel:'ЦБ из КП'})).join('');
  const keyT = DL.key ? `ключевая ${dlIn(DL.key.rate)} % + ${DL_KEY_SPREAD}` : 'по умолчанию';
  const head=`<div class="dlg-h"><h3>Экономика сделки${!DL.ex&&S.number?` · КП № ${esc(S.number)}`:''}<small>${DL.ex?'Учебный пример из методики':esc(S.client||'Получатель не указан')}</small></h3>
      <button class="btn" type="button" data-dlx="xlsx">Excel для согласования</button><button class="icon" type="button" data-dlx="close" aria-label="Закрыть">✕</button></div>`;
  const banner = DL.ex ? `<div class="dl-ex">Учебный пример: 196 000 CNY по курсу 12,4, растаможка 48 000 CNY. Данные сделки не меняются. <button class="btn" type="button" data-dlx="exit">Вернуться к сделке</button></div>`
    : kp.sumNoRate ? `<div class="dl-ex warn">Нет курса валюты КП (${esc(kp.cur)}) — цена не переведена в рубли. Укажите курс в разделе «Цены и валюта».</div>` : '';
  const b=c.base, mini = b ? `<span><small>Прибыль при цене КП</small><b class="${b.P<0?'neg':''}">${dlRub0(b.P)}</b></span><span class="r"><small>Маржинальность</small><b>${dlPct(b.margin)}</b></span>`
    : `<span><small>Прибыль при цене КП</small><b>${dlRub0(c.lo.P)} … ${dlRub0(c.hi.P)}</b></span><span class="r warn-t">нужен ввозной НДС</span>`;
  const otherOpen = dlFilled(d.vo, d.warr, d.bonus);
  const cust=dlCustoms(c), nS=cust?1:0;
  morph(dlg, `${head}${banner}<div class="dl-mini">${mini}</div><div class="dl-b"><div class="dl-form">
    ${dlPurchase(c)}
    ${cust}
    ${dlStep(2+nS, 'Монтаж и прочие расходы', 'Работы и затраты по сделке, кроме закупки и доставки.', `<div class="dl-g g3">
      ${dlField('Монтаж и ПНР', 'mnt', {calc:c, unit:'₽', hint:'Платёж — при поставке'})}${dlField('Срок ПНР', 'pnr', {calc:c, unit:'дней', int:true, hint:'Для оплаты «после ПНР»'})}${dlField('Прочие расходы', 'oth', {calc:c, unit:'₽', hint:'Платёж — при поставке'})}</div>
      <details class="dl-more"${otherOpen?' open':''}><summary>Ещё <span class="muted">— резерв на гарантию, бонусы с продажи, прочий НДС к вычету</span></summary><div class="dl-g g3">
        ${dlField('Резерв на гарантию', 'warr', {calc:c, unit:'% выручки', ph:'1', q:'Деньги на гарантийные случаи — процент от выручки без НДС.'})}${dlField('Бонусы и комиссии', 'bonus', {calc:c, unit:'% выручки', q:'Агентам, партнёрам, менеджерам — платятся после оплаты заказчика.'})}
        ${dlField('Прочий НДС к вычету', 'vo', {calc:c, unit:'₽', q:'НДС в монтаже и прочих расходах, если подрядчики с НДС.'})}</div></details>`)}
    ${dlStep(3+nS, 'Оплата заказчика', 'Когда и сколько платит заказчик. Аванс уменьшает финансирование.', dlCustomer(c))}
    ${dlStep(4+nS, 'Цена, курс, деньги и налог', 'Значения из КП можно изменить только для расчёта — КП они не меняют.', `<div class="dl-g g4">
      ${dlField('Цена КП с НДС', 'over.price', {calc:c, unit:'₽', kp:kp.sumRub, q:'Итог КП в рублях. Измените, чтобы прикинуть другую цену; перенести её в КП — справа.'})}${dlField('НДС продажи', 'over.vat', {calc:c, unit:'%', kp:kp.vat})}${rates}
      ${dlField('Стоимость денег', 'money', {calc:c, unit:'% в мес.', auto:kp.moneyAuto, autoLabel:keyT, autoTitle:DL.key?`Ключевая ставка ЦБ РФ ${dlIn(DL.key.rate)} % с ${DL.key.date} + ${DL_KEY_SPREAD} п.п. годовых, делённое на 12`:(DL.keyErr?'Ключевая ставка ЦБ недоступна: '+DL.keyErr:''), q:'Сколько стоят деньги, вложенные в сделку до оплаты заказчика: кредит или упущенный доход. По умолчанию — ключевая ставка ЦБ + 3 п.п. в год.'})}
      ${dlField('Налог на прибыль', 'tax', {calc:c, unit:'%'})}</div>`)}
    ${dlSchedule(c)}
    <div class="dl-foot">${DL.ex?'':'<button class="btn ghost" type="button" data-dlx="example">Учебный пример из методики</button>'}<span class="muted">Пересчёт — сразу при вводе. Закупка сохраняется в КП и каталоге.</span></div>
  </div><aside class="dl-side">${dlResult(c)}</aside></div>`);
}

// ---------- справочник кодов ТН ВЭД по категориям
function dlHsDir(){
  const dd=$('#dlg'); dd.classList.add('wide');
  const types=TYPES.filter(t=>t.id!=='other'), cus=DL.cus||{};
  dd.innerHTML=`<div class="dlg-h"><h3>Коды ТН ВЭД и пошлины по категориям</h3><button class="icon" type="button" data-close aria-label="Закрыть">✕</button></div>
    <div class="dlg-b"><p class="muted">Значения по умолчанию для всех моделей категории. У конкретной модели код и ставку можно изменить в «Экономике сделки». Справочно — проверьте у брокера.</p>
    <table class="dl-it dl-hsdir"><thead><tr><th>Категория</th><th>Код ТН ВЭД</th><th>Пошлина, %</th><th>Пояснение</th></tr></thead><tbody>
    ${types.map(t=>{ const o=cus['cat:'+t.id]||{}, def=DEAL_HS[t.id]||{};
      return `<tr><td><b>${esc(t.name)}</b></td><td><input type="text" data-hc="${esc(t.id)}" data-f="code" value="${esc(o.code||'')}" placeholder="${esc(def.code||'0000 00')}"></td>
        <td><input type="text" inputmode="decimal" data-hc="${esc(t.id)}" data-f="duty" value="${esc(o.duty??'')}" placeholder="${esc(def.duty??'')}"></td><td class="muted">${esc(o.note||def.note||'')}</td></tr>`; }).join('')}
    </tbody></table><p class="muted">Пустое поле — справочное значение (серым). Изменения сохраняются в базе для всего отдела.</p></div>`;
  dd.showModal();
  dd.querySelector('[data-close]').onclick=()=>{ dd.close(); dd.classList.remove('wide'); dealRender(); };
  dd.querySelector('.dlg-b').onchange=async e=>{ const t=e.target; if (!t.dataset.hc) return;
    const key='cat:'+t.dataset.hc, o={...(DL.cus[key]||{})}; o[t.dataset.f]=t.value.trim();
    try{ await api('/api/customs',{method:'PUT',headers:{'Content-Type':'application/json; charset=utf-8'},body:JSON.stringify({key, code:o.code||'', duty:o.duty??'', note:o.note||''})});
      DL.cus[key]=o; toast('Сохранено в справочнике'); }catch(err){ toast('Не удалось сохранить: '+(err.message||err)); } };
}

// код и ставка позиции: у модели каталога — в базу (для всех следующих сделок), иначе — только в этом КП
async function dlSaveHs(itemId, f, v){
  const x=S.items.find(z=>z.id===itemId); if (!x) return; const d=dealEnsure(), h=dlHsOf(x), o={code:h.code, duty:h.duty}; o[f]=v.trim();
  if (x.catId){ const key='item:'+x.catId; DL.cus=DL.cus||{}; DL.cus[key]={...o};
    api('/api/customs',{method:'PUT',headers:{'Content-Type':'application/json; charset=utf-8'},body:JSON.stringify({key, code:o.code, duty:o.duty, note:''})}).catch(()=>toast('Код не сохранён в справочнике — проверьте связь с сервером')); }
  else { d.hs=d.hs||{}; d.hs[itemId]=o; }
}

// ---------- события окна
function dealBind(dlg){
  const touch=()=>{ if (DL.ex) return; S.deal.touched=true; persist(); renderSide(); };
  dlg.addEventListener('input', e=>{ const t=e.target;
    if (t.dataset.costI!=null){ const x=S.items[+t.dataset.costI], n=dNum(t.value); x._costText=t.value; t.classList.toggle('bad', Number.isNaN(n));
      if (!Number.isNaN(n)) x.cost=n==null?0:Math.round(n*100); touch(); updateLive(); return dealRender(); }
    if (t.dataset.hsI!=null){ dlSaveHs(t.dataset.hsI, t.dataset.f, t.value); touch(); return dealRender(); }
    const p=t.dataset.dl; if (!p || t.tagName==='SELECT') return;
    const d=dlDeal(); dlSet(d, p, t.value); if (!DL.ex) dealRememberDefault(p, t.value);
    const m=/^sup\.(\d+)\.(name|country)$/.exec(p);
    if (m && !DL.ex){ const s=d.sup[+m[1]];
      if (m[2]==='name' && dlNorm(s.name)!==s._dir){ const dir=dlDir(s.name); if (dir && dlApplyDir(s, dir)) toast('Поставщик из справочника: условия подставлены'); }
      if (m[2]==='country') dlApplyCountry(s); }
    if (/^sup\.(\d+)\./.test(p) && !DL.ex) dlSaveSupplier(d.sup[+/^sup\.(\d+)/.exec(p)[1]]);
    touch(); dealRender(); });
  dlg.addEventListener('focusout', e=>{ const t=e.target; if (t.dataset.costI!=null){ const x=S.items[+t.dataset.costI]; if (!Number.isNaN(dNum(x._costText))) delete x._costText; persist(); dealRender(); } });
  dlg.addEventListener('change', e=>{ const t=e.target;
    if (t.dataset.costcurI!=null){ S.items[+t.dataset.costcurI].costCur=t.value; if (t.value!=='RUB' && !(rateOf(t.value)>0)) loadCBR(); touch(); updateLive(); return dealRender(); }
    if (t.dataset.dl && t.tagName==='SELECT'){ dlSet(dlDeal(), t.dataset.dl, t.value); if (!DL.ex) dealRememberDefault(t.dataset.dl, t.value);
      const m=/^sup\.(\d+)\./.exec(t.dataset.dl); if (m && !DL.ex) dlSaveSupplier(dlDeal().sup[+m[1]]); touch(); dealRender(); }
    if (t.dataset.dlmap){ const d=dlDeal(); d.map={...(d.map||{}), [t.dataset.dlmap]:t.value}; touch(); dealRender(); } });
  dlg.addEventListener('toggle', e=>{ if (e.target.classList?.contains('dl-sched')) dlDeal()._schedOpen=e.target.open; }, true);
  dlg.addEventListener('click', e=>{ const b=e.target.closest('[data-dlx]'); if (!b) return; const d=dlDeal(), a=b.dataset.dlx, k=+b.dataset.k;
    if (a==='close') return dlg.close();
    if (a==='xlsx') return dealXlsx();
    if (a==='hsdir') return dlHsDir();
    if (a==='apply') return dealApplyPrice(+b.dataset.s);
    if (a==='example'){ const x=dealExample(); Object.assign(DL,{ex:true, exKp:x.kp, exDeal:x.deal}); return dealRender(); }
    if (a==='exit'){ DL.ex=false; return dealRender(); }
    if (a==='reset'){ dlSet(d, b.dataset.path, ''); }
    if (a==='resetdays') d.days={};
    if (a==='novat'){ d.sup[k].noVat=b.dataset.v==='1'; dlSaveSupplier(d.sup[k]); }
    if (a==='cusmode'){ d.sup[k].cusMode=b.dataset.v; dlSaveSupplier(d.sup[k]); }
    if (a==='addtr'){ const tr=d.cust.tr; tr.splice(tr.length-1, 0, {pct:'', ev:tr.length>1?'ready':'sign', off:'0'}); }
    if (a==='deltr'){ d.cust.tr.splice(k,1); }
    if (a==='addsup'){ d.sup.push(dealNewSupplier('s'+Date.now().toString(36), dealDefaults())); }
    if (a==='delsup'){ const id=d.sup[k].id; d.sup.splice(k,1); for (const x in d.map) if (d.map[x]===id) delete d.map[x]; }
    touch(); dealRender(); });
}

// краткий итог для правой панели и журнала (только если расчёт заполнен)
function dealSummary(st=S){
  if (!st.deal || !st.deal.touched) return null;
  const c=dealCalc(dealKpInputs(st), st.deal), b=c.base;
  return b ? { confirmed:true, profit:Math.round(b.P*100)/100, net:Math.round(b.net*100)/100, margin:b.margin, markup:b.markup }
    : { confirmed:false, lo:Math.round(c.lo.P), hi:Math.round(c.hi.P), marginLo:c.lo.margin, marginHi:c.hi.margin };
}
