// Цены: валюта КП, курсы ЦБ РФ, закупка → маржа/наценка → цена продажи.
'use strict';

function livePrice(i){ const x=S.items[i], el=document.querySelector(`[data-price="${i}"]`); if(el && document.activeElement!==el){ el.value=fmtPrice(x.price); el.classList.toggle('bad',!x.price); } }

// подсказка под строкой цены: скидка для заказчика, себестоимость, прибыль, маржа (с учётом скидки)
function priceHint(x){
  const c=costKP(x), cs=curSh(kpCur()), d=KPGen.unitDisc(x), np=(x.price||0)-d;
  const pc = v => v.toFixed(1).replace('.',',');
  const dTxt = d ? `Скидка ${money(d)} ${cs} за ед. · цена для заказчика <b>${money(np)} ${cs}</b>` : '';
  if (!x.cost) return dTxt;
  if (Number.isNaN(c)) return '<span class="bad-t">Нет курса для пересчёта закупки — обновите курс ЦБ</span>';
  if (!x.price) return 'Укажите маржу или наценку — цена рассчитается, или введите цену продажи вручную.';
  const pr=np-c;
  return (dTxt?dTxt+' · ':'') + `Себестоимость ${money(Math.round(c))} ${cs} · прибыль <b${pr<0?' class="bad-t"':''}>${money(Math.round(pr))} ${cs}</b> · маржа ${np?pc(pr/np*100):'—'} % · наценка ${pc(pr/c*100)} %${d?' (с учётом скидки)':''}`;
}

function liveMargin(i){ const x=S.items[i], el=document.querySelector(`[data-minfo="${i}"]`); if(!el) return;
  el.innerHTML = priceHint(x);
  const mi=document.querySelector(`[data-margin="${i}"]`); if (mi){ mi.disabled=!x.cost; const act=actualPct(x); mi.placeholder = x.cost&&act!=null&&(x.priceManual||marginOf(x)==null) ? act.toFixed(1).replace('.',',') : '—'; } }

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

function roundTo(kop){ const st=Math.round(parseFloat(S.pricing.round||'0.01')*100)||1; return Math.round(kop/st)*st; }

function marginOf(x){ if (x.margin==null || x.margin==='') return null; const m=parseFloat(String(x.margin).replace(',','.')); return Number.isFinite(m)?m:null; }

const modeOf = x => x.mmode==='markup' ? 'markup' : 'margin';

function costKP(x){  // себестоимость единицы в валюте КП, копейки (с НДС)
  if (!x.cost) return null;
  const r1=rateOf(x.costCur||'RUB'), r2=rateOf(kpCur()); if (!(r1>0&&r2>0)) return NaN;
  let v=x.cost*r1/r2; if (S.pricing.costNoVat) v*=1+(+S.vat||0)/100; return v;
}

function calcPrice(x){
  const c=costKP(x); if (c==null||Number.isNaN(c)) return c;
  const mv=marginOf(x); if (mv==null) return null; const m=mv/100;
  const v = modeOf(x)==='markup' ? c*(1+m) : (m<0.99 ? c/(1-m) : NaN);
  return Number.isNaN(v)?NaN:roundTo(v);
}

function applyCalc(x){ if (x.priceManual || !x.cost || marginOf(x)==null) return; const p=calcPrice(x); if (p>0){ x.price=p; delete x._priceText; } }

function actualPct(x){ const c=costKP(x); if (!c||Number.isNaN(c)||!x.price) return null; const pr=x.price-c; return modeOf(x)==='markup' ? pr/c*100 : pr/x.price*100; }

function recalcAll(){ S.items.forEach(applyCalc); }

let _autoRates=false;

function autoRates(){ const need=[kpCur(),...S.items.filter(x=>x.cost).map(x=>x.costCur||'RUB')].filter(c=>c!=='RUB'&&!(rateOf(c)>0)); if(need.length && !_autoRates){ _autoRates=true; loadCBR().finally(()=>{_autoRates=false;}); } }

async function loadCBR(){
  const msgEl=$('#cbrMsg'); if(msgEl) msgEl.textContent='Загружаю курс ЦБ РФ…';
  let r=null, src='', why='';
  const btn=document.querySelector('[data-a="cbr"]'); if(btn){ btn.disabled=true; btn.textContent='Запрашиваю курс…'; }
  try{ r=await api('/api/cbr'); src=r.src||'ЦБ РФ (cbr.ru)'; if(!r.USD){ why=r.error||''; r=null; } }catch(e){ why=String(e.message||e).slice(0,160); }
  if (btn){ btn.disabled=false; btn.textContent='Обновить с cbr.ru'; }
  if (!r || !r.USD){ const m=$('#cbrMsg'); if(m){ m.textContent='Курс с cbr.ru не получен'+(why?` (${why})`:'')+' — введите вручную ниже.'; m.classList.add('bad-t'); } document.querySelector('details.psettings')?.setAttribute('open',''); document.querySelector('[data-rate]')?.focus(); toast('Курс ЦБ не загружен — введите вручную'); return; }
  const got=[]; for (const c of ['USD','EUR','CNY']) if (r[c]) { S.pricing.rates[c]=(+r[c]).toFixed(4).replace('.',','); got.push(c); }
  S.pricing.rateDate=r.date||today(); S.pricing.rateSrc=src; recalcAll(); renderForm(); persist();
  got.forEach(c=>{ const el=document.querySelector(`[data-rate="${c}"]`); if(el){ el.classList.add('flash'); setTimeout(()=>el.classList.remove('flash'),1800); } });
  toast(`Курс ЦБ РФ на ${KPGen.ruDate(S.pricing.rateDate)}: USD ${S.pricing.rates.USD}, EUR ${S.pricing.rates.EUR}, CNY ${S.pricing.rates.CNY}`);
}

function pricingBlock(){
  const P=S.pricing, cur=kpCur();
  const need=[...new Set([cur,...S.items.map(x=>x.cost?(x.costCur||'RUB'):null)].filter(c=>c&&c!=='RUB'))];
  const missing=need.filter(c=>!(rateOf(c)>0));
  const rateTxt=['USD','EUR','CNY'].map(c=>`<span class="rt${need.includes(c)?' need':''}${need.includes(c)&&!(rateOf(c)>0)?' bad-t':''}">${c}&nbsp;<b data-rshow="${c}">${esc(P.rates[c]||'—')}</b></span>`).join('');
  const rateInp=c=>`<label class="f"><span>1 ${c}, руб.</span><input type="text" inputmode="decimal" class="num${need.includes(c)&&!(rateOf(c)>0)?' bad':''}" data-rate="${c}" value="${esc(P.rates[c]||'')}" placeholder="0,0000"></label>`;
  return `<div class="curbar">
     <label class="f cur-sel"><span>Валюта КП</span><select data-pr="cur">${CUR_LIST.map(c=>`<option value="${c}"${c===cur?' selected':''}>${c==='RUB'?'Рубли':c==='USD'?'Доллары США':c==='EUR'?'Евро':'Юани'} (${c})</option>`).join('')}</select></label>
     <div class="rates"><span class="muted">Курс ЦБ РФ${P.rateDate?' на '+esc(KPGen.ruDate(P.rateDate)):''}:</span> ${rateTxt}
       <button class="btn ghost" type="button" data-a="cbr">Обновить с cbr.ru</button>
       <span class="muted" id="cbrMsg">${missing.length?`<span class="bad-t">Нужен курс ${missing.join(', ')}</span>`:(P.rateSrc==='вручную'?'введён вручную':'')}</span></div>
   </div>
   <details class="psettings"${missing.length?' open':''}><summary>Изменить курсы вручную и параметры расчёта</summary>
     <div class="grid g4" style="margin-top:10px">${rateInp('USD')}${rateInp('EUR')}${rateInp('CNY')}
       <label class="f"><span>Округление цены продажи</span><select data-pr="round">${[['0.01','до копеек'],['1','до рубля'],['100','до 100'],['1000','до 1 000']].map(([v,l])=>`<option value="${v}"${String(P.round)===v?' selected':''}>${l}</option>`).join('')}</select></label></div>
     <label class="row" style="gap:8px;margin-top:10px"><input type="checkbox" data-pr="costNoVat" ${P.costNoVat?'checked':''} style="width:auto"> Закупочные цены указаны без НДС (к закупке добавится НДС ${esc(S.vat)} %)</label></details>`;
}
