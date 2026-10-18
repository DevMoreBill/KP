'use strict';
// «Сотрудники и система → База и копии» (BackupTab): сверху сводка (база, последняя копия, вторая папка, место на диске),
// ниже подвкладки Выгрузить · Загрузить · Автокопии · Обслуживание · История (решение владельца 18.10). В «Выгрузить» и
// «Загрузить» слева — что (вся база, разделы, каталог поставщика, каталог по фильтру, настройки), справа — как и кнопка.
// DataTransfer — выгрузка разделов базы в JSON (каталог целиком или выбранные категории, производители, поставщики, фиды;
// с изображениями — архив .zip: kp-backup.json + img/…) и загрузка такого файла обратно. SettingsFileCard — все настройки в файл и из файла.

class BackupTab {
  static SUBS = [['out','Выгрузить'],['in','Загрузить'],['copies','Автокопии'],['maint','Обслуживание'],['hist','История']];
  // что выгрузить / загрузить: [ключ, название, пояснение в списке]
  static OUT = [['db','Вся база','Один файл .zip — всё как есть'],['parts','Разделы базы','Каталог, клиенты, КП, настройки — на выбор'],
    ['sup','Каталог поставщика','Без цен: копия с фото или Excel для правки'],['goods','Каталог по фильтру','Excel, JSON, XML, YML — с ценами и остатками'],
    ['settings','Настройки программы','Один файл — на другой компьютер']];
  static IN = [['file','Копия или правки','.zip, .json или Excel для правки'],['settings','Файл настроек','КП_настройки_….json'],['db','Файл базы целиком','.sqlite3 или архив копии — заменяет всё']];
  static HIST = [['','Все операции',['export_db','import_db','backup_db','maintain_db']],['out','Выгрузки',['export_db']],['in','Загрузки',['import_db']],['copies','Копии и обслуживание',['backup_db','maintain_db']]];
  static sub = 'out';     // открытая подвкладка
  static out = 'db';      // выбранное в «Выгрузить»
  static inn = 'file';    // выбранное в «Загрузить»
  static hist = '';       // фильтр «Истории»
  static m = null;
  static ov = null;       // сводка /api/admin/maint/overview

  /** строка «что — пояснение — кнопки» (и в «Файле настроек» на вкладке «Файл, изменения, откат») */
  static row(title, note, acts, id=''){
    return `<div class="bk-row"${id?` id="${id}"`:''}><div class="bk-t"><b>${title}</b><small class="muted">${note}</small></div><div class="bk-a">${acts}</div></div>`;
  }

  static async render(m){
    BackupTab.m=m;
    if (StNav.sup){ BackupTab.sub='out'; BackupTab.out='sup'; }
    m.innerHTML=`<div class="bk-sum" id="bkSum">${BackupTab.tiles(null)}</div>
      <div class="bk-tabs" role="tablist" aria-label="База и копии">${BackupTab.SUBS.map(([k,l])=>`<button type="button" role="tab" data-bks="${k}" aria-selected="${k===BackupTab.sub}"${k===BackupTab.sub?' class="on"':''}>${l}</button>`).join('')}</div>
      <div id="bkPane" class="bk-pane"></div>`;
    m.onclick=e=>{ const t=e.target.closest('[data-bks]'); if (t){ BackupTab.go(t.dataset.bks); return; } };
    BackupTab.pane();
    BackupTab.summary();
  }

  /** открыть подвкладку (и выбор слева) — из поиска по настройкам; вкладку затем рисует stTab */
  static at(sub, pick){ BackupTab.sub=sub; if (pick && sub==='out') BackupTab.out=pick; if (pick && sub==='in') BackupTab.inn=pick; }

  static go(sub){
    BackupTab.sub=sub;
    BackupTab.m.querySelectorAll('[data-bks]').forEach(b=>{ const on=b.dataset.bks===sub; b.classList.toggle('on', on); b.setAttribute('aria-selected', on); });
    BackupTab.pane();
  }

  // ---------- сводка: база, последняя копия, вторая папка, место на диске (плитка открывает свою подвкладку)
  static async summary(){
    try{ BackupTab.ov=await aapi('maint/overview'); }catch(e){ BackupTab.ov=null; }
    const box=BackupTab.m && BackupTab.m.querySelector('#bkSum'); if (!box || !BackupTab.ov) return;
    box.innerHTML=BackupTab.tiles(BackupTab.ov);
    const sz=BackupTab.m.querySelector('#bkDbSz'); if (sz) sz.textContent=Fmt.size(BackupTab.ov.dbBytes);
  }

  static tiles(o){
    const T=(sub, label, val, note, cls='')=>`<button type="button" class="bk-tile${cls?' '+cls:''}" data-bks="${sub}"><small>${label}</small><b>${val}</b><span>${note}</span></button>`;
    if (!o) return T('maint', 'База данных', '…', 'загружаю')+T('copies', 'Последняя копия', '…', '')+T('copies', 'Вторая папка', '…', '')+T('maint', 'Свободно на диске', '…', '');
    const c=o.counts||{}, b=o.backup||{}, mr=o.mirror||{}, L=mr.last||{}, d=o.disk;
    const n=(k, w)=>c[k]!=null ? `${w} ${Fmt.num(c[k])}` : '';
    const copy=!b.at ? ['нет', 'копий ещё не было', 'bad'] : !b.ok ? [Fmt.dateTime(b.at), 'с ошибкой', 'bad'] : [Fmt.dateTime(b.at), `${o.stale?'давно · ':'исправна · '}копий ${o.copies}`, o.stale?'warn':'ok'];
    const low=d && d.free < DEFN('srv.lowDiskGB', 2)*1024**3;
    return T('maint', 'База данных', Fmt.size(o.dbBytes), [n('catalog','позиций'), n('kp','КП'), n('clients','клиентов')].filter(Boolean).join(' · '))
      + T('copies', 'Последняя копия', esc(copy[0]), esc(copy[1]), copy[2])
      + T('copies', 'Вторая папка', mr.on ? (L.at ? esc(Fmt.dateTime(L.at)) : 'включена') : 'выключена', mr.on ? (mr.running ? 'идёт копирование' : L.at && !L.ok ? 'последняя — с ошибкой' : mr.stale ? 'копия давно не обновлялась' : 'копии на другом диске') : 'копии только на этом диске', !mr.on ? 'warn' : (mr.stale || (L.at && !L.ok)) ? 'bad' : 'ok')
      + T('maint', 'Свободно на диске', d ? Fmt.size(d.free) : '—', d ? `из ${Fmt.size(d.total)}` : 'не удалось узнать', low ? 'bad' : '');
  }

  // ---------- подвкладки
  static pane(){
    const p=BackupTab.m.querySelector('#bkPane'); p.onclick=null; p.onchange=null; p.oninput=null;
    p.ondragover=null; p.ondrop=null;
    ({out:BackupTab.paneOut, in:BackupTab.paneIn, copies:BackupTab.paneCopies, maint:BackupTab.paneMaint, hist:BackupTab.paneHist})[BackupTab.sub](p);
  }

  /** левый список «что» (радиокнопки) + правая панель с настройками и кнопкой */
  static two(name, list, cur){
    return `<div class="bk-two"><div class="bk-pick" role="radiogroup" aria-label="${name==='bkOut'?'Что выгрузить':'Что загрузить'}">${list.map(([k,l,n])=>`<label class="bk-opt${k===cur?' on':''}"><input type="radio" name="${name}" value="${k}"${k===cur?' checked':''} data-nodirty><span><b>${l}</b><small>${n}</small></span></label>`).join('')}</div>
      <div class="bk-side" id="bkSide"></div></div>`;
  }

  static _pick(p, name, key, draw){
    p.querySelectorAll('.bk-opt').forEach(x=>x.classList.toggle('on', x.querySelector('input').checked));
    BackupTab[key]=p.querySelector(`[name="${name}"]:checked`).value; draw(p.querySelector('#bkSide'));
  }

  static paneOut(p){
    p.innerHTML=BackupTab.two('bkOut', BackupTab.OUT, BackupTab.out);
    p.addEventListener('change', e=>{ if (e.target.name==='bkOut') BackupTab._pick(p, 'bkOut', 'out', BackupTab.sideOut); });
    BackupTab.sideOut(p.querySelector('#bkSide'));
  }

  static foot(btn, note=''){ return `<div class="bk-foot"><span class="bk-note" id="bkSt">${note}</span>${btn}</div>`; }
  static kv(rows){ return `<table class="pv-t bk-kv">${rows.map(([k,v])=>`<tr><td>${k}</td><td>${v}</td></tr>`).join('')}</table>`; }

  static sideOut(s){
    const k=BackupTab.out, o=BackupTab.ov||{}, H=(t, h='')=>`<div class="sub st-mh">${t}${h?' '+tip(h):''}</div>`;
    s.onclick=null; s.onchange=null; s.oninput=null;
    if (k==='db'){
      s.innerHTML=H('Вся база одним файлом', '<p>Архив .zip с файлом kp.sqlite3 внутри — точная копия базы на эту минуту. Изображения (папка img) в него не входят: их копирует «Вторая папка».</p><p>Вернуть — «Загрузить → Файл базы целиком».</p>')
        + BackupTab.kv([['Внутри', 'каталог, КП, клиенты, менеджеры, сделки, настройки, журнал'], ['Формат', '.zip (kp.sqlite3 внутри), без изображений'], ['Размер базы', `<span id="bkDbSz">${o.dbBytes?Fmt.size(o.dbBytes):'…'}</span> — в архиве в 5–20 раз меньше`], ['Обратно', 'заменяет всю базу целиком']])
        + BackupTab.foot('<button class="btn primary" type="button" data-bkx="db">Скачать базу (.zip)</button>');
      s.onclick=e=>{ const b=e.target.closest('[data-bkx]'); if (b) BackupTab._dl(b, 'export/sqlite'); };
    }
    if (k==='parts'){ s.innerHTML=DataTransfer.html(); DataTransfer.mount(s, ()=>BackupTab.summary()); }
    if (k==='sup'){
      s.innerHTML=H('Каталог поставщика', SupplierExport.TIP)
        + `<div class="bk-form" id="seBox"><label class="f"><span>Поставщик</span><select id="seSup" data-nodirty><option value="">Загружаю…</option></select></label>
          <label class="f"><span>Что скачать</span><select id="seFmt" data-nodirty><option value="zip">Копия с фото (.zip) — загрузить обратно или на другой сервер</option><option value="xlsx">Книга Excel для правки (.xlsx) — исправить и загрузить</option></select></label>
          ${BackupTab.foot('<button class="btn primary" type="button" data-se="go">Скачать</button>', 'Цены, закупка и остатки не выгружаются.')}<p class="muted bk-st" id="seSt"></p></div>`;
      SupplierExport.mount(s, StNav.sup||''); StNav.sup='';
    }
    if (k==='goods'){
      s.innerHTML=H('Каталог по любому фильтру')
        + BackupTab.kv([['Отбор', 'категория, производитель, поставщик, поиск, «С ценой», «В наличии» — как в каталоге; или галочками'], ['Форматы', 'Excel, JSON, XML, YML (для сайтов и маркетплейсов)'], ['Состав', 'цена, РРЦ, закупка (по галочке), остатки, картинки, нужные параметры']])
        + BackupTab.foot('<button class="btn primary" type="button" data-bkx="goods">Открыть товары…</button>', 'Отберите позиции и нажмите «Выгрузить…» над списком.');
      s.onclick=e=>{ if (e.target.closest('[data-bkx]')) GoodsTab.open(); };
    }
    if (k==='settings'){
      s.innerHTML=H('Все настройки программы', '<p>Значения программы, списки, тексты, функции, категории, тарифы доставки, ставки из Китая, нормы станций, фиды, почта (без пароля), права менеджеров (без паролей), личные настройки.</p><p>Загрузить — «Загрузить → Файл настроек»: сначала покажем разделы файла, отметите, какие заменить.</p>')
        + BackupTab.kv([['Внутри', 'значения, списки, тексты, функции, тарифы, нормы станций, фиды, почта, права менеджеров'], ['Не попадают', 'пароли — никогда; ключи API — только по галочке ниже']])
        + `<label class="ck bk-ck"><input type="checkbox" id="sfKeys" data-nodirty> С ключами API ${tip('<p>Ключи сервисов: проверка контрагентов, перевозчики, PDF, нейросеть, GitHub. Такой файл храните как пароль.</p>')}</label>`
        + BackupTab.foot('<button class="btn primary" type="button" data-bkx="settings">Скачать файл настроек</button>');
      s.querySelector('#sfKeys').onchange=async e=>{ if (e.target.checked && !await stConfirm('Сохранить вместе с ключами API?', 'В файл попадут ключи сервисов (проверка контрагентов, перевозчики, PDF, нейросеть, GitHub). Храните его как пароль и не пересылайте.', 'С ключами')) e.target.checked=false; };
      s.onclick=e=>{ const b=e.target.closest('[data-bkx]'); if (b) BackupTab._dl(b, 'settings-file'+(s.querySelector('#sfKeys').checked?'?keys=1':'')); };
    }
  }

  static async _dl(b, url){ b.disabled=true; try{ if (await DataTransfer.download(url, BackupTab.m.querySelector('#bkSt'))) BackupTab.summary(); } finally{ b.disabled=false; } }

  // ---------- «Загрузить»: файл — кнопкой или перетаскиванием, сначала предпросмотр
  static paneIn(p){
    p.innerHTML=BackupTab.two('bkIn', BackupTab.IN, BackupTab.inn);
    p.addEventListener('change', e=>{ if (e.target.name==='bkIn') BackupTab._pick(p, 'bkIn', 'inn', BackupTab.sideIn); });
    p.ondragover=e=>{ if (e.target.closest('.bk-drop')){ e.preventDefault(); e.target.closest('.bk-drop').classList.add('over'); } };
    p.ondragleave=e=>{ const z=e.target.closest('.bk-drop'); if (z) z.classList.remove('over'); };
    p.ondrop=e=>{ const z=e.target.closest('.bk-drop'); if (!z) return; e.preventDefault(); z.classList.remove('over');
      const f=e.dataTransfer.files[0]; if (f) BackupTab._file(p.querySelector('#bkSide'), f); };
    BackupTab.sideIn(p.querySelector('#bkSide'));
  }

  static sideIn(s){
    const k=BackupTab.inn, drop=(id, acc, what)=>`<div class="bk-drop"><input type="file" id="${id}" accept="${acc}" class="sr-file"><label for="${id}" class="btn">Выбрать файл…</label><span class="muted">или перетащите ${what} сюда</span></div>`;
    s.onclick=null; s.onchange=null;
    const H=(t, h)=>`<div class="sub st-mh">${t} ${tip(h)}</div>`;
    if (k==='file') s.innerHTML=H('Копия или правки', '<p><b>.json</b> или <b>.zip</b> — выгрузка «Разделы базы» или «Каталог поставщика»: записи с теми же id заменяются, новые добавляются, ничего не удаляется; изображения — только недостающие.</p><p><b>Книга Excel для правки</b> — меняются только исправленные ячейки; поля, изменённые после выгрузки, пропускаются.</p>')
      + BackupTab.kv([['Подходит', 'выгрузка «Разделы базы» (.json, .zip), «Каталог поставщика» (.zip, .xlsx)'], ['Сначала', 'покажем, сколько записей добавится и заменится'], ['Перед загрузкой', 'программа сама сохранит копию базы']]) + drop('impF', '.json,.zip,.xlsx,application/json,application/zip', 'файл') + '<div id="impP" class="bk-prev"></div>';
    if (k==='settings') s.innerHTML=H('Файл настроек', '<p>Файл «КП_настройки_….json» из «Выгрузить → Настройки программы». Свои ключи API и пароль почты остаются, если в файле их нет. Каждое изменение попадёт в «Историю изменений настроек» — его можно вернуть.</p>')
      + BackupTab.kv([['Подходит', 'КП_настройки_….json'], ['Сначала', 'покажем разделы файла — отметите, какие заменить']]) + drop('sfFile', '.json,application/json', 'файл') + '<div id="sfPrev" class="bk-prev"></div>';
    if (k==='db') s.innerHTML=H('Файл базы целиком', '<p>Так и нужно подменять базу: вручную копировать kp.sqlite3 в папку data нельзя — рядом лежат файлы kp.sqlite3-wal и -shm от прежней базы, и она повредится («database disk image is malformed»).</p>')
      + BackupTab.kv([['Подходит', '.sqlite3 или .zip с ним (выгрузка «Вся база», автокопия из data\\backup)'], ['Что будет', '<b class="warn-t">вся база заменится</b>; текущая сохранится в копию (data\\backup)'], ['После', 'страница обновится сама']]) + drop('impDb', '.sqlite3,.sqlite,.db,.zip', 'файл базы') + '<p class="muted bk-st" id="impDbSt"></p>';
    s.onchange=e=>{ const i=e.target.closest('input[type=file]'); if (!i) return; const f=i.files[0]; i.value=''; if (f) BackupTab._file(s, f); };
    if (k==='file') DataTransfer.bindImport(s, ()=>BackupTab.summary(), true);
    if (k==='settings') s.onclick=e=>{ const ap=e.target.closest('[data-sfapply]'); if (ap) SettingsFileCard.apply(s, ap); };
  }

  static _file(s, f){
    if (BackupTab.inn==='file') return DataTransfer._preview(s, f);
    if (BackupTab.inn==='settings') return SettingsFileCard.preview(s, f);
    return BackupTab._db(s, f);
  }

  static async _db(s, f){
    if (!await stConfirm('Заменить всю базу файлом «'+f.name+'»?','Текущие данные будут заменены содержимым файла. Перед этим программа сохранит копию текущей базы в data\\backup.','Заменить базу')) return;
    const st=s.querySelector('#impDbSt'); st.textContent=`Загружаю «${f.name}» (${Fmt.size(f.size)})…`;
    try{ const j=await aapi('import/sqlite?name='+encodeURIComponent(f.name), {method:'POST', headers:{'Content-Type':'application/octet-stream'}, body:f});
      st.textContent=''; toast(`База заменена: позиций ${Fmt.num(j.catalog)}, КП ${Fmt.num(j.kp)}. Прежняя сохранена: ${j.backup.split(/[\\/]/).pop()}`);
      setTimeout(()=>location.reload(), 1500); }
    catch(err){ st.textContent=''; toast('Не загружено: '+(err.message||err)); }
  }

  // ---------- «Автокопии», «Обслуживание»
  static paneCopies(p){
    p.innerHTML='<div class="st-card" id="stMaint"><p class="muted">Загружаю…</p></div><div class="st-card" id="stMirror"></div>';
    DbMaint.render(p.querySelector('#stMaint'), BackupTab.ov, 'copies');
    new MirrorCard(p.querySelector('#stMirror')).open();
    p.addEventListener('click', e=>{ if (e.target.closest('[data-mt],[data-mb]')) setTimeout(()=>BackupTab.summary(), 1500); });
  }

  static paneMaint(p){
    const c=(BackupTab.ov||{}).counts||{}, N=[['catalog','Позиций каталога'],['kp','КП'],['clients','Клиентов'],['managers','Менеджеров'],['deals','Сделок']].filter(([k])=>c[k]!=null);
    p.innerHTML=`<div class="st-card" id="stMaint"><p class="muted">Загружаю…</p></div>
      ${N.length?`<div class="st-card"><p class="sub">Записей в базе</p><div class="bk-nums">${N.map(([k,l])=>`<div><b>${Fmt.num(c[k])}</b><small>${l}</small></div>`).join('')}</div></div>`:''}
      <div id="stMigr"></div>`;
    DbMaint.render(p.querySelector('#stMaint'), BackupTab.ov, 'service');
    stMigr(p.querySelector('#stMigr'));
  }

  // ---------- «История»: выгрузки, загрузки, копии и обслуживание
  static paneHist(p){
    p.innerHTML=`<div class="st-card"><div class="row bk-hh"><p class="sub" style="margin:0">История операций с базой</p><span class="sp"></span>
        <select id="bkHf" aria-label="Какие операции" data-nodirty>${BackupTab.HIST.map(([k,l])=>`<option value="${k}"${k===BackupTab.hist?' selected':''}>${l}</option>`).join('')}</select></div>
      <div id="bkHist"><p class="muted">Загружаю…</p></div><p class="muted">Последние 30 операций; все — в «Журнале действий».</p></div>`;
    p.onchange=e=>{ if (e.target.id==='bkHf'){ BackupTab.hist=e.target.value; BackupTab.history(p.querySelector('#bkHist')); } };
    BackupTab.history(p.querySelector('#bkHist'));
  }

  static async history(box){
    const acts=(BackupTab.HIST.find(x=>x[0]===BackupTab.hist)||BackupTab.HIST[0])[2];
    try{ const rs=await Promise.all(acts.map(a=>aapi('audit?'+new URLSearchParams({action:a}))));
      const ops=rs.flatMap(r=>r.items).sort((x,y)=>y.id-x.id).slice(0,30), A=x=>x.after||{};
      const ENT={auto:'автокопия', mirror:'во вторую папку', vacuum:'', sqlite:'вся база'}, ids=v=>String(v||'').split(',').map(k=>DataTransfer.NAMES[k]||k).join(', '), what=x=>[x.entityId in ENT ? ENT[x.entityId] : ids(x.entityId), A(x).supplier||'', A(x).file||'', A(x).path||''].filter(Boolean).map(esc).join(' · ');
      box.innerHTML=ops.length ? `<table class="pv-t bk-hist"><thead><tr><th>Когда</th><th>Операция</th><th>Что</th><th>Кто</th></tr></thead><tbody>${ops.map(x=>`<tr><td>${esc(Fmt.dateTime(x.timestamp))}</td><td><b class="${x.result==='failed'?'bad-t':''}">${esc(ACT[x.action]||x.action)}</b></td><td>${what(x)}${A(x).bytes?' · '+Fmt.size(A(x).bytes):''}</td><td>${esc(x.userName||x.userId||'')}</td></tr>`).join('')}</tbody></table>` : '<p class="empty">Операций ещё не было.</p>'; }
    catch(e){ box.innerHTML=`<p class="muted">${esc(e.message||e)}</p>`; }
  }
}

class DataTransfer {
  static SECTIONS = [['catalog','Каталог'],['clients','Клиенты'],['settings','Настройки программы'],['suppliers','Поставщики и ТН ВЭД'],['managers','Менеджеры'],['kp','КП (журнал)'],['audit','Журнал действий']];
  static NAMES = {catalog:'Каталог',kp:'КП',managers:'Менеджеры',clients:'Клиенты',suppliers:'Поставщики',settings:'Настройки программы'};
  // быстрый выбор: что отметить
  static PRESETS = [['all','Всё',null],['catalog','Только каталог',['catalog','settings']],['clients','Только клиенты',['clients']],['settings','Только настройки',['settings']]];
  static file = null;

  /** «Выгрузить → Разделы базы» (правая панель вкладки): быстрый выбор, разделы, каталог, формат, «Скачать» */
  static html(){
    return `<div id="dtExp" class="bk-form"><div class="sub st-mh">Разделы базы ${tip('<p><b>.json</b> — выбранные разделы базы. <b>.zip</b> — тот же JSON и все фото, галереи и логотипы, на которые в нём есть ссылки (папка img).</p><p>Каталог можно выгрузить целиком или выбрать категории, производителей, поставщиков, фиды. Файл загружается обратно в «Загрузить → Копия или правки»: записи с теми же id заменяются, новые добавляются, изображения — только недостающие.</p><p>«Настройки программы» — категории, умолчания, списки, функции, тексты интерфейса, тарифы доставки, фиды, почта; пароли, ключи API и учётные записи не выгружаются.</p>')}</div>
      <label class="f"><span>Быстрый выбор</span><select id="dtPre" data-nodirty>${DataTransfer.PRESETS.map(([k,l])=>`<option value="${k}">${l}</option>`).join('')}<option value="">Свой выбор</option></select></label>
      <div class="f"><span>Разделы</span><div class="bk-cks">${DataTransfer.SECTIONS.map(([v,l])=>`<label class="ck"><input type="checkbox" data-xs="${v}" data-nodirty${v==='audit'?'':' checked'}> ${l}</label>`).join('')}</div></div>
      <div class="f" id="dtCatBox"><span>Каталог</span><div></div></div>
      <label class="f"><span>Формат</span><select id="dtFmt" data-nodirty><option value="zip">.zip — данные и изображения</option><option value="json">.json — только данные</option></select></label>
      ${BackupTab.foot('<button class="btn primary" type="button" data-dx="json">Скачать</button>').replace('id="bkSt"', 'id="dtExpSt"')}</div>`;
  }

  /** скачать файл выгрузки администратора (GET /api/admin/…); st — строка состояния */
  static async download(url, st){
    if (st) st.textContent='Готовлю файл…';
    try{ const r=await fetch('/api/admin/'+url,{headers:{'X-CSRF-Token':ADMIN.csrf}}); if (!r.ok) throw new Error(await r.text());
      const fn=decodeURIComponent((r.headers.get('Content-Disposition')||'').split("''")[1]||'backup'), blob=await r.blob();
      saveFileA(fn, blob); if (st) st.textContent=`Скачано: ${fn} (${Fmt.size(blob.size)})`; return true; }
    catch(err){ if (st) st.textContent=''; toast('Не выгружено: '+(err.message||err)); return false; }
  }

  static async mount(m, done){
    const box=m.querySelector('#dtCatBox>div');
    try{ DataTransfer._cats(box, await aapi('export/scope')); }catch(err){ box.innerHTML=`<p class="muted">${esc(err.message)}</p>`; }
    m.querySelector('#dtExp').addEventListener('click', e=>{ const b=e.target.closest('[data-dx]'); if (b) return DataTransfer._export(m, b.dataset.dx, done);
    });
    m.querySelector('#dtExp').addEventListener('change', e=>{ if (e.target.id==='dtPre') return DataTransfer._preset(m, e.target.value);
      if (e.target.dataset.xs) m.querySelector('#dtPre').value=DataTransfer._which(m);
      DataTransfer._toggle(m, e.target); });
    DataTransfer._preset(m, 'all');
    m.querySelector('#dtExp').addEventListener('input', e=>{ const q=e.target.closest('[data-dtq]'); if (!q) return; const w=norm(q.value);
      q.closest('[data-dtk]').querySelectorAll('[data-dtn]').forEach(c=>{ c.hidden=!!w && !c.dataset.dtn.includes(w); }); });
  }

  // каталог: «Весь каталог» или выбор — категории, производители, поставщики, фиды (несколько в каждом списке; решение
  // владельца 18.10): внутри списка — любое из отмеченного, между списками — всё сразу. Счётчик — по сочетаниям с сервера.
  static S=null;          // {rows:[{cat, maker, sup, feed, n}], feeds:{id: название}}
  static _cats(box, scope){
    DataTransfer.S=scope;
    const rows=scope.rows||[], total=rows.reduce((s,r)=>s+r.n,0), sum=(key)=>{ const o=new Map(); rows.forEach(r=>o.set(r[key], (o.get(r[key])||0)+r.n)); return o; };
    const groups=new Map();
    for (const [cat, n] of sum('cat')){ const t=cat ? typeById(cat) : null, ok=t&&t.id===cat, g=ok ? t.group||'Прочее' : 'Без категории';
      if (!groups.has(g)) groups.set(g, []); groups.get(g).push({cat, name:ok ? t.name : (cat||'Без категории'), n}); }
    const chip=(attr, v, label, n)=>`<label class="chk-chip" data-dtn="${esc(norm(label))}"><input type="checkbox" ${attr}="${esc(v)}"> ${esc(label)} · ${Fmt.num(n)}</label>`;
    const byN=(m)=>[...m].sort((x,y)=>y[1]-x[1] || String(x[0]).localeCompare(String(y[0]), 'ru'));
    const block=(k, title, body, n, find)=>`<details class="dt-k" data-dtk="${k}"${k==='cats'?' open':''}><summary>${title} <span class="muted">· ${n}</span> <b class="md-c" data-dtc="${k}" hidden></b></summary>
      ${find?`<input type="search" class="dt-find" data-dtq="${k}" placeholder="${esc(find)}" autocomplete="off" data-nodirty>`:''}<div class="chips dt-l">${body}</div></details>`;
    const cats=[...groups].map(([g,L],i)=>L.length===1 && L[0].name===g
      ? `<div class="dt-g">${chip('data-dc', L[0].cat, g, L[0].n)}</div>`
      : `<div class="dt-g"><label class="chk-chip dt-gh"><input type="checkbox" data-dg="${i}"> <b>${esc(g)}</b> · ${Fmt.num(L.reduce((s,x)=>s+x.n,0))}</label>
        <div class="chips">${L.map(x=>`<label class="chk-chip"><input type="checkbox" data-dc="${esc(x.cat)}" data-dgi="${i}"> ${esc(x.name)} · ${Fmt.num(x.n)}</label>`).join('')}</div></div>`).join('');
    const mk=byN(sum('maker')), sp=byN(sum('sup')), fd=byN(sum('feed'));
    box.innerHTML=`<div class="chips" role="radiogroup"><label class="chk-chip"><input type="radio" name="dtScope" value="all" checked> Весь каталог · ${Fmt.num(total)}</label>
        <label class="chk-chip"><input type="radio" name="dtScope" value="some"> Выбрать: категории, производители, поставщики, фиды</label></div>
      <div id="dtCats" hidden style="margin-top:8px"><p class="muted dt-how">В каждом списке можно отметить несколько. Внутри списка — любое из отмеченного, между списками — всё сразу (например, производитель Atlas Copco <b>и</b> поставщик «Абсолют»).</p>
        ${block('cats', 'Категории', cats, groups.size+' гр.')}
        ${block('makers', 'Производители', mk.map(([v,n])=>chip('data-dm', v, v, n)).join(''), mk.length, mk.length>12?'Найти производителя':'')}
        ${block('sups', 'Поставщики', sp.map(([v,n])=>chip('data-ds', v, v, n)).join(''), sp.length, sp.length>12?'Найти поставщика':'')}
        ${block('feeds', 'Фиды', fd.map(([v,n])=>chip('data-df', v, (scope.feeds||{})[v]||v||'Не из фида', n)).join(''), fd.length, fd.length>12?'Найти фид':'')}
        <p class="dt-sum" id="dtSel">Ничего не выбрано</p></div>`;
  }

  static _preset(m, key){
    if (!key) return;
    const on=(DataTransfer.PRESETS.find(x=>x[0]===key)||[])[2];
    m.querySelectorAll('[data-xs]').forEach(c=>{ c.checked = on ? on.includes(c.dataset.xs) : c.dataset.xs!=='audit'; });
    m.querySelector('#dtFmt').value = !on || on.includes('catalog') ? 'zip' : 'json';
    DataTransfer._scope(m);
  }

  /** какой быстрый выбор совпадает с отмеченными разделами ('' — свой) */
  static _which(m){
    const on=new Set([...m.querySelectorAll('[data-xs]:checked')].map(c=>c.dataset.xs));
    const same=L=>L.length===on.size && L.every(x=>on.has(x));
    const p=DataTransfer.PRESETS.find(([, , L])=>same(L||DataTransfer.SECTIONS.map(x=>x[0]).filter(x=>x!=='audit')));
    return p ? p[0] : '';
  }

  // выбор групп и категорий — только когда выгружается каталог
  static _scope(m){ const box=m.querySelector('#dtCatBox'), cat=m.querySelector('[data-xs=catalog]'); if (box && cat) box.hidden=!cat.checked; }

  static _toggle(m, el){
    if (el.dataset.xs==='catalog') DataTransfer._scope(m);
    if (el.name==='dtScope') m.querySelector('#dtCats').hidden = el.value!=='some';
    if (el.dataset.dg!=null) m.querySelectorAll(`[data-dgi="${el.dataset.dg}"]`).forEach(c=>{ c.checked=el.checked; });
    if (el.dataset.dgi!=null){ const all=[...m.querySelectorAll(`[data-dgi="${el.dataset.dgi}"]`)], g=m.querySelector(`[data-dg="${el.dataset.dgi}"]`);
      g.checked=all.every(c=>c.checked); g.indeterminate=!g.checked && all.some(c=>c.checked); }
    DataTransfer._count(m);
  }

  /** выбор: {cats, makers, sups, feeds} — только непустые списки */
  static _picked(m){
    const v=a=>[...m.querySelectorAll(`[${a}]:checked`)].map(c=>c.getAttribute(a)), out={};
    for (const [k, a] of [['cats','data-dc'], ['makers','data-dm'], ['sups','data-ds'], ['feeds','data-df']]){ const L=v(a); if (L.length) out[k]=L; }
    return out;
  }

  /** сколько позиций попадёт в выгрузку и сколько отмечено в каждом списке */
  static _count(m){
    const sel=m.querySelector('#dtSel'); if (!sel || !DataTransfer.S) return;
    const p=DataTransfer._picked(m), key=s=>norm(s), set=(k, f)=>p[k] ? new Set(p[k].map(f)) : null;
    const C=set('cats', x=>x), M=set('makers', key), Sp=set('sups', key), F=set('feeds', x=>x);
    m.querySelectorAll('[data-dtc]').forEach(b=>{ const n=(p[b.dataset.dtc]||[]).length; b.hidden=!n; b.textContent=n; });
    if (!Object.keys(p).length){ sel.textContent='Ничего не выбрано'; return; }
    const n=DataTransfer.S.rows.reduce((s,r)=>s+((!C||C.has(r.cat)) && (!M||M.has(key(r.maker))) && (!Sp||Sp.has(key(r.sup))) && (!F||F.has(r.feed)) ? r.n : 0), 0);
    sel.innerHTML=n ? `Будет выгружено позиций: <b>${Fmt.num(n)}</b>` : '<span class="warn-t">Ни одна позиция не подходит под все условия сразу</span>';
  }

  static async _export(m, kind, done){
    const st=m.querySelector('#dtExpSt');
    let url='export/sqlite';
    if (kind==='json'){
      const secs=[...m.querySelectorAll('[data-xs]:checked')].map(c=>c.dataset.xs); if (!secs.length) return toast('Отметьте разделы');
      const some=(m.querySelector('[name="dtScope"]:checked')||{}).value==='some', pick=some ? DataTransfer._picked(m) : {};
      if (some && secs.includes('catalog') && !Object.keys(pick).length) return toast('Отметьте категории, производителей, поставщиков или фиды');
      url='export?'+new URLSearchParams({sections:secs.join(','), images:m.querySelector('#dtFmt').value==='zip'?'1':'0', ...(some && secs.includes('catalog') ? {pick:JSON.stringify(pick)} : {})});
    }
    if (await DataTransfer.download(url, st) && done) setTimeout(done, 1500);
  }

  // ---------- загрузка .json / .zip ----------
  static bindImport(m, done, own){
    if (!own) m.querySelector('#impF').onchange=e=>{ const f=e.target.files[0]; e.target.value=''; if (f) DataTransfer._preview(m, f); };
    m.querySelector('#impP').addEventListener('click', async e=>{ const b=e.target.closest('[data-imp]'); if (!b || !DataTransfer.file) return;
      const patch=b.dataset.patch==='1';
      if (!await stConfirm('Загрузить данные из «'+DataTransfer.file.name+'»?', patch ? 'Перед загрузкой программа сохранит копию текущей базы. В позициях каталога изменятся только перечисленные в файле поля; цены, закупка, остатки и фото не меняются. Поля, изменённые после выгрузки копии, пропускаются.' : 'Перед загрузкой программа сохранит копию текущей базы. Записи с теми же id будут заменены, новые — добавлены, ничего не удаляется. Изображения добавляются только недостающие.'+(b.dataset.keep==='1'?' Цены, закупка и остатки имеющихся позиций не меняются.':''),'Загрузить')) return;
      b.disabled=true;
      try{ const r=await DataTransfer._send('import/file?sections='+b.dataset.imp, DataTransfer.file);
        DataTransfer.file=null; toast(r.patch ? `Правки внесены: позиций ${Fmt.num(r.patch.written)}, полей ${Fmt.num(r.patch.fields)}${r.patch.conflictCount ? `, пропущено ${Fmt.num(r.patch.conflictCount)}` : ''}` : 'Загружено'+(r.images?`, изображений добавлено: ${Fmt.num(r.images.written)}`:''));
        refreshCat(); loadManagers(); loadClients(); if (done) done(); }
      catch(err){ b.disabled=false; toast('Не загружено: '+err.message); } });
  }

  static _send(path, f){ const n=f.name.toLowerCase(), zip=n.endsWith('.zip')||n.endsWith('.xlsx');
    return aapi(path+(path.includes('?')?'&':'?')+'name='+encodeURIComponent(f.name), {method:'POST', headers:{'Content-Type':zip?'application/zip':'application/json; charset=utf-8'}, body:f}); }

  static async _preview(m, f){
    const box=m.querySelector('#impP'); box.innerHTML=`<p class="muted">Проверяю «${esc(f.name)}» (${Fmt.size(f.size)})…</p>`;
    try{ const r=await DataTransfer._send('import/file/preview', f); DataTransfer.file=f;
      if (r.patch){ box.innerHTML=DataTransfer._patchHtml(r); return; }
      const im=r.images;
      box.innerHTML=`<p class="muted">${r.supplier?`Каталог поставщика «${esc(r.supplier)}» — копия`:'Копия'} от ${esc(Fmt.dateTime(r.createdAt))}. Будет:</p><table class="pv-t">${Object.entries(r.report).map(([k,v])=>`<tr><td>${DataTransfer.NAMES[k]||esc(k)}</td><td>новых ${v.new}, заменится ${v.updated}${v.invalid?`, <span class="bad-t">с ошибками ${v.invalid}</span>`:''}</td></tr>`).join('')}
          ${im?`<tr><td>Изображения</td><td>добавится ${Fmt.num(im.new)}, уже есть ${Fmt.num(im.exist)}${im.invalid?`, <span class="bad-t">пропущено ${im.invalid}</span>`:''}</td></tr>`:''}</table>
        ${r.errors.length?`<p class="msg err" style="text-align:left">${r.errors.map(esc).join('<br>')}</p>`:''}
        ${r.keep?'<p class="muted">Цен, закупки и остатков в файле нет — у имеющихся позиций они останутся как сейчас.</p>':''}
        <button class="btn primary" type="button" data-imp="${esc(Object.keys(r.report).join(','))}" data-keep="${r.keep?1:0}" style="margin-top:10px">Загрузить</button>`; }
    catch(err){ DataTransfer.file=null; box.innerHTML=`<p class="msg err" style="text-align:left">${esc(err.message)}</p>`; }
  }

  /** предпросмотр файла правок каталога (CatalogPatch на сервере): сколько позиций и полей изменится, что пропущено */
  static _patchHtml(r){
    const p=r.patch;
    return `<p class="muted">${esc(p.title||'Правки каталога')} — от ${esc(Fmt.dateTime(r.createdAt))}. Будет:</p><table class="pv-t">
        <tr><td>Каталог</td><td>изменится позиций ${Fmt.num(p.items)}, полей ${Fmt.num(p.fields)}${p.same ? `; уже как в файле — ${Fmt.num(p.same)}` : ''}${p.missing ? `; нет в базе — ${Fmt.num(p.missing)}` : ''}</td></tr>
        ${p.conflictCount ? `<tr><td>Пропущено</td><td><span class="bad-t">${Fmt.num(p.conflictCount)}</span> — изменены после выгрузки копии</td></tr>` : ''}</table>
      ${p.conflicts.length ? `<details style="margin-top:6px"><summary class="muted">Что пропущено</summary><p class="muted" style="text-align:left">${p.conflicts.map(esc).join('<br>')}${p.conflictCount>p.conflicts.length ? '<br>…' : ''}</p></details>` : ''}
      ${r.errors.length ? `<p class="msg err" style="text-align:left">${r.errors.map(esc).join('<br>')}</p>` : ''}
      ${p.items ? `<button class="btn primary" type="button" data-imp="catalog" data-patch="1" style="margin-top:10px">Внести правки</button>` : '<p class="muted">Изменять нечего.</p>'}`;
  }
}

// Каталог одного поставщика (поставщик — как в фильтре «Поставщик» окна каталога; сервер: supplier_scope.py) — без цен,
// закупки и остатков: копия с фото (.zip, загружается обратно, цены и остатки при этом не меняются) или книга Excel
// для правки (лист на категорию; загрузка — как файл правок: меняются только исправленные ячейки).
class SupplierExport {
  static groups = [];
  static NONE = 'Без поставщика';
  static EDIT = [['name','Название'],['spec','Кратко (строка под названием)'],['a:maker','Производитель'],['a:model','Модель']];

  static TIP = '<p>Все позиции одного поставщика из справочника «Поставщики и склады» (позиции фида — поставщик, к которому привязан фид, иначе — название фида; позиции не из фида — по производителю). <b>Без цен, закупки и остатков</b>.</p><p><b>Копия с фото (.zip)</b> — резервная копия: загружается ниже, в «Загрузке»; позиции восстанавливаются как были, а цены, закупка и остатки остаются как сейчас в базе.</p><p><b>Excel для правки</b> — лист на каждую категорию: название, производитель, модель и все поля категории. Исправьте ячейки и загрузите книгу в «Загрузке» — изменятся только исправленные поля; поле, которое после выгрузки уже изменили в программе, пропускается. Описание и таблицы характеристик правятся в карточке позиции.</p>';

  static async mount(m, sel=''){
    const box=m.querySelector('#seBox'), st=m.querySelector('#seSt'); if (!box) return;
    try{ SupplierExport.groups=await aapi('export/suppliers'); }catch(err){ if (st) st.textContent=err.message; return; }
    const s=box.querySelector('#seSup');
    s.innerHTML=SupplierExport.groups.map(g=>`<option value="${esc(g.name)}"${norm(g.name)===norm(sel)?' selected':''}>${esc(g.name)} · ${Fmt.num(g.count)}${g.dir||g.name===SupplierExport.NONE?'':' (фид, не привязан к справочнику)'}</option>`).join('')||'<option value="">Каталог пуст</option>';
    box.addEventListener('click', e=>{ const b=e.target.closest('[data-se]'); if (b && s.value) SupplierExport.run(b, s.value, st, b.dataset.se==='go' ? box.querySelector('#seFmt').value : b.dataset.se); });
  }

  static async _get(name, images){
    const r=await fetch('/api/admin/export?'+new URLSearchParams({sup:name, images:images?'1':'0'}), {headers:{'X-CSRF-Token':ADMIN.csrf}});
    if (!r.ok){ const t=await r.text(); let msg=t; try{ msg=JSON.parse(t).error||t; }catch(e){ /* не JSON — текст как есть */ } throw new Error(msg||'ошибка '+r.status); }
    return r;
  }

  static async run(b, name, st, kind){
    b.disabled=true; st.textContent='Готовлю файл…';
    try{
      if (kind==='zip'){ const r=await SupplierExport._get(name, true), fn=decodeURIComponent((r.headers.get('Content-Disposition')||'').split("''")[1]||'catalog.zip'), blob=await r.blob();
        saveFileA(fn, blob); st.textContent=`Скачано: ${fn} (${Fmt.size(blob.size)})`; }
      else { const d=await (await SupplierExport._get(name, false)).json(), items=(d.sections||{}).catalog||[];
        const fn=`Каталог_${name.replace(/[^\wа-яё.-]+/gi,'_').slice(0,60)}_${today()}_для_правки.xlsx`;
        saveFileA(fn, await makeXlsx(SupplierExport.book(items, name), 'Каталог '+name)); st.textContent=`Скачано: ${fn} — позиций ${Fmt.num(items.length)}`; }
    }catch(err){ st.textContent=''; toast('Не выгружено: '+(err.message||err)); }
    finally{ b.disabled=false; }
  }

  /** книга: «Как править», лист на категорию (строка 1 — названия, строка 2 — служебные ключи), скрытый «_было» */
  static book(items, name){
    const byCat=new Map(); items.forEach(x=>{ const c=(x.attrs||{}).cat||''; if (!byCat.has(c)) byCat.set(c, []); byCat.get(c).push(x); });
    const used=new Set(), sheetName=t=>{ let n=String(t||'Без категории').replace(/[[\]:*?/\\]/g,' ').slice(0,28).trim()||'Лист', k=n, i=2; while (used.has(k.toLowerCase())) k=n.slice(0,25)+' '+(i++); used.add(k.toLowerCase()); return k; };
    used.add('как править'); used.add('_было');
    const cell=v=>typeof v==='number' ? {v, s:'td'} : typeof v==='boolean' ? {v:v?'да':'нет', s:'td'} : {v:v==null?'':String(v), s:'td'};
    const val=(x,k)=>k.startsWith('a:') ? (x.attrs||{})[k.slice(2)] : x[k];
    const orig=[['id','ключ','значение']], sheets=[];
    [...byCat].sort((a,b)=>b[1].length-a[1].length).forEach(([cat, L])=>{
      const t=typeById(cat), own=t.id===cat ? t.fields||[] : [];
      const cols=[...SupplierExport.EDIT, ...own.filter(f=>!['maker','model','cat'].includes(f.key)).map(f=>['a:'+f.key, f.label+(f.unit?', '+f.unit:'')])];
      const extra=new Set(); L.forEach(x=>Object.keys(x.attrs||{}).forEach(k=>{ if (k!=='cat' && !cols.some(c=>c[0]==='a:'+k)) extra.add(k); }));
      extra.forEach(k=>cols.push(['a:'+k, k]));
      const rows=[[{v:'Код позиции (не менять)', s:'head'}, ...cols.map(c=>({v:c[1], s:'head'}))], [{v:'id', s:'note'}, ...cols.map(c=>({v:c[0], s:'note'}))]];
      L.forEach(x=>{ rows.push([{v:x.id, s:'td'}, ...cols.map(c=>cell(val(x, c[0])))]); orig.push([x.id]);
        cols.forEach(c=>{ const v=val(x, c[0]); if (v!=null && v!=='') orig.push([x.id, c[0], JSON.stringify(v)]); }); });
      sheets.push({name:sheetName(t.id===cat ? t.name : cat), cols:[22, 44, 40, 18, 22, ...cols.slice(4).map(()=>16)], rows, freeze:2});
    });
    const help=[[{v:'Каталог поставщика «'+name+'» — для правки', s:'title'}], [{v:`Выгружено ${Fmt.dateTime(new Date().toISOString())}, позиций ${items.length}. Цен, закупки и остатков в книге нет.`, s:'sub'}], [],
      ...['1. На листах категорий исправьте нужные ячейки: название, производитель, модель, поля категории. Пустая ячейка — поле очищается (название не стирается).',
        '2. Не меняйте столбец «Код позиции» и вторую (серую) строку с ключами; строки и листы не добавляйте — новые позиции из книги не создаются.',
        '3. «Настройки → Сотрудники и система → База и копии → Загрузить → Копия или правки» → выберите эту книгу: программа покажет, сколько позиций и полей изменится, и попросит подтвердить.',
        '4. Если поле после выгрузки уже изменили в программе (вручную или фидом), правка этого поля пропускается и попадает в отчёт.',
        'Описание и таблицы характеристик правятся в карточке позиции; цены — в карточке или фидом.'].map(t=>[{v:t, s:'text'}])];
    return [{name:'Как править', cols:[120], rows:help}, ...sheets, {name:'_было', hidden:true, cols:[22, 20, 40], rows:orig}];
  }
}

// Все настройки программы в файл и обратно (сервер — data_bundle.SettingsFile): значения, списки, тексты, функции, тарифы,
// нормы станций, фиды, почта (без пароля), права менеджеров (без паролей), личные настройки. Ключи API — только по галочке
// (с предупреждением); пароли — никогда. Загрузка — предпросмотр по разделам и выбор, что заменить.
class SettingsFileCard {
  static file = null;

  static render(m){
    m.innerHTML=`<div class="st-card sf"><p class="sub">Все настройки — в файл и из файла</p>
      <p class="muted">Значения программы, списки, тексты, функции, категории, тарифы доставки, ставки из Китая, нормы станций, фиды, почта (без пароля), права менеджеров, личные настройки — одним файлом: перенести на другой компьютер или сохранить перед большими правками. Пароли в файл не попадают никогда.</p>
      ${BackupTab.row('Сохранить', 'Файл КП_настройки_….json. С ключами API — только если отметить: такой файл храните как пароль.', '<label class="cx-ck"><input type="checkbox" id="sfKeys"> с ключами API</label><button class="btn primary" type="button" data-sf="save">Сохранить все настройки в файл</button>')}
      ${BackupTab.row('Загрузить', 'Сначала покажем разделы файла — отметьте, какие заменить. Свои ключи и пароль почты остаются, если в файле их нет.', '<input type="file" id="sfFile" accept=".json,application/json" class="sr-file"><label for="sfFile" class="btn">Загрузить настройки из файла…</label>')}
      <div id="sfPrev"></div></div>`;
    m.querySelector('#sfKeys').onchange=async e=>{ if (!e.target.checked) return;
      if (!await stConfirm('Сохранить вместе с ключами API?', 'В файл попадут ключи сервисов (проверка контрагентов, перевозчики, PDF, нейросеть, GitHub). Храните его как пароль и не пересылайте по почте и в мессенджерах. Пароли в файл не попадают.', 'Да, с ключами')) e.target.checked=false; };
    m.onclick=async e=>{
      if (e.target.closest('[data-sf="save"]')){ const keys=m.querySelector('#sfKeys').checked;
        await DataTransfer.download('settings-file'+(keys?'?keys=1':''), null); return; }
      const ap=e.target.closest('[data-sfapply]'); if (ap) return SettingsFileCard.apply(m, ap); };
    m.querySelector('#sfFile').onchange=async e=>{ const f=e.target.files[0]; e.target.value=''; if (f) SettingsFileCard.preview(m, f); };
  }

  static async preview(m, f){
    const box=m.querySelector('#sfPrev'); box.innerHTML=`<p class="muted">Проверяю «${esc(f.name)}»…</p>`;
    try{ const r=await aapi('settings-file/preview', {method:'POST', headers:{'Content-Type':'application/json; charset=utf-8'}, body:f}); SettingsFileCard.file=f;
      box.innerHTML=`<p class="muted">Файл от ${esc(Fmt.dateTime(r.createdAt))}${r.app?', версия программы '+esc(r.app):''}${r.keys?' · <b class="warn-t">с ключами API</b>':''}. Отметьте, что заменить:</p>
        <div class="sf-list">${r.sections.map(x=>`<label class="sf-r"><input type="checkbox" data-sfk="${esc(x.key)}"${x.same?'':' checked'}><span>${esc(x.label)}</span><small class="${x.same?'muted':'warn-t'}">${x.same?'как сейчас':'отличается'}</small></label>`).join('')}</div>
        <div class="row"><button class="btn primary" type="button" data-sfapply>Загрузить отмеченное</button><span class="muted">Каждое изменение попадёт в «Историю» — его можно вернуть.</span></div>`; }
    catch(err){ SettingsFileCard.file=null; box.innerHTML=`<p class="msg err" style="text-align:left">${esc(err.message||err)}</p>`; }
  }

  static async apply(m, b){
    const f=SettingsFileCard.file, keys=[...m.querySelectorAll('[data-sfk]:checked')].map(i=>i.dataset.sfk);
    if (!f) return; if (!keys.length) return toast('Отметьте разделы');
    if (!await stConfirm(`Заменить настройки (${keys.length})?`, 'Отмеченные разделы станут как в файле. Прежние значения — в «Истории изменений», их можно вернуть.', 'Заменить')) return;
    b.disabled=true;
    try{ const r=await aapi('settings-file?sections='+encodeURIComponent(keys.join(',')), {method:'POST', headers:{'Content-Type':'application/json; charset=utf-8'}, body:f});
      SettingsFileCard.file=null; toast(`Загружено разделов: ${r.applied.length}`+(r.errors.length?`; не загружено: ${r.errors.join('; ')}`:''));
      await StRefresh.all(); await loadTypes(); stTab(); }
    catch(err){ b.disabled=false; toast('Не загружено: '+(err.message||err)); }
  }
}
