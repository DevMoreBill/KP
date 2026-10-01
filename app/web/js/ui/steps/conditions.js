// Раздел 5 «Условия».
'use strict';

// свои значения, которые уже вписывали в прошлых КП (запоминаются при сохранении КП)
function condRecent(){ try{ return JSON.parse(localStorage.getItem('kp.condRecent')||'{}')||{}; }catch(e){ return {}; } }
function condLast(){ try{ return JSON.parse(localStorage.getItem('kp.lastConds')||'null'); }catch(e){ return null; } }

// после сохранения КП: условия запоминаются для кнопки «Как в прошлом КП», свои значения — для списка ▾
function rememberConds(){
  try{
    localStorage.setItem('kp.lastConds', JSON.stringify({conditions:S.conditions.map(c=>({label:c.label,value:c.value})), condExtra:S.condExtra||''}));
    const r=condRecent();
    S.conditions.forEach((c,j)=>{ const v=String(c.value||'').trim(); if (!v || (COND[j]?.[1]||[]).includes(v)) return;
      r[c.label]=[v,...(r[c.label]||[]).filter(x=>x!==v)].slice(0,5); });
    localStorage.setItem('kp.condRecent', JSON.stringify(r));
  }catch(e){}
}

function condPicker(attr, idx, opts, recent){
  const btn=v=>`<button type="button" ${attr}="${idx}" data-v="${esc(v)}">${esc(v)}</button>`;
  return `<details class="pickm"><summary class="btn" title="Выбрать из списка" aria-label="Выбрать из списка">▾</summary><div class="menu-l">
    ${recent.length?`<p class="pm-cap">Вы вписывали</p>${recent.map(btn).join('')}<hr>`:''}${opts.map(btn).join('')}</div></details>`;
}

function stepConds(){
  const rec=condRecent(), last=condLast();
  const rows = S.conditions.map((c,j)=>`<div class="f"><span>${esc(c.label)}</span><div class="cpick">
      <input type="text" data-p="conditions.${j}.value" value="${esc(c.value||'')}" placeholder="Не выводить" autocomplete="off">
      ${condPicker('data-cset', j, COND[j]?.[1]||[], (rec[c.label]||[]).filter(v=>!(COND[j]?.[1]||[]).includes(v)))}</div></div>`).join('');
  return `<section class="step" id="st-conds"><h2><span class="n">5</span>Условия${tip('<p>Кнопка ▾ у поля — список базовых вариантов (и ваших значений из прошлых КП); можно и вписать своё. Пустое условие в КП не попадёт.</p><p>«Как в прошлом КП» — заполнить все условия так же, как в последнем сохранённом КП.</p><p>Дополнительные условия выводятся под таблицей условий: каждая строка — отдельный абзац.</p>')}</h2>
  <div class="row cond-bar">${last?'<button class="btn" type="button" data-cond="last">Как в прошлом КП</button>':''}<button class="btn ghost" type="button" data-cond="clear">Очистить</button></div>
  <div class="grid g2">${rows}</div>
  <div class="f" style="margin-top:14px"><span>Дополнительные условия и оговорки</span><div class="cpick ta">
    <textarea data-p="condExtra" rows="3" placeholder="Например: цена действительна при заказе комплекта целиком">${esc(S.condExtra||'')}</textarea>
    ${condPicker('data-cxadd', 0, COND_EXTRA, [])}</div></div>
  <div class="grid g2" style="margin-top:14px"><label class="f"><span>Ставка НДС, %</span><input type="text" inputmode="numeric" data-p="vat" value="${esc(S.vat)}"></label>
  <div style="align-self:end;padding-bottom:10px"><button class="sw" type="button" role="switch" aria-checked="${S.showClients}" data-a="clients"><i></i>Страница «Наши клиенты»</button></div></div></section>`;
}

document.addEventListener('click', e=>{
  const set=e.target.closest('[data-cset]'), add=e.target.closest('[data-cxadd]'), act=e.target.closest('[data-cond]');
  if (set){ S.conditions[+set.dataset.cset].value=set.dataset.v; }
  else if (add){ const cur=String(S.condExtra||'').trim(); if (!cur.split('\n').map(s=>s.trim()).includes(add.dataset.v)) S.condExtra=(cur?cur+'\n':'')+add.dataset.v; }
  else if (act && act.dataset.cond==='last'){ const l=condLast(); if (!l) return;
    S.conditions=S.conditions.map(c=>({...c, value:(l.conditions.find(x=>x.label===c.label)||{}).value||''})); S.condExtra=l.condExtra||''; toast('Условия — как в прошлом КП'); }
  else if (act && act.dataset.cond==='clear'){ S.conditions.forEach(c=>c.value=''); S.condExtra=''; }
  else return;
  e.target.closest('details')?.removeAttribute('open'); renderForm(); persist();
});
