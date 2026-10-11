// Компоновка станции в контейнере — в программе: вкладка «Компоновка» карточки станции (помещается ли оборудование,
// чертёж, схема и 3D-вид, подбор контейнера), размер блок-контейнера по оборудованию, картинки для КП (3D-вид — главное
// фото станции, габаритный чертёж и схема пневматическая — в изображениях после характеристик), проверка перед сохранением.
// Расчёт — station-layout.js (StationLayout), лист ЕСКД и схема — station-eskd.js (EskdSheet, StationScheme), чертёж —
// station-draw.js (StationDrawing), 3D-вид — station-render.js (StationRender, WebGL2); нет WebGL2 — SVG-вид (StationView3D).
'use strict';

class StationUi {
  static cache = new Map();

  /** функция включена, позиция — станция в контейнере */
  static on(x){ return !!x && typeof stationOf==='function' && !!stationOf(x) && FEAT.on('stLayout'); }
  static input(x){
    const c=kitContainer(x);
    const R=typeof StationReq!=='undefined' ? StationReq : null;   // где ресивер и снаружи ли — из требований станции
    return { cont:c ? { ctype:c.ctype, size:c.size, sizeAuto:!!c.sizeAuto, ins:c.ins, ral:c.ral, sys:c.sys||null, climate:c.climate||'', roof:c.roof||'', floor:StationGeo.floor(c) } : null, parts:kitParts(x), air:this.opts(x).air,
      recv:R ? R.recv(x) : 'after', recvOut:R ? R.recvOut(x) : false, req:R ? R.plan(x) : null };
  }
  /** расстановка — пересчитывается, только когда изменился состав, контейнер или класс чистоты воздуха (на картинки не влияет) */
  static plan(x){
    const inp=this.input(x), h=StationLayout.hash(inp), k=h+'|'+inp.air, c=this.cache.get(x.id);
    if (c && c.k===k) return c.plan;
    const plan=StationLayout.solve(inp); plan.hash=h; this.cache.set(x.id, { k, plan });
    return plan;
  }
  /** оборудование не помещается — КП не сохраняется (пункт в «Чтобы сохранить, заполните»); по условным габаритам —
   *  только предупреждение: программа не уверена */
  static blocked(x){ if (!this.on(x) || !isKit(x)) return false; const p=this.plan(x); return p.level==='error' && !p.assumed; }
  static meta(x, plan){
    const c=kitContainer(x), dev=String((S.manager||{}).name||'').trim().replace(/\s+/g, ' ');
    return { title:String(x.name||'').trim() || 'Станция в контейнере', cont:c ? ctypeOf(c.ctype).name : 'Контейнер', colorText:plan.colorText ? 'цвет '+plan.colorText : '',
      org:this.org(), dev:this.short(dev), date:S.date||'' };   // основная надпись чертежей: организация, «Разраб.», дата
  }
  /** организация для основной надписи: из настроек шаблона КП */
  static org(){ const pk=TPL_CACHE[S.template], st=(pk && pk.settings) || {}, tl=curTemplate() || {};
    return String(st.company || tl.company || (st.brandParts||[]).map(x=>x[0]).join('') || 'ПНЕВМОТЕХ').trim(); }
  /** «Иванов Иван Иванович» → «Иванов И. И.»; два слова — как есть */
  static short(n){ const w=n.split(' ').filter(Boolean); return w.length>=3 ? `${w[0]} ${w[1][0]}. ${w[2][0]}.` : n; }
  /** что вставлять в КП: 3D-вид главным фото, чертёж — в изображения (по умолчанию да); схема — только если включили */
  static opts(x){ const o=x.stLayout||{}; return { photo:o.photo!==false, out:o.out!==false, draw:o.draw!==false, scheme:o.scheme===true, air:/^[1-6]\.[1-6]\.[1-4]$/.test(String(o.air||'')) ? o.air : '' }; }
  static url(svg){ return 'data:image/svg+xml;charset=utf-8,'+encodeURIComponent(svg); }
  /** схема станции: компрессорная — пневматическая, насосная — гидравлическая */
  static scheme(plan){
    if (StationScheme.ok(plan)) return { cls:StationScheme, title:'Схема пневматическая', name:'Схема пневматическая принципиальная' };
    if (HydroScheme.ok(plan)) return { cls:HydroScheme, title:'Схема гидравлическая', name:'Схема гидравлическая принципиальная' };
    return null;
  }

  // ---- вкладка «Компоновка»
  static tab(x, i){
    if (StationSize.apply(x)) persist();
    const plan=this.plan(x), n=StationLayout.n;
    if (plan.level==='none') return `<div class="ed-sec stl"><p class="stl-none">${esc(plan.text)}</p>${this.how()}</div>`;
    const g=plan.geo, c=kitContainer(x), ct=ctypeOf(c.ctype), o=this.opts(x);
    const big=plan.suggest && plan.suggest.smaller && !plan.issues.some(t=>t.level==='warn' && !t.big);   // предупреждение — только о запасе
    const wn=plan.issues.filter(t=>t.level==='warn'), airOnly=wn.length && wn.every(t=>t.air);
    const head=plan.level==='error' ? ['err', plan.assumed ? '✕ Не помещается по условным габаритам — укажите размеры оборудования' : '✕ Оборудование не помещается в контейнер']
      : plan.door==='service' ? ['warn', '⚠ Помещается без прохода — обслуживание снаружи через сервисные двери']
      : big ? ['warn', '⚠ Помещается с запасом — достаточно контейнера меньше']
      : airOnly ? ['warn', '⚠ Помещается — есть замечания по подготовке воздуха']
      : plan.level==='warn' ? ['warn', '⚠ Помещается, но часть отступов меньше рекомендуемых'] : ['ok', '✓ Оборудование помещается с рекомендуемыми отступами'];
    const dims=g.ext ? `${esc(ct.name)} · ${n(g.ext[0])} × ${n(g.ext[1])} × ${n(g.ext[2])} мм${plan.int ? ` · внутри ${n(plan.int[0])} × ${n(plan.int[1])} × ${n(plan.int[2])} мм` : ''}` : esc(ct.name);
    const iss=[...plan.issues].sort((a, b)=>this.rank(a)-this.rank(b)), top=iss.filter(t=>t.level!=='info'), info=iss.filter(t=>t.level==='info');
    if (plan.level==='error' && plan.assumed) info.unshift({ level:'info', text:'Пока габариты части оборудования условные, КП сохранится, но контейнер может не подойти: впишите «Габариты» элементов на вкладке «Состав станции».' });
    else if (plan.level==='error') info.unshift({ level:'info', text:'КП не сохранится, пока оборудование не поместится: замените контейнер (кнопка выше) или измените состав.' });
    // замечания — все; сведения — первые два, остальные по раскрытию (окно не перегружено)
    const li=t=>`<li class="${t.level}">${esc(t.text)}</li>`, more=info.slice(2);
    const pics=plan.level!=='error' && g.ext, meta=this.meta(x, plan), photoOn=x.photo ? x.photo.gen==='st3d' : o.photo;
    if (pics && !EskdSheet.FONT_DATA) EskdFont.load().then(ok=>{ if (ok) renderEditor(); });   // чертёж — встроенным шрифтом, как в КП
    if (pics && typeof DrawPic!=='undefined' && DrawPic.pending(x)) DrawPic.load(x).then(ch=>{ if (ch) renderEditor(); });   // свои рисунки моделей
    if (pics && PhotoTint.pending(x)) PhotoTint.load(x).then(ch=>{ if (ch) renderEditor(); });   // цвет оборудования — по его фото
    StationImages.soon(x);
    // 3D-вид: готовый (WebGL) — сразу; пока рисуется — прежний SVG-вид, затем картинка подменяется; снаружи — только WebGL
    const r3=pics ? StationRender.cached(plan) : null, src3=pics ? (r3 ? r3.src : this.url(StationView3D.svg(plan, meta))) : '';
    if (pics && !r3) StationRender.image(plan, meta).then(im=>{ if (im) for (const el of document.querySelectorAll('img[data-st3d]')) if (el.dataset.st3d===plan.hash) el.src=im.src; });
    const gl=pics && StationRender.ok(), r3o=gl ? StationRender.cached(plan, 'out') : null;
    if (gl && !r3o) StationRender.image(plan, meta, 'out').then(im=>{ if (im) for (const el of document.querySelectorAll('img[data-st3do]')) if (el.dataset.st3do===plan.hash){ el.src=im.src; el.classList.remove('wait'); } });
    const cutCab=plan.items.some(t=>t.mount==='wall' && t.wall==='front') && !(plan.door==='service' && (plan.doors||[]).some(d=>d.wall!=='back'));   // стена прохода срезана
    const sch=this.scheme(plan);
    return `<div class="ed-sec stl">
      <div class="stl-st ${head[0]}"><b>${head[1]}</b><span>${dims}${this.sizeNote(c, i)}</span>${plan.suggest ? this.fix(plan.suggest, i) : ''}</div>
      ${top.length || info.length ? `<ul class="stl-iss">${[...top, ...info.slice(0, 2)].map(li).join('')}</ul>` : ''}
      ${more.length ? `<details class="stl-more"><summary>Ещё сведения — ${more.length}</summary><ul class="stl-iss">${more.map(li).join('')}</ul></details>` : ''}
      ${this.air(plan, x, i)}
      ${this.systems(plan)}
      ${pics ? `<div class="stl-views">
        <figure class="v3d"><figcaption><b>3D-вид</b><label class="stl-chk"><input type="checkbox" data-stl="photo" data-i="${i}"${photoOn ? ' checked' : ''}> главное фото станции — в строке КП и на титуле</label></figcaption>
          <img src="${esc(src3)}" data-st3d="${esc(plan.hash||'')}" alt="3D-вид станции">${cutCab ? '<small class="stl-note">Стена прохода срезана вместе со шкафами на ней — их место на чертеже.</small>' : ''}</figure>
        ${gl ? `<figure class="v3d"><figcaption><b>Вид снаружи</b><label class="stl-chk"><input type="checkbox" data-stl="out" data-i="${i}"${o.out ? ' checked' : ''}> в КП — в изображениях позиции</label></figcaption>
          <img src="${esc(r3o ? r3o.src : this.BLANK)}"${r3o ? '' : ' class="wait"'} data-st3do="${esc(plan.hash||'')}" alt="Станция снаружи: двери, логотип, светильники"></figure>` : ''}
        <figure class="dr"><figcaption><b>Габаритный чертёж</b><label class="stl-chk"><input type="checkbox" data-stl="draw" data-i="${i}"${o.draw ? ' checked' : ''}> в КП — после характеристик</label></figcaption>
          <img src="${esc(this.url(StationDrawing.svg(plan, meta)))}" alt="Габаритный чертёж станции"></figure>
        ${sch ? `<figure class="dr"><figcaption><b>${esc(sch.title)}</b><label class="stl-chk"><input type="checkbox" data-stl="scheme" data-i="${i}"${o.scheme ? ' checked' : ''}> в КП — после чертежа</label></figcaption>
          <img src="${esc(this.url(sch.cls.svg(plan, meta)))}" alt="${esc(sch.name)}"></figure>` : ''}</div>` : ''}
      ${this.how()}</div>`;
  }
  static BLANK = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';   // пока вид рисуется
  static rank(t){ return { error:0, warn:1, info:2 }[t.level] ?? 3; }
  /** системы контейнера по расчёту: электропитание (мощность, ток, вводной автомат), освещение, розетки, пожарная
   *  безопасность, отопление — коротко; подробно — в ТЗ на сборку */
  static systems(plan){
    const W=plan.power, Lt=plan.light, K=plan.sockets, F=plan.fire, h=plan.heat; if (!W) return '';
    const f=StationPower.f, pl=StationFire.pl, row=(k, v)=>v ? `<li><b>${esc(k)}:</b> ${esc(v)}</li>` : '';
    const own=W.dgu ? 'собственные нужды' : 'расчётная';
    return `<div class="stl-air stl-sys"><div class="stl-air-h"><b>Системы контейнера и электропитание</b><span class="muted">по расчёту — подробно в ТЗ на сборку</span></div><ul class="stl-sys-l">
      ${row('Мощность', `установленная (с системами контейнера) ${f(W.inst)} кВт, ${own} — ${f(W.kw)} кВт (${W.mode==='run' ? 'при работе' : 'зимой в простое'}); ток ${f(W.amp)} А при 3 × 400 В; вводной автомат — ${W.breaker ? W.breaker+' А' : 'по проекту'}`)}
      ${Lt && Lt.on ? row('Освещение', `${pl(Lt.n, ['светильник', 'светильника', 'светильников'])} по ${StationLight.LAMP.w} Вт — около ${Math.round(Lt.E)} лк (норма ${Lt.lux}); аварийное — ${Lt.em} с блоком питания на 1 ч${Lt.floods ? `; прожекторов над дверями — ${Lt.floods}` : ''}`) : ''}
      ${K ? row('Розетки', `230 В — ${K.n230}, 380 В — ${K.n380}, ЯТП-0,25 (36 В) — ${K.ytp}; на высоте 1 м`) : ''}
      ${F ? row('Пожарная безопасность', `огнетушители ${StationFire.EXT} — ${F.ext}${F.auto ? `; модули «Буран-2,5» на потолке — ${F.mods} (по площади и объёму)` : ''}${F.ops ? '; щит ОПС у входа' : ''}${F.cat && F.cat!=='Д' ? `; категория ${F.cat}${F.zone ? ', зона '+F.zone : ''} — табличка на двери` : ''}`) : ''}
      ${h && h.on && h.n ? row('Отопление', `${h.n} × ${StationHeat.kw(h.kw)} кВт = ${StationHeat.kw(h.total)} кВт`) : ''}
      ${plan.pipe ? row('Трубопровод', `${plan.pipe.lines.map(l=>`${l.name} — DN ${l.dn}`).join(', ')} по расчёту (${plan.pipe.why}, не более ${StationFire.f1(plan.pipe.lines[0].v)} м/с)${plan.pipe.small ? ` — в составе DN ${plan.pipe.set}, мало` : ''}`) : ''}</ul></div>`;
  }
  /** подготовка воздуха: цепочка по ходу воздуха, класс чистоты (ISO 8573-1), чего не хватает — подобрать в каталоге */
  static air(plan, x, i){
    const a=plan.air; if (!a) return '';
    const o=this.opts(x), m3=v=>AirChain.m3(v);
    const chain=a.chain.map(c=>`<span class="stl-node${c.guess ? ' guess' : ''}"${c.guess ? ' title="Ступень фильтра не указана — место выбрано по виду осушителя"' : ''}>${esc(c.text)} <small>поз. ${c.pos}</small></span>`).join('<span class="stl-arr">→</span>');
    const cls=`<label class="f stl-cls"><span>Класс чистоты воздуха по ISO 8573-1 (частицы.вода.масло)</span><select data-stl="air" data-i="${i}"><option value="">не задан — проверка по составу</option>${AirChain.options(o.air).map(([v, t])=>`<option value="${esc(v)}"${o.air===v ? ' selected' : ''}>${esc(t)}</option>`).join('')}</select></label>`;
    const recs=a.recs.map((r, k)=>`<li><span><b>${esc(r.title)}</b> — ${esc(r.why)}</span><button class="btn sm" type="button" data-a="stlRec" data-i="${i}" data-k="${k}">${r.replace ? 'Заменить — подобрать в каталоге' : 'Подобрать в каталоге'}</button></li>`).join('');
    return `<div class="stl-air"><div class="stl-air-h"><b>Подготовка воздуха</b>${a.q ? `<span class="muted">компрессоры — ${m3(a.q)} м³/мин при ${m3(a.bar)} бар</span>` : ''}</div>
      <div class="stl-chain">${chain}<span class="stl-arr">→</span><span class="stl-node">потребителю</span></div>
      ${a.chain.some(c=>c.guess) ? '<p class="muted stl-hint">Пунктиром — фильтр, у которого не указана ступень очистки: место выбрано по виду осушителя. Укажите «Ступень очистки» в характеристиках фильтра (предварительная, тонкая, сверхтонкая, угольный).</p>' : ''}
      ${cls}${recs ? `<p class="stl-rec-h">Не хватает в составе:</p><ul class="stl-recs">${recs}</ul>` : ''}</div>`;
  }
  /** подпись размера блок-контейнера: подобран или задан вручную (вернуть подбор) */
  static sizeNote(c, i){
    if (!c || !StationGeo.FLEX[c.ctype]) return '';
    if (c.sizeAuto && String(c.size||'').trim()) return ' · размер подобран по оборудованию';
    return String(c.size||'').trim() ? ` · размер задан вручную — <button type="button" class="lnk" data-a="stlAuto" data-i="${i}">подобрать по оборудованию</button>` : '';
  }
  static fix(sg, i){
    const n=StationLayout.n, t=ctypeOf(sg.ctype).name+(sg.size ? ` ${n(sg.size[0])} × ${n(sg.size[1])} × ${n(sg.size[2])} мм` : '');
    const lead=sg.smaller ? 'Достаточно' : sg.aisle ? 'С проходом внутри' : 'Поместится';
    return `<button class="btn ${sg.aisle ? 'ghost' : 'primary'}" type="button" data-a="stlFix" data-i="${i}" data-ct="${esc(sg.ctype)}"${sg.size ? ` data-size="${esc(sg.size.join(' × '))}"` : ''}>${lead}: ${esc(t)} — заменить</button>`;
  }
  /** как расставляется и какие отступы (с источниками) */
  static how(){
    const [aRec, aMin]=StationClear.aisle(), n=StationLayout.n;
    return `<details class="stl-how"><summary>Как расставляется оборудование и какие отступы</summary>
      <p>Оборудование стоит вдоль задней стены лицевой стороной к проходу обслуживания (проход — вдоль стены с дверью); если не хватает длины, а ширина позволяет, — в два ряда с проходом посередине. Порядок — как в составе станции (стрелки ↑↓ на вкладке «Состав станции»), у компрессорной — по ходу воздуха; ДГУ — в дальнем торце радиатором к жалюзи. Габариты, масса и цвет — из характеристик элементов (цвет контейнера — поле «Цвет» в составе).</p>
      <p>Сжатый воздух — последовательно, по ходу: компрессоры → коллектор → «мокрый» ресивер → фильтры до осушителя → осушитель → фильтры после → угольный → «сухой» ресивер → потребителю. У осушителя, ресивера и фильтра — один вход и один выход: магистраль проходит через них, у ресивера вход внизу, выход вверху. Фильтры — по ступени очистки (поле «Ступень очистки» или название): предварительный и тонкий — перед осушителем, сверхтонкий от масла — после рефрижераторного; перед адсорбционным — всегда фильтр очистки от масла, после него — пылевой; угольный — последним. Фильтр без указанной ступени ставится по виду осушителя. Встроенные фильтры осушителя и встроенный осушитель компрессора учитываются. Фильтры висят на трубопроводе у осушителя — там, где к ним подойти из прохода (колба и элемент снимаются вниз).</p>
      <p>Подбор: осушитель и фильтры — не меньше суммы производительности компрессоров с поправкой на давление (номинал — при 7 бар, +35 °C на входе, +25 °C вокруг, ISO 7183), осушитель — с запасом 15 % на лето; ресивер — около 125 л на 1 м³/мин компрессора с регулированием «нагрузка — холостой ход» (с частотным — меньше). Класс чистоты по ISO 8573-1 (частицы.вода.масло) — какой нужен осушитель (вода 1–3 — адсорбционный, 4–6 — рефрижераторный) и какие ступени фильтров. Чего не хватает — кнопка «Подобрать в каталоге»: каталог открывается с нужным видом, ступенью и производительностью.</p>
      <p>Шкафы — на стене и не мешают проходу оператора: перед шкафом — не меньше прохода обслуживания (ПУЭ, п. 4.1.23: у щитов не менее 0,8 м в свету; сужение до 0,6 м допускается только строительными конструкциями). Сначала — на стене прохода у двери напротив промежутка между оборудованием, затем — на торце у двери или на дальнем торце, затем — на стене прохода с проходом «не менее»; низ — от 300 мм, верх — до 1,9 м. Напольный шкаф (выбрано в составе, назван так или большой по габаритам) — в ряду у двери. Входная дверь оператора — 900 мм, не уже 600 мм в свету, открывается наружу.</p>
      <p>Отступы — сначала «не менее» (помещается ли), затем свободное место раздаётся до рекомендуемых:</p>
      <ul><li>проход обслуживания — рекомендуется ${n(aRec)} мм (руководства производителей компрессоров: не менее 1 м), не менее ${n(aMin)} мм (ПУЭ, п. 4.1.23); вдоль ДГУ — не менее 600 мм (там же: сужение прохода до 0,6 м);</li>
        <li>между оборудованием — 700 мм (СП 30.13330.2020, п. 13.22: между выступающими частями 0,7 м), не менее 300 мм; насосы — 1000 мм (СП 31.13330.2021, п. 10.15), малые (до 22 кВт) — 700 мм, у стены и парой на общей раме — от 250 мм;</li>
        <li>компрессор: сзади 600 / не менее 300 мм; над ним в помещении — 1 м до потолка, в контейнере горячий воздух отводится воздуховодом (не менее 300 мм);</li>
        <li>осушитель: около 500 мм вокруг (руководства производителей), ресивер — 300 мм от стен (доступ к крану слива и люку), ДГУ: со стороны генератора 1000 / 800 мм, радиатор к жалюзи — 300 мм.</li></ul>
      <p>Прохода внутри не получается — оборудование обслуживается снаружи через сервисные двери с любой стороны: один ряд лицом к стене с дверями или, если так короче, два ряда спиной друг к другу с дверями в обеих стенах (между рядами — трубопровод); ДГУ посередине — двери с обеих сторон. До двери ${n(StationLayout.DOOR_GAP[1])}–${n(StationLayout.DOOR_GAP[0])} мм, проём напротив каждого агрегата (между соседними — стойка), створки до 1,2 м открываются наружу, у дверей на площадке — свободная зона не менее 1,5 м; шкаф — на раме за своей дверью.</p>
      <p>ДГУ: дополнительный топливный бак — рядом с ДГУ; глушитель — на крыше прямо над ДГУ, на опорах, выхлопная труба от двигателя — вертикально в глушитель, вывод выхлопа вверх (высота с глушителем — на чертеже; при перевозке глушитель снимают: с платформой — не выше 4 м). Трубопровод — вдоль задней стены с отводами к оборудованию и выходом через дальний торец; материал (сталь, нержавеющая сталь, полипропилен) — в «Составе станции», цвет трассы на чертеже и 3D-виде — по материалу.</p>
      <p>3D-вид рисуется по расстановке: перспектива, мягкие тени, окраска по RAL, оцинковка, нержавеющая сталь, полипропилен. Стена со стороны зрителя срезана (шкафы на ней — на чертеже); если в ней сервисные двери — стена стоит, створки открыты. Без WebGL2 (старая видеокарта, удалённый рабочий стол) — упрощённый вид.</p>
      <p>Блок-контейнер без своего размера — по необходимому месту, без запаса: длина, ширина и высота с шагом 100 мм, наименьшая площадь пола (сначала все отступы рекомендуемые; не выходит в ширину, которую везут без спецразрешения, — проход и отступ от стены «не менее»; затем без прохода — с сервисными дверями; затем шире 2 550 мм). Морской контейнер, в который всё не помещается, — ошибка (КП не сохраняется) и подсказка, какой подойдёт; с большим запасом — подсказка, какой меньший (в том числе 10 футов) подойдёт так же. Проход обслуживания администратор меняет в «Настройки → Умолчания → Станции в контейнере».</p>
      <p>Чертёж — лист А4 по ЕСКД: рамка и основная надпись (ГОСТ Р 2.104), литера «П» — техническое предложение, масштаб из ряда ГОСТ 2.302, линии — ГОСТ 2.303, шрифт типа Б — ГОСТ 2.304, разрезы А–А и Б–Б и вид слева — ГОСТ 2.305, размеры габаритные, установочные и присоединительные — ГОСТ 2.307 и ГОСТ Р 2.109; оборудование — узнаваемые упрощённые рисунки, схематически сходные с изделием (компрессор с пультом, жалюзи и рамой, ресивер с люком, клапаном и манометром, осушитель с вентилятором, адсорбционный — с двумя колоннами, фильтр с индикатором и стаканом, шкаф с дверью и панелью, ДГУ, насос, бак); перечень составных частей, техническая характеристика и технические требования — ГОСТ 2.316. Схема пневматическая принципиальная (компрессорная) — ГОСТ 2.701 и 2.704, обозначения — ГОСТ 2.780, 2.781, 2.782, 2.785 и ISO 1219-1; позиции — те же, что в составе станции и на чертеже. Обозначение документа (например, «ПНЕВ.012345.001 ГЧ») — по организации из шаблона КП и отпечатку расстановки: тот же состав — то же обозначение.</p></details>`;
  }
  /** метка на позиции в разделе «Оборудование» */
  static chip(x, i){
    if (!this.on(x) || !kitContainer(x)) return '';
    const p=this.plan(x); if (p.level==='none') return '';
    const [cls, t]=p.level==='error' ? ['bad', p.assumed ? '✕ Компоновка: проверьте габариты' : '✕ Не помещается в контейнер'] : p.level==='warn' ? ['warn', '⚠ Компоновка'] : ['on', '✓ Компоновка'];
    return `<button type="button" class="chip sm stl-chip ${cls}" data-a="edit" data-i="${i}" data-tab="layout" title="Расстановка оборудования в контейнере, габаритный чертёж и 3D-вид">${t}</button>`;
  }

  // ---- действия
  static act(a, i, b){
    const it=S.items[i], c=it && kitContainer(it); if (!c) return false;
    if (a==='stlFix'){
      contApply(c, { ctype:b.dataset.ct, size:b.dataset.size||'', sizeAuto:!!StationGeo.FLEX[b.dataset.ct] });
      stationFill(it); stationAutoName(it); StationSize.apply(it);
      toast('Контейнер заменён: '+ctypeOf(c.ctype).name+'. Проверьте закупку контейнера в составе станции.');
      return true;
    }
    if (a==='stlAuto'){ c.sizeAuto=true; StationSize.apply(it, true); return true; }
    if (a==='stlRec'){ const r=((this.plan(it).air||{}).recs||[])[+b.dataset.k]; if (r) kitPickCat(i, [r.cat], null, r.name, { f:r.f, r:r.r, rows:r.rows, attrs:r.attrs, qty:r.qty, replace:r.replace }); return false; }
    return false;
  }
  /** галочки «главное фото» и «в КП» */
  static async check(t){
    const it=S.items[+t.dataset.i]; if (!it) return;
    it.stLayout={ ...this.opts(it), [t.dataset.stl]:t.type==='checkbox' ? t.checked : t.value };
    if (t.dataset.stl==='air'){ persist(); renderEditor(); renderForm(); return; }
    if (t.dataset.stl==='photo' && t.checked && it.photo && it.photo.gen!=='st3d'){
      const part=StationImages.partPhoto(it);   // фото элемента состава — и так стоит в КП у его описания
      if (!confirm(part ? 'Заменить главное фото станции 3D-видом? Фото элемента останется у его описания.' : 'Заменить главное фото станции 3D-видом? Прежнее фото останется в изображениях позиции.')){ it.stLayout.photo=false; t.checked=false; return; }
      if (!part){ it.gallery=it.gallery||[]; it.gallery.push({ id:uid(), src:it.photo.src, w:it.photo.w, h:it.photo.h, caption:'', slot:'', wide:'', at:'', on:true, ...(it.photoSource ? { source:it.photoSource } : {}) }); }
      it.photo=null; delete it.photoSource; }
    await StationImages.sync(it); persist(); renderEditor(); renderForm();
  }
}

// ---------------------------------------------------------------- размер блок-контейнера по оборудованию
class StationSize {
  static last = new Map();
  /** блок-контейнер «по проекту» без своего размера — наименьший размер из ряда, при котором всё помещается.
   *  Возвращает true, если размер изменился. Размер, вписанный менеджером, не трогается. */
  static apply(x, force){
    if (!StationUi.on(x)) return false;
    const c=kitContainer(x); if (!c || !StationGeo.FLEX[c.ctype]) return false;
    if (String(c.size||'').trim() && !c.sizeAuto) return false;
    const inp={ cont:{ ...StationUi.input(x).cont, size:'', sizeAuto:true }, parts:kitParts(x) }, h=StationLayout.hash(inp), L=this.last.get(x.id);
    if (!force && L && L.h===h && L.size===String(c.size||'')) return false;
    const plan=StationLayout.solve(inp), txt=plan.level!=='error' && plan.level!=='none' && plan.geo && plan.geo.ext ? plan.geo.ext.join(' × ') : '';
    this.last.set(x.id, { h, size:txt });
    if (txt===String(c.size||'') && c.sizeAuto) return false;
    contApply(c, { size:txt, sizeAuto:true }); stationFill(x);
    return true;
  }
}

// ---------------------------------------------------------------- картинки для КП
class StationImages {
  static busy = new Set();
  static timer = 0;

  /** 3D-вид (главное фото), габаритный чертёж и схема пневматическая (изображения после характеристик) — по расстановке.
   *  Своё фото менеджера не заменяется; фото элемента состава, подставленное мастером само, — заменяется (у элемента оно
   *  остаётся); убранный из изображений чертёж или схема — выключает «в КП». true — что-то изменилось. */
  static async sync(x){
    if (!StationUi.on(x) || !isKit(x) || this.busy.has(x.id)) return false;
    StationSize.apply(x);
    const plan=StationUi.plan(x), o=StationUi.opts(x); let ch=false;
    x.gallery=Array.isArray(x.gallery) ? x.gallery : [];
    const none=plan.level==='none' || plan.level==='error' || !plan.geo || !plan.geo.ext;   // нечего рисовать — прежние картинки не годятся
    if ((!o.photo || none) && x.photo && x.photo.gen==='st3d'){ x.photo=null; ch=true; }
    const sch=StationUi.scheme(plan), off={ stout:!o.out || none, stdraw:!o.draw || none, stschema:!o.scheme || none || !sch };
    for (const gen of Object.keys(off)){ const k=x.gallery.findIndex(g=>g && g.gen===gen); if (off[gen] && k>=0){ x.gallery.splice(k, 1); ch=true; } }
    if (none) return ch;
    this.busy.add(x.id);
    try{
      await EskdFont.load();   // шрифт чертежей — встраивается в листы
      if (typeof DrawPic!=='undefined') await DrawPic.load(x);   // свои рисунки моделей — тоже внутрь листа
      if (await PhotoTint.load(x)){ this.busy.delete(x.id); return (await this.sync(x)) || ch; }   // цвета по фото изменили расстановку — заново
      const meta=StationUi.meta(x, plan), h=plan.hash, hd=this.key(plan, meta);   // на 3D-виде надписей нет; на чертеже — название
      if (o.photo && x.photo && x.photo.gen!=='st3d' && this.partPhoto(x)){ x.photo=null; ch=true; }
      // 3D-вид WebGL (отпечаток с «.g») не заменяется SVG-видом на компьютере без WebGL2
      const fresh=x.photo && x.photo.gen==='st3d' && (x.photo.hash===h+'.g' || (x.photo.hash===h && !StationRender.ok()));
      if (o.photo && (!x.photo || x.photo.gen==='st3d') && !fresh){
        const gl=await StationRender.image(plan, meta), im=gl || await this.raster(StationView3D.svg(plan, meta), 'image/jpeg');
        x.photo={ ...im, gen:'st3d', hash:gl ? h+'.g' : h }; ch=true; }
      // вид снаружи (только WebGL): изображением после характеристик, перед чертежом; без WebGL прежний остаётся
      const jo=x.gallery.findIndex(g=>g && g.gen==='stout');
      if (o.out && StationRender.ok() && (jo<0 || x.gallery[jo].hash!==h+'.o')){
        const im=await StationRender.image(plan, meta, 'out');
        if (im){ const old=jo>=0 ? x.gallery[jo] : null, g={ id:old ? old.id : uid(), ...im, caption:'Вид снаружи', slot:'', at:'', on:old ? old.on!==false : true, wide:'full', gen:'stout', hash:h+'.o' };
          if (old) x.gallery[jo]=g; else { const d=x.gallery.findIndex(q=>q && (q.gen==='stdraw' || q.gen==='stschema')); x.gallery.splice(d>=0 ? d : x.gallery.length, 0, g); }
          x.page=true; ch=true; } }
      // листы ЕСКД: габаритный чертёж и схема (пневматическая — компрессорная, гидравлическая — насосная) — изображениями после
      // характеристик, по порядку
      for (const [gen, on, svg, caption] of [['stdraw', o.draw, ()=>StationDrawing.svg(plan, meta), 'Габаритный чертёж'],
        ['stschema', !off.stschema, ()=>sch.cls.svg(plan, meta), sch ? sch.name : '']]){
        const j=x.gallery.findIndex(g=>g && g.gen===gen); if (!on || (j>=0 && x.gallery[j].hash===hd)) continue;
        const im=await this.raster(svg(), 'image/png'), old=j>=0 ? x.gallery[j] : null;
        const g={ id:old ? old.id : uid(), ...im, caption, slot:'', at:'', on:old ? old.on!==false : true, wide:'full', gen, hash:hd };
        if (old) x.gallery[j]=g; else if (gen==='stschema'){ const d=x.gallery.findIndex(q=>q && q.gen==='stdraw'); x.gallery.splice(d>=0 ? d+1 : x.gallery.length, 0, g); } else x.gallery.push(g);
        x.page=true; ch=true; }
    } catch(e){ /* картинка не собралась — КП собирается без неё */ }
    finally{ this.busy.delete(x.id); }
    return ch;
  }
  static async syncAll(){ let ch=false; for (const x of S.items) if (await this.sync(x)) ch=true; if (ch) persist(); return ch; }
  /** после правок — через полсекунды, без лишних перерисовок; окно позиции — только на вкладке «Компоновка»
   *  (на других вкладках поля ввода: перерисовка под рукой сбила бы набираемое) */
  static soon(x){
    clearTimeout(this.timer);
    this.timer=setTimeout(async ()=>{
      if (!(await this.sync(x))) return;
      persist(); renderForm();
      if (EDIT && EDIT.tab==='layout' && S.items[EDIT.i]===x) renderEditor();
    }, 500);
  }
  /** SVG → картинка (3D-вид — JPEG, чертёж — PNG: чёткие линии) */
  static async raster(svg, type){
    const im=await readImg(StationUi.url(svg)), w=im.naturalWidth||im.width, h=im.naturalHeight||im.height;
    const c=document.createElement('canvas'); c.width=w; c.height=h;
    const g=c.getContext('2d'); g.fillStyle='#ffffff'; g.fillRect(0, 0, w, h); g.drawImage(im, 0, 0, w, h);
    return { src:c.toDataURL(type, 0.9), w, h };
  }
  /** отпечаток листов: расстановка и надписи на них (название станции, контейнер, цвет, основная надпись) */
  static key(plan, meta){ return plan.hash+'.'+StationLayout.fnv(JSON.stringify([meta.title, meta.cont, meta.colorText, meta.org, meta.dev, meta.date, plan.air ? plan.air.cls : '', EskdSheet.FONT_DATA ? 'osi' : ''])); }
  /** менеджер убрал сгенерированную картинку сам — больше её не вставлять */
  static forget(x, what){ if (!x) return; x.stLayout={ ...StationUi.opts(x), [what]:false }; }
  /** главное фото станции — копия фото элемента состава */
  static partPhoto(x){ const s=x && x.photo && x.photo.src; return !!s && kitParts(x).some(p=>p.photo && p.photo.src===s); }
  /** менеджер сам выбрал главное фото (фото элемента, изображение позиции): 3D-вид больше не подставлять,
   *  сам 3D-вид в изображения не переносится (вернуть — галочкой на вкладке «Компоновка»). true — главным был 3D-вид */
  static chosen(x){
    if (!x || !stationOf(x)) return false;
    const was=!!(x.photo && x.photo.gen==='st3d'); if (was) x.photo=null;
    this.forget(x, 'photo'); return was;
  }
}

document.addEventListener('change', e=>{ const t=e.target; if (t && t.dataset && t.dataset.stl) StationUi.check(t); });
