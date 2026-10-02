// Окно «Экономика сделки»: расчёт по данным конструктора (js/features/deal-calc.js), график платежей, выгрузка в Excel.
// Не влияет на КП: данные хранятся в S.deal и при сборке документа не читаются.
// Видят только автор КП и администратор (на сервере расчёт чужого КП не отдаётся и не перезаписывается — app/admin.py).
'use strict';

const DL = { ex:false, exKp:null, exDeal:null };
const DL_DEF_KEYS = { money:'money', 'cust.defer':'defer', 'cust.adv':'cAdv', 'sup.0.adv':'adv', 'sup.0.prod':'prod', 'sup.0.ship':'ship' };

function dealDefaults(){ try{ return JSON.parse(localStorage.getItem('kp.dealDef')||'{}')||{}; }catch(e){ return {}; } }

function dealRememberDefault(path, v){ const k=DL_DEF_KEYS[path]; if (!k) return; try{ const o=dealDefaults(); o[k]=v; localStorage.setItem('kp.dealDef', JSON.stringify(o)); }catch(e){} }

// расчёт виден автору КП (кто его создал на своём устройстве) и администратору; новое несохранённое КП — своё
function dealAllowed(st=S){
  if (ADMIN.on || !st.kpId) return true;
  const me=meId(); if (!me) return false;
  return st.authorId ? st.authorId===me : st.managerId===me;
}

// данные конструктора для расчёта
function dealKpInputs(st=S){
  const e=kpEconomics(st), P=st.pricing||{}, r=e.cur==='RUB'?1:dNum(P.rates&&P.rates[e.cur]);
  return { sumRub: r>0 ? e.sum/100*r : 0, sumNoRate: !(r>0), cur:e.cur, vat:+st.vat||0, rates:{...(P.rates||{})}, costNoVat:!!P.costNoVat,
    items:(st.items||[]).filter(x=>String(x.name||'').trim()||x.cost).map(x=>({id:x.id, name:x.name, qty:+x.qty||0, cost:(x.cost||0)/100, cur:x.costCur||'RUB'})) };
}

function dealEnsure(){
  if (S.deal && S.deal.v) return S.deal;
  const d=dealBlank(dealDefaults()), its=(S.items||[]).filter(x=>x.cost), curs=its.map(x=>x.costCur||'RUB');
  const main=curs.find(c=>c!=='RUB'); d.sup[0].vatIn = its.length>0 && !main;          // все закупки в рублях — скорее всего российский поставщик с НДС
  if (main){ d.sup[0].log.cur=main; d.sup[0].cus.cur=main; }
  S.deal=d; return d;
}

function dealExample(){
  const d=dealBlank({adv:'20',prod:'40',ship:'40',defer:'30',money:'2',cAdv:'0'});
  Object.assign(d.sup[0],{name:'Поставщик из Китая', extra:{v:'196000',cur:'CNY'}, log:{v:'13500',cur:'CNY'}, cus:{v:'48000',cur:'CNY'}, vi:''});
  d.mnt='100000'; d.oth='0'; d.vo='0';
  return { kp:{sumRub:4356000, vat:22, rates:{CNY:'12,4'}, costNoVat:false, items:[]}, deal:d };
}

const dlKp = () => DL.ex ? DL.exKp : dealKpInputs();
const dlDeal = () => DL.ex ? DL.exDeal : dealEnsure();

function dlGet(d, path){ return path.split('.').reduce((o,k)=>o==null?o:o[k], d); }

function dlSet(d, path, v){ const ks=path.split('.'), last=ks.pop(); let o=d; for (const k of ks){ if (o[k]==null) o[k]={}; o=o[k]; } o[last]=v; }

const dlRub = n => n==null||!Number.isFinite(n) ? '—' : n.toLocaleString('ru-RU',{minimumFractionDigits:2, maximumFractionDigits:2})+' ₽';

const dlRub0 = n => n==null||!Number.isFinite(n) ? '—' : Math.round(n).toLocaleString('ru-RU')+' ₽';

const dlPct = n => n==null||!Number.isFinite(n) ? 'не определена' : n.toLocaleString('ru-RU',{minimumFractionDigits:2, maximumFractionDigits:2})+' %';

const dlIn = n => n==null||!Number.isFinite(n) ? '' : String(Math.round(n*100)/100).replace('.',',');

function openDeal(){
  if (!dealAllowed()){ toast('Экономика сделки доступна автору КП и администратору'); return; }
  DL.ex=false; dealEnsure();
  let d=$('#dealdlg'); if (!d){ d=document.createElement('dialog'); d.id='dealdlg'; d.className='dealwin'; d.setAttribute('aria-label','Экономика сделки'); document.body.appendChild(d); dealBind(d); }
  d.innerHTML=''; dealRender(); if (!d.open) d.showModal();
}

// ---------- отрисовка
function dlField(label, path, o={}){
  const d=dlDeal(), c=o.calc, raw=dlGet(d,path), e=c&&c.err[path];
  let val=raw??'', badge='';
  if (o.kp!==undefined){ const own=raw!=null&&raw!==''; val= own?raw:dlIn(o.kp);
    badge = own ? `<button type="button" class="dl-badge own" data-dlx="reset" data-path="${path}" title="Вернуть значение из КП">изменено · ↺ из КП</button>`
      : `<span class="dl-badge kp">${DL.ex?'пример':(o.kpLabel||'из КП')}</span>`; }
  if (o.auto!==undefined && (raw==null||raw==='')){ val=dlIn(o.auto); badge=`<span class="dl-badge kp">${esc(o.autoLabel||'авто')}</span>`; }
  if (o.unknown && (raw==null||raw==='')) badge=`<span class="dl-badge warn">неизвестно</span>`;
  const cur = o.cur ? `<select data-dl="${o.cur}" aria-label="Валюта">${DEAL_CURS.map(k=>`<option${(dlGet(d,o.cur)||'RUB')===k?' selected':''}>${k}</option>`).join('')}</select>` : '';
  return `<label class="f dl-f${e?' bad':''}${o.wide?' wide':''}"><span>${esc(label)}${o.unit?` <i>${esc(o.unit)}</i>`:''}${badge}</span>
    <span class="dl-in${cur?' cur':''}"><input type="text" inputmode="${o.int?'numeric':'decimal'}" data-dl="${path}" value="${esc(val)}" placeholder="${esc(o.ph||'0')}" autocomplete="off"${e?' aria-invalid="true"':''}>${cur}</span>
    ${e?`<small class="dl-err">${esc(e)}</small>`:o.hint?`<small class="muted">${o.hint}</small>`:''}</label>`;
}

function dlSupCard(c, s, k){
  const d=dlDeal(), cs=c.sup[k], multi=d.sup.length>1, P=`sup.${k}`;
  const its=[...cs.items, ...cs.noCost];
  const list = DL.ex ? '' : `<div class="dl-items">${its.length?its.map(x=>`<div class="dl-item"><span><b>${esc(x.name||'Без названия')}</b>
        <small>${x.cost>0?`${esc(x.qty)} × ${dlIn(x.cost)} ${esc(x.cur)}`:'<em class="bad-t">закупка не указана</em> — <button type="button" class="lnk" data-dlx="price">указать в «Ценах»</button>'}</small></span>
        ${multi?`<select data-dlmap="${esc(x.id)}" aria-label="Поставщик позиции">${d.sup.map((z,j)=>`<option value="${esc(z.id)}"${z.id===s.id?' selected':''}>${esc(c.sup[j].name)}</option>`).join('')}</select>`:''}</div>`).join('')
      : `<p class="muted">${multi?'Позиции КП не отнесены к этому поставщику — выберите поставщика у позиции в другой карточке.':'В КП нет позиций с закупкой.'}</p>`}</div>`;
  const byCur=Object.entries(cs.byCur).map(([cur,a])=>`${dlIn(a).replace(/\B(?=(\d{3})+(?!\d))/g,' ')} ${cur}`).join(' + ');
  return `<section class="dl-card">
    <div class="dl-ch">${multi||d.sup[k].name?`<input type="text" class="dl-name" data-dl="${P}.name" value="${esc(s.name||'')}" placeholder="Поставщик ${k+1}" aria-label="Название поставщика">`:`<b>Поставщик и оборудование</b>`}
      ${multi?`<button type="button" class="icon" data-dlx="delsup" data-k="${k}" aria-label="Убрать поставщика" title="Убрать поставщика: его позиции перейдут к первому">✕</button>`:''}</div>
    ${list}
    <div class="dl-sum"><span>Оборудование${byCur?` (${byCur})`:''}</span><b>${dlRub(cs.equip)}</b></div>
    <div class="dl-g">${dlField('Прочая закупка у поставщика', P+'.extra.v', {calc:c, cur:P+'.extra.cur', hint:'Опции и то, чего нет в позициях КП'})}
      ${dlField('Логистика целиком', P+'.log.v', {calc:c, cur:P+'.log.cur'})}
      ${dlField('Растаможка целиком, с НДС', P+'.cus.v', {calc:c, cur:P+'.cus.cur'})}
      ${dlField('Ввозной НДС к вычету', P+'.vi', {calc:c, unit:'₽', ph:cs.T?'Сумма по таможенной декларации':'0', unknown:cs.T>0, hint:cs.T?'Пусто — сумма неизвестна (не ноль). Нет права на вычет — 0.':''})}</div>
    <label class="sw-l"><button class="sw" type="button" role="switch" aria-checked="${!!s.vatIn}" data-dlx="vatin" data-k="${k}"><i></i>Поставщик с НДС (российский)</button></label>
    ${s.vatIn?`<div class="dl-g">${dlField('НДС поставщика к вычету', P+'.vo', {calc:c, unit:'₽', auto:cs.suggest, autoLabel:`авто ${c.v}/${100+c.v}`, hint:'Подсказка — НДС в стоимости оборудования. Проверьте по счёту-фактуре.'})}</div>`:''}
    <div class="dl-g g3">${dlField('Аванс поставщику', P+'.adv', {calc:c, unit:'%'})}${dlField('Изготовление', P+'.prod', {calc:c, unit:'дней', int:true})}${dlField('Доставка', P+'.ship', {calc:c, unit:'дней', int:true})}</div>
  </section>`;
}

function dlResult(c){
  const b=c.base, lo=c.lo, hi=c.hi, unk=c.unknown.length>0, bad=!c.ok || c.warn.some(w=>w.bad);
  const chip = bad ? '<span class="dl-chip bad">Проверьте данные</span>' : unk ? '<span class="dl-chip warn">Нужна сумма ввозного НДС</span>' : '<span class="dl-chip ok">Все данные указаны</span>';
  const rng=(f,fmt)=>unk ? `<span class="dl-rng">${fmt(f(lo))} … ${fmt(f(hi))}</span>` : fmt(f(b));
  const P = unk ? null : b.P;
  return `<div class="dl-res">${chip}
    <div class="dl-big${P!=null&&P<0?' neg':''}${unk?' rng':''}"><small>Прибыль после финансирования, до налога на прибыль</small><b>${unk?`от ${dlRub0(lo.P)} до ${dlRub0(hi.P)}`:dlRub(P)}</b>
      ${unk?`<p class="dl-note">Без ввозного НДС — нижняя граница; если вся растаможка — НДС к вычету, верхняя. Укажите сумму из декларации.</p>`:''}</div>
    <div class="dl-kpi"><div><small>Наценка</small><b>${rng(x=>x.markup,dlPct)}</b><span>от себестоимости</span></div><div><small>Маржинальность</small><b>${rng(x=>x.margin,dlPct)}</b><span>от выручки без НДС</span></div></div>
    <dl class="dl-dl">
      <dt>Выручка без НДС</dt><dd>${dlRub(c.R)}</dd>
      <dt>НДС с продажи</dt><dd>${dlRub(c.VATs)}</dd>
      <dt>Прямые платежи</dt><dd>${dlRub(c.Ccash)}</dd>
      <dt>Финансирование</dt><dd>${dlRub(c.F)}</dd>
      <dt>НДС к вычету</dt><dd>${unk?rng(x=>x.VATin,dlRub0):dlRub(b.VATin)}</dd>
      <dt>Себестоимость с финансированием</dt><dd>${unk?rng(x=>x.Ctot,dlRub0):dlRub(b.Ctot)}</dd>
      <dt>НДС к доплате</dt><dd>${unk?rng(x=>x.payable,dlRub0):dlRub(b.payable)}</dd>
      ${!unk&&b.excess>0?`<dt>Превышение вычетов</dt><dd>${dlRub(b.excess)}</dd>`:''}
      <dt>Остаток до расчётов по НДС</dt><dd>${dlRub(c.cashBefore)}</dd>
      <dt>Остаток после доплаты НДС</dt><dd>${unk?rng(x=>x.cashAfter,dlRub0):dlRub(b.cashAfter)}</dd></dl>
    ${c.warn.length?`<ul class="dl-warn">${c.warn.map(w=>`<li class="${w.bad?'bad':''}">${esc(w.t)}${w.go?` <button type="button" class="lnk" data-dlx="price">в «Цены»</button>`:''}</li>`).join('')}</ul>`:''}
    ${!unk&&b.excess>0?'<p class="dl-note">Превышение вычетов не добавляется в денежный остаток как автоматический возврат.</p>':''}
  </div>`;
}

function dlSchedule(c){
  const d=dlDeal();
  return `<section class="dl-card dl-sched"><div class="dl-ch"><b>График платежей · ${c.Tend} ${plural(c.Tend,'день','дня','дней')}</b>${Object.keys(d.days||{}).length?'<button type="button" class="btn ghost" data-dlx="resetdays">↺ Даты по срокам</button>':''}</div>
    <div class="dl-tw"><table class="dl-t"><thead><tr><th>День</th><th>Событие</th><th class="num">Платёж</th><th class="num">Остаток денег</th><th class="num">Финансирование</th></tr></thead><tbody>
    ${c.rows.map(r=>`<tr class="${r.inflow?'in':''}${r.manual?' man':''}"><td class="c-day"><input type="text" inputmode="numeric" class="dl-day" data-dl="days.${r.key}" value="${r.day}" aria-label="День: ${esc(r.label)}" title="${r.manual?'Дата изменена вручную':'По срокам — можно изменить'}"></td>
      <td class="c-ev">${esc(r.label)}</td><td class="num c-pay">${r.inflow?'+':'−'}${dlRub0(Math.abs(r.amount))}</td><td class="num c-bal ${r.balance<0?'neg':''}">${dlRub0(r.balance)}</td><td class="num c-fin">${r.fin?dlRub0(r.fin)+`<small>${r.days} дн.</small>`:'—'}</td></tr>`).join('')}
    </tbody><tfoot><tr><td class="c-day"></td><td class="c-ev">Стоимость финансирования</td><td class="c-pay"></td><td class="c-bal"></td><td class="num c-fin"><b>${dlRub(c.F)}</b></td></tr></tfoot></table></div>
    <p class="muted">Простой процент на недостающие деньги до последней оплаты заказчика, месяц — 30 дней; аванс заказчика уменьшает финансирование, доход на свободный остаток не начисляется. День строки можно изменить.</p></section>`;
}

function dealRender(){
  const dlg=$('#dealdlg'); if (!dlg) return;
  const d=dlDeal(), kp=dlKp(), c=dealCalc(kp,d);
  const rates=c.used.map(cur=>dlField(`Курс, ₽ за 1 ${cur}`, 'rates.'+cur, {calc:c, kp:dNum(kp.rates[cur]), kpLabel:'курс КП'})).join('');
  const head=`<div class="dlg-h"><h3>Экономика сделки${!DL.ex&&S.number?` · КП № ${esc(S.number)}`:''}<small>${DL.ex?'Учебный пример из методики':esc(S.client||'Получатель не указан')}</small></h3>
      <button class="btn" type="button" data-dlx="xlsx">Выгрузить в Excel</button><button class="icon" type="button" data-dlx="close" aria-label="Закрыть">✕</button></div>`;
  const banner = DL.ex ? `<div class="dl-ex">Учебный пример: 196 000 CNY по курсу 12,4, растаможка 48 000 CNY. Данные сделки не меняются. <button class="btn" type="button" data-dlx="exit">Вернуться к сделке</button></div>`
    : kp.sumNoRate ? `<div class="dl-ex warn">Нет курса валюты КП (${esc(kp.cur)}) — цена для заказчика не переведена в рубли. Укажите курс в разделе «Цены» или цену здесь.</div>` : '';
  const b=c.base, mini = b ? `<span><small>Прибыль после финансирования</small><b class="${b.P<0?'neg':''}">${dlRub0(b.P)}</b></span><span class="r"><small>Маржинальность</small><b>${dlPct(b.margin)}</b></span>`
    : `<span><small>Прибыль после финансирования</small><b>${dlRub0(c.lo.P)} … ${dlRub0(c.hi.P)}</b></span><span class="r warn-t">нужен ввозной НДС</span>`;
  morph(dlg, `${head}${banner}<div class="dl-mini">${mini}</div><div class="dl-b"><div class="dl-form">
    <section class="dl-card"><div class="dl-ch"><b>Цена и НДС</b></div><div class="dl-g">
      ${dlField('Цена для заказчика с НДС', 'over.price', {calc:c, unit:'₽', kp:kp.sumRub})}${dlField('НДС при продаже', 'over.vat', {calc:c, unit:'%', kp:kp.vat})}${rates}</div></section>
    ${d.sup.map((s,k)=>dlSupCard(c,s,k)).join('')}
    ${DL.ex?'':`<button type="button" class="btn dl-add" data-dlx="addsup">+ Поставщик <span class="muted">— свои аванс, сроки, логистика</span></button>`}
    <section class="dl-card"><div class="dl-ch"><b>Монтаж и прочее</b></div><div class="dl-g g3">
      ${dlField('Монтаж и ПНР', 'mnt', {calc:c, unit:'₽', hint:'Платёж — при доставке'})}${dlField('Прочие расходы', 'oth', {calc:c, unit:'₽'})}${dlField('Прочий НДС к вычету', 'vo', {calc:c, unit:'₽', hint:'В составе логистики, монтажа и прочих'})}</div></section>
    <section class="dl-card"><div class="dl-ch"><b>Заказчик и финансирование</b></div><div class="dl-g g4">
      ${dlField('Аванс заказчика', 'cust.adv', {calc:c, unit:'%'})}${dlField('День аванса', 'cust.day', {calc:c, int:true, hint:'0 — при заказе'})}
      ${dlField('Отсрочка оплаты', 'cust.defer', {calc:c, unit:'дней', int:true, hint:'После доставки'})}${dlField('Стоимость денег', 'money', {calc:c, unit:'% в мес.'})}</div></section>
    ${dlSchedule(c)}
    <div class="dl-foot">${DL.ex?'':'<button class="btn ghost" type="button" data-dlx="example">Учебный пример НДС</button>'}<span class="muted">Расчёт не попадает в КП. Пересчёт — сразу при вводе.</span></div>
  </div><aside class="dl-side">${dlResult(c)}</aside></div>`);
}

// ---------- события окна
function dealBind(dlg){
  const touch=()=>{ if (DL.ex) return; S.deal.touched=true; persist(); renderSide(); };
  dlg.addEventListener('input', e=>{ const t=e.target, p=t.dataset.dl; if (!p) return;
    dlSet(dlDeal(), p, t.value); if (!DL.ex) dealRememberDefault(p, t.value); touch(); dealRender(); });
  dlg.addEventListener('change', e=>{ const t=e.target;
    if (t.dataset.dl && t.tagName==='SELECT'){ dlSet(dlDeal(), t.dataset.dl, t.value); touch(); dealRender(); }
    if (t.dataset.dlmap){ const d=dlDeal(); d.map={...(d.map||{}), [t.dataset.dlmap]:t.value}; touch(); dealRender(); } });
  dlg.addEventListener('click', e=>{ const b=e.target.closest('[data-dlx]'); if (!b) return; const d=dlDeal(), a=b.dataset.dlx, k=+b.dataset.k;
    if (a==='close') return dlg.close();
    if (a==='price'){ dlg.close(); return goStep('price'); }
    if (a==='xlsx') return dealXlsx();
    if (a==='example'){ const x=dealExample(); Object.assign(DL,{ex:true, exKp:x.kp, exDeal:x.deal}); return dealRender(); }
    if (a==='exit'){ DL.ex=false; return dealRender(); }
    if (a==='reset'){ dlSet(d, b.dataset.path, ''); }
    if (a==='resetdays') d.days={};
    if (a==='vatin') d.sup[k].vatIn=!d.sup[k].vatIn;
    if (a==='addsup'){ const def=dealDefaults(), n=dealNewSupplier('s'+Date.now().toString(36), def); n.name='Поставщик '+(d.sup.length+1); d.sup.push(n); }
    if (a==='delsup'){ const id=d.sup[k].id; d.sup.splice(k,1); for (const x in d.map) if (d.map[x]===id) delete d.map[x]; }
    touch(); dealRender(); });
}

// ---------- выгрузка в Excel: исходные данные (жёлтые ячейки), результат формулами, график платежей
async function dealXlsx(){
  const d=dlDeal(), kp=dlKp(), c=dealCalc(kp,d), R=[], G=[];
  const SH1='Расчёт', SH2='График платежей', q=n=>`'${n}'!`;
  const at={}, row=(cells, key)=>{ R.push(cells); if (key) at[key]=R.length; return R.length; };
  const ref=(key,col='B')=>col+at[key];
  const num=v=>Number.isFinite(v)?v:0;
  row([{v:'Экономика сделки', s:'title'}]);
  row([{v: DL.ex ? 'Учебный пример из методики' : [S.number?'КП № '+S.number:'КП без номера', S.client||'', 'расчёт от '+new Date().toLocaleDateString('ru-RU'), S.manager&&S.manager.name?'автор: '+S.manager.name:''].filter(Boolean).join(' · '), s:'note'}]);
  row([]);
  row([{v:'Исходные данные', s:'head'},{v:'Значение',s:'head'},{v:'Ед.',s:'head'},{v:'В рублях',s:'head'},{v:'Примечание',s:'head'}]);
  row(['Цена для заказчика с НДС', {v:c.S, s:'inpMoney'}, '₽', {f:'B'+(R.length+1), v:c.S}], 'S');
  row(['НДС при продаже', {v:c.v, s:'inp'}, '%'], 'v');
  for (const cur of c.used) row([`Курс рубля за 1 ${cur}`, {v:num(c.rate(cur)), s:'inp'}, '₽'], 'rate_'+cur);
  const rub=(key, cur)=> cur==='RUB' ? ref(key) : `${ref(key)}*${ref('rate_'+cur)}`;
  const pairs=[]; // строки «сумма в валюте → в рублях»
  c.sup.forEach((s,k)=>{ const ds=d.sup[k];
    row([{v:'Поставщик: '+s.name, s:'bold'}]);
    const eqKeys=[];
    Object.entries(s.byCur).forEach(([cur,a])=>{ const key=`eq${k}_${cur}`; const r=row([`Оборудование, ${cur}`, {v:a, s:'inpMoney'}, cur], key);
      R[r-1][3]={f:rub(key,cur)+(kp.costNoVat&&s.items.length?`*(1+${ref('v')}/100)`:''), v:a*num(c.rate(cur))*(kp.costNoVat&&s.items.length?1+c.v/100:1), s:'money'}; eqKeys.push(key); });
    row(['Оборудование, итого', '', '', {f: eqKeys.length?eqKeys.map(x=>ref(x,'D')).join('+'):'0', v:s.equip, s:'moneyB'},
      kp.costNoVat?{v:'Закупка в КП без НДС — к рублёвой сумме добавлен НДС', s:'note'}:''], `EQ${k}`);
    for (const [nm,key,o] of [['Логистика целиком','L'+k,ds.log],['Растаможка целиком, с НДС','T'+k,ds.cus]]){
      const cur=(o&&o.cur)||'RUB', a=dNum(o&&o.v)||0; const r=row([nm, {v:a, s:'inpMoney'}, cur], key); R[r-1][3]={f:rub(key,cur), v:a*num(c.rate(cur)), s:'money'}; }
    row(['Аванс поставщику', {v:s.adv, s:'inp'}, '%'], 'adv'+k);
    row(['Изготовление', {v:s.prod, s:'inpInt'}, 'дней'], 'prod'+k);
    row(['Доставка', {v:s.ship, s:'inpInt'}, 'дней'], 'ship'+k);
    row(['Ввозной НДС к вычету', s.vi==null?{v:'', s:'inpMoney'}:{v:s.vi, s:'inpMoney'}, '₽', {f:'B'+(R.length+1), v:s.vi||0}, s.vi==null?{v:'Не указан: в файле считается 0 — прибыль минимальная. Уточните по декларации.', s:'note'}:''], 'vi'+k);
    if (ds.vatIn) row(['НДС поставщика к вычету', s.voAuto?{f:`${ref('EQ'+k,'D')}*${ref('v')}/(100+${ref('v')})`, v:s.vo, s:'inpMoney'}:{v:s.vo, s:'inpMoney'}, '₽', {f:'B'+(R.length+1), v:s.vo}, s.voAuto?{v:'Подсказка: НДС в стоимости оборудования', s:'note'}:''], 'vo'+k);
    pairs.push(k); });
  row([{v:'Монтаж, прочее, заказчик', s:'bold'}]);
  row(['Монтаж и ПНР', {v:c.M, s:'inpMoney'}, '₽', {f:'B'+(R.length+1), v:c.M}], 'M');
  row(['Прочие расходы', {v:c.E, s:'inpMoney'}, '₽', {f:'B'+(R.length+1), v:c.E}], 'E');
  row(['Прочий НДС к вычету', {v:c.Vo, s:'inpMoney'}, '₽', {f:'B'+(R.length+1), v:c.Vo}], 'Vo');
  row(['Аванс заказчика', {v:c.cAdv, s:'inp'}, '%'], 'cAdv');
  row(['Стоимость денег', {v:c.i, s:'inp'}, '% в месяц'], 'i');
  // график (на втором листе): строки по дням
  const gHead=4, gFirst=gHead+1, gLast=gHead+c.rows.length, gTot=gLast+1;
  const supK=id=>c.sup.findIndex(s=>s.id===id);
  const amountF=r=>{ const [kind,id]=r.key.split(':'), k=supK(id), EQ=k>=0?q(SH1)+ref('EQ'+k,'D'):'';
    if (kind==='adv') return `-${EQ}*${q(SH1)}${ref('adv'+k)}/100`;
    if (kind==='rest') return `-(${EQ}-${EQ}*${q(SH1)}${ref('adv'+k)}/100+${q(SH1)}${ref('L'+k,'D')}+${q(SH1)}${ref('T'+k,'D')})`;
    if (kind==='mnt') return `-(${q(SH1)}${ref('M','D')}+${q(SH1)}${ref('E','D')})`;
    if (kind==='cadv') return `${q(SH1)}${ref('S','D')}*${q(SH1)}${ref('cAdv')}/100`;
    return `${q(SH1)}${ref('S','D')}-${q(SH1)}${ref('S','D')}*${q(SH1)}${ref('cAdv')}/100`; };
  const inRows=c.rows.map((r,k)=>r.inflow?'A'+(gFirst+k):null).filter(Boolean);
  G.push([{v:'График платежей', s:'title'}]);
  G.push(['Последняя оплата заказчика, день', {f:`MAX(${inRows.join(',')})`, v:c.Tend, s:'int'}]);
  G.push([{v:'Дни можно менять, сохраняя порядок строк по возрастанию дня. Платёж: минус — расход, плюс — поступление.', s:'note'}]);
  G.push([{v:'День',s:'head'},{v:'Событие',s:'head'},{v:'Платёж, ₽',s:'head'},{v:'Остаток денег, ₽',s:'head'},{v:'Дней финансирования',s:'head'},{v:'Финансирование, ₽',s:'head'}]);
  c.rows.forEach((r,k)=>{ const n=gFirst+k;
    G.push([{v:r.day, s:'inpInt'}, r.label, {f:amountF(r), v:r.amount, s:'money'}, {f:k?`D${n-1}+C${n}`:`C${n}`, v:r.balance, s:'money'},
      {f:k<c.rows.length-1?`MAX(0,MIN(A${n+1},$B$2)-A${n})`:'0', v:r.days, s:'int'}, {f:`MAX(0,-D${n})*E${n}*${q(SH1)}${ref('i')}/100/30`, v:r.fin, s:'money'}]); });
  G.push(['', {v:'Стоимость финансирования', s:'bold'}, '', '', '', {f:`SUM(F${gFirst}:F${gLast})`, v:c.F, s:'moneyB'}]);
  // результат
  row([]);
  row([{v:'Результат', s:'head'},{v:'Значение',s:'head'},{v:'',s:'head'},{v:'',s:'head'},{v:'Формула',s:'head'}]);
  const D=k=>ref(k,'D'), sumOf=p=>c.sup.map((s,k)=>D(p+k)).join('+')||'0';
  const vatIn=[...c.sup.map((s,k)=>D('vi'+k)), ...c.sup.map((s,k)=>d.sup[k].vatIn?D('vo'+k):null).filter(Boolean), D('Vo')].join('+');
  const b=c.base||c.lo;
  row(['Выручка без НДС', {f:`${D('S')}/(1+${ref('v')}/100)`, v:c.R, s:'money'}, '', '', {v:'R = S / (1 + НДС / 100)', s:'note'}], 'R');
  row(['НДС с продажи', {f:`${D('S')}-${ref('R')}`, v:c.VATs, s:'money'}, '', '', {v:'S − R', s:'note'}], 'VATs');
  row(['Прямые платежи', {f:`${sumOf('EQ')}+${sumOf('L')}+${sumOf('T')}+${D('M')}+${D('E')}`, v:c.Ccash, s:'money'}, '', '', {v:'Оборудование + логистика + растаможка + монтаж + прочее', s:'note'}], 'C');
  row(['Финансирование', {f:`${q(SH2)}F${gTot}`, v:c.F, s:'money'}, '', '', {v:'Лист «График платежей»', s:'note'}], 'F');
  row(['НДС к вычету', {f:vatIn, v:b.VATin, s:'money'}, '', '', {v:'Ввозной + НДС поставщиков + прочий', s:'note'}], 'VI');
  row(['Себестоимость с финансированием', {f:`${ref('C')}-${ref('VI')}+${ref('F')}`, v:b.Ctot, s:'money'}, '', '', {v:'Прямые платежи − НДС к вычету + финансирование', s:'note'}], 'CT');
  row([{v:'Прибыль до налога на прибыль', s:'bold'}, {f:`${ref('R')}-${ref('CT')}`, v:b.P, s:'moneyB'}, '', '', c.unknown.length?{v:'Ввозной НДС не указан — прибыль минимальная', s:'note'}:''], 'P');
  row(['Наценка', {f:`IF(${ref('CT')}=0,"",${ref('P')}/${ref('CT')})`, v:b.markup==null?undefined:b.markup/100, s:'pctB'}, '', '', {v:'Прибыль / себестоимость', s:'note'}]);
  row(['Маржинальность', {f:`IF(${ref('R')}=0,"",${ref('P')}/${ref('R')})`, v:b.margin==null?undefined:b.margin/100, s:'pctB'}, '', '', {v:'Прибыль / выручка без НДС', s:'note'}]);
  row(['НДС к доплате', {f:`MAX(${ref('VATs')}-${ref('VI')},0)`, v:b.payable, s:'money'}], 'PAY');
  row(['Превышение вычетов', {f:`MAX(${ref('VI')}-${ref('VATs')},0)`, v:b.excess, s:'money'}, '', '', {v:'Не добавляется в остаток как возврат', s:'note'}]);
  row(['Денежный остаток до расчётов по НДС', {f:`${D('S')}-${ref('C')}-${ref('F')}`, v:c.cashBefore, s:'money'}], 'CB');
  row(['Денежный остаток после доплаты НДС', {f:`${ref('CB')}-${ref('PAY')}`, v:b.cashAfter, s:'money'}]);
  const blob=await makeXlsx([{name:SH1, cols:[42,18,12,18,52], rows:R}, {name:SH2, cols:[10,46,18,18,14,18], rows:G}], 'Экономика сделки');
  const safe=s=>String(s||'').replace(/[\\/:*?"<>|«»]+/g,'').replace(/\s+/g,'_').slice(0,60);
  saveFileA(DL.ex ? 'Экономика_сделки_пример.xlsx' : `Экономика_КП_${safe(S.number||'черновик')}${S.client?'_'+safe(S.client):''}.xlsx`, blob);
  toast('Расчёт выгружен в Excel');
}

// краткий итог для правой панели и журнала (только если расчёт заполнен)
function dealSummary(st=S){
  if (!st.deal || !st.deal.touched) return null;
  const c=dealCalc(dealKpInputs(st), st.deal), b=c.base;
  return b ? { confirmed:true, profit:Math.round(b.P*100)/100, margin:b.margin, markup:b.markup }
    : { confirmed:false, lo:Math.round(c.lo.P), hi:Math.round(c.hi.P), marginLo:c.lo.margin, marginHi:c.hi.margin };
}
