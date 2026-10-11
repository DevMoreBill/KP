// Компоновка станции в контейнере — в программе: вкладка «Компоновка» карточки станции (помещается ли оборудование,
// чертёж и 3D-вид, подбор контейнера), размер блок-контейнера по оборудованию, картинки для КП (3D-вид — главное фото
// станции, габаритный чертёж — в изображениях после характеристик), проверка перед сохранением КП.
// Расчёт — station-layout.js (StationLayout), рисунки — station-draw.js (StationDrawing, StationView3D).
'use strict';

class StationUi {
  static cache = new Map();

  /** функция включена, позиция — станция в контейнере */
  static on(x){ return !!x && typeof stationOf==='function' && !!stationOf(x) && FEAT.on('stLayout'); }
  static input(x){
    const c=kitContainer(x);
    return { cont:c ? { ctype:c.ctype, size:c.size, sizeAuto:!!c.sizeAuto, ins:c.ins, ral:c.ral, sys:c.sys||null } : null, parts:kitParts(x) };
  }
  /** расстановка — пересчитывается, только когда изменился состав или контейнер */
  static plan(x){
    const inp=this.input(x), h=StationLayout.hash(inp), c=this.cache.get(x.id);
    if (c && c.h===h) return c.plan;
    const plan=StationLayout.solve(inp); plan.hash=h; this.cache.set(x.id, { h, plan });
    return plan;
  }
  /** оборудование не помещается — КП не сохраняется (пункт в «Чтобы сохранить, заполните»); по условным габаритам —
   *  только предупреждение: программа не уверена */
  static blocked(x){ if (!this.on(x) || !isKit(x)) return false; const p=this.plan(x); return p.level==='error' && !p.assumed; }
  static meta(x, plan){
    const c=kitContainer(x);
    return { title:String(x.name||'').trim() || 'Станция в контейнере', cont:c ? ctypeOf(c.ctype).name : 'Контейнер', colorText:plan.colorText ? 'цвет '+plan.colorText : '' };
  }
  /** что вставлять в КП: 3D-вид главным фото, чертёж — в изображения (по умолчанию — оба) */
  static opts(x){ const o=x.stLayout||{}; return { photo:o.photo!==false, draw:o.draw!==false }; }
  static url(svg){ return 'data:image/svg+xml;charset=utf-8,'+encodeURIComponent(svg); }

  // ---- вкладка «Компоновка»
  static tab(x, i){
    if (StationSize.apply(x)) persist();
    const plan=this.plan(x), n=StationLayout.n;
    if (plan.level==='none') return `<div class="ed-sec stl"><p class="stl-none">${esc(plan.text)}</p>${this.how()}</div>`;
    const g=plan.geo, c=kitContainer(x), ct=ctypeOf(c.ctype), o=this.opts(x);
    const head=plan.level==='error' ? ['err', plan.assumed ? '✕ Не помещается по условным габаритам — укажите размеры оборудования' : '✕ Оборудование не помещается в контейнер']
      : plan.level==='warn' ? ['warn', '⚠ Помещается, но часть отступов меньше рекомендуемых'] : ['ok', '✓ Оборудование помещается с рекомендуемыми отступами'];
    const dims=g.ext ? `${esc(ct.name)} · ${n(g.ext[0])} × ${n(g.ext[1])} × ${n(g.ext[2])} мм${plan.int ? ` · внутри ${n(plan.int[0])} × ${n(plan.int[1])} × ${n(plan.int[2])} мм` : ''}` : esc(ct.name);
    const iss=[...plan.issues].sort((a, b)=>this.rank(a)-this.rank(b));
    if (plan.level==='error' && plan.assumed) iss.push({ level:'info', text:'Пока габариты части оборудования условные, КП сохранится, но контейнер может не подойти: впишите «Габариты» элементов на вкладке «Состав станции».' });
    else if (plan.level==='error') iss.push({ level:'info', text:'КП не сохранится, пока оборудование не поместится: замените контейнер (кнопка выше) или измените состав.' });
    const pics=plan.level!=='error' && g.ext, meta=this.meta(x, plan), photoOn=x.photo ? x.photo.gen==='st3d' : o.photo;
    StationImages.soon(x);
    return `<div class="ed-sec stl">
      <div class="stl-st ${head[0]}"><b>${head[1]}</b><span>${dims}${this.sizeNote(c, i)}</span>${plan.suggest ? this.fix(plan.suggest, i) : ''}</div>
      ${iss.length ? `<ul class="stl-iss">${iss.map(t=>`<li class="${t.level}">${esc(t.text)}</li>`).join('')}</ul>` : ''}
      ${pics ? `<div class="stl-views">
        <figure><figcaption><b>3D-вид</b><label class="stl-chk"><input type="checkbox" data-stl="photo" data-i="${i}"${photoOn ? ' checked' : ''}> главное фото станции — в строке КП и на титуле</label></figcaption>
          <img src="${esc(this.url(StationView3D.svg(plan, meta)))}" alt="3D-вид станции"></figure>
        <figure class="dr"><figcaption><b>Габаритный чертёж</b><label class="stl-chk"><input type="checkbox" data-stl="draw" data-i="${i}"${o.draw ? ' checked' : ''}> в КП — после характеристик</label></figcaption>
          <img src="${esc(this.url(StationDrawing.svg(plan, meta)))}" alt="Габаритный чертёж станции"></figure></div>` : ''}
      ${this.how()}</div>`;
  }
  static rank(t){ return { error:0, warn:1, info:2 }[t.level] ?? 3; }
  /** подпись размера блок-контейнера: подобран или задан вручную (вернуть подбор) */
  static sizeNote(c, i){
    if (!c || !StationGeo.FLEX[c.ctype]) return '';
    if (c.sizeAuto && String(c.size||'').trim()) return ' · размер подобран по оборудованию';
    return String(c.size||'').trim() ? ` · размер задан вручную — <button type="button" class="lnk" data-a="stlAuto" data-i="${i}">подобрать по оборудованию</button>` : '';
  }
  static fix(sg, i){
    const n=StationLayout.n, t=ctypeOf(sg.ctype).name+(sg.size ? ` ${n(sg.size[0])} × ${n(sg.size[1])} × ${n(sg.size[2])} мм` : '');
    return `<button class="btn primary" type="button" data-a="stlFix" data-i="${i}" data-ct="${esc(sg.ctype)}"${sg.size ? ` data-size="${esc(sg.size.join(' × '))}"` : ''}>Поместится: ${esc(t)} — заменить</button>`;
  }
  /** как расставляется и какие отступы (с источниками) */
  static how(){
    const [aRec, aMin]=StationClear.aisle(), n=StationLayout.n;
    return `<details class="stl-how"><summary>Как расставляется оборудование и какие отступы</summary>
      <p>Оборудование стоит вдоль задней стены лицевой стороной к проходу обслуживания (проход — вдоль стены с дверью); если не хватает длины, а ширина позволяет, — в два ряда с проходом посередине. Порядок — как в составе станции (стрелки ↑↓ на вкладке «Состав станции»); шкафы — у двери, ДГУ — в дальнем торце радиатором к жалюзи, магистральные фильтры — на трубопроводе в промежутках у задней стены. Габариты, масса и цвет — из характеристик элементов (цвет контейнера — поле «Цвет» в составе).</p>
      <p>Отступы — сначала «не менее» (помещается ли), затем свободное место раздаётся до рекомендуемых:</p>
      <ul><li>проход обслуживания — рекомендуется ${n(aRec)} мм (руководства производителей компрессоров: не менее 1 м), не менее ${n(aMin)} мм (ПУЭ, п. 4.1.23); вдоль ДГУ — не менее 600 мм (там же: сужение прохода до 0,6 м);</li>
        <li>между оборудованием — 700 мм (СП 30.13330.2020, п. 13.22: между выступающими частями 0,7 м), не менее 300 мм; насосы — 1000 мм (СП 31.13330.2021, п. 10.15), малые (до 22 кВт) — 700 мм, у стены и парой на общей раме — от 250 мм;</li>
        <li>компрессор: сзади 600 / не менее 300 мм; над ним в помещении — 1 м до потолка, в контейнере горячий воздух отводится воздуховодом (не менее 300 мм);</li>
        <li>осушитель: около 500 мм вокруг (руководства производителей), ресивер — 300 мм от стен (доступ к крану слива и люку), ДГУ: со стороны генератора 1000 / 800 мм, радиатор к жалюзи — 300 мм.</li></ul>
      <p>Блок-контейнер без своего размера получает наименьший размер из ряда (длина с шагом 500 мм до 12 м; ширина 2400 и 2500 мм — везут без спецразрешения, затем 3000 мм). Морской контейнер, в который всё не помещается, — ошибка (КП не сохраняется) и подсказка, какой подойдёт. Проход обслуживания администратор меняет в «Настройки → Умолчания → Станции в контейнере».</p></details>`;
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
    return false;
  }
  /** галочки «главное фото» и «в КП» */
  static async check(t){
    const it=S.items[+t.dataset.i]; if (!it) return;
    it.stLayout={ ...this.opts(it), [t.dataset.stl]:t.checked };
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

  /** 3D-вид (главное фото) и габаритный чертёж (изображение после характеристик) — по текущей расстановке.
   *  Своё фото менеджера не заменяется; фото элемента состава, подставленное мастером само, — заменяется (у элемента оно
   *  остаётся); убранный из изображений чертёж — выключает «в КП». true — что-то изменилось. */
  static async sync(x){
    if (!StationUi.on(x) || !isKit(x) || this.busy.has(x.id)) return false;
    StationSize.apply(x);
    const plan=StationUi.plan(x), o=StationUi.opts(x); let ch=false;
    x.gallery=Array.isArray(x.gallery) ? x.gallery : [];
    const k=x.gallery.findIndex(g=>g && g.gen==='stdraw');
    const none=plan.level==='none' || plan.level==='error' || !plan.geo || !plan.geo.ext;   // нечего рисовать — прежние картинки не годятся
    if ((!o.photo || none) && x.photo && x.photo.gen==='st3d'){ x.photo=null; ch=true; }
    if ((!o.draw || none) && k>=0){ x.gallery.splice(k, 1); ch=true; }
    if (none) return ch;
    this.busy.add(x.id);
    try{
      const meta=StationUi.meta(x, plan), h=plan.hash, hd=this.key(plan, meta);   // на 3D-виде надписей нет; на чертеже — название
      if (o.photo && x.photo && x.photo.gen!=='st3d' && this.partPhoto(x)){ x.photo=null; ch=true; }
      if (o.photo && (!x.photo || x.photo.gen==='st3d') && !(x.photo && x.photo.hash===h)){
        const im=await this.raster(StationView3D.svg(plan, meta), 'image/jpeg');
        x.photo={ ...im, gen:'st3d', hash:h }; ch=true; }
      const j=x.gallery.findIndex(g=>g && g.gen==='stdraw');
      if (o.draw && (j<0 || x.gallery[j].hash!==hd)){
        const im=await this.raster(StationDrawing.svg(plan, meta), 'image/png'), old=j>=0 ? x.gallery[j] : null;
        const g={ id:old ? old.id : uid(), ...im, caption:'Габаритный чертёж и схема расстановки оборудования', slot:'', at:'', on:old ? old.on!==false : true, wide:'full', gen:'stdraw', hash:hd };
        if (old) x.gallery[j]=g; else x.gallery.push(g);
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
  /** отпечаток чертежа: расстановка и подписи на нём (название станции, контейнер, цвет) */
  static key(plan, meta){ return plan.hash+'.'+StationLayout.fnv(JSON.stringify([meta.title, meta.cont, meta.colorText])); }
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
