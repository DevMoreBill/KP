// Правая панель: итог, проверка заполнения, кнопка сохранения.
'use strict';

function problems(){
  const p=[];
  if (!S.client.trim()) p.push(['Укажите получателя','st-client']);
  if (!S.date) p.push(['Укажите дату','st-client']);
  if (S.clientInn && !validInn(S.clientInn)) p.push(['ИНН получателя указан с ошибкой','st-client']);
  if (!S.items.length) p.push(['Добавьте хотя бы одну позицию','st-items']);
  S.items.forEach((x,i)=>{
    if (!x.name.trim()) p.push([`Позиция ${i+1}: нет наименования`,'item-'+x.id]);
    if (!(Number.isInteger(+x.qty) && +x.qty>=1)) p.push([`Позиция ${i+1}: количество — целое число от 1`,'item-'+x.id]);
    if (!x.price || Number.isNaN(parsePrice(x._priceText ?? fmtPrice(x.price)))) p.push([`Позиция ${i+1}: укажите цену`,'prow-'+x.id]);
    if (x._discBad) p.push([`Позиция ${i+1}: скидка — ${discType(x)==='sum'?'сумма не больше цены за единицу':'процент от 0 до 99,99'}`,'prow-'+x.id]);
    (x.options||[]).forEach((o,j)=>{ if(!o.name.trim()) return;
      if (!(Number.isInteger(+o.qty)&&+o.qty>=1)) p.push([`Позиция ${i+1}, опция «${o.short||o.name}»: количество`,'item-'+x.id]);
      if (Number.isNaN(parsePrice(o._priceText ?? ''))) p.push([`Позиция ${i+1}, опция «${o.short||o.name}»: цена`,'item-'+x.id]); });
  });
  if (!S.cover.model.trim() && stationsOf().length<2) p.push(['Титул: укажите модель или серию','st-cover']);
  const v=+S.vat; if (!(v>=0 && v<=50)) p.push(['Проверьте ставку НДС','st-conds']);
  const needR=new Set([kpCur(),...S.items.filter(x=>x.cost).map(x=>x.costCur||'RUB')].filter(c=>c!=='RUB'));
  for (const c of needR) if (!(rateOf(c)>0)) p.push([`Укажите курс ${c}`,'st-price']);
  if (!S.manager.name.trim() || !S.manager.phone.trim()) p.push(['Контакты: ФИО и телефон','st-manager']);
  return p;
}

function renderSide(){
  const t = totalsS();
  const pr = problems();
  const cs=curSh(kpCur());
  const ec=kpEconomics(), pc=v=>v==null?'—':v.toFixed(1).replace('.',',');
  // экономика — только автору КП и администратору; заполнен расчёт сделки — его итог, иначе простая маржа по закупке
  const ds=dealAllowed()?dealSummary():null, pc2=v=>v==null?'—':v.toFixed(2).replace('.',',');
  const mBlock = !dealAllowed() ? '' : ds ? `<div class="mrg"><div class="lab">Экономика сделки — в КП не выводится</div><dl>
     ${ds.confirmed?`<dt>Прибыль после финансирования</dt><dd class="${ds.profit<0?'bad-t':''}">${money(Math.round(ds.profit*100))} руб.</dd><dt>Маржинальность / наценка</dt><dd>${pc2(ds.margin)} % / ${pc2(ds.markup)} %</dd>`
       :`<dt>Прибыль</dt><dd>от ${money(ds.lo*100)} до ${money(ds.hi*100)} руб.</dd><dt class="warn-t">Нужна сумма ввозного НДС</dt><dd></dd>`}</dl>
     <button class="btn dl-open" type="button" data-a="deal">Экономика сделки →</button></div>`
   : `<div class="mrg"><div class="lab">Для внутреннего расчёта — в КП не выводится</div>${ec.withCost?`<dl>
     <dt>Закупка${ec.withCost<ec.positions?` (${ec.withCost} из ${ec.positions} поз.)`:''}</dt><dd>${money(ec.cost)} ${cs}</dd>
     <dt>Продажа тех же позиций${ec.discount?' (со скидкой)':''}</dt><dd>${money(ec.sale)} ${cs}</dd>
     <dt>Прибыль</dt><dd>${money(ec.profit)} ${cs}</dd>
     <dt>Маржа / наценка</dt><dd>${pc(ec.margin)} % / ${pc(ec.markup)} %</dd></dl><p class="muted mrg-n">Без логистики, растаможки и финансирования</p>`:''}
     <button class="btn dl-open" type="button" data-a="deal">Рассчитать экономику сделки →</button></div>`;
  const rubEq = kpCur()!=='RUB' && rateOf(kpCur())>0 ? `<dt>В рублях по курсу</dt><dd>${money(Math.round(t.sum*rateOf(kpCur())))}</dd>` : '';
  const kn=$('#kpno'); if(kn) kn.textContent = S.number ? 'КП № '+S.number : '';
  renderMbar(t, pr, cs);
  morph($('#side'), `<h2 class="side-h">Итог и сохранение</h2><div class="total"><div class="lab">Итого к оплате с НДС</div>
    <div class="big">${money(t.sum)} <small>${cs}</small></div>
    <dl>${t.discount?`<dt>Без скидки</dt><dd>${money(t.gross)}</dd><dt>Скидка для заказчика</dt><dd>−${money(t.discount)}</dd>`:''}<dt>в т. ч. НДС ${esc(S.vat)} %</dt><dd>${money(t.vat)}</dd>${rubEq}<dt>Позиций</dt><dd>${S.items.length}</dd><dt>Единиц оборудования</dt><dd>${t.units}</dd></dl>
    <div class="words">${t.sum?esc(words(t.sum).replace(/^./,c=>c.toUpperCase())):'Сумма прописью появится после ввода цен.'}</div></div>${mBlock}
    <div class="checks"><h3>${pr.length?'Осталось заполнить':'Всё готово'}</h3><ul>${pr.length?pr.map(x=>`<li><button type="button" data-go="${x[1]}">${esc(x[0])}</button></li>`).join(''):'<li class="ok">Проверки пройдены — можно скачивать.</li>'}</ul>
    ${TEMPLATES.length>1?`<div class="tplside">Шаблон: <b>${esc((curTemplate()||{}).name||'—')}</b> <button type="button" data-go="st-cover">сменить</button></div>`:''}
    <button class="btn dl pv" type="button" data-a="kpPreview" ${S.items.length?'':'disabled'}>Предпросмотр КП</button>
    <button class="btn primary dl" type="button" data-a="download" ${pr.length?'disabled':''}>${S.kpId?'Сохранить изменения КП № '+esc(S.number):'Сохранить КП'}</button>
    <label class="pdftoo"><input type="checkbox" id="pdfToo" ${pdfWanted()?'checked':''}> Также сохранить в PDF</label>
    <div class="fname">${!S.kpId?'Номер присвоится при сохранении':esc(fileName())}</div><div class="msg" id="dlmsg"></div></div>`);
}

// нижняя панель телефона: назад, итог (переход к сохранению), далее; на последнем шаге — «Сохранить КП»
function renderMbar(t, pr, cs){
  const m=$('#mbar'); if (!m) return;
  const k=STEPS.findIndex(s=>s.id===STEP), prev=STEPS[k-1], next=STEPS[k+1];
  const back = prev ? `<button class="mb-back" type="button" data-step="${prev.id}" aria-label="Назад: ${esc(prev.t)}"><span aria-hidden="true">‹</span></button>` : '<span class="mb-back" aria-hidden="true"></span>';
  const sum = `<button class="mb-sum" type="button" data-a="toSave"><small>${pr.length?`Итого · не заполнено: ${pr.length}`:'Итого · всё готово'}</small><b>${money(t.sum)} ${esc(cs)}</b></button>`;
  const go = next ? `<button class="btn primary mb-next" type="button" data-step="${next.id}"><span>Далее</span><small>${esc(next.t)}</small></button>`
    : pr.length ? `<button class="btn primary mb-next" type="button" data-a="toSave"><span>Проверить</span><small>осталось ${pr.length}</small></button>`
    : `<button class="btn primary mb-next" type="button" data-a="download"><span>Сохранить</span><small>${S.kpId?'изменения КП':'КП'}</small></button>`;
  morph(m, back+sum+go);
}

function updateLive(){
  S.items.forEach((x,i)=>{ const el=document.querySelector(`[data-sum="${i}"]`); if(el) el.textContent=money(itemSum(x));
    (x.options||[]).forEach((o,j)=>{ const e2=document.querySelector(`[data-osum="${i}.${j}"]`); if(e2) e2.textContent=o.price?money((+o.qty||0)*o.price):'—'; }); });
  if (CATED) return;
  renderSide(); persist();
}
