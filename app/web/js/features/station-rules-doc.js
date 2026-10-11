// Инженерные правила станций — документ «Инженерные правила и источники» (Word) и вкладка «Настроек»: просмотр правил
// со статусами и источниками, выгрузка файла, загрузка своей версии (проверка структуры — на сервере, app/station_rules.py),
// возврат к файлу поставки. Документ доступен всем (кнопка в «Расчёте станции»), изменение файла — только администратору.
'use strict';

class StationRulesDoc {
  static STATUS = { confirmed:'Подтверждено', practice:'Практика', unconfirmed:'Требует подтверждения' };
  static KIND = { dryer:'Осушители', filter:'Фильтры', genset:'ДГУ' };

  /** значение правила текстом: число, таблица [[x, y]], список, параметры {ключ: значение} */
  static val(v, unit){
    const n=x=>typeof x==='number' ? String(x).replace('.', ',').replace('-', '−') : String(x);
    let t;
    if (Array.isArray(v)) t=v.every(r=>Array.isArray(r) && r.length===2) ? v.map(([x, y])=>`${n(x)} → ${n(y)}`).join('; ') : v.map(x=>Array.isArray(x) ? x.map(n).join(' — ') : n(x)).join('; ');
    else if (v && typeof v==='object') t=Object.entries(v).map(([k, x])=>`${k}: ${x && typeof x==='object' ? this.val(x) : n(x)}`).join('; ');
    else t=n(v);
    return unit && !Array.isArray(v) && (!v || typeof v!=='object') ? t+' '+unit : t;
  }
  static src(s){ return [s && s.doc, s && s.item].filter(Boolean).join(', ')+(s && s.url ? ' — '+s.url : ''); }

  /** правила с сервера (действующая версия) */
  static async load(){ return (await api('/api/rules/stations')).rules; }

  static async download(){
    try{ const d=await this.load(); saveFileA(`Инженерные правила и источники — ${String(d.version||'').replace(/[\\/:*?"<>|]+/g, ' ')}.docx`, await this.make(d)); }
    catch(e){ toast('Не удалось подготовить документ: '+(e && e.message || e)); }
  }

  /** документ .docx (Blob) */
  static make(d){
    const org=typeof StationUi!=='undefined' ? StationUi.org() : 'ПНЕВМОТЕХ', w=new DocxWriter({ title:'Инженерные правила и источники', author:org, footer:'Инженерные правила и источники — версия '+(d.version||'') });
    const R=d.rules||[], cnt=k=>R.filter(r=>r.status===k).length;
    w.title1('Инженерные правила и источники');
    w.p(`Расчёт модульных станций (компрессорных и дизель-генераторных) — версия правил ${d.version||'—'} от ${d.date||'—'}. Правил: ${R.length}; подтверждено источником — ${cnt('confirmed')}, отраслевая практика — ${cnt('practice')}, требует подтверждения — ${cnt('unconfirmed')}. Данных производителей по сериям: ${(d.series||[]).length}.`, { align:'center' });
    w.h1('Как читать');
    w.items([
      'Подтверждено — значение взято из нормативного документа или каталога производителя (указан пункт или страница).',
      'Практика — принятое в отрасли значение (методическая литература, руководства производителей), обязательной нормы нет.',
      'Требует подтверждения — значение принято программой до получения данных производителя или заказчика; в расчётной записке такие пункты перечисляются отдельно и в КП попадают в раздел «Требует подтверждения».',
      'Правило меняется только новой версией файла правил («Настройки» → «Инженерные правила станций»): прежняя версия сохраняется, вернуть файл поставки можно одной кнопкой.']);
    const groups=[...new Set(R.map(r=>r.group||'Прочее'))];
    groups.forEach((g, gi)=>{ w.h1(`${gi+1}. ${g}`);
      w.table([10, 46, 44, 60, 20], ['№', 'Правило', 'Значение', 'Источник', 'Статус'], R.filter(r=>(r.group||'Прочее')===g).map((r, k)=>[
        `${gi+1}.${k+1}`, [[r.title, { b:true }], ...(r.note ? [['\n'+r.note, { sz:8.5, color:'5E6984' }]] : []), ['\n'+r.id, { sz:8, color:'8A94A8' }]], this.val(r.value, r.unit), this.src(r.source), this.STATUS[r.status]||r.status])); });
    const S=d.series||[];
    if (S.length){ w.h1(`${groups.length+1}. Данные производителей по сериям`);
      w.p('Поправочные коэффициенты производителя применяются, если позиция каталога относится к серии (производитель и выражение по названию, модели, серии). Производительность с поправками = номинал × Fдавление × Fвход × Fокружающая.');
      w.table([28, 34, 70, 48], ['Вид, производитель', 'Серия', 'Поправки', 'Источник'], S.map(s=>[`${this.KIND[s.kind]||s.kind}, ${s.maker}`, [[s.title||'', { b:true }], ['\n'+(s.note||''), { sz:8.5, color:'5E6984' }]],
        Object.entries(s.f||{}).map(([k, T])=>`${{ p:'давление, бар', inlet:'вход, °C', ambient:'окружающая, °C' }[k]||k}: ${this.val(T)}`).join('\n'), this.src(s.source)])); }
    const U=R.filter(r=>r.status==='unconfirmed');
    if (U.length){ w.h1('Требует подтверждения — что запросить'); w.items(U.map(r=>`${r.title} (${r.id}) — сейчас ${this.val(r.value, r.unit)}${r.note ? '. '+r.note : ''}`)); }
    return w.pack('blob');
  }
}

// ---------------------------------------------------------------- вкладка «Настроек»: инженерные правила станций
class RulesPanel {
  constructor(m){ this.m=m; this.info=null; this.data=null; this.flt=''; }
  async open(){
    try{ const [a, d]=await Promise.all([aapi('rules/stations'), StationRulesDoc.load()]); this.info=a.info; this.data=d; }
    catch(e){ this.m.innerHTML=`<p class="msg err">${esc(e.message||e)}</p>`; return; }
    this.render(); this.bind();
  }
  render(){
    const i=this.info||{}, d=this.data||{ rules:[] }, st=StationRulesDoc.STATUS, R=(d.rules||[]).filter(r=>!this.flt || r.status===this.flt);
    const chip={ confirmed:'on', practice:'', unconfirmed:'warn' };
    this.m.innerHTML=`<div class="st-card"><p style="margin:0">Действует версия <b>${esc(i.version||'—')}</b> от ${esc(i.date||'—')} — ${i.own ? `своя версия администратора${i.saved ? ` (загружена ${esc(String(i.saved.at||'').replace('T', ' '))}${i.saved.by ? ', '+esc(i.saved.by) : ''})` : ''}; в поставке — ${esc(i.bundled||'')}` : 'файл поставки программы'}.
        Правил: ${i.rules||0} (подтверждено — ${(i.byStatus||{}).confirmed||0}, практика — ${(i.byStatus||{}).practice||0}, требует подтверждения — ${(i.byStatus||{}).unconfirmed||0}); данных производителей по сериям: ${i.series||0}.</p>
        <div class="row" style="gap:8px;flex-wrap:wrap;margin-top:8px"><button class="btn" type="button" data-rl="doc">Документ «Инженерные правила и источники» (DOCX)</button>
          <button class="btn ghost" type="button" data-rl="json">Скачать файл правил (JSON)</button><button class="btn ghost" type="button" data-rl="up">Загрузить свою версию…</button>
          ${i.own ? '<button class="btn ghost" type="button" data-rl="reset">Вернуть файл поставки</button>' : ''}</div>
        <p class="muted" style="margin:8px 0 0">Свою версию готовят из скачанного файла: меняют значение, источник и статус правила, номер версии. Программа проверит структуру и не примет файл с ошибкой; прежняя версия сохраняется.</p></div>
      <div class="st-card"><label class="f" style="max-width:320px"><span>Показать</span><select data-rlf data-nodirty><option value="">все правила</option>${Object.entries(st).map(([k, t])=>`<option value="${k}"${this.flt===k ? ' selected' : ''}>${esc(t)}</option>`).join('')}</select></label>
        <div class="tzi-tw" style="max-height:none"><table class="tzi-t"><thead><tr><th>Правило</th><th>Значение</th><th>Статус</th><th>Источник</th></tr></thead><tbody>
        ${R.map(r=>`<tr><td><b>${esc(r.title)}</b><div class="muted">${esc(r.group||'')} · ${esc(r.id)}</div>${r.note ? `<div class="muted">${esc(r.note)}</div>` : ''}</td><td>${esc(StationRulesDoc.val(r.value, r.unit))}</td>
          <td><span class="chip sm ${chip[r.status]||''}">${esc(st[r.status]||r.status)}</span></td><td>${esc(StationRulesDoc.src(r.source))}</td></tr>`).join('')}</tbody></table></div></div>`;
  }
  bind(){
    this.m.onchange=e=>{ if (e.target.matches('[data-rlf]')){ this.flt=e.target.value; this.render(); } };
    this.m.onclick=async e=>{ const b=e.target.closest('[data-rl]'); if (!b) return; const a=b.dataset.rl;
      if (a==='doc') return StationRulesDoc.download();
      if (a==='json') return saveFileA(`Правила станций ${this.data.version||''}.json`, new Blob([JSON.stringify(this.data, null, 1)], { type:'application/json' }));
      if (a==='reset'){ if (!confirm('Вернуть файл правил из поставки программы? Своя версия сохранится как предыдущая.')) return; return this.post({ method:'POST', body:'' }, '?reset=1'); }
      if (a==='up'){ const f=$('#filePick'); f.value=''; f.multiple=false; f.accept='.json';
        f.onchange=()=>{ const fl=f.files[0]; f.accept=''; if (!fl) return; if (fl.size>2*1024*1024) return toast('Файл больше 2 МБ');
          this.post({ method:'POST', headers:{ 'Content-Type':'application/json; charset=utf-8' }, body:fl }); };
        f.click(); } };
  }
  async post(opts, qs=''){
    try{ const r=await aapi('rules/stations'+qs, opts); this.info=r.info; this.data=await StationRulesDoc.load(); StationRules.use(this.data);
      if (typeof StationUi!=='undefined') StationUi.cache.clear(); if (typeof StationCalc!=='undefined') StationCalc.cache.clear();
      toast('Правила станций: версия '+(this.info.version||'')); this.render(); }
    catch(e){ toast('Файл не принят: '+(e.message||e)); }
  }
}
document.addEventListener('click', e=>{ if (e.target.closest && e.target.closest('[data-rulesdoc]')) StationRulesDoc.download(); });
