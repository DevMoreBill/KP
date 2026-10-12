// Инженерные правила станций — документ «Инженерные правила и источники» (Word) и вкладка «Настроек»: просмотр правил
// со статусами и источниками, выгрузка файла, загрузка своей версии (проверка структуры — на сервере, app/station_rules.py),
// возврат к файлу поставки. Документ доступен всем (кнопка в «Расчёте станции»), изменение файла — только администратору.
'use strict';

class StationRulesDoc {
  static STATUS = { confirmed:'Подтверждено', practice:'Практика', unconfirmed:'Требует подтверждения' };
  static KIND = { dryer:'Осушители', filter:'Фильтры', genset:'ДГУ' };

  /** значение правила текстом: число, таблица [[x, y]], список, параметры {ключ: значение} */
  static val(v, unit){
    const n=x=>typeof x==='number' ? String(x).replace('.', ',').replace('-', '−') : String(x);
    let t;
    if (Array.isArray(v)) t=v.every(r=>Array.isArray(r) && r.length===2) ? v.map(([x, y])=>`${n(x)} → ${n(y)}`).join('; ') : v.map(x=>Array.isArray(x) ? x.map(n).join(' — ') : n(x)).join('; ');
    else if (v && typeof v==='object') t=Object.entries(v).map(([k, x])=>`${k}: ${x && typeof x==='object' ? this.val(x) : n(x)}`).join('; ');
    else t=n(v);
    return unit && !Array.isArray(v) && (!v || typeof v!=='object') ? t+' '+unit : t;
  }
  static src(s){ return [s && s.doc, s && s.item].filter(Boolean).join(', ')+(s && s.url ? ' — '+s.url : ''); }

  /** правила с сервера (действующая версия) */
  static async load(){ return (await api('/api/rules/stations')).rules; }

  static async download(){
    try{ const d=await this.load(); saveFileA(`Инженерные правила и источники — ${String(d.version||'').replace(/[\\/:*?"<>|]+/g, ' ')}.docx`, await this.make(d)); }
    catch(e){ toast('Не удалось подготовить документ: '+(e && e.message || e)); }
  }

  /** документ .docx (Blob) */
  static make(d){
    const org=typeof StationUi!=='undefined' ? StationUi.org() : 'ПНЕВМОТЕХ', w=new DocxWriter({ title:'Инженерные правила и источники', author:org, footer:'Инженерные правила и источники — версия '+(d.version||'') });
    const R=d.rules||[], cnt=k=>R.filter(r=>r.status===k).length;
    w.title1('Инженерные правила и источники');
    w.p(`Расчёт модульных станций (компрессорных и дизель-генераторных) — версия правил ${d.version||'—'} от ${d.date||'—'}. Правил: ${R.length}; подтверждено источником — ${cnt('confirmed')}, отраслевая практика — ${cnt('practice')}, требует подтверждения — ${cnt('unconfirmed')}. Данных производителей по сериям: ${(d.series||[]).length}.`, { align:'center' });
    w.h1('Как читать');
    w.items([
      'Подтверждено — значение взято из нормативного документа или каталога производителя (указан пункт или страница).',
      'Практика — принятое в отрасли значение (методическая литература, руководства производителей), обязательной нормы нет.',
      'Требует подтверждения — значение принято программой до получения данных производителя или заказчика; в расчётной записке такие пункты перечисляются отдельно и в КП попадают в раздел «Требует подтверждения».',
      'Правило меняется только новой версией файла правил («Настройки» → «Инженерные правила станций»): прежняя версия сохраняется, вернуть файл поставки можно одной кнопкой.']);
    const groups=[...new Set(R.map(r=>r.group||'Прочее'))];
    groups.forEach((g, gi)=>{ w.h1(`${gi+1}. ${g}`);
      w.table([10, 46, 44, 60, 20], ['№', 'Правило', 'Значение', 'Источник', 'Статус'], R.filter(r=>(r.group||'Прочее')===g).map((r, k)=>[
        `${gi+1}.${k+1}`, [[r.title, { b:true }], ...(r.note ? [['\n'+r.note, { sz:8.5, color:'5E6984' }]] : []), ['\n'+r.id, { sz:8, color:'8A94A8' }]], this.val(r.value, r.unit), this.src(r.source), this.STATUS[r.status]||r.status])); });
    const S=d.series||[];
    if (S.length){ w.h1(`${groups.length+1}. Данные производителей по сериям`);
      w.p('Поправочные коэффициенты производителя применяются, если позиция каталога относится к серии (производитель и выражение по названию, модели, серии). Производительность с поправками = номинал × Fдавление × Fвход × Fокружающая.');
      w.table([28, 34, 70, 48], ['Вид, производитель', 'Серия', 'Поправки', 'Источник'], S.map(s=>[`${this.KIND[s.kind]||s.kind}, ${s.maker}`, [[s.title||'', { b:true }], ['\n'+(s.note||''), { sz:8.5, color:'5E6984' }]],
        Object.entries(s.f||{}).map(([k, T])=>`${{ p:'давление, бар', inlet:'вход, °C', ambient:'окружающая, °C' }[k]||k}: ${this.val(T)}`).join('\n'), this.src(s.source)])); }
    const U=R.filter(r=>r.status==='unconfirmed');
    if (U.length){ w.h1('Требует подтверждения — что запросить'); w.items(U.map(r=>`${r.title} (${r.id}) — сейчас ${this.val(r.value, r.unit)}${r.note ? '. '+r.note : ''}`)); }
    return w.pack('blob');
  }
}

// ---------------------------------------------------------------- редактор матрицы расстановки (правила станций)
// Значения расстановки — таблицами, без правки файла: расстояния между соседями, отступы от стен и проходы, стороны
// обслуживания, поворот, ворота, двери, выходы. «Сохранить» — новая версия правил (номер версии +1), проверка — на сервере.
class StationMatrixEditor {
  static KINDS = ['compressor', 'dryer', 'receiver', 'filter', 'pump', 'dgu', 'cabinet', 'tank', 'other'];
  static CLEAR = [['back', 'сзади'], ['side', 'сбоку'], ['top', 'сверху']];
  static SIDES = [['Ф', 'фронт'], ['З', 'зад'], ['Л', 'левый бок'], ['П', 'правый бок']];
  static SCALARS = [
    ['gap', 'v', 'Зазор на коммуникации G (компрессорная), мм'],
    ['access', 'back', 'Сзади меньше этого — нужны сервисные ворота в стене, мм'], ['access', 'side', 'Проход обслуживания сбоку, мм'],
    ['gate', 'addW', 'Ворота торца: ширина = ширина агрегата + …, мм'], ['gate', 'addH', 'Ворота торца: высота = высота агрегата + …, мм'],
    ['gate', 'minW', 'Ворота торца: ширина не менее, мм'], ['gate', 'full', 'Во весь торец, если ширина ≥ доли ширины станции'],
    ['gate', 'twoAt', 'Ворота с обоих торцов, если цепочка длиннее, мм'],
    ['service', 'addW', 'Сервисные ворота: ширина = длина агрегата + …, мм'], ['service', 'addH', 'Сервисные ворота: высота = высота агрегата + …, мм'],
    ['door', 'w', 'Дверь оператора: ширина (900–1000), мм'], ['door', 'h', 'Дверь оператора: высота (2000–2100), мм'],
    ['aisle', 'service', 'Проход обслуживания (крайний), мм'], ['aisle', 'mountAdd', 'Монтажный проход = ширина агрегата + …, мм'],
    ['exits', 'n', 'Выходов не менее'], ['exits', 'dist', 'Между выходами не менее, мм'],
    ['exhaust', 'louvre', 'Жалюзи выброса над воротами: высота, мм']];

  constructor(panel){ this.p=panel; this.w=null; }
  static label(k){ return ({ ...StationEquip.LABEL, other:'Прочее' })[k] || k; }
  static rule(d, id){ return ((d && d.rules) || []).find(r=>r.id===id); }
  static copy(v){ return JSON.parse(JSON.stringify(v)); }
  /** рабочая копия: матрица (недостающее — значения программы), проходы, отступы */
  load(){
    const d=this.p.data, R=id=>StationMatrixEditor.rule(d, id), m=R('layout.matrix'), D=StationMatrix.DEF, v=m && m.value && typeof m.value==='object' ? m.value : {};
    const mx={}; for (const k of Object.keys(D)) mx[k]=StationMatrixEditor.copy(v[k] && typeof v[k]==='object' ? { ...D[k], ...v[k] } : D[k]);
    this.w={ m:mx, a:StationMatrixEditor.copy((R('norm.aisle') || {}).value || [1000, 800]), t:+((R('norm.aisle_tight') || {}).value || 600),
      c:StationMatrixEditor.copy((R('clear.kind') || {}).value || {}) };
  }
  static n(v){ return typeof v==='number' ? String(v).replace('.', ',') : ''; }
  inp(path, v, w=70){ return `<input type="text" inputmode="decimal" data-mx="${esc(path)}" value="${esc(StationMatrixEditor.n(v))}" style="width:${w}px">`; }
  sel(path, v, opts){ return `<select data-mx="${esc(path)}">${opts.map(([k, t])=>`<option value="${esc(k)}"${k===v ? ' selected' : ''}>${esc(t)}</option>`).join('')}</select>`; }
  html(){
    if (!this.w) this.load();
    const E=StationMatrixEditor, M=this.w.m, K=E.KINDS.map(k=>[k, E.label(k)]), C=this.w.c;
    const pair=(M.pair.rows||[]).map((r, j)=>`<tr><td>${this.sel(`m|pair.rows.${j}.a`, r.a, K)} ↔ ${this.sel(`m|pair.rows.${j}.b`, r.b, K)}</td>
      <td>${this.inp(`m|pair.rows.${j}.base`, r.base)}</td><td>${this.inp(`m|pair.rows.${j}.k`, r.k, 52)} × ${this.sel(`m|pair.rows.${j}.of`, r.of||'', [['', '—'], ...[...new Set([r.a, r.b])].map(k=>[k+'.w', 'ширина: '+E.label(k).toLowerCase()])])}</td>
      <td>${this.inp(`m|pair.rows.${j}.min`, r.min)}</td><td><input type="checkbox" data-mx="m|pair.rows.${j}.close"${r.close ? ' checked' : ''} aria-label="Вплотную допускается"></td>
      <td><button class="icon" type="button" data-mxdel="${j}" aria-label="Убрать строку">✕</button></td></tr>`).join('');
    const wall=(M.wall.rows||[]).map((r, j)=>`<tr><td>${esc(E.label(r.kind))}</td><td>${this.inp(`m|wall.rows.${j}.base`, r.base)}</td><td>${this.inp(`m|wall.rows.${j}.k`, r.k, 52)} × ширина</td><td>${this.inp(`m|wall.rows.${j}.tight`, r.tight)}</td></tr>`).join('');
    const clear=Object.keys(C).map(k=>`<tr><td>${esc(E.label(k))}</td>${E.CLEAR.map(([s])=>Array.isArray(C[k][s]) ? `<td>${this.inp(`c|${k}.${s}.0`, C[k][s][0], 58)} / ${this.inp(`c|${k}.${s}.1`, C[k][s][1], 58)}</td>` : '<td>—</td>').join('')}</tr>`).join('');
    const rot=new Map((M.rotate.rows||[]).map(r=>[r.kind, r.on!==false]));
    const sides=(M.sides.rows||[]).map((r, j)=>`<tr><td>${esc(E.label(r.kind))}</td>${E.SIDES.map(([c, t])=>`<td><input type="checkbox" data-mxs="${j}" value="${c}"${String(r.s||'').includes(c) ? ' checked' : ''} aria-label="${esc(t)}"></td>`).join('')}
      <td>${rot.has(r.kind) ? `<input type="checkbox" data-mx="r|${esc(r.kind)}"${rot.get(r.kind) ? ' checked' : ''} aria-label="Можно повернуть">` : '—'}</td></tr>`).join('');
    const sc=E.SCALARS.map(([g, k, t])=>`<label class="f"><span>${esc(t)}</span>${this.inp(`m|${g}.${k}`, M[g][k], 90)}</label>`).join('');
    return `<p class="muted" style="margin:6px 0">Как программа расставляет оборудование. Расстояние «рекомендуется» = max(база, коэффициент × размер); если станция иначе не в габарите —
        не меньше «не менее»; вплотную — только где отмечено (ресиверы, фильтры). Сохранение — новая версия правил, прежняя остаётся для отката.</p>
      <h4 class="mx-h">Между соседними агрегатами по длине, мм</h4>
      <div class="tzi-tw mx-tw"><table class="tzi-t mx-t"><thead><tr><th>Пара</th><th>База</th><th>Коэффициент × размер</th><th>Не менее</th><th>Вплотную</th><th></th></tr></thead><tbody>${pair}</tbody></table></div>
      <button class="btn ghost sm" type="button" data-rl="mxadd">+ пара</button>
      <h4 class="mx-h">Отступ за агрегатом от стены, мм</h4>
      <div class="tzi-tw mx-tw"><table class="tzi-t mx-t"><thead><tr><th>Вид</th><th>База</th><th>Коэффициент</th><th>Плотно (с сервисными воротами)</th></tr></thead><tbody>${wall}</tbody></table></div>
      <h4 class="mx-h">Отступы от стен и соседей: рекомендуемый / допустимый, мм</h4>
      <div class="tzi-tw mx-tw"><table class="tzi-t mx-t"><thead><tr><th>Вид</th>${E.CLEAR.map(([, t])=>`<th>${t}</th>`).join('')}</tr></thead><tbody>${clear}</tbody></table></div>
      <h4 class="mx-h">Обслуживаемые стороны и поворот</h4>
      <div class="tzi-tw mx-tw"><table class="tzi-t mx-t"><thead><tr><th>Вид</th>${E.SIDES.map(([, t])=>`<th>${t}</th>`).join('')}<th>Можно повернуть</th></tr></thead><tbody>${sides}</tbody></table></div>
      <h4 class="mx-h">Проходы, ворота, двери, выходы</h4>
      <div class="mx-sc"><label class="f"><span>Проход оператора: основной, мм</span>${this.inp('a|0', this.w.a[0], 90)}</label><label class="f"><span>Проход оператора: допустимый, мм</span>${this.inp('a|1', this.w.a[1], 90)}</label>
        <label class="f"><span>Проход в крайнем случае (не менее 600), мм</span>${this.inp('t|', this.w.t, 90)}</label>${sc}</div>
      <div class="row" style="gap:8px;flex-wrap:wrap;margin-top:10px"><button class="btn" type="button" data-rl="mxsave">Сохранить матрицу</button><button class="btn ghost" type="button" data-rl="mxdef">Значения программы</button></div>`;
  }
  /** поля окна → рабочая копия; ошибка ввода — текстом */
  read(root){
    const w=this.w, put=(o, path, v)=>{ const k=path.split('.'); let x=o; for (const p of k.slice(0, -1)) x=x[p]; x[k[k.length-1]]=v; };
    for (const el of root.querySelectorAll('[data-mx]')){
      const [t, path]=el.dataset.mx.split('|');
      let v; if (el.type==='checkbox') v=el.checked; else if (el.tagName==='SELECT') v=el.value;
      else { const s=el.value.trim().replace(/\s+/g, '').replace(',', '.'); v=+s; if (!s || !Number.isFinite(v) || v<0) throw new Error('Не число: «'+el.value+'» — '+(el.closest('tr,label')||el).textContent.trim().slice(0, 60)); }
      if (t==='m') put(w.m, path, v); else if (t==='c') put(w.c, path, v); else if (t==='a') w.a[+path]=v; else if (t==='t') w.t=v;
      else if (t==='r'){ const r=(w.m.rotate.rows||[]).find(q=>q.kind===path); if (r) r.on=v; } }
    (w.m.sides.rows||[]).forEach((r, j)=>{ r.s=[...root.querySelectorAll(`[data-mxs="${j}"]`)].filter(c=>c.checked).map(c=>c.value).join('') || 'Ф'; });
  }
  add(root){ this.read(root); this.w.m.pair.rows.push({ a:'other', b:'other', base:500, k:0, of:'', min:300, close:false }); }
  del(root, j){ this.read(root); this.w.m.pair.rows.splice(j, 1); }
  reset(){ this.w.m=StationMatrixEditor.copy(StationMatrix.DEF); }
  /** новая версия правил с этой матрицей: номер версии +1 («…-н1», «…-н2»), источник — правка в «Настройках» */
  build(){
    const d=StationMatrixEditor.copy(this.p.data), w=this.w, day=new Date().toLocaleDateString('ru-RU');
    if (w.a[1]>w.a[0]) throw new Error('Проход оператора: допустимый больше основного');
    if (w.t<600) throw new Error('Проход в крайнем случае — не менее 600 мм (решение владельца)');
    for (const r of w.m.pair.rows) if (r.min>Math.max(r.base, 0) && !r.k) throw new Error(`Пара ${StationMatrixEditor.label(r.a)} ↔ ${StationMatrixEditor.label(r.b)}: «не менее» больше базы`);
    const set=(id, value, base)=>{ let r=StationMatrixEditor.rule(d, id); if (!r){ r={ ...base }; d.rules.push(r); }
      if (JSON.stringify(r.value)!==JSON.stringify(value)){ r.value=value; r.source={ ...(r.source||{}), item:'правка в «Настройках» '+day }; } };
    set('layout.matrix', w.m, { id:'layout.matrix', group:'Компоновка', title:'Матрица расстановки оборудования', status:'practice', unit:'мм', source:{ doc:'Решение ПНЕВМОТЕХ' } });
    set('norm.aisle', w.a, { id:'norm.aisle', group:'Нормы помещения', title:'Проход обслуживания: рекомендуемый, допустимый', status:'practice', unit:'мм', source:{ doc:'Решение ПНЕВМОТЕХ' } });
    set('norm.aisle_tight', w.t, { id:'norm.aisle_tight', group:'Компоновка', title:'Проход оператора в крайнем случае', status:'practice', unit:'мм', source:{ doc:'Решение ПНЕВМОТЕХ' } });
    set('clear.kind', w.c, { id:'clear.kind', group:'Компоновка', title:'Отступы от стен и соседнего оборудования', status:'practice', unit:'мм', source:{ doc:'Решение ПНЕВМОТЕХ' } });
    const v=String(d.version||'1'), m=/-н(\d+)$/.exec(v);
    d.version=(m ? v.slice(0, m.index) : v).slice(0, 34)+'-н'+(m ? +m[1]+1 : 1);
    d.date=new Date().toISOString().slice(0, 10); delete d._saved;
    return d;
  }
}

// ---------------------------------------------------------------- вкладка «Настроек»: инженерные правила станций
class RulesPanel {
  constructor(m){ this.m=m; this.info=null; this.data=null; this.flt=''; this.mx=new StationMatrixEditor(this); this.mxOpen=false; }
  async open(){
    try{ const [a, d]=await Promise.all([aapi('rules/stations'), StationRulesDoc.load()]); this.info=a.info; this.data=d; }
    catch(e){ this.m.innerHTML=`<p class="msg err">${esc(e.message||e)}</p>`; return; }
    this.render(); this.bind();
  }
  render(){
    const box=this.m.querySelector('[data-mxbox]'); if (box && this.mx.w) try{ this.mx.read(box); } catch(e){ /* неверное число — останется прежнее значение */ }
    const i=this.info||{}, d=this.data||{ rules:[] }, st=StationRulesDoc.STATUS, R=(d.rules||[]).filter(r=>!this.flt || r.status===this.flt);
    const chip={ confirmed:'on', practice:'', unconfirmed:'warn' };
    this.m.innerHTML=`<div class="st-card"><p style="margin:0">Действует версия <b>${esc(i.version||'—')}</b> от ${esc(i.date||'—')} — ${i.own ? `своя версия администратора${i.saved ? ` (загружена ${esc(String(i.saved.at||'').replace('T', ' '))}${i.saved.by ? ', '+esc(i.saved.by) : ''})` : ''}; в поставке — ${esc(i.bundled||'')}` : 'файл поставки программы'}.
        Правил: ${i.rules||0} (подтверждено — ${(i.byStatus||{}).confirmed||0}, практика — ${(i.byStatus||{}).practice||0}, требует подтверждения — ${(i.byStatus||{}).unconfirmed||0}); данных производителей по сериям: ${i.series||0}.</p>
        <div class="row" style="gap:8px;flex-wrap:wrap;margin-top:8px"><button class="btn" type="button" data-rl="doc">Документ «Инженерные правила и источники» (DOCX)</button>
          <button class="btn ghost" type="button" data-rl="json">Скачать файл правил (JSON)</button><button class="btn ghost" type="button" data-rl="up">Загрузить свою версию…</button>
          ${i.own ? '<button class="btn ghost" type="button" data-rl="reset">Вернуть файл поставки</button>' : ''}</div>
        <p class="muted" style="margin:8px 0 0">Свою версию готовят из скачанного файла: меняют значение, источник и статус правила, номер версии. Программа проверит структуру и не примет файл с ошибкой; прежняя версия сохраняется.</p></div>
      <details class="st-card mx"${this.mxOpen ? ' open' : ''} data-mxbox><summary><b>Матрица расстановки оборудования</b> <span class="muted">— расстояния, отступы, стороны обслуживания, ворота, двери, выходы</span></summary>${this.mx.html()}</details>
      <div class="st-card"><label class="f" style="max-width:320px"><span>Показать</span><select data-rlf data-nodirty><option value="">все правила</option>${Object.entries(st).map(([k, t])=>`<option value="${k}"${this.flt===k ? ' selected' : ''}>${esc(t)}</option>`).join('')}</select></label>
        <div class="tzi-tw" style="max-height:none"><table class="tzi-t"><thead><tr><th>Правило</th><th>Значение</th><th>Статус</th><th>Источник</th></tr></thead><tbody>
        ${R.map(r=>`<tr><td><b>${esc(r.title)}</b><div class="muted">${esc(r.group||'')} · ${esc(r.id)}</div>${r.note ? `<div class="muted">${esc(r.note)}</div>` : ''}</td><td>${esc(StationRulesDoc.val(r.value, r.unit))}</td>
          <td><span class="chip sm ${chip[r.status]||''}">${esc(st[r.status]||r.status)}</span></td><td>${esc(StationRulesDoc.src(r.source))}</td></tr>`).join('')}</tbody></table></div></div>`;
  }
  bind(){
    this.m.onchange=e=>{ if (e.target.matches('[data-rlf]')){ this.flt=e.target.value; this.render(); }
      else if (/^m\|pair\.rows\.\d+\.[ab]$/.test(e.target.dataset.mx||'')){ try{ this.mx.read(this.m.querySelector('[data-mxbox]')); this.render(); } catch(er){ toast(er.message); } } };
    this.m.addEventListener('toggle', e=>{ if (e.target.matches && e.target.matches('[data-mxbox]')) this.mxOpen=e.target.open; }, true);
    this.m.onclick=async e=>{ const box=this.m.querySelector('[data-mxbox]'), dl=e.target.closest('[data-mxdel]');
      if (dl){ try{ this.mx.del(box, +dl.dataset.mxdel); this.render(); } catch(er){ toast(er.message); } return; }
      const b=e.target.closest('[data-rl]'); if (!b) return; const a=b.dataset.rl;
      if (a==='mxadd'){ try{ this.mx.add(box); this.render(); } catch(er){ toast(er.message); } return; }
      if (a==='mxdef'){ if (!confirm('Вернуть в форму значения матрицы, заложенные в программу? Сохранятся только после «Сохранить матрицу».')) return; this.mx.reset(); this.render(); return; }
      if (a==='mxsave'){ let d; try{ this.mx.read(box); d=this.mx.build(); } catch(er){ return toast(er.message); }
        return this.post({ method:'POST', headers:{ 'Content-Type':'application/json; charset=utf-8' }, body:JSON.stringify(d) }); }
      if (a==='doc') return StationRulesDoc.download();
      if (a==='json') return saveFileA(`Правила станций ${this.data.version||''}.json`, new Blob([JSON.stringify(this.data, null, 1)], { type:'application/json' }));
      if (a==='reset'){ if (!confirm('Вернуть файл правил из поставки программы? Своя версия сохранится как предыдущая.')) return; return this.post({ method:'POST', body:'' }, '?reset=1'); }
      if (a==='up'){ const f=$('#filePick'); f.value=''; f.multiple=false; f.accept='.json';
        f.onchange=()=>{ const fl=f.files[0]; f.accept=''; if (!fl) return; if (fl.size>2*1024*1024) return toast('Файл больше 2 МБ');
          this.post({ method:'POST', headers:{ 'Content-Type':'application/json; charset=utf-8' }, body:fl }); };
        f.click(); } };
  }
  async post(opts, qs=''){
    try{ const r=await aapi('rules/stations'+qs, opts); this.info=r.info; this.data=await StationRulesDoc.load(); StationRules.use(this.data); this.mx.w=null;
      if (typeof StationUi!=='undefined') StationUi.cache.clear(); if (typeof StationCalc!=='undefined') StationCalc.cache.clear();
      toast('Правила станций: версия '+(this.info.version||'')); this.render(); }
    catch(e){ toast('Файл не принят: '+(e.message||e)); }
  }
}
document.addEventListener('click', e=>{ if (e.target.closest && e.target.closest('[data-rulesdoc]')) StationRulesDoc.download(); });
