// Слепок станций: каждый расчёт компоновки (StationLayout.solve) с текстом дверей и систем для ТЗ, чертёж, схема и 3D-вид
// из tests/js/station_layout.js, расчёт станции (StationCalc) из tests/js/station_calc.js, подбор по ТЗ (TzPick) и текст ТЗ
// на сборку (TzText) из tests/js/tz_pick.js и эталонных сценариев station_scenarios.js сверяются с tests/js/station_golden.json.
// Изменили поведение намеренно — пересоздать: node tests/js/station_golden.js --update и показать разницу в git.
// Запуск из корня репозитория: node tests/js/station_golden.js — код выхода 0, если совпало (tests/test_station_layout.py).
'use strict';
const fs=require('fs'), os=require('os'), path=require('path'), { execFileSync }=require('child_process');
const SNAP=path.join(__dirname, 'station_golden.json'), SUITES=['station_layout.js', 'station_calc.js', 'tz_pick.js', 'station_scenarios.js'];
const ROOT=path.resolve(__dirname, '..', '..');

class StationGolden {
  static take(){
    const out={}, sc=StationGolden.scenarios();
    for (const s of SUITES){
      const tmp=path.join(os.tmpdir(), `kp-golden-${process.pid}-${s}.json`);
      execFileSync(process.execPath, [path.join(__dirname, s), sc], { env:{ ...process.env, KP_GOLDEN:tmp }, stdio:['ignore', 'ignore', 'inherit'] });
      out[s]=JSON.parse(fs.readFileSync(tmp, 'utf8')); fs.unlinkSync(tmp);
    }
    fs.unlinkSync(sc);
    return out;
  }

  /** требования эталонных сценариев ТЗ (tests/test_station_scenarios.py), разобранные сервером, — для station_scenarios.js */
  static scenarios(){
    const f=path.join(os.tmpdir(), `kp-golden-${process.pid}-sc.json`);
    const py='import json, sys; sys.path[:0] = ["tests", "app"]; import test_station_scenarios as t; '+
      'json.dump([{"n": n, "name": m, "req": t.TzParse.parse(z)["req"], "edit": e} for n, m, z, e in t.SCENARIOS], open(sys.argv[1], "w", encoding="utf-8"), ensure_ascii=False)';
    execFileSync(process.env.PYTHON || 'python3', ['-c', py, f], { cwd:ROOT, stdio:['ignore', 'ignore', 'inherit'] });
    return f;
  }

  static diff(want, got){
    const bad=[];
    for (const s of SUITES){
      const a=want[s]||[], b=got[s]||[];
      if (a.length!==b.length) bad.push(`${s}: вызовов ${b.length} вместо ${a.length}`);
      for (let i=0; i<Math.min(a.length, b.length) && bad.length<20; i++)
        if (a[i].join()!==b[i].join()) bad.push(`${s} #${i} «${b[i][0]}» ${b[i][1]}: ${b[i][2]} вместо ${a[i][2]}`);
    }
    return bad;
  }

  static main(){
    const got=StationGolden.take();
    if (process.argv.includes('--update')){ fs.writeFileSync(SNAP, JSON.stringify(got, null, 0).replace(/\],\[/g, '],\n[')+'\n'); console.log('слепок станций обновлён'); return; }
    const bad=StationGolden.diff(JSON.parse(fs.readFileSync(SNAP, 'utf8')), got);
    if (bad.length){ console.error('Слепок станций не совпал:\n'+bad.join('\n')); process.exitCode=1; return; }
    console.log(`Слепок станций совпал: ${SUITES.map(s=>got[s].length).reduce((a, b)=>a+b)} результатов`);
  }
}

StationGolden.main();
