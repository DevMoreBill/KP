// Станция «просто»: главный экран менеджера на вкладке «Состав станции». Несколько главных требований (или ТЗ заказчика),
// одна кнопка «Подобрать оборудование» — оборудование из каталога, контейнер по оборудованию, компоновка и изображения для КП
// (3D-вид, чертёж, схема); итог — одной строкой, состав коротко, проверки значками, 3D-вид. Всё подробное — условия расчёта,
// проверки по нормам, расчётная записка, правила и источники — под раскрывающимися блоками (Spoiler): открывают по
// необходимости. Неясное и незначительное решается в пользу заказчика (запас, а не вопрос), заказчика спрашиваем только о
// том, без чего станцию не подобрать.
'use strict';

// ---------------------------------------------------------------- раскрывающийся блок: помнит, раскрыт ли (перерисовка окна)
class Spoiler {
  static open = new Map();     // ключ → раскрыт (true / false), если менеджер менял сам
  /** атрибуты <details>: data-sp и open (по выбору менеджера, иначе — по умолчанию) */
  static attr(key, def=false){ const v=this.open.has(key) ? this.open.get(key) : def; return ` data-sp="${esc(key)}"${v ? ' open' : ''}`; }
  static toggle(d){ if (d && d.dataset && d.dataset.sp) this.open.set(d.dataset.sp, d.open); }
}
document.addEventListener('toggle', e=>{ if (e.target && e.target.matches && e.target.matches('details[data-sp]')) Spoiler.toggle(e.target); }, true);

// ---------------------------------------------------------------- подбор станции в одно действие
class StationQuick {
  /** главные поля по виду станции: [ключ, подпись, подсказка, режим ввода] */
  static KEYS = {
    comp:[['flow', 'Производительность, м³/мин', 'например, 10'], ['pressure', 'Давление у потребителя, бар', 'например, 7']],
    dgu:[['kw', 'Мощность нагрузки, кВт', 'например, 200'], ['hours', 'Работа без дозаправки, ч', 'например, 8', 'numeric']],
    pump:[['q', 'Подача, м³/ч', 'например, 50'], ['head', 'Напор, м', 'например, 40']],
  };
  /** без чего подбор невозможен */
  static NEED = { comp:['flow', 'производительность'], dgu:['kw', 'мощность нагрузки'], pump:['q', 'подачу'] };
  /** ключи, которые стоят в главном блоке (в «Все требования» их нет) */
  static MAIN = new Set(['flow', 'pressure', 'kw', 'hours', 'q', 'head', 'reserve', 'mode']);
  static SEC = { air:'Производительность', press:'Давление', dryer:'Осушитель', filter:'Фильтры', recv:'Ресиверы', dgu:'ДГУ', el:'Электропитание', vent:'Вентиляция' };

  /** блок «Подбор станции»: главные требования, кнопки, итог; всё остальное — в раскрывающемся блоке */
  static html(x, i){
    const r=StationReq.of(x), k=StationReq.kind(x), P=`items.${i}.req`, main=kitMainPart(x), cls=StationUi.opts(x).air;
    const fld=([key, label, ph, mode='decimal'])=>`<label class="f"><span>${label}</span><input type="text" inputmode="${mode}" data-p="${P}.${key}" data-req="${i}" value="${esc(r[key]??'')}" placeholder="${esc(ph)}" autocomplete="off"></label>`;
    const sel=(key, label, list, cur)=>`<label class="f"><span>${label}</span><select data-req="${i}" data-rk="${key}">${list.map(([v, l])=>`<option value="${esc(v)}"${String(cur)===String(v) ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select></label>`;
    const air=k==='comp' ? `<label class="f"><span>Качество воздуха</span><select data-stl="air" data-i="${i}"><option value="">обычное — осушитель и фильтры по умолчанию</option>${AirChain.options(cls).map(([v, t])=>`<option value="${esc(v)}"${cls===v ? ' selected' : ''}>${esc(t)}</option>`).join('')}</select></label>`
      : k==='dgu' ? sel('mode', 'Назначение', StationReq.MODE, r.mode||'prime') : '';
    const busy=this.busy.has(x.id);
    return `<div class="sq">
      <div class="sq-h"><b>Подбор станции</b><span class="muted">Главное — ниже; остальное программа подберёт сама: оборудование из каталога, контейнер, компоновку и изображения для КП.</span></div>
      <div class="sq-g">${(this.KEYS[k]||[]).map(fld).join('')}${air}${sel('reserve', 'Резерв', StationReq.RES, r.reserve||'')}</div>
      <div class="sq-a"><button class="btn primary" type="button" data-sq="pick" data-i="${i}"${busy ? ' disabled' : ''}>${busy ? 'Подбираю…' : main ? 'Подобрать заново' : 'Подобрать оборудование'}</button>
        ${typeof TzImport!=='undefined' ? `<button class="btn ghost" type="button" data-a="tzLoad" data-i="${i}">Загрузить ТЗ заказчика</button>` : ''}
        ${r.src && r.src.name ? `<span class="muted">по ТЗ «${esc(r.src.name)}»</span>` : ''}</div>
      ${main ? this.result(x, i) : ''}
      <details class="sq-more"${Spoiler.attr('req:'+x.id)}><summary>Все требования, условия расчёта и проверки</summary>${StationReq.details(x, i)}</details></div>`;
  }

  /** итог подбора: статус одной строкой, что подобрано, проверки значками, 3D-вид */
  static result(x, i){
    const plan=StationUi.on(x) && kitContainer(x) ? StationUi.plan(x) : null, R=StationRules.ok() && typeof StationCalc!=='undefined' ? StationCalc.run(x) : null, r=StationReq.of(x);
    const errs=R && !R.accept ? R.errors : [], fit=plan && plan.level==='error' && !plan.assumed, miss=String(r.pick||'').match(/В каталоге нет: ([^]*?)(?: — добавьте вручную|$)/);
    // причина — первой: не помещается; в каталоге нет нужного (из-за этого и ошибки расчёта); ошибка расчёта; нет данных
    const st=fit ? ['bad', '✕ Оборудование не помещается в контейнер'] : miss ? [errs.length ? 'bad' : 'warn', (errs.length ? '✕' : '⚠')+' В каталоге не нашлось: '+miss[1]]
      : errs.length ? ['bad', '✕ '+errs[0].text+(errs.length>1 ? ` (и ещё ${errs.length-1})` : '')] : R && R.questions.length ? ['warn', '⚠ Не хватает данных: '+R.questions[0]]
      : ['ok', '✓ Станция подобрана — требования заказчика выполнены'];
    const chips=R ? R.sections.map(s=>{ const L=s.steps.filter(o=>o.ok===true || o.ok===false), bad=L.some(o=>o.ok===false);
      return L.length ? `<button type="button" class="chip sm ${bad ? 'bad' : 'ok'}" data-edtab="layout" title="Подробный расчёт — вкладка «Компоновка»">${bad ? '✕' : '✓'} ${esc(this.SEC[s.id]||s.title)}</button>` : ''; }).join('') : '';
    const c=kitContainer(x), ct=c ? ctypeOf(c.ctype).name+(String(c.size||'').trim() ? ', '+c.size+' мм' : '') : '';
    return `<div class="sq-r">
      <div class="sq-st ${st[0]}"><b>${esc(st[1])}</b>${fit && plan.suggest ? StationUi.fix(plan.suggest, i) : ''}${!fit && miss ? '<span class="muted">Добавьте позицию в каталог или выберите аналог в составе ниже; затем — «Подобрать заново».</span>' : errs.length && !fit ? '<span class="muted">Замените оборудование в составе ниже или нажмите «Подобрать заново»; подробно — на вкладке «Компоновка».</span>' : ''}</div>
      <div class="sq-b"><div class="sq-l">${this.lines(x).map(t=>`<div>${esc(t)}</div>`).join('')}${ct ? `<div class="muted">${esc(ct)}</div>` : ''}
        ${chips ? `<div class="sq-ck">${chips}</div>` : ''}</div>${this.pic(x, plan)}</div></div>`;
  }

  /** состав коротко: основное оборудование (рабочих + резерв), подготовка воздуха, ресиверы, баки */
  static lines(x){
    const P=kitParts(x).filter(p=>p.role!=='container'), r=StationReq.of(x), res=Math.max(0, Math.round(StationReq.num(r.reserve)||0)), out=[];
    const kinds=[['compressor', ''], ['dgu', ''], ['pump', ''], ['dryer', ''], ['filter', 'Фильтры'], ['receiver', 'Ресиверы'], ['tank', 'Топливный бак']];
    for (const [kind, title] of kinds){ const L=P.filter(p=>StationEquip.kindOf(p)===kind); if (!L.length) continue;
      const n=L.reduce((s, p)=>s+Math.max(1, +p.qty||1), 0);
      if (/^(compressor|dgu|pump)$/.test(kind)){ for (const p of L){ const q=Math.max(1, +p.qty||1), w=res && L.length===1 && q>res ? q-res : 0;
          out.push(`${String(p.name).trim()} × ${q}${w ? ` (${w} рабоч. + ${res} резерв)` : ''}`); } }
      else if (kind==='dryer') out.push(...L.map(p=>`${String(p.name).trim()}${(+p.qty||1)>1 ? ' × '+p.qty : ''}`));
      else if (kind==='filter') out.push(`${title}: ${n} ${n===1 ? 'ступень' : n<5 ? 'ступени' : 'ступеней'}`);
      else if (kind==='receiver'){ const v=L.reduce((s, p)=>s+(AirChain.volume(p)||0)*Math.max(1, +p.qty||1), 0); out.push(`${title}: ${n} шт.${v ? ', всего '+StationLayout.n(v)+' л' : ''}`); }
      else out.push(`${title}: ${L.map(p=>String(p.name).trim()).join(', ')}`); }
    return out;
  }

  /** 3D-вид станции (готовый — сразу, иначе SVG-вид, затем подмена); щелчок — вкладка «Компоновка» */
  static pic(x, plan){
    if (!plan || plan.level==='error' || !plan.geo || !plan.geo.ext) return '';
    const meta=StationUi.meta(x, plan), r3=StationRender.cached(plan);
    if (!r3) StationRender.image(plan, meta).then(im=>{ if (im) for (const el of document.querySelectorAll('img[data-sq3d]')) if (el.dataset.sq3d===plan.hash) el.src=im.src; });
    return `<button type="button" class="sq-pic" data-edtab="layout" title="Компоновка, чертёж и схема"><img src="${esc(r3 ? r3.src : StationUi.url(StationView3D.svg(plan, meta)))}" data-sq3d="${esc(plan.hash||'')}" alt="3D-вид станции"><small>Компоновка и чертежи →</small></button>`;
  }

  static busy = new Set();
  /** «Подобрать оборудование»: требования станции → подбор из каталога, контейнер, компоновка, изображения */
  static async pick(i){
    const x=S.items[i]; if (!x) return; const k=StationReq.kind(x), r=StationReq.ensure(x), need=this.NEED[k];
    if (need && !(StationReq.num(r[need[0]])>0)) return toast('Укажите '+need[1]+' — без неё станцию не подобрать');
    if (kitMainPart(x) && !confirm(`Подобрать оборудование заново? ${k==='comp' ? 'Компрессоры, осушители, фильтры и ресиверы' : k==='dgu' ? 'ДГУ и бак' : 'Насосы'} заменятся подобранными из каталога; контейнер, шкафы и обвязка останутся.`)) return;
    this.busy.add(x.id); renderEditor();
    try{ const note=await TzPick.assemble(x, this.query(x)); r.pick=note.slice(0, 900); persist(); }
    catch(e){ toast('Не получилось подобрать: '+(e && e.message || e)); }
    finally{ this.busy.delete(x.id); }
    renderEditor(); renderForm(); StationImages.soon(x);
    const R=StationRules.ok() ? StationCalc.run(x) : null;
    toast(R && R.errors.length && !R.accept ? 'Подобрано, но не всё выполняется — смотрите строку итога' : 'Станция подобрана и скомпонована — изображения для КП готовятся');
  }
  /** требования станции → запрос подбора (числа) */
  static query(x){
    const r=StationReq.of(x), n=v=>StationReq.num(String(v??'').replace(/[−–]/g, '-').replace(/^\+/, ''))||0;
    return { ...r, kind:StationReq.kind(x), air:StationUi.opts(x).air, flow:n(r.flow), pressure:n(r.pressure), q:n(r.q), head:n(r.head), kw:n(r.kw), hours:n(r.hours), recvVol:n(r.recvVol), work:+r.work||0 };
  }
}
document.addEventListener('click', e=>{ const b=e.target.closest && e.target.closest('[data-sq]'); if (b && b.dataset.sq==='pick') StationQuick.pick(+b.dataset.i); });
