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
    return { cont:c ? { ctype:c.ctype, size:c.size, sizeAuto:!!c.sizeAuto, lenFix:c.lenFix||null, ins:c.ins, ral:c.ral, sys:c.sys||null, climate:c.climate||'', roof:c.roof||'', floor:StationGeo.floor(c) } : null, parts:kitParts(x), air:this.opts(x).air,
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
  /** что вставлять в КП: 3D-вид главным фото, чертёж — в изображения (по умолчанию да, кроме листов skip, убранных
   *  менеджером); схема — только если включили */
  static opts(x){ const o=x.stLayout||{}; return { photo:o.photo!==false, out:o.out!==false, draw:o.draw!==false, scheme:o.scheme===true, calc:o.calc!==false, air:/^[1-6]\.[1-6]\.[1-4]$/.test(String(o.air||'')) ? o.air : '',
    skip:Array.isArray(o.skip) ? o.skip.filter(v=>Number.isInteger(v) && v>0 && v<10) : [],
    outSkip:Array.isArray(o.outSkip) ? o.outSkip.filter(v=>StationImages.VIEWS.some(w=>w[0]===v)) : [] }; }
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
      : big ? ['warn', '⚠ Помещается с запасом — достаточно контейнера меньше']
      : plan.mode && (plan.mode.cross || plan.mode.tight) ? ['warn', `⚠ Помещается в габарит перевозки — исключение: ${[plan.mode.tight ? 'проход оператора сужен' : '', plan.mode.cross && plan.cross ? 'без сквозного прохода, две двери оператора' : ''].filter(Boolean).join(', ')} (согласуйте с заказчиком)`]
      : plan.mode && plan.mode.ends && plan.ends ? [plan.level==='ok' ? 'ok' : 'warn', `${plan.level==='ok' ? '✓' : '⚠'} Без продольного прохода: ${plan.ends.n>1 ? 'компрессоры в ряд от торца' : 'компрессор у торца'}, сервисные ворота с обеих сторон, ворота в торцах${plan.level==='ok' ? '' : ' — см. замечания'}`]
      : airOnly ? ['warn', '⚠ Помещается — есть замечания по подготовке воздуха']
      : plan.level==='warn' ? ['warn', '⚠ Помещается, но часть отступов меньше рекомендуемых'] : ['ok', '✓ Оборудование помещается с рекомендуемыми отступами'];
    const dims=g.ext ? `${esc(ct.name)} · ${n(g.ext[0])} × ${n(g.ext[1])} × ${n(g.ext[2])} мм${plan.int ? ` · внутри ${n(plan.int[0])} × ${n(plan.int[1])} × ${n(plan.int[2])} мм` : ''}` : esc(ct.name);
    const iss=[...plan.issues].sort((a, b)=>this.rank(a)-this.rank(b)), top=iss.filter(t=>t.level!=='info'), info=iss.filter(t=>t.level==='info');
    if (StationImages.issues.has(x.id)) top.unshift({ level:'warn', text:'Изображения не готовы: '+StationImages.issues.get(x.id)+'.' });
    if (plan.level==='error' && plan.assumed) info.unshift({ level:'info', text:'Пока габариты части оборудования условные, КП сохранится, но контейнер может не подойти: впишите «Габариты» элементов на вкладке «Состав станции».' });
    else if (plan.level==='error') info.unshift({ level:'info', text:'КП не сохранится, пока оборудование не поместится: замените контейнер (кнопка выше) или измените состав.' });
    // замечания и сведения — под раскрывающимся блоком (раскрыт сам, если оборудование не помещается)
    let xf=null; const fix=t=>{ if (t.level==='info' || typeof ExpertFix==='undefined') return ''; xf=xf || ExpertFix.list(x); return ExpertFix.btn(x, i, t.text, xf); };   // «решить» — режим «эксперт»
    const li=t=>{ const j=plan.issues.indexOf(t), sp=j>=0 && IssueSpot.has(t.text, plan);
      return `<li class="${t.level}">${esc(t.text)}${sp ? ` <button class="lnk is-spot" type="button" data-a="stSpot" data-i="${i}" data-j="${j}" title="Открыть чертёж с подсветкой">на чертеже</button>` : ''}${fix(t)}</li>`; };
    const pics=plan.level!=='error' && g.ext, meta=this.meta(x, plan), photoOn=x.photo ? x.photo.gen==='st3d' : o.photo;
    if (pics && !EskdSheet.FONT_DATA) EskdFont.load().then(ok=>{ if (ok) renderEditor(); });   // чертёж — встроенным шрифтом, как в КП
    if (pics && typeof DrawPic!=='undefined' && DrawPic.pending(x)) DrawPic.load(x).then(ch=>{ if (ch) renderEditor(); });   // свои рисунки моделей
    if (pics && PhotoTint.pending(x)) PhotoTint.load(x).then(ch=>{ if (ch) renderEditor(); });   // цвет оборудования — по его фото
    StationImages.soon(x);
    // 3D-вид: готовый (WebGL) — сразу; пока рисуется — прежний SVG-вид, затем картинка подменяется; снаружи — только WebGL
    const r3=pics ? StationRender.cached(plan) : null, src3=pics ? (r3 ? r3.src : this.url(StationView3D.svg(plan, meta))) : '';
    if (pics && !r3) StationRender.image(plan, meta).then(im=>{ if (im) for (const el of document.querySelectorAll('img[data-st3d]')) if (el.dataset.st3d===plan.hash) el.src=im.src; });
    // виды снаружи — со всех четырёх сторон (WebGL); пока рисуются — пустые рамки
    const gl=pics && StationRender.ok(), outs=gl ? StationImages.VIEWS.map(([v, az, cap])=>({ v, az, cap, r:StationRender.cached(plan, 'out', az) })) : [];
    for (const q of outs) if (!q.r) StationRender.image(plan, meta, 'out', q.az).then(im=>{ if (im) for (const el of document.querySelectorAll('img[data-st3do]')) if (el.dataset.st3do===plan.hash && el.dataset.az===String(q.az)){ el.src=im.src; el.classList.remove('wait'); } });
    const cutCab=plan.items.some(t=>t.mount==='wall' && t.wall==='front');   // стена прохода срезана
    const sch=this.scheme(plan);
    return `<div class="ed-sec stl">
      <div class="stl-st ${head[0]}"><b>${head[1]}</b><span>${dims}${this.sizeNote(c, i)}</span>${plan.suggest ? this.fix(plan.suggest, i) : ''}</div>
      ${pics ? `<div class="stl-views">
        <figure class="v3d"><figcaption><b>Разрез (3D-вид)</b><label class="stl-chk"><input type="checkbox" data-stl="photo" data-i="${i}"${photoOn ? ' checked' : ''}> главное фото станции — в строке КП и на титуле</label></figcaption>
          <img src="${esc(src3)}" data-st3d="${esc(plan.hash||'')}" alt="3D-вид станции">${cutCab ? '<small class="stl-note">Стена прохода срезана вместе со шкафами на ней — их место на чертеже.</small>' : ''}</figure>
        ${gl ? `<figure class="v3d stl-out"><figcaption><b>Вид снаружи — 4 стороны</b><label class="stl-chk"><input type="checkbox" data-stl="out" data-i="${i}"${o.out ? ' checked' : ''}> в КП — в изображениях позиции</label></figcaption>
          <div class="stl-out4">${outs.map(q=>`<div><img src="${esc(q.r ? q.r.src : this.BLANK)}"${q.r ? '' : ' class="wait"'} data-st3do="${esc(plan.hash||'')}" data-az="${q.az}" alt="${esc(q.cap)}"><small>${esc(q.cap)}</small></div>`).join('')}</div></figure>` : ''}
        ${this.sheets(plan, meta, i, o)}
        ${sch ? `<figure class="dr"><figcaption><b>${esc(sch.title)}</b><label class="stl-chk"><input type="checkbox" data-stl="scheme" data-i="${i}"${o.scheme ? ' checked' : ''}> в КП — после чертежа</label></figcaption>
          <img src="${esc(this.url(sch.cls.svg(plan, meta)))}" alt="${esc(sch.name)}"></figure>` : ''}</div>` : ''}
      ${top.length || info.length ? `<details class="stl-air stl-sp"${Spoiler.attr('iss:'+x.id, plan.level==='error')}><summary class="stl-air-h"><b>Замечания по компоновке</b>${top.length ? `<span class="warn-t">⚠ ${top.length}</span>` : '<span class="ok-t">✓ нет</span>'}${info.length ? `<span class="muted">сведений: ${info.length}</span>` : ''}</summary>
        <ul class="stl-iss">${[...top, ...info].map(li).join('')}</ul></details>` : ''}
      ${this.access(plan, x)}
      ${this.air(plan, x, i)}
      ${this.systems(plan, x)}
      ${typeof StationCalc!=='undefined' ? StationCalc.html(x, i) : ''}
      ${this.how()}</div>`;
  }
  /** матрица доступа: к каждой стороне агрегата — чем подойти (проход, зазор, ворота), класс по ширине */
  static access(plan, x){
    const A=plan.access||[]; if (!A.length) return '';
    const bad=A.filter(q=>q.miss.length).length, S=['F', 'B', 'L', 'R'];
    const td=c=>`<td class="${c.ok ? (c.t==='не требуется' ? 'muted' : '') : 'warn-t'}">${c.ok ? '' : '⚠ '}${esc(c.t)}</td>`;
    return `<details class="stl-air stl-sp"${Spoiler.attr('acc:'+x.id, bad>0)}><summary class="stl-air-h"><b>Доступ к оборудованию</b>${bad ? `<span class="warn-t">⚠ ${bad}</span>` : '<span class="ok-t">✓ ко всем сторонам</span>'}</summary>
      <div class="tzi-tw"><table class="tzi-t stl-acc"><thead><tr><th>Поз.</th><th>Оборудование</th>${S.map(k=>`<th>${StationLayout.SIDE[k][0]}</th>`).join('')}<th>Класс</th></tr></thead><tbody>
      ${A.map(q=>`<tr><td>${esc(q.pos)}</td><td>${esc(q.name||'')}</td>${S.map(k=>td(q.s[k])).join('')}<td>${esc(q.cls)}</td></tr>`).join('')}</tbody></table></div>
      <p class="muted" style="margin:6px 0 0">Какие стороны обслуживаются у вида оборудования, сколько нужно места и когда ставятся ворота — «Настройки → Инженерные правила станций → Матрица расстановки». Класс: узкое — помещается с основным проходом; широкое — с проходом «в крайнем случае» и сервисными воротами; сверхширокое — только поперёк или шире габарита перевозки.</p></details>`;
  }
  static BLANK = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';   // пока вид рисуется
  /** габаритный чертёж — все листы в полный размер, один под другим (решение ПНЕВМОТЕХ 13.10: для удобства чтения); лист с
   *  изображением, повёрнутым на 90°, на экране — повёрнут обратно (читается без поворота головы) */
  static sheets(plan, meta, i, o){
    const L=StationDrawing.sheets(plan, meta), n=L.length;
    return `<figure class="dr${n>1 ? ' dr-all' : ''}"><figcaption><b>Габаритный чертёж${n>1 ? ` — ${n} ${n<5 ? 'листа' : 'листов'}` : ''}</b><label class="stl-chk"><input type="checkbox" data-stl="draw" data-i="${i}"${o.draw ? ' checked' : ''}> в КП — после характеристик${n>1 ? ', все листы' : ''}</label></figcaption>
          <div class="stl-sheets">${L.map((svg, k)=>{ const im=`<img src="${esc(this.url(svg))}" alt="Габаритный чертёж станции, лист ${k+1}">`;
            return svg.includes(' rotate(90)">') ? `<div class="stl-rot">${im}</div>` : im; }).join('')}</div></figure>`;
  }
  static rank(t){ return { error:0, warn:1, info:2 }[t.level] ?? 3; }
  /** системы контейнера по расчёту: электропитание (мощность, ток, вводной автомат), освещение, розетки, пожарная
   *  безопасность, отопление — коротко; подробно — в ТЗ на сборку */
  static systems(plan, x){
    const W=plan.power, Lt=plan.light, K=plan.sockets, F=plan.fire, h=plan.heat; if (!W) return '';
    const f=StationPower.f, pl=StationFire.pl, row=(k, v)=>v ? `<li><b>${esc(k)}:</b> ${esc(v)}</li>` : '';
    const own=W.dgu ? 'собственные нужды' : 'расчётная';
    return `<details class="stl-air stl-sys stl-sp"${Spoiler.attr('sys:'+(x ? x.id : ''))}><summary class="stl-air-h"><b>Системы контейнера и электропитание</b><span class="muted">${f(W.inst)} кВт, ввод ${W.breaker ? W.breaker+' А' : 'по проекту'} — подробно в ТЗ на сборку</span></summary><ul class="stl-sys-l">
      ${row('Мощность', `установленная (с системами контейнера) ${f(W.inst)} кВт, ${own} — ${f(W.kw)} кВт (${W.mode==='run' ? 'при работе' : 'зимой в простое'}); ток ${f(W.amp)} А при 3 × 400 В; вводной автомат — ${W.breaker ? W.breaker+' А' : 'по проекту'}`)}
      ${Lt && Lt.on ? row('Освещение', `${pl(Lt.n, ['светильник', 'светильника', 'светильников'])} по ${StationLight.LAMP.w} Вт — около ${Math.round(Lt.E)} лк на 0,8 м (норма ${Lt.lux}); аварийное — ${Lt.em} с блоком питания на 1 ч${Lt.floods ? `; прожекторов над дверями — ${Lt.floods}` : ''}`) : ''}
      ${K ? row('Розетки', `230 В — ${K.n230}, 380 В — ${K.n380}, ЯТП-0,25 (36 В) — ${K.ytp}; на высоте 1 м`) : ''}
      ${F ? row('Пожарная безопасность', `огнетушители ${StationFire.EXT} — ${F.ext}${F.auto ? `; модули «Буран-2,5» на потолке — ${F.mods} (по площади, объёму и геометрии распыла${F.rooms.some(q=>q.shade) ? ', над затенёнными зонами' : ''})` : ''}${F.ops ? '; щит ОПС у входа' : ''}${F.cat && F.cat!=='Д' ? `; категория ${F.cat}${F.zone ? ', зона '+F.zone : ''} — табличка на двери` : ''}`) : ''}
      ${h && h.on && h.n ? row('Отопление', `${h.n} × ${StationHeat.kw(h.kw)} кВт = ${StationHeat.kw(h.total)} кВт`) : ''}
      ${plan.pipe ? row('Трубопровод', `${plan.pipe.lines.map(l=>`${l.name} — DN ${l.dn}`).join(', ')} по расчёту (${plan.pipe.why}, не более ${StationFire.f1(plan.pipe.lines[0].v)} м/с)${plan.pipe.small ? ` — в составе DN ${plan.pipe.set}, мало` : ''}`) : ''}</ul></details>`;
  }
  /** подготовка воздуха: цепочка по ходу воздуха, класс чистоты (ISO 8573-1), чего не хватает — подобрать в каталоге */
  static air(plan, x, i){
    const a=plan.air; if (!a) return '';
    const o=this.opts(x), m3=v=>AirChain.m3(v);
    const chain=a.chain.map(c=>`<span class="stl-node${c.guess ? ' guess' : ''}"${c.guess ? ' title="Ступень фильтра не указана — место выбрано по виду осушителя"' : ''}>${esc(c.text)} <small>поз. ${c.pos}</small></span>`).join('<span class="stl-arr">→</span>');
    const cls=`<label class="f stl-cls"><span>Класс чистоты воздуха по ISO 8573-1 (частицы.вода.масло)</span><select data-stl="air" data-i="${i}"><option value="">не задан — проверка по составу</option>${AirChain.options(o.air).map(([v, t])=>`<option value="${esc(v)}"${o.air===v ? ' selected' : ''}>${esc(t)}</option>`).join('')}</select></label>`;
    const recs=a.recs.map((r, k)=>`<li><span><b>${esc(r.title)}</b> — ${esc(r.why)}</span><button class="btn sm" type="button" data-a="stlRec" data-i="${i}" data-k="${k}">${r.replace ? 'Заменить — подобрать в каталоге' : 'Подобрать в каталоге'}</button></li>`).join('');
    return `<details class="stl-air stl-sp"${Spoiler.attr('air:'+x.id)}><summary class="stl-air-h"><b>Подготовка воздуха</b>${a.recs.length ? `<span class="warn-t">⚠ не хватает: ${a.recs.length}</span>` : '<span class="ok-t">✓ цепочка полная</span>'}${a.q ? `<span class="muted">компрессоры — ${m3(a.q)} м³/мин при ${m3(a.bar)} бар</span>` : ''}</summary>
      <div class="stl-chain">${chain}<span class="stl-arr">→</span><span class="stl-node">потребителю</span></div>
      ${a.chain.some(c=>c.guess) ? '<p class="muted stl-hint">Пунктиром — фильтр, у которого не указана ступень очистки: место выбрано по виду осушителя. Укажите «Ступень очистки» в характеристиках фильтра (предварительная, тонкая, сверхтонкая, угольный).</p>' : ''}
      ${cls}${recs ? `<p class="stl-rec-h">Не хватает в составе:</p><ul class="stl-recs">${recs}</ul>` : ''}</details>`;
  }
  /** подпись размера блок-контейнера: подобран или задан вручную (вернуть подбор) */
  static sizeNote(c, i){
    if (!c || !StationGeo.FLEX[c.ctype]) return '';
    if (c.sizeAuto && String(c.size||'').trim()) return ' · размер подобран по оборудованию';
    return String(c.size||'').trim() ? ` · размер задан вручную — <button type="button" class="lnk" data-a="stlAuto" data-i="${i}">подобрать по оборудованию</button>` : '';
  }
  static fix(sg, i){
    const n=StationLayout.n, t=ctypeOf(sg.ctype).name+(sg.size ? ` ${n(sg.size[0])} × ${n(sg.size[1])} × ${n(sg.size[2])} мм` : '');
    const lead=sg.smaller ? 'Достаточно' : 'Поместится';
    return `<button class="btn primary" type="button" data-a="stlFix" data-i="${i}" data-ct="${esc(sg.ctype)}"${sg.size ? ` data-size="${esc(sg.size.join(' × '))}"` : ''}>${lead}: ${esc(t)} — заменить</button>`;
  }
  /** как расставляется и какие отступы (с источниками) */
  static how(){
    // свод правил компоновки — из действующих значений (LayoutDigest), остальное — пояснения
    return `<details class="stl-how"><summary>Как расставляется оборудование и какие отступы</summary>
      <p>Оборудование стоит вдоль задней стены лицевой стороной к проходу обслуживания (проход — вдоль стены с дверью); если не хватает длины, а ширина позволяет, — в два ряда с проходом посередине. Порядок — как в составе станции (стрелки ↑↓ на вкладке «Состав станции»), у компрессорной — по ходу воздуха; ДГУ — в дальнем торце радиатором к жалюзи. Габариты, масса и цвет — из характеристик элементов (цвет контейнера — поле «Цвет» в составе).</p>
      <p>Сжатый воздух — последовательно, по ходу: компрессоры → коллектор → «мокрый» ресивер → фильтры до осушителя → осушитель → фильтры после → угольный → «сухой» ресивер → потребителю. У осушителя, ресивера и фильтра — один вход и один выход: магистраль проходит через них, у ресивера вход внизу, выход вверху. Фильтры — по ступени очистки (поле «Ступень очистки» или название): предварительный и тонкий — перед осушителем, сверхтонкий от масла — после рефрижераторного; перед адсорбционным — всегда фильтр очистки от масла, после него — пылевой; угольный — последним. Фильтр без указанной ступени ставится по виду осушителя. Встроенные фильтры осушителя и встроенный осушитель компрессора учитываются. Фильтры висят на трубопроводе у осушителя — там, где к ним подойти из прохода (колба и элемент снимаются вниз).</p>
      <p>Подбор: осушитель и фильтры — не меньше суммы производительности компрессоров с поправкой на давление (номинал — при 7 бар, +35 °C на входе, +25 °C вокруг, ISO 7183), осушитель — с запасом 15 % на лето; ресивер — около 125 л на 1 м³/мин компрессора с регулированием «нагрузка — холостой ход» (с частотным — меньше). Класс чистоты по ISO 8573-1 (частицы.вода.масло) — какой нужен осушитель (вода 1–3 — адсорбционный, 4–6 — рефрижераторный) и какие ступени фильтров. Чего не хватает — кнопка «Подобрать в каталоге»: каталог открывается с нужным видом, ступенью и производительностью.</p>
      <p>Шкафы — на стене и не мешают проходу оператора: перед шкафом — не меньше прохода обслуживания (ПУЭ, п. 4.1.23: у щитов не менее 0,8 м в свету; сужение до 0,6 м допускается только строительными конструкциями). Сначала — на стене прохода у двери напротив промежутка между оборудованием, затем — на торце у двери или на дальнем торце, затем — на стене прохода с проходом «не менее»; низ — от 300 мм, верх — до 1,9 м. Напольный шкаф (выбрано в составе, назван так или большой по габаритам) — в ряду у двери. Дверь оператора — не уже 900 мм в свету, открывается наружу.</p>
      <p><b>Свод правил компоновки</b> <span class="muted">— действующие значения; правятся в «Настройки → Инженерные правила станций → Правила компоновки»</span></p>${LayoutDigest.html()}
      <p>Вентиляция (решение ПНЕВМОТЕХ 12.10 — сбалансированная, подробно — «Расчёт станции»): тепло компрессора Q = N · k (k = ${String(StationRules.raw('vent.k_heat').def.screw).replace('.', ',')} по умолчанию, паспортное тепловыделение важнее); воздух охлаждения — по паспорту, иначе его собственный вентилятор: L = Q · 3600 / (c · ρ · Δt_к), нагрев воздуха в компрессоре Δt_к = ${StationRules.raw('heat.cool_dt')} °C, горячий воздух — воздуховодом наружу (помещение не греет). Тепло помещения (корпуса, осушители, солнце) — перепадом Δt = t_вн − t_нар (t_вн = ${StationRules.raw('vent.temps').tIn} °C; меньше ${StationRules.raw('vent.temps').dtMin} °C — предупреждение); компрессор протягивает воздух через помещение — приток один: больший из охлаждения и вентиляции помещения плюс воздух на сжатие, не меньше ${StationRules.raw('vent.ach').min} объёмов в час; воздух у входа компрессора — не выше t_вн. При остановке — вытяжной вентилятор с термостатом (не меньше ${StationRules.raw('vent.fan').stand} м³/ч). Проёмы — по рамке: приток S = L / (3600 · ${String(StationRules.raw('vent.speed').in).replace('.', ',')}) · ${String(StationRules.raw('vent.speed').inReserve).replace('.', ',')}, выброс S = L / (3600 · ${String(StationRules.raw('vent.speed').out).replace('.', ',')}); больше ${StationRules.raw('vent.speed').max} м/с — предупреждение (Atlas Copco); воздуховод с жалюзи — не более ${StationRules.raw('vent.speed').ductDp} Па для штатного вентилятора компрессора. Компактнее — система «Вентилятор в воздуховоде выброса» (приток ${String(StationRules.raw('vent.boost').vIn).replace('.', ',')} м/с, выброс ${String(StationRules.raw('vent.boost').vOut).replace('.', ',')} м/с) или «Вытяжные вентиляторы» — осевые вентиляторы вверху стены напротив притока, по датчику температуры (приток ${String((StationRules.opt('vent.exfan')||{}).vIn??4).replace('.', ',')} м/с, выброс ${String((StationRules.opt('vent.exfan')||{}).vOut??6).replace('.', ',')} м/с по рамке); если приточные жалюзи целиком не встают — программа сама ставит приточные вентиляторы на недостающий расход. Зимой — баланс: тепло работающего компрессора против потерь ограждений (U по утеплителю) и минимального воздухообмена (${StationRules.raw('vent.ach').winter} объёма в час); жалюзи прикрываются до нужной доли (не меньше ${Math.round(StationRules.raw('vent.winter').openMin*100)} %). Свои значения (k, нагрев в компрессоре, Δt, скорости, U, КПД рекуператора) — «Условия для расчёта» → «Вентиляция и отопление — режим «эксперт»». Приток и выброс горячего воздуха — никогда на одной стене: выброс — сбоку, вверху задней стены над компрессором или над его сервисными воротами (короб-воздухоотвод от компрессора), в створки ворот выброс не ставится; не хватает — в торец, если компрессор стоит у торца и в торце нет ворот; иначе — через крышу, и тогда через крышу все компрессоры, каналы одного размера; у ДГУ — дверь-жалюзи радиатора в дальнем торце; приток — внизу на стене напротив выброса, затем в створках ворот и сервисных дверей, затем на остальных стенах (у ДГУ — дальше от радиатора). На воздуховодах компрессоров — клапаны рециркуляции: зимой тёплый воздух — в помещение (рекуперация тепла). Приток — одним проёмом (до 2 400 мм шириной), если где-то помещается; иначе — наименьшим числом одинаковых. Система контейнера «Маркизы на приточных жалюзи»: над каждой приточной жалюзи — откидной козырёк на петлях; открытый — с раскрывающимися боковыми створками-ограничителями, воздух входит только снизу, угол открытия — по расчёту (скорость на входе не более ${String(StationRules.raw('vent.hood_v')).replace('.', ',')} м/с, 30…75°); закрытый — закрывает проём как щит. Приток — выше конвекторов (вход над снегом), не ближе 300 мм к дверям. «Маркизы на жалюзи выброса» — по требованию: открытые направляют горячий воздух вниз, закрытые — щит. Размеры и места — на чертеже.</p>
      <p>ДГУ: дополнительный топливный бак — рядом с ДГУ; глушитель — на крыше прямо над ДГУ, на опорах, выхлопная труба от двигателя — вертикально в глушитель, вывод выхлопа вверх (высота с глушителем — на чертеже; при перевозке глушитель снимают: с платформой — не выше 4 м). Трубопровод — вдоль задней стены с отводами к оборудованию и выходом через дальний торец; материал (сталь, нержавеющая сталь, полипропилен) — в «Составе станции», цвет трассы на чертеже и 3D-виде — по материалу.</p>
      <p>Разрез (3D-вид) и вид снаружи с четырёх сторон рисуются по расстановке: перспектива, мягкие тени, окраска по RAL, оцинковка, нержавеющая сталь, полипропилен. В разрезе стена со стороны зрителя срезана (шкафы на ней — на чертеже), ворота в торцах видны изнутри. Без WebGL2 (старая видеокарта, удалённый рабочий стол) — упрощённый вид.</p>
      <p>Морской контейнер, в который всё не помещается, — ошибка (КП не сохраняется) и подсказка, какой подойдёт; с большим запасом — подсказка, какой меньший (в том числе 10 футов) подойдёт так же.</p>
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
    if (a==='stlAuto'){ c.sizeAuto=true; delete c.lenFix; StationSize.apply(it, true); return true; }
    if (a==='stlRec'){ const r=((this.plan(it).air||{}).recs||[])[+b.dataset.k]; if (r) KitNeed.open(i, r); return false; }
    return false;
  }
  /** галочки «главное фото» и «в КП» */
  static async check(t){
    const it=S.items[+t.dataset.i]; if (!it) return;
    it.stLayout={ ...this.opts(it), [t.dataset.stl]:t.type==='checkbox' ? t.checked : t.value };
    if (t.dataset.stl==='draw' && t.checked) it.stLayout.skip=[];   // снова в КП — все листы
    if (t.dataset.stl==='air' || t.dataset.stl==='calc'){ persist(); renderForm(); return; }   // класс воздуха, расчётная записка — картинки не меняются
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
  static dens = new Map();
  /** длина задана: компоновка пересобрана — уведомление, если сменилась плотность (просторно / плотно / максимально плотно)
   *  или длина не подходит (3.86.11) */
  static notify(x, c, plan){
    const L=StationGeo.len(c.lenFix); if (!L){ this.dens.delete(x.id); return; }
    const d=plan.level==='error' ? 'error' : plan.density ? plan.density.id : '', k=L+'|'+d, was=this.dens.get(x.id); this.dens.set(x.id, k);
    if (was===k || typeof toast!=='function') return;
    // после перерисовки окна (иначе уведомление пропадает вместе со старым содержимым)
    const msg=plan.level==='error' ? (plan.issues[0]||{}).text||'Не помещается' : plan.density ? `Длина ${StationLayout.n(L)} мм: компоновка пересобрана — «${plan.density.title}» (${plan.density.text})` : '';
    if (msg)
    setTimeout(()=>toast(msg, 7000), 0);
  }
  /** подпись под полем размера: длина задана — плотность и «снять» */
  static note(c, plan, i){
    const L=StationGeo.len(c && c.lenFix); if (!L) return '';
    const d=plan && plan.density;
    return `<p class="muted kit-szn">Длина задана: <b>${esc(StationLayout.n(L))} мм</b>${d ? ` — компоновка «${esc(d.title)}» (${esc(d.text)})` : plan && plan.level==='error' ? ' — <span class="bad-t">не помещается</span>' : ''}. <button type="button" class="lnk" data-a="stlAuto" data-i="${i}">размер — по оборудованию</button></p>`;
  }
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
    this.notify(x, c, plan);
    if (txt===String(c.size||'') && c.sizeAuto) return false;
    contApply(c, { size:txt, sizeAuto:true }); stationFill(x);
    return true;
  }
}

// ---------------------------------------------------------------- «Показать на чертеже» у замечаний «Компоновки»
/** что показать на плане по тексту замечания: номера позиций («поз. 3», «поз. 2, 4 и 5», «поз. 2–4») и элементы по словам
 *  (ворота, двери, жалюзи, проход); окно — лист с планом (разрез Б–Б), найденное — в красной рамке (только на экране) */
class IssueSpot {
  static KINDS = [['gate', /ворот/i], ['door', /двер(?!ь-жалюзи)|калитк/i], ['vent', /жалюзи|приток|выброс|воздухозабор/i], ['aisle', /проход/i]];
  /** {pos:[номера], kinds:[…]} — только то, что есть на плане */
  static of(text, plan){
    const t=String(text||''), pos=new Set(), have=new Set([...(plan.items||[]), ...(plan.outside||[]), ...(plan.roof||[])].map(it=>it.pos));
    for (const m of t.matchAll(/поз\.\s*([\d,\s–\-и]+)/gi)) for (const part of m[1].split(/,|\sи\s/)){ const r=part.trim().match(/^(\d+)(?:\s*[–-]\s*(\d+))?$/); if (!r) continue;
      for (let n=+r[1]; n<=(r[2] ? Math.min(+r[2], +r[1]+30) : +r[1]); n++) if (have.has(n)) pos.add(n); }
    const can={ gate:[plan.gates, plan.gates2].some(q=>q && !q.sea), door:(plan.doors||[]).length>0 || !!(plan.entry && plan.entry.wall==='front') || !!plan.dguDoor,
      vent:!!(plan.vent && (plan.vent.louvers||[]).length), aisle:(plan.items||[]).length>0 };
    return { pos:[...pos], kinds:this.KINDS.filter(([k, re])=>can[k] && re.test(t)).map(([k])=>k) };
  }
  static has(text, plan){ const s=this.of(text, plan); return s.pos.length>0 || s.kinds.length>0; }
  /** окно: лист с планом, подсветка; i — позиция КП, j — номер замечания в plan.issues */
  static open(i, j){
    const x=S.items[i]; if (!x) return; const plan=StationUi.plan(x), t=(plan.issues||[])[j]; if (!t || !plan.geo || !plan.geo.ext) return;
    const hl=this.of(t.text, plan), L=StationDrawing.sheets(plan, { ...StationUi.meta(x, plan), hl }), k=Math.max(0, L.findIndex(svg=>svg.includes('class="hl"')));
    const what=[hl.pos.length ? 'поз. '+hl.pos.join(', ') : '', ...hl.kinds.map(z=>({ gate:'ворота', door:'двери', vent:'жалюзи', aisle:'проход' }[z]))].filter(Boolean).join(', ');
    const m=new Modal(`<div class="dlg-h"><h3>На чертеже: ${esc(what)}</h3><button class="icon" type="button" data-x aria-label="Закрыть">✕</button></div>
      <p class="is-txt ${esc(t.level)}">${esc(t.text)}</p>
      ${L.length>1 ? `<div class="is-tabs" role="tablist">${L.map((_, n)=>`<button type="button" class="chip sm${n===k ? ' on' : ''}" data-sh="${n}">Лист ${n+1}</button>`).join('')}</div>` : ''}
      <div class="is-sheet">${L[k]}</div>`, 'is-dlg');
    const go=()=>{ const h=m.$('.is-sheet .hl'), box=m.$('.is-sheet'); if (h && box) box.scrollTop+=h.getBoundingClientRect().top-box.getBoundingClientRect().top-box.clientHeight/3; };   // к подсветке
    setTimeout(go, 30);
    m.d.onclick=e=>{ const b=e.target.closest('[data-x],[data-sh]'); if (!b) return; if (b.dataset.x!=null) return m.close();
      m.$('.is-sheet').innerHTML=L[+b.dataset.sh]; m.d.querySelectorAll('[data-sh]').forEach(z=>z.classList.toggle('on', z===b)); setTimeout(go, 30); };
  }
}

// ---------------------------------------------------------------- картинки для КП
class StationImages {
  static busy = new Set();
  static timer = 0;
  static issues = new Map();   // позиция → почему изображения станции не попадут в КП (показать до сохранения)

  /** что не так с изображениями станций текущего КП: ['Станция …: …'] */
  static problems(){ return S.items.filter(x=>this.issues.has(x.id)).map(x=>`${String(x.name||'').trim() || 'Станция'}: ${this.issues.get(x.id)}`); }
  /** перед сохранением КП: изображения не готовы — спросить; true — сохранять */
  static confirmSave(){ const P=this.problems(); return !P.length || confirm(`Изображения станции не готовы:\n\n${P.join('\n')}\n\nСохранить КП без них?`); }

  /** 3D-вид (главное фото), габаритный чертёж и схема пневматическая (изображения после характеристик) — по расстановке.
   *  Своё фото менеджера не заменяется; фото элемента состава, подставленное мастером само, — заменяется (у элемента оно
   *  остаётся); убранный из изображений чертёж или схема — выключает «в КП». true — что-то изменилось. */
  static async sync(x){
    if (!StationUi.on(x) || !isKit(x) || this.busy.has(x.id)) return false;
    StationSize.apply(x);
    const plan=StationUi.plan(x), o=StationUi.opts(x); let ch=false;
    x.gallery=Array.isArray(x.gallery) ? x.gallery : [];
    const none=plan.level==='none' || plan.level==='error' || !plan.geo || !plan.geo.ext;   // нечего рисовать — прежние картинки не годятся
    this.issues.delete(x.id);
    if (none && (o.photo || o.draw || o.out) && plan.level!=='none'){ const e=(plan.issues||[]).find(q=>q.level==='error');
      this.issues.set(x.id, `компоновка не собрана${e ? ` (${String(e.text).replace(/\.$/, '')})` : ''} — 3D-вида и чертежа в КП не будет; исправьте на вкладке «Компоновка»`); }
    if ((!o.photo || none) && x.photo && x.photo.gen==='st3d'){ x.photo=null; ch=true; }
    const sch=StationUi.scheme(plan), off={ stout:!o.out || none, stdraw:!o.draw || none, stschema:!o.scheme || none || !sch };
    for (const gen of Object.keys(off)) if (off[gen] && x.gallery.some(g=>g && g.gen===gen)){ x.gallery=x.gallery.filter(g=>!(g && g.gen===gen)); ch=true; }
    if (none) return ch;
    this.busy.add(x.id);
    try{
      await EskdFont.load();   // шрифт чертежей — встраивается в листы
      if (typeof DrawPic!=='undefined') await DrawPic.load(x);   // свои рисунки моделей — тоже внутрь листа
      if (await PhotoTint.load(x)){ this.busy.delete(x.id); return (await this.sync(x)) || ch; }   // цвета по фото изменили расстановку — заново
      const meta=StationUi.meta(x, plan), h=plan.hash+StationRender.brandKey(), hd=this.key(plan, meta);   // на 3D-виде надписей нет; на чертеже — название
      if (o.photo && x.photo && x.photo.gen!=='st3d' && this.partPhoto(x)){ x.photo=null; ch=true; }
      // 3D-вид WebGL (отпечаток с «.g») не заменяется SVG-видом на компьютере без WebGL2
      const fresh=x.photo && x.photo.gen==='st3d' && (x.photo.hash===h+'.g' || (x.photo.hash===h && !StationRender.ok()));
      if (o.photo && (!x.photo || x.photo.gen==='st3d') && !fresh){
        const gl=await StationRender.image(plan, meta), im=gl || await this.raster(StationView3D.svg(plan, meta), 'image/jpeg');
        x.photo={ ...im, gen:'st3d', hash:gl ? h+'.g' : h }; ch=true;
        if (!gl && StationRender.fails) this.issues.set(x.id, '3D-вид не построен (сбой WebGL) — в КП упрощённый вид и чертёж; повтор — при следующем построении'); }
      // виды снаружи со всех четырёх сторон (только WebGL): изображениями после характеристик, перед чертежом, по два в ряд;
      // без WebGL прежние остаются; убранный менеджером ракурс больше не вставляется
      if (o.out && StationRender.ok() && await this.outside(x, plan, meta, h, o)) ch=true;
      // листы ЕСКД — изображениями после характеристик, по порядку: габаритный чертёж (все листы) и схема (пневматическая —
      // компрессорная, гидравлическая — насосная)
      if (o.draw && await this.drawing(x, plan, meta, hd)) ch=true;
      const j=x.gallery.findIndex(g=>g && g.gen==='stschema');
      if (!off.stschema && !(j>=0 && x.gallery[j].hash===hd)){
        const im=await this.raster(sch.cls.svg(plan, meta), 'image/png'), old=j>=0 ? x.gallery[j] : null;
        const g={ id:old ? old.id : uid(), ...im, caption:sch.name, slot:'', at:'', on:old ? old.on!==false : true, wide:'full', gen:'stschema', hash:hd };
        if (old) x.gallery[j]=g; else x.gallery.splice(this.after(x.gallery, 'stdraw'), 0, g);
        x.page=true; ch=true; }
    } catch(e){ this.issues.set(x.id, `изображения не собрались (${String((e && e.message)||e).slice(0, 120)})`); }   // КП собирается без них
    finally{ this.busy.delete(x.id); }
    return ch;
  }
  // ракурсы вида снаружи: ключ, азимут камеры (°, StCam: 0 — спереди, 90 — слева, −90 — справа, 180 — сзади), подпись
  static VIEWS = [['front', 18, 'Вид спереди'], ['right', -72, 'Вид справа'], ['back', -162, 'Вид сзади'], ['left', 72, 'Вид слева']];
  /** виды снаружи (gen 'stout', view — ракурс): каждый — своей картинкой на прежнем месте; true — что-то изменилось */
  static async outside(x, plan, meta, h, o){
    let ch=false;
    x.gallery=x.gallery.filter(g=>!(g && g.gen==='stout' && !g.view));   // прежний один вид снаружи — заменяется четырьмя
    for (const [v, az, cap] of this.VIEWS){ if (o.outSkip.includes(v)) continue;
      const j=x.gallery.findIndex(g=>g && g.gen==='stout' && g.view===v); if (j>=0 && x.gallery[j].hash===h+'.o'+az) continue;
      const im=await StationRender.image(plan, meta, 'out', az); if (!im) continue;
      const old=j>=0 ? x.gallery[j] : null, g={ id:old ? old.id : uid(), ...im, caption:cap, slot:'', at:'', on:old ? old.on!==false : true, wide:'half', gen:'stout', view:v, hash:h+'.o'+az };
      if (old) x.gallery[j]=g; else { const k=this.after(x.gallery, 'stout'), d=x.gallery.findIndex(q=>q && (q.gen==='stdraw' || q.gen==='stschema'));
        x.gallery.splice(x.gallery.some(q=>q && q.gen==='stout') ? k : d>=0 ? d : x.gallery.length, 0, g); }
      x.page=true; ch=true; }
    return ch;
  }
  /** листы габаритного чертежа в изображениях позиции: каждый — отдельной картинкой («лист N»), на прежнем месте; лишние
   *  (листов стало меньше) — убираются, скрытый менеджером лист остаётся скрытым. true — что-то изменилось */
  static async drawing(x, plan, meta, hd){
    const D=x.gallery.filter(g=>g && g.gen==='stdraw'), skip=StationUi.opts(x).skip, N=D.length ? D[0].sheets||1 : 0;
    if (D.length && D.every(g=>g.hash===hd && g.sheets===N) && D.length===N-skip.filter(v=>v<=N).length) return false;
    const L=StationDrawing.sheets(plan, meta), n=L.length, keep=new Map(D.map(g=>[g.sheet||1, g])), add=[];
    for (let k=0; k<n; k++){ if (skip.includes(k+1)) continue;
      const im=await this.raster(L[k], 'image/png'), old=keep.get(k+1);
      add.push({ id:old ? old.id : uid(), ...im, caption:n>1 ? `Габаритный чертёж, лист ${k+1}` : 'Габаритный чертёж', slot:'', at:'', on:old ? old.on!==false : true, wide:'full', gen:'stdraw', sheet:k+1, sheets:n, hash:hd }); }
    const at=x.gallery.findIndex(g=>g && g.gen==='stdraw');
    x.gallery=x.gallery.filter(g=>!(g && g.gen==='stdraw'));
    x.gallery.splice(at>=0 ? Math.min(at, x.gallery.length) : this.before(x.gallery, 'stschema'), 0, ...add);
    x.page=true; return true;
  }
  /** место сразу после последней картинки gen (нет таких — в конец) */
  static after(G, gen){ let k=-1; G.forEach((g, j)=>{ if (g && g.gen===gen) k=j; }); return k>=0 ? k+1 : G.length; }
  /** место перед первой картинкой gen (нет таких — в конец) */
  static before(G, gen){ const k=G.findIndex(g=>g && g.gen===gen); return k>=0 ? k : G.length; }
  static async syncAll(){ let ch=false; for (const x of S.items) if (await this.sync(x)) ch=true; if (ch) persist(); return ch; }
  /** после правок — через полторы секунды тишины (картинки 3D считаются долго: не на каждое нажатие при наборе), без лишних
   *  перерисовок; окно позиции — только на вкладке «Компоновка» (на других вкладках поля ввода: перерисовка под рукой сбила бы
   *  набираемое) */
  static WAIT = 1500;
  static soon(x){
    clearTimeout(this.timer);
    this.timer=setTimeout(async ()=>{
      if (!(await this.sync(x))) return;
      persist(); renderForm();
      if (EDIT && EDIT.tab==='layout' && S.items[EDIT.i]===x) renderEditor();
    }, this.WAIT);
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
  /** менеджер убрал картинку j из изображений позиции: лист чертежа — только этот лист (пока остаются другие), остальное —
   *  выключает «в КП» */
  static drop(x, j){
    const g=(x.gallery||[])[j], opt=g && { stdraw:'draw', stschema:'scheme', stout:'out' }[g.gen];
    if (opt==='draw' && x.gallery.some((q, k)=>k!==j && q && q.gen==='stdraw')){ const o=StationUi.opts(x); x.stLayout={ ...o, skip:[...new Set([...o.skip, g.sheet||1])] }; }
    else if (opt==='out' && g.view && x.gallery.some((q, k)=>k!==j && q && q.gen==='stout')){ const o=StationUi.opts(x); x.stLayout={ ...o, outSkip:[...new Set([...o.outSkip, g.view])] }; }
    else if (opt) this.forget(x, opt);
    x.gallery.splice(j, 1);
  }
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
