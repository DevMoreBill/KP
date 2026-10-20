// Эталонные сценарии «ТЗ → КП» (tests/test_station_scenarios.py): требования, разобранные из текста ТЗ (TzParse на
// сервере), записываются в станцию как в окне ТЗ (TzImport.apply — без окна), оборудование подбирается из каталога
// (TzPick), затем расчёт станции (StationCalc) и приложение к КП (StationCalc.docGroups). Каталог — вымышленный, в памяти:
// компрессоры «Пример», осушители и фильтры Dalgakiran с номиналами из каталога производителя (DK — Dryair, DA, GON),
// осушители и фильтры «Пример» без данных производителя (типовые поправки), ресиверы, ДГУ с расходом топлива.
// Запуск: node tests/js/station_scenarios.js сценарии.json → JSON с результатами в stdout.
'use strict';
const vm=require('vm'), fs=require('fs'), path=require('path');
const ROOT=path.resolve(__dirname, '..', '..'), WebScripts=require('./web.js');

global.document={ addEventListener(){} };
global.uid=(()=>{ let n=0; return ()=>'p'+(++n); })();
global.attrsOf=d=>Object.assign({}, d.attrs||{});
const TYPES={ st_comp:{ station:{ main:['comp_screw', 'comp_piston'] } }, st_pump:{ station:{ main:['pump'] } }, st_dgu:{ station:{ main:['dgu'] } } };
global.typeById=id=>TYPES[id]||{};
global.DEF=()=>null; global.FEAT={ on:()=>true };
global.esc=s=>String(s??'');
Object.assign(global, require(path.join(ROOT, 'app', 'web', 'js', 'core', 'money.js')));   // Money — показ сумм (ES-модуль)
for (const f of ['deal/index.js', 'rules/index.js', 'layout/index.js', 'calc/index.js', 'kit/index.js', 'req/index.js', 'station/index.js', 'eskd/index.js', 'view/index.js', 'draw/index.js', 'tz/index.js', 'tz-out/index.js']){
  WebScripts.load(path.join(ROOT, 'app', 'web', 'js', 'features', f)); }
StationRules.use(JSON.parse(fs.readFileSync(path.join(ROOT, 'app', 'web', 'rules', 'stations.json'), 'utf8')));
global.S={};
const GOLDEN=process.env.KP_GOLDEN ? require('./golden.js') : null;   // слепок для station_golden.js
if (GOLDEN) process.on('exit', ()=>GOLDEN.save(process.env.KP_GOLDEN));

class Catalog {
  static n=0;
  static it(name, attrs, rows){ return { id:'c'+(++Catalog.n), name, attrs, groups:rows ? [{ name:'Характеристики', rows }] : [] }; }
  static comp(flow, bar, kw, extra=''){ return this.it(`Компрессор винтовой Пример ${String(flow).replace('.', ',')}/${bar}${extra}`, { cat:'comp_screw', maker:'Пример', model:`П-${flow}-${bar}`, flow, pressure:bar, kw }, [{ k:'Тип запуска', v:'«Звезда–треугольник» (Y/Δ)' }]); }
  static list(){
    const fuel=(kw)=>[{ k:'При нагрузке 50 %', v:String(Math.round(kw*0.135*10)/10).replace('.', ',')+' л/ч' }, { k:'При нагрузке 75 %', v:String(Math.round(kw*0.2*10)/10).replace('.', ',')+' л/ч' },
      { k:'При нагрузке 100 %', v:String(Math.round(kw*0.265*10)/10).replace('.', ',')+' л/ч' }, { k:'Топливный бак', v:Math.round(kw*1.2)+' л' }];
    const dgu=(kw)=>this.it(`ДГУ Пример ${kw} кВт открытого исполнения`, { cat:'dgu', maker:'Пример', model:'ДП-'+kw, kw, kwMax:Math.round(kw*1.1), kva:Math.round(kw/0.8) }, fuel(kw));
    return [
      this.comp(5, 10, 37), this.comp(6.5, 8, 45), this.comp(8, 10, 55), this.comp(10.5, 8, 55), this.comp(13, 10, 75), this.comp(16.5, 10, 90), this.comp(21, 10, 110), this.comp(9, 13, 75),
      this.it('Компрессор винтовой безмасляный Пример ОФ-10', { cat:'comp_screw', maker:'Пример', model:'ОФ-10', flow:10, pressure:8, kw:75, oilFree:'да' }),
      ...[['100', 7.8], ['110', 9.8], ['120', 13.8], ['130', 18.3], ['140', 21.8], ['150', 27.1], ['160', 36.7], ['170', 43.7], ['180', 52.4]].map(([m, f])=>this.it('Осушитель рефрижераторный Dalgakiran Dryair DK '+m, { cat:'dryer_refrig', maker:'Dalgakiran', model:'DK '+m, series:'Dryair DK', flow:f, pressure:16, dewPoint:'+3' })),
      ...[['575', 9.58], ['680', 11.3], ['850', 14.2], ['1000', 16.7], ['1250', 20.8], ['1500', 25.0], ['1800', 30.0]].map(([m, f])=>this.it('Осушитель адсорбционный Dalgakiran DA '+m, { cat:'dryer_ads', maker:'Dalgakiran', model:'DA '+m, flow:f, pressure:10, dewPoint:'−40', regen:'Холодная (без нагрева)' })),
      this.it('Осушитель рефрижераторный Пример ОР-25', { cat:'dryer_refrig', maker:'Пример', model:'ОР-25', flow:25, pressure:16, dewPoint:'+3' }),
      ...[['400', 'MX', 'Тонкая'], ['600', 'MX', 'Тонкая'], ['1000', 'MX', 'Тонкая'], ['1550', 'MX', 'Тонкая'], ['400', 'MY', 'Сверхтонкая (микрофильтр)'], ['600', 'MY', 'Сверхтонкая (микрофильтр)'],
        ['1000', 'MY', 'Сверхтонкая (микрофильтр)'], ['1550', 'MY', 'Сверхтонкая (микрофильтр)'], ['1000', 'MP', 'Предварительная'], ['1550', 'MP', 'Предварительная'], ['1000', 'MA', 'Угольный (от паров масла)'], ['1550', 'MA', 'Угольный (от паров масла)']]
        .map(([m, g, st])=>this.it(`Фильтр магистральный Dalgakiran GON ${m} ${g}`, { cat:'filter', maker:'Dalgakiran', model:`GON ${m} ${g}`, series:'GON', flow:Math.round(+m/60*10)/10, pressure:16, stage:st })),
      ...[[500, 11], [900, 11], [1000, 11], [2000, 11], [500, 16], [1000, 16]].map(([v, p])=>this.it(`Ресивер воздушный вертикальный Пример РВ-${v}/${p}`, { cat:'receiver', maker:'Пример', model:`РВ-${v}/${p}`, volume:v, pressure:p })),
      dgu(100), dgu(160), dgu(200), dgu(250), dgu(320), dgu(400), dgu(500),
    ];
  }
}

class Scenario {
  static NUMS = TzImport.NUMS;
  static num(v){ const n=StationReq.num(String(v??'').replace(/[−–]/g, '-').replace(/^\+/, '')); return n==null ? '' : String(n); }
  /** требования из ТЗ → станция, подбор, расчёт; как TzImport.apply без окна */
  static async run(sc){
    const q=Object.assign({}, sc.req);
    const x={ id:'x'+sc.n, name:'', attrs:{ cat:q.kind==='dgu' ? 'st_dgu' : q.kind==='pump' ? 'st_pump' : 'st_comp' }, req:{}, kit:{ parts:[ContainerPart.create(q.cont||'block')] } };
    StationDefaults.add(x, x.attrs.cat);   // как мастер новой станции: глушитель, бак, обвязка
    const r=x.req;
    for (const k of this.NUMS) if (q[k]!=null && q[k]!=='') r[k]=this.num(q[k]);
    for (const k of ['recv', 'reserve', 'work', 'fire']) if (q[k]!=null) r[k]=String(q[k]);
    for (const [k, L] of [['basis', StationReq.BASIS], ['mode', StationReq.MODE], ['start', StationReq.START]]) if (L.some(o=>o[0]===q[k])) r[k]=q[k];
    for (const [k, , kinds] of StationReq.OPTS) if (kinds.includes(q.kind)) r[k]=!!q[k];
    r.recvOut=!!q.recvOut;
    if (q.kind==='comp' && q.air) x.stLayout={ air:q.air };
    StationReq.ensureParts(x);
    const note=await TzPick.run(x, { ...q, flow:+this.num(q.flow), pressure:+this.num(q.pressure), q:+this.num(q.q), head:+this.num(q.head), kw:+this.num(q.kw), hours:+this.num(q.hours), pdp:q.pdp, recvVol:+this.num(q.recvVol), work:+q.work||0 });
    if (GOLDEN){ GOLDEN.label=sc.name; GOLDEN.put('TzPick.run', [note, x.kit, x.req, x.stLayout]);
      const d=GOLDEN.docx(); TzText.write(d, x, StationUi.plan(x), 'ПНЕВМОТЕХ'); GOLDEN.put('TzOut.write', d.calls); }
    if (sc.edit) for (const [k, v] of Object.entries(sc.edit)) r[k]=v;   // правка менеджера после подбора
    // ТКП (решение ПНЕВМОТЕХ): расчётная записка в КП — только галочкой менеджера, по умолчанию её нет
    const off=StationCalc.docGroups(x).length; x.stLayout={ ...(x.stLayout||{}), calc:true };
    const R=StationCalc.run(x), G=StationCalc.docGroups(x);
    const steps=R.sections.flatMap(s=>s.steps.map(o=>({ sec:s.id, what:o.what, result:o.result||'', ok:o.ok, margin:o.margin, data:(o.data||[]).map(([k, v])=>k+': '+v) })));
    return { n:sc.n, name:sc.name, req:r, cls:(x.stLayout||{}).air||'', note,
      parts:Kit.parts(x).filter(p=>p.role!=='container').map(p=>({ name:p.name, qty:+p.qty||1, kind:StationEquip.kindOf(p), attrs:p.attrs||{}, rows:(p.rows||[]).filter(r=>r && r.k) })),
      errors:R.errors.map(e=>e.text), warnings:R.warnings.map(e=>e.text), weak:R.weak.map(w=>w.title), assumptions:R.assumptions, questions:R.questions, later:R.later,
      steps, groups:G.map(g=>g.name), groupsOff:off, version:R.version };
  }
}

(async ()=>{
  global.catCache=Catalog.list();
  global.api=async u=>{ const c=global.catCache.find(z=>u.endsWith('/'+encodeURIComponent(z.id))); if (!c) throw new Error('нет '+u); return c; };
  const S=JSON.parse(fs.readFileSync(process.argv[2], 'utf8')), out=[];
  for (const sc of S) out.push(await Scenario.run(sc));
  process.stdout.write(JSON.stringify(out));
})().catch(e=>{ console.error(e && e.stack || e); process.exit(1); });
