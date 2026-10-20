// Показ денег (app/web/js/core/money.js, Money): одно место для всей программы — целые рубли, копейки, коротко «млн/тыс.»;
// округление половины от нуля одинаково для прибыли и убытка, «−0» не бывает, минус «−», нет данных — прочерк; прежние
// имена (Fmt.rub, fmtRub, CrmFmt, lgRub, DealFmt.rub, DealValues.rub) выводят то же, что Money.
// Запуск из корня репозитория: node tests/js/money.js — код выхода 0, если всё прошло (tests/test_deal_logistics.py).
'use strict';
const vm=require('vm'), fs=require('fs'), path=require('path'), assert=require('assert');
const ROOT=path.resolve(__dirname, '..', '..'), JS=f=>fs.readFileSync(path.join(ROOT, 'app', 'web', 'js', f), 'utf8');
for (const f of ['docx/kpgen.js', 'core/money.js']) vm.runInThisContext(JS(f), { filename:f });

let n=0;
const check=(name, fn)=>{ try{ fn(); n++; } catch(e){ console.error('ОШИБКА — '+name+':\n'+(e && e.stack || e)); process.exitCode=1; } };
const NB=' ';

check('целые рубли', ()=>{
  assert.strictEqual(Money.rub(1234567.5), `1${NB}234${NB}568${NB}₽`);
  assert.strictEqual(Money.rub(-1234567.5), `−1${NB}234${NB}568${NB}₽`, 'убыток округляется так же, как прибыль');
  assert.strictEqual(Money.rub(-0.4), `0${NB}₽`, 'без «−0»');
  assert.strictEqual(Money.rub(2.5), `3${NB}₽`); assert.strictEqual(Money.rub(-2.5), `−3${NB}₽`);
  for (const v of [NaN, null, undefined, '5', Infinity]) assert.strictEqual(Money.rub(v), '—', String(v));
});
check('копейки и число', ()=>{
  assert.strictEqual(Money.rub2(1234567.891), `1${NB}234${NB}567,89${NB}₽`);
  assert.strictEqual(Money.rub2(1.005), `1,01${NB}₽`); assert.strictEqual(Money.rub2(-0.004), `0,00${NB}₽`);
  assert.strictEqual(Money.int(1220000), `1${NB}220${NB}000`);
  assert.strictEqual(Money.kop(123456789), KPGen.money(123456789), 'цены КП — как в документе');
  assert.strictEqual(Money.kop(-5), '−0,05');
});
check('коротко для кабинета', ()=>{
  assert.strictEqual(Money.short(1234567), `1,2${NB}млн${NB}₽`);
  assert.strictEqual(Money.short(1000000), `1${NB}млн${NB}₽`);
  assert.strictEqual(Money.short(350400), `350${NB}тыс.${NB}₽`);
  assert.strictEqual(Money.short(999), `999${NB}₽`);
  assert.strictEqual(Money.short(-2500000), `−2,5${NB}млн${NB}₽`);
  assert.strictEqual(Money.short(999500), `1${NB}млн${NB}₽`, 'граница — по округлённому'); assert.strictEqual(Money.short(999.6), `1${NB}тыс.${NB}₽`);
});
check('прежние имена выводят то же', ()=>{
  const util=JS('core/util.js'), cab=JS('features/crm/crm-fmt.js'), lg=JS('features/logistics-calc.js'), deal=JS('features/deal.js'), dc=JS('features/deal-calc.js');
  assert.ok(/static rub\(v\)\{ return Money\.rub\(v\); \}/.test(util) && /function fmtRub\(v\)\{ return Money\.rub\(v\); \}/.test(util), 'Fmt.rub, fmtRub');
  assert.ok(/static rub\(kop\) \{\s*return Money\.rub\(\(\+kop \|\| 0\) \/ this\.KOPECKS\);/.test(cab) && /static KOPECKS = 100;/.test(cab) && /static short\(kop\) \{\s*return Money\.short/.test(cab), 'CrmFmt — копейки сделки');
  assert.ok(/const lgRub = v => Money\.rub\(v\);/.test(lg), 'lgRub'); assert.ok(/static rub\(n\)\{ return Money\.rub2\(n\); \}/.test(deal), 'DealFmt.rub');
  assert.ok(/static rub\(v\)\{ return Money\.int\(v\); \}/.test(dc), 'DealValues.rub');
  const own=[util, cab, lg, deal, dc].join('\n').match(/Math\.round\([^)]*\)\.toLocaleString\('ru-RU'\)\+' ?(₽|руб\.)'/g);
  assert.ok(!own, 'свой показ рублей мимо Money: '+own);
});

if (!process.exitCode) console.log('Money: проверок пройдено — '+n);
