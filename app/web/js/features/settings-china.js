// «Настройки → Расчёты и нормы → Доставка из Китая» — только для администратора, в «Экономику сделки» не попадает.
// Расчёт Китай → граница РФ: ATI.SU «Средние ставки» (направления из Китая) и ставки экспедиторов из таблицы ниже
// (в USD / CNY / EUR / RUB — в рубли по курсу ЦБ). Сервер: app/china_freight.py, /api/logistics/china.
'use strict';

class ChinaFreightTab {
  static st = null;                                     // ответ сервера: виды, единицы, валюты, пункты пропуска, ставки
  static q = { from:'', to:'Забайкальск', kind:'ftl', kg:'', m3:'' };

  static opts(map, cur){ return Object.entries(map).map(([k, t])=>`<option value="${esc(k)}"${k===cur?' selected':''}>${esc(t)}</option>`).join(''); }
  static rub(n){ return Math.round(n).toLocaleString('ru-RU')+' ₽'; }

  static async render(m){
    try{ this.st=await api('/api/logistics/china'); }catch(e){ m.innerHTML=`<p class="msg err">${esc(e.message||e)}</p>`; return; }
    const S=this.st, q=this.q, dirs=S.directions||[];
    const froms=[...new Set([...dirs.map(d=>d.from), ...(S.rates.rows||[]).map(r=>r.from)])];
    const tos=[...new Set([...S.borders, ...dirs.map(d=>d.to), ...(S.rates.rows||[]).map(r=>r.to)])];
    m.innerHTML=`<div class="st-card"><p class="sub">Расчёт доставки из Китая до границы РФ</p>
        <p class="muted">В экономику сделки не попадает. Открытого API расчёта Китай → РФ у перевозчиков нет, поэтому два источника:
          ATI.SU «Средние ставки» (${S.ati?(S.atiError?`ошибка: ${esc(S.atiError)}`:`ключ задан, направлений из Китая: ${dirs.length}`):'нужен ключ ATI.SU в «Внешние сервисы → Ключи API»'}) — для фуры, контейнеровоза и трала (негабарит);
          и ставки экспедиторов, которые вы вписываете ниже из их предложений.</p>
        <div class="cf-form">
          <label class="f"><span>Откуда (город в Китае)</span><input type="text" id="cfFrom" data-nodirty list="cfFromL" value="${esc(q.from)}" placeholder="например, Шанхай" autocomplete="off"></label>
          <label class="f"><span>Куда (пункт пропуска или город)</span><input type="text" id="cfTo" data-nodirty list="cfToL" value="${esc(q.to)}" autocomplete="off"></label>
          <label class="f"><span>Вид перевозки</span><select id="cfKind" data-nodirty>${this.opts(S.kinds, q.kind)}</select></label>
          <label class="f"><span>Вес, кг</span><input type="text" id="cfKg" data-nodirty inputmode="decimal" value="${esc(q.kg)}" placeholder="для ставок за кг"></label>
          <label class="f"><span>Объём, м³</span><input type="text" id="cfM3" data-nodirty inputmode="decimal" value="${esc(q.m3)}" placeholder="для ставок за м³"></label>
          <button class="btn primary" type="button" data-cfgo>Рассчитать</button></div>
        <datalist id="cfFromL">${froms.map(x=>`<option value="${esc(x)}">`).join('')}</datalist>
        <datalist id="cfToL">${tos.map(x=>`<option value="${esc(x)}">`).join('')}</datalist>
        <div id="cfRes"></div></div>
      <div class="st-card"><p class="sub">Ставки экспедиторов</p>
        <p class="muted">Из коммерческих предложений экспедиторов: маршрут, вид перевозки, ставка и валюта. Ставка «за кг» или «за м³» умножается на вес или объём из расчёта.
          ${S.rates.at?`Сохранено ${esc(String(S.rates.at).slice(0,16).replace('T',' '))}${S.rates.by?' · '+esc(S.rates.by):''}.`:''}</p>
        <div class="cf-tw"><table class="cf-t"><thead><tr><th>Откуда</th><th>Куда</th><th>Вид</th><th>Ставка</th><th>Валюта</th><th>За</th><th>Срок, дн.</th><th>Экспедитор</th><th>Примечание</th><th></th></tr></thead>
          <tbody id="cfRows">${(S.rates.rows||[]).map(r=>this.row(r)).join('')}</tbody></table></div>
        <div class="row"><button class="btn ghost" type="button" data-cfadd>+ Строка</button><span class="sp"></span><button class="btn primary" type="button" data-cfsave>Сохранить ставки</button></div></div>`;
    this.bind(m);
  }

  static row(r={}){ const S=this.st;
    return `<tr><td><input type="text" data-c="from" value="${esc(r.from||'')}" list="cfFromL" aria-label="Откуда"></td><td><input type="text" data-c="to" value="${esc(r.to||'')}" list="cfToL" aria-label="Куда"></td>
      <td><select data-c="kind" aria-label="Вид">${this.opts(S.kinds, r.kind||'ftl')}</select></td><td><input type="text" data-c="price" inputmode="decimal" value="${esc(r.price??'')}" aria-label="Ставка"></td>
      <td><select data-c="cur" aria-label="Валюта">${S.curs.map(c=>`<option${c===(r.cur||'USD')?' selected':''}>${esc(c)}</option>`).join('')}</select></td>
      <td><select data-c="unit" aria-label="За">${this.opts(S.units, r.unit||'trip')}</select></td><td><input type="text" data-c="days" inputmode="numeric" value="${esc(r.days??'')}" aria-label="Срок"></td>
      <td><input type="text" data-c="who" value="${esc(r.who||'')}" aria-label="Экспедитор"></td><td><input type="text" data-c="note" value="${esc(r.note||'')}" aria-label="Примечание"></td>
      <td><button class="icon" type="button" data-cfdel title="Удалить строку" aria-label="Удалить строку">✕</button></td></tr>`; }

  static result(r){
    const fx=r.fx||{}, f=n=>n?String(Math.round(n*100)/100).replace('.',','):'—';
    return `${r.offers.length?`<table class="cf-t cf-r"><thead><tr><th>Источник</th><th>Стоимость</th><th>Срок</th><th>Как посчитано</th></tr></thead><tbody>${r.offers.map(o=>`<tr><td><b>${esc(o.src)}</b></td>
        <td><b>${this.rub(o.rub)}</b>${o.cur&&o.cur!=='RUB'?`<br><small class="muted">${esc(o.amount.toLocaleString('ru-RU'))} ${esc(o.cur)}</small>`:''}${o.avgRub?`<br><small class="muted">в среднем ${this.rub(o.avgRub)}</small>`:''}</td>
        <td>${o.days?esc(o.days)+' дн.':'—'}</td><td class="muted">${esc(o.note||'')}</td></tr>`).join('')}</tbody></table>`:''}
      ${r.errors.map(e=>`<p class="warn-t">${esc(e.src)}: ${esc(e.msg)}</p>`).join('')}
      <p class="muted">Курс ЦБ${fx.date?' на '+esc(fx.date):''}: USD ${f(fx.USD)} ₽, CNY ${f(fx.CNY)} ₽, EUR ${f(fx.EUR)} ₽. До границы РФ — без растаможки, пошлин и доставки по России.</p>`;
  }

  static bind(m){
    m.onclick=async e=>{
      if (e.target.closest('[data-cfadd]')){ m.querySelector('#cfRows').insertAdjacentHTML('beforeend', this.row()); return; }
      const del=e.target.closest('[data-cfdel]'); if (del){ del.closest('tr').remove(); StDirty.set(true); return; }
      if (e.target.closest('[data-cfsave]')){
        const rows=[...m.querySelectorAll('#cfRows tr')].map(tr=>Object.fromEntries([...tr.querySelectorAll('[data-c]')].map(i=>[i.dataset.c, i.value.trim()])))
          .filter(r=>r.from||r.to||r.price);
        try{ await api('/api/logistics/china',{method:'PUT',headers:{'Content-Type':'application/json; charset=utf-8'},body:JSON.stringify({rows})});
          toast('Ставки сохранены'); StDirty.saved(); this.render(m); }
        catch(err){ toast('Не сохранено: '+(err.message||err)); }
        return; }
      const go=e.target.closest('[data-cfgo]'); if (!go) return;
      const q=this.q; q.from=m.querySelector('#cfFrom').value.trim(); q.to=m.querySelector('#cfTo').value.trim(); q.kind=m.querySelector('#cfKind').value;
      q.kg=m.querySelector('#cfKg').value.trim(); q.m3=m.querySelector('#cfM3').value.trim();
      const out=m.querySelector('#cfRes'); go.disabled=true; out.innerHTML='<p class="muted">Считаю…</p>';
      try{ const r=await api('/api/logistics/china/quote',{method:'POST',headers:{'Content-Type':'application/json; charset=utf-8'},
          body:JSON.stringify({from:q.from, to:q.to, kind:q.kind, kg:q.kg.replace(',','.'), m3:q.m3.replace(',','.')})});
        out.innerHTML=this.result(r); }
      catch(err){ out.innerHTML=`<p class="warn-t">${esc(err.message||err)}</p>`; }
      go.disabled=false;
    };
  }
}
