'use strict';
// «Сотрудники и система → База и копии» (BackupTab): ровные строки «что — пояснение — кнопки»: скачать (вся база, разделы,
// каталог поставщика, каталог по фильтру, настройки), загрузить (копия или правки, файл базы целиком), автокопии, вторая папка.
// DataTransfer — выгрузка разделов базы в JSON (каталог целиком или выбранные группы и категории, с изображениями — архив
// .zip: kp-backup.json + img/…) и загрузка такого файла обратно. SettingsFileCard — все настройки в файл и из файла.

class BackupTab {
  static row(title, note, acts, id=''){
    return `<div class="bk-row"${id?` id="${id}"`:''}><div class="bk-t"><b>${title}</b><small class="muted">${note}</small></div><div class="bk-a">${acts}</div></div>`;
  }

  static async render(m){
    const R=BackupTab.row;
    m.innerHTML=`<div class="st-card bk"><p class="sub">Скачать</p>
        ${R('Вся база одним файлом', 'Каталог, КП, клиенты, менеджеры, настройки — архив .zip (kp.sqlite3 внутри, без изображений). Загружается обратно как есть.', '<button class="btn primary" type="button" data-bk="db">Скачать базу (.zip)</button>')}
        ${R('Разделы базы', 'Каталог целиком или выбранные категории, клиенты, поставщики, КП, настройки — .json или .zip с фото.', '<button class="btn" type="button" data-bk="parts">Выбрать разделы…</button>')}
        ${R('Каталог поставщика '+tip(SupplierExport.TIP), 'Без цен, закупки и остатков: копия с фото или книга Excel для правки.', `<select id="seSup" aria-label="Поставщик"><option value="">Загружаю…</option></select><button class="btn" type="button" data-se="zip">Копия с фото (.zip)</button><button class="btn" type="button" data-se="xlsx">Excel для правки</button>`, 'seBox')}
        ${R('Каталог по любому фильтру', 'Excel, JSON, XML или YML — с ценами, РРЦ, остатками, картинками, нужными параметрами: отберите позиции в окне товаров.', '<button class="btn" type="button" data-bk="goods">Открыть товары</button>')}
        ${R('Все настройки программы', 'Одним файлом — перенести на другой компьютер или сохранить перед большими правками.', '<button class="btn" type="button" data-sttab="changes">Файл настроек…</button>')}
        <p class="muted bk-st" id="seSt"></p></div>
      <div class="st-card bk"><p class="sub">Загрузить</p>
        ${R('Копия или правки', '.zip, .json или книга Excel для правки — сначала программа покажет, что изменится.', '<input type="file" id="impF" accept=".json,.zip,.xlsx,application/json,application/zip" class="sr-file"><label for="impF" class="btn">Выбрать файл…</label>')}
        <div id="impP"></div>
        ${R('Файл базы целиком', `.sqlite3 или .zip с ним — заменяет всю базу; текущая сохраняется в копию (data\\backup). ${tip('<p>Так и нужно подменять базу: вручную копировать kp.sqlite3 в папку data нельзя — рядом лежат файлы kp.sqlite3-wal и -shm от прежней базы, и она повредится («database disk image is malformed»).</p>')}`, '<input type="file" id="impDb" accept=".sqlite3,.sqlite,.db,.zip" class="sr-file"><label for="impDb" class="btn">Выбрать файл базы…</label>')}
        <p class="muted bk-st" id="impDbSt"></p></div>
      <div class="st-card" id="stMaint"><p class="sub">Автоматические копии и обслуживание базы</p><p class="muted">Загружаю…</p></div>
      <div class="st-card" id="stMirror"></div>
      <details class="st-card mx"><summary class="sub">История выгрузок и загрузок · структура базы</summary><div id="stMigr"></div><div id="bkHist"><p class="muted">Загружаю…</p></div></details>`;
    DbMaint.render(m.querySelector('#stMaint')); stMigr(m.querySelector('#stMigr')); new MirrorCard(m.querySelector('#stMirror')).open();
    SupplierExport.mount(m, StNav.sup||''); StNav.sup='';
    DataTransfer.bindImport(m, ()=>BackupTab.render(m));
    BackupTab.history(m.querySelector('#bkHist'));
    m.onclick=e=>{ const b=e.target.closest('[data-bk]'); if (!b) return;
      if (b.dataset.bk==='db') return DataTransfer.download('export/sqlite', m.querySelector('#seSt'));
      if (b.dataset.bk==='parts') return DataTransfer.dialog(()=>BackupTab.render(m));
      if (b.dataset.bk==='goods') return GoodsTab.open(); };
    m.querySelector('#impDb').onchange=async e=>{ const f=e.target.files[0]; if (!f) return; e.target.value='';
      if (!await stConfirm('Заменить всю базу файлом «'+f.name+'»?','Текущие данные будут заменены содержимым файла. Перед этим программа сохранит копию текущей базы в data\\backup.','Заменить базу')) return;
      const st=m.querySelector('#impDbSt'); st.textContent=`Загружаю «${f.name}» (${Fmt.size(f.size)})…`;
      try{ const j=await aapi('import/sqlite?name='+encodeURIComponent(f.name), {method:'POST', headers:{'Content-Type':'application/octet-stream'}, body:f});
        st.textContent=''; toast(`База заменена: позиций ${Fmt.num(j.catalog)}, КП ${Fmt.num(j.kp)}. Прежняя сохранена: ${j.backup.split(/[\\/]/).pop()}`);
        setTimeout(()=>location.reload(), 1500); }
      catch(err){ st.textContent=''; toast('Не загружено: '+(err.message||err)); } };
  }

  static async history(box){
    try{ const [a, b]=await Promise.all([aapi('audit?'+new URLSearchParams({action:'export_db'})), aapi('audit?'+new URLSearchParams({action:'import_db'}))]);
      const ops=[...a.items, ...b.items].sort((x,y)=>y.id-x.id).slice(0,15);
      box.innerHTML=ops.map(x=>`<div class="st-row"><div><b>${esc(ACT[x.action])}</b><span class="muted">${esc(Fmt.dateTime(x.timestamp))} · ${esc(x.entityId||'')}${x.after&&x.after.supplier?' · '+esc(x.after.supplier):''}${x.after&&x.after.bytes?' · '+Fmt.size(x.after.bytes):''}</span></div></div>`).join('')||'<p class="muted">Операций ещё не было.</p>'; }
    catch(e){ box.innerHTML=''; }
  }
}

class DataTransfer {
  static SECTIONS = [['catalog','Каталог'],['clients','Клиенты'],['settings','Настройки программы'],['suppliers','Поставщики и ТН ВЭД'],['managers','Менеджеры'],['kp','КП (журнал)'],['audit','Журнал действий']];
  static NAMES = {catalog:'Каталог',kp:'КП',managers:'Менеджеры',clients:'Клиенты',suppliers:'Поставщики',settings:'Настройки программы'};
  // быстрый выбор: что отметить
  static PRESETS = [['all','Всё',null],['catalog','Только каталог',['catalog','settings']],['clients','Только клиенты',['clients']],['settings','Только настройки',['settings']]];
  static file = null;

  static html(){
    return `<div id="dtExp"><div class="sub">Что выгрузить${tip('<p><b>.json</b> — выбранные разделы базы. <b>С изображениями</b> — архив .zip: тот же JSON и все фото, галереи и логотипы, на которые в нём есть ссылки (папка img).</p><p>Каталог можно выгрузить целиком или только выбранные группы и категории оборудования. Файл загружается обратно здесь же, в «Загрузке»: записи с теми же id заменяются, новые добавляются, изображения — только недостающие.</p>')}</div>
      <div class="row" style="flex-wrap:wrap;gap:6px">${DataTransfer.PRESETS.map(([k,l])=>`<button class="btn ghost" type="button" data-dp="${k}">${l}</button>`).join('')}</div>
      <div class="chips" style="margin-top:8px">${DataTransfer.SECTIONS.map(([v,l])=>`<label class="chk-chip"><input type="checkbox" data-xs="${v}" checked> ${l}</label>`).join('')}</div>
      <p class="muted">«Настройки программы» — категории, умолчания, списки, функции, тексты интерфейса, тарифы доставки, фиды, почта; пароли, ключи API и учётные записи не выгружаются.</p>
      <div id="dtCatBox" style="margin-top:10px"></div>
      <label class="chk-chip" style="margin-top:10px"><input type="checkbox" id="dtImg" checked> С изображениями (.zip)</label>
      <div class="row" style="margin-top:10px"><button class="btn primary" type="button" data-dx="json">Скачать</button></div>
      <p class="muted" id="dtExpSt"></p></div>`;
  }

  /** окно «Разделы базы»: что выгрузить, каталог целиком или категории, с фото */
  static dialog(done){
    const m=new Modal(`<div class="mv-h"><h3>Выгрузка разделов базы</h3><button class="icon" type="button" data-x aria-label="Закрыть">✕</button></div>${DataTransfer.html()}`, 'dt-dlg');
    m.$('[data-x]').onclick=()=>m.close();
    DataTransfer.mount(m.d, done);
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
    const box=m.querySelector('#dtCatBox');
    try{ DataTransfer._cats(box, await aapi('export/cats')); }catch(err){ box.innerHTML=`<p class="muted">${esc(err.message)}</p>`; }
    m.querySelector('#dtExp').addEventListener('click', e=>{ const b=e.target.closest('[data-dx]'); if (b) return DataTransfer._export(m, b.dataset.dx, done);
      const p=e.target.closest('[data-dp]'); if (p) DataTransfer._preset(m, p.dataset.dp); });
    m.querySelector('#dtExp').addEventListener('change', e=>DataTransfer._toggle(m, e.target));
  }

  // группы и категории каталога: «Весь каталог» или выбор (группа отмечает все свои категории)
  static _cats(box, rows){
    const groups=new Map();
    rows.forEach(r=>{ const t=r.cat ? typeById(r.cat) : null, g=t&&t.id===r.cat ? t.group||'Прочее' : 'Без категории';
      if (!groups.has(g)) groups.set(g, []); groups.get(g).push({cat:r.cat, name:t&&t.id===r.cat ? t.name : (r.cat||'Без категории'), count:r.count}); });
    const total=rows.reduce((s,r)=>s+r.count,0);
    box.innerHTML=`<div class="chips" role="radiogroup"><label class="chk-chip"><input type="radio" name="dtScope" value="all" checked> Весь каталог · ${Fmt.num(total)}</label>
        <label class="chk-chip"><input type="radio" name="dtScope" value="some"> Выбранные группы и категории</label></div>
      <div id="dtCats" hidden style="margin-top:8px">${[...groups].map(([g,L],i)=>`<div class="dt-g"><label class="chk-chip dt-gh"><input type="checkbox" data-dg="${i}"> <b>${esc(g)}</b> · ${Fmt.num(L.reduce((s,x)=>s+x.count,0))}</label>
        <div class="chips">${L.map(x=>`<label class="chk-chip"><input type="checkbox" data-dc="${esc(x.cat)}" data-dgi="${i}"> ${esc(x.name)} · ${Fmt.num(x.count)}</label>`).join('')}</div></div>`).join('')}
        <p class="muted" id="dtSel">Ничего не выбрано</p></div>`;
  }

  static _preset(m, key){
    const on=(DataTransfer.PRESETS.find(x=>x[0]===key)||[])[2];
    m.querySelectorAll('[data-xs]').forEach(c=>{ c.checked = on ? on.includes(c.dataset.xs) : c.dataset.xs!=='audit'; });
    const img=m.querySelector('#dtImg'); if (img) img.checked = !on || on.includes('catalog');
    DataTransfer._scope(m);
  }

  // выбор групп и категорий — только когда выгружается каталог
  static _scope(m){ const box=m.querySelector('#dtCatBox'), cat=m.querySelector('[data-xs=catalog]'); if (box && cat) box.hidden=!cat.checked; }

  static _toggle(m, el){
    if (el.dataset.xs==='catalog') DataTransfer._scope(m);
    if (el.name==='dtScope') m.querySelector('#dtCats').hidden = el.value!=='some';
    if (el.dataset.dg!=null) m.querySelectorAll(`[data-dgi="${el.dataset.dg}"]`).forEach(c=>{ c.checked=el.checked; });
    if (el.dataset.dgi!=null){ const all=[...m.querySelectorAll(`[data-dgi="${el.dataset.dgi}"]`)], g=m.querySelector(`[data-dg="${el.dataset.dgi}"]`);
      g.checked=all.every(c=>c.checked); g.indeterminate=!g.checked && all.some(c=>c.checked); }
    const sel=m.querySelector('#dtSel'); if (sel){ const n=DataTransfer._picked(m).length; sel.textContent=n ? 'Выбрано категорий: '+n : 'Ничего не выбрано'; }
  }

  static _picked(m){ return [...m.querySelectorAll('[data-dc]:checked')].map(c=>c.dataset.dc); }

  static async _export(m, kind, done){
    const st=m.querySelector('#dtExpSt');
    let url='export/sqlite';
    if (kind==='json'){
      const secs=[...m.querySelectorAll('[data-xs]:checked')].map(c=>c.dataset.xs); if (!secs.length) return toast('Отметьте разделы');
      const some=(m.querySelector('[name="dtScope"]:checked')||{}).value==='some', cats=some ? DataTransfer._picked(m) : [];
      if (some && secs.includes('catalog') && !cats.length) return toast('Отметьте группы или категории каталога');
      if (some && cats.includes('')) return toast('Позиции без категории выгружаются только со всем каталогом');
      url='export?'+new URLSearchParams({sections:secs.join(','), cats:cats.join(','), images:m.querySelector('#dtImg').checked?'1':'0'});
    }
    if (await DataTransfer.download(url, st) && done) setTimeout(done, 1500);
  }

  // ---------- загрузка .json / .zip ----------
  static bindImport(m, done){
    m.querySelector('#impF').onchange=e=>{ const f=e.target.files[0]; e.target.value=''; if (f) DataTransfer._preview(m, f); };
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
    box.addEventListener('click', e=>{ const b=e.target.closest('[data-se]'); if (b && s.value) SupplierExport.run(b, s.value, st); });
  }

  static async _get(name, images){
    const r=await fetch('/api/admin/export?'+new URLSearchParams({sup:name, images:images?'1':'0'}), {headers:{'X-CSRF-Token':ADMIN.csrf}});
    if (!r.ok){ const t=await r.text(); let msg=t; try{ msg=JSON.parse(t).error||t; }catch(e){ /* не JSON — текст как есть */ } throw new Error(msg||'ошибка '+r.status); }
    return r;
  }

  static async run(b, name, st){
    b.disabled=true; st.textContent='Готовлю файл…';
    try{
      if (b.dataset.se==='zip'){ const r=await SupplierExport._get(name, true), fn=decodeURIComponent((r.headers.get('Content-Disposition')||'').split("''")[1]||'catalog.zip'), blob=await r.blob();
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
