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
    if (typeof LayoutDigest!=='undefined'){ w.h1('Свод правил компоновки');
      w.p('Как программа компонует станцию — по действующим значениям этой версии правил (правятся в «Настройки → Инженерные правила станций → Правила компоновки»).');
      for (const s of LayoutDigest.sections()){ w.p(s.h, { run:{ b:true }, keep:true }); w.items(s.items); } }
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

// ---------------------------------------------------------------- правила компоновки (Настройки → Инженерные правила станций)
// Все параметры расстановки — понятной формой, без правки файла: разделы (размер контейнера и габарит перевозки,
// исключения, двери, ворота, сервисные ворота, проходы, ресиверы, выброс, шкафы, бак ДГУ, конвекторы, глушитель) — у
// каждого числа подпись, единица, пределы, значение по умолчанию и «↺» (вернуть); таблицы — расстояния между соседями,
// отступ от стены, отступы по видам, стороны обслуживания. Над формой — свод «как программа компонует» по действующим
// значениям. «Сохранить» — новая версия правил (номер версии +1), прежняя остаётся для отката; проверка — на сервере.
class LayoutEditor {
  static KINDS = ['compressor', 'dryer', 'receiver', 'filter', 'pump', 'dgu', 'cabinet', 'tank', 'other'];
  static CLEAR = [['back', 'сзади'], ['side', 'сбоку'], ['top', 'сверху']];
  static SIDES = [['Ф', 'спереди'], ['З', 'сзади'], ['Л', 'слева'], ['П', 'справа']];
  static OF = { compressor:'ширины компрессора', dryer:'ширины осушителя', receiver:'Ø ресивера', pump:'ширины насоса', filter:'ширины фильтра', other:'ширины' };
  static AISLE = [1000, 800];
  static TIGHT = 600;

  constructor(panel){ this.p=panel; this.w=null; this.q=''; }
  static label(k){ return ({ ...StationEquip.LABEL, other:'Прочее' })[k] || k; }
  static rule(d, id){ return ((d && d.rules) || []).find(r=>r.id===id); }
  static copy(v){ return JSON.parse(JSON.stringify(v)); }
  static n(v){ return typeof v==='number' ? String(v).replace('.', ',') : ''; }
  /** рабочая копия: матрица (недостающее — значения программы), проходы, отступы */
  load(){
    const d=this.p.data, R=id=>LayoutEditor.rule(d, id), m=R('layout.matrix'), D=StationMatrix.DEF, v=m && m.value && typeof m.value==='object' ? m.value : {};
    const mx={}; for (const k of Object.keys(D)) mx[k]=LayoutEditor.copy(v[k] && typeof v[k]==='object' ? { ...D[k], ...v[k] } : D[k]);
    this.w={ m:mx, a:LayoutEditor.copy((R('norm.aisle') || {}).value || LayoutEditor.AISLE), t:+((R('norm.aisle_tight') || {}).value || LayoutEditor.TIGHT),
      c:LayoutEditor.copy((R('clear.kind') || {}).value || {}) };
  }
  inp(path, v, w=76){ return `<input type="text" inputmode="decimal" data-mx="${esc(path)}" value="${esc(LayoutEditor.n(v))}" style="width:${w}px">`; }
  sel(path, v, opts){ return `<select data-mx="${esc(path)}">${opts.map(([k, t])=>`<option value="${esc(k)}"${String(k)===String(v) ? ' selected' : ''}>${esc(t)}</option>`).join('')}</select>`; }
  /** строка числа: подпись (и пояснение), поле с единицей, «по умолчанию …» и «↺» */
  row(path, label, v, def, f, hint){
    const chg=def!=null && String(v)!==String(def), u=f && f.u && f.u!=='доля' ? `<i>${esc(f.u)}</i>` : '';
    const ctl=f && f.opt ? this.sel(path, v, f.opt) : this.inp(path, v)+u;
    const lim=f && !f.opt ? `от ${LayoutParams.show({}, f.lo)} до ${LayoutParams.show({}, f.hi)}` : '';
    return `<div class="lp-r${chg ? ' chg' : ''}" data-lps="${esc((label+' '+(hint||'')).toLowerCase())}"><div class="lp-t">${esc(label)}${hint ? `<small>${esc(hint)}</small>` : ''}</div>
      <div class="lp-v">${ctl}</div><div class="lp-d">${def!=null ? `по умолчанию ${esc(f ? LayoutParams.show(f, def) : String(def))}` : ''}${lim ? `<small>${esc(lim)}</small>` : ''}${chg ? ` <button class="icon" type="button" data-lpdef="${esc(path)}" title="Вернуть значение по умолчанию" aria-label="Вернуть значение по умолчанию">↺</button>` : ''}</div></div>`;
  }
  sec(id, title, hint, body, open){ return `<details class="lp-s" data-lpsec="${esc(id)}"${open ? ' open' : ''}><summary><b>${esc(title)}</b></summary>${hint ? `<p class="muted lp-h">${esc(hint)}</p>` : ''}${body}</details>`; }
  html(){
    if (!this.w) this.load();
    const E=LayoutEditor, M=this.w.m, D=StationMatrix.DEF, K=E.KINDS.map(k=>[k, E.label(k)]), C=this.w.c, on=!!this.q;
    const secs=LayoutParams.SECTIONS.map(s=>{
      let body=s.f.map(f=>this.row(`m|${f.g}.${f.k}`, f.t, M[f.g][f.k], D[f.g][f.k], f, f.h)).join('');
      if (s.id==='aisle') body=this.row('a|0', 'Проход оператора: рекомендуется', this.w.a[0], E.AISLE[0], { u:'мм', lo:600, hi:3000 }, 'Вдоль оборудования, от двери.')
        +this.row('a|1', 'Проход оператора: допустимо (плотная компоновка)', this.w.a[1], E.AISLE[1], { u:'мм', lo:600, hi:3000 }, 'ПУЭ, п. 4.1.23: не менее 0,8 м.')
        +this.row('t|', 'Проход оператора: в крайнем случае (исключение)', this.w.t, E.TIGHT, { u:'мм', lo:600, hi:3000 }, 'Решение ПНЕВМОТЕХ 12.10: не меньше 600 мм; только ради габарита перевозки.')+body;
      return this.sec(s.id, s.title, s.t, body, on || s.id==='fit'); });
    const pair=(M.pair.rows||[]).map((r, j)=>`<tr><td>${this.sel(`m|pair.rows.${j}.a`, r.a, K)} ↔ ${this.sel(`m|pair.rows.${j}.b`, r.b, K)}</td>
      <td>${this.inp(`m|pair.rows.${j}.base`, r.base, 70)}</td><td>${this.inp(`m|pair.rows.${j}.k`, r.k, 52)} × ${this.sel(`m|pair.rows.${j}.of`, r.of||'', [['', '—'], ...[...new Set([r.a, r.b])].map(k=>[k+'.w', E.OF[k]||'ширины'])])}</td>
      <td>${this.inp(`m|pair.rows.${j}.min`, r.min, 70)}</td><td><input type="checkbox" data-mx="m|pair.rows.${j}.close"${r.close ? ' checked' : ''} aria-label="Вплотную можно"></td>
      <td><button class="icon" type="button" data-mxdel="${j}" aria-label="Убрать строку">✕</button></td></tr>`).join('');
    const wall=(M.wall.rows||[]).map((r, j)=>`<tr><td>${esc(E.label(r.kind))}</td><td>${this.inp(`m|wall.rows.${j}.base`, r.base, 70)}</td><td>${this.inp(`m|wall.rows.${j}.k`, r.k, 52)} × глубины</td><td>${this.inp(`m|wall.rows.${j}.tight`, r.tight, 70)}</td></tr>`).join('');
    const clear=Object.keys(C).map(k=>`<tr><td>${esc(E.label(k))}</td>${E.CLEAR.map(([s])=>Array.isArray(C[k][s]) ? `<td>${this.inp(`c|${k}.${s}.0`, C[k][s][0], 58)} / ${this.inp(`c|${k}.${s}.1`, C[k][s][1], 58)}</td>` : '<td>—</td>').join('')}</tr>`).join('');
    const rot=new Map((M.rotate.rows||[]).map(r=>[r.kind, r.on!==false]));
    const sides=(M.sides.rows||[]).map((r, j)=>`<tr><td>${esc(E.label(r.kind))}</td>${E.SIDES.map(([c, t])=>`<td><input type="checkbox" data-mxs="${j}" value="${c}"${String(r.s||'').includes(c) ? ' checked' : ''} aria-label="${esc(t)}"></td>`).join('')}
      <td>${rot.has(r.kind) ? `<input type="checkbox" data-mx="r|${esc(r.kind)}"${rot.get(r.kind) ? ' checked' : ''} aria-label="Можно повернуть">` : '—'}</td>
      <td><input type="checkbox" data-mx="m|sides.rows.${j}.door"${StationMatrix.noDoor(r.kind) ? '' : ' checked'} aria-label="Сервисные ворота можно"></td>
      <td><input type="checkbox" data-mx="m|sides.rows.${j}.tilt"${r.tilt ? ' checked' : ''} aria-label="Можно наклонить при выносе"></td></tr>`).join('');
    const tables=[
      this.sec('pair', 'Расстояния между соседними агрегатами по длине', 'Рекомендуется — большее из «не меньше» и «доля × размер»; «плотно» — при плотной компоновке (по умолчанию); вплотную — только где отмечено и только в заданном контейнере.',
        `<div class="tzi-tw mx-tw"><table class="tzi-t mx-t"><thead><tr><th>Пара</th><th>Рекомендуется не меньше, мм</th><th>и не меньше доли размера</th><th>Плотно, мм</th><th>Вплотную можно</th><th></th></tr></thead><tbody>${pair}</tbody></table></div>
        <button class="btn ghost sm" type="button" data-rl="mxadd">+ пара</button>`, on),
      this.sec('wall', 'Отступ за агрегатом от стены', '«Плотно» — с сервисными воротами в стене за агрегатом (только тем, кому они разрешены в таблице «Стороны»).',
        `<div class="tzi-tw mx-tw"><table class="tzi-t mx-t"><thead><tr><th>Вид</th><th>Рекомендуется не меньше, мм</th><th>и не меньше доли</th><th>Плотно, мм</th></tr></thead><tbody>${wall}</tbody></table></div>`, on),
      this.sec('clear', 'Отступы по видам: рекомендуется / допустимо', 'Сзади, сбоку и сверху до стены, потолка и соседнего оборудования, мм. Паспорт конкретной модели важнее.',
        `<div class="tzi-tw mx-tw"><table class="tzi-t mx-t"><thead><tr><th>Вид</th>${E.CLEAR.map(([, t])=>`<th>${t}</th>`).join('')}</tr></thead><tbody>${clear}</tbody></table></div>`, on),
      this.sec('sides', 'Стороны обслуживания, поворот, сервисные ворота, вынос', 'Отмечены стороны, к которым нужен доступ. «Сервисные ворота» снято — монтаж и демонтаж только через ворота в торце (решение ПНЕВМОТЕХ 13.10: осушители и ресиверы).',
        `<div class="tzi-tw mx-tw"><table class="tzi-t mx-t"><thead><tr><th>Вид</th>${E.SIDES.map(([, t])=>`<th>${t}</th>`).join('')}<th>Можно повернуть</th><th>Сервисные ворота</th><th>Наклонить при выносе</th></tr></thead><tbody>${sides}</tbody></table></div>`, on)];
    return `<div class="lp-top"><label class="f lp-q"><span>Найти параметр</span><input type="search" data-lpq data-nodirty value="${esc(this.q)}" placeholder="например: ворота, ресивер, габарит" autocomplete="off"></label>
        <span class="muted">Изменённые значения подсвечены; «↺» — вернуть значение по умолчанию. Сохранение — новая версия правил, прежняя остаётся для отката.</span></div>
      ${this.presets()}
      <details class="lp-s lp-dg"><summary><b>Как программа компонует станцию — свод по действующим значениям</b></summary>${LayoutDigest.html()}</details>
      ${secs.join('')}${tables.join('')}
      <div class="row lp-go"><button class="btn primary" type="button" data-rl="mxsave">Сохранить правила компоновки</button><button class="btn ghost" type="button" data-rl="mxdef">Все значения — по умолчанию</button></div>`;
  }
  /** готовые наборы правил: кнопка — заполнить форму (сохранится после «Сохранить правила компоновки») */
  presets(){
    const cur=LayoutParams.which(this.w.m);
    return `<div class="lp-pre"><span class="lp-pre-h"><b>Готовые наборы</b> <span class="muted">— сейчас: ${esc(cur ? cur.title.toLowerCase() : 'свои значения')}</span></span>
      ${LayoutParams.PRESETS.map(P=>`<button type="button" class="lp-pb${cur && cur.id===P.id ? ' on' : ''}" data-lppre="${esc(P.id)}"><b>${esc(P.title)}</b><small>${esc(P.t)}</small></button>`).join('')}</div>`;
  }
  /** набор → форма (только стратегия подбора; нормы отступов не меняются) */
  usePreset(id){ const v=LayoutParams.preset(id); if (!v) return; for (const [k, x] of Object.entries(v)){ const [g, f]=k.split('.'); this.w.m[g][f]=x; } }
  /** поиск параметра: строки и разделы без совпадений скрыты */
  filter(root){
    const q=this.q.trim().toLowerCase();
    for (const s of root.querySelectorAll('[data-lpsec]')){
      let hit=!q || s.querySelector('summary').textContent.toLowerCase().includes(q);
      for (const r of s.querySelectorAll('.lp-r')){ const m=!q || hit || r.dataset.lps.includes(q); r.hidden=!m; if (m) hit=true; }
      for (const t of s.querySelectorAll('tbody tr')){ const m=!q || hit || t.textContent.toLowerCase().includes(q) || [...t.querySelectorAll('select')].some(x=>x.selectedOptions[0] && x.selectedOptions[0].textContent.toLowerCase().includes(q)); if (m) hit=true; }
      s.hidden=!hit; if (q && hit) s.open=true; }
  }
  /** поля окна → рабочая копия; ошибка ввода — текстом с названием поля */
  read(root){
    const w=this.w, put=(o, path, v)=>{ const k=path.split('.'); let x=o; for (const p of k.slice(0, -1)) x=x[p]; x[k[k.length-1]]=v; };
    for (const el of root.querySelectorAll('[data-mx]')){
      const [t, path]=el.dataset.mx.split('|');
      let v; if (el.type==='checkbox') v=el.checked; else if (el.tagName==='SELECT') v=/^-?\d+$/.test(el.value) && !/\.(a|b|of)$/.test(path) ? +el.value : el.value;
      else { const s=el.value.trim().replace(/\s+/g, '').replace(',', '.'); v=+s;
        const lab=(el.closest('.lp-r') && el.closest('.lp-r').querySelector('.lp-t').firstChild.textContent) || (el.closest('tr,label')||el).textContent.trim().slice(0, 60);
        if (!s || !Number.isFinite(v) || v<0) throw new Error(`Не число: «${el.value}» — ${lab}`);
        const f=t==='m' ? LayoutParams.field(...path.split('.')) : null;
        if (f && (v<f.lo || v>f.hi)) throw new Error(`${lab}: от ${LayoutParams.show({}, f.lo)} до ${LayoutParams.show({}, f.hi)}${f.u && f.u!=='доля' ? ' '+f.u : ''}`); }
      if (t==='m'){ if (/^sides\.rows\.\d+\.door$/.test(path)) v=!!v; else if (/^sides\.rows\.\d+\.tilt$/.test(path)) v=v || undefined;
        put(w.m, path, v); if (v===undefined){ const k=path.split('.'); delete w.m.sides.rows[+k[2]][k[3]]; } }
      else if (t==='c') put(w.c, path, v); else if (t==='a') w.a[+path]=v; else if (t==='t') w.t=v;
      else if (t==='r'){ const r=(w.m.rotate.rows||[]).find(q=>q.kind===path); if (r) r.on=v; } }
    (w.m.sides.rows||[]).forEach((r, j)=>{ r.s=[...root.querySelectorAll(`[data-mxs="${j}"]`)].filter(c=>c.checked).map(c=>c.value).join('') || 'Ф'; });
  }
  /** «↺»: одно значение — по умолчанию программы */
  def(path){ const [t, p]=path.split('|');
    if (t==='m'){ const [g, k]=p.split('.'); this.w.m[g][k]=StationMatrix.DEF[g][k]; }
    else if (t==='a') this.w.a[+p]=LayoutEditor.AISLE[+p]; else if (t==='t') this.w.t=LayoutEditor.TIGHT; }
  add(root){ this.read(root); this.w.m.pair.rows.push({ a:'other', b:'other', base:500, k:0, of:'', min:300, close:false }); }
  del(root, j){ this.read(root); this.w.m.pair.rows.splice(j, 1); }
  reset(){ this.w.m=LayoutEditor.copy(StationMatrix.DEF); this.w.a=[...LayoutEditor.AISLE]; this.w.t=LayoutEditor.TIGHT; }
  /** новая версия правил с этими значениями */
  build(){
    const w=this.w;
    if (w.a[1]>w.a[0]) throw new Error('Проход оператора: «допустимо» больше «рекомендуется»');
    if (w.t<600) throw new Error('Проход в крайнем случае — не меньше 600 мм (решение ПНЕВМОТЕХ 12.10)');
    if (w.m.service.min>w.m.service.max) throw new Error('Сервисные ворота: «ширина не меньше» больше «не больше»');
    for (const r of w.m.pair.rows) if (r.min>Math.max(r.base, 0) && !r.k) throw new Error(`Пара ${LayoutEditor.label(r.a)} ↔ ${LayoutEditor.label(r.b)}: «плотно» больше «рекомендуется»`);
    return RuleEdit.version(this.p.data, d=>{
      RuleEdit.set(d, 'layout.matrix', w.m, { id:'layout.matrix', group:'Компоновка', title:'Матрица расстановки оборудования', status:'practice', unit:'мм', source:{ doc:'Решение ПНЕВМОТЕХ' } });
      RuleEdit.set(d, 'norm.aisle', w.a, { id:'norm.aisle', group:'Нормы помещения', title:'Проход обслуживания: рекомендуемый, допустимый', status:'practice', unit:'мм', source:{ doc:'Решение ПНЕВМОТЕХ' } });
      RuleEdit.set(d, 'norm.aisle_tight', w.t, { id:'norm.aisle_tight', group:'Компоновка', title:'Проход оператора в крайнем случае', status:'practice', unit:'мм', source:{ doc:'Решение ПНЕВМОТЕХ' } });
      RuleEdit.set(d, 'clear.kind', w.c, { id:'clear.kind', group:'Компоновка', title:'Отступы от стен и соседнего оборудования', status:'practice', unit:'мм', source:{ doc:'Решение ПНЕВМОТЕХ' } }); });
  }
}

// ---------------------------------------------------------------- правка значения любого правила
// Значение правила — формой по его виду: число, список чисел, таблица [[x, y]] (строки можно добавлять и убирать), параметры
// {ключ: значение} (вложенные — тоже); текстовые значения правятся как текст. Статус и пункт источника — рядом. Сервер
// принимает значение только той же формы, что в файле поставки (StationRules.save).
class RuleEdit {
  /** правило id в копии файла d: нет — добавить base; значение изменилось — пометка источника «правка в «Настройках»» */
  static set(d, id, value, base){ let r=d.rules.find(q=>q.id===id); if (!r){ r={ ...base }; d.rules.push(r); }
    if (JSON.stringify(r.value)!==JSON.stringify(value)){ r.value=value; r.source={ ...(r.source||{}), item:'правка в «Настройках» '+new Date().toLocaleDateString('ru-RU') }; } }
  /** копия файла правил, изменённая fn, с новым номером версии («…-н1», «…-н2») */
  static version(data, fn){
    const d=JSON.parse(JSON.stringify(data)); fn(d);
    const v=String(d.version||'1'), m=/-н(\d+)$/.exec(v);
    d.version=(m ? v.slice(0, m.index) : v).slice(0, 34)+'-н'+(m ? +m[1]+1 : 1);
    d.date=new Date().toISOString().slice(0, 10); delete d._saved;
    return d;
  }
  constructor(panel){ this.p=panel; this.id=''; }
  /** поля значения v (путь p) */
  form(v, p=''){
    const inp=(path, x, w=90)=>`<input type="text" ${typeof x==='number' ? 'inputmode="decimal" ' : ''}data-re="${esc(path)}" data-ty="${typeof x==='number' ? 'n' : 's'}" value="${esc(typeof x==='number' ? String(x).replace('.', ',') : String(x??''))}" style="width:${typeof x==='number' ? w : 220}px">`;
    if (typeof v==='number' || typeof v==='string') return inp(p, v, 120);
    if (typeof v==='boolean') return `<input type="checkbox" data-re="${esc(p)}" data-ty="b"${v ? ' checked' : ''}>`;
    if (Array.isArray(v)){
      if (v.length && v.every(r=>Array.isArray(r) && r.length===2 && r.every(x=>typeof x==='number')))
        return `<table class="tzi-t mx-t re-t"><tbody>${v.map((r, j)=>`<tr><td>${inp(p+'.'+j+'.0', r[0], 80)}</td><td>→</td><td>${inp(p+'.'+j+'.1', r[1], 80)}</td><td><button class="icon" type="button" data-redel="${esc(p+'.'+j)}" aria-label="Убрать строку">✕</button></td></tr>`).join('')}</tbody></table>
          <button class="btn ghost sm" type="button" data-readd="${esc(p)}">+ строка</button>`;
      return `<div class="re-l">${v.map((x, j)=>this.form(x, p+'.'+j)).join(' ')}</div>`;
    }
    if (v && typeof v==='object') return `<div class="re-o">${Object.entries(v).map(([k, x])=>`<div class="re-k"><span>${esc(k)}</span>${this.form(x, p+'.'+k)}</div>`).join('')}</div>`;
    return '';
  }
  html(r){
    const st=StationRulesDoc.STATUS;
    return `<div class="re" data-reid="${esc(r.id)}"><div class="re-v">${this.form(this.v, '')}</div>
      <div class="row re-m"><label class="f"><span>Статус</span><select data-rest>${Object.entries(st).map(([k, t])=>`<option value="${k}"${r.status===k ? ' selected' : ''}>${esc(t)}</option>`).join('')}</select></label>
        <label class="f"><span>Источник, пункт</span><input type="text" data-resrc value="${esc((r.source||{}).item||'')}" placeholder="например: каталог производителя, с. 12" maxlength="200"></label></div>
      <div class="row" style="gap:8px"><button class="btn primary sm" type="button" data-rl="resave">Сохранить правило</button><button class="btn ghost sm" type="button" data-rl="recancel">Отмена</button></div></div>`;
  }
  open(r){ this.id=r.id; this.v=JSON.parse(JSON.stringify(r.value)); }
  /** поля → значение; ошибка — текстом */
  read(root){
    const set=(path, x)=>{ if (path===''){ this.v=x; return; } const k=path.slice(1).split('.'); let o=this.v; for (const q of k.slice(0, -1)) o=o[q]; o[k[k.length-1]]=x; };
    for (const el of root.querySelectorAll('[data-re]')){
      const ty=el.dataset.ty; let x;
      if (ty==='b') x=el.checked; else if (ty==='n'){ const s=el.value.trim().replace(/\s+/g, '').replace(',', '.').replace('−', '-'); x=+s; if (!s || !Number.isFinite(x)) throw new Error(`Не число: «${el.value}»`); }
      else { x=el.value.trim(); if (x.length>200) throw new Error('Текст — до 200 знаков'); }
      set(el.dataset.re, x); }
  }
  rows(path, fn){ const k=path.slice(1).split('.').filter(Boolean); let o=this.v; for (const q of k) o=o[q]; fn(o); }
  add(root, path){ this.read(root); this.rows(path, T=>T.push([...(T[T.length-1]||[0, 0])])); }
  del(root, path){ this.read(root); const i=path.lastIndexOf('.'), j=+path.slice(i+1); this.rows(path.slice(0, i), T=>{ if (T.length>1) T.splice(j, 1); }); }
  build(root){
    this.read(root); const r=this.p.data.rules.find(q=>q.id===this.id), st=root.querySelector('[data-rest]').value, src=root.querySelector('[data-resrc]').value.trim();
    return RuleEdit.version(this.p.data, d=>{ const x=d.rules.find(q=>q.id===this.id);
      x.value=this.v; x.status=st; x.source={ ...(x.source||{}), item:src || 'правка в «Настройках» '+new Date().toLocaleDateString('ru-RU') };
      if (JSON.stringify(r.value)===JSON.stringify(this.v) && r.status===st && ((r.source||{}).item||'')===src) throw new Error('Ничего не изменено'); });
  }
}

// ---------------------------------------------------------------- вкладка «Настроек»: инженерные правила станций
class RulesPanel {
  static LAYOUT = new Set(['layout.matrix', 'norm.aisle', 'norm.aisle_tight', 'clear.kind']);   // правятся формой «Правила компоновки» (как LayoutValues.IDS на сервере)
  constructor(m){ this.m=m; this.info=null; this.data=null; this.flt=''; this.rq=''; this.mx=new LayoutEditor(this); this.re=new RuleEdit(this); this.mxOpen=true; }
  async open(){
    try{ const [a, d]=await Promise.all([aapi('rules/stations'), StationRulesDoc.load()]); this.info=a.info; this.data=d; }
    catch(e){ this.m.innerHTML=`<p class="msg err">${esc(e.message||e)}</p>`; return; }
    this.render(); this.bind();
  }
  box(){ return this.m.querySelector('[data-mxbox]'); }
  keep(){ const b=this.box(); if (b && this.mx.w) try{ this.mx.read(b); } catch(e){ /* неверное число — останется прежнее значение */ }
    const o=new Set([...this.m.querySelectorAll('[data-lpsec]')].filter(s=>s.open).map(s=>s.dataset.lpsec)); if (o.size) this.secOpen=o; }
  render(){
    this.keep();
    const i=this.info||{}, d=this.data||{ rules:[] }, st=StationRulesDoc.STATUS, q=this.rq.trim().toLowerCase();
    const R=(d.rules||[]).filter(r=>(!this.flt || r.status===this.flt) && (!q || [r.title, r.id, r.group, r.note, StationRulesDoc.val(r.value, r.unit)].join(' ').toLowerCase().includes(q)));
    const chip={ confirmed:'on', practice:'', unconfirmed:'warn' }, ed=this.re.id;
    this.m.innerHTML=`<div class="st-card"><p style="margin:0">Действует версия <b>${esc(i.version||'—')}</b> от ${esc(i.date||'—')} — ${i.own ? `своя версия администратора${i.saved ? ` (сохранена ${esc(String(i.saved.at||'').replace('T', ' '))}${i.saved.by ? ', '+esc(i.saved.by) : ''})` : ''}; в поставке — ${esc(i.bundled||'')}` : 'файл поставки программы'}.
        Правил: ${i.rules||0} (подтверждено — ${(i.byStatus||{}).confirmed||0}, практика — ${(i.byStatus||{}).practice||0}, требует подтверждения — ${(i.byStatus||{}).unconfirmed||0}); данных производителей по сериям: ${i.series||0}.</p>
        <div class="row" style="gap:8px;flex-wrap:wrap;margin-top:8px"><button class="btn" type="button" data-rl="doc">Документ «Инженерные правила и источники» (DOCX)</button>
          <button class="btn ghost" type="button" data-rl="json">Скачать файл правил (JSON)</button><button class="btn ghost" type="button" data-rl="up">Загрузить свою версию…</button>
          ${i.own ? '<button class="btn ghost" type="button" data-rl="reset">Вернуть файл поставки</button>' : ''}</div></div>
      <details class="st-card mx"${this.mxOpen ? ' open' : ''} data-mxbox><summary><b>Правила компоновки станций</b> <span class="muted">— габарит перевозки, размер контейнера, проходы, отступы, двери, ворота, ресиверы, исключения</span></summary>${this.mx.html()}</details>
      <div class="st-card"><p style="margin:0 0 6px"><b>Все инженерные правила</b> <span class="muted">— «Изменить» у правила: значение, статус и источник; сохранение — новая версия правил</span></p>
        <div class="row" style="gap:10px;flex-wrap:wrap"><label class="f" style="max-width:320px"><span>Показать</span><select data-rlf data-nodirty><option value="">все правила</option>${Object.entries(st).map(([k, t])=>`<option value="${k}"${this.flt===k ? ' selected' : ''}>${esc(t)}</option>`).join('')}</select></label>
          <label class="f" style="max-width:320px"><span>Найти</span><input type="search" data-rlq data-nodirty value="${esc(this.rq)}" placeholder="название, значение, группа" autocomplete="off"></label></div>
        <div class="tzi-tw" style="max-height:none"><table class="tzi-t re-all"><thead><tr><th>Правило</th><th>Значение</th><th>Статус</th><th>Источник</th><th></th></tr></thead><tbody>
        ${R.map(r=>`<tr${r.id===ed ? ' class="re-on"' : ''}><td><b>${esc(r.title)}</b><div class="muted">${esc(r.group||'')} · ${esc(r.id)}</div>${r.note ? `<div class="muted">${esc(r.note)}</div>` : ''}</td>
          <td>${r.id===ed ? this.re.html(r) : esc(StationRulesDoc.val(r.value, r.unit))}</td>
          <td><span class="chip sm ${chip[r.status]||''}">${esc(st[r.status]||r.status)}</span></td><td>${esc(StationRulesDoc.src(r.source))}</td>
          <td>${r.id===ed ? '' : RulesPanel.LAYOUT.has(r.id) ? '<button class="btn ghost sm" type="button" data-rl="tolayout" title="Правится в «Правилах компоновки» выше">Выше ↑</button>' : `<button class="btn ghost sm" type="button" data-reopen="${esc(r.id)}">Изменить</button>`}</td></tr>`).join('')}</tbody></table></div></div>`;
    const b=this.box(); if (b){ if (this.secOpen) for (const s of b.querySelectorAll('[data-lpsec]')) s.open=this.secOpen.has(s.dataset.lpsec); this.mx.filter(b); }
  }
  bind(){
    this.m.onchange=e=>{ if (e.target.matches('[data-rlf]')){ this.flt=e.target.value; this.render(); }
      else if (/^m\|pair\.rows\.\d+\.[ab]$/.test(e.target.dataset.mx||'')){ try{ this.mx.read(this.box()); this.render(); } catch(er){ toast(er.message); } }
      else if (e.target.dataset.mx){ const r=e.target.closest('.lp-r'); if (r) try{ this.mx.read(this.box()); this.render(); } catch(er){ toast(er.message); } } };
    this.m.oninput=e=>{ if (e.target.matches('[data-lpq]')){ this.mx.q=e.target.value; this.mx.filter(this.box()); }
      else if (e.target.matches('[data-rlq]')){ this.rq=e.target.value; const p=e.target.selectionStart; this.render(); const x=this.m.querySelector('[data-rlq]'); if (x){ x.focus(); x.setSelectionRange(p, p); } } };
    this.m.addEventListener('toggle', e=>{ if (e.target.matches && e.target.matches('[data-mxbox]')) this.mxOpen=e.target.open; }, true);
    this.m.onclick=async e=>{ const box=this.box(), dl=e.target.closest('[data-mxdel]'), df=e.target.closest('[data-lpdef]'), ro=e.target.closest('[data-reopen]');
      if (dl){ try{ this.mx.del(box, +dl.dataset.mxdel); this.render(); } catch(er){ toast(er.message); } return; }
      if (df){ try{ this.mx.read(box); this.mx.def(df.dataset.lpdef); this.render(); } catch(er){ toast(er.message); } return; }
      const pre=e.target.closest('[data-lppre]');
      if (pre){ try{ this.mx.read(box); this.mx.usePreset(pre.dataset.lppre); this.render(); toast('Набор «'+(LayoutParams.PRESETS.find(p=>p.id===pre.dataset.lppre)||{}).title+'» — в форме; сохранится кнопкой «Сохранить правила компоновки»'); } catch(er){ toast(er.message); } return; }
      if (ro){ const r=this.data.rules.find(q=>q.id===ro.dataset.reopen); if (r){ this.re.open(r); this.render(); } return; }
      const ra=e.target.closest('[data-readd]'), rd=e.target.closest('[data-redel]'), rb=this.m.querySelector('.re');
      if (ra || rd){ try{ ra ? this.re.add(rb, ra.dataset.readd) : this.re.del(rb, rd.dataset.redel); this.render(); } catch(er){ toast(er.message); } return; }
      const b=e.target.closest('[data-rl]'); if (!b) return; const a=b.dataset.rl;
      if (a==='mxadd'){ try{ this.mx.add(box); this.render(); } catch(er){ toast(er.message); } return; }
      if (a==='mxdef'){ if (!confirm('Вернуть в форму все значения компоновки, заложенные в программу? Сохранятся только после «Сохранить правила компоновки».')) return; this.mx.reset(); this.render(); return; }
      if (a==='mxsave'){ let d; try{ this.mx.read(box); d=this.mx.build(); } catch(er){ return toast(er.message); }
        return this.post({ method:'POST', headers:{ 'Content-Type':'application/json; charset=utf-8' }, body:JSON.stringify(d) }); }
      if (a==='recancel'){ this.re.id=''; this.render(); return; }
      if (a==='resave'){ let d; try{ d=this.re.build(rb); } catch(er){ return toast(er.message); }
        return this.post({ method:'POST', headers:{ 'Content-Type':'application/json; charset=utf-8' }, body:JSON.stringify(d) }); }
      if (a==='tolayout'){ const x=this.box(); if (x){ x.open=true; x.scrollIntoView({ behavior:'smooth', block:'start' }); } return; }
      if (a==='doc') return StationRulesDoc.download();
      if (a==='json') return saveFileA(`Правила станций ${this.data.version||''}.json`, new Blob([JSON.stringify(this.data, null, 1)], { type:'application/json' }));
      if (a==='reset'){ if (!confirm('Вернуть файл правил из поставки программы? Своя версия сохранится как предыдущая.')) return; return this.post({ method:'POST', body:'' }, '?reset=1'); }
      if (a==='up'){ const f=$('#filePick'); f.value=''; f.multiple=false; f.accept='.json';
        f.onchange=()=>{ const fl=f.files[0]; f.accept=''; if (!fl) return; if (fl.size>2*1024*1024) return toast('Файл больше 2 МБ');
          this.post({ method:'POST', headers:{ 'Content-Type':'application/json; charset=utf-8' }, body:fl }); };
        f.click(); } };
  }
  async post(opts, qs=''){
    try{ const r=await aapi('rules/stations'+qs, opts); this.info=r.info; this.data=await StationRulesDoc.load(); StationRules.use(this.data); this.mx.w=null; this.re.id='';
      if (typeof StationUi!=='undefined') StationUi.cache.clear(); if (typeof StationCalc!=='undefined') StationCalc.cache.clear();
      toast('Правила станций: версия '+(this.info.version||'')); this.render(); }
    catch(e){ toast('Не принято: '+(e.message||e)); }
  }
}
document.addEventListener('click', e=>{ if (e.target.closest && e.target.closest('[data-rulesdoc]')) StationRulesDoc.download(); });
