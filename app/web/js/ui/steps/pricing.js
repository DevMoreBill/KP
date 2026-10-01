// Раздел 3 «Цены и валюта».
'use strict';

function stepPrice(){
  const cs=curSh(kpCur());
  const rows=S.items.map((x,i)=>{ const pt=x._priceText ?? fmtPrice(x.price);
    const act=actualPct(x), mv=marginOf(x), md=modeOf(x);
    const hint = priceHint(x);
    const opts=(x.options||[]).filter(o=>o.name&&o.price);
    return `<div class="prow" id="prow-${x.id}">
      <div class="pname"><span class="item-no">${i+1}</span><div><b>${esc(x.name||'Без названия')}</b><span class="muted">${esc(x.qty)} шт.${opts.length?` · опции ${money(opts.reduce((s,o)=>s+(+o.qty||0)*(o.price||0),0))} ${cs}`:''}</span></div></div>
      <label class="f"><span>Закупка за ед.</span><div class="cin"><select data-cc="${i}" aria-label="Валюта закупки">${CUR_LIST.map(k=>`<option${(x.costCur||'RUB')===k?' selected':''}>${k}</option>`).join('')}</select><input type="text" inputmode="decimal" class="num${x._costText!=null&&Number.isNaN(parsePrice(x._costText))?' bad':''}" data-cost="${i}" value="${esc(x._costText ?? (x.cost?money(x.cost):''))}" placeholder="не указана"></div></label>
      <label class="f mcell"><span><span class="mtog" role="group" aria-label="Способ расчёта"><button type="button" class="${md==='margin'?'on':''}" data-a="mmode" data-i="${i}" data-v="margin" title="Маржа — доля прибыли в цене продажи">Маржа</button><button type="button" class="${md==='markup'?'on':''}" data-a="mmode" data-i="${i}" data-v="markup" title="Наценка — процент к закупке">Наценка</button></span>, %</span>
        <input type="text" inputmode="decimal" class="num" data-margin="${i}" value="${esc(x.margin ?? '')}" placeholder="${x.cost&&act!=null&&(x.priceManual||mv==null)?esc(act.toFixed(1).replace('.',',')):'—'}" ${x.cost?'':'disabled title="Сначала укажите закупку"'}></label>
      <label class="f"><span class="req">Цена продажи за ед., ${cs}${x.priceManual&&x.cost?' <em class="man">вручную</em>':''}</span><input type="text" inputmode="decimal" class="num strong${Number.isNaN(parsePrice(pt))||!x.price?' bad':''}" data-price="${i}" value="${esc(pt)}" placeholder="0,00"></label>
      <label class="f dcell" title="Скидка для заказчика — попадёт в КП"><span>Скидка <span class="mtog" role="group" aria-label="Вид скидки"><button type="button" class="${discType(x)==='pct'?'on':''}" data-a="dmode" data-i="${i}" data-v="pct" title="Скидка в процентах от цены">%</button><button type="button" class="${discType(x)==='sum'?'on':''}" data-a="dmode" data-i="${i}" data-v="sum" title="Скидка суммой на единицу">${cs}</button></span></span>
        <input type="text" inputmode="decimal" class="num${x._discText!=null&&x._discBad?' bad':''}" data-disc="${i}" value="${esc(x._discText ?? discText(x))}" placeholder="нет" title="Скидка попадёт в КП: колонка «Скидка» и строки «Сумма без скидки» / «Скидка»"></label>
      <div class="psum"><span>Сумма</span><b data-sum="${i}">${money(itemSum(x))}</b></div>
      <div class="pinfo"><span data-minfo="${i}">${hint}</span>
        ${x.cost&&x.priceManual&&mv!=null?`<button class="btn ghost" type="button" data-a="reprice" data-i="${i}">↺ рассчитать по ${md==='markup'?'наценке':'марже'} ${esc(x.margin)} %</button>`:''}</div>
    </div>`; }).join('');
  return `<section class="step" id="st-price"><h2><span class="n">3</span>Цены и валюта${tip('<p>Введите цену продажи — или закупку и маржу (наценку), тогда цена посчитается сама.</p><p>Закупка, маржа и прибыль видны только вам, в КП не попадают. Скидка попадает в КП.</p>')}</h2>
  ${pricingBlock()}
  ${rows || `<div class="empty-pick"><p><b>Сначала добавьте оборудование</b></p><button class="btn primary" type="button" data-step="equip">Перейти к оборудованию</button></div>`}
  </section>`;
}
