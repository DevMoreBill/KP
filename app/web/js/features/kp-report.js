// Отчёт по КП за период (журнал → «Отчёт»): по менеджерам, категориям оборудования и клиентам — количество КП,
// сумма, выиграно / проиграно, конверсия, прибыль и маржа; выгрузка в Excel. Права — как в журнале (чужие КП и экономика —
// по правам менеджера). Сравнение версий КП (журнал → «⋯» → «Прежние версии КП» → «Сравнить с текущей») — KpDiff.
'use strict';

// отчёт по КП — группа «Журнал и отчёт по КП» в «Настройки → Значения программы → Интерфейс»
DefRegistry.add([], [
  ['ui.repClients', 'journal', 'Клиентов в отчёте «Крупнейшие клиенты»', 'num', '20', {unit:'шт.', req:true, min:5, max:500,
    hint:'Сколько клиентов с наибольшей суммой КП за период показывать в отчёте (журнал → «Отчёт») и на листе «Клиенты» в Excel. Остальные клиенты видны в списке КП отчёта.'}],
]);

class KpReport {
  static range(k){ const d=new Date(), y=d.getFullYear(), m=d.getMonth(), iso=x=>x.toISOString().slice(0,10), D=(a,b,c)=>new Date(Date.UTC(a,b,c));
    if (k==='month') return [iso(D(y,m,1)), today()];
    if (k==='prev') return [iso(D(y,m-1,1)), iso(D(y,m,0))];
    if (k==='quarter') return [iso(D(y,Math.floor(m/3)*3,1)), today()];
    return [iso(D(y,0,1)), today()]; }
  static open(f={}){
    const [a,b]=KpReport.range('month');
    const m=new Modal(`<div class="dlg-h"><h3>Отчёт по КП</h3><button class="icon" type="button" data-x aria-label="Закрыть">✕</button></div>
      <div class="rp-bar"><label class="f"><span>С</span><input type="date" id="rpA" value="${a}"></label><label class="f"><span>По</span><input type="date" id="rpB" value="${b}"></label>
        <span class="rp-q">${[['month','Этот месяц'],['prev','Прошлый месяц'],['quarter','Квартал'],['year','Год']].map(([k,l])=>`<button type="button" class="btn sm${k==='month'?' on':''}" data-rq="${k}">${l}</button>`).join('')}</span>
        <button class="btn" type="button" data-rx disabled>Excel</button></div>
      <div id="rpOut"><p class="empty">Считаю…</p></div>`, 'rp-dlg');
    const R={rows:[], f, n:0};       // n — номер запроса: ответ за прежний период (пришёл позже) не показывается
    const run=async()=>{ const out=m.$('#rpOut'); out.innerHTML='<p class="empty">Считаю…</p>'; m.$('[data-rx]').disabled=true; const n=++R.n;
      try{ const r=await api(`/api/report?from=${m.$('#rpA').value}&to=${m.$('#rpB').value}&author=${encodeURIComponent(f.author||'')}&kind=${encodeURIComponent(f.kind||'')}`);
        if (n!==R.n) return;
        R.rows=r.items||[]; R.data=KpReport.calc(R.rows); out.innerHTML=KpReport.html(R.data); m.$('[data-rx]').disabled=!R.rows.length; }
      catch(e){ if (n===R.n) out.innerHTML=`<p class="empty">Отчёт недоступен: ${esc(e.message)}</p>`; } };
    m.d.onclick=async e=>{ const t=e.target; if (t.closest('[data-x]')) return m.close();
      const q=t.closest('[data-rq]'); if (q){ const [x,y]=KpReport.range(q.dataset.rq); m.$('#rpA').value=x; m.$('#rpB').value=y; m.d.querySelectorAll('[data-rq]').forEach(z=>z.classList.toggle('on', z===q)); return run(); }
      const o=t.closest('[data-ro]'); if (o){ m.close(); return KpLoader.byId(o.dataset.ro).catch(err=>toast('Не удалось открыть: '+err.message)); }
      if (t.closest('[data-rx]')) return KpReport.excel(R.data, m.$('#rpA').value, m.$('#rpB').value); };
    m.d.onchange=e=>{ if (e.target.type==='date'){ m.d.querySelectorAll('[data-rq]').forEach(z=>z.classList.remove('on')); run(); } };
    run();
  }
  /** сводка: по менеджерам, категориям (по позициям с закупкой), клиентам; суммы — в копейках рублей */
  static calc(rows){
    const add=(map, k, o)=>{ const x=map.get(k)||{name:k, n:0, sum:0, won:0, wonSum:0, lost:0, sent:0, profit:0, pBase:0}; map.set(k,x); for (const [f,v] of Object.entries(o)) x[f]+=v; return x; };
    const byM=new Map(), byC=new Map(), byK=new Map(), list=[];
    for (const r of rows){
      const st=KpTrack.status(r.track), sum=r.sumRub||0, pr=r.profitRub, won=st==='won'?1:0;
      const o={n:1, sum, won, wonSum:won?sum:0, lost:st==='lost'?1:0, sent:st!=='new'?1:0, profit:pr??0, pBase:pr!=null?sum:0};
      add(byM, r.manager||'Без автора', o); add(byK, r.client||'Без получателя', o);
      list.push({id:r.id, number:r.number, date:r.date, client:r.client, manager:r.manager, st, sum, profit:pr});
      const c=r.calc; if (!c) continue;
      const cur=(c.pricing||{}).cur||'RUB', rate=cur==='RUB'?1:parseFloat(String((c.pricing.rates||{})[cur]||'').replace(/\s/g,'').replace(',','.'));
      const groups=new Map(); for (const x of c.items||[]){ const k=typeById((x.attrs||{}).cat).name; (groups.get(k)||groups.set(k,[]).get(k)).push(x); }
      for (const [k, items] of groups){ const e=kpEconomics({items, pricing:c.pricing, vat:c.vat});
        const toRub=v=>rate>0?Math.round(v*rate):0;
        const g=byC.get(k)||{name:k, n:0, pos:0, sum:0, sale:0, cost:0, won:0}; byC.set(k,g);
        g.n++; g.pos+=items.length; g.sum+=toRub(e.sum); g.sale+=toRub(e.sale); g.cost+=toRub(e.cost); g.won+=won?toRub(e.sum):0; }
    }
    const sortSum=m=>[...m.values()].sort((a,b)=>b.sum-a.sum);
    const tot=rows.reduce((t,r)=>{ const st=KpTrack.status(r.track); t.n++; t.sum+=r.sumRub||0; if (st==='won'){ t.won++; t.wonSum+=r.sumRub||0; } if (st==='lost') t.lost++; if (r.profitRub!=null){ t.profit+=r.profitRub; t.pBase+=r.sumRub||0; } return t; },
      {n:0, sum:0, won:0, wonSum:0, lost:0, profit:0, pBase:0});
    return { tot, mgr:sortSum(byM), cat:sortSum(byC), cli:sortSum(byK).slice(0, Math.round(DEFN('ui.repClients', 20))), list };
  }
  static pct(a, b){ return b ? (a/b*100).toFixed(1).replace('.',',')+' %' : '—'; }
  static conv(x){ return x.won+x.lost ? Math.round(x.won/(x.won+x.lost)*100)+' %' : '—'; }
  static html(D){
    if (!D.list.length) return '<p class="empty">За этот период КП нет.</p>';
    const t=D.tot, rub=v=>money(v||0)+' ₽', P=KpReport.pct, pf=FEAT.on('deal');     // прибыль и маржа — только при включённой экономике сделки
    const tile=(l,v,s='')=>`<div class="rp-t"><small>${l}</small><b>${v}</b>${s?`<span>${s}</span>`:''}</div>`;
    // столбец: [заголовок, (строка)=>ячейка, числовой?, только при экономике?]
    const tbl=(cols, rows)=>{ const cs=cols.filter(c=>pf || !c[3]);
      return `<div class="rp-tw"><table class="rp-tb"><thead><tr>${cs.map(c=>`<th>${c[0]}</th>`).join('')}</tr></thead><tbody>${rows.map(x=>`<tr>${cs.map(c=>`<td${c[2]?' class="n"':''}>${c[1](x)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`; };
    const nm=x=>esc(x.name), n=f=>x=>x[f], r=f=>x=>rub(x[f]), conv=x=>KpReport.conv(x), wonC=x=>`${x.won} · ${rub(x.wonSum)}`;
    return `<div class="rp-tiles">${tile('КП', t.n, `на ${rub(t.sum)}`)}${tile('Выиграно', t.won, rub(t.wonSum))}${tile('Проиграно', t.lost)}${tile('Конверсия', KpReport.conv(t), 'выиграно из закрытых')}
        ${pf?tile('Прибыль', rub(t.profit), t.pBase?`${P(t.profit, t.pBase)} от суммы КП с расчётом`:'нет КП с закупкой'):''}</div>
      <h4>По менеджерам</h4>${tbl([['Менеджер',nm],['КП',n('n'),1],['Сумма',r('sum'),1],['Отправлено',n('sent'),1],['Выиграно',wonC,1],['Проиграно',n('lost'),1],['Конверсия',conv,1],
        ['Прибыль',x=>x.pBase?rub(x.profit):'—',1,1],['% от суммы',x=>P(x.profit,x.pBase),1,1]], D.mgr)}
      <h4>По категориям оборудования${pf?' <span class="muted">— прибыль по позициям с закупкой, без логистики и финансирования</span>':''}</h4>${tbl([['Категория',nm],['КП',n('n'),1],['Позиций',n('pos'),1],['Сумма',r('sum'),1],['Выиграно на',r('won'),1],
        ['Продажа с закупкой',r('sale'),1,1],['Закупка',r('cost'),1,1],['Прибыль',x=>rub(x.sale-x.cost),1,1],['Маржа',x=>P(x.sale-x.cost, x.sale),1,1]], D.cat)}
      <h4>Крупнейшие клиенты</h4>${tbl([['Клиент',nm],['КП',n('n'),1],['Сумма',r('sum'),1],['Выиграно',wonC,1],['Конверсия',conv,1]], D.cli)}
      <details class="rp-all"><summary>Все КП периода (${D.list.length})</summary>${tbl([['№',x=>`<button type="button" class="lnk" data-ro="${esc(x.id)}">${esc(x.number)}</button>`],['Дата',x=>esc(KpDate.ddmm(x.date))],
        ['Клиент',x=>esc(x.client||'')],['Автор',x=>esc(jShort(x.manager||''))],['Статус',x=>`<span class="jst st-${x.st}">${KP_STATUS[x.st]}</span>`],['Сумма',r('sum'),1],['Прибыль',x=>x.profit==null?'—':rub(x.profit),1,1]], D.list)}</details>`;
  }
  static async excel(D, a, b){
    const r=v=>Math.round(v||0)/100, h=s=>({v:s, s:'head'}), H=s=>({v:s, s:'headR'}), M=v=>({v:r(v), s:'tdMoney'}), N=v=>({v, s:'tdInt'}), T=v=>({v:String(v??''), s:'td'}), Pc=(x,y)=>({v:y?x/y:0, s:'tdPct'});
    const title=[[{v:`Отчёт по КП за ${KpDate.ddmm(a)} — ${KpDate.ddmm(b)}`, s:'title'}],[]];
    const sheets=[
      {name:'Менеджеры', cols:[34,8,16,12,10,16,11,16,12], freeze:3, rows:[...title, [h('Менеджер'),H('КП'),H('Сумма, руб.'),H('Отправлено'),H('Выиграно'),H('Выиграно на, руб.'),H('Проиграно'),H('Прибыль, руб.'),H('% от суммы')],
        ...D.mgr.map(x=>[T(x.name),N(x.n),M(x.sum),N(x.sent),N(x.won),M(x.wonSum),N(x.lost),M(x.profit),Pc(x.profit,x.pBase)])]},
      {name:'Категории', cols:[36,8,10,16,16,18,16,16,10], freeze:3, rows:[...title, [h('Категория'),H('КП'),H('Позиций'),H('Сумма, руб.'),H('Выиграно на, руб.'),H('Продажа с закупкой, руб.'),H('Закупка, руб.'),H('Прибыль, руб.'),H('Маржа')],
        ...D.cat.map(x=>[T(x.name),N(x.n),N(x.pos),M(x.sum),M(x.won),M(x.sale),M(x.cost),M(x.sale-x.cost),Pc(x.sale-x.cost,x.sale)])]},
      {name:'Клиенты', cols:[44,8,16,10,16], freeze:3, rows:[...title, [h('Клиент'),H('КП'),H('Сумма, руб.'),H('Выиграно'),H('Выиграно на, руб.')],
        ...D.cli.map(x=>[T(x.name),N(x.n),M(x.sum),N(x.won),M(x.wonSum)])]},
      {name:'КП', cols:[12,12,40,28,14,16,16], freeze:3, rows:[...title, [h('№'),h('Дата'),h('Клиент'),h('Автор'),h('Статус'),H('Сумма, руб.'),H('Прибыль, руб.')],
        ...D.list.map(x=>[T(x.number),T(KpDate.ddmm(x.date)),T(x.client),T(x.manager),T(KP_STATUS[x.st]),M(x.sum),x.profit==null?T('—'):M(x.profit)])]}];
    if (!FEAT.on('deal')){     // экономика сделки выключена — без прибыли, закупки и маржи
      const drop={'Менеджеры':[7,8], 'Категории':[5,6,7,8], 'КП':[6]};
      for (const sh of sheets){ const d=drop[sh.name]; if (!d) continue; sh.cols=sh.cols.filter((_,k)=>!d.includes(k)); sh.rows=sh.rows.map(row=>row.length>2?row.filter((_,k)=>!d.includes(k)):row); }
    }
    saveFileA(`Отчёт_КП_${a}_${b}.xlsx`, await makeXlsx(sheets, 'Отчёт по КП'));
    toast('Отчёт выгружен в Excel');
  }
}

// ---------- сравнение версий КП: что изменилось между прежним вариантом и текущим
class KpDiff {
  static itemKey(x){ return x.id || norm(x.name||''); }
  static rows(a, b){
    const out=[], ch=(what, x, y)=>{ if (String(x??'')!==String(y??'')) out.push([what, x??'', y??'']); };
    ch('Получатель', a.client, b.client); ch('Дата КП', KpDate.ddmm(a.date), KpDate.ddmm(b.date)); ch('Валюта', (a.pricing||{}).cur||'RUB', (b.pricing||{}).cur||'RUB');
    ch('НДС, %', a.vat, b.vat); ch('Шаблон', a.template, b.template); ch('№ закупки', (a.tender||{}).number, (b.tender||{}).number);
    ch('Менеджер', (a.manager||{}).name, (b.manager||{}).name);
    const ea=kpEconomics(a), eb=kpEconomics(b), cs=c=>curSh(c||'RUB');
    ch('Итого с НДС', money(ea.sum)+' '+cs(ea.cur), money(eb.sum)+' '+cs(eb.cur));
    const A=new Map((a.items||[]).map(x=>[KpDiff.itemKey(x), x])), B=new Map((b.items||[]).map(x=>[KpDiff.itemKey(x), x]));
    for (const [k, x] of A) if (!B.has(k)) out.push(['Позиция удалена', `${x.name} × ${x.qty}`, '']);
    for (const [k, y] of B){ const x=A.get(k);
      if (!x){ out.push(['Позиция добавлена', '', `${y.name} × ${y.qty} — ${money(y.price||0)}`]); continue; }
      const nm=y.name||x.name;
      ch(`«${nm}»: название`, x.name, y.name); ch(`«${nm}»: количество`, x.qty, y.qty); ch(`«${nm}»: цена за ед.`, money(x.price||0), money(y.price||0));
      const dz=d=>d&&+d.v>0 ? (d.type==='sum' ? money(+d.v)+' руб.' : d.v+' %') : '';
      ch(`«${nm}»: скидка`, dz(x.disc), dz(y.disc));
      const on=o=>(o||[]).filter(z=>z.name).map(z=>`${z.name} × ${z.qty}`).join('; ');
      ch(`«${nm}»: опции`, on(x.options), on(y.options)); }
    const C=new Map((a.conditions||[]).map(c=>[c.label, c.value]));
    for (const c of b.conditions||[]) ch('Условие «'+c.label+'»', C.get(c.label), c.value);
    ch('Дополнительные условия', a.condExtra, b.condExtra);
    return out;
  }
  static async open(id, vid, number){
    let a, b; try{ [a, b]=await Promise.all([api(`/api/kp/${encodeURIComponent(id)}/versions/${vid}`), api(`/api/kp/${encodeURIComponent(id)}/state`)]); }
    catch(e){ return toast('Не удалось сравнить: '+e.message); }
    const rows=KpDiff.rows(a, b);
    const m=new Modal(`<div class="dlg-h"><h3>Что изменилось · КП № ${esc(number||id)}</h3><button class="icon" type="button" data-x aria-label="Закрыть">✕</button></div>
      ${rows.length?`<div class="rp-tw"><table class="rp-tb kd-tb"><thead><tr><th>Что</th><th>Было (выбранная версия)</th><th>Стало (текущее КП)</th></tr></thead><tbody>
        ${rows.map(([w,x,y])=>`<tr><td>${esc(w)}</td><td class="was">${esc(x)}</td><td class="now">${esc(y)}</td></tr>`).join('')}</tbody></table></div>`
        : '<p class="empty">Отличий в позициях, ценах и условиях нет (менялось только оформление).</p>'}`, 'kd-dlg');
    m.d.onclick=e=>{ if (e.target.closest('[data-x]')) m.close(); };
  }
}
