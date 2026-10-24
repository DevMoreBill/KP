// Поправки статей из Битрикс24 в расчёте сделки (features/deal/deal-bx-fix.js): для нескольких сделок — итог без поправки,
// с поправкой и сама поправка; tests/test_deal_econ.py сверяет пересчёт сервера (deal_econ.EconShift) с этим расчётом.
// Запуск из корня репозитория: node tests/js/deal_bx_fix.js — JSON в stdout.
'use strict';
const path=require('path');
const ROOT=path.resolve(__dirname, '..', '..');
const WebScripts=require('./web.js');
global.document={ addEventListener(){} };
WebScripts.load(path.join(ROOT, 'app', 'web', 'js', 'features', 'deal', 'index.js'));

class FixCases {
  static KP(o={}){ return {sumRub:1220000, vat:22, rates:{USD:'92,5', EUR:'100', CNY:'12,8'}, moneyAuto:2, date:'2026-10-19',
    items:[{id:'a', name:'Компрессор', qty:1, cost:500000, cur:'RUB', duty:5, code:'8414805900'}], ...o}; }
  static deal(o={}){ const d=DealTerms.blank({});
    d.sup=[{...DealTerms.newSupplier('s1', {country:'Россия'}), country:'Россия', cusMode:'none', vatIn:true, prod:'40', ship:'40',
      pay:[{name:'Оплата', ev:'ready', off:'0'}], logRu:{v:'60000'}, ...(o.sup||{})}];
    d.cust={tr:[{pct:'', ev:'delivery', off:'30'}]}; d.tax='25'; const {sup:_s, ...rest}=o; return Object.assign(d, rest); }

  static summary(calc){
    const c=x=>Number.isFinite(x) ? Math.round(x*100)/100 : null, side=r=>({Pa:r.Pa, Ctot:r.Ctot});
    const res=calc.base;
    const head=res ? {confirmed:true, profit:c(res.P), net:c(res.net), margin:res.margin, markup:res.markup}
      : {confirmed:false, lo:Math.round(calc.lo.P), hi:Math.round(calc.hi.P), marginLo:calc.lo.margin, marginHi:calc.hi.margin};
    return {...head, full:{price:c(calc.S), revenue:c(calc.R), cost:c((calc.base||calc.lo).Ctot), fin:c(calc.F),
      parts:calc.parts.map(([n, v])=>[n, c(v)]),
      fix:Object.fromEntries((calc.bxFix||[]).filter(l=>l.active).map(l=>[l.key, c(l.delta)])),
      calc:{lo:side(calc.lo), hi:side(calc.hi), taxP:calc.taxP, xMode:calc.xMode, xV:calc.xV, xG:calc.xG, R:calc.R, S:calc.S, sv:calc.sv}}};
  }

  static run(){
    const cases=[
      ['Россия, логистика +100 000', this.KP(), this.deal(), 'logistics', 100000],
      ['Россия, монтаж −20 000', this.KP(), this.deal({mnt:'80000'}), 'mount', -20000],
      ['Таможня без НДС, наличные от прибыли', this.KP(), this.deal({xc:{mode:'net', v:'10', cost:'12'}}), 'customs', 50000],
      ['Прочие, наличные суммой', this.KP(), this.deal({oth:'20000', xc:{mode:'sum', v:'50000', cost:'10'}}), 'other', 30000],
      ['Закупка, ввозной НДС неизвестен', this.KP({items:[{id:'a', name:'Компрессор', qty:1, cost:5000, cur:'USD'}]}),
        this.deal({sup:{country:'Турция', cusMode:'sum', vatIn:false, cus:{v:'150000', cur:'RUB'}}}), 'equip', 40000],
    ];
    return cases.map(([name, kp, d, key, delta])=>{
      const plain=DealCalculator.calc(kp, JSON.parse(JSON.stringify(d)));
      const view={...plain, sumOf:pick=>plain.sup.reduce((sum, sup)=>sum+pick(sup), 0)};
      const raw=DealBxFix.KEYS[key].raw(view, {equipSum:plain.equipSum, asmCost:plain.asm ? plain.asm.cost : 0});
      const fixed=JSON.parse(JSON.stringify(d)); fixed.bxFix={[key]:{to:raw+delta, base:raw}};
      const withFix=DealCalculator.calc(kp, fixed);
      const moved=JSON.parse(JSON.stringify(d)); moved.bxFix={[key]:{to:raw+delta, base:raw+5000}};  // статью пересчитали в программе
      return {name, key, delta, raw, before:this.summary(plain), after:this.summary(withFix), stale:this.summary(DealCalculator.calc(kp, moved))};
    });
  }
}
process.stdout.write(JSON.stringify(FixCases.run()));
