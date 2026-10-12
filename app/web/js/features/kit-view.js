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
  static num(v){ const n=parseFloat(String(v??'').replace(/\s+/g, '').replace(',', '.')); return Number.isFinite(n) ? n : null; }
  /** ресивер — после подготовки воздуха (так чаще), до осушителя или до и после */
  static RECV = [['after', 'после осушителя'], ['before', 'до осушителя'], ['both', 'до и после']];
  static recv(x){ const v=this.of(x).recv; return v==='before' || v==='both' ? v : 'after'; }
  static recvOut(x){ return !!this.of(x).recvOut; }
  /** категория помещения по СП 12.13130.2009: своя или ориентировочная по виду станции (уточняется расчётом) */
  static fire(x){ const f=this.of(x).fire; return this.FIRE.includes(f) ? f : this.fireDef(x); }
  static fireDef(x){ return { comp:'В4', dgu:'В1', pump:'Д' }[this.kind(x)] || 'Д'; }
  /** допустимый уровень звука на рабочем месте, дБА (СанПиН 1.2.3685-21 — 80) */
  static noise(x){ const n=this.num(this.of(x).noise); return n>0 ? n : 80; }
  /** для расстановки, проверок и чертежа: вид станции, категория (своя или ориентировочная), шум, наружный воздух, °C */
  static plan(x){
    const r=this.of(x), t=v=>this.num(String(v??'').replace(/[−–]/g, '-').replace(/^\+/, ''));
    return { kind:this.kind(x), fire:this.fire(x), fireAuto:!this.FIRE.includes(r.fire), noise:this.noise(x), tmin:t(r.tmin), tmax:t(r.tmax), res:Math.max(0, Math.round(this.num(r.reserve)||0)) };
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
    if (k==='comp' && r.oilFree){ const U=units('compressor'), bad=U.filter(p=>!TzPick.oilFree(p)).length;
      if (U.length) out.push({ ok:!bad, text:bad ? 'компрессор не безмасляный — по ТЗ класс 0 по маслу' : 'компрессоры безмасляные' }); }
    if (r.ats && !P.some(p=>this.ATS.test(String(p.name||'')))) out.push({ ok:false, text:'нет шкафа АВР — по ТЗ два ввода питания' });
    if (r.scada && !P.some(p=>this.SCADA.test(String(p.name||'')))) out.push({ ok:false, text:'нет шкафа АСУ ТП — по ТЗ диспетчеризация' });
    if (k==='dgu'){ const U=units('dgu'), kw=U.map(p=>StationEquip.num((p.attrs||{}).kw)||0), need=this.num(r.kw), h=this.num(r.hours);
      if (need>0) out.push(enough(kw, need, 'мощность', 'кВт'));
      // работа от бака: топливо в баках станции (и в баке ДГУ, если указан) при нагрузке 75 % рабочих ДГУ
      const work=[...kw].sort((a, b)=>b-a).slice(res).reduce((a, b)=>a+b, 0), fuel=P.filter(p=>StationEquip.kindOf(p)==='tank' || StationEquip.kindOf(p)==='dgu')
        .reduce((s, p)=>s+(StationEquip.kindOf(p)==='tank' ? AirChain.volume(p)||StationEquip.num((p.attrs||{}).tank)||0 : StationEquip.num((p.attrs||{}).tank)||0)*Math.max(1, +p.qty||1), 0);
      const fp=h>0 && typeof GensetSizing!=='undefined' && StationRules.ok() ? GensetSizing.plan(x) : null;   // как в расчётной записке
      if (fp){ const t=fp.have/(fp.c*fp.n*StationRules.raw('dgu.fuel_margin')), ok=fp.have>=fp.need*0.98;
        out.push({ ok, text:ok ? `работа от баков ≈ ${n(Math.floor(t))} ч при нагрузке ${Math.round(fp.x*100)} % (с запасом) — не меньше ${n(h)}` : `работа от баков ≈ ${n(Math.floor(t))} ч — меньше ${n(h)}: нужно топлива ${n(Math.ceil(fp.need))} л, в баках ${n(fp.have)}` }); }
      else if (h>0 && work>0 && fuel>0){ const t=fuel/(work*0.75*StationDefaults.LPH);
        out.push({ ok:t>=h*0.98, text:t>=h*0.98 ? `работа от бака ≈ ${n(Math.floor(t))} ч при нагрузке 75 % — не меньше ${n(h)}` : `работа от бака ≈ ${n(Math.floor(t))} ч — меньше ${n(h)}: нужен бак около ${StationDefaults.tank(work, h)} л` }); } }
    if (k==='pump'){ const U=units('pump'), q=U.map(p=>StationEquip.num((p.attrs||{}).flow)||0), need=this.num(r.q), head=this.num(r.head);
      if (need>0) out.push(enough(q, need, 'подача', 'м³/ч'));
      if (head>0){ const hm=Math.max(0, ...U.map(p=>StationEquip.num((p.attrs||{}).head)||0)); if (hm) out.push({ ok:hm>=head, text:`напор ${n(hm)} м — ${hm>=head ? 'не меньше' : 'меньше'} ${n(head)}` }); } }
    return out;
  }

  /** требуемая производительность компрессоров, м³/мин FAD: потребность из ТЗ (нормальные м³ — к условиям всасывания на
   *  высоте и при влажности, AirDemand) с запасом из ТЗ; {v, why} */
  static need(r, q){
    const t=v=>this.num(String(v??'').replace(/[−–]/g, '-').replace(/^\+/, '')), why=[]; let v=q;
    if (r.basis==='normal' && typeof AirDemand!=='undefined'){ const tm=t(r.tmax), rh=t(r.rh); v=AirDemand.fad(q, t(r.alt)||0, tm!=null ? tm : StationRules.raw('flow.fad_ref').t, rh!=null ? rh : 100); why.push('н. м³ → FAD'); }
    const m=t(r.margin); if (m>0){ v*=1+m/100; why.push('запас '+String(m).replace('.', ',')+' %'); }
    return { v, why:why.join(', ') };
  }
  static BASIS = [['fad', 'к условиям всасывания (FAD, ISO 1217)'], ['normal', 'к нормальным условиям (н. м³: 0 °C, 101,3 кПа)']];
  static MODE = [['prime', 'основной источник (PRP)'], ['standby', 'резервный — до 200 ч в год (ESP)']];
  static START = [['', 'не указан'], ['direct', 'прямой'], ['stardelta', 'звезда — треугольник'], ['soft', 'плавный пуск'], ['vsd', 'частотный преобразователь']];

  /** потери давления в подготовке воздуха, бар (оценка): осушитель и ступени фильтров по ходу воздуха */
  static loss(P){ const k=P.map(p=>StationEquip.kindOf(p)); return Math.round(((k.includes('dryer') ? this.LOSS.dryer : 0)+this.LOSS.filter*Math.min(4, k.filter(z=>z==='filter').length))*100)/100; }

  /** короткая строка требований для заголовка блока */
  static line(x){
    const r=this.of(x), k=this.kind(x), u=(v, s)=>v ? `${String(v).replace('.', ',')} ${s}` : '', cls=StationUi.opts(x).air;
    const main=k==='comp' ? [u(r.flow, r.basis==='normal' ? 'н. м³/мин' : 'м³/мин'), u(r.pressure, 'бар'), cls ? 'класс '+cls : '', this.num(r.margin)>0 ? 'запас '+u(r.margin, '%') : '']
      : k==='dgu' ? [u(r.kw, 'кВт'), r.mode==='standby' ? 'резервный (ESP)' : '', this.num(r.load)>0 ? 'средняя нагрузка '+u(r.load, '%') : ''] : k==='pump' ? [u(r.q, 'м³/ч'), u(r.head, 'м')] : [];
    const t=[r.tmin!=null && r.tmin!=='' ? `от ${r.tmin} °C` : '', r.tmax!=null && r.tmax!=='' ? `до ${r.tmax} °C` : ''].filter(Boolean).join(' ');
    const w=this.num(r.work), rs=this.num(r.reserve);
    const opt=[r.oilFree && k==='comp' ? 'безмасляный' : '', r.vsd && k!=='dgu' ? 'частотное регулирование' : '', r.ats ? 'два ввода с АВР' : '', r.scada ? 'диспетчеризация' : ''];
    return [...main, w>0 ? `${w} раб.${rs>0 ? ' + '+rs+' рез.' : ''}` : rs>0 ? 'резерв N+'+rs : '', t, this.num(r.alt)>0 ? u(r.alt, 'м над уровнем моря') : '', ...opt, r.src && r.src.name ? 'по ТЗ «'+r.src.name+'»' : ''].filter(Boolean).join(' · ');
  }

  /** «Все требования, условия расчёта и проверки» — под раскрывающимся блоком «Подбора станции» (StationQuick): проверки
   *  состава, итог подбора, остальные требования ТЗ (главные — в «Подборе станции»), условия расчёта, особые требования */
  static details(x, i){
    const r=this.of(x), k=this.kind(x), P=`items.${i}.req`, ck=this.checks(x);
    const fld=(key, label, ph, mode='decimal')=>`<label class="f"><span>${label}</span><input type="text" inputmode="${mode}" data-p="${P}.${key}" data-req="${i}" value="${esc(r[key]??'')}" placeholder="${esc(ph||'')}" autocomplete="off"></label>`;
    const sel=(key, label, list, cur)=>`<label class="f"><span>${label}</span><select data-req="${i}" data-rk="${key}">${list.map(([v, l])=>`<option value="${esc(v)}"${String(cur)===String(v) ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select></label>`;
    const head=`${ck.length ? `<div class="kr-ck">${ck.map(c=>`<span class="chip sm ${c.ok ? 'on' : 'warn'}">${c.ok ? '✓' : '⚠'} ${esc(c.text)}</span>`).join('')}</div>` : ''}
      ${r.pick ? `<p class="kr-pick"><span>${esc(r.pick)}</span><button class="icon sm" type="button" data-a="reqPickX" data-i="${i}" title="Скрыть" aria-label="Скрыть итог подбора">✕</button></p>` : ''}`;
    const main=k==='comp' ? sel('recv', 'Ресивер', this.RECV, this.recv(x))+fld('recvVol', 'Ресивер по ТЗ, л', 'по расчёту', 'numeric') : '';
    return `<div class="kit-req open">${head}
      <div class="kr-g">${main}${sel('work', 'Рабочих агрегатов', this.WORK, r.work||'')}
        ${fld('tmin', 'Наружный воздух от, °C', '−45', 'text')}${fld('tmax', 'до, °C', '+40', 'text')}
        ${sel('fire', 'Категория помещения (СП 12.13130)', this.FIRE.map(f=>[f, f+(f===this.fireDef(x) ? ' (ориент.)' : '')]), this.fire(x))}
        ${fld('noise', 'Шум на рабочем месте, не более дБА', '80', 'numeric')}</div>
      ${k==='comp' || k==='dgu' ? `<details class="kr-calc"${Spoiler.attr('cond:'+x.id)}><summary>Условия для расчёта станции</summary><div class="kr-g">${k==='comp'
        ? sel('basis', 'Производительность приведена', this.BASIS, r.basis||'fad')+fld('margin', 'Запас производительности, %', '0 — по ТЗ')+fld('alt', 'Высота над уровнем моря, м', '0', 'numeric')
          +fld('rh', 'Влажность воздуха, % (для н. м³)', '100 — с запасом', 'numeric')+fld('tin', 'Воздух на входе в осушитель, °C', 'по расчёту', 'text')
        : fld('load', 'Средняя нагрузка за сутки, %', '100')+fld('motor', 'Наибольший двигатель нагрузки, кВт', '—')
          +sel('start', 'Пуск этого двигателя', this.START, r.start||'')+fld('alt', 'Высота над уровнем моря, м', '0', 'numeric')}</div>
        <p class="muted kr-hint">Не заданы — расчёт берёт значения с запасом в пользу заказчика; они перечислены в «Расчёте станции» (вкладка «Компоновка»).</p></details>` : ''}
      ${k==='comp' ? `<label class="chk kr-out"><input type="checkbox" data-req="${i}" data-rk="recvOut"${this.recvOut(x) ? ' checked' : ''}> Ресивер после подготовки — снаружи, на площадке у торца <span class="muted">(ФНП ОРПД, п. 65)</span></label>` : ''}
      <div class="kr-opts">${this.OPTS.filter(([, , kinds])=>kinds.includes(k)).map(([key, label])=>`<label class="chk"><input type="checkbox" data-req="${i}" data-rk="${key}"${r[key] ? ' checked' : ''}> ${esc(label)}</label>`).join('')}</div>
      <label class="chk" title="${esc(SupplyDocs.list(x).join('; '))}"><input type="checkbox" data-req="${i}" data-rk="docs"${this.docs(x) ? ' checked' : ''}> Документы при поставке — в КП <span class="muted">(паспорта, декларации ТР ТС 010, 004, 020, 032, исполнительная документация)</span></label>
      ${r.notes ? `<label class="f kr-n"><span>Прочие требования из ТЗ</span><textarea rows="3" data-p="${P}.notes" data-req="${i}">${esc(r.notes)}</textarea></label>` : ''}</div>`;
  }
  /** поле требований изменилось */
  static change(t){
    const i=+t.dataset.req, x=S.items[i]; if (!x) return; const r=this.ensure(x), k=t.dataset.rk;
    if (k) r[k]=t.type==='checkbox' ? t.checked : t.value;
    if (k==='recv' || k==='recvOut'){ StationUi.cache.delete(x.id); StationSize.apply(x, true); }
    if ((k==='ats' || k==='scada') && t.checked){ const a=this.ensureParts(x); if (a.length){ kitSync(x); StationUi.cache.delete(x.id); StationSize.apply(x, true); toast('Добавлено в состав: '+a.join(', ')); } }
    persist(); renderForm();
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
// TzPick — поправки производителя, добор количеством, ресиверы без учёта в Ростехнадзоре). «Подобрать всё недостающее» —
// одной кнопкой. Компрессор — по требованиям «Подбора станции», если они заданы.
class KitNeed {
  static n(v){ return StationReq.num(String(v??'').replace(/[−–]/g, '-').replace(/^\+/, '')); }
  /** цепочка воздуха по составу (контейнер не нужен): {q, bar, recs, …} или null (не компрессорная, нет компрессоров) */
  static air(x){
    if (StationReq.kind(x)!=='comp') return null;
    return AirChain.check(StationEquip.list(kitParts(x), { recv:StationReq.recv(x), recvOut:StationReq.recvOut(x) }), StationUi.opts(x).air);
  }
  /** компрессоры состава с характеристиками */
  static comps(x){ return StationEquip.list(kitParts(x)).filter(e=>e.kind==='compressor' && e.air); }
  /** наибольшее давление компрессоров, бар (0 — неизвестно) */
  static bar(x){ return Math.max(0, ...this.comps(x).map(e=>e.air.bar||0)); }
  /** чего не хватает (или что мало — замена): рекомендации цепочки; осушитель при уже выбранном того же вида — замена */
  static recs(x){
    const A=this.air(x); if (!A) return [];
    const rank=r=>/^dryer/.test(r.cat) ? 0 : r.cat==='filter' ? 1 : 2;   // по ходу воздуха: осушитель, фильтры, ресиверы
    return [...A.recs].sort((a, b)=>rank(a)-rank(b)).map(r=>{ if (!/^dryer-/.test(r.key) || r.replace) return r;
      const old=kitParts(x).filter(p=>attrsOf(p).cat===r.cat || (StationEquip.kindOf(p)==='dryer' && AirChain.info(p, 'dryer').type===(r.cat==='dryer_ads' ? 'ads' : 'refrig'))).map(p=>p.id);
      return old.length ? { ...r, replace:old, swap:true } : r; });
  }
  /** рекомендуемая позиция каталога по рекомендации r: {c, n — штук параллельно, twin — два ресивера (до и после осушителя)} | null */
  static best(x, r){
    const A=this.air(x), q=A ? A.q : 0, req=StationReq.of(x), B=this.n(req.pressure)||0, Bc=this.bar(x); let o=null;
    if (/^dryer-/.test(r.key)){ const ads=r.cat==='dryer_ads', pdp=ads && r.f && r.f.dewPoint ? this.n(r.f.dewPoint) : null;
      o=q>0 ? TzPick.dryer(ads, q, B, Bc, this.n(req.tmax), pdp) : null; }
    else if (r.cat==='filter') o=TzPick.filter(r, q, B, Bc);
    else if (r.cat==='receiver'){
      const big=this.comps(x).filter(e=>e.air.flow>0).reduce((m, e)=>!m || e.air.flow>m.air.flow ? e : m, null);
      const old=kitParts(x).filter(p=>(r.replace||[]).includes(p.id)).reduce((s, p)=>s+(AirChain.volume(p)||0)*Math.max(1, +p.qty||1), 0);
      const both=StationReq.recv(x)==='both' && r.key==='receiver';
      const V=this.n(req.recvVol)>0 ? this.n(req.recvVol) : r.key==='recv-split' ? old : big ? big.air.flow*(big.air.vsd ? AirChain.RECV_VSD : AirChain.RECV) : 0;
      const R=V>0 ? TzPick.receivers(both ? V/2 : V, Bc, StationReq.recvOut(x) ? 0 : TzPick.hmax(x)) : null;
      return R ? { c:R.o.c, n:R.n, twin:both } : null; }
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
    return { f:F.f, r:F.r, min:F.min, rows:r.rows, attrs:r.attrs, qty:r.qty, replace:r.replace, twin:b && b.twin,
      best:b ? { id:b.c.id, n:b.n } : null, title:r.title,
      need:`${r.swap ? 'Заменить: ' : 'Нужно: '}${r.title.charAt(0).toLowerCase()+r.title.slice(1)}${A && A.q ? ` — к компрессорам ${AirChain.m3(A.q)} м³/мин, ${AirChain.m3(A.bar)} бар` : ''}.`
        +(need.length ? ' Показаны подходящие: '+need.join(', ')+'.' : '') };
  }
  /** «+ Осушитель», «+ Фильтр», «+ Ресивер»: рекомендация этой категории (если есть) — иначе обычный подбор */
  static presetFor(x, cat){ const r=this.recs(x).find(z=>z.cat===cat && !z.swap); return r ? this.preset(x, r) : null; }
  /** компрессор по требованиям «Подбора станции» (производительность, давление у потребителя, безмасляный, частотный):
   *  показаны подходящие, рекомендуемый (тот же подбор, что у кнопки «Подобрать оборудование») — первым */
  static mainPreset(x){
    if (StationReq.kind(x)!=='comp') return null;
    const r=StationReq.of(x), q0=this.n(r.flow), B=this.n(r.pressure)||0; if (!(q0>0)) return null;
    const cls=String(StationUi.opts(x).air||''), wc=+(cls.split('.')[1]||0), ads=wc>0 && wc<=3, nd=StationReq.need(r, q0), Q=ads ? nd.v/(1-AirChain.PURGE) : nd.v;
    const cats=(stationOf(x)||{}).main||[], res=Math.max(0, Math.round(this.n(r.reserve)||0)), work=+r.work||0;
    const u=TzPick.comps(catCache.filter(c=>cats.includes(attrsOf(c).cat)), Q, B, { oilFree:!!r.oilFree, vsd:!!r.vsd, work }), n=u ? u.n : work||1;
    const per=Q/n, test=c=>TzPick.flow(c)>=per-1e-9 && (!r.oilFree || TzPick.oilFree(c));
    return { min:B>0 ? { pressure:B } : {}, test, qty:n+res, best:u ? { id:u.o.c.id, n:u.n+res, label:u.n+res>1 ? `${u.n} рабоч.${res ? ` + ${res} резерв.` : ''} = ${u.n+res} шт.` : '' } : null,
      need:`Нужно ${AirChain.m3(Q)} м³/мин${B ? ` при ${AirChain.m3(B)} бар у потребителя` : ''}${nd.why || ads ? ` (${[nd.why, ads ? 'с запасом на продувку адсорбционного осушителя' : ''].filter(Boolean).join(', ')})` : ''}${n>1 ? ` — ${n} рабочих` : ''}${res ? ` + ${res} в резерве` : ''}. Показаны компрессоры от ${AirChain.m3(per)} м³/мин${B ? `, давление от ${AirChain.m3(B)} бар` : ''}${r.oilFree ? ', безмасляные' : ''}.` };
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

  /** строки «Нужно: …» в таблице «Наше оборудование» */
  static rows(x, i){
    return this.recs(x).map(r=>{ const has=!!this.best(x, r);
      return `<div class="kt-r kt-need${r.swap ? ' swap' : ''}" role="row"><span class="kt-n" aria-hidden="true">${r.swap ? '⚠' : '+'}</span>
        <span class="kt-nw"><b>${esc((r.swap ? 'Заменить: ' : 'Нужно: ')+r.title.charAt(0).toLowerCase()+r.title.slice(1))}</b><small class="muted">${esc(r.why||'')}${has ? '' : ' · в каталоге подходящего нет — «Подобрать» откроет каталог, можно добавить своё'}</small></span>
        <span class="kt-go"><button class="btn sm${has ? ' primary' : ''}" type="button" data-a="kitNeed" data-i="${i}" data-k="${esc(r.key)}">Подобрать</button></span></div>`; }).join('');
  }
  /** кнопка «Подобрать всё недостающее» (если рекомендаций больше одной) */
  static allBtn(x, i){ const n=this.recs(x).length; return n>1 ? `<button class="btn primary sm kt-all" type="button" data-a="kitNeedAll" data-i="${i}">Подобрать всё недостающее (${n})</button>` : ''; }
  /** окно каталога по рекомендации (вкладки «Состав станции» и «Компоновка») */
  static open(i, r){ const x=S.items[i]; if (!x || !r) return; kitPickCat(i, [r.cat], null, r.name, this.preset(x, r)); }
  /** одна кнопка: по каждой рекомендации — рекомендуемый из каталога (после осушителя могут понадобиться фильтры — до 4 проходов) */
  static async fillAll(i){
    const x=S.items[i]; if (!x) return; x.kit=x.kit||{ parts:[] }; const got=[], none=[], seen=new Set();
    for (let pass=0; pass<4; pass++){ const R=this.recs(x).filter(r=>!seen.has(r.key)); if (!R.length) break;
      for (const r of R){ seen.add(r.key); const b=this.best(x, r); if (!b){ none.push(r.title.replace(/\s*\(.*?\)/g, '')); continue; }
        if (Array.isArray(r.replace)) x.kit.parts=x.kit.parts.filter(z=>!r.replace.includes(z.id));
        for (let k=0; k<(b.twin ? 2 : 1); k++){ const p=await TzPick.part(b.c, b.n); x.kit.parts.push(p); }
        got.push((b.twin ? '2 × ' : '')+(b.n>1 ? b.n+' × ' : '')+b.c.name); } }
    kitSync(x); stationFill(x); stationAutoName(x); StationUi.cache.delete(x.id); StationSize.apply(x, true); x.page=true; persist(); renderEditor(); renderForm();
    toast((got.length ? 'Добавлено: '+got.join('; ') : 'Ничего не добавлено')+(none.length ? '. В каталоге нет: '+none.join('; ')+' — добавьте вручную' : ''));
  }
  /** действия (data-a): kitNeed — окно подбора по рекомендации, kitNeedAll — всё недостающее */
  static act(a, i, b){
    const x=S.items[i]; if (!x) return false;
    if (a==='kitNeed'){ this.open(i, this.recs(x).find(r=>r.key===b.dataset.k)); return 'async'; }
    if (a==='kitNeedAll'){ this.fillAll(i); return 'async'; }
    return false;
  }
}

class KitView {
  static open = new Set();       // раскрытые строки (id элементов)
  static SYS = /отоплен|вентиляц|освещен|электроснабж|сигнализац|пожаротуш|шумо/i;   // как системы контейнера — не элементы
  static pos = new Map();        // id элемента → номер позиции на чертеже (при отрисовке вкладки)

  static render(x, i){
    const parts=kitParts(x), st=stationOf(x), t=typeById(attrsOf(x).cat);
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
      ${this.group(x, i, 'our', our, st, t)}
      ${this.group(x, i, 'asm', asm, st, t)}
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
        <label class="f"><span>Размер Д × Ш × В, мм${auto && p.sizeAuto && sz ? ' <small class="muted">по оборудованию</small>' : ''}</span><input type="text" data-kitct="${i}.${j}" data-fld="size" value="${esc(p.size||'')}" placeholder="${esc(ctypeOf(p.ctype).size)}"></label>
        ${sel('ins', CONTAINER_INS.map(v=>[v, v]), p.ins, 'Утепление')}
        ${sel('climate', CLIMATES.map(c=>[c[0], c[0]+' — до '+c[2]+' °C']), p.climate, 'Климатическое исполнение')}
        <label class="f"><span>Сборщик контейнера${tip('Кто изготавливает контейнер и собирает станцию. Элементы «Сборщика контейнера» без своего поставщика в «Экономике сделки» попадут к нему; наше оборудование едет к нему на сборку.')}</span><input type="text" list="kitSupL" data-p="${P}.sup" value="${esc(p.sup||'')}" placeholder="производитель контейнеров"></label>
        <label class="f"><span>Закупка контейнера</span><span class="kit-cost"><input type="text" inputmode="decimal" data-kitcost="${i}.${j}" value="${esc(ct)}" placeholder="цена из счёта"><select data-kitcur="${i}.${j}" aria-label="Валюта закупки">${DEAL_CURS.map(c=>`<option${(p.costCur||'RUB')===c ? ' selected' : ''}>${c}</option>`).join('')}</select></span></label></div>
      <details class="kc-more"${Spoiler.attr('cont:'+x.id)}><summary>Крыша, пол, цвет${this.look(p)}</summary><div class="kc-g">
        ${StationGeo.SEA[p.ctype] ? '' : sel('roof', Object.entries(StationGeo.ROOFS).map(([k, r])=>[k, r.deg ? `${r.name} (${r.deg}°)` : r.name]), StationGeo.roof(p), 'Крыша')}
        ${sel('floor', Object.entries(StationGeo.FLOORS).map(([k, f])=>[k, f.short]), StationGeo.floor(p), 'Пол')}
        <label class="f"><span>Цвет</span><input type="text" data-kitct="${i}.${j}" data-fld="ral" value="${esc(p.ral||'')}" placeholder="RAL 7004 / RAL 5005"></label></div></details>
      ${auto && !p.sizeAuto && sz ? `<p class="muted kit-szn">Размер задан вручную — <button type="button" class="lnk" data-a="stlAuto" data-i="${i}">подобрать по оборудованию</button></p>` : ''}
      <div class="kit-sys"><span class="muted">Системы:</span>${CONT_SYSTEMS.map(([id, k, v])=>{ const on=KitView.sysOn(x, p, id); return `<button type="button" class="chip sm${on ? ' on' : ''}" data-a="kitSys" data-i="${i}" data-j="${j}" data-sys="${id}" aria-pressed="${!!on}" title="${esc(v)}">${esc(k)}</button>`; }).join('')}</div></div>`;
  }

  /** выбранное исполнение коротко — в заголовке свёрнутого блока: «: скатная · сталь чёрная · RAL 7004» */
  static look(p){
    const r=StationGeo.SEA[p.ctype] ? null : StationGeo.ROOFS[StationGeo.roof(p)], f=StationGeo.FLOORS[StationGeo.floor(p)];
    const t=[r && 'крыша '+r.name, f && 'пол — '+f.short, String(p.ral||'').trim()].filter(Boolean).join(' · ');
    return t ? ` <span class="muted">(${esc(t)})</span>` : '';
  }

  /** система контейнера включена: своё значение, иначе по умолчанию (рекуперация — у компрессорных и ДГУ, насосы почти не греют) */
  static sysOn(x, p, id){ const v=(p.sys||{})[id]; return v ?? (id==='rec' ? StationReq.kind(x)!=='pump' : !!CONT_SYS_DEF[id]); }

  /** группа элементов: таблица строк и кнопки добавления */
  static group(x, i, by, idx, st, t){
    const presets=(st ? st.parts : KIT_PRESETS).map(z=>Array.isArray(z) ? z : [z, '']), have=new Set(kitParts(x).map(p=>norm(p.name)));
    const kinds=new Set(kitParts(x).map(p=>StationEquip.kindOf(p)).filter(k=>k==='dryer' || k==='receiver'));   // уже есть — не предлагать
    // «Нужно: …» — чего не хватает к выбранным компрессорам (KitNeed); кнопки этих категорий не дублируем
    const need=by==='our' ? KitNeed.rows(x, i) : '', needCats=new Set(by==='our' ? KitNeed.recs(x).map(r=>r.cat) : []);
    const mine=presets.filter(([n, c])=>!have.has(norm(n)) && KitScope.def({ name:n, attrs:{ cat:c } })===by && !KitView.SYS.test(n) && !kinds.has(StationEquip.kindOf({ name:n, attrs:{ cat:c } })) && !needCats.has(c));   // системы — кнопками у контейнера
    const lead=by==='our' ? 'привозим на сборку сами' : 'шкафы, трубопровод, обвязка, системы безопасности — по ТЗ на сборку';
    return `<section class="kit-grp ${by}"><h4>${KitScope.LABEL[by]} <small class="muted">— ${lead}</small></h4>
      ${idx.length || need ? `<div class="kit-t" role="table">
        ${idx.length ? `<div class="kt-r kt-h" role="row"><span title="Номер позиции на габаритном чертеже">Поз.</span><span>Наименование</span><span>Кол.</span><span>Закупка за ед.</span><span>Поставщик</span><span></span></div>` : ''}
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
        <button class="icon" type="button" data-a="kitMv" data-i="${i}" data-j="${j}" data-d="-1" ${j ? '' : 'disabled'} aria-label="Выше">↑</button><button class="icon" type="button" data-a="kitMv" data-i="${i}" data-j="${j}" data-d="1" ${j<last ? '' : 'disabled'} aria-label="Ниже">↓</button>
        <button class="icon" type="button" data-a="kitDel" data-i="${i}" data-j="${j}" aria-label="Убрать элемент">✕</button></span>
      ${open ? this.details(x, i, p, j, by) : ''}</div>`;
  }

  /** строка под названием: вид (если его нет в названии) и главные характеристики из каталога («12,6 м³/мин · 8 бар · 75 кВт») */
  static sub(p, kind){
    const nm=String(p.name||'').toLowerCase(), lab=kind && StationEquip.LABEL[kind] && !nm.includes(StationEquip.LABEL[kind].toLowerCase().slice(0, 5)) ? StationEquip.LABEL[kind] : '';
    const t=[lab, p.attrs && p.attrs.cat ? mainLine(p, 3) : ''].filter(Boolean).join(' · ');
    return t ? `<small class="muted kt-sub">${esc(t)}</small>` : '';
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
      <div class="kd-rows"><span class="muted">Характеристики — таблица в КП${rows.length ? '' : ' (габариты, масса и цвет нужны для компоновки)'}</span>
        ${rows.map((r, k)=>`<div class="kit-row"><input type="text" data-p="${P}.rows.${k}.k" value="${esc(r.k)}" placeholder="Параметр"><input type="text" data-p="${P}.rows.${k}.v" value="${esc(r.v)}" placeholder="Значение"><button class="icon" type="button" data-a="kitRowDel" data-i="${i}" data-j="${j}" data-k="${k}" aria-label="Удалить строку">✕</button></div>`).join('')}
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
      ${typeof TzOut!=='undefined' ? `<button class="btn ghost sm" type="button" data-a="tzOut" data-i="${i}">Скачать ТЗ на сборку</button>` : ''}
      ${miss.length ? `<small class="warn-t">не указана закупка: ${miss.map(p=>esc(p.name||'без названия')).join(', ')}</small>` : ''}</div>`;
  }

  /** действия вкладки (data-a); true — перерисовать */
  static act(a, i, b){
    const it=S.items[i]; if (!it) return false; const P=kitParts(it), p=P[+b.dataset.j];
    if (a==='kitOpen' && p){ if (this.open.has(p.id)) this.open.delete(p.id); else this.open.add(p.id); renderEditor(); return 'async'; }
    if (a==='kitBy' && p){ p.by=b.dataset.by==='our' ? 'our' : 'asm'; if (p.by===KitScope.def(p)) delete p.by; kitSync(it); return true; }
    if (a==='reqPickX'){ delete StationReq.ensure(it).pick; persist(); renderEditor(); return 'async'; }
    if (a==='kitNeed' || a==='kitNeedAll') return KitNeed.act(a, i, b);
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
