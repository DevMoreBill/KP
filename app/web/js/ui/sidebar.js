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
  const mt=$('#mtotal'); if(mt) mt.textContent=money(t.sum)+' '+cs;
  const withCost=S.items.filter(x=>x.cost && costKP(x)>0);
  const costSum=withCost.reduce((s,x)=>s+costKP(x)*(+x.qty||0),0), saleSum=withCost.reduce((s,x)=>s+KPGen.netPrice(x)*(+x.qty||0),0);
  const mBlock = withCost.length ? `<div class="mrg"><div class="lab">Для внутреннего расчёта — в КП не выводится</div><dl>
     <dt>Закупка${withCost.length<S.items.length?` (${withCost.length} из ${S.items.length} поз.)`:''}</dt><dd>${money(Math.round(costSum))} ${cs}</dd>
     <dt>Продажа тех же позиций${withCost.some(x=>KPGen.unitDisc(x))?' (со скидкой)':''}</dt><dd>${money(saleSum)} ${cs}</dd>
     <dt>Прибыль</dt><dd>${money(Math.round(saleSum-costSum))} ${cs}</dd>
     <dt>Маржа / наценка</dt><dd>${saleSum?((saleSum-costSum)/saleSum*100).toFixed(1).replace('.',','):'—'} % / ${costSum?((saleSum-costSum)/costSum*100).toFixed(1).replace('.',','):'—'} %</dd></dl></div>` : '';
  const rubEq = kpCur()!=='RUB' && rateOf(kpCur())>0 ? `<dt>В рублях по курсу</dt><dd>${money(Math.round(t.sum*rateOf(kpCur())))}</dd>` : '';
  const kn=$('#kpno'); if(kn) kn.textContent = S.number ? 'КП № '+S.number : '';
  $('#side').innerHTML = `<div class="total"><div class="lab">Итого к оплате с НДС</div>
    <div class="big">${money(t.sum)} <small>${cs}</small></div>
    <dl>${t.discount?`<dt>Без скидки</dt><dd>${money(t.gross)}</dd><dt>Скидка для заказчика</dt><dd>−${money(t.discount)}</dd>`:''}<dt>в т. ч. НДС ${esc(S.vat)} %</dt><dd>${money(t.vat)}</dd>${rubEq}<dt>Позиций</dt><dd>${S.items.length}</dd><dt>Единиц оборудования</dt><dd>${t.units}</dd></dl>
    <div class="words">${t.sum?esc(words(t.sum).replace(/^./,c=>c.toUpperCase())):'Сумма прописью появится после ввода цен.'}</div></div>${mBlock}
    <div class="checks"><h3>${pr.length?'Осталось заполнить':'Всё готово'}</h3><ul>${pr.length?pr.map(x=>`<li><button type="button" data-go="${x[1]}">${esc(x[0])}</button></li>`).join(''):'<li class="ok">Проверки пройдены — можно скачивать.</li>'}</ul>
    ${TEMPLATES.length>1?`<div class="tplside">Шаблон: <b>${esc((curTemplate()||{}).name||'—')}</b> <button type="button" data-go="st-cover">сменить</button></div>`:''}
    <button class="btn primary dl" type="button" data-a="download" ${pr.length?'disabled':''}>${S.kpId?'Сохранить изменения КП № '+esc(S.number):'Сохранить КП'}</button>
    <div class="fname">${!S.kpId?'Номер присвоится при сохранении':esc(fileName())}</div><div class="msg" id="dlmsg"></div></div>`;
}

function updateLive(){
  S.items.forEach((x,i)=>{ const el=document.querySelector(`[data-sum="${i}"]`); if(el) el.textContent=money(itemSum(x));
    (x.options||[]).forEach((o,j)=>{ const e2=document.querySelector(`[data-osum="${i}.${j}"]`); if(e2) e2.textContent=o.price?money((+o.qty||0)*o.price):'—'; }); });
  renderSide(); persist();
}
