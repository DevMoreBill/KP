// Цены: валюта КП, курсы ЦБ РФ, ручные цены продажи и скидки. Цена по закупке и марже считается только при подстановке
// модели из каталога (если у неё нет цены); дальше — «Экономика сделки».
'use strict';


// подсказка под строкой цены: скидка для заказчика и цена со скидкой (закупка и маржа — в «Экономике сделки»)
function priceHint(x){
  const cs=curSh(kpCur()), d=KPGen.unitDisc(x);
  const disc = d ? `Скидка ${money(d)} ${cs} за ед. · цена для заказчика <b>${money((x.price||0)-d)} ${cs}</b>` : '';
  const rrc = rrcHint(x, (x.price||0)-d);
  return [disc, rrc, PriceHist.hint(x)].filter(Boolean).join('<br>');
}

// цены позиции в прошлых КП (функция priceHist): каталог помнит цену модели в каждом сохранённом КП (последние 50)
class PriceHist {
  static doc(x){ if (typeof CatFind==='undefined') return null; return CatFind.id(x.catId) || (x.name ? CatFind.name(x.name) : null); }
  static rows(c){ return (c&&c.prices||[]).filter(p=>p && p.price>0 && (!S.number || p.number!==S.number)); }
  static fmt(p){ return `${money(p.price)} ${curSh(p.cur||'RUB')}`; }
  static hint(x){
    if (!FEAT.on('priceHist') || !x.name) return '';
    const c=this.doc(x), L=this.rows(c); if (!L.length) return '';
    const p=L[0], n=Math.max(L.length, (c.pricesCount||0)-((c.prices||[]).length-L.length)), i=S.items.indexOf(x);
    const same=L.filter(q=>(q.cur||'RUB')===(p.cur||'RUB')).map(q=>q.price), lo=Math.min(...same), hi=Math.max(...same);
    return `<span class="ph-h">В прошлых КП: <b>${this.fmt(p)}</b> — ${p.number?'№ '+esc(p.number)+', ':''}${esc(p.client||'')}${p.date?', '+esc(KpDate.ddmm(p.date)):''}${same.length>1&&lo!==hi?` · от ${money(lo)} до ${money(hi)}`:''}
      ${i>=0?`<button class="lnk" type="button" data-a="priceHist" data-i="${i}">${n>1?'все '+n:'подробнее'}</button>`:''}</span>`;
  }
  static async open(i){
    const x=S.items[i]; if (!x) return; const lite=this.doc(x); if (!lite) return;
    const c=await fullDoc(lite), L=this.rows(c), cs=curSh(kpCur());
    const m=new Modal(`<div class="dlg-h"><h3>Цены в прошлых КП</h3><button class="icon" type="button" data-x aria-label="Закрыть">✕</button></div>
      <p class="muted" style="margin:0 0 10px">${esc(x.name)}${x.price?` · сейчас <b>${money(x.price)} ${cs}</b>`:''}</p>
      <div class="ph-l"><table class="ph-t"><thead><tr><th>Дата</th><th>КП</th><th>Клиент</th><th class="num">Кол-во</th><th class="num">Цена</th><th></th></tr></thead><tbody>
      ${L.map((p, k)=>`<tr><td>${esc(p.date?KPGen.ruDate(p.date).replace(/ г\.$/, ''):'')}</td><td>${p.number?'№ '+esc(p.number):'—'}</td><td>${esc(p.client||'')}</td><td class="num">${p.qty||''}</td><td class="num"><b>${this.fmt(p)}</b></td>
        <td>${(p.cur||'RUB')===kpCur()?`<button class="btn sm ghost" type="button" data-phu="${k}" title="Поставить эту цену в КП">Взять</button>`:''}</td></tr>`).join('')}</tbody></table></div>`, 'ph-dlg');
    m.d.onclick=e=>{ if (e.target.closest('[data-x]')) return m.close();
      const b=e.target.closest('[data-phu]'); if (!b) return; const p=L[+b.dataset.phu];
      x.price=p.price; x.priceManual=true; delete x._priceText; m.close(); renderForm(); persist(); toast(`Цена из КП № ${p.number||''}: ${this.fmt(p)}`); };
  }
}

// контроль РРЦ: цена для заказчика против рекомендованной розничной цены поставщика (позиции из товарного фида)
function rrcHint(x, unit){
  const c=x.catId && typeof CatFind!=='undefined' ? CatFind.id(x.catId) : null, r=c&&c.rrc;
  if (!r || !(r.price>0)) return '';
  const kr=rateOf(kpCur()), rr=rateOf(r.cur||'RUB');
  const st=c.stock&&typeof feedStockTxt==='function' ? ` · ${esc(feedStockTxt(c.stock))}` : '';
  if (!(kr>0) || !(rr>0) || !(unit>0)) return `<span class="rrc-h">РРЦ ${money(r.price)} ${curSh(r.cur||'RUB')}${st}</span>`;
  const mine=unit*kr, rrc=r.price*rr, diff=(mine-rrc)/rrc*100;
  const rrcTxt=`РРЦ ${money(r.price)} ${curSh(r.cur||'RUB')}`;
  if (Math.abs(diff)<0.05) return `<span class="rrc-h ok">По РРЦ (${rrcTxt})${st}</span>`;
  return diff<0 ? `<span class="rrc-h bad" title="Цена для заказчика ниже рекомендованной розничной цены поставщика">Ниже РРЦ на ${String(Math.round(-diff*10)/10).replace('.',',')} % — ${rrcTxt}${st}</span>`
    : `<span class="rrc-h">Выше РРЦ на ${String(Math.round(diff*10)/10).replace('.',',')} % — ${rrcTxt}${st}</span>`;
}

function liveMargin(i){ const el=document.querySelector(`[data-minfo="${i}"]`); if (el) el.innerHTML=priceHint(S.items[i]); }

// скидка для заказчика: x.disc = { type:'pct'|'sum', v } — процент или копейки за единицу; x.discType помнит выбранный вид
const discType = x => (x.disc && x.disc.type) || x.discType || 'pct';
function discText(x){ if (!x.disc || !(+x.disc.v>0)) return ''; return x.disc.type==='sum' ? money(x.disc.v) : String(x.disc.v).replace('.',','); }
// разбор введённой скидки; возвращает false, если значение неверное (тогда скидка не применяется)
function setDisc(x, text){
  const type=discType(x), s=String(text||'').replace(/[\s %]/g,'');
  x.discType=type;
  if (!s){ delete x.disc; return true; }
  if (type==='sum'){ const k=parsePrice(s); if (Number.isNaN(k) || k<0 || (x.price && k>x.price)){ delete x.disc; return false; } if (k) x.disc={type, v:k}; else delete x.disc; return true; }
  const v=parseFloat(s.replace(',','.')); if (!/^\d+([.,]\d{0,2})?$/.test(s) || !(v>=0 && v<100)){ delete x.disc; return false; }
  if (v) x.disc={type, v}; else delete x.disc; return true;
}

const CUR_LIST=['RUB','USD','EUR','CNY'];

const curSh = c => (CURS[c]||CURS.RUB).sh;

const kpCur = () => S.pricing.cur||'RUB';

function rateOf(c){ if (c==='RUB') return 1; const v=parseFloat(String(S.pricing.rates[c]||'').replace(/\s/g,'').replace(',','.')); return v>0?v:NaN; }

// смена валюты КП: цены позиций и опций переводятся по курсу (раздел «Цены» и окно «Экономика сделки»)
function kpSetCur(cur){
  const prev=kpCur(); if (prev===cur) return;
  const r1=rateOf(prev), r2=rateOf(cur); S.pricing.cur=cur;
  if (r1>0 && r2>0){ const cv=v=>Math.round(v*r1/r2);
    S.items.forEach(x=>{ if (x.price) x.price=cv(x.price); delete x._priceText; (x.options||[]).forEach(o=>{ if(o.price){ o.price=cv(o.price); delete o._priceText; } }); });
    toast(`Цены переведены в ${cur} по курсу`);
  } else toast('Укажите курс, чтобы перевести цены: сейчас цены не пересчитаны');
  renderForm(); persist(); if (typeof dealRender==='function') dealRender();
  if (cur!=='RUB' && !(rateOf(cur)>0)) loadCBR();
}

function roundTo(kop){ const st=Math.round(parseFloat(S.pricing.round||'0.01')*100)||1; return Math.round(kop/st)*st; }

function marginOf(x){ if (x.margin==null || x.margin==='') return null; const m=parseFloat(String(x.margin).replace(',','.')); return Number.isFinite(m)?m:null; }

const modeOf = x => x.mmode==='markup' ? 'markup' : 'margin';

function costKP(x){  // себестоимость единицы в валюте КП, копейки (с НДС)
  if (!x.cost) return null;
  const r1=rateOf(x.costCur||'RUB'), r2=rateOf(kpCur()); if (!(r1>0&&r2>0)) return NaN;
  let v=x.cost*r1/r2; if (S.pricing.costNoVat) v*=1+(+S.vat||0)/100; return v;
}

// экономика сделки по состоянию КП (текущего S или сохранённого в журнале): итог, закупка, прибыль, маржа.
// Закупка, прибыль и маржа — по позициям с указанной закупкой; курсы — сохранённые в КП
function kpEconomics(st=S){
  const P=st.pricing||{}, cur=P.cur||'RUB', vat=+st.vat||0;
  const rate=c=>{ if (!c||c==='RUB') return 1; const v=parseFloat(String((P.rates||{})[c]||'').replace(/\s/g,'').replace(',','.')); return v>0?v:NaN; };
  const items=st.items||[];
  const t=totals(items.map(x=>({qty:+x.qty||0, price:x.price||0, disc:x.disc, options:(x.options||[]).filter(o=>o.name).map(o=>({qty:+o.qty||0, price:o.price||0}))})), vat);
  const unitCost=x=>{ if (!x.cost) return null; const v=x.cost*rate(x.costCur||'RUB')/rate(cur); return P.costNoVat ? v*(1+vat/100) : v; };
  const withCost=items.filter(x=>unitCost(x)>0);
  const cost=withCost.reduce((s,x)=>s+unitCost(x)*(+x.qty||0),0), sale=withCost.reduce((s,x)=>s+KPGen.netPrice(x)*(+x.qty||0),0);
  const r=cur!=='RUB' && rate(cur)>0 ? rate(cur) : null;
  return { cur, sum:t.sum, vat:t.vat, discount:t.discount||0, sumRub: r?Math.round(t.sum*r):null,
    withCost:withCost.length, positions:items.length, cost:Math.round(cost), sale:Math.round(sale), profit:Math.round(sale-cost),
    margin: sale?(sale-cost)/sale*100:null, markup: cost?(sale-cost)/cost*100:null };
}

function calcPrice(x){
  const c=costKP(x); if (c==null||Number.isNaN(c)) return c;
  const mv=marginOf(x); if (mv==null) return null; const m=mv/100;
  const v = modeOf(x)==='markup' ? c*(1+m) : (m<0.99 ? c/(1-m) : NaN);
  return Number.isNaN(v)?NaN:roundTo(v);
}

function applyCalc(x){ if (x.priceManual || !x.cost || marginOf(x)==null) return; const p=calcPrice(x); if (p>0){ x.price=p; delete x._priceText; } }

let _autoRates=false;

function autoRates(){ const need=[kpCur(),...S.items.filter(x=>x.cost).map(x=>x.costCur||'RUB'),...S.items.flatMap(x=>kitParts(x).filter(p=>p.cost).map(p=>p.costCur||'RUB'))].filter(c=>c!=='RUB'&&!(rateOf(c)>0)); if(need.length && !_autoRates){ _autoRates=true; loadCBR().finally(()=>{_autoRates=false;}); } }

async function loadCBR(){
  const msgEl=$('#cbrMsg'); if(msgEl) msgEl.textContent='Загружаю курс ЦБ РФ…';
  let r=null, src='', why='';
  const btn=document.querySelector('[data-a="cbr"]'); if(btn){ btn.disabled=true; btn.textContent='Запрашиваю курс…'; }
  try{ r=await api('/api/cbr'); src=r.src||'ЦБ РФ (cbr.ru)'; if(!r.USD){ why=r.error||''; r=null; } }catch(e){ why=String(e.message||e).slice(0,160); }
  if (btn){ btn.disabled=false; btn.textContent='Обновить с cbr.ru'; }
  if (!r || !r.USD){ const m=$('#cbrMsg'); if(m){ m.textContent='Курс с cbr.ru не получен'+(why?` (${why})`:'')+' — введите вручную ниже.'; m.classList.add('bad-t'); } document.querySelector('details.psettings')?.setAttribute('open',''); document.querySelector('[data-rate]')?.focus(); toast('Курс ЦБ не загружен — введите вручную'); return; }
  const got=[]; for (const c of ['USD','EUR','CNY']) if (r[c]) { S.pricing.rates[c]=(+r[c]).toFixed(4).replace('.',','); got.push(c); }
  S.pricing.rateDate=r.date||today(); S.pricing.rateSrc=src; renderForm(); persist(); if (typeof dealRender==='function') dealRender();
  got.forEach(c=>{ const el=document.querySelector(`[data-rate="${c}"]`); if(el){ el.classList.add('flash'); setTimeout(()=>el.classList.remove('flash'),1800); } });
  toast(`Курс ЦБ РФ на ${KPGen.ruDate(S.pricing.rateDate)}: USD ${S.pricing.rates.USD}, EUR ${S.pricing.rates.EUR}, CNY ${S.pricing.rates.CNY}`);
}

function pricingBlock(){
  const P=S.pricing, cur=kpCur();
  const need=[...new Set([cur,...S.items.map(x=>x.cost&&!isKit(x)?(x.costCur||'RUB'):null),...S.items.flatMap(x=>kitParts(x).filter(p=>p.cost).map(p=>p.costCur||'RUB'))].filter(c=>c&&c!=='RUB'))];
  const missing=need.filter(c=>!(rateOf(c)>0));
  const rateTxt=['USD','EUR','CNY'].map(c=>`<span class="rt${need.includes(c)?' need':''}${need.includes(c)&&!(rateOf(c)>0)?' bad-t':''}">${c}&nbsp;<b data-rshow="${c}">${esc(P.rates[c]||'—')}</b></span>`).join('');
  const rateInp=c=>`<label class="f"><span>1 ${c}, руб.</span><input type="text" inputmode="decimal" class="num${need.includes(c)&&!(rateOf(c)>0)?' bad':''}" data-rate="${c}" value="${esc(P.rates[c]||'')}" placeholder="0,0000"></label>`;
  return `<div class="curbar">
     <label class="cur-sel cur-vat"><span>НДС, %</span><input type="text" inputmode="decimal" data-p="vat" value="${esc(S.vat)}" aria-label="Ставка НДС, %"></label>
     <label class="cur-sel"><span>Валюта КП</span><select data-pr="cur">${CUR_LIST.map(c=>`<option value="${c}"${c===cur?' selected':''}>${c==='RUB'?'Рубли':c==='USD'?'Доллары США':c==='EUR'?'Евро':'Юани'} (${c})</option>`).join('')}</select></label>
     ${need.length?`<div class="rates"><span class="muted">Курс ЦБ${P.rateDate?' на '+esc(KPGen.ruDate(P.rateDate).replace(/ г\.$/,'')):''}:</span> ${rateTxt}
       <button class="btn ghost sm" type="button" data-a="cbr" title="Обновить курсы с cbr.ru">↻ Обновить</button>
       <span class="muted" id="cbrMsg">${missing.length?`<span class="bad-t">Нужен курс ${missing.join(', ')}</span>`:(P.rateSrc==='вручную'?'введён вручную':'')}</span></div>`:''}
   </div>
   <details class="psettings"${missing.length?' open':''}><summary>${need.length?'Изменить курсы вручную, округление цен':'Округление цен'}</summary>
     <div class="grid g4" style="margin-top:10px">${need.length?rateInp('USD')+rateInp('EUR')+rateInp('CNY'):''}
       <label class="f"><span>Округление цен из экономики сделки</span><select data-pr="round">${(DEF_BY['kp.round'][5].opts).map(([v,l])=>`<option value="${v}"${String(P.round)===v?' selected':''}>${l}</option>`).join('')}</select></label></div></details>`;
}
