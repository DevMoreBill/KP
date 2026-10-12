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
    rh:'Влажность, %', margin:'Запас производительности, %', mode:'Режим ДЭС', load:'Средняя нагрузка, %', motor:'Наибольший двигатель, кВт', start:'Пуск двигателя', fire:'Категория помещения', noise:'Шум, дБА' };
  static cur = null;

  /** выбрать файл ТЗ: i — станция в КП (требования — к ней), null — новая станция */
  static pick(i){
    const f=$('#filePick'); f.value=''; f.multiple=false; f.accept=this.ACCEPT;
    f.onchange=async ()=>{ const fl=f.files[0]; f.accept=''; if (!fl) return;
      if (fl.size>40*1024*1024) return toast('Файл больше 40 МБ');
      toast(/\.(png|jpe?g|tiff?|bmp)$/i.test(fl.name) ? 'Распознаю скан ТЗ…' : 'Читаю ТЗ…');
      let r; try{ r=await api('/api/tz/parse?name='+encodeURIComponent(fl.name), { method:'POST', headers:{ 'Content-Type':'application/octet-stream' }, body:fl }); }
      catch(e){ return toast(String(e && e.message || e)); }
      this.open(r, fl.name, i); };
    f.click();
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
    const sum=F.length ? `Из ТЗ взято ${n('found')} ${this.plural(n('found'), 'параметр', 'параметра', 'параметров')}${n('default')+n('missing') ? `; остальное — по умолчанию, с запасом в пользу заказчика` : ''}${n('conflict') ? `; разные значения в ТЗ (${n('conflict')}) — принято более требовательное` : ''}.`
      : found.length ? `Из ТЗ взято ${found.length} ${this.plural(found.length, 'значение', 'значения', 'значений')}.` : 'В тексте не нашлось числовых требований — впишите главное сами.';
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
  static plural(n, one, few, many){ const a=Math.abs(n)%100, b=a%10; return a>10 && a<20 ? many : b===1 ? one : b>=2 && b<=4 ? few : many; }

  /** значение параметра анкеты словами (ключи выбора — понятным текстом) */
  static VAL = { basis:{ fad:'FAD — условия всасывания', normal:'нормальные м³' }, mode:{ prime:'основной (PRP)', standby:'резервный (ESP)' },
    start:{ direct:'прямой', stardelta:'звезда — треугольник', soft:'плавный пуск', vsd:'частотный преобразователь' }, reserve:{ 0:'без резерва', 1:'N + 1', 2:'N + 2' }, rel:{ 1:'I', 2:'II', 3:'III' } };
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
{"kind":"comp|pump|dgu","flow":м³/мин,"basis":"fad|normal" (normal — если производительность в нормальных м³, нм³),"pressure":бар у потребителя,"air":"класс ISO 8573-1 вида 1.4.1",
"margin":запас производительности %,"q":м³/ч,"head":м,"kw":кВт,"mode":"prime|standby" (ДЭС — основной или резервный источник),"load":средняя нагрузка %,"motor":кВт наибольшего двигателя нагрузки,
"start":"direct|stardelta|soft|vsd","hours":работа от бака ч,"work":рабочих агрегатов 1…4,"reserve":0|1|2,"tmin":°C,"tmax":°C,"alt":высота над уровнем моря м,"rh":влажность %,
"climate":"У1|УХЛ1|ХЛ1","fire":"А|Б|В1|В2|В3|В4|Г|Д","noise":дБА,"recvOut":true|false,"cont":"block|sea20|sea40|sea20hc|sea40hc|north",
"oilFree":true|false,"vsd":true|false,"ats":true|false,"scada":true|false,"notes":"прочие требования кратко"}. Неизвестное — не указывай, не выдумывай.\n\nТЕКСТ ТЗ:\n${text}`;
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
      kitSync(x); stationFill(x); stationAutoName(x); StationUi.cache.delete(x.id); StationSize.apply(x, true); }
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
class TzPick {
  static get LOSS(){ return StationRules.raw('loss.pick'); }   // запас давления компрессора к требуемому, бар (файл правил)
  static GRADE = { dust:['dust', 'fine'] };   // после адсорбционного осушителя годится и фильтр тонкой очистки 1 мкм
  static num(v){ return StationEquip.num(v); }
  /** производительность позиции каталога в единицах подбора: компрессоры и осушители — м³/мин, насосы — м³/ч */
  static flow(c){ const a=attrsOf(c), f=this.num(a.flow); return f>0 ? (a.cat==='comp_piston' ? f/1000 : f) : 0; }

  /** лучшая позиция: из подходящих — с наименьшим значением key (самая «впритык») */
  static best(list, key){ return list.reduce((b, o)=>!b || o[key]<b[key] ? o : b, null); }

  static MAX = 4;   // добор производительности количеством: до четырёх одинаковых рабочих агрегатов или аппаратов параллельно
  /** рабочие агрегаты из pool [{c, v}] на нагрузку need: {o, n}; n0 — число рабочих из ТЗ, pen(o) — штраф позиции;
   *  подбор — без недобора (в пользу заказчика): сумма рабочих не меньше нужного; одного не хватает — несколько (до MAX) */
  static units(pool, need, n0, pen=()=>0){
    let pick=null;
    for (let n=n0||1; n<=(n0||this.MAX); n++) for (const o of pool){ if (o.v*n<need-1e-9) continue;
      const score=(o.v*n-need)/need+0.08*(n-1)+pen(o); if (!pick || score<pick.score) pick={ o, n, score }; }
    return pick;
  }
  /** одинаковые аппараты параллельно на нагрузку need (осушители, фильтры): один, иначе несколько (до MAX) — наименьшее
   *  число, затем наименьший запас; list — [{c, cap}]: {o, n} | null */
  static many(list, need, max=this.MAX){
    for (let n=1; n<=max; n++){ const o=this.best(list.filter(z=>z.cap*n>=need-1e-9).map(z=>Object.assign({}, z, { over:z.cap*n-need })), 'over'); if (o) return { o, n }; }
    return null;
  }
  /** компрессоры из pool на Q, м³/мин, и B, бар, у потребителя: класс 0 по маслу — только безмасляные; частотное регулирование
   *  по ТЗ — в приоритете; безмасляный без требования — нет (дороже). q — требования ({oilFree, vsd, work}): {o, n} | null */
  static comps(pool, Q, B, q){
    const comp=c=>({ name:c.name, attrs:attrsOf(c), rows:[] }), vsd=c=>AirChain.info(comp(c), 'compressor').vsd;
    return this.units(pool.filter(c=>!q.oilFree || this.oilFree(c)).map(c=>({ c, v:this.flow(c), p:this.num(attrsOf(c).pressure), vsd:vsd(c), f:!q.vsd || vsd(c), of:!q.oilFree && this.oilFree(c) }))
      .filter(o=>o.v>0 && (!(B>0) || !(o.p>0) || o.p>=B-0.05)), Q, q.work, o=>this.barPen(o.p, B, o.vsd)+(o.f ? 0 : 0.3)+(o.of ? 0.5 : 0));
  }
  /** осушитель на Qd, м³/мин (вся производительность рабочих компрессоров) с поправками производителя (серия в файле правил:
   *  давление B у потребителя, температура tmax; нет — типовая таблица и запас); давление аппарата — не ниже Bc (компрессор);
   *  точка росы адсорбционного — не выше pdp (если известна). Одного не хватает — несколько одинаковых параллельно: {o, n} */
  static dryer(ads, Qd, B, Bc, tmax, pdp=null){
    const t=DryerSizing.temps({ tmax, tin:null }), pb=B>0 ? B : StationRules.raw('dryer.ref').p, dc=ads ? 'dryer_ads' : 'dryer_refrig';
    const dp=c=>this.num(String(attrsOf(c).dewPoint??'').replace(/[−–]/g, '-'));
    return this.many(catCache.filter(c=>attrsOf(c).cat===dc && (pdp==null || dp(c)==null || dp(c)<=pdp+0.5)).map(c=>{ const a=attrsOf(c), F=DryerSizing.factor({ name:c.name, attrs:a, rows:[] }, pb, t, ads ? 'ads' : 'refrig').F; return { c, v:this.flow(c), cap:this.flow(c)*F }; })
      .filter(o=>o.v>0 && (!(Bc>0) || !(this.num(attrsOf(o.c).pressure)>0) || this.num(attrsOf(o.c).pressure)>=Bc-0.05)), Qd);
  }
  /** фильтр ступени rec.key (рекомендация AirChain) на Qf, м³/мин: с поправкой производителя на давление у потребителя (как в
   *  расчёте станции: давление не выше фактического), иначе — типовой; давление фильтра — не ниже Bc. Одного не хватает —
   *  несколько одинаковых параллельно; Qf неизвестна — самый маленький этой ступени: {o, n} | null */
  static filter(rec, Qf, B, Bc){
    const pf=B>0 ? B+StationRules.raw('loss.pipe') : StationRules.raw('dryer.ref').p;
    const kf=(c, a)=>{ const s=StationRules.series({ name:c.name, attrs:a, rows:[] }, 'filter'); return s ? StationRules.interp(s.f.p, pf) : AirChain.kf(pf); };
    const ok=c=>{ const a=attrsOf(c), p={ name:c.name, attrs:a, rows:[] }; if (a.cat!=='filter') return false;
      if (!(this.GRADE[rec.key]||[rec.key]).includes(AirChain.grade(p, a.cat, AirChain.text(p)))) return false;   // ступень — по полю или названию (DD, PD, «0,01 мкм»…)
      if (Qf>0 && !(this.flow(c)>0)) return false;
      return !(Bc>0 && this.num(a.pressure)>0 && this.num(a.pressure)<Bc-0.05); };
    if (Qf>0) return this.many(catCache.filter(ok).map(c=>({ c, cap:this.flow(c)*kf(c, attrsOf(c)) })), Qf);
    const b=this.best(catCache.filter(ok).map(c=>({ c, v:this.num(attrsOf(c).flow)||0 })), 'v'); return b ? { o:b, n:1 } : null;
  }
  /** давление компрессора, бар, нужное для B у потребителя: потери в подготовке воздуха (loss.pick) и — без частотного
   *  регулирования — диапазон «нагрузка — холостой ход» (pressure.band): давление включения не ниже нужного */
  static barNeed(B, vsd){ return B+this.LOSS+(vsd ? 0 : StationRules.raw('pressure.band')); }
  /** штраф компрессора по давлению: меньше нужного — сильный, больше — по 0,05 за бар */
  static barPen(p, B, vsd){ if (!(B>0) || !(p>0)) return 0; const need=this.barNeed(B, vsd); return p<need-0.05 ? 0.5 : 0.05*(p-need); }
  /** безмасляный компрессор: по названию или характеристикам («безмасляный», oil-free, класс 0) */
  static oilFree(c){ const a=attrsOf(c); return /безмасл|oil[\s-]?free|класс\w*\s*0(?![.,\d])/i.test([c.name, a.model, a.series, a.lubrication, a.oil].filter(Boolean).join(' ')); }
  /** ресиверы на объём V, л: один, иначе несколько одинаковых — наименьшее число, затем наименьший объём; сначала — каждый без
   *  учёта в Ростехнадзоре (p·V не больше 1,0 МПа·м³, до шести), иначе — любые (до четырёх); давление — не ниже B, высота с
   *  арматурой (+300 мм) — не выше Hmax (0 — без ограничения: ресивер снаружи). {o, n, free — без учёта} */
  static receivers(V, B, Hmax){
    const L=catCache.filter(c=>attrsOf(c).cat==='receiver').map(c=>{ const a=attrsOf(c); return { c, v:this.num(a.volume)||0, p:this.num(a.pressure), h:StationEquip.dims({ name:c.name, attrs:a, rows:[] }, 'receiver').h }; })
      .filter(o=>o.v>0 && (!(B>0) || !(o.p>0) || o.p>=B-0.05) && (!(Hmax>0) || o.h+300<=Hmax));
    const free=o=>!(B>0) || B/10*o.v/1000<=PressureVessel.LIMIT+1e-9;
    // по умолчанию — одинаковые по 900 л (receiver.base, решение ПНЕВМОТЕХ), сколько нужно по объёму: производитель в
    // приоритете (АСО) — первым, затем в наличии, наименьшее достаточное давление, дешевле, ниже; нет таких — прежний подбор
    const B0=AirChain.BASE, bs=B0 ? AirChain.base(V>0 ? V : B0.volume, B) : null;
    if (bs && bs.n<=6){ const mk=String(B0.maker||'').trim().toLowerCase(), pri=o=>mk && String(attrsOf(o.c).maker||'').trim().toLowerCase()===mk ? 0 : 1;
      const C=L.filter(o=>Math.abs(o.v-bs.v)<0.5 && free(o)).sort((a, b)=>pri(a)-pri(b) || this.stock(b.c)-this.stock(a.c) || (a.p||99)-(b.p||99) || this.cheaper(a.c, b.c) || a.h-b.h);
      if (C.length) return { o:C[0], n:bs.n, free:true, base:true }; }
    if (!(V>0)) return L.length ? { o:this.best(L, 'v'), n:1, free:true } : null;
    for (const [only, max] of [[true, 6], [false, 4]]) for (let n=1; n<=max; n++){ const o=this.best(L.filter(z=>z.v*n>=V-1e-9 && (!only || free(z))), 'v'); if (o) return { o, n, free:free(o) }; }
    return null;
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
  /** «осушитель …» — без повтора, если это слово уже есть в названии («Воздушный ресивер АСО…») */
  static lbl(word, name){ return String(name||'').toLowerCase().includes(word.slice(0, 5)) ? name : word+' '+name; }

  /** подбор и сборка станции: шкафы по особым требованиям (АВР, АСУ ТП), оборудование из каталога, название и
   *  характеристики станции, контейнер по оборудованию; ответ — итог подбора для менеджера */
  static async assemble(x, q){
    const added=StationReq.ensureParts(x), note=await this.run(x, q);
    kitSync(x); stationFill(x); stationAutoName(x); StationUi.cache.delete(x.id); StationSize.apply(x, true);
    return [note, added.length ? 'Добавлено по ТЗ: '+added.join(', ') : ''].filter(Boolean).join('. ');
  }

  static async part(c, qty, role){
    let doc=c; try{ doc=await api('/api/catalog/'+encodeURIComponent(c.id)); }catch(_){}
    const p=KitPart.fromCat(doc); p.qty=qty; if (role) p.role=role; return p;
  }

  /** подбор в станцию x; ответ — строка для менеджера: что подобрано и чего в каталоге нет */
  static async run(x, q){
    const res=Math.max(0, Math.round(+q.reserve||0)), got=[], miss=[], kind=q.kind;
    const drop=kind==='comp' ? /^(compressor|dryer|filter|receiver)$/ : kind==='pump' ? /^pump$/ : /^dgu$/;
    const keep=kitParts(x).filter(p=>p.role==='container' || !drop.test(StationEquip.kindOf(p)||'')), add=[];
    const cats=(typeById({ comp:'st_comp', pump:'st_pump', dgu:'st_dgu' }[kind]).station||{}).main||[];
    const pool=catCache.filter(c=>cats.includes(attrsOf(c).cat));
    if (kind==='comp'){
      const B=q.pressure, wc=+(String(q.air||'').split('.')[1]||0), ads=(wc && wc<=3) || (q.pdp!=null && +q.pdp<=-20);
      let Bc=B, picked=null;   // давление аппаратов (осушитель, фильтры, ресиверы) — не ниже наибольшего давления компрессора
      // потребность из ТЗ → FAD с запасом (StationReq.need); адсорбционный осушитель — компрессоры с запасом на продувку
      const nd=q.flow>0 ? StationReq.need(q, q.flow) : { v:0, why:'' }, Q=ads && nd.v>0 ? nd.v/(1-AirChain.PURGE) : nd.v;
      if (Q>0){ const u=this.comps(pool, Q, B, q);
        if (u){ Bc=u.o.p||B; picked=u; }
        if (u){ add.push(await this.part(u.o.c, u.n+res, 'main')); got.push(`компрессоры ${u.n}${res ? ' + '+res+' резервн.' : ''} × ${u.o.c.name}${nd.why ? ` (потребность: ${nd.why})` : ''}${ads ? ` (с запасом ${Math.round(AirChain.PURGE*100)} % на продувку адсорбционного осушителя)` : ''}`);
          if (B>0 && u.o.p>0 && u.o.p<this.barNeed(B, u.o.vsd)-0.05) got.push(`давление компрессора ${AirChain.m3(u.o.p)} бар — без запаса на потери в осушителе и фильтрах${u.o.vsd ? '' : ' и диапазон регулирования'} (нужно около ${AirChain.m3(this.barNeed(B, u.o.vsd))})`); }
        else miss.push(`${q.oilFree ? 'безмасляный ' : ''}${q.work>1 ? q.work+' компрессора' : 'компрессор'} на ${AirChain.m3(Q)} м³/мин${B ? ' и '+AirChain.m3(B)+' бар' : ''}`);
        if (u && q.vsd && !u.o.f) got.push('компрессора с частотным регулированием в каталоге нет — подобран без него');
        // осушитель — на всю производительность рабочих компрессоров с поправками производителя (серия в файле правил:
        // давление, вход, помещение; нет — типовая таблица и запас), давление — у потребителя (не выше фактического)
        const Qd=u ? u.o.v*u.n : Q, dm=this.dryer(ads, Qd, B, Bc, StationReq.num(String(q.tmax??'').replace(/[−–]/g, '-'))), d=dm && dm.o;
        if (d){ add.push(await this.part(d.c, dm.n)); got.push((dm.n>1 ? `осушители ${dm.n} × ${d.c.name} параллельно` : this.lbl('осушитель', d.c.name))+` (с поправками ${dm.n>1 ? dm.n+' × ' : ''}${AirChain.m3(d.cap)}${dm.n>1 ? ' = '+AirChain.m3(d.cap*dm.n) : ''} м³/мин)`); }
        else miss.push(`${ads ? 'адсорбционный' : 'рефрижераторный'} осушитель на ${AirChain.m3(Qd)} м³/мин с поправками на давление и температуру`); }
      // фильтры и ресивер — по расчёту цепочки на подобранном составе
      x.kit.parts=[...add, ...keep]; let at=add.length;   // фильтры и ресивер — после подобранного, перед прочим составом
      const plan=StationLayout.solve(StationUi.input(x));
      for (const rec of (plan.air && plan.air.recs || []).filter(r=>(r.cat==='filter' || r.cat==='receiver') && !r.replace)){
        const lo=Object.fromEntries(Object.entries(rec.r||{}).map(([k, v])=>[k, this.num((v||[])[0])]));
        // общий объём ресиверов — как в расчёте станции (ReceiverSizing): по наибольшему подобранному компрессору, без недобора
        if (rec.cat==='receiver' && rec.total>0) lo.volume=picked && picked.o.v>0 ? Math.round(picked.o.v*(picked.o.vsd ? StationRules.raw('receiver.vsd') : AirChain.RECV)) : rec.total;
        if (rec.cat==='receiver' && q.recvVol>0) lo.volume=q.recvVol;
        if (rec.cat==='receiver'){   // ресиверы: один или несколько; «до и после осушителя» — два (до — «мокрый», после — «сухой»)
          const both=q.recv==='both', V=lo.volume||0, r=this.receivers(both ? V/2 : V, Bc, q.recvOut ? 0 : this.hmax(x));
          if (!r){ miss.push(rec.title.toLowerCase()); continue; }
          for (let j=0; j<(both ? 2 : 1); j++) x.kit.parts.splice(at++, 0, await this.part(r.o.c, r.n));
          const n=r.n*(both ? 2 : 1);
          got.push((n>1 ? `ресиверы ${n} × ` : '')+this.lbl('ресивер', r.o.c.name)+(r.base ? (r.n>1 ? ` (${r.n} по ${StationLayout.n(r.o.v)} л — нужно около ${StationLayout.n(Math.round(both ? V/2 : V))} л)` : '')
            : r.n>1 ? ` (${r.n} по ${StationLayout.n(r.o.v)} л: ${r.free && Bc>0 && Bc/10*(both ? V/2 : V)/1000>PressureVessel.LIMIT ? 'каждый без учёта в Ростехнадзоре, p·V не больше 1,0 МПа·м³' : `одного на ${StationLayout.n(both ? V/2 : V)} л в каталоге нет или он не проходит по высоте контейнера`})` : ''));
          continue; }
        const fm=this.filter(rec, picked ? picked.o.v*picked.n : Q, B, Bc), c=fm && fm.o, fn=fm ? fm.n : 1;
        if (c){ x.kit.parts.splice(at++, 0, await this.part(c.c, fn)); got.push(fn>1 ? `фильтры ${fn} × ${c.c.name} параллельно` : this.lbl('фильтр', c.c.name)); }
        else miss.push(rec.title.toLowerCase()); }
      return this.note(got, miss);
    }
    if (kind==='pump' && q.q>0){
      const u=this.units(pool.map(c=>({ c, v:this.num(attrsOf(c).flow)||0, h:this.num(attrsOf(c).head) })).filter(o=>o.v>0 && (!(q.head>0) || o.h>=q.head)), q.q, q.work,
        o=>q.head>0 && o.h>0 ? 0.3*(o.h-q.head)/q.head : 0);
      if (u){ add.push(await this.part(u.o.c, u.n+res, 'main')); got.push(`насосы ${u.n}${res ? ' + '+res+' резервн.' : ''} × ${u.o.c.name}`); }
      else miss.push(`${q.work>1 ? q.work+' насоса' : 'насос'} на ${AirChain.m3(q.q)} м³/ч${q.head ? ' и '+AirChain.m3(q.head)+' м' : ''}`);
    }
    if (kind==='dgu' && q.kw>0){
      const u=this.units(pool.map(c=>({ c, v:this.num(attrsOf(c).kw)||0 })).filter(o=>o.v>0), q.kw, q.work||1), n=u ? u.n+res : 0;   // ДГУ — одна рабочая, если в ТЗ не сказано иначе
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
