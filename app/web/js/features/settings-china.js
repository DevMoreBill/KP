// «Настройки → Расчёты и нормы → Доставка из Китая» — только для администратора, в «Экономику сделки» пока не попадает
// (решение владельца 17.10). Расчёт перевозки до места прибытия на территорию ЕАЭС — часть таможенной стоимости
// (ТК ЕАЭС ст. 40): по ставкам экспедиторов из таблицы ниже (участок, срок действия, валюта → рубли по курсу ЦБ),
// с учётом условий поставки; ATI.SU «Средние ставки» — только контроль «не выбивается ли из рынка».
// Сервер: app/china_freight.py, /api/logistics/china.
'use strict';

class ChinaFreightTab {
  static st = null;                                     // ответ сервера: виды, участки, единицы, валюты, места прибытия, ставки
  static q = { from:'', to:'Забайкальск', dest:'', kind:'ftl', kg:'', m3:'', terms:'EXW', extraV:'', extraCur:'CNY', insV:'', insCur:'CNY' };

  static opts(map, cur){ return Object.entries(map).map(([k, t])=>`<option value="${esc(k)}"${k===cur?' selected':''}>${esc(t)}</option>`).join(''); }
  static curs(cur){ return this.st.curs.map(c=>`<option${c===cur?' selected':''}>${esc(c)}</option>`).join(''); }

  static async render(m){
    try{ this.st=await api('/api/logistics/china'); }catch(e){ m.innerHTML=`<p class="msg err">${esc(e.message||e)}</p>`; return; }
    const S=this.st, q=this.q, dirs=S.directions||[], rows=S.rates.rows||[];
    const froms=[...new Set([...dirs.map(d=>d.from), ...rows.filter(r=>r.scope!=='after').map(r=>r.from)])];
    const tos=[...new Set([...S.borders, ...dirs.map(d=>d.to), ...rows.map(r=>r.to), ...rows.filter(r=>r.scope==='after').map(r=>r.from)])];
    m.innerHTML=`<div class="st-card"><p class="sub">Доставка из Китая до места прибытия — для таможенной стоимости</p>
        <p class="muted">Перевозка, погрузка и страхование до места прибытия на территорию ЕАЭС входят в таможенную стоимость (ТК ЕАЭС, ст. 40);
          перевозка по РФ после места прибытия — не входит, только если выделена в договоре и подтверждена счётом. Через Казахстан место прибытия —
          Достык / Хоргос. Цена — по ставкам экспедиторов ниже; ATI.SU — сравнение с рынком${S.ati?(S.atiError?` (ошибка: ${esc(S.atiError)})`:` (направлений из Китая: ${dirs.length})`):' (нужен ключ ATI.SU)'},
          предупреждение при отличии больше ${esc(S.dev)} % («Значения программы → Логистика»). В экономику сделки пока не передаётся.</p>
        <div class="cf-form">
          <label class="f"><span>Откуда (город в Китае)</span><input type="text" id="cfFrom" data-nodirty list="cfFromL" value="${esc(q.from)}" placeholder="например, Шанхай" autocomplete="off"></label>
          <label class="f"><span>Место прибытия в ЕАЭС</span><input type="text" id="cfTo" data-nodirty list="cfToL" value="${esc(q.to)}" autocomplete="off"></label>
          <label class="f"><span>Пункт назначения в РФ</span><input type="text" id="cfDest" data-nodirty list="cfToL" value="${esc(q.dest)}" placeholder="для сквозных ставок" autocomplete="off"></label>
          <label class="f"><span>Вид перевозки</span><select id="cfKind" data-nodirty>${this.opts(S.kinds, q.kind)}</select></label>
          <label class="f"><span>Вес брутто, кг</span><input type="text" id="cfKg" data-nodirty inputmode="decimal" value="${esc(q.kg)}"></label>
          <label class="f"><span>Объём, м³</span><input type="text" id="cfM3" data-nodirty inputmode="decimal" value="${esc(q.m3)}"></label>
          <label class="f"><span>Условия поставки</span><select id="cfTerms" data-nodirty>${this.opts(S.terms, q.terms)}</select></label>
          <label class="f"><span>Расходы в Китае (погрузка, экспорт)</span><span class="cf-m"><input type="text" id="cfExV" data-nodirty inputmode="decimal" value="${esc(q.extraV)}" placeholder="0"><select id="cfExC" data-nodirty aria-label="Валюта">${this.curs(q.extraCur)}</select></span></label>
          <label class="f"><span>Страхование груза, если оплачено</span><span class="cf-m"><input type="text" id="cfInV" data-nodirty inputmode="decimal" value="${esc(q.insV)}" placeholder="0"><select id="cfInC" data-nodirty aria-label="Валюта">${this.curs(q.insCur)}</select></span></label>
          <button class="btn primary" type="button" data-cfgo>Рассчитать</button><button class="btn ghost" type="button" data-cfreq title="Текст запроса по полям выше: участки до места прибытия и по РФ — раздельно, валюта, срок действия, что не входит">Запрос экспедитору</button></div>
        <datalist id="cfFromL">${froms.map(x=>`<option value="${esc(x)}">`).join('')}</datalist>
        <datalist id="cfToL">${tos.map(x=>`<option value="${esc(x)}">`).join('')}</datalist>
        <div id="cfRes"></div></div>
      <div class="st-card"><p class="sub">Ставки экспедиторов</p>
        <p class="muted">Из коммерческих предложений: участок — «до места прибытия» (входит в таможенную стоимость), «сквозная до пункта в РФ» (одной суммой — входит целиком)
          или «по РФ от места прибытия» (откуда — место прибытия). Сборный груз: строки «за кг» и «за м³» одного экспедитора — берётся большее, не меньше минимальной суммы.
          Просроченная ставка помечается. ${S.rates.at?`Сохранено ${esc(String(S.rates.at).slice(0,16).replace('T',' '))}${S.rates.by?' · '+esc(S.rates.by):''}.`:''}</p>
        <div class="cf-tw"><table class="cf-t"><thead><tr><th>Откуда</th><th>Куда</th><th>Участок</th><th>Вид</th><th>Ставка</th><th>Валюта</th><th>За</th><th>Мин. сумма</th><th>Срок, дн.</th><th>Действует до</th><th>Экспедитор</th><th>Примечание</th><th></th></tr></thead>
          <tbody id="cfRows">${rows.map(r=>this.row(r)).join('')}</tbody></table></div>
        <div class="row"><button class="btn ghost" type="button" data-cfadd>+ Строка</button><button class="btn ghost" type="button" data-cftpl title="Лист «Ставки» — текущая таблица (или пример), «Как заполнить», «Запрос экспедитору». Этот же файл экспедитор может заполнить и прислать">Шаблон Excel</button><button class="btn ghost" type="button" data-cfload title="Файл .xlsx или .csv: строки добавятся в таблицу, затем — «Сохранить ставки»">Загрузить из файла</button><input type="file" id="cfFile" accept=".xlsx,.csv" hidden>${(S.ref.rows||[]).length?`<button class="btn ghost" type="button" data-cfref title="${esc((S.ref.note||'')+' Подборка от '+this.day(S.ref.date))}">+ Ориентиры из открытых данных (${S.ref.rows.length})</button>`:''}<span class="sp"></span><button class="btn primary" type="button" data-cfsave>Сохранить ставки</button></div></div>`;
    this.bind(m);
  }

  static row(r={}){ const S=this.st;
    return `<tr><td><input type="text" data-c="from" value="${esc(r.from||'')}" list="cfFromL" aria-label="Откуда"></td><td><input type="text" data-c="to" value="${esc(r.to||'')}" list="cfToL" aria-label="Куда"></td>
      <td><select data-c="scope" aria-label="Участок">${this.opts(S.scopes, r.scope||'border')}</select></td>
      <td><select data-c="kind" aria-label="Вид">${this.opts(S.kinds, r.kind||'ftl')}</select></td><td><input type="text" data-c="price" inputmode="decimal" value="${esc(r.price??'')}" aria-label="Ставка"></td>
      <td><select data-c="cur" aria-label="Валюта">${this.curs(r.cur||'CNY')}</select></td>
      <td><select data-c="unit" aria-label="За">${this.opts(S.units, r.unit||'trip')}</select></td><td><input type="text" data-c="min" inputmode="decimal" value="${esc(r.min||'')}" aria-label="Минимальная сумма"></td>
      <td><input type="text" data-c="days" inputmode="numeric" value="${esc(r.days??'')}" aria-label="Срок"></td><td><input type="date" data-c="until" value="${esc(r.until||'')}" aria-label="Действует до"></td>
      <td><input type="text" data-c="who" value="${esc(r.who||'')}" aria-label="Экспедитор">${r.ref?`<input type="hidden" data-c="ref" value="1"><small class="muted">ориентир${r.src?` · <a href="${esc(r.src)}" target="_blank" rel="noopener">источник</a>`:''}</small>`:''}<input type="hidden" data-c="src" value="${esc(r.src||'')}"></td><td><input type="text" data-c="note" value="${esc(r.note||'')}" aria-label="Примечание"></td>
      <td><button class="icon" type="button" data-cfdel title="Удалить строку" aria-label="Удалить строку">✕</button></td></tr>`; }

  static day(s){ const m=/^(\d{4})-(\d\d)-(\d\d)/.exec(s||''); return m ? `${m[3]}.${m[2]}.${m[1]}` : ''; }
  static money(o){ return `<b>${Fmt.rub(o.rub)}</b>${o.cur&&o.cur!=='RUB'?`<br><small class="muted">${esc(o.amount.toLocaleString('ru-RU'))} ${esc(o.cur)}</small>`:''}`; }
  static warns(o){ return (o.warn||[]).map(w=>`<div class="warn-t">⚠ ${esc(w)}</div>`).join(''); }

  static result(r){
    const fx=r.fx||{}, f=n=>n?String(Math.round(n*10000)/10000).replace('.',','):'—', S=this.st;
    const off=r.offers.length ? `<table class="cf-t cf-r"><thead><tr><th>Экспедитор</th><th>Участок</th><th>Перевозка</th><th>В таможенную стоимость</th><th>Срок</th><th>Как посчитано</th></tr></thead><tbody>${r.offers.map(o=>`<tr>
        <td><b>${esc(o.src)}</b>${o.srcUrl?` <a href="${esc(o.srcUrl)}" target="_blank" rel="noopener" title="Источник">↗</a>`:''}${o.until?`<br><small class="muted">до ${esc(this.day(o.until))}</small>`:''}</td><td>${esc(S.scopes[o.scope]||'')}</td><td>${this.money(o)}</td>
        <td><b>${Fmt.rub(o.cv)}</b>${o.cvParts.length>1?`<br><small class="muted">${esc(o.cvParts.map(p=>p[0]+' '+Fmt.rub(p[1])).join(' + '))}</small>`:''}</td>
        <td>${o.days?esc(o.days)+' дн.':'—'}</td><td class="muted">${esc(o.note||'')}${this.warns(o)}</td></tr>`).join('')}</tbody></table>` : '';
    const aft=r.after.length ? `<p class="sub">По РФ от места прибытия — в таможенную стоимость не входит</p><table class="cf-t"><tbody>${r.after.map(o=>`<tr><td><b>${esc(o.src)}</b></td><td>${this.money(o)}</td>
        <td>${o.days?esc(o.days)+' дн.':'—'}</td><td class="muted">${esc(o.note||'')}${this.warns(o)}</td></tr>`).join('')}</tbody></table>` : '';
    const mk=r.market ? `<p class="muted">Рынок (ATI.SU): ${Fmt.rub(r.market.rub)}${r.market.avgRub?`, в среднем ${Fmt.rub(r.market.avgRub)}`:''} — ${esc(r.market.note)}. Только для сравнения, в таможенную стоимость не идёт.</p>` : '';
    return `<p><b>${esc(r.terms)}</b>: ${esc(r.termsNote)}.</p>${off}${aft}${mk}
      ${r.errors.map(e=>`<p class="${e.skip?'muted':'warn-t'}">${esc(e.src)}: ${esc(e.msg)}</p>`).join('')}
      ${r.kz?'<p class="muted">Через Казахстан: место прибытия на территорию ЕАЭС — граница Казахстана; перевозка по Казахстану и РФ после неё в таможенную стоимость не входит, если выделена и подтверждена.</p>':''}
      <p class="muted">Курс ЦБ${fx.date?' на '+esc(fx.date):''}: CNY ${f(fx.CNY)} ₽, USD ${f(fx.USD)} ₽, EUR ${f(fx.EUR)} ₽ — для декларации берётся курс на день её регистрации.
        На несколько позиций сумма делится пропорционально весу брутто (Решение Коллегии ЕЭК № 83). Без пошлин, НДС и таможенного сбора.</p>`;
  }

  /** ориентиры из открытых данных (файл поставки, с источником и датой) — в таблицу, без повторов; действуют 30 дней от
   *  сегодня: потом просрочены, и расчёт напомнит запросить ставку экспедитора. Сохраняет администратор кнопкой */
  static addRef(m){
    const have=new Set([...m.querySelectorAll('#cfRows tr')].map(tr=>['who', 'from', 'to', 'unit'].map(k=>(tr.querySelector(`[data-c="${k}"]`)||{}).value||'').join('|')));
    const until=new Date(Date.now()+30*864e5).toISOString().slice(0, 10);
    const add=(this.st.ref.rows||[]).filter(r=>!have.has([r.who, r.from, r.to, r.unit].join('|')));
    m.querySelector('#cfRows').insertAdjacentHTML('beforeend', add.map(r=>this.row({ ...r, ref:true, until })).join(''));
    if (add.length) StDirty.set(true);
    toast(add.length ? `Добавлено ориентиров: ${add.length}. Проверьте и нажмите «Сохранить ставки»` : 'Ориентиры уже в таблице');
  }

  /** строки таблицы на экране (в том числе ещё не сохранённые) */
  static tableRows(m){ return [...m.querySelectorAll('#cfRows tr')].map(tr=>Object.fromEntries([...tr.querySelectorAll('[data-c]')].map(i=>[i.dataset.c, i.value.trim()]))).filter(r=>r.from||r.to||r.price); }
  /** поля расчёта на экране */
  static form(m){ const v=id=>(m.querySelector(id)||{}).value||''; return { ...this.q, from:v('#cfFrom').trim(), to:v('#cfTo').trim(), dest:v('#cfDest').trim(), kind:v('#cfKind'), kg:v('#cfKg').trim(), m3:v('#cfM3').trim(), terms:v('#cfTerms') }; }
  /** загрузка файла ставок: строки — в таблицу (сохраняет администратор), пропущенные — с причиной */
  static async load(m, file){
    try{ const r=ChinaRateBook.parse(await ChinaRateBook.lines(file));
      m.querySelector('#cfRows').insertAdjacentHTML('beforeend', r.rows.map(x=>this.row(x)).join(''));
      if (r.rows.length) StDirty.set(true);
      m.querySelector('#cfRes').innerHTML=`<p class="${r.bad.length?'warn-t':'muted'}">Из «${esc(file.name)}» добавлено строк: ${r.rows.length}${r.bad.length?`, пропущено: ${r.bad.length} — ${esc(r.bad.slice(0, 8).join('; '))}${r.bad.length>8?'…':''}`:''}. Проверьте таблицу и нажмите «Сохранить ставки».</p>`;
      toast(`Добавлено строк: ${r.rows.length}`); }
    catch(err){ toast('Файл не прочитан: '+(err.message||err)); }
  }

  static bind(m){
    m.querySelector('#cfFile').onchange=e=>{ const f=e.target.files[0]; e.target.value=''; if (f) this.load(m, f); };
    m.onclick=async e=>{
      if (e.target.closest('[data-cfadd]')){ m.querySelector('#cfRows').insertAdjacentHTML('beforeend', this.row()); return; }
      if (e.target.closest('[data-cfref]')){ this.addRef(m); return; }
      if (e.target.closest('[data-cftpl]')){ try{ saveFileA('Ставки_экспедиторов_Китай.xlsx', await ChinaRateBook.template(this.tableRows(m), this.form(m), this.st)); }catch(err){ toast('Шаблон не создан: '+(err.message||err)); } return; }
      if (e.target.closest('[data-cfload]')){ m.querySelector('#cfFile').click(); return; }
      if (e.target.closest('[data-cfreq]')){ const t=ChinaRateBook.request(this.form(m), this.st);
        try{ await navigator.clipboard.writeText(t); toast('Запрос скопирован — вставьте в письмо экспедитору'); }
        catch(_){ m.querySelector('#cfRes').innerHTML=`<p class="muted">Скопируйте запрос:</p><textarea class="cf-req" rows="12" readonly>${esc(t)}</textarea>`; }
        return; }
      const del=e.target.closest('[data-cfdel]'); if (del){ del.closest('tr').remove(); StDirty.set(true); return; }
      if (e.target.closest('[data-cfsave]')){
        const rows=[...m.querySelectorAll('#cfRows tr')].map(tr=>Object.fromEntries([...tr.querySelectorAll('[data-c]')].map(i=>[i.dataset.c, i.value.trim()])))
          .filter(r=>r.from||r.to||r.price);
        try{ await api('/api/logistics/china',{method:'PUT',headers:{'Content-Type':'application/json; charset=utf-8'},body:JSON.stringify({rows})});
          toast('Ставки сохранены'); StDirty.saved(); this.render(m); }
        catch(err){ toast('Не сохранено: '+(err.message||err)); }
        return; }
      const go=e.target.closest('[data-cfgo]'); if (!go) return;
      const q=this.q, v=id=>m.querySelector(id).value.trim(), num=s=>s.replace(',','.');
      Object.assign(q, { from:v('#cfFrom'), to:v('#cfTo'), dest:v('#cfDest'), kind:v('#cfKind'), kg:v('#cfKg'), m3:v('#cfM3'), terms:v('#cfTerms'),
        extraV:v('#cfExV'), extraCur:v('#cfExC'), insV:v('#cfInV'), insCur:v('#cfInC') });
      const out=m.querySelector('#cfRes'); go.disabled=true; out.innerHTML='<p class="muted">Считаю…</p>';
      try{ const r=await api('/api/logistics/china/quote',{method:'POST',headers:{'Content-Type':'application/json; charset=utf-8'},
          body:JSON.stringify({from:q.from, to:q.to, dest:q.dest, kind:q.kind, kg:num(q.kg), m3:num(q.m3), terms:q.terms,
            extra:{v:num(q.extraV), cur:q.extraCur}, ins:{v:num(q.insV), cur:q.insCur}})});
        out.innerHTML=this.result(r); }
      catch(err){ out.innerHTML=`<p class="warn-t">${esc(err.message||err)}</p>`; }
      go.disabled=false;
    };
  }
}

/** Ставки экспедиторов файлом: шаблон Excel (лист «Ставки» — его же экспедитор заполняет и присылает; «Как заполнить»;
 *  «Запрос экспедитору»), загрузка .xlsx / .csv (столбцы узнаются по заголовкам, значения — по словам: «фура», «сборный»,
 *  «до места прибытия», «за кг», «юань»…) и текст запроса экспедитору с обязательным разделением участков (ТК ЕАЭС ст. 40).
 *  Загруженное — в таблицу на вкладке; сохраняет администратор кнопкой «Сохранить ставки» (сервер проверяет всё ещё раз). */
class ChinaRateBook {
  // поле → заголовок столбца шаблона, как узнать заголовок в чужом файле
  static COLS = [['from', 'Откуда (город в Китае или место прибытия)', /^откуда|отправлен|^from/],
    ['to', 'Куда (место прибытия в ЕАЭС или город в РФ)', /^куда|назначен|^to$/], ['scope', 'Участок', /участок|scope/],
    ['kind', 'Вид перевозки', /^вид|перевозк|транспорт|kind/], ['price', 'Ставка', /^ставка|^цена|^стоимост|price|rate/],
    ['cur', 'Валюта', /валют|cur/], ['unit', 'За (рейс / кг / м³)', /^за($|[\s(])|единиц|unit/], ['min', 'Минимальная сумма', /^мин|миним|min/],
    ['days', 'Срок в пути, дн.', /срок|дн|days/], ['until', 'Действует до', /действ|до\s*даты|valid|until/],
    ['who', 'Экспедитор', /экспедит|перевозчик|компан|who/], ['note', 'Примечание', /примеч|коммент|note/]];
  static MAX = 300;

  static norm(s){ return String(s??'').toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim(); }
  /** значение из файла → код таблицы ('' — не узнано) */
  static scope(s){ s=this.norm(s); return /по рф|по росси|после|от места|after/.test(s) ? 'after' : /сквозн|through/.test(s) ? 'through' : !s || /до (места|границ|пункта пропуска)|прибыт|border/.test(s) ? 'border' : ''; }
  static kind(s){ s=this.norm(s); return /сборн|ltl|lcl/.test(s) ? 'ltl' : /негабарит|трал|tral/.test(s) ? 'tral' : /фура|тент|ftl/.test(s) ? 'ftl' : /контейнер|docker|fcl/.test(s) ? 'docker' : /машин|авто|truck/.test(s) ? 'ftl' : ''; }
  static unit(s){ s=this.norm(s); return !s || /рейс|контейнер|машин|фур|trip/.test(s) ? 'trip' : /кг|kg|килограм/.test(s) ? 'kg' : /м3|м³|куб|cbm|m3/.test(s) ? 'm3' : ''; }
  static cur(s){ s=this.norm(s); return /cny|rmb|юан|¥/.test(s) ? 'CNY' : /usd|\$|доллар/.test(s) ? 'USD' : /eur|€|евро/.test(s) ? 'EUR' : /rub|руб|₽|^р$/.test(s) ? 'RUB' : ''; }
  static num(s){ if (typeof s==='number') return s; const t=String(s??'').replace(/[\s ]/g, '').replace(',', '.').replace(/[^\d.\-]/g, ''); return t ? +t : NaN; }
  /** дата: число Excel, ДД.ММ.ГГГГ или ГГГГ-ММ-ДД → ГГГГ-ММ-ДД ('' — пусто, null — не дата) */
  static date(s){
    if (s==null || String(s).trim()==='') return '';
    if (/^\d{5}(\.\d+)?$/.test(String(s).trim())){ const d=new Date(Date.UTC(1899, 11, 30)+Math.floor(+s)*864e5); return d.toISOString().slice(0, 10); }
    let m=/^(\d{1,2})[.\/](\d{1,2})[.\/](\d{4})$/.exec(String(s).trim()); if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
    m=/^(\d{4})-(\d{2})-(\d{2})/.exec(String(s).trim()); return m ? m[0] : null;
  }

  /** строки файла ([[ячейки]]) → {rows, bad:[«строка N: причина»]}; заголовок — первая строка, где есть «Откуда» и «Ставка» */
  static parse(lines){
    const hi=lines.findIndex(r=>r.some(c=>/^откуда|^from/.test(this.norm(c))) && r.some(c=>/^ставка|^цена|^стоимост|price|rate/.test(this.norm(c))));
    if (hi<0) throw new Error('не найдена строка заголовков со столбцами «Откуда» и «Ставка» — возьмите шаблон кнопкой «Шаблон Excel»');
    const head=lines[hi].map(c=>this.norm(c)), at={};
    for (const [k, , re] of this.COLS){ const i=head.findIndex((h, j)=>re.test(h) && !Object.values(at).includes(j)); if (i>=0) at[k]=i; }
    const rows=[], bad=[];
    for (let n=hi+1; n<lines.length && rows.length<this.MAX; n++){
      const r=lines[n], v=k=>at[k]==null ? '' : String(r[at[k]]??'').trim();
      if (!v('from') && !v('to') && !v('price')) continue;
      const o={ from:v('from'), to:v('to'), scope:this.scope(v('scope')), kind:this.kind(v('kind')), price:this.num(v('price')), cur:this.cur(v('cur')),
        unit:this.unit(v('unit')), min:v('min') ? this.num(v('min')) : '', days:v('days') ? Math.round(this.num(v('days'))) : '', until:this.date(v('until')), who:v('who'), note:v('note') };
      const why=[!o.from && '«Откуда»', !o.to && '«Куда»', !(o.price>0) && 'ставка', !o.kind && 'вид перевозки', !o.scope && 'участок', !o.unit && '«За»', !o.cur && 'валюта',
        o.min!=='' && !(o.min>=0) && 'минимальная сумма', o.days!=='' && !(o.days>=0 && o.days<=365) && 'срок', o.until===null && 'дата «Действует до»'].filter(Boolean);
      if (why.length) bad.push(`строка ${n+1}: ${why.join(', ')}`); else rows.push(o);
    }
    return { rows, bad };
  }

  /** файл .xlsx / .csv → строки ячеек */
  static async lines(file){
    if (/\.xlsx$/i.test(file.name)) return LgTariffFile.readXlsx(await file.arrayBuffer());
    const t=(await file.text()).replace(/^﻿/, ''), sep=(t.split('\n')[0].match(/;/g)||[]).length>=(t.split('\n')[0].match(/,/g)||[]).length ? ';' : ',';
    return t.split(/\r?\n/).map(l=>{ const out=[]; let cur='', q=false;
      for (let i=0; i<l.length; i++){ const ch=l[i]; if (q){ if (ch==='"' && l[i+1]==='"'){ cur+='"'; i++; } else if (ch==='"') q=false; else cur+=ch; }
        else if (ch==='"') q=true; else if (ch===sep){ out.push(cur); cur=''; } else cur+=ch; }
      out.push(cur); return out; }).filter(r=>r.some(c=>c.trim()));
  }

  /** текст запроса экспедитору по полям расчёта (маршрут, груз, условия) — участки раздельно, срок действия, что включено */
  static request(q, S){
    const kind=(S.kinds[q.kind]||'').toLowerCase(), terms=(S.terms[q.terms]||q.terms||'').split(' — ')[0];
    return ['Здравствуйте! Просим рассчитать перевозку из Китая.',
      `Маршрут: ${q.from||'(город в Китае)'} → ${q.to||'(пункт пропуска)'}${q.dest?' → '+q.dest:''}.`,
      `Груз: ${kind}${q.kg?`, вес брутто ${q.kg} кг`:''}${q.m3?`, объём ${q.m3} м³`:''}. Условия поставки: ${terms}.`,
      'Прошу в ответе:',
      `1) отдельной суммой — стоимость до места прибытия на территорию ЕАЭС (${q.to||'пункт пропуска'}), включая погрузку, перевалку и оформление на границе;`,
      `2) отдельной суммой — стоимость по территории ${/казахстан|достык|хоргос/i.test(q.to||'') ? 'ЕАЭС (Казахстан и РФ)' : 'РФ'} от места прибытия${q.dest?' до пункта назначения: '+q.dest:''};`,
      '3) эти суммы так же раздельно указать в договоре и счёте (ТК ЕАЭС ст. 40 п. 2 — для таможенной стоимости);',
      '4) валюту, за что ставка (рейс / кг / м³), минимальную сумму, срок в пути и до какой даты действует ставка;',
      '5) что не входит в ставку (экспортное оформление в Китае, страхование, хранение, простой).',
      'Удобнее всего — в приложенном файле Excel (лист «Ставки»).'].join('\n');
  }

  /** шаблон: «Ставки» (текущие строки таблицы или пример), «Как заполнить», «Запрос экспедитору» */
  static async template(rows, q, S){
    const H=this.COLS.map(c=>({ v:c[1], s:'head' })), lab=(map, k)=>map[k]||k;
    const data=(rows.length ? rows : [{ from:'Шанхай', to:'Забайкальск', scope:'border', kind:'ftl', price:21000, cur:'CNY', unit:'trip', days:12, until:'', who:'Экспедитор', note:'пример — замените' }])
      .map(r=>[r.from, r.to, lab(S.scopes, r.scope||'border'), lab(S.kinds, r.kind), { v:+r.price, s:'tdMoney2' }, r.cur, lab(S.units, r.unit||'trip'),
        r.min ? { v:+r.min, s:'tdMoney2' } : '', r.days ?? '', r.until ? { v:xlsxDate(r.until), s:'tdDate' } : '', r.who||'', r.note||''].map(c=>typeof c==='object' ? c : { v:c, s:'td' }));
    const how=[[{ v:'Как заполнить лист «Ставки»', s:'title' }], [],
      ...[['Откуда / Куда', 'Город в Китае и место прибытия (Забайкальск, Пограничный, Достык, Хоргос…). Для участка «по РФ»: откуда — место прибытия, куда — город в РФ.'],
        ['Участок', `${Object.values(S.scopes).join(' / ')}. Для таможенной стоимости нужна ставка «до места прибытия» — отдельно от участка по РФ (ТК ЕАЭС ст. 40 п. 2).`],
        ['Вид перевозки', Object.values(S.kinds).join(' / ')], ['Ставка, Валюта', `Число и валюта: ${S.curs.join(', ')}.`],
        ['За', `${Object.values(S.units).join(' / ')}. Сборный груз: две строки — «за кг» и «за м³», программа берёт большее.`],
        ['Минимальная сумма', 'Если есть — в той же валюте.'], ['Действует до', 'Дата ДД.ММ.ГГГГ: после неё ставка в расчёте помечается просроченной.']]
        .map(([a, b])=>[{ v:a, s:'bold' }, { v:b, s:'text' }])];
    const req=[[{ v:'Запрос экспедитору', s:'title' }], [], ...this.request(q, S).split('\n').map(l=>[{ v:l, s:'text' }])];
    return makeXlsx([{ name:'Ставки', cols:[22, 22, 24, 22, 12, 8, 18, 12, 10, 13, 22, 30], rows:[H, ...data], freeze:1 },
      { name:'Как заполнить', cols:[22, 100], rows:how }, { name:'Запрос экспедитору', cols:[120], rows:req }], 'Ставки экспедиторов Китай');
  }
}
