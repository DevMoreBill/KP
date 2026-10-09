// Запуск страницы до отрисовки (отдельным файлом — политика безопасности запрещает встроенные скрипты).
/* тема до отрисовки страницы, чтобы не мигала: сохранённый выбор или системная */
(function(){ try{ var t=localStorage.getItem('kp.theme'); if (t==='light'||t==='dark'){ document.documentElement.dataset.theme=t; document.documentElement.style.colorScheme=t; } }catch(e){} })();
/* телефон — сразу телефонная раскладка (условие то же, что в js/ui/mobile.js) */
if (window.matchMedia && matchMedia('(max-width: 760px), (pointer: coarse) and (max-height: 500px)').matches) document.documentElement.classList.add('mob');
