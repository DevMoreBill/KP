// «Настройки» — админ-панель под паролем администратора (сервер: app/admin.py).
// Статистика, удаление (в корзину), корзина, модерация правок товаров, журнал действий, резервные копии,
// шаблоны КП, ключи API, пароль. Сессия — 15 минут бездействия.
'use strict';

const ST = { tab:'stats', del:{type:'kp', q:'', sel:new Set()}, audit:{page:0, f:{}}, imp:null, chart:'day' };

const ST_TABS = [['stats','Статистика'],['moderation','Модерация'],['delete','Данные: правка и удаление'],['trash','Корзина'],['audit','Журнал действий'],
  ['backup','Резервные копии'],['logistics','Логистика'],['templates','Шаблоны и категории'],['keys','Ключи API'],['users','Администраторы'],['security','Пароль и доступ']];

const ACT = { login:'Вход в «Настройки»', backup_db:'Копия базы', maintain_db:'Сжатие и проверка базы', purge_images:'Удаление лишних изображений', create_admin:'Новый администратор', edit_admin:'Изменение администратора', delete_admin:'Удаление администратора', logout:'Выход из «Настроек»', set_password:'Пароль администратора', delete_attempt:'Попытка удаления',
  admin_request:'Запрос без входа', edit_settings:'Изменение настроек', edit_template:'Изменение шаблона', create_kp:'Создание КП', edit_kp:'Изменение КП',
  create_manager:'Новый менеджер', create_supplier:'Новый поставщик', edit_supplier:'Изменение поставщика', delete_supplier:'Удаление поставщика', edit_customs:'Код ТН ВЭД и пошлина', edit_manager:'Изменение менеджера', create_client:'Новый клиент', edit_client:'Изменение клиента',
  edit_types:'Категории оборудования', submit_edit:'Правка на модерацию', edit_product:'Правка товара', create_product:'Новый товар',
  price_sync:'Цены из КП', approve_edit:'Правка одобрена', reject_edit:'Правка отклонена', rollback_edit:'Откат правки',
  toggle_moderation:'Режим модерации', delete_kp:'Удаление КП', delete_catalog:'Удаление товара', delete_manager:'Удаление менеджера',
  delete_client:'Удаление клиента', restore:'Восстановление из корзины', purge_trash:'Очистка корзины', export_db:'Экспорт базы', import_db:'Импорт базы' };
const ENT = { supplier:'Поставщик', customs:'ТН ВЭД', product:'Товар', catalog:'Товар', kp:'КП', manager:'Менеджер', client:'Клиент', settings:'Настройки', template:'Шаблон',
  types:'Категории', admin:'Администратор', db:'База', trash:'Корзина' };
const DEL_TYPES = [['kp','КП из журнала'],['catalog','Товары каталога'],['manager','Контакты менеджеров'],['client','Клиенты'],['supplier','Поставщики']];

function setDlg(){ let d=$('#setdlg'); if(!d){ d=document.createElement('dialog'); d.id='setdlg'; d.className='setwin'; d.setAttribute('aria-label','Настройки'); document.body.appendChild(d); stWinSize(d);
    // размер окна запоминается (тянуть за правый нижний угол); «⤢» — во весь экран
    d.addEventListener('click', e=>{ if (e.target.closest('[data-st="max"]')){ d.classList.toggle('max'); stWinSize(d, true); } });
    let t=null; if (window.ResizeObserver) new ResizeObserver(()=>{ if (!d.open || (typeof isMob==='function'&&isMob()) || d.classList.contains('max')) return; clearTimeout(t);
      t=setTimeout(()=>{ const r=d.getBoundingClientRect(); if (r.width>300){ d.style.width=Math.round(r.width)+'px'; d.style.height=Math.round(r.height)+'px'; stWinSize(d, true); } }, 600); }).observe(d); }
  return d; }
function stWinSize(d, save){ try{
  if (save){ localStorage.setItem('kp.setwin', JSON.stringify({max:d.classList.contains('max'), w:d.style.width||'', h:d.style.height||''})); return; }
  const o=JSON.parse(localStorage.getItem('kp.setwin')||'{}')||{}; d.classList.toggle('max', !!o.max); if (o.w) d.style.width=o.w; if (o.h) d.style.height=o.h; }catch(e){} }

// запрос «Настроек»: сессия истекла — снова форма входа
async function aapi(path, opts){
  try{ return await api('/api/admin/'+path, opts); }
  catch(e){ if (/сессия|Войдите/.test(e.message)){ ADMIN.on=false; ADMIN.csrf=''; stRender(); } throw e; }
}
const ajson = (path, body) => aapi(path, {method:'POST', headers:{'Content-Type':'application/json; charset=utf-8'}, body:JSON.stringify(body||{})});

async function openSettings(tab){
  if (tab) ST.tab=tab;
  const d=setDlg(); if (!d.open) d.showModal();
  d.innerHTML='<p class="empty">Загружаю…</p>';
  try{ const s=await api('/api/admin/status'); ADMIN.on=s.admin; ADMIN.csrf=s.csrf||''; ST.status=s; }catch(e){ ST.status={}; }
  stRender();
}

function stRender(){
  const d=setDlg(), s=ST.status||{};
  const head=`<div class="dlg-h"><h3>Настройки${ADMIN.on&&s.name?`<small>${esc(s.name)} · ${esc(s.login||'')}</small>`:''}</h3>${ADMIN.on?'<button class="btn ghost" type="button" data-st="logout">Выйти</button>':''}<button class="icon st-maxb" type="button" data-st="max" aria-label="Во весь экран" title="Во весь экран / обычный размер. Размер окна меняется, если потянуть за правый нижний угол">⤢</button><button class="icon" type="button" data-st="close" aria-label="Закрыть">✕</button></div>`;
  if (!ADMIN.on){
    const setup=!s.hasPassword;
    d.innerHTML=head+`<div class="st-login"><form id="stLogin" autocomplete="off">
      <p class="sub">${setup?'Создайте учётную запись администратора':'Вход для администратора'}</p>
      ${setup&&!s.canSetup?'<p class="msg err" style="text-align:left">Администратор ещё не создан. Создайте учётную запись на компьютере, где работает программа (сервер отдела).</p>':`
      <label class="f"><span>Логин</span><input type="text" id="stLg" autocomplete="username" required value="${setup?'admin':esc(localStorage.getItem('kp.adminLogin')||'')}" placeholder="admin"></label>
      ${setup?'<label class="f"><span>Имя (для журнала действий)</span><input type="text" id="stNm" autocomplete="name" placeholder="Например, Петров А. В."></label>':''}
      <label class="f"><span>${setup?'Пароль (не короче 8 символов, буквы и цифры)':'Пароль'}</span><input type="password" id="stPw" autocomplete="${setup?'new-password':'current-password'}" required></label>
      ${setup?'<label class="f"><span>Повторите пароль</span><input type="password" id="stPw2" autocomplete="new-password" required></label>':''}
      <p class="msg err" id="stErr" style="text-align:left"></p>
      <button class="btn primary" type="submit">${setup?'Создать и войти':'Войти'}</button>
      <p class="muted">Удаление и правка данных, модерация, резервные копии, шаблоны, ключи API и администраторы — только здесь. Через ${s.idleMinutes||15} минут бездействия вход закрывается.</p>`}
      </form></div>`;
    const f=$('#stLogin'); if (f) f.onsubmit=async e=>{ e.preventDefault(); const pw=$('#stPw').value, lg=$('#stLg').value.trim();
      if (setup && pw!==$('#stPw2').value) return $('#stErr').textContent='Пароли не совпадают';
      try{ const r=await ajson(setup?'setup':'login', setup?{login:lg, name:$('#stNm').value.trim(), password:pw}:{login:lg, password:pw});
        try{ localStorage.setItem('kp.adminLogin', lg); }catch(_){}
        ADMIN.on=true; ADMIN.csrf=r.csrf; const st2=await api('/api/admin/status').catch(()=>({})); ST.status={...s, ...st2, hasPassword:true}; stRender(); }
      catch(err){ $('#stErr').textContent=err.message; } };
    setTimeout(()=>($('#stLg')&&!$('#stLg').value?$('#stLg'):$('#stPw'))?.focus(),30);
    return;
  }
  d.innerHTML=head+`<div class="st-b"><nav class="st-nav">${ST_TABS.map(([k,l])=>`<button type="button" class="${ST.tab===k?'on':''}" data-sttab="${k}">${l}</button>`).join('')}</nav>
    <section class="st-main" id="stMain"><p class="empty">Загружаю…</p></section></div>`;
  stTab();
}

async function stTab(){
  const m=$('#stMain'); if (!m) return;
  try{ await ({stats:stStats, moderation:stModeration, delete:stDelete, trash:stTrash, audit:stAudit, backup:stBackup,
    templates:stTemplates, logistics:stLogistics, keys:stKeys, users:stUsers, security:stSecurity})[ST.tab](m); }
  catch(e){ if (ADMIN.on) m.innerHTML=`<p class="msg err">${esc(e.message||e)}</p>`; }
}

const stNum = v => Number(v||0).toLocaleString('ru-RU');
const stSize = b => b>1048576 ? (b/1048576).toFixed(1).replace('.',',')+' МБ' : Math.round(b/1024)+' КБ';
const stTime = iso => iso ? new Date(iso).toLocaleString('ru-RU',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'}) : '';

// ---------- статистика
function stBars(series){ // один ряд — столбцы с подсказкой при наведении/касании; подписи осей приглушённые
  const max=Math.max(1,...series.map(x=>x.count)), W=640, H=180, n=series.length, bw=W/n;
  const step=n>16?Math.ceil(n/8):1;
  return `<svg class="st-chart" viewBox="0 0 ${W} ${H+22}" role="img" aria-label="Количество КП по периодам">
    ${[0.5,1].map(f=>`<line x1="0" x2="${W}" y1="${H-H*f}" y2="${H-H*f}" class="grid"/><text x="0" y="${H-H*f-3}" class="ax">${Math.round(max*f)}</text>`).join('')}
    <line x1="0" x2="${W}" y1="${H}" y2="${H}" class="base"/>
    ${series.map((x,i)=>{ const h=x.count?Math.max(3,H*x.count/max):0, bx=i*bw+1, w=Math.max(2,bw-2);
      return `<g class="bar"><title>${esc(x.label)}: ${x.count} КП</title><rect class="hit" x="${i*bw}" y="0" width="${bw}" height="${H}"/>
        ${h?`<path d="M${bx},${H} V${H-h+Math.min(4,h)} q0,-4 4,-4 h${w-8} q4,0 4,4 V${H} Z"/>`:''}
        ${i%step===0?`<text x="${i*bw+bw/2}" y="${H+15}" class="ax" text-anchor="${i===0?'start':'middle'}">${esc(x.label)}</text>`:''}</g>`; }).join('')}</svg>`;
}

async function stStats(m){
  const s=await aapi('stats'), k=s.kp, mo=s.moderation;
  const tile=(v,l)=>`<div class="st-tile"><b>${v}</b><span>${l}</span></div>`;
  const ser=s.series[ST.chart];
  m.innerHTML=`<div class="st-tiles">${tile(stNum(k.total),'КП всего')}${tile(stNum(k.today),'за сегодня')}${tile(stNum(k.week),'за неделю')}${tile(stNum(k.month),'за месяц')}
      ${tile(stNum(Math.round((k.sumMonth||0)/100)),'сумма КП за месяц, руб.')}${tile(stNum(s.activeUsers),'активных за 30 дней')}
      ${tile(stNum(mo.pending),'правок на модерации')}${tile(mo.conversion==null?'—':String(mo.conversion).replace('.',',')+' %','правок одобрено')}
      ${tile(stNum(s.deletions.month),'удалений за месяц')}${tile(stSize(s.db.bytes),'размер базы')}</div>
    <div class="st-card"><div class="row st-ch-h"><p class="sub" style="margin:0">КП по ${ST.chart==='day'?'дням (30 дней)':ST.chart==='week'?'неделям (12 недель)':'месяцам (12 месяцев)'}</p><span class="sp"></span>
      <div class="seg">${[['day','Дни'],['week','Недели'],['month','Месяцы']].map(([v,l])=>`<button type="button" class="${ST.chart===v?'on':''}" data-chart="${v}">${l}</button>`).join('')}</div></div>
      ${stBars(ser)}
      <details><summary class="muted">Таблицей</summary><table class="pv-t">${ser.map(x=>`<tr><td>${esc(x.label)}</td><td>${x.count}</td></tr>`).join('')}</table></details></div>
    <div class="st-cols"><div class="st-card"><p class="sub">Менеджеры — больше всего КП</p><table class="pv-t">${s.managers.map(x=>`<tr><td>${esc(x.name)}</td><td>${x.count} КП</td><td>${stNum(Math.round(x.sum/100))} руб.</td></tr>`).join('')||'<tr><td>Нет данных</td></tr>'}</table></div>
      <div class="st-card"><p class="sub">Товары — чаще всего в КП</p><table class="pv-t">${s.products.map(x=>`<tr><td>${esc(x.name)}</td><td>${x.count}</td></tr>`).join('')||'<tr><td>Нет данных</td></tr>'}</table></div></div>
    <div class="st-cols"><div class="st-card"><p class="sub">Модерация правок</p><table class="pv-t"><tr><td>Режим</td><td>${mo.enabled?'включена':'выключена'}</td></tr>
      <tr><td>На модерации</td><td>${mo.pending}</td></tr><tr><td>Одобрено / отклонено</td><td>${mo.approved} / ${mo.rejected}</td></tr>
      <tr><td>Конверсия черновик → подтверждено</td><td>${mo.conversion==null?'—':String(mo.conversion).replace('.',',')+' %'}</td></tr></table></div>
      <div class="st-card"><p class="sub">База данных · ${stSize(s.db.bytes)}</p><table class="pv-t">${Object.entries(s.db.tables).map(([t,n])=>`<tr><td>${esc(t)}</td><td>${stNum(n)}</td></tr>`).join('')}
      <tr><td>Удалений всего / в корзине</td><td>${s.deletions.total} / ${s.deletions.trash}</td></tr></table></div></div>`;
  m.onclick=e=>{ const c=e.target.closest('[data-chart]'); if (c){ ST.chart=c.dataset.chart; stStats(m); } };
}

// ---------- обслуживание базы: копии, сжатие, срок журнала, изображения без ссылок
async function stMaint(box, r){
  if (!box) return;
  try{ r=r||await aapi('maint'); }catch(e){ box.innerHTML='<p class="sub">Обслуживание базы</p><p class="muted">Недоступно: '+esc(e.message)+'</p>'; return; }
  const b=r.backup||{}, v=r.vacuum, img=r.images, au=r.audit;
  const bline = !b.at ? '<span class="bad-t">копий ещё не было</span>'
    : b.ok ? `<span class="ok-t">${esc(stTime(b.at))} — исправна</span>` : `<span class="bad-t">${esc(stTime(b.at))} — ошибка: ${esc(b.error||'')}</span>`;
  box.innerHTML=`<div class="sub st-mh">Автоматические копии и обслуживание базы ${tip('<p>Каждый день при первом запуске (и раз в сутки, пока работает сервер отдела) программа делает копию базы и проверяет её встроенной проверкой SQLite. Хранятся копии за 7 последних дней, по одной на 4 последние недели и на 12 последних месяцев.</p><p>Раз в месяц база сжимается и проверяется. Журнал действий старше заданного срока переносится в архив (папка backup/audit-archive рядом с базой).</p>')}</div>
    <table class="pv-t">
      <tr><td>Последняя копия</td><td>${bline}</td></tr>
      <tr><td>Копий в папке</td><td>${r.copies}${r.copies?` · ${stSize(r.copiesBytes)} · с ${esc(KPGen.ruDate(r.oldest))}`:''}<br><small class="muted">${esc(r.dir)}</small></td></tr>
      <tr><td>Сжатие и проверка</td><td>${v?`${esc(stTime(v.at))} · ${stSize(v.before)} → ${stSize(v.after)} · ${v.check==='ok'?'<span class="ok-t">без ошибок</span>':'<span class="bad-t">'+esc(v.check)+'</span>'}`:'ещё не выполнялись'}</td></tr>
      <tr><td>Журнал действий</td><td>${stNum(r.auditRows)} записей${r.auditOldest?' с '+esc(KPGen.ruDate(r.auditOldest)):''} · хранить <select id="mAudY" class="st-inl" aria-label="Срок хранения журнала">${[1,2,3,5,10].map(y=>`<option value="${y}"${y===r.auditYears?' selected':''}>${y} ${y===1?'год':y<5?'года':'лет'}</option>`).join('')}</select>${au&&au.archived?` · в архиве ${stNum(au.archived)}`:''}</td></tr>
      <tr><td>Изображения без ссылок</td><td id="mImg">${img?`удалено ${img.deleted} (${stSize(img.bytes)}) — ${esc(stTime(img.at))} · `:''}<button class="btn ghost" type="button" data-mt="imgscan">Найти</button></td></tr>
    </table>
    <div class="row" style="margin-top:8px"><button class="btn" type="button" data-mt="backup">Создать копию сейчас</button><button class="btn" type="button" data-mt="run">Сжать и проверить базу</button></div>`;
  const busy=(btn,t)=>{ if (btn){ btn.disabled=true; btn.textContent=t; } };
  box.onclick=async e=>{ const t=e.target.closest('[data-mt]'); if (!t) return; const a=t.dataset.mt;
    try{
      if (a==='backup'){ busy(t,'Копирую…'); const x=await ajson('maint/backup'); toast(x.backup&&x.backup.ok?'Копия создана и проверена':'Копия не создана'); return stMaint(box, x); }
      if (a==='run'){ busy(t,'Сжимаю…'); const x=await ajson('maint/run'); toast('База сжата и проверена'); return stMaint(box, x); }
      if (a==='imgscan'){ busy(t,'Ищу…'); const x=await aapi('maint/images');
        $('#mImg').innerHTML = x.count ? `${x.count} файлов · ${stSize(x.bytes)} <button class="btn ghost" type="button" data-mt="imgdel" data-n="${x.count}">Удалить</button>${tip('<p>Файлы в папке img, на которые нет ссылок ни в каталоге, ни в КП, ни в истории версий и корзине (и которым больше месяца), а также всё из папки img/unused.</p><p>'+x.sample.map(esc).join('<br>')+(x.count>x.sample.length?'<br>…':'')+'</p>')}` : 'лишних нет'; return; }
      if (a==='imgdel'){ if (!confirm(`Удалить ${t.dataset.n} изображений без ссылок? Восстановить их можно только из резервной копии папки img.`)) return; busy(t,'Удаляю…');
        const x=await ajson('maint/images'); toast(`Удалено: ${x.deleted} (${stSize(x.bytes)})`); return stMaint(box); }
    }catch(err){ toast('Не выполнено: '+(err.message||err)); stMaint(box); } };
  const sel=$('#mAudY'); if (sel) sel.onchange=async()=>{ const y=+sel.value;
    if (y<r.auditYears && !confirm(`Записи журнала действий старше ${sel.selectedOptions[0].textContent} будут перенесены в архив (папка backup/audit-archive) и пропадут из поиска в «Журнале действий». Продолжить?`)){ sel.value=r.auditYears; return; }
    try{ const x=await ajson('maint/audit',{years:y}); toast(x.archivedNow?`В архив перенесено записей: ${x.archivedNow}`:'Срок хранения журнала сохранён'); stMaint(box, x); }catch(err){ toast('Не сохранено: '+err.message); } };
}

// ---------- модерация
async function stModeration(m){
  const r=await aapi('moderation'), on=!!r.settings.enabled, P=r.pending;
  m.innerHTML=`<div class="st-card"><div class="row"><button class="sw" type="button" role="switch" aria-checked="${on}" data-mod="toggle"><i></i>Требовать подтверждение правок товаров</button></div>
      <p class="muted" style="margin:8px 0 0">${on?'Включено: правки сотрудников сохраняются черновиком и ждут вашего решения; у товара бейдж «На модерации».':'Выключено: правки сохраняются в каталог сразу и записываются в журнал действий (там же — откат правки).'}
      ${r.settings.updatedAt?` Изменено: ${esc(stTime(r.settings.updatedAt))}.`:''}</p></div>
    <div class="row" style="margin:14px 0 8px"><p class="sub" style="margin:0">На модерации <span class="muted">${P.length}</span></p><span class="sp"></span>${P.length>1?'<button class="btn" type="button" data-mod="all">Одобрить все</button>':''}</div>
    ${P.length?P.map(p=>`<div class="st-row"><div><b>${esc(p.name)}</b><span class="muted">${p.kind==='create'?'новый товар':'изменено: '+esc(p.fields.join(', ')||'—')} · ${esc(p.userName||'—')} · ${esc(stTime(p.created))}</span>
        ${p.stale?'<span class="bad-t" style="font-size:12.5px">Товар изменён после отправки правки — проверьте перед одобрением</span>':''}</div>
        <div class="acts"><button class="btn" type="button" data-pend="${p.id}">Посмотреть</button></div></div>`).join(''):`<p class="muted">${on?'Правок, ожидающих решения, нет.':'Модерация выключена — очередь не пополняется.'}</p>`}
    ${r.history.length?`<details class="more"><summary>Рассмотренные правки (${r.history.length})</summary>${r.history.sort((a,b)=>b.id-a.id).map(p=>`<div class="st-row"><div><b>${esc(p.name)}</b><span class="muted">${p.status==='approved'?'<span class="ok-t">Одобрено</span>':'<span class="bad-t">Отклонено</span>'+(p.reason?' — '+esc(p.reason):'')} · ${esc(p.userName||'—')} · ${esc(stTime(p.reviewedAt))}</span></div></div>`).join('')}</details>`:''}
    ${r.archived.length?`<details class="more"><summary>Архив модерации (${r.archived.length})</summary>${r.archived.map(p=>`<div class="st-row"><div><b>${esc(p.name)}</b><span class="muted">${esc(p.userName||'—')} · ${esc(stTime(p.created))}</span></div></div>`).join('')}</details>`:''}`;
  m.onclick=async e=>{
    const b=e.target.closest('[data-mod],[data-pend]'); if (!b) return;
    if (b.dataset.pend) return stPendView(+b.dataset.pend);
    if (b.dataset.mod==='all'){ if (!await stConfirm(`Одобрить все правки (${P.length})?`,'Изменения сразу попадут в каталог.','Одобрить все')) return;
      await ajson('pending/approve-all'); toast('Правки одобрены'); return stModeration(m); }
    // переключение режима: при выключении с накопленными правками — что с ними сделать
    let body={enabled:!on};
    if (on && P.length){ const how=await stChoose(`Выключить модерацию? На модерации ${P.length} ${plural(P.length,'правка','правки','правок')}.`,
        [['apply','Применить все'],['reject','Отклонить все'],['archive','Оставить в архиве']]); if (!how) return; body.pending=how; }
    else if (!await stConfirm(on?'Выключить модерацию?':'Включить модерацию?', on?'Правки товаров будут сохраняться сразу (и записываться в журнал).':'Новые правки товаров будут ждать вашего одобрения. Существующие товары не меняются.', on?'Выключить':'Включить')) return;
    await ajson('moderation', body); toast(body.enabled?'Модерация включена':'Модерация выключена'); stModeration(m);
  };
}

const stVal = v => v==='__absent__' ? '<i class="muted">нет</i>' : v&&typeof v==='object'&&'__truncated__' in v ? `<i class="muted">большое значение (${v.__truncated__} знаков)</i>`
  : `<pre>${esc(typeof v==='string'?v:JSON.stringify(v,null,1))}</pre>`;

async function stPendView(id){
  const p=await aapi('pending/'+id), d=$('#dlg'); d.classList.add('wide');
  d.innerHTML=`<div class="dlg-h"><h3>Правка товара: ${esc(p.productId)}</h3><button class="icon" type="button" data-close aria-label="Закрыть">✕</button></div>
   <div class="dlg-b"><p class="muted" style="margin-top:0">${p.kind==='create'?'Новый товар':'Изменение'} · ${esc(p.userName||'—')} · ${esc(stTime(p.created))}${p.current?'':' · товара сейчас нет в каталоге'}</p>
   <table class="st-diff"><tr><th>Поле</th><th>Было</th><th>Стало</th></tr>${p.diff.map(x=>`<tr><td>${esc(x.label)}</td><td>${stVal(x.before)}</td><td>${stVal(x.after)}</td></tr>`).join('')||'<tr><td colspan="3">Отличий нет</td></tr>'}</table>
   ${p.status==='pending'?`<label class="f" style="margin-top:12px"><span>Причина отклонения</span><input type="text" id="pReason" placeholder="Например: неверные характеристики"></label>
   <div class="row" style="justify-content:flex-end;margin-top:12px"><button class="btn danger" type="button" data-pa="reject">Отклонить</button><button class="btn primary" type="button" data-pa="approve">Одобрить</button></div>`:''}</div>`;
  d.showModal(); d.querySelector('[data-close]').onclick=()=>{ d.close(); d.classList.remove('wide'); };
  d.querySelector('.dlg-b').onclick=async e=>{ const b=e.target.closest('[data-pa]'); if(!b) return;
    const reason=$('#pReason').value.trim(); if (b.dataset.pa==='reject' && !reason) return toast('Укажите причину отклонения');
    await ajson(`pending/${id}/${b.dataset.pa}`,{reason}); d.close(); d.classList.remove('wide');
    toast(b.dataset.pa==='approve'?'Одобрено — изменения в каталоге':'Отклонено'); refreshCat(); stTab(); };
}

// ---------- удаление (в корзину)
async function stDelete(m){
  const D=ST.del, r=await aapi(`list/${D.type}?q=${encodeURIComponent(D.q)}`);
  m.innerHTML=`<div class="seg st-types">${DEL_TYPES.map(([v,l])=>`<button type="button" class="${D.type===v?'on':''}" data-dtype="${v}">${l}</button>`).join('')}</div>
    <div class="row st-dbar"><input type="search" id="dQ" placeholder="Поиск" value="${esc(D.q)}" autocomplete="off"><span class="muted">${r.total>r.items.length?`показано ${r.items.length} из ${r.total} — уточните поиск`:`найдено: ${r.total}`}</span>
      <span class="sp"></span><button class="btn danger" type="button" data-del ${D.sel.size?'':'disabled'}>Удалить${D.sel.size?' ('+D.sel.size+')':''}</button></div>
    <div class="st-list">${r.items.map(x=>`<label class="st-row ck-row"><input type="checkbox" data-did="${esc(x.id)}" ${D.sel.has(x.id)?'checked':''}><div><b>${esc(x.title)}</b><span class="muted">${esc(x.sub)}</span></div><div class="acts"><button class="btn" type="button" data-dedit="${esc(x.id)}">${D.type==='kp'?'Открыть':'Изменить'}</button></div></label>`).join('')||'<p class="muted">Ничего не найдено.</p>'}</div>
    <p class="muted">«${D.type==='kp'?'Открыть':'Изменить'}» — ${({kp:'КП откроется в конструкторе для правки', catalog:'карточка товара в редакторе каталога', manager:'контакты менеджера', client:'реквизиты клиента', supplier:'условия поставщика'})[D.type]}. Удалённое попадает в корзину и хранится ${30} дней — его можно восстановить. Файлы готовых КП (.docx, .pdf) в папке КП не удаляются.</p>`;
  let qT; $('#dQ').oninput=e=>{ D.q=e.target.value; clearTimeout(qT); qT=setTimeout(()=>stDelete(m).then(()=>{ const i=$('#dQ'); i.focus(); i.setSelectionRange(i.value.length,i.value.length); }),250); };
  m.onchange=e=>{ const c=e.target.closest('[data-did]'); if(!c) return; c.checked?D.sel.add(c.dataset.did):D.sel.delete(c.dataset.did);
    const b=m.querySelector('[data-del]'); b.disabled=!D.sel.size; b.textContent='Удалить'+(D.sel.size?' ('+D.sel.size+')':''); };
  m.onclick=async e=>{ const t=e.target.closest('[data-dtype]'); if (t){ D.type=t.dataset.dtype; D.sel.clear(); D.q=''; return stDelete(m); }
    const ed=e.target.closest('[data-dedit]'); if (ed){ e.preventDefault(); try{ await stEdit(D.type, ed.dataset.dedit, ()=>stDelete(m)); }catch(err){ toast(err.message||String(err)); } return; }
    if (!e.target.closest('[data-del]')) return;
    const n=D.sel.size, label=(DEL_TYPES.find(x=>x[0]===D.type)||[])[1];
    if (!await stConfirm(`Удалить? ${label}: ${n}`,'Записи будут в корзине 30 дней (их можно восстановить), затем удалятся окончательно.','Удалить')) return;
    const res=await ajson('delete',{type:D.type, ids:[...D.sel]}); D.sel.clear(); toast(`Удалено: ${res.deleted}`);
    if (D.type==='catalog') refreshCat(); if (D.type==='manager') loadManagers().then(renderForm); stDelete(m); };
}

// правка записи из «Настроек»: КП — в конструкторе, товар — в редакторе каталога, остальное — формой
const ST_EDIT = {
  manager: [['name','ФИО'],['position','Должность'],['phone','Телефон'],['ext','Добавочный'],['mobile','Мобильный'],['email','E-mail'],['site','Сайт'],['address','Адрес'],['hours','Часы работы']],
  client: [['name','Краткое наименование'],['full','Полное наименование'],['inn','ИНН'],['kpp','КПП'],['ogrn','ОГРН'],['address','Юридический адрес','','textarea'],['director','Руководитель'],['directorPost','Должность руководителя']],
  supplier: [['name','Поставщик'],['country','Страна'],['cur','Валюта (RUB, USD, EUR, CNY)'],['adv','Аванс поставщику, %'],['prod','Срок изготовления, дней'],['ship','Срок доставки, дней'],['ins','Страхование, %'],['fx','Комиссия за перевод, %']],
};
async function stEdit(type, id, after){
  const J={'Content-Type':'application/json; charset=utf-8'};
  if (type==='kp'){ const st=await api(`/api/kp/${encodeURIComponent(id)}/state`); S=Object.assign(freshState(), st); setDlg().close(); renderForm(); persist(); window.scrollTo({top:0}); toast('КП № '+(S.number||'')+' открыто для редактирования'); return; }
  if (type==='catalog'){ const doc=await api('/api/catalog/'+encodeURIComponent(id)); openCatEditor(doc, ()=>{ refreshCat(); after(); }); return; }
  const src = type==='manager' ? (await api('/api/managers')).find(x=>x.id===id) : type==='client' ? await api('/api/clients/'+encodeURIComponent(id)) : (await api('/api/suppliers')).find(x=>x.id===id);
  if (!src) throw new Error('Запись не найдена');
  const v=await stForm(({manager:'Менеджер',client:'Клиент',supplier:'Поставщик'})[type]+': '+(src.name||id), ST_EDIT[type].map(([k,l,_,t])=>[k,l,src[k]??'',t]));
  if (!v) return;
  if (!v.name) throw new Error('Название (ФИО) не может быть пустым');
  const doc={...src, ...v};
  if (type==='manager'){ await api('/api/managers/'+encodeURIComponent(id),{method:'PUT',headers:{...J,...(src._rev!=null?{'X-KP-Rev':String(src._rev)}:{})},body:JSON.stringify(Object.fromEntries(MGR_KEYS.map(k=>[k,doc[k]??''])))}); loadManagers().then(renderForm); }
  if (type==='client') await api('/api/clients/'+encodeURIComponent(id),{method:'PUT',headers:J,body:JSON.stringify(doc)});
  if (type==='supplier'){ delete doc.id; delete doc.updatedAt; await api('/api/suppliers/'+encodeURIComponent(id),{method:'PUT',headers:J,body:JSON.stringify(doc)}); if (typeof DL!=='undefined') DL.sups=null; }
  toast('Сохранено'); after();
}

async function stTrash(m){
  const r=await aapi('trash');
  m.innerHTML=`<p class="muted" style="margin-top:0">Удалённое хранится ${r.days} дней, затем удаляется окончательно.</p>
    ${r.items.map(x=>`<div class="st-row"><div><b>${esc(x.title||x.entityId)}</b><span class="muted">${esc(ENT[x.entityType]||x.entityType)} · удалено ${esc(stTime(x.deletedAt))}</span></div>
      <div class="acts"><button class="btn" type="button" data-rest="${x.id}">Восстановить</button></div></div>`).join('')||'<p class="muted">Корзина пуста.</p>'}`;
  m.onclick=async e=>{ const b=e.target.closest('[data-rest]'); if(!b) return;
    try{ await ajson(`trash/${b.dataset.rest}/restore`); toast('Восстановлено'); refreshCat(); loadManagers(); }catch(err){ toast(err.message); } stTrash(m); };
}

// ---------- журнал действий
async function stAudit(m){
  const A=ST.audit, F=A.f;
  const [r, fl]=await Promise.all([aapi('audit?'+new URLSearchParams({...F, page:A.page})), A.fl||aapi('audit/filters')]); A.fl=fl;
  const sel=(k,list,lab,map)=>`<select data-af="${k}" aria-label="${lab}"><option value="">${lab}</option>${list.map(v=>`<option value="${esc(v)}"${F[k]===v?' selected':''}>${esc((map&&map[v])||v)}</option>`).join('')}</select>`;
  const pages=Math.max(1,Math.ceil(r.total/50));
  m.innerHTML=`<div class="st-filters">${sel('user',fl.users,'Все пользователи')}${sel('action',fl.actions,'Все действия',ACT)}${sel('entity',fl.entities,'Все объекты',ENT)}
      <input type="date" data-af="from" value="${esc(F.from||'')}" aria-label="С даты"><input type="date" data-af="to" value="${esc(F.to||'')}" aria-label="По дату">
      <input type="search" data-af="q" value="${esc(F.q||'')}" placeholder="Поиск: id, имя, значение" autocomplete="off"></div>
    <p class="muted">Записей: ${stNum(r.total)}</p>
    <div class="st-list">${r.items.map(x=>`<details class="st-log ${x.result==='failed'?'fail':''}"><summary><span class="t">${esc(stTime(x.timestamp))}</span><b>${esc(ACT[x.action]||x.action)}</b>
        <span class="muted">${esc(ENT[x.entityType]||x.entityType||'')} ${esc(x.entityId||'')}</span><span class="u">${esc(x.userName||'')}${x.userRole==='admin'?' · админ':''}</span>${x.result==='failed'?'<span class="bad-t">отклонено</span>':''}</summary>
        <div class="st-logb">${x.before||x.after?`<table class="st-diff"><tr><th>Поле</th><th>Было</th><th>Стало</th></tr>${[...new Set([...Object.keys(x.before||{}),...Object.keys(x.after||{})])].map(k=>`<tr><td>${esc(k)}</td><td>${x.before&&k in x.before?stVal(x.before[k]):''}</td><td>${x.after&&k in x.after?stVal(x.after[k]):''}</td></tr>`).join('')}</table>`:''}
        <p class="muted">IP ${esc(x.ip||'—')} · ${esc(x.userAgent||'')}</p>
        ${['edit_product','approve_edit'].includes(x.action)&&x.before?`<button class="btn" type="button" data-rb="${x.id}">Откатить эту правку</button>`:''}</div></details>`).join('')||'<p class="muted">Записей нет.</p>'}</div>
    ${pages>1?`<div class="row st-pg"><button class="btn" type="button" data-pg="-1" ${A.page?'':'disabled'}>← Новее</button><span class="muted">стр. ${A.page+1} из ${pages}</span><button class="btn" type="button" data-pg="1" ${A.page+1<pages?'':'disabled'}>Старее →</button></div>`:''}`;
  let qT;
  m.onchange=e=>{ const t=e.target.closest('[data-af]'); if (t && t.type!=='search'){ F[t.dataset.af]=t.value; A.page=0; stAudit(m); } };
  m.oninput=e=>{ const t=e.target.closest('[data-af]'); if (t && t.type==='search'){ F.q=t.value; A.page=0; clearTimeout(qT); qT=setTimeout(()=>stAudit(m),300); } };
  m.onclick=async e=>{ const p=e.target.closest('[data-pg]'); if (p){ A.page+= +p.dataset.pg; return stAudit(m); }
    const rb=e.target.closest('[data-rb]'); if (!rb) return;
    if (!await stConfirm('Откатить правку?','Изменённые этой правкой поля товара вернутся к прежним значениям.','Откатить')) return;
    try{ await ajson(`audit/${rb.dataset.rb}/rollback`); toast('Правка откачена'); refreshCat(); A.fl=null; stAudit(m); }catch(err){ toast(err.message); } };
}

// ---------- резервные копии
async function stBackup(m){
  const hist=await aapi('audit?'+new URLSearchParams({action:'export_db'})), hi=await aapi('audit?'+new URLSearchParams({action:'import_db'}));
  const ops=[...hist.items, ...hi.items].sort((a,b)=>b.id-a.id).slice(0,15);
  const secs=[['catalog','Каталог'],['kp','КП (журнал)'],['managers','Менеджеры'],['clients','Клиенты'],['audit','Журнал действий'],['settings','Категории и настройки']];
  m.innerHTML=`<div class="st-card" id="stMaint"><p class="sub">Автоматические копии и обслуживание базы</p><p class="muted">Загружаю…</p></div>
    <div class="st-card"><p class="sub">Экспорт</p>
      <div class="chips">${secs.map(([v,l])=>`<label class="chk-chip"><input type="checkbox" data-xs="${v}" checked> ${l}</label>`).join('')}</div>
      <div class="row" style="margin-top:10px"><button class="btn primary" type="button" data-x="json">Скачать (.json)</button><button class="btn" type="button" data-x="sqlite">Полная копия базы (.sqlite3)</button></div>
      <p class="muted">.json — выбранные разделы (без изображений), можно загрузить обратно. .sqlite3 — файл базы целиком.</p></div>
    <div class="st-card"><p class="sub">Импорт</p><input type="file" id="impF" accept=".json,application/json" class="sr-file"><label for="impF" class="btn">Выбрать файл резервной копии…</label>
      <div id="impP"></div></div>
    <div class="st-card"><p class="sub">История</p>${ops.map(x=>`<div class="st-row"><div><b>${esc(ACT[x.action])}</b><span class="muted">${esc(stTime(x.timestamp))} · ${esc(x.entityId||'')}${x.after&&x.after.bytes?' · '+stSize(x.after.bytes):''}</span></div></div>`).join('')||'<p class="muted">Операций ещё не было.</p>'}</div>`;
  stMaint($('#stMaint'));
  m.onclick=async e=>{ const x=e.target.closest('[data-x]'); if (x){
      const secs2=[...m.querySelectorAll('[data-xs]:checked')].map(c=>c.dataset.xs); if (x.dataset.x==='json' && !secs2.length) return toast('Отметьте разделы');
      const url = x.dataset.x==='json' ? 'export?sections='+secs2.join(',') : 'export/sqlite';
      const r=await fetch('/api/admin/'+url,{headers:{'X-CSRF-Token':ADMIN.csrf}}); if (!r.ok) return toast(await r.text());
      const fn=decodeURIComponent((r.headers.get('Content-Disposition')||'').split("''")[1]||'backup');
      saveFileA(fn, await r.blob()); setTimeout(()=>stBackup(m),800); return; }
    const ap=e.target.closest('[data-imp]'); if (ap && ST.imp){
      if (!await stConfirm('Загрузить данные из резервной копии?','Перед загрузкой программа сохранит копию текущей базы. Записи с теми же id будут заменены, новые — добавлены, ничего не удаляется.','Загрузить')) return;
      await aapi('import?sections='+ap.dataset.imp,{method:'POST',headers:{'Content-Type':'application/json; charset=utf-8'},body:ST.imp});
      ST.imp=null; toast('Загружено'); refreshCat(); loadManagers(); loadClients(); stBackup(m); } };
  $('#impF').onchange=async e=>{ const f=e.target.files[0]; if (!f) return; const box=$('#impP'); box.innerHTML='<p class="muted">Проверяю…</p>';
    try{ ST.imp=await f.text(); const r=await aapi('import/preview',{method:'POST',headers:{'Content-Type':'application/json; charset=utf-8'},body:ST.imp});
      const names={catalog:'Каталог',kp:'КП',managers:'Менеджеры',clients:'Клиенты',settings:'Категории и настройки'};
      box.innerHTML=`<p class="muted">Копия от ${esc(stTime(r.createdAt))}. Будет:</p><table class="pv-t">${Object.entries(r.report).map(([k,v])=>`<tr><td>${names[k]||k}</td><td>новых ${v.new}, заменится ${v.updated}${v.invalid?`, <span class="bad-t">с ошибками ${v.invalid}</span>`:''}</td></tr>`).join('')}</table>
        ${r.errors.length?`<p class="msg err" style="text-align:left">${r.errors.map(esc).join('<br>')}</p>`:''}
        <button class="btn primary" type="button" data-imp="${Object.keys(r.report).join(',')}" style="margin-top:10px">Загрузить</button>`; }
    catch(err){ ST.imp=null; box.innerHTML=`<p class="msg err" style="text-align:left">${esc(err.message)}</p>`; } };
}

// ---------- шаблоны, категории, ключи, пароль
async function stTemplates(m){
  m.innerHTML=`<div class="st-card"><p class="sub">Шаблоны КП</p>${TEMPLATES.map(t=>`<div class="st-row"><div><b>${esc(t.name)}</b><span class="muted">${esc(t.description||t.id)}${t.error?' · <span class="bad-t">'+esc(t.error)+'</span>':''}</span></div>
      <div class="acts">${t.error?'':`<button class="btn primary" type="button" data-tdes="${esc(t.id)}" title="Документ как в Word: щёлкните текст или картинку и меняйте шрифт, цвет, размеры, порядок разделов">Графический редактор</button>`}<button class="btn" type="button" data-tpl="${esc(t.id)}">Настроить</button></div></div>`).join('')}
      <div class="row" style="margin-top:10px"><button class="btn" type="button" data-tnew>+ Новый шаблон для компании…</button><button class="btn ghost" type="button" data-tfold>Папка шаблонов</button></div></div>
    <div class="st-card"><p class="sub">Категории оборудования</p><p class="muted">Параметры, фильтры, группы характеристик. Удалить свою категорию или вернуть стандартные можно только отсюда (при входе в «Настройки»).</p>
      <button class="btn" type="button" data-types>Открыть категории</button></div>`;
  m.onclick=e=>{ const t=e.target.closest('[data-tpl]'); if (t) return openTemplateEditor(t.dataset.tpl);
    const g=e.target.closest('[data-tdes]'); if (g) return openTemplateDesigner(g.dataset.tdes);
    if (e.target.closest('[data-tnew]')) return tdNewCompany().catch(err=>toast('Не получилось: '+(err.message||err)));
    if (e.target.closest('[data-tfold]')) return api('/api/templates/folder',{method:'POST'}).then(r=>{ if(r&&r.remote) toast('Шаблоны лежат на компьютере-сервере, в папке программы «templates»'); }).catch(err=>toast(err.message));
    if (e.target.closest('[data-types]')) openTypesEditor(); };
}

async function stKeys(m){
  m.innerHTML=`<div class="st-card"><p class="sub">Ключи API</p><p class="muted">Checko и DaData — реквизиты и проверка контрагентов; ConvertAPI — PDF, если на сервере нет Word и LibreOffice.</p>
    <button class="btn primary" type="button" data-keys>Изменить ключи</button></div>`;
  m.onclick=e=>{ if (e.target.closest('[data-keys]')) openIntegrations(); };
}

async function stSecurity(m){
  const mg=await aapi('migrations');
  m.innerHTML=`<div class="st-card"><form id="pwF" autocomplete="off"><p class="sub">Сменить свой пароль${(ST.status||{}).login?` (${esc(ST.status.login)})`:''}</p>
      <div class="grid g2"><label class="f"><span>Текущий пароль</span><input type="password" id="pwO" autocomplete="current-password" required></label>
      <label class="f"><span>Новый пароль</span><input type="password" id="pwN" autocomplete="new-password" required></label></div>
      <p class="msg err" id="pwE" style="text-align:left"></p><button class="btn primary" type="submit">Сменить пароль</button></form></div>
    <div class="st-card"><p class="sub">Доступ</p><p class="muted">Вход закрывается через ${(ST.status||{}).idleMinutes||15} минут бездействия. Пять неверных паролей за 10 минут — пауза 10 минут.
      Пароль другого администратора меняется во вкладке «Администраторы». Забыли пароль все администраторы: на компьютере, где работает программа, создайте файл <b>data\\admin-reset.txt</b> и перезапустите программу — учётные записи администраторов удалятся, создайте новую здесь.</p></div>
    <details class="more"><summary>Миграции базы (для обслуживания)</summary>${mg.applied.map(id=>`<div class="st-row"><div><b>${esc(id)}</b><span class="muted">применена</span></div>
      <div class="acts"><button class="btn danger" type="button" data-mdown="${esc(id)}">Откатить</button></div></div>`).join('')||'<p class="muted">Нет применённых миграций.</p>'}
      <p class="muted">Откат удаляет таблицы журнала действий, корзины и модерации (перед этим — копия базы в data\\backup). При следующем запуске программы миграция применится снова.</p></details>`;
  $('#pwF').onsubmit=async e=>{ e.preventDefault();
    try{ await ajson('password',{old:$('#pwO').value, new:$('#pwN').value}); toast('Пароль изменён'); stSecurity(m); }catch(err){ $('#pwE').textContent=err.message; } };
  m.onclick=async e=>{ const b=e.target.closest('[data-mdown]'); if (!b) return;
    if (!await stConfirm('Откатить миграцию?','Журнал действий, корзина и правки на модерации будут удалены. Перед этим сохраняется копия базы.','Откатить')) return;
    await ajson(`migrations/${b.dataset.mdown}/down`); toast('Миграция откачена'); stSecurity(m); };
}

// ---------- администраторы: логин, имя, пароль
async function stUsers(m){
  const r=await aapi('users');
  m.innerHTML=`<div class="st-card"><p class="sub">Администраторы · ${r.items.length}</p>
    ${r.items.map(u=>`<div class="st-row" data-ulogin="${esc(u.login)}"><div><b>${esc(u.name||u.login)}</b><span class="muted">логин <b>${esc(u.login)}</b>${u.login===r.me?' · это вы':''} · создан ${esc(stTime(u.created))}${u.by?' ('+esc(u.by)+')':''}${u.lastLogin?' · последний вход '+esc(stTime(u.lastLogin)):''}</span></div>
      <div class="acts"><button class="btn" type="button" data-uact="edit">Изменить</button><button class="btn" type="button" data-uact="password">Пароль</button>${r.items.length>1&&u.login!==r.me?'<button class="btn danger" type="button" data-uact="delete">Удалить</button>':''}</div></div>`).join('')}</div>
    <div class="st-card"><form id="uAdd" autocomplete="off"><p class="sub">Добавить администратора</p>
      <div class="grid g3"><label class="f"><span>Логин</span><input type="text" id="uL" required placeholder="ivanov" autocomplete="off"></label>
      <label class="f"><span>Имя</span><input type="text" id="uN" placeholder="Иванов И. И."></label>
      <label class="f"><span>Пароль</span><input type="password" id="uP" required autocomplete="new-password" placeholder="не короче 8, буквы и цифры"></label></div>
      <p class="msg err" id="uE" style="text-align:left"></p><button class="btn primary" type="submit">Добавить</button></form>
      <p class="muted">Каждый администратор входит под своим логином; в журнале действий видно, кто что изменил.</p></div>`;
  $('#uAdd').onsubmit=async e=>{ e.preventDefault();
    try{ await ajson('users',{action:'add', login:$('#uL').value.trim(), name:$('#uN').value.trim(), password:$('#uP').value}); toast('Администратор добавлен'); stUsers(m); }catch(err){ $('#uE').textContent=err.message; } };
  m.onclick=async e=>{ const b=e.target.closest('[data-uact]'); if (!b) return; const login=b.closest('[data-ulogin]').dataset.ulogin, u=r.items.find(x=>x.login===login), a=b.dataset.uact;
    try{
      if (a==='delete'){ if (!await stConfirm(`Удалить администратора ${login}?`,'Он больше не сможет войти в «Настройки». Записи журнала действий сохранятся.','Удалить')) return;
        await ajson('users',{action:'delete', login}); toast('Удалён'); }
      if (a==='edit'){ const v=await stForm(`Изменить: ${login}`, [['newLogin','Логин',u.login],['name','Имя',u.name||'']]); if (!v) return;
        await ajson('users',{action:'edit', login, newLogin:v.newLogin, name:v.name}); toast('Сохранено');
        if (login===r.me){ ST.status={...ST.status, login:v.newLogin, name:v.name||v.newLogin}; } }
      if (a==='password'){ const v=await stForm(`Новый пароль: ${login}`, [['password','Новый пароль (не короче 8, буквы и цифры)','','password']]); if (!v) return;
        await ajson('users',{action:'password', login, password:v.password}); toast('Пароль изменён'); }
      stUsers(m);
    }catch(err){ toast(err.message||String(err)); } };
}

// форма из нескольких полей поверх «Настроек»: fields [[ключ, подпись, значение, тип]] → {ключ: значение} или null
function stForm(title, fields){
  return new Promise(res=>{ const d=document.createElement('dialog'); d.className='st-confirm st-form';
    d.innerHTML=`<form method="dialog"><h3>${esc(title)}</h3>${fields.map(([k,l,v,t])=>`<label class="f"><span>${esc(l)}</span>${t==='textarea'?`<textarea data-k="${k}" rows="3">${esc(v??'')}</textarea>`:`<input type="${t||'text'}" data-k="${k}" value="${esc(v??'')}" autocomplete="off">`}</label>`).join('')}
      <div class="row"><button class="btn" type="button" data-v="0">Отмена</button><button class="btn primary" type="submit">Сохранить</button></div></form>`;
    document.body.appendChild(d); d.showModal(); d.querySelector('[data-k]')?.focus();
    const done=v=>{ d.close(); d.remove(); res(v); };
    d.addEventListener('cancel',e=>{ e.preventDefault(); done(null); });
    d.querySelector('[data-v="0"]').onclick=()=>done(null);
    d.querySelector('form').onsubmit=e=>{ e.preventDefault(); const o={}; d.querySelectorAll('[data-k]').forEach(i=>{ o[i.dataset.k]=i.value.trim(); }); done(o); }; });
}

// ---------- окно подтверждения и выбора (поверх «Настроек»)
function stModal(html){ return new Promise(res=>{ const d=document.createElement('dialog'); d.className='st-confirm'; d.innerHTML=html; document.body.appendChild(d); d.showModal();
  const done=v=>{ d.close(); d.remove(); res(v); }; d.addEventListener('cancel',e=>{ e.preventDefault(); done(null); });
  d.onclick=e=>{ const b=e.target.closest('[data-v]'); if (b) done(b.dataset.v==='0'?null:b.dataset.v); }; }); }

const stConfirm = (title, text, ok) => stModal(`<h3>${esc(title)}</h3><p>${esc(text)}</p><div class="row"><button class="btn" type="button" data-v="0">Отмена</button><button class="btn primary${/Удал|Откат/.test(ok)?' danger-bg':''}" type="button" data-v="1">${esc(ok)}</button></div>`);

const stChoose = (title, opts) => stModal(`<h3>${esc(title)}</h3><div class="st-choose">${opts.map(([v,l])=>`<button class="btn" type="button" data-v="${v}">${esc(l)}</button>`).join('')}<button class="btn ghost" type="button" data-v="0">Отмена</button></div>`);

document.addEventListener('click', e=>{
  const d=e.target.closest('#setdlg'); if (!d) return;
  const t=e.target.closest('[data-sttab]'); if (t){ ST.tab=t.dataset.sttab; d.querySelectorAll('[data-sttab]').forEach(b=>b.classList.toggle('on',b===t)); return stTab(); }
  const a=e.target.closest('[data-st]'); if (!a) return;
  if (a.dataset.st==='close') return d.close();
  if (a.dataset.st==='logout') ajson('logout').catch(()=>{}).then(()=>{ ADMIN.on=false; ADMIN.csrf=''; stRender(); toast('Вы вышли из «Настроек»'); });
});
