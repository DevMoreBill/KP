// Окно станции, вкладка «Состав станции» — коротко и по делу: требования заказчика (StationReq), контейнер одной строкой,
// оборудование двумя группами по стороне поставки (KitScope): «Наше оборудование» — привозим на сборку сами (компрессоры,
// ДГУ, насосы, осушители, фильтры, ресиверы) и «Сборщик контейнера» — шкафы управления, трубопровод, обвязка и всё, что
// отвечает за безопасность, по ТЗ на сборку. Каждый элемент — строка таблицы; описание, характеристики, фото, рисунок для
// чертежа и поля обвязки или шкафа — по раскрытию строки (KitView).
'use strict';

// ---------------------------------------------------------------- сторона поставки элемента
class KitScope {
  static OUR = /^(compressor|dgu|pump|dryer|filter|receiver)$/;
  static LABEL = { our:'Наше оборудование', asm:'Сборщик контейнера' };
  /** по умолчанию: основное оборудование и подготовка воздуха — наши, остальное (шкафы, трубопровод, системы) — сборщика */
  static def(p){ return p && p.role!=='container' && this.OUR.test(StationEquip.kindOf(p)) ? 'our' : 'asm'; }
  static of(p){ return p && (p.by==='our' || p.by==='asm') ? p.by : this.def(p); }
  /** поставщик элемента сборщика без своего поставщика — сборщик (поставщик контейнера): в экономике — у него */
  static sup(x, p){ const s=String((p && p.sup)||'').trim(); if (s || this.of(p)!=='asm') return s; return String((kitContainer(x)||{}).sup||'').trim(); }
}

// ---------------------------------------------------------------- числа в требованиях: разбор и допустимые значения
// Один разбор чисел для полей требований, расчёта и подбора: запятая или точка — десятичный разделитель, пробелы между
// разрядами, минус любого вида (−, –, -), «+» впереди. Что не число или вне допустимого — ошибка под полем (по-русски),
// значение в расчёт не идёт, КП не сохраняется, пока поле не исправят (без «тихой» подстановки).
class ReqNum {
  // ключ → [наименьшее, наибольшее, единица]; диапазоны — заведомо шире реальных станций в контейнере, отсекают опечатки
  static R = { flow:[0.05, 500, 'м³/мин'], pressure:[0.5, 40, 'бар'], margin:[0, 100, '%'], alt:[-100, 5000, 'м'], rh:[0, 100, '%'],
    tin:[0, 70, '°C'], tmin:[-65, 15, '°C'], tmax:[0, 60, '°C'], noise:[40, 120, 'дБА'], recvVol:[1, 100000, 'л'],
    kw:[1, 20000, 'кВт'], hours:[0.5, 720, 'ч'], load:[1, 100, '%'], motor:[0.1, 5000, 'кВт'], q:[0.1, 20000, 'м³/ч'], head:[0.5, 2500, 'м'],
    hsuct:[-10, 8, 'м'], tliq:[1, 100, '°C'], gateOff:[-1500, 1500, 'мм'],
    recvDp:[0.1, 5, 'бар'], recvT:[0.05, 120, 'мин'], recvC:[0.05, 500, 'м³/мин'], recvDrop:[0.1, 5, 'бар'], recvPoint:[0.01, 500, 'м³/мин'], recvValve:[1, 40, 'бар'],
    ventK:[0.5, 1, ''], ventTin:[20, 60, '°C'], ventDt:[1, 40, '°C'], ventDtc:[5, 30, '°C'], ventVin:[0.5, 8, 'м/с'], ventVout:[0.5, 10, 'м/с'], ventRes:[1, 2, ''],
    ventU:[0.1, 6, 'Вт/(м²·°C)'], ventFan:[1, 1e6, 'м³/ч'], ventEta:[0.3, 0.95, ''], ventTexh:[0, 40, '°C'], ventPhi:[5, 100, '%'], ventDays:[0, 365, 'сут'], ventTavg:[-40, 8, '°C'] };
  /** разбор: {n — число или null, bad — текст ошибки ('' — нет)} */
  static parse(v){
    const t=String(v??'').trim().replace(/[\u00a0\u202f ]+/g, '').replace(/[−–—]/g, '-').replace(/^\+/, '');
    if (!t) return { n:null, bad:'' };
    if (!/^-?\d+(?:[.,]\d+)?$/.test(t)) return { n:null, bad:/[.,].*[.,]/.test(t) ? 'неоднозначная запись числа — один десятичный разделитель' : 'нужно число' };
    return { n:parseFloat(t.replace(',', '.')), bad:'' };
  }
  /** число (null — пусто или ошибка) */
  static num(v){ return this.parse(v).n; }
  static f(v){ return String(v).replace('.', ','); }
  /** ошибка поля key: '' — нет */
  static check(key, v){
    const p=this.parse(v); if (p.bad) return p.bad; if (p.n==null) return ''; const R=this.R[key]; if (!R) return '';
    return p.n<R[0] || p.n>R[1] ? `от ${this.f(R[0])} до ${this.f(R[1])}${R[2] ? ' '+R[2] : ''}` : '';
  }
  /** все ошибки требований станции: [{key, label, text}] */
  static errors(x){
    const r=(x && x.req) || {}, out=[];
    for (const key of Object.keys(this.R)){ const t=this.check(key, r[key]); if (t) out.push({ key, label:this.LABEL[key]||key, text:t }); }
    return out;
  }
  static LABEL = { flow:'Производительность', pressure:'Давление', margin:'Запас производительности', alt:'Высота над уровнем моря', rh:'Влажность воздуха',
    tin:'Воздух на входе в осушитель', tmin:'Наружный воздух от', tmax:'Наружный воздух до', noise:'Шум на рабочем месте', recvVol:'Ресивер по ТЗ',
    kw:'Мощность нагрузки', hours:'Работа без дозаправки', load:'Средняя нагрузка', motor:'Наибольший двигатель нагрузки', q:'Подача', head:'Напор',
    hsuct:'Высота всасывания', tliq:'Температура жидкости', gateOff:'Смещение ворот от оси торца',
    recvDp:'ΔP нагрузка/разгрузка', recvT:'Длительность пика', recvC:'Расход в пике', recvDrop:'Допустимый перепад в ресивере', recvPoint:'Пиковый расход точки', recvValve:'Уставка предохранительного клапана',
    ventK:'k', ventTin:'t_вн летом', ventDt:'Δt помещения', ventDtc:'Нагрев воздуха в компрессоре', ventVin:'Скорость притока', ventVout:'Скорость выброса', ventRes:'Запас притока',
    ventU:'U стенки', ventFan:'Вытяжной вентилятор', ventEta:'КПД рекуператора', ventTexh:'t выбросного воздуха', ventPhi:'Влажность выбросного воздуха', ventDays:'Отопительный период', ventTavg:'Средняя температура периода' };
  /** для поля ввода: класс и подпись ошибки под полем */
  static mark(x, key){ const t=this.check(key, ((x && x.req) || {})[key]); return t ? { cls:' bad', msg:`<small class="f-err">${esc(t)}</small>` } : { cls:'', msg:'' }; }
}

// ---------------------------------------------------------------- требования к станции (из ТЗ заказчика или вручную)
class StationReq {
  static FIRE = ['А', 'Б', 'В1', 'В2', 'В3', 'В4', 'Г', 'Д'];
  static RES = [['', 'без резерва'], ['1', 'N + 1'], ['2', 'N + 2']];
  static WORK = [['', 'по подбору'], ['1', '1'], ['2', '2'], ['3', '3'], ['4', '4']];
  static get LOSS(){ return { dryer:StationRules.raw('loss.dryer').refrig, filter:StationRules.raw('loss.filter') }; }   // потери давления, бар (файл правил)
  // особые требования ТЗ: ключ, подпись, виды станций; АВР и диспетчеризация — шкафы в составе
  static OPTS = [['oilFree', 'Безмасляный компрессор (класс 0 по маслу)', ['comp']], ['vsd', 'Частотное регулирование', ['comp', 'pump']],
    ['ats', 'Два ввода питания с АВР', ['comp', 'pump', 'dgu']], ['scada', 'Диспетчеризация — шкаф АСУ ТП', ['comp', 'pump', 'dgu']]];
  static ATS = /АВР|ввод\S*\s+резерв/i;
  /** отрасль заказчика: в пищевой и медицинской — компрессоры только безмасляные (правило comp.oil_free) */
  static INDUSTRY = [['', 'общепромышленная'], ['food', 'пищевая (в т. ч. напитки)'], ['med', 'медицинская, фармацевтическая']];
  static INDUSTRY_WORD = { food:'пищевой', med:'медицинской и фармацевтической' };
  /** безмасляный компрессор нужен: по требованию (галочка) или по отрасли (пищевая, медицинская), если заказчик не разрешил масляный */
  static oilFree(x){
    const r=this.of(x); if (this.kind(x)!=='comp') return false; if (r.oilFree) return true;
    const L=(StationRules.opt('comp.oil_free')||{ industries:['food', 'med'] }).industries||[];
    return L.includes(r.industry) && !r.oilOk;
  }
  /** безмасляный — по отрасли (а не галочкой): «для пищевой промышленности» */
  static oilWhy(x){ const r=this.of(x); return !r.oilFree && this.oilFree(x) ? `для ${this.INDUSTRY_WORD[r.industry]} промышленности` : 'по ТЗ'; }
  static SCADA = /АСУ\s?ТП|диспетчер/i;
  /** шкафы АВР и АСУ ТП по требованиям — добавить, если их нет; ответ — названия добавленного */
  static ensureParts(x){
    const r=this.of(x), P=kitParts(x), has=re=>P.some(p=>re.test(String(p.name||''))), out=[];
    if (r.ats && !has(this.ATS)){ const p=StationDefaults.part(x, 'Шкаф АВР (автоматический ввод резерва)'); p.attrs={ cat:'ats' }; P.push(p); out.push(p.name); }
    if (r.scada && !has(this.SCADA)){ const p=StationDefaults.part(x, 'Шкаф АСУ ТП (автоматизация и диспетчеризация)'); P.push(p); out.push(p.name); }
    return out;
  }
  /** вид станции: comp — компрессорная, dgu — ДГУ, pump — насосная */
  static kind(x){ const id=String(attrsOf(x).cat||''); return /comp/.test(id) ? 'comp' : /dgu/.test(id) ? 'dgu' : /pump/.test(id) ? 'pump' : ''; }
  static of(x){ return (x && x.req && typeof x.req==='object') ? x.req : {}; }
  static ensure(x){ if (!x.req || typeof x.req!=='object') x.req={}; return x.req; }
  static num(v){ return ReqNum.num(v); }
  /** ресиверы: по методике — основной после осушителя, мокрый до него — только при риске проскока влаги;
   *  или основной + мокрый всегда, только после, только до */
  static RECV = [['', 'по методике (мокрый — при пиках)'], ['both', 'основной + мокрый'], ['after', 'только после осушителя'], ['before', 'только до осушителя']];
  static recv(x){ const v=this.of(x).recv; return v==='before' || v==='after' || v==='both' ? v : ''; }
  static RSIZE = [['', 'авто: кратно 900 л'], ['900', '900 л'], ['500', '500 л (крайняя необх.)']];
  static RWHY = [['', 'обоснование 500 л —'], ['space', 'нехватка места'], ['mass', 'ограничение по массе']];
  /** расчёт ресиверов по составу станции (ReceiverPlan) или null */
  static recvPlan(x){ return ReceiverPlan.from(StationEquip.list(kitParts(x), { recv:this.recv(x), recvOut:this.recvOut(x) }), this.recvIn(x)); }
  /** блок «Ресиверы»: где ставить, типоразмер, ТЗ, ΔP, клапан, циклограмма, пик точки — и итог расчёта одной строкой */
  static recvBlock(x, i, fld, sel){
    const r=this.of(x), R=this.recvPlan(x), n=StationLayout.n, E=R ? R.checks : [], er=E.filter(c=>c.level==='error').length;
    const sum=R ? `<p class="kr-rp"><b>Приоритет ${esc(String(R.prio))}</b>: нужно ${n(R.theor)} л → ${esc(ReceiverPlan.text(R))}. <span class="${er ? 'bad-t' : E.length ? 'warn-t' : 'ok-t'}">${E.length ? `${er ? 'ошибок: '+er+(E.length>er ? ', ' : '') : ''}${E.length>er ? 'предупреждений: '+(E.length-er) : ''} — подробно в «Расчёте станции»` : 'Все проверки пройдены.'}</span></p>`
      : '<p class="muted kr-rp">Расчёт ресиверов — после выбора компрессора с производительностью.</p>';
    return `<details class="kr-calc"${Spoiler.attr('recv:'+x.id, ExpertFix.has(x, ['recv']))}><summary>Ресиверы — исходные данные и расчёт</summary>${sum}${ExpertFix.html(x, i, ['recv'], { all:true })}
      <div class="kr-g">${sel('recv', 'Где ставить', this.RECV, this.recv(x))}${sel('recvSize', 'Типоразмер', this.RSIZE, r.recvSize||'')}
        ${r.recvSize==='500' || r.recvWhy ? sel('recvWhy', 'Обоснование 500 л', this.RWHY, r.recvWhy||'') : ''}
        ${fld('recvVol', 'Объём по ТЗ, л', 'по расчёту', 'numeric')}${fld('recvDp', 'ΔP разгрузка − нагрузка, бар', '1 — по правилу')}
        ${fld('recvValve', 'Уставка предохранительного клапана, бар', 'по паспорту')}</div>
      <p class="kr-sub">Циклограмма потребления — если есть (приоритет 2)</p>
      <div class="kr-g">${fld('recvT', 'Длительность пика T, мин', '—')}${fld('recvC', 'Расход в пике C, м³/мин', '—')}${fld('recvDrop', 'Допустимый перепад P1 − P2, бар', '—')}
        ${fld('recvPoint', 'Пик отдельной точки, м³/мин', '—')}</div>
      <p class="muted kr-hint">Методика ПНЕВМОТЕХ: 1 — цикл V = Q / (8 · ΔP); 2 — пик V = T · (C − S) · Pa / (P1 − P2); 3 — без циклограммы 0,25 · Q (винтовой), 1 · Q (поршневой). Нужен наибольший; ресиверы — по 900 л (500 л — крайняя необходимость), мокрый до осушителя — 30–50 % основного, у потребителя — если пик точки больше 50 % компрессора.</p></details>`;
  }
  /** исходные данные расчёта ресиверов (ReceiverPlan): ошибочные поля — как не заданные (ошибка — под полем) */
  static recvIn(x){
    const r=this.of(x), g=k=>ReqNum.check(k, r[k]) ? null : this.num(r[k]), T=g('recvT'), C=g('recvC'), D=g('recvDrop');
    return { dp:g('recvDp'), cyc:T>0 && C>0 && D>0 ? { T, C, drop:D } : null, point:g('recvPoint'), tz:g('recvVol'), mode:this.recv(x),
      force:r.recvSize==='500' || r.recvSize==='900' ? r.recvSize : '', reason:r.recvWhy==='space' || r.recvWhy==='mass' ? r.recvWhy : '', auto:!!r.recvSizeAuto, valve:g('recvValve'),
      reserve:Math.max(0, Math.round(this.num(r.reserve)||0)) };
  }
  static recvOut(x){ return !!this.of(x).recvOut; }
  /** категория помещения по СП 12.13130.2009: своя или ориентировочная по виду станции (уточняется расчётом) */
  static fire(x){ const f=this.of(x).fire; return this.FIRE.includes(f) ? f : this.fireDef(x); }
  static fireDef(x){ return { comp:'В4', dgu:'В1', pump:'Д' }[this.kind(x)] || 'Д'; }
  /** допустимый уровень звука на рабочем месте, дБА (СанПиН 1.2.3685-21 — 80) */
  static noise(x){ const n=this.num(this.of(x).noise); return n>0 ? n : StationRules.ok() ? StationRules.raw('norm.noise') : 80; }   // по умолчанию — правило norm.noise
  /** для расстановки, проверок и чертежа: вид станции, категория (своя или ориентировочная), шум, наружный воздух, °C */
  static plan(x){
    const r=this.of(x), t=v=>this.num(String(v??'').replace(/[−–]/g, '-').replace(/^\+/, ''));
    return { kind:this.kind(x), fire:this.fire(x), fireAuto:!this.FIRE.includes(r.fire), noise:this.noise(x), tmin:t(r.tmin), tmax:t(r.tmax), res:Math.max(0, Math.round(this.num(r.reserve)||0)), vent:this.vent(x),
      gate:{ off:ReqNum.check('gateOff', r.gateOff) ? null : t(r.gateOff), why:String(r.gateWhy||'').trim().slice(0, 300) }, recvIn:this.kind(x)==='comp' ? this.recvIn(x) : null };
  }
  // режим «эксперт» вентиляции: [ключ требований, ключ расчёта, подпись, подсказка]; пусто — по правилам
  static VENT = [['ventK', 'k', 'k — доля мощности в тепло', '0,9'], ['ventTin', 'tIn', 't_вн летом, °C', '40'], ['ventDt', 'dt', 'Δt помещения летом, °C', 't_вн − t_нар'],
    ['ventDtc', 'dtc', 'Нагрев воздуха в компрессоре, °C', '15'], ['ventVin', 'vIn', 'Скорость притока (по рамке), м/с', '3'], ['ventVout', 'vOut', 'Скорость выброса (по рамке), м/с', '4'], ['ventRes', 'res', 'Запас притока', '1,1'],
    ['ventU', 'U', 'U стенки, Вт/(м²·°C)', 'по утеплителю'], ['ventFan', 'fan', 'Вытяжной вентилятор, м³/ч', 'нет'],
    ['ventEta', 'eta', 'КПД рекуператора', 'по типу'], ['ventTexh', 'tExh', 't выбросного воздуха зимой, °C', '+5'], ['ventPhi', 'phi', 'Влажность выбросного воздуха, %', '50'],
    ['ventDays', 'days', 'Отопительный период, сут', '205'], ['ventTavg', 'tavg', 'Средняя температура периода, °C', '−2,2']];
  static HRV = [['', 'с промежуточным теплоносителем (по умолчанию)'], ['plate', 'пластинчатый перекрёстный'], ['rotary', 'роторный'], ['glycol', 'с промежуточным теплоносителем']];
  /** числа режима «эксперт» для расчёта (VentCalc): {k, tIn, dt, dtc, vIn, vOut, res, U, fan, eta, tExh, phi, days, tavg, hrvType} */
  static vent(x){
    const r=this.of(x), o={}; for (const [rk, k] of this.VENT){ const v=this.num(String(r[rk]??'').replace(/[−–]/g, '-').replace(/^\+/, '')); if (v!=null) o[k]=v; }
    if (r.hrvType) o.hrvType=r.hrvType; return o;
  }
  /** документы при поставке — в КП (по умолчанию да) */
  static docs(x){ return this.of(x).docs!==false; }

  /** что даёт состав против требований: [{ok, text}] */
  static checks(x){
    const r=this.of(x), k=this.kind(x), out=[], P=kitParts(x), n=v=>String(Math.round(v*100)/100).replace('.', ',');
    const units=kind=>P.filter(p=>StationEquip.kindOf(p)===kind).flatMap(p=>Array.from({ length:Math.max(1, Math.min(20, +p.qty||1)) }, ()=>p));
    const res=Math.max(0, Math.round(this.num(r.reserve)||0));
    // рабочие — без res самых больших агрегатов (отказать может любой); текст: «12,6 + 12,6 в резерве — не меньше 12,5»
    const enough=(vals, need, what, unit)=>{ const s=[...vals].sort((a, b)=>b-a), sum=s.reduce((a, b)=>a+b, 0), work=s.slice(res).reduce((a, b)=>a+b, 0), ok=work>=need;
      const rs=res && s.length>res ? ` + ${n(sum-work)} в резерве` : '';
      return { ok, text:`${what} ${n(work)} ${unit}${rs} — ${ok ? 'не меньше' : 'меньше требуемых'} ${n(need)}` }; };
    if (k==='comp'){ const U=units('compressor'), q0=this.num(r.flow), bar=this.num(r.pressure), nd=q0>0 ? this.need(r, q0) : null, need=nd ? nd.v : null;
      const ads=P.find(p=>StationEquip.kindOf(p)==='dryer' && AirChain.info(p, 'dryer').type==='ads'), purge=ads ? AirChain.purge((ads.attrs||{}).regen) : 0, q=U.map(p=>(AirChain.flow(p)||0)*(1-purge));
      if (need>0) out.push(enough(q, need, (purge ? 'производительность за вычетом продувки осушителя' : 'производительность')+(nd.why ? ` (потребность: ${nd.why})` : ''), 'м³/мин'));
      if (bar>0){ const pm=Math.max(0, ...U.map(p=>AirChain.bar(p)||0)), loss=this.loss(P), o=Math.round((pm-loss)*10)/10;
        if (pm) out.push({ ok:o>=bar, text:loss ? `давление на выходе ≈ ${n(o)} бар (компрессор ${n(pm)}, потери в подготовке воздуха ≈ ${n(loss)}) — ${o>=bar ? 'не меньше' : 'меньше'} ${n(bar)}`
          : `давление ${n(pm)} бар — ${pm>=bar ? 'не меньше' : 'меньше'} ${n(bar)}` }); } }
    if (k==='comp' && this.oilFree(x)){ const U=units('compressor'), bad=U.filter(p=>!TzPick.oilFree(p)).length;
      if (U.length) out.push({ ok:!bad, text:bad ? `компрессор не безмасляный — ${this.oilWhy(x)} нужен класс 0 по маслу` : 'компрессоры безмасляные' }); }
    if (r.ats && !P.some(p=>this.ATS.test(String(p.name||'')))) out.push({ ok:false, text:'нет шкафа АВР — по ТЗ два ввода питания' });
    if (r.scada && !P.some(p=>this.SCADA.test(String(p.name||'')))) out.push({ ok:false, text:'нет шкафа АСУ ТП — по ТЗ диспетчеризация' });
    if (k==='dgu'){ const U=units('dgu'), sb=r.mode==='standby', kw=U.map(p=>GensetSizing.cap(p.attrs, sb)), need=this.num(r.kw), h=this.num(r.hours);
      if (U.length && kw.some(v=>!(v>0))) out.push({ ok:false, text:'у ДГУ в карточке не указана мощность — заполните карточку' });
      else if (need>0) out.push(enough(kw, need, 'мощность', 'кВт'));
      // работа от бака: топливо в баках станции (и в баке ДГУ, если указан) при нагрузке 75 % рабочих ДГУ
      const work=[...kw].sort((a, b)=>b-a).slice(res).reduce((a, b)=>a+b, 0), fuel=P.filter(p=>StationEquip.kindOf(p)==='tank' || StationEquip.kindOf(p)==='dgu')
        .reduce((s, p)=>s+(StationEquip.kindOf(p)==='tank' ? AirChain.volume(p)||StationEquip.num((p.attrs||{}).tank)||0 : StationEquip.num((p.attrs||{}).tank)||0)*Math.max(1, +p.qty||1), 0);
      const fp=h>0 && typeof GensetSizing!=='undefined' && StationRules.ok() ? GensetSizing.plan(x) : null;   // как в расчётной записке
      if (fp && fp.c>0){ const t=fp.have/(fp.c*StationRules.raw('dgu.fuel_margin')), ok=fp.have>=fp.need*(1-StationRules.raw('calc.tolerance'));
        out.push({ ok, text:ok ? `работа от баков ≈ ${n(Math.floor(t))} ч при нагрузке ${Math.round(fp.x*100)} % (с запасом) — не меньше ${n(h)}` : `работа от баков ≈ ${n(Math.floor(t))} ч — меньше ${n(h)}: нужно топлива ${n(Math.ceil(fp.need))} л, в баках ${n(fp.have)}` }); }
      else if (h>0 && work>0 && fuel>0){ const t=fuel/(work*StationDefaults.LOAD*StationDefaults.LPH);
        out.push({ ok:t>=h*0.98, text:t>=h*0.98 ? `работа от бака ≈ ${n(Math.floor(t))} ч при нагрузке ${Math.round(StationDefaults.LOAD*100)} % — не меньше ${n(h)}` : `работа от бака ≈ ${n(Math.floor(t))} ч — меньше ${n(h)}: нужен бак около ${StationDefaults.tank(work, h)} л` }); } }
    if (k==='pump'){ const U=units('pump'), top=(p, f)=>{ const t=StationEquip.top((p.attrs||{})[f]); return t ? t.v : 0; }, q=U.map(p=>top(p, 'flow')), need=this.num(r.q), head=this.num(r.head);
      if (U.length && q.some(v=>!(v>0))) out.push({ ok:false, text:'у насоса в карточке не указана подача — заполните карточку' });
      else if (need>0) out.push(enough(q, need, 'подача', 'м³/ч'));
      if (head>0){ const res=Math.max(0, Math.round(this.num(r.reserve)||0)), W=[...U].sort((a, b)=>top(b, 'flow')-top(a, 'flow')).slice(Math.min(res, Math.max(0, U.length-1))), H=W.map(p=>top(p, 'head'));
        if (H.some(v=>!(v>0))) out.push({ ok:false, text:'у насоса в карточке не указан напор — заполните карточку' });
        else if (H.length){ const hm=Math.min(...H); out.push({ ok:hm>=head*0.98, text:`напор ${n(hm)} м — ${hm>=head*0.98 ? 'не меньше' : 'меньше'} ${n(head)}` }); } } }
    return out;
  }

  /** требуемая производительность компрессоров, м³/мин FAD: потребность из ТЗ (нормальные м³ — к условиям всасывания на
   *  высоте и при влажности, AirDemand) с запасом из ТЗ; {v, why} */
  static need(r, q){
    const t=v=>this.num(String(v??'').replace(/[−–]/g, '-').replace(/^\+/, '')), why=[]; let v=q;
    if (typeof AirDemand!=='undefined' && AirDemand.REF[r.basis]){ const tm=t(r.tmax), rh=t(r.rh); v=AirDemand.fad(q, t(r.alt)||0, tm!=null ? tm : StationRules.raw('flow.fad_ref').t, rh!=null ? rh : 100, r.basis); why.push(AirDemand.unit(r.basis)+' → FAD'); }
    const m=t(r.margin); if (m>0){ v*=1+m/100; why.push('запас '+String(m).replace('.', ',')+' %'); }
    return { v, why:why.join(', ') };
  }
  static BASIS = [['fad', 'на выходе компрессора (FAD, как в каталогах — ISO 1217)'], ['normal', 'нормальные н. м³ (0 °C, 101,3 кПа)'], ['std', 'стандартные ст. м³ (20 °C, 101,3 кПа, ГОСТ 2939)']];
  static LIQUID = [['', 'вода (по умолчанию)'], ['other', 'другая — по паспорту насоса и данным заказчика']];
  static MODE = [['prime', 'основной источник (PRP)'], ['standby', 'резервный — до 200 ч в год (ESP)']];
  static START = [['', 'не указан'], ['direct', 'прямой'], ['stardelta', 'звезда — треугольник'], ['soft', 'плавный пуск'], ['vsd', 'частотный преобразователь']];

  /** потери давления в подготовке воздуха, бар (оценка): осушитель и ступени фильтров по ходу воздуха */
  static loss(P){ const k=P.map(p=>StationEquip.kindOf(p)); return Math.round(((k.includes('dryer') ? this.LOSS.dryer : 0)+this.LOSS.filter*Math.min(4, k.filter(z=>z==='filter').length))*100)/100; }

  /** короткая строка требований для заголовка блока */
  static line(x){
    const r=this.of(x), k=this.kind(x), v=key=>ReqNum.check(key, r[key]) ? null : this.num(r[key]), u=(key, s)=>v(key)!=null && v(key)!==0 ? `${ReqNum.f(v(key))} ${s}` : '', cls=StationUi.opts(x).air;
    const main=k==='comp' ? [u('flow', r.basis==='std' ? 'ст. м³/мин' : r.basis==='normal' ? 'н. м³/мин' : 'м³/мин'), u('pressure', 'бар'), cls ? 'класс '+cls : '', v('margin')>0 ? 'запас '+u('margin', '%') : '']
      : k==='dgu' ? [u('kw', 'кВт'), r.mode==='standby' ? 'резервный (ESP)' : '', v('load')>0 ? 'средняя нагрузка '+u('load', '%') : ''] : k==='pump' ? [u('q', 'м³/ч'), u('head', 'м')] : [];
    const deg=key=>{ const n=v(key); return n==null ? '' : (n>0 ? '+' : '')+ReqNum.f(n).replace('-', '−')+' °C'; }, t=[deg('tmin') ? 'от '+deg('tmin') : '', deg('tmax') ? 'до '+deg('tmax') : ''].filter(Boolean).join(' ');
    const w=this.num(r.work), rs=this.num(r.reserve);
    const opt=[k==='comp' && r.industry ? (this.INDUSTRY.find(o=>o[0]===r.industry)||['', ''])[1].replace(/\s*\(.*\)$/, '')+' отрасль' : '', this.oilFree(x) ? 'безмасляный' : k==='comp' && r.oilOk && r.industry ? 'масляный — по требованию заказчика' : '', r.vsd && k!=='dgu' ? 'частотное регулирование' : '', r.ats ? 'два ввода с АВР' : '', r.scada ? 'диспетчеризация' : ''];
    return [...main, w>0 ? `${w} раб.${rs>0 ? ' + '+rs+' рез.' : ''}` : rs>0 ? 'резерв N+'+rs : '', t, v('alt')>0 ? u('alt', 'м над уровнем моря') : '', ...opt, r.src && r.src.name ? 'по ТЗ «'+r.src.name+'»' : ''].filter(Boolean).join(' · ');
  }

  /** «Все требования, условия расчёта и проверки» — под раскрывающимся блоком «Подбора станции» (StationQuick): проверки
   *  состава, итог подбора, остальные требования ТЗ (главные — в «Подборе станции»), условия расчёта, особые требования */
  static details(x, i){
    const r=this.of(x), k=this.kind(x), P=`items.${i}.req`, ck=this.checks(x);
    const fld=(key, label, ph, mode='decimal', ex='')=>{ const m=ReqNum.mark(x, key); return `<label class="f"><span>${label}</span><input type="text" inputmode="${mode}" data-p="${P}.${key}" data-req="${i}" value="${esc(r[key]??'')}" placeholder="${esc(ph||'')}" autocomplete="off"${m.cls ? ' class="bad"' : ''}>${m.msg}${ex}</label>`; };
    const sel=(key, label, list, cur)=>`<label class="f"><span>${label}</span><select data-req="${i}" data-rk="${key}">${list.map(([v, l])=>`<option value="${esc(v)}"${String(cur)===String(v) ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select></label>`;
    // замечания с решениями (ExpertFix): все — в «Подборе станции», ресиверы, вентиляция и ворота — ещё и в своих разделах
    // (раздел с замечанием раскрыт)
    const own=[...(k==='comp' ? ['recv'] : []), 'vent', ...(k==='comp' || k==='pump' ? ['gate'] : [])];
    const head=`${ck.length ? `<div class="kr-ck">${ck.map(c=>`<span class="chip sm ${c.ok ? 'on' : 'warn'}">${c.ok ? '✓' : '⚠'} ${esc(c.text)}</span>`).join('')}</div>` : ''}
      ${r.pick ? `<p class="kr-pick"><span>${esc(r.pick)}</span><button class="icon sm" type="button" data-a="reqPickX" data-i="${i}" title="Скрыть" aria-label="Скрыть итог подбора">✕</button></p>` : ''}`;
    // режим «эксперт» вентиляции — внутри «Условий для расчёта станции»
    const vx=`<details class="kr-calc"${Spoiler.attr('vent:'+x.id, ExpertFix.has(x, ['vent']))}><summary>Вентиляция и отопление — режим «эксперт»</summary>
        ${ExpertFix.html(x, i, ['vent'], { all:true })}<div class="kr-g">${this.VENT.filter(([rk])=>k==='comp' || !/^vent(K|Dtc)$/.test(rk)).map(([rk, , label, ph])=>fld(rk, label, ph, 'text', ExpertLog.mark(x, i, rk))).join('')}${sel('hrvType', 'Тип рекуператора', this.HRV, r.hrvType||'')}</div>
        ${ExpertLog.foot(x, i, ExpertLog.VENT())}
        <p class="muted kr-hint">Для нестандартных условий. Не заданы — значения из инженерных правил (k = 0,9, нагрев воздуха в компрессоре 15 °C, t_вн = 40 °C, приток 3 м/с с запасом 10 %, выброс 4 м/с, U — по утеплителю). k и U сильнее всего влияют на результат; паспортный расход охлаждающего воздуха важнее расчёта. Компактнее — система «Вентилятор в воздуховоде выброса», рекуператор — система «Рекуператор (по требованию)».</p></details>`;
    return `<div class="kit-req open">${head}
      <div class="kr-g">${sel('work', 'Рабочих агрегатов', this.WORK, r.work||'')}
        ${fld('tmin', 'Наружный воздух от, °C', '−45', 'text')}${fld('tmax', 'до, °C', '+40', 'text')}
        ${sel('fire', 'Категория помещения (СП 12.13130)', this.FIRE.map(f=>[f, f+(f===this.fireDef(x) ? ' (ориент.)' : '')]), this.fire(x))}
        ${fld('noise', 'Шум на рабочем месте, не более дБА', '80', 'numeric')}</div>
      ${k==='comp' ? this.recvBlock(x, i, fld, sel) : ''}
      ${k==='comp' || k==='dgu' || k==='pump' ? `<details class="kr-calc"${Spoiler.attr('cond:'+x.id, ExpertFix.has(x, own.filter(s=>s!=='recv')))}><summary>Условия для расчёта станции</summary><div class="kr-g">${k==='pump'
        ? sel('liquid', 'Перекачиваемая жидкость', this.LIQUID, r.liquid||'')+fld('tliq', 'Температура жидкости, °C', '20', 'text')
          +fld('hsuct', 'Высота всасывания, м (подпор — с минусом)', 'по ТЗ', 'text')+fld('alt', 'Высота над уровнем моря, м', '0', 'text')
        : k==='comp'
        ? fld('margin', 'Запас производительности, %', '0 — по ТЗ')+fld('alt', 'Высота над уровнем моря, м', '0', 'text')
          +fld('rh', 'Влажность воздуха, % (для н. м³)', '100 — с запасом', 'numeric')+fld('tin', 'Воздух на входе в осушитель, °C', 'по расчёту', 'text')
        : fld('load', 'Средняя нагрузка за сутки, %', '100')+fld('motor', 'Наибольший двигатель нагрузки, кВт', '—')
          +sel('start', 'Пуск этого двигателя', this.START, r.start||'')+fld('alt', 'Высота над уровнем моря, м', '0', 'text')}</div>
        <p class="muted kr-hint">Не заданы — расчёт берёт значения с запасом в пользу заказчика; они перечислены в «Расчёте станции» (вкладка «Компоновка»).</p>
        ${k!=='dgu' ? `<details class="kr-calc"${Spoiler.attr('gate:'+x.id, ExpertFix.has(x, ['gate']))}><summary>Ворота в торце — режим «эксперт»</summary>${ExpertFix.html(x, i, ['gate'], { all:true })}<div class="kr-g">${fld('gateOff', 'Смещение от оси торца, мм (+ к задней стене)', '0 — по оси', 'text', ExpertLog.mark(x, i, 'gateOff'))}
          <label class="f kr-n"><span>Причина смещения (обязательна)</span><input type="text" data-p="${P}.gateWhy" data-req="${i}" value="${esc(r.gateWhy||'')}" maxlength="300" placeholder="например: проход к воротам у передней стены" autocomplete="off"${this.num(r.gateOff) && !String(r.gateWhy||'').trim() ? ' class="bad"' : ''}></label></div>
          <p class="muted kr-hint">По умолчанию ворота — по оси торца; программа смещает их сама, только если агрегат иначе не провезти (причина — в замечаниях и ТЗ). Своё смещение без причины не сохранится в КП.</p>${ExpertLog.foot(x, i, ExpertLog.GATE)}</details>` : ''}${vx}</details>` : ''}
      ${k==='comp' || k==='dgu' || k==='pump' ? '' : vx}
      ${k==='comp' ? `<label class="chk kr-out"><input type="checkbox" data-req="${i}" data-rk="recvOut"${this.recvOut(x) ? ' checked' : ''}> Ресивер после подготовки — снаружи, на площадке у торца <span class="muted">(ФНП ОРПД, п. 65)</span></label>` : ''}
      <div class="kr-opts">${this.OPTS.filter(([, , kinds])=>kinds.includes(k)).map(([key, label])=>key==='oilFree' && !r.oilFree && this.oilFree(x)
        ? `<label class="chk" title="Правило: в пищевой и медицинской промышленности — только безмасляные компрессоры"><input type="checkbox" checked disabled> ${esc(label)} <span class="muted">— ${esc(this.oilWhy(x))}</span></label>`
        : `<label class="chk"><input type="checkbox" data-req="${i}" data-rk="${key}"${r[key] ? ' checked' : ''}> ${esc(label)}</label>`).join('')}</div>
      <label class="chk" title="${esc(SupplyDocs.list(x).join('; '))}"><input type="checkbox" data-req="${i}" data-rk="docs"${this.docs(x) ? ' checked' : ''}> Документы при поставке — в КП <span class="muted">(паспорта, декларации ТР ТС 010, 004, 020, 032, исполнительная документация)</span></label>
      ${r.notes ? `<label class="f kr-n"><span>Прочие требования из ТЗ</span><textarea rows="3" data-p="${P}.notes" data-req="${i}">${esc(r.notes)}</textarea></label>` : ''}</div>`;
  }
  /** поле требований изменилось */
  static change(t){
    const i=+t.dataset.req, x=S.items[i]; if (!x) return; const r=this.ensure(x), k=t.dataset.rk;
    if (k) r[k]=t.type==='checkbox' ? t.checked : t.value;
    if (k==='recvOut') delete r.recvOutAuto;   // менеджер решил сам — подбор «снаружи» больше не меняет
    const fk0=k || String(t.dataset.p||'').split('.').pop(); if (fk0==='recvSize' || fk0==='recvWhy') delete r.recvSizeAuto;   // и типоразмер ресивера (500 л «нехватка места» подбора)
    ExpertLog.note(x);
    if (t.dataset.stpar!=null) StationParams.changed(x);
    if (k==='recv' || k==='recvOut'){ StationUi.cache.delete(x.id); StationSize.apply(x, true); }
    // исходные данные ресиверов — число ресиверов в составе по расчёту
    const fk=k || String(t.dataset.p||'').split('.').pop();
    if (ReceiverSync.KEYS.includes(fk)){ const m=ReceiverSync.apply(x); if (m){ kitSync(x); StationUi.cache.delete(x.id); StationSize.apply(x, true); toast('Ресиверы по расчёту: '+m); } }
    // главное требование (расход, давление; мощность ДГУ; подача и напор насосов) изменилось у подобранной станции —
    // комплектующие подбираются заново сами, с уведомлением, что заменено
    if (k==='basis' && kitMainPart(x)){ persist(); StationQuick.auto(i, 'flow'); return; }   // другие кубометры — другая потребность
    if (StationQuick.AUTO.includes(fk) && t.dataset.p && kitMainPart(x)){ r[fk]=t.value; persist(); StationQuick.auto(i, fk); return; }
    if ((k==='ats' || k==='scada') && t.checked){ const a=this.ensureParts(x); if (a.length){ kitSync(x); StationUi.cache.delete(x.id); StationSize.apply(x, true); toast('Добавлено в состав: '+a.join(', ')); } }
    persist(); renderForm();
  }
}

// ---------------------------------------------------------------- ресиверы: число в составе — по расчёту
/** исходные данные ресиверов изменились (объём по ТЗ, ΔP, циклограмма, пик точки, типоразмер, где ставить) — число ресиверов
 *  в составе приводится к расчёту (ReceiverPlan): у строки ресивера нужного объёма и роли (основной, мокрый, у потребителя)
 *  меняется количество; ресивер другого объёма не трогаем — замену предлагает «Нужно…» */
class ReceiverSync {
  static KEYS = ['recv', 'recvSize', 'recvWhy', 'recvVol', 'recvDp', 'recvValve', 'recvT', 'recvC', 'recvDrop', 'recvPoint', 'reserve'];
  static WORD = { dry:'основной', wet:'мокрый', local:'у потребителя' };
  /** что изменено словами («основной 4 × 900 л») или ''; dry — только узнать, что изменилось бы */
  static apply(x, dry=false){
    const R=StationReq.recvPlan(x); if (!R) return '';
    const eq=StationEquip.list(kitParts(x), { recv:StationReq.recv(x), recvOut:StationReq.recvOut(x) }), P=kitParts(x), done=[];
    const role=e=>e.local ? 'local' : e.kind==='receiver' && e.air ? (e.air.role==='wet' ? 'wet' : 'dry') : '';
    for (const [k, g] of [['dry', R.main], ['wet', R.wet], ['local', R.local]]){
      if (!g || !(g.n>0)) continue;
      const ids=[...new Set(eq.filter(e=>role(e)===k && Math.round((e.local ? e.vol : e.air.vol)||0)===g.size).map(e=>e.id))];
      if (ids.length!==1 || eq.some(e=>role(e)===k && !ids.includes(e.id))) continue;   // несколько строк или другой объём — вручную / «Нужно…»
      const p=P.find(z=>z.id===ids[0]); if (!p || (+p.qty||1)===g.n) continue;
      if (!dry) p.qty=g.n; done.push(`${this.WORD[k]} ${g.n} × ${StationLayout.n(g.size)} л`); }
    return done.join(', ');
  }
}

// ---------------------------------------------------------------- режим «эксперт»: откуда значение, сброс, журнал
/** значения режима «эксперт» (вентиляция, ворота): у заданного вручную — отметка и сброс к инженерным правилам; каждая правка —
 *  в журнал станции (когда, кто, что было и стало; хранится в КП, последние MAX записей) */
class ExpertLog {
  static MAX = 40;
  static GATE = ['gateOff', 'gateWhy'];
  static VENT(){ return [...StationReq.VENT.map(v=>v[0]), 'hrvType']; }
  static keys(){ return [...this.VENT(), ...this.GATE]; }
  static label(k){ const v=StationReq.VENT.find(z=>z[0]===k); return v ? v[2] : { hrvType:'Тип рекуператора', gateOff:'Смещение ворот от оси торца, мм', gateWhy:'Причина смещения ворот' }[k] || k; }
  static set(r, k){ return r[k]!=null && String(r[k]).trim()!==''; }
  static snap(r){ const o={}; for (const k of this.keys()) if (this.set(r, k)) o[k]=String(r[k]).trim().slice(0, 300); return o; }
  static stamp(){ const d=new Date(), p=v=>String(v).padStart(2, '0'); return `${p(d.getDate())}.${p(d.getMonth()+1)}.${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`; }
  /** записать отличия от прошлого снимка (первый раз — только снимок: значения прежних версий не считаются правкой) */
  static note(x){
    const r=StationReq.ensure(x), now=this.snap(r);
    if (!r._xs || typeof r._xs!=='object'){ r._xs=now; return; }
    const was=r._xs, who=String((S.manager && S.manager.name)||'').trim().slice(0, 80), t=this.stamp(), L=Array.isArray(r.xlog) ? r.xlog : [];
    for (const k of new Set([...Object.keys(was), ...Object.keys(now)])) if (was[k]!==now[k]) L.push({ t, k, from:was[k]??'', to:now[k]??'', who });
    r.xlog=L.slice(-this.MAX); r._xs=now;
  }
  /** вернуть значения к инженерным правилам */
  static reset(x, keys){ const r=StationReq.ensure(x), ok=new Set(this.keys()); if (!r._xs) r._xs=this.snap(r); for (const k of keys) if (ok.has(k)) delete r[k]; this.note(x); }
  /** под полем: «вручную · по правилам» (кнопка сброса); не задано — подсказка в поле и есть значение правил */
  static mark(x, i, k){ return this.set(StationReq.of(x), k) ? `<small class="f-src">вручную · <button class="lnk" type="button" data-a="reqReset" data-i="${i}" data-k="${esc(k)}" title="Вернуть значение инженерных правил">по правилам</button></small>` : ''; }
  /** низ блока: сбросить всё заданное вручную; журнал правок этого блока */
  static foot(x, i, keys){
    const r=StationReq.of(x), on=keys.filter(k=>this.set(r, k)), L=(Array.isArray(r.xlog) ? r.xlog : []).filter(e=>keys.includes(e.k));
    if (!on.length && !L.length) return '';
    return `<div class="kr-xp">${on.length ? `<button class="btn ghost sm" type="button" data-a="reqReset" data-i="${i}" data-k="${esc(on.join(','))}">Всё по правилам (задано вручную: ${on.length})</button>` : ''}
      ${L.length ? `<details class="kr-log"><summary>Журнал правок (${L.length})</summary><ul>${L.slice().reverse().map(e=>`<li><span class="muted">${esc(e.t)}${e.who ? ' · '+esc(e.who) : ''}</span> ${esc(this.label(e.k))}: ${esc(e.from||'по правилам')} → ${esc(e.to||'по правилам')}</li>`).join('')}</ul></details>` : ''}</div>`;
  }
}

// ---------------------------------------------------------------- документы при поставке станции (блок в КП)
// По составу: паспорта и руководства, декларации (сертификаты) ЕАЭС по техническим регламентам — машины и оборудование
// (ТР ТС 010/2011), низковольтное оборудование (004/2011), электромагнитная совместимость (020/2011), оборудование под
// давлением (032/2013 — ресиверы, колонны адсорбционного осушителя); паспорт сосуда на каждый ресивер; исполнительная
// документация на сборку и протоколы испытаний.
class SupplyDocs {
  static list(x){
    const P=kitParts(x).filter(p=>String(p.name||'').trim()), k=p=>StationEquip.kindOf(p), has=(...K)=>P.some(p=>K.includes(k(p)));
    const mach=has('compressor', 'pump', 'dgu', 'dryer'), el=mach || has('cabinet'), vessel=has('receiver') || P.some(p=>k(p)==='dryer' && /адсорбц/i.test(AirChain.text(p)));
    const tr=[mach && 'ТР ТС 010/2011 «О безопасности машин и оборудования»', el && 'ТР ТС 004/2011 «О безопасности низковольтного оборудования»',
      el && 'ТР ТС 020/2011 «Электромагнитная совместимость технических средств»', vessel && 'ТР ТС 032/2013 «О безопасности оборудования, работающего под избыточным давлением»'].filter(Boolean);
    const sk=StationReq.kind(x), scheme=sk==='comp' ? 'схема пневматическая принципиальная' : sk==='pump' ? 'схема гидравлическая принципиальная' : '';
    return [
      'паспорта и руководства по эксплуатации оборудования на русском языке',
      tr.length ? 'декларации (сертификаты) соответствия: '+tr.join(', ') : '',
      has('receiver') ? 'паспорт сосуда, работающего под давлением, — на каждый ресивер, паспорт предохранительного клапана' : '',
      ['паспорт станции', 'габаритный чертёж', scheme, 'схема электрическая принципиальная', 'перечень оборудования'].filter(Boolean).join(', '),
      `протоколы испытаний при сборке: ${sk==='dgu' ? 'топливопровод на плотность' : 'опрессовка трубопроводов'}, сопротивление изоляции, металлосвязь (заземление)`,
    ].filter(Boolean);
  }
  /** блок описания для документа КП (станция, документы включены) или null */
  static feature(x){
    if (!stationOf(x) || !StationReq.docs(x) || !kitParts(x).length) return null;
    const L=this.list(x); return { id:'kit_docs', label:'Документы при поставке', text:L.map((t, i)=>i ? t : t[0].toUpperCase()+t.slice(1)).join('; ')+'.' };
  }
}

// ---------------------------------------------------------------- вкладка «Состав станции»
// ---------------------------------------------------------------- чего не хватает компрессорной и фильтры подбора
// По выбранным компрессорам программа сама знает, какой нужен осушитель, какие фильтры и ресивер (AirChain.check): в составе
// — строки «Нужно: …» с кнопкой «Подобрать»; окно каталога открывается сразу с подходящими (производительность и объём — не
// меньше нужных, давление — не ниже компрессорного), рекомендуемый — первым (тот же расчёт, что у «Подобрать оборудование»:
// TzPick — поправки производителя, добор количеством, ресиверы по 900 л без учёта в Ростехнадзоре). «Подобрать всё
// недостающее» — одной кнопкой. Для всех станций — основное оборудование против требований «Подбора станции»: сколько
// рабочих и резервных («Нужно: ещё 1 × …»), мало (давление, напор, больше четырёх рабочих) — «Заменить» с подбором по
// требованиям; у ДГУ — топливный бак под время работы без дозаправки.
class KitNeed {
  static n(v){ return StationReq.num(String(v??'').replace(/[−–]/g, '-').replace(/^\+/, '')); }
  /** цепочка воздуха по составу (контейнер не нужен): {q, bar, recs, …} или null (не компрессорная, нет компрессоров) */
  static air(x){
    if (StationReq.kind(x)!=='comp') return null;
    return AirChain.check(StationEquip.list(kitParts(x), { recv:StationReq.recv(x), recvOut:StationReq.recvOut(x) }), StationUi.opts(x).air, StationReq.recvIn(x));
  }
  /** компрессоры состава с характеристиками */
  static comps(x){ return StationEquip.list(kitParts(x)).filter(e=>e.kind==='compressor' && e.air); }
  /** наибольшее давление компрессоров, бар (0 — неизвестно) */
  static bar(x){ return Math.max(0, ...this.comps(x).map(e=>e.air.bar||0)); }
  /** чего не хватает (или что мало — замена): основное оборудование, бак ДГУ, подготовка воздуха компрессорной */
  static recs(x){ return [...this.main(x), ...this.fuel(x), ...this.airRecs(x)]; }
  static MAIN = { comp:['compressor', 'компрессор', 'м³/мин'], dgu:['dgu', 'ДГУ', 'кВт'], pump:['pump', 'насос', 'м³/ч'] };
  /** основное оборудование против требований «Подбора станции» (как в проверках требований): одна модель в составе —
   *  сколько нужно рабочих (по производительности, мощности, подаче; не меньше заданного числа) и резервных; давление
   *  (с потерями в подготовке воздуха), напор или больше четырёх рабочих — «Заменить». Несколько моделей — собрано вручную */
  static main(x){
    const k=StationReq.kind(x), M=this.MAIN[k]; if (!M) return [];
    const P=kitParts(x).filter(p=>StationEquip.kindOf(p)===M[0]); if (P.length!==1) return [];
    const p=P[0], r=StationReq.of(x), a=p.attrs||{}, U=Math.max(1, Math.round(+p.qty||1)), res=Math.max(0, Math.round(this.n(r.reserve)||0)), work=Math.max(0, Math.round(+r.work||0)), m3=AirChain.m3;
    let cap=0, need=0, bad='';
    if (k==='comp'){ const ads=kitParts(x).find(z=>StationEquip.kindOf(z)==='dryer' && AirChain.info(z, 'dryer').type==='ads'), purge=ads ? AirChain.purge((ads.attrs||{}).regen) : 0;
      cap=(AirChain.flow(p)||0)*(1-purge); need=this.n(r.flow)>0 ? StationReq.need(r, this.n(r.flow)).v : 0;
      const B=this.n(r.pressure), pm=AirChain.bar(p)||0, loss=StationReq.loss(kitParts(x));
      if (B>0 && pm>0 && pm-loss<B-1e-9) bad=`давление ${m3(pm)} бар${loss ? ` (с потерями в осушителе и фильтрах ≈ ${m3(pm-loss)})` : ''} меньше ${m3(B)} бар у потребителя`;
      if (!bad && StationReq.oilFree(x) && !TzPick.oilFree(p)) bad=`масляный, а ${StationReq.oilWhy(x)} нужен безмасляный (класс 0 по маслу)`; }
    if (k==='dgu'){ cap=GensetSizing.cap(a, r.mode==='standby'); need=this.n(r.kw)||0; }
    if (k==='pump'){ cap=this.n(a.flow)||0; need=this.n(r.q)||0; const H=this.n(r.head), h=this.n(a.head); if (H>0 && h>0 && h<H-1e-9) bad=`напор ${m3(h)} м меньше нужного ${m3(H)} м`; }
    const W=Math.max(work, need>0 && cap>0 ? Math.ceil(need/cap-1e-9) : 1);
    if (!bad && W>TzPick.MAX) bad=`слишком мал: нужно ${m3(need)} ${M[2]}, у одного ${m3(cap)} (больше ${TzPick.MAX} рабочих)`;
    if (bad) return [{ key:'main', main:true, swap:true, replace:[p.id], head:`Заменить: ${M[1]} — ${bad}`, why:'«Подобрать» откроет каталог с подходящими по требованиям «Подбора станции»' }];
    if (U<W+res) return [{ key:'main-qty', act:'qty', id:p.id, qty:W+res, head:`Нужно: ещё ${W+res-U} × ${String(p.name||'').trim() || StationEquip.LABEL[M[0]]}`,
      why:`всего ${W+res}: ${W} рабоч.${res ? ` + ${res} резерв.` : ''}${need>0 ? ` на ${m3(need)} ${M[2]}` : ''} — по «Подбору станции»` }];
    return [];
  }
  /** ДГУ: топливный бак под время работы без дозаправки (требования): нет бака — «Нужно», мал — «Заменить» (расчёт —
   *  StationDefaults.tankFor, как в расчётной записке) */
  static fuel(x){
    if (StationReq.kind(x)!=='dgu') return [];
    const h=this.n(StationReq.of(x).hours), t=h>0 ? StationDefaults.tankFor(x, h) : null; if (!t) return [];
    const T=kitParts(x).filter(z=>StationEquip.kindOf(z)!=='dgu' && StationDefaults.FUEL.test(String(z.name||''))), cur=T.reduce((s, z)=>s+(AirChain.volume(z)||0)*Math.max(1, +z.qty||1), 0);
    if (T.length && cur>=t.v) return [];
    return [{ key:'tank', act:'tank', hours:h, by:'asm', match:StationDefaults.FUEL, swap:!!T.length,
      head:T.length ? `Заменить: топливный бак ${StationLayout.n(cur)} л — нужен ${StationLayout.n(t.v)} л` : `Нужно: топливный бак ${StationLayout.n(t.v)} л`,
      why:`работа без дозаправки ${AirChain.m3(h)} ч — по «Подбору станции»${t.rows[1] ? '; '+t.rows[1].k.charAt(0).toLowerCase()+t.rows[1].k.slice(1)+' — '+t.rows[1].v : ''}` }];
  }
  /** подготовка воздуха компрессорной: рекомендации цепочки; осушитель при уже выбранном того же вида — замена */
  static airRecs(x){
    const A=this.air(x); if (!A) return [];
    const rank=r=>/^dryer/.test(r.cat) ? 0 : r.cat==='filter' ? 1 : 2;   // по ходу воздуха: осушитель, фильтры, ресиверы
    return [...A.recs, ...this.dryerFit(x, A)].sort((a, b)=>rank(a)-rank(b)).map(r=>{ if (!/^dryer-/.test(r.key) || r.replace) return r;
      const old=kitParts(x).filter(p=>attrsOf(p).cat===r.cat || (StationEquip.kindOf(p)==='dryer' && AirChain.info(p, 'dryer').type===(r.cat==='dryer_ads' ? 'ads' : 'refrig'))).map(p=>p.id);
      return old.length ? { ...r, replace:old, swap:true } : r; });
  }
  /** осушитель состава не проходит по высоте или в плане с проходом (габариты известны) — заменить на подходящий: меньший
   *  или два одинаковых параллельно на ту же производительность (решение ПНЕВМОТЕХ); подбор — TzPick.dryer */
  static dryerFit(x, A){
    const H=TzPick.hmax(x), W=TzPick.wmax(x), out=[], q=A.q||0;
    for (const t of ['ads', 'refrig']){ const cat=t==='ads' ? 'dryer_ads' : 'dryer_refrig';
      if ((A.recs||[]).some(r=>r.key==='dryer-'+t)) continue;   // уже рекомендована замена по производительности
      const L=kitParts(x).filter(p=>StationEquip.kindOf(p)==='dryer' && AirChain.info(p, 'dryer').type===t), c=p=>({ name:p.name, attrs:p.attrs||{}, rows:p.rows||[] });
      const bad=L.filter(p=>{ const d=StationEquip.dims(c(p), 'dryer'); return d.known && (!(TzPick.fitsH(c(p), 'dryer', H)) || !TzPick.fitsW(c(p), 'dryer', W)); });
      if (!bad.length) continue;
      const d=StationEquip.dims(c(bad[0]), 'dryer'), why=!TzPick.fitsH(c(bad[0]), 'dryer', H) ? `по высоте (${StationLayout.n(d.h)} мм, помещение ${StationLayout.n(H)} мм)` : `в плане с проходом (${StationLayout.n(Math.min(d.l, d.w))} мм, ширина ${StationLayout.n(W)} мм)`;
      out.push({ key:'dryer-'+t, cat, title:`${t==='ads' ? 'Адсорбционный' : 'Рефрижераторный'} осушитель, который помещается — или два параллельно${q ? ` (всего не менее ${AirChain.m3(q*AirChain.MARGIN/AirChain.kp(A.bar||7))} м³/мин)` : ''}`,
        why:`«${bad[0].name}» не проходит ${why} — меньший или два одинаковых параллельно на ту же производительность`, name:(t==='ads' ? 'Адсорбционный' : 'Рефрижераторный')+' осушитель', f:{}, r:{},
        attrs:{ cat }, rows:[], replace:bad.map(p=>p.id), swap:true, fit:true }); }
    return out;
  }
  /** рекомендуемая позиция каталога по рекомендации r: {c, n — штук параллельно, role — роль ресивера (основной, мокрый, у потребителя)} | null */
  static best(x, r){
    StationSup.use(x);   // при равных условиях — поставщик компрессоров станции (решение 17.10)
    const A=this.air(x), q=A ? A.q : 0, req=StationReq.of(x), B=this.n(req.pressure)||0, Bc=this.bar(x); let o=null;
    if (/^dryer-/.test(r.key)){ const ads=r.cat==='dryer_ads', pdp=ads && r.f && r.f.dewPoint ? this.n(r.f.dewPoint) : null;
      o=q>0 ? TzPick.dryer(ads, q, B, Bc, this.n(req.tmax), pdp, TzPick.hmax(x), TzPick.wmax(x)) : null; }
    else if (r.cat==='filter') o=TzPick.filter(r, q, B, Bc);
    else if (r.cat==='receiver'){
      // замена ресиверов на учёте (recv-split) — как раньше; остальные — типоразмер и число по методике (ReceiverPlan)
      if (r.key==='recv-split'){ const old=kitParts(x).filter(p=>(r.replace||[]).includes(p.id)).reduce((s, p)=>s+(AirChain.volume(p)||0)*Math.max(1, +p.qty||1), 0);
        const R=old>0 ? TzPick.receivers(old, Bc, StationReq.recvOut(x) ? 0 : TzPick.hmax(x)) : null; return R ? { c:R.o.c, n:R.n } : null; }
      const role=r.role||'dry', R=TzPick.recvPick(this.n((r.r.volume||[])[0])||0, Bc, (StationReq.recvOut(x) && role==='dry') || role==='local' ? 0 : TzPick.hmax(x));
      return R && R.o ? { c:R.o.c, n:Math.max(1, +r.qty||1), role } : null; }
    if (o) return { c:o.o.c, n:o.n };
    const L=pfList(this.filters(x, r), [r.cat], 1).list; return L.length ? { c:L[0], n:Math.max(1, +r.qty||1) } : null;
  }
  /** фильтры окна каталога по рекомендации: {cat, f, r, min — давление не ниже компрессорного (без данных не отсекается)} */
  static filters(x, r){
    const Bc=this.bar(x), F=pfNew([r.cat]); Object.assign(F.f, r.f||{}); for (const [k, v] of Object.entries(r.r||{})) F.r[k]=[...v];
    if (Bc>0) F.min={ pressure:Bc }; return F;
  }
  /** пресет окна подбора по рекомендации: фильтры, строка «что нужно», рекомендуемый, количество и замена */
  static preset(x, r){
    const A=this.air(x), F=this.filters(x, r), b=this.best(x, r), lab={ flow:'производительность от', volume:'объём от' }, unit={ flow:'м³/мин', volume:'л' };
    const need=[...Object.entries(F.r).filter(([, v])=>v && v[0]).map(([k, v])=>`${lab[k]||k} ${String(v[0]).replace('.', ',')} ${unit[k]||''}`.trim()),
      ...(F.min.pressure ? [`давление от ${AirChain.m3(F.min.pressure)} бар`] : []), ...Object.values(F.f).filter(Boolean)];
    return { f:F.f, r:F.r, min:F.min, rows:r.rows, attrs:r.attrs, qty:r.qty, replace:r.replace, role:r.cat==='receiver' ? r.role||'' : '', grade:r.cat==='filter' && AirChain.GRADES[r.key] ? r.key : '',
      best:b ? { id:b.c.id, n:b.n, label:b.n>1 && r.cat==='receiver' ? `${b.n} шт.` : '' } : null, title:r.title,
      need:`${r.swap ? 'Заменить: ' : 'Нужно: '}${r.title.charAt(0).toLowerCase()+r.title.slice(1)}${A && A.q ? ` — к компрессорам ${AirChain.m3(A.q)} м³/мин, ${AirChain.m3(A.bar)} бар` : ''}.`
        +(need.length ? ' Показаны подходящие: '+need.join(', ')+'.' : '') };
  }
  /** «+ Осушитель», «+ Фильтр», «+ Ресивер»: рекомендация этой категории (если есть) — иначе обычный подбор */
  static presetFor(x, cat){ const r=this.recs(x).find(z=>z.cat===cat && !z.swap); return r ? this.preset(x, r) : null; }
  /** основное оборудование по требованиям «Подбора станции»: показаны подходящие на рабочий агрегат, рекомендуемый (тот же
   *  подбор, что у кнопки «Подобрать оборудование») — первым, с числом рабочих и резервных. Компрессор — производительность,
   *  давление у потребителя, безмасляный, частотный; ДГУ — мощность (резервный источник — ESP); насос — подача и напор */
  static mainPreset(x){
    const k=StationReq.kind(x), r=StationReq.of(x), m3=AirChain.m3, cats=(stationOf(x)||{}).main||[], res=Math.max(0, Math.round(this.n(r.reserve)||0)), work=+r.work||0;
    const pool=TzPick.stationPool(cats), tail=n=>`${n>1 ? ` — ${n} рабочих` : ''}${res ? ` + ${res} в резерве` : ''}`;
    const out=(u, n, test, need, extra={})=>({ test, qty:n+res, best:u ? { id:u.o.c.id, n:u.n+res, label:u.n+res>1 ? `${u.n} рабоч.${res ? ` + ${res} резерв.` : ''} = ${u.n+res} шт.` : '' } : null, need, ...extra });
    if (k==='comp'){ const q0=this.n(r.flow), B=this.n(r.pressure)||0; if (!(q0>0)) return null;
      const cls=String(StationUi.opts(x).air||''), wc=+(cls.split('.')[1]||0), ads=wc>0 && wc<=3, nd=StationReq.need(r, q0), Q=ads ? nd.v/(1-AirChain.PURGE) : nd.v;
      const H=TzPick.hmax(x), cp=pool.filter(c=>TzPick.fitsH(c, 'compressor', H)), cq={ oilFree:StationReq.oilFree(x), vsd:!!r.vsd, work, ads };
      StationSup.use(x);
      const of=cq.oilFree, u=TzPick.comps(TzPick.electric(cp), Q, B, cq) || TzPick.comps(cp, Q, B, cq), n=u ? u.n : work||1, per=Q/n;
      return out(u, n, c=>TzPick.flow(c)>=per-1e-9 && (!of || TzPick.oilFree(c)),
        `Нужно ${m3(Q)} м³/мин${B ? ` при ${m3(B)} бар у потребителя` : ''}${nd.why || ads ? ` (${[nd.why, ads ? 'с запасом на продувку адсорбционного осушителя' : ''].filter(Boolean).join(', ')})` : ''}${tail(n)}. Показаны компрессоры от ${m3(per)} м³/мин${B ? `, давление от ${m3(B)} бар` : ''}${of ? `, безмасляные (${StationReq.oilWhy(x)})` : ''}.`,
        { min:B>0 ? { pressure:B } : {} }); }
    if (k==='dgu'){ const P=this.n(r.kw); if (!(P>0)) return null; const sb=r.mode==='standby', kw=c=>GensetSizing.cap(attrsOf(c), sb);
      const u=TzPick.units(pool.filter(c=>TzPick.dguOk(c)).map(c=>({ c, v:kw(c) })).filter(o=>o.v>0), P, work||1, o=>TzPick.dguPen(o.c)), n=u ? u.n : work||1, per=P/n;
      return out(u, n, c=>kw(c)>=per-1e-9, `Нужно ${m3(P)} кВт${sb ? ' (резервный источник — по ESP)' : ''}${tail(n)}. Показаны ДГУ от ${m3(per)} кВт.`); }
    if (k==='pump'){ const Q=this.n(r.q), H=this.n(r.head)||0; if (!(Q>0)) return null; const tp=v=>{ const t=StationEquip.top(v); return t ? t.v : null; }, f=c=>tp(attrsOf(c).flow)||0, hd=c=>tp(attrsOf(c).head);
      const u=TzPick.units(pool.filter(c=>TzPick.pumpOk(c)).map(c=>({ c, v:f(c), h:hd(c) })).filter(o=>o.v>0 && (!(H>0) || o.h>=H)), Q, work, o=>H>0 && o.h>0 ? 0.3*(o.h-H)/H : 0), n=u ? u.n : work||1, per=Q/n;
      return out(u, n, c=>f(c)>=per-1e-9 && (!(H>0) || (hd(c)||0)>=H), `Нужно ${m3(Q)} м³/ч${H ? `, напор ${m3(H)} м` : ''}${tail(n)}. Показаны насосы от ${m3(per)} м³/ч${H ? `, напор от ${m3(H)} м` : ''}.`); }
    return null;
  }
  /** подходит ли позиция каталога по пресету (отметка «мало» в окне подбора, когда показаны все) */
  static fits(c, P){
    if (!P) return true; const a=attrsOf(c);
    for (const [k, [lo]] of Object.entries(P.r||{})){ const l=pfNum(lo), v=numOf(a[k]); if (l!=null && (v==null || v<l-1e-9)) return false; }
    for (const [k, v] of Object.entries(P.min||{})){ const t=this.top(a[k]); if (t!=null && t<v-1e-9) return false; }
    for (const [k, v] of Object.entries(P.f||{})) if (v && String(a[k]??'')!==v) return false;
    return !P.test || P.test(c);
  }
  /** наибольшее число в значении («7,5 / 10 / 13 бар» → 13) */
  static top(v){ const m=String(v??'').replace(/\s+/g, '').replace(/[−–]/g, '-').match(/-?\d+(?:[.,]\d+)?/g); return m ? Math.max(...m.map(z=>+z.replace(',', '.'))) : null; }

  /** заголовок строки: «Нужно: …» / «Заменить: …» */
  static head(r){ return r.head || (r.swap ? 'Заменить: ' : 'Нужно: ')+r.title.charAt(0).toLowerCase()+r.title.slice(1); }
  /** есть чем закрыть: действие в составе, рекомендуемый из каталога. Подбор по каталогу долгий (тысячи позиций), а в одной
   *  перерисовке его спрашивают и строки «Нужно…», и «эксперт» — ответ помнится до конца шага и пока станция та же */
  static memo = null;
  static can(x, r){
    if (r.act) return true;
    const inp=StationUi.input(x), k=[x.id, StationLayout.hash(inp), inp.air, JSON.stringify(x.req||{}), catCache.length, JSON.stringify([r.key, r.main, r.cat, r.f, r.r, r.qty, r.role, r.replace])].join('|');
    if (!this.memo){ this.memo=new Map(); setTimeout(()=>{ this.memo=null; }, 0); }
    let v=this.memo.get(k); if (v===undefined){ v=r.main ? !!(this.mainPreset(x)||{}).best : !!this.best(x, r); this.memo.set(k, v); }
    return v;
  }
  /** строки «Нужно: …» в группе by (наше оборудование / сборщик контейнера) */
  static rows(x, i, by='our'){
    return this.recs(x).filter(r=>(r.by||'our')===by).map(r=>{ const has=this.can(x, r), lab=r.act ? (r.swap ? 'Заменить' : 'Добавить') : 'Подобрать';
      return `<div class="kt-r kt-need${r.swap ? ' swap' : ''}" role="row"><span class="kt-n" aria-hidden="true">${r.swap ? '⚠' : '+'}</span>
        <span class="kt-nw"><b>${esc(this.head(r))}</b><small class="muted">${esc(r.why||'')}${has ? '' : ' · в каталоге подходящего нет — «Подобрать» откроет каталог, можно добавить своё'}</small></span>
        <span class="kt-go"><button class="btn sm${has ? ' primary' : ''}" type="button" data-a="kitNeed" data-i="${i}" data-k="${esc(r.key)}">${lab}</button></span></div>`; }).join('');
  }
  /** что закрывает «Подобрать всё недостающее»: всё, кроме замены основного оборудования (её выбирает менеджер) */
  static fillable(x){ return this.recs(x).filter(r=>!r.main); }
  /** кнопка «Подобрать всё недостающее» (если рекомендаций больше одной) */
  static allBtn(x, i){ const n=this.fillable(x).length; return n>1 ? `<button class="btn primary sm kt-all" type="button" data-a="kitNeedAll" data-i="${i}">Подобрать всё недостающее (${n})</button>` : ''; }
  /** окно каталога по рекомендации (вкладки «Состав станции» и «Компоновка»); основное — по требованиям, с заменой */
  static open(i, r){
    const x=S.items[i]; if (!x || !r) return;
    if (r.main) return kitPickCat(i, (stationOf(x)||{}).main, 'main', '', { ...(this.mainPreset(x)||{}), replace:r.replace });
    kitPickCat(i, [r.cat], null, r.name, this.preset(x, r));
  }
  /** действие в составе (без каталога): число агрегатов, топливный бак; ответ — что сделано (для сообщения) */
  static apply(x, r){
    if (r.act==='qty'){ const p=kitParts(x).find(z=>z.id===r.id); if (!p) return ''; p.qty=r.qty; return `${String(p.name||'').trim()} — ${r.qty} шт.`; }
    if (r.act==='tank'){ if (!kitParts(x).some(z=>StationEquip.kindOf(z)!=='dgu' && StationDefaults.FUEL.test(String(z.name||'')))) x.kit.parts.push(StationDefaults.part(x, 'Дополнительный топливный бак'));
      const v=StationDefaults.retank(x, r.hours); return v ? `топливный бак ${StationLayout.n(v)} л` : ''; }
    return '';
  }
  /** состав изменился: закупка, компоновка, характеристики и название станции, перерисовка (размер контейнера — до
   *  характеристик: они берут ту же расстановку, второй раз она не считается) */
  static done(x){ kitSync(x); StationUi.cache.delete(x.id); StationSize.apply(x, true); stationFill(x); stationAutoName(x); x.page=true; persist(); renderEditor(); renderForm(); }
  /** одна кнопка: число агрегатов и бак — в составе, остальное — рекомендуемый из каталога (после осушителя могут
   *  понадобиться фильтры — до 4 проходов) */
  static async fillAll(i){
    const x=S.items[i]; if (!x) return; x.kit=x.kit||{ parts:[] }; const got=[], none=[], seen=new Set();
    for (let pass=0; pass<4; pass++){ const R=this.fillable(x).filter(r=>!seen.has(r.key)); if (!R.length) break;
      for (const r of R){ seen.add(r.key);
        if (r.act){ const t=this.apply(x, r); if (t) got.push(t); continue; }
        const b=this.best(x, r); if (!b){ none.push(r.title.replace(/\s*\(.*?\)/g, '')); continue; }
        if (Array.isArray(r.replace)) x.kit.parts=x.kit.parts.filter(z=>!r.replace.includes(z.id));
        const p=await TzPick.part(b.c, b.n); if (r.cat==='filter' && AirChain.GRADES[r.key]) p.airGrade=r.key; if (b.role) p.recvRole=b.role; x.kit.parts.push(p);
        got.push((b.n>1 ? b.n+' × ' : '')+b.c.name); } }
    this.done(x);
    toast((got.length ? 'Добавлено: '+got.join('; ') : 'Ничего не добавлено')+(none.length ? '. В каталоге нет: '+none.join('; ')+' — добавьте вручную' : ''));
  }
  /** действия (data-a): kitNeed — строка «Нужно: …» (действие в составе или окно подбора), kitNeedAll — всё недостающее */
  static act(a, i, b){
    const x=S.items[i]; if (!x) return false;
    if (a==='kitNeed'){ const r=this.recs(x).find(z=>z.key===b.dataset.k); if (!r) return false;
      if (r.act){ const t=this.apply(x, r); this.done(x); if (t) toast('В составе: '+t); return 'async'; }
      this.open(i, r); return 'async'; }
    if (a==='kitNeedAll'){ this.fillAll(i); return 'async'; }
    if (a==='kitSwap'){ const p=kitParts(x)[+b.dataset.j]; if (p) this.swap(i, p); return 'async'; }
    return false;
  }
  /** виды, которые можно заменить из каталога прямо из строки состава */
  static SWAP = /^(compressor|dryer|filter|receiver|dgu|pump|tank)$/;
  static canSwap(p){ return !!(p && (p.role==='main' || this.SWAP.test(StationEquip.kindOf(p)) || (p.attrs && p.attrs.cat))); }
  /** «⇄ Заменить» в строке: окно каталога с фильтрами по требованиям станции (основное — как «Подобрать оборудование»,
   *  остальное — по рекомендации этого вида или по расходу компрессоров, давлению, объёму), выбранное встаёт вместо этой
   *  строки с тем же количеством */
  static swap(i, p){
    const x=S.items[i], kind=StationEquip.kindOf(p), cat=(p.attrs||{}).cat, qty=Math.max(1, +p.qty||1), name=String(p.name||'').trim();
    const tag=`Замена «${name || 'элемента'}». `;
    if (p.role==='main'){ const m=this.mainPreset(x)||{};
      return kitPickCat(i, (stationOf(x)||{}).main, 'main', '', { ...m, replace:[p.id], swapRow:true, qty:m.qty||qty, need:tag+(m.need||'Показано основное оборудование станции.') }); }
    const cats=cat && TYPES.some(t=>t.id===cat) ? [cat] : null;
    // своя рекомендация этого вида («Нужно» / «Заменить») — её фильтры и рекомендуемый; иначе — по требованиям станции
    const rec=cats && this.recs(x).find(z=>z.cat===cat && !z.main);
    let pre=rec ? this.preset(x, rec) : null;
    if (!pre && cats){ const A=this.air(x), q=A && A.q>0 ? A.q : 0, V=AirChain.volume(p)||0;
      const r={ key:kind==='dryer' ? 'dryer-'+(cat==='dryer_ads' ? 'ads' : 'refrig') : kind==='filter' ? p.airGrade||'' : 'swap', cat, name, title:StationEquip.LABEL[kind] || 'элемент', f:{},
        r:kind==='receiver' ? (V>0 ? { volume:[V] } : {}) : (kind==='dryer' || kind==='filter') && q ? { flow:[AirChain.m3(q).replace(',', '.')] } : {}, qty, swap:true, role:p.recvRole||'' };
      pre=this.preset(x, r); }
    pre={ ...(pre||{}), replace:[p.id], swapRow:true, qty:pre && pre.qty ? pre.qty : qty, grade:p.airGrade || (pre && pre.grade) || '', role:p.recvRole || (pre && pre.role) || '' };
    const nd=pre.need ? pre.need.replace(/^(Нужно|Заменить): /, '') : 'Показан каталог этого вида — выберите, что поставить вместо.';
    pre.need=tag+nd.charAt(0).toUpperCase()+nd.slice(1);
    kitPickCat(i, cats, p.role||null, cats ? '' : name, pre, p.by);
  }
}

class KitView {
  static open = new Set();       // раскрытые строки (id элементов)
  static SYS = /отоплен|вентиляц|освещен|электроснабж|сигнализац|пожаротуш|шумо/i;   // как системы контейнера — не элементы
  static pos = new Map();        // id элемента → номер позиции на чертеже (при отрисовке вкладки)

  static render(x, i){
    const parts=kitParts(x), st=stationOf(x);
    if (!st && !parts.length) return `<div class="ed-sec"><p class="muted">Состав есть только у станций в контейнере. Чтобы собрать станцию, выберите категорию «Насосные / Компрессорные / Дизель-генераторные станции в контейнере» на вкладке «Основное».</p></div>`;
    StationReq.ensure(x);
    const cont=kitContainer(x), main=kitMainPart(x);
    const idx=parts.map((p, j)=>[p, j]).filter(([p])=>p.role!=='container'), our=idx.filter(([p])=>KitScope.of(p)==='our'), asm=idx.filter(([p])=>KitScope.of(p)==='asm');
    const sups=[...new Set([...(typeof DL!=='undefined' && DL.sups || []).map(s=>s.name), ...catCache.map(c=>attrsOf(c).maker)].filter(Boolean))].slice(0, 400);
    this.pos=new Map(StationEquip.list(parts).filter(e=>e.pos).map(e=>[e.id, e.pos]));   // номера позиций на чертеже
    return `<div class="ed-sec kit2">
      ${st ? StationQuick.html(x, i) : ''}
      ${cont ? this.cont(x, i, cont, parts.indexOf(cont)) : this.pickCont(i)}
      ${st && !main ? `<div class="kit-todo"><b>${esc(st.mainLabel)}</b><span class="muted">Основное оборудование станции — из каталога (с описанием, характеристиками, фото и закупкой) или своё.</span>
        <div class="row"><button class="btn primary" type="button" data-a="kitMain" data-i="${i}">Выбрать в каталоге</button><button class="btn ghost" type="button" data-a="kitAdd" data-i="${i}" data-n="${esc(st.mainLabel)}" data-role="main">+ Своё</button></div></div>` : ''}
      ${this.group(x, i, 'our', our, st)}
      ${this.group(x, i, 'asm', asm, st)}
      <datalist id="kitSupL">${sups.map(s=>`<option value="${esc(s)}">`).join('')}</datalist>
      ${this.sum(x, i)}</div>`;
  }

  /** контейнер ещё не выбран — плитки типов */
  static pickCont(i){
    return `<div class="kit-todo"><b>Контейнер</b><span class="muted">В чём поставляем станцию — дальше уточните утепление, климат и системы.</span>
      <div class="kit-cts">${CONTAINER_TYPES.map(c=>`<button type="button" class="kit-ctb" data-a="kitCont" data-i="${i}" data-ct="${esc(c.id)}"><b>${esc(c.name)}</b><small>${esc(c.size)}</small></button>`).join('')}</div></div>`;
  }

  /** контейнер: тип, размер, утепление, климат, цвет, сборщик и закупка — одной строкой; системы — кнопками */
  static cont(x, i, p, j){
    const sel=(attr, list, cur, lab)=>`<label class="f"><span>${lab}</span><select data-kitct="${i}.${j}" data-fld="${attr}">${list.map(([v, l])=>`<option value="${esc(v)}"${v===cur ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select></label>`;
    const ct=p._costText ?? (p.cost ? String(p.cost/100).replace('.', ',') : ''), P=`items.${i}.kit.parts.${j}`;
    const auto=StationUi.on(x) && StationGeo.FLEX[p.ctype], sz=String(p.size||'').trim();
    return `<div class="kit-cont">
      <div class="kc-g">${sel('ctype', CONTAINER_TYPES.map(c=>[c.id, c.name]), p.ctype, 'Контейнер')}
        <label class="f"><span>Размер Д × Ш × В, мм${auto && p.sizeAuto && sz ? ` <small class="muted">${p.lenFix ? 'длина задана' : 'по оборудованию'}</small>` : ''}${auto ? tip('Все три окошка пустые — размер по оборудованию. Только длина (например, 10000) — длина заданная, ширина, высота и плотность компоновки (просторно, плотно, максимально плотно) — по оборудованию. Все три — размер целиком вручную.') : ''}</span>${DimInput.html(`data-kitct="${i}.${j}" data-fld="size"`, p.size||'', {ph:ctypeOf(p.ctype).size, label:'Размер контейнера', lenOnly:auto, unit:''})}</label>
        ${sel('ins', CONTAINER_INS.map(v=>[v, v]), p.ins, 'Утепление')}
        ${sel('climate', CLIMATES.map(c=>[c[0], c[0]+' — до '+c[2]+' °C']), p.climate, 'Климатическое исполнение')}
        <label class="f"><span>Сборщик контейнера${tip('Кто изготавливает контейнер и собирает станцию. Элементы «Сборщика контейнера» без своего поставщика в «Экономике сделки» попадут к нему; наше оборудование едет к нему на сборку.')}</span><input type="text" list="kitSupL" data-p="${P}.sup" value="${esc(p.sup||'')}" placeholder="производитель контейнеров"></label>
        <label class="f"><span>Закупка контейнера</span><span class="kit-cost"><input type="text" inputmode="decimal" data-kitcost="${i}.${j}" value="${esc(ct)}" placeholder="цена из счёта"><select data-kitcur="${i}.${j}" aria-label="Валюта закупки">${DEAL_CURS.map(c=>`<option${(p.costCur||'RUB')===c ? ' selected' : ''}>${c}</option>`).join('')}</select></span></label></div>
      <details class="kc-more"${Spoiler.attr('cont:'+x.id)}><summary>Крыша, пол, окраска${this.look(p)}</summary><div class="kc-g">
        ${StationGeo.SEA[p.ctype] ? '' : sel('roof', Object.entries(StationGeo.ROOFS).map(([k, r])=>[k, r.deg ? `${r.name} (${r.deg}°)` : r.name]), StationGeo.roof(p), 'Крыша')}
        ${sel('floor', Object.entries(StationGeo.FLOORS).map(([k, f])=>[k, f.short]), StationGeo.floor(p), 'Пол')}
</div>${PaintView.html(p, i, j)}</details>
      ${auto && p.lenFix ? StationSize.note(p, StationUi.plan(x), i) : ''}
      ${auto && !p.sizeAuto && sz ? `<p class="muted kit-szn">Размер задан вручную — <button type="button" class="lnk" data-a="stlAuto" data-i="${i}">подобрать по оборудованию</button></p>` : ''}
      <div class="kit-sys"><span class="muted">Системы:</span>${CONT_SYSTEMS.map(([id, k, v])=>{ const on=KitView.sysOn(x, p, id); return `<button type="button" class="chip sm${on ? ' on' : ''}" data-a="kitSys" data-i="${i}" data-j="${j}" data-sys="${id}" aria-pressed="${!!on}" title="${esc(v)}">${esc(k)}</button>`; }).join('')}</div></div>`;
  }

  /** выбранное исполнение коротко — в заголовке свёрнутого блока: «(крыша скатная · пол — сталь чёрная · RAL 7035 / RAL 5005)» */
  static look(p){
    const r=StationGeo.SEA[p.ctype] ? null : StationGeo.ROOFS[StationGeo.roof(p)], f=StationGeo.FLOORS[StationGeo.floor(p)];
    const n=StationPaint.arts(p).length, t=[r && 'крыша '+r.name, f && 'пол — '+f.short, StationPaint.short(p), n && 'рисунков: '+n].filter(Boolean).join(' · ');
    return t ? ` <span class="muted">(${esc(t)})</span>` : '';
  }

  /** система контейнера включена: своё значение, иначе по умолчанию (рекуперация — у компрессорных и ДГУ, насосы почти не греют) */
  static sysOn(x, p, id){ const v=(p.sys||{})[id]; return v ?? (id==='rec' ? StationReq.kind(x)!=='pump' : !!CONT_SYS_DEF[id]); }

  /** группа элементов: таблица строк и кнопки добавления */
  static group(x, i, by, idx, st){
    const presets=(st ? st.parts : KIT_PRESETS).map(z=>Array.isArray(z) ? z : [z, '']), have=new Set(kitParts(x).map(p=>norm(p.name)));
    const kinds=new Set(kitParts(x).map(p=>StationEquip.kindOf(p)).filter(k=>k==='dryer' || k==='receiver'));   // уже есть — не предлагать
    // «Нужно: …» — чего не хватает (KitNeed); кнопки этих категорий и элементов не дублируем
    const R=KitNeed.recs(x).filter(r=>(r.by||'our')===by), need=KitNeed.rows(x, i, by), needCats=new Set(R.map(r=>r.cat).filter(Boolean)), hide=n=>R.some(r=>r.match && r.match.test(n));
    const mine=presets.filter(([n, c])=>!have.has(norm(n)) && KitScope.def({ name:n, attrs:{ cat:c } })===by && !KitView.SYS.test(n) && !kinds.has(StationEquip.kindOf({ name:n, attrs:{ cat:c } })) && !needCats.has(c) && !hide(n));   // системы — кнопками у контейнера
    const lead=by==='our' ? 'привозим на сборку сами' : 'шкафы, трубопровод, обвязка, системы безопасности — по ТЗ на сборку';
    return `<section class="kit-grp ${by}"><h4>${KitScope.LABEL[by]} <small class="muted">— ${lead}</small></h4>
      ${idx.length || need ? `<div class="kit-t" role="table">
        ${idx.length ? `<div class="kt-r kt-head" role="row"><span title="Номер позиции на габаритном чертеже">Поз.</span><span>Наименование</span><span>Кол.</span><span>Закупка за ед.</span><span>Поставщик</span><span></span></div>` : ''}
        ${idx.map(([p, j])=>this.row(x, i, p, j, by)).join('')}${need}</div>${by==='our' ? KitNeed.allBtn(x, i) : ''}` : `<p class="muted kit-empty">${by==='our' ? 'Нет оборудования — выберите ниже.' : 'Пока ничего — по умолчанию сборщик делает контейнер и его системы.'}</p>`}
      <div class="kit-add">${mine.map(([n, c])=>`<button class="chip sm" type="button" data-a="kitPreset" data-i="${i}" data-n="${esc(n)}" data-cat="${esc(c)}" data-by="${by}" title="${c ? 'Подобрать в каталоге: '+esc(typeById(c).name) : 'Найти в каталоге или добавить новым элементом'}">+ ${esc(n)}</button>`).join('')}
        <button class="chip sm ghost" type="button" data-a="kitCat" data-i="${i}" data-by="${by}">+ Из каталога</button><button class="chip sm ghost" type="button" data-a="kitAdd" data-i="${i}" data-by="${by}">+ Своё</button></div></section>`;
  }

  /** строка элемента */
  static row(x, i, p, j, by){
    const P=`items.${i}.kit.parts.${j}`, ct=p._costText ?? (p.cost ? String(p.cost/100).replace('.', ',') : ''), open=this.open.has(p.id), last=kitParts(x).length-1;
    const kind=StationEquip.kindOf(p), lab=p.role==='main' ? '<span class="kit-role main">основное</span>' : '';
    const asmSup=by==='asm' ? KitScope.sup(x, p) : '';
    return `<div class="kt-r${open ? ' open' : ''}${p.name ? '' : ' need'}" role="row" data-kitj="${j}">
      <span class="kt-n" title="${this.pos.has(p.id) ? 'Позиция на габаритном чертеже' : 'На чертеже не показывается'}">${this.pos.get(p.id) || '·'}</span>
      <span class="kt-nm">${lab}<input type="text" data-p="${P}.name" value="${esc(p.name)}" placeholder="Название элемента" aria-label="Название элемента"${p.name ? '' : ' class="need"'}>${this.sub(p, kind)}</span>
      <span class="kt-q"><input type="text" inputmode="numeric" data-p="${P}.qty" value="${esc(p.qty)}" aria-label="Количество"></span>
      <span class="kit-cost"><input type="text" inputmode="decimal" data-kitcost="${i}.${j}" value="${esc(ct)}" placeholder="${by==='asm' ? 'в цене сборки' : 'цена из счёта'}" aria-label="Закупка за единицу"><select data-kitcur="${i}.${j}" aria-label="Валюта закупки">${DEAL_CURS.map(c=>`<option${(p.costCur||'RUB')===c ? ' selected' : ''}>${c}</option>`).join('')}</select></span>
      <span class="kt-s"><input type="text" list="kitSupL" data-p="${P}.sup" value="${esc(p.sup||'')}" placeholder="${esc(asmSup ? 'сборщик: '+asmSup : by==='asm' ? 'сборщик' : 'производитель или поставщик')}" aria-label="Поставщик"></span>
      <span class="kt-a"><button class="icon" type="button" data-a="kitOpen" data-i="${i}" data-j="${j}" aria-expanded="${open}" title="${open ? 'Свернуть' : 'Описание, характеристики, фото, рисунок для чертежа'}">${open ? '▾' : '▸'}</button>
        ${KitNeed.canSwap(p) ? `<button class="icon" type="button" data-a="kitSwap" data-i="${i}" data-j="${j}" title="Заменить: окно каталога с фильтрами по требованиям станции" aria-label="Заменить из каталога">⇄</button>` : ''}
        <button class="icon" type="button" data-a="kitMv" data-i="${i}" data-j="${j}" data-d="-1" ${j ? '' : 'disabled'} aria-label="Выше">↑</button><button class="icon" type="button" data-a="kitMv" data-i="${i}" data-j="${j}" data-d="1" ${j<last ? '' : 'disabled'} aria-label="Ниже">↓</button>
        <button class="icon" type="button" data-a="kitDel" data-i="${i}" data-j="${j}" aria-label="Убрать элемент">✕</button></span>
      ${open ? this.details(x, i, p, j, by) : ''}</div>`;
  }

  /** строка под названием: вид (если его нет в названии) и главные характеристики из каталога («12,6 м³/мин · 8 бар · 75 кВт») */
  static sub(p, kind){
    const nm=String(p.name||'').toLowerCase(), lab=kind && StationEquip.LABEL[kind] && !nm.includes(StationEquip.LABEL[kind].toLowerCase().slice(0, 5)) ? StationEquip.LABEL[kind] : '';
    const sup=typeof StationSup!=='undefined' ? StationSup.label(p) : '', t=[lab, p.attrs && p.attrs.cat ? mainLine(p, 3) : '', sup ? 'поставщик: '+sup : ''].filter(Boolean).join(' · ');
    return t ? `<small class="muted kt-sub">${esc(t)}</small>` : '';
  }

  /** бак без своих габаритов: габариты по расчётному объёму (TankSize) — строкой под характеристиками */
  static tankSize(p, kind){
    if (kind!=='tank' || StationEquip.dims(p, kind).known) return '';
    const v=TankSize.vol(p), d=TankSize.of(v||1000);
    return `<small class="muted kd-tank">Габариты по объёму${v ? ' '+StationLayout.n(v)+' л' : ''}: ${esc(TankSize.text(d))} — прямоугольный, стенка ${StationMatrix.tank().wall} мм (требует подтверждения изготовителем). Свои — строкой «Габариты».</small>`;
  }
  /** подробности элемента: сторона поставки, описание, характеристики, фото, рисунок для чертежа, поля обвязки и шкафа */
  static details(x, i, p, j, by){
    const P=`items.${i}.kit.parts.${j}`, rows=p.rows||[], kind=StationEquip.kindOf(p), drawn=!/^(skip|piping|chassis|container|)$/.test(kind);
    const seg=`<span class="seg" role="group" aria-label="Кто поставляет">${['our', 'asm'].map(v=>`<button type="button" class="${v===by ? 'on' : ''}" data-a="kitBy" data-i="${i}" data-j="${j}" data-by="${v}" aria-pressed="${v===by}">${v==='our' ? 'наше' : 'сборщик'}</button>`).join('')}</span>`;
    return `<div class="kt-d">
      <div class="kd-top"><span class="muted">Поставка:</span>${seg}<button class="btn ghost sm" type="button" data-a="aiPart" data-i="${i}" data-j="${j}" title="Описание и характеристики элемента — с помощью любого ИИ">✨ ИИ</button></div>
      ${KitPipe.fields(p, i, j)}${KitCabinet.fields(p, i, j)}
      <div class="kd-g">
        <div class="kd-ph"><span class="muted">Фото</span><div class="kit-ph${p.photo && p.photo.src ? ' has' : ''}">${p.photo && p.photo.src ? `<img src="${esc(p.photo.src)}" alt="${esc(p.name||'Фото элемента')}"><button class="icon x" type="button" data-a="kitPhotoDel" data-i="${i}" data-j="${j}" aria-label="Убрать фото">✕</button>` : `<button type="button" class="kit-phb" data-a="kitPhoto" data-i="${i}" data-j="${j}">+ фото</button>`}</div></div>
        <label class="f kit-desc"><span>Техническое описание${p.catId ? ' <small class="muted">из каталога</small>' : ''}</span><textarea rows="3" data-p="${P}.desc" placeholder="Назначение, конструкция, комплектация — попадёт в КП">${esc(p.desc||'')}</textarea></label></div>
      <div class="kd-rows"><span class="muted">Характеристики — таблица в КП${rows.length ? '' : ' (габариты, масса и цвет нужны для компоновки)'}</span>${KitView.tankSize(p, kind)}
        ${rows.map((r, k)=>`<div class="kit-row"><input type="text" data-p="${P}.rows.${k}.k" value="${esc(r.k)}" placeholder="Параметр">${DimRow.is('', r.k) ? DimRow.html(`data-p="${P}.rows.${k}.v"`, r) : `<input type="text" data-p="${P}.rows.${k}.v" value="${esc(r.v)}" placeholder="Значение">`}<button class="icon" type="button" data-a="kitRowDel" data-i="${i}" data-j="${j}" data-k="${k}" aria-label="Удалить строку">✕</button></div>`).join('')}
        <button class="btn ghost sm" type="button" data-a="kitRowAdd" data-i="${i}" data-j="${j}">+ строка</button></div>
      ${drawn ? DrawPic.fields(p, i, j) : ''}</div>`;
  }

  /** итог закупки и переход к компоновке */
  static sum(x, i){
    const parts=kitParts(x); if (!parts.length) return '';
    const cost=kitCost(x), miss=parts.filter(p=>!p.cost && (p.role==='container' || KitScope.of(p)==='our'));
    const plan=StationUi.on(x) && kitContainer(x) ? StationUi.plan(x) : null;
    const lay=plan && plan.level!=='none' ? (plan.level==='error' ? ['bad', plan.assumed ? '✕ Компоновка: проверьте габариты' : '✕ Не помещается в контейнер'] : plan.level==='warn' ? ['warn', '⚠ Компоновка — есть замечания'] : ['on', '✓ Помещается']) : null;
    return `<div class="kit-sum"><span>Закупка изделия${parts.some(p=>p.costCur && p.costCur!=='RUB') ? ' (по курсам КП)' : ''}</span><b>${Number.isFinite(cost) ? money(cost)+' ₽' : 'нет курса валюты — укажите в шаге «Цены»'}</b>
      ${lay ? `<button type="button" class="chip sm ${lay[0]}" data-edtab="layout">${lay[1]} → компоновка</button>` : ''}
      <button class="btn ghost sm" type="button" data-a="tzOut" data-i="${i}">Скачать ТЗ на сборку</button>
      ${miss.length ? `<small class="warn-t">не указана закупка: ${miss.map(p=>esc(p.name||'без названия')).join(', ')}</small>` : ''}</div>`;
  }

  /** действия вкладки (data-a); true — перерисовать */
  static act(a, i, b){
    const it=S.items[i]; if (!it) return false; const P=kitParts(it), p=P[+b.dataset.j];
    if (a==='kitOpen' && p){ if (this.open.has(p.id)) this.open.delete(p.id); else this.open.add(p.id); renderEditor(); return 'async'; }
    if (a==='kitBy' && p){ p.by=b.dataset.by==='our' ? 'our' : 'asm'; if (p.by===KitScope.def(p)) delete p.by; kitSync(it); return true; }
    if (a==='reqPickX'){ delete StationReq.ensure(it).pick; persist(); renderEditor(); return 'async'; }
    if (a==='reqReset'){ ExpertLog.reset(it, String(b.dataset.k||'').split(',')); StationUi.cache.delete(it.id); persist(); renderEditor(); return 'async'; }
    if (a==='kitNeed' || a==='kitNeedAll' || a==='kitSwap') return KitNeed.act(a, i, b);
    return false;
  }
}

// ---------------------------------------------------------------- свой рисунок модели для габаритного чертежа
// Вид спереди и сверху (PNG или JPEG, без полей — обрезаются сами): на чертеже вписывается в габарит элемента вместо
// автоматического рисунка. Хранится у элемента станции (p.draw) и у позиции каталога (doc.draw) — переходит в состав.
class DrawPic {
  static VIEWS = [['front', 'спереди'], ['top', 'сверху']];
  static cache = new Map();      // src → data:URL (картинка внутрь SVG чертежа — только data:)
  static fields(p, i, j){
    const d=p.draw||{};
    return `<div class="kd-draw"><span class="muted">Рисунок модели для габаритного чертежа${tip('Свой рисунок изделия (вид спереди и сверху, PNG или JPEG). На чертеже он вписывается в габарит элемента вместо автоматического. Удобно завести один раз в карточке позиции каталога — тогда он придёт в состав сам.')}</span>
      <div class="kd-dv">${this.VIEWS.map(([v, l])=>`<div class="kd-pic">${d[v] && d[v].src ? `<img src="${esc(d[v].src)}" alt="Рисунок для чертежа — ${l}"><button class="icon x" type="button" data-a="drawDel" data-i="${i}" data-j="${j}" data-v="${v}" aria-label="Убрать рисунок ${l}">✕</button>` : `<button type="button" class="kit-phb" data-a="drawPick" data-i="${i}" data-j="${j}" data-v="${v}">+ ${l}</button>`}<small>${l}</small></div>`).join('')}</div></div>`;
  }
  static DRAWN = /^(compressor|dryer|receiver|filter|dgu|pump|cabinet|tank)$/;
  /** карточка позиции (КП или каталог): оборудование, которое рисуется на чертеже станции, — свой рисунок модели */
  static forItem(x, i){
    if (stationOf(x) || !this.DRAWN.test(StationEquip.kindOf(x)||'')) return '';
    return `<div class="ed-sec">${this.fields(x, i, -1)}<p class="muted kd-hint">Попадёт в состав станции вместе с позицией: на габаритном чертеже — вместо рисунка программы.</p></div>`;
  }
  /** сохранение: рисунки data:… — файлами на сервер (как фото), в данных — адреса /img/… */
  static async upload(draw, owner, name){
    const out={ ...draw };
    for (const [v, l] of this.VIEWS) if (out[v] && out[v].src){ const was=out[v].src; out[v]=await ImgUpload.put(out[v], imgPlace(owner, 'gallery', { caption:(name ? name+' — ' : '')+'рисунок для чертежа, '+l }));
      if (out[v].src!==was && was.startsWith('data:')) this.cache.set(out[v].src, was); }   // для чертежа — тот же рисунок без повторной загрузки
    return out;
  }
  /** есть рисунки, ещё не загруженные для чертежа */
  static pending(x){ return kitParts(x).some(p=>this.VIEWS.some(([v])=>{ const s=p.draw && p.draw[v] && p.draw[v].src; return s && !this.cache.has(s) && !s.startsWith('data:'); })); }
  /** выбрать файл рисунка: элемент станции (j>=0) или позиция в карточке (j<0) */
  static pick(i, j, v){
    const f=$('#filePick'); f.value=''; f.multiple=false; f.accept='image/png,image/jpeg,image/webp';
    f.onchange=async ()=>{ const fl=f.files[0]; f.accept=''; if (!fl) return;
      try{ const im=await prepGallery(fl), it=S.items[i], tg=j>=0 ? kitParts(it)[j] : it; if (!tg) return;
        tg.draw={ ...(tg.draw||{}), [v]:im }; if (j>=0) StationUi.cache.delete(it.id); renderForm(); persist(); }
      catch(e){ toast('Не удалось открыть изображение'); } };
    f.click();
  }
  static del(i, j, v){ const it=S.items[i], tg=j>=0 ? kitParts(it)[j] : it; if (!tg || !tg.draw) return; delete tg.draw[v]; if (!Object.keys(tg.draw).length) delete tg.draw; if (j>=0) StationUi.cache.delete(it.id); }
  /** все рисунки станции — в data:URL (для SVG чертежа); true — что-то загрузилось */
  static async load(x){
    let ch=false;
    for (const p of kitParts(x)) for (const [v] of this.VIEWS){ const s=p.draw && p.draw[v] && p.draw[v].src; if (!s || this.cache.has(s)) continue;
      if (s.startsWith('data:')){ this.cache.set(s, s); continue; }
      try{ const b=await (await fetch(s)).blob(); this.cache.set(s, await new Promise((ok, no)=>{ const r=new FileReader(); r.onload=()=>ok(r.result); r.onerror=no; r.readAsDataURL(b); })); ch=true; }
      catch(e){ this.cache.set(s, ''); } }
    return ch;
  }
  static data(src){ return src ? (src.startsWith('data:') ? src : this.cache.get(src)||'') : ''; }
}

document.addEventListener('change', e=>{ const t=e.target; if (t && t.dataset && t.dataset.req!=null) StationReq.change(t); });

// ---- окраска контейнера в «Крыша, пол, окраска» (StationPaint): на один цвет — одно окно (каркас, стены, крыша, пол, двери и
// ворота), «Окраска по буклету заказчика» с файлом, рисунки заказчика на стенах (картинка, стена, место, ширина). Файлы —
// сразу на сервер отдела (data/img), в КП — ссылка.
class PaintView {
  static RAL = ['1015', '1018', '2004', '3000', '3020', '5002', '5005', '5010', '5015', '6005', '6018', '6029', '7004', '7016', '7024', '7035', '7040', '8017', '9003', '9005', '9006', '9010', '9016'];

  static html(p, i, j){
    const o=StationPaint.of(p), sea=StationGeo.SEA[p.ctype], id=`ralL${i}_${j}`, at=`data-i="${i}" data-j="${j}"`;
    const field=([k, name, ph])=>{ if (k==='roof' && sea) return ''; const hx=StationPaint.hex(o[k]);
      return `<label class="f"><span>${esc(name)}</span><span class="kc-ral"><i class="kc-sw${hx ? '' : ' none'}"${hx ? ` style="background:${esc(hx)}"` : ''}></i><input type="text" data-kitpaint="${i}.${j}" data-k="${k}" value="${esc(o[k])}" placeholder="${esc(ph)}" list="${id}" maxlength="60" aria-label="${esc(name)}"></span></label>`; };
    const f=p.paintFile, book=StationPaint.book(p);
    const arts=StationPaint.arts(p), opt=(L, v)=>L.map(([x, t])=>`<option value="${x}"${Math.abs(x-v)<0.01 ? ' selected' : ''}>${esc(t)}</option>`).join('');
    const near=(L, v)=>L.reduce((b, q)=>Math.abs(q[0]-v)<Math.abs(b[0]-v) ? q : b)[0];
    return `<div class="kc-g kc-paints">${StationPaint.PARTS.map(field).join('')}</div>
      <datalist id="${id}">${this.RAL.map(c=>`<option value="RAL ${c}">`).join('')}</datalist>
      <div class="kc-book"><label class="stl-chk"><input type="checkbox" data-kitbook="${i}.${j}"${book ? ' checked' : ''}> Окраска по буклету заказчика</label>${tip('В КП — строка «Окраска — по буклету цветовых решений заказчика». Файл буклета (PDF или картинка) уходит в ТЗ на сборку. Цвета выше — для 3D-вида и как ориентир сборщику.')}
        ${book ? (f && f.src ? `<a href="${esc(f.src)}" target="_blank" rel="noopener">📎 ${esc(f.name||'буклет')}</a> <button type="button" class="lnk" data-a="paintFileDel" ${at}>убрать</button>`
          : `<button type="button" class="btn sm" data-a="paintFile" ${at}>Файл буклета — PDF или картинка</button>`) : ''}</div>
      <div class="kc-arts">${arts.map((a, k)=>`<div class="kc-art"><img src="${esc(a.src)}" alt="" loading="lazy">
          <select data-kitart="${i}.${j}.${k}" data-k="wall" aria-label="Стена">${Object.entries(StationPaint.WALLS).map(([w, t])=>`<option value="${w}"${w===a.wall ? ' selected' : ''}>${esc(t)}</option>`).join('')}</select>
          <select data-kitart="${i}.${j}.${k}" data-k="x" aria-label="Место по длине">${opt(StationPaint.ALONG, near(StationPaint.ALONG, a.x))}</select>
          <select data-kitart="${i}.${j}.${k}" data-k="z" aria-label="Место по высоте">${opt(StationPaint.HIGH, near(StationPaint.HIGH, a.z))}</select>
          <label class="kc-artw"><input type="text" inputmode="numeric" data-kitart="${i}.${j}.${k}" data-k="w" value="${a.w}" aria-label="Ширина рисунка, мм"> мм</label>
          <button type="button" class="lnk" data-a="paintArtDel" ${at} data-k="${k}" title="Убрать рисунок" aria-label="Убрать рисунок">✕</button></div>`).join('')}
        ${arts.length<StationPaint.ART_MAX ? `<span class="kc-book"><button type="button" class="btn sm ghost" data-a="paintArt" ${at}>+ Рисунок заказчика на стене</button>${tip('Картинка (PNG с прозрачностью, JPEG) — на выбранной стене снаружи: видна на 3D-виде и видах снаружи, в ТЗ на сборку — с местом и размером.')}</span>` : ''}</div>`;
  }

  /** окно окраски, место или размер рисунка изменены */
  static change(t){
    const [i, j, k]=String(t.dataset.kitpaint || t.dataset.kitbook || t.dataset.kitart).split('.').map(Number), it=S.items[i], p=kitParts(it)[j]; if (!p) return;
    if (t.dataset.kitpaint!=null) StationPaint.set(p, t.dataset.k, t.value);
    else if (t.dataset.kitbook!=null) p.paintBook=t.checked;
    else { const a=(p.art||[])[k]; if (!a) return; const f=t.dataset.k;
      if (f==='wall' && StationPaint.WALLS[t.value]) a.wall=t.value;
      else if (f==='x' || f==='z') a[f]=StationPaint.frac(+t.value, 0.5);
      else if (f==='w'){ const n=Math.round(dNum(t.value)); if (n>=100 && n<=12000) a.w=n; else toast('Ширина рисунка — от 100 до 12 000 мм'); } }
    contApply(p); StationUi.cache.delete(it.id); renderForm(); persist();
  }

  /** кнопки: файл буклета, рисунок заказчика — загрузить или убрать */
  static act(a, i, b){
    const it=S.items[i], p=kitParts(it)[+b.dataset.j]; if (!p) return false;
    const done=()=>{ contApply(p); StationUi.cache.delete(it.id); renderForm(); persist(); };
    if (a==='paintFileDel'){ delete p.paintFile; return true; }
    if (a==='paintArtDel'){ (p.art||[]).splice(+b.dataset.k, 1); if (p.art && !p.art.length) delete p.art; StationUi.cache.delete(it.id); return true; }
    const book=a==='paintFile', f=$('#filePick'); f.value=''; f.multiple=false; f.accept=book ? 'application/pdf,image/png,image/jpeg,image/webp' : 'image/png,image/jpeg,image/webp';
    f.onchange=async ()=>{ const fl=f.files[0]; f.accept=''; if (!fl) return;
      try{ toast('Загружаю «'+fl.name+'»…');
        if (book){ const pdf=/pdf$/i.test(fl.type) || /\.pdf$/i.test(fl.name);
          const src=pdf ? '/img/'+(await api('/api/img?'+this.q(it, 'booklet', fl.name), { method:'POST', body:fl })).name : (await this.upload(fl, it, 'буклет окраски')).src;
          p.paintFile={ src, name:String(fl.name).slice(0, 120), pdf }; }
        else { const im=await this.upload(fl, it, 'рисунок заказчика'); (p.art=p.art||[]).push({ src:im.src, name:String(fl.name).slice(0, 120), wall:'front', x:0.5, z:0.5, w:1500, ar:im.ar }); }
        done(); }
      catch(e){ toast('Не удалось загрузить файл: '+(e && e.message || e)); } };
    f.click(); return 'async';
  }
  static q(it, kind, caption){ return Object.entries({ ...imgPlace(it, kind, { caption }), ext:'pdf' }).map(([k, v])=>k+'='+encodeURIComponent(v||'')).join('&'); }
  /** картинка: не больше 2000 точек, прозрачность сохраняется (PNG) → на сервер; ar — ширина / высота */
  static async upload(file, it, caption){
    const url=await fileToURL(file), im=await readImg(url), sc=Math.min(1, 2000/Math.max(im.width, im.height)), w=Math.max(1, Math.round(im.width*sc)), h=Math.max(1, Math.round(im.height*sc));
    const c=document.createElement('canvas'); c.width=w; c.height=h; c.getContext('2d').drawImage(im, 0, 0, w, h);
    const png=/png|webp/i.test(file.type), r=await ImgUpload.put({ src:c.toDataURL(png ? 'image/png' : 'image/jpeg', 0.9) }, imgPlace(it, 'gallery', { caption }));
    return { src:r.src, ar:w/h };
  }
}
