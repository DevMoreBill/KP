// Правая панель: итог, проверка заполнения, кнопки сохранения и предпросмотра.
'use strict';

function problems(){
  const p=[];
  if (!S.client.trim()) p.push(['Укажите получателя','st-client']);
  if (!S.date) p.push(['Укажите дату','st-client']);
  if (S.clientInn && !validInn(S.clientInn)) p.push(['ИНН получателя указан с ошибкой','st-client']);
  if (tenderOn() && !tenderNo()) p.push(['Тендер: укажите № закупки','st-tender']);
  if (tenderOn() && String(S.tender.url||'').trim() && !tenderUrl()) p.push(['Тендер: ссылка должна начинаться с http:// или https://','st-tender']);
  if (!S.items.length) p.push(['Добавьте хотя бы одну позицию','st-items']);
  S.items.forEach((x,i)=>{
    if (!x.name.trim()) p.push([`Позиция ${i+1}: нет наименования`,'item-'+x.id]);
    if (!(Number.isInteger(+x.qty) && +x.qty>=1)) p.push([`Позиция ${i+1}: количество — целое число от 1`,'item-'+x.id]);
    if (!x.price || Number.isNaN(parsePrice(x._priceText ?? fmtPrice(x.price)))) p.push([`Позиция ${i+1}: укажите цену`,'prow-'+x.id]);
    if (StationUi.blocked(x)) p.push([`Позиция ${i+1}: оборудование станции не помещается в контейнер`,'item-'+x.id]);
    { const ce=StationCalc.errors(x);   // расчёт станции: станция не пройдёт по требованиям
      if (ce.length) p.push([`Позиция ${i+1}: расчёт станции — ${ce[0].text}${ce.length>1 ? ` (и ещё ${ce.length-1})` : ''}`,'item-'+x.id]); }
    if (x._discBad) p.push([`Позиция ${i+1}: скидка — ${discType(x)==='sum'?'сумма не больше цены за единицу':'процент от 0 до 99,99'}`,'prow-'+x.id]);
    (x.options||[]).forEach(o=>{ if(!o.name.trim()) return;
      if (!(Number.isInteger(+o.qty)&&+o.qty>=1)) p.push([`Позиция ${i+1}, опция «${o.short||o.name}»: количество`,'item-'+x.id]);
      if (Number.isNaN(parsePrice(o._priceText ?? ''))) p.push([`Позиция ${i+1}, опция «${o.short||o.name}»: цена`,'item-'+x.id]); });
  });
  if (!S.cover.model.trim() && KpModels.list().length<2) p.push(['Титул: укажите модель или серию','st-cover']);
  const v=+S.vat; if (!(v>=0 && v<=50)) p.push(['Проверьте ставку НДС','st-price']);
  const needR=new Set([kpCur(),...S.items.filter(x=>x.cost).map(x=>x.costCur||'RUB')].filter(c=>c!=='RUB'));
  for (const c of needR) if (!(rateOf(c)>0)) p.push([`Укажите курс ${c}`,'st-price']);
  if (!S.manager.name.trim() || !S.manager.phone.trim()) p.push(['Контакты: ФИО и телефон','st-manager']);
  return p;
}

// Правая панель (класс SidePanel): сумма КП, сразу под ней — «Сохранить КП» и «Предпросмотр» (видны без прокрутки и на
// ноутбуке), что осталось заполнить, затем краткая экономика сделки (DealSide, deal.js). На телефоне — нижняя панель (mbar).
class SidePanel {
  static render(){
    const t=totalsS(), pr=problems(), cs=curSh(kpCur());
    const kn=$('#kpno'); if (kn) kn.textContent = S.number ? 'КП № '+S.number : '';
    this.mbar(t, pr, cs);
    morph($('#side'), `<h2 class="side-h">Итог и сохранение</h2>${this.total(t, cs)}${this.actions(pr)}${DealDefaults.allowed()?DealSide.html():''}`);
  }

  static total(t, cs){
    const n=S.items.length;
    const rubEq = kpCur()!=='RUB' && rateOf(kpCur())>0 ? `<dt>В рублях по курсу</dt><dd>${money(Math.round(t.sum*rateOf(kpCur())))}</dd>` : '';
    return `<div class="total"><div class="lab">Итого к оплате с НДС</div>
      <div class="big">${money(t.sum)} <small>${cs}</small></div>
      <dl>${t.discount?`<dt>Без скидки</dt><dd>${money(t.gross)}</dd><dt>Скидка для заказчика</dt><dd>−${money(t.discount)}</dd>`:''}<dt>в т. ч. НДС ${esc(S.vat)} %</dt><dd>${money(t.vat)}</dd>${rubEq}</dl>
      <div class="tot-n">${n} ${plural(n,'позиция','позиции','позиций')} · ${t.units} ${plural(t.units,'единица','единицы','единиц')} оборудования</div>
      <div class="words">${t.sum?esc(words(t.sum).replace(/^./,c=>c.toUpperCase())):'Сумма прописью появится после ввода цен.'}</div></div>`;
  }

  /** сохранение и предпросмотр — первыми; под ними — почему «Сохранить» недоступна (что заполнить) */
  static actions(pr){
    return `<div class="checks side-act">
      <button class="btn primary dl" type="button" data-a="download" ${pr.length?'disabled':''}>${S.kpId?'Сохранить изменения КП № '+esc(S.number):'Сохранить КП'}</button>
      <button class="btn dl pv" type="button" data-a="kpPreview" ${S.items.length?'':'disabled'}>Предпросмотр КП</button>
      <label class="pdftoo"><input type="checkbox" id="pdfToo" ${PdfExport.wanted()?'checked':''}> Также сохранить в PDF</label>
      <div class="fname">${!S.kpId?'Номер присвоится при сохранении':esc(KpFile.saved())}</div><div class="msg" id="dlmsg"></div>
      <h3>${pr.length?'Чтобы сохранить, заполните':'Всё заполнено'}</h3>
      <ul>${pr.length?pr.map(x=>`<li><button type="button" data-go="${x[1]}">${esc(x[0])}</button></li>`).join(''):'<li class="ok">Проверки пройдены — можно сохранять.</li>'}</ul>
      ${StepList.mgrLine()&&STEP!=='mgr'?`<div class="tplside">Менеджер: <b>${esc(jShort(S.manager.name))}</b>, ${esc(S.manager.phone)} <button type="button" data-step="mgr">изменить</button></div>`:''}
      ${Templates.list.length>1?`<div class="tplside">Шаблон: <b>${esc((Templates.current()||{}).name||'—')}</b> <button type="button" data-go="st-cover">сменить</button></div>`:''}</div>`;
  }

  /** нижняя панель телефона: назад, итог (переход к сохранению), далее; на последнем шаге — «Сохранить КП» */
  static mbar(t, pr, cs){
    const m=$('#mbar'); if (!m) return;
    const L=StepList.visible(), k=L.findIndex(s=>s.id===STEP), prev=L[k-1], next=L[k+1];
    const back = prev ? `<button class="mb-back" type="button" data-step="${prev.id}" aria-label="Назад: ${esc(prev.t)}"><span aria-hidden="true">‹</span></button>` : '<span class="mb-back" aria-hidden="true"></span>';
    const sum = `<button class="mb-sum" type="button" data-a="toSave"><small>${pr.length?`Итого · не заполнено: ${pr.length}`:'Итого · всё готово'}</small><b>${money(t.sum)} ${esc(cs)}</b></button>`;
    const go = next ? `<button class="btn primary mb-next" type="button" data-step="${next.id}"><span>Далее</span><small>${esc(next.t)}</small></button>`
      : pr.length ? `<button class="btn primary mb-next" type="button" data-a="toSave"><span>Проверить</span><small>осталось ${pr.length}</small></button>`
      : `<button class="btn primary mb-next" type="button" data-a="download"><span>Сохранить</span><small>${S.kpId?'изменения КП':'КП'}</small></button>`;
    morph(m, back+sum+go);
  }
}

function updateLive(){
  S.items.forEach((x,i)=>{ const el=document.querySelector(`[data-sum="${i}"]`); if(el) el.textContent=money(itemSum(x));
    (x.options||[]).forEach((o,j)=>{ const e2=document.querySelector(`[data-osum="${i}.${j}"]`); if(e2) e2.textContent=o.price?money((+o.qty||0)*o.price):'—'; }); });
  if (CATED) return;
  SidePanel.render(); persist();
}
