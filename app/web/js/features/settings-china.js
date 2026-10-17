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
          <button class="btn primary" type="button" data-cfgo>Рассчитать</button></div>
        <datalist id="cfFromL">${froms.map(x=>`<option value="${esc(x)}">`).join('')}</datalist>
        <datalist id="cfToL">${tos.map(x=>`<option value="${esc(x)}">`).join('')}</datalist>
        <div id="cfRes"></div></div>
      <div class="st-card"><p class="sub">Ставки экспедиторов</p>
        <p class="muted">Из коммерческих предложений: участок — «до места прибытия» (входит в таможенную стоимость), «сквозная до пункта в РФ» (одной суммой — входит целиком)
          или «по РФ от места прибытия» (откуда — место прибытия). Сборный груз: строки «за кг» и «за м³» одного экспедитора — берётся большее, не меньше минимальной суммы.
          Просроченная ставка помечается. ${S.rates.at?`Сохранено ${esc(String(S.rates.at).slice(0,16).replace('T',' '))}${S.rates.by?' · '+esc(S.rates.by):''}.`:''}</p>
        <div class="cf-tw"><table class="cf-t"><thead><tr><th>Откуда</th><th>Куда</th><th>Участок</th><th>Вид</th><th>Ставка</th><th>Валюта</th><th>За</th><th>Мин. сумма</th><th>Срок, дн.</th><th>Действует до</th><th>Экспедитор</th><th>Примечание</th><th></th></tr></thead>
          <tbody id="cfRows">${rows.map(r=>this.row(r)).join('')}</tbody></table></div>
        <div class="row"><button class="btn ghost" type="button" data-cfadd>+ Строка</button>${(S.ref.rows||[]).length?`<button class="btn ghost" type="button" data-cfref title="${esc((S.ref.note||'')+' Подборка от '+this.day(S.ref.date))}">+ Ориентиры из открытых данных (${S.ref.rows.length})</button>`:''}<span class="sp"></span><button class="btn primary" type="button" data-cfsave>Сохранить ставки</button></div></div>`;
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

  static bind(m){
    m.onclick=async e=>{
      if (e.target.closest('[data-cfadd]')){ m.querySelector('#cfRows').insertAdjacentHTML('beforeend', this.row()); return; }
      if (e.target.closest('[data-cfref]')){ this.addRef(m); return; }
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
