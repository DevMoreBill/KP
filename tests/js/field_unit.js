// Единицы полей категорий (core/field-unit.js, п. 1 отчёта аудита 30.10): производительность поршневых — л/мин, воздуходувок —
// м³/ч и давление в мбар; расчёт станции (AirChain), автозаполнение станции (StationAuto), подбор по ТЗ (TzPick), строка
// документа (StationDoc) и сборное изделие переводят в м³/мин и бар в одном месте — и со справочником категорий, и без него
// (встроенная таблица совпадает с app/equipment_types.json).
// Запуск из корня репозитория: node tests/js/field_unit.js — код выхода 0, если всё прошло (tests/test_field_unit.py).
'use strict';
const path=require('path'), fs=require('fs'), assert=require('assert');
const ROOT=path.resolve(__dirname, '..', '..');
global.document={ addEventListener(){} };
require('./web.js').load(path.join(ROOT, 'app', 'web', 'js', 'features', 'kit', 'index.js'));
const TYPES=JSON.parse(fs.readFileSync(path.join(ROOT, 'app', 'equipment_types.json'), 'utf8')).types;

const checks=[];
const check=(name, fn)=>checks.push([name, fn]);
const part=(cat, attrs, extra={})=>({ name:extra.name || 'Позиция', attrs:{ cat, ...attrs }, rows:[], ...extra });
const near=(actual, expected, what)=>assert.ok(Math.abs(actual-expected)<1e-9, `${what}: ${actual} вместо ${expected}`);

check('встроенные единицы — как в app/equipment_types.json; все, что не м³/мин и не бар, — в таблице', ()=>{
  for (const type of TYPES) for (const field of type.fields || []) {
    if (!['flow', 'pressure'].includes(field.key)) continue;
    const base=field.key==='flow' ? 'м³/мин' : 'бар';
    const own=(FieldUnit.BUILTIN[type.id] || {})[field.key];
    if (field.unit!==base) assert.strictEqual(own, field.unit, `${type.id}.${field.key}`);
    else assert.ok(own===undefined || own===base, `${type.id}.${field.key}`);
  }
});

for (const [what, list] of [['справочник загружен', TYPES], ['справочник не загружен', []]]) {
  check(`расчёт станции: поршневой и воздуходувка — в м³/мин и бар (${what}; было: 650 л/мин как 650 м³/мин)`, ()=>{
    EquipTypes.list=list;
    near(AirChain.flow(part('comp_piston', { flow:650 })), 0.65, 'поршневой 650 л/мин');
    near(AirChain.flow(part('blower', { flow:600 })), 10, 'воздуходувка 600 м³/ч');
    near(AirChain.flow(part('comp_screw', { flow:10 })), 10, 'винтовой — как было');
    near(AirChain.bar(part('blower', { pressure:800 })), 0.8, 'воздуходувка 800 мбар');
    near(AirChain.bar(part('comp_piston', { pressure:10 })), 10, 'поршневой — бар, как было');
    near(AirChain.flow(part('other', { flow:5 })), 5, 'без категории — как было');
    // документ заказчика — число паспорта в единице поля категории (без перевода и округления вверх)
    assert.strictEqual(StationDoc.rows(part('comp_piston', { flow:650 }, { name:'Компрессор поршневой' }))[0].v, '650 л/мин');
  });
}

check('подбор по ТЗ: поршневой — в м³/мин, насос — в м³/ч (категорию карточки знает справочник)', ()=>{
  EquipTypes.list=TYPES;
  near(TzPick.flow({ attrs:{ cat:'comp_piston', flow:650 } }), 0.65, 'поршневой 650 л/мин');
  near(TzPick.flow({ attrs:{ cat:'comp_screw', flow:10 } }), 10, 'винтовой — как было');
  near(TzPick.flow({ attrs:{ cat:'pump', flow:32 } }), 32, 'насос — м³/ч, как было');
});

check('автозаполнение станции: производительность поршневых — в м³/мин станции, × число агрегатов', ()=>{
  EquipTypes.list=TYPES;
  const station={ attrs:{ cat:'st_comp' }, kit:{ parts:[
    part('comp_piston', { flow:650, pressure:10, kw:4 }, { role:'main', qty:2, name:'Компрессор поршневой' }),
  ] } };
  const out=StationAuto.of(station);
  near(out.flow, 1.3, 'станция из 2 × 650 л/мин');
  assert.strictEqual(out.pressure, 10, 'давление — бар, как было');
  const screw={ attrs:{ cat:'st_comp' }, kit:{ parts:[part('comp_screw', { flow:10, pressure:8 }, { role:'main', qty:2 })] } };
  near(StationAuto.of(screw).flow, 20, 'винтовой — как было');
});

check('сборное изделие: те же переводы, что у станции (воздуходувка — м³/ч → м³/мин, мбар → бар)', ()=>{
  assert.strictEqual(FieldUnit.pair('л/мин', 'м³/мин'), 0.001);
  near(FieldUnit.pair('м³/ч', 'м³/мин'), 1/60, 'м³/ч → м³/мин');
  assert.strictEqual(FieldUnit.pair('мбар', 'бар'), 0.001);
  assert.strictEqual(FieldUnit.pair('бар', 'бар'), 1);
  assert.strictEqual(FieldUnit.pair('кВт', 'бар'), null, 'неизвестная пара — не переводится');
});

let passed=0;
for (const [name, fn] of checks) {
  try { fn(); passed++; } catch (e) { console.error('ОШИБКА — '+name+':\n'+(e && e.stack || e)); process.exitCode=1; }
}
if (!process.exitCode) console.log(`Единицы полей категорий: проверок ${passed} — все прошли`);
