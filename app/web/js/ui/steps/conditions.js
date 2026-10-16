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
    S.conditions.forEach(c=>{ const v=String(c.value||'').trim(); if (!v || condOpts(c.label).includes(v)) return;
      r[c.label]=[v,...(r[c.label]||[]).filter(x=>x!==v)].slice(0,5); });
    localStorage.setItem('kp.condRecent', JSON.stringify(r));
  }catch(e){}
}

// базовые варианты условия — по его названию (условия, добавленные позже, могут стоять не на своём месте)
const condOpts = label => (COND.find(x=>x[0]===label)||[])[1] || [];

// что предлагает экономика сделки (если её заполняли)
function condFromDeal(){
  if (!S.deal || !S.deal.touched || typeof dealCalc!=='function') return {};
  try{ return dealCondSuggest(dealCalc(dealKpInputs(), S.deal)); }catch(e){ return {}; }
}

function condPicker(attr, idx, opts, recent){
  const btn=v=>`<button type="button" ${attr}="${idx}" data-v="${esc(v)}">${esc(v)}</button>`;
  return `<details class="pickm"><summary class="btn" title="Выбрать из списка" aria-label="Выбрать из списка">▾</summary><div class="menu-l">
    ${recent.length?`<p class="pm-cap">Вы вписывали</p>${recent.map(btn).join('')}<hr>`:''}${opts.map(btn).join('')}</div></details>`;
}

// раздел «Условия» (класс CondsStep): поле и список вариантов ▾ у каждого условия, «Как в прошлом КП»;
// «Очистить все условия» — только когда есть что очищать, справа и с подтверждением
class CondsStep {
  static html(){
    const rec=condRecent(), last=condLast(), sug=condFromDeal(), any=S.conditions.some(c=>String(c.value||'').trim()) || !!String(S.condExtra||'').trim();
    const rows = S.conditions.map((c,j)=>{ const v=String(c.value||'').trim(), sv=sug[c.label], fromDeal=v && sv && v===sv;
      return `<div class="f"><span>${esc(c.label)}${fromDeal?' <em class="cond-auto" title="Подставлено из «Экономики сделки» и обновляется при её изменении. Впишите своё — останется ваше.">из экономики сделки</em>':''}</span><div class="cpick">
        <input type="text" data-p="conditions.${j}.value" value="${esc(c.value||'')}" placeholder="Не выводить" autocomplete="off">
        ${condPicker('data-cset', j, condOpts(c.label), (rec[c.label]||[]).filter(v=>!condOpts(c.label).includes(v)))}</div>
        ${sv && v!==sv ? `<button type="button" class="lnk cond-sync" data-csync="${j}" title="${esc(sv)}">↺ Из экономики сделки: ${esc(sv.length>70?sv.slice(0,70)+'…':sv)}</button>` : ''}</div>`; }).join('');
    return `<section class="step" id="st-conds"><h2><span class="n">5</span>Условия${tip('<p>Кнопка ▾ у поля — список базовых вариантов (и ваших значений из прошлых КП); можно и вписать своё. Пустое условие в КП не попадёт.</p><p>«Как в прошлом КП» — заполнить все условия так же, как в последнем сохранённом КП.</p><p>Дополнительные условия выводятся под таблицей условий: каждая строка — отдельный абзац.</p>')}</h2>
    ${last||any?`<div class="row cond-bar">${last?'<button class="btn" type="button" data-cond="last">Как в прошлом КП</button>':''}<span class="sp"></span>${any?'<button class="btn ghost" type="button" data-cond="clear">Очистить все условия</button>':''}</div>`:''}
    <div class="grid g2">${rows}</div>
    <div class="f" style="margin-top:14px"><span>Дополнительные условия и оговорки</span><div class="cpick ta">
      <textarea data-p="condExtra" rows="3" placeholder="Например: цена действительна при заказе комплекта целиком">${esc(S.condExtra||'')}</textarea>
      ${condPicker('data-cxadd', 0, COND_EXTRA, [])}</div></div>
    ${KpFilesPanel.stepHtml()}</section>`;
  }

  static async click(e){
    const set=e.target.closest('[data-cset]'), add=e.target.closest('[data-cxadd]'), act=e.target.closest('[data-cond]');
    const sync=e.target.closest('[data-csync]');
    if (act && act.dataset.cond==='clear'){
      if (!await stConfirm('Очистить все условия?', 'Поля условий и оговорки станут пустыми — в КП условия не попадут.', 'Очистить')) return;
      S.conditions.forEach(c=>c.value=''); S.condExtra=''; }
    else if (sync){ const c=S.conditions[+sync.dataset.csync], v=condFromDeal()[c.label]; if (v){ c.value=v; S.condAuto={...(S.condAuto||{}), [c.label]:v}; } }
    else if (set){ S.conditions[+set.dataset.cset].value=set.dataset.v; }
    else if (add){ const cur=String(S.condExtra||'').trim(); if (!cur.split('\n').map(s=>s.trim()).includes(add.dataset.v)) S.condExtra=(cur?cur+'\n':'')+add.dataset.v; }
    else if (act && act.dataset.cond==='last'){ const l=condLast(); if (!l) return;
      S.conditions=S.conditions.map(c=>({...c, value:(l.conditions.find(x=>x.label===c.label)||{}).value||''})); S.condExtra=l.condExtra||''; toast('Условия — как в прошлом КП'); }
    else return;
    e.target.closest('details')?.removeAttribute('open'); renderForm(); persist();
  }
}

document.addEventListener('click', e=>CondsStep.click(e));
