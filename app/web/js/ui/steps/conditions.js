// Раздел 5 «Условия».
'use strict';

function stepConds(){
  const rows = S.conditions.map((c,j)=>`<div>${field(c.label,`conditions.${j}.value`,{ph:'Не выводить'})}
    <div class="chips">${(COND[j]?.[1]||[]).map(v=>`<button class="chip" type="button" data-a="chip" data-j="${j}" data-v="${esc(v)}">${esc(v)}</button>`).join('')}</div></div>`).join('');
  return `<section class="step" id="st-conds"><h2><span class="n">4</span>Условия</h2>
  <p class="hint">Пустое условие не попадёт в КП. Подсказки под полями заполняют значение одним нажатием.</p>
  <div class="grid g2">${rows}</div>
  <div class="grid g2" style="margin-top:16px"><label class="f"><span>Ставка НДС, %</span><input type="text" inputmode="numeric" data-p="vat" value="${esc(S.vat)}"></label>
  <div style="align-self:end;padding-bottom:10px"><button class="sw" type="button" role="switch" aria-checked="${S.showClients}" data-a="clients"><i></i>Страница «Наши клиенты»</button></div></div></section>`;
}
