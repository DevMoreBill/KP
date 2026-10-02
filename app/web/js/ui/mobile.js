// Телефон (Safari iOS, Chrome Android): режим «mob» на <html> (ставится ещё в <head>, чтобы не мигала настольная
// раскладка), меню «☰» внизу экрана, нижняя панель шагов. Прокрутку к полю при вводе браузер делает сам —
// своя прокрутка поверх неё и давала рывки.
'use strict';

const MOB_Q = '(max-width: 760px), (pointer: coarse) and (max-height: 500px)';

function isMob(){ return document.documentElement.classList.contains('mob'); }

(function(){
  const mq=matchMedia(MOB_Q);
  const apply=()=>{ const was=isMob(); document.documentElement.classList.toggle('mob', mq.matches); if (was!==mq.matches && typeof renderForm==='function') renderForm(); };
  mq.addEventListener('change', apply); apply();
})();

// меню телефона: только то, что нужно для работы с КП; настольные функции (папки на сервере, импорт, типы) — на компьютере
function openMobileMenu(){
  let d=$('#mmenu'); if (!d){ d=document.createElement('dialog'); d.id='mmenu'; d.className='sheet'; d.setAttribute('aria-label','Меню'); document.body.appendChild(d); }
  const dark=document.documentElement.dataset.theme==='dark' || (!document.documentElement.dataset.theme && matchMedia('(prefers-color-scheme: dark)').matches);
  const it=(k,ic,t,s)=>`<button type="button" class="mm-i" data-mm="${k}"><i aria-hidden="true">${ic}</i><span><b>${t}</b>${s?`<small>${s}</small>`:''}</span></button>`;
  d.innerHTML=`<div class="dlg-h"><h3>Меню</h3><button class="icon" type="button" data-close aria-label="Закрыть">✕</button></div>
    <div class="mm-l">${it('new','＋','Новое КП','Начать с чистого листа')}
      ${it('journal','☰','Журнал КП','Открыть, повторить прошлое КП')}
      ${it('catalog','▦','Каталог оборудования','Подбор и своё оборудование')}
      ${it('preview','▤','Предпросмотр КП','Документ целиком')}
      ${dealAllowed()?it('deal','₽','Экономика сделки','Прибыль, финансирование, Excel'):''}
      ${it('help','?','Руководство','Как пользоваться, история версий')}
      <hr>${it('theme',dark?'☀':'☾',dark?'Светлая тема':'Тёмная тема','')}
      ${it('settings','⚙','Настройки','Для администратора')}</div>`;
  d.onclick=e=>{ const b=e.target.closest('[data-mm],[data-close]'); if (!b){ if (e.target===d) d.close(); return; }
    d.close(); const k=b.dataset.mm;
    if (k==='new') $('#btnNew').click();
    else if (k==='journal') openJournal();
    else if (k==='catalog') openCatalog({});
    else if (k==='preview') openKpPreview();
    else if (k==='deal') openDeal();
    else if (k==='help') openHelp();
    else if (k==='theme') $('#btnTheme').click();
    else if (k==='settings') openSettings(); };
  d.showModal();
}

document.addEventListener('click', e=>{ if (e.target.closest('#btnMenu')) openMobileMenu(); });

// название позиции — поле по высоте текста (на узком экране длинное название не обрезается)
function fitText(el){ el.style.height='auto'; el.style.height=(el.scrollHeight+2)+'px'; }
document.addEventListener('input', e=>{ if (e.target.matches?.('textarea.iname')) fitText(e.target); });
