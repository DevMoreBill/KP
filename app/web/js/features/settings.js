// «Настройки» — админ-панель под паролем администратора (сервер: app/admin.py). Разделы и вкладки — AdminNav:
// обзор, КП и документы, каталог, клиенты и поставщики, расчёты и нормы, вид и возможности, сотрудники и вход,
// внешние сервисы, обслуживание (первая вкладка — карта «Что где»). Сессия — 15 минут бездействия.
'use strict';

const ST = { tab:'home', del:{type:'kp', q:'', sel:new Set()}, audit:{page:0, f:{}}, imp:null, chart:'day' };

// Разделы «Настроек» по предметной области: что смотрим → с чем работает отдел (КП, каталог, справочники) → как ведёт себя
// программа → внешние сервисы → кто входит → обслуживание. У вкладки: ключ, название, пояснение (под заголовком) и обработчик.
class AdminNav {
  static GROUPS = [
    {title:'Обзор', desc:'Что происходит в программе: сводка, кто что делал, что изменено в настройках.', tabs:[
      {key:'home', label:'Что где', hint:'Карта «Настроек»: все разделы с пояснениями — с чего начать и где что меняется.', open:m=>AdminNav.home(m)},
      {key:'stats', label:'Сводка и статистика', hint:'КП по периодам, активные менеджеры, популярные товары, «требует внимания», размер базы.', open:m=>stStats(m)},
      {key:'audit', label:'Журнал действий', hint:'Кто, что и когда сделал: КП, каталог, справочники, настройки. Фильтры по сотруднику, действию и дате.', open:m=>stAudit(m)},
      {key:'changed', label:'Что изменено в настройках', hint:'Всё, что отличается от программы по умолчанию, одним списком: открыть или вернуть как было.', open:m=>new ChangedPanel(m).open()},
      {key:'history', label:'История изменений настроек', hint:'Кто, когда и что поменял в настройках; «Вернуть как было» отменяет любую правку.', open:m=>new SettingsHistoryPanel(m).open()}]},
    {title:'КП и документы', desc:'Как выглядит КП и что с ним происходит после сохранения.', tabs:[
      {key:'templates', label:'Шаблоны КП', hint:'Оформление документа КП: графический редактор, настройки шаблона, новый шаблон для другой компании.', open:m=>stTemplates(m)},
      {key:'db-kp', label:'Сохранённые КП', hint:'Все сохранённые КП: найти, открыть для правки, удалить в корзину. Файлы готовых КП в папке не удаляются.', open:m=>stDelete(m, 'kp')},
      {key:'mail', label:'Почта для отправки КП', hint:'Почтовый сервер (SMTP) и текст письма по умолчанию — для кнопки «Отправить КП клиенту».', open:m=>stMail(m)}]},
    {title:'Каталог оборудования', desc:'Товары, их категории и загрузка данных от поставщиков.', tabs:[
      {key:'db-catalog', label:'Товары', hint:'Карточки каталога: найти, изменить в редакторе, удалить в корзину.', open:m=>stDelete(m, 'catalog')},
      {key:'types', label:'Категории и характеристики', hint:'Параметры, фильтры и группы характеристик каждой категории оборудования.', open:m=>stTypes(m)},
      {key:'feeds', label:'Фиды поставщиков', hint:'Загрузка прайсов, остатков и описаний поставщиков в каталог: РРЦ, наличие, сетка скидок.', open:m=>stFeeds(m)},
      {key:'moderation', label:'Модерация правок', hint:'Правки товаров сотрудниками — сразу в каталог или после вашего подтверждения.', open:m=>stModeration(m)}]},
    {title:'Клиенты и поставщики', desc:'Справочники, из которых подставляются реквизиты и адреса.', tabs:[
      {key:'db-client', label:'Клиенты', hint:'Реквизиты, контакты и объекты клиентов; загрузка списком ИНН.', open:m=>stDelete(m, 'client')},
      {key:'db-supplier', label:'Поставщики и склады', hint:'Условия, реквизиты, склады (адрес отгрузки), режим работы, контакты и оборудование поставщиков.', open:m=>stDelete(m, 'supplier')}]},
    {title:'Расчёты и нормы', desc:'Числа, с которыми программа считает: экономику сделки, доставку, станции.', tabs:[
      {key:'defaults', label:'Значения программы', hint:'Все числа и умолчания по разделам: новое КП, экономика сделки, логистика, каталог, сервер — с пояснениями, границами и поиском.', open:m=>stDefaults(m)},
      {key:'logistics', label:'Тарифы доставки', hint:'Ставки перевозки по России: машины, расстояния, разгрузка, страхование, агент; загрузка файлом.', open:m=>FreightSettings.open(m)},
      {key:'china', label:'Доставка из Китая', hint:'Только для администратора: расчёт перевозки Китай → граница РФ по ATI.SU и ставкам экспедиторов (фура, контейнер, негабарит, сборный груз), в рублях по курсу ЦБ.', open:m=>ChinaFreightTab.render(m)},
      {key:'rules', label:'Нормы станций (инженерные правила)', hint:'Отступы, проходы, ворота, вентиляция, отопление, ресиверы и все расчёты станций в контейнере: значение, источник, пределы.', open:m=>new RulesPanel(m).open()}]},
    {title:'Вид и возможности', desc:'Что видят менеджеры: включённые функции, списки выбора, надписи.', tabs:[
      {key:'features', label:'Функции программы', hint:'Какие возможности включены и кому доступны: всем, администратору или выбранным менеджерам.', open:m=>new FeaturesPanel(m).open()},
      {key:'lists', label:'Списки выбора', hint:'Варианты в выпадающих списках: условия, причины проигрыша, единицы и т. п. — добавить, убрать, переименовать.', open:m=>stLists(m)},
      {key:'texts', label:'Тексты интерфейса', hint:'Свои надписи и подсказки вместо стандартных.', open:m=>stTexts(m)}]},
    {title:'Сотрудники и вход', desc:'Кто работает в программе и что ему можно.', tabs:[
      {key:'db-manager', label:'Менеджеры: контакты', hint:'Имя, должность, телефон, почта менеджера — то, что попадает в КП.', open:m=>stDelete(m, 'manager')},
      {key:'access', label:'Менеджеры: вход и права', hint:'Вход в конструктор по логину и паролю; права: оборудование, чужие КП, экономика сделки.', open:m=>AccessPanel.open(m)},
      {key:'users', label:'Администраторы', hint:'Кто входит в «Настройки»: добавить, изменить, сменить пароль.', open:m=>stUsers(m)},
      {key:'security', label:'Мой пароль', hint:'Смена своего пароля и правила входа.', open:m=>stSecurity(m)}]},
    {title:'Внешние сервисы', desc:'Подключения к интернет-сервисам и их ключи.', tabs:[
      {key:'connections', label:'Проверка подключений', hint:'Все внешние сервисы одной кнопкой: почта, нейросеть, ЦБ, контрагенты, перевозчики, GitHub, фиды, PDF.', open:m=>new ConnectionsPanel(m).open()},
      {key:'ai', label:'Нейросеть', hint:'Нейросеть прямо в программе для «Заполнить с ИИ» и описания станции: ключ, модель, расход.', open:m=>stAi(m)},
      {key:'keys', label:'Ключи API', hint:'Проверка контрагентов (Checko, OFData, DaData), перевозчики, PDF; резервная копия ключей.', open:m=>stKeys(m)}]},
    {title:'Обслуживание', desc:'Обновления, копии базы, корзина и состояние компьютера-сервера.', tabs:[
      {key:'updates', label:'Обновления программы', hint:'Новая версия: проверить на GitHub и установить одной кнопкой или из файла; откат; история установок.', open:m=>AdminSystem.updates(m)},
      {key:'backup', label:'Копии и база', hint:'Автоматические копии и вторая папка для них, сжатие и проверка базы, выгрузка и загрузка.', open:m=>stBackup(m)},
      {key:'trash', label:'Корзина', get hint(){ return `Удалённое хранится ${DEFN('srv.trashDays', 30)} дн. — здесь его можно восстановить.`; }, open:m=>stTrash(m)},
      {key:'system', label:'Система', hint:'Версия, режим работы, адрес, папки, место на диске; перезапуск программы.', open:m=>AdminSystem.system(m)}]}];
  // прежние ключи вкладок (ссылки из других окон, сохранённый выбор)
  static ALIAS = {delete:'db-kp'};
  static START = 'home';   // вкладка при первом открытии — карта «Настроек»

  static tabs(){ return this.GROUPS.flatMap(g=>g.tabs); }
  static key(k){ k=this.ALIAS[k]||k; return this.tabs().some(t=>t.key===k) ? k : this.START; }
  static tab(k){ return this.tabs().find(t=>t.key===this.key(k)); }
  /** «Раздел → Вкладка» — где вкладка в «Настройках» (для поиска и подсказок) */
  static path(k){ const t=this.tab(k), g=this.GROUPS.find(x=>x.tabs.includes(t)); return g ? g.title+' → '+t.label : t.label; }
  static html(cur){ return `<nav class="st-nav">${SettingsSearch.html()}${this.GROUPS.map(g=>`<span class="st-ng">${esc(g.title)}</span>${g.tabs.map(t=>`<button type="button" class="${t.key===cur?'on':''}" data-sttab="${t.key}" title="${esc(t.hint)}">${esc(t.label)}</button>`).join('')}`).join('')}</nav>`; }
  /** «Что где»: все разделы плитками — название, для чего, вкладки с пояснениями (щелчок открывает вкладку) */
  static home(m){
    m.innerHTML=`<div class="st-home">${this.GROUPS.filter(g=>g.tabs.some(t=>t.key!=='home')).map(g=>`<section class="st-card st-hg"><p class="sub">${esc(g.title)}</p><p class="muted">${esc(g.desc||'')}</p>
      <ul>${g.tabs.filter(t=>t.key!=='home').map(t=>`<li><button type="button" class="lnk" data-sttab="${t.key}">${esc(t.label)}</button><small class="muted">${esc(t.hint)}</small></li>`).join('')}</ul></section>`).join('')}</div>`;
  }
  /** вкладка: заголовок и пояснение, под ними — содержимое (обработчику отдаётся его блок) */
  static async open(main, k){
    const t=this.tab(k), g=this.GROUPS.find(x=>x.tabs.includes(t)), hist=SettingsHistoryPanel.TABS[t.key];
    StDirty.set(false);
    main.innerHTML=`<header class="st-th"><span class="muted">${esc(g.title)}</span><div class="st-th-r"><h4>${esc(t.label)}</h4>${hist?`<button class="btn ghost sm" type="button" data-sthist="${t.key}" title="Что и когда меняли на этой вкладке, вернуть как было">История</button>`:''}</div><p class="muted">${esc(t.hint)}</p></header><div class="st-body"><p class="empty">Загружаю…</p></div>`;
    await t.open(main.querySelector('.st-body'));
  }
}

const ACT = { login:'Вход в «Настройки»', backup_db:'Копия базы', maintain_db:'Сжатие и проверка базы', purge_images:'Удаление лишних изображений', create_admin:'Новый администратор', edit_admin:'Изменение администратора', delete_admin:'Удаление администратора', logout:'Выход из «Настроек»', set_password:'Смена пароля', reset_password:'Сброс пароля (временный)', logout_all:'Выход на всех устройствах', user_logout:'Выход менеджера', delete_attempt:'Попытка удаления',
  admin_request:'Запрос без входа', kp_status:'Ход сделки по КП', send_kp:'Отправка КП по почте', edit_settings:'Изменение настроек', edit_template:'Изменение шаблона', create_kp:'Создание КП', edit_kp:'Изменение КП',
  create_manager:'Новый менеджер', create_supplier:'Новый поставщик', edit_supplier:'Изменение поставщика', delete_supplier:'Удаление поставщика', edit_customs:'Код ТН ВЭД и пошлина', edit_manager:'Изменение менеджера', create_client:'Новый клиент', edit_client:'Изменение клиента',
  edit_types:'Категории оборудования', submit_edit:'Правка на модерацию', edit_product:'Правка товара', create_product:'Новый товар',
  price_sync:'Цены из КП', approve_edit:'Правка одобрена', reject_edit:'Правка отклонена', rollback_edit:'Откат правки',
  toggle_moderation:'Режим модерации', update_install:'Установка обновления', rollback_settings:'Откат изменения настроек', update_rollback:'Откат обновления', update_remove:'Обновление убрано', restart:'Перезапуск программы', toggle_user_login:'Вход менеджеров по паролю', edit_ai:'Нейросеть в программе', edit_access:'Доступ менеджера', delete_kp:'Удаление КП', delete_catalog:'Удаление товара', delete_manager:'Удаление менеджера',
  delete_client:'Удаление клиента', restore:'Восстановление из корзины', purge_trash:'Очистка корзины', export_db:'Экспорт базы', import_db:'Импорт базы', export_keys:'Копия ключей API', import_feed:'Загрузка фида в каталог', check_feed:'Проверка РРЦ и наличия по фиду',
  add_kp_file:'Документ к КП прикреплён', edit_kp_file:'Примечание к документу КП', delete_kp_file:'Документ КП удалён' };
const ENT = { supplier:'Поставщик', customs:'ТН ВЭД', product:'Товар', catalog:'Товар', kp:'КП', manager:'Менеджер', client:'Клиент', settings:'Настройки', template:'Шаблон',
  types:'Категории', admin:'Администратор', user:'Вход менеджера', db:'База', trash:'Корзина', system:'Программа' };
const DEL_TYPES = [['kp','КП из журнала'],['catalog','Товары каталога'],['manager','Контакты менеджеров'],['client','Клиенты'],['supplier','Поставщики']];

// размер окна запоминается (тянуть за правый нижний угол); «⤢» — во весь экран
function setDlg(){ return Modal.host('setdlg', 'setwin', 'Настройки', d=>{ stWinSize(d);
  d.addEventListener('click', e=>{ if (e.target.closest('[data-st="max"]')){ d.classList.toggle('max'); stWinSize(d, true); } });
  let t=null; new ResizeObserver(()=>{ if (!d.open || isMob() || d.classList.contains('max') || d.classList.contains('login')) return; clearTimeout(t);
    t=setTimeout(()=>{ const r=d.getBoundingClientRect(); if (r.width>300){ d.style.width=Math.round(r.width)+'px'; d.style.height=Math.round(r.height)+'px'; stWinSize(d, true); } }, 600); }).observe(d); }); }
function stWinSize(d, save){ try{
  if (save){ localStorage.setItem('kp.setwin', JSON.stringify({max:d.classList.contains('max'), w:d.style.width||'', h:d.style.height||''})); return; }
  const o=JSON.parse(localStorage.getItem('kp.setwin')||'{}')||{}; d.classList.toggle('max', !!o.max); if (o.w) d.style.width=o.w; if (o.h) d.style.height=o.h; }catch(e){} }

// запрос «Настроек»: сессия истекла — снова форма входа
async function aapi(path, opts){
  try{ return await api('/api/admin/'+path, opts); }
  catch(e){ if (/сессия|Войдите/.test(e.message)){ ADMIN.set(false); stRender(); } throw e; }
}
const ajson = (path, body) => aapi(path, {method:'POST', headers:{'Content-Type':'application/json; charset=utf-8'}, body:JSON.stringify(body||{})});

async function openSettings(tab){
  if (tab) ST.tab=tab;
  const d=setDlg(); if (!ADMIN.on) d.classList.add('login'); if (!d.open) d.showModal();
  d.innerHTML='<p class="empty">Загружаю…</p>';
  try{ const s=await api('/api/admin/status'); ADMIN.set(s.admin, s.csrf); ST.status=s; }catch(e){ ST.status={}; }
  stRender();
}

// вход администратора в «Настройки» (и создание первой учётной записи на компьютере-сервере): компактное окно
class AdminLogin {
  static render(d, head, s){
    const setup=!s.hasPassword, min=DEFN('srv.adminPwMin', 8);
    const last=(()=>{ try{ return localStorage.getItem('kp.adminLogin')||''; }catch(e){ return ''; } })();
    const body = setup&&!s.canSetup
      ? '<p class="msg warn">Администратор ещё не создан. Создайте учётную запись на компьютере, где работает программа (сервер отдела): откройте программу там и нажмите «Настройки».</p>'
      : `${LoginForm.login('stLg', 'Логин', setup?'admin':last, 'placeholder="admin"')}
        ${setup?'<label class="f"><span>Имя (для журнала действий)</span><input type="text" id="stNm" autocomplete="name" placeholder="Например, Петров А. В."></label>':''}
        ${LoginForm.pw('stPw', setup?`Пароль — не короче ${min} символов, буквы и цифры`:'Пароль', setup?'new-password':'current-password')}
        ${setup?LoginForm.pw('stPw2', 'Повторите пароль', 'new-password'):''}
        <p class="auth-err" id="stErr" role="alert" aria-live="assertive" hidden></p>
        <button class="btn primary auth-go" type="submit">${setup?'Создать и войти':'Войти'}</button>
        <div class="muted st-login-note">Через ${s.idleMinutes||15} мин бездействия вход закрывается.${tip('Только в «Настройках»: удаление и правка данных, модерация, резервные копии, шаблоны, ключи API, вход менеджеров и администраторы. Забыли пароль — его меняет другой администратор («Сотрудники и вход → Администраторы»).')}</div>`;
    d.innerHTML=head+`<div class="st-login"><form id="stLogin" autocomplete="on" novalidate>
      <p class="st-login-h">${setup?'Создайте учётную запись администратора':'Вход администратора'}</p>${body}</form></div>`;
    const f=$('#stLogin'), err=$('#stErr');
    if (err) LoginForm.bind(f, ()=>AdminLogin._send(setup, s), err);
    setTimeout(()=>{ const l=$('#stLg'); (l && l.value ? $('#stPw') : l)?.focus(); }, 30);
  }

  static async _send(setup, s){
    const lg=$('#stLg').value.trim(), pw=$('#stPw').value;
    if (!lg || !pw) throw new Error(!lg ? 'Введите логин' : 'Введите пароль');
    if (setup && pw!==$('#stPw2').value) throw new Error('Пароли не совпадают');
    const r=await LoginForm.post('/api/admin/'+(setup?'setup':'login'), setup?{login:lg, name:$('#stNm').value.trim(), password:pw}:{login:lg, password:pw});
    try{ localStorage.setItem('kp.adminLogin', lg); }catch(_){}
    ADMIN.set(true, r.csrf); const st2=await api('/api/admin/status').catch(()=>({})); ST.status={...s, ...st2, hasPassword:true}; stRender(); FEAT.refresh();
  }
}

function stRender(){
  const d=setDlg(), s=ST.status||{};
  const head=`<div class="dlg-h"><h3>Настройки${ADMIN.on&&s.name?`<small>${esc(s.name)} · ${esc(s.login||'')}</small>`:''}</h3>${ADMIN.on?'<button class="btn ghost" type="button" data-st="logout">Выйти</button>':''}<button class="icon st-maxb" type="button" data-st="max" aria-label="Во весь экран" title="Во весь экран / обычный размер. Размер окна меняется, если потянуть за правый нижний угол">⤢</button><button class="icon" type="button" data-st="close" aria-label="Закрыть">✕</button></div>`;
  d.classList.toggle('login', !ADMIN.on);
  if (!ADMIN.on) return AdminLogin.render(d, head, s);
  ST.tab=AdminNav.key(ST.tab);
  d.innerHTML=head+`<div class="st-b">${AdminNav.html(ST.tab)}
    <section class="st-main" id="stMain"><p class="empty">Загружаю…</p></section></div>`;
  d.querySelector('.st-nav .on')?.scrollIntoView({block:'nearest'});
  SettingsSearch.bind(d); StDirty.watch(d);
  stTab();
}

async function stTab(){
  const m=$('#stMain'); if (!m) return;
  try{ await AdminNav.open(m, ST.tab); }
  catch(e){ if (ADMIN.on) m.innerHTML=`<p class="msg err">${esc(e.message||e)}</p>`; }
}

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
  m.innerHTML=`<div id="stAttn"></div>
    <div class="row st-quick"><button class="btn" type="button" data-q="report">Отчёт по КП…</button><button class="btn" type="button" data-q="journal">Журнал КП…</button><button class="btn" type="button" data-sttab="audit">Журнал действий</button><button class="btn" type="button" data-sttab="connections">Проверить подключения</button><button class="btn" type="button" data-sttab="changed">Изменённые настройки</button><button class="btn" type="button" data-sttab="updates">Обновления</button></div>
    <div class="st-tiles">${tile(Fmt.num(k.total),'КП всего')}${tile(Fmt.num(k.today),'за сегодня')}${tile(Fmt.num(k.week),'за неделю')}${tile(Fmt.num(k.month),'за месяц')}
      ${tile(Fmt.num(Math.round((k.sumMonth||0)/100)),'сумма КП за месяц, руб.')}${tile(Fmt.num(s.activeUsers),`активных за ${s.activeDays||DEFN('srv.statActiveDays', 30)} дн.`)}
      ${tile(Fmt.num(mo.pending),'правок на модерации')}${tile(mo.conversion==null?'—':String(mo.conversion).replace('.',',')+' %','правок одобрено')}
      ${tile(Fmt.num(s.deletions.month),'удалений за месяц')}${tile(Fmt.size(s.db.bytes),'размер базы')}</div>
    <div class="st-card"><div class="row st-ch-h"><p class="sub" style="margin:0">КП по ${ST.chart==='day'?'дням (30 дней)':ST.chart==='week'?'неделям (12 недель)':'месяцам (12 месяцев)'}</p><span class="sp"></span>
      <div class="seg">${[['day','Дни'],['week','Недели'],['month','Месяцы']].map(([v,l])=>`<button type="button" class="${ST.chart===v?'on':''}" data-chart="${v}">${l}</button>`).join('')}</div></div>
      ${stBars(ser)}
      <details><summary class="muted">Таблицей</summary><table class="pv-t">${ser.map(x=>`<tr><td>${esc(x.label)}</td><td>${x.count}</td></tr>`).join('')}</table></details></div>
    <div class="st-cols"><div class="st-card"><p class="sub">Менеджеры — больше всего КП</p><table class="pv-t">${s.managers.map(x=>`<tr><td>${esc(x.name)}</td><td>${x.count} КП</td><td>${Fmt.num(Math.round(x.sum/100))} руб.</td></tr>`).join('')||'<tr><td>Нет данных</td></tr>'}</table></div>
      <div class="st-card"><p class="sub">Товары — чаще всего в КП</p><table class="pv-t">${s.products.map(x=>`<tr><td>${esc(x.name)}</td><td>${x.count}</td></tr>`).join('')||'<tr><td>Нет данных</td></tr>'}</table></div></div>
    <div class="st-cols"><div class="st-card"><p class="sub">Модерация правок</p><table class="pv-t"><tr><td>Режим</td><td>${mo.enabled?'включена':'выключена'}</td></tr>
      <tr><td>На модерации</td><td>${mo.pending}</td></tr><tr><td>Одобрено / отклонено</td><td>${mo.approved} / ${mo.rejected}</td></tr>
      <tr><td>Конверсия черновик → подтверждено</td><td>${mo.conversion==null?'—':String(mo.conversion).replace('.',',')+' %'}</td></tr></table></div>
      <div class="st-card"><p class="sub">База данных · ${Fmt.size(s.db.bytes)}</p><table class="pv-t">${Object.entries(s.db.tables).map(([t,n])=>`<tr><td>${esc(t)}</td><td>${Fmt.num(n)}</td></tr>`).join('')}
      <tr><td>Удалений всего / в корзине</td><td>${s.deletions.total} / ${s.deletions.trash}</td></tr></table></div></div>`;
  AdminSystem.attention(m.querySelector('#stAttn'));
  m.onclick=e=>{ const c=e.target.closest('[data-chart]'); if (c){ ST.chart=c.dataset.chart; stStats(m); return; }
    const q=e.target.closest('[data-q]'); if (q){ setDlg().close(); if (q.dataset.q==='report') KpReport.open({}); else openJournal(); } };
}

// ---------- обслуживание базы: копии (архивы ZIP), сжатие, срок журнала, изображения без ссылок
class DbMaint {
  // строка о последней копии: время, проверка, размер архива рядом с размером базы
  static last(b){
    if (!b.at) return '<span class="bad-t">копий ещё не было</span>';
    if (!b.ok) return `<span class="bad-t">${esc(Fmt.dateTime(b.at))} — ошибка: ${esc(b.error||'')}</span>`;
    return `<span class="ok-t">${esc(Fmt.dateTime(b.at))} — исправна</span>${b.bytes?` · ${b.zip?'архив ZIP ':''}${Fmt.size(b.bytes)}${b.zip&&b.db?` (база ${Fmt.size(b.db)})`:''}`:''}`;
  }

  static async render(box, r){
    if (!box) return;
    try{ r=r||await aapi('maint'); }catch(e){ box.innerHTML='<p class="sub">Обслуживание базы</p><p class="muted">Недоступно: '+esc(e.message)+'</p>'; return; }
    const v=r.vacuum, img=r.images, au=r.audit, oth=r.others||{}, cz=r.compressed;
    box.innerHTML=`<div class="sub st-mh">Автоматические копии и обслуживание базы ${tip('<p>Каждый день при первом запуске (и раз в сутки, пока работает сервер отдела) программа делает копию базы, проверяет её встроенной проверкой SQLite и сжимает в архив ZIP (в 15–20 раз меньше файла базы; файл kp.sqlite3 — внутри). Восстановить — «Файл базы целиком» ниже: он принимает и архив. Хранятся копии за 7 последних дней, по одной на 4 последние недели и на 12 последних месяцев.</p><p>Раз в месяц база сжимается и проверяется. Журнал действий старше заданного срока переносится в архив (папка backup/audit-archive рядом с базой).</p>')}</div>
      <table class="pv-t">
        <tr><td>Последняя копия</td><td>${DbMaint.last(r.backup||{})}</td></tr>
        <tr><td>Копий в папке</td><td>${r.copies}${r.copies?` · ${Fmt.size(r.copiesBytes)} · с ${esc(KPGen.ruDate(r.oldest))}`:''}<br><small class="muted">${esc(r.dir)}</small></td></tr>
        <tr><td>Копии перед изменениями</td><td>${oth.count?`${oth.count} · ${Fmt.size(oth.bytes)}`:'нет'} <small class="muted">— перед обновлением программы, загрузкой базы, сборкой каталога</small>${cz?`<br><small class="ok-t">прежние копии без сжатия перепакованы в ZIP: ${cz.files} · освобождено ${Fmt.size(cz.saved)}</small>`:''}</td></tr>
        <tr><td>Сжатие и проверка</td><td>${v?`${esc(Fmt.dateTime(v.at))} · ${Fmt.size(v.before)} → ${Fmt.size(v.after)} · ${v.check==='ok'?'<span class="ok-t">без ошибок</span>':'<span class="bad-t">'+esc(v.check)+'</span>'}`:'ещё не выполнялись'}</td></tr>
        <tr><td>Журнал действий</td><td>${Fmt.num(r.auditRows)} записей${r.auditOldest?' с '+esc(KPGen.ruDate(r.auditOldest)):''} · хранить <select id="mAudY" class="st-inl" aria-label="Срок хранения журнала">${[1,2,3,5,10].map(y=>`<option value="${y}"${y===r.auditYears?' selected':''}>${y} ${y===1?'год':y<5?'года':'лет'}</option>`).join('')}</select>${au&&au.archived?` · в архиве ${Fmt.num(au.archived)}`:''}</td></tr>
        <tr><td>Изображения без ссылок</td><td id="mImg">${img?`удалено ${img.deleted} (${Fmt.size(img.bytes)}) — ${esc(Fmt.dateTime(img.at))} · `:''}<button class="btn ghost" type="button" data-mt="imgscan">Найти</button></td></tr>
      </table>
      <div class="row" style="margin-top:8px"><button class="btn" type="button" data-mt="backup">Создать копию сейчас</button><button class="btn" type="button" data-mt="run">Сжать и проверить базу</button></div>`;
    const busy=(btn,t)=>{ if (btn){ btn.disabled=true; btn.textContent=t; } };
    box.onclick=async e=>{ const t=e.target.closest('[data-mt]'); if (!t) return; const a=t.dataset.mt;
      try{
        if (a==='backup'){ busy(t,'Копирую…'); const x=await ajson('maint/backup'); toast(x.backup&&x.backup.ok?'Копия создана и проверена':'Копия не создана'); return DbMaint.render(box, x); }
        if (a==='run'){ busy(t,'Сжимаю…'); const x=await ajson('maint/run'); toast('База сжата и проверена'); return DbMaint.render(box, x); }
        if (a==='imgscan'){ busy(t,'Ищу…'); const x=await aapi('maint/images');
          $('#mImg').innerHTML = x.count ? `${x.count} файлов · ${Fmt.size(x.bytes)} <button class="btn ghost" type="button" data-mt="imgdel" data-n="${x.count}">Удалить</button>${tip('<p>Файлы в папке img, на которые нет ссылок ни в каталоге, ни в КП, ни в истории версий и корзине (и которым больше месяца), а также всё из папки img/unused.</p><p>'+x.sample.map(esc).join('<br>')+(x.count>x.sample.length?'<br>…':'')+'</p>')}` : 'лишних нет'; return; }
        if (a==='imgdel'){ if (!confirm(`Удалить ${t.dataset.n} изображений без ссылок? Восстановить их можно только из резервной копии папки img.`)) return; busy(t,'Удаляю…');
          const x=await ajson('maint/images'); toast(`Удалено: ${x.deleted} (${Fmt.size(x.bytes)})`); return DbMaint.render(box); }
      }catch(err){ toast('Не выполнено: '+(err.message||err)); DbMaint.render(box); } };
    const sel=$('#mAudY'); if (sel) sel.onchange=async()=>{ const y=+sel.value;
      if (y<r.auditYears && !confirm(`Записи журнала действий старше ${sel.selectedOptions[0].textContent} будут перенесены в архив (папка backup/audit-archive) и пропадут из поиска в «Журнале действий». Продолжить?`)){ sel.value=r.auditYears; return; }
      try{ const x=await ajson('maint/audit',{years:y}); toast(x.archivedNow?`В архив перенесено записей: ${x.archivedNow}`:'Срок хранения журнала сохранён'); DbMaint.render(box, x); }catch(err){ toast('Не сохранено: '+err.message); } };
  }
}

// ---------- модерация
async function stModeration(m){
  const r=await aapi('moderation'), on=!!r.settings.enabled, P=r.pending;
  m.innerHTML=`<div class="st-card"><div class="row"><button class="sw" type="button" role="switch" aria-checked="${on}" data-mod="toggle"><i></i>Требовать подтверждение правок товаров</button></div>
      <p class="muted" style="margin:8px 0 0">${on?'Включено: правки сотрудников сохраняются черновиком и ждут вашего решения; у товара бейдж «На модерации».':'Выключено: правки сохраняются в каталог сразу и записываются в журнал действий (там же — откат правки).'}
      ${r.settings.updatedAt?` Изменено: ${esc(Fmt.dateTime(r.settings.updatedAt))}.`:''}</p></div>
    <div class="row" style="margin:14px 0 8px"><p class="sub" style="margin:0">На модерации <span class="muted">${P.length}</span></p><span class="sp"></span>${P.length>1?'<button class="btn" type="button" data-mod="all">Одобрить все</button>':''}</div>
    ${P.length?P.map(p=>`<div class="st-row"><div><b>${esc(p.name)}</b><span class="muted">${p.kind==='create'?'новый товар':'изменено: '+esc(p.fields.join(', ')||'—')} · ${esc(p.userName||'—')} · ${esc(Fmt.dateTime(p.created))}</span>
        ${p.stale?'<span class="bad-t" style="font-size:12.5px">Товар изменён после отправки правки — проверьте перед одобрением</span>':''}</div>
        <div class="acts"><button class="btn" type="button" data-pend="${p.id}">Посмотреть</button></div></div>`).join(''):`<p class="muted">${on?'Правок, ожидающих решения, нет.':'Модерация выключена — очередь не пополняется.'}</p>`}
    ${r.history.length?`<details class="more"><summary>Рассмотренные правки (${r.history.length})</summary>${r.history.sort((a,b)=>b.id-a.id).map(p=>`<div class="st-row"><div><b>${esc(p.name)}</b><span class="muted">${p.status==='approved'?'<span class="ok-t">Одобрено</span>':'<span class="bad-t">Отклонено</span>'+(p.reason?' — '+esc(p.reason):'')} · ${esc(p.userName||'—')} · ${esc(Fmt.dateTime(p.reviewedAt))}</span></div></div>`).join('')}</details>`:''}
    ${r.archived.length?`<details class="more"><summary>Архив модерации (${r.archived.length})</summary>${r.archived.map(p=>`<div class="st-row"><div><b>${esc(p.name)}</b><span class="muted">${esc(p.userName||'—')} · ${esc(Fmt.dateTime(p.created))}</span></div></div>`).join('')}</details>`:''}`;
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
   <div class="dlg-b"><p class="muted" style="margin-top:0">${p.kind==='create'?'Новый товар':'Изменение'} · ${esc(p.userName||'—')} · ${esc(Fmt.dateTime(p.created))}${p.current?'':' · товара сейчас нет в каталоге'}</p>
   <table class="st-diff"><tr><th>Поле</th><th>Было</th><th>Стало</th></tr>${p.diff.map(x=>`<tr><td>${esc(x.label)}</td><td>${stVal(x.before)}</td><td>${stVal(x.after)}</td></tr>`).join('')||'<tr><td colspan="3">Отличий нет</td></tr>'}</table>
   ${p.status==='pending'?`<label class="f" style="margin-top:12px"><span>Причина отклонения</span><input type="text" id="pReason" placeholder="Например: неверные характеристики"></label>
   <div class="row" style="justify-content:flex-end;margin-top:12px"><button class="btn danger" type="button" data-pa="reject">Отклонить</button><button class="btn primary" type="button" data-pa="approve">Одобрить</button></div>`:''}</div>`;
  d.showModal(); d.querySelector('[data-close]').onclick=()=>{ d.close(); d.classList.remove('wide'); };
  d.querySelector('.dlg-b').onclick=async e=>{ const b=e.target.closest('[data-pa]'); if(!b) return;
    const reason=$('#pReason').value.trim(); if (b.dataset.pa==='reject' && !reason) return toast('Укажите причину отклонения');
    await ajson(`pending/${id}/${b.dataset.pa}`,{reason}); d.close(); d.classList.remove('wide');
    toast(b.dataset.pa==='approve'?'Одобрено — изменения в каталоге':'Отклонено'); refreshCat(); stTab(); };
}

// ---------- записи базы: КП, товары, клиенты, поставщики, контакты менеджеров — поиск, правка, удаление в корзину
// (вкладка на каждый вид — AdminNav; type задаёт вкладка, повторные вызовы без type остаются на том же виде)
async function stDelete(m, type){
  const D=ST.del; if (type && type!==D.type){ D.type=type; D.sel.clear(); D.q=''; ST.ed=null; }
  const r=await aapi(`list/${D.type}?q=${encodeURIComponent(D.q)}`), ed=ST.ed&&ST.ed.type===D.type?ST.ed:null;
  const link=({manager:['access','Менеджеры: вход и права →'], catalog:['moderation','Модерация правок →'], supplier:['feeds','Фиды поставщиков →']})[D.type];
  const catTools=D.type==='catalog'?`<div class="row st-quick"><button class="btn" type="button" data-cat="xls">Импорт из Excel…</button><button class="btn" type="button" data-cat="imp">Загрузить файл каталога (.json)…</button><button class="btn" type="button" data-cat="exp">Выгрузить каталог в файл</button><button class="btn ghost" type="button" data-cat="open">Открыть каталог</button></div>`:'';
  m.innerHTML=`${catTools}<div class="row st-dbar"><input type="search" id="dQ" placeholder="Поиск" value="${esc(D.q)}" autocomplete="off"><span class="muted">${r.total>r.items.length?`показано ${r.items.length} из ${r.total} — уточните поиск`:`найдено: ${r.total}`}</span>
      <span class="sp"></span>${D.type==='client'?'<button class="btn" type="button" data-dimp title="Список ИНН — реквизиты подтянутся сами">Загрузить списком ИНН…</button>':''}${ST_NEW[D.type]?`<button class="btn primary" type="button" data-dnew>+ ${esc(ST_NEW[D.type])}</button>`:''}<button class="btn danger" type="button" data-del ${D.sel.size?'':'disabled'}>Удалить${D.sel.size?' ('+D.sel.size+')':''}</button>${link?`<button class="btn ghost" type="button" data-sttab="${link[0]}">${link[1]}</button>`:''}</div>
    ${ed&&!ed.id?'<div class="st-ed"></div>':''}
    <div class="st-list">${r.items.map(x=>`<label class="st-row ck-row${ed&&ed.id===x.id?' on':''}"><input type="checkbox" data-did="${esc(x.id)}" ${D.sel.has(x.id)?'checked':''}><div><b>${esc(x.title)}</b><span class="muted">${esc(x.sub)}</span></div><div class="acts">${D.type==='kp'&&x.files?`<button class="btn" type="button" data-dfiles="${esc(x.id)}" data-dt="${esc(x.title)}" title="Справочные документы КП: посмотреть, удалить">📎 ${esc(String(x.files))}</button>`:''}<button class="btn" type="button" data-dedit="${esc(x.id)}">${D.type==='kp'?'Открыть':'Изменить'}</button></div></label>${ed&&ed.id===x.id?'<div class="st-ed"></div>':''}`).join('')||'<p class="muted">Ничего не найдено.</p>'}</div>
    <p class="muted">«${D.type==='kp'?'Открыть':'Изменить'}» — ${({kp:'КП откроется в конструкторе для правки', catalog:'карточка товара в редакторе каталога', manager:'контакты менеджера — прямо в списке', client:'реквизиты и контакт клиента — прямо в списке', supplier:'условия, реквизиты, склады (адрес отгрузки), режим работы, контакты и оборудование поставщика — прямо в списке'})[D.type]}. Удалённое попадает в корзину и хранится ${30} дней — его можно восстановить. Файлы готовых КП (.docx, .pdf) в папке КП не удаляются.${D.type==='kp'?' «📎» — справочные документы КП: скачать или удалить ошибочный файл; у КП в корзине документы сохраняются.':''}</p>`;
  const eb=m.querySelector('.st-ed'); if (eb){ stEdDraw(eb); stEdBind(eb, ()=>stDelete(m)); eb.scrollIntoView({block:'nearest'}); eb.querySelector('[data-ef]')?.focus({preventScroll:true}); }
  let qT; $('#dQ').oninput=e=>{ D.q=e.target.value; clearTimeout(qT); qT=setTimeout(()=>stDelete(m).then(()=>{ const i=$('#dQ'); i.focus(); i.setSelectionRange(i.value.length,i.value.length); }),250); };
  m.onchange=e=>{ const c=e.target.closest('[data-did]'); if(!c) return; c.checked?D.sel.add(c.dataset.did):D.sel.delete(c.dataset.did);
    const b=m.querySelector('[data-del]'); b.disabled=!D.sel.size; b.textContent='Удалить'+(D.sel.size?' ('+D.sel.size+')':''); };
  m.onclick=async e=>{ if (e.target.closest('.st-ed')) return;
    if (e.target.closest('[data-dimp]')) return openClientsImport();
    const ct=e.target.closest('[data-cat]'); if (ct) return stCatalogTool(ct.dataset.cat);
    const df=e.target.closest('[data-dfiles]'); if (df){ e.preventDefault(); return KpFilesPanel.open(df.dataset.dfiles, df.dataset.dt.replace(/^№\s*/, ''), {admin:true, onClose:()=>stDelete(m)}); }
    if (e.target.closest('[data-dnew]')){ try{ await stEdOpen(D.type, null); }catch(err){ return toast(err.message||String(err)); } return stDelete(m); }
    const ed=e.target.closest('[data-dedit]'); if (ed){ e.preventDefault();
      if (ST_NEW[D.type]){ if (ST.ed&&ST.ed.id===ed.dataset.dedit){ ST.ed=null; return stDelete(m); } try{ await stEdOpen(D.type, ed.dataset.dedit); }catch(err){ return toast(err.message||String(err)); } return stDelete(m); }
      try{ await stEdit(D.type, ed.dataset.dedit, ()=>stDelete(m)); }catch(err){ toast(err.message||String(err)); } return; }
    if (!e.target.closest('[data-del]')) return;
    const n=D.sel.size, label=(DEL_TYPES.find(x=>x[0]===D.type)||[])[1];
    if (!await stConfirm(`Удалить? ${label}: ${n}`,`Записи будут в корзине ${DEFN('srv.trashDays', 30)} дн. (их можно восстановить), затем удалятся окончательно.`,'Удалить')) return;
    const res=await ajson('delete',{type:D.type, ids:[...D.sel]}); D.sel.clear(); toast(`Удалено: ${res.deleted}`);
    if (D.type==='catalog') refreshCat(); if (D.type==='manager') loadManagers().then(renderForm); stDelete(m); };
}

// каталог из «Настроек»: импорт из Excel, загрузка и выгрузка файла каталога (те же действия, что в «Ещё» окна каталога)
function stCatalogTool(a){
  if (a==='exp') return CW.exportFile();
  if (a==='xls') return openXlsImport('');
  if (a==='open'){ setDlg().close(); return openCatalog({}); }
  const f=document.createElement('input'); f.type='file'; f.accept='.json,application/json'; f.hidden=true; document.body.appendChild(f);
  f.onchange=async()=>{ const file=f.files[0]; f.remove(); if (!file) return; setDlg().close(); await openCatalog({}); CW.importFile(file); };
  f.click();
}

// правка записи из «Настроек»: КП — в конструкторе, товар — в редакторе каталога (менеджеры, клиенты, поставщики — в списке, settings-dir.js)
async function stEdit(type, id, after){
  if (type==='kp'){ await Drafts.stash(); const st=await api(`/api/kp/${encodeURIComponent(id)}/state`); S=Object.assign(freshState(), st); setDlg().close(); renderForm(); persist(); window.scrollTo({top:0}); toast('КП № '+(S.number||'')+' открыто для редактирования'); return; }
  if (type==='catalog'){ const doc=await api('/api/catalog/'+encodeURIComponent(id)); openCatEditor(doc, ()=>{ refreshCat(); after(); }); }
}

async function stTrash(m){
  const r=await aapi('trash');
  m.innerHTML=`<p class="muted" style="margin-top:0">Удалённое хранится ${r.days} дней, затем удаляется окончательно.</p>
    ${r.items.map(x=>`<div class="st-row"><div><b>${esc(x.title||x.entityId)}</b><span class="muted">${esc(ENT[x.entityType]||x.entityType)} · удалено ${esc(Fmt.dateTime(x.deletedAt))}</span></div>
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
    <p class="muted">Записей: ${Fmt.num(r.total)}</p>
    <div class="st-list">${r.items.map(x=>`<details class="st-log ${x.result==='failed'?'fail':''}"><summary><span class="t">${esc(Fmt.dateTime(x.timestamp))}</span><b>${esc(ACT[x.action]||x.action)}</b>
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
  m.innerHTML=`<div class="st-card" id="stMaint"><p class="sub">Автоматические копии и обслуживание базы</p><p class="muted">Загружаю…</p></div>
    <div class="st-card" id="stMirror"></div>
    ${DataTransfer.html()}
    <div class="st-card"><p class="sub">Загрузка</p>${DataTransfer.importHtml()}
      <p class="sub" style="margin-top:14px">Файл базы целиком (.sqlite3 или .zip с ним)${tip('<p>Заменяет всю базу содержимым файла — каталог, КП, клиентов, менеджеров, настройки. Перед заменой программа сохраняет копию текущей базы в data\\backup (архив kp-…-before-restore.zip).</p><p>Так и нужно подменять базу: вручную копировать kp.sqlite3 в папку data нельзя — рядом лежат файлы kp.sqlite3-wal и -shm от прежней базы, и она повредится («database disk image is malformed»).</p>')}</p>
      <input type="file" id="impDb" accept=".sqlite3,.sqlite,.db,.zip" class="sr-file"><label for="impDb" class="btn">Выбрать файл базы…</label><p class="muted" id="impDbSt"></p></div>
    <div class="st-card" id="stMigr"></div>
    <div class="st-card"><p class="sub">История</p>${ops.map(x=>`<div class="st-row"><div><b>${esc(ACT[x.action])}</b><span class="muted">${esc(Fmt.dateTime(x.timestamp))} · ${esc(x.entityId||'')}${x.after&&x.after.bytes?' · '+Fmt.size(x.after.bytes):''}</span></div></div>`).join('')||'<p class="muted">Операций ещё не было.</p>'}</div>`;
  DbMaint.render($('#stMaint')); stMigr($('#stMigr')); new MirrorCard($('#stMirror')).open();
  m.onclick=null; DataTransfer.mount(m, ()=>stBackup(m)); DataTransfer.bindImport(m, ()=>stBackup(m));
  $('#impDb').onchange=async e=>{ const f=e.target.files[0]; if (!f) return; e.target.value='';
    if (!await stConfirm('Заменить всю базу файлом «'+f.name+'»?','Текущие данные будут заменены содержимым файла. Перед этим программа сохранит копию текущей базы в data\\backup.','Заменить базу')) return;
    const st=$('#impDbSt'); st.textContent=`Загружаю «${f.name}» (${Fmt.size(f.size)})…`;
    try{ const j=await aapi('import/sqlite?name='+encodeURIComponent(f.name), {method:'POST', headers:{'Content-Type':'application/octet-stream'}, body:f});
      st.textContent=''; toast(`База заменена: позиций ${Fmt.num(j.catalog)}, КП ${Fmt.num(j.kp)}. Прежняя сохранена: ${j.backup.split(/[\\/]/).pop()}`);
      setTimeout(()=>location.reload(), 1500); }
    catch(err){ st.textContent=''; toast('Не загружено: '+(err.message||err)); } };
}

// ---------- шаблоны, категории, ключи, пароль
async function stTemplates(m){
  m.innerHTML=`<div class="st-card"><p class="sub">Шаблоны · ${TEMPLATES.length}</p>${TEMPLATES.map(t=>`<div class="st-row"><div><b>${esc(t.name)}</b><span class="muted">${esc(t.description||t.id)}${t.error?' · <span class="bad-t">'+esc(t.error)+'</span>':''}</span></div>
      <div class="acts">${t.error?'':`<button class="btn primary" type="button" data-tdes="${esc(t.id)}" title="Документ как в Word: щёлкните текст или картинку и меняйте шрифт, цвет, размеры, порядок разделов">Графический редактор</button>`}<button class="btn" type="button" data-tpl="${esc(t.id)}">Настроить</button></div></div>`).join('')}
      <div class="row" style="margin-top:10px"><button class="btn" type="button" data-tnew>+ Новый шаблон для компании…</button><button class="btn ghost" type="button" data-tfold>Папка шаблонов</button></div></div>`;
  m.onclick=e=>{ const t=e.target.closest('[data-tpl]'); if (t) return openTemplateEditor(t.dataset.tpl);
    const g=e.target.closest('[data-tdes]'); if (g) return openTemplateDesigner(g.dataset.tdes);
    if (e.target.closest('[data-tnew]')) return tdNewCompany().catch(err=>toast('Не получилось: '+(err.message||err)));
    if (e.target.closest('[data-tfold]')) return api('/api/templates/folder',{method:'POST'}).then(r=>{ if(r&&r.remote) toast('Шаблоны лежат на компьютере-сервере, в папке программы «templates»'); }).catch(err=>toast(err.message)); };
}

// ---------- категории оборудования (редактор — types-editor.js): сколько товаров в каждой, открыть редактор
async function stTypes(m){
  const n={}; for (const x of catCache){ const c=attrsOf(x).cat||''; n[c]=(n[c]||0)+1; }
  const L=TYPES.filter(t=>!t.station), S2=TYPES.filter(t=>t.station);
  const row=t=>`<tr><td>${esc(t.name)}</td><td class="muted">${t.fields.length} ${plural(t.fields.length,'параметр','параметра','параметров')}</td><td>${Fmt.num(n[t.id]||0)}</td></tr>`;
  m.innerHTML=`<div class="st-card"><div class="row"><p class="sub" style="margin:0">Категории · ${L.length}${S2.length?` и станций · ${S2.length}`:''}</p><span class="sp"></span><button class="btn primary" type="button" data-types>Открыть редактор категорий</button></div>
      <p class="muted">Параметры, фильтры, группы характеристик и шаблон таблицы. Удалить свою категорию или вернуть стандартные можно только отсюда (при входе в «Настройки»).</p>
      <table class="pv-t st-tt"><tr><th>Категория</th><th>Параметры</th><th>Товаров</th></tr>${[...L, ...S2].map(row).join('')}</table></div>`;
  m.onclick=e=>{ if (e.target.closest('[data-types]')) openTypesEditor(); };
}

async function stKeys(m){ return ApiKeys.form(m); }

// ---------- нейросеть в программе (DeepSeek): включение, ключ, модель, проверка, расход
// почта: менеджеры отправляют КП клиентам из журнала и после сохранения КП (сервер — app/kp_track.py, SMTP)
async function stMail(m, note){
  const r=await aapi('mail');
  m.innerHTML=`<div class="st-card"><p class="sub" style="margin:0">Отправка КП по почте ${r.on?'<b class="ok-t">настроена</b>':'<span class="muted">не настроена</span>'}</p>
    <p class="muted" style="margin:6px 0 0">Менеджеры отправляют КП клиенту из программы: журнал → «Отправить» или кнопка после сохранения КП. Письмо уходит с этого адреса,
      ответ клиента — на почту менеджера КП; отправка отмечается в журнале, статус КП становится «Отправлено».</p>
    ${note?`<p class="msg${note.err?' err':''}" style="text-align:left">${esc(note.t)}</p>`:''}</div>
  <div class="st-card"><p class="sub">Почтовый сервер (SMTP)</p>
    <div class="grid g2"><label class="f"><span>Сервер</span><input type="text" id="mlHost" value="${esc(r.host)}" placeholder="smtp.yandex.ru" autocomplete="off"></label>
      <div class="grid g2"><label class="f"><span>Порт</span><input type="text" inputmode="numeric" id="mlPort" value="${esc(r.port)}"></label>
        <label class="f"><span>Защита</span><select id="mlSec">${[['ssl','SSL/TLS (465)'],['starttls','STARTTLS (587)'],['none','Без защиты']].map(([k,l])=>`<option value="${k}"${r.security===k?' selected':''}>${l}</option>`).join('')}</select></label></div>
      <label class="f"><span>Логин</span><input type="text" id="mlLogin" value="${esc(r.login)}" autocomplete="off" placeholder="обычно — адрес почты"></label>
      <label class="f"><span>Пароль ${r.hasPassword?'<b class="ok-t">задан</b>':''}</span><input type="password" id="mlPw" autocomplete="new-password" placeholder="${r.hasPassword?'Новый пароль — заменит текущий':'Пароль приложения для почты'}"></label>
      <label class="f"><span>Адрес отправителя</span><input type="text" id="mlFrom" value="${esc(r.fromEmail)}" placeholder="kp@company.ru"></label>
      <label class="f"><span>Имя отправителя</span><input type="text" id="mlName" value="${esc(r.fromName)}" placeholder="ПНЕВМОТЕХ"></label></div>
    <label class="ck"><input type="checkbox" id="mlBcc"${r.bccSelf?' checked':''}> Копия каждого письма — на адрес отправителя (архив отправленных КП)</label>
    <p class="muted">Яндекс: smtp.yandex.ru, 465, SSL, пароль приложения (id.yandex.ru → Безопасность). Mail.ru: smtp.mail.ru, 465. Корпоративный сервер — у системного администратора.</p></div>
  <div class="st-card"><p class="sub">Письмо по умолчанию</p>
    <label class="f"><span>Тема</span><input type="text" id="mlSubj" value="${esc(r.subject)}"></label>
    <label class="f"><span>Текст</span><textarea id="mlBody" rows="9">${esc(r.body)}</textarea></label>
    <p class="muted">Подстановки: {номер}, {дата}, {клиент}, {поставщик} (имя отправителя), {менеджер}, {должность}, {телефон}, {e-mail}; {, контакт} — «, Иван Петрович» (если в КП указано контактное лицо); {: оборудование} — «: Винтовые компрессоры Remeza ВК10…» по заголовку титула. Менеджер может поправить текст перед отправкой.</p>
    <div class="row" style="margin-top:10px;gap:8px;flex-wrap:wrap"><button class="btn primary" type="button" id="mlSave">Сохранить</button>
      <input type="text" id="mlTestTo" placeholder="адрес для проверки" style="max-width:260px" autocomplete="off"><button class="btn" type="button" id="mlTest"${r.on?'':' disabled'}>Отправить проверочное письмо</button>
      ${r.hasPassword?'<button class="btn ghost" type="button" id="mlDel">Удалить пароль</button>':''}</div></div>
  <div class="st-card" id="stAlerts"></div>`;
  new AlertsCard($('#stAlerts')).open();
  const body=()=>{ const b={host:$('#mlHost').value.trim(), port:$('#mlPort').value.trim(), security:$('#mlSec').value, login:$('#mlLogin').value.trim(),
    fromEmail:$('#mlFrom').value.trim(), fromName:$('#mlName').value.trim(), bccSelf:$('#mlBcc').checked, subject:$('#mlSubj').value, body:$('#mlBody').value};
    const pw=$('#mlPw').value; if (pw) b.password=pw; return b; };
  $('#mlSave').onclick=async()=>{ try{ await ajson('mail', body()); stMail(m, {t:'Сохранено'}); }catch(e){ stMail(m, {t:String(e.message||e), err:true}); } };
  $('#mlTest').onclick=async e=>{ e.target.disabled=true; e.target.textContent='Отправляю…';
    try{ await ajson('mail/test', {to:$('#mlTestTo').value}); stMail(m, {t:'Проверочное письмо отправлено на '+$('#mlTestTo').value}); }
    catch(err){ stMail(m, {t:String(err.message||err), err:true}); } };
  if ($('#mlDel')) $('#mlDel').onclick=async()=>{ if (!await stConfirm('Удалить пароль почты?','Отправка КП по почте перестанет работать, пока не зададите новый.','Удалить')) return;
    try{ await ajson('mail', {clearPassword:true}); stMail(m, {t:'Пароль удалён'}); }catch(e){ stMail(m, {t:String(e.message||e), err:true}); } };
}

async function stAi(m, note){
  const r=await aapi('ai'), u=r.usage||{}, tok=n=>Number(n||0).toLocaleString('ru-RU');
  m.innerHTML=`<div class="st-card"><div class="row"><p class="sub" style="margin:0">Заполнение карточек нейросетью</p><span class="sp"></span>
      <label class="sw"><input type="checkbox" id="aiOn"${r.enabled?' checked':''}${r.hasKey?'':' disabled'}><span>${r.enabled?'включена':'выключена'}</span></label></div>
    <p class="muted">${r.enabled?'Менеджеры заполняют карточки оборудования и элементы станций одной кнопкой «✨ Заполнить автоматически» — без чата в браузере. Ручной способ (копировать запрос в любой ИИ-чат) остаётся запасным.'
      :'Сейчас менеджеры заполняют карточки через любой ИИ-чат в браузере (копировать запрос → вставить ответ). Включите, чтобы программа сама отправляла запрос в DeepSeek.'}</p>
    ${r.hasKey?'':'<p class="msg warn" style="text-align:left">Сначала укажите ключ API DeepSeek ниже.</p>'}
    ${note?`<p class="msg${note.err?' err':''}" style="text-align:left">${esc(note.t)}</p>`:''}</div>
  <div class="st-card"><p class="sub">Подключение</p>
    <div class="grid g2"><label class="f"><span>Ключ API DeepSeek ${r.hasKey?`<b class="ok-t">задан: ${esc(r.keyMask)}</b>`:''}</span><input type="password" id="aiKey" placeholder="${r.hasKey?'Новый ключ — заменит текущий':'sk-…'}" autocomplete="off"></label>
      <label class="f"><span>Модель</span><input type="text" id="aiModel" list="aiModels" value="${esc(r.model)}" autocomplete="off"><datalist id="aiModels">${r.models.map(x=>`<option value="${esc(x.id)}">${esc(x.name)}</option>`).join('')}<option value="deepseek/deepseek-chat-v3-0324:free">OpenRouter — DeepSeek V3, бесплатная (с лимитами)</option></datalist></label></div>
    <details class="more"><summary>Другой сервис с таким же API</summary><label class="f" style="margin-top:8px"><span>Адрес API</span><input type="text" id="aiBase" value="${esc(r.base)}" placeholder="https://api.deepseek.com"></label>
      <p class="muted">Например OpenRouter — https://openrouter.ai/api/v1 (модели DeepSeek, в т. ч. бесплатные с лимитами; ключ — с openrouter.ai) или своя модель на сервере отдела (Ollama — http не подойдёт, нужен https). Название модели — в поле «Модель».</p></details>
    <div class="row" style="margin-top:10px"><button class="btn primary" type="button" id="aiSave">Сохранить</button><button class="btn" type="button" id="aiTest"${r.hasKey?'':' disabled'}>Проверить связь</button>
      ${r.hasKey?'<button class="btn ghost" type="button" id="aiDel">Удалить ключ</button>':''}</div>
    <p class="muted">Ключ — на platform.deepseek.com (раздел API keys), оплата — пополнением баланса там же. Ключ хранится только на компьютере-сервере и попадает в резервную копию ключей; менеджерам он не виден.</p></div>
  <div class="st-card"><p class="sub">Расход</p>
    <p>За ${esc(r.usageMonth)}: запросов <b>${tok(u.requests)}</b>, токенов в запросах <b>${tok(u.tokensIn)}</b>, в ответах <b>${tok(u.tokensOut)}</b>.</p>
    ${(r.usageAll||[]).length>1?`<p class="muted">${r.usageAll.slice(1).map(x=>`${esc(x.month)}: ${tok(x.requests)} запр., ${tok((x.tokensIn||0)+(x.tokensOut||0))} ток.`).join(' · ')}</p>`:''}
    <p class="muted">Одна карточка — обычно 3–15 тыс. токенов (больше, если вставлен длинный паспорт или ТЗ).</p></div>`;
  const save=async(body, msg)=>{ try{ await ajson('ai', body); await aiStatusLoad(); stAi(m, {t:msg}); }catch(e){ stAi(m, {t:String(e.message||e), err:true}); } };
  $('#aiOn').onchange=e=>save({enabled:e.target.checked}, e.target.checked?'Нейросеть включена — у менеджеров появилась кнопка «✨ Заполнить автоматически»':'Нейросеть выключена — менеджеры заполняют через ИИ-чат');
  $('#aiSave').onclick=()=>{ const b={model:$('#aiModel').value, base:$('#aiBase').value}; const k=$('#aiKey').value.trim(); if (k) b.key=k; save(b, 'Сохранено'); };
  if ($('#aiDel')) $('#aiDel').onclick=async()=>{ if (!await stConfirm('Удалить ключ DeepSeek?','Нейросеть в программе выключится, менеджеры будут заполнять через ИИ-чат.','Удалить')) return; save({key:''}, 'Ключ удалён, нейросеть выключена'); };
  $('#aiTest').onclick=async e=>{ e.target.disabled=true; e.target.textContent='Проверяю…';
    try{ const t=await ajson('ai/test', {}); stAi(m, {t:`Связь есть: модель ${t.model}, ответ получен (${(t.usage&&t.usage.total_tokens)||0} токенов).`}); }
    catch(err){ stAi(m, {t:String(err.message||err), err:true}); } };
}

async function stSecurity(m){
  m.innerHTML=`<div class="st-card"><form id="pwF" autocomplete="off"><p class="sub">Сменить свой пароль${(ST.status||{}).login?` (${esc(ST.status.login)})`:''}</p>
      <div class="grid g2"><label class="f"><span>Текущий пароль</span><input type="password" id="pwO" autocomplete="current-password" required></label>
      <label class="f"><span>Новый пароль</span><input type="password" id="pwN" autocomplete="new-password" required></label></div>
      <p class="msg err" id="pwE" style="text-align:left"></p><button class="btn primary" type="submit">Сменить пароль</button></form></div>
    <div class="st-card"><p class="sub">Доступ</p><p class="muted">Вход закрывается через ${(ST.status||{}).idleMinutes||15} минут бездействия. Пять неверных паролей за 10 минут — пауза 10 минут.
      Пароль другого администратора меняется во вкладке «Администраторы». Забыли пароль все администраторы: на компьютере, где работает программа, создайте файл <b>data\\admin-reset.txt</b> и перезапустите программу — учётные записи администраторов удалятся, создайте новую здесь.</p></div>
`;
  $('#pwF').onsubmit=async e=>{ e.preventDefault();
    try{ await ajson('password',{old:$('#pwO').value, new:$('#pwN').value}); toast('Пароль изменён'); stSecurity(m); }catch(err){ $('#pwE').textContent=err.message; } };
}

// миграции базы — в «Копии и обслуживание базы» (для обслуживания, обычно не нужны)
async function stMigr(box){
  if (!box) return; let mg; try{ mg=await aapi('migrations'); }catch(e){ box.innerHTML=''; return; }
  box.innerHTML=`<details class="more"><summary>Миграции базы (для обслуживания)</summary>${mg.applied.map(id=>`<div class="st-row"><div><b>${esc(id)}</b><span class="muted">применена</span></div>
      <div class="acts"><button class="btn danger" type="button" data-mdown="${esc(id)}">Откатить</button></div></div>`).join('')||'<p class="muted">Нет применённых миграций.</p>'}
      <p class="muted">Откат удаляет таблицы журнала действий, корзины и модерации (перед этим — копия базы в data\\backup). При следующем запуске программы миграция применится снова.</p></details>`;
  box.onclick=async e=>{ const b=e.target.closest('[data-mdown]'); if (!b) return;
    if (!await stConfirm('Откатить миграцию?','Журнал действий, корзина и правки на модерации будут удалены. Перед этим сохраняется копия базы.','Откатить')) return;
    await ajson(`migrations/${b.dataset.mdown}/down`); toast('Миграция откачена'); stMigr(box); };
}

// ---------- администраторы: логин, имя, пароль
async function stUsers(m){
  const r=await aapi('users');
  m.innerHTML=`<div class="st-card"><p class="sub">Учётные записи · ${r.items.length}</p>
    ${r.items.map(u=>`<div class="st-row" data-ulogin="${esc(u.login)}"><div><b>${esc(u.name||u.login)}</b><span class="muted">логин <b>${esc(u.login)}</b>${u.login===r.me?' · это вы':''} · создан ${esc(Fmt.dateTime(u.created))}${u.by?' ('+esc(u.by)+')':''}${u.lastLogin?' · последний вход '+esc(Fmt.dateTime(u.lastLogin)):''}</span></div>
      <div class="acts"><button class="btn" type="button" data-uact="edit">Изменить</button><button class="btn" type="button" data-uact="password">Пароль</button>${r.items.length>1&&u.login!==r.me?'<button class="btn danger" type="button" data-uact="delete">Удалить</button>':''}</div></div>`).join('')}</div>
    <div class="st-card"><form id="uAdd" autocomplete="off"><p class="sub">Добавить администратора</p>
      <div class="grid g3"><label class="f"><span>Логин</span><input type="text" id="uL" required placeholder="ivanov" autocomplete="off"></label>
      <label class="f"><span>Имя</span><input type="text" id="uN" placeholder="Иванов И. И."></label>
      <label class="f"><span>Пароль</span><input type="password" id="uP" required autocomplete="new-password" placeholder="не короче ${DEFN('srv.adminPwMin', 8)}, буквы и цифры"></label></div>
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
      if (a==='password'){ const v=await stForm(`Новый пароль: ${login}`, [['password',`Новый пароль (не короче ${DEFN('srv.adminPwMin', 8)}, буквы и цифры)`,'','password']]); if (!v) return;
        await ajson('users',{action:'password', login, password:v.password}); toast('Пароль изменён'); }
      stUsers(m);
    }catch(err){ toast(err.message||String(err)); } };
}

// ---------- вход менеджеров в конструктор по паролю и права; сброс пароля (временный), «выйти на всех устройствах»
class AccessPanel {
  static async open(m){
    const r=await aapi('access'), P=r.perms;
    const row=x=>`<tr data-mid="${esc(x.id)}"${x.blocked?' class="off"':''}><td><b>${esc(x.name||'Без имени')}</b><small class="muted">${esc(x.position||'')}${x.lastLogin?(x.position?' · ':'')+'вход '+esc(Fmt.dateTime(x.lastLogin)):''}</small></td>
      <td>${x.login?`<b>${esc(x.login)}</b>${AccessPanel._state(x)}`:'<span class="muted">не задан</span>'}</td>
      ${P.map(p=>`<td class="c"><input type="checkbox" data-perm="${p.key}"${x.perms[p.key]?' checked':''} aria-label="${esc(p.label)}"></td>`).join('')}
      <td class="acts"><div class="ac-acts"><button class="btn sm" type="button" data-ac="login">${x.login?'Логин и пароль':'Задать вход'}</button>${x.login?`<button class="btn sm" type="button" data-ac="reset">Сбросить пароль</button>
        <button class="btn sm ghost" type="button" data-ac="block">${x.blocked?'Разрешить вход':'Запретить вход'}</button>`:''}${x.sessions?`<button class="btn sm ghost" type="button" data-ac="out" title="Закрыть все входы менеджера: компьютеры и телефоны">Выйти везде (${x.sessions})</button>`:''}</div></td></tr>`;
    m.innerHTML=`<div class="st-card"><div class="row"><p class="sub" style="margin:0">Вход в конструктор по логину и паролю</p><span class="sp"></span>
        <label class="sw"><input type="checkbox" id="acOn"${r.enabled?' checked':''}><span>${r.enabled?'включён':'выключен'}</span></label></div>
      <p class="muted">${r.enabled?'Без входа программа не открывается. Кто работает, программа знает по входу; права ниже проверяются на сервере.'
        :'Сейчас менеджер выбирается на устройстве, пароль не нужен, права не проверяются. Чтобы включить вход, задайте логин и пароль хотя бы одному менеджеру.'}
        Администратор входит в «Настройки» своим паролем и может всё.</p>
      <div class="ac-help"><label class="f"><span>«Забыли пароль?» на экране входа — к кому обращаться ${tip('Менеджер видит этот текст до входа, под ссылкой «Забыли пароль?». Укажите, кто сбрасывает пароль и как с ним связаться. Пусто — только общая подсказка «обратитесь к администратору».')}</span>
        <input type="text" id="acHelp" maxlength="200" value="${esc(r.help||'')}" placeholder="Например: пароль сбросит Иванов Иван, доб. 123"></label><button class="btn" type="button" id="acHelpSave">Сохранить</button></div></div>
      <div class="st-card"><div class="row"><p class="sub" style="margin:0">Менеджеры и права · ${r.managers.length} ${tip(AccessPanel.HELP)}</p><span class="sp"></span><button class="btn ghost" type="button" data-sttab="db-manager">Контакты менеджеров →</button></div>
      ${r.managers.length?`<div class="ac-tw"><table class="pv-t ac-t"><thead><tr><th>Менеджер</th><th>Логин</th>${P.map(p=>`<th class="c" title="${esc(p.label)}">${esc(p.label)}</th>`).join('')}<th></th></tr></thead><tbody>${r.managers.map(row).join('')}</tbody></table></div>`
        :'<p class="muted">Менеджеров ещё нет — их добавляют в шаге «Менеджер» конструктора.</p>'}
      <p class="muted">Права действуют, когда вход по паролю включён. «КП других менеджеров» — видеть их в журнале, открывать и сохранять; без него менеджер видит только свои КП. «Экономика сделки» — своих КП (чужих — вместе с правом на КП других).</p></div>`;
    const post=(mid, body)=>ajson('access/'+encodeURIComponent(mid), body);
    $('#acHelpSave').onclick=async()=>{ try{ const x=await ajson('access',{help:$('#acHelp').value}); $('#acHelp').value=x.help||''; toast('Подсказка сохранена'); }catch(err){ toast(err.message||String(err)); } };
    $('#acOn').onchange=async e=>{ try{ await ajson('access',{enabled:e.target.checked}); toast(e.target.checked?'Вход по паролю включён':'Вход по паролю выключен'); }catch(err){ toast(err.message||String(err)); } AccessPanel.open(m); };
    m.onchange=async e=>{ const c=e.target.closest('[data-perm]'); if (!c) return; const mid=c.closest('[data-mid]').dataset.mid;
      const perms={}; c.closest('tr').querySelectorAll('[data-perm]').forEach(x=>perms[x.dataset.perm]=x.checked);
      try{ await post(mid,{perms}); toast('Права сохранены'); }catch(err){ toast(err.message||String(err)); AccessPanel.open(m); } };
    m.onclick=async e=>{ const b=e.target.closest('[data-ac]'); if (!b) return; const mid=b.closest('[data-mid]').dataset.mid, x=r.managers.find(z=>z.id===mid);
      try{
        if (b.dataset.ac==='login'){ const v=await stForm(`Вход: ${x.name}`, [['login','Логин (латиница или кириллица, без пробелов)',x.login||''],['password',x.hasPassword?`Новый пароль (пусто — не менять), не короче ${DEFN('srv.userPwMin', 4)} символов`:`Пароль, не короче ${DEFN('srv.userPwMin', 4)} символов`,'','password']]); if (!v) return;
          if (!x.hasPassword && !v.password) return toast('Задайте пароль');
          await post(mid,{login:v.login, ...(v.password?{password:v.password}:{})}); toast('Сохранено'); }
        if (b.dataset.ac==='block'){ await post(mid,{blocked:!x.blocked}); toast(x.blocked?'Вход разрешён':'Вход запрещён, сессии закрыты'); }
        if (b.dataset.ac==='reset' && !await AccessPanel.reset(x)) return;
        if (b.dataset.ac==='out'){ if (!await stConfirm('Выйти на всех устройствах?', `${x.name||x.login}: закроются все входы (${x.sessions}) — на компьютерах и телефонах. Пароль не меняется: менеджер войдёт снова своим.`, 'Закрыть входы')) return;
          const o=await ajson('access/'+encodeURIComponent(mid)+'/logout'); toast(o.closed?`Входы закрыты: ${o.closed}`:'Открытых входов не было'); }
        AccessPanel.open(m);
      }catch(err){ toast(err.message||String(err)); } };
  }

  static HELP = '<p><b>Сбросить пароль</b> — менеджер забыл пароль: программа выдаст временный пароль (покажет один раз — передайте менеджеру). Прежний пароль перестаёт действовать, открытые входы менеджера закрываются. Войдя с временным паролем, менеджер сразу задаёт свой; срок временного пароля — «Значения программы» → «Временный пароль… действует».</p>'
    +'<p><b>Выйти везде</b> — закрыть все входы менеджера (например, потерял телефон); пароль не меняется. Менеджер может сделать это и сам: «⋯ → Выйти на всех устройствах», а пароль сменить — «⋯ → Сменить пароль».</p>';

  // отметки у логина: нет пароля, вход запрещён, временный пароль (до какого времени), открытые входы
  static _state(x){
    const t=x.temp, out=[];
    if (!x.hasPassword) out.push('<small class="bad-t">нет пароля</small>');
    if (x.blocked) out.push('<small class="bad-t">вход запрещён</small>');
    if (t) out.push(t.expired ? '<small class="bad-t">временный пароль истёк</small>' : `<small class="warn-t">временный пароль до ${esc(Fmt.dateTime(t.until))}</small>`);
    if (x.sessions) out.push(`<small class="muted">входов открыто: ${x.sessions}</small>`);
    return out.join('');
  }

  // «Сбросить пароль»: подтверждение → временный пароль на экран один раз (с «Копировать»)
  static async reset(x){
    if (!await stConfirm('Сбросить пароль?', `${x.name||x.login} получит временный пароль. Прежний пароль перестанет действовать, открытые входы менеджера закроются.`, 'Сбросить пароль')) return false;
    const r=await ajson('access/'+encodeURIComponent(x.id)+'/reset');
    await new Promise(res=>{
      const m=new Modal(`<h3>Временный пароль</h3><p>Передайте менеджеру <b>${esc(x.name||'')}</b> — пароль показывается только сейчас.</p>
        <div class="ac-tmp"><span class="ac-tmp-l">Логин <b>${esc(x.login)}</b></span><code id="acTmp">${esc(r.password)}</code><button class="btn" type="button" id="acCopy">Копировать</button></div>
        <p class="muted">Действует до ${esc(Fmt.dateTime(r.until))} (${r.hours} ч). При входе менеджер сразу задаст свой пароль.</p>
        <div class="row"><button class="btn primary" type="button" data-x>Готово</button></div>`, 'ac-tmp-dlg');
      m.$('#acCopy').onclick=async()=>{ const ok=await copyToClipboard(r.password); toast(ok?'Пароль скопирован':'Не скопировалось — выделите пароль и скопируйте вручную');
        if (!ok){ const sel=getSelection(), rg=document.createRange(); rg.selectNodeContents(m.$('#acTmp')); sel.removeAllRanges(); sel.addRange(rg); } };
      m.$('[data-x]').onclick=()=>m.close();
      m.d.addEventListener('close', ()=>res());
    });
    return true;
  }
}

// форма из нескольких полей поверх «Настроек»: fields [[ключ, подпись, значение, тип]] → {ключ: значение} или null
function stForm(title, fields){
  return new Promise(res=>{ let v=null;
    const m=new Modal(`<form method="dialog"><h3>${esc(title)}</h3>${fields.map(([k,l,v,t])=>`<label class="f"><span>${esc(l)}</span>${t==='textarea'?`<textarea data-k="${k}" rows="3">${esc(v??'')}</textarea>`:`<input type="${t||'text'}" data-k="${k}" value="${esc(v??'')}" autocomplete="off">`}</label>`).join('')}
      <div class="row"><button class="btn" type="button" data-v="0">Отмена</button><button class="btn primary" type="submit">Сохранить</button></div></form>`, 'st-form');
    m.$('[data-k]')?.focus();
    m.$('[data-v="0"]').onclick=()=>m.close();
    m.$('form').onsubmit=e=>{ e.preventDefault(); v={}; m.d.querySelectorAll('[data-k]').forEach(i=>{ v[i.dataset.k]=i.value.trim(); }); m.close(); };
    m.d.addEventListener('close', ()=>res(v)); });
}

// ---------- окно подтверждения и выбора (поверх «Настроек»)
const stConfirm = (title, text, ok) => Modal.ask(`<h3>${esc(title)}</h3><p>${esc(text)}</p><div class="row"><button class="btn" type="button" data-v="0">Отмена</button><button class="btn primary${/Удал|Откат/.test(ok)?' danger-bg':''}" type="button" data-v="1">${esc(ok)}</button></div>`);

const stChoose = (title, opts) => Modal.ask(`<h3>${esc(title)}</h3><div class="st-choose">${opts.map(([v,l])=>`<button class="btn" type="button" data-v="${v}">${esc(l)}</button>`).join('')}<button class="btn ghost" type="button" data-v="0">Отмена</button></div>`);

document.addEventListener('click', async e=>{
  const d=e.target.closest('#setdlg'); if (!d) return;
  const h=e.target.closest('[data-sthist]'); if (h){ if (!await StDirty.leave()) return; SettingsHistoryPanel.filter=h.dataset.sthist; StNav.select('history'); return stTab(); }
  const t=e.target.closest('[data-sttab]'); if (t){ if (!await StDirty.leave()) return; const f=$('#stFind'); if (f) f.value=''; StNav.select(t.dataset.sttab); return stTab(); }
  const a=e.target.closest('[data-st]'); if (!a) return;
  if (a.dataset.st==='close'){ if (await StDirty.leave()) d.close(); return; }
  if (a.dataset.st==='logout'){ if (!await StDirty.leave()) return; ajson('logout').catch(()=>{}).then(()=>{ ADMIN.set(false); stRender(); FEAT.refresh(); toast('Вы вышли из «Настроек»'); }); }
});
