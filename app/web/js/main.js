// Запуск программы: проверка сервера, загрузка справочников и каталога.
'use strict';

(async()=>{
  try{ SRV.info=await api('/api/ping'); SRV.on=true; }catch(e){}
  if (!SRV.on){ document.body.innerHTML='<div style="max-width:620px;margin:80px auto;font:16px/1.5 system-ui;padding:24px;border:1px solid #cfe0f2;border-radius:14px"><h2 style="margin-top:0;color:#0B45A0">Программа не запущена</h2><p>Откройте «Конструктор КП.exe» — он запустит программу и откроет её в браузере. Если вы работаете с сервером отдела, проверьте, что компьютер-сервер включён, и откройте ярлык «Конструктор КП (сервер …)».</p></div>'; return; }
  { $('#srvBtns').hidden=false; $('#btnExit').hidden = SRV.info.mode==='server' || SRV.info.local===false; document.title='Конструктор КП — ПНЕВМОТЕХ';
    if (SRV.info.local===false || SRV.info.mode==='server'){ const ml=document.querySelector('.topmenu .menu-l'); if (ml) ml.insertAdjacentHTML('afterbegin', `<div class="menu-info" title="Общая база отдела">Сервер отдела: <b>${esc(SRV.info.host||location.hostname)}</b></div><hr>`); } }
  await authLoad();
  aiStatusLoad();               // нейросеть в программе — включена ли администратором
  defaultsLoad();               // значения по умолчанию от администратора («Настройки → Умолчания»)
  if (AUTH.enabled && !AUTH.user && !AUTH.admin){ authScreen(); return; }       // вход менеджеров по паролю включён
  try{ const st=await api('/api/admin/status'); ADMIN.on=!!st.admin; ADMIN.csrf=st.csrf||''; }catch(e){}   // вход администратора действует и после обновления страницы
  // справочники — параллельно (каталогу нужны только категории); списки и выборы администратора — до первой отрисовки
  await loadTypes(); await Promise.all([loadClients(), loadManagers(), loadTemplates(), refreshCat(), LISTS.load(), FEAT.load(), MyPrefs.load()]);
  loadLogos(); loadAppVersion(); uitLoad(); renderForm(); authMenu();
  (window.requestIdleCallback||setTimeout)(()=>CW.prewarm());     // поиск в каталоге — готов заранее
  Drafts.start();               // черновики на сервере: автосохранение раз в минуту
  Reminders.load(); Reminders.poll();   // колокольчик: перезвонить, срок действия КП
  if (!showMigrationNotice(SRV.info.migrations) && !MyPrefs.start() && !MyDay.start() && !S.items.length && catCache.length) openCatalog({});   // «Мой день» — вместо каталога
})();

renderForm();

// переключатель светлой и тёмной темы: выбор хранится в браузере; без выбора — как в системе
function curTheme(){ const t=document.documentElement.dataset.theme; return t==='dark'||t==='light' ? t : (matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'); }
function paintThemeBtn(){ const b=document.getElementById('btnTheme'); if(!b) return; const dark=curTheme()==='dark';
  b.textContent = dark ? '☀  Светлая тема' : '☾  Тёмная тема'; }
document.getElementById('btnTheme').addEventListener('click', ()=>{
  const t = curTheme()==='dark' ? 'light' : 'dark', r=document.documentElement;
  r.dataset.theme=t; r.style.colorScheme=t; try{ localStorage.setItem('kp.theme', t); }catch(e){} paintThemeBtn(); MyPrefs.rememberTheme(t); });
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', paintThemeBtn);
paintThemeBtn();
