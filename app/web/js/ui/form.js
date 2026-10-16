// Каркас формы: поля, разделы (шаги), навигация, перерисовка.
'use strict';

// подсказка «?»: пояснение открывается по нажатию и не занимает место в форме
function tip(html){ return `<details class="tip"><summary title="Подсказка" aria-label="Подсказка">?</summary><div class="tip-b">${html}</div></details>`; }

function field(label, path, o={}){
  const v = getPath(S, path) ?? '';
  const req = o.req ? ' class="req"' : '';
  const input = o.area ? `<textarea data-p="${path}" rows="${o.rows||3}" placeholder="${esc(o.ph||'')}">${esc(v)}</textarea>`
    : `<input type="${o.type||'text'}" data-p="${path}" value="${esc(v)}" placeholder="${esc(o.ph||'')}" ${o.list?`list="${o.list}"`:''} ${o.cls?`class="${o.cls}"`:''} autocomplete="off">`;
  return `<label class="f"><span${req}>${esc(label)}</span>${input}</label>`;
}

const STEPS=[
  {id:'client', t:'Клиент',          d:'Кому и когда',                       f:()=>stepClient()},
  {id:'equip',  t:'Оборудование',    d:'Подбор из каталога, опции, фото',    f:()=>stepItems()},
  {id:'price',  t:'Цены и валюта',   d:'Валюта, НДС, цены и скидки',         f:()=>stepPrice()},
  {id:'cover',  t:'Оформление КП',  d:'Шаблон, титул, страница клиентов',  f:()=>stepCover()},
  {id:'conds',  t:'Условия',         d:'Сроки, оплата, гарантия',            f:()=>CondsStep.html()},
  {id:'mgr',    t:'Менеджер',        d:'Контакты в КП',                      f:()=>stepManager()}];

let STEP='client';

// «Менеджер — строкой» (функция mgrLine): ФИО и телефон заполнены — шага нет в списке, менеджер — строкой в боковой панели
class StepList {
  static mgrLine(){ return FEAT.on('mgrLine') && !!String(S.manager.name||'').trim() && !!String(S.manager.phone||'').trim(); }
/** шаги, которые сейчас показаны (открытый шаг — всегда) */
  static visible(){ return STEPS.filter(s=>s.id!=='mgr' || STEP==='mgr' || !StepList.mgrLine()); }
}

try{ const s0=localStorage.getItem('kp.step'); if (STEPS.some(s=>s.id===s0)) STEP=s0; }catch(e){}

function stepOfTarget(t, msg=''){
  if (/^st-client/.test(t)) return 'client';
  if (/^st-price|^prow-/.test(t) || /курс|закупк|: укажите цену/i.test(msg)) return 'price';
  if (/^st-items|^item-/.test(t)) return 'equip';
  if (/^st-cover/.test(t)) return 'cover';
  if (/^st-conds/.test(t)) return 'conds';
  if (/^st-manager/.test(t)) return 'mgr';
  return null;
}

function goStep(id, target){
  STEP=id; try{ localStorage.setItem('kp.step',id); }catch(e){}
  renderForm(); window.scrollTo({top:0,behavior:isMob()?'auto':'smooth'});
  if (id==='price') autoRates();
  if (target) setTimeout(()=>{ const el=document.getElementById(target); if(el){ el.scrollIntoView({behavior:'smooth',block:'center'}); el.querySelector('input.bad, input')?.focus({preventScroll:true}); } },60);
}

function stepperHtml(){
  const pr=problems(); const bad=new Set(pr.map(x=>stepOfTarget(x[1],x[0])).filter(Boolean));
  const done=id=> id==='client'? !!S.client.trim() : id==='equip'? S.items.length>0 : id==='price'? S.items.length>0 && S.items.every(x=>x.price>0)
     : id==='cover'? !!(S.cover.model||KpModels.list().length>1) : id==='conds'? S.conditions.some(c=>c.value) : id==='mgr'? !!S.manager.name : false;
  return `<nav class="stepper" aria-label="Разделы КП">${StepList.visible().map((s,k)=>{
      const st = s.id===STEP ? 'cur' : bad.has(s.id) ? 'bad' : done(s.id) ? 'ok' : '';
      return `<button type="button" class="stp ${st}" data-step="${s.id}" title="${esc(s.d)}" aria-current="${s.id===STEP?'step':'false'}">
        <span class="num">${st==='ok'?'✓':k+1}</span><span class="tx"><b>${s.t}</b></span>${st==='bad'?'<i class="dot" title="Есть незаполненные поля"></i>':''}</button>`; }).join('')}</nav>`;
}

function stepNavHtml(){
  const L=StepList.visible(), k=L.findIndex(s=>s.id===STEP), prev=L[k-1], next=L[k+1];
  return `<div class="stepnav">${prev?`<button class="btn" type="button" data-step="${prev.id}">← ${prev.t}</button>`:'<span></span>'}
    ${next?`<button class="btn primary" type="button" data-step="${next.id}">Далее: ${next.t} →</button>`:`<button class="btn primary" type="button" data-a="toSave">Перейти к сохранению КП →</button>`}</div>`;
}

function renderForm(){
  if (CATED){ if (EDIT && $('#edlg').open) renderEditor(); return; }
  pickTemplate();
  const f = $('#form'); const act = document.activeElement, focusP = act?.dataset?.p;
  const cur = STEPS.find(s=>s.id===STEP)||STEPS[0];
  morph($('#nav'), stepperHtml());
  morph(f, cur.f().replace(/<h2><span class="n">\d+<\/span>/, `<h2><span class="n">${StepList.visible().indexOf(cur)+1}</span>`) + stepNavHtml());
  // поле осталось тем же узлом — фокус не трогаем (иначе на телефоне прыгает клавиатура)
  if (focusP && !act.isConnected && !$('#edlg').open) { const el = f.querySelector(`[data-p="${CSS.escape(focusP)}"]`); if (el){ el.focus({preventScroll:true}); try{ const n=el.value.length; el.setSelectionRange(n,n);}catch(e){} } }
  const sp=$('#nav .stepper'), sc=sp?.querySelector('.stp.cur'); if (sp && sc && sp.scrollWidth>sp.clientWidth) sp.scrollLeft=sc.offsetLeft-(sp.clientWidth-sc.offsetWidth)/2;
  document.body.dataset.kpstep=STEP;
  f.querySelectorAll('textarea.iname').forEach(fitText);
  SidePanel.render();
  if (EDIT && $('#edlg').open) renderEditor();
  if (STEP==='cover') coverThumbSoon();
}

// раскрывающиеся меню и подсказки (класс Popups) закрываются щелчком мимо них, меню действий — и после выбора пункта
class Popups {
  static OPEN = 'details.tip[open], details.topmenu[open], details.pickm[open], details.jr-more[open]';
  static close(e){
    document.querySelectorAll(this.OPEN).forEach(d=>{
      if (!d.contains(e.target) || (d.matches('.topmenu, .jr-more') && e.target.closest('.menu-l button'))) d.open=false; });
  }
}
document.addEventListener('click', e=>Popups.close(e));
