'use strict';
// «Сотрудники и система → База и копии» (BackupTab): сверху сводка (база, последняя копия, вторая папка, место на диске),
// ниже подвкладки Выгрузить · Загрузить · Автокопии · Обслуживание · История (решение владельца 18.10). В «Выгрузить» и
// «Загрузить» слева — что (вся база, разделы, каталог поставщика, каталог по фильтру, настройки), справа — как и кнопка.
// DataTransfer — выгрузка разделов базы в JSON (каталог целиком или выбранные категории, производители, поставщики, фиды;
// с изображениями — архив .zip: kp-backup.json + img/…) и загрузка такого файла обратно. SettingsFileCard — все настройки в файл и из файла.

class BackupTab {
  static SUBS = [['out','Выгрузить'],['in','Загрузить'],['copies','Автокопии'],['maint','Обслуживание'],['hist','История']];
  // что выгрузить / загрузить: [ключ, название, пояснение в списке]
  static OUT = [['db','Вся база','Все разделы одним файлом'],['parts','Разделы базы','Каталог, клиенты, КП, настройки — на выбор'],
    ['sup','Каталог поставщика','Позиции поставщика, без цен'],['filter','Каталог по фильтру','Категория, марка, поиск — с ценами на выбор'],
    ['settings','Настройки программы','Перенести на другой компьютер']];
  static IN = [['file','Копия или правки','Любой выгруженный файл: Excel, JSON, XML, YML, .zip'],['settings','Файл настроек','КП_настройки_… любого формата'],['db','Файл базы целиком','.sqlite3 или архив копии — заменяет всё']];
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
    p.onchange=e=>{ if (e.target.name==='bkOut') BackupTab._pick(p, 'bkOut', 'out', BackupTab.sideOut); };
    BackupTab.sideOut(p.querySelector('#bkSide'));
  }

  static foot(btn, note=''){ return `<div class="bk-foot"><span class="bk-note" id="bkSt">${note}</span>${btn}</div>`; }
  static kv(rows){ return `<table class="pv-t bk-kv">${rows.map(([k,v])=>`<tr><td>${k}</td><td>${v}</td></tr>`).join('')}</table>`; }

  // общий список форматов у всех вариантов выгрузки (решение владельца 18.10); у «Вся база» ещё точная копия .sqlite
  static FMT = [['xlsx','Excel (.xlsx) — таблица, можно править'],['json','JSON — данные как есть'],['xml','XML'],['yml','YML — для сайтов (только каталог, без закупки)'],['zip','Архив .zip — данные и все фото']];
  static SQLITE = ['sqlite','Точная копия базы (.sqlite в архиве .zip)'];
  static FMT_TIP = '<p>У всех вариантов выгрузки — одни и те же форматы, и любой файл загружается обратно: «Загрузить → Копия или правки» (настройки — «Файл настроек»).</p><p><b>Excel</b> — лист на раздел: строка 2 — служебные ключи, столбец «Код» не меняйте; при загрузке можно взять только изменённые строки. <b>JSON</b> и <b>XML</b> — данные как есть. <b>YML</b> — каталог в формате Яндекса для сайтов и маркетплейсов (и данные для загрузки обратно). <b>Архив .zip</b> — JSON и все фото, на которые он ссылается.</p>';
  static ALL = 'catalog,kp,managers,clients,suppliers,audit,settings';
  static flt = null;     // «Каталог по фильтру»: выбранное (переживает переключение вариантов)

  static fmt(){ try{ return localStorage.getItem('kp.bk.fmt')||'xlsx'; }catch(e){ return 'xlsx'; } }
  static fmtOpts(sqlite=false){
    const cur=BackupTab.fmt(), L=[...(sqlite?[BackupTab.SQLITE]:[]), ...BackupTab.FMT];
    return L.map(([k,l])=>`<option value="${k}"${k===cur?' selected':''}>${l}</option>`).join('');
  }
  static fmtSel(sqlite=false){
    return `<label class="f"><span class="st-mh">Формат ${tip(BackupTab.FMT_TIP)}</span><select id="bkFmt" data-nodirty>${BackupTab.fmtOpts(sqlite)}</select></label>`;
  }
  /** выбранный формат (запоминается для всех вариантов, кроме точной копии базы) */
  static fmtOf(s){ const v=s.querySelector('#bkFmt').value; if (v!=='sqlite') try{ localStorage.setItem('kp.bk.fmt', v); }catch(e){ /* без запоминания */ } return v; }

  static sideOut(s){
    const k=BackupTab.out, o=BackupTab.ov||{}, H=(t, h='')=>`<div class="sub st-mh">${t}${h?' '+tip(h):''}</div>`;
    s.onclick=null; s.onchange=null; s.oninput=null;
    if (k==='db'){
      s.innerHTML=`<div class="bk-form">${H('Вся база одним файлом', '<p>Все разделы: каталог, КП, клиенты, менеджеры, поставщики, настройки, журнал действий. Любой формат загружается обратно в «Загрузить → Копия или правки» (записи с теми же кодами заменяются, новые добавляются).</p><p><b>Точная копия базы</b> — файл kp.sqlite3 в архиве: заменяет всю базу целиком («Загрузить → Файл базы целиком»). Изображения (папка img) в неё не входят — их копирует «Вторая папка».</p>')}`
        + BackupTab.kv([['Внутри', 'каталог, КП, клиенты, менеджеры, поставщики, настройки, журнал'], ['Размер базы', `<span id="bkDbSz">${o.dbBytes?Fmt.size(o.dbBytes):'…'}</span>`]])
        + BackupTab.fmtSel(true) + BackupTab.foot('<button class="btn primary" type="button" data-bkx="db">Скачать</button>') + '</div>';
      s.onclick=e=>{ const b=e.target.closest('[data-bkx]'); if (!b) return; const f=BackupTab.fmtOf(s);
        BackupTab._dl(b, f==='sqlite' ? 'export/sqlite' : 'export?'+new URLSearchParams({sections:BackupTab.ALL, fmt:f})); };
    }
    if (k==='parts'){ s.innerHTML=DataTransfer.html(); DataTransfer.mount(s, ()=>BackupTab.summary()); }
    if (k==='sup'){
      s.innerHTML=`<div class="bk-form" id="seBox">${H('Каталог поставщика', SupplierExport.TIP)}<label class="f"><span>Поставщик</span><select id="seSup" data-nodirty><option value="">Загружаю…</option></select></label>
          ${BackupTab.fmtSel()}${BackupTab.foot('<button class="btn primary" type="button" data-se="go">Скачать</button>', 'Без цен, закупки и остатков — при загрузке они остаются как в программе.')}<p class="muted bk-st" id="seSt"></p></div>`;
      SupplierExport.mount(s, StNav.sup||''); StNav.sup='';
    }
    if (k==='filter') CatFilterPane.mount(s);
    if (k==='settings'){
      s.innerHTML=`<div class="bk-form">${H('Все настройки программы', '<p>Значения программы, списки, тексты, функции, категории, тарифы доставки, ставки из Китая, нормы станций, фиды, почта (без пароля), права менеджеров (без паролей), личные настройки.</p><p>Загрузить — «Загрузить → Файл настроек»: сначала покажем разделы файла, отметите, какие заменить.</p>')}`
        + BackupTab.kv([['Внутри', 'значения, списки, тексты, функции, тарифы, нормы станций, фиды, почта, права менеджеров'], ['Не попадают', 'пароли — никогда; ключи API — только по галочке ниже']])
        + `<label class="ck bk-ck"><input type="checkbox" id="sfKeys" data-nodirty> С ключами API ${tip('<p>Ключи сервисов: проверка контрагентов, перевозчики, PDF, нейросеть, GitHub. Такой файл храните как пароль.</p>')}</label>`
        + BackupTab.fmtSel() + BackupTab.foot('<button class="btn primary" type="button" data-bkx="settings">Скачать</button>') + '</div>';
      s.querySelector('#sfKeys').onchange=async e=>{ if (e.target.checked && !await stConfirm('Сохранить вместе с ключами API?', 'В файл попадут ключи сервисов (проверка контрагентов, перевозчики, PDF, нейросеть, GitHub). Храните его как пароль и не пересылайте.', 'С ключами')) e.target.checked=false; };
      s.onclick=e=>{ const b=e.target.closest('[data-bkx]'); if (b) BackupTab._dl(b, 'settings-file?'+new URLSearchParams({fmt:BackupTab.fmtOf(s), ...(s.querySelector('#sfKeys').checked?{keys:'1'}:{})})); };
    }
  }

  static async _dl(b, url){ b.disabled=true; try{ if (await DataTransfer.download(url, BackupTab.m.querySelector('#bkSt'))) BackupTab.summary(); } finally{ b.disabled=false; } }

  // ---------- «Загрузить»: файл — кнопкой или перетаскиванием, сначала предпросмотр
  static paneIn(p){
    p.innerHTML=BackupTab.two('bkIn', BackupTab.IN, BackupTab.inn);
    p.onchange=e=>{ if (e.target.name==='bkIn') BackupTab._pick(p, 'bkIn', 'inn', BackupTab.sideIn); };
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
    if (k==='file') s.innerHTML=H('Копия или правки', '<p>Любой файл из «Выгрузить» — Excel, JSON, XML, YML или архив .zip: вся база, разделы, каталог поставщика, каталог по фильтру. Записи с теми же кодами заменяются, новые добавляются, ничего не удаляется; изображения из архива — только недостающие.</p><p><b>Только изменённое в файле</b> (по умолчанию для Excel) — загрузятся записи, которые правили в файле; если ту же запись успели изменить и в программе — она пропускается с отчётом.</p><p>Подходит и книга «…_для_правки.xlsx» прежних версий.</p>')
      + BackupTab.kv([['Подходит', 'любой выгруженный файл: .xlsx, .json, .xml, .yml, .zip'], ['Сначала', 'покажем, сколько записей добавится и заменится'], ['Перед загрузкой', 'программа сама сохранит копию базы']]) + drop('impF', '.xlsx,.json,.xml,.yml,.zip', 'файл') + '<div id="impP" class="bk-prev"></div>';
    if (k==='settings') s.innerHTML=H('Файл настроек', '<p>Файл «КП_настройки_…» любого формата из «Выгрузить → Настройки программы». Свои ключи API и пароль почты остаются, если в файле их нет. Каждое изменение попадёт в «Историю изменений настроек» — его можно вернуть.</p>')
      + BackupTab.kv([['Подходит', 'КП_настройки_… (.xlsx, .json, .xml, .yml, .zip)'], ['Сначала', 'покажем разделы файла — отметите, какие заменить']]) + drop('sfFile', '.xlsx,.json,.xml,.yml,.zip', 'файл') + '<div id="sfPrev" class="bk-prev"></div>';
    if (k==='db') s.innerHTML=H('Файл базы целиком', '<p>Так и нужно подменять базу: вручную копировать kp.sqlite3 в папку data нельзя — рядом лежат файлы kp.sqlite3-wal и -shm от прежней базы, и она повредится («database disk image is malformed»).</p>')
      + BackupTab.kv([['Подходит', '.sqlite3 или .zip с ним (выгрузка «Вся база», автокопия из data\\backup)'], ['Что будет', '<b class="warn-t">вся база заменится</b>; текущая сохранится в копию (data\\backup)'], ['После', 'страница обновится сама']]) + drop('impDb', '.sqlite3,.sqlite,.db,.zip', 'файл базы') + '<p class="muted bk-st" id="impDbSt"></p>';
    s.onchange=e=>{ const i=e.target.closest('input[type=file]'); if (!i) return; const f=i.files[0]; i.value=''; if (f) BackupTab._file(s, f); };
    if (k==='file') DataTransfer.bindImport(s, ()=>BackupTab.summary(), true);
    if (k==='settings') s.onclick=e=>{ const ap=e.target.closest('[data-sfapply]'); if (ap) SettingsFileCard.apply(s, ap); };
  }

  /** файл настроек или базы целиком, выбранный в «Копия или правки», — открыть свой пункт и продолжить там */
  static redirect(kind, f){
    BackupTab.inn = kind==='settings' ? 'settings' : 'db';
    const p=BackupTab.m.querySelector('#bkPane'); BackupTab.pane();
    toast(kind==='settings' ? 'Это файл настроек — открыт пункт «Файл настроек»' : 'Это файл базы целиком — открыт пункт «Файл базы целиком»');
    return BackupTab._file(p.querySelector('#bkSide'), f);
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
    p.onclick=e=>{ if (e.target.closest('[data-mt],[data-mb]')) setTimeout(()=>BackupTab.summary(), 1500); };
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
    return `<div id="dtExp" class="bk-form"><div class="sub st-mh">Разделы базы ${tip('<p>Каталог можно выгрузить целиком или выбрать категории, производителей, поставщиков, фиды. Файл любого формата загружается обратно в «Загрузить → Копия или правки»: записи с теми же кодами заменяются, новые добавляются, изображения (из архива .zip) — только недостающие.</p><p>«Настройки программы» — категории, умолчания, списки, функции, тексты интерфейса, тарифы доставки, фиды, почта; пароли, ключи API и учётные записи не выгружаются.</p>')}</div>
      <label class="f"><span>Быстрый выбор</span><select id="dtPre" data-nodirty>${DataTransfer.PRESETS.map(([k,l])=>`<option value="${k}">${l}</option>`).join('')}<option value="">Свой выбор</option></select></label>
      <div class="f"><span>Разделы</span><div class="bk-cks">${DataTransfer.SECTIONS.map(([v,l])=>`<label class="ck"><input type="checkbox" data-xs="${v}" data-nodirty${v==='audit'?'':' checked'}> ${l}</label>`).join('')}</div></div>
      <div class="f" id="dtCatBox"><span>Каталог</span><div></div></div>
      ${BackupTab.fmtSel()}
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
      url='export?'+new URLSearchParams({sections:secs.join(','), fmt:BackupTab.fmtOf(m), ...(some && secs.includes('catalog') ? {pick:JSON.stringify(pick)} : {})});
    }
    if (await DataTransfer.download(url, st) && done) setTimeout(done, 1500);
  }

  // ---------- загрузка .json / .zip ----------
  static bindImport(m, done, own){
    if (!own) m.querySelector('#impF').onchange=e=>{ const f=e.target.files[0]; e.target.value=''; if (f) DataTransfer._preview(m, f); };
    m.querySelector('#impP').addEventListener('click', async e=>{ const b=e.target.closest('[data-imp]'); if (!b || !DataTransfer.file) return;
      const patch=b.dataset.patch==='1';
      if (!await stConfirm('Загрузить данные из «'+DataTransfer.file.name+'»?', patch ? 'Перед загрузкой программа сохранит копию текущей базы. В позициях каталога изменятся только перечисленные в файле поля; цены, закупка, остатки и фото не меняются. Поля, изменённые после выгрузки копии, пропускаются.' : 'Перед загрузкой программа сохранит копию текущей базы. '+(DataTransfer.mode==='edits' ? 'Загрузятся только записи, изменённые в файле после выгрузки; цены и остатки позиций не меняются.' : 'Записи с теми же кодами будут заменены, новые — добавлены, ничего не удаляется. Изображения добавляются только недостающие.'+(b.dataset.keep==='1'?' Цены, закупка и остатки имеющихся позиций не меняются.':'')),'Загрузить')) return;
      b.disabled=true;
      try{ const r=await DataTransfer._send('import/file?'+new URLSearchParams({sections:b.dataset.imp, mode:patch?'all':DataTransfer.mode}), DataTransfer.file);
        const msg=r.patch ? `Правки внесены: позиций ${Fmt.num(r.patch.written)}, полей ${Fmt.num(r.patch.fields)}${r.patch.conflictCount ? `, пропущено ${Fmt.num(r.patch.conflictCount)}` : ''}`
          : 'Загружено: '+Object.entries(r.report||{}).map(([k,v])=>`${DataTransfer.NAMES[k]||k} — ${Fmt.num((v.new||0)+(v.updated||0))}`).join(', ')+(r.images?`; изображений добавлено ${Fmt.num(r.images.written)}`:'');
        DataTransfer.file=null; toast(msg); m.querySelector('#impP').innerHTML=`<p class="ok-t">✓ ${esc(msg)}</p>`;
        refreshCat(); loadManagers(); loadClients(); if (done) done(); }
      catch(err){ b.disabled=false; toast('Не загружено: '+err.message); } });
  }

  static mode = 'all';     // загрузка: «all» — всё как в файле, «edits» — только изменённое в файле после выгрузки

  static _send(path, f){ const json=f.name.toLowerCase().endsWith('.json');
    return aapi(path+(path.includes('?')?'&':'?')+'name='+encodeURIComponent(f.name), {method:'POST', headers:{'Content-Type':json?'application/json; charset=utf-8':'application/octet-stream'}, body:f}); }

  /** предпросмотр: что добавится и заменится; mode — по умолчанию у Excel «только изменённое», у остальных — «всё» */
  static async _preview(m, f, mode){
    const box=m.querySelector('#impP'); box.innerHTML=`<p class="muted">Проверяю «${esc(f.name)}» (${Fmt.size(f.size)})…</p>`;
    try{ const r=await DataTransfer._send('import/file/preview?mode='+(mode||'auto'), f); DataTransfer.file=f;   // auto: у Excel — «только изменённое»
      if (r.kind) return BackupTab.redirect(r.kind, f);
      DataTransfer.mode=r.mode||'all';
      if (r.patch){ box.innerHTML=DataTransfer._patchHtml(r); return; }
      const im=r.images, ed=r.mode==='edits', N=DataTransfer.NAMES;
      const line=(k, v)=>`<tr><td>${N[k]||esc(k)}</td><td>${[v.new?`новых ${Fmt.num(v.new)}`:'', v.updated?`заменится ${Fmt.num(v.updated)}`:'', v.same?`<span class="muted">не менялось ${Fmt.num(v.same)}</span>`:'',
        v.conflict?`<span class="warn-t">пропущено ${Fmt.num(v.conflict)} — изменено и в программе</span>`:'', v.invalid?`<span class="bad-t">с ошибками ${v.invalid}</span>`:''].filter(Boolean).join(', ')||'<span class="muted">ничего</span>'}</td></tr>`;
      const FMTN={xlsx:'Excel', json:'JSON', xml:'XML', zip:'архив .zip', 'xlsx-patch':'Excel'};
      box.innerHTML=`<p class="muted">${r.supplier?`Каталог поставщика «${esc(r.supplier)}»`:'Выгрузка'} от ${esc(Fmt.dateTime(r.createdAt))}${r.fmt?` · ${esc(FMTN[r.fmt]||r.fmt)}`:''}.</p>
        ${r.digests?`<label class="f bk-mode"><span class="st-mh">Что загрузить ${tip('<p><b>Только изменённое в файле</b> — записи, которые правили в файле после выгрузки. Если ту же запись после выгрузки изменили и в программе (вручную или фидом), она пропускается и попадает в список ниже. Цены и остатки позиций каталога при этом не меняются.</p><p><b>Всё как в файле</b> — записи с теми же кодами заменяются, как в файле (восстановить копию).</p>')}</span>
          <select id="impMode" data-nodirty><option value="edits"${ed?' selected':''}>Только изменённое в файле</option><option value="all"${ed?'':' selected'}>Всё как в файле (восстановить)</option></select></label>`:''}
        <table class="pv-t bk-kv">${Object.entries(r.report).map(([k,v])=>line(k, v)).join('')}
          ${im?`<tr><td>Изображения</td><td>добавится ${Fmt.num(im.new)}, уже есть ${Fmt.num(im.exist)}${im.invalid?`, <span class="bad-t">пропущено ${im.invalid}</span>`:''}</td></tr>`:''}</table>
        ${(r.conflicts||[]).length?`<details class="more"><summary>Что пропущено (${r.conflicts.length})</summary><p class="muted" style="text-align:left">${r.conflicts.map(esc).join('<br>')}</p></details>`:''}
        ${r.errors.length?`<p class="msg err" style="text-align:left">${r.errors.map(esc).join('<br>')}</p>`:''}
        ${r.keep?'<p class="muted">Цен, закупки и остатков в файле нет — у имеющихся позиций они останутся как сейчас.</p>':''}
        ${ed?'<p class="muted">Цены и остатки позиций каталога не меняются.</p>':''}
        <div class="bk-foot"><span class="bk-note">Перед загрузкой программа сохранит копию базы.</span><button class="btn primary" type="button" data-imp="${esc(Object.keys(r.report).join(','))}" data-keep="${r.keep?1:0}">Загрузить</button></div>`;
      const sel=box.querySelector('#impMode'); if (sel) sel.onchange=()=>DataTransfer._preview(m, f, sel.value); }
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
// закупки и остатков, в любом формате общего списка (сервер: data_file.DataFile); при загрузке цены и остатки не меняются.
class SupplierExport {
  static groups = [];
  static NONE = 'Без поставщика';

  static TIP = '<p>Все позиции одного поставщика из справочника «Поставщики и склады» (позиции фида — поставщик, к которому привязан фид, иначе — название фида; не из фида — по производителю из карточки поставщика).</p><p>Цены, закупка и остатки в файл не попадают: при загрузке файла обратно они остаются как в программе. Формат — любой из общего списка; Excel можно править и загрузить только изменённые строки.</p>';

  static async mount(m, sel=''){
    const box=m.querySelector('#seBox'), st=m.querySelector('#seSt'); if (!box) return;
    try{ SupplierExport.groups=await aapi('export/suppliers'); }catch(err){ if (st) st.textContent=err.message; return; }
    const s=box.querySelector('#seSup');
    s.innerHTML=SupplierExport.groups.map(g=>`<option value="${esc(g.name)}"${norm(g.name)===norm(sel)?' selected':''}>${esc(g.name)} · ${Fmt.num(g.count)}${g.dir||g.name===SupplierExport.NONE?'':' (фид, не привязан к справочнику)'}</option>`).join('');
    box.addEventListener('click', e=>{ const b=e.target.closest('[data-se]'); if (b && s.value) SupplierExport.run(b, s.value, BackupTab.fmtOf(box)); });
  }

  static async run(b, name, fmt){
    b.disabled=true;
    try{ if (await DataTransfer.download('export?'+new URLSearchParams({sup:name, fmt}), BackupTab.m.querySelector('#bkSt'))) BackupTab.summary(); }
    finally{ b.disabled=false; }
  }
}

// «Выгрузить → Каталог по фильтру» прямо во вкладке (решение владельца 18.10): категория, производитель, поставщик —
// выпадающими списками, поиск по словам, «С ценой», «В наличии»; какие цены и остатки войдут в файл — галочками
// (невыбранные при загрузке остаются как в программе); сколько позиций попадёт — сразу (сервер: supplier_scope.CatalogFilter).
class CatFilterPane {
  static S = null;       // сочетания категория / производитель / поставщик (/api/admin/export/scope)
  static PRICES = [['price','Цена КП',true],['rrc','РРЦ',true],['cost','Закупка',false],['stock','Остатки',true]];
  static t = 0;
  static seq = 0;        // номер запроса счётчика: ответ на устаревший запрос не показывается
  static NO_CAT = '__none__';

  static async mount(s){
    const f=BackupTab.flt||(BackupTab.flt={cat:'', maker:'', sup:'', q:'', priced:false, instock:false, prices:CatFilterPane.PRICES.filter(x=>x[2]).map(x=>x[0])});
    s.innerHTML=`<div class="bk-form" id="cfBox"><div class="sub st-mh">Каталог по фильтру ${tip('<p>Отбор — как в окне каталога: категория, производитель, поставщик, слова поиска (все — в названии, кратком описании, артикуле или характеристиках), «С ценой», «В наличии».</p><p>Цены и остатки — галочками: что не отмечено, в файл не попадёт, а при загрузке файла обратно останется как в программе. Закупку видит только администратор.</p>')}</div>
      <div class="bk-grid"><label class="f"><span>Категория</span><select data-cf="cat" data-nodirty><option value="">Загружаю…</option></select></label>
        <label class="f"><span>Производитель</span><select data-cf="maker" data-nodirty></select></label>
        <label class="f"><span>Поставщик</span><select data-cf="sup" data-nodirty></select></label>
        <label class="f"><span>Поиск</span><input type="search" data-cf="q" value="${esc(f.q)}" placeholder="модель, артикул, слово" autocomplete="off" data-nodirty></label></div>
      <div class="bk-cks"><label class="ck"><input type="checkbox" data-cf="priced" data-nodirty${f.priced?' checked':''}> С ценой</label><label class="ck"><input type="checkbox" data-cf="instock" data-nodirty${f.instock?' checked':''}> В наличии</label></div>
      <div class="f"><span>В файл — цены и остатки</span><div class="bk-cks">${CatFilterPane.PRICES.map(([k,l])=>`<label class="ck"><input type="checkbox" data-cfp="${k}" data-nodirty${f.prices.includes(k)?' checked':''}> ${l}</label>`).join('')}</div></div>
      ${BackupTab.fmtSel()}${BackupTab.foot('<button class="btn primary" type="button" data-bkx="filter">Скачать</button>', '<span id="cfN">Считаю…</span>')}</div>`;
    s.oninput=e=>{ if (e.target.dataset.cf==='q'){ f.q=e.target.value; CatFilterPane.count(s, 400); } };
    s.onchange=e=>{ const c=e.target.dataset.cf, p=e.target.dataset.cfp;
      if (c && c!=='q'){ f[c]=e.target.type==='checkbox' ? e.target.checked : e.target.value; CatFilterPane.count(s, 0); }
      if (p) f.prices=[...s.querySelectorAll('[data-cfp]:checked')].map(x=>x.dataset.cfp); };
    s.onclick=e=>{ const b=e.target.closest('[data-bkx]'); if (!b) return;
      BackupTab._dl(b, 'export?'+new URLSearchParams({sections:'catalog', fmt:BackupTab.fmtOf(s), flt:JSON.stringify(CatFilterPane.query()), prices:f.prices.join(',')})); };
    try{ CatFilterPane.S=CatFilterPane.S||await aapi('export/scope'); }catch(err){ s.querySelector('#cfN').textContent=err.message||String(err); return; }
    CatFilterPane.options(s); CatFilterPane.count(s, 0);
  }

  /** выпадающие списки: категории по группам, производители и поставщики — по числу позиций */
  static options(s){
    const f=BackupTab.flt, rows=CatFilterPane.S.rows||[], sum=k=>{ const m=new Map(); rows.forEach(r=>m.set(r[k], (m.get(r[k])||0)+r.n)); return [...m].sort((a,b)=>b[1]-a[1] || String(a[0]).localeCompare(String(b[0]), 'ru')); };
    const total=rows.reduce((a,r)=>a+r.n, 0), opt=(key, v, l, n)=>`<option value="${esc(v)}"${v===f[key]?' selected':''}>${esc(l)} · ${Fmt.num(n)}</option>`;
    const groups=new Map();
    for (const [cat, n] of sum('cat')){ const t=cat?typeById(cat):null, ok=t&&t.id===cat, g=ok?t.group||'Прочее':'Без категории';
      if (!groups.has(g)) groups.set(g, []); groups.get(g).push([cat||CatFilterPane.NO_CAT, ok?t.name:(cat||'Без категории'), n]); }
    s.querySelector('[data-cf=cat]').innerHTML=`<option value="">Все категории · ${Fmt.num(total)}</option>`+[...groups].map(([g, L])=>`<optgroup label="${esc(g)}">${L.map(([v,l,n])=>opt('cat', v, l, n)).join('')}</optgroup>`).join('');
    s.querySelector('[data-cf=maker]').innerHTML=`<option value="">Все производители</option>`+sum('maker').map(([v,n])=>opt('maker', v, v, n)).join('');
    s.querySelector('[data-cf=sup]').innerHTML=`<option value="">Все поставщики</option>`+sum('sup').map(([v,n])=>opt('sup', v, v, n)).join('');
  }

  static query(){ const f=BackupTab.flt; return {cat:f.cat, maker:f.maker, sup:f.sup, q:f.q, priced:f.priced, instock:f.instock}; }

  static count(s, wait){
    clearTimeout(CatFilterPane.t);
    CatFilterPane.t=setTimeout(async()=>{ const n=s.querySelector('#cfN'), b=s.querySelector('[data-bkx=filter]'); if (!n) return;
      const my=++CatFilterPane.seq;
      try{ const r=await aapi('export/filter?'+new URLSearchParams({flt:JSON.stringify(CatFilterPane.query())}));
        if (my!==CatFilterPane.seq) return;
        n.innerHTML=r.n ? `Попадёт позиций: <b>${Fmt.num(r.n)}</b>` : '<span class="warn-t">Под условия не подходит ни одна позиция</span>'; b.disabled=!r.n; }
      catch(err){ if (my===CatFilterPane.seq) n.textContent=err.message||String(err); } }, wait);
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
      ${BackupTab.row('Сохранить', 'Файл КП_настройки_… в любом формате общего списка (как в «База и копии → Выгрузить»). С ключами API — только если отметить: такой файл храните как пароль.', `<label class="cx-ck"><input type="checkbox" id="sfKeys"> с ключами API</label><select id="bkFmt" aria-label="Формат" data-nodirty>${BackupTab.fmtOpts()}</select><button class="btn primary" type="button" data-sf="save">Сохранить все настройки в файл</button>`)}
      ${BackupTab.row('Загрузить', 'Сначала покажем разделы файла — отметьте, какие заменить. Свои ключи и пароль почты остаются, если в файле их нет.', '<input type="file" id="sfFile" accept=".xlsx,.json,.xml,.yml,.zip" class="sr-file"><label for="sfFile" class="btn">Загрузить настройки из файла…</label>')}
      <div id="sfPrev"></div></div>`;
    m.querySelector('#sfKeys').onchange=async e=>{ if (!e.target.checked) return;
      if (!await stConfirm('Сохранить вместе с ключами API?', 'В файл попадут ключи сервисов (проверка контрагентов, перевозчики, PDF, нейросеть, GitHub). Храните его как пароль и не пересылайте по почте и в мессенджерах. Пароли в файл не попадают.', 'Да, с ключами')) e.target.checked=false; };
    m.onclick=async e=>{
      if (e.target.closest('[data-sf="save"]')){ const keys=m.querySelector('#sfKeys').checked;
        await DataTransfer.download('settings-file?'+new URLSearchParams({fmt:BackupTab.fmtOf(m), ...(keys?{keys:'1'}:{})}), null); return; }
      const ap=e.target.closest('[data-sfapply]'); if (ap) return SettingsFileCard.apply(m, ap); };
    m.querySelector('#sfFile').onchange=async e=>{ const f=e.target.files[0]; e.target.value=''; if (f) SettingsFileCard.preview(m, f); };
  }

  static async preview(m, f){
    const box=m.querySelector('#sfPrev'); box.innerHTML=`<p class="muted">Проверяю «${esc(f.name)}»…</p>`;
    try{ const r=await aapi('settings-file/preview', {method:'POST', headers:{'Content-Type':/\.json$/i.test(f.name)?'application/json; charset=utf-8':'application/octet-stream'}, body:f}); SettingsFileCard.file=f;
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
    try{ const r=await aapi('settings-file?sections='+encodeURIComponent(keys.join(',')), {method:'POST', headers:{'Content-Type':/\.json$/i.test(f.name)?'application/json; charset=utf-8':'application/octet-stream'}, body:f});
      SettingsFileCard.file=null; toast(`Загружено разделов: ${r.applied.length}`+(r.errors.length?`; не загружено: ${r.errors.join('; ')}`:''));
      await StRefresh.all(); await loadTypes(); stTab(); }
    catch(err){ b.disabled=false; toast('Не загружено: '+(err.message||err)); }
  }
}
