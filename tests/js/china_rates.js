// Ставки экспедиторов Китай → РФ файлом (app/web/js/features/settings-china.js — ChinaRateBook): разбор строк .xlsx / .csv
// по заголовкам и словам («фура», «сборный», «до места прибытия», «юань», «за кг»), даты, пропуск строк с причиной,
// текст запроса экспедитору с раздельными участками; шаблон Excel открывается обратно тем же разбором.
// Запуск из корня репозитория: node tests/js/china_rates.js — код выхода 0, если всё прошло (tests/test_carrier_api.py).
'use strict';
const vm=require('vm'), fs=require('fs'), path=require('path'), assert=require('assert');
const ROOT=path.resolve(__dirname, '..', '..');
global.JSZip=require(path.join(ROOT, 'app', 'web', 'vendor', 'jszip.min.js'));
global.DOMParser=class { parseFromString(){ throw new Error('нет DOM'); } };
for (const f of ['core/xlsx.js', 'features/settings-china.js']){
  const p=path.join(ROOT, 'app', 'web', 'js', f); vm.runInThisContext(fs.readFileSync(p, 'utf8'), { filename:p }); }

let n=0;
const check=async (name, fn)=>{ try{ await fn(); n++; } catch(e){ console.error('ОШИБКА — '+name+':\n'+(e && e.stack || e)); process.exitCode=1; } };
const S={ kinds:{ ftl:'Фура 20 т (тент)', ltl:'Сборный груз', docker:'Контейнер (контейнеровоз)', tral:'Негабарит (трал)' }, units:{ trip:'за рейс / контейнер', kg:'за кг', m3:'за м³' },
  scopes:{ border:'До места прибытия в ЕАЭС', through:'Сквозная до пункта в РФ', after:'По РФ от места прибытия' }, curs:['CNY', 'USD', 'EUR', 'RUB'],
  terms:{ EXW:'EXW — с завода', FCA:'FCA — передача перевозчику в Китае' } };

(async ()=>{
  await check('разбор строк экспедитора: заголовки и слова', ()=>{
    const r=ChinaRateBook.parse([
      ['Коммерческое предложение'], [],
      ['Откуда', 'Куда', 'Участок', 'Вид', 'Ставка', 'Валюта', 'За', 'Мин.', 'Срок, дн', 'Действует до', 'Экспедитор'],
      ['Шанхай', 'Забайкальск', 'до границы', 'Фура 20 т (тент)', '21 000', 'юань', 'рейс', '', '12', '31.12.2026', 'А'],
      ['Иу', 'Хоргос', '', 'сборный груз', '2,5', 'CNY', 'за кг', '3000', '', '46387', 'Б'],
      ['Забайкальск', 'Москва', 'по РФ от места прибытия', 'фура', '180000', '₽', 'машина', '', '9', '2026-11-30', 'А'],
      ['Шанхай', 'Москва', 'сквозная', 'контейнер 40', '9500', '$', '', '', '', '', 'В'],
      ['Пекин', 'Забайкальск', 'до границы', 'вертолёт', '0', 'GBP', 'за км', '', '', '31/02', 'Г']]);
    assert.deepStrictEqual(r.rows.map(x=>[x.scope, x.kind, x.unit, x.cur, x.price]), [['border', 'ftl', 'trip', 'CNY', 21000], ['border', 'ltl', 'kg', 'CNY', 2.5],
      ['after', 'ftl', 'trip', 'RUB', 180000], ['through', 'docker', 'trip', 'USD', 9500]]);
    assert.strictEqual(r.rows[0].until, '2026-12-31'); assert.strictEqual(r.rows[1].until, '2026-12-31', 'число Excel');
    assert.strictEqual(r.rows[1].min, 3000); assert.strictEqual(r.rows[0].days, 12);
    assert.strictEqual(r.bad.length, 1); assert.ok(/строка 8: .*ставка.*вид перевозки.*«За».*валюта.*дата/.test(r.bad[0]), r.bad[0]);
    assert.throws(()=>ChinaRateBook.parse([['a', 'b'], ['1', '2']]), /Откуда/);
  });

  await check('запрос экспедитору: участки раздельно', ()=>{
    const t=ChinaRateBook.request({ from:'Иу', to:'Достык (Казахстан)', dest:'Москва', kind:'ltl', kg:'800', m3:'3', terms:'EXW' }, S);
    assert.ok(/Иу → Достык \(Казахстан\) → Москва/.test(t) && /сборный груз, вес брутто 800 кг, объём 3 м³/.test(t) && /EXW/.test(t), t);
    assert.ok(/отдельной суммой — стоимость до места прибытия/.test(t) && /по территории ЕАЭС \(Казахстан и РФ\) от места прибытия до пункта назначения: Москва/.test(t) && /ст\. 40 п\. 2/.test(t));
  });

  await check('шаблон Excel: три листа, «Ставки» первым', async ()=>{
    const blob=await ChinaRateBook.template([], { from:'Шанхай', to:'Забайкальск', kind:'ftl' }, S);
    const z=await JSZip.loadAsync(Buffer.from(await blob.arrayBuffer()));
    const wb=await z.file('xl/workbook.xml').async('string');
    assert.ok(/name="Ставки".*name="Как заполнить".*name="Запрос экспедитору"/s.test(wb), wb);
    const s1=await z.file('xl/worksheets/sheet1.xml').async('string');
    assert.ok(s1.includes('Откуда (город в Китае или место прибытия)') && s1.includes('До места прибытия в ЕАЭС'));
  });

  if (!process.exitCode) console.log('OK: '+n+' проверок');
})();
