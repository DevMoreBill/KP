// Запуск программы: проверка сервера, загрузка справочников и каталога.
'use strict';

(async()=>{
  try{ SRV.info=await api('/api/ping'); SRV.on=true; }catch(e){}
  if (!SRV.on){ document.body.innerHTML='<div style="max-width:620px;margin:80px auto;font:16px/1.5 system-ui;padding:24px;border:1px solid #cfe0f2;border-radius:14px"><h2 style="margin-top:0;color:#0B45A0">Программа не запущена</h2><p>Откройте «Конструктор КП.exe» — он запустит программу и откроет её в браузере. Если вы работаете с сервером отдела, проверьте, что компьютер-сервер включён, и откройте ярлык «Конструктор КП (сервер …)».</p></div>'; return; }
  const remote=SRV.info.local===false || SRV.info.mode==='server';
  $('#srvBtns').hidden=false; $('#btnExit').hidden=remote; document.title='Конструктор КП — ПНЕВМОТЕХ';
  if (remote){ const ml=document.querySelector('.topmenu .menu-l'); if (ml) ml.insertAdjacentHTML('afterbegin', `<div class="menu-info" title="Общая база отдела">Сервер отдела: <b>${esc(SRV.info.host||location.hostname)}</b></div><hr>`); }
  await authLoad();
  if (AUTH.enabled && AUTH.user && AUTH.user.mustChange && !AUTH.admin){ AuthScreen.change(); return; }   // вошёл с временным паролем — сначала свой
  aiStatusLoad();               // нейросеть в программе — включена ли администратором
  defaultsLoad();               // значения по умолчанию от администратора («Настройки → Умолчания»)
  if (AUTH.enabled && !AUTH.user && !AUTH.admin){ AuthScreen.show(); return; }       // вход менеджеров по паролю включён
  try{ const st=await api('/api/admin/status'); ADMIN.set(st.admin, st.csrf); }catch(e){}   // вход администратора действует и после обновления страницы
  // справочники — параллельно (каталогу нужны только категории); списки и выборы администратора — до первой отрисовки
  await loadTypes(); await Promise.all([loadClients(), loadManagers(), Templates.load(), refreshCat(), LISTS.load(), FEAT.load(), MyPrefs.load()]);
  loadLogos(); loadAppVersion(); uitLoad(); renderForm(); AuthMenu.mount();
  (window.requestIdleCallback||setTimeout)(()=>CW.prewarm());     // поиск в каталоге — готов заранее
  Drafts.start();               // черновики на сервере: автосохранение раз в минуту
  Reminders.load(); Reminders.poll();   // колокольчик: перезвонить, срок действия КП
  if (!showMigrationNotice(SRV.info.migrations) && !MyPrefs.start() && !MyDay.start() && !S.items.length && catCache.length) openCatalog({});   // «Мой день» — вместо каталога
})();

renderForm();

// светлая и тёмная тема: выбор хранится в браузере (и в «Моих настройках»); без выбора (auto) — как в системе
class Theme {
  static NAMES = ['light', 'dark', 'auto'];
  static SYSTEM = matchMedia('(prefers-color-scheme: dark)');
  static current(){ const t=document.documentElement.dataset.theme; return t==='dark'||t==='light' ? t : (this.SYSTEM.matches ? 'dark' : 'light'); }
  static set(t){
    const r=document.documentElement, fixed=t==='light' || t==='dark';
    if (fixed){ r.dataset.theme=t; r.style.colorScheme=t; } else { delete r.dataset.theme; r.style.colorScheme=''; }
    try{ if (fixed) localStorage.setItem('kp.theme', t); else localStorage.removeItem('kp.theme'); }catch(e){ /* без хранилища браузера */ }
    this.paintButton();
  }
  static toggle(){ const t=this.current()==='dark' ? 'light' : 'dark'; this.set(t); MyPrefs.rememberTheme(t); }
  static paintButton(){ $('#btnTheme').textContent = this.current()==='dark' ? '☀  Светлая тема' : '☾  Тёмная тема'; }
}
$('#btnTheme').addEventListener('click', ()=>Theme.toggle());
Theme.SYSTEM.addEventListener('change', ()=>Theme.paintButton());
Theme.paintButton();
