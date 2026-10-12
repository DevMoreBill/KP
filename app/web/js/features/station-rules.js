// Инженерные правила модульных станций — из файла правил (app/web/rules/stations.json или своя версия администратора),
// не из кода. Сервер отдаёт их скриптом /api/rules/stations.js: StationRules.use({...}) — до модулей расчёта станций.
// У каждого правила — значение, единица, источник и статус: confirmed — подтверждено источником, practice — отраслевая
// практика, unconfirmed — требует подтверждения (в расчётной записке такие пункты перечисляются отдельно).
'use strict';

class StationRules {
  static data = null;
  static map = new Map();
  static STATUS = { confirmed:'подтверждено источником', practice:'отраслевая практика', unconfirmed:'требует подтверждения' };

  /** правила из файла: {version, rules:[{id, value, unit, source, status}], series:[…]} */
  static use(d){
    if (!d || !Array.isArray(d.rules)) return;
    this.data=d; this.map=new Map(d.rules.map(r=>[r.id, r]));
  }
  static ok(){ return !!this.data; }
  static version(){ return this.data ? String(this.data.version||'') : ''; }
  /** правило целиком; нет — ошибка (правила обязательны: без них расчёт не выполняется) */
  static rule(id){
    const r=this.map.get(id); if (!r) throw new Error('Нет инженерного правила «'+id+'» — файл правил станций не загружен или неполный');
    return r;
  }
  /** значение правила (копия — менять его нельзя) */
  static v(id){ const v=this.rule(id).value; return v && typeof v==='object' ? JSON.parse(JSON.stringify(v)) : v; }
  /** значение необязательного правила или null — в своей версии файла администратора (сделанной до появления правила)
   *  его может не быть: тогда расчёт идёт по-прежнему */
  static opt(id){ const r=this.map.get(id); return r ? r.value : null; }
  /** значение без копии — для частых обращений из расчёта (только чтение) */
  static raw(id){ return this.rule(id).value; }
  static status(id){ return this.rule(id).status; }
  /** «требует подтверждения» */
  static weak(id){ return this.rule(id).status==='unconfirmed'; }
  /** ссылка на источник: «документ, пункт» */
  static src(id){ const s=this.rule(id).source||{}; return [s.doc, s.item].filter(Boolean).join(', '); }
  /** коротко для окна расчёта: название документа без пояснений в скобках и после двоеточия; статус — если не подтверждено */
  static short(id){ const r=this.rule(id), s=r.source||{}, d=String(s.doc||'').split(/\s*[(:]|\s+—\s+|;\s*/)[0].trim();
    return [d.length>90 ? d.slice(0, 88)+'…' : d, s.item].filter(Boolean).join(', ')+(r.status!=='confirmed' ? ' — '+this.STATUS[r.status] : ''); }
  /** данные производителя по серии позиции каталога: первая серия, где совпали производитель и выражение match по
   *  названию / модели / серии; kind — 'dryer' | 'filter' | 'genset' */
  static series(p, kind){
    const L=(this.data && this.data.series) || [], a=(p && p.attrs)||{}, mk=String(a.maker||'').toLowerCase(), t=[p && p.name, a.model, a.series].filter(Boolean).join(' ');
    for (const s of L){ if (kind && s.kind!==kind) continue; if (String(s.maker||'').toLowerCase()!==mk) continue;
      let re; try{ re=new RegExp(s.match, 'i'); } catch(_){ continue; }
      if (re.test(t)) return s; }
    return null;
  }
  /** линейная интерполяция по таблице [[x, y], …] (за краями — крайние значения) */
  static interp(T, x){
    if (!Array.isArray(T) || !T.length || !Number.isFinite(x)) return null;
    if (x<=T[0][0]) return T[0][1]; if (x>=T[T.length-1][0]) return T[T.length-1][1];
    for (let i=1; i<T.length; i++) if (x<=T[i][0]){ const [x0, y0]=T[i-1], [x1, y1]=T[i]; return y0+(y1-y0)*(x-x0)/(x1-x0); }
    return T[T.length-1][1];
  }
}
