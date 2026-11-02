// Шаблон «ПНЕВМОТЕХ НОВЫЙ» (templates/pnevmotekh_new): документ на вымышленных КП — 1, 4, 9 и 13 позиций, опции,
// скидка, НДС 0 %, валюта (курс ЦБ и курс расчёта), станция со составом, графический редактор, «трудное» КП (ДГУ с
// текстовыми параметрами и строкой-сводкой, сроки поставки по позициям). Разметка Word без ошибок, титул — один лист
// отдельным разделом без полей, без полей ячеек сверху и снизу в строках точной высоты и с запасом внизу (Word прибавляет
// такое поле к высоте строки), суммы и надписи — на месте; плитки — только числа полными рядами, условия — плитками по
// числу, позиции подряд, совсем небольшие — по две в ряд; форма редактора (editor.json) — только существующие
// настройки; картинки шаблона (значки, логотип) — именами, которые отдаёт сервер; KpDocx: картинки шаблона и
// «Действует до …».
// Запуск из корня репозитория: node tests/js/tpl_new.js — код выхода 0, если всё прошло (tests/test_tpl_new.py).
'use strict';
const path=require('path'), fs=require('fs'), assert=require('assert');
const ROOT=path.resolve(__dirname, '..', '..');
const JS=path.join(ROOT, 'app', 'web', 'js');
const DIR=path.join(ROOT, 'templates', 'pnevmotekh_new');
global.document={ addEventListener(){} };
require('./web.js');
require(path.join(JS, 'docx', 'kpgen.js'));
const JSZip=require(path.join(ROOT, 'app', 'web', 'vendor', 'jszip.min.js'));
const mod=file=>require(path.join(JS, file));
const { DocxRoots }=mod('features/doc/docx-roots.js');
const { KpDocx }=mod('features/doc/kp-docx.js');
const { Templates }=mod('features/doc/templates.js');
const { KpState }=mod('core/state.js');
const { KpDate }=mod('core/kp-date.js');
const { WordCheck }=mod('features/doc/word-check.js');

const TEXT=fs.readFileSync(path.join(DIR, 'skeleton.js'), 'utf8');
const SKEL=KPGen.loadSkeleton(TEXT);
const JSON_TPL=JSON.parse(fs.readFileSync(path.join(DIR, 'template.json'), 'utf8'));
const SETTINGS=KPGen.deepMerge(SKEL.defaults, JSON_TPL);
const PAGE_H=16838;   // А4, твипы
const IMAGE_NAME=/^[A-Za-z0-9_-]+\.(jpg|jpeg|png)$/;   // kp_templates.TPL_FILES: картинки шаблона, которые отдаёт сервер

const swap=async (pairs, fn)=>{
  const saved=pairs.map(([owner, name])=>[owner, name, owner[name]]);
  for (const [owner, name, value] of pairs) owner[name]=value;
  try { return await fn(); } finally { for (const [owner, name, value] of saved) owner[name]=value; }
};

// разметка XML: теги закрыты по порядку, атрибуты в кавычках, «&» — только сущностью
const wellFormed=(xml, what)=>{
  const body=xml.replace(/^<\?xml[^>]*\?>\s*/, '');
  const stack=[], tag=/<(\/?)([A-Za-z_][\w:.-]*)((?:\s+[\w:.-]+="[^"<]*")*)\s*(\/?)>/g;
  let at=0, match;
  while ((match=tag.exec(body))) {
    const between=body.slice(at, match.index);
    assert.ok(!/[<>]/.test(between), `${what}: лишний знак разметки около «${between.slice(0, 80)}»`);
    assert.ok(!/&(?!(amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);)/.test(between), `${what}: «&» без сущности около «${between.slice(0, 80)}»`);
    const [, close, name, , self]=match;
    if (close) assert.strictEqual(stack.pop(), name, `${what}: </${name}> закрывает не свой тег`);
    else if (!self) stack.push(name);
    at=tag.lastIndex;
  }
  assert.ok(!/[<>]/.test(body.slice(at)), `${what}: хвост после последнего тега`);
  assert.deepStrictEqual(stack, [], `${what}: не закрыты ${stack.join(', ')}`);
};
const textOf=xml=>[...xml.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g)].map(m=>m[1]).join('')
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"');
const has=(text, re, what)=>assert.ok(re.test(text), `${what}: нет ${re}`);

// ---------------------------------------------------------------- вымышленные КП
const COND=[
  ['Срок поставки', '30 календарных дней с даты подписания договора'],
  ['Условия оплаты', '100 % в течение 10 рабочих дней после поставки'],
  ['Гарантия', '12 месяцев с даты ввода в эксплуатацию'],
  ['Доставка', 'Доставка до объекта включена по адресу: г. Пример, ул. Тестовая, д. 1'],
  ['Срок действия предложения', '30 дней'],
  ['Монтаж, ШМР и ПНР', 'Шефмонтаж входит в стоимость'],
].map(([label, value])=>({ label, value }));
const groups=(main, extra)=>[{ name:'Основные', rows:[{ k:'Производительность', v:main, hl:true }, { k:'Рабочее давление', v:'8 бар', hl:true },
  { k:'Мощность двигателя', v:'15 кВт', hl:true }, { k:'Охлаждение', v:'воздушное' }] }].concat(extra || []);
const item=(n, over)=>Object.assign({ id:'i'+n, name:`Винтовой компрессор Пример ВК-${n}`, qty:1, price:10000000*n, page:true,   // цены — в копейках, как KpDocx.state()
  spec:'2,2 м³/мин · 8 бар · 15 кВт', options:[],
  features:[{ id:'f'+n, label:'Назначение', text:'Снабжение сжатым воздухом производственных участков & цехов.' }],
  groups:groups('2,2 м³/мин (2 200 л/мин)') }, over || {});
const station=()=>item(90, { name:'Компрессорная станция Пример ВК-220Т в блок-контейнере', price:180000000,
  spec:'10 м³/мин · 9,7 бар · 67,9 кВт · 4 500 × 2 400 × 3 100 мм',
  kit:{ parts:[
    { id:'p1', name:'Винтовой компрессор Пример ВК-220Т', qty:1, maker:'Пример', model:'ВК-220Т', desc:'Винтовой маслозаполненный компрессор.',
      rows:[{ k:'Производительность', v:'10,0 м³/мин' }, { k:'Мощность', v:'67,9 кВт' }] },
    { id:'p2', name:'Осушитель рефрижераторный Пример ОР-102', qty:1, rows:[{ k:'Пропускная способность', v:'18,6 м³/мин' }] },
    { id:'p3', name:'Блок-контейнер утеплённый', qty:1, card:false, rows:[{ k:'Габариты', v:'4 500 × 2 400 × 3 100 мм' }] },
  ] },
  groups:groups('10 м³/мин', [{ name:'Контейнер', rows:[{ k:'Климатическое исполнение', v:'УХЛ1' }] }]) });
const base=items=>({
  number:'2026-001', date:'2026-11-02', validUntil:'2026-12-02', vat:22, cur:{ code:'RUB', rate:null, date:'', own:false },
  client:'ООО «Пример»', clientInn:'7700000094', contact:{ name:'Петров Пётр Сергеевич', post:'главный инженер' },
  object:{ purpose:'', address:'г. Пример, ул. Тестовая, д. 1' },
  manager:{ name:'Иванова Анна Сергеевна', position:'Менеджер', phone:'+7 (900) 000-00-00', mobile:'+7 (900) 000-00-01', email:'ivanova@example.com',
    site:'www.example.com', hours:'', address:'' },
  conditions:JSON.parse(JSON.stringify(COND)), condExtra:'Цена действительна при заказе всего комплекта.', showClients:true,
  cover:{ title:'Компрессорное оборудование', model:items.length+' модели', desc:'', kpis:[], photoFrom:items[0].id }, items,
});
const pic=(w, h, file)=>({ file, w, h });
const mediaOf=state=>{
  const items={};
  state.items.forEach((it, i)=>{ items[it.id]={ gallery:[], featImgs:{}, tile:i % 3 === 2 ? null : pic(1300, 860, `tile_${it.id}.png`) }; });
  const station=state.items.find(it=>it.kit);
  if (station) items[station.id].kitImgs={ p1:pic(800, 600, 'kit_p1.jpg') };
  const assets=Object.fromEntries(Object.keys(SETTINGS.assets).map(key=>[key, pic(key === 'coverLogo' ? 1200 : 96, key === 'coverLogo' ? 280 : 96, `tpla_${key}.png`)]));
  return { cover:null, items, assets };
};
const SCENARIOS={
  one:()=>{ const s=base([item(1, { disc:{ type:'pct', v:5 }, options:[{ name:'Комплект фильтров на первое ТО', qty:1, unit:'компл.', price:0 },
    { name:'Масло компрессорное, 20 л', qty:2, unit:'шт.', price:1480000 }] })]);
  s.cover={ title:'Винтовые компрессоры', model:'Пример ВК-1', desc:'Снабжение сжатым воздухом производственных участков.',
    kpis:[{ num:'2,2', unit:'м³/мин', cap:'Производительность' }, { num:'8', unit:'бар', cap:'Рабочее давление' }, { num:'15', unit:'кВт', cap:'Мощность' }], photoFrom:'i1' };
  return s; },
  four:()=>base([item(1, { disc:{ type:'pct', v:5 } }), item(2, { qty:2 }), item(3), station()]),
  nine:()=>base([1, 2, 3, 4, 5, 6, 7, 8, 9].map(n=>item(n))),
  thirteen:()=>base([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13].map(n=>item(n, { name:`Фильтр магистральный Пример ФМ-${n}0-16 с автоматическим конденсатоотводчиком` }))),
  vat0:()=>{ const s=base([item(1), item(2)]); s.vat=0; s.client='ИП Сидоров С. С.'; s.clientInn=''; s.contact={}; s.object={}; s.condExtra='';
    s.showClients=false; s.validUntil=''; return s; },
  usdCbr:()=>{ const s=base([item(1), item(2)]); s.cur={ code:'USD', rate:95.5, date:'2026-11-01', own:false }; return s; },
  usdOwn:()=>{ const s=base([item(1), item(2)]); s.cur={ code:'USD', rate:97, date:'', own:true }; return s; },
  station:()=>{ const s=base([station()]); s.cover={ title:'Компрессорная станция в блок-контейнере', model:'Пример ВК-220Т в блок-контейнере',
    desc:'Готовая станция.', kpis:[{ num:'10', unit:'м³/мин', cap:'Производительность' }], photoFrom:'i90' }; return s; },
};

// base.docx шаблона: связи и последний раздел — как TemplateBase.read и KpDocx.render (шапка из настроек)
let BASE=null;
const baseParts=async ()=>{
  if (BASE) return BASE;
  const zip=await JSZip.loadAsync(fs.readFileSync(path.join(DIR, 'base.docx')));
  const rels=await zip.file('word/_rels/document.xml.rels').async('string');
  const documentXml=await zip.file('word/document.xml').async('string');
  const fonts=await zip.file('word/fontTable.xml').async('string');
  const keep=(rels.match(/<Relationship\s[^>]*\/>/g) || []).filter(rel=>!/\/(image|hyperlink)"/.test(rel));
  const sects=documentXml.match(/<w:sectPr[\s\S]*?<\/w:sectPr>/g) || [];
  const sect=sects[sects.length-1].replace(/<w:headerReference[^>]*\/>/g, '').replace(/<w:titlePg\/>/g, '')
    .replace(/(<w:sectPr[^>]*>)/, '$1<w:headerReference w:type="default" r:id="rIdKpHeader"/>');
  BASE={ zip, rels:keep.join('')+'<Relationship Id="rIdKpHeader" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header_kp.xml"/>', sect, fonts };
  return BASE;
};
const build=async (state, extra)=>{
  const parts=await baseParts();
  const options={ ...SETTINGS, ...(extra || {}), rels:parts.rels, sect:parts.sect, clients:{ rid:'rIdTplClients', file:'tpl_clients.jpg', w:1600, h:1200 },
    headerLogo:{ rid:'rIdHdrLogo', file:'tpl_hdr_logo.png', w:1200, h:280 } };
  const res=SKEL.build(state, mediaOf(state), DocxRoots.all(), options);
  for (const [key, xml] of [['document', res.document], ['footer', res.footer], ['rels', res.rels], ['header', res.header]]) wellFormed(xml, key);
  const text=textOf(res.document);
  assert.ok(!/undefined|NaN|\[object Object\]|\bnull\b/.test(text + textOf(res.header) + textOf(res.footer)), 'в тексте нет undefined, NaN, null');
  assert.ok(!res.document.includes('\u0001'), 'служебные метки разделов убраны');
  // каждая картинка документа и шапки — со связью
  const ids=new Set([...res.rels.matchAll(/Id="([^"]+)"/g)].map(m=>m[1]));
  for (const [, rid] of res.document.matchAll(/r:(?:embed|id)="([^"]+)"/g)) assert.ok(ids.has(rid), 'нет связи '+rid);
  return { ...res, text };
};
// титул — первый раздел Word: без полей, без шапки, строки — точной высоты и не выше листа
const coverOf=documentXml=>{
  const end=documentXml.indexOf('<w:sectPr');
  const sectEnd=documentXml.indexOf('</w:sectPr>', end);
  assert.ok(end > 0 && sectEnd < documentXml.lastIndexOf('<w:sectPr'), 'титул — отдельным разделом');
  const sect=documentXml.slice(end, sectEnd);
  assert.ok(/<w:pgMar w:top="0" w:right="0" w:bottom="0" w:left="0"/.test(sect), 'у титула нет полей: '+sect.slice(0, 300));
  assert.ok(!/headerReference|footerReference/.test(sect), 'у титула нет колонтитулов');
  const cover=documentXml.slice(0, end);
  assert.ok(!/<w:br w:type="page"\/>|<w:pageBreakBefore\/>/.test(cover), 'внутри титула нет разрывов страниц');
  const rows=[...cover.matchAll(/<w:trHeight w:val="(\d+)" w:hRule="exact"\/>/g)].map(m=>+m[1]);
  assert.ok(rows.length >= 4, 'строки титула — точной высоты');
  return { xml:cover, height:rows.slice(0, 4).reduce((a, b)=>a+b, 0) };
};

// таблицы и строки верхнего уровня (вложенные таблицы — внутри своих ячеек)
const tagsOf=(xml, names)=>[...xml.matchAll(new RegExp(`<(/?)(${names})(?=[\\s>/])[^>]*>`, 'g'))];
const topTables=xml=>{
  const out=[];
  let depth=0, start=0;
  for (const m of tagsOf(xml, 'w:tbl')) {
    if (!m[1]) { if (!depth) start=m.index; depth++; } else { depth--; if (!depth) out.push(xml.slice(start, m.index+m[0].length)); }
  }
  return out;
};
const partsOf=(tblXml, name)=>{   // строки (w:tr) или ячейки (w:tc) самой таблицы, без вложенных
  const out=[];
  let depth=0, start=-1;
  for (const m of tagsOf(tblXml, 'w:tbl|'+name)) {
    if (m[2] === 'w:tbl') { depth+=m[1] ? -1 : 1; continue; }
    if (depth !== 1) continue;
    if (!m[1]) start=m.index; else if (start >= 0) { out.push(tblXml.slice(start, m.index+m[0].length)); start=-1; }
  }
  return out;
};
const styled=(xml, style)=>[...xml.matchAll(new RegExp(`<w:r><w:rPr><w:rStyle w:val="KPS_${style}"/>[\\s\\S]*?<w:t xml:space="preserve">([^<]*)</w:t>`, 'g'))].map(m=>m[1]);
const NUMVAL=/^\s*(?:(?:до|от|не\s+более|не\s+менее|не\s+выше|не\s+ниже)\s+|[≤≥<>~±]\s*)?\d/i;

// «трудное» КП (как КП владельца 30.10): ДГУ с параметрами-текстом («В кожухе»), строкой-сводкой и пустым значением,
// дизельный компрессор с текстовыми параметрами, ресивер; сроки поставки по позициям — длинным условием
const hardRows=(rows, hl)=>rows.map(([k, v], i)=>(i < hl ? { k, v, hl:true } : { k, v }));
const LEAD='ДГУ Пример-600 в кожухе — под заказ, 16 рабочих дней; ДГУ Пример-56 в кожухе с АВР — под заказ, 7 рабочих дней; '+
  'Дизельный компрессор Пример ДК-12/7 — под заказ, 80 рабочих дней';
const hard=()=>{
  const long='Основное или резервное электроснабжение объектов: производство, стройка, склады. ';
  const dgu=item(1, { name:'ДГУ Пример-600 в кожухе', qty:2, spec:'600 кВт · В кожухе · 400 В · 50 Гц',
    features:[{ id:'h1', label:'Назначение', text:long.repeat(4) }, { id:'h2', label:'Комплектация', text:long.repeat(12) }],
    groups:[{ name:'Характеристики', rows:hardRows([['Исполнение', 'В кожухе'], ['Мощность номинальная', '600 кВт'], ['Выходное напряжение', '230 / 400 В'],
      ['Частота', '50 Гц'], ['Двигатель', 'Мотор-Пример'], ['Альтернатор', 'Генератор-Пример'], ['Контроллер', 'Контроллер-Пример'],
      ['Гарантия, месяцев / моточасов', '/'], ['Двигатель / альтернатор', 'Мотор-Пример / Генератор-Пример / Контроллер-Пример']], 4) }] });
  const small=item(2, { name:'ДГУ Пример-56 в кожухе с АВР', qty:2, groups:[{ name:'Основные', rows:hardRows([['Исполнение', 'в кожухе'],
    ['Резервная мощность (ESP)', '63 кВА / 50 кВт'], ['Основная мощность (PRP)', '56 кВА / 45 кВт'], ['При нагрузке 100 %', '12,9 л/ч']], 4)
    .concat(Array.from({ length:16 }, (_, i)=>({ k:'Параметр '+(i+1), v:String(i+1)+' ед.' }))) }] });
  const comp=item(3, { name:'Дизельный компрессор Пример ДК-12/7', features:[{ id:'c1', label:'Назначение', text:long.repeat(14) }],
    groups:[{ name:'Характеристики', rows:hardRows([['Серия', 'ДК'], ['Тип', 'Дизельный компрессор'], ['Производительность', '12,5 м³/мин'],
      ['Давление', '7 бар'], ['Мощность', '93 кВт']], 4) }] });
  const recv=item(4, { name:'Воздушный ресивер Пример РВ 900/10', groups:[{ name:'Основные', rows:hardRows([['Объём', '900 л'], ['Давление', 'до 10 атм']], 2) }] });
  const s=base([dgu, small, comp, recv]);
  s.validUntil='';
  s.conditions=[{ label:'Срок поставки', value:LEAD }, { label:'Доставка', value:'Доставка до объекта включена' }];
  s.condExtra='';
  return s;
};

const checks=[];
const check=(name, fn)=>checks.push([name, fn]);

check('папка шаблона: файлы на месте, картинки шаблона — именами, которые отдаёт сервер; Golos Text встроен в base.docx', async ()=>{
  for (const file of ['template.json', 'skeleton.js', 'editor.json', 'base.docx', 'OFL-GolosText.txt']) assert.ok(fs.existsSync(path.join(DIR, file)), file);
  assert.deepStrictEqual(SKEL.features, ['discount', 'header', 'images', 'design', 'kit', 'sign', 'assets', 'flow']);
  for (const [key, file] of Object.entries(SETTINGS.assets)) {
    assert.ok(KpDocx.ASSET_KEY.test(key), 'ключ '+key);
    assert.ok(IMAGE_NAME.test(file) && fs.existsSync(path.join(DIR, file)), 'картинка '+file);
  }
  for (const file of [SETTINGS.header.logo, SETTINGS.clientsImage]) assert.ok(IMAGE_NAME.test(file) && fs.existsSync(path.join(DIR, file)), file);
  assert.strictEqual(JSON_TPL.name, 'ПНЕВМОТЕХ НОВЫЙ');
  const { zip, fonts }=await baseParts();
  // Golos Text: обычный и жирный, Golos Text SemiBold — обычный; у каждого — файл шрифта в документе
  const embeds=[...fonts.matchAll(/<w:font w:name="([^"]+)">([\s\S]*?)<\/w:font>/g)].flatMap(([, name, body])=>
    [...body.matchAll(/<w:embed(\w+) r:id="([^"]+)"/g)].map(([, face, rid])=>[name+' '+face, rid]));
  assert.deepStrictEqual(embeds.map(([face])=>face).sort(), ['Golos Text Bold', 'Golos Text Regular', 'Golos Text SemiBold Regular']);
  const fontRels=await zip.file('word/_rels/fontTable.xml.rels').async('string');
  for (const [face, rid] of embeds) {
    const target=(fontRels.match(new RegExp(`Id="${rid}"[^>]*Target="([^"]+)"`)) || [])[1];
    assert.ok(target && zip.file('word/'+target), 'файл шрифта '+face);
  }
  const settings=await zip.file('word/settings.xml').async('string');
  assert.ok(settings.includes('<w:embedTrueTypeFonts/>'), 'встроенные шрифты включены');
  const types=await zip.file('[Content_Types].xml').async('string');
  assert.ok(types.includes('Extension="odttf"'), 'тип встроенного шрифта');
});

check('форма редактора (editor.json): каждое поле — существующая настройка шаблона, надписи и стили — все', ()=>{
  const editor=JSON.parse(fs.readFileSync(path.join(DIR, 'editor.json'), 'utf8'));
  const fields=editor.tabs.flatMap(tab=>tab.fields || []).filter(field=>field.key);
  const valueAt=key=>key.split('.').reduce((value, part)=>value == null ? undefined : value[part], SETTINGS);
  // картинки (подпись, печать) — файлы, которые администратор загружает сам: до загрузки настройки нет
  for (const field of fields.filter(one=>one.type !== 'image')) assert.notStrictEqual(valueAt(field.key), undefined, 'нет настройки '+field.key);
  const keys=new Set(fields.map(field=>field.key));
  for (const group of ['texts', 'styles']) {
    const missing=Object.keys(SETTINGS[group]).filter(name=>!keys.has(`${group}.${name}`));
    assert.deepStrictEqual(missing, [], `${group}: без поля в форме`);
  }
});

check('одна позиция: титул — один лист, «Действует до», скидка, опции и «Итого по позиции»', async ()=>{
  const res=await build(SCENARIOS.one());
  const cover=coverOf(res.document);
  assert.ok(cover.height <= PAGE_H, `титул выше листа: ${cover.height}`);
  const coverText=textOf(cover.xml);
  has(coverText, /Действует до 2 декабря 2026/, 'титул');
  has(coverText, /с учётом скидки/, 'скидка на титуле');
  has(coverText, /В предложение также входит/, 'опции на титуле');
  has(res.text, /Итого по позиции 1/, 'карточка позиции');
  has(res.text, /Масло компрессорное, 20 л/, 'опция');
  has(res.text, /в т\. ч\. НДС 22 %/, 'НДС');
  has(textOf(res.footer), /стр\./, 'нижний колонтитул');
  assert.ok(/PAGE/.test(res.footer) && /NUMPAGES/.test(res.footer), 'номер страницы и число страниц');
  has(textOf(res.header), /Коммерческое предложение/, 'шапка внутренних страниц');
});

check('четыре позиции и станция: «Состав предложения», «В составе: …», «Состав изделия», итог', async ()=>{
  const state=SCENARIOS.four();
  const res=await build(state);
  const cover=coverOf(res.document);
  assert.ok(cover.height <= PAGE_H, `титул выше листа: ${cover.height}`);
  const coverText=textOf(cover.xml);
  has(coverText, /Состав предложения/, 'титул');
  state.items.forEach(it=>assert.ok(coverText.includes(it.name.slice(0, 20)) || coverText.includes(it.name.split(' ').slice(0, 2).join(' ')), 'на титуле '+it.name));
  has(res.text, /В составе: /, 'части станции в карточке');
  // «В составе» — состав одного изделия и на титуле, и в карточке (было: в карточке — умножено на количество позиций)
  const two=SCENARIOS.station(); two.items[0].qty=2; two.items[0].kit.parts[0].qty=2;
  const twoRes=await build(two);
  assert.ok(!/ — 4\sшт\./.test(twoRes.text) && (twoRes.text.match(/В составе: Винтовой компрессор Пример ВК\W?220Т × 2/g) || []).length === 2, 'состав на одно изделие — на титуле и в карточке');
  has(res.text, /Состав изделия/, 'таблица состава станции');
  has(res.text, /Итого к оплате с НДС/, 'итог');
  // сумма: 100 000 × 0,95 + 200 000 × 2 + 300 000 + 1 800 000 = 2 595 000
  has(res.text, /2\s595\s000,00/, 'итоговая сумма');
  has(res.text, /Условия поставки/, 'условия');
  has(res.text, /Шефмонтаж входит в стоимость/, 'плитка условия');
  has(res.text, /Срок действия предложения30 дней — до 2 декабря 2026/i, 'срок действия с датой');
});

check('девять и тринадцать позиций: титул остаётся одним листом, лишние — «и ещё N позиций»', async ()=>{
  for (const name of ['nine', 'thirteen']) {
    const res=await build(SCENARIOS[name]());
    const cover=coverOf(res.document);
    assert.ok(cover.height <= PAGE_H, `${name}: титул выше листа: ${cover.height}`);
    if (name === 'thirteen') has(textOf(cover.xml), /и ещё 4\sпозиции/, 'тринадцать');
  }
});

check('НДС 0 %, без «Действует до», клиента-ИП и «Наших клиентов»', async ()=>{
  const res=await build(SCENARIOS.vat0());
  has(res.text, /в т\. ч\. НДС 0 %/, 'НДС 0');
  assert.ok(!/НДС 22/.test(res.text), 'нет НДС 22 %');
  assert.ok(!/Действует до/.test(textOf(coverOf(res.document).xml)), 'без срока действия — без плашки');
  assert.ok(!/Наши клиенты/.test(res.text), 'без «Наших клиентов»');
});

check('валюта: курс ЦБ — «курс ЦБ РФ на …», договорной — «курс расчёта» без ЦБ', async ()=>{
  const cbr=await build(SCENARIOS.usdCbr());
  has(cbr.text, /курс ЦБ РФ на 1 ноября 2026/, 'курс ЦБ');
  const own=await build(SCENARIOS.usdOwn());
  has(own.text, /Справочно: курс расчёта — 1 \S+ = 97 руб\./, 'курс расчёта');
  assert.ok(!/курс ЦБ РФ на/.test(own.text), 'договорной — без даты ЦБ');
});

check('станция одной позицией и графический редактор: пометки стилей, разделов и мест привязки', async ()=>{
  const res=await build(SCENARIOS.station());
  coverOf(res.document);
  has(res.text, /Состав изделия/, 'станция');
  const design=await build(SCENARIOS.four(), { design:true });
  for (const section of ['cover', 'offer', 'conditions', 'equipment', 'contacts']) assert.ok(design.document.includes(`KPSEC_${section}`), 'раздел '+section);
  assert.ok(/KPS_coverModel/.test(design.document) && /KPANC_coverTop/.test(design.document), 'стили и места привязки');
});

check('KpDocx: картинки шаблона — только допустимые ключи и найденные файлы; «Действует до …» — по сроку действия', async ()=>{
  const zip=new JSZip();
  const files={ 'ic_ok.png':{ buf:Buffer.from('png'), ext:'png', w:96, h:96 } };
  const assets=await swap([[Templates, 'image', async (pack, file)=>files[file] || null]], ()=>KpDocx._assets(zip, {}, { assets:{
    icOk:'ic_ok.png', 'bad key':'ic_ok.png', '../up':'ic_ok.png', icNone:'ic_none.png', icNum:5 } }));
  assert.deepStrictEqual(Object.keys(assets), ['icOk']);
  assert.deepStrictEqual(assets.icOk, { file:'tpla_icOk.png', w:96, h:96 });
  assert.ok(zip.file('word/media/tpla_icOk.png'), 'файл в документе');
  const state={ number:'2026-001', date:'2026-11-02', items:[], vat:22, pricing:{ cur:'RUB', rates:{} },
    conditions:[{ label:'Срок действия предложения', value:'30 дней' }] };
  const got=await swap([[KpState, 'replace', KpState.replace]], ()=>{ KpState.replace(state); return KpDocx.state(); });
  assert.strictEqual(got.validUntil, KpDate.validUntil(state));
  assert.ok(/^2026-12-0[12]$/.test(got.validUntil), got.validUntil);
});

check('Word: титул — строки точной высоты без полей ячеек сверху и снизу, с запасом внизу листа (coverReserveCm)', async ()=>{
  for (const name of ['one', 'four', 'nine', 'thirteen', 'station', 'vat0']) {
    const res=await build(SCENARIOS[name]());
    const cover=coverOf(res.document), table=topTables(cover.xml)[0];
    const rows=partsOf(table, 'w:tr');
    assert.ok(rows.every(row=>/<w:trHeight w:val="\d+" w:hRule="exact"\/>/.test(row)), name+': все строки — точной высоты');
    const total=rows.reduce((sum, row)=>sum+ +row.match(/<w:trHeight w:val="(\d+)"/)[1], 0);
    assert.ok(total <= PAGE_H-Math.round(SETTINGS.rules.coverReserveCm * 567)-120, `${name}: титул ${total} — без запаса внизу листа`);
    for (const row of rows) for (const cell of partsOf(row.replace(/^<w:tr>/, '<w:tbl><w:tr>')+'</w:tbl>', 'w:tc')) {
      const mar=cell.match(/<w:tcMar><w:top w:w="(\d+)"[^>]*\/><w:left[^>]*\/><w:bottom w:w="(\d+)"/);
      assert.ok(mar && mar[1] === '0' && mar[2] === '0', name+': поле ячейки сверху или снизу в строке точной высоты');
    }
  }
});

check('трудное КП: срок на титуле — коротко, условия плитками по числу, плитки — только числа, без строк-сводок', async ()=>{
  const res=await build(hard(), { design:true });
  const coverText=textOf(coverOf(res.document).xml);
  has(coverText, /Срок поставкипод заказ, до 80 рабочих дней/, 'срок на титуле — по самой долгой позиции');
  assert.ok(!coverText.includes('16 рабочих дней'), 'на титуле — без сроков по позициям');
  // в «Условиях поставки» — сроки по позициям, каждый своей строкой, плиткой во всю ширину
  const conds=topTables(res.document).find(t=>textOf(t).includes('Условия поставки'));
  assert.ok(conds, 'условия — одним блоком');
  const tiles=topTables(partsOf(conds, 'w:tc')[0].replace(/^<w:tc>[\s\S]*?<\/w:tcPr>/, ''));
  const perRow=tiles.map(t=>[...t.matchAll(/KPS_label/g)].length);
  assert.deepStrictEqual(perRow, [1, 1], 'длинное условие и одно короткое — каждое во всю ширину');
  const paras=t=>t.match(/<w:p>[\s\S]*?<\/w:p>/g).filter(x=>x.includes('KPS_condText'));
  assert.strictEqual(paras(tiles[0]).length, LEAD.split('; ').length, 'срок каждой позиции — своей строкой');
  for (const t of tiles) for (const p of paras(t)) assert.ok(p.includes('<w:suppressAutoHyphens/>'), 'текст условия — без переносов слов');
  // два коротких условия — пополам, четыре — по два в ряд
  const rowsOf=async values=>{ const s=hard(); s.conditions=values.map((v, i)=>({ label:'Условие '+(i+1), value:v }));
    const doc=(await build(s, { design:true })).document, box=topTables(doc).find(t=>textOf(t).includes('Условия поставки'));
    return topTables(partsOf(box, 'w:tc')[0].replace(/^<w:tc>[\s\S]*?<\/w:tcPr>/, '')).map(t=>[...t.matchAll(/KPS_label/g)].length); };
  assert.deepStrictEqual(await rowsOf(['коротко', 'коротко']), [2], 'два — пополам');
  assert.deepStrictEqual(await rowsOf(['а', 'б', 'в', 'г']), [2, 2], 'четыре — по два');
  assert.deepStrictEqual(await rowsOf(['а', 'б', 'в', 'г', 'д']), [3, 2], 'пять — три и два');
  // плитки параметров — числа с единицами, полными рядами по три (или одним рядом)
  const values=styled(res.document, 'heroValue');
  assert.ok(values.length && values.every(v=>NUMVAL.test(v)), 'плитки — только числа: '+values.join(' | '));
  assert.ok(!values.some(v=>/кожух|Дизельный|^ДК$/.test(v)), 'текст — не в плитках');
  // строка-сводка и пустое значение — не в КП, их части — на месте
  assert.ok(!res.text.includes('Мотор-Пример / Генератор-Пример'), 'строка-сводка не печатается');
  assert.ok(!res.text.includes('Гарантия, месяцев / моточасов'), 'строка без значения не печатается');
  for (const part of ['Мотор-Пример', 'Генератор-Пример', 'Контроллер-Пример']) assert.ok(res.text.includes(part), part);
});

check('позиции подряд: заголовок позиции с её фото — одним блоком, разрыв листа — только по правилу «Каждая с нового листа»', async ()=>{
  const state=hard();
  const res=await build(state);
  assert.ok(!res.document.includes('<w:pageBreakBefore/>'), 'по умолчанию позиции и контакты — без разрыва листа');
  const tops=topTables(res.document), rels=res.rels;
  for (const n of [1, 2, 3]) {
    const block=tops.find(t=>textOf(t).includes(`Позиция ${n} из 4`));
    const rid=(rels.match(new RegExp(`Id="([^"]+)"[^>]*Target="media/tile_i${n}\\.png"`)) || [])[1];
    assert.ok(block && partsOf(block, 'w:tr').length === 1, `позиция ${n}: заголовок — в строке-блоке`);
    if (rid) assert.ok(block.includes(`r:embed="${rid}"`), `позиция ${n}: фото — в том же блоке, что и заголовок`);
    assert.ok(/<w:trPr><w:cantSplit\/>/.test(partsOf(block, 'w:tr')[0]), `позиция ${n}: блок не разрывается`);
  }
  const each=await build(hard(), { rules:{ ...SETTINGS.rules, posNewPage:true } });
  assert.strictEqual((each.document.match(/<w:pageBreakBefore\/>/g) || []).length, 2, 'каждая крупная с нового листа — кроме первой');
  // характеристики: заголовок держится с первыми specKeepRows строками, последние две — вместе, середина переносится
  const long=topTables(res.document).flatMap(t=>[t, ...topTables(partsOf(t, 'w:tc').join(''))]).find(t=>textOf(partsOf(t, 'w:tr')[0] || '').startsWith('Основные') && partsOf(t, 'w:tr').length >= 9);
  assert.ok(long, 'длинная таблица характеристик');
  const keeps=partsOf(long, 'w:tr').map(row=>/<w:keepNext\/>/.test(row));
  const k=SETTINGS.rules.specKeepRows, n=keeps.length;
  assert.deepStrictEqual(keeps.slice(0, k), Array(k).fill(true), 'заголовок и первые строки — вместе');
  assert.strictEqual(keeps[k+1], false, 'дальше таблица может перейти на следующий лист');
  assert.deepStrictEqual(keeps.slice(n-2), [true, false], 'последние две строки — вместе');
});

check('совсем небольшие позиции — по две в ряд; одна без пары — во всю ширину', async ()=>{
  const res=await build(SCENARIOS.nine());
  const pairs=topTables(res.document).map(t=>(textOf(t).match(/Позиция \d из 9/g) || []).length);
  assert.ok(pairs.filter(c=>c === 2).length >= 4, 'карточки парами: '+pairs.join(','));
  assert.ok(pairs.filter(c=>c > 2).length === 0, 'не больше двух в ряду');
  const total=pairs.reduce((a, b)=>a+b, 0);
  assert.strictEqual(total, 9, 'все позиции на месте');
});

check('срок поставки на титуле: недели и рабочие дни сравниваются, нераспознанное — как есть', async ()=>{
  const cover=async value=>{ const s=hard(); s.conditions[0].value=value; return textOf(coverOf((await build(s)).document).xml); };
  has(await cover('Модель А — под заказ 6–8 недель; Модель Б — под заказ, 30 рабочих дней'), /Срок поставкипод заказ, до 8 недель/, 'недели');
  has(await cover('Модель А — 10 календарных дней; Модель Б — в наличии'), /Срок поставкидо 10 календарных дней/, 'в наличии и календарные');
  has(await cover('Модель А — под заказ, 30 рабочих дней; доставка — по согласованию'), /Срок поставкиМодель А — под заказ, 30 рабочих дней; доставка — по согласованию/, 'нераспознанное — как есть');
});

check('проверка в Word: титул на двух листах и почти пустые листы — «Пересобрать плотнее», плотнее — запас и фото', async ()=>{
  const rules=SETTINGS.rules;
  assert.ok(WordCheck.supports({ skel:SKEL }), 'шаблон раскладывает позиции подряд');
  assert.ok(!WordCheck.supports({ skel:{ features:['discount'] } }), 'прежний шаблон — без проверки');
  assert.deepStrictEqual(WordCheck.problems({ pages:8, cover:1, fill:[100, 90, 60, 80, 70, 95, 85, 10] }, rules), [], 'последний лист может быть неполным');
  assert.deepStrictEqual(WordCheck.problems({ pages:10, cover:2, fill:[100, 6, 60, 80, 32, 95, 85, 76, 90, 54] }, rules),
    ['титул занял 2 листа', 'почти пустые листы: 5 (32 %)'], 'КП владельца 30.10: титул и лист 5');
  assert.ok(/data-a="denseKp"/.test(WordCheck.html(['титул занял 2 листа'], 0)), 'кнопка «Пересобрать плотнее»');
  assert.ok(!/data-a="denseKp"/.test(WordCheck.html(['титул занял 2 листа'], WordCheck.DENSE_MAX)), 'плотнее некуда — без кнопки');
  assert.ok(/Проверено в Word/.test(WordCheck.html([], 0)), 'всё в порядке');
  // ступень плотности КП: больше запас внизу титула, ниже фото позиции
  const heights=async dense=>{ const s=hard(); s.layoutDense=dense; const res=await build(s);
    const rows=partsOf(topTables(coverOf(res.document).xml)[0], 'w:tr').map(row=>+row.match(/<w:trHeight w:val="(\d+)"/)[1]);
    // фото позиции на её странице — самое крупное с её названием (миниатюры титула и карточки цены — мельче)
    const photo=Math.max(...[...res.document.matchAll(/<wp:extent cx="\d+" cy="(\d+)"\/><wp:effectExtent[^>]*\/><wp:docPr id="\d+" name="ДГУ Пример-600 в кожухе"/g)].map(m=>+m[1]));
    return { total:rows.reduce((a, b)=>a+b, 0), photo }; };
  const [d0, d2]=[await heights(0), await heights(2)];
  assert.ok(d2.total <= d0.total-2*567, `запас титула на 2 см больше: ${d0.total} → ${d2.total}`);
  assert.ok(d2.photo && d0.photo && d2.photo < d0.photo, `фото позиции ниже: ${d0.photo} → ${d2.photo}`);
});

(async ()=>{
  let passed=0;
  for (const [name, fn] of checks) {
    try { await fn(); passed++; } catch (e) { console.error('ОШИБКА — '+name+':\n'+(e && e.stack || e)); process.exitCode=1; }
  }
  if (!process.exitCode) console.log(`Шаблон «ПНЕВМОТЕХ НОВЫЙ»: проверок ${passed} — все прошли`);
})();
