'use strict';
// «Обслуживание → Копии и база»: выгрузка разделов базы в JSON — каталог целиком или выбранные группы и категории
// оборудования, с изображениями (тогда архив .zip: kp-backup.json + img/…), и загрузка такого файла обратно.

class DataTransfer {
  static SECTIONS = [['catalog','Каталог'],['clients','Клиенты'],['settings','Настройки программы'],['suppliers','Поставщики и ТН ВЭД'],['managers','Менеджеры'],['kp','КП (журнал)'],['audit','Журнал действий']];
  static NAMES = {catalog:'Каталог',kp:'КП',managers:'Менеджеры',clients:'Клиенты',suppliers:'Поставщики',settings:'Настройки программы'};
  // быстрый выбор: что отметить
  static PRESETS = [['all','Всё',null],['catalog','Только каталог',['catalog','settings']],['clients','Только клиенты',['clients']],['settings','Только настройки',['settings']]];
  static file = null;

  static html(){
    return `<div class="st-card" id="dtExp"><p class="sub">Выгрузка${tip('<p><b>.json</b> — выбранные разделы базы. <b>С изображениями</b> — архив .zip: тот же JSON и все фото, галереи и логотипы, на которые в нём есть ссылки (папка img).</p><p>Каталог можно выгрузить целиком или только выбранные группы и категории оборудования. Файл загружается обратно здесь же, в «Загрузке»: записи с теми же id заменяются, новые добавляются, изображения — только недостающие.</p>')}</p>
      <div class="row" style="flex-wrap:wrap;gap:6px">${DataTransfer.PRESETS.map(([k,l])=>`<button class="btn ghost" type="button" data-dp="${k}">${l}</button>`).join('')}</div>
      <div class="chips" style="margin-top:8px">${DataTransfer.SECTIONS.map(([v,l])=>`<label class="chk-chip"><input type="checkbox" data-xs="${v}" checked> ${l}</label>`).join('')}</div>
      <p class="muted">«Настройки программы» — категории, умолчания, списки, функции, тексты интерфейса, тарифы доставки, фиды, почта; пароли, ключи API и учётные записи не выгружаются.</p>
      <div id="dtCatBox" style="margin-top:10px"></div>
      <label class="chk-chip" style="margin-top:10px"><input type="checkbox" id="dtImg" checked> С изображениями (.zip)</label>
      <div class="row" style="margin-top:10px"><button class="btn primary" type="button" data-dx="json">Скачать</button><button class="btn" type="button" data-dx="sqlite">Полная копия базы (.zip)</button></div>
      <p class="muted" id="dtExpSt">.zip — файл базы целиком в архиве (kp.sqlite3 внутри, без изображений), загружается ниже как есть: «Файл базы целиком».</p></div>`;
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
    st.textContent='Готовлю файл…';
    try{ const r=await fetch('/api/admin/'+url,{headers:{'X-CSRF-Token':ADMIN.csrf}}); if (!r.ok) throw new Error(await r.text());
      const fn=decodeURIComponent((r.headers.get('Content-Disposition')||'').split("''")[1]||'backup'), blob=await r.blob();
      saveFileA(fn, blob); st.textContent=`Скачано: ${fn} (${Fmt.size(blob.size)})`; if (done) setTimeout(done, 1500); }
    catch(err){ st.textContent=''; toast('Не выгружено: '+(err.message||err)); }
  }

  // ---------- загрузка .json / .zip ----------
  static importHtml(){
    return `<input type="file" id="impF" accept=".json,.zip,application/json,application/zip" class="sr-file"><label for="impF" class="btn">Выбрать файл выгрузки (.json или .zip)…</label><div id="impP"></div>`;
  }

  static bindImport(m, done){
    m.querySelector('#impF').onchange=e=>{ const f=e.target.files[0]; e.target.value=''; if (f) DataTransfer._preview(m, f); };
    m.querySelector('#impP').addEventListener('click', async e=>{ const b=e.target.closest('[data-imp]'); if (!b || !DataTransfer.file) return;
      const patch=b.dataset.patch==='1';
      if (!await stConfirm('Загрузить данные из «'+DataTransfer.file.name+'»?', patch ? 'Перед загрузкой программа сохранит копию текущей базы. В позициях каталога изменятся только перечисленные в файле поля; цены, закупка, остатки и фото не меняются. Поля, изменённые после выгрузки копии, пропускаются.' : 'Перед загрузкой программа сохранит копию текущей базы. Записи с теми же id будут заменены, новые — добавлены, ничего не удаляется. Изображения добавляются только недостающие.','Загрузить')) return;
      b.disabled=true;
      try{ const r=await DataTransfer._send('import/file?sections='+b.dataset.imp, DataTransfer.file);
        DataTransfer.file=null; toast(r.patch ? `Правки внесены: позиций ${Fmt.num(r.patch.written)}, полей ${Fmt.num(r.patch.fields)}${r.patch.conflictCount ? `, пропущено ${Fmt.num(r.patch.conflictCount)}` : ''}` : 'Загружено'+(r.images?`, изображений добавлено: ${Fmt.num(r.images.written)}`:''));
        refreshCat(); loadManagers(); loadClients(); if (done) done(); }
      catch(err){ b.disabled=false; toast('Не загружено: '+err.message); } });
  }

  static _send(path, f){ return aapi(path, {method:'POST', headers:{'Content-Type':f.name.toLowerCase().endsWith('.zip')?'application/zip':'application/json; charset=utf-8'}, body:f}); }

  static async _preview(m, f){
    const box=m.querySelector('#impP'); box.innerHTML=`<p class="muted">Проверяю «${esc(f.name)}» (${Fmt.size(f.size)})…</p>`;
    try{ const r=await DataTransfer._send('import/file/preview', f); DataTransfer.file=f;
      if (r.patch){ box.innerHTML=DataTransfer._patchHtml(r); return; }
      const im=r.images;
      box.innerHTML=`<p class="muted">Копия от ${esc(Fmt.dateTime(r.createdAt))}. Будет:</p><table class="pv-t">${Object.entries(r.report).map(([k,v])=>`<tr><td>${DataTransfer.NAMES[k]||esc(k)}</td><td>новых ${v.new}, заменится ${v.updated}${v.invalid?`, <span class="bad-t">с ошибками ${v.invalid}</span>`:''}</td></tr>`).join('')}
          ${im?`<tr><td>Изображения</td><td>добавится ${Fmt.num(im.new)}, уже есть ${Fmt.num(im.exist)}${im.invalid?`, <span class="bad-t">пропущено ${im.invalid}</span>`:''}</td></tr>`:''}</table>
        ${r.errors.length?`<p class="msg err" style="text-align:left">${r.errors.map(esc).join('<br>')}</p>`:''}
        <button class="btn primary" type="button" data-imp="${esc(Object.keys(r.report).join(','))}" style="margin-top:10px">Загрузить</button>`; }
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
