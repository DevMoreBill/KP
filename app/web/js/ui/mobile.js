// Телефоны: высота видимой области при открытой экранной клавиатуре (--vvh для окон на весь экран)
// и прокрутка к полю ввода, чтобы клавиатура его не закрывала (Safari iOS, Chrome Android).
'use strict';

(function(){
  const vv=window.visualViewport; if (!vv) return;
  const set=()=>document.documentElement.style.setProperty('--vvh', Math.round(vv.height)+'px');
  vv.addEventListener('resize', set); set();
  document.addEventListener('focusin', e=>{
    const t=e.target; if (!t.matches || !t.matches('input,textarea,select') || !matchMedia('(pointer:coarse)').matches) return;
    setTimeout(()=>t.scrollIntoView({block:'center', behavior:'smooth'}), 300);
  });
})();
