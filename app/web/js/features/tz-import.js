// ТЗ заказчика → станция. Файл (PDF, DOCX, XLSX, ODT, ODS, RTF, TXT) читает сервер: /api/tz/parse — текст и требования
// по правилам, у каждого значения — цитата из ТЗ. Менеджер проверяет найденное в окне (TzImport), по желанию уточняет с
// ИИ (заполняются только пустые поля); затем требования записываются в станцию (новую — из мастера, или уже открытую),
// контейнер — по ним (тип, утепление, климат, системы), оборудование подбирается из каталога (TzPick).
'use strict';

class TzImport {
  static KINDS = [['comp', 'Компрессорная', 'st_comp'], ['pump', 'Насосная', 'st_pump'], ['dgu', 'Дизель-генераторная', 'st_dgu']];
  static ACCEPT = '.pdf,.docx,.xlsx,.odt,.ods,.rtf,.txt';
  static cur = null;

  /** выбрать файл ТЗ: i — станция в КП (требования — к ней), null — новая станция */
  static pick(i){
    const f=$('#filePick'); f.value=''; f.multiple=false; f.accept=this.ACCEPT;
    f.onchange=async ()=>{ const fl=f.files[0]; f.accept=''; if (!fl) return;
      if (fl.size>40*1024*1024) return toast('Файл больше 40 МБ');
      toast('Читаю ТЗ…');
      let r; try{ r=await api('/api/tz/parse?name='+encodeURIComponent(fl.name), { method:'POST', headers:{ 'Content-Type':'application/octet-stream' }, body:fl }); }
      catch(e){ return toast(String(e && e.message || e)); }
      this.open(r, fl.name, i); };
    f.click();
  }

  /** окно разбора: найденное (с цитатами) и поля требований */
  static open(r, name, i){
    const x=i!=null ? S.items[i] : null, q={ ...(r.req||{}) };
    q.kind=(x && StationReq.kind(x)) || q.kind || 'comp';
    if (x){ const c=kitContainer(x), r0=StationReq.of(x); if (!q.cont && c) q.cont=c.ctype;   // станция уже есть: чего нет в ТЗ — из её требований
      for (const [k, v] of Object.entries(r0)) if (!['src', 'pick'].includes(k) && (q[k]==null || q[k]==='') && v!=null && v!=='') q[k]=v;
      if (!q.air && StationUi.opts(x).air) q.air=StationUi.opts(x).air;
      if (c){ q.sys={ ...(c.sys||{}), ...(q.sys||{}) }; if (!q.ins && c.ins) q.ins=c.ins; if (!q.climate && c.climate) q.climate=c.climate; } }
    this.cur={ r, name, i, q, pick:!x || !kitMainPart(x) };
    if (this.m) this.m.close();
    const t=$('#toast'); if (t) t.classList.remove('on');
    const m=this.m=new Modal(this.html(), 'wide tzi');
    m.d.addEventListener('click', e=>this.click(e));
    m.d.addEventListener('change', e=>{ if (e.target.dataset.tz==='kind'){ this.read(); this.redraw(); } });
  }
  static redraw(){ if (this.m && this.m.d.open) this.m.d.innerHTML=this.html(); }

  static html(){
    const c=this.cur, q=c.q, k=q.kind, x=c.i!=null ? S.items[c.i] : null, found=(c.r.found||[]).filter(f=>f.key!=='kind');
    const fld=(key, label, ph, mode='decimal')=>`<label class="f"><span>${label}</span><input type="text" inputmode="${mode}" data-tz="${key}" value="${esc(q[key]??'')}" placeholder="${esc(ph||'')}" autocomplete="off"></label>`;
    const sel=(key, label, list)=>`<label class="f"><span>${label}</span><select data-tz="${key}">${list.map(([v, l])=>`<option value="${esc(v)}"${String(q[key]??'')===String(v) ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select></label>`;
    const chk=(key, label, on)=>`<label class="tzi-c"><input type="checkbox" data-tz="${key}"${on ? ' checked' : ''}><span>${label}</span></label>`;
    const main=k==='comp' ? fld('flow', 'Производительность, м³/мин', 'например, 10')+fld('pressure', 'Давление, бар', '8')
        +sel('air', 'Класс воздуха ISO 8573-1', [['', 'не задан'], ...AirChain.options(q.air)])+sel('recv', 'Ресивер', StationReq.RECV)+fld('recvVol', 'Ресивер, л', 'по расчёту', 'numeric')
      : k==='pump' ? fld('q', 'Подача, м³/ч', 'например, 50')+fld('head', 'Напор, м', '40')
      : fld('kw', 'Мощность, кВт', 'например, 200')+fld('hours', 'Работа от бака, ч', '16', 'numeric');
    const sys=q.sys||{};
    const src=found.length ? `<details class="tzi-f" open><summary>Найдено в ТЗ — ${found.length}</summary><ul>${found.map(f=>`<li><b>${esc(f.label)}</b>${f.value===true ? '' : ': '+esc(String(f.value))}<small class="muted">${esc(f.src||'')}</small></li>`).join('')}</ul></details>`
      : '<p class="muted">В тексте не нашлось числовых требований — впишите их сами или уточните с ИИ.</p>';
    return `<div class="dlg-h"><h3>ТЗ заказчика <small class="muted">· ${esc(c.name)}${c.r.doc ? ` · ${esc(String(c.r.doc.kind).toUpperCase())}${c.r.doc.pages ? ', стр. '+c.r.doc.pages : ''}` : ''}</small></h3><button class="icon" type="button" data-x aria-label="Закрыть">✕</button></div>
      <div class="dlg-b">
        ${x ? '' : sel('kind', 'Станция', this.KINDS.map(([v, l])=>[v, l]))}
        <div class="kr-g tzi-g">${main}${sel('work', 'Рабочих агрегатов', StationReq.WORK)}${sel('reserve', 'Резерв', StationReq.RES)}
          ${fld('tmin', 'Наружный воздух от, °C', '−45', 'text')}${fld('tmax', 'до, °C', '+40', 'text')}
          ${sel('fire', 'Категория помещения', [['', 'ориентировочно по виду станции'], ...StationReq.FIRE.map(f=>[f, f])])}${fld('noise', 'Шум, не более дБА', '80', 'numeric')}
          ${sel('cont', 'Контейнер', CONTAINER_TYPES.map(t=>[t.id, t.name]))}${sel('ins', 'Утепление', [['', 'по типу контейнера'], ...CONTAINER_INS.map(v=>[v, v])])}
          ${sel('climate', 'Климатическое исполнение', [['', 'по температуре'], ...CLIMATES.map(z=>[z[0], z[0]+' — до '+z[2]+' °C'])])}</div>
        <div class="tzi-sys"><span class="muted">Системы контейнера:</span>${CONT_SYSTEMS.map(([id, l])=>chk('sys.'+id, esc(l), sys[id] ?? CONT_SYS_DEF[id])).join('')}</div>
        <div class="tzi-sys">${StationReq.OPTS.filter(([, , kinds])=>kinds.includes(k)).map(([key, label])=>chk(key, esc(label), q[key])).join('')}</div>
        ${k==='comp' ? chk('recvOut', 'Ресивер после подготовки — снаружи (ФНП ОРПД, п. 65)', q.recvOut) : ''}
        ${chk('docs', 'Документы при поставке — в КП', q.docs!==false)}
        <label class="f"><span>Прочие требования из ТЗ</span><textarea rows="3" data-tz="notes">${esc(q.notes||'')}</textarea></label>
        ${src}
        ${chk('pick', `<b>Подобрать оборудование из каталога</b> <span class="muted">— ${k==='comp' ? 'компрессоры с резервом, осушитель и фильтры по классу, ресивер' : k==='pump' ? 'насосы с резервом' : 'ДГУ с резервом'}${x && kitMainPart(x) ? '; прежнее основное оборудование заменится' : ''}</span>`, c.pick)}
        <div class="row" style="justify-content:flex-end;gap:8px;margin-top:12px">
          ${typeof AI_DIRECT!=='undefined' && AI_DIRECT.enabled ? '<button class="btn ghost" type="button" data-tzai>✨ Уточнить с ИИ</button>' : ''}
          <button class="btn" type="button" data-x>Отмена</button><button class="btn primary" type="button" data-tzok>${x ? 'Применить к станции' : 'Создать станцию'}</button></div></div>`;
  }

  /** поля окна → требования */
  static read(){
    const q=this.cur.q, d=this.m.d;
    for (const el of d.querySelectorAll('[data-tz]')){ const k=el.dataset.tz, v=el.type==='checkbox' ? el.checked : String(el.value).trim();
      if (k==='pick') this.cur.pick=v;
      else if (k.startsWith('sys.')){ q.sys=q.sys||{}; q.sys[k.slice(4)]=v; }
      else q[k]=v; }
    return q;
  }

  static async click(e){
    if (e.target.closest('[data-x]')) return this.m.close();
    if (e.target.closest('[data-tzai]')) return this.ai();
    const ok=e.target.closest('[data-tzok]'); if (!ok) return;
    ok.disabled=true; ok.textContent='Подбираю…';
    try{ await this.apply(); }
    catch(err){ ok.disabled=false; ok.textContent='Повторить'; toast('Не получилось: '+(err && err.message || err)); }
  }

  /** уточнить с ИИ: пустые поля — из ответа нейросети (JSON) */
  static async ai(){
    const q=this.read(), text=String(this.cur.r.text||'').slice(0, 12000);
    const prompt=`Из технического задания ниже выпиши требования к станции в контейнере. Ответ — только JSON без пояснений:
{"kind":"comp|pump|dgu","flow":м³/мин,"pressure":бар,"air":"класс ISO 8573-1 вида 1.4.1","q":м³/ч,"head":м,"kw":кВт,"work":рабочих агрегатов 1…4,"reserve":0|1|2,
"tmin":°C,"tmax":°C,"climate":"У1|УХЛ1|ХЛ1","fire":"А|Б|В1|В2|В3|В4|Г|Д","noise":дБА,"recvOut":true|false,"cont":"block|sea20|sea40|sea20hc|sea40hc|north",
"oilFree":true|false,"vsd":true|false,"ats":true|false,"scada":true|false,"notes":"прочие требования кратко"}. Неизвестное — не указывай.\n\nТЕКСТ ТЗ:\n${text}`;
    toast('Спрашиваю ИИ…');
    let a; try{ a=JSON.parse(String(await aiDirect(prompt)).replace(/^[^{]*/, '').replace(/[^}]*$/, '')); }
    catch(err){ return toast('ИИ не ответил понятно — поля оставлены как есть'); }
    let n=0;
    for (const [k, v] of Object.entries(a||{})){ if (v==null || v==='' || typeof v==='object') continue;
      if (StationReq.OPTS.some(o=>o[0]===k)){ if (v===true && !q[k]){ q[k]=true; n++; } continue; }
      if (q[k]==null || q[k]===''){ q[k]=k==='reserve' ? String(Math.max(0, Math.min(2, Math.round(+v||0)))) : k==='work' ? String(Math.max(1, Math.min(4, Math.round(+v||1)))) : String(v).slice(0, 600); n++; } }
    this.redraw(); toast(n ? `ИИ дополнил полей: ${n}` : 'ИИ не нашёл ничего сверх найденного');
  }

  /** записать требования в станцию (или создать её), контейнер по требованиям, подбор оборудования */
  static async apply(){
    const c=this.cur, q=this.read(), num=v=>{ const n=StationReq.num(String(v??'').replace(/[−–]/g, '-').replace(/^\+/, '')); return n==null ? '' : String(n); };
    let i=c.i, x=i!=null ? S.items[i] : null;
    if (!x){ const t=typeById((this.KINDS.find(z=>z[0]===q.kind)||this.KINDS[0])[2]);
      x=newItem(); x.attrs={ cat:t.id }; x.page=true; x.features=[]; x.kit={ parts:[] };
      x.kit.parts.push(kitNewContainer(q.cont||'block')); StationDefaults.add(x, t.id);
      S.items.push(x); i=S.items.length-1; }
    // контейнер: тип, утепление, климат (по требованию или по температуре), системы
    const cont=kitContainer(x)||(()=>{ const n=kitNewContainer('block'); x.kit.parts.push(n); return n; })(), tmin=+num(q.tmin);
    const climate=q.climate || (num(q.tmin)!=='' ? (tmin<-45 ? 'УХЛ1' : 'У1') : cont.climate);
    if (q.cont && q.cont!==cont.ctype){ cont.ctype=q.cont; const ct=ctypeOf(q.cont); cont.size=''; cont.sizeAuto=!!StationGeo.FLEX[q.cont]; if (ct.ins) cont.ins=ct.ins; }
    cont.sys={ ...(cont.sys||CONT_SYS_DEF), ...(q.sys||{}) };
    contApply(cont, { ins:q.ins || cont.ins, climate });
    // требования станции
    const r=StationReq.ensure(x);
    for (const k of ['flow', 'pressure', 'q', 'head', 'kw', 'hours', 'tmin', 'tmax', 'noise', 'recvVol']) if (q[k]!=null && q[k]!=='') r[k]=num(q[k]);
    for (const k of ['recv', 'reserve', 'work', 'fire']) if (q[k]!=null) r[k]=q[k];
    r.recvOut=!!q.recvOut; r.docs=q.docs!==false; if (q.notes) r.notes=String(q.notes).slice(0, 2000);
    for (const [k, , kinds] of StationReq.OPTS) if (kinds.includes(q.kind)) r[k]=!!q[k];
    const added=StationReq.ensureParts(x);
    r.src={ name:String(c.name||'').slice(0, 120) };
    if (q.kind==='comp' && q.air) x.stLayout={ ...StationUi.opts(x), air:q.air };
    let note='';
    if (c.pick){ note=await TzPick.run(x, { ...q, flow:+num(q.flow), pressure:+num(q.pressure), q:+num(q.q), head:+num(q.head), kw:+num(q.kw), hours:+num(q.hours), pdp:q.pdp, recvVol:+num(q.recvVol), work:+q.work||0 }); r.pick=note.slice(0, 900); }
    else { delete r.pick; if (q.kind==='dgu' && +num(q.hours)>0) StationDefaults.retank(x, +num(q.hours)); }
    kitSync(x); stationFill(x); stationAutoName(x); StationUi.cache.delete(x.id); StationSize.apply(x, true);
    persist(); this.m.close(); renderForm(); openEditor(i, 'kit');
    if (added.length) r.pick=[r.pick, 'Добавлено по ТЗ: '+added.join(', ')].filter(Boolean).join('. ').slice(0, 900);
    toast(c.pick ? 'Станция собрана по ТЗ — проверьте состав' : 'Требования из ТЗ записаны в станцию');
  }
}

// ---------------------------------------------------------------- подбор оборудования по требованиям
// Основное: число рабочих агрегатов — из ТЗ или 1…3 с наименьшим избытком производительности (лишний агрегат — штраф),
// каждый не меньше доли нагрузки; к ним — резервные той же модели. Компрессор — с запасом давления на потери в осушителе
// и фильтрах (лишнее давление — штраф: каждый бар сверх нужного — около 7 % энергии), насос — без большого избытка напора.
// Компрессорная: осушитель — по классу воды (точка росы ниже −20 °C — адсорбционный) с запасом на давление и лето;
// фильтры и ресивер — по рекомендациям расчёта цепочки (AirChain).
class TzPick {
  static LOSS = 0.5;   // потери давления в осушителе и фильтрах, бар — запас компрессора к требуемому давлению
  static GRADE = { dust:['dust', 'fine'] };   // после адсорбционного осушителя годится и фильтр тонкой очистки 1 мкм
  static num(v){ return StationEquip.num(v); }
  /** производительность позиции каталога в единицах подбора: компрессоры и осушители — м³/мин, насосы — м³/ч */
  static flow(c){ const a=attrsOf(c), f=this.num(a.flow); return f>0 ? (a.cat==='comp_piston' ? f/1000 : f) : 0; }

  /** лучшая позиция: из подходящих — с наименьшим значением key (самая «впритык») */
  static best(list, key){ return list.reduce((b, o)=>!b || o[key]<b[key] ? o : b, null); }

  /** рабочие агрегаты из pool [{c, v}] на нагрузку need: {o, n}; n0 — число рабочих из ТЗ, pen(o) — штраф позиции */
  static units(pool, need, n0, pen=()=>0){
    let pick=null;
    for (let n=n0||1; n<=(n0||3); n++) for (const o of pool){ if (o.v<need/n*0.98) continue;
      const score=(o.v*n-need)/need+0.08*(n-1)+pen(o); if (!pick || score<pick.score) pick={ o, n, score }; }
    return pick;
  }
  /** штраф компрессора по давлению: меньше нужного с запасом на потери — сильный, больше — по 0,05 за бар */
  static barPen(p, B){ if (!(B>0) || !(p>0)) return 0; const need=B+this.LOSS; return p<need-0.05 ? 0.5 : 0.05*(p-need); }
  /** безмасляный компрессор: по названию или характеристикам («безмасляный», oil-free, класс 0) */
  static oilFree(c){ const a=attrsOf(c); return /безмасл|oil[\s-]?free|класс\w*\s*0(?![.,\d])/i.test([c.name, a.model, a.series, a.lubrication, a.oil].filter(Boolean).join(' ')); }
  /** ресиверы на объём V, л: один, иначе несколько одинаковых (2…4) — наименьшее число, затем наименьший объём; давление — не ниже B,
   *  высота с арматурой (+300 мм) — не выше Hmax (0 — без ограничения: ресивер снаружи) */
  static receivers(V, B, Hmax){
    const L=catCache.filter(c=>attrsOf(c).cat==='receiver').map(c=>{ const a=attrsOf(c); return { c, v:this.num(a.volume)||0, p:this.num(a.pressure), h:StationEquip.dims({ name:c.name, attrs:a, rows:[] }, 'receiver').h }; })
      .filter(o=>o.v>0 && (!(B>0) || !(o.p>0) || o.p>=B-0.05) && (!(Hmax>0) || o.h+300<=Hmax));
    if (!(V>0)) return L.length ? { o:this.best(L, 'v'), n:1 } : null;
    for (let n=1; n<=4; n++){ const o=this.best(L.filter(z=>z.v>=V/n*0.98), 'v'); if (o) return { o, n }; }
    return null;
  }
  /** высота внутри контейнера станции, мм: блок-контейнер по оборудованию — до наибольшей высоты ряда */
  static hmax(x){
    const g=StationGeo.of(kitContainer(x)||{ ctype:'block' });
    return g.int ? g.int[2] : StationGeo.inner(g.type, [10000, StationGeo.ROAD_W, StationGeo.BLOCK.maxH], g.t)[2];
  }
  /** «осушитель …» — без повтора, если название уже начинается с этого слова */
  static lbl(word, name){ return String(name||'').toLowerCase().startsWith(word.slice(0, 5)) ? name : word+' '+name; }

  static async part(c, qty, role){
    let doc=c; try{ doc=await api('/api/catalog/'+encodeURIComponent(c.id)); }catch(_){}
    const p=KitPart.fromCat(doc); p.qty=qty; if (role) p.role=role; return p;
  }

  /** подбор в станцию x; ответ — строка для менеджера: что подобрано и чего в каталоге нет */
  static async run(x, q){
    const res=Math.max(0, Math.round(+q.reserve||0)), got=[], miss=[], kind=q.kind;
    const drop=kind==='comp' ? /^(compressor|dryer|filter|receiver)$/ : kind==='pump' ? /^pump$/ : /^dgu$/;
    const keep=kitParts(x).filter(p=>p.role==='container' || !drop.test(StationEquip.kindOf(p)||'')), add=[];
    const cats=(typeById({ comp:'st_comp', pump:'st_pump', dgu:'st_dgu' }[kind]).station||{}).main||[];
    const pool=catCache.filter(c=>cats.includes(attrsOf(c).cat));
    if (kind==='comp'){
      const B=q.pressure, wc=+(String(q.air||'').split('.')[1]||0), ads=(wc && wc<=3) || (q.pdp!=null && +q.pdp<=-20);
      const Q=ads && q.flow>0 ? q.flow/(1-AirChain.PURGE) : q.flow;   // адсорбционный осушитель — компрессоры с запасом на продувку
      const comp=c=>({ name:c.name, attrs:attrsOf(c), rows:[] }), vsd=c=>AirChain.info(comp(c), 'compressor').vsd;
      const cand=pool.filter(c=>!q.oilFree || this.oilFree(c));   // класс 0 по маслу — только безмасляные
      if (Q>0){ const u=this.units(cand.map(c=>({ c, v:this.flow(c), p:this.num(attrsOf(c).pressure), f:!q.vsd || vsd(c) })).filter(o=>o.v>0 && (!(B>0) || !(o.p>0) || o.p>=B-0.05)), Q, q.work,
          o=>this.barPen(o.p, B)+(o.f ? 0 : 0.3));   // частотное регулирование по ТЗ — такие в приоритете
        if (u){ add.push(await this.part(u.o.c, u.n+res, 'main')); got.push(`компрессоры ${u.n}${res ? ' + '+res+' резервн.' : ''} × ${u.o.c.name}${ads ? ` (с запасом ${Math.round(AirChain.PURGE*100)} % на продувку адсорбционного осушителя)` : ''}`);
          if (B>0 && u.o.p>0 && u.o.p<B+this.LOSS-0.05) got.push(`давление компрессора ${AirChain.m3(u.o.p)} бар — почти без запаса на потери в осушителе и фильтрах (нужно около ${AirChain.m3(B+this.LOSS)})`); }
        else miss.push(`${q.oilFree ? 'безмасляный ' : ''}${q.work>1 ? q.work+' компрессора' : 'компрессор'} на ${AirChain.m3(Q)} м³/мин${B ? ' и '+AirChain.m3(B)+' бар' : ''}`);
        if (u && q.vsd && !u.o.f) got.push('компрессора с частотным регулированием в каталоге нет — подобран без него');
        const need=Q*AirChain.MARGIN/AirChain.kp(B>0 ? B : 7);
        const dc=ads ? 'dryer_ads' : 'dryer_refrig', d=this.best(catCache.filter(c=>attrsOf(c).cat===dc).map(c=>({ c, v:this.flow(c) })).filter(o=>o.v>=need), 'v');
        if (d){ add.push(await this.part(d.c, 1)); got.push(this.lbl('осушитель', d.c.name)); } else miss.push(`${ads ? 'адсорбционный' : 'рефрижераторный'} осушитель от ${AirChain.m3(need)} м³/мин`); }
      // фильтры и ресивер — по расчёту цепочки на подобранном составе
      x.kit.parts=[...add, ...keep]; let at=add.length;   // фильтры и ресивер — после подобранного, перед прочим составом
      const plan=StationLayout.solve(StationUi.input(x));
      for (const rec of (plan.air && plan.air.recs || []).filter(r=>r.cat==='filter' || r.cat==='receiver')){
        const lo=Object.fromEntries(Object.entries(rec.r||{}).map(([k, v])=>[k, this.num((v||[])[0])]));
        if (rec.cat==='receiver' && q.recvVol>0) lo.volume=q.recvVol;
        if (rec.cat==='receiver'){   // ресиверы: один или несколько; «до и после осушителя» — два (до — «мокрый», после — «сухой»)
          const both=q.recv==='both', V=lo.volume||0, r=this.receivers(both ? V/2 : V, q.pressure, q.recvOut ? 0 : this.hmax(x));
          if (!r){ miss.push(rec.title.toLowerCase()); continue; }
          for (let j=0; j<(both ? 2 : 1); j++) x.kit.parts.splice(at++, 0, await this.part(r.o.c, r.n));
          const n=r.n*(both ? 2 : 1);
          got.push((n>1 ? `ресиверы ${n} × ` : '')+this.lbl('ресивер', r.o.c.name)+(r.n>1 ? ` (${r.n} по ${StationLayout.n(r.o.v)} л: одного на ${StationLayout.n(both ? V/2 : V)} л в каталоге нет или он не проходит по высоте контейнера)` : ''));
          continue; }
        const ok=c=>{ const a=attrsOf(c); if (a.cat!==rec.cat) return false;
          if (rec.cat==='filter'){ const p={ name:c.name, attrs:a, rows:[] };   // ступень — по полю или названию (DD, PD, «0,01 мкм»…)
            if (!(this.GRADE[rec.key]||[rec.key]).includes(AirChain.grade(p, a.cat, AirChain.text(p)))) return false; }
          else for (const [k, v] of Object.entries(rec.f||{})) if (v && !String(a[k]||'').toLowerCase().includes(String(v).toLowerCase().slice(0, 6))) return false;
          for (const [k, v] of Object.entries(lo)) if (v>0 && !(this.num(a[k])>=v*0.98)) return false;
          return !(rec.cat==='receiver' && q.pressure>0 && this.num(a.pressure)>0 && this.num(a.pressure)<q.pressure); };
        const key=Object.keys(lo)[0]||'flow', c=this.best(catCache.filter(ok).map(c=>({ c, v:this.num(attrsOf(c)[key])||0 })), 'v');
        if (c){ x.kit.parts.splice(at++, 0, await this.part(c.c, 1)); got.push(this.lbl(rec.cat==='receiver' ? 'ресивер' : 'фильтр', c.c.name)); }
        else miss.push(rec.title.toLowerCase()); }
      return this.note(got, miss);
    }
    if (kind==='pump' && q.q>0){
      const u=this.units(pool.map(c=>({ c, v:this.num(attrsOf(c).flow)||0, h:this.num(attrsOf(c).head) })).filter(o=>o.v>0 && (!(q.head>0) || o.h>=q.head)), q.q, q.work,
        o=>q.head>0 && o.h>0 ? 0.3*(o.h-q.head)/q.head : 0);
      if (u){ add.push(await this.part(u.o.c, u.n+res, 'main')); got.push(`насосы ${u.n}${res ? ' + '+res+' резервн.' : ''} × ${u.o.c.name}`); }
      else miss.push(`${q.work>1 ? q.work+' насоса' : 'насос'} на ${AirChain.m3(q.q)} м³/ч${q.head ? ' и '+AirChain.m3(q.head)+' м' : ''}`);
    }
    if (kind==='dgu' && q.kw>0){
      const u=this.units(pool.map(c=>({ c, v:this.num(attrsOf(c).kw)||0 })).filter(o=>o.v>0), q.kw, q.work||1), n=u ? u.n+res : 0;   // ДГУ — одна рабочая, если в ТЗ не сказано иначе
      if (u){ add.push(await this.part(u.o.c, n, 'main')); got.push(`ДГУ ${n>1 ? `${u.n}${res ? ' + '+res+' резервн.' : ''} × ` : ''}${u.o.c.name}`); } else miss.push(`ДГУ от ${AirChain.m3(q.kw)} кВт`);
      x.kit.parts=[...add, ...keep];
      const v=q.hours>0 ? StationDefaults.retank(x, q.hours) : null; if (v) got.push(`топливный бак ${v} л — на ${q.hours} ч при нагрузке 75 %`);
    }
    x.kit.parts=[...add, ...keep];
    return this.note(got, miss);
  }
  static note(got, miss){
    return [got.length ? 'Подобрано: '+got.join('; ') : '', miss.length ? 'В каталоге нет: '+miss.join('; ')+' — добавьте вручную' : ''].filter(Boolean).join('. ')
      || 'Требования записаны; для подбора не хватило данных (производительность, подача или мощность)';
  }
}
