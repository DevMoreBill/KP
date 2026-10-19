// Раздел 3 «Цены и валюта»: цены продажи вводятся вручную, одна строка на позицию; скидка попадает в КП.
// Закупка, логистика, таможня и подбор цены под маржу — в окне «Экономика сделки» (js/features/deal.js).
'use strict';

function stepPrice(){
  const cs=curSh(kpCur());
  const rows=S.items.map((x,i)=>{ const pt=x._priceText ?? fmtPrice(x.price);
    const opts=(x.options||[]).filter(o=>o.name&&o.price), os=opts.reduce((s,o)=>s+(+o.qty||0)*(o.price||0),0);
    return `<div class="prow" id="prow-${x.id}">
      <span class="item-no">${i+1}</span>
      <div class="pname"><b>${esc(x.name||'Без названия')}</b><small>${esc(x.qty)} шт.${opts.length?` · опции ${money(os)} ${cs}`:''}</small></div>
      <label class="f pprice"><span class="pl">Цена за ед., ${cs}</span><input type="text" inputmode="decimal" class="num strong${Number.isNaN(parsePrice(pt))||!x.price?' bad':''}" data-price="${i}" value="${esc(pt)}" placeholder="0,00" aria-label="Цена за единицу с НДС, ${cs}"></label>
      <label class="f pdisc" title="Скидка для заказчика — попадёт в КП"><span class="pl">Скидка</span><span class="dwrap"><input type="text" inputmode="decimal" class="num${x._discText!=null&&x._discBad?' bad':''}" data-disc="${i}" value="${esc(x._discText ?? discText(x))}" placeholder="нет" aria-label="Скидка"><span class="mtog" role="group" aria-label="Вид скидки"><button type="button" class="${discType(x)==='pct'?'on':''}" data-a="dmode" data-i="${i}" data-v="pct" title="Скидка в процентах от цены">%</button><button type="button" class="${discType(x)==='sum'?'on':''}" data-a="dmode" data-i="${i}" data-v="sum" title="Скидка суммой на единицу">${cs}</button></span></span></label>
      <div class="psum"><span class="pl">Сумма</span><b data-sum="${i}">${money(itemSum(x))}</b></div>
      <div class="pinfo" data-minfo="${i}">${priceHint(x)}</div>
    </div>`; }).join('');
  const cta = S.items.length&&DealDefaults.allowed() ? `<button class="dl-cta" type="button" data-a="deal"><i aria-hidden="true">₽</i><span><b>Экономика сделки: логистика, растаможка, финансирование</b><small>Закупка у поставщиков, таможня по кодам ТН ВЭД — и цена продажи под нужную маржу. В КП не выводится.</small></span><em aria-hidden="true">→</em></button>` : '';
  return `<section class="step" id="st-price"><h2><span class="n">3</span>Цены и валюта${tip('<p>Цена продажи за единицу с НДС — вручную. Скидка попадает в КП.</p><p>Закупку и расчёт цены под маржу ведите в «Экономике сделки» — оттуда цены переносятся сюда одной кнопкой.</p>')}</h2>
  ${pricingBlock()}
  ${cta}
  ${rows ? `<div class="ptable"><div class="phead" aria-hidden="true"><span>№</span><span>Позиция</span><span>Цена за ед. с НДС, ${cs}</span><span>Скидка</span><span>Сумма, ${cs}</span></div>${rows}</div>`
    : `<div class="empty-pick"><p><b>Сначала добавьте оборудование</b></p><button class="btn primary" type="button" data-step="equip">Перейти к оборудованию</button></div>`}
  </section>`;
}
