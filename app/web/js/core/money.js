// Деньги для показа — одно место для всей программы (решение владельца 19.10, «один способ показывать деньги»):
//   Money.kop(копейки)  — «1 234 567,89» — цены и суммы КП, документ заказчика (KPGen.money);
//   Money.rub(рубли)    — «1 234 568 ₽» — экономика сделки, логистика, кабинет: целые рубли;
//   Money.rub2(рубли)   — «1 234 567,89 ₽» — таблицы экономики сделки с копейками;
//   Money.int(рубли)    — «1 234 568» — число рублей без знака валюты (в тексте подсказок);
//   Money.short(рубли)  — «1,2 млн ₽», «350 тыс. ₽» — плитки и графики кабинета.
// Округление — до ближайшего, половина — от нуля одинаково для прибыли и убытка (−2,5 → −3, как 2,5 → 3); «−0» не бывает;
// минус — «−», как в документе; не посчитано (нет данных) — прочерк. Без DOM — работает и в проверках (node).
'use strict';

class Money {
  static NB = ' ';
  static MINUS = '−';

  /** число округлено до digits знаков: половина — от нуля; −0 → 0 */
  static round(v, digits=0){ const m=10**digits, r=Math.sign(v)*Math.round(Math.abs(v)*m+1e-9)/m; return r===0 ? 0 : r; }

  /** «1 234 567» / «1 234 567,89» — группы через неразрывный пробел, запятая, минус «−» */
  static text(v, digits=0){
    const r=this.round(v, digits), neg=r<0, a=Math.abs(r), int=Math.floor(a+1e-9), frac=digits ? Math.round((a-int)*10**digits) : 0;
    const s=String(int).replace(/\B(?=(\d{3})+(?!\d))/g, this.NB);
    return (neg ? this.MINUS : '')+s+(digits ? ','+String(frac).padStart(digits, '0') : ''); }

  static ok(v){ return typeof v==='number' && Number.isFinite(v); }
  static int(v){ return this.ok(v) ? this.text(v) : '—'; }
  static rub(v){ return this.ok(v) ? this.text(v)+this.NB+'₽' : '—'; }
  static rub2(v){ return this.ok(v) ? this.text(v, 2)+this.NB+'₽' : '—'; }
  static kop(kop){ return typeof KPGen!=='undefined' ? KPGen.money(kop) : this.text((+kop||0)/100, 2); }
  static short(v){ const r=+v||0, a=Math.abs(r);
    if (a>=1e6) return this.text(r/1e6, 1).replace(/,0$/, '')+this.NB+'млн'+this.NB+'₽';
    if (a>=1e3) return this.text(r/1e3)+this.NB+'тыс.'+this.NB+'₽';
    return this.rub(r); }
}

if (typeof module!=='undefined') module.exports={Money};
