// Раздел 5 «Условия».
'use strict';

function stepConds(){
  // варианты — выпадающим списком в поле (можно выбрать или вписать своё)
  const rows = S.conditions.map((c,j)=>`<div>${field(c.label,`conditions.${j}.value`,{ph:'Не выводить',list:'cond'+j})}
    <datalist id="cond${j}">${(COND[j]?.[1]||[]).map(v=>`<option value="${esc(v)}">`).join('')}</datalist></div>`).join('');
  return `<section class="step" id="st-conds"><h2><span class="n">5</span>Условия${tip('<p>Нажмите на поле — появится список готовых вариантов; можно вписать своё. Пустое условие в КП не попадёт.</p><p>Дополнительные условия выводятся под таблицей условий: каждая строка — отдельный абзац, строка с «-» в начале — пункт списка.</p>')}</h2>
  <div class="grid g2">${rows}</div>
  <div class="grid" style="margin-top:14px">${field('Дополнительные условия и оговорки','condExtra',{area:1,rows:3,ph:'Например: цена действительна при заказе комплекта целиком'})}</div>
  <div class="grid g2" style="margin-top:14px"><label class="f"><span>Ставка НДС, %</span><input type="text" inputmode="numeric" data-p="vat" value="${esc(S.vat)}"></label>
  <div style="align-self:end;padding-bottom:10px"><button class="sw" type="button" role="switch" aria-checked="${S.showClients}" data-a="clients"><i></i>Страница «Наши клиенты»</button></div></div></section>`;
}
