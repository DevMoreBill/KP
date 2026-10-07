// Выгрузка «Экономики сделки» в Excel для согласования:
//   «Сводка» — одна страница для коммерческого директора: показатели, позиции, структура себестоимости, условия, подписи;
//   «Расчёт» — все исходные данные (жёлтые ячейки можно менять) и формулы; «График платежей» — деньги по дням.
// Сводка — значения на момент выгрузки; «что если» считается на листе «Расчёт».
'use strict';

async function dealXlsx(){
  const d=dlDeal(), kp=dlKp(), c=dealCalc(kp,d), b=c.base||c.lo, unk=c.unknown.length>0;
  const SH0='Сводка', SH1='Расчёт', SH2='График платежей', q=n=>`'${n}'!`;
  const num=v=>Number.isFinite(v)?v:0;
  const note=t=>({v:t, s:'note'});
  const today=new Date().toLocaleDateString('ru-RU');
  const who=S.manager&&S.manager.name || '';
  const kpTitle=`${S.number?'КП № '+S.number:'КП без номера'}${S.date?' от '+KPGen.ruDate(S.date):''}`;
  const footer=`${kpTitle} · расчёт от ${today}`;

  // ---------- лист «Расчёт»
  const R=[], at={};
  const row=(cells, key)=>{ R.push(cells); if (key) at[key]=R.length; return R.length; };
  const ref=(key,col='B')=>col+at[key], D=k=>ref(k,'D'), self=()=>'B'+(R.length+1);
  row([{v:'Расчёт экономики сделки', s:'title'}]);
  row([{v:`${kpTitle}${!DL.ex&&S.client?' · '+S.client:''} · жёлтые ячейки — исходные данные, их можно менять; остальное считается формулами`, s:'sub'}]);
  row([]);
  row([{v:'Показатель', s:'head'},{v:'Значение',s:'head'},{v:'Ед.',s:'head'},{v:'В рублях',s:'headR'},{v:'Пояснение',s:'head'}]);
  row([{v:'Цена и курсы', s:'grp'},{v:'',s:'grp'},{v:'',s:'grp'},{v:'',s:'grp'},{v:'',s:'grp'}]);
  row(['Цена для заказчика с НДС', {v:c.S, s:'inpMoney'}, '₽', {f:self(), v:c.S}], 'S');
  row(['НДС при продаже', {v:c.v, s:'inp'}, '%'], 'v');
  // курсы — всех валют, которые встречаются в расчёте (в т. ч. с нулевой суммой: на них ссылаются формулы)
  const curs=[...new Set([...c.used, ...d.sup.flatMap(s=>[s.log&&s.log.cur, s.extra&&s.extra.cur]), ...kp.items.map(x=>x.cur)].filter(x=>x&&x!=='RUB'&&num(c.rate(x))>0))];
  for (const cur of curs) row([`Курс рубля за 1 ${cur}`, {v:num(c.rate(cur)), s:'inp'}, '₽', '', note(c.rateSrc[cur]==='deal'?'Указан в расчёте':'Из КП (курс ЦБ)')], 'rate_'+cur);
  const rub=(key, cur)=> cur==='RUB' ? ref(key) : at['rate_'+cur] ? `${ref(key)}*${ref('rate_'+cur)}` : `${ref(key)}*${num(c.rate(cur))||0}`;
  const vK=`${ref('v')}/(100+${ref('v')})`;
  const amt=(label, key, o, cur0, nt)=>{ const cur=cur0||(o&&o.cur)||'RUB', a=dNum(o&&o.v)||0; const r=row([label, {v:a, s:'inpMoney'}, cur, '', nt?note(nt):''], key); R[r-1][3]={f:rub(key,cur), v:a*num(c.rate(cur)), s:'money'}; return cur; };
  const custOut=[];
  c.sup.forEach((s,k)=>{ const ds=d.sup[k], nv=s.noVat, vf=nv?`*(1+${ref('v')}/100)`:'';
    row([{v:`Поставщик: ${s.name}${s.country?' · '+s.country:''}`, s:'grp'},{v:'',s:'grp'},{v:'',s:'grp'},{v:'',s:'grp'},{v:'',s:'grp'}]);
    const eqKeys=[], fxKeys=[], lineKey={};
    s.lines.forEach((ln,j)=>{ if (ln.id==='extra') return; const it=kp.items.find(x=>x.id===ln.id)||{}, cur=it.cur||'RUB', key=`it${k}_${j}`;
      const r=row([`${ln.name} × ${ln.qty}`, {v:it.cost||0, s:'inpMoney'}, cur+' за ед.', '', ln.code?note('ТН ВЭД '+ln.code):''], key);
      R[r-1][3]={f:`${rub(key,cur)}*${ln.qty}${vf}`, v:ln.rub, s:'money'}; eqKeys.push(key); lineKey[ln.id]=key; if (cur!=='RUB') fxKeys.push(key); });
    const exO=ds.extra||{}, exA=dNum(exO.v)||0;
    if (exA || !eqKeys.length){ const cur=exO.cur||'RUB', key='ex'+k; const r=row(['Прочая закупка у поставщика', {v:exA, s:'inpMoney'}, cur, '', note('Опции, ЗИП — то, чего нет в позициях КП')], key);
      R[r-1][3]={f:rub(key,cur)+vf, v:exA*num(c.rate(cur))*(nv?1+c.v/100:1), s:'money'}; eqKeys.push(key); lineKey.extra=key; if (cur!=='RUB') fxKeys.push(key); }
    row([{v:'Оборудование, итого', s:'bold'}, '', '', {f:eqKeys.map(x=>D(x)).join('+')||'0', v:s.equip, s:'moneyB'}, nv?note('Цены поставщика без НДС — добавлен НДС'):''], `EQ${k}`);
    const logCur=amt('Логистика до границы', 'L'+k, ds.log, null, 'Входит в таможенную стоимость');
    amt('Доставка по России', 'LRU'+k, ds.logRu, 'RUB');
    amt('Брокер, СВХ, сертификация', 'BRK'+k, ds.brk, 'RUB');
    row(['Страхование груза', {v:dNum(ds.ins)||0, s:'inp'}, '% от оборудования', {f:`${D('EQ'+k)}*${self()}/100`, v:s.ins, s:'money'}], 'INS'+k);
    row(['Комиссия банка или агента за перевод', {v:dNum(ds.fx)||0, s:'inp'}, '% от платежа в валюте',
      {f:`(${[...fxKeys.map(x=>D(x)), logCur!=='RUB'?D('L'+k):null].filter(Boolean).join('+')||'0'})*${self()}/100`, v:s.fxE+s.fxL, s:'money'}], 'FX'+k);
    if (s.mode==='calc'){
      row(['Таможенная стоимость', '', '', {f:`${D('EQ'+k)}+${D('L'+k)}+${D('INS'+k)}`, v:s.cv, s:'money'}, note('Оборудование + логистика до границы + страхование')], 'CV'+k);
      const duK=[];
      s.lines.forEach((ln,j)=>{ const lk=lineKey[ln.id]; if (!lk) return; const key=`du${k}_${j}`; duK.push(key);
        row([`Пошлина: ${ln.name}`, {v:Number.isFinite(ln.duty)?ln.duty:0, s:'inp'}, '%',
          {f:`IF(${D('EQ'+k)}=0,0,${D(lk)}*${D('CV'+k)}/${D('EQ'+k)})*${self()}/100`, v:ln.dutyA, s:'money'}, note((ln.code?'ТН ВЭД '+ln.code+'. ':'')+(Number.isFinite(ln.duty)?'':'Ставка не указана — 0 %'))], key); });
      row(['Пошлина, итого', '', '', {f:duK.map(x=>D(x)).join('+')||'0', v:s.dutyA, s:'money'}, note('С таможенной стоимости позиции (доля логистики и страхования — по цене)')], 'DU'+k);
      const sc=CUSTOMS_FEES.scale, lims=[0,...sc.slice(0,-1).map(x=>x[0]+0.01)], fees=sc.map(x=>x[1]);
      row(['Таможенный сбор', s.feeAuto?{f:`LOOKUP(${D('CV'+k)},{${lims.join(',')}},{${fees.join(',')}})`, v:s.fee, s:'inpMoney'}:{v:s.fee, s:'inpMoney'}, '₽', {f:self(), v:s.fee, s:'money'}, note(s.feeAuto?'По шкале '+CUSTOMS_FEES.title:'Вписан вручную')], 'FE'+k);
      row(['НДС на ввоз', {v:s.ivP, s:'inp'}, '%', {f:`(${D('CV'+k)}+${D('DU'+k)})*${self()}/100`, v:s.ivatA, s:'money'}, note('(Таможенная стоимость + пошлина) × ставка. Возвращается вычетом')], 'IV'+k);
      row([{v:'Таможенные платежи', s:'bold'}, '', '', {f:`${D('DU'+k)}+${D('FE'+k)}+${D('IV'+k)}`, v:s.T, s:'moneyB'}], 'T'+k);
      row(['Ввозной НДС к вычету', '', '', {f:D('IV'+k), v:s.vi, s:'money'}], 'vi'+k);
    } else if (s.mode==='eaeu'){
      row(['НДС при ввозе из ЕАЭС', {v:s.ivP, s:'inp'}, '%', {f:`${D('EQ'+k)}*${self()}/100`, v:s.ivatA, s:'money'}, note('Пошлины и сбора нет; НДС платится в налоговую и возвращается вычетом')], 'IV'+k);
      row([{v:'Таможенные платежи', s:'bold'}, '', '', {f:D('IV'+k), v:s.T, s:'moneyB'}], 'T'+k);
      row(['Ввозной НДС к вычету', '', '', {f:D('IV'+k), v:s.vi, s:'money'}], 'vi'+k);
    } else if (s.mode==='none'){
      row(['Таможенные платежи', '', '', {v:0, s:'money'}, note('Поставка по России — таможни нет')], 'T'+k);
      row(['Ввозной НДС к вычету', '', '', {v:0, s:'money'}], 'vi'+k);
    } else {
      amt('Таможенные платежи целиком', 'T'+k, ds.cus, null, 'Пошлина, сбор и ввозной НДС одной суммой');
      row(['Ввозной НДС к вычету', s.vi==null?{v:'', s:'inpMoney'}:{v:s.vi, s:'inpMoney'}, '₽', {f:self(), v:s.vi||0, s:'money'}, s.vi==null?note('Не указан: в файле считается 0 — прибыль минимальная'):''], 'vi'+k);
    }
    const spK=[];
    s.stages.forEach(st=>{ const key=`sp${k}_${st.j}`; spK.push(key);
      const evT=DEAL_SUP_EVENTS[st.ev]+(st.off?' + '+st.off+' дн.':''), dup=st.name&&evT.toLowerCase().includes(st.name.toLowerCase());
      row([`Оплата поставщику: этап ${st.j+1} — ${st.name&&!dup?st.name+', ':''}${evT}`,
        st.last?{f:`100-${spK.slice(0,-1).map(x=>ref(x)).join('-')||'0'}`, v:st.p, s:'money'}:{v:st.p, s:'inp'}, '%', '', note(st.last?'Остаток до 100 % от оборудования':'Доля от оборудования (с комиссией за перевод)')], key); });
    row(['Изготовление', {v:s.prod, s:'inpInt'}, 'дней'], 'prod'+k);
    row(['Доставка', {v:s.ship, s:'inpInt'}, 'дней'], 'ship'+k);
    if (ds.vatIn) row(['НДС поставщика к вычету', s.voAuto?{f:`${D('EQ'+k)}*${vK}`, v:s.vo, s:'inpMoney'}:{v:s.vo, s:'inpMoney'}, '₽', {f:self(), v:s.vo, s:'money'}, s.voAuto?note('НДС в стоимости оборудования'):''], 'vo'+k);
    row(['НДС к вычету по услугам в России', s.voRuAuto?{f:`(${D('LRU'+k)}+${D('BRK'+k)})*${vK}`, v:s.voRu, s:'inpMoney'}:{v:s.voRu, s:'inpMoney'}, '₽', {f:self(), v:s.voRu, s:'money'}], 'voru'+k);
    const fxE=fxKeys.length?`(${fxKeys.map(x=>D(x)).join('+')})*${ref('FX'+k)}/100`:'0';
    row([{v:'Платежи поставщику, доставка и таможня', s:'bold'}, '', '', {f:`${D('EQ'+k)}+${D('FX'+k)}+${D('INS'+k)}+${D('L'+k)}+${D('T'+k)}+${D('BRK'+k)}+${D('LRU'+k)}`, v:s.cash, s:'moneyB'}], 'CASH'+k);
    custOut.push({k, fxE}); });
  row([{v:'Монтаж, прочие расходы, оплата заказчика', s:'grp'},{v:'',s:'grp'},{v:'',s:'grp'},{v:'',s:'grp'},{v:'',s:'grp'}]);
  row(['Монтаж и ПНР', {v:c.M, s:'inpMoney'}, '₽', {f:self(), v:c.M, s:'money'}], 'M');
  row(['Прочие расходы', {v:c.E, s:'inpMoney'}, '₽', {f:self(), v:c.E, s:'money'}], 'E');
  row(['Разработка документации', {v:c.Dc, s:'inpMoney'}, '₽', {f:self(), v:c.Dc, s:'money'}, c.Dc?note(dealDocKinds(d)||'проектная, рабочая, исполнительная'):''], 'DOC');
  const asmOn=!!(c.asm && c.asm.cost>0);
  if (asmOn) row([`Сборка станции у «${c.asm.A.name}» (с НДС)`, {v:c.asm.cost, s:'inpMoney'}, '₽', {f:self(), v:c.asm.cost, s:'money'}, note(`Сборка ${c.asm.days} дн.; НДС ${c.v} % — к вычету`)], 'ASM');
  row(['Прочий НДС к вычету', {v:c.Vo, s:'inpMoney'}, '₽', {f:self(), v:c.Vo, s:'money'}], 'Vo');
  row(['Резерв на гарантию', {v:c.warrP, s:'inp'}, '% выручки без НДС'], 'WARR');
  row(['Бонусы и комиссии с продажи', {v:c.bonusP, s:'inp'}, '% выручки без НДС'], 'BON');
  if (c.BG>0) row(['Банковская гарантия — комиссия банка', {v:c.BG, s:'inpMoney'}, '₽', {f:self(), v:c.BG, s:'money'},
    note(c.bgs.filter(g=>g.fee>0).map(g=>`${DEAL_BG_TYPES[g.type]}: ${dlRub0(g.amount)} × ${dlIn(g.rate)} % × ${g.days} дн. / 365${g.fee>g.amount*g.rate/100*g.days/365+0.005?` (минимальная ${dlRub0(g.min)})`:''}`).join('; '))], 'BG');
  // прочие расходы наличными (только если заданы): способ расчёта — как в программе, значение и стоимость наличных можно менять
  const xOn=b.K>0, xm=c.xc.mode;
  if (xOn){
    row([`Прочие расходы наличными, на руки — ${xm==='net'?'% от чистой прибыли':xm==='sale'?'% от выручки без НДС':xm==='salevat'?'% от суммы продажи с НДС':'сумма'}`, {v:c.xc.v, s:xm==='sum'?'inpMoney':'inp'}, xm==='sum'?'₽':'%', '', note('Не уменьшают налог на прибыль; платятся после последней оплаты заказчика')], 'XV');
    row(['Стоимость получения наличных', {v:c.xc.cost, s:'inp'}, '%', '', note('Расход компании = на руки / (1 − %)')], 'XCOST');
    row(['Когда выдаются наличные', {v:c.xc.when==='pay'&&c.xc.from.length?'с оплат заказчика':'после последней оплаты', s:'td'}, '', '',
      note(c.xc.when==='pay'&&c.xc.from.length?(xm==='net'?'Пропорционально оплатам; суммы в графике — по расчёту программы (от чистой прибыли — с учётом финансирования)':'Пропорционально суммам отмеченных оплат заказчика, в день оплаты'):'На финансирование не влияют')]);
  }
  const trKeys=[], trRef=x=>ref(x, at[x+'col']||'B');
  c.trs.forEach((t,j)=>{ const key='TR'+j; trKeys.push(key);
    const nm=`${t.name||'Оплата заказчика'}: этап ${j+1} — ${DEAL_EVENTS[t.ev]}${t.off?` + ${t.off} дн.`:''}`;
    if (t.bySum){ const r=row([nm, {v:t.sum, s:'inpMoney'}, '₽', '', note('Сумма этапа; доля от цены — в колонке D')], key+'s');
      R[r-1][3]={f:`IF(${D('S')}=0,0,${ref(key+'s')}/${D('S')}*100)`, v:t.p, s:'money'}; at[key]=r; at[key+'col']='D'; }
    else row([nm, t.last?{f:`100-${trKeys.slice(0,-1).map(x=>trRef(x)).join('-')||'0'}`, v:t.p, s:'money'}:{v:t.p, s:'inp'}, '%', '', t.last?note('Остаток до 100 %'):''], key); });
  row(['Стоимость денег', {v:c.i, s:'inp'}, '% в месяц', '', c.moneyAuto&&DL.key?note(`Ключевая ставка ЦБ ${dlIn(DL.key.rate)} % + ${dlSpread()} п.п. / 12`):''], 'i');
  row(['Налог на прибыль', {v:c.taxP, s:'inp'}, '%'], 'TAX');
  row(['Дата отсчёта — подписание договора (день 0)', {v:xlsxDate(d.start), s:'inpDate'}, 'дата', '', note('Даты платежей на листе «График платежей» = эта дата + день')], 'D0');
  // график (на листе «График платежей»)
  const G=[], gHead=4, gFirst=gHead+1, gLast=gHead+c.rows.length, gTot=gLast+1;
  const supK=id=>c.sup.findIndex(s=>s.id===id);
  const A=key=>q(SH1)+key, Afx=o=>o.fxE.replace(/([A-Z]+\d+)/g, m=>A(m));
  const amountF=r=>{ const [kind,id]=r.key.split(':'), k=supK(id), o=custOut[k];
    if (kind==='sp') return `-(${A(D('EQ'+k))}+${Afx(o)})*${A(ref(`sp${k}_${r.key.split(':')[2]}`))}/100`;
    if (kind==='log') return `-(${A(D('FX'+k))}-${Afx(o)}+${A(D('INS'+k))}+${A(D('L'+k))}+${A(D('T'+k))}+${A(D('BRK'+k))})`;
    if (kind==='ru') return `-${A(D('LRU'+k))}`;
    if (kind==='mnt') return `-(${A(D('M'))}+${A(D('E'))})`;
    if (r.key==='bonus') return `-${A(ref('Rv'))}*${A(ref('BON'))}/100`;
    if (String(r.key).startsWith('bg:')) return c.bgs.filter(g=>g.fee>0).length===1 ? `-${A(D('BG'))}` : null;
    if (r.key==='xc') return `-${A(ref('XK'))}`;
    if (String(r.key).startsWith('xc:')) return xm==='net' ? null : `-${A(ref('XK'))}*D${gRow[r.from]}/(${c.xc.from.map(x=>'D'+gRow[x]).join('+')})`;
    if (r.key==='warr') return `-${A(ref('Rv'))}*${A(ref('WARR'))}/100`;
    if (r.key==='asm') return `-${A(D('ASM'))}`;
    if (r.key==='doc') return `-${A(D('DOC'))}`;
    if (!/^c\d+$/.test(r.key)) return null;            // прочие строки — значением
    const j=+r.key.slice(1); return `${A(D('S'))}*${A(trRef('TR'+j))}/100`; };
  const gRow=Object.fromEntries(c.rows.map((x,k)=>[x.key, gFirst+k]));
  const inRows=c.rows.map((r,k)=>r.inflow?'A'+(gFirst+k):null).filter(Boolean);
  G.push([{v:'График платежей', s:'title'}]);
  const D0g=()=>q(SH1)+ref('D0');
  G.push([{v:'Последняя оплата заказчика — день и дата', s:'bold'}, '', '', {f:`MAX(${inRows.join(',')})`, v:c.Tend, s:'int'}, {f:`IF(${D0g()}="","",${D0g()}+D2)`, v:xlsxDate(d.start)===''?undefined:xlsxDate(d.start)+c.Tend, s:'tdDate'}]);
  G.push([{v:'Минус — расход, плюс — поступление. Дни (жёлтые) можно менять, сохраняя порядок строк по возрастанию дня. Финансирование — простой процент на недостающие деньги, месяц = 30 дней.'+(d.start?' Даты платежей — рабочие (банковские) дни по производственному календарю РФ.':''), s:'note'}]);
  const GM=['A2:C2','A3:G3'], GH={3:32};
  G.push([{v:'День',s:'head'},{v:'Дата',s:'head'},{v:'Событие',s:'head'},{v:'Платёж, ₽',s:'headR'},{v:'Остаток денег, ₽',s:'headR'},{v:'Дней финанси­рования',s:'headR'},{v:'Финансирование, ₽',s:'headR'}]);
  // итог расчёта (строки графика ссылаются на выручку)
  row([]);
  row([{v:'Результат', s:'head'},{v:'Значение',s:'headR'},{v:'',s:'head'},{v:'',s:'head'},{v:'Как считается',s:'head'}]);
  const sumK=p=>c.sup.map((s,k)=>D(p+k)).join('+')||'0';
  const vatIn=[...c.sup.map((s,k)=>D('vi'+k)), ...c.sup.map((s,k)=>d.sup[k].vatIn?D('vo'+k):null).filter(Boolean), ...c.sup.map((s,k)=>D('voru'+k)), D('Vo'), ...(asmOn?[`${D('ASM')}*${ref('v')}/(100+${ref('v')})`]:[])].join('+');
  row(['Выручка без НДС', {f:`${D('S')}/(1+${ref('v')}/100)`, v:c.R, s:'money'}, '', '', note('R = цена с НДС / (1 + НДС / 100)')], 'Rv');
  row(['НДС с продажи', {f:`${D('S')}-${ref('Rv')}`, v:c.VATs, s:'money'}, '', '', note('Цена с НДС − выручка')], 'VATs');
  row(['Прямые платежи', {f:`${sumK('CASH')}+${D('M')}+${D('E')}+${D('DOC')}+${ref('Rv')}*(${ref('WARR')}+${ref('BON')})/100${c.BG>0?'+'+D('BG'):''}${asmOn?'+'+D('ASM'):''}`, v:c.Ccash, s:'money'}, '', '', note('Поставщики, доставка, таможня, монтаж, прочее, резерв, бонусы')], 'C');
  row(['Финансирование', {f:`${q(SH2)}G${gTot}`, v:c.F, s:'money'}, '', '', note('Лист «График платежей»')], 'F');
  row(['НДС к вычету', {f:vatIn, v:b.VATin, s:'money'}, '', '', note('Ввозной + НДС поставщиков + услуги в России + прочий')], 'VI');
  row(['Себестоимость с финансированием', {f:`${ref('C')}-${ref('VI')}+${ref('F')}`, v:b.Ctot, s:'money'}, '', '', note('Прямые платежи − НДС к вычету + финансирование')], 'CT');
  if (!xOn){
    row([{v:'Прибыль до налога на прибыль', s:'bold'}, {f:`${ref('Rv')}-${ref('CT')}`, v:b.P, s:'moneyB'}, '', '', unk?note('Ввозной НДС не указан — прибыль минимальная'):note('Выручка − себестоимость')], 'P');
    row(['Налог на прибыль', {f:`IF(${ref('P')}>0,${ref('P')}*${ref('TAX')}/100,0)`, v:b.tax, s:'money'}], 'PT');
    row([{v:'Чистая прибыль', s:'bold'}, {f:`${ref('P')}-${ref('PT')}`, v:b.net, s:'moneyB'}]);
    row(['Наценка', {f:`IF(${ref('CT')}=0,"",${ref('P')}/${ref('CT')})`, v:b.markup==null?undefined:b.markup/100, s:'pctB'}, '', '', note('Прибыль / себестоимость')]);
  } else {
    row(['Прибыль до прочих расходов (база налога)', {f:`${ref('Rv')}-${ref('CT')}`, v:b.Pa, s:'money'}, '', '', unk?note('Ввозной НДС не указан — прибыль минимальная'):note('Выручка − себестоимость')], 'PA');
    row(['Налог на прибыль', {f:`IF(${ref('PA')}>0,${ref('PA')}*${ref('TAX')}/100,0)`, v:b.tax, s:'money'}, '', '', note('Прочие расходы наличными налог не уменьшают')], 'PT');
    row(['Прочие расходы наличными — на руки', {f:xm==='net'?`MAX(0,${ref('PA')}-${ref('PT')})*${ref('XV')}/100`:xm==='sale'?`${ref('Rv')}*${ref('XV')}/100`:xm==='salevat'?`${D('S')}*${ref('XV')}/100`:ref('XV'), v:b.X, s:'money'}, '', '',
      note(xm==='net'?'% от чистой прибыли до этих расходов':xm==='sale'?'% от выручки без НДС':xm==='salevat'?'% от суммы продажи с НДС':'Сумма на руки')], 'XX');
    row(['Прочие расходы наличными — расход компании', {f:`${ref('XX')}/(1-${ref('XCOST')}/100)`, v:b.K, s:'money'}, '', '', note('С учётом стоимости получения наличных')], 'XK');
    row([{v:'Прибыль сделки до налога (за вычетом наличных)', s:'bold'}, {f:`${ref('PA')}-${ref('XK')}`, v:b.P, s:'moneyB'}], 'P');
    row([{v:'Чистая прибыль', s:'bold'}, {f:`${ref('PA')}-${ref('PT')}-${ref('XK')}`, v:b.net, s:'moneyB'}, '', '', note('После налога на прибыль и прочих расходов')]);
    row(['Наценка', {f:`IF(${ref('CT')}+${ref('XK')}=0,"",${ref('P')}/(${ref('CT')}+${ref('XK')}))`, v:b.markup==null?undefined:b.markup/100, s:'pctB'}, '', '', note('Прибыль / (себестоимость + наличные)')]);
  }
  row(['Маржинальность', {f:`IF(${ref('Rv')}=0,"",${ref('P')}/${ref('Rv')})`, v:b.margin==null?undefined:b.margin/100, s:'pctB'}, '', '', note('Прибыль / выручка без НДС')]);
  row(['НДС к уплате', {f:`MAX(${ref('VATs')}-${ref('VI')},0)`, v:b.payable, s:'money'}, '', '', note('НДС с продажи − НДС к вычету')], 'PAY');
  row(['Превышение вычетов', {f:`MAX(${ref('VI')}-${ref('VATs')},0)`, v:b.excess, s:'money'}, '', '', note('Не добавляется в остаток как возврат')]);
  row(['Деньги до расчётов по НДС', {f:`${D('S')}-${ref('C')}-${ref('F')}`, v:c.cashBefore, s:'money'}], 'CB');
  row(['Деньги на счёте после сделки', {f:`${ref('CB')}-${ref('PAY')}${xOn?'-'+ref('XK'):''}`, v:b.cashAfter, s:'money'}, '', '', note(xOn?'После доплаты НДС и наличных, до налога на прибыль':'После доплаты НДС, до налога на прибыль')]);
  const xIdx=c.rows.findIndex(x=>x.key==='xc');
  c.rows.forEach((r,k)=>{ const n=gFirst+k;
    const D0=q(SH1)+ref('D0'), dv=xlsxDate(d.start);
    G.push([{v:r.day, s:r.fixed?'tdInt':'inpInt'}, {f:`IF(${D0}="","",${D0}+A${n})`, v:dv===''?undefined:dv+r.day, s:'tdDate'}, {v:r.label, s:'td'}, (f=>f==null?{v:r.amount, s:'tdMoney2'}:{f, v:r.amount, s:'tdMoney2'})(amountF(r)), {f:k?`E${n-1}+D${n}`:`D${n}`, v:r.balance, s:'tdMoney2'},
      {f:k<c.rows.length-1?`MAX(0,MIN(A${n+1},$D$2)-A${n})`:'0', v:r.days, s:'tdInt'}, xIdx>=0&&k>=xIdx?{v:0, s:'tdMoney2'}:{f:`MAX(0,-E${n})*F${n}*${q(SH1)}${ref('i')}/100/30`, v:r.fin, s:'tdMoney2'}]); });
  G.push([{v:'',s:'totL'}, {v:'',s:'totL'}, {v:'Стоимость финансирования', s:'totL'}, {v:'',s:'totL'}, {v:'',s:'totL'}, {v:'',s:'totL'}, {f:`SUM(G${gFirst}:G${gLast})`, v:c.F, s:'totMoney'}]);

  // ---------- лист «Сводка»
  const W=[], M=[], H={};
  const put=(cells, h)=>{ W.push(cells); if (h) H[W.length]=h; return W.length; };
  const mg=(r, a, z)=>M.push(`${a}${r}:${z}${r}`);
  const blank=()=>put([], 6);
  const sec=t=>{ const r=put([{v:t, s:'sec'},{v:'',s:'sec'},{v:'',s:'sec'},{v:'',s:'sec'},{v:'',s:'sec'},{v:'',s:'sec'},{v:'',s:'sec'},{v:'',s:'sec'}], 22); mg(r,'A','H'); };
  let r=put([{v:'Экономика сделки — на согласование', s:'title'}], 24); mg(r,'A','H');
  r=put([{v:[kpTitle, !DL.ex&&S.client?'заказчик: '+S.client:'', who?'менеджер: '+who:'', 'расчёт от '+today].filter(Boolean).join(' · '), s:'sub'}]); mg(r,'A','H');
  blank();
  // показатели
  const P=unk?null:b.P, gap=Math.max(0, ...c.rows.map(x=>-x.balance)), gapRow=c.rows.find(x=>-x.balance===gap);
  const kv=(v,s)=>({v, s}), tl=t=>({v:t, s:'kpiL'});
  const tiles=(L, V)=>{ let r1=put([tl(L[0]),tl(''),tl(L[1]),tl(''),tl(L[2]),tl(''),tl(L[3]),tl('')], 16); ['A:B','C:D','E:F','G:H'].forEach(x=>mg(r1,...x.split(':')));
    r1=put([V[0],kv('',V[0].s),V[1],kv('',V[1].s),V[2],kv('',V[2].s),V[3],kv('',V[3].s)], unk?30:22); ['A:B','C:D','E:F','G:H'].forEach(x=>mg(r1,...x.split(':'))); };
  sec('Ключевые показатели');
  tiles(['Цена КП с НДС','Выручка без НДС','Себестоимость с финансированием', unk?'Прибыль (диапазон)':xOn?'Прибыль до налога, за вычетом наличных':'Прибыль до налога'],
    [kv(c.S,'kpiV'), kv(c.R,'kpiV'), kv(b.Ctot,'kpiV'), unk?kv(`${dlRub0(c.lo.P)} … ${dlRub0(c.hi.P)}`,'kpiT'):kv(P, P<0?'kpiVr':'kpiVg')]);
  tiles(['Маржинальность — прибыль / выручка','Наценка к себестоимости','Чистая прибыль после налога', gapRow&&gap>0?`Пик вложений, день ${gapRow.day}`:'Пик вложений своих денег'],
    [unk?kv(`${dlPct(c.lo.margin)} … ${dlPct(c.hi.margin)}`,'kpiT'):kv(b.margin==null?'—':b.margin/100,'kpiP'), unk?kv(`${dlPct(c.lo.markup)} … ${dlPct(c.hi.markup)}`,'kpiT'):kv(b.markup==null?'—':b.markup/100,'kpiP'),
     unk?kv('—','kpiT'):kv(b.net, b.net<0?'kpiVr':'kpiV'), kv(gap,'kpiV')]);
  const tg=d.target||{}, tv=dNum(tg.v), TGN={margin:'маржинальность',markup:'наценка',profit:'прибыль до налога',net:'чистая прибыль'};
  const verdict = !c.ok || c.warn.some(w=>w.bad) ? ['bad','Расчёт содержит ошибки — см. «На что обратить внимание».']
    : unk ? ['warn',`Не указан ввозной НДС к вычету — прибыль от ${dlRub0(c.lo.P)} до ${dlRub0(c.hi.P)}.`]
    : P<0 ? ['bad',`Сделка убыточна: убыток ${dlRub0(-P)} при цене ${dlRub0(c.S)}.`]
    : ['ok',`Сделка прибыльна: прибыль ${dlRub0(P)}, маржинальность ${dlPct(b.margin)}.`];
  const be=DL.ex?null:dealSolve(kp, d, 'profit', 0);
  let vt=verdict[1]+(be!=null?` Безубыточная цена с НДС — ${dlRub0(be)}.`:'');
  if (!DL.ex && tv!=null && !Number.isNaN(tv)){ const need=dealSolve(kp, d, tg.type, tv), u=tg.type==='profit'||tg.type==='net'?' ₽':' %';
    vt+=need!=null ? ` Цель — ${TGN[tg.type]} ${dlIn(tv)}${u}: цена с НДС ${dlRub0(need)}${Math.abs(need-c.S)<1?' (совпадает с КП)':need<=c.S?' — цена КП выше, цель достигнута':` — на ${dlRub0(need-c.S)} выше цены КП`}.` : ` Цель — ${TGN[tg.type]} ${dlIn(tv)}${u}: недостижима при этих расходах.`; }
  r=put([{v:vt, s:verdict[0]}], 15*Math.ceil(vt.length/92)+4); mg(r,'A','H');
  blank();
  // позиции
  sec('Позиции: закупка и продажа');
  put([{v:'№',s:'head'},{v:'Позиция',s:'head'},{v:'Кол-во',s:'headR'},{v:'Закупка, ₽',s:'headR'},{v:'Продажа без НДС, ₽',s:'headR'},{v:'Себестоимость*, ₽',s:'headR'},{v:'Прибыль, ₽',s:'headR'},{v:'Маржа',s:'headR'}], 32);
  const lines=c.sup.flatMap(s=>s.lines.filter(l=>l.id!=='extra'));
  const its=DL.ex ? [] : S.items.filter(x=>String(x.name||'').trim());
  const rk=rateOf(kpCur())>0 ? rateOf(kpCur()) : 0;
  const saleOf=x=>totals([{qty:+x.qty||0, price:x.price||0, disc:x.disc, options:(x.options||[]).filter(o=>o.name).map(o=>({qty:+o.qty||0, price:o.price||0}))}], 0).sum/100*rk/(1+c.v/100);
  const sales=its.map(saleOf), sSum=sales.reduce((a,x)=>a+x,0), kS=sSum>0?c.R/sSum:0;
  const wSum=lines.reduce((a,l)=>a+l.rub,0);
  let tq={buy:0, sale:0, cost:0};
  its.forEach((x,k)=>{ const ln=lines.find(l=>l.id===x.id), buy=ln?ln.rub:0, sale=sales[k]*kS, cost=ln&&wSum>0?b.Ctot*ln.rub/wSum:0;
    tq.buy+=buy; tq.sale+=sale; tq.cost+=cost;
    put([{v:k+1,s:'tdInt'}, {v:x.name+(ln&&ln.code?`\nТН ВЭД ${ln.code}`:'')+(ln?'':'\nзакупка не указана'), s:'td'}, {v:+x.qty||0,s:'tdInt'}, {v:buy||'—',s:'tdMoney'}, {v:sale,s:'tdMoney'}, {v:ln?cost:'—',s:'tdMoney'}, {v:ln?sale-cost:'—',s:'tdMoney'}, {v:ln&&sale?(sale-cost)/sale:'—',s:'tdPct'}]); });
  const other=b.Ctot-tq.cost;
  if (!its.length) { r=put([{v:'',s:'td'},{v:'В КП нет позиций',s:'td'},{v:'',s:'td'},{v:c.equipSum,s:'tdMoney'},{v:c.R,s:'tdMoney'},{v:b.Ctot,s:'tdMoney'},{v:c.R-b.Ctot,s:'tdMoney'},{v:c.R?(c.R-b.Ctot)/c.R:'—',s:'tdPct'}]); tq={buy:c.equipSum, sale:c.R, cost:b.Ctot}; }
  else if (Math.abs(other)>0.5 && tq.cost>0) { put([{v:'',s:'td'},{v:'Расходы без привязки к позициям (прочая закупка; при отсутствии закупки у позиций)',s:'tdNote'},{v:'',s:'td'},{v:'',s:'td'},{v:Math.max(0,c.R-tq.sale),s:'tdMoney'},{v:other,s:'tdMoney'},{v:-other,s:'tdMoney'},{v:'',s:'td'}]); tq.cost+=other; }
  put([{v:'',s:'totL'},{v:'Итого',s:'totL'},{v:'',s:'totL'},{v:tq.buy,s:'totMoney'},{v:c.R,s:'totMoney'},{v:b.Ctot,s:'totMoney'},{v:c.R-b.Ctot,s:'totMoney'},{v:c.R?(c.R-b.Ctot)/c.R:'',s:'totPct'}]);
  r=put([note('* Себестоимость позиции — её закупка плюс доля логистики, таможни, монтажа, финансирования и прочих расходов (распределены пропорционально закупке), за вычетом НДС к вычету.'+(unk?' Ввозной НДС не указан — показана минимальная прибыль.':''))], 30); mg(r,'A','H');
  blank();
  // структура себестоимости
  sec('Из чего складывается себестоимость');
  r=put([{v:'№',s:'head'},{v:'Статья',s:'head'},{v:'',s:'head'},{v:'',s:'head'},{v:'',s:'head'},{v:'Сумма, ₽',s:'headR'},{v:'Доля',s:'headR'},{v:'',s:'head'}]); mg(r,'B','E'); mg(r,'G','H');
  c.parts.forEach(([n,v],k)=>{ r=put([{v:k+1,s:'tdInt'},{v:n,s:'td'},{v:'',s:'td'},{v:'',s:'td'},{v:'',s:'td'},{v:v,s:'tdMoney'},{v:b.Ctot?v/b.Ctot:'',s:'tdPct'},{v:'',s:'tdPct'}]); mg(r,'B','E'); mg(r,'G','H'); });
  r=put([{v:'',s:'totL'},{v:'Себестоимость с финансированием',s:'totL'},{v:'',s:'totL'},{v:'',s:'totL'},{v:'',s:'totL'},{v:b.Ctot,s:'totMoney'},{v:1,s:'totPct'},{v:'',s:'totPct'}]); mg(r,'B','E'); mg(r,'G','H');
  blank();
  // поставщики
  sec('Поставщики и условия закупки');
  put([{v:'№',s:'head'},{v:'Поставщик',s:'head'},{v:'Страна',s:'head'},{v:'Закупка, ₽',s:'headR'},{v:'Таможня, ₽',s:'headR'},{v:'Логистика, ₽',s:'headR'},{v:'Оплата, %',s:'headR'},{v:'Срок, дн.',s:'headR'}], 30);
  const CUSN={calc:'расчёт по ТН ВЭД', eaeu:'ЕАЭС', sum:'по сумме', none:'нет'};
  c.sup.forEach((s,k)=>put([{v:k+1,s:'tdInt'},{v:`${s.name}\nтаможня: ${CUSN[s.mode]||'—'}${s.noVat?'; цены без НДС':''}\nоплата: ${s.stages.filter(st=>st.p>0).map(st=>`${dlIn(st.p)} % ${DEAL_SUP_EVENTS[st.ev]}${st.off?' + '+st.off+' дн.':''}`).join('; ')}`,s:'td'},{v:s.country||'—',s:'td'},{v:s.equip,s:'tdMoney'},{v:s.T,s:'tdMoney'},{v:s.L+s.Lru+s.brk,s:'tdMoney'},{v:s.stages.filter(st=>st.p>0).map(st=>dlIn(st.p)).join(' / '),s:'tdC'},{v:`${s.prod} + ${s.ship}`,s:'tdC'}]));
  r=put([note('Срок: изготовление + доставка. Логистика: до границы, по России, брокер и СВХ.')]); mg(r,'A','H');
  blank();
  // оплата заказчика
  sec('Оплата заказчика');
  r=put([{v:'№',s:'head'},{v:'Этап',s:'head'},{v:'Доля',s:'headR'},{v:'День',s:'headR'},{v:'Сумма, ₽',s:'headR'},{v:'',s:'head'},{v:'Дата',s:'head'},{v:'',s:'head'}]); mg(r,'E','F'); mg(r,'G','H');
  c.rows.filter(x=>x.inflow).forEach((x,k)=>{ r=put([{v:k+1,s:'tdInt'},{v:(t=>t?`${t.name||(t.last&&c.trs.length>1?'Окончательный расчёт':t.k===0&&!t.last?'Аванс':'Оплата')} — ${DEAL_EVENTS[t.ev]}${t.off?` + ${t.off} дн.`:''}`:x.label)(c.trs[x.stage]),s:'td'},{v:(x.pct||0)/100,s:'tdPct'},{v:x.day,s:'tdInt'},{v:x.amount,s:'tdMoney'},{v:'',s:'tdMoney'},{v:xlsxDate(d.start)===''?'—':xlsxDate(d.start)+x.day,s:'tdDate'},{v:'',s:'tdDate'}]); mg(r,'E','F'); mg(r,'G','H'); });
  r=put([note(`День 0 — подписание договора${d.start?' ('+d.start.split('-').reverse().join('.')+', ориентировочно)':''}. Готовность к отгрузке — день ${c.Rdy}, поставка — день ${c.D}.`)]); mg(r,'A','H');
  blank();
  // деньги и налоги
  sec('Деньги и налоги');
  const fin=[[`Стоимость денег, % в месяц${c.moneyAuto&&DL.key?` (ключевая ставка ЦБ ${dlIn(DL.key.rate)} % + ${dlSpread()} п.п.)`:''}`, c.i/100, 'tdPct'],
    ['Финансирование (проценты на вложенные деньги)', c.F], ['Максимальное вложение своих денег', gap], ['НДС с продажи', c.VATs], ['НДС к вычету', b.VATin], ['НДС к уплате', b.payable],
    [`Налог на прибыль ${dlIn(c.taxP)} %${xOn?' (с прибыли до прочих расходов)':''}`, b.tax],
    ...(c.BG>0?[['Банковская гарантия — комиссия банка', c.BG]]:[]),
    ...(xOn?[['Прочие расходы (наличные) — расход компании', b.K], ...(b.K!==b.X?[[`  в т. ч. на руки (стоимость наличных ${dlIn(c.xc.cost)} %)`, b.X]]:[]), ['  налог на прибыль они не уменьшают', '', 'td']]:[]),
    ['Деньги на счёте после сделки (после НДС, до налога на прибыль)', b.cashAfter]];
  fin.forEach(([n,v,s])=>{ r=put([{v:'',s:'td'},{v:n,s:'td'},{v:'',s:'td'},{v:'',s:'td'},{v:'',s:'td'},{v:v,s:s||'tdMoney'},{v:'',s:'td'},{v:'',s:'td'}]); mg(r,'B','E'); mg(r,'F','H'); });
  blank();
  // замечания
  sec('На что обратить внимание');
  const ws=[...c.warn.map(w=>[w.t, w.bad?'bad':'warn']), ...(unk?[['Не указан ввозной НДС к вычету — прибыль показана диапазоном','warn']]:[]), ...(c.ok?[]:[['В исходных данных есть ошибки — проверьте поля, отмеченные в программе','bad']])];
  (ws.length?ws:[['Замечаний нет','ok']]).forEach(([t,s])=>{ r=put([{v:'•',s:'text'},{v:t,s}]); mg(r,'B','H'); });
  blank(); put([], 14);
  // подписи
  r=put([{v:'Подготовил',s:'bold'},'',{v:who,s:'text'},'',{v:'',s:'sign'},{v:'',s:'sign'},{v:today,s:'text'}], 28); mg(r,'A','B'); mg(r,'C','D'); mg(r,'E','F');
  r=put([{v:'',s:'note'},'','','',{v:'подпись',s:'note'}]); mg(r,'E','F');
  r=put([{v:'Согласовано: Коммерческий директор',s:'bold'},'',{v:'',s:'sign'},{v:'',s:'sign'},{v:'',s:'sign'},{v:'',s:'sign'},{v:'«___» __________ 20__',s:'text'}], 28); mg(r,'A','B'); mg(r,'C','D'); mg(r,'E','F'); mg(r,'G','H');
  r=put([{v:'',s:'note'},'',{v:'ФИО',s:'note'},'',{v:'подпись',s:'note'}]); mg(r,'C','D'); mg(r,'E','F');
  r=put([note('Подробный расчёт с формулами — лист «Расчёт»; движение денег по дням — лист «График платежей».')]); mg(r,'A','H');

  // страховка от #ИМЯ?: формула со ссылкой на несуществующую строку заменяется посчитанным значением
  let badF=0;
  for (const rows of [R, G, W]) for (const r of rows) for (const cell of r||[]) if (cell && typeof cell==='object' && cell.f && /undefined|NaN|null|Infinity/.test(cell.f)){ delete cell.f; badF++; }
  if (badF) console.warn('Excel: формул заменено значениями —', badF);
  const blob=await makeXlsx([
    {name:SH0, cols:[4,33,8,13,14,14,12,9], rows:W, merges:M, heights:H, grid:false, footer, onePage:true},
    {name:SH1, cols:[46,18,14,18,52], rows:R, freeze:4, titles:'4:4', footer},
    {name:SH2, cols:[8,12,48,17,17,13,17], rows:G, merges:GM, heights:GH, freeze:4, titles:'4:4', footer, landscape:true}], 'Экономика сделки');
  const safe=s=>String(s||'').replace(/[\\/:*?"<>|«»]+/g,'').replace(/\s+/g,'_').slice(0,60);
  saveFileA(DL.ex ? 'Экономика_сделки_пример.xlsx' : `Экономика_КП_${safe(S.number||'черновик')}${S.client?'_'+safe(S.client):''}.xlsx`, blob);
  toast('Расчёт выгружен в Excel');
}
