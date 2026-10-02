// Окно «Экономика сделки»: расчёт по данным конструктора (js/features/deal-calc.js), график платежей, цена под целевую маржу
// с переносом в позиции КП, выгрузка в Excel. Документ КП не меняется: данные — в S.deal, при сборке документа не читаются;
// меняются только цены позиций — и только кнопкой «Перенести в цены КП».
// Видят только автор КП и администратор (на сервере расчёт чужого КП не отдаётся и не перезаписывается — app/admin.py).
// Внешние данные: курсы ЦБ (из раздела «Цены»), ключевая ставка ЦБ (/api/cbr/keyrate) — для стоимости денег.
// Общие для отдела подсказки (/api/deal/profiles): условия поставщиков по названию и ставки пошлин по категориям оборудования.
// Для будущего модуля логистики: dealSetLogistics(idПоставщика, {abroad:{v,cur}, ru:{v}, ship, note}) — заполняет логистику поставщика.
'use strict';

const DL = { ex:false, exKp:null, exDeal:null, key:null, keyErr:'', prof:null, profT:null };
const DL_DEF_KEYS = { money:'money', tax:'tax', 'sup.0.adv':'adv', 'sup.0.prod':'prod', 'sup.0.ship':'ship' };
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

// данные конструктора для расчёта
function dealKpInputs(st=S){
  const e=kpEconomics(st), P=st.pricing||{}, r=e.cur==='RUB'?1:dNum(P.rates&&P.rates[e.cur]);
  return { sumRub: r>0 ? e.sum/100*r : 0, sumNoRate: !(r>0), cur:e.cur, vat:+st.vat||0, rates:{...(P.rates||{})}, costNoVat:!!P.costNoVat, moneyAuto:dlMoneyAuto(),
    items:(st.items||[]).filter(x=>String(x.name||'').trim()||x.cost).map(x=>({id:x.id, name:x.name, qty:+x.qty||0, cost:(x.cost||0)/100, cur:x.costCur||'RUB', cat:attrsOf(x).cat})) };
}

function dealEnsure(){
  if (S.deal && S.deal.v){ dealUpgrade(S.deal); return S.deal; }
  const d=dealBlank(dealDefaults()), its=(S.items||[]).filter(x=>x.cost), curs=its.map(x=>x.costCur||'RUB');
  const main=curs.find(c=>c!=='RUB'); d.sup[0].vatIn = its.length>0 && !main;          // все закупки в рублях — скорее всего российский поставщик с НДС
  if (main){ d.sup[0].log.cur=main; d.sup[0].cus.cur=main; d.sup[0].cusMode='calc'; d.sup[0].duty=dlDutyFor(its.map(x=>attrsOf(x).cat))||''; }
  else if (its.length) d.sup[0].cusMode='none';
  S.deal=d; return d;
}

function dealExample(){
  const d=dealBlank({adv:'20',prod:'40',ship:'40',defer:'30',money:'2'});
  Object.assign(d.sup[0],{name:'Поставщик из Китая', extra:{v:'196000',cur:'CNY'}, log:{v:'13500',cur:'CNY'}, cus:{v:'48000',cur:'CNY'}, vi:''});
  d.mnt='100000'; d.oth='0'; d.vo='0'; d.money='2';
  return { kp:{sumRub:4356000, vat:22, rates:{CNY:'12,4'}, costNoVat:false, items:[], moneyAuto:2}, deal:d };
}

const dlKp = () => DL.ex ? DL.exKp : dealKpInputs();
const dlDeal = () => DL.ex ? DL.exDeal : dealEnsure();

function dlGet(d, path){ return path.split('.').reduce((o,k)=>o==null?o:o[k], d); }

function dlSet(d, path, v){ const ks=path.split('.'), last=ks.pop(); let o=d; for (const k of ks){ if (o[k]==null) o[k]={}; o=o[k]; } o[last]=v; }

const dlRub = n => n==null||!Number.isFinite(n) ? '—' : n.toLocaleString('ru-RU',{minimumFractionDigits:2, maximumFractionDigits:2})+' ₽';

const dlRub0 = n => n==null||!Number.isFinite(n) ? '—' : Math.round(n).toLocaleString('ru-RU')+' ₽';

const dlPct = n => n==null||!Number.isFinite(n) ? 'не определена' : n.toLocaleString('ru-RU',{minimumFractionDigits:2, maximumFractionDigits:2})+' %';

const dlIn = n => n==null||!Number.isFinite(n) ? '' : String(Math.round(n*100)/100).replace('.',',');

const dlThousands = s => String(s).replace(/\B(?=(\d{3})+(?!\d))/g,' ');

// ---------- внешние данные и общие подсказки
async function dlLoadExternal(){
  if (!DL.key && !DL.keyErr) api('/api/cbr/keyrate').then(r=>{ if (r && r.rate>0) DL.key=r; else DL.keyErr=(r&&r.error)||'нет данных'; dealRender(); }).catch(e=>{ DL.keyErr=e.message||'нет связи'; });
  if (!DL.prof) api('/api/deal/profiles').then(r=>{ DL.prof=r||{}; dealRender(); }).catch(()=>{ DL.prof={}; });
}

function dlProfile(name){ const n=String(name||'').trim().toLowerCase(); if (!n || !DL.prof || !DL.prof.sup) return null;
  const k=Object.keys(DL.prof.sup).find(x=>x.toLowerCase()===n); return k ? DL.prof.sup[k] : null; }

function dlDutyFor(cats){ const m=(DL.prof&&DL.prof.duty)||{}; for (const c of cats||[]) if (c && m[c]!=null && m[c]!=='') return String(m[c]); return ''; }

const DL_PROF_KEYS=['vatIn','adv','prod','ship','cusMode','duty','ivat','ins','fx'];

function dlApplyProfile(s){ const p=dlProfile(s.name); if (!p || s._prof===s.name.trim().toLowerCase()) return false;
  for (const k of DL_PROF_KEYS) if (p[k]!=null) s[k]=p[k];
  if (p.logCur) s.log.cur=p.logCur; if (p.cusCur) s.cus.cur=p.cusCur;
  s._prof=s.name.trim().toLowerCase(); return true; }

// запомнить условия поставщиков и пошлины по категориям — для следующих сделок (общие для отдела)
function dlSaveProfiles(){
  if (DL.ex || !S.deal) return; clearTimeout(DL.profT);
  DL.profT=setTimeout(()=>{ const d=S.deal, kp=dealKpInputs(), sup={}, duty={};
    for (const s of d.sup){ const nm=String(s.name||'').trim();
      if (nm) sup[nm]={ ...Object.fromEntries(DL_PROF_KEYS.map(k=>[k,s[k]])), logCur:s.log.cur, cusCur:s.cus.cur };
      if (s.cusMode==='calc' && s.duty!=='' && s.duty!=null)
        for (const x of kp.items) if ((d.map[x.id]||d.sup[0].id)===s.id && x.cat) duty[x.cat]=s.duty; }
    if (!Object.keys(sup).length && !Object.keys(duty).length) return;
    DL.prof=DL.prof||{}; DL.prof.sup={...(DL.prof.sup||{}), ...sup}; DL.prof.duty={...(DL.prof.duty||{}), ...duty};
    api('/api/deal/profiles',{method:'PUT',headers:{'Content-Type':'application/json; charset=utf-8'},body:JSON.stringify({sup,duty})}).catch(()=>{}); }, 1500);
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

function openDeal(){
  if (!dealAllowed()){ toast('Экономика сделки доступна автору КП и администратору'); return; }
  DL.ex=false; dealEnsure();
  let d=$('#dealdlg'); if (!d){ d=document.createElement('dialog'); d.id='dealdlg'; d.className='dealwin'; d.setAttribute('aria-label','Экономика сделки'); document.body.appendChild(d); dealBind(d); }
  d.innerHTML=''; dealRender(); if (!d.open) d.showModal();
  dlLoadExternal();
}

// ---------- отрисовка
function dlField(label, path, o={}){
  const d=dlDeal(), c=o.calc, raw=dlGet(d,path), e=c&&(c.err[path]||(o.errKey&&c.err[o.errKey]));
  let val=raw??'', badge='';
  if (o.kp!==undefined){ const own=raw!=null&&raw!==''; val= own?raw:dlIn(o.kp);
    badge = own ? `<button type="button" class="dl-badge own" data-dlx="reset" data-path="${path}" title="Вернуть значение из КП">изменено · ↺ ${esc(o.kpLabel||'из КП')}</button>`
      : `<span class="dl-badge kp">${DL.ex?'пример':esc(o.kpLabel||'из КП')}</span>`; }
  if (o.auto!==undefined){ const own=raw!=null&&raw!=='';
    if (!own){ val=dlIn(o.auto); badge=`<span class="dl-badge kp" title="${esc(o.autoTitle||'')}">${esc(o.autoLabel||'авто')}</span>`; }
    else if (o.autoReset) badge=`<button type="button" class="dl-badge own" data-dlx="reset" data-path="${path}" title="Вернуть расчёт">вручную · ↺ авто</button>`; }
  if (o.unknown && (raw==null||raw==='')) badge=`<span class="dl-badge warn">неизвестно</span>`;
  if (o.src==='module') badge=`<span class="dl-badge kp">из расчёта логистики</span>`;
  const cur = o.cur ? `<select data-dl="${o.cur}" aria-label="Валюта">${DEAL_CURS.map(k=>`<option${(dlGet(d,o.cur)||'RUB')===k?' selected':''}>${k}</option>`).join('')}</select>` : '';
  const inp = o.select ? `<select data-dl="${path}" aria-label="${esc(label)}">${o.select.map(([v,t])=>`<option value="${esc(v)}"${String(raw??o.select[0][0])===String(v)?' selected':''}>${esc(t)}</option>`).join('')}</select>`
    : `<input type="text" inputmode="${o.int?'numeric':'decimal'}" data-dl="${path}" value="${esc(val)}" placeholder="${esc(o.ph||'0')}" autocomplete="off"${o.list?` list="${o.list}"`:''}${e?' aria-invalid="true"':''}>`;
  return `<label class="f dl-f${e?' bad':''}"><span>${esc(label)}${o.unit?` <i>${esc(o.unit)}</i>`:''}${badge}</span>
    <span class="dl-in${cur?' cur':''}">${inp}${cur}</span>
    ${e?`<small class="dl-err">${esc(e)}</small>`:o.hint?`<small class="muted">${o.hint}</small>`:''}</label>`;
}

const dlFilled = (...v) => v.some(x=>x!=null && String(x).trim()!=='' && String(x).trim()!=='0');

function dlSupCard(c, s, k){
  const d=dlDeal(), cs=c.sup[k], multi=d.sup.length>1, P=`sup.${k}`;
  const its=[...cs.items, ...cs.noCost];
  const list = DL.ex ? '' : `<div class="dl-items">${its.length?its.map(x=>`<div class="dl-item"><span><b>${esc(x.name||'Без названия')}</b>
        <small>${x.cost>0?`${esc(x.qty)} × ${dlThousands(dlIn(x.cost))} ${esc(x.cur)}`:'<em class="bad-t">закупка не указана</em> — <button type="button" class="lnk" data-dlx="price">указать в «Ценах»</button>'}</small></span>
        ${multi?`<select data-dlmap="${esc(x.id)}" aria-label="Поставщик позиции">${d.sup.map((z,j)=>`<option value="${esc(z.id)}"${z.id===s.id?' selected':''}>${esc(c.sup[j].name)}</option>`).join('')}</select>`:''}</div>`).join('')
      : `<p class="muted">${multi?'Позиции КП не отнесены к этому поставщику — выберите поставщика у позиции в другой карточке.':'В КП нет позиций с закупкой.'}</p>`}</div>`;
  const byCur=Object.entries(cs.byCur).map(([cur,a])=>`${dlThousands(dlIn(a))} ${cur}`).join(' + ');
  const calc=s.cusMode==='calc';
  const customs = calc ? `<div class="dl-g g3">${dlField('Пошлина', P+'.duty', {calc:c, unit:'%', hint:'По коду ТН ВЭД. Запоминается для категории.'})}
        ${dlField('НДС на ввоз', P+'.ivat', {calc:c, select:[['22','22 %'],['10','10 %'],['0','0 %']]})}
        ${dlField('Таможенный сбор', P+'.fee', {calc:c, unit:'₽', auto:cs.fee, autoReset:true, autoLabel:'по шкале', autoTitle:'Сбор за таможенные операции по таможенной стоимости: '+CUSTOMS_FEES.title})}</div>
      <p class="dl-break">Таможенная стоимость ${dlRub0(cs.cv)} · пошлина ${dlRub0(cs.dutyA)} · сбор ${dlRub0(cs.fee)} · ввозной НДС ${dlRub0(cs.ivatA)} <span class="muted">(к вычету)</span> = <b>${dlRub0(cs.T)}</b></p>`
    : `<div class="dl-g">${dlField('Таможенные платежи целиком', P+'.cus.v', {calc:c, cur:P+'.cus.cur', hint:'Пошлина, сбор и ввозной НДС одной суммой'})}
        ${dlField('Ввозной НДС к вычету', P+'.vi', {calc:c, unit:'₽', ph:cs.T?'Сумма по декларации':'0', unknown:cs.T>0, hint:cs.T?'Пусто — сумма неизвестна (не ноль). Нет права на вычет — 0.':''})}</div>`;
  const moreOpen = dlFilled(s.extra&&s.extra.v, s.ins, s.fx, s.brk&&s.brk.v, s.voRu);
  const fxHint = cs.equipFx>0 ? '' : 'Для оплаты в валюте';
  return `<section class="dl-card">
    <div class="dl-ch"><input type="text" class="dl-name" data-dl="${P}.name" value="${esc(s.name||'')}" placeholder="${multi?`Поставщик ${k+1}`:'Поставщик'} — название" aria-label="Название поставщика" list="dlSupList">
      ${multi?`<button type="button" class="icon" data-dlx="delsup" data-k="${k}" aria-label="Убрать поставщика" title="Убрать поставщика: его позиции перейдут к первому">✕</button>`:''}</div>
    ${list}
    <div class="dl-sum"><span>Оборудование${byCur?` (${byCur})`:''}</span><b>${dlRub(cs.equip)}</b></div>
    <div class="dl-g g3">${dlField('Аванс поставщику', P+'.adv', {calc:c, unit:'%'})}${dlField('Изготовление', P+'.prod', {calc:c, unit:'дней', int:true})}${dlField('Доставка', P+'.ship', {calc:c, unit:'дней', int:true, hint:'Вместе с таможней'})}</div>
    <div class="dl-g">${dlField('Логистика до границы', P+'.log.v', {calc:c, cur:P+'.log.cur', src:s.log&&s.log.src, hint:'Из-за рубежа; входит в таможенную стоимость'})}
      ${dlField('Доставка по России', P+'.logRu.v', {calc:c, unit:'₽', src:s.logRu&&s.logRu.src, hint:'До склада или объекта; оплата при поставке'})}</div>
    <div class="dl-cus"><span class="dl-lab">Таможня</span><span class="seg dl-seg" role="group" aria-label="Таможня"><button type="button" class="${s.cusMode==='sum'||!s.cusMode?'on':''}" data-dlx="cusmode" data-k="${k}" data-v="sum">Сумма целиком</button><button type="button" class="${calc?'on':''}" data-dlx="cusmode" data-k="${k}" data-v="calc">Рассчитать</button><button type="button" class="${s.cusMode==='none'?'on':''}" data-dlx="cusmode" data-k="${k}" data-v="none" title="Поставка внутри России — таможни нет">Нет</button></span></div>
    ${s.cusMode==='none'?'':customs}
    <label class="sw-l"><button class="sw" type="button" role="switch" aria-checked="${!!s.vatIn}" data-dlx="vatin" data-k="${k}"><i></i>Поставщик с НДС (российский)</button></label>
    ${s.vatIn?`<div class="dl-g">${dlField('НДС поставщика к вычету', P+'.vo', {calc:c, unit:'₽', auto:cs.suggest, autoReset:true, autoLabel:`авто ${c.v}/${100+c.v}`, hint:'НДС в стоимости оборудования. Сверьте со счётом-фактурой.'})}</div>`:''}
    <details class="dl-more"${moreOpen?' open':''}><summary>Ещё расходы по поставщику <span class="muted">— прочая закупка, страхование, комиссия за перевод, брокер</span></summary>
      <div class="dl-g">${dlField('Прочая закупка у поставщика', P+'.extra.v', {calc:c, cur:P+'.extra.cur', hint:'Опции и то, чего нет в позициях КП'})}
        ${dlField('Страхование груза', P+'.ins', {calc:c, unit:'% от оборудования', ph:'0,3'})}
        ${dlField('Комиссия банка или агента', P+'.fx', {calc:c, unit:'% от платежа в валюте', ph:'1,5', hint:fxHint})}
        ${dlField('Брокер, СВХ, сертификация', P+'.brk.v', {calc:c, unit:'₽'})}
        ${cs.Lru+cs.brk>0?dlField('НДС к вычету по услугам в России', P+'.voRu', {calc:c, unit:'₽', auto:cs.ruSuggest, autoReset:true, autoLabel:`авто ${c.v}/${100+c.v}`, hint:'Перевозчик и брокер без НДС — впишите 0'}):''}</div></details>
  </section>`;
}

function dlCustomer(c){
  const d=dlDeal(), tr=d.cust.tr, n=tr.length;
  const evSel=(k,t)=>`<select data-dl="cust.tr.${k}.ev" aria-label="Событие">${Object.entries(DEAL_EVENTS).map(([v,l])=>`<option value="${v}"${t.ev===v?' selected':''}>${l}</option>`).join('')}</select>`;
  const rows=tr.map((t,k)=>{ const last=k===n-1, e=c.err[`cust.tr.${k}.pct`]||c.err[`cust.tr.${k}.off`];
    return `<div class="dl-tr${e?' bad':''}">
      ${last?`<span class="dl-trp" title="Последний этап — остаток до 100 %">${dlIn(c.trs[k].p)} %</span>`:`<span class="dl-in"><input type="text" inputmode="decimal" data-dl="cust.tr.${k}.pct" value="${esc(t.pct)}" placeholder="0" aria-label="Доля этапа, %"><i>%</i></span>`}
      ${evSel(k,t)}<span class="dl-in"><i>+</i><input type="text" inputmode="numeric" data-dl="cust.tr.${k}.off" value="${esc(t.off)}" placeholder="0" aria-label="Дней после события"><i>дн.</i></span>
      ${n>1?`<button type="button" class="icon" data-dlx="deltr" data-k="${k}" aria-label="Убрать этап">✕</button>`:'<span></span>'}</div>`; }).join('');
  return `<section class="dl-card"><div class="dl-ch"><b>Оплата заказчика</b><button type="button" class="btn ghost" data-dlx="addtr">+ Этап</button></div>
    <div class="dl-trs">${rows}</div>${c.err['cust.tr']?`<small class="dl-err">${esc(c.err['cust.tr'])}</small>`:''}
    <p class="muted dl-trn">Последний этап — остаток до 100 %. Готовность — день ${c.Rdy}, поставка — день ${c.D}${c.pnrDays?`, ПНР — день ${c.D+c.pnrDays}`:''}.</p></section>`;
}

function dlResult(c){
  const d=dlDeal(), b=c.base, lo=c.lo, hi=c.hi, unk=c.unknown.length>0, bad=!c.ok || c.warn.some(w=>w.bad), r=b||lo;
  const chip = bad ? '<span class="dl-chip bad">Проверьте данные</span>' : unk ? '<span class="dl-chip warn">Нужна сумма ввозного НДС</span>' : '<span class="dl-chip ok">Все данные указаны</span>';
  const rng=(f,fmt)=>unk ? `<span class="dl-rng">${fmt(f(lo))} … ${fmt(f(hi))}</span>` : fmt(f(b));
  const P = unk ? null : b.P;
  // цена под цель и безубыточная цена
  const kp=dlKp(), tg=d.target||{type:'margin',v:''}, tv=dNum(tg.v);
  const need = tv!=null && !Number.isNaN(tv) ? dealSolve(kp, d, tg.type, tv) : null;
  const be = dealSolve(kp, d, 'profit', 0);
  const own = d.over.price!=='' && d.over.price!=null && Math.abs(c.S-kp.sumRub)>0.5;
  const diff = need!=null ? need-kp.sumRub : 0;
  const unit = tg.type==='profit'||tg.type==='net' ? '₽' : '%';
  const parts = c.parts.map(([n,v])=>`<dt>${esc(n)}</dt><dd${v<0?' class="ok-t"':''}>${dlRub0(v)}${v>0&&r.Ctot>0?`<small>${dlIn(v/r.Ctot*100)} %</small>`:''}</dd>`).join('');
  return `<div class="dl-res">${chip}
    <div class="dl-big${P!=null&&P<0?' neg':''}${unk?' rng':''}"><small>Прибыль после финансирования, до налога на прибыль</small><b>${unk?`от ${dlRub0(lo.P)} до ${dlRub0(hi.P)}`:dlRub(P)}</b>
      ${unk?`<p class="dl-note">Без ввозного НДС — нижняя граница; если вся сумма таможни — НДС к вычету, верхняя. Укажите сумму из декларации или выберите «Рассчитать».</p>`
        :`<p class="dl-note">Чистая прибыль после налога ${dlIn(c.taxP)} %: <b>${dlRub0(b.net)}</b></p>`}</div>
    <div class="dl-kpi"><div><small>Наценка</small><b>${rng(x=>x.markup,dlPct)}</b><span>от себестоимости</span></div><div><small>Маржинальность</small><b>${rng(x=>x.margin,dlPct)}</b><span>от выручки без НДС</span></div></div>
    ${DL.ex?'':`<div class="dl-price"><b>Цена для КП</b>
      <div class="dl-pr"><select data-dl="target.type" aria-label="Цель">${[['margin','Маржинальность'],['markup','Наценка'],['profit','Прибыль'],['net','Чистая прибыль']].map(([v,t])=>`<option value="${v}"${tg.type===v?' selected':''}>${t}</option>`).join('')}</select>
        <span class="dl-in"><input type="text" inputmode="decimal" data-dl="target.v" value="${esc(tg.v||'')}" placeholder="${unit==='%'?'20':'500 000'}" aria-label="Целевое значение"><i>${unit}</i></span></div>
      ${need!=null?`<p>Цена с НДС: <b>${dlRub0(need)}</b> <span class="${diff<0?'ok-t':'muted'}">(${diff>=0?'+':'−'}${dlRub0(Math.abs(diff))} к КП)</span></p>
        <button class="btn primary" type="button" data-dlx="apply" data-s="${need}">Перенести в цены КП</button>`
        : tv!=null?'<p class="muted">Цель недостижима при этих расходах.</p>':'<p class="muted">Укажите цель — программа подберёт цену с НДС.</p>'}
      ${own?`<p class="dl-note">В расчёте цена изменена вручную: ${dlRub0(c.S)}. <button class="lnk" type="button" data-dlx="apply" data-s="${c.S}">Перенести её в цены КП</button></p>`:''}
      ${be!=null?`<p class="dl-note">Безубыточная цена с НДС: <b>${dlRub0(be)}</b>${unk?' (без ввозного НДС)':''}</p>`:''}</div>`}
    <dl class="dl-dl">
      <dt>Выручка без НДС</dt><dd>${dlRub(c.R)}</dd>
      <dt>НДС с продажи</dt><dd>${dlRub(c.VATs)}</dd>
      <dt>Прямые платежи</dt><dd>${dlRub(c.Ccash)}</dd>
      <dt>Финансирование</dt><dd>${dlRub(c.F)}</dd>
      <dt>НДС к вычету</dt><dd>${unk?rng(x=>x.VATin,dlRub0):dlRub(b.VATin)}</dd>
      <dt>Себестоимость с финансированием</dt><dd>${unk?rng(x=>x.Ctot,dlRub0):dlRub(b.Ctot)}</dd>
      <dt>НДС к доплате</dt><dd>${unk?rng(x=>x.payable,dlRub0):dlRub(b.payable)}</dd>
      ${!unk&&b.excess>0?`<dt>Превышение вычетов</dt><dd>${dlRub(b.excess)}</dd>`:''}
      <dt>Налог на прибыль ${dlIn(c.taxP)} %</dt><dd>${unk?rng(x=>x.tax,dlRub0):dlRub(b.tax)}</dd>
      <dt>Остаток до расчётов по НДС</dt><dd>${dlRub(c.cashBefore)}</dd>
      <dt>Остаток после доплаты НДС</dt><dd>${unk?rng(x=>x.cashAfter,dlRub0):dlRub(b.cashAfter)}</dd></dl>
    ${parts?`<details class="dl-more dl-parts"><summary>Из чего себестоимость</summary><dl class="dl-dl">${parts}</dl></details>`:''}
    ${c.warn.length?`<ul class="dl-warn">${c.warn.map(w=>`<li class="${w.bad?'bad':''}">${esc(w.t)}${w.go?` <button type="button" class="lnk" data-dlx="price">в «Цены»</button>`:''}</li>`).join('')}</ul>`:''}
    ${!unk&&b.excess>0?'<p class="dl-note">Превышение вычетов не добавляется в денежный остаток как автоматический возврат.</p>':''}
  </div>`;
}

function dlSchedule(c){
  const d=dlDeal();
  return `<section class="dl-card dl-sched"><div class="dl-ch"><b>График платежей · ${c.Tend} ${plural(c.Tend,'день','дня','дней')}</b>${Object.keys(d.days||{}).length?'<button type="button" class="btn ghost" data-dlx="resetdays">↺ Даты по срокам</button>':''}</div>
    <div class="dl-tw"><table class="dl-t"><thead><tr><th>День</th><th>Событие</th><th class="num">Платёж</th><th class="num">Остаток денег</th><th class="num">Финансирование</th></tr></thead><tbody>
    ${c.rows.map(r=>`<tr class="${r.inflow?'in':''}${r.manual?' man':''}"><td class="c-day">${r.fixed?`<span class="dl-day fx">${r.day}</span>`:`<input type="text" inputmode="numeric" class="dl-day" data-dl="days.${r.key}" value="${r.day}" aria-label="День: ${esc(r.label)}" title="${r.manual?'Дата изменена вручную':'По срокам — можно изменить'}">`}</td>
      <td class="c-ev">${esc(r.label)}</td><td class="num c-pay">${r.inflow?'+':'−'}${dlRub0(Math.abs(r.amount))}</td><td class="num c-bal ${r.balance<0?'neg':''}">${dlRub0(r.balance)}</td><td class="num c-fin">${r.fin?dlRub0(r.fin)+`<small>${r.days} дн.</small>`:'—'}</td></tr>`).join('')}
    </tbody><tfoot><tr><td class="c-day"></td><td class="c-ev">Стоимость финансирования</td><td class="c-pay"></td><td class="c-bal"></td><td class="num c-fin"><b>${dlRub(c.F)}</b></td></tr></tfoot></table></div>
    <p class="muted">Простой процент на недостающие деньги до последней оплаты заказчика, месяц — 30 дней; оплаты заказчика уменьшают финансирование, доход на свободный остаток не начисляется. День строки можно изменить.</p></section>`;
}

function dealRender(){
  const dlg=$('#dealdlg'); if (!dlg || !dlg.isConnected) return;
  const d=dlDeal(), kp=dlKp(), c=dealCalc(kp,d);
  const rates=c.used.map(cur=>dlField(`Курс, ₽ за 1 ${cur}`, 'rates.'+cur, {calc:c, kp:dNum(kp.rates[cur]), kpLabel:'курс ЦБ из КП'})).join('');
  const keyT = DL.key ? `ключевая ${dlIn(DL.key.rate)} % + ${DL_KEY_SPREAD} п.п.` : 'по умолчанию';
  const head=`<div class="dlg-h"><h3>Экономика сделки${!DL.ex&&S.number?` · КП № ${esc(S.number)}`:''}<small>${DL.ex?'Учебный пример из методики':esc(S.client||'Получатель не указан')}</small></h3>
      <button class="btn" type="button" data-dlx="xlsx">Выгрузить в Excel</button><button class="icon" type="button" data-dlx="close" aria-label="Закрыть">✕</button></div>`;
  const banner = DL.ex ? `<div class="dl-ex">Учебный пример: 196 000 CNY по курсу 12,4, растаможка 48 000 CNY. Данные сделки не меняются. <button class="btn" type="button" data-dlx="exit">Вернуться к сделке</button></div>`
    : kp.sumNoRate ? `<div class="dl-ex warn">Нет курса валюты КП (${esc(kp.cur)}) — цена для заказчика не переведена в рубли. Укажите курс в разделе «Цены» или цену здесь.</div>` : '';
  const b=c.base, mini = b ? `<span><small>Прибыль после финансирования</small><b class="${b.P<0?'neg':''}">${dlRub0(b.P)}</b></span><span class="r"><small>Маржинальность</small><b>${dlPct(b.margin)}</b></span>`
    : `<span><small>Прибыль после финансирования</small><b>${dlRub0(c.lo.P)} … ${dlRub0(c.hi.P)}</b></span><span class="r warn-t">нужен ввозной НДС</span>`;
  const otherOpen = dlFilled(d.vo, d.warr, d.bonus);
  const supNames = Object.keys((DL.prof&&DL.prof.sup)||{});
  morph(dlg, `${head}${banner}<div class="dl-mini">${mini}</div><div class="dl-b"><div class="dl-form">
    <datalist id="dlSupList">${supNames.map(n=>`<option value="${esc(n)}">`).join('')}</datalist>
    <section class="dl-card"><div class="dl-ch"><b>Цена и НДС</b></div><div class="dl-g">
      ${dlField('Цена для заказчика с НДС', 'over.price', {calc:c, unit:'₽', kp:kp.sumRub})}${dlField('НДС при продаже', 'over.vat', {calc:c, unit:'%', kp:kp.vat})}${rates}</div></section>
    ${d.sup.map((s,k)=>dlSupCard(c,s,k)).join('')}
    ${DL.ex?'':`<button type="button" class="btn dl-add" data-dlx="addsup">+ Поставщик <span class="muted">— свои позиции, аванс, сроки, логистика, таможня</span></button>`}
    <section class="dl-card"><div class="dl-ch"><b>Монтаж и прочие расходы</b></div><div class="dl-g g3">
      ${dlField('Монтаж и ПНР', 'mnt', {calc:c, unit:'₽', hint:'Платёж — при поставке'})}${dlField('ПНР', 'pnr', {calc:c, unit:'дней', int:true, hint:'Для оплаты «после ПНР»'})}${dlField('Прочие расходы', 'oth', {calc:c, unit:'₽', hint:'Платёж — при поставке'})}</div>
      <details class="dl-more"${otherOpen?' open':''}><summary>Ещё <span class="muted">— резерв на гарантию, бонусы с продажи, прочий НДС к вычету</span></summary><div class="dl-g g3">
        ${dlField('Резерв на гарантию', 'warr', {calc:c, unit:'% выручки', ph:'1'})}${dlField('Бонусы и комиссии', 'bonus', {calc:c, unit:'% выручки', hint:'Агентам, менеджерам; после оплаты'})}
        ${dlField('Прочий НДС к вычету', 'vo', {calc:c, unit:'₽', hint:'В монтаже и прочих расходах'})}</div></details></section>
    ${dlCustomer(c)}
    <section class="dl-card"><div class="dl-ch"><b>Деньги и налог</b></div><div class="dl-g">
      ${dlField('Стоимость денег', 'money', {calc:c, unit:'% в мес.', auto:kp.moneyAuto, autoReset:true, autoLabel:keyT, autoTitle:DL.key?`Ключевая ставка ЦБ РФ ${dlIn(DL.key.rate)} % с ${DL.key.date} + ${DL_KEY_SPREAD} п.п. годовых, делённое на 12`:(DL.keyErr?'Ключевая ставка ЦБ недоступна: '+DL.keyErr:'')})}
      ${dlField('Налог на прибыль', 'tax', {calc:c, unit:'%'})}</div></section>
    ${dlSchedule(c)}
    <div class="dl-foot">${DL.ex?'':'<button class="btn ghost" type="button" data-dlx="example">Учебный пример НДС</button>'}<span class="muted">Расчёт не попадает в КП. Пересчёт — сразу при вводе.</span></div>
  </div><aside class="dl-side">${dlResult(c)}</aside></div>`);
}

// ---------- перенос цены в позиции КП: распределение по закупке (одинаковая наценка позиций) или по текущим ценам
async function dealApplyPrice(Srub){
  const cur=kpCur(), r=rateOf(cur); if (!(r>0)){ toast('Нет курса валюты КП — укажите его в разделе «Цены»'); return; }
  const its=S.items.filter(x=>String(x.name||'').trim()); if (!its.length){ toast('В КП нет позиций'); return; }
  const target=Math.round(Srub/r*100), before=totalsS().sum;
  const rub=x=>x.cost>0 && rateOf(x.costCur||'RUB')>0 ? x.cost*rateOf(x.costCur||'RUB')*(+x.qty||0) : 0;
  let w=its.map(rub), basis='пропорционально закупке — одинаковая наценка позиций';
  if (w.some(v=>!(v>0))){ w=its.map(x=>(x.price||0)*(+x.qty||0)); basis='пропорционально текущим ценам'; }
  if (w.some(v=>!(v>0))){ w=its.map(x=>+x.qty||1); basis='поровну на единицу'; }
  const W=w.reduce((a,b)=>a+b,0);
  const ok=await stConfirm('Изменить цены позиций КП?', `Итог КП с НДС: ${money(before)} → ${money(target)} ${curSh(cur)}. Цена распределяется по позициям ${basis}; опции и скидки не меняются.`, 'Изменить цены');
  if (!ok) return;
  const old=its.map(x=>[x.price, x.priceManual, x._priceText]);
  const setX=X=>its.forEach((x,k)=>{ x.price=Math.max(0, roundTo(w[k]/W*X/(+x.qty||1))); });
  setX(target); const t1=totalsS().sum; setX(target*1.1); const t2=totalsS().sum;
  const X = t2!==t1 ? target+(target-t1)*(target*0.1)/(t2-t1) : target;
  setX(X); its.forEach(x=>{ x.priceManual=true; delete x._priceText; });
  const after=totalsS().sum;
  if (!(after>0)){ its.forEach((x,k)=>{ [x.price,x.priceManual,x._priceText]=old[k]; }); toast('Не удалось распределить цену'); return; }
  const d=dealEnsure(); d.over.price=''; d.touched=true;
  renderForm(); persist(); dealRender();
  toast(`Цены позиций изменены: итог КП ${money(after)} ${curSh(cur)}${Math.abs(after-target)>=100?' (округление цен позиций)':''}`);
}

// ---------- события окна
function dealBind(dlg){
  const touch=()=>{ if (DL.ex) return; S.deal.touched=true; persist(); renderSide(); dlSaveProfiles(); };
  dlg.addEventListener('input', e=>{ const t=e.target, p=t.dataset.dl; if (!p || t.tagName==='SELECT') return;
    dlSet(dlDeal(), p, t.value); if (!DL.ex) dealRememberDefault(p, t.value);
    const m=/^sup\.(\d+)\.name$/.exec(p); if (m && !DL.ex && dlApplyProfile(dlDeal().sup[+m[1]])) toast('Условия поставщика подставлены из прошлой сделки — проверьте');
    touch(); dealRender(); });
  dlg.addEventListener('change', e=>{ const t=e.target;
    if (t.dataset.dl && t.tagName==='SELECT'){ dlSet(dlDeal(), t.dataset.dl, t.value); touch(); dealRender(); }
    if (t.dataset.dlmap){ const d=dlDeal(); d.map={...(d.map||{}), [t.dataset.dlmap]:t.value}; touch(); dealRender(); } });
  dlg.addEventListener('click', e=>{ const b=e.target.closest('[data-dlx]'); if (!b) return; const d=dlDeal(), a=b.dataset.dlx, k=+b.dataset.k;
    if (a==='close') return dlg.close();
    if (a==='price'){ dlg.close(); return goStep('price'); }
    if (a==='xlsx') return dealXlsx();
    if (a==='apply') return dealApplyPrice(+b.dataset.s);
    if (a==='example'){ const x=dealExample(); Object.assign(DL,{ex:true, exKp:x.kp, exDeal:x.deal}); return dealRender(); }
    if (a==='exit'){ DL.ex=false; return dealRender(); }
    if (a==='reset'){ dlSet(d, b.dataset.path, ''); }
    if (a==='resetdays') d.days={};
    if (a==='vatin') d.sup[k].vatIn=!d.sup[k].vatIn;
    if (a==='cusmode'){ const s=d.sup[k]; s.cusMode=b.dataset.v;
      if (s.cusMode==='calc' && (s.duty===''||s.duty==null)){ const its=dlKp().items.filter(x=>(d.map[x.id]||d.sup[0].id)===s.id); const p=dlProfile(s.name); s.duty=(p&&p.duty)||dlDutyFor(its.map(x=>x.cat))||''; } }
    if (a==='addtr'){ const tr=d.cust.tr; tr.splice(tr.length-1, 0, {pct:'', ev:tr.length>1?'ready':'sign', off:'0'}); }
    if (a==='deltr'){ d.cust.tr.splice(k,1); }
    if (a==='addsup'){ const def=dealDefaults(), n=dealNewSupplier('s'+Date.now().toString(36), def); n.name=''; d.sup.push(n); }
    if (a==='delsup'){ const id=d.sup[k].id; d.sup.splice(k,1); for (const x in d.map) if (d.map[x]===id) delete d.map[x]; }
    touch(); dealRender(); });
}

// ---------- выгрузка в Excel: исходные данные (жёлтые ячейки), результат формулами, график платежей
async function dealXlsx(){
  const d=dlDeal(), kp=dlKp(), c=dealCalc(kp,d), R=[], G=[];
  const SH1='Расчёт', SH2='График платежей', q=n=>`'${n}'!`;
  const at={}, row=(cells, key)=>{ R.push(cells); if (key) at[key]=R.length; return R.length; };
  const ref=(key,col='B')=>col+at[key], D=k=>ref(k,'D'), self=()=>'B'+(R.length+1);
  const num=v=>Number.isFinite(v)?v:0;
  const note=t=>({v:t, s:'note'});
  row([{v:'Экономика сделки', s:'title'}]);
  row([note(DL.ex ? 'Учебный пример из методики' : [S.number?'КП № '+S.number:'КП без номера', S.client||'', 'расчёт от '+new Date().toLocaleDateString('ru-RU'), S.manager&&S.manager.name?'автор: '+S.manager.name:''].filter(Boolean).join(' · '))]);
  row([]);
  row([{v:'Исходные данные', s:'head'},{v:'Значение',s:'head'},{v:'Ед.',s:'head'},{v:'В рублях',s:'head'},{v:'Примечание',s:'head'}]);
  row(['Цена для заказчика с НДС', {v:c.S, s:'inpMoney'}, '₽', {f:self(), v:c.S}], 'S');
  row(['НДС при продаже', {v:c.v, s:'inp'}, '%'], 'v');
  for (const cur of c.used) row([`Курс рубля за 1 ${cur}`, {v:num(c.rate(cur)), s:'inp'}, '₽'], 'rate_'+cur);
  const rub=(key, cur)=> cur==='RUB' ? ref(key) : `${ref(key)}*${ref('rate_'+cur)}`;
  const vK=`${ref('v')}/(100+${ref('v')})`;
  const amt=(label, key, o, cur0)=>{ const cur=cur0||(o&&o.cur)||'RUB', a=dNum(o&&o.v)||0; const r=row([label, {v:a, s:'inpMoney'}, cur], key); R[r-1][3]={f:rub(key,cur), v:a*num(c.rate(cur)), s:'money'}; return cur; };
  const custOut=[];
  c.sup.forEach((s,k)=>{ const ds=d.sup[k];
    row([{v:'Поставщик: '+s.name, s:'bold'}]);
    const eqKeys=[], fxKeys=[];
    Object.entries(s.byCur).forEach(([cur,a])=>{ const key=`eq${k}_${cur}`, nv=kp.costNoVat&&s.items.length; const r=row([`Оборудование, ${cur}`, {v:a, s:'inpMoney'}, cur], key);
      R[r-1][3]={f:rub(key,cur)+(nv?`*(1+${ref('v')}/100)`:''), v:a*num(c.rate(cur))*(nv?1+c.v/100:1), s:'money'}; eqKeys.push(key); if (cur!=='RUB') fxKeys.push(key); });
    row(['Оборудование, итого', '', '', {f: eqKeys.length?eqKeys.map(x=>D(x)).join('+'):'0', v:s.equip, s:'moneyB'}, kp.costNoVat?note('Закупка в КП без НДС — добавлен НДС'):''], `EQ${k}`);
    const logCur=amt('Логистика до границы', 'L'+k, ds.log);
    amt('Доставка по России', 'LRU'+k, ds.logRu, 'RUB');
    amt('Брокер, СВХ, сертификация', 'BRK'+k, ds.brk, 'RUB');
    row(['Страхование груза', {v:dNum(ds.ins)||0, s:'inp'}, '% от оборудования', {f:`${D('EQ'+k)}*${self()}/100`, v:s.ins}], 'INS'+k);
    row(['Комиссия банка или агента за перевод', {v:dNum(ds.fx)||0, s:'inp'}, '% от платежа в валюте',
      {f:`(${[...fxKeys.map(x=>D(x)), logCur!=='RUB'?D('L'+k):null].filter(Boolean).join('+')||'0'})*${self()}/100`, v:s.fxE+s.fxL}], 'FX'+k);
    if (s.calc){
      row(['Таможенная стоимость', '', '', {f:`${D('EQ'+k)}+${D('L'+k)}+${D('INS'+k)}`, v:s.cv, s:'money'}, note('Оборудование + логистика до границы + страхование')], 'CV'+k);
      row(['Пошлина', {v:dNum(ds.duty)||0, s:'inp'}, '%', {f:`${D('CV'+k)}*${self()}/100`, v:s.dutyA}], 'DU'+k);
      const sc=CUSTOMS_FEES.scale, lims=[0,...sc.slice(0,-1).map(x=>x[0]+0.01)], fees=sc.map(x=>x[1]);
      row(['Таможенный сбор', s.feeAuto?{f:`LOOKUP(${D('CV'+k)},{${lims.join(',')}},{${fees.join(',')}})`, v:s.fee, s:'inpMoney'}:{v:s.fee, s:'inpMoney'}, '₽', {f:self(), v:s.fee}, note(s.feeAuto?'По шкале '+CUSTOMS_FEES.title:'Вписан вручную')], 'FE'+k);
      row(['НДС на ввоз', {v:dNum(ds.ivat)??22, s:'inp'}, '%', {f:`(${D('CV'+k)}+${D('DU'+k)})*${self()}/100`, v:s.ivatA}, note('Ввозной НДС — к вычету')], 'IV'+k);
      row(['Таможенные платежи', '', '', {f:`${D('DU'+k)}+${D('FE'+k)}+${D('IV'+k)}`, v:s.T, s:'moneyB'}], 'T'+k);
      row(['Ввозной НДС к вычету', '', '', {f:D('IV'+k), v:s.vi}], 'vi'+k);
    } else {
      amt('Таможенные платежи целиком', 'T'+k, ds.cusMode==='none'?{v:0,cur:'RUB'}:ds.cus);
      row(['Ввозной НДС к вычету', s.vi==null?{v:'', s:'inpMoney'}:{v:s.vi, s:'inpMoney'}, '₽', {f:self(), v:s.vi||0}, s.vi==null?note('Не указан: в файле считается 0 — прибыль минимальная'):''], 'vi'+k);
    }
    row(['Аванс поставщику', {v:s.adv, s:'inp'}, '%'], 'adv'+k);
    row(['Изготовление', {v:s.prod, s:'inpInt'}, 'дней'], 'prod'+k);
    row(['Доставка', {v:s.ship, s:'inpInt'}, 'дней'], 'ship'+k);
    if (ds.vatIn) row(['НДС поставщика к вычету', s.voAuto?{f:`${D('EQ'+k)}*${vK}`, v:s.vo, s:'inpMoney'}:{v:s.vo, s:'inpMoney'}, '₽', {f:self(), v:s.vo}, s.voAuto?note('НДС в стоимости оборудования'):''], 'vo'+k);
    row(['НДС к вычету по услугам в России', s.voRuAuto?{f:`(${D('LRU'+k)}+${D('BRK'+k)})*${vK}`, v:s.voRu, s:'inpMoney'}:{v:s.voRu, s:'inpMoney'}, '₽', {f:self(), v:s.voRu}], 'voru'+k);
    const fxE=fxKeys.length?`(${fxKeys.map(x=>D(x)).join('+')})*${ref('FX'+k)}/100`:'0';
    row(['Платежи поставщику и за доставку, итого', '', '', {f:`${D('EQ'+k)}+${D('FX'+k)}+${D('INS'+k)}+${D('L'+k)}+${D('T'+k)}+${D('BRK'+k)}+${D('LRU'+k)}`, v:s.cash, s:'moneyB'}], 'CASH'+k);
    custOut.push({k, fxE}); });
  row([{v:'Монтаж, прочее, заказчик, деньги', s:'bold'}]);
  row(['Монтаж и ПНР', {v:c.M, s:'inpMoney'}, '₽', {f:self(), v:c.M}], 'M');
  row(['Прочие расходы', {v:c.E, s:'inpMoney'}, '₽', {f:self(), v:c.E}], 'E');
  row(['Прочий НДС к вычету', {v:c.Vo, s:'inpMoney'}, '₽', {f:self(), v:c.Vo}], 'Vo');
  row(['Резерв на гарантию', {v:c.warrP, s:'inp'}, '% выручки без НДС'], 'WARR');
  row(['Бонусы и комиссии с продажи', {v:c.bonusP, s:'inp'}, '% выручки без НДС'], 'BON');
  const trKeys=[];
  c.trs.forEach((t,j)=>{ const key='TR'+j; trKeys.push(key);
    row([`Оплата заказчика: этап ${j+1} — ${DEAL_EVENTS[t.ev]}${t.off?` + ${t.off} дн.`:''}`, t.last?{f:`100-${trKeys.slice(0,-1).map(x=>ref(x)).join('-')||'0'}`, v:t.p, s:'money'}:{v:t.p, s:'inp'}, '%', '', t.last?note('Остаток до 100 %'):''], key); });
  row(['Стоимость денег', {v:c.i, s:'inp'}, '% в месяц', '', c.moneyAuto&&DL.key?note(`Ключевая ставка ЦБ ${dlIn(DL.key.rate)} % + ${DL_KEY_SPREAD} п.п. / 12`):''], 'i');
  row(['Налог на прибыль', {v:c.taxP, s:'inp'}, '%'], 'TAX');
  // график (на втором листе)
  const gHead=4, gFirst=gHead+1, gLast=gHead+c.rows.length, gTot=gLast+1;
  const supK=id=>c.sup.findIndex(s=>s.id===id);
  const A=key=>q(SH1)+key;
  const amountF=r=>{ const [kind,id]=r.key.split(':'), k=supK(id), o=custOut[k];
    if (kind==='adv') return `-(${A(D('EQ'+k))}+${o.fxE.replace(/([A-Z]+\d+)/g, m=>A(m))})*${A(ref('adv'+k))}/100`;
    if (kind==='rest') return `-((${A(D('EQ'+k))}+${o.fxE.replace(/([A-Z]+\d+)/g, m=>A(m))})*(1-${A(ref('adv'+k))}/100)+${A(D('FX'+k))}-${o.fxE.replace(/([A-Z]+\d+)/g, m=>A(m))}+${A(D('INS'+k))}+${A(D('L'+k))}+${A(D('T'+k))}+${A(D('BRK'+k))})`;
    if (kind==='ru') return `-${A(D('LRU'+k))}`;
    if (kind==='mnt') return `-(${A(D('M'))}+${A(D('E'))})`;
    if (r.key==='bonus') return `-${A(ref('Rv'))}*${A(ref('BON'))}/100`;
    if (r.key==='warr') return `-${A(ref('Rv'))}*${A(ref('WARR'))}/100`;
    const j=+r.key.slice(1); return `${A(D('S'))}*${A(ref('TR'+j))}/100`; };
  const inRows=c.rows.map((r,k)=>r.inflow?'A'+(gFirst+k):null).filter(Boolean);
  G.push([{v:'График платежей', s:'title'}]);
  G.push(['Последняя оплата заказчика, день', {f:`MAX(${inRows.join(',')})`, v:c.Tend, s:'int'}]);
  G.push([note('Дни можно менять, сохраняя порядок строк по возрастанию дня. Платёж: минус — расход, плюс — поступление.')]);
  G.push([{v:'День',s:'head'},{v:'Событие',s:'head'},{v:'Платёж, ₽',s:'head'},{v:'Остаток денег, ₽',s:'head'},{v:'Дней финансирования',s:'head'},{v:'Финансирование, ₽',s:'head'}]);
  // результат — до графика (строки графика ссылаются на выручку)
  row([]);
  row([{v:'Результат', s:'head'},{v:'Значение',s:'head'},{v:'',s:'head'},{v:'',s:'head'},{v:'Формула',s:'head'}]);
  const sumK=p=>c.sup.map((s,k)=>D(p+k)).join('+')||'0';
  const vatIn=[...c.sup.map((s,k)=>D('vi'+k)), ...c.sup.map((s,k)=>d.sup[k].vatIn?D('vo'+k):null).filter(Boolean), ...c.sup.map((s,k)=>D('voru'+k)), D('Vo')].join('+');
  const b=c.base||c.lo;
  row(['Выручка без НДС', {f:`${D('S')}/(1+${ref('v')}/100)`, v:c.R, s:'money'}, '', '', note('R = S / (1 + НДС / 100)')], 'Rv');
  row(['НДС с продажи', {f:`${D('S')}-${ref('Rv')}`, v:c.VATs, s:'money'}, '', '', note('S − R')], 'VATs');
  row(['Прямые платежи', {f:`${sumK('CASH')}+${D('M')}+${D('E')}+${ref('Rv')}*(${ref('WARR')}+${ref('BON')})/100`, v:c.Ccash, s:'money'}, '', '', note('Поставщики, доставка, таможня, монтаж, прочее, резерв, бонусы')], 'C');
  row(['Финансирование', {f:`${q(SH2)}F${gTot}`, v:c.F, s:'money'}, '', '', note('Лист «График платежей»')], 'F');
  row(['НДС к вычету', {f:vatIn, v:b.VATin, s:'money'}, '', '', note('Ввозной + НДС поставщиков + услуги в России + прочий')], 'VI');
  row(['Себестоимость с финансированием', {f:`${ref('C')}-${ref('VI')}+${ref('F')}`, v:b.Ctot, s:'money'}, '', '', note('Прямые платежи − НДС к вычету + финансирование')], 'CT');
  row([{v:'Прибыль до налога на прибыль', s:'bold'}, {f:`${ref('Rv')}-${ref('CT')}`, v:b.P, s:'moneyB'}, '', '', c.unknown.length?note('Ввозной НДС не указан — прибыль минимальная'):''], 'P');
  row(['Налог на прибыль', {f:`IF(${ref('P')}>0,${ref('P')}*${ref('TAX')}/100,0)`, v:b.tax, s:'money'}], 'PT');
  row([{v:'Чистая прибыль', s:'bold'}, {f:`${ref('P')}-${ref('PT')}`, v:b.net, s:'moneyB'}]);
  row(['Наценка', {f:`IF(${ref('CT')}=0,"",${ref('P')}/${ref('CT')})`, v:b.markup==null?undefined:b.markup/100, s:'pctB'}, '', '', note('Прибыль / себестоимость')]);
  row(['Маржинальность', {f:`IF(${ref('Rv')}=0,"",${ref('P')}/${ref('Rv')})`, v:b.margin==null?undefined:b.margin/100, s:'pctB'}, '', '', note('Прибыль / выручка без НДС')]);
  row(['НДС к доплате', {f:`MAX(${ref('VATs')}-${ref('VI')},0)`, v:b.payable, s:'money'}], 'PAY');
  row(['Превышение вычетов', {f:`MAX(${ref('VI')}-${ref('VATs')},0)`, v:b.excess, s:'money'}, '', '', note('Не добавляется в остаток как возврат')]);
  row(['Денежный остаток до расчётов по НДС', {f:`${D('S')}-${ref('C')}-${ref('F')}`, v:c.cashBefore, s:'money'}], 'CB');
  row(['Денежный остаток после доплаты НДС', {f:`${ref('CB')}-${ref('PAY')}`, v:b.cashAfter, s:'money'}]);
  c.rows.forEach((r,k)=>{ const n=gFirst+k;
    G.push([{v:r.day, s:r.fixed?'int':'inpInt'}, r.label, {f:amountF(r), v:r.amount, s:'money'}, {f:k?`D${n-1}+C${n}`:`C${n}`, v:r.balance, s:'money'},
      {f:k<c.rows.length-1?`MAX(0,MIN(A${n+1},$B$2)-A${n})`:'0', v:r.days, s:'int'}, {f:`MAX(0,-D${n})*E${n}*${q(SH1)}${ref('i')}/100/30`, v:r.fin, s:'money'}]); });
  G.push(['', {v:'Стоимость финансирования', s:'bold'}, '', '', '', {f:`SUM(F${gFirst}:F${gLast})`, v:c.F, s:'moneyB'}]);
  const blob=await makeXlsx([{name:SH1, cols:[44,18,20,18,52], rows:R}, {name:SH2, cols:[10,52,18,18,14,18], rows:G}], 'Экономика сделки');
  const safe=s=>String(s||'').replace(/[\\/:*?"<>|«»]+/g,'').replace(/\s+/g,'_').slice(0,60);
  saveFileA(DL.ex ? 'Экономика_сделки_пример.xlsx' : `Экономика_КП_${safe(S.number||'черновик')}${S.client?'_'+safe(S.client):''}.xlsx`, blob);
  toast('Расчёт выгружен в Excel');
}

// краткий итог для правой панели и журнала (только если расчёт заполнен)
function dealSummary(st=S){
  if (!st.deal || !st.deal.touched) return null;
  const c=dealCalc(dealKpInputs(st), st.deal), b=c.base;
  return b ? { confirmed:true, profit:Math.round(b.P*100)/100, net:Math.round(b.net*100)/100, margin:b.margin, markup:b.markup }
    : { confirmed:false, lo:Math.round(c.lo.P), hi:Math.round(c.hi.P), marginLo:c.lo.margin, marginHi:c.hi.margin };
}
