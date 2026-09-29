// Запуск программы: проверка сервера, загрузка справочников и каталога.
'use strict';

(async()=>{
  try{ SRV.info=await api('/api/ping'); SRV.on=true; }catch(e){}
  if (!SRV.on){ document.body.innerHTML='<div style="max-width:620px;margin:80px auto;font:16px/1.5 system-ui;padding:24px;border:1px solid #cfe0f2;border-radius:14px"><h2 style="margin-top:0;color:#0B45A0">Программа не запущена</h2><p>Откройте «Конструктор КП.exe» — он запустит программу и откроет её в браузере. Если вы работаете с сервером отдела, проверьте, что компьютер-сервер включён, и откройте ярлык «Конструктор КП (сервер …)».</p></div>'; return; }
  { $('#srvBtns').hidden=false; $('#btnExit').hidden = SRV.info.mode==='server' || SRV.info.local===false; document.title='Конструктор КП — ПНЕВМОТЕХ';
    if (SRV.info.local===false || SRV.info.mode==='server'){ const st=$('#saved'); if (st) st.insertAdjacentHTML('beforebegin', `<span class="srvtag" title="Общая база отдела">Сервер отдела: ${esc(SRV.info.host||location.hostname)}</span>`); } }
  await loadTypes(); await loadClients(); await loadTemplates(); await refreshCat(); renderForm();
  if (!S.items.length && catCache.length) openCatalog({});
})();

renderForm();
