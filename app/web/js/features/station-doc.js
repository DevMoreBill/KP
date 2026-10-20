// Станция в документе КП — технико-коммерческое предложение (решение ПНЕВМОТЕХ): характеристики станции, что в ней
// есть, описание основных агрегатов и устройство станции — подробно, но без расчётов (расчётная записка — только галочкой).
//   StationDesign — блок «Устройство станции»: контейнер, размещение, сжатый воздух, вентиляция, отопление, освещение,
//                   электропитание, пожарная безопасность — из компоновки и систем контейнера, без выдуманных значений;
//   StationDoc    — какие элементы состава — карточками с описанием (основные агрегаты), какие характеристики — ключевые;
//   StationBrief  — краткое описание станции нейросетью (вкладка «Описание и фото»): встроенная нейросеть программы или
//                   запрос в буфер для ИИ-чата; результат — блок «Описание станции» (вместо шаблонного «Назначение и состав»).
'use strict';

class StationDesign {
  static LABEL = 'Устройство станции';
  static n(v){ return Mm.text(v); }
  /** строки «раздел: текст» (пустые — без строки) */
  static items(x){
    if (!StationUi.on(x)) return [];
    let plan; try{ plan=StationUi.plan(x); } catch(e){ return []; }
    if (!plan || plan.level==='error' || plan.level==='none' || !plan.geo || !plan.geo.ext) return [];
    const c=kitContainer(x)||{}, n=v=>this.n(v), on=id=>KitView.sysOn(x, c, id), out=[], kind=StationReq.kind(x);
    const [L, W, H]=plan.geo.ext, ct=ctypeOf(c.ctype), roof=StationGeo.ROOFS[StationGeo.roof(c)], fl=StationGeo.FLOORS[StationGeo.floor(c)];
    const cl=CLIMATES.find(z=>z[0]===c.climate);
    out.push(['Контейнер', `${ct.name}, ${n(L)} × ${n(W)} × ${n(H)} мм${c.ins ? `, утепление ${c.ins}` : ''}${cl ? `, климатическое исполнение ${cl[0]} (${cl[1]})` : ''}; крыша ${roof ? roof.name : 'плоская'}, пол — ${fl ? fl.name : ''}.`]);
    // размещение: двери, ворота
    const G=plan.gates, svc=(plan.doors||[]).filter(d=>d.kind==='service'), f=plan.fire||{}, two=!!f.exit2 || (plan.doors||[]).some(d=>d.kind==='entry');
    const place=[(plan.mode||{}).ends ? 'основной агрегат — у торца, обслуживание через ворота с обеих сторон'
      : `оборудование — вдоль стены с проходом для обслуживания`, two ? 'две двери оператора' : 'дверь оператора с доводчиком'];
    if (G) place.push(`распашные утеплённые ворота в торце ${n(G.w)} × ${n(G.h)} мм для монтажа и демонтажа оборудования`);
    if (plan.gates2) place.push('вторые ворота в противоположном торце');
    if (svc.length && !(plan.mode||{}).ends) place.push(`сервисные ворота для обслуживания агрегатов (${svc.length} шт.)`);
    out.push(['Размещение оборудования', this.cap(place.join('; '))+'.']);
    if (kind==='comp'){ const a=plan.air, pp=(plan.piping||[])[0], dn=plan.pipe && plan.pipe.dn;
      const chain=a && a.chain && a.chain.length ? a.chain.map(z=>z.text).filter((t, i, A)=>t!==A[i-1]).join(' → ')+' → потребителю' : '';
      const pipe=[pp && pp.matText ? `трубопровод — ${pp.matText}` : 'трубопровод стальной', dn ? `DN ${dn}` : ''].filter(Boolean).join(', ');
      if (chain || pipe) out.push(['Сжатый воздух', this.cap([chain ? `последовательно: ${chain.toLowerCase()}` : '', (plan.items||[]).some(i=>i.kind==='dryer') ? 'обводная линия (байпас) осушителя' : '', pipe+'; запорная арматура на каждом агрегате'].filter(Boolean).join('; '))+'.']); }
    const v=plan.vent;
    if (on('vent') && v && v.size){ const t=[];
      if (v.size.in) t.push(`приток — жалюзи ${v.size.in.n>1 ? v.size.in.n+' × ' : ''}${n(v.size.in.w)} × ${n(v.size.in.h)} мм с клапанами на электроприводе`);
      if ((v.roof||[]).length) t.push('выброс горячего воздуха от компрессоров — воздуховодами через крышу');
      else if (v.size.out) t.push(`выброс горячего воздуха — жалюзи ${v.size.out.n>1 ? v.size.out.n+' × ' : ''}${n(v.size.out.w)} × ${n(v.size.out.h)} мм`);
      t.push('управление по термодатчику'); if (on('rec')) t.push('зимой — рециркуляция тёплого воздуха');
      out.push(['Вентиляция', this.cap(t.join('; '))+'.']); }
    const h=plan.heat;
    if (on('heat') && h && h.n>0) out.push(['Отопление', `Электрические конвекторы с терморегуляторами — ${h.n} × ${String(h.kw).replace('.', ',')} кВт; поддержание в помещении не ниже +${h.tin} °C.`]);
    const l=plan.light;
    if (on('light') && l && l.n>0) out.push(['Освещение', `Светодиодные светильники — ${l.n} шт. (${l.lux} лк)${l.em ? `, аварийные — ${l.em} шт` : ''}${l.floods ? `, прожекторы над дверями — ${l.floods} шт` : ''}.`]);
    const P=plan.power;
    if (on('power') && P && P.kw>0) out.push(['Электропитание', `Щит собственных нужд; ввод 3 × 400 В, расчётная мощность ${String(P.kw).replace('.', ',')} кВт${P.breaker ? `, вводной автомат ${P.breaker} А` : ''}; розетки, заземление.`]);
    const fire=[f.cat ? `категория помещения ${f.cat}` : '', f.ext ? `огнетушители — ${f.ext} шт` : '', on('fire') && f.mods ? `модули автоматического пожаротушения — ${f.mods} шт` : '', on('ops') ? 'охранно-пожарная сигнализация' : '', 'знаки и табло «Выход»'].filter(Boolean);
    out.push(['Пожарная безопасность', this.cap(fire.join('; '))+'.']);
    if (on('noise')) out.push(['Шумоизоляция', 'Внутренняя обшивка шумопоглощающим материалом.']);
    if (on('snow')) out.push(['Снегозащита', 'Откидные козырьки (маркизы) над приточными жалюзи.']);
    return out;
  }
  static cap(s){ s=String(s||''); return s ? s[0].toUpperCase()+s.slice(1) : s; }
  /** текст блока: каждый раздел — строкой «• Раздел: текст» */
  static text(x){ return this.items(x).map(([k, t])=>`• ${k}: ${t}`).join('\n'); }
  /** блок описания для документа или null; свой блок менеджера «Устройство…» важнее */
  static feature(x){
    if ((x.features||[]).some(f=>/устройств/i.test(String(f.label||'')) && String(f.text||'').trim())) return null;
    const text=this.text(x); return text ? { id:'st_design', label:this.LABEL, text } : null;
  }
}

class StationDoc {
  // карточкой с описанием — основные агрегаты; фильтры, обвязка, шкафы, контейнер — только в таблице состава
  static CARD = /^(compressor|dryer|receiver|dgu|pump|tank)$/;
  static SKIP = /^(страна|модель|марка|производитель(?!н)|серия|бренд|артикул|код|тип контроллера|гарантия|цена)/i;
  static MAX_ROWS = 8;
  static card(p){ return this.CARD.test(StationEquip.kindOf(p)||''); }
  /** ключевые характеристики элемента для карточки КП */
  // порядок важности строк карточки: производительность и давление — первыми, габариты и масса — в конце восьми
  static PRIO = [/производительн|подач|пропускн|мощность.*(основн|ном)/i, /давлен|напор/i, /мощност/i, /объ[её]м/i, /точк\S* росы|класс|ступен|фильтрац/i,
    /габарит/i, /масса|вес/i, /шум/i, /напряжен|питани/i];
  static rows(p){
    const L=(p.rows||[]).filter(r=>r.k && r.v && !this.SKIP.test(String(r.k).trim())), kd=StationEquip.kindOf(p)||'';
    // производительность компрессора и осушителя — из поля каталога, если строки нет (она главная в карточке)
    const f=/^(compressor|dryer)$/.test(kd) && !L.some(r=>this.PRIO[0].test(String(r.k))) ? AirChain.flow(p)/((p.attrs||{}).cat==='comp_piston' && StationEquip.num((p.attrs||{}).flow)>0 ? 1000 : 1) : null;   // поршневые — л/мин
    if (f>0) L.unshift({ k:kd==='dryer' ? 'Пропускная способность' : 'Производительность', v:`${String(Math.round(f*100)/100).replace('.', ',')} м³/мин` });
    // бак без своих габаритов — по расчётному объёму (TankSize)
    if (kd==='tank' && !StationEquip.dims(p, kd).known){ const v=TankSize.vol(p); if (v) L.push({ k:'Габариты Д × Ш × В', v:TankSize.text(TankSize.of(v)) }); }
    const rank=r=>{ const k=this.PRIO.findIndex(re=>re.test(String(r.k))); return k<0 ? 99 : k; };
    const seen=new Set();
    return L.map((r, i)=>[r, i]).sort((a, b)=>rank(a[0])-rank(b[0]) || a[1]-b[1]).map(([r])=>r)
      .filter(r=>{ const k=String(r.k).toLowerCase().replace(/\s+/g, ' '); if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, this.MAX_ROWS);
  }
  /** первые блоки описания позиции: описание станции (ИИ или своё) / «Назначение и состав», затем «Устройство станции», затем
   *  остальные блоки менеджера (свой «Описание станции» — первым) */
  static lead(x, pur, des){
    const own=(x.features||[]).filter(f=>f.label||f.text), brief=own.filter(f=>f.label===StationBrief.LABEL), rest=own.filter(f=>f.label!==StationBrief.LABEL);
    return [...brief, ...(pur ? [pur] : []), ...(des ? [des] : []), ...rest];
  }
  /** строки характеристик станции, которых нет в таблице: габариты и масса станции, контейнер */
  static extra(x, groups){
    if (!StationUi.on(x)) return groups;
    let plan; try{ plan=StationUi.plan(x); } catch(e){ return groups; }
    if (!plan || plan.level==='error' || !plan.geo || !plan.geo.ext) return groups;
    const has=k=>groups.some(g=>(g.rows||[]).some(r=>new RegExp(k, 'i').test(String(r.k||'')))), add=[], n=v=>Mm.text(v), c=kitContainer(x)||{};
    if (!has('^Габарит')) add.push({ k:'Габариты станции (Д × Ш × В)', v:`${plan.geo.ext.map(n).join(' × ')} мм`, hl:false });
    const m=plan.mass; if (!has('^Масса') && m && m.mass>0 && !(m.missing||[]).length) add.push({ k:'Масса станции', v:`около ${n(Math.round(m.mass/10)*10)} кг`, hl:false });
    if (!has('^Контейнер')) add.push({ k:'Контейнер', v:[ctypeOf(c.ctype).name, c.ins ? `утепление ${c.ins}` : ''].filter(Boolean).join(', '), hl:false });
    if (!has('^Климатическое')) { const cl=CLIMATES.find(z=>z[0]===c.climate); if (cl) add.push({ k:'Климатическое исполнение', v:`${cl[0]} (${cl[1]})`, hl:false }); }
    if (!add.length) return groups;
    const out=groups.map(g=>({ ...g, rows:[...(g.rows||[])] })); if (out.length) out[0].rows.push(...add); else out.push({ name:'Основные', rows:add });
    return out;
  }
}

class StationBrief {
  static LABEL = 'Описание станции';
  static busy = new Set();
  /** данные станции для запроса: только то, что есть в составе и компоновке */
  static facts(x){
    const t=typeById(attrsOf(x).cat), m=kitMainPart(x), lines=[];
    lines.push(`Изделие: ${t.item||t.name} — «${String(x.name||'').trim()}».`);
    const kpi=mainLine(x, 4); if (kpi) lines.push(`Основные параметры: ${kpi}.`);
    if (m) lines.push(`Основное оборудование: ${m.name}${(+m.qty||1)>1 ? ` — ${m.qty} шт.` : ''}.`);
    const rest=kitParts(x).filter(p=>p!==m && p.role!=='container' && String(p.name||'').trim());
    if (rest.length) lines.push('Состав: '+rest.map(p=>p.name.trim()+((+p.qty||1)>1 ? ` — ${p.qty} шт.` : '')).join('; ')+'.');
    for (const p of kitParts(x).filter(p=>StationDoc.card(p))){ const d=String(p.desc||'').replace(/\s+/g, ' ').slice(0, 300); if (d) lines.push(`О «${p.name.trim()}»: ${d}`); }
    const r=StationReq.of(x); if (r.industry && StationReq.INDUSTRY_WORD && StationReq.INDUSTRY_WORD[r.industry]) lines.push(`Отрасль заказчика: ${StationReq.INDUSTRY_WORD[r.industry]}.`);
    const d=StationDesign.items(x); if (d.length) lines.push('Устройство станции:\n'+d.map(([k, v])=>`- ${k}: ${v}`).join('\n'));
    return lines.join('\n');
  }
  static prompt(x){
    return `Ты — инженер-технолог компании ПНЕВМОТЕХ (поставка и сборка компрессорных, дизель-генераторных и насосных станций в блок-контейнерах).
Напиши краткое описание станции для технико-коммерческого предложения заказчику: 4–6 предложений, деловой стиль, по-русски.
Что сказать: назначение станции; из чего она состоит и как работает (основные агрегаты и цепочка); устройство контейнера и систем
(коротко); 1–2 преимущества решения (готовая к подключению станция заводской сборки, компактность, автономность и т. п.).
Строго: только факты из данных ниже — без выдуманных чисел, марок и гарантий; без маркетинговых штампов и превосходных степеней;
без вопросов и пометок для заказчика; без списков и заголовков — связный текст.
Ответ — одним JSON: {"text":"…"}

Данные станции:
${this.facts(x)}`;
  }
  /** ответ нейросети → текст или '' */
  static parse(raw){
    const r=aiParse(raw); if (r && r.kind==='json' && r.j && typeof r.j.text==='string') return r.j.text.trim();
    const s=String(raw||'').replace(/```[a-z]*|```/gi, '').trim(); return /\{/.test(s) ? '' : s;
  }
  /** текст — в блок «Описание станции» (первым; прежний такой блок заменяется) */
  static apply(x, text){
    text=String(text||'').trim().slice(0, 2000); if (!text) return false;
    x.features=x.features||[]; let f=x.features.find(z=>z.label===this.LABEL);
    if (!f){ f={ id:uid(), label:this.LABEL, text:'' }; x.features.unshift(f); }
    f.text=text; f.ai=true; return true;
  }
  /** блок в «Описание и фото» станции */
  static html(x, i){
    const busy=this.busy.has(x.id), has=(x.features||[]).some(f=>f.label===this.LABEL && String(f.text||'').trim()), direct=typeof AI_DIRECT!=='undefined' && AI_DIRECT.enabled;
    return `<div class="ed-sec sb"><div class="sub">Краткое описание станции — ИИ${tip('Нейросеть пишет 4–6 предложений для КП только по данным станции: состав, параметры, устройство контейнера. Результат — блок «Описание станции» ниже, его можно поправить. В КП он стоит первым, вместо шаблонного «Назначение и состав». «Устройство станции» программа собирает сама из компоновки.')}</div>
      <div class="row sb-a">${direct ? `<button class="btn primary" type="button" data-sb="go" data-i="${i}"${busy ? ' disabled' : ''}>${busy ? '<span class="ai-spin" aria-hidden="true"></span> Пишу…' : has ? '✨ Написать заново' : '✨ Написать описание'}</button>` : ''}
        ${aiSitesHtml('sbCopy', i, direct ? ' data-alt="1"' : '')}</div>
      ${direct ? '' : `<p class="muted sb-h">Встроенная нейросеть не включена («Настройки → Нейросеть») — скопируйте запрос в ИИ-чат и вставьте ответ:</p>`}
      <details class="ai-pr"${direct ? '' : ' open'}><summary>${direct ? 'Через ИИ-чат в браузере' : 'Ответ ИИ-чата'}</summary><textarea rows="3" data-sbans="${i}" placeholder="Вставьте ответ ИИ-чата"></textarea>
        <div class="row"><button class="btn" type="button" data-sb="paste" data-i="${i}">Вставить в описание</button></div></details></div>`;
  }
  static async go(i){
    const x=S.items[i]; if (!x || this.busy.has(x.id)) return;
    this.busy.add(x.id); renderEditor();
    try{ const txt=this.parse(await aiDirect(this.prompt(x))); if (!this.apply(x, txt)) throw new Error('пустой ответ'); persist(); toast('Описание станции написано — проверьте и поправьте при необходимости'); }
    catch(e){ toast('Нейросеть не ответила: '+(e && e.message || e)); }
    finally{ this.busy.delete(x.id); renderEditor(); }
  }
  static paste(i){
    const x=S.items[i], el=document.querySelector(`[data-sbans="${i}"]`); if (!x || !el) return;
    if (!this.apply(x, this.parse(el.value))) return toast('Вставьте ответ ИИ-чата');
    persist(); renderEditor(); toast('Описание станции вставлено');
  }
}
document.addEventListener('click', e=>{ const b=e.target.closest && e.target.closest('[data-sb],[data-a="sbCopy"]'); if (!b) return;
  const i=+b.dataset.i;
  if (b.dataset.sb==='go') StationBrief.go(i);
  else if (b.dataset.sb==='paste') StationBrief.paste(i);
  else if (b.dataset.a==='sbCopy'){ const x=S.items[i]; if (x) aiSend(StationBrief.prompt(x), b.dataset.url, ok=>toast(ok ? 'Запрос скопирован — вставьте его в ИИ-чат, ответ — в поле «Ответ ИИ-чата»' : 'Скопируйте запрос вручную')); } });
