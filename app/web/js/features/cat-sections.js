// Разделы каталога (решение владельца 18.10): в разделе «Оборудование» вместо плитки на каждую категорию — плитки разделов
// (группа категории: «Компрессоры», «Подготовка воздуха»…) с пиктограммой, числом позиций и крупнейшими подкатегориями;
// маленькие разделы (меньше cat.sectionMin позиций) — одной плиткой «Другое оборудование». Нажатие открывает каталог на
// разделе, подкатегории — кнопками над списком (CatalogWindow, фильтр grp).
'use strict';

DefRegistry.add([], [
  ['cat.sectionMin', 'catsearch', 'Раздел отдельной плиткой — от', 'num', '20', {unit:'позиций', req:true, min:0, max:1000,
    hint:'Разделы каталога, в которых позиций меньше, в разделе «Оборудование» собираются в одну плитку «Другое оборудование», чтобы плиток было немного. 0 — каждый раздел своей плиткой.'}],
]);

class CatSections {
  static OTHER = 'Другое оборудование';
  // пиктограмма раздела — по названию группы категорий (свои группы отдела тоже узнаются по словам)
  static ICONS = [[/компрес|воздуходув/i, 'comp'], [/воздух|осуш|фильтр|азот|кислород|конденсат/i, 'air'], [/генерат|электро|дгу|мачт/i, 'gen'],
    [/свар|резк/i, 'weld'], [/насос|мотопомп/i, 'pump'], [/холод|чиллер/i, 'cold']];
  static PATHS = {
    comp: '<rect x="6" y="34" width="52" height="20" rx="10"/><rect x="14" y="16" width="24" height="18" rx="3"/><path d="M38 22h8v12M22 16v-6h8v6"/><circle cx="50" cy="14" r="6"/><path d="M50 14l3-3M14 54v4M50 54v4"/>',
    air: '<path d="M20 8h24v8H20z"/><path d="M22 16v22a10 10 0 0 0 20 0V16"/><path d="M27 24h10M27 30h10M27 36h10"/><path d="M32 48v6"/><path d="M50 40c0 4-3 7-5 7s-5-3-5-7 5-10 5-10 5 6 5 10z"/>',
    gen: '<rect x="6" y="20" width="52" height="30" rx="4"/><path d="M12 50v6M52 50v6M14 28h14v14H14z"/><path d="M42 26l-6 10h8l-6 10"/>',
    weld: '<path d="M14 10h36l4 14v14a22 18 0 0 1-44 0V24z"/><rect x="20" y="22" width="24" height="10" rx="2"/><path d="M32 46v12M26 58h12"/>',
    pump: '<circle cx="26" cy="34" r="14"/><circle cx="26" cy="34" r="4"/><path d="M26 20h20v-8h8v16h-8v-8"/><path d="M40 34h16M12 54h32M18 48l-4 6M34 48l4 6"/>',
    cold: '<path d="M32 6v52M9 19l46 26M55 19L9 45"/><path d="M26 10l6 6 6-6M26 54l6-6 6 6"/>',
    other: '<rect x="8" y="22" width="48" height="32" rx="4"/><path d="M24 22v-8h16v8M8 34h48M28 34v6h8v-6"/>',
    box: '<rect x="4" y="18" width="56" height="30" rx="2"/><path d="M14 18v30M24 18v30M34 18v30M44 18v30M54 18v30M4 48h56v4H4z"/>' };
  static _c = null;       // {types, cat, list, byCat} — пересчёт, когда сменились категории или каталог

  static svg(k, cls='sec-i'){ return `<svg class="${cls}" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${this.PATHS[k]||this.PATHS.other}</svg>`; }
  static iconOf(name){ const m=this.ICONS.find(([rx])=>rx.test(name)); return m ? m[1] : 'other'; }

  /** разделы: [{key, name, icon, n, types:[{id, name, n}] — по убыванию числа позиций}]; key — имя группы (или OTHER) */
  static list(){
    const c=this._c; if (c && c.types===TYPES && c.cat===catCache) return c.list;
    const cnt=new Map(); for (const x of catCache){ const k=attrsOf(x).cat; cnt.set(k, (cnt.get(k)||0)+1); }
    const groups=new Map();
    for (const t of TYPES){ if (t.station || t.role==='accessory') continue; const g=t.group||'Прочее';
      if (!groups.has(g)) groups.set(g, []); groups.get(g).push({id:t.id, name:t.name, n:cnt.get(t.id)||0}); }
    const min=catCache.length ? Math.round(DEFN('cat.sectionMin', 20)) : 0, out=[], rest=[];
    for (const [g, ts] of groups){ const n=ts.reduce((a, t)=>a+t.n, 0);
      if ((n<min || /^прочее$/i.test(g)) && groups.size>1) rest.push(...ts); else out.push({key:g, name:g, icon:this.iconOf(g), n, types:ts}); }
    if (rest.length) out.push({key:this.OTHER, name:this.OTHER, icon:'other', n:rest.reduce((a, t)=>a+t.n, 0), types:rest});
    for (const s of out) s.types.sort((a, b)=>b.n-a.n || a.name.localeCompare(b.name, 'ru'));
    const byCat=new Map(); for (const s of out) for (const t of s.types) byCat.set(t.id, s.key);
    this._c={types:TYPES, cat:catCache, list:out, byCat};
    return out;
  }
  static keyOf(cat){ this.list(); return this._c.byCat.get(cat) || ''; }
  static get(key){ return this.list().find(s=>s.key===key) || null; }

  /** плитки раздела «Оборудование» (пустой КП) */
  static tiles(){
    return this.list().map(s=>{ const top=s.types.filter(t=>t.n).slice(0, 3).map(t=>`${t.name} ${Fmt.num(t.n)}`).join(' · ');
      return `<button type="button" class="tile sec${s.n?'':' zero'}" data-a="secOf" data-sec="${esc(s.key)}">${this.svg(s.icon)}<b>${esc(s.name)}</b>
        <em>${s.n?Fmt.num(s.n):'пусто'}</em><span>${s.n ? esc(s.types.filter(t=>t.n).length>1 ? top : 'в каталоге') : 'добавить вручную'}</span></button>`; }).join(''); }

  /** нажата плитка раздела: одна категория — сразу она, пустой раздел — новое оборудование, иначе — каталог на разделе */
  static open(key){ const s=this.get(key); if (!s) return openCatalog({});
    const full=s.types.filter(t=>t.n);
    if (!full.length) return EquipWizard.open('kp', s.types[0].id);
    if (full.length===1) return openCatalog({cat:full[0].id});
    return openCatalog({grp:key}); }
}
