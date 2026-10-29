// Запуск страницы до отрисовки (отдельным файлом — политика безопасности запрещает встроенные скрипты).
/* тема до отрисовки страницы, чтобы не мигала: сохранённый выбор или системная */
(function(){ try{ var t=localStorage.getItem('kp.theme'); if (t==='time'){ var h=new Date().getHours(); t=(h>=19||h<7)?'dark':'light'; } if (t==='light'||t==='dark'){ document.documentElement.dataset.theme=t; document.documentElement.style.colorScheme=t; } }catch(e){} })();
/* крупный режим (на этом устройстве) — до отрисовки */
(function(){ try{ if (localStorage.getItem('kp.big')==='1') document.documentElement.classList.add('big'); }catch(e){} })();
/* телефон — сразу телефонная раскладка (условие то же, что в js/ui/mobile.js) */
if (window.matchMedia && matchMedia('(max-width: 760px), (pointer: coarse) and (max-height: 500px)').matches) document.documentElement.classList.add('mob');
/* форма КП скрыта, пока запуск не решит первый экран (кабинет или КП) — конструктор не мелькает перед кабинетом */
document.documentElement.classList.add('app-boot');
/* запасной выход: запуск не дошёл до первого экрана (ошибка модуля) — форма не остаётся скрытой */
setTimeout(function(){ document.documentElement.classList.remove('app-boot'); }, 15000);
