// «Настройки → Фиды поставщиков»: товарный фид поставщика (YML) как API — по кнопке позиции фида становятся позициями
// каталога (характеристики, описание, фото, РРЦ, наличие), раз в день программа сверяет РРЦ и наличие (сервер: app/feeds.py).
// Фид из файлов (парс сайта CSV + прайс XLSX, app/feed_files.py) — для поставщиков без YML: цены обновляются загрузкой нового прайса.
'use strict';

const FD = { sel:null, prev:null, cats:{}, types:[], poll:0, edit:null, logs:{}, disc:null, plan:null };
// сетка скидок Dalgakiran от РРЦ: ременные компрессоры и рефрижераторные осушители до 75 кВт включительно — 30 %, прямой привод
// и/или частотник — 27 % при любой мощности, фильтры и сепараторы — 30 %, остальное — 25 %. Мощность осушителя часто не указана
// (у всех рефрижераторных осушителей Dalgakiran она намного меньше 75 кВт) — такие осушители тоже получают 30 %.
const FD_DISC_DALG = { discount:25, driveHints:{ belt:'TIDY, DVK, DS', direct:'DVK D, IMPETUS, EAGLE' }, discounts:[
  { label:'Компрессоры с ременным приводом до 75 кВт', cats:['comp_screw','comp_piston','comp_scroll'], drive:'belt', kwMax:75, kwUnknown:false, pct:30 },
  { label:'Рефрижераторные осушители до 75 кВт', cats:['dryer_refrig'], drive:'any', kwMax:75, kwUnknown:true, pct:30 },
  { label:'Компрессоры с прямым приводом и/или частотником', cats:['comp_screw','comp_piston','comp_scroll'], drive:'direct', pct:27 },
  { label:'Фильтры, сепараторы, маслоотделители', cats:['filter','oil_sep'], drive:'any', pct:30 } ] };
const FD_DRIVES = [['any','любой'], ['belt','ременной'], ['direct','прямой и/или частотник']];
const FD_REMEZA = { name:'Remeza', url:'https://www.remeza.org/bitrix/catalog_export/yandex_202475.php', maker:'Remeza', auto:true, pageDesc:true, kind:'yml' };
const FD_FILES = { kind:'files', name:'', maker:'', priceKind:'cost', cur:'EUR', priceOnly:false, pageDesc:false, auto:false };
const FD_CURS = [['', 'как в прайсе'], ['RUB', 'Рубли'], ['EUR', 'Евро'], ['USD', 'Доллары США'], ['CNY', 'Юани']];

const fdRub = kop => kop==null ? '—' : money(kop)+' ₽';
const fdMoney = (kop, cur) => kop==null ? '—' : money(kop)+' '+(typeof curSh==='function' ? curSh(cur||'RUB') : (cur||'₽'));
const fdDate = iso => iso ? stTime(iso) : '—';
const fdIsFiles = f => !!f && f.kind==='files';
const fdCostKind = f => fdIsFiles(f) && f.priceKind!=='rrc';
// кнопка обновления фида из файлов: с остатками на складе — «цены и остатки»
const fdUpdLbl = f => (fdCostKind(f)?'Обновить цены':'Обновить РРЦ')+(f.files&&f.files.stock?' и остатки':' из прайса');

async function stFeeds(m){
  const r=await aapi('feeds'); FD.types=r.types||[]; const items=r.items||[];
  if (FD.sel && !items.some(f=>f.id===FD.sel)) FD.sel=null;
  if (!items.length && !FD.edit) FD.edit={...FD_REMEZA};
  const f=items.find(x=>x.id===FD.sel);
  m.innerHTML=`<div class="st-card"><div class="row fd-head"><div class="sub" style="margin:0">Фиды поставщиков${tip('<p>Товарный фид (YML, «Яндекс.Маркет») — выгрузка каталога с сайта поставщика: характеристики, фото, цены, наличие. Раз в день программа сверяет РРЦ и наличие.</p><p>Фид из файлов — для поставщика без YML: файл парса сайта (CSV: категория, название, ссылка, картинки, описание, характеристики) и прайс (XLSX). Позиции каталога создаются из парса, цена и артикул берутся из строки прайса с тем же названием. Новый прайс загружается в любой момент — «Обновить цены из прайса» пересчитает закупку.</p><p>«Проверить фид» покажет, что в нём есть, и предложит категории. «Загрузить в каталог» создаст позиции (повторная загрузка обновит их, ручные правки сохранятся).</p>')}</div>
      <span class="sp"></span><button class="btn" type="button" data-fd="new">+ Фид YML</button><button class="btn" type="button" data-fd="newfiles">+ Фид из файлов</button></div>
    ${items.length?`<div class="st-list">${items.map(x=>`<div class="st-row${x.id===FD.sel?' on':''}"><div><b>${esc(x.name)}</b><span class="muted">${fdIsFiles(x)?esc(fdFilesShort(x)):esc(x.url)}</span>
        <span class="muted">в каталоге: ${x.linked} ${plural(x.linked,'позиция','позиции','позиций')}${x.last&&x.last.check?` · ${fdIsFiles(x)?'цены':'проверка'} ${esc(fdDate(x.last.check.at))}`:''}${x.last&&x.last.import?` · загрузка ${esc(fdDate(x.last.import.at))}`:''}${x.auto?' · автопроверка раз в день':''}</span>
        ${x.job&&x.job.state==='run'?`<span class="ok-t">${x.job.kind==='import'?'Загружаю':'Проверяю'}… ${x.job.done}/${x.job.total||'?'}</span>`:''}</div>
        <div class="acts"><button class="btn" type="button" data-fd="open" data-id="${esc(x.id)}">${x.id===FD.sel?'Свернуть':'Открыть'}</button></div></div>`).join('')}</div>`:'<p class="muted">Фидов пока нет.</p>'}</div>
    ${FD.edit?fdForm(FD.edit, true):''}
    ${f?`<div class="st-card fd-panel" id="fdPanel">${fdForm(f)}${fdIsFiles(f)?fdFiles(f):''}<div id="fdDisc">${fdDisc(f)}</div>${fdActions(f)}<div id="fdJob">${fdJob(f.job)}</div><div id="fdPrev">${FD.prev&&FD.prev.id===f.id?fdPreview(FD.prev, f):''}</div><div id="fdLog"></div></div>`:''}`;
  m.onclick=e=>fdClick(e, m);
  m.oninput=e=>{ const t=e.target; if (t.dataset.fdd==='kwMax'){ const l=t.parentNode.querySelector('.fd-dku'); if (l) l.hidden=!t.value.trim(); } };
  m.onchange=e=>{ const t=e.target;
    if (t.dataset.fdc!=null){ fdDiscRead(m); const s=t.closest('details'); if (s) s.querySelector('summary').textContent=fdCatsTxt(FD.disc.discounts[+s.dataset.fdr].cats); return; }
    if (t.dataset.fdcat!=null){ FD.cats[t.dataset.fdcat]=t.value; fdCount(m); return; }
    if (t.dataset.fdfile!=null){ fdUpload(t, m); return; }
    if (t.dataset.fdf==='kind' && FD.edit){ FD.edit={...(t.value==='files'?FD_FILES:FD_REMEZA), ...fdVals(t.closest('[data-fdform]')), kind:t.value}; if (t.value==='files' && FD.edit.url===FD_REMEZA.url) FD.edit.url=''; stFeeds(m); } };
  if (f){ fdLoadLog(f.id); if (f.job&&f.job.state==='run') fdPoll(f.id, m); }
}

function fdFilesShort(x){ const fl=x.files||{}; const d=iso=>iso?new Date(iso).toLocaleDateString('ru-RU'):'нет';
  return `файлы: парс сайта — ${fl.pages?d(fl.pages.at):'нет'}, прайс — ${fl.price?d(fl.price.at):'нет'}${fl.stock?', остатки — '+d(fl.stock.at):''}`; }

function fdForm(f, isNew){
  const files=fdIsFiles(f);
  const kindSel=`<label class="f"><span>Источник</span><select data-fdf="kind"${isNew?'':' disabled'}><option value="yml"${files?'':' selected'}>Адрес фида (YML)</option><option value="files"${files?' selected':''}>Файлы: парс сайта + прайс</option></select></label>`;
  const common=`<label class="f"><span>Название</span><input type="text" data-fdf="name" value="${esc(f.name||'')}" placeholder="${files?'Dalgakiran':'Remeza'}"></label>
      <label class="f"><span>Производитель по умолчанию</span><input type="text" data-fdf="maker" value="${esc(f.maker||'')}" placeholder="${files?'Dalgakiran':'если в фиде нет поля vendor'}"></label>`;
  const body = files
    ? `${kindSel}${common}
      <label class="f"><span>Цена в прайсе — это${tip('<p><b>Наша закупка</b> — дилерский прайс: цена идёт в закупку позиции (валюта — как в прайсе), цена продажи остаётся за менеджером и «Экономикой сделки».</p><p><b>РРЦ</b> — розничный прайс: цена идёт в РРЦ и цену КП, закупка — РРЦ минус скидка.</p>')}</span><select data-fdf="priceKind"><option value="cost"${f.priceKind!=='rrc'?' selected':''}>наша закупка (дилерская цена)</option><option value="rrc"${f.priceKind==='rrc'?' selected':''}>РРЦ (розничная цена)</option></select></label>
      <label class="f"><span>Валюта прайса</span><select data-fdf="cur">${FD_CURS.map(([v,t])=>`<option value="${v}"${(f.cur||'')===v?' selected':''}>${t}</option>`).join('')}</select></label>
      ${isNew?`<label class="f"><span>Скидка от цены прайса, %${tip('Если задана — закупка = цена прайса минус скидка. Пусто — закупка равна цене прайса. Сетку скидок по видам оборудования можно задать после создания фида.')}</span><input type="text" inputmode="decimal" data-fdf="discount" value="${esc(f.discount??'')}" placeholder="например, 10"></label>`:''}
      <label class="fd-auto"><input type="checkbox" data-fdf="priceOnly"${f.priceOnly?' checked':''}> Добавлять и позиции, которых нет в парсе (только из прайса)${tip('Строки прайса, для которых не нашлось страницы сайта: без фото и описания, с характеристиками из столбцов прайса. Разделы — по листам прайса.')}</label>
      <label class="fd-auto"><input type="checkbox" data-fdf="pageDesc"${f.pageDesc?' checked':''}> Дополнять описание и фото со страницы товара (дольше)${tip('Программа откроет страницу каждого товара по ссылке из парса. Обычно не нужно: описание, фото и характеристики уже есть в файле парса.')}</label>`
    : `${kindSel}<label class="f wide"><span>Адрес фида (YML)</span><input type="text" inputmode="url" data-fdf="url" value="${esc(f.url||'')}" placeholder="https://…/catalog_export/yandex.php"></label>
      ${common}
      ${isNew?`<label class="f"><span>Наша скидка от РРЦ, %${tip('Если задана — закупка позиции = РРЦ минус скидка; обновляется вместе с РРЦ. Пусто — закупку фид не трогает. Сетку скидок по видам оборудования можно задать после создания фида.')}</span><input type="text" inputmode="decimal" data-fdf="discount" value="${esc(f.discount??'')}" placeholder="например, 25"></label>`:''}
      <label class="fd-auto"><input type="checkbox" data-fdf="auto"${f.auto!==false?' checked':''}> Раз в день проверять РРЦ и наличие</label>
      <label class="fd-auto"><input type="checkbox" data-fdf="pageDesc"${f.pageDesc!==false?' checked':''}> Описание, фото и применимость — со страницы товара${tip('При загрузке в каталог программа открывает страницу каждого товара (ссылка из фида): описание из блока описания (itemprop="description") — если оно длиннее описания в фиде; до 8 фото товара (без блоков «похожие товары»); характеристики, которых нет в фиде; у запчастей — применимость («Применяемость», «Подходит для…»). Страницы запоминаются на 30 дней; первая загрузка большого фида — дольше на несколько минут. Описание, исправленное вручную, не затирается.')}</label>`;
  return `<div class="${isNew?'st-card ':''}fd-form" data-fdform="${isNew?'new':esc(f.id)}">${isNew?`<p class="sub">${files?'Новый фид из файлов':'Новый фид'}</p>`:''}
    <div class="st-ed-g">${body}</div>
    <div class="row fd-fb"><button class="btn primary" type="button" data-fd="save">${isNew?'Добавить фид':'Сохранить'}</button>${isNew?'<button class="btn ghost" type="button" data-fd="cancel">Отмена</button>':'<button class="btn ghost danger" type="button" data-fd="del">Удалить фид</button>'}</div></div>`;
}

// файлы фида из файлов: что загружено и кнопки загрузки
function fdFiles(f){
  const fl=f.files||{};
  const row=(kind, title, accept, hint, meta, info)=>`<div class="fd-file"><div><b>${title}</b>${tip(hint)}<br>${meta?`<span class="muted">${esc(meta.name)} · ${esc(fdDate(meta.at))} · ${info}</span>`:'<span class="bad-t">файл ещё не загружен</span>'}</div>
      <label class="btn fd-up"><input type="file" accept="${accept}" data-fdfile="${kind}" hidden>${meta?'Заменить файл':'Загрузить файл'}</label></div>`;
  const pg=fl.pages, pr=fl.price, sk=fl.stock;
  return `<div class="fd-files">
    ${row('pages', 'Парс сайта (JSON или CSV)', '.json,application/json,.csv,text/csv', '<p><b>JSON</b> (надёжнее): {"items": [{"category", "name", "model", "url", "images": [адреса, первое — главное], "description": [{"title": "Назначение", "text": "…"}, {"title": "Общие характеристики", "items": ["…"]}], "specs": [{"name": "Давление", "value": "8,5 бар"}]}]}.</p><p><b>CSV</b>: столбцы — категория, название, ссылка на страницу товара, картинки (через « | »), описание, технические характеристики («Ключ: значение | Ключ: значение»). Первая строка — заголовки.</p><p>Из него создаются позиции каталога: название, раздел, описание, характеристики, фото (скачиваются по ссылкам).</p>', pg, pg?`${stNum(pg.rows)} ${plural(pg.rows,'позиция','позиции','позиций')}, разделов: ${pg.cats}`:'')}
    ${row('price', 'Прайс поставщика (XLSX)', '.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', '<p>Книга Excel с листами по сериям: шапка «Артикул», «Модель» (полное название), «Название для печатной формы», характеристики, «Стоимость» (и столбцы опций). Объединённые ячейки учитываются.</p><p>Строка прайса находится по названию позиции парса (точно, без знаков препинания, по модели). Чтобы обновить цены, загрузите новый прайс и нажмите «Обновить цены из прайса».</p>', pr, pr?`${stNum(pr.rows)} ${plural(pr.rows,'строка','строки','строк')} на ${pr.sheets} ${plural(pr.sheets,'листе','листах','листах')}, с ценой: ${stNum(pr.withPrice)}${pr.cur?', '+esc(pr.cur):''}`:'')}
    ${row('stock', 'Остатки на складе (XLSX)', '.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', '<p>Необязательно. Выгрузка склада поставщика: «Артикул», «Номенклатура» и количество (столбец с числами можно не подписывать).</p><p>Позиция находится по артикулу из прайса, иначе — по коду модели в названии («УСТАНОВКА КОМПРЕССОРНАЯ К14» → «Поршневой компрессор К14»). Нет в файле — «нет в наличии». Чтобы обновить остатки, загрузите новый файл и нажмите «Обновить цены и остатки».</p>', sk, sk?`${stNum(sk.rows)} ${plural(sk.rows,'строка','строки','строк')}, в наличии: ${stNum(sk.inStock)}`:'')}
    <p class="muted fd-note" id="fdUpSt"></p></div>`;
}

async function fdUpload(input, m){
  const file=input.files&&input.files[0]; if (!file) return;
  const st=$('#fdUpSt'); const kind=input.dataset.fdfile;
  if (st) st.textContent=`Загружаю «${file.name}» (${Math.round(file.size/1024)} КБ)…`;
  input.disabled=true;
  try{
    const r=await fetch(`/api/admin/feeds/${encodeURIComponent(FD.sel)}/upload?kind=${kind}&name=${encodeURIComponent(file.name)}`, {method:'POST', headers:{'X-CSRF-Token':ADMIN.csrf, 'Content-Type':'application/octet-stream'}, body:file});
    if (!r.ok) throw new Error(await r.text());
    const meta=await r.json();
    toast(kind==='pages' ? `Парс сайта загружен: ${stNum(meta.rows)} ${plural(meta.rows,'позиция','позиции','позиций')}`
      : kind==='stock' ? `Остатки загружены: ${stNum(meta.rows)} ${plural(meta.rows,'строка','строки','строк')}, в наличии ${stNum(meta.inStock)}. Нажмите «… и остатки», чтобы перенести их в каталог`
      : `Прайс загружен: ${stNum(meta.rows)} ${plural(meta.rows,'строка','строки','строк')}, с ценой ${stNum(meta.withPrice)}`);
    FD.prev=null; stFeeds(m);
  }catch(err){ input.disabled=false; if (st) st.textContent=''; toast('Файл не принят: '+(err.message||err)); }
}

// ---------------------------------------------------------------- сетка скидок поставщика
function fdDiscOf(f){
  if (!FD.disc || FD.disc.id!==f.id) FD.disc={ id:f.id, discount:f.discount??'', driveHints:{...(f.driveHints||{})},
    discounts:JSON.parse(JSON.stringify(f.discounts||[])) };
  return FD.disc;
}
function fdCatsTxt(cats){ return (cats||[]).length ? cats.map(fdTypeName).join(', ') : 'любая категория'; }

function fdDisc(f){
  const d=fdDiscOf(f), base=fdCostKind(f)?'цены прайса':'РРЦ';
  const num=v=>v==null?'':String(v).replace('.',',');
  const row=(r,i)=>`<tr data-fdr="${i}">
      <td><input type="text" data-fdd="label" value="${esc(r.label||'')}" placeholder="Например: Ременные компрессоры до 75 кВт" aria-label="Название правила"></td>
      <td data-l="Категории"><details class="fd-dc" data-fdr="${i}"><summary>${esc(fdCatsTxt(r.cats))}</summary><div class="fd-dcl">${FD.types.map(t=>`<label><input type="checkbox" data-fdc="${esc(t.id)}"${(r.cats||[]).includes(t.id)?' checked':''}> ${esc(t.name)}</label>`).join('')}</div></details></td>
      <td data-l="Привод"><select data-fdd="drive" aria-label="Привод">${FD_DRIVES.map(([v,t])=>`<option value="${v}"${(r.drive||'any')===v?' selected':''}>${t}</option>`).join('')}</select></td>
      <td data-l="Мощность до, кВт"><input type="text" inputmode="decimal" data-fdd="kwMax" value="${esc(num(r.kwMax))}" placeholder="любая" aria-label="Мощность до, кВт">
        <label class="fd-dku"${r.kwMax?'':' hidden'}><input type="checkbox" data-fdd="kwUnknown"${r.kwUnknown?' checked':''}> не указана — тоже</label></td>
      <td data-l="Скидка, %"><input type="text" inputmode="decimal" data-fdd="pct" value="${esc(num(r.pct))}" placeholder="%" aria-label="Скидка, %"></td>
      <td class="num"><button class="btn ghost" type="button" data-fd="discdel" data-i="${i}" title="Удалить правило" aria-label="Удалить правило">✕</button></td></tr>`;
  return `<div class="fd-disc"><div class="row fd-dh"><p class="sub" style="margin:0">Сетка скидок поставщика${tip(`<p>Закупка позиции = ${base} минус скидка. Правила проверяются сверху вниз: первое подходящее даёт скидку; не подошло ни одно — «Остальное оборудование».</p><p>Категория — категория программы у позиции каталога. Привод определяется по признаку частотника (VSD, инвертор), по сериям из полей ниже (в названии позиции или на листе прайса) и по строке «Привод» в характеристиках. Мощность — поле «Мощность» позиции; «до 75» — включительно. Если мощность у позиции не указана, правило с ограничением мощности её пропускает — или применяется, когда отмечено «не указана — тоже».</p><p>Цены обновляются у всех позиций производителя: и у загруженных из фида, и у заведённых вручную — для них строка прайса подбирается по серии, типоразмеру и исполнению (ресивер, осушитель, водяное охлаждение, частотник).</p><p>Закупка и цена, исправленные вручную в карточке, не меняются. Применённая скидка видна в карточке позиции.</p>`)}</p>
      <span class="sp"></span><button class="btn" type="button" data-fd="discpreset">Сетка Dalgakiran</button></div>
    <div class="fd-tw"><table class="fd-t fd-dt"><thead><tr><th>Правило</th><th>Категории</th><th>Привод</th><th>Мощность до, кВт</th><th>Скидка, %</th><th></th></tr></thead>
      <tbody>${d.discounts.map(row).join('')}
      <tr class="fd-dother"><td><b>Остальное оборудование</b></td><td class="muted" colspan="3">всё, что не подошло под правила выше</td><td data-l="Скидка, %"><input type="text" inputmode="decimal" data-fddo="discount" value="${esc(num(d.discount))}" placeholder="нет" aria-label="Скидка на остальное, %"></td><td></td></tr></tbody></table></div>
    <div class="row fd-fb"><button class="btn" type="button" data-fd="discadd">+ Правило</button></div>
    <div class="st-ed-g fd-dhint">
      <label class="f"><span>Серии с ременным приводом${tip('Через запятую. Ищутся в названии позиции и в названии листа прайса целым словом. Пример для Dalgakiran: TIDY, DVK, DS.')}</span><input type="text" data-fdh="belt" value="${esc(d.driveHints.belt||'')}" placeholder="TIDY, DVK, DS"></label>
      <label class="f"><span>Серии с прямым приводом${tip('Через запятую; проверяются раньше ременных — «DVK D» точнее, чем «DVK». Частотник (VSD, INVERSYS, инвертор) определяется сам.')}</span><input type="text" data-fdh="direct" value="${esc(d.driveHints.direct||'')}" placeholder="DVK D, IMPETUS, EAGLE"></label></div>
    <div class="row fd-fb"><button class="btn" type="button" data-fd="discplan">Показать распределение</button><button class="btn" type="button" data-fd="discsave">Сохранить сетку</button>
      <button class="btn primary" type="button" data-fd="discapply"${f.linked?'':' disabled title="Сначала загрузите позиции в каталог"'}>Сохранить и обновить цены</button></div>
    <div id="fdPlan">${FD.plan&&FD.plan.id===f.id?fdPlan(FD.plan):''}</div></div>`;
}

function fdDiscRead(m){
  const d=FD.disc; if (!d) return d; const box=m.querySelector('.fd-disc'); if (!box) return d;
  const n=v=>{ const x=parseFloat(String(v||'').replace(/\s/g,'').replace(',','.')); return Number.isFinite(x)&&x>0?x:null; };
  box.querySelectorAll('tr[data-fdr]').forEach(tr=>{ const r=d.discounts[+tr.dataset.fdr]; if (!r) return;
    r.label=tr.querySelector('[data-fdd=label]').value.trim(); r.drive=tr.querySelector('[data-fdd=drive]').value;
    r.kwMax=n(tr.querySelector('[data-fdd=kwMax]').value); r.pct=n(tr.querySelector('[data-fdd=pct]').value);
    r.kwUnknown=!!tr.querySelector('[data-fdd=kwUnknown]')?.checked;
    r.cats=[...tr.querySelectorAll('[data-fdc]:checked')].map(x=>x.dataset.fdc); });
  d.discount=n(box.querySelector('[data-fddo=discount]').value);
  box.querySelectorAll('[data-fdh]').forEach(i=>{ d.driveHints[i.dataset.fdh]=i.value.trim(); });
  return d;
}

function fdDiscBody(d){ return { discounts:d.discounts.filter(r=>r.pct), discount:d.discount, driveHints:d.driveHints }; }

function fdPlan(p){
  const pct=v=>v==null||v===''?'нет':String(v).replace('.',',')+' %';
  return `<div class="fd-tw"><table class="fd-t"><thead><tr><th>Правило</th><th class="num">Скидка</th><th class="num">Позиций</th><th>Например</th></tr></thead>
    <tbody>${p.groups.map(g=>`<tr><td>${esc(g.label)}</td><td class="num">${pct(g.pct)}</td><td class="num">${stNum(g.count)}</td><td class="muted">${esc(g.sample.slice(0,3).join(' · '))}${g.count>3?' …':''}</td></tr>`).join('')}</tbody></table></div>
    ${p.unknownCount?`<details class="more"><summary class="bad-t">Не распознано: ${stNum(p.unknownCount)} — получат скидку «остальное»</summary><p class="muted">${p.unknown.map(u=>`${esc(u.name)} <small>(${esc(u.why)})</small>`).join(' · ')}</p><p class="muted">Добавьте серию в поле «Серии с ременным / прямым приводом» или укажите привод и мощность в карточке позиции.</p></details>`:''}
    ${p.manual?`<p class="muted">Закупка исправлена вручную у ${stNum(p.manual)} ${plural(p.manual,'позиции','позиций','позиций')} — её сетка не меняет.</p>`:''}
    ${p.noprice?`<p class="muted">Пока без цены: ${stNum(p.noprice)} ${plural(p.noprice,'позиция','позиции','позиций')} — закупка появится после «Сохранить и обновить цены», если в прайсе есть цена.</p>`:''}`;
}

async function fdDiscClick(a, b, m){
  const f=(await aapi('feeds')).items.find(x=>x.id===FD.sel); if (!f) return;
  const d=fdDiscRead(m) || fdDiscOf(f), redraw=()=>{ const el=m.querySelector('#fdDisc'); if (el) el.innerHTML=fdDisc(f); };
  if (a==='discadd'){ d.discounts.push({ label:'', cats:[], drive:'any', kwMax:null, pct:null }); return redraw(); }
  if (a==='discdel'){ d.discounts.splice(+b.dataset.i, 1); return redraw(); }
  if (a==='discpreset'){
    if (d.discounts.length && !await stConfirm('Заменить сетку скидок?','Текущие правила заменятся сеткой Dalgakiran: ременные компрессоры и рефрижераторные осушители до 75 кВт включительно — 30 %, прямой привод и/или частотник — 27 % при любой мощности, фильтры, сепараторы и маслоотделители — 30 %, остальное — 25 %.','Заменить')) return;
    Object.assign(d, JSON.parse(JSON.stringify(FD_DISC_DALG))); FD.plan=null; return redraw(); }
  if (d.discounts.some(r=>!r.pct)){ toast('У каждого правила укажите скидку, % (или удалите правило)'); return; }
  if (a==='discplan'){ b.disabled=true; b.textContent='Считаю…';
    FD.plan={...await ajson(`feeds/${FD.sel}/discounts`, fdDiscBody(d)), id:FD.sel}; return redraw(); }
  await ajson('feeds', {...f, ...fdDiscBody(d)}); FD.disc=null;
  if (a==='discsave'){ toast('Сетка скидок сохранена'); FD.plan=null; return stFeeds(m); }
  if (a==='discapply'){ await ajson(`feeds/${FD.sel}/check`); toast('Сетка сохранена, обновляю цены по прайсу'); FD.plan=null; return stFeeds(m); }
}

function fdActions(f){
  const files=fdIsFiles(f), ready=!files || (f.files&&f.files.pages);
  if (files) return fdFilesActions(f, ready);
  return `<div class="row fd-acts"><button class="btn" type="button" data-fd="preview"${ready?'':' disabled title="Сначала загрузите файл парса сайта"'}>Проверить фид</button>
    <button class="btn primary" type="button" data-fd="import"${FD.prev&&FD.prev.id===f.id?'':' disabled title="Сначала «Проверить фид»"'}>Загрузить в каталог</button>
    <button class="btn" type="button" data-fd="check"${f.linked?'':' disabled title="Сначала загрузите позиции в каталог"'}>${files?fdUpdLbl(f):'Проверить цены и наличие сейчас'}</button></div>`;
}

// фид из файлов: сначала «Сформировать каталог» (полный парс → позиция на каждое исполнение, без дублей), потом парс
// только добавляет новые позиции, а прайс обновляет цены
function fdFilesActions(f, ready){
  const noFile=ready?'':' disabled title="Сначала загрузите файл парса сайта"', b=f.built;
  if (!b) return `<div class="fd-build"><p class="muted">${tip('<p>Парс сайта — полный список номенклатуры. «Сформировать каталог» создаёт позицию на каждое исполнение из парса (давление, ресивер, осушитель — как на сайте): описание по блокам, характеристики (сверены с прайсом — он точнее), главное фото из парса, цена из прайса.</p><p>Уже имеющиеся позиции производителя (из прошлых загрузок и заведённые вручную) сопоставляются с позициями парса и перестраиваются — id сохраняется, ссылки в КП не теряются. Лишние совпадения (дубли, например карточка «на все давления») уходят в корзину — 30 дней их можно восстановить.</p><p>После сборки парс больше не меняет позиции — только добавляет новые; описания, фото и характеристики правятся вручную. Цены обновляются загрузкой нового прайса.</p>')} Каталог производителя ещё не сформирован по полному парсу.</p></div>
    <div class="row fd-acts"><button class="btn" type="button" data-fd="preview"${noFile}>Проверить фид</button>
      <button class="btn" type="button" data-fd="plan"${noFile}>План сборки</button>
      <button class="btn primary" type="button" data-fd="build"${noFile}>Сформировать каталог</button></div>`;
  return `<div class="fd-build"><p class="ok-t">Каталог сформирован ${esc(fdDate(b.at))}${b.by?' · '+esc(b.by):''}: позиций ${stNum(b.items||0)}, сопоставлено с имевшимися ${stNum(b.linked||0)}, в корзину ${stNum(b.trashed||0)}.</p>
      <p class="muted">Парс больше не меняет позиции каталога — только добавляет новые, если они появятся. Описания, фото и характеристики правятся вручную в карточке. Цены${f.files&&f.files.stock?' и остатки':''}: загрузите новый прайс${f.files&&f.files.stock?' или файл остатков':''} и нажмите «${fdUpdLbl(f)}».</p></div>
    <div class="row fd-acts"><button class="btn" type="button" data-fd="plan"${noFile}>Что нового в парсе</button>
      <button class="btn" type="button" data-fd="addnew"${noFile}>Добавить новые из парса</button>
      <button class="btn primary" type="button" data-fd="check"${f.linked?'':' disabled'}>${fdUpdLbl(f)}</button>
      <span class="sp"></span><button class="btn ghost danger" type="button" data-fd="rebuild">Сформировать заново…</button></div>`;
}

function fdBuildPlan(p){
  const list=(arr, f)=>arr.length?`<p class="muted">${arr.slice(0,300).map(f).join(' · ')}${arr.length>300?' …':''}</p>`:'';
  if (p.built) return `<div class="fd-plan"><p><b>Новых позиций в парсе: ${stNum(p.addCount)}</b>${p.addCount?' — «Добавить новые из парса» создаст их; имеющиеся не изменятся.':' — каталог совпадает с парсом.'}</p>${list(p.add, esc)}</div>`;
  return `<div class="fd-plan"><div class="fd-sum"><span><b>${stNum(p.offers)}</b> позиций в парсе</span><span><b>${stNum(p.withPrice)}</b> с ценой из прайса</span>
      <span><b>${stNum(p.links)}</b> сопоставлено с имеющимися</span><span><b>${stNum(p.new)}</b> новых</span><span><b>${stNum(p.dups.length)}</b> дублей — в корзину</span><span><b>${stNum(p.keep.length)}</b> нет в парсе</span></div>
    ${p.dups.length?`<details class="more" open><summary>Дубли — уйдут в корзину (${p.dups.length})</summary>${list(p.dups, x=>esc(x.name))}</details>`:''}
    ${p.keep.length?`<details class="more"><summary>Позиции производителя, которых нет в парсе (${p.keep.length})</summary>${list(p.keep, x=>esc(x.name))}
      <label class="fd-auto"><input type="checkbox" id="fdTrashMissing"> Убрать и их в корзину (по умолчанию остаются в каталоге как есть)</label></details>`:''}
    ${p.linkSample.length?`<details class="more"><summary>Имеющиеся позиции, которые перестроятся по парсу с новым названием (${p.linkSample.length})</summary>${list(p.linkSample, x=>`${esc(x[0])} → <b>${esc(x[1])}</b>`)}</details>`:''}</div>`;
}

function fdJob(j){
  if (!j) return '';
  if (j.state==='run') return `<div class="fd-prog"><span>${j.kind==='import'?'Загружаю позиции, фото и характеристики':'Сверяю цены'}… ${j.done} из ${j.total||'?'}</span><i style="width:${j.total?Math.round(j.done/j.total*100):5}%"></i></div>`;
  if (j.state==='error') return `<p class="msg err">${esc(j.msg)}</p>`;
  return j.msg ? `<p class="msg ok">${esc(j.msg)}</p>` : '';
}

function fdTypeName(id){ const t=FD.types.find(x=>x.id===id); return t ? t.name : (id==='other'||!id ? 'Прочее' : id); }
function fdKinds(k){ return (k||[]).map(([id,n])=>`${esc(fdTypeName(id))} ${n}`).join(' · '); }

function fdPreview(p, f){
  const files=p.kind==='files', cost=fdCostKind(f||{kind:p.kind, priceKind:'cost'});
  const tsel=(cid,v)=>`<select data-fdcat="${esc(cid)}" aria-label="Категория программы"><option value="skip"${v==='skip'?' selected':''}>— не загружать —</option>
    <option value=""${!v?' selected':''}>по названию позиции</option>${FD.types.map(t=>`<option value="${esc(t.id)}"${v===t.id?' selected':''}>${esc(t.name)}</option>`).join('')}</select>`;
  const mt=p.match||{};
  const sum = files
    ? [['позиций', p.total], ['с ценой из прайса', p.withPrice], ['с фото', p.withPhoto], ['уже в каталоге', p.inCatalog]]
    : [['товаров', p.total], ['в наличии', p.available], ['с ценой', p.withPrice], ['с остатком', p.withQty], ['с фото', p.withPhoto], ['уже в каталоге', p.inCatalog]];
  return `<div class="fd-sum">${sum.map(([t,v])=>`<span><b>${stNum(v)}</b> ${t}</span>`).join('')}${p.shop&&!files?`<span class="muted">${esc(p.shop)}${p.date?' · '+esc(p.date):''}</span>`:''}</div>
    ${files&&p.match?`<p class="muted fd-match">Сопоставление с прайсом: строка прайса нашлась у ${stNum(mt.matched)} ${plural(mt.matched,'позиции','позиций','позиций')} парса${mt.how?` (по названию ${mt.how.name||0}, без знаков ${mt.how.key||0}, по модели ${(mt.how.model||0)+(mt.how.short||0)+(mt.how.set||0)})`:''}; строк прайса без страницы на сайте — ${stNum(mt.priceOnly)}${f&&f.priceOnly?' (загружаются как отдельные позиции, разделы «Прайс / …»)':' (не загружаются — есть настройка «Добавлять и позиции, которых нет в парсе»)'}. Позиции без строки прайса или с пустой ценой («по запросу») загружаются без цены.</p>`:''}
    <div class="sub">Категории ${files?'парса':'фида'} → категории программы ${tip('По умолчанию категория определяется по названию каждой позиции: разделы фида часто — подборки («200 л/мин», «С ресивером»), где вперемешку винтовые и поршневые. Выберите категорию, только если весь раздел — одно и то же, или «не загружать».')}</div>
    <div class="fd-tw"><table class="fd-t"><thead><tr><th>Категория ${files?'в парсе':'в фиде'}</th><th class="num">Товаров</th><th class="num">В каталоге</th><th>По названию</th><th>Категория программы</th></tr></thead>
      <tbody>${p.cats.map(c=>`<tr><td>${esc(c.path)}</td><td class="num">${c.count}</td><td class="num">${c.inCatalog||''}</td><td class="muted">${fdKinds(c.kinds)}</td><td>${tsel(c.id, FD.cats[c.id]??c.map)}</td></tr>`).join('')}</tbody></table></div>
    <p class="muted fd-cnt" id="fdCnt"></p>
    ${p.params.length?`<details class="more"><summary>Характеристики (${p.params.length})</summary><p class="muted">${p.params.map(([k,n])=>`${esc(k)} <small>(${n})</small>`).join(' · ')}</p></details>`:''}
    <details class="more"><summary>Первые товары</summary><div class="fd-tw"><table class="fd-t"><thead><tr><th>Товар</th><th>Производитель, модель</th><th>Артикул</th><th>Категория</th><th class="num">${cost?'Закупка':'РРЦ'}</th>${files?'':'<th>Наличие</th>'}<th class="num">Фото / ТТХ</th></tr></thead>
      <tbody>${p.sample.map(o=>`<tr><td>${esc(o.name)}</td><td>${esc([o.maker,o.model].filter(Boolean).join(' '))}</td><td>${esc(o.sku||'')}</td><td class="muted">${esc(fdTypeName(o.cat))}</td><td class="num">${o.price!=null?money(Math.round(o.price*100))+' '+esc(o.cur||''):'—'}</td>
        ${files?'':`<td>${o.qty!=null?(o.qty>0?'в наличии '+o.qty:'нет'):(o.available?'в наличии':'нет')}</td>`}<td class="num">${o.pics} / ${o.params}</td></tr>`).join('')}</tbody></table></div></details>`;
}

function fdCount(m){ const p=FD.prev; if (!p) return; const el=m.querySelector('#fdCnt'); if (!el) return;
  const n=p.cats.filter(c=>(FD.cats[c.id]??c.map)!=='skip').reduce((a,c)=>a+c.count,0);
  el.textContent=`Будет загружено: ${n} ${plural(n,'позиция','позиции','позиций')}. Новые появятся в каталоге, уже загруженные обновятся (ручные правки сохранятся).`;
  const b=m.querySelector('[data-fd=import]'); if (b) b.textContent=`Загрузить в каталог (${n})`; }

async function fdLoadLog(fid){
  try{ const r=await aapi(`feeds/${fid}/log`); const el=$('#fdLog'); if (!el) return;
    el.innerHTML=(r.items||[]).length?`<p class="sub">Журнал загрузок и проверок</p>${r.items.map(x=>fdLogItem(x)).join('')}`:'<p class="muted">Загрузок и проверок ещё не было.</p>'; }
  catch(e){ const el=$('#fdLog'); if (el) el.innerHTML=`<p class="muted">Журнал не загрузился: ${esc(e.message||e)}</p>`; }
}

function fdLogItem(x){
  const pc=x.price||[], sc=x.stock||[], gone=x.gone||[];
  const costLog=pc.length&&pc.every(c=>c.kind==='cost');
  const kind=x.kind==='import'?(x.mode==='build'?'Сборка каталога по парсу':x.mode==='add'?'Новые позиции из парса':'Загрузка в каталог'):(costLog?'Обновление закупки по прайсу':'Проверка РРЦ и наличия');
  if (x.error) return `<div class="st-row"><div><b>${esc(fdDate(x.at))} · ${kind}</b><span class="bad-t">${esc(x.error)}</span></div></div>`;
  const ph=x.photos, sum=x.kind==='import' ? `добавлено ${x.added}, обновлено ${x.updated}, без изменений ${x.same}${ph&&ph.items?` · фото: в среднем ${String(ph.avg).replace('.',',')} на позицию, с несколькими фото — ${ph.multi} из ${ph.items}${ph.new?`, скачано новых ${ph.new}`:''}`:''}` : `проверено ${x.checked}, обновлено ${x.updated}${x.new?`, новых в фиде ${x.new}`:''}`;
  const tbl=(rows, f)=>`<table class="fd-t"><tbody>${rows.map(f).join('')}</tbody></table>`;
  const lbl=c=>c.kind==='cost'?'Закупка':'РРЦ';
  return `<details class="st-log"><summary><span class="t">${esc(fdDate(x.at))}</span><b>${kind}</b><span class="muted">${esc(sum)}${pc.length?` · ${costLog?'закупка':'РРЦ'} изменилась: ${pc.length}`:''}${sc.length?` · наличие: ${sc.length}`:''}${gone.length?` · нет в фиде: ${gone.length}`:''}</span><span class="u">${esc(x.by||'')}</span></summary>
    <div class="st-logb">${pc.length?`<p class="sub">${costLog?'Закупка':'РРЦ'}</p>${tbl(pc, c=>`<tr><td>${esc(c.name)}</td><td class="muted">${lbl(c)}</td><td class="num">${c.cur?fdMoney(c.old,c.cur):fdRub(c.old)} → <b class="${c.new>c.old?'bad-t':'ok-t'}">${c.cur?fdMoney(c.new,c.cur):fdRub(c.new)}</b></td><td class="num">${c.old?((c.new-c.old)/c.old*100>0?'+':'')+String(Math.round((c.new-c.old)/c.old*1000)/10).replace('.',',')+' %':''}</td></tr>`)}`:''}
      ${sc.length?`<p class="sub">Наличие</p>${tbl(sc, c=>`<tr><td>${esc(c.name)}</td><td>${esc(c.old)} → <b>${esc(c.new)}</b></td></tr>`)}`:''}
      ${gone.length?`<p class="sub">Пропали из фида</p>${tbl(gone, c=>`<tr><td>${esc(c.name)}</td></tr>`)}`:''}
      ${x.newSample&&x.newSample.length?`<p class="sub">Новые товары в фиде (ещё не в каталоге)</p><p class="muted">${x.newSample.map(esc).join(' · ')}${x.new>x.newSample.length?' …':''} — «Проверить фид» → «Загрузить в каталог».</p>`:''}
      ${x.cards?fdCardsLog(x.cards):''}
      ${x.mode==='build'?`<p class="sub">Сборка</p><p class="muted">Сопоставлено с имевшимися позициями: ${stNum(x.linked||0)}, в корзину: ${stNum(x.trashed||0)}.</p>${(x.dups||[]).length?`<details class="more"><summary>Дубли в корзине (${x.dups.length})</summary><p class="muted">${x.dups.map(esc).join(' · ')}</p></details>`:''}${(x.keep||[]).length?`<details class="more"><summary>Позиции производителя, которых нет в парсе (${x.keep.length})</summary><p class="muted">${x.keep.map(esc).join(' · ')}</p></details>`:''}`:''}
      ${(x.errors||[]).length?`<p class="sub">Ошибки</p><p class="bad-t">${x.errors.map(esc).join('<br>')}</p>`:''}
      ${!pc.length&&!sc.length&&!gone.length&&!(x.errors||[]).length&&!x.new?'<p class="muted">Изменений нет.</p>':''}</div></details>`;
}

// карточки производителя, заведённые вручную: сколько получили цену из прайса и какие — нет (почему)
function fdCardsLog(c){
  const list=(arr, t)=>arr.length?`<details class="more"><summary>${t}: ${arr.length}</summary><p class="muted">${arr.map(x=>esc(x.name)+(x.rows&&x.rows.length?` <small>(${esc(x.rows[0])})</small>`:'')).join(' · ')}</p></details>`:'';
  return `<p class="sub">Карточки, заведённые вручную</p><p class="muted">Всего ${stNum(c.cards)}, цена из прайса — у ${stNum(c.priced)}, изменились — ${stNum(c.updated)}.</p>
    ${list(c.noPrice||[], 'В прайсе без цены («по запросу»)')}${list(c.missing||[], 'Такого исполнения нет в прайсе')}${list(c.unclear||[], 'Не понятна модель')}`;
}

function fdPoll(fid, m){
  clearTimeout(FD.poll);
  FD.poll=setTimeout(async()=>{ if (ST.tab!=='feeds' || !$('#fdPanel')) return;
    let j=null; try{ j=(await aapi(`feeds/${fid}/status`)).job; }catch(e){ return; }
    const el=$('#fdJob'); if (el) el.innerHTML=fdJob(j);
    if (j && j.state==='run') return fdPoll(fid, m);
    if (j && j.state==='done' && typeof refreshCat==='function') refreshCat();
    FD.prev=null; stFeeds(m); }, 1500);
}

function fdVals(box){ const v={}; box.querySelectorAll('[data-fdf]').forEach(i=>{ v[i.dataset.fdf]=i.type==='checkbox'?i.checked:i.value.trim(); }); return v; }

async function fdClick(e, m){
  const b=e.target.closest('[data-fd]'); if (!b) return; const a=b.dataset.fd;
  try{
    if (a==='new'){ FD.edit={name:'', url:'', maker:'', auto:true, pageDesc:true, kind:'yml'}; return stFeeds(m); }
    if (a==='newfiles'){ FD.edit={...FD_FILES}; return stFeeds(m); }
    if (a==='cancel'){ FD.edit=null; return stFeeds(m); }
    if (a==='open'){ FD.sel = FD.sel===b.dataset.id ? null : b.dataset.id; FD.prev=null; FD.cats={}; FD.disc=null; FD.plan=null; return stFeeds(m); }
    if (a.startsWith('disc')) return fdDiscClick(a, b, m);
    const form=b.closest('[data-fdform]') || m.querySelector(`[data-fdform="${FD.sel}"]`);
    if (a==='save'){ const isNew=form.dataset.fdform==='new', v=fdVals(form);
      const old=isNew?{}:(await aapi('feeds')).items.find(x=>x.id===FD.sel)||{};
      const f=await ajson('feeds', {...old, ...v, kind:isNew?(v.kind||'yml'):old.kind, id:isNew?undefined:FD.sel}); FD.edit=null; FD.sel=f.id; FD.prev=null; toast(isNew&&f.kind==='files'?'Фид создан — загрузите файл парса сайта и прайс':'Фид сохранён'); return stFeeds(m); }
    if (a==='del'){ if (!await stConfirm('Удалить фид?','Позиции, уже загруженные в каталог, останутся; обновление цен и наличия для них прекратится.','Удалить')) return;
      await ajson(`feeds/${FD.sel}/delete`); FD.sel=null; FD.prev=null; toast('Фид удалён'); return stFeeds(m); }
    if (a==='preview'){ b.disabled=true; b.textContent='Читаю…'; const p=await ajson(`feeds/${FD.sel}/preview`);
      FD.prev={...p, id:FD.sel}; FD.cats={}; p.cats.forEach(c=>{ FD.cats[c.id]=c.map; }); await stFeeds(m); fdCount(m); return; }
    if (a==='import'){ const f=(await aapi('feeds')).items.find(x=>x.id===FD.sel); if (!f) return;
      await ajson('feeds', {...f, cats:{...FD.cats}});
      await ajson(`feeds/${FD.sel}/import`); toast('Загрузка началась — можно продолжать работу'); return stFeeds(m); }
    if (a==='check'){ await ajson(`feeds/${FD.sel}/check`); toast('Обновление началось'); return stFeeds(m); }
    if (a==='plan'){ b.disabled=true; b.textContent='Считаю…'; const p=await ajson(`feeds/${FD.sel}/plan`);
      const el=m.querySelector('#fdPrev'); if (el) el.innerHTML=fdBuildPlan(p); b.disabled=false; b.textContent=p.built?'Что нового в парсе':'План сборки'; return; }
    if (a==='build'){ const tm=!!m.querySelector('#fdTrashMissing')?.checked;
      if (!await stConfirm('Сформировать каталог по парсу?', `Позиции производителя перестроятся по парсу и прайсу (описания, характеристики, фото, цены), дубли уйдут в корзину${tm?', позиции, которых нет в парсе, — тоже':''}. Ручные правки в этих позициях заменятся. Перед сборкой программа сделает копию базы.`, 'Сформировать')) return;
      await ajson(`feeds/${FD.sel}/import`, {trashMissing:tm}); toast('Сборка каталога началась — можно продолжать работу'); FD.prev=null; return stFeeds(m); }
    if (a==='addnew'){ await ajson(`feeds/${FD.sel}/import`, {}); toast('Добавляю новые позиции из парса'); return stFeeds(m); }
    if (a==='rebuild'){
      if (!await stConfirm('Сформировать каталог заново?', 'Позиции производителя снова перестроятся по парсу — ручные правки описаний, фото и характеристик в них заменятся. Обычно это не нужно: новые позиции добавляет «Добавить новые из парса».', 'Разрешить пересборку')) return;
      await ajson(`feeds/${FD.sel}/rebuild`); toast('Теперь можно сформировать каталог заново'); return stFeeds(m); }
  }catch(err){ toast(err.message||String(err)); stFeeds(m); }
}
