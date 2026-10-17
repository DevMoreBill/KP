// ТЗ заказчика → станция. Файл (PDF, DOCX, XLSX, ODT, ODS, RTF, TXT, скан — PDF или картинка) читает сервер:
// /api/tz/parse — текст (скан — встроенным распознаванием Windows, способы сравниваются по качеству) и требования по
// правилам, у каждого значения — цитата из ТЗ и страница. Окно (TzImport): сверху — главное (ключевые параметры, итог,
// вопросы, без которых станцию не подобрать, кнопка подбора); под раскрытием — условия расчёта, анкета (у параметра статус
// «найдено в ТЗ» / «принято по умолчанию» / «отсутствует» / «противоречие»), «уточнить позже» (DOCX — TzQuestions); по желанию —
// уточнение с ИИ: пустые поля заполняются, расхождения с найденным правилами показываются; затем требования записываются
// в станцию (новую — из мастера, или уже открытую), контейнер — по ним, оборудование подбирается из каталога (TzPick).
'use strict';

class TzImport {
  static KINDS = [['comp', 'Компрессорная', 'st_comp'], ['pump', 'Насосная', 'st_pump'], ['dgu', 'Дизель-генераторная', 'st_dgu']];
  static ACCEPT = '.pdf,.docx,.xlsx,.odt,.ods,.rtf,.txt,.png,.jpg,.jpeg,.tif,.tiff,.bmp';
  static STATUS = { found:['найдено в ТЗ', 'on'], default:['принято по умолчанию', 'warn'], missing:['отсутствует', 'off'], conflict:['противоречие', 'bad'] };
  // поля для сравнения с ИИ и записи в станцию (числа)
  static NUMS = ['flow', 'pressure', 'q', 'head', 'kw', 'hours', 'tmin', 'tmax', 'noise', 'recvVol', 'alt', 'rh', 'margin', 'load', 'motor'];
  static LABELS = { flow:'Производительность, м³/мин', pressure:'Давление, бар', air:'Класс воздуха', q:'Подача, м³/ч', head:'Напор, м', kw:'Мощность, кВт', hours:'Работа от бака, ч',
    tmin:'Наружный воздух от, °C', tmax:'Наружный воздух до, °C', reserve:'Резерв', work:'Рабочих агрегатов', basis:'Производительность приведена', alt:'Высота над уровнем моря, м',
    rh:'Влажность, %', margin:'Запас производительности, %', mode:'Режим ДЭС', load:'Средняя нагрузка, %', motor:'Наибольший двигатель, кВт', start:'Пуск двигателя', fire:'Категория помещения', noise:'Шум, дБА', industry:'Отрасль заказчика' };
  static cur = null;

  /** ТЗ заказчика: файл или текст, вставленный в окно; i — станция в КП (требования — к ней), null — новая станция */
  static pick(i){
    const m=new Modal(`<div class="dlg-h"><h3>ТЗ заказчика</h3><button class="icon" type="button" data-x aria-label="Закрыть">✕</button></div>
      <p class="muted" style="margin:0 0 10px">Файл (PDF, Word, Excel, скан) — или скопируйте текст ТЗ из письма, сайта тендера или документа и вставьте ниже.</p>
      <button class="btn" type="button" data-tzf>Выбрать файл ТЗ…</button>
      <label class="f" style="margin-top:12px"><span>Текст ТЗ</span><textarea rows="10" data-tzt maxlength="200000" placeholder="Например: Компрессорная станция в блок-контейнере, производительность 12 м³/мин, давление 8 бар, точка росы +3 °C, климат УХЛ1, от −45 до +40 °C…"></textarea></label>
      <div class="row" style="gap:8px;margin-top:10px;justify-content:flex-end"><button class="btn ghost" type="button" data-x>Отмена</button><button class="btn primary" type="button" data-tzp>Разобрать текст</button></div>`, 'tzi-in');
    m.d.addEventListener('click', e=>{
      if (e.target.closest('[data-x]')) return m.close();
      if (e.target.closest('[data-tzf]')){ m.close(); return this.file(i); }
      if (e.target.closest('[data-tzp]')){ const t=String(m.$('[data-tzt]').value||'').trim();
        if (t.length<20) return toast('Вставьте текст ТЗ — хотя бы пару строк с требованиями');
        m.close(); toast('Читаю ТЗ…');
        this.parse(new Blob([t], { type:'text/plain;charset=utf-8' }), 'ТЗ (текст из окна).txt', i); } });
    setTimeout(()=>{ const t=m.$('[data-tzt]'); if (t) t.focus(); }, 50);
  }
  /** выбрать файл ТЗ */
  static file(i){
    const f=$('#filePick'); f.value=''; f.multiple=false; f.accept=this.ACCEPT;
    f.onchange=()=>{ const fl=f.files[0]; f.accept=''; if (!fl) return;
      if (fl.size>40*1024*1024) return toast('Файл больше 40 МБ');
      toast(/\.(png|jpe?g|tiff?|bmp)$/i.test(fl.name) ? 'Распознаю скан ТЗ…' : 'Читаю ТЗ…');
      this.parse(fl, fl.name, i); };
    f.click();
  }
  /** разбор на сервере → окно разбора */
  static async parse(body, name, i){
    let r; try{ r=await api('/api/tz/parse?name='+encodeURIComponent(name), { method:'POST', headers:{ 'Content-Type':'application/octet-stream' }, body }); }
    catch(e){ return toast(String(e && e.message || e)); }
    this.open(r, name, i);
  }

  /** окно разбора: найденное (с цитатами) и поля требований */
  static open(r, name, i){
    const x=i!=null ? S.items[i] : null, q={ ...(r.req||{}) };
    q.kind=(x && StationReq.kind(x)) || q.kind || 'comp';
    if (x){ const c=kitContainer(x), r0=StationReq.of(x); if (!q.cont && c) q.cont=c.ctype;   // станция уже есть: чего нет в ТЗ — из её требований
      for (const [k, v] of Object.entries(r0)) if (!['src', 'pick'].includes(k) && (q[k]==null || q[k]==='') && v!=null && v!=='') q[k]=v;
      if (!q.air && StationUi.opts(x).air) q.air=StationUi.opts(x).air;
      if (c){ q.sys={ ...(c.sys||{}), ...(q.sys||{}) }; if (!q.ins && c.ins) q.ins=c.ins; if (!q.climate && c.climate) q.climate=c.climate; } }
    this.cur={ r, name, i, q, pick:!x || !kitMainPart(x), ai:null };
    if (this.m) this.m.close();
    const t=$('#toast'); if (t) t.classList.remove('on');
    const m=this.m=new Modal(this.html(), 'wide tzi');
    m.d.addEventListener('click', e=>this.click(e));
    m.d.addEventListener('change', e=>{ if (['kind', 'pick'].includes(e.target.dataset.tz)){ this.read(); this.redraw(); } });
  }
  static redraw(){ if (this.m && this.m.d.open) this.m.d.innerHTML=this.html(); }

  /** окно: сверху — главное (вид станции, ключевые параметры, итог разбора, обязательные вопросы, подбор); всё
   *  остальное — под раскрытием: условия расчёта и системы, анкета с цитатами, «уточнить позже», сравнение с ИИ */
  static html(){
    const c=this.cur, q=c.q, k=q.kind, x=c.i!=null ? S.items[c.i] : null, found=(c.r.found||[]).filter(f=>f.key!=='kind');
    const fld=(key, label, ph, mode='decimal')=>`<label class="f"><span>${label}</span><input type="text" inputmode="${mode}" data-tz="${key}" value="${esc(q[key]??'')}" placeholder="${esc(ph||'')}" autocomplete="off"></label>`;
    const sel=(key, label, list)=>`<label class="f"><span>${label}</span><select data-tz="${key}">${list.map(([v, l])=>`<option value="${esc(v)}"${String(q[key]??'')===String(v) ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select></label>`;
    const chk=(key, label, on)=>`<label class="tzi-c"><input type="checkbox" data-tz="${key}"${on ? ' checked' : ''}><span>${label}</span></label>`;
    const main=k==='comp' ? fld('flow', 'Производительность, м³/мин', 'например, 10')+fld('pressure', 'Давление у потребителя, бар', 'например, 7')
        +sel('air', 'Качество воздуха (ISO 8573-1)', [['', 'обычное — по умолчанию'], ...AirChain.options(q.air)])
      : k==='pump' ? fld('q', 'Подача, м³/ч', 'например, 50')+fld('head', 'Напор, м', 'например, 40')
      : fld('kw', 'Мощность нагрузки, кВт', 'например, 200')+fld('hours', 'Работа без дозаправки, ч', 'например, 8', 'numeric')+sel('mode', 'Назначение', StationReq.MODE);
    const more=k==='comp' ? sel('basis', 'Производительность приведена', StationReq.BASIS)+fld('margin', 'Запас производительности, %', '0 — по ТЗ')
        +sel('recv', 'Ресивер', StationReq.RECV)+fld('recvVol', 'Ресивер, л', 'по расчёту', 'numeric')+fld('alt', 'Высота над уровнем моря, м', '0', 'numeric')+fld('rh', 'Влажность, % (для н. м³)', '100', 'numeric')
      : k==='pump' ? ''
      : fld('load', 'Средняя нагрузка, %', '100')+fld('motor', 'Наибольший двигатель, кВт', '—')+sel('start', 'Пуск двигателя', StationReq.START)+fld('alt', 'Высота над уровнем моря, м', '0', 'numeric');
    const sys=q.sys||{}, F=c.r.fields||[], n=st=>F.filter(f=>f.status===st).length, Q=c.r.questions||[], L=c.r.later||[];
    const sum=F.length ? `Из ТЗ взято ${n('found')} ${plural(n('found'), 'параметр', 'параметра', 'параметров')}${n('default')+n('missing') ? `; остальное — по умолчанию, с запасом в пользу заказчика` : ''}${n('conflict') ? `; разные значения в ТЗ (${n('conflict')}) — принято более требовательное` : ''}.`
      : found.length ? `Из ТЗ взято ${found.length} ${plural(found.length, 'значение', 'значения', 'значений')}.` : 'В тексте не нашлось числовых требований — впишите главное сами.';
    return `<div class="dlg-h"><h3>ТЗ заказчика <small class="muted">· ${esc(c.name)}${c.r.doc ? ` · ${esc(this.kindName(c.r.doc.kind))}${c.r.doc.pages ? ', стр. '+c.r.doc.pages : ''}` : ''}</small></h3><button class="icon" type="button" data-x aria-label="Закрыть">✕</button></div>
      <div class="dlg-b">
        ${this.methods(c.r.doc)}
        <div class="kr-g tzi-g tzi-main">${x ? '' : sel('kind', 'Станция', this.KINDS.map(([v, l])=>[v, l]))}${main}${sel('reserve', 'Резерв', StationReq.RES)}</div>
        <p class="tzi-sum">${esc(sum)}</p>
        ${Q.length ? `<div class="tzi-need"><b>Без этого станцию не подобрать — узнайте у заказчика:</b><ol>${Q.map(t=>`<li>${esc(t)}</li>`).join('')}</ol>
          <div class="row" style="gap:8px"><button class="btn sm" type="button" data-tzqc>Копировать вопросы</button><button class="btn sm" type="button" data-tzqd>Вопросы — DOCX</button></div></div>` : ''}
        ${chk('pick', `<b>Подобрать и скомпоновать станцию</b> <span class="muted">— оборудование из каталога, контейнер, компоновка и изображения${x && kitMainPart(x) ? '; прежнее основное оборудование заменится' : ''}</span>`, c.pick)}
        <details class="tzi-f tzi-more"${Spoiler.attr('tz:more')}><summary>Все параметры, условия расчёта и системы контейнера</summary>
          <div class="kr-g tzi-g">${more}${sel('work', 'Рабочих агрегатов', StationReq.WORK)}
            ${fld('tmin', 'Наружный воздух от, °C', '−45', 'text')}${fld('tmax', 'до, °C', '+40', 'text')}
            ${sel('fire', 'Категория помещения', [['', 'ориентировочно по виду станции'], ...StationReq.FIRE.map(f=>[f, f])])}${fld('noise', 'Шум, не более дБА', '80', 'numeric')}
            ${sel('cont', 'Контейнер', CONTAINER_TYPES.map(t=>[t.id, t.name]))}${sel('ins', 'Утепление', [['', 'по типу контейнера'], ...CONTAINER_INS.map(v=>[v, v])])}
            ${sel('climate', 'Климатическое исполнение', [['', 'по температуре'], ...CLIMATES.map(z=>[z[0], z[0]+' — до '+z[2]+' °C'])])}</div>
          <div class="tzi-sys"><span class="muted">Системы контейнера:</span>${CONT_SYSTEMS.map(([id, l])=>chk('sys.'+id, esc(l), sys[id] ?? CONT_SYS_DEF[id])).join('')}</div>
          <div class="tzi-sys">${StationReq.OPTS.filter(([, , kinds])=>kinds.includes(k)).map(([key, label])=>chk(key, esc(label), q[key])).join('')}</div>
          ${k==='comp' ? chk('recvOut', 'Ресивер после подготовки — снаружи (ФНП ОРПД, п. 65)', q.recvOut) : ''}
          ${chk('docs', 'Документы при поставке — в КП', q.docs!==false)}
          <label class="f"><span>Прочие требования из ТЗ</span><textarea rows="3" data-tz="notes">${esc(q.notes||'')}</textarea></label></details>
        ${this.anketa(c.r, found)}
        ${L.length ? `<details class="tzi-f tzi-q"${Spoiler.attr('tz:later')}><summary>Можно уточнить у заказчика позже — ${L.length} <span class="muted">(расчёт уже идёт по значениям по умолчанию)</span></summary><ol>${L.map(t=>`<li>${esc(t)}</li>`).join('')}</ol>
          <div class="row" style="gap:8px"><button class="btn sm" type="button" data-tzqc>Копировать вопросы</button><button class="btn sm" type="button" data-tzqd>Вопросы — DOCX</button></div></details>` : ''}
        ${this.aiDiff()}
        <div class="row" style="justify-content:flex-end;gap:8px;margin-top:12px">
          ${typeof AI_DIRECT!=='undefined' && AI_DIRECT.enabled ? '<button class="btn ghost" type="button" data-tzai>✨ Уточнить с ИИ</button>' : ''}
          <button class="btn" type="button" data-x>Отмена</button><button class="btn primary" type="button" data-tzok>${c.pick ? 'Подобрать станцию' : x ? 'Применить к станции' : 'Создать станцию'}</button></div></div>`;
  }

  /** значение параметра анкеты словами (ключи выбора — понятным текстом) */
  static VAL = { basis:{ fad:'FAD — на выходе компрессора', normal:'нормальные м³ (0 °C)', std:'стандартные м³ (20 °C)' }, mode:{ prime:'основной (PRP)', standby:'резервный (ESP)' },
    start:{ direct:'прямой', stardelta:'звезда — треугольник', soft:'плавный пуск', vsd:'частотный преобразователь' }, reserve:{ 0:'без резерва', 1:'N + 1', 2:'N + 2' }, rel:{ 1:'I', 2:'II', 3:'III' },
    industry:{ food:'пищевая — компрессоры безмасляные', med:'медицинская, фармацевтическая — компрессоры безмасляные' } };
  static val(key, v){ if (v===true) return 'да'; if (v==null || v==='') return '—'; const m=this.VAL[key]; return m && m[v]!=null ? m[v] : String(v).replace('.', ',').replace(/^-(?=\d)/, '−'); }
  static kindName(k){ return { 'pdf-ocr':'PDF-скан, распознан', image:'картинка, распознана' }[k] || String(k||'').toUpperCase(); }
  /** как прочитан документ: способы (текстовый слой, распознавание Windows) и качество; низкое — совет проверить и уточнить с ИИ */
  static methods(d){
    if (!d || !(d.methods||[]).length) return '';
    const pct=v=>v!=null ? Math.round(v*100)+' %' : '—';
    const L=d.methods.map(m=>`<li${m.used ? ' class="on"' : ''}>${esc(m.name)}: ${m.error ? `<span class="muted">${esc(m.error)}</span>` : `качество ${pct(m.quality)}, ${m.chars} знаков${m.used ? ' — <b>использован</b>' : ''}`}</li>`).join('');
    const low=d.low ? `<p><b>Качество текста низкое</b> — значения могли прочитаться с ошибками: сверьте с документом${typeof AI_DIRECT!=='undefined' && AI_DIRECT.enabled ? ' и нажмите «Уточнить с ИИ»' : ''}.</p>` : '';
    if (d.methods.length<2) return `<div class="tzi-m${d.low ? ' low' : ''}">${low || `<span class="muted">Качество текста ${pct(d.quality)}</span>`}</div>`;
    return `<div class="tzi-m${d.low ? ' low' : ''}">${low}<details${Spoiler.attr('tz:read')}><summary class="muted">Как прочитан документ — качество ${pct(d.quality)}</summary><ul>${L}</ul></details></div>`;
  }
  /** анкета: статус каждого параметра, значение, цитата со страницей или почему принято по умолчанию */
  static anketa(r, found){
    const F=r.fields||[];
    if (!F.length) return found.length ? `<details class="tzi-f"${Spoiler.attr('tz:anketa')}><summary>Найдено в ТЗ — ${found.length}</summary><ul>${found.map(f=>`<li><b>${esc(f.label)}</b>${f.value===true ? '' : ': '+esc(String(f.value))}<small class="muted">${esc(f.src||'')}</small></li>`).join('')}</ul></details>`
      : '';
    const n=k=>F.filter(f=>f.status===k).length, pg=p=>p ? `стр. ${p}: ` : '';
    const row=f=>{ const [t, cls]=this.STATUS[f.status]||['', ''];
      const note=f.status==='conflict' ? (f.values||[]).map(v=>`${this.val(f.key, v.value)} — ${pg(v.page)}${v.src}`).join(' | ') : f.status==='found' ? pg(f.page)+(f.src||'') : f.why||'';
      return `<tr><td>${esc(f.label)}</td><td><span class="chip sm ${cls}">${esc(t)}</span></td><td>${esc(this.val(f.key, f.value))}</td><td class="muted">${esc(note)}</td></tr>`; };
    const extra=found.filter(f=>!F.some(x=>x.key===f.key) && !['kind', 'pdp'].includes(f.key));
    return `<details class="tzi-f tzi-a"${Spoiler.attr('tz:anketa')}><summary>Анкета по ТЗ с цитатами — найдено ${n('found')}, по умолчанию ${n('default')}, нет ${n('missing')}${n('conflict') ? `, разные значения ${n('conflict')}` : ''}</summary>
      <div class="tzi-tw"><table class="tzi-t"><thead><tr><th>Параметр</th><th>Статус</th><th>Значение</th><th>Цитата из ТЗ / почему</th></tr></thead><tbody>${F.map(row).join('')}</tbody></table></div>
      ${extra.length ? `<ul>${extra.map(f=>`<li><b>${esc(f.label)}</b>${f.value===true ? '' : ': '+esc(String(f.value))}<small class="muted">${esc((f.page ? 'стр. '+f.page+': ' : '')+(f.src||''))}</small></li>`).join('')}</ul>` : ''}</details>`;
  }
  /** сравнение с ИИ: что ИИ прочитал иначе, чем правила (поле не меняется — решает менеджер) */
  static aiDiff(){
    const A=this.cur && this.cur.ai; if (!A) return '';
    const same=A.filter(d=>d.same).length, diff=A.filter(d=>!d.same && d.rule!=null), add=A.filter(d=>d.rule==null);
    return `<details class="tzi-f tzi-ai"${Spoiler.attr('tz:ai')}><summary>Сравнение с ИИ — совпало ${same}, расхождений ${diff.length}, ИИ дополнил ${add.length}</summary>
      ${diff.length ? `<ul>${diff.map(d=>`<li class="bad-t"><b>${esc(this.LABELS[d.key]||d.key)}</b>: правила — ${esc(String(d.rule))}, ИИ — ${esc(String(d.ai))} <small class="muted">проверьте по документу; в поле оставлено значение правил</small></li>`).join('')}</ul>` : ''}
      ${add.length ? `<p class="muted">ИИ заполнил пустые поля: ${esc(add.map(d=>(this.LABELS[d.key]||d.key)+' — '+d.ai).join('; '))}</p>` : ''}</details>`;
  }

  /** поля окна → требования */
  static read(){
    const q=this.cur.q, d=this.m.d;
    for (const el of d.querySelectorAll('[data-tz]')){ const k=el.dataset.tz, v=el.type==='checkbox' ? el.checked : String(el.value).trim();
      if (k==='pick') this.cur.pick=v;
      else if (k.startsWith('sys.')){ q.sys=q.sys||{}; q.sys[k.slice(4)]=v; }
      else q[k]=v; }
    return q;
  }

  static async click(e){
    if (e.target.closest('[data-x]')) return this.m.close();
    if (e.target.closest('[data-tzai]')) return this.ai();
    if (e.target.closest('[data-tzqc]')){ const t=[...(this.cur.r.questions||[]), ...(this.cur.r.later||[])].map((q, k)=>`${k+1}. ${q}`).join('\n');
      try{ await navigator.clipboard.writeText(t); toast('Вопросы скопированы'); } catch(_){ toast('Не удалось скопировать — выделите текст вручную'); } return; }
    if (e.target.closest('[data-tzqd]')) return TzQuestions.download(this.cur);
    const ok=e.target.closest('[data-tzok]'); if (!ok) return;
    ok.disabled=true; ok.textContent='Подбираю…';
    try{ await this.apply(); }
    catch(err){ ok.disabled=false; ok.textContent='Повторить'; toast('Не получилось: '+(err && err.message || err)); }
  }

  /** уточнить с ИИ: пустые поля — из ответа нейросети (JSON) */
  static async ai(){
    const q=this.read(), text=String(this.cur.r.text||'').slice(0, 12000);
    const prompt=`Из технического задания ниже выпиши требования к станции в контейнере. Ответ — только JSON без пояснений:
{"kind":"comp|pump|dgu","flow":м³/мин,"basis":"fad|normal|std" (normal — нормальные м³, нм³, 0 °C; std — стандартные м³, ст. м³, 20 °C по ГОСТ 2939; иначе fad),"pressure":бар у потребителя,"air":"класс ISO 8573-1 вида 1.4.1",
"margin":запас производительности %,"q":м³/ч,"head":м,"kw":кВт,"mode":"prime|standby" (ДЭС — основной или резервный источник),"load":средняя нагрузка %,"motor":кВт наибольшего двигателя нагрузки,
"start":"direct|stardelta|soft|vsd","hours":работа от бака ч,"work":рабочих агрегатов 1…4,"reserve":0|1|2,"tmin":°C,"tmax":°C,"alt":высота над уровнем моря м,"rh":влажность %,
"climate":"У1|УХЛ1|ХЛ1","fire":"А|Б|В1|В2|В3|В4|Г|Д","noise":дБА,"recvOut":true|false,"cont":"block|sea20|sea40|sea20hc|sea40hc|north",
"oilFree":true|false,"industry":"food|med" (food — пищевая, напитки; med — медицинская, фармацевтическая),"vsd":true|false,"ats":true|false,"scada":true|false,"notes":"прочие требования кратко"}. Неизвестное — не указывай, не выдумывай.\n\nТЕКСТ ТЗ:\n${text}`;
    toast('Спрашиваю ИИ…');
    let a; try{ a=JSON.parse(String(await aiDirect(prompt)).replace(/^[^{]*/, '').replace(/[^}]*$/, '')); }
    catch(err){ return toast('ИИ не ответил понятно — поля оставлены как есть'); }
    // сравнение: совпало, расхождение (поле не меняется), ИИ дополнил пустое
    const rule=Object.fromEntries((this.cur.r.found||[]).map(f=>[f.key, f.value])), diff=[], num=v=>StationReq.num(String(v??'').replace(/[−–]/g, '-').replace(/^\+/, ''));
    let n=0;
    for (const [k, v] of Object.entries(a||{})){ if (v==null || v==='' || typeof v==='object' || k==='notes' || k==='kind') { if (k==='notes' && v && !q.notes){ q.notes=String(v).slice(0, 2000); n++; } continue; }
      if (StationReq.OPTS.some(o=>o[0]===k)){ if (v===true && !q[k]){ q[k]=true; n++; } continue; }
      const val=k==='reserve' ? String(Math.max(0, Math.min(2, Math.round(+v||0)))) : k==='work' ? String(Math.max(1, Math.min(4, Math.round(+v||1)))) : String(v).slice(0, 600);
      if (rule[k]!=null){ const same=this.NUMS.includes(k) ? Math.abs((num(val)??NaN)-(num(rule[k])??NaN))<=0.02*Math.max(1, Math.abs(num(rule[k])||0)) : String(rule[k]).toLowerCase()===val.toLowerCase();
        diff.push({ key:k, rule:rule[k], ai:val, same }); continue; }
      if (q[k]==null || q[k]===''){ q[k]=val; n++; diff.push({ key:k, rule:null, ai:val, same:false }); } }
    this.cur.ai=diff;
    this.redraw(); const bad=diff.filter(d=>!d.same && d.rule!=null).length;
    toast((n ? `ИИ дополнил полей: ${n}` : 'ИИ не нашёл ничего сверх найденного')+(bad ? `; расхождений с правилами: ${bad} — смотрите «Сравнение с ИИ»` : ''));
  }

  /** записать требования в станцию (или создать её), контейнер по требованиям, подбор оборудования */
  static async apply(){
    const c=this.cur, q=this.read(), num=v=>{ const n=StationReq.num(String(v??'').replace(/[−–]/g, '-').replace(/^\+/, '')); return n==null ? '' : String(n); };
    let i=c.i, x=i!=null ? S.items[i] : null;
    if (!x){ const t=typeById((this.KINDS.find(z=>z[0]===q.kind)||this.KINDS[0])[2]);
      x=newItem(); x.attrs={ cat:t.id }; x.page=true; x.features=[]; x.kit={ parts:[] };
      x.kit.parts.push(kitNewContainer(q.cont||'block')); StationDefaults.add(x, t.id);
      S.items.push(x); i=S.items.length-1; }
    // контейнер: тип, утепление, климат (по требованию или по температуре), системы
    const cont=kitContainer(x)||(()=>{ const n=kitNewContainer('block'); x.kit.parts.push(n); return n; })(), tmin=+num(q.tmin);
    const climate=q.climate || (num(q.tmin)!=='' ? (tmin<-45 ? 'УХЛ1' : 'У1') : cont.climate);
    if (q.cont && q.cont!==cont.ctype){ cont.ctype=q.cont; const ct=ctypeOf(q.cont); cont.size=''; cont.sizeAuto=!!StationGeo.FLEX[q.cont]; if (ct.ins) cont.ins=ct.ins; }
    cont.sys={ ...(cont.sys||CONT_SYS_DEF), ...(q.sys||{}) };
    contApply(cont, { ins:q.ins || cont.ins, climate });
    // требования станции
    const r=StationReq.ensure(x);
    for (const k of this.NUMS) if (q[k]!=null && q[k]!=='') r[k]=num(q[k]);
    for (const k of ['recv', 'reserve', 'work', 'fire']) if (q[k]!=null) r[k]=q[k];
    if (q.kind==='comp' && StationReq.INDUSTRY.some(o=>o[0]===q.industry)) r.industry=q.industry;   // пищевая, медицинская — только безмасляные
    for (const [k, L] of [['basis', StationReq.BASIS], ['mode', StationReq.MODE], ['start', StationReq.START]]) if (L.some(o=>o[0]===q[k])) r[k]=q[k];
    r.recvOut=!!q.recvOut; r.docs=q.docs!==false;
    // коммерческие условия из ТЗ — в прочие требования (для КП и переписки)
    const terms=[q.warranty ? `Гарантия — ${q.warranty} мес.` : '', q.deadline ? `Срок поставки — ${q.deadline}` : '', q.brands ? `Производители — только ${q.brands}` : '',
      q.noBrands ? `Не допускаются: ${q.noBrands}` : '', q.noAnalogs ? 'Аналоги не допускаются' : ''].filter(Boolean);
    const notes=[String(q.notes||'').trim(), ...terms.filter(t=>!String(q.notes||'').includes(t))].filter(Boolean).join('\n');
    if (notes) r.notes=notes.slice(0, 2000);
    for (const [k, , kinds] of StationReq.OPTS) if (kinds.includes(q.kind)) r[k]=!!q[k];
    r.src={ name:String(c.name||'').slice(0, 120) };
    if (q.kind==='comp' && q.air) x.stLayout={ ...StationUi.opts(x), air:q.air };
    if (c.pick) r.pick=(await TzPick.assemble(x, { ...q, flow:+num(q.flow), pressure:+num(q.pressure), q:+num(q.q), head:+num(q.head), kw:+num(q.kw), hours:+num(q.hours), pdp:q.pdp, recvVol:+num(q.recvVol), work:+q.work||0 })).slice(0, 900);
    else { delete r.pick; const added=StationReq.ensureParts(x); if (added.length) r.pick='Добавлено по ТЗ: '+added.join(', ');
      if (q.kind==='dgu' && +num(q.hours)>0) StationDefaults.retank(x, +num(q.hours));
      kitSync(x); StationUi.cache.delete(x.id); StationSize.apply(x, true); stationFill(x); stationAutoName(x); }
    persist(); this.m.close(); renderForm(); openEditor(i, 'kit'); StationImages.soon(x);
    toast(c.pick ? 'Станция подобрана и скомпонована по ТЗ — итог в «Подборе станции»' : 'Требования из ТЗ записаны в станцию');
  }
}

// ---------------------------------------------------------------- вопросы заказчику по ТЗ — документ Word
class TzQuestions {
  /** cur — окно разбора (TzImport.cur): вопросы, анкета, имя файла ТЗ */
  static async download(cur){
    const Q=(cur.r.questions||[]), L=cur.r.later||[], F=cur.r.fields||[]; if (!Q.length && !L.length) return toast('Вопросов нет — всё нужное найдено в ТЗ');
    try{ const b=await this.make(cur, Q, F, L); saveFileA(`Вопросы по ТЗ — ${TzOut.NAME(cur.name) || 'заказчик'}.docx`, b); }
    catch(e){ toast('Не удалось подготовить документ: '+(e && e.message || e)); }
  }
  static async make(cur, Q, F, L=[]){
    const org=StationUi.org(), d=new DocxWriter({ title:'Вопросы по техническому заданию', author:org, footer:'Вопросы по ТЗ — '+(cur.name||'') });
    const st=TzImport.STATUS, fmt=(k, v)=>TzImport.val(k, v);
    d.title1('Вопросы по техническому заданию');
    d.p([['Документ: ', { b:true }], [cur.name||'', {}]]).p([['От: ', { b:true }], [org+(S.manager && S.manager.name ? ', '+S.manager.name : '')+(S.manager && S.manager.phone ? ', '+S.manager.phone : ''), {}]]);
    if (Q.length){ d.p('Для подбора оборудования просим сообщить:', { before:6 }); d.items(Q); }
    if (L.length){ d.p(Q.length ? 'По возможности уточните также (без ответа расчёт выполнен по значениям с запасом):' : 'Расчёт выполнен по ТЗ; по возможности уточните (без ответа приняты значения с запасом):', { before:6 }); d.items(L); }
    if (F.length){ d.h2('Что принято из ТЗ');
      d.table([50, 28, 28, 74], ['Параметр', 'Статус', 'Значение', 'Источник / почему'], F.map(f=>[f.label, (st[f.status]||[''])[0], fmt(f.key, f.value),
        f.status==='found' ? (f.page ? 'стр. '+f.page+': ' : '')+(f.src||'') : f.status==='conflict' ? (f.values||[]).map(v=>fmt(f.key, v.value)+(v.page ? ' (стр. '+v.page+')' : '')).join('; ') : f.why||''])); }
    return d.pack('blob');
  }
}

// ---------------------------------------------------------------- подбор оборудования по требованиям
// Основное: число рабочих агрегатов — из ТЗ или 1…3 с наименьшим избытком производительности (лишний агрегат — штраф),
// каждый не меньше доли нагрузки; к ним — резервные той же модели. Компрессор — с запасом давления на потери в осушителе
// и фильтрах (лишнее давление — штраф: каждый бар сверх нужного — около 7 % энергии), насос — без большого избытка напора.
// Компрессорная: осушитель — по классу воды (точка росы ниже −20 °C — адсорбционный) с запасом на давление и лето;
// фильтры и ресивер — по рекомендациям расчёта цепочки (AirChain).
/** один поставщик в станции (решение владельца 17.10): при равных условиях — оборудование того же поставщика, что и основные
 *  агрегаты. Поставщик позиции — как в фильтре «Поставщик» каталога (фид или справочник; CatalogWindow.supplierOf).
 *  «Равные условия» — подходит без недобора, столько же штук, оценка хуже лучшей не больше допуска `pick.oneSup` (%, 0 — выкл.) */
class StationSup {
  static ctx = '';   // поставщик основного оборудования станции, под которую идёт подбор
  static key(s){ return norm(s||''); }
  static of(c){ return c && typeof CW!=='undefined' ? this.key(CW.supplierOf(c)) : ''; }
  static get TOL(){ return Math.max(0, +StationMatrix.grp('pick').oneSup||0)/100; }
  /** поставщик основного оборудования станции x (компрессоры, ДГУ, насосы — роль main) */
  static use(x){ const p=kitParts(x).find(z=>z.role==='main'), c=p && catCache.find(z=>z.id===p.catId); this.ctx=this.of(c); return this.ctx; }
  static same(c){ return !!this.ctx && this.TOL>0 && this.of(c)===this.ctx ? 1 : 0; }
  /** сколько видов подготовки воздуха (осушитель cat, фильтры) есть у поставщика позиции c — компрессор от того, кто закроет больше состава */
  static cover(c, cats){ const s=this.of(c); if (!s || !(this.TOL>0)) return 0;
    return cats.filter(k=>catCache.some(z=>attrsOf(z).cat===k && this.of(z)===s)).length; }
  /** выбор из кандидатов [{…, score}] при «равных условиях»: в пределах допуска от лучшего — с наибольшим rank, затем лучший */
  /** поставщик элемента состава p (позиция каталога), как в каталоге: «ООО Альфа» | '' */
  static label(p){ const c=p && p.catId ? catCache.find(z=>z.id===p.catId) : null; return c && typeof CW!=='undefined' ? String(CW.supplierOf(c)||'').trim() : ''; }
  /** поставщики оборудования станции (наше: агрегаты, подготовка воздуха, ресиверы, баки): «Всё у одного поставщика: …» /
   *  «Поставщиков: 2 — Альфа (компрессоры, осушитель); Бета (ресиверы)» | '' — оборудования из каталога нет */
  static summary(x){
    const KIND={ compressor:'компрессоры', dgu:'ДГУ', pump:'насосы', dryer:'осушители', filter:'фильтры', receiver:'ресиверы', tank:'бак' }, by=new Map();
    for (const p of kitParts(x)){ const k=StationEquip.kindOf(p); if (!KIND[k]) continue;
      const s=this.label(p)||'без поставщика в каталоге', e=by.get(s)||new Set(); e.add(KIND[k]); by.set(s, e); }
    if (!by.size) return '';
    if (by.size===1) return 'Всё у одного поставщика: '+[...by.keys()][0];
    return `Поставщиков: ${by.size} — `+[...by].map(([s, e])=>`${s} (${[...e].join(', ')})`).join('; ');
  }
  static pick(L, rank, tol){ if (!L.length) return null; const b=L.reduce((m, o)=>o.score<m.score ? o : m, L[0]);
    if (!(this.TOL>0)) return b; const near=L.filter(o=>o.score<=b.score+tol+1e-9);
    return near.reduce((m, o)=>rank(o)>rank(m) || (rank(o)===rank(m) && o.score<m.score) ? o : m, b); }
}

class TzPick {
  static get LOSS(){ return StationRules.raw('loss.pick'); }   // запас давления компрессора к требуемому, бар (файл правил)
  // какие ступени годятся под рекомендацию (по порядку предпочтения): предварительный — и сухой фильтр частиц, и тонкий
  // 1 мкм; пылевой после адсорбционного осушителя — и фильтр тонкой очистки 1 мкм
  static GRADE = { pre:['pre', 'dust', 'fine'], dust:['dust', 'fine'] };
  static num(v){ return StationEquip.num(v); }
  /** производительность позиции каталога в единицах подбора: компрессоры и осушители — м³/мин, насосы — м³/ч */
  static flow(c){ const a=attrsOf(c), f=this.num(a.flow); return f>0 ? (a.cat==='comp_piston' ? f/1000 : f) : 0; }

  /** лучшая позиция: из подходящих — с наименьшим значением key (самая «впритык») */
  static best(list, key){ return list.reduce((b, o)=>!b || o[key]<b[key] ? o : b, null); }

  static get MAX(){ return StationMatrix.grp('pick').max; }   // добор производительности количеством: до четырёх одинаковых рабочих агрегатов или аппаратов параллельно
  /** рабочие агрегаты из pool [{c, v}] на нагрузку need: {o, n}; n0 — число рабочих из ТЗ, pen(o) — штраф позиции;
   *  подбор — без недобора (в пользу заказчика): сумма рабочих не меньше нужного; одного не хватает — несколько (до MAX) */
  static units(pool, need, n0, pen=()=>0, rank=null){
    const L=[];
    for (let n=n0||1; n<=(n0||this.MAX); n++) for (const o of pool){ if (o.v*n<need-1e-9) continue;
      L.push({ o, n, score:(o.v*n-need)/need+0.08*(n-1)+pen(o) }); }
    const b=StationSup.pick(L, ()=>0, 0); if (!b || !rank) return b;
    return StationSup.pick(L.filter(z=>z.n===b.n), z=>rank(z.o), StationSup.TOL);   // один поставщик — при том же числе агрегатов
  }
  /** одинаковые аппараты параллельно на нагрузку need (осушители, фильтры): один, иначе несколько (до MAX) — наименьшее
   *  число, затем наименьший запас; list — [{c, cap}]: {o, n} | null */
  static many(list, need, max=this.MAX){
    for (let n=1; n<=max; n++){ const L=list.filter(z=>z.cap*n>=need-1e-9).map(z=>Object.assign({}, z, { over:z.cap*n-need, score:need>0 ? (z.cap*n-need)/need : z.cap*n }));
      const o=StationSup.pick(L, z=>StationSup.same(z.c), StationSup.TOL); if (o) return { o, n }; }
    return null;
  }
  /** компрессоры из pool на Q, м³/мин, и B, бар, у потребителя: класс 0 по маслу — только безмасляные; частотное регулирование
   *  по ТЗ — в приоритете; безмасляный без требования — нет (дороже). q — требования ({oilFree, vsd, work}): {o, n} | null */
  static comps(pool, Q, B, q){
    const comp=c=>({ name:c.name, attrs:attrsOf(c), rows:[] }), vsd=c=>AirChain.info(comp(c), 'compressor').vsd;
    return this.units(pool.filter(c=>!q.oilFree || this.oilFree(c)).map(c=>({ c, v:this.flow(c), p:this.num(attrsOf(c).pressure), vsd:vsd(c), f:!q.vsd || vsd(c), of:!q.oilFree && this.oilFree(c) }))
      .filter(o=>o.v>0 && (!(B>0) || !(o.p>0) || o.p>=B-0.05) && !(q.compact && (o.of || this.barPen(o.p, B, o.vsd)>=0.5 || (q.work && o.v*q.work>Q*this.OVER)))), Q, q.work, o=>this.barPen(o.p, B, o.vsd)+(o.f ? 0 : 0.3)+(o.of ? 0.5 : 0)+(q.compact ? this.area(o.c) : 0),
      o=>StationSup.same(o.c)*10+StationSup.cover(o.c, [q.ads ? 'dryer_ads' : 'dryer_refrig', 'filter']));
  }
  static get OVER(){ return 1+StationMatrix.grp('pick').over/100; }   // подбор «чтобы поместилось»: запас производительности — не больше 30 % (не центробежный на 60 м³/мин), безмасляный — только по требованию, давление — с запасом на потери
  /** штраф за площадь агрегата (подбор «чтобы станция поместилась»): 0,3 на м² пола; габарит неизвестен — как 3,5 м² */
  static area(c){
    const d=StationEquip.dims({ name:c.name, attrs:attrsOf(c), rows:[] }, 'compressor');
    return 0.3*(d.known ? d.l*d.w/1e6 : 3.5);
  }
  /** осушитель на Qd, м³/мин (вся производительность рабочих компрессоров) с поправками производителя (серия в файле правил:
   *  давление B у потребителя, температура tmax; нет — типовая таблица и запас); давление аппарата — не ниже Bc (компрессор);
   *  точка росы адсорбционного — не выше pdp (если известна). Одного не хватает — несколько одинаковых параллельно: {o, n} */
  static dryer(ads, Qd, B, Bc, tmax, pdp=null, H=0, W=0){
    const t=DryerSizing.temps({ tmax, tin:null }), pb=B>0 ? B : StationRules.raw('dryer.ref').p, dc=ads ? 'dryer_ads' : 'dryer_refrig';
    const dp=c=>this.num(String(attrsOf(c).dewPoint??'').replace(/[−–]/g, '-'));
    return this.many(catCache.filter(c=>attrsOf(c).cat===dc && (pdp==null || dp(c)==null || dp(c)<=pdp+0.5) && this.fitsH(c, 'dryer', H) && this.fitsW(c, 'dryer', W)).map(c=>{ const a=attrsOf(c), F=DryerSizing.factor({ name:c.name, attrs:a, rows:[] }, pb, t, ads ? 'ads' : 'refrig').F; return { c, v:this.flow(c), cap:this.flow(c)*F }; })
      .filter(o=>o.v>0 && (!(Bc>0) || !(this.num(attrsOf(o.c).pressure)>0) || this.num(attrsOf(o.c).pressure)>=Bc-0.05)), Qd);
  }
  /** фильтр ступени rec.key (рекомендация AirChain) на Qf, м³/мин: с поправкой производителя на давление у потребителя (как в
   *  расчёте станции: давление не выше фактического), иначе — типовой; давление фильтра — не ниже Bc. Одного не хватает —
   *  несколько одинаковых параллельно; Qf неизвестна — самый маленький этой ступени: {o, n} | null */
  static filter(rec, Qf, B, Bc){
    const pf=B>0 ? B+StationRules.raw('loss.pipe') : StationRules.raw('dryer.ref').p;
    const kf=(c, a)=>{ const s=StationRules.series({ name:c.name, attrs:a, rows:[] }, 'filter'); return s ? StationRules.interp(s.f.p, pf) : AirChain.kf(pf); };
    const ok=(c, g)=>{ const a=attrsOf(c), p={ name:c.name, attrs:a, rows:[] }; if (a.cat!=='filter') return false;
      if (AirChain.grade(p, a.cat, AirChain.text(p))!==g) return false;   // ступень — по полю или названию (DD, PD, «0,01 мкм»…)
      if (Qf>0 && !(this.flow(c)>0)) return false;
      return !(Bc>0 && this.num(a.pressure)>0 && this.num(a.pressure)<Bc-0.05); };
    for (const g of this.GRADE[rec.key]||[rec.key]){   // сначала — своей ступени, нет такой — следующей подходящей
      const L=catCache.filter(c=>ok(c, g));
      if (Qf>0){ const m=this.many(L.map(c=>({ c, cap:this.flow(c)*kf(c, attrsOf(c)) })), Qf); if (m) return m; continue; }
      const b=StationSup.pick(L.map(c=>({ c, v:this.num(attrsOf(c).flow)||0, score:this.num(attrsOf(c).flow)||0 })), z=>StationSup.same(z.c), 0); if (b) return { o:b, n:1 }; }
    return null;
  }
  /** давление компрессора, бар, нужное для B у потребителя: потери в подготовке воздуха (loss.pick) и — без частотного
   *  регулирования — диапазон «нагрузка — холостой ход» (pressure.band): давление включения не ниже нужного */
  static barNeed(B, vsd){ return B+this.LOSS+(vsd ? 0 : StationRules.raw('pressure.band')); }
  /** штраф компрессора по давлению: меньше нужного — сильный, больше — по 0,05 за бар */
  static barPen(p, B, vsd){ if (!(B>0) || !(p>0)) return 0; const need=this.barNeed(B, vsd); return p<need-0.05 ? 0.5 : 0.05*(p-need); }
  /** безмасляный компрессор: поле каталога «Безмасляный (класс 0)», не заполнено — по названию или характеристикам
   *  («безмасляный», oil-free, класс 0) */
  static oilFree(c){ const a=attrsOf(c), f=String(a.oilFree??'').trim();
    if (/^(да|есть|true)/i.test(f) || /класс\w*\s*0(?![.,\d])/i.test(f)) return true;
    if (/^(нет|false)/i.test(f)) return false;   // маслозаполненный — по полю, даже если в описании серии есть «безмасляный»
    if (/безмасл|oil[\s-]?free|класс\w*\s*0(?![.,\d])/i.test([c.name, a.model, a.series, a.lubrication, a.oil].filter(Boolean).join(' '))) return true;
    return false; }
  /** компрессоры для станции в контейнере: без передвижных (на шасси, колёсных) и бензиновых; дизельные — только если
   *  электрических подходящих нет (станция по умолчанию — с электроприводом) */
  static mobile(c){ const a=attrsOf(c); return /шасси|передвижн|мобильн|колёсн|колесн/i.test(String(a.execution||'')+' '+c.name) || /бензин/i.test(c.name); }
  /** насос для стационарной насосной станции в контейнере: электрический, не погружной, не скважинный, не дренажный, не
   *  мотопомпа (вид и привод — из карточки; не указаны — допускается) */
  static pumpOk(c){ const a=attrsOf(c); return !/мотопомп|погружн|скважин|дренаж|фекал/i.test(String(a.kind||'')+' '+c.name) && !/дизел|бензин/i.test(String(a.drive||'')); }
  /** в контейнер — ДГУ открытого исполнения: в кожухе она шире и выше, контейнер выходит за габарит перевозки (кожух —
   *  только если открытой нужной мощности нет); штраф к оценке подбора */
  static dguPen(c){ return /кожух|капот|шумозащит/i.test(String(attrsOf(c).execution||'')+' '+c.name) ? 0.15 : 0; }
  /** ДГУ для станции 0,4 кВ: трёхфазная 400 В (не однофазная 220/230 В и не высоковольтная 6,3 / 10,5 кВ); «400 / 230 В» —
   *  трёхфазная с нейтралью; исполнение — открытое или под контейнер (передвижные отсеяны в stationPool) */
  static dguOk(c){
    const a=attrsOf(c), v=String(a.voltage||''), t=v+' '+String(a.phases||'')+' '+c.name;
    if (/\d{4,}\s*В(?![а-яё])|\d+(?:[.,]\d+)?\s*кВ(?![а-яёА-ЯЁ])/i.test(t.replace(/(\d)\s+(?=\d{3}\b)/g, '$1'))) return false;   // 6 300 / 10 500 В, 10,5 кВ
    if (/3\s*фаз|тр[её]хфазн/i.test(t)) return true;
    return !/однофазн|1\s*фаз|(?<![\d\/]\s*)(?<!\d)(?:220|230)\s*В(?![а-яё])(?!\s*\/)/i.test(t);
  }
  static stationPool(cats){ return catCache.filter(c=>cats.includes(attrsOf(c).cat) && !this.mobile(c)); }
  static electric(pool){ return pool.filter(c=>attrsOf(c).cat!=='comp_diesel'); }
  /** ресиверы на объём V, л: один, иначе несколько одинаковых — наименьшее число, затем наименьший объём; сначала — каждый без
   *  учёта в Ростехнадзоре (p·V не больше 1,0 МПа·м³, до шести), иначе — любые (до четырёх); давление — не ниже B, высота с
   *  арматурой (+300 мм) — не выше Hmax (0 — без ограничения: ресивер снаружи). {o, n, free — без учёта} */
  /** ресивер внутри: над ним — место на арматуру (клапан, манометр, отвод конденсата), мм — раздел pick матрицы */
  static get RECV_TOP(){ return StationMatrix.grp('pick').recvFit; }
  static receivers(V, B, Hmax){
    const L=catCache.filter(c=>attrsOf(c).cat==='receiver').map(c=>{ const a=attrsOf(c); return { c, v:this.num(a.volume)||0, p:this.num(a.pressure), h:StationEquip.dims({ name:c.name, attrs:a, rows:[] }, 'receiver').h }; })
      .filter(o=>o.v>0 && (!(B>0) || !(o.p>0) || o.p>=B-0.05) && (!(Hmax>0) || o.h+this.RECV_TOP<=Hmax));
    const free=o=>!(B>0) || B/10*o.v/1000<=PressureVessel.LIMIT+1e-9;
    // по умолчанию — одинаковые по 900 л (receiver.base, решение ПНЕВМОТЕХ), сколько нужно по объёму: производитель в
    // приоритете (АСО) — первым, затем в наличии, наименьшее достаточное давление, дешевле, ниже; нет таких — прежний подбор
    const B0=AirChain.BASE, bs=B0 ? AirChain.base(V>0 ? V : B0.volume, B) : null;
    if (bs && bs.n<=6){ const mk=String(B0.maker||'').trim().toLowerCase(), pri=o=>mk && String(attrsOf(o.c).maker||'').trim().toLowerCase()===mk ? 0 : 1;
      const C=L.filter(o=>Math.abs(o.v-bs.v)<0.5 && free(o)).sort((a, b)=>pri(a)-pri(b) || StationSup.same(b.c)-StationSup.same(a.c) || this.stock(b.c)-this.stock(a.c) || (a.p||99)-(b.p||99) || this.cheaper(a.c, b.c) || a.h-b.h);
      if (C.length) return { o:C[0], n:bs.n, free:true, base:true }; }
    if (!(V>0)) return L.length ? { o:this.best(L, 'v'), n:1, free:true } : null;
    const P=StationMatrix.grp('pick');
    for (const [only, max] of [[true, P.recvFree], [false, P.recvAny]]) for (let n=1; n<=max; n++){ const o=StationSup.pick(L.filter(z=>z.v*n>=V-1e-9 && (!only || free(z))).map(z=>({ ...z, score:z.v })), z=>StationSup.same(z.c), 0); if (o) return { o, n, free:free(o) }; }
    return null;
  }
  /** ресивер типоразмера size, л (900 или 500 — методика ПНЕВМОТЕХ): давление — с запасом над компрессором (правило
   *  receiver.method.margin), нет такого — не ниже компрессорного (тогда ошибка в расчёте); высота с арматурой (+300 мм) — не выше
   *  Hmax (0 — без ограничения); производитель в приоритете (АСО), в наличии, наименьшее достаточное давление, дешевле, ниже.
   *  {o} | {o:null, tall — на это давление есть, но выше Hmax} | null */
  static recvPick(size, B, Hmax){
    const all=catCache.filter(c=>attrsOf(c).cat==='receiver').map(c=>{ const a=attrsOf(c); return { c, v:this.num(a.volume)||0, p:this.num(a.pressure), h:StationEquip.dims({ name:c.name, attrs:a, rows:[] }, 'receiver').h }; })
      .filter(o=>Math.abs(o.v-size)<0.5 && (!(B>0) || !(o.p>0) || o.p>=B-0.05)), fit=all.filter(o=>!(Hmax>0) || o.h+this.RECV_TOP<=Hmax);
    const B0=AirChain.BASE, mk=String((B0 && B0.maker)||'').trim().toLowerCase(), pri=o=>mk && String(attrsOf(o.c).maker||'').trim().toLowerCase()===mk ? 0 : 1, m=ReceiverPlan.M.margin;
    const sort=L=>L.sort((a, b)=>pri(a)-pri(b) || StationSup.same(b.c)-StationSup.same(a.c) || this.stock(b.c)-this.stock(a.c) || (a.p||99)-(b.p||99) || this.cheaper(a.c, b.c) || a.h-b.h)[0];
    for (const ok of [o=>!(B>0) || !(o.p>0) || o.p>=B+m-0.05, o=>!(B>0) || !(o.p>0) || o.p>=B-0.05]){ const o=sort(fit.filter(ok)); if (o) return { o }; }
    return all.length ? { o:null, tall:true } : null;
  }
  /** сравнение по закупке, иначе по цене (одна валюта; без цены — в конце): < 0 — a дешевле */
  static cheaper(a, b){
    for (const [k, cur] of [['cost', 'costCur'], ['price', 'priceCur']]){
      const va=+a[k]>0 ? +a[k] : Infinity, vb=+b[k]>0 ? +b[k] : Infinity;
      if (va===Infinity && vb===Infinity) continue;
      if (va!==Infinity && vb!==Infinity && (a[cur]||'RUB')!==(b[cur]||'RUB')) return 0;
      return va===vb ? 0 : va<vb ? -1 : 1; }
    return 0;
  }
  /** в наличии на складе поставщика (остатки фида): 1 / 0 */
  static stock(c){ return typeof CatalogIndex!=='undefined' && CatalogIndex.inStock(c) ? 1 : 0; }
  /** высота внутри контейнера станции, мм: блок-контейнер по оборудованию — до наибольшей высоты ряда */
  static hmax(x){
    const g=StationGeo.of(kitContainer(x)||{ ctype:'block' });
    return g.int ? g.int[2] : StationGeo.inner(g.type, [10000, StationGeo.ROAD_W, StationGeo.BLOCK.maxH], g.t)[2];
  }
  /** полезная ширина помещения станции, мм: внутри минус зазоры на коммуникации; без размера (по оборудованию) — блок в
   *  ширину перевозки без спецразрешения */
  static wmax(x){
    const g=StationGeo.of(kitContainer(x)||{ ctype:'block' }), Wi=g.int && !g.auto ? g.int[1] : StationGeo.inner(g.type, [10000, StationGeo.ROAD_W, StationGeo.BLOCK.maxH], g.t)[1];
    return Wi-2*StationMatrix.gap();
  }
  /** помещается в плане с проходом (W, мм; 0 — без ограничения): меньшая сторона + отступ от стены «плотно» + проход
   *  «не менее» не больше W. Не помещается один — несколько меньших параллельно (решение ПНЕВМОТЕХ) */
  static fitsW(c, kind, W){
    if (!(W>0)) return true; const d=StationEquip.dims({ name:c.name, attrs:attrsOf(c), rows:c.rows||[] }, kind); if (!d.known) return true;
    const s=Math.min(d.l, d.w), wr=StationMatrix.wall({ kind, w:s }); return s+(wr ? wr[1] : 100)+StationClear.aisle()[1]<=W;
  }
  /** проходит по высоте помещения станции H, мм (0 — без ограничения): габариты из каталога; неизвестны — не отсекается.
   *  Над аппаратом — место на подключение трубопровода (осушитель — 100 мм) */
  static fitsH(c, kind, H){
    if (!(H>0)) return true; const d=StationEquip.dims({ name:c.name, attrs:attrsOf(c), rows:[] }, kind);
    return !d.known || d.h+(kind==='dryer' ? StationMatrix.grp('pick').dryerFit : 0)<=H;
  }
  /** «осушитель …» — без повтора, если это слово уже есть в названии («Воздушный ресивер АСО…») */
  static lbl(word, name){ return String(name||'').toLowerCase().includes(word.slice(0, 5)) ? name : word+' '+name; }

  /** подбор и сборка станции: шкафы по особым требованиям (АВР, АСУ ТП), оборудование из каталога, название и
   *  характеристики станции, контейнер по оборудованию; ответ — итог подбора для менеджера */
  static async assemble(x, q){
    const added=StationReq.ensureParts(x), note=await this.run(x, q);
    kitSync(x); StationUi.cache.delete(x.id); StationSize.apply(x, true); stationFill(x); stationAutoName(x);
    return [note, added.length ? 'Добавлено по ТЗ: '+added.join(', ') : ''].filter(Boolean).join('. ');
  }

  /** элемент состава из позиции каталога c: полная карточка с сервера, нет связи — облегчённая из кэша каталога */
  static async part(c, qty, role){
    let doc=c; try{ doc=await api('/api/catalog/'+encodeURIComponent(c.id)); }catch(_){}
    const p=KitPart.fromCat(doc); p.qty=qty; if (role) p.role=role; return p;
  }

  /** подбор в станцию x; ответ — строка для менеджера: что подобрано и чего в каталоге нет */
  /** подбор с защитой состава: чего в каталоге не нашлось — прежнее оборудование этого вида остаётся (не пропадает) */
  static async run(x, q){
    const drop=this.DROP[q.kind]||/^$/, before=kitParts(x).filter(p=>p.role!=='container' && drop.test(StationEquip.kindOf(p)||''));
    let note=await this.fit(x, q); const kept=[];
    // фильтры и ресиверы — только если цепочка воздуха их по-прежнему просит (осушитель со встроенными фильтрами — фильтры
    // не нужны: прежние на меньший расход не оставлять)
    let air=null; const need=k=>{ if (k!=='filter' && k!=='receiver') return true;
      if (!air) air=StationLayout.solve(StationUi.input(x)).air || KitNeed.air(x) || { recs:[] }; return (air.recs||[]).some(r=>r.cat===k && !r.replace); };
    for (const k of [...new Set(before.map(p=>StationEquip.kindOf(p)))]){
      if (kitParts(x).some(p=>StationEquip.kindOf(p)===k) || !need(k)) continue;
      const old=before.filter(p=>StationEquip.kindOf(p)===k), at=kitParts(x).findIndex(p=>p.role==='container');
      x.kit.parts.splice(at<0 ? x.kit.parts.length : at, 0, ...old); kept.push(...old.map(p=>p.name));
    }
    if (kept.length) note+=`. Оставлено прежнее: ${kept.join('; ')}`;
    return note;
  }
  static DROP = { comp:/^(compressor|dryer|filter|receiver)$/, pump:/^pump$/, dgu:/^dgu$/ };
  /** подбор, при котором станция помещается в контейнер (решение ПНЕВМОТЕХ — «ресиверы — внутри,
   *  применив все приёмы компоновки»): один большой агрегат не встаёт — несколько одинаковых меньших (2, 3 … до MAX; меньшим
   *  агрегатам — и меньше ресиверов). Порядок: всё внутри в габарите перевозки — для каждого числа агрегатов сначала ресиверы
   *  900 л, затем по 500 л без учёта в Ростехнадзоре («нехватка места», методика ПНЕВМОТЕХ; меньше по диаметру — встают парами
   *  поперёк); компоновка сама перебирает два ряда, пары, поворот, плотные отступы, длину до наибольшей и в крайнем случае —
   *  ресиверы вплотную. Только если внутри не встаёт никак — ресиверы после подготовки снаружи у стены станции (ФНП ОРПД
   *  п. 65) в габарите перевозки; негабарит (исключение); иначе — первый вариант и подсказка разделить станцию. Число рабочих
   *  из ТЗ («work») не меняется; типоразмер ресиверов, выбранный менеджером, — тоже */
  static async fit(x, q){
    { const rq=StationReq.ensure(x);   // «снаружи» и «по 500 л» выбрала программа — каждый подбор заново
      if (rq.recvOutAuto){ delete rq.recvOut; delete rq.recvOutAuto; q={ ...q, recvOut:false }; }
      if (rq.recvSizeAuto){ delete rq.recvSize; delete rq.recvWhy; delete rq.recvSizeAuto; } }
    const note=await this.pick(x, q);
    if (q.work || q.kind!=='comp' || !(q.flow>0)) return note;   // компрессорные (решение ПНЕВМОТЕХ); ДГУ и насосы параллельно — решение проектировщика
    const res=Math.max(0, Math.round(+q.reserve||0)), main=()=>kitParts(x).find(p=>p.role==='main'), req=StationReq.ensure(x), out0=!!req.recvOut, sz0=!!req.recvSize;
    // нет контейнера — проверять нечего; close — помещается только с ресиверами вплотную (крайний случай: сначала другие варианты внутри)
    const state=()=>{ if (!main()) return 'bad'; const p=StationLayout.solve(StationUi.input(x)), I=p.issues||[]; return p.level==='error' ? 'bad' : I.some(i=>i.wide) ? 'wide' : I.some(i=>i.close) ? 'close' : 'ok'; };
    const n0=main() ? main().qty-res : 1, s0=state(); if (s0==='ok') return note;
    const keep=(nt, n, out, s5)=>({ parts:JSON.parse(JSON.stringify(x.kit.parts)), note:nt, n, out, s5 }), first=keep(note, n0, out0, false);
    const set=(out, s5)=>{ if (out){ req.recvOut=true; req.recvOutAuto=true; } else if (!out0){ delete req.recvOut; delete req.recvOutAuto; }
      if (s5){ req.recvSize='500'; req.recvWhy='space'; req.recvSizeAuto=true; } else if (req.recvSizeAuto){ delete req.recvSize; delete req.recvWhy; delete req.recvSizeAuto; } };
    // варианты по порядку: [снаружи, по 500 л] — внутри 900 л, внутри по 500 л (если типоразмер не задан менеджером), снаружи
    const tries=[];
    if (!out0) for (let n=n0; n<=this.MAX; n++){ tries.push([n, false, false]); if (!sz0) tries.push([n, false, true]); }
    for (let n=n0; n<=this.MAX; n++) tries.push([n, true, false]);
    let wide=s0==='wide' ? first : null, close=s0==='close' ? first : null;
    // меньшие по площади агрегаты (compact): станция короче и уже
    let hadR=true, t5=false;   // в предыдущем варианте были ресиверы (нет — вариант «по 500 л» не нужен); по 500 л — проверено
    for (const [n, out, s5] of tries){
      if (s5 && !hadR) continue;
      if (out && close) break;   // внутри помещается с ресиверами вплотную — лучше, чем снаружи (решение ПНЕВМОТЕХ)
      set(out, s5);
      const nt=await this.pick(x, { ...q, work:n, compact:true, recvOut:out }), st=state(), v=keep(nt, n, out, s5);
      const dryR=kitParts(x).some(p=>StationEquip.kindOf(p)==='receiver' && p.recvRole!=='local' && p.recvRole!=='wet');
      if (!s5) hadR=dryR; else if (!dryR) continue; else t5=true;   // ресиверов по 500 л в каталоге нет — вариант не годится (станция без ресиверов)
      v.t5=t5;
      if (st==='ok') return this._fitNote(v, n0, false);
      if (st==='close' && !close) close=v;
      if (st==='wide' && !wide) wide=v;
    }
    const v=close || wide || first; x.kit.parts=v.parts; set(v.out && !out0, v.s5);
    if (close) return this._fitNote(v, n0, false, true);
    return wide ? this._fitNote(v, n0, true) : `${v.note}. Станция не помещается в один контейнер даже из ${this.MAX} одинаковых агрегатов${t5 ? ', с ресиверами по 500 л' : ''} и с ресиверами снаружи — разделите её на две станции (по половине производительности) или задайте контейнер вручную`;
  }
  /** уведомление о том, как станция встала в контейнер */
  static _fitNote(v, n0, wide, close){
    const why=[]; if (v.n>n0) why.push(`подобрано ${v.n} одинаковых`);
    if (close) why.push('ресиверы и фильтры — вплотную друг к другу (исключение: иначе ресиверы пришлось бы выносить наружу)');
    if (v.s5) why.push('ресиверы — по 500 л (без учёта в Ростехнадзоре): с ресиверами 900 л станция не помещается в габарит перевозки');
    if (v.out) why.push(`ресиверы — снаружи у стены станции (ФНП ОРПД, п. 65): внутри в габарите перевозки не помещаются${v.t5 ? ' — ни по 900 л, ни по 500 л' : ''}, хотя компоновка пробует два ряда, пары, поворот и плотные отступы`);
    if (wide) why.push('ширина больше габарита перевозки — негабарит (исключение)');
    return why.length ? `${v.note}. Одним ${n0>1 ? 'набором' : 'агрегатом'} со всем оборудованием внутри станция не помещается в контейнер в габарите перевозки — ${why.join('; ')}` : v.note;
  }
  /** подбор в станцию x по требованиям q (без защиты состава — run) */
  static async pick(x, q){
    const res=Math.max(0, Math.round(+q.reserve||0)), got=[], miss=[], kind=q.kind;
    const drop=kind==='comp' ? /^(compressor|dryer|filter|receiver)$/ : kind==='pump' ? /^pump$/ : /^dgu$/;
    const keep=kitParts(x).filter(p=>p.role==='container' || !drop.test(StationEquip.kindOf(p)||'')), add=[];
    const cats=(typeById({ comp:'st_comp', pump:'st_pump', dgu:'st_dgu' }[kind]).station||{}).main||[];
    const pool=this.stationPool(cats), H=this.hmax(x);
    StationSup.ctx='';   // поставщик — по подобранным основным агрегатам
    if (kind==='comp'){
      const B=q.pressure, wc=+(String(q.air||'').split('.')[1]||0), ads=(wc && wc<=3) || (q.pdp!=null && +q.pdp<=-20);
      let Bc=B, picked=null;   // давление аппаратов (осушитель, фильтры, ресиверы) — не ниже наибольшего давления компрессора
      { const rq=StationReq.ensure(x); if (q.recv==='after' || q.recv==='before') rq.recv=q.recv; if (q.recvOut) rq.recvOut=true; }   // где ресиверы — для расчёта цепочки
      // потребность из ТЗ → FAD с запасом (StationReq.need); адсорбционный осушитель — компрессоры с запасом на продувку
      const nd=q.flow>0 ? StationReq.need(q, q.flow) : { v:0, why:'' }, Q=ads && nd.v>0 ? nd.v/(1-AirChain.PURGE) : nd.v;
      // по высоте — помещаются в контейнер (габариты известны); электрические — первыми, дизельные — если их нет
      const cp=pool.filter(c=>this.fitsH(c, 'compressor', H));
      if (Q>0){ const cq={ ...q, ads }, u=this.comps(this.electric(cp), Q, B, cq) || (q.compact && this.electric(cp).length ? null : this.comps(cp, Q, B, cq));
        if (u) StationSup.ctx=StationSup.of(u.o.c);   // «чтобы поместилось» — не дизельный вместо электрического
        if (u){ Bc=u.o.p||B; picked=u; }
        if (u){ add.push(await this.part(u.o.c, u.n+res, 'main')); got.push(`компрессоры ${u.n}${res ? ' + '+res+' резервн.' : ''} × ${u.o.c.name}${nd.why ? ` (потребность: ${nd.why})` : ''}${ads ? ` (с запасом ${Math.round(AirChain.PURGE*100)} % на продувку адсорбционного осушителя)` : ''}`);
          if (B>0 && u.o.p>0 && u.o.p<this.barNeed(B, u.o.vsd)-0.05) got.push(`давление компрессора ${AirChain.m3(u.o.p)} бар — без запаса на потери в осушителе и фильтрах${u.o.vsd ? '' : ' и диапазон регулирования'} (нужно около ${AirChain.m3(this.barNeed(B, u.o.vsd))})`); }
        else miss.push(`${q.oilFree ? 'безмасляный ' : ''}${q.work>1 ? q.work+' компрессора' : 'компрессор'} на ${AirChain.m3(Q)} м³/мин${B ? ' и '+AirChain.m3(B)+' бар' : ''}`);
        if (u && q.vsd && !u.o.f) got.push('компрессора с частотным регулированием в каталоге нет — подобран без него');
        // осушитель — на всю производительность рабочих компрессоров с поправками производителя (серия в файле правил:
        // давление, вход, помещение; нет — типовая таблица и запас), давление — у потребителя (не выше фактического)
        const Qd=u ? u.o.v*u.n : Q, dm=this.dryer(ads, Qd, B, Bc, StationReq.num(String(q.tmax??'').replace(/[−–]/g, '-')), null, H, this.wmax(x)), d=dm && dm.o;
        if (d){ add.push(await this.part(d.c, dm.n)); got.push((dm.n>1 ? `осушители ${dm.n} × ${d.c.name} параллельно` : this.lbl('осушитель', d.c.name))+` (с поправками ${dm.n>1 ? dm.n+' × ' : ''}${AirChain.m3(d.cap)}${dm.n>1 ? ' = '+AirChain.m3(d.cap*dm.n) : ''} м³/мин)`); }
        else miss.push(`${ads ? 'адсорбционный' : 'рефрижераторный'} осушитель на ${AirChain.m3(Qd)} м³/мин с поправками на давление и температуру`); }
      // фильтры и ресивер — по расчёту цепочки на подобранном составе
      x.kit.parts=[...add, ...keep]; let at=add.length;   // фильтры и ресивер — после подобранного, перед прочим составом
      // цепочка воздуха — и когда компоновка не сложилась (оборудование не помещается): фильтры и ресиверы всё равно нужны
      const plan=StationLayout.solve(StationUi.input(x)), air=plan.air || KitNeed.air(x);
      for (const rec of (air && air.recs || []).filter(r=>(r.cat==='filter' || r.cat==='receiver') && !r.replace)){
        // ресиверы — по методике ПНЕВМОТЕХ (ReceiverPlan): типоразмер и число — из рекомендации цепочки (основной, мокрый,
        // у потребителя); 900 л не помещается по высоте, а нужно не больше 500 л — 500 л с обоснованием «нехватка места»
        if (rec.cat==='receiver'){
          const role=rec.role||'dry', size=this.num((rec.r.volume||[])[0])||0, H=(q.recvOut && role==='dry') || role==='local' ? 0 : this.hmax(x);
          let r=size>0 ? this.recvPick(size, Bc, H) : null, n=rec.qty||1;
          if ((!r || !r.o) && size===ReceiverPlan.UNIT && rec.need>0 && rec.need<=ReceiverPlan.SMALL){ const r5=this.recvPick(ReceiverPlan.SMALL, Bc, H);
            if (r5 && r5.o){ r=r5; n=1; StationReq.ensure(x).recvWhy='space'; } }
          if (!r || !r.o){ miss.push(rec.title.toLowerCase()+(r && r.tall ? ' — по высоте не помещается' : ' — подходящих в каталоге нет')); continue; }
          const fp=await this.part(r.o.c, n); fp.recvRole=role; x.kit.parts.splice(at++, 0, fp);
          got.push(`${role==='wet' ? 'мокрый ресивер (до осушителя)' : role==='local' ? 'ресивер у потребителя' : 'основной ресивер'}: ${n>1 ? n+' × ' : ''}${r.o.c.name}`);
          continue; }
        const fm=this.filter(rec, picked ? picked.o.v*picked.n : Q, B, Bc), c=fm && fm.o, fn=fm ? fm.n : 1;
        if (c){ const fp=await this.part(c.c, fn); fp.airGrade=rec.key;   // ступень, под которую подобран (пылевой — после адсорбционного осушителя)
          x.kit.parts.splice(at++, 0, fp); got.push(fn>1 ? `фильтры ${fn} × ${c.c.name} параллельно` : this.lbl('фильтр', c.c.name)); }
        else miss.push(rec.title.toLowerCase()); }
      return this.note(got, miss);
    }
    if (kind==='pump' && q.q>0){
      const top=v=>{ const t=StationEquip.top(v); return t ? t.v : null; };
      const u=this.units(pool.filter(c=>this.pumpOk(c)).map(c=>({ c, v:top(attrsOf(c).flow)||0, h:top(attrsOf(c).head) })).filter(o=>o.v>0 && (!(q.head>0) || o.h>=q.head)), q.q, q.work,
        o=>q.head>0 && o.h>0 ? 0.3*(o.h-q.head)/q.head : 0);
      if (u){ add.push(await this.part(u.o.c, u.n+res, 'main')); got.push(`насосы ${u.n}${res ? ' + '+res+' резервн.' : ''} × ${u.o.c.name}`); }
      else miss.push(`${q.work>1 ? q.work+' насоса' : 'насос'} на ${AirChain.m3(q.q)} м³/ч${q.head ? ' и '+AirChain.m3(q.head)+' м' : ''}`);
    }
    if (kind==='dgu' && q.kw>0){
      // мощность — по назначению (резервный — ESP, иначе PRP); только трёхфазные стационарные; одна рабочая, если в ТЗ не сказано
      // иначе; одной не хватает — несколько одинаковых параллельно (до MAX)
      const L=pool.filter(c=>this.dguOk(c)).map(c=>({ c, v:GensetSizing.cap(attrsOf(c), q.mode==='standby') })).filter(o=>o.v>0);
      const cov=o=>this.dguPen(o.c);
      const u=this.units(L, q.kw, q.work||1, cov) || (q.work ? null : this.units(L, q.kw, 0, cov)), n=u ? u.n+res : 0;
      if (u){ add.push(await this.part(u.o.c, n, 'main')); got.push(`ДГУ ${n>1 ? `${u.n}${res ? ' + '+res+' резервн.' : ''} × ` : ''}${u.o.c.name}`); } else miss.push(`ДГУ от ${AirChain.m3(q.kw)} кВт`);
      x.kit.parts=[...add, ...keep];
      const v=q.hours>0 ? StationDefaults.retank(x, q.hours) : null, fp=v && StationRules.ok() ? GensetSizing.plan(x) : null;
      if (v) got.push(`топливный бак ${v} л — на ${q.hours} ч при нагрузке ${fp ? Math.round(fp.x*100) : 75} %${fp ? ' с запасом '+Math.round((StationRules.raw('dgu.fuel_margin')-1)*100)+' %' : ''}`);
    }
    x.kit.parts=[...add, ...keep];
    return this.note(got, miss);
  }
  static note(got, miss){
    return [got.length ? 'Подобрано: '+got.join('; ') : '', miss.length ? 'В каталоге нет: '+miss.join('; ')+' — добавьте вручную' : ''].filter(Boolean).join('. ')
      || 'Требования записаны; для подбора не хватило данных (производительность, подача или мощность)';
  }
}
