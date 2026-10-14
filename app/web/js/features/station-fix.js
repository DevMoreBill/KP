// Режим «эксперт»: что в станции не выполняется — по разделам, с пояснением «как решить» и кнопкой «Решить автоматически»
// (решение ПНЕВМОТЕХ 13.10: на случай неточности автоматического подбора — для всех станций: компрессорных, ДГУ, насосных).
// Источники: ошибки ввода требований, «Нужно…» по составу (KitNeed), расчёт станции (StationCalc), замечания компоновки
// (StationUi.plan), значения «эксперта», заданные вручную. Решения программы: число агрегатов и топливный бак — в составе;
// недостающее и замена — рекомендуемый из каталога (тот же подбор, что у «Подобрать оборудование»); ресиверы — по расчёту
// (ReceiverSync); контейнер — подходящий по оборудованию; жалюзи не помещаются — вентилятор в воздуховоде выброса; ворота,
// смещённые без причины, — по оси торца; ошибка в поле — поле очищается (расчёт берёт значение инженерных правил). Что само не
// решается — с подсказкой, что сделать менеджеру. Замечание показано в своём разделе (ресиверы, вентиляция, ворота), общий
// список — в «Подборе станции».
'use strict';

class ExpertFix {
  static SEC = { input:'Ввод требований', main:'Основное оборудование', air:'Подготовка воздуха', recv:'Ресиверы', fuel:'Топливо ДГУ',
    fit:'Контейнер и компоновка', gate:'Ворота и двери', vent:'Вентиляция и отопление', el:'Электропитание', other:'Прочее' };
  /** раздел расчёта (CalcNote) → раздел режима «эксперт» */
  static CALC = { air:'main', press:'main', dryer:'air', filter:'air', recv:'recv', dgu:'main', pump:'main', el:'el', vent:'vent' };
  /** замечание компоновки → раздел (по тексту; первое совпадение) */
  static TEXT = [[/не подойти|не помещается|не проходит/i, 'fit'], [/жалюзи|вентиляц|выброс|приток|колпак|маркиз|отоплен|конвектор/i, 'vent'], [/ресивер/i, 'recv'], [/топлив|бак/i, 'fuel'],
    [/ворот|двер|выход/i, 'gate'], [/осушител|фильтр/i, 'air'], [/кабел|автомат|ввод|электр/i, 'el'],
    [/не помещается|не проходит|проход|контейнер|габарит|стоит в|промежутк|не подойти|над поз\.|высот|масс/i, 'fit']];
  /** как решить — по тексту замечания (первое совпадение) */
  static get HOW(){ return [
    [/Топлив|бак/i, `Бак под время работы без дозаправки — «Решить» поставит нужный объём; больше ${StationLayout.n(StationMatrix.tank().max)} л — два бака или ёмкость вне контейнера.`],
    [/в карточке не указан/i, 'Откройте позицию в каталоге и заполните эту характеристику — проверка выполнится.'],
    [/не подойти для обслуживания/i, 'Нужен проход или сервисные ворота: возьмите контейнер больше или поменяйте порядок элементов в составе.'],
    [/не помещается|не проходит по/i, 'Возьмите контейнер больше или ресиверы по 500 л внутри (кнопка); не помещаются и они — ресиверы на площадку снаружи; иначе — оборудование меньших размеров или два модуля.'],
    [/Контейнер с запасом/i, 'Возьмите меньший контейнер — дешевле и легче.'],
    [/Проход .*меньше рекомендуемых/i, 'Допустимо по нормам; шире проход — в более широком контейнере (до 2 550 мм — без спецразрешения).'],
    [/учёт\S* в Ростехнадзоре/i, 'Замените на несколько ресиверов по 900 л до 11 бар — каждый без учёта.'],
    [/Средняя нагрузка .* больше 70 %/i, 'ДГУ мощнее или по мощности COP — уточните у изготовителя.'],
    [/малой нагрузке|меньше \d+ % PRP/i, 'ДГУ меньшей мощности или уточните минимальную нагрузку у изготовителя.'],
    [/Пусковая мощность/i, 'Укажите плавный пуск или частотный преобразователь («Условия для расчёта» → «Пуск этого двигателя») либо возьмите ДГУ больше.'],
    [/Условия площадки|Условия выше номинальных/i, 'Проверьте запас мощности по паспорту изготовителя при этих условиях.'],
    [/NPSH|кавитац/i, 'Уменьшите высоту всасывания (подпор, насос ниже) или возьмите насос с меньшим NPSHr.'],
    [/циклограмм|пиков\S* разбор|проскок/i, 'Проверьте циклограмму в блоке «Ресиверы»; мокрый ресивер до осушителя снимает пик.'],
    [/объём .*ниже минимально|меньше нужного|кратн|500 л/i, 'Число и типоразмер ресиверов — по расчёту («Решить» приведёт состав к расчёту).'],
    [/номинал|клапан|рассчитан на|давлени/i, 'Замените на исполнение на давление не ниже давления компрессора (у ресиверов — с запасом не меньше 1 бар).'],
    [/меньше производительности|с поправк|меньше требуемой|меньше нагрузки|мощность ДГУ|меньше \S+ м³/i, 'Добавьте ещё один такой же аппарат или замените на более мощный — «Решить» сделает это по каталогу.'],
    [/Не поместилось .*жалюзи|приточных жалюзи|колпаков/i, 'Включите «Вытяжные вентиляторы» (выброс через вентиляторы в стене напротив притока, приток до 4 м/с — проёмы меньше), освободите стену или возьмите контейнер больше; приточные вентиляторы программа ставит сама, если жалюзи не встают.'],
    [/Над .* до потолка/i, 'Допустимо; больше места над оборудованием — в контейнере выше.'],
    [/Причина смещения|смещены/i, 'Укажите причину смещения или верните ворота на ось торца.'],
    [/фильтр/i, 'Добавьте фильтр нужной ступени — «Нужно…» в составе.'],
  ]; }
  static SHORT = /меньше|не хватает|нет (фильтр|осушител|ресивер|компрессор)|ниже минимал|не кратен|без обоснования|не помести/i;
  static num(v){ return StationReq.num(v); }
  static secOf(t){ const m=this.TEXT.find(([re])=>re.test(t)); return m ? m[1] : 'other'; }
  static how(t){ const m=this.HOW.find(([re])=>re.test(t)); return m ? m[1] : ''; }
  /** решается без выбора менеджера («Решить всё»): не очищает его поля и не сбрасывает его значения «эксперта» */
  static auto(id){ return !/^(clr:|xs:|gate$)/.test(id); }

  /** все замечания станции: [{sec, bad, text, how, fix:{id, label} | null}], по разделам в порядке проверки. В одной
   *  перерисовке окна список считается один раз (memo сбрасывается после неё и при каждом решении) */
  static memo = null;
  static list(x){
    if (this.memo && this.memo.x===x) return this.memo.L;
    const L=this.collect(x); this.memo={ x, L }; setTimeout(()=>{ this.memo=null; }, 0); return L;
  }
  static collect(x){
    if (!stationOf(x) || !isKit(x)) return [];
    const out=[], seen=new Set(), k=StationReq.kind(x), r=StationReq.of(x);
    const add=(sec, bad, text, how, fix)=>{ const t=String(text||'').trim(); if (!t || seen.has(t)) return; seen.add(t); out.push({ sec, bad:!!bad, text:t, how:how||'', fix:fix||null }); };
    // решение раздела («Нужно…», ресиверы по расчёту) — только к замечанию о нехватке (меньше нужного, нет аппарата)
    const secFix=(s, t)=>{ if (t!=null && !this.SHORT.test(t)) return null; const f=out.find(o=>o.sec===s && o.fix && /^(need:|recv$)/.test(o.fix.id)); return f ? f.fix : null; };
    // ввод требований
    for (const e of ReqNum.errors(x)) add('input', true, `«${e.label}»: ${e.text}`, 'Исправьте значение или очистите поле — расчёт возьмёт значение инженерных правил.', { id:'clr:'+e.key, label:'Очистить поле' });
    if (this.num(r.gateOff) && !String(r.gateWhy||'').trim())
      add('gate', true, 'Ворота в торце смещены от оси без причины — КП не сохранится', 'Укажите причину смещения («Ворота в торце — режим «эксперт»») или верните ворота на ось.', { id:'gate', label:'Вернуть на ось' });
    // чего не хватает в составе («Нужно…»)
    const sOf=q=>q.main || /^main/.test(q.key||'') ? 'main' : q.cat==='receiver' ? 'recv' : q.key==='tank' ? 'fuel' : /^(dryer|filter)/.test(q.cat||'') ? 'air' : 'other';
    // ресиверы того же объёма — числом в той же строке состава (а не «Ещё N × 900 л» отдельной строкой)
    const rs=k==='comp' ? ReceiverSync.apply(x, true) : '';
    for (const q of KitNeed.recs(x)){ if (rs && /^receiver-(wet-)?more$/.test(q.key)) continue; const can=KitNeed.can(x, q);
      add(sOf(q), q.swap, KitNeed.head(q), (q.why ? q.why[0].toUpperCase()+q.why.slice(1)+'.' : '')+(can ? '' : ' В каталоге подходящего нет — добавьте позицию в каталог.'),
        can ? { id:'need:'+q.key, label:q.swap ? 'Заменить' : q.act ? 'Добавить' : 'Подобрать' } : null); }
    if (rs){ const m=rs; add('recv', false, 'Число ресиверов в составе — не по расчёту: нужно '+m, 'Число приводится к расчёту по методике (объём по ТЗ, циклограмма, пик точки).', { id:'recv', label:'Пересчитать' }); }
    // расчёт станции (ошибки ввода — выше)
    const R=StationRules.ok() && typeof StationCalc!=='undefined' ? StationCalc.run(x) : null;
    if (R){ for (const t of R.issues.filter(t=>t.level!=='info' && !/^Требования: «/.test(t.text))){ const s=/топлив|бак/i.test(t.text) ? 'fuel' : this.CALC[t.sec] || this.secOf(t.text); add(s, t.level==='error', t.text, this.how(t.text), secFix(s, t.text)); }
      for (const q of R.questions) add('input', false, 'Нужно узнать у заказчика: '+q, 'Спросите заказчика и укажите ответ в «Подборе станции» — расчёт уточнится.', null); }
    // компоновка
    const plan=StationUi.on(x) && kitContainer(x) ? StationUi.plan(x) : null, sg=plan && plan.suggest, c=kitContainer(x);
    if (plan && plan.level!=='none') for (const q of plan.issues||[]){ if (q.level!=='error' && q.level!=='warn') continue;
      const s=q.big ? 'fit' : this.secOf(q.text);
      // не помещается и подходящего контейнера нет — ресиверы после осушителя на площадку снаружи (ФНП ОРПД, п. 65)
      // (решение ПНЕВМОТЕХ 14.10: сначала — меньшие ресиверы по 500 л внутри, без учёта в Ростехнадзоре; наружу — только потом)
      const rOut=k==='comp' && q.level==='error' && s==='fit' && !StationReq.recvOut(x) && kitParts(x).some(z=>StationEquip.kindOf(z)==='receiver');
      const r500=rOut && !r.recvSize && kitParts(x).some(z=>StationEquip.kindOf(z)==='receiver' && z.recvRole!=='wet' && z.recvRole!=='local' && AirChain.volume(z)>ReceiverPlan.SMALL);
      const fix=sg && s==='fit' && (q.level==='error' || q.big) ? { id:'cont', label:(sg.smaller ? 'Взять меньше: ' : 'Взять: ')+this.cont(sg) }
        : r500 ? { id:'recv500', label:'Ресиверы по 500 л — внутри' }
        : rOut ? { id:'recvOut', label:'Ресиверы после осушителя — снаружи' }
        : s==='vent' && /Не поместил/.test(q.text) && c && !KitView.sysOn(x, c, 'exfan') && StationRules.opt('vent.exfan') ? { id:'exfan', label:'Включить вытяжные вентиляторы' }
        : s==='vent' && /Не поместил/.test(q.text) && c && !KitView.sysOn(x, c, 'boost') ? { id:'boost', label:'Включить вентилятор в воздуховоде выброса' } : secFix(s, q.text);
      add(s, q.level==='error', q.text, this.how(q.text), fix); }
    // значения «эксперта», заданные вручную, — если в их разделе есть замечания
    for (const [s, keys] of [['vent', ExpertLog.VENT()], ['gate', ExpertLog.GATE]]){ const on=keys.filter(z=>ExpertLog.set(r, z));
      if (on.length && out.some(o=>o.sec===s)) add(s, false, 'Заданы вручную (режим «эксперт»): '+on.map(z=>ExpertLog.label(z)).join(', '), 'Если замечания из-за них — верните значения инженерных правил.', { id:'xs:'+s, label:'Всё по правилам' }); }
    return out;
  }
  /** контейнер словами: «Блок-контейнер 7 000 × 2 550 × 2 800 мм» */
  static cont(sg){ const n=StationLayout.n; return ctypeOf(sg.ctype).name+(sg.size ? ` ${n(sg.size[0])} × ${n(sg.size[1])} × ${n(sg.size[2])} мм` : ''); }

  /** решить одно замечание; ответ — что сделано («» — не получилось) */
  static async fix(x, id){
    this.memo=null; try{ return await this.fix0(x, id); } finally{ this.memo=null; }
  }
  static async fix0(x, id){
    const r=StationReq.ensure(x), c=kitContainer(x);
    if (id.startsWith('clr:')){ const key=id.slice(4); if (!(key in ReqNum.R)) return ''; delete r[key]; return `поле «${ReqNum.LABEL[key]||key}» очищено`; }
    if (id.startsWith('need:')){ const q=KitNeed.recs(x).find(z=>z.key===id.slice(5)); return q ? this.need(x, q) : ''; }
    if (id==='recv'){ const m=ReceiverSync.apply(x); return m ? 'ресиверы: '+m : ''; }
    if (id==='cont'){ const plan=StationUi.plan(x), sg=plan && plan.suggest; if (!sg || !c) return '';
      contApply(c, { ctype:sg.ctype, size:sg.size ? sg.size.join(' × ') : '', sizeAuto:!!StationGeo.FLEX[sg.ctype] }); return 'контейнер — '+this.cont(sg); }
    if (id==='recvOut'){ r.recvOut=true; return 'ресиверы после осушителя — снаружи на площадке у торца (ФНП ОРПД, п. 65)'; }
    if (id==='recv500') return this.recv500(x);
    if (id==='exfan'){ if (!c) return ''; c.sys={ ...(c.sys||CONT_SYS_DEF), exfan:true, boost:false }; contApply(c); return 'вытяжные вентиляторы в стене напротив притока — проёмы меньше'; }
    if (id==='boost'){ if (!c) return ''; c.sys={ ...(c.sys||CONT_SYS_DEF), boost:true }; contApply(c); return 'вентилятор в воздуховоде выброса — жалюзи меньше'; }
    if (id==='gate'){ ExpertLog.reset(x, ExpertLog.GATE); return 'ворота — по оси торца'; }
    if (id.startsWith('xs:')){ ExpertLog.reset(x, id==='xs:vent' ? ExpertLog.VENT() : ExpertLog.GATE); return 'значения — по инженерным правилам'; }
    return '';
  }
  /** основные ресиверы — по 500 л (нехватка места, методика ПНЕВМОТЕХ): число — по расчёту, ресивер — рекомендуемый из
   *  каталога (давление с запасом, по высоте помещения); 500 л в каталоге нет — ничего не меняется ('') */
  static async recv500(x){
    const r=StationReq.ensure(x), P=kitParts(x), old=P.filter(z=>StationEquip.kindOf(z)==='receiver' && z.recvRole!=='wet' && z.recvRole!=='local' && AirChain.volume(z)>ReceiverPlan.SMALL);
    if (!old.length) return '';
    const keep={ size:r.recvSize, why:r.recvWhy }; r.recvSize='500'; r.recvWhy='space';
    const R=StationReq.recvPlan(x), o=R && R.main ? TzPick.recvPick(ReceiverPlan.SMALL, KitNeed.bar(x), TzPick.hmax(x)) : null;
    if (!o || !o.o){ if (keep.size) r.recvSize=keep.size; else delete r.recvSize; if (keep.why) r.recvWhy=keep.why; else delete r.recvWhy; return ''; }
    const p=await TzPick.part(o.o.c, R.main.n); p.recvRole='dry';
    const at=x.kit.parts.indexOf(old[0]); x.kit.parts=x.kit.parts.filter(z=>!old.includes(z)); x.kit.parts.splice(Math.max(0, Math.min(at, x.kit.parts.length)), 0, p);
    return `ресиверы — ${R.main.n} × ${o.o.c.name} внутри (500 л, без учёта в Ростехнадзоре: нехватка места)`;
  }
  /** строка «Нужно…» без окна каталога: число и бак — в составе, остальное — рекомендуемый; основное — по требованиям */
  static async need(x, q){
    if (q.act) return KitNeed.apply(x, q);
    let b=null;
    if (q.main){ const P=KitNeed.mainPreset(x), cc=P && P.best ? catCache.find(z=>z.id===P.best.id) : null; b=cc ? { c:cc, n:P.best.n } : null; }
    else b=KitNeed.best(x, q);
    if (!b || !b.c) return '';
    x.kit=x.kit||{ parts:[] };
    if (Array.isArray(q.replace)) x.kit.parts=x.kit.parts.filter(z=>!q.replace.includes(z.id));
    const p=await TzPick.part(b.c, b.n, q.main ? 'main' : '');
    if (q.cat==='filter' && AirChain.GRADES[q.key]) p.airGrade=q.key; if (b.role) p.recvRole=b.role;
    if (q.main){ const ix=x.kit.parts.findIndex(z=>z.role==='container'); x.kit.parts.splice(ix>=0 ? ix : 0, 0, p); } else x.kit.parts.push(p);
    return (b.n>1 ? b.n+' × ' : '')+b.c.name;
  }
  /** «Решить автоматически»: всё, что решается без выбора менеджера, — по порядку (основное, подготовка воздуха, ресиверы,
   *  топливо, контейнер, вентиляция), до 4 проходов (после замены могут появиться новые «Нужно…») */
  static async all(x, secs){
    const got=[], tried=new Set();
    for (let pass=0; pass<4; pass++){
      const L=this.list(x).filter(q=>q.fix && this.auto(q.fix.id) && !tried.has(q.fix.id) && (!secs || secs.includes(q.sec))); if (!L.length) break;
      for (const q of L){ if (tried.has(q.fix.id)) continue; tried.add(q.fix.id);
        const m=await this.fix(x, q.fix.id); if (m) got.push(m); kitSync(x); StationUi.cache.delete(x.id); StationSize.apply(x, true); this.memo=null; } }
    return got;
  }

  /** замечания разделов secs (null — все): текст, «как решить», кнопка; o.title — заголовок, o.all — «Решить автоматически»,
   *  o.max — не больше строк (остальные — числом) */
  static html(x, i, secs, o={}){
    const A=this.list(x).filter(q=>!secs || secs.includes(q.sec)), L=A.filter(q=>q.text!==o.skip);   // skip — уже в строке итога
    const n=A.filter(q=>q.fix && this.auto(q.fix.id)).length, max=o.max || L.length, more=L.length-max, tag=!secs || secs.length>1;
    if (!L.length && !(o.all && n)) return '';
    return `<div class="xf">${o.title || (o.all && n) ? `<div class="xf-h">${o.title ? `<b>${esc(o.title)}</b>` : ''}${o.all && n ? `<button class="btn primary sm" type="button" data-a="xFixAll" data-i="${i}" data-k="${esc(secs ? secs.join(',') : '')}">Решить автоматически${n>1 ? ` (${n})` : ''}</button>` : ''}</div>` : ''}
      ${L.length ? `<ul class="xf-l">${L.slice(0, max).map(q=>`<li class="${q.bad ? 'bad' : 'warn'}"><div class="xf-t">${q.bad ? '✕' : '⚠'} ${esc(q.text)}${tag ? ` <span class="xf-s">${esc(this.SEC[q.sec]||'')}</span>` : ''}</div>
        ${q.how || q.fix ? `<div class="xf-a">${q.how ? `<small class="muted">Как решить: ${esc(q.how)}</small>` : ''}${this.button(i, q)}</div>` : ''}</li>`).join('')}
        ${more>0 ? `<li class="muted">и ещё ${more} — в разделах «Все требования, условия расчёта и проверки»</li>` : ''}</ul>` : ''}</div>`;
  }
  /** кнопка решения замечания q или '' */
  static button(i, q){ return q && q.fix ? `<button class="btn sm${this.auto(q.fix.id) ? '' : ' ghost'}" type="button" data-a="xFix" data-i="${i}" data-k="${esc(q.fix.id)}">${esc(q.fix.label)}</button>` : ''; }
  /** «Как решить» и кнопка для замечания с этим текстом (строка итога «Подбора станции») или '' */
  static hint(x, i, text){ const q=this.list(x).find(z=>z.text===String(text||'').trim()); return q && (q.how || q.fix) ? `<div class="xf-a">${q.how ? `<small class="muted">Как решить: ${esc(q.how)}</small>` : ''}${this.button(i, q)}</div>` : ''; }
  /** есть ли замечания в разделах secs (раскрыть раздел) */
  static has(x, secs){ return this.list(x).some(q=>secs.includes(q.sec)); }
  /** кнопка «Решить» для замечания с этим текстом (вкладка «Компоновка») или '' */
  static btn(x, i, text, L){ const q=(L || this.list(x)).find(z=>z.text===String(text||'').trim() && z.fix);
    return q ? `<button class="lnk is-fix" type="button" data-a="xFix" data-i="${i}" data-k="${esc(q.fix.id)}" title="${esc(q.how||'')}">${esc(q.fix.label.toLowerCase())}</button>` : ''; }

  /** действия: xFix — одно замечание, xFixAll — всё, что решается автоматически */
  static async act(a, i, b){
    const x=S.items[i]; if (!x) return;
    if (a==='xFix'){ const id=String(b.dataset.k||''); if (!this.auto(id) && id!=='gate' && !confirm('Сбросить заданное вручную?')) return;
      const m=await this.fix(x, id); KitNeed.done(x); StationImages.soon(x); toast(m ? 'Сделано: '+m : 'Автоматически не решается — смотрите «Как решить»'); return; }
    if (a==='xFixAll'){ const secs=String(b.dataset.k||'').split(',').filter(Boolean);
      const got=await this.all(x, secs.length ? secs : null); KitNeed.done(x); StationImages.soon(x);
      const left=this.list(x).filter(q=>q.bad).length;
      toast((got.length ? 'Сделано: '+got.join('; ') : 'Автоматически решить нечего')+(left ? `. Осталось ошибок: ${left} — смотрите «Как решить»` : '')); }
  }
}
