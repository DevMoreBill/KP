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
    <div class="mm-l">${MyDay.on()?it('myday','☀','Мой день','Напоминания, черновики, КП в работе'):''}${it('new','＋','Новое КП',Presets.on()?'Пустое или по заготовке':'Начать с чистого листа')}
      ${it('journal','☰','Журнал КП','Открыть, повторить прошлое КП, статусы, отчёт')}
      ${Reminders.items.length?it('reminders','🔔','Напоминания ('+Reminders.items.length+')','Перезвонить, срок действия КП'):''}
      ${it('catalog','▦','Каталог оборудования','Подбор и своё оборудование')}
      ${it('preview','▤','Предпросмотр КП','Документ целиком')}
      ${dealAllowed()?it('deal','₽','Экономика сделки','Прибыль, финансирование, Excel'):''}
      ${it('help','?','Руководство','Как пользоваться, история версий')}
      <hr>${it('prefs','☺','Мои настройки','Тема, стартовый экран, мои условия, подпись в письмах')}${it('theme',dark?'☀':'☾',dark?'Светлая тема':'Тёмная тема','')}
      ${it('settings','⚙','Настройки','Для администратора')}${ADMIN.on?it('uitexts','✎','Тексты интерфейса','Правка надписей и подсказок'):''}</div>`;
  d.onclick=e=>{ const b=e.target.closest('[data-mm],[data-close]'); if (!b){ if (e.target===d) d.close(); return; }
    d.close(); const k=b.dataset.mm;
    if (k==='new') $('#btnNew').click();
    else if (k==='uitexts') uitToggle();
    else if (k==='journal') openJournal();
    else if (k==='myday') MyDay.open();
    else if (k==='reminders') Reminders.open();
    else if (k==='catalog') openCatalog({});
    else if (k==='preview') openKpPreview();
    else if (k==='deal') openDeal();
    else if (k==='help') openHelp();
    else if (k==='theme') $('#btnTheme').click();
    else if (k==='prefs') MyPrefs.open();
    else if (k==='settings') openSettings(); };
  d.showModal();
}

document.addEventListener('click', e=>{ if (e.target.closest('#btnMenu')) openMobileMenu(); });

// название позиции — поле по высоте текста (на узком экране длинное название не обрезается)
function fitText(el){ el.style.height='auto'; el.style.height=(el.scrollHeight+2)+'px'; }
document.addEventListener('input', e=>{ if (e.target.matches?.('textarea.iname')) fitText(e.target); });

// пустое поле даты: на iPhone (Safari) оно выглядит пустым белым прямоугольником — помечаем пустые поля,
// CSS показывает в них подсказку «дд.мм.гггг» (только на iOS, см. mobile.css)
const dtMark = el => el.classList.toggle('dt-empty', !el.value);
let dtRaf = 0;
const dtScan = () => { dtRaf = 0; document.querySelectorAll('input[type=date]').forEach(dtMark); };
['input','change'].forEach(t=>document.addEventListener(t, e=>{ if (e.target.type==='date') dtMark(e.target); }, true));
new MutationObserver(()=>{ if (!dtRaf) dtRaf = requestAnimationFrame(dtScan); }).observe(document.documentElement, {childList:true, subtree:true});

// телефон: шапка с логотипом прячется при прокрутке вниз и возвращается при прокрутке вверх — больше рабочей зоны
let topY = 0;
addEventListener('scroll', ()=>{ if (!isMob()) return; const y = scrollY, d = y - topY;
  if (Math.abs(d) < 8) return;
  document.body.classList.toggle('top-hide', d > 0 && y > 90); topY = y; }, {passive:true});
