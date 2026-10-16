// «Настройки → Обслуживание»: обновления программы, сведения о системе, перезапуск; «Обзор» — «Требует внимания».
// Сервер: app/app_update.py (Updater, ReleaseSource, Restarter), app/admin_overview.py (SystemInfo, Attention).
'use strict';

class AdminSystem {
  static LEVEL = {bad:'Важно', warn:'Внимание', info:'К сведению'};

  // ---------- «Требует внимания» (вкладка «Статистика»)
  static async attention(box){
    let r; try{ r=await aapi('attention'); }catch(e){ box.innerHTML=''; return; }
    const L=r.items||[];
    box.innerHTML = L.length ? `<div class="st-card at-card"><p class="sub">Требует внимания · ${L.length}</p>${L.map(x=>`<div class="at-r at-${esc(x.level)}"><span class="at-l">${esc(this.LEVEL[x.level]||'')}</span><span class="at-t">${esc(x.text)}</span>${x.tab?`<button class="btn sm" type="button" data-sttab="${esc(x.tab)}">Открыть</button>`:''}</div>`).join('')}</div>`
      : '<div class="st-card at-card at-ok"><p class="sub" style="margin:0">✓ Всё в порядке — ничего не требует внимания</p></div>';
  }

  // ---------- перезапуск: окно ожидания, затем страница обновляется
  static async restart(why='Программа перезапускается'){
    try{ await ajson('restart'); }catch(e){ return toast('Не перезапущено: '+(e.message||e)); }
    const m=new Modal(`<div class="dlg-h"><h3>${esc(why)}…</h3></div><p class="muted" id="rsMsg">Подождите 10–30 секунд — страница обновится сама.</p><div class="rs-bar"><i></i></div>`, 'rs-dlg');
    m.d.addEventListener('cancel', e=>e.preventDefault());
    const t0=Date.now(); let down=false;
    await new Promise(r=>setTimeout(r, 2500));
    for (;;){
      let ok=false; try{ ok=(await fetch('/api/ping', {cache:'no-store'})).ok; }catch(e){ down=true; }
      if (ok && (down || Date.now()-t0>8000)) break;
      if (!ok) down=true;
      if (Date.now()-t0>120000){ m.$('#rsMsg').textContent='Программа не ответила за 2 минуты. Проверьте компьютер-сервер и обновите страницу (Ctrl+F5).'; return; }
      await new Promise(r=>setTimeout(r, 1000));
    }
    location.reload();
  }

  // ---------- обновления
  static async updates(m, note){
    const s=await aapi('update'), last=s.last||{};
    const ver=v=>`<b>${esc(v)}</b>`;
    const hist=(s.history||[]).map(h=>`<tr><td>${esc(Fmt.dateTime(h.at))}</td><td>${esc(h.from||'')} → ${esc(h.version||'')}</td><td>${esc(h.source||'')}${h.reason?`<br><small class="muted">${esc(h.reason)}</small>`:''}</td><td>${esc(h.by||'')}</td></tr>`).join('');
    const f=s.failed, again=f&&last.version===f.version;
    m.innerHTML=`${note?`<p class="msg ok" style="text-align:left">${esc(note)}</p>`:''}
    ${f?`<div class="st-card up-fail"><p><b class="bad-t">Обновление ${esc(f.version)} не запустилось</b>${f.at?` (${esc(Fmt.dateTime(f.at))})`:''} — программа сама вернулась к версии ${ver(s.current)}. Данные не пострадали: перед установкой была сделана копия базы («Копии и база»).</p>
      <p>Причина: <code>${esc(f.reason||'неизвестна')}</code></p>
      ${f.trace?`<details class="up-notes"><summary>Подробности для разработчика</summary><pre>${esc(f.trace)}</pre></details>`:''}
      <p class="muted">Установить эту версию снова можно, когда причина устранена (обычно — в выпуске с исправлением): «Скачать и установить» или «Выбрать архив обновления…».</p></div>`:''}
    <div class="st-card"><div class="up-v"><div><span class="muted">Работает версия</span><b class="up-big">${esc(s.current)}</b>
        <span class="muted">${s.patched?`обновление поверх программы ${s.base?esc(s.base):''}`:'версия программы (EXE)'}</span></div>
      ${s.pending?`<div class="up-pend">Установлено обновление ${ver(s.installed)} — заработает после перезапуска <button class="btn primary" type="button" data-up="restart">Перезапустить сейчас</button></div>`:''}</div>
      ${!s.frozen?'<p class="msg warn" style="text-align:left">Программа запущена из исходников (не из EXE): обновление установится в папку update, но подключится только у программы, запущенной из «Конструктор КП.exe».</p>':''}
      ${!s.writable?`<p class="msg err" style="text-align:left">Нет прав записи в папку программы ${esc(s.root)}. Обновление из «Настроек» не установится — запустите «Установить обновление.cmd» из архива от имени администратора компьютера.</p>`:''}</div>
    <div class="st-card"><div class="row"><p class="sub" style="margin:0">Новая версия</p><span class="sp"></span><button class="btn" type="button" data-up="check"${s.hasToken||!/^DevMoreBill\/KP$/.test(s.repo)?'':' title="Репозиторий приватный — нужен токен GitHub (ниже)"'}>Проверить обновления</button></div>
      ${last.at?`<p class="muted" style="margin:6px 0">Проверено ${esc(Fmt.dateTime(last.at))}${last.error?` — <span class="bad-t">${esc(last.error)}</span>`:''}</p>`:'<p class="muted" style="margin:6px 0">Ещё не проверялось.</p>'}
      ${last.version&&!last.error?(s.available?`<div class="up-new"><p>Доступна версия ${ver(last.version)}${last.published?` от ${esc(KPGen.ruDate(last.published.slice(0,10)))}`:''}.${last.url?` <a href="${esc(last.url)}" target="_blank" rel="noopener noreferrer">Выпуск на GitHub ↗</a>`:''}</p>
          ${last.notes?`<details class="up-notes" open><summary>Что нового</summary><pre>${esc(last.notes)}</pre></details>`:''}
          ${again?'<p class="bad-t">Эта версия уже не запустилась на этом компьютере — подробности выше.</p>':''}
          ${last.asset?`<button class="btn${again?'':' primary'}" type="button" data-up="download">Скачать и установить ${esc(last.version)}</button> <span class="muted">${esc(last.asset.name)}${last.asset.size?` · ${Fmt.size(last.asset.size)}`:""} · перед установкой — копия базы, после — перезапуск</span>`:'<p class="muted">В выпуске нет архива обновления — скачайте полный комплект с GitHub.</p>'}</div>`
        :`<p class="ok-t" style="margin:0">Установлена последняя версия (${esc(last.version)}).</p>`):''}</div>
    <div class="st-card"><p class="sub">Установить из файла</p>
      <p class="muted" style="margin:0 0 8px">Архив обновления «KP-Obnovlenie-….zip» из выпуска — без интернета на компьютере-сервере. Перед установкой — копия базы, после — перезапуск.</p>
      <div class="row"><label class="btn" for="upF">Выбрать архив обновления…</label><input type="file" id="upF" accept=".zip,application/zip" class="sr-file">
        <label class="row muted" style="gap:6px"><input type="checkbox" id="upForce" style="width:auto"> переустановить или поставить более старую версию</label></div>
      <p class="muted" id="upSt"></p></div>
    <div class="st-card"><p class="sub">Откат</p><div class="row">
      <button class="btn" type="button" data-up="rollback"${s.prev?'':' disabled'}>${s.prev?`Вернуть предыдущее обновление (${esc(s.prev)})`:'Предыдущего обновления нет'}</button>
      <button class="btn ghost" type="button" data-up="remove"${s.installed?'':' disabled'}>Убрать обновление — работать на версии EXE</button></div>
      <p class="muted" style="margin:8px 0 0">База данных при откате не меняется. Копии базы перед каждой установкой — в «Копии и база».</p></div>
    <div class="st-card"><p class="sub">Источник обновлений</p><div class="grid g2">
      <label class="f"><span>Репозиторий GitHub</span><input type="text" id="upRepo" value="${esc(s.repo)}" placeholder="владелец/имя"></label>
      <label class="f"><span>Токен GitHub ${s.hasToken?'<b class="ok-t">задан</b>':''}</span><input type="password" id="upTok" autocomplete="off" placeholder="${s.hasToken?'Новый токен — заменит текущий':'github_pat_… (только чтение: Contents)'}"></label></div>
      <label class="row muted" style="gap:6px;margin-top:6px"><input type="checkbox" id="upAuto" style="width:auto"${s.auto?' checked':''}> Проверять новую версию раз в сутки (в «Требует внимания» появится напоминание)</label>
      <p class="muted">Репозиторий приватный — нужен токен: github.com → Settings → Developer settings → Fine-grained tokens → доступ к репозиторию, право «Contents: Read-only». Токен хранится только на компьютере-сервере.</p>
      <div class="row"><button class="btn primary" type="button" data-up="save">Сохранить</button>${s.hasToken?'<button class="btn ghost" type="button" data-up="deltok">Удалить токен</button>':''}</div></div>
    <div class="st-card"><p class="sub">Ночные обновления</p>
      <div class="grid g2"><label class="f"><span>Ставить сами</span><select id="upNight">${[['off','выключено'],['patch','только исправления (3.52.0 → 3.52.1)'],['all','все новые версии']].map(([k,l])=>`<option value="${k}"${s.nightly===k?' selected':''}>${l}</option>`).join('')}</select></label>
        <label class="f"><span>Время</span><select id="upHour">${Array.from({length:24},(_,h)=>`<option value="${h}"${s.nightHour===h?' selected':''}>с ${h}:00 до ${(h+2)%24}:00</option>`).join('')}</select></label></div>
      <p class="muted">В это время программа сама проверит новую версию на GitHub, скачает, поставит её и перезапустится (сотрудникам — пара секунд ожидания). Не ставит, если последние 15 минут кто-то сохранял данные (попробует через полчаса), и не повторяет версию, которая уже не запустилась. Если новая версия не запустится, программа сама вернётся к прежней. Об установке придёт письмо, если включены «Письма о проблемах» (вкладка «Почта»).</p>
      ${s.nightSupported?'':'<p class="msg warn">Программа запущена не из EXE 3.51 и новее — ночные обновления не сработают (установите полный комплект).</p>'}
      ${s.nightLast?`<p class="muted" style="margin:0 0 8px">Последняя попытка: ${esc(Fmt.dateTime(s.nightLast.at))} — <span class="${s.nightLast.error?'bad-t':''}">${esc(s.nightLast.result||'')}</span></p>`:''}
      <button class="btn primary" type="button" data-up="night">Сохранить</button></div>
    ${hist?`<div class="st-card"><p class="sub">История установок</p><table class="pv-t st-tt"><tr><th>Когда</th><th>Версия</th><th>Откуда</th><th>Кто</th></tr>${hist}</table></div>`:''}`;
    const installed=async res=>{ if (await stConfirm(`Установлена версия ${res.version}`, `Файлов: ${res.files}. Копия базы сохранена. Чтобы новая версия заработала, программу нужно перезапустить — у всех сотрудников страница обновится сама.`, 'Перезапустить сейчас')) return this.restart('Устанавливается версия '+res.version);
      this.updates(m, `Версия ${res.version} установлена — перезапустите программу, когда будет удобно.`); };
    m.querySelector('#upF').onchange=async e=>{ const f=e.target.files[0]; e.target.value=''; if (!f) return;
      const st=m.querySelector('#upSt'); st.textContent=`Загружаю «${f.name}»…`;
      try{ const res=await aapi(`update/upload?name=${encodeURIComponent(f.name)}${m.querySelector('#upForce').checked?'&force=1':''}`, {method:'POST', headers:{'Content-Type':'application/zip'}, body:f}); installed(res); }
      catch(err){ st.innerHTML=`<span class="bad-t">${esc(err.message||err)}</span>`; } };
    m.onclick=async e=>{ const b=e.target.closest('[data-up]'); if (!b) return; const a=b.dataset.up;
      const busy=t=>{ b.disabled=true; b.textContent=t; };
      try{
        if (a==='restart') return this.restart();
        if (a==='check'){ busy('Проверяю…'); await ajson('update/check'); return this.updates(m); }
        if (a==='download'){ if (!await stConfirm(`Установить версию ${last.version}?`, 'Программа скачает архив обновления с GitHub, сохранит копию базы и установит обновление. Затем — перезапуск (сотрудникам — пара секунд ожидания).', 'Установить')) return;
          busy('Скачиваю и устанавливаю…'); return installed(await ajson('update/download')); }
        if (a==='rollback'){ if (!await stConfirm(`Вернуть версию ${s.prev}?`, 'Установленное сейчас обновление можно будет вернуть тем же способом. После — перезапуск.', 'Вернуть')) return;
          const r=await ajson('update/rollback'); return this.restart('Возвращается версия '+(r.version||'')); }
        if (a==='remove'){ if (!await stConfirm('Убрать обновление?', 'Программа будет работать на версии, встроенной в EXE. Обновление останется в update.prev — его можно вернуть кнопкой «Вернуть предыдущее». После — перезапуск.', 'Убрать')) return;
          await ajson('update/remove'); return this.restart(); }
        if (a==='night'){ await ajson('update', {nightly:m.querySelector('#upNight').value, nightHour:+m.querySelector('#upHour').value}); toast('Сохранено'); return this.updates(m); }
        if (a==='save' || a==='deltok'){ const body={repo:m.querySelector('#upRepo').value.trim(), auto:m.querySelector('#upAuto').checked};
          const t=m.querySelector('#upTok').value.trim(); if (t) body.token=t; if (a==='deltok') body.token='';
          await ajson('update', body); toast('Сохранено'); return this.updates(m); }
      }catch(err){ toast(err.message||String(err)); this.updates(m); } };
  }

  // ---------- система
  // задача Планировщика сервера отдела (app/server_task.py): без ограничения времени работы, от батареи (ИБП), обычный приоритет
  static task(t){
    const bat='«server-setup\\1. Установить сервер отдела.bat»';
    if (t.pending) return '<span class="muted">проверяется…</span>';
    if (!t.exists) return t.error?`<span class="bad-t">не проверена: ${esc(t.error)}</span>`
      :`<span class="muted">задачи Планировщика нет — после перезагрузки сервер сам не запустится; автозапуск включает ${bat}</span>`;
    if ((t.problems||[]).length) return `<span class="bad-t">✕ задача Планировщика ${esc(t.problems.join(', '))}</span>${t.error?` <small class="muted">(исправить не удалось: ${esc(t.error)})</small>`:''}<br><small class="muted">Запустите ${bat} от имени администратора.</small>`;
    const fx=t.fixed||t.fixedBefore;
    return `<span class="ok-t">✓ задача Планировщика: без ограничения времени работы, от батареи и ИБП, обычный приоритет</span>${fx?` <small class="muted">· исправлена программой ${esc(Fmt.dateTime(fx))}</small>`:''}`;
  }
  // журнал сервера (app/server_log.py, data/logs/kp.log): последние ошибки, скачать целиком
  static async logCard(box){
    let r; try{ r=await aapi('log'); }catch(e){ box.innerHTML=`<p class="sub">Журнал сервера</p><p class="muted">${esc(e.message||e)}</p>`; return; }
    const L=r.errors||[];
    box.innerHTML=`<div class="row"><p class="sub" style="margin:0">Журнал сервера</p><span class="sp"></span>
        <a class="btn" href="/api/admin/log/download" download>Скачать журнал</a>${r.local?'<button class="btn ghost" type="button" data-fold="logs">Открыть папку</button>':''}</div>
      <p class="muted" style="margin:6px 0">${r.day?`<span class="bad-t">Ошибок за сутки: ${r.day}</span>`:'<span class="ok-t">За сутки ошибок нет</span>'} · ${Fmt.size(r.bytes||0)} · <code>${esc(r.dir||'')}</code></p>
      ${L.length?`<div class="lg-list">${L.map(x=>`<details class="lg-e"><summary><span class="muted">${esc(Fmt.dateTime(x.at))}</span> ${esc(x.text)}</summary>${x.detail?`<pre>${esc(x.detail)}</pre>`:''}</details>`).join('')}</div>`
        :'<p class="muted" style="margin:0">Ошибок в журнале нет.</p>'}`;
  }
  static uptime(s){ const d=Math.floor(s/86400), h=Math.floor(s%86400/3600), mi=Math.floor(s%3600/60); return (d?`${d} дн. `:'')+(h?`${h} ч `:'')+`${mi} мин`; }
  static async system(m){
    const s=await aapi('system');
    const row=(k,v)=>`<tr><td>${k}</td><td>${v}</td></tr>`, path=(p,w)=>`<code>${esc(p)}</code>${s.local&&w?` <button class="btn sm ghost" type="button" data-fold="${w}">Открыть</button>`:''}`;
    m.innerHTML=`<div class="st-card"><div class="row"><p class="sub" style="margin:0">Программа</p><span class="sp"></span><button class="btn" type="button" data-sys="restart">Перезапустить программу</button></div>
      <table class="pv-t">${row('Версия', `<b>${esc(s.version)}</b>${s.patched?` (обновление поверх ${esc(s.base||'EXE')})`:''} <button class="lnk" type="button" data-sttab="updates">Обновления →</button>`)}
        ${row('Режим', s.mode==='server'?`сервер отдела — сотрудники открывают <code>http://${esc(s.host)}:${s.port}/</code>`:`программа на этом компьютере — <code>http://localhost:${s.port}/</code>`)}
        ${row('Работает', `${this.uptime(s.uptime)} (с ${esc(Fmt.dateTime(s.started))})`)}
        ${s.task?row('Автозапуск', this.task(s.task)):''}
        ${row('Компьютер', `${esc(s.host)} · ${esc(s.os)} · Python ${esc(s.python)}`)}
        ${s.allowedHosts.length?row('Разрешённые имена', esc(s.allowedHosts.join(', '))):''}</table></div>
    <div class="st-card"><p class="sub">Папки и место на диске</p>
      <table class="pv-t">${row('Программа', path(s.root, 'root'))}${row('Данные (база, изображения)', path(s.dataDir, 'data'))}
        ${row('Готовые КП', path(s.docsDir, 'docs')+(s.docsShare?`<br><small class="muted">сотрудникам: ${esc(s.docsShare)}</small>`:''))}${row('Копии базы', path(s.dataDir+(s.dataDir.includes('\\')?'\\':'/')+'backup', 'backup'))}
        ${row('База данных', Fmt.size(s.dbBytes))}${s.disk?row('Свободно на диске', `${Fmt.size(s.disk.free)} из ${Fmt.size(s.disk.total)}`):''}
        ${row('Файл настроек', `<code>${esc(s.settingsFile)}</code><br><small class="muted">режим, порт, папка данных — меняются в нём; затем «Перезапустить программу»</small>`)}</table>
      ${s.local?'':'<p class="muted">Кнопки «Открыть» — только на самом компьютере-сервере.</p>'}</div>
    <div class="st-card" id="sysLog"><p class="sub">Журнал сервера</p><p class="muted">Загружаю…</p></div>`;
    this.logCard(m.querySelector('#sysLog'));
    m.onclick=async e=>{ if (e.target.closest('[data-sys=restart]')){ if (await stConfirm('Перезапустить программу?', 'Сотрудники подождут 10–30 секунд, несохранённые черновики останутся в браузере.', 'Перезапустить')) this.restart(); return; }
      const f=e.target.closest('[data-fold]'); if (f){ try{ await ajson('folder', {which:f.dataset.fold}); }catch(err){ toast(err.message); } } };
  }
}
