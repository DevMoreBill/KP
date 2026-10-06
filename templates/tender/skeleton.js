/* Скелет тендерного КП: строгий документ без графики, с полным составом предложения.
   Разделы (порядок и включение — в «Настроить шаблон → Разделы и блоки»):
     requisites — бланк: наименование и реквизиты поставщика строками, исх. № и дата, адресат, заголовок, вступление;
     offer      — таблица предложения: наименование, производитель и модель, ед. изм., кол-во, цена и сумма с НДС,
                  элементы сборки и доп. комплектация строками, итоги, сумма прописью;
     conditions — условия предложения таблицей и дополнительные условия;
     specs      — техническое описание: по каждой позиции описание, полная таблица характеристик
                  («Наименование показателя — Значение показателя»), состав сборки, доп. комплектация;
     supplier   — сведения о поставщике (реквизиты таблицей);
     signature  — подпись: должность, подпись (картинка), расшифровка, М.П. с печатью (картинка), исполнитель.
   Картинки подписи и печати — «Настроить шаблон → Подпись и печать» (лучше PNG с прозрачным фоном).
   build(S, Min, roots, tpl) — как у основного шаблона; features: 'kit' (состав сборки как есть), 'sign' (подпись и печать),
   'header' (шапка страницы из настроек). Без 'discount' программа передаёт цены уже со скидкой. */
function kpSkeleton(KP) {
  'use strict';
  const { money, words, totals, ruDate, CURS, fill, deepMerge } = KP;

  // ---------------------------------------------------------------- настройки по умолчанию
  const DEFAULTS = {
    name: 'Тендерный (без графики)',
    description: 'Строгое КП для подачи на тендеры: полный состав и характеристики, реквизиты, подпись и печать.',
    filePrefix: 'КП',
    fileName: '{номер}_{префикс}_{клиент}_{оборудование}_{дата}',
    brandParts: [['ПНЕВМОТЕХ', 'DARK']],
    site: 'www.kompr.ru',
    font: 'Times New Roman',
    colors: { DARK: '000000', GRAY: '595959', LINE: '7F7F7F', FILL: 'F2F2F2', WHITE: 'FFFFFF' },
    sections: [
      { id: 'requisites', on: true },
      { id: 'offer', on: true, newPage: false },
      { id: 'conditions', on: true, newPage: false },
      { id: 'specs', on: true, newPage: true },
      { id: 'supplier', on: true, newPage: false },
      { id: 'signature', on: true, newPage: false }
    ],
    blocks: {
      letterhead: true, recipient: true, intro: true, object: true,
      offerMaker: true, offerSpec: true, offerKit: true, offerOptions: true, amountInWords: true, currencyNote: true,
      specsFeatures: true, specsChars: true, specsKit: true, specsKitChars: true, specsOptions: true, specsPhoto: false, specsNote: true,
      signImage: true, stampImage: true, executor: true, footer: true
    },
    rules: {
      specPhotoWidthCm: 6, specPhotoHeightCm: 4.5,
      signWidthCm: 3.5, signHeightCm: 0,          // 0 — по пропорциям картинки
      stampWidthCm: 4, stampX: 5.5, stampY: -2.6, // печать: от левого края текста и от строки «М.П.», см
      stampBehind: false                          // true — печать за текстом (для картинки без прозрачного фона)
    },
    header: { on: false, logo: '', logoWidthCm: 4, logoHeightCm: 0, logoSide: 'left', lines: '', textSize: 8, textColor: 'GRAY', firstBold: true, firstColor: 'DARK', rule: true, ruleColor: 'LINE' },
    company: 'ПНЕВМОТЕХ',
    letterhead: '',     // строки под наименованием: адрес, телефон, e-mail, сайт, ИНН/КПП
    supplier: [
      ['Полное наименование', ''], ['Сокращённое наименование', ''], ['ИНН / КПП', ''], ['ОГРН', ''],
      ['Юридический адрес', ''], ['Почтовый адрес', ''], ['Расчётный счёт', ''], ['Банк', ''], ['БИК', ''], ['Корреспондентский счёт', ''],
      ['Руководитель', ''], ['Телефон', ''], ['E-mail', '']
    ],
    signPost: 'Генеральный директор',
    signName: '',        // пусто — подписывает менеджер КП (его должность и ФИО)
    signImage: '', stampImage: '',
    texts: {
      outNo: 'Исх. № {номер} от {дата}', to: 'Кому:', inn: 'ИНН {inn}', attention: '{contact}',
      title: 'Коммерческое предложение', subject: 'на поставку: {предмет}',
      intro: '{компания} предлагает к поставке оборудование в соответствии с приведённой ниже спецификацией на следующих условиях.',
      object: 'Объект: {объект}',
      offerTitle: '1. Спецификация и стоимость',
      colNo: '№ п/п', colName: 'Наименование товара, производитель, модель', colUnit: 'Ед. изм.', colQty: 'Кол-во',
      colPrice: 'Цена за ед. с НДС, {cur}', colSum: 'Сумма с НДС, {cur}', colPriceNoVat: 'Цена за ед., {cur}', colSumNoVat: 'Сумма, {cur}',
      maker: 'Производитель: {maker}', model: 'Модель: {model}', country: 'Страна происхождения: {country}',
      pcs: 'шт.', kitPart: 'в т. ч. {name}', inKit: 'в составе', included: 'включено',
      total: 'Итого:', vatIncl: 'в т. ч. НДС {vat} %:', noVat: 'НДС не облагается', grandTotal: 'Всего к оплате:',
      inWords: 'Всего к оплате: {words}, в т. ч. НДС {vat} % — {vatSum} {cur}', inWordsNoVat: 'Всего к оплате: {words}, НДС не облагается',
      currencyNote: 'Цены указаны в {curName}. Оплата производится в рублях по курсу ЦБ РФ на дату оплаты.',
      currencyRate: ' Справочно: курс ЦБ РФ{rateDate} — 1 {cur} = {rate} руб.; сумма в рублях — {rub} руб.',
      conditionsTitle: '2. Условия поставки', condExtraTitle: 'Дополнительные условия:',
      specsTitle: '3. Техническое описание предлагаемого оборудования', specsItem: '3.{n}. {name}',
      qtyLine: 'Количество: {qty} {unit}',
      charsTitle: 'Технические характеристики', charName: 'Наименование показателя', charValue: 'Значение показателя',
      kitTitle: 'Состав изделия', kitName: 'Наименование элемента', kitQty: 'Кол-во', kitChars: 'Описание и характеристики',
      optionsTitle: 'Дополнительная комплектация (входит в стоимость)',
      specsNote: 'Характеристики приведены по данным производителя. Оборудование новое, не бывшее в употреблении, не восстановленное.',
      supplierTitle: '4. Сведения о поставщике',
      signPost: '{должность}', signCaption: '(подпись)', signNameCaption: '(расшифровка подписи)', stamp: 'М.П.',
      executor: 'Исполнитель: {менеджер}{должность}, тел. {телефон}{email}',
      footerText: 'КП № {номер} от {дата}', page: 'Стр. {page} из {pages}'
    },
    styles: {
      company: { size: 12, color: 'DARK', bold: true },
      letterhead: { size: 9, color: 'GRAY' },
      meta: { size: 11, color: 'DARK' },
      metaBold: { size: 11, color: 'DARK', bold: true },
      title: { size: 14, color: 'DARK', bold: true, caps: true },
      subject: { size: 12, color: 'DARK', bold: true },
      text: { size: 11, color: 'DARK' },
      heading: { size: 12, color: 'DARK', bold: true },
      subheading: { size: 11, color: 'DARK', bold: true },
      label: { size: 11, color: 'DARK', bold: true },
      th: { size: 9.5, color: 'DARK', bold: true },
      cell: { size: 10, color: 'DARK' },
      cellBold: { size: 10, color: 'DARK', bold: true },
      cellSmall: { size: 9, color: 'GRAY' },
      group: { size: 10, color: 'DARK', bold: true },
      total: { size: 10.5, color: 'DARK', bold: true },
      words: { size: 11, color: 'DARK', italic: true },
      note: { size: 9.5, color: 'GRAY', italic: true },
      sign: { size: 11, color: 'DARK' },
      signBold: { size: 11, color: 'DARK', bold: true },
      caption: { size: 8, color: 'GRAY' },
      footer: { size: 8, color: 'GRAY' }
    }
  };

  // ---------------------------------------------------------------- текущие настройки
  let TPL = DEFAULTS, T = DEFAULTS.texts, RULES = DEFAULTS.rules, BLK = DEFAULTS.blocks;
  const BASEW = 9638;        // ширина текста А4 при полях 2,5 / 1,5 см
  let W = BASEW, PID = 9000;
  const CM = 360000, NB = ' ';
  function setTemplate(t) {
    TPL = deepMerge(DEFAULTS, t || {});
    const given = Array.isArray(t && t.sections) ? t.sections.filter(s => s && DEFAULTS.sections.some(d => d.id === s.id)) : [];
    TPL.sections = given.map(s => Object.assign({}, DEFAULTS.sections.find(d => d.id === s.id), s))
      .concat(DEFAULTS.sections.filter(d => !given.some(s => s.id === d.id)));
    if (Array.isArray(t && t.supplier)) TPL.supplier = t.supplier;
    T = TPL.texts; RULES = TPL.rules; BLK = TPL.blocks;
    W = BASEW;
    const sect = TPL.sect || '';
    const pw = /<w:pgSz[^>]*w:w="(\d+)"/.exec(sect), ml = /<w:pgMar[^>]*w:left="(\d+)"/.exec(sect), mr = /<w:pgMar[^>]*w:right="(\d+)"/.exec(sect);
    if (pw && ml && mr) W = +pw[1] - +ml[1] - +mr[1];
  }
  const COL = k => (TPL.colors && TPL.colors[k]) || String(k || '').replace(/^#/, '');
  const X = v => Math.round(v * W / BASEW);
  function cols(arr) {
    const total = X(arr.reduce((a, b) => a + b, 0)), out = arr.map(X);
    out[out.length - 1] += total - out.reduce((a, b) => a + b, 0);
    return out;
  }
  function sty(name, extra) {
    const s = TPL.styles[name] || {};
    return Object.assign({ sz: Math.round((+s.size || 11) * 2), color: COL(s.color || 'DARK'), b: !!s.bold, i: !!s.italic, caps: !!s.caps,
      sp: s.spacing ? Math.round(+s.spacing * 20) : 0 }, extra || {});
  }
  const txt = (key, vars) => fill(T[key] == null ? '' : T[key], vars || {});
  const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const cm = v => Math.round(+v * CM);
  const curCode = S => (S && S.cur && S.cur.code) || 'RUB';
  const curSh = S => (CURS[curCode(S)] || CURS.RUB).sh;
  const sectionOn = id => TPL.sections.some(s => s.id === id && s.on);

  // ---------------------------------------------------------------- строительные блоки Word
  function r(t, o = {}) {
    if (typeof o === 'string') o = sty(o);
    const sz = o.sz || 22, f = esc(TPL.font || 'Times New Roman');
    let rp = `<w:rFonts w:ascii="${f}" w:eastAsia="${f}" w:hAnsi="${f}" w:cs="${f}"/>`;
    if (o.b) rp += '<w:b/><w:bCs/>';
    if (o.i) rp += '<w:i/><w:iCs/>';
    if (o.caps) rp += '<w:caps/>';
    rp += `<w:color w:val="${o.color || COL('DARK')}"/>`;
    if (o.sp) rp += `<w:spacing w:val="${o.sp}"/>`;
    rp += `<w:sz w:val="${sz}"/><w:szCs w:val="${sz}"/><w:lang w:val="ru-RU"/>`;
    return `<w:r><w:rPr>${rp}</w:rPr><w:t xml:space="preserve">${esc(t)}</w:t></w:r>`;
  }
  const br = '<w:r><w:br/></w:r>';
  const lines = (s, st) => String(s || '').split(/\r?\n/).map(x => r(x, st)).join(br);
  function p(runs = '', o = {}) {
    let pp = '';
    if (o.keep) pp += '<w:keepNext/>';
    if (o.pbb) pp += '<w:pageBreakBefore/>';
    if (o.style) pp = `<w:pStyle w:val="${o.style}"/>` + pp;
    if (o.bdr) pp += `<w:pBdr>${o.bdr}</w:pBdr>`;
    pp += `<w:spacing w:before="${o.before || 0}" w:after="${o.after || 0}" w:line="${o.line || 252}" w:lineRule="auto"/>`;
    if (o.indL || o.indR || o.first) pp += `<w:ind w:left="${o.indL || 0}" w:right="${o.indR || 0}"${o.first ? ` w:firstLine="${o.first}"` : ''}/>`;
    pp += `<w:jc w:val="${o.jc || 'left'}"/>`;
    return `<w:p><w:pPr>${pp}</w:pPr>${runs}</w:p>`;
  }
  const END = '<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="20" w:lineRule="exact"/></w:pPr></w:p>';
  const ln = (side, sz, color) => `<w:${side} w:val="single" w:sz="${sz}" w:space="0" w:color="${color}"/>`;
  const GRID = () => ['top', 'left', 'bottom', 'right'].map(s => ln(s, 4, COL('LINE'))).join('');
  const NONE = '<w:top w:val="nil"/><w:left w:val="nil"/><w:bottom w:val="nil"/><w:right w:val="nil"/>';
  function tc(content, w, o = {}) {
    const [t, l, b, rr] = o.mar || [50, 90, 50, 90];
    let pr = `<w:tcW w:w="${w}" w:type="dxa"/>`;
    if (o.span > 1) pr += `<w:gridSpan w:val="${o.span}"/>`;
    pr += `<w:tcBorders>${o.bdr == null ? GRID() : o.bdr}</w:tcBorders>`;
    if (o.fill) pr += `<w:shd w:val="clear" w:color="auto" w:fill="${o.fill}"/>`;
    pr += `<w:tcMar><w:top w:w="${t}" w:type="dxa"/><w:left w:w="${l}" w:type="dxa"/><w:bottom w:w="${b}" w:type="dxa"/><w:right w:w="${rr}" w:type="dxa"/></w:tcMar>`;
    pr += `<w:vAlign w:val="${o.va || 'top'}"/>`;
    return `<w:tc><w:tcPr>${pr}</w:tcPr>${content || '<w:p/>'}</w:tc>`;
  }
  function tbl(rows, widths, o = {}) {
    const grid = widths.map(x => `<w:gridCol w:w="${x}"/>`).join('');
    const pr = `<w:tblW w:w="${widths.reduce((a, b) => a + b, 0)}" w:type="dxa"/><w:tblInd w:w="0" w:type="dxa"/>` +
      '<w:tblBorders><w:top w:val="nil"/><w:left w:val="nil"/><w:bottom w:val="nil"/><w:right w:val="nil"/><w:insideH w:val="nil"/><w:insideV w:val="nil"/></w:tblBorders>' +
      '<w:tblLayout w:type="fixed"/><w:tblCellMar><w:left w:w="0" w:type="dxa"/><w:right w:w="0" w:type="dxa"/></w:tblCellMar><w:tblLook w:val="0000"/>';
    const body = rows.map((row, i) => {
      let trp = '';
      if (o.cantSplit !== false) trp += '<w:cantSplit/>';
      if (o.header && i < (o.header === true ? 1 : o.header)) trp += '<w:tblHeader/>';
      return `<w:tr><w:trPr>${trp}</w:trPr>${row.join('')}</w:tr>`;
    }).join('');
    return `<w:tbl><w:tblPr>${pr}</w:tblPr><w:tblGrid>${grid}</w:tblGrid>${body}</w:tbl>`;
  }
  const picXml = (id, rid, cx, cy, name) => '<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">' +
    '<pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">' +
    `<pic:nvPicPr><pic:cNvPr id="${id}" name="${esc(name)}"/><pic:cNvPicPr/></pic:nvPicPr>` +
    `<pic:blipFill><a:blip r:embed="${rid}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>` +
    `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic>`;
  function img(rid, cx, cy, name) {
    const id = ++PID;
    return '<w:r><w:rPr><w:noProof/></w:rPr><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0">' +
      `<wp:extent cx="${cx}" cy="${cy}"/><wp:effectExtent l="0" t="0" r="0" b="0"/><wp:docPr id="${id}" name="${esc(name)}"/>` +
      '<wp:cNvGraphicFramePr><a:graphicFrameLocks xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" noChangeAspect="1"/></wp:cNvGraphicFramePr>' +
      picXml(id, rid, cx, cy, name) + '</wp:inline></w:drawing></w:r>';
  }
  // плавающая картинка (печать): x — от левого края текста, y — от абзаца привязки (см); текст не сдвигает
  function anchorRun(rid, cx, cy, x, y, name, behind) {
    const id = ++PID;
    return '<w:r><w:rPr><w:noProof/></w:rPr><w:drawing>' +
      `<wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" relativeHeight="${251659264 + id}" behindDoc="${behind ? 1 : 0}" locked="0" layoutInCell="1" allowOverlap="1">` +
      `<wp:simplePos x="0" y="0"/><wp:positionH relativeFrom="column"><wp:posOffset>${cm(x || 0)}</wp:posOffset></wp:positionH>` +
      `<wp:positionV relativeFrom="paragraph"><wp:posOffset>${cm(y || 0)}</wp:posOffset></wp:positionV>` +
      `<wp:extent cx="${cx}" cy="${cy}"/><wp:effectExtent l="0" t="0" r="0" b="0"/><wp:wrapNone/><wp:docPr id="${id}" name="${esc(name)}"/><wp:cNvGraphicFramePr/>` +
      picXml(id, rid, cx, cy, name) + '</wp:anchor></w:drawing></w:r>';
  }
  const fit = (g, bw, bh) => { const k = Math.min(bw / g.w, bh / g.h, 914400 / 150); return [Math.round(g.w * k), Math.round(g.h * k)]; };
  const heading = (title, sec, first) => p(r(title, 'heading'), { before: first || (sec && sec.newPage) ? 0 : 360, after: 160, keep: true, pbb: !!(sec && sec.newPage) });
  const TH = (t, w, jc) => tc(p(r(t, 'th'), { jc: jc || 'center', line: 240 }), w, { fill: COL('FILL'), va: 'center' });

  // производитель, модель, страна происхождения позиции (из карточки и таблицы характеристик)
  function infoOf(it) {
    const inf = it.info || {}, rows = (it.groups || []).flatMap(g => g.rows || []);
    const row = re => (rows.find(x => x.k && x.v && re.test(x.k)) || {}).v || '';
    return { maker: inf.maker || row(/^производитель/i), model: inf.model || row(/^модель/i), country: row(/страна/i) };
  }
  const kitOf = it => (it && it.kit && Array.isArray(it.kit.parts) ? it.kit.parts : []).filter(x => x && String(x.name || '').trim());
  const optsOf = it => (it.options || []).filter(o => o.name && +o.qty > 0);
  const vatOn = S => +S.vat > 0;

  // ================================================================ БЛАНК: реквизиты, адресат, заголовок
  function requisitesXml(S) {
    const out = [];
    if (BLK.letterhead) {
      out.push(p(r(TPL.company || '', 'company'), { after: 40 }));
      if (String(TPL.letterhead || '').trim()) out.push(p(lines(TPL.letterhead.trim(), 'letterhead'), { line: 240 }));
      out.push(p('', { after: 240, bdr: ln('bottom', 8, COL('DARK')) }));
    }
    const w2 = cols([4500, 5138]);
    const left = p(r(txt('outNo', { 'номер': S.number || '', 'дата': S.date ? ruDate(S.date) : '' }), 'meta'));
    let right = '';
    if (BLK.recipient) {
      const ct = S.contact || {};
      right += p(r(T.to + ' ', 'meta') + r(S.client || '', 'metaBold'), { line: 240 });
      if (S.clientInn) right += p(r(txt('inn', { inn: S.clientInn }), 'meta'), { line: 240 });
      if (ct.name) right += p(r(txt('attention', { contact: [ct.post, ct.name].filter(Boolean).join(' ') }), 'meta'), { line: 240 });
    }
    out.push(tbl([[tc(left, w2[0], { bdr: NONE, mar: [0, 0, 0, 0] }), tc(right || '<w:p/>', w2[1], { bdr: NONE, mar: [0, 0, 0, 0] })]], w2));
    const c = S.cover || {}, subj = [c.title, c.model].filter(Boolean).join(' ') || (S.items[0] && S.items[0].name) || '';
    out.push(p(r(T.title, 'title'), { jc: 'center', before: 360, after: 60 }));
    if (subj) out.push(p(r(txt('subject', { 'предмет': subj }), 'subject'), { jc: 'center', after: 240 }));
    const ob = S.object || {};
    if (BLK.object && (ob.purpose || ob.address)) out.push(p(r(txt('object', { 'объект': [ob.purpose, ob.address].filter(Boolean).join(', ') }), 'text'), { after: 120, jc: 'both' }));
    if (BLK.intro && T.intro) out.push(p(r(txt('intro', { 'компания': TPL.company || '', 'клиент': S.client || '' }), 'text'), { after: 120, jc: 'both', first: 567 }));
    return out.join('');
  }

  // ================================================================ СПЕЦИФИКАЦИЯ И СТОИМОСТЬ
  function offerXml(S, sec) {
    const t = totals(S.items, S.vat), cur = curSh(S), vo = vatOn(S);
    const wc = cols([600, 4238, 800, 800, 1500, 1700]), n = wc.length;
    const rows = [[TH(T.colNo, wc[0]), TH(T.colName, wc[1]), TH(T.colUnit, wc[2]), TH(T.colQty, wc[3]),
      TH(txt(vo ? 'colPrice' : 'colPriceNoVat', { cur }), wc[4]), TH(txt(vo ? 'colSum' : 'colSumNoVat', { cur }), wc[5])]];
    const num = (v, st, jc) => p(r(v, st || 'cell'), { jc: jc || 'right', line: 240 });
    S.items.forEach((it, i) => {
      const inf = infoOf(it);
      let nm = p(r(it.name, 'cellBold'), { line: 240 });
      if (BLK.offerMaker) {
        const sub = [inf.maker && !it.name.includes(inf.maker) ? txt('maker', { maker: inf.maker }) : '', inf.model && !it.name.includes(inf.model) ? txt('model', { model: inf.model }) : '',
          inf.country ? txt('country', { country: inf.country }) : ''].filter(Boolean).join('; ');
        if (sub) nm += p(r(sub, 'cellSmall'), { before: 30, line: 240 });
      }
      if (BLK.offerSpec && it.spec) nm += p(r(it.spec, 'cellSmall'), { before: 30, line: 240 });
      rows.push([tc(num(String(i + 1), 'cell', 'center'), wc[0]), tc(nm, wc[1]), tc(num(T.pcs, 'cell', 'center'), wc[2]), tc(num(String(it.qty), 'cell', 'center'), wc[3]),
        tc(num(money(it.price || 0)), wc[4]), tc(num(money(it.qty * (it.price || 0)), 'cellBold'), wc[5])]);
      const sub = (k, name, qty, unit, price, sum) => rows.push([tc(num(k, 'cellSmall', 'center'), wc[0]), tc(p(r(name, 'cell'), { line: 240, indL: 170 }), wc[1]),
        tc(num(unit, 'cell', 'center'), wc[2]), tc(num(String(qty), 'cell', 'center'), wc[3]), tc(num(price, price === T.inKit || price === T.included ? 'cellSmall' : 'cell'), wc[4]), tc(num(sum, sum === '—' ? 'cellSmall' : 'cell'), wc[5])]);
      if (BLK.offerKit) kitOf(it).forEach((x, j) => sub(`${i + 1}.${j + 1}`, txt('kitPart', { name: x.name }), (+x.qty || 1) * (+it.qty || 1), T.pcs, T.inKit, '—'));
      const k0 = BLK.offerKit ? kitOf(it).length : 0;
      if (BLK.offerOptions) optsOf(it).forEach((o, j) => sub(`${i + 1}.${k0 + j + 1}`, o.name, o.qty, o.unit || T.pcs,
        o.price ? money(o.price) : T.included, o.price ? money(o.qty * o.price) : '—'));
    });
    const L = wc.slice(0, n - 1).reduce((a, b) => a + b, 0);
    const tot = (label, val) => rows.push([tc(p(r(label, 'total'), { jc: 'right', line: 240 }), L, { span: n - 1 }), tc(num(val, 'total'), wc[n - 1])]);
    tot(T.total, money(t.sum));
    tot(vo ? txt('vatIncl', { vat: S.vat }) : T.noVat, vo ? money(t.vat) : '—');
    tot(T.grandTotal, money(t.sum));
    const out = [heading(T.offerTitle, sec, sectionOn('requisites') ? 0 : 1), tbl(rows, wc, { header: true })];
    if (BLK.amountInWords) out.push(p(r(vo ? txt('inWords', { words: words(t.sum, curCode(S)), vat: S.vat, vatSum: money(t.vat), cur }) : txt('inWordsNoVat', { words: words(t.sum, curCode(S)) }), 'words'), { before: 120, jc: 'both' }));
    if (curCode(S) !== 'RUB' && BLK.currencyNote) {
      const C = CURS[curCode(S)], rt = S.cur && +S.cur.rate;
      out.push(p(r(txt('currencyNote', { curName: C.name }) + (rt ? txt('currencyRate', { rateDate: S.cur.date ? ' на ' + ruDate(S.cur.date) : '', cur: C.sh, rate: String(rt).replace('.', ','), rub: money(Math.round(t.sum * rt)) }) : ''), 'note'), { before: 60, jc: 'both' }));
    }
    return out.join('');
  }

  // ================================================================ УСЛОВИЯ
  function conditionsXml(S, sec) {
    const conds = (S.conditions || []).filter(c => c.value);
    const extra = String(S.condExtra || '').split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    if (!conds.length && !extra.length) return '';
    const w2 = cols([3300, 6338]);
    let x = heading(T.conditionsTitle, sec);
    if (conds.length) x += tbl(conds.map(c => [tc(p(r(c.label, 'cellBold'), { line: 240 }), w2[0]), tc(p(r(c.value, 'cell'), { line: 240 }), w2[1])]), w2);
    if (extra.length) {
      x += p(r(T.condExtraTitle, 'label'), { before: conds.length ? 200 : 0, after: 60 });
      x += extra.map(l => p(r(/^[-•*–—]\s*/.test(l) ? '–' + NB + l.replace(/^[-•*–—]\s*/, '') : l, 'text'), { after: 40, jc: 'both', indL: /^[-•*–—]/.test(l) ? 284 : 0 })).join('');
    }
    return x;
  }

  // ================================================================ ТЕХНИЧЕСКОЕ ОПИСАНИЕ
  function charsTable(groups) {
    const w2 = cols([5200, 4438]);
    const rows = [[TH(T.charName, w2[0]), TH(T.charValue, w2[1])]];
    groups.forEach(g => {
      if (groups.length > 1 || g.name) rows.push([tc(p(r(g.name || T.charsTitle, 'group'), { line: 240 }), w2[0] + w2[1], { span: 2, fill: COL('FILL') })]);
      g.rows.forEach(x => rows.push([tc(p(r(x.k || '', 'cell'), { line: 240 }), w2[0]), tc(p(r(x.v || '', x.hl ? 'cellBold' : 'cell'), { line: 240 }), w2[1])]));
    });
    return tbl(rows, w2, { header: true });
  }
  function kitTable(it) {
    const wc = cols([600, 2800, 800, 5438]);
    const rows = [[TH(T.colNo, wc[0]), TH(T.kitName, wc[1]), TH(T.kitQty, wc[2]), TH(T.kitChars, wc[3])]];
    kitOf(it).forEach((x, j) => {
      const sub = [x.maker, x.model].filter(Boolean).join(' ');
      let d = x.desc ? p(r(x.desc, 'cell'), { line: 240, jc: 'both', after: (x.rows || []).length && BLK.specsKitChars ? 60 : 0 }) : '';
      if (BLK.specsKitChars) d += (x.rows || []).map(z => p(r(z.k + ': ', 'cellSmall') + r(z.v, 'cell'), { line: 240 })).join('');
      rows.push([tc(p(r(String(j + 1), 'cell'), { jc: 'center', line: 240 }), wc[0]),
        tc(p(r(x.name, 'cellBold'), { line: 240 }) + (sub && !x.name.includes(sub) ? p(r(sub, 'cellSmall'), { line: 240, before: 30 }) : ''), wc[1]),
        tc(p(r(String(+x.qty || 1) + NB + T.pcs, 'cell'), { jc: 'center', line: 240 }), wc[2]), tc(d || p(r('—', 'cellSmall'), { line: 240 }), wc[3])]);
    });
    return tbl(rows, wc, { header: true, cantSplit: false });
  }
  function specsXml(S, sec, M) {
    const out = [heading(T.specsTitle, sec)];
    S.items.forEach((it, i) => {
      const inf = infoOf(it), m = M.items[it.id] || {};
      out.push(p(r(txt('specsItem', { n: i + 1, name: it.name }), 'subheading'), { before: i ? 280 : 0, after: 80, keep: true }));
      const meta = [inf.maker ? txt('maker', { maker: inf.maker }) : '', inf.model ? txt('model', { model: inf.model }) : '', inf.country ? txt('country', { country: inf.country }) : '',
        txt('qtyLine', { qty: it.qty, unit: T.pcs })].filter(Boolean).join('; ').replace(/([^.])$/, '$1.');
      out.push(p(r(meta, 'text'), { after: 100 }));
      if (BLK.specsPhoto && m.tile) {
        const [cx, cy] = fit(m.tile, cm(RULES.specPhotoWidthCm), cm(RULES.specPhotoHeightCm));
        out.push(p(img(m.tile.rid, cx, cy, it.name), { jc: 'center', after: 100 }));
      }
      if (BLK.specsFeatures) (it.features || []).filter(f => f.text).forEach(f => {
        out.push(p((f.label ? r(f.label.replace(/[.:]\s*$/, '') + '. ', 'label') : '') + r(f.text, 'text'), { after: 80, jc: 'both', first: 567 }));
      });
      const groups = (it.groups || []).map(g => ({ name: g.name, rows: (g.rows || []).filter(x => x.k && x.v) })).filter(g => g.rows.length);
      if (BLK.specsChars && groups.length) {
        out.push(p(r(T.charsTitle, 'label'), { before: 120, after: 80, keep: true }));
        out.push(charsTable(groups));
      }
      if (BLK.specsKit && kitOf(it).length) {
        out.push(p(r(T.kitTitle, 'label'), { before: 160, after: 80, keep: true }));
        out.push(kitTable(it));
      }
      const opts = BLK.specsOptions ? optsOf(it) : [];
      if (opts.length) {
        out.push(p(r(T.optionsTitle, 'label'), { before: 160, after: 60, keep: true }));
        opts.forEach(o => out.push(p(r('–' + NB + o.name + ' — ' + o.qty + NB + (o.unit || T.pcs), 'text'), { after: 30, indL: 284 })));
      }
    });
    if (BLK.specsNote && T.specsNote) out.push(p(r(T.specsNote, 'note'), { before: 200, jc: 'both' }));
    return out.join('');
  }

  // ================================================================ СВЕДЕНИЯ О ПОСТАВЩИКЕ
  function supplierXml(S, sec) {
    const list = (TPL.supplier || []).filter(x => Array.isArray(x) && String(x[1] || '').trim());
    if (!list.length) return '';
    const w2 = cols([3300, 6338]);
    return heading(T.supplierTitle, sec) + tbl(list.map(([k, v]) => [tc(p(r(k, 'cellBold'), { line: 240 }), w2[0]), tc(p(lines(v, 'cell'), { line: 240 }), w2[1])]), w2);
  }

  // ================================================================ ПОДПИСЬ И ПЕЧАТЬ
  function signatureXml(S, sec, M, floats) {
    const mg = S.manager || {}, byMgr = !String(TPL.signName || '').trim();
    const post = byMgr ? (mg.position || TPL.signPost || '') : (TPL.signPost || ''), name = byMgr ? (mg.name || '') : TPL.signName;
    const wc = cols([3900, 2700, 300, 2738]);
    const under = ln('bottom', 6, COL('DARK'));
    const bd = s => '<w:top w:val="nil"/><w:left w:val="nil"/><w:right w:val="nil"/>' + (s ? under : '<w:bottom w:val="nil"/>');
    let signCell = '<w:p><w:pPr><w:spacing w:before="0" w:after="0"/><w:jc w:val="center"/></w:pPr></w:p>';
    if (BLK.signImage && M.sign && M.sign.sign) {
      const g = M.sign.sign, cx = cm(RULES.signWidthCm || 3.5), cy = +RULES.signHeightCm > 0 ? cm(RULES.signHeightCm) : Math.round(cx * g.h / g.w);
      signCell = p(img(g.rid, cx, cy, 'Подпись'), { jc: 'center', line: 240 });
    }
    const out = [sec && sec.newPage ? p('', { pbb: true }) : p('', { before: 480 })];
    out.push(tbl([
      [tc(p(r(txt('signPost', { 'должность': post }), 'signBold'), { line: 240 }) + (TPL.company ? p(r(TPL.company, 'sign'), { line: 240 }) : ''), wc[0], { bdr: NONE, va: 'bottom', mar: [0, 0, 40, 0] }),
        tc(signCell, wc[1], { bdr: bd(true), va: 'bottom', mar: [0, 0, 20, 0] }), tc('<w:p/>', wc[2], { bdr: NONE }),
        tc(p(r('/' + NB + name + NB + '/', 'sign'), { jc: 'center', line: 240 }), wc[3], { bdr: bd(true), va: 'bottom', mar: [0, 0, 20, 0] })],
      [tc('<w:p/>', wc[0], { bdr: NONE }), tc(p(r(T.signCaption, 'caption'), { jc: 'center', line: 240 }), wc[1], { bdr: NONE, mar: [20, 0, 0, 0] }), tc('<w:p/>', wc[2], { bdr: NONE }),
        tc(p(r(T.signNameCaption, 'caption'), { jc: 'center', line: 240 }), wc[3], { bdr: NONE, mar: [20, 0, 0, 0] })]], wc));
    // «М.П.» и печать: картинка плавает поверх подписи (как ставят печать на бумаге), не сдвигая текст
    let stamp = '';
    if (BLK.stampImage && M.sign && M.sign.stamp) {
      const g = M.sign.stamp, cx = cm(RULES.stampWidthCm || 4), cy = Math.round(cx * g.h / g.w);
      floats.push({ kind: 'img', id: 'stamp', behind: !!RULES.stampBehind });
      stamp = anchorRun(g.rid, cx, cy, +RULES.stampX || 0, +RULES.stampY || 0, 'Печать', !!RULES.stampBehind);
    }
    out.push(p(stamp + r(T.stamp, 'sign'), { before: 200, style: stamp ? 'KPFLOAT' : '' }));
    if (BLK.executor && mg.name) {
      const e = txt('executor', { 'менеджер': mg.name || '', 'должность': mg.position ? ', ' + mg.position.toLowerCase() : '', 'телефон': [mg.phone, mg.mobile].filter(Boolean).join(', ') || '—', email: mg.email ? ', e-mail: ' + mg.email : '' });
      out.push(p(r(e, 'note'), { before: stamp ? 1100 : 360 }));
    }
    return out.join('');
  }

  // ================================================================ КОЛОНТИТУЛЫ
  function fld(instr, res, o) {
    const f = esc(TPL.font || 'Times New Roman');
    const rp = `<w:rPr><w:rFonts w:ascii="${f}" w:hAnsi="${f}" w:cs="${f}"/><w:color w:val="${o.color}"/><w:sz w:val="${o.sz}"/><w:szCs w:val="${o.sz}"/></w:rPr>`;
    return `<w:r>${rp}<w:fldChar w:fldCharType="begin"/></w:r><w:r>${rp}<w:instrText xml:space="preserve"> ${instr} </w:instrText></w:r><w:r>${rp}<w:fldChar w:fldCharType="separate"/></w:r><w:r>${rp}<w:t>${res}</w:t></w:r><w:r>${rp}<w:fldChar w:fldCharType="end"/></w:r>`;
  }
  function footerXml(S, root) {
    if (!BLK.footer) return root + END + '</w:ftr>';
    const left = p(r(txt('footerText', { 'номер': S.number || '', 'дата': S.date ? ruDate(S.date) : '', 'клиент': S.client || '' }) + (TPL.company ? '  ·  ' + TPL.company : ''), 'footer'));
    // «Стр. {page} из {pages}»: метки заменяются полями Word
    const parts = String(T.page || '').split(/(\{page\}|\{pages\})/);
    const right = p(parts.map(x => x === '{page}' ? fld('PAGE', '1', sty('footer')) : x === '{pages}' ? fld('NUMPAGES', '1', sty('footer')) : x ? r(x, 'footer') : '').join(''), { jc: 'right' });
    const w2 = cols([6838, 2800]), top = ln('top', 4, COL('LINE')) + '<w:left w:val="nil"/><w:bottom w:val="nil"/><w:right w:val="nil"/>';
    return root + tbl([[tc(left, w2[0], { bdr: top, mar: [80, 0, 0, 0] }), tc(right, w2[1], { bdr: top, mar: [80, 0, 0, 0] })]], w2) + END + '</w:ftr>';
  }
  function headerXml(S, root) {
    const H = TPL.header || {}, lg = TPL.headerLogo;
    const ls = String(H.lines || '').split(/\r?\n/).map(x => x.trim()).filter(Boolean);
    const sz = Math.round((+H.textSize || 8) * 2), col = COL(H.textColor || 'GRAY');
    const tx = ls.map((l, i) => p(r(l, { sz: i === 0 && H.firstBold ? sz + 4 : sz, color: i === 0 && H.firstColor ? COL(H.firstColor) : col, b: i === 0 && !!H.firstBold }),
      { jc: H.logoSide === 'right' ? 'left' : 'right', line: 240 })).join('') || p('');
    let logo = p('');
    if (lg && lg.rid) {
      const cx = cm(Math.max(0.5, +H.logoWidthCm || 4)), cy = +H.logoHeightCm > 0 ? cm(H.logoHeightCm) : Math.round(cx * lg.h / lg.w);
      logo = p(img(lg.rid, cx, cy, 'Логотип компании'), { jc: H.logoSide === 'right' ? 'right' : 'left' });
    }
    const lw = lg && lg.rid ? Math.min(X(6000), Math.round((+H.logoWidthCm || 4) * 567) + 200) : 0, tw = W - lw;
    const bdr = H.rule !== false ? '<w:top w:val="nil"/><w:left w:val="nil"/><w:right w:val="nil"/>' + ln('bottom', 6, COL(H.ruleColor || 'LINE')) : NONE;
    const cells = lw ? (H.logoSide === 'right' ? [tc(tx, tw, { bdr, mar: [0, 0, 120, 0] }), tc(logo, lw, { bdr, mar: [0, 0, 120, 0] })]
      : [tc(logo, lw, { bdr, mar: [0, 0, 120, 0] }), tc(tx, tw, { bdr, mar: [0, 0, 120, 0] })]) : [tc(tx, W, { bdr, mar: [0, 0, 120, 0] })];
    return root + tbl([cells], lw ? (H.logoSide === 'right' ? [tw, lw] : [lw, tw]) : [W]) + END + '</w:hdr>';
  }
  function relsXml(media) {
    let x = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' + (TPL.rels || '');
    media.forEach(md => { x += `<Relationship Id="${md.rid}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${esc(md.file)}"/>`; });
    return x + '</Relationships>';
  }

  // ================================================================ СБОРКА
  /* S — данные КП; Min — изображения: { items:{[id]:{tile,…}}, sign:{sign, stamp} } (файлы уже в word/media);
     roots — корневые теги document.xml, footer.xml, header.xml; tpl — настройки шаблона (template.json + base.docx). */
  function build(S, Min, roots, tpl) {
    setTemplate(tpl);
    PID = 9000;
    const media = [], M = { items: {}, sign: {} };
    let n = 0;
    const reg = x => { if (!x) return null; const rid = 'rIdImg' + (++n); media.push({ rid, file: x.file }); return Object.assign({ rid }, x); };
    if (BLK.specsPhoto) for (const id in (Min.items || {})) M.items[id] = { tile: reg(Min.items[id].tile) };
    M.sign = { sign: BLK.signImage ? reg((Min.sign || {}).sign) : null, stamp: BLK.stampImage ? reg((Min.sign || {}).stamp) : null };
    const floats = [];
    const parts = {
      requisites: () => requisitesXml(S),
      offer: sec => offerXml(S, sec),
      conditions: sec => conditionsXml(S, sec),
      specs: sec => specsXml(S, sec, M),
      supplier: sec => supplierXml(S, sec),
      signature: sec => signatureXml(S, sec, M, floats)
    };
    let body = '';
    for (const sec of TPL.sections) if (sec.on && parts[sec.id]) body += parts[sec.id](sec) || '';
    body += END;
    return {
      document: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' + roots.document + '<w:body>' + body + (TPL.sect || '') + '</w:body></w:document>',
      footer: footerXml(S, roots.footer),
      rels: relsXml(media),
      header: TPL.header && TPL.header.on && roots.header ? headerXml(S, roots.header) : null,
      media, floats
    };
  }

  return { defaults: DEFAULTS, build, features: ['header', 'kit', 'sign'] };
}
