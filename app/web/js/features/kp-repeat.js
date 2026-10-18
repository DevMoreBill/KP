// «Повторить КП» (журнал, карточка клиента): новое КП тому же клиенту с новыми датами и ценами каталога — с перечнем, что
// изменилось в ценах. Цена позиции и каталог (CatPrice): у позиции КП видно, если в каталоге цена теперь другая (фид обновил
// РРЦ, коллега поправил) — кнопкой «Обновить» она подставляется. Решение владельца 18.10 (пункты 13 и 15).
'use strict';

class CatPrice {
  static EPS = 0.005;        // разница меньше 0,5 % — не разница (курс, округление)
  /** цена позиции каталога в валюте КП (копейки) или null — позиции нет, цены нет или нет курса */
  static of(x){
    const c=PriceHist.doc(x); if (!c || !(c.price>0)) return null;
    const pc=c.priceCur||'RUB', cur=kpCur(); if (pc===cur) return c.price;
    const r1=rateOf(pc), r2=rateOf(cur); return r1>0 && r2>0 ? Math.round(c.price*r1/r2) : null;
  }
  /** в каталоге цена другая: {now, cat, pct} или null */
  static diff(x){
    const p=this.of(x); if (p==null || !(x.price>0)) return null;
    return Math.abs(p-x.price)/x.price > this.EPS ? {now:x.price, cat:p, pct:Math.round((p-x.price)/x.price*1000)/10} : null;
  }
  /** строка подсказки под ценой позиции (раздел «Цены и валюта») */
  static hint(x){
    const d=this.diff(x), i=S.items.indexOf(x); if (!d || i<0) return '';
    return `<span class="cp-h">В каталоге сейчас <b>${money(d.cat)} ${curSh(kpCur())}</b> (${d.pct>0?'+':''}${String(d.pct).replace('.', ',')} %)
      <button class="lnk" type="button" data-a="catPrice" data-i="${i}">обновить цену</button></span>`;
  }
  /** подставить цену каталога в позицию i */
  static apply(i){ const x=S.items[i], d=x && this.diff(x); if (!d) return; x.price=d.cat; delete x._priceText; x.priceManual=false;
    renderForm(); persist(); toast(`Цена «${x.name}» — как в каталоге: ${money(d.cat)} ${curSh(kpCur())}`); }
}

class KpRepeat {
  /** новое КП по сохранённому id: тот же клиент, сегодняшняя дата, цены каталога; изменения цен — окном */
  static async run(id){
    if (!await Drafts.stash()) return;
    let st; try{ st=await api(`/api/kp/${encodeURIComponent(id)}/state`); }catch(e){ return toast('КП не открылось: '+(e.message||e)); }
    S=Object.assign(freshState(), st);
    const was=S.number;
    for (const k of ['kpId', 'number', 'createdAt', '_rev', '_file', 'dealId']) delete S[k];
    S.date=today(); S.authorId=meId()||S.managerId||'';
    if (S.tender && S.tender.on) S.tender={on:true, number:'', url:''};          // другая закупка
    const ch=[];
    for (const x of S.items){ const d=CatPrice.diff(x); if (!d) continue; ch.push({name:x.name, ...d}); x.price=d.cat; delete x._priceText; }
    document.querySelectorAll('dialog[open]').forEach(d=>d.close());
    renderForm(); persist(); window.scrollTo({top:0}); Drafts.loaded();
    if (!ch.length) return toast(`Новое КП по № ${was}: цены как в каталоге, даты — сегодняшние`);
    const m=new Modal(`<div class="dlg-h"><h3>Повтор КП № ${esc(was)}: цены по каталогу</h3><button class="icon" type="button" data-x aria-label="Закрыть">✕</button></div>
      <p class="muted" style="margin:0 0 8px">Клиент и позиции — как в КП № ${esc(was)}, дата — сегодня. У этих позиций цена теперь как в каталоге:</p>
      <table class="pv-t kr-t"><thead><tr><th>Позиция</th><th class="num">Было</th><th class="num">Стало</th><th class="num">%</th></tr></thead><tbody>
      ${ch.map(c=>`<tr><td>${esc(c.name)}</td><td class="num">${money(c.now)}</td><td class="num"><b>${money(c.cat)}</b></td><td class="num ${c.pct>0?'up':'down'}">${c.pct>0?'+':''}${String(c.pct).replace('.', ',')}</td></tr>`).join('')}
      </tbody></table><div class="row" style="margin-top:12px"><button class="btn primary" type="button" data-x>Понятно</button></div>`, 'kr-dlg');
    m.d.addEventListener('click', e=>{ if (e.target.closest('[data-x]')) m.close(); });
  }
}
