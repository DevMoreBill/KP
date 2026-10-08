/* ============================================================================
   СКЕЛЕТ ШАБЛОНА КП — раскладка страниц документа Word.

   Этот файл лежит в папке шаблона и читается программой при каждом сохранении КП:
   правки вступают в силу сразу, без пересборки программы.

   Обычно править его не нужно: цвета, шрифт, размеры текста, все надписи, порядок
   и включение разделов, правила заполнения настраиваются в программе —
   кнопка «Настроить шаблон» (они хранятся в template.json рядом с этим файлом).
   Шапка страницы, поля и размер листа — в base.docx (правится в Word).

   Здесь — «каркас»: какие блоки есть на каждой странице и как они расположены.
   Если что-то сломалось — в редакторе шаблона есть «Вернуть заводской шаблон».

   Устройство:
     DEFAULTS            — настройки по умолчанию (template.json переопределяет любые из них);
     coverXml            — титульный лист;
     clientsXml          — страница «Наши клиенты»;
     equipXml            — страница оборудования (описание, узлы, характеристики, фото);
     offerXml            — таблица «Коммерческое предложение» с итогами;
     conditionsXml       — «Условия предложения»;
     contactsXml         — «Контактная информация»;
     footerXml           — нижний колонтитул;
     headerXml           — шапка страницы из настроек (header.on): логотип и реквизиты — для новой компании без Word;
     build               — сборка документа из разделов в порядке settings.sections.
   Свои картинки и надписи шаблона (images, labels) — в начале или в конце раздела (place: '<раздел>Top' | '<раздел>End'):
   строкой или свободно (float: плавающий объект Word со смещением x, y см от абзаца привязки, размер widthCm × heightCm).
   imgSize — размер картинок макета без сохранения пропорций; para — сдвиг абзацев по стилю (выравнивание, отступы).
   design: true — пометки для графического редактора (стиль текста — KPS_<стиль>, картинка — KPI_<правило>,
   надпись — KPL_<id>, начало раздела — KPSEC_<раздел>, место привязки — KPANC_<место>).
   Размеры: ширина в «твипах» (1 см = 567), изображения в EMU (1 см = 360000).
   ============================================================================ */
function kpSkeleton(KP) {
  'use strict';
  const { money, words, totals, ruDate, plural, CURS, fill, deepMerge } = KP;
  // скидка для заказчика (для программ без поддержки скидок — без скидок)
  const unitDisc = KP.unitDisc || (() => 0), netPrice = KP.netPrice || (it => it.price || 0);

  // ---------------------------------------------------------------- настройки по умолчанию
  const DEFAULTS = {
    name: 'Шаблон КП',
    description: '',
    filePrefix: 'КП',
    fileName: '{номер}_{префикс}_{клиент}_{оборудование}_{дата}',
    brandParts: [['ПНЕВМО', 'BLUE'], ['ТЕХ', 'SKY']],
    site: 'www.kompr.ru',
    font: 'Arial',
    colors: {
      BLUE: '0B45A0', SKY: '3DA0EE', NAVYD: '143A7F', DARK: '1F2B4D', GRAY: '66718C',
      LIGHT: 'EAF4FD', LINE: 'CFE0F2', HAIR: 'D9E6F3', WHITE: 'FFFFFF'
    },
    // порядок разделов документа; on — включён; newPage — начинать с новой страницы
    sections: [
      { id: 'cover', on: true },
      { id: 'clients', on: true, newPage: true },
      { id: 'equipment', on: true, newPage: true },
      { id: 'offer', on: true, newPage: true },
      { id: 'conditions', on: true, newPage: false },
      { id: 'contacts', on: true, newPage: false }
    ],
    // отдельные блоки внутри разделов
    blocks: {
      coverKpis: true, coverTotal: true, coverDetailsNote: true, coverAbout: true, coverAdvantages: true, coverTrust: true,
      equipLogo: true, equipKeyParams: true, equipOptions: true, equipKit: true, equipKitCards: true, offerKit: true, coverKit: true, equipComponents: true, equipFeatures: true, equipSpecs: true, specNote: true, equipGallery: true,
      discount: true, amountInWords: true, currencyNote: true, footer: true
    },
    // правила заполнения и раскладки
    rules: {
      compactCoverFrom: 4,        // с какого числа моделей титул делается плотнее
      coverModelsPerRow: 4,       // моделей в ряду на титуле (больше — в два ряда)
      coverPhotoWidthCm: 7, coverPhotoHeightCm: 5,
      coverOptionsMax: 5,         // сколько опций перечислять в «Включая: …»
      advantagesMax: 3,
      logoWidthCm: 3.75,
      equipPhotoWidthCm: 8.8,
      longFeatureChars: 230,      // описание длиннее — уходит в раздел «Особенности и комплектация»
      specTwoColumnsFrom: 15,     // строк в характеристиках, с которых карточки групп встают в две колонки
      specLongValueChars: 32,     // значение длиннее — выводится текстом во всю ширину карточки
      heroPhotoHeightCm: 6.5,     // высота рамки главного фото на странице оборудования
      keyParamsMax: 6,            // плиток ключевых параметров рядом с фото
      keyParamMaxChars: 28,       // значения длиннее в плитки не берутся
      componentPhotoWidthCm: 4.6, componentPhotoHeightCm: 3.2,
      kitKeyParams: 3,            // характеристик элемента в таблице «Состав изделия» (полностью — в карточке элемента)
      kitPhotoWidthCm: 3.6, kitPhotoHeightCm: 2.8,
      clientsWidthCm: 0           // ширина картинки «Наши клиенты», 0 — во всю ширину текста
    },
    // шапка страницы из настроек (вместо шапки base.docx): логотип слева или справа, реквизиты строками
    header: { on: false, logo: '', logoWidthCm: 4, logoHeightCm: 0, logoSide: 'left', lines: '', textSize: 8, textColor: 'GRAY', firstBold: true, firstColor: 'BLUE', rule: true, ruleColor: 'LINE' },
    // дополнительные картинки шаблона (баннер, печать, подпись…): место — начало/конец раздела;
    // float: true — свободно на странице (x, y — см от места привязки), widthCm × heightCm (0 — по пропорциям)
    images: [],
    // свои надписи: текст с подстановками {клиент} {номер} {дата} {менеджер} {телефон} {email} {сайт};
    // свободно на странице (рамка widthCm × heightCm в точке x, y) или строкой в начале/конце раздела
    labels: [],
    // размер картинок макета без сохранения пропорций: { ключ: { w, h } } (см; ключ — правило ширины)
    imgSize: {},
    // сдвиг абзацев по стилю: { стиль | 'IMG_'+ключ: { align, indent (см), before, after (пт) } } — прибавляется к макету
    para: {},
    texts: {
      coverKicker: 'Технико-коммерческое предложение',
      recipient: 'Получатель', object: 'Объект', date: 'Дата',
      inn: 'ИНН {inn}', attention: 'Вниманию: {contact}', supplyUnits: 'Поставка оборудования: {units} ед.',
      coverMultiTitle: 'Оборудование',
      coverMultiDesc: 'В предложение входят {count} оборудования. Характеристики каждой модели приведены на отдельной странице.',
      coverModelsTitle: 'Оборудование в предложении', kpisTitle: 'Ключевые параметры',
      supplyTitle: 'Состав поставки', including: 'Включая: {list}', includingMore: ' и др.',
      priceWithVat: 'Стоимость с НДС {vat} %',
      detailsNote: 'Детальный расчёт по позициям приведён в разделе «Коммерческое предложение».',
      aboutTitle: 'О компании', trustLabel: 'Нам доверяют: ', trustMore: ' — полный список на следующей странице.',
      equipOptionsTitle: 'Дополнительная комплектация', componentsTitle: 'Узлы и компоненты',
      kitTitle: 'Состав изделия', kitColName: 'Элемент', kitColParams: 'Основные характеристики', kitCardsTitle: 'Элементы изделия',
      kitMaker: 'Производитель: {maker}', kitInOffer: 'в составе', kitCover: 'В составе: {list}',
      featuresTitle: 'Особенности и комплектация', specsTitle: 'Технические характеристики',
      specParam: 'Параметр', specValue: 'Значение',
      specNote: 'Синим выделены ключевые параметры. Характеристики приведены по данным производителя.',
      galleryTitle: 'Фото и схемы',
      offerTitle: 'Коммерческое предложение',
      colNo: '№', colName: 'Наименование', colQty: 'Кол-во', colPrice: 'Цена за ед., {cur}', colSum: 'Сумма, {cur}',
      colDisc: 'Скидка', subtotal: 'Сумма без скидки', discountTotal: 'Скидка', coverDiscount: 'с учётом скидки {sum} {cur}',
      pcs: 'шт.', included: 'включено', total: 'Итого', vatIncl: 'в т. ч. НДС {vat} %', grandTotal: 'Итого к оплате с НДС',
      inWordsLabel: 'Итого: ', inWords: '{words}, в т. ч. НДС {vat} % — {vatSum} {cur}',
      currencyNote: 'Цены указаны в {curName}. Оплата производится в рублях по курсу ЦБ РФ на дату оплаты.',
      currencyRate: ' Справочно: курс ЦБ РФ{rateDate} — 1 {cur} = {rate} руб.; сумма в рублях — {rub} руб.',
      conditionsTitle: 'Условия предложения', condExtraTitle: 'Дополнительные условия', contactsTitle: 'Контактная информация',
      closing1: 'С уважением и надеждой', closing2: 'на плодотворное сотрудничество',
      phone: 'Телефон', ext: ' доб. {ext}', mobile: 'Мобильный', email: 'E-mail', site: 'Сайт', hours: 'Часы работы', address: 'Адрес',
      footerText: 'Технико-коммерческое предложение для'
    },
    // стили текста: size — пт, color — ключ цвета (BLUE…) или HEX, spacing — разрядка, пт
    styles: {
      heading: { size: 16, color: 'BLUE', bold: true },
      blockTitle: { size: 7.5, color: 'BLUE', bold: true, caps: true, spacing: 1 },
      coverKicker: { size: 8, color: 'BLUE', bold: true, caps: true, spacing: 1.5 },
      coverTitle: { size: 15, color: 'DARK' },
      coverModel: { size: 26, color: 'BLUE', bold: true },
      coverModelMulti: { size: 18, color: 'BLUE', bold: true },
      coverDesc: { size: 9.5, color: 'GRAY' },
      metaLabel: { size: 7, color: 'BLUE', bold: true, caps: true, spacing: 1 },
      clientName: { size: 12, color: 'BLUE', bold: true },
      metaObject: { size: 9, color: 'DARK', bold: true },
      metaDate: { size: 11, color: 'DARK', bold: true },
      muted: { size: 7.5, color: 'GRAY' },
      stationModel: { size: 10, color: 'BLUE', bold: true },
      stationPower: { size: 8, color: 'DARK' },
      kpiValue: { size: 20, color: 'BLUE', bold: true },
      kpiUnit: { size: 10, color: 'SKY', bold: true },
      boxLabel: { size: 7, color: 'GRAY', caps: true, spacing: 1 },
      boxValue: { size: 12, color: 'DARK', bold: true },
      boxSum: { size: 16, color: 'BLUE', bold: true },
      boxCurrency: { size: 11, color: 'BLUE', bold: true },
      note: { size: 7.5, color: 'GRAY', italic: true },
      about: { size: 9.5, color: 'DARK' },
      advTitle: { size: 9.5, color: 'DARK', bold: true },
      advText: { size: 8, color: 'GRAY' },
      trustLabel: { size: 8, color: 'DARK', bold: true },
      trustText: { size: 8, color: 'GRAY' },
      featureLabel: { size: 7, color: 'BLUE', bold: true, caps: true, spacing: 0.75 },
      featureText: { size: 8.5, color: 'DARK' },
      photoCaption: { size: 6.5, color: 'GRAY', caps: true, spacing: 0.75 },
      componentLabel: { size: 7.5, color: 'BLUE', bold: true, caps: true, spacing: 0.75 },
      componentText: { size: 9, color: 'DARK' },
      tableHeader: { size: 7, color: 'WHITE', bold: true, caps: true, spacing: 0.75 },
      specGroup: { size: 8, color: 'BLUE', bold: true, caps: true, spacing: 1 },
      specName: { size: 8, color: 'DARK' },
      specValue: { size: 8, color: 'DARK', bold: true },
      specValueKey: { size: 8, color: 'BLUE', bold: true },
      specNote: { size: 7, color: 'GRAY', italic: true },
      specText: { size: 8, color: 'DARK' },
      subheading: { size: 11, color: 'BLUE', bold: true },
      heroValue: { size: 12, color: 'BLUE', bold: true },
      heroLabel: { size: 7, color: 'GRAY' },
      galleryCaption: { size: 8, color: 'DARK', bold: true },
      rowIndex: { size: 9, color: 'GRAY' },
      itemName: { size: 9.5, color: 'DARK', bold: true },
      cell: { size: 9, color: 'DARK' },
      cellBold: { size: 9, color: 'DARK', bold: true },
      option: { size: 8.5, color: 'DARK' },
      optionNote: { size: 7, color: 'GRAY' },
      totalLabel: { size: 8, color: 'GRAY' },
      totalValue: { size: 8.5, color: 'DARK', bold: true },
      grandLabel: { size: 9, color: 'WHITE', bold: true, caps: true, spacing: 0.75 },
      grandSum: { size: 12, color: 'WHITE', bold: true },
      wordsLabel: { size: 7.5, color: 'DARK', bold: true },
      words: { size: 7.5, color: 'DARK' },
      condLabel: { size: 9, color: 'GRAY' },
      condValue: { size: 9, color: 'DARK' },
      managerName: { size: 15, color: 'BLUE', bold: true },
      managerPost: { size: 9.5, color: 'DARK' },
      closing: { size: 8.5, color: 'GRAY', italic: true },
      contactLabel: { size: 7, color: 'GRAY', bold: true, caps: true, spacing: 1 },
      contactPhone: { size: 11, color: 'DARK', bold: true },
      contactExt: { size: 9.5, color: 'GRAY' },
      contactLink: { size: 10, color: 'BLUE', bold: true },
      contactValue: { size: 10, color: 'DARK' },
      footer: { size: 7, color: 'GRAY' },
      footerClient: { size: 7, color: 'DARK', bold: true },
      footerPage: { size: 8, color: 'BLUE', bold: true },
      footerBrand: { size: 7.5, color: 'DARK', bold: true },
      aboutBrand: { size: 9.5, color: 'DARK', bold: true }
    },
    about: '',
    advantages: [],
    trust: '',
    clientsTitle: 'Наши клиенты',
    closing: ''
  };

  // ---------------------------------------------------------------- текущие настройки
  let TPL = DEFAULTS, T = DEFAULTS.texts, RULES = DEFAULTS.rules, BLK = DEFAULTS.blocks;
  let BLUE, SKY, NAVYD, DARK, GRAY, LIGHT, LINE, HAIR;
  const BASEW = 10347;       // ширина текста, под которую нарисованы пропорции (А4, поля 1,25 / 1,5 см)
  let W = BASEW;             // фактическая ширина текста — из полей страницы base.docx
  const E = 635, NB = ' ', CM = 360000;

  function setTemplate(t) {
    TPL = deepMerge(DEFAULTS, t || {});
    // разделы: порядок и флажки из шаблона; разделы, которых там нет, добавляются в конец
    const given = Array.isArray(t && t.sections) ? t.sections.filter(s => s && DEFAULTS.sections.some(d => d.id === s.id)) : [];
    TPL.sections = given.map(s => Object.assign({}, DEFAULTS.sections.find(d => d.id === s.id), s))
      .concat(DEFAULTS.sections.filter(d => !given.some(s => s.id === d.id)));
    T = TPL.texts; RULES = TPL.rules; BLK = TPL.blocks;
    const c = TPL.colors;
    BLUE = c.BLUE; SKY = c.SKY; NAVYD = c.NAVYD; DARK = c.DARK; GRAY = c.GRAY; LIGHT = c.LIGHT; LINE = c.LINE; HAIR = c.HAIR;
    W = BASEW;
    const sect = TPL.sect || '';
    const pw = /<w:pgSz[^>]*w:w="(\d+)"/.exec(sect), ml = /<w:pgMar[^>]*w:left="(\d+)"/.exec(sect), mr = /<w:pgMar[^>]*w:right="(\d+)"/.exec(sect);
    if (pw && ml && mr) W = +pw[1] - +ml[1] - +mr[1];
  }
  const COL = k => (TPL.colors && TPL.colors[k]) || String(k || '').replace(/^#/, '');
  // пропорциональный пересчёт ширины под фактические поля страницы
  const X = v => Math.round(v * W / BASEW);
  function cols(arr) {
    const total = X(arr.reduce((a, b) => a + b, 0)), out = arr.map(X);
    out[out.length - 1] += total - out.reduce((a, b) => a + b, 0);
    return out;
  }
  // стиль текста по имени из настроек (+ разовые правки)
  function sty(name, extra) {
    const s = TPL.styles[name] || {};
    return Object.assign({ sz: Math.round((+s.size || 10) * 2), color: COL(s.color || 'DARK'), b: !!s.bold, i: !!s.italic, caps: !!s.caps,
      sp: s.spacing ? Math.round(+s.spacing * 20) : 0 }, extra || {});
  }
  const txt = (key, vars) => fill(T[key] == null ? '' : T[key], vars || {});
  const brandRuns = (styleName) => { const s = sty(styleName); return (TPL.brandParts || []).map(([t, c]) => r(t, { sz: s.sz, color: COL(c), b: s.b, mk: TPL.design ? 'KPS_' + styleName : '' })).join(''); };

  const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  // ---------------------------------------------------------------- строительные блоки Word
  function r(t, o = {}) {
    if (typeof o === 'string') { const nm = o; o = sty(o); if (TPL.design) o.mk = 'KPS_' + nm; if (RUNSTY === null) RUNSTY = nm; }
    const sz = o.sz || 20, color = o.color || DARK, f = esc(TPL.font || 'Arial');
    let rp = (o.mk ? `<w:rStyle w:val="${o.mk}"/>` : '') + `<w:rFonts w:ascii="${f}" w:eastAsia="${f}" w:hAnsi="${f}" w:cs="${f}"/>`;
    if (o.b) rp += '<w:b/><w:bCs/>';
    if (o.i) rp += '<w:i/><w:iCs/>';
    if (o.caps) rp += '<w:caps/>';
    rp += `<w:color w:val="${color}"/>`;
    if (o.sp) rp += `<w:spacing w:val="${o.sp}"/>`;
    rp += `<w:sz w:val="${sz}"/><w:szCs w:val="${sz}"/><w:lang w:val="ru-RU"/>`;
    // перенос строки в тексте (список «• …» в описании) — разрыв строки внутри абзаца
    return String(t == null ? '' : t).split(/\r?\n/).map(line => `<w:r><w:rPr>${rp}</w:rPr><w:t xml:space="preserve">${esc(line)}</w:t></w:r>`).join('<w:r><w:br/></w:r>');
  }
  function p(runs = '', o = {}) {
    // сдвиг абзаца из графического редактора: по стилю первого текста (или картинке) в абзаце
    const adj = RUNSTY && TPL.para && TPL.para[RUNSTY]; RUNSTY = null;
    if (adj) {
      o = Object.assign({}, o);
      if (adj.align) o.jc = adj.align;
      if (+adj.before) o.before = Math.max(0, (o.before || 0) + Math.round(+adj.before * 20));
      if (+adj.after) o.after = Math.max(0, (o.after || 0) + Math.round(+adj.after * 20));
      if (+adj.indent) o.indL = Math.max(-1134, (o.indL || 0) + Math.round(+adj.indent * 567));
    }
    let pp = '';
    if (o.keep) pp += '<w:keepNext/>';
    if (o.pbb) pp += '<w:pageBreakBefore/>';
    if (o.bdr) pp += `<w:pBdr>${o.bdr}</w:pBdr>`;
    const ls = o.line ? ` w:line="${o.line}" w:lineRule="auto"` : '';
    pp += `<w:spacing w:before="${o.before || 0}" w:after="${o.after || 0}"${ls}/>`;
    if (o.indL || o.indR) pp += `<w:ind w:left="${o.indL || 0}" w:right="${o.indR || 0}"/>`;
    pp += `<w:jc w:val="${o.jc || 'left'}"/>`;
    return `<w:p><w:pPr>${pp}</w:pPr>${runs}</w:p>`;
  }
  const spacer = h => `<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="${h}" w:lineRule="exact"/><w:rPr><w:sz w:val="2"/></w:rPr></w:pPr></w:p>`;
  const END = '<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="20" w:lineRule="exact"/></w:pPr></w:p>';
  const line = (side, sz, color) => `<w:${side} w:val="single" w:sz="${sz}" w:space="0" w:color="${color}"/>`;
  function B(top, left, bottom, right) {
    const one = (s, v) => v ? line(s, v[0], v[1]) : `<w:${s} w:val="nil"/>`;
    return one('top', top) + one('left', left) + one('bottom', bottom) + one('right', right);
  }
  function tc(content, w, o = {}) {
    const [t, l, b, rr] = o.mar || [70, 120, 70, 120];
    let pr = `<w:tcW w:w="${w}" w:type="dxa"/>`;
    if (o.span > 1) pr += `<w:gridSpan w:val="${o.span}"/>`;
    pr += `<w:tcBorders>${o.bdr || B()}</w:tcBorders>`;
    if (o.fill) pr += `<w:shd w:val="clear" w:color="auto" w:fill="${o.fill}"/>`;
    pr += `<w:tcMar><w:top w:w="${t}" w:type="dxa"/><w:left w:w="${l}" w:type="dxa"/><w:bottom w:w="${b}" w:type="dxa"/><w:right w:w="${rr}" w:type="dxa"/></w:tcMar>`;
    pr += `<w:vAlign w:val="${o.va || 'center'}"/>`;
    return `<w:tc><w:tcPr>${pr}</w:tcPr>${content || '<w:p/>'}</w:tc>`;
  }
  function tbl(rows, widths, o = {}) {
    const grid = widths.map(x => `<w:gridCol w:w="${x}"/>`).join('');
    const pr = `<w:tblW w:w="${widths.reduce((a, b) => a + b, 0)}" w:type="dxa"/><w:tblInd w:w="0" w:type="dxa"/>` +
      '<w:tblBorders><w:top w:val="nil"/><w:left w:val="nil"/><w:bottom w:val="nil"/><w:right w:val="nil"/><w:insideH w:val="nil"/><w:insideV w:val="nil"/></w:tblBorders>' +
      '<w:tblLayout w:type="fixed"/><w:tblCellMar><w:left w:w="0" w:type="dxa"/><w:right w:w="0" w:type="dxa"/></w:tblCellMar><w:tblLook w:val="0000"/>';
    const hs = o.heights || {};
    const body = rows.map((row, i) => {
      let trp = '';
      if (hs[i]) trp += `<w:trHeight w:val="${hs[i]}" w:hRule="exact"/>`;
      if (o.split !== true) trp += '<w:cantSplit/>';
      if (o.header && i === 0) trp += '<w:tblHeader/>';
      return `<w:tr><w:trPr>${trp}</w:trPr>${row.join('')}</w:tr>`;
    }).join('');
    return `<w:tbl><w:tblPr>${pr}</w:tblPr><w:tblGrid>${grid}</w:tblGrid>${body}</w:tbl>`;
  }
  let PID = 9000, RUNSTY = null;
  // рисунок как графический объект Word
  const picXml = (id, rid, cx, cy, name) => '<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">' +
    '<pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">' +
    `<pic:nvPicPr><pic:cNvPr id="${id}" name="${esc(name)}"/><pic:cNvPicPr/></pic:nvPicPr>` +
    `<pic:blipFill><a:blip r:embed="${rid}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>` +
    `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic>`;
  // плавающий объект: x — от левого края текста, y — от абзаца привязки (см); не сдвигает текст
  function anchorRun(graphic, id, cx, cy, x, y, name, mk, behind) {
    return '<w:r><w:rPr>' + (TPL.design && mk ? `<w:rStyle w:val="${mk}"/>` : '') + '<w:noProof/></w:rPr><w:drawing>' +
      `<wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" relativeHeight="${251659264 + id}" behindDoc="${behind ? 1 : 0}" locked="0" layoutInCell="1" allowOverlap="1">` +
      `<wp:simplePos x="0" y="0"/><wp:positionH relativeFrom="column"><wp:posOffset>${cm(x || 0)}</wp:posOffset></wp:positionH>` +
      `<wp:positionV relativeFrom="paragraph"><wp:posOffset>${cm(y || 0)}</wp:posOffset></wp:positionV>` +
      `<wp:extent cx="${cx}" cy="${cy}"/><wp:effectExtent l="0" t="0" r="0" b="0"/><wp:wrapNone/><wp:docPr id="${id}" name="${esc(name)}"/><wp:cNvGraphicFramePr/>` +
      graphic + '</wp:anchor></w:drawing></w:r>';
  }
  function img(rid, cx, cy, name, key) {
    const id = ++PID;
    const fix = key && TPL.imgSize && TPL.imgSize[key];   // размер из графического редактора (пропорции не сохраняются)
    if (fix && +fix.w > 0) { const k = cx ? cy / cx : 1; cx = cm(fix.w); cy = +fix.h > 0 ? cm(fix.h) : Math.round(cx * k); }
    if (key && RUNSTY === null) RUNSTY = 'IMG_' + key;
    return '<w:r><w:rPr>' + (TPL.design && key ? `<w:rStyle w:val="KPI_${key}"/>` : '') + '<w:noProof/></w:rPr><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0">' +
      `<wp:extent cx="${cx}" cy="${cy}"/><wp:effectExtent l="0" t="0" r="0" b="0"/><wp:docPr id="${id}" name="${esc(name)}"/>` +
      '<wp:cNvGraphicFramePr><a:graphicFrameLocks xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" noChangeAspect="1"/></wp:cNvGraphicFramePr>' +
      '<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">' +
      '<pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">' +
      `<pic:nvPicPr><pic:cNvPr id="${id}" name="${esc(name)}"/><pic:cNvPicPr/></pic:nvPicPr>` +
      `<pic:blipFill><a:blip r:embed="${rid}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>` +
      `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>` +
      '</pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>';
  }
  // скруглённая подложка за таблицей
  function rbg(wd, hd, color, rad, yoff, xoff) {
    const id = ++PID, w = wd * E, h = hd * E;
    const adj = Math.floor(Math.min(50000, rad / Math.min(wd, hd) * 100000));
    const arc = (2 * adj / 100000).toFixed(4);
    const dml = `<wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" relativeHeight="${id}" behindDoc="1" locked="0" layoutInCell="1" allowOverlap="1">` +
      '<wp:simplePos x="0" y="0"/><wp:positionH relativeFrom="column"><wp:posOffset>' + ((xoff || 0) * E) + '</wp:posOffset></wp:positionH>' +
      `<wp:positionV relativeFrom="paragraph"><wp:posOffset>${yoff * E}</wp:posOffset></wp:positionV>` +
      `<wp:extent cx="${w}" cy="${h}"/><wp:effectExtent l="0" t="0" r="0" b="0"/><wp:wrapNone/>` +
      `<wp:docPr id="${id}" name="Подложка ${id}"/><wp:cNvGraphicFramePr/>` +
      '<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.microsoft.com/office/word/2010/wordprocessingShape">' +
      `<wps:wsp><wps:cNvSpPr/><wps:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${w}" cy="${h}"/></a:xfrm>` +
      `<a:prstGeom prst="roundRect"><a:avLst><a:gd name="adj" fmla="val ${adj}"/></a:avLst></a:prstGeom>` +
      `<a:solidFill><a:srgbClr val="${color}"/></a:solidFill><a:ln><a:noFill/></a:ln></wps:spPr><wps:bodyPr/></wps:wsp></a:graphicData></a:graphic></wp:anchor>`;
    const vml = `<w:pict><v:roundrect id="bg${id}" o:spid="_x0000_s${id}" arcsize="${arc}" style="position:absolute;margin-left:${(xoff || 0) / 20}pt;margin-top:${yoff / 20}pt;width:${wd / 20}pt;height:${hd / 20}pt;z-index:-${id};mso-position-horizontal-relative:text;mso-position-vertical-relative:text" fillcolor="#${color}" stroked="f"/></w:pict>`;
    return '<w:r><w:rPr><w:noProof/></w:rPr><mc:AlternateContent><mc:Choice Requires="wps"><w:drawing>' + dml +
      '</w:drawing></mc:Choice><mc:Fallback>' + vml + '</mc:Fallback></mc:AlternateContent></w:r>';
  }
  const bgpara = (wd, hd, color, rad = 110, h = 20) =>
    `<w:p><w:pPr><w:keepNext/><w:spacing w:before="0" w:after="0" w:line="${h}" w:lineRule="exact"/><w:rPr><w:sz w:val="2"/></w:rPr></w:pPr>${rbg(wd, hd, color, rad, h)}</w:p>`;
  const hyper = (rid, runs) => `<w:hyperlink r:id="${rid}">${runs}</w:hyperlink>`;

  // заголовок раздела: крупный текст и короткая линия-акцент
  const HEADMARK = '\u0001KPHEAD\u0001';   // место сразу после заголовка раздела (для картинок «в начале раздела»)
  function heading(title, pbb) {
    return p(r(title, 'heading'), { after: 90, keep: true, line: 240, pbb }) +
      p('', { after: 220, indR: W - X(1500), keep: true, bdr: line('bottom', 18, SKY) }) + HEADMARK;
  }
  const blockTitle = (t, o) => p(r(t, 'blockTitle'), o || { after: 120 });

  const curCode = S => (S && S.cur && S.cur.code) || 'RUB';
  const curSh = S => (CURS[curCode(S)] || CURS.RUB).sh;
  const cm = v => Math.round(+v * CM);

  // ================================================================ ТИТУЛЬНЫЙ ЛИСТ
  function coverXml(S, M) {
    const out = [], t = totals(S.items, S.vat);
    const tight = (S.stations || []).filter(x => x && x.model).length >= RULES.compactCoverFrom;
    const meta = (label, val, sub, w, first, jc) => {
      const bd = line('top', 4, LINE) + (first ? '<w:left w:val="nil"/>' : line('left', 4, LINE)) + line('bottom', 4, LINE) + '<w:right w:val="nil"/>';
      return tc(p(r(label, 'metaLabel'), { after: 50, jc }) + p(val, { after: 30, line: 240, jc }) + p(sub, { line: 240, jc }),
        w, { bdr: bd, va: 'top', mar: [170, first ? 0 : 240, 170, 0] });
    };
    const ct = S.contact || {}, ob = S.object || {};
    const subParts = [S.clientInn ? txt('inn', { inn: S.clientInn }) : '', ct.name ? txt('attention', { contact: [ct.post, ct.name].filter(Boolean).join(' ') }) : ''].filter(Boolean);
    const sub = subParts.length ? subParts.map(x => r(x, 'muted')).join('<w:r><w:br/></w:r>') : r(txt('supplyUnits', { units: t.units }), 'muted');
    const dateCell = (w) => meta(T.date, r(ruDate(S.date), 'metaDate'), r((S.number ? '№ ' + S.number + (S.city ? ' · ' + S.city : '') : (S.city || '')), 'muted'), w, false, 'right');
    const cn = sty('clientName');
    if (ob.purpose || ob.address) {
      // получатель · объект · дата
      const w3 = cols([4100, 3647, 2600]);
      out.push(tbl([[meta(T.recipient, r(S.client, Object.assign({}, cn, { sz: cn.sz - 2 })), sub, w3[0], true, 'left'),
        meta(T.object, r(ob.purpose || ob.address, 'metaObject'), r(ob.purpose ? (ob.address || '') : '', 'muted'), w3[1], false, 'left'),
        dateCell(w3[2])]], w3));
    } else {
      const w2 = cols([6847, 3500]);
      out.push(tbl([[meta(T.recipient, r(S.client, cn), sub, w2[0], true, 'left'), dateCell(w2[1])]], w2));
    }
    out.push(spacer(tight ? 500 : 900));
    const c = S.cover;
    let left = p(r(T.coverKicker, 'coverKicker'), { after: 160 });
    if (c.title) left += p(r(c.title, 'coverTitle'), { line: 240 });
    const multiHdr = (S.stations || []).filter(x => x && x.model).length >= 2;
    const hdrRuns = (tx, o) => {   // модели не разрываются посередине: неразрывные пробелы и дефисы
      const hy = r('-', o).replace(/<w:t xml:space="preserve">-<\/w:t>/, '<w:noBreakHyphen/>');
      return String(tx).split(' · ').map(m => m.split('-').map(part => r(part.replace(/ /g, NB), o)).join(hy)).join(r(' · ', o));
    };
    left += p(multiHdr ? hdrRuns(c.model || '', sty('coverModelMulti')) : r(c.model || '', 'coverModel'), { after: 120, line: 240 });
    left += p('', { after: 200, indR: X(4700), bdr: line('bottom', 18, SKY) });
    if (c.desc) left += p(r(c.desc, 'coverDesc'), { line: 276 });
    const ST = (S.stations || []).filter(x => x && x.model);
    const multi = ST.length >= 2;
    if (multi) {
      // несколько моделей: карточки с фото в один или два ряда
      out.push(left);
      out.push(spacer(tight ? 300 : 500));
      out.push(blockTitle(T.coverModelsTitle, { after: 120, keep: true }));
      const per = ST.length <= RULES.coverModelsPerRow ? ST.length : Math.ceil(ST.length / 2);
      const rowsN = Math.ceil(ST.length / per);
      const w = Math.floor(W / per), ws = Array.from({ length: per }, (_, i) => i === per - 1 ? W - w * (per - 1) : w);
      const BOXW = Math.min(3.8 * CM, (w - 300) * E), BOXH = (rowsN > 1 ? 2.0 : 2.6) * CM;
      const rows = [];
      for (let rI = 0; rI < rowsN; rI++) {
        const cells = [];
        for (let cI = 0; cI < per; cI++) {
          const st = ST[rI * per + cI];
          const bd = cI === 0 ? B() : B(null, [4, LINE]);
          if (!st) { cells.push(tc('', ws[cI], { bdr: bd })); continue; }
          const th = M.thumbs && M.thumbs[st.key];
          let ph = '';
          if (th) { const k = Math.min(BOXW / th.w, BOXH / th.h); ph = p(img(th.rid, Math.round(th.w * k), Math.round(th.h * k), st.model), { jc: 'center', after: 100 }); }
          const body = ph + p(r(st.model, 'stationModel'), { jc: 'center', after: 30, line: 240 }) +
            (st.power ? p(r(st.power, 'stationPower'), { jc: 'center', after: 20, line: 240 }) : '') +
            p(r([st.exec, st.qty ? st.qty + NB + T.pcs : ''].filter(Boolean).join(' · '), 'muted'), { jc: 'center', line: 240 });
          cells.push(tc(body, ws[cI], { bdr: bd, va: 'top', mar: [60, 120, 60, 120] }));
        }
        rows.push(cells);
      }
      out.push(tbl(rows, ws));
    } else if (M.cover) {
      // одна модель: фото вписывается в рамку с сохранением пропорций
      const BOXW = cm(RULES.coverPhotoWidthCm), BOXH = cm(RULES.coverPhotoHeightCm);
      const k = Math.min(BOXW / M.cover.w, BOXH / M.cover.h);
      const cxc = Math.round(M.cover.w * k), cyc = Math.round(M.cover.h * k);
      const w2 = cols([6247, 4100]);
      out.push(tbl([[tc(left, w2[0], { va: 'center', mar: [0, 0, 0, 0] }), tc(p(img(M.cover.rid, cxc, cyc, 'Оборудование', 'coverPhotoWidthCm'), { jc: 'right' }), w2[1], { va: 'center', mar: [0, 0, 0, 0] })]], w2));
    } else out.push(left);
    // ключевые параметры
    const kp = multi || !BLK.coverKpis ? [] : (c.kpis || []).filter(k => k.num);
    if (kp.length) {
      out.push(spacer(900));
      out.push(blockTitle(T.kpisTitle));
      const n = kp.length, w = Math.floor(W / n), ws = kp.map((_, i) => i === n - 1 ? W - w * (n - 1) : w);
      out.push(tbl([kp.map((k, i) => {
        const bd = i === 0 ? B() : B(null, [4, LINE]);
        return tc(p(r(k.num, 'kpiValue') + (k.unit ? r(' ' + k.unit, 'kpiUnit') : ''), { after: 40, line: 240 }) +
          p(r(k.cap || '', 'muted'), { line: 240 }), ws[i], { bdr: bd, mar: [60, i === 0 ? 0 : 220, 60, 120] });
      })], ws));
    }
    // плашка «Состав поставки / Стоимость»
    if (BLK.coverTotal) {
      out.push(spacer(tight ? 400 : 760));
      const one = S.items.length === 1;
      const comp = one ? `${S.items[0].qty} × ${c.model || S.items[0].name}` : multi ? `${ST.length} ${plural(ST.length, 'модель', 'модели', 'моделей')}, ${t.units} ед.` : `${S.items.length} ${plural(S.items.length, 'позиция', 'позиции', 'позиций')}, ${t.units} ед.`;
      const optNames = [...new Set((BLK.coverKit ? S.items.flatMap(it => kitOf(it).map(kitName)) : []).concat(S.items.flatMap(it => (it.options || []).filter(o => o.name && +o.qty > 0).map(o => o.short || o.name))))];
      const OM = RULES.coverOptionsMax;
      const c1 = p(r(T.supplyTitle, 'boxLabel'), { after: 40 }) + p(r(comp, 'boxValue'), { after: optNames.length ? 40 : 0 }) +
        (optNames.length ? p(r(txt('including', { list: optNames.slice(0, OM).join(', ') }) + (optNames.length > OM ? T.includingMore : ''), 'muted'), { line: 240 }) : '');
      const showD = BLK.discount && t.discount > 0;
      const c2 = p(r(txt('priceWithVat', { vat: S.vat }), 'boxLabel'), { jc: 'right', after: 40 }) +
        p(r(money(t.sum), 'boxSum') + r(' ' + curSh(S), 'boxCurrency'), { jc: 'right' }) +
        (showD ? p(r(txt('coverDiscount', { sum: money(t.discount), cur: curSh(S) }), 'muted'), { jc: 'right', before: 40, line: 240 }) : '');
      const bh = optNames.length || showD ? 1500 : 1180, w2 = cols([5847, 4500]);
      out.push(bgpara(W, bh, LIGHT, 160));
      out.push(tbl([[tc(c1, w2[0], { mar: [0, 300, 0, 120] }), tc(c2, w2[1], { mar: [0, 120, 0, 300] })]], w2, { heights: { 0: bh } }));
      if (BLK.coverDetailsNote && T.detailsNote) out.push(p(r(T.detailsNote, 'note'), { before: 100 }));
    }
    // о компании, преимущества, «нам доверяют»
    if (BLK.coverAbout || BLK.coverAdvantages) out.push(spacer(tight ? 500 : 900));
    if (BLK.coverAbout) {
      out.push(blockTitle(T.aboutTitle));
      out.push(p(brandRuns('aboutBrand') + r(TPL.about || '', 'about'), { after: 240, line: 276, jc: 'both' }));
    }
    const AD = BLK.coverAdvantages ? (TPL.advantages || []).slice(0, RULES.advantagesMax) : [];
    const adv = (ti, tx, w) => tc(p(r(ti, 'advTitle'), { after: 40 }) + p(r(tx, 'advText'), { line: 250 }), w,
      { bdr: B(null, [18, SKY]), va: 'top', mar: [20, 160, 20, 240] });
    if (AD.length) { const aw = Math.floor(W / AD.length); out.push(tbl([AD.map(([t, x]) => adv(t, x, aw))], AD.map((_, k) => k === AD.length - 1 ? W - aw * (AD.length - 1) : aw))); }
    if (BLK.coverTrust && TPL.trust) {
      out.push(spacer(600));
      out.push(p(r(T.trustLabel, 'trustLabel') + r(TPL.trust + (S.showClients && TPL.clients && sectionOn('clients') ? T.trustMore : '.'), 'trustText'), { line: 250 }));
    }
    return out.join('');
  }

  // ================================================================ НАШИ КЛИЕНТЫ
  function clientsXml(S, sec) {
    if (!S.showClients || !TPL.clients || !TPL.clients.rid) return '';
    const c = TPL.clients, full = Math.round(7108166 * W / BASEW), maxW = +RULES.clientsWidthCm > 0 ? Math.min(full, cm(RULES.clientsWidthCm)) : full;
    const k = Math.min(maxW / c.w, (+RULES.clientsWidthCm > 0 ? 25 * CM : 7400000) / c.h);
    return headingFor(TPL.clientsTitle || 'Наши клиенты', sec, 600) + p(img(c.rid, Math.round(c.w * k), Math.round(c.h * k), 'Логотипы клиентов', 'clientsWidthCm'), { jc: 'center' });
  }

  // ================================================================ СТРАНИЦА ОБОРУДОВАНИЯ
  // Страница позиции: первый экран (фото + ключевые параметры + коротко о главном), узлы и компоненты
  // компактными карточками, особенности списком «подзаголовок — текст», характеристики — отдельной
  // карточкой на каждую группу, фото и схемы. Колонки характеристик независимы: высота строки
  // в одной колонке не влияет на соседнюю.
  const HDR = (t, w, jc = 'left', span = 1) => tc(p(r(t, 'tableHeader'), { jc }), w, { mar: [0, 120, 0, 120], span });
  const PXCAP = 914400 / 150;   // EMU на пиксель при 150 dpi — мелкие картинки не растягиваются
  // «не отрывать»: все абзацы строк таблицы держатся со следующими — Word переносит такой блок целиком
  const keepAll = xml => xml.replace(/<w:pPr>/g, '<w:pPr><w:keepNext/>').replace(/<w:p>(?!<w:pPr>)/g, '<w:p><w:pPr><w:keepNext/></w:pPr>');
  const specVal = row => row.hl ? 'specValueKey' : 'specValue';
  const fit = (g, bw, bh) => { const k = Math.min(bw / g.w, bh / g.h, PXCAP); return [Math.round(g.w * k), Math.round(g.h * k)]; };
  const FRAME = [4, HAIR], NOM = [0, 0, 0, 0];
  const gapCell = w => tc(END, w, { mar: NOM });

  // подраздел страницы оборудования: заголовок и тонкая линия на всю ширину
  function subheading(title, before) {
    return p(r(title, 'subheading'), { before: before == null ? 320 : before, after: 140, keep: true,
      bdr: `<w:bottom w:val="single" w:sz="6" w:space="4" w:color="${LINE}"/>` });
  }

  // ключевые параметры позиции: выделенные синим строки характеристик (или первые строки, если выделенных нет)
  function keyParams(it) {
    const rows = (it.groups || []).flatMap(g => (g.rows || []).filter(x => x.k && x.v));
    let list = rows.filter(x => x.hl);
    if (!list.length) list = rows.slice(0, 4);
    return list.filter(x => String(x.v).length <= RULES.keyParamMaxChars).slice(0, RULES.keyParamsMax);
  }

  // первый экран: слева фото в светлой рамке, справа логотип, плитки ключевых параметров и коротко о главном
  function heroXml(it, m, feats, opts) {
    let right = '';
    if (m.logo && BLK.equipLogo) { const [cx, cy] = fit(m.logo, cm(RULES.logoWidthCm), 560000); right += p(img(m.logo.rid, cx, cy, 'Логотип', 'logoWidthCm'), { after: 200 }); }
    const kp = BLK.equipKeyParams ? keyParams(it) : [];
    const [wl, wg, wr] = m.tile ? cols([4700, 340, 5307]) : [0, 0, W];
    if (kp.length) {
      const half = Math.floor(wr / 2), ws = [half, wr - half], rows = [];
      for (let i = 0; i < kp.length; i += 2) rows.push([0, 1].map(j => {
        const x = kp[i + j], last = i + 2 >= kp.length;
        if (!x) return tc(END, ws[j], { mar: NOM });
        return tc(p(r(x.v, 'heroValue'), { after: 30, line: 240 }) + p(r(x.k, 'heroLabel'), { line: 240 }), ws[j],
          { bdr: B(null, j ? [4, LINE] : null, last ? null : [4, LINE]), va: 'top', mar: [90, j ? 180 : 0, 110, 120] });
      }));
      right += tbl(rows, ws) + spacer(200);
    }
    feats.forEach((f, i) => {
      if (f.label) right += p(r(f.label, 'featureLabel'), { before: i ? 140 : 0, after: 30 });
      right += p(r(f.text || '', 'featureText'), { line: 250 });
    });
    if (opts.length) {
      right += p(r(T.equipOptionsTitle, 'featureLabel'), { before: feats.length ? 160 : 0, after: 30 });
      opts.forEach(o => { right += p(r('+ ' + o.name, 'featureText'), { after: 20, line: 250 }); });
    }
    if (!m.tile) return right;
    const [cx, cy] = fit(m.tile, Math.min(cm(RULES.equipPhotoWidthCm), (wl - 280) * E), cm(RULES.heroPhotoHeightCm));
    const photo = p(img(m.tile.rid, cx, cy, it.name, 'equipPhotoWidthCm'), { jc: 'center', after: it.photoCaption ? 120 : 0 }) +
      (it.photoCaption ? p(r(it.photoCaption, 'photoCaption'), { jc: 'center', line: 240 }) : '');
    return tbl([[tc(photo, wl, { fill: LIGHT, va: 'center', mar: [200, 140, 200, 140] }), gapCell(wg),
      tc(right + END, wr, { va: 'top', mar: NOM })]], [wl, wg, wr]);
  }

  // узлы и компоненты: горизонтальные карточки — небольшое фото слева, подзаголовок и текст справа
  function componentsXml(list, fimg) {
    const out = [subheading(T.componentsTitle)];
    const [wi, wg, wt] = cols([Math.round(RULES.componentPhotoWidthCm * 567), 280, BASEW - Math.round(RULES.componentPhotoWidthCm * 567) - 280]);
    list.forEach((f, n) => {
      const g = fimg[f.id], [cx, cy] = fit(g, (wi - 200) * E, cm(RULES.componentPhotoHeightCm));
      const pic = tc(p(img(g.rid, cx, cy, f.label || 'Узел', 'componentPhotoWidthCm'), { jc: 'center' }), wi, { bdr: B(FRAME, FRAME, FRAME, FRAME), va: 'center', mar: [100, 100, 100, 100] });
      const txt = tc((f.label ? p(r(f.label, 'componentLabel'), { after: 60 }) : '') + p(r(f.text || '', 'componentText'), { line: 252 }), wt, { va: 'center', mar: [40, 0, 40, 0] });
      if (n) out.push(spacer(160));
      out.push(tbl([[pic, gapCell(wg), txt]], [wi, wg, wt]));
    });
    return out.join('');
  }

  // особенности и комплектация: список «подзаголовок слева — текст справа»
  function featuresXml(list) {
    const [wl, wt] = cols([2500, 7847]);
    const rows = list.map((f, i) => {
      const bd = i < list.length - 1 ? B(null, null, [4, HAIR]) : B();
      return [tc(p(r(f.label || '', 'featureLabel'), { line: 240 }), wl, { bdr: bd, va: 'top', mar: [120, 0, 120, 200] }),
        tc(p(r(f.text || '', 'featureText'), { line: 252 }), wt, { bdr: bd, va: 'top', mar: [110, 0, 120, 0] })];
    });
    return subheading(T.featuresTitle) + tbl(rows, [wl, wt]);
  }

  // карточка группы характеристик: название группы (повторяется при переносе на новую страницу) и строки;
  // длинное значение (перечень, условия) — текстом во всю ширину карточки под названием параметра
  function specCard(g, w) {
    const wk = Math.round(w * 0.55), wv = w - wk;
    const rows = [[tc(p(r(g.name || T.specsTitle, 'specGroup'), { line: 240 }), w, { span: 2, fill: LIGHT, bdr: B(null, [36, BLUE]), mar: [90, 140, 80, 140] })]];
    g.rows.forEach((x, i) => {
      const bd = i === g.rows.length - 1 ? B(null, null, [4, LINE]) : B(null, null, [4, HAIR]);
      if (String(x.v || '').length > RULES.specLongValueChars)
        rows.push([tc(p(r(x.k, 'specName'), { after: 40, line: 240 }) + p(r(x.v, x.hl ? 'specValueKey' : String(x.v).length <= 70 ? 'specValue' : 'specText'), { line: 250 }), w,
          { span: 2, bdr: bd, mar: [70, 140, 80, 120] })]);
      else rows.push([tc(p(r(x.k, 'specName'), { line: 240 }), wk, { bdr: bd, va: 'center', mar: [50, 140, 50, 80] }),
        tc(p(r(x.v, specVal(x)), { line: 240 }), wv, { bdr: bd, va: 'center', mar: [50, 80, 50, 120] })]);
    });
    return tbl(rows, [wk, wv], { header: true });
  }
  // примерная высота карточки в строках — для раскладки групп по двум колонкам
  const cardH = g => 1.4 + g.rows.reduce((a, x) => {
    const k = String(x.k || '').length, v = String(x.v || '').length;
    return a + (v > RULES.specLongValueChars ? 1.2 + Math.ceil(v / 58) : Math.max(1, Math.ceil(k / 27), Math.ceil(v / 23)));
  }, 0);
  function specsXml(groups) {
    const out = [subheading(T.specsTitle)];
    const nrows = groups.reduce((a, g) => a + g.rows.length + 1, 0);
    if (nrows < RULES.specTwoColumnsFrom || groups.length < 2) {
      groups.forEach((g, i) => { if (i) out.push(spacer(160)); out.push(specCard(g, W)); });
    } else {
      // группы раскладываются по двум независимым колонкам: каждая следующая — в ту, что короче
      const [c1, cg, c2] = cols([5073, 201, 5073]), A = [], Bc = [];
      let ha = 0, hb = 0;
      for (const g of groups) { const h = cardH(g); if (ha <= hb) { A.push(g); ha += h; } else { Bc.push(g); hb += h; } }
      const stack = (gs, w) => gs.map((g, i) => (i ? spacer(200) : '') + specCard(g, w)).join('') + END;
      out.push(tbl([[tc(stack(A, c1), c1, { va: 'top', mar: NOM }), gapCell(cg), tc(stack(Bc, c2), c2, { va: 'top', mar: NOM })]], [c1, cg, c2], { split: true }));
    }
    if (BLK.specNote && T.specNote) out.push(p(r(T.specNote, 'specNote'), { before: 120 }));
    return out.join('');
  }

  // фото и схемы: карточки 2 в ряд, схемы и чертежи — на всю ширину; ряд переносится на новую страницу целиком
  function galleryXml(list) {
    if (!list || !list.length) return '';
    const out = [subheading(T.galleryTitle)];
    const GAP = X(201), HALF = Math.floor((W - GAP) / 2), FULL = W;
    const card = (g, w, boxW, boxH) => {
      const [cx, cy] = fit(g, boxW, boxH);
      const body = p(img(g.rid, cx, cy, g.caption || 'Изображение'), { jc: 'center', after: g.caption ? 80 : 0 }) +
        (g.caption ? p(r(g.caption, 'galleryCaption'), { jc: 'center', line: 240 }) : '');
      return tc(body, w, { bdr: B(FRAME, FRAME, FRAME, FRAME), va: 'center', mar: [140, 120, 140, 120] });
    };
    const halfBox = [(HALF - 260) * E, list.length <= 2 ? 1450000 : 1850000], fullBox = [(FULL - 260) * E, 3600000];
    // раскладка: половинки парами по порядку; широкое изображение, попавшее между половинками, ставится после пары
    const rows = []; let pend = null; const deferred = [];
    for (const g of list) {
      if (g.wide) { if (pend) deferred.push(g); else rows.push([g]); continue; }
      if (pend) { rows.push([pend, g]); pend = null; while (deferred.length) rows.push([deferred.shift()]); }
      else pend = g;
    }
    if (pend) rows.push([pend]);
    while (deferred.length) rows.push([deferred.shift()]);
    rows.forEach((row, n) => {
      if (n) out.push(spacer(160));
      if (row.length === 2) out.push(tbl([[card(row[0], HALF, ...halfBox), gapCell(FULL - 2 * HALF), card(row[1], HALF, ...halfBox)]], [HALF, FULL - 2 * HALF, HALF]));
      else if (row[0].wide) out.push(tbl([[card(row[0], FULL, ...fullBox)]], [FULL]));
      else { // одиночная половинка — по центру, без пустой колонки рядом
        const side = Math.floor((FULL - HALF) / 2);
        out.push(tbl([[gapCell(side), card(row[0], HALF, ...halfBox), gapCell(FULL - HALF - side)]], [side, HALF, FULL - HALF - side]));
      }
    });
    return out.join('');
  }

  // ---------------------------------------------------------------- СБОРКА (изделие из нескольких элементов)
  // it.kit.parts — элементы: {id, name, qty, desc, rows:[{k,v}], maker, model}; фото — m.kitImgs[id].
  // Таблица «Состав изделия» — что входит и главное о каждом элементе одной строкой; карточки — описание и все характеристики.
  const kitOf = it => (it && it.kit && Array.isArray(it.kit.parts) ? it.kit.parts : []).filter(x => x && String(x.name || '').trim());
  const kitName = x => x.name + (+x.qty > 1 ? ' × ' + x.qty : '');
  function kitXml(it, m) {
    const parts = kitOf(it), imgs = m.kitImgs || {}, out = [];
    if (BLK.equipKit) {
      out.push(subheading(T.kitTitle));
      const wc = cols([520, 3900, 1000, 4927]), HL = B(null, null, [4, HAIR]), Mr = [90, 100, 90, 100];
      const head = [T.colNo, T.kitColName, T.colQty, T.kitColParams].map((t, i) => tc(p(r(t, 'tableHeader'), { jc: i === 0 || i === 2 ? 'center' : 'left' }), wc[i], { fill: NAVYD, mar: [80, 100, 80, 100] }));
      const rows = [head].concat(parts.map((x, i) => {
        const short = (x.rows || []).filter(z => String(z.v).length <= 40), main = short.filter(z => !/^(модель|марка|производитель|тип|бренд)/i.test(z.k));
        const key = (main.length ? main : short).slice(0, Math.max(0, +RULES.kitKeyParams || 0)).map(z => z.k + ': ' + z.v).join('; ');
        const sub = [x.maker, x.model].filter(Boolean).join(' ');
        return [tc(p(r(String(i + 1), 'rowIndex'), { jc: 'center' }), wc[0], { bdr: HL, mar: Mr }),
          tc(p(r(x.name, 'cellBold'), { line: 240 }) + (sub && !x.name.includes(sub) ? p(r(sub, 'muted'), { before: 20, line: 240 }) : ''), wc[1], { bdr: HL, mar: Mr }),
          tc(p(r((+x.qty || 1) + NB + T.pcs, 'cell'), { jc: 'center' }), wc[2], { bdr: HL, mar: Mr }),
          tc(p(r(key || '—', key ? 'specText' : sty('specText', { color: GRAY })), { line: 240 }), wc[3], { bdr: HL, mar: Mr })];
      }));
      out.push(tbl(rows, wc, { header: true }));
    }
    // карточки элементов: фото (если есть) слева, справа — название, описание и характеристики парами «параметр — значение»
    const cards = BLK.equipKitCards ? parts.filter(x => x.desc || (x.rows || []).length || imgs[x.id]) : [];
    if (cards.length) {
      out.push(subheading(T.kitCardsTitle));
      cards.forEach((x, n) => {
        const g = imgs[x.id], wi = g ? Math.round(RULES.kitPhotoWidthCm * 567) : 0, wg = g ? X(240) : 0, wt = W - wi - wg;
        let body = p(r((n + 1) + '. ' + kitName(x), 'componentLabel'), { after: 60, keep: true });
        if (x.maker && !x.name.includes(x.maker)) body += p(r(txt('kitMaker', { maker: [x.maker, x.model].filter(Boolean).join(' ') }), 'muted'), { after: 60 });
        if (x.desc) body += p(r(x.desc, 'componentText'), { line: 252, after: (x.rows || []).length ? 80 : 0 });
        const rows = x.rows || [];
        if (rows.length) {
          // характеристики в две пары колонок, если их больше четырёх — карточка остаётся короткой
          const two = rows.length > 4, per = two ? Math.ceil(rows.length / 2) : rows.length, w1 = two ? Math.floor((wt - 160) / 2) : wt;
          const kv = (z, w) => { const wk = Math.round(w * 0.55); return [tc(p(r(z ? z.k : '', 'specName'), { line: 240 }), wk, { bdr: B(null, null, [4, HAIR]), mar: [40, 0, 40, 80] }),
            tc(p(r(z ? z.v : '', 'specValue'), { line: 240 }), w - wk, { bdr: B(null, null, [4, HAIR]), mar: [40, 60, 40, 0] })]; };
          const tr = [];
          for (let i = 0; i < per; i++) tr.push(two ? kv(rows[i], w1).concat([gapCell(wt - 2 * w1)], kv(rows[i + per], w1)) : kv(rows[i], w1));
          const ws = two ? [Math.round(w1 * 0.55), w1 - Math.round(w1 * 0.55), wt - 2 * w1, Math.round(w1 * 0.55), w1 - Math.round(w1 * 0.55)] : [Math.round(wt * 0.55), wt - Math.round(wt * 0.55)];
          body += tbl(tr, ws) + END;
        }
        if (n) out.push(spacer(180));
        if (g) {
          const [cx, cy] = fit(g, (wi - 160) * E, cm(RULES.kitPhotoHeightCm));
          out.push(tbl([[tc(p(img(g.rid, cx, cy, x.name, 'kitPhotoWidthCm'), { jc: 'center' }), wi, { va: 'top', mar: [40, 0, 0, 0] }),
            gapCell(wg), tc(body, wt, { va: 'top', mar: [0, 0, 0, 0] })]], [wi, wg, wt]));
        } else out.push(tbl([[tc(body, W, { bdr: B(null, [18, SKY]), va: 'top', mar: [20, 200, 20, 0] })]], [W]));
      });
    }
    return out.join('');
  }

  function equipXml(it, M) {
    const out = [heading(it.pageTitle || it.name, true)];
    const m = M.items[it.id] || {};
    const fimg = BLK.equipComponents ? (m.featImgs || {}) : {};
    const allF = (it.features || []).filter(f => f.label || f.text);
    const illustrated = allF.filter(f => f.id && fimg[f.id]);
    // длинные тексты (о серии, комплектация) — списком ниже; короткие — на первом экране рядом с фото
    const longF = allF.filter(f => !(f.id && fimg[f.id]) && (f.text || '').length > RULES.longFeatureChars);
    const feats = allF.filter(f => !(f.id && fimg[f.id]) && !longF.includes(f));
    const opts = BLK.equipOptions ? (it.options || []).filter(o => o.name && +o.qty > 0) : [];
    out.push(heroXml(it, m, feats, opts));
    if (kitOf(it).length) out.push(kitXml(it, m));
    if (illustrated.length) out.push(componentsXml(illustrated, fimg));
    if (longF.length && BLK.equipFeatures) out.push(featuresXml(longF));
    const groups = BLK.equipSpecs ? (it.groups || []).map(g => ({ name: g.name, rows: (g.rows || []).filter(x => x.k || x.v) })).filter(g => g.rows.length) : [];
    if (groups.length) out.push(specsXml(groups));
    if (BLK.equipGallery) out.push(galleryXml(m.gallery));
    return out.join('');
  }
  function hasEquipPage(it, M) {
    const m = M.items[it.id];
    return it.page && ((it.options || []).some(o => o.name) || kitOf(it).length || (it.groups && it.groups.some(g => g.rows && g.rows.some(x => x.k || x.v))) ||
      (m && m.tile) || ((m && m.gallery) || []).length || Object.keys((m && m.featImgs) || {}).length || (it.features || []).some(f => f.text));
  }

  // ================================================================ КОММЕРЧЕСКОЕ ПРЕДЛОЖЕНИЕ
  function offerXml(S, sec) {
    const out = [headingFor(T.offerTitle, sec, 480)], t = totals(S.items, S.vat);
    // скидка для заказчика: колонка «Скидка» и строки «Сумма без скидки» / «Скидка»;
    // если блок скидки выключен в шаблоне — в колонке цены сразу цена со скидкой
    const showD = BLK.discount && t.discount > 0;
    const unitP = it => showD ? it.price : netPrice(it);
    const wc = showD ? cols([560, 3787, 1100, 1800, 1300, 1800]) : cols([560, 4787, 1200, 1900, 1900]);
    const n = wc.length, wSum = (a, b) => wc.slice(a, b).reduce((x, y) => x + y, 0);
    const HL = B(null, null, [4, HAIR]), Mr = [230, 120, 230, 120];
    const cur = curSh(S), pcs = NB + T.pcs;
    const discCell = (it, w, o) => {
      const d = unitDisc(it);
      const tx = !d ? '—' : it.disc.type === 'sum' ? '−' + money(d) : '−' + String(it.disc.v).replace('.', ',') + NB + '%';
      return tc(p(r(tx, d ? 'cell' : sty('cell', { color: GRAY })), { jc: 'right' }), w, o);
    };
    const rows = [[HDR(T.colNo, wc[0], 'center'), HDR(T.colName, wc[1]), HDR(T.colQty, wc[2], 'center'), HDR(txt('colPrice', { cur }), wc[3], 'right')]
      .concat(showD ? [HDR(T.colDisc, wc[4], 'right')] : [], [HDR(txt('colSum', { cur }), wc[n - 1], 'right')])];
    S.items.forEach((it, i) => {
      const nm = p(r(it.name, 'itemName'), { after: it.spec ? 40 : 0 }) + (it.spec ? p(r(it.spec, 'muted')) : '');
      rows.push([tc(p(r(String(i + 1), 'rowIndex'), { jc: 'center' }), wc[0], { bdr: HL, mar: Mr }), tc(nm, wc[1], { bdr: HL, mar: Mr }),
        tc(p(r(it.qty + pcs, 'cell'), { jc: 'center' }), wc[2], { bdr: HL, mar: Mr }),
        tc(p(r(money(unitP(it)), 'cell'), { jc: 'right' }), wc[3], { bdr: HL, mar: Mr })]
        .concat(showD ? [discCell(it, wc[4], { bdr: HL, mar: Mr })] : [],
          [tc(p(r(money(it.qty * netPrice(it)), 'cellBold'), { jc: 'right' }), wc[n - 1], { bdr: HL, mar: Mr })]));
      if (BLK.offerKit) kitOf(it).forEach(x => {
        const Mo = [70, 120, 70, 120], free = sty('option', { color: GRAY });
        rows.push([tc('', wc[0], { bdr: HL, mar: Mo }), tc(p(r('· ' + x.name, 'option'), { indL: 200 }), wc[1], { bdr: HL, mar: Mo }),
          tc(p(r((+x.qty || 1) * (+it.qty || 1) + pcs, 'option'), { jc: 'center' }), wc[2], { bdr: HL, mar: Mo }),
          tc(p(r(T.kitInOffer, free), { jc: 'right' }), wc[3], { bdr: HL, mar: Mo })]
          .concat(showD ? [tc('', wc[4], { bdr: HL, mar: Mo })] : [], [tc(p(r('—', free), { jc: 'right' }), wc[n - 1], { bdr: HL, mar: Mo })]));
      });
      (it.options || []).filter(o => o.name && +o.qty > 0).forEach((o, j) => {
        const Mo = [110, 120, 110, 120], free = sty('option', { color: GRAY });
        const nm = p(r('+ ' + o.name, 'option'), { after: o.note ? 30 : 0, indL: 200 }) + (o.note ? p(r(o.note, 'optionNote'), { indL: 200 }) : '');
        rows.push([tc(p(r(`${i + 1}.${j + 1}`, 'muted'), { jc: 'center' }), wc[0], { bdr: HL, mar: Mo }), tc(nm, wc[1], { bdr: HL, mar: Mo }),
          tc(p(r(o.qty + NB + (o.unit || T.pcs), 'option'), { jc: 'center' }), wc[2], { bdr: HL, mar: Mo }),
          tc(p(r(o.price ? money(o.price) : T.included, o.price ? 'option' : free), { jc: 'right' }), wc[3], { bdr: HL, mar: Mo })]
          .concat(showD ? [tc('', wc[4], { bdr: HL, mar: Mo })] : [],
            [tc(p(r(o.price ? money(o.qty * o.price) : '—', o.price ? 'option' : free), { jc: 'right' }), wc[n - 1], { bdr: HL, mar: Mo })]));
      });
    });
    const lbl = (tx, span, w) => tc(p(r(tx, 'totalLabel'), { jc: 'right' }), w, { span, mar: [90, 120, 60, 160] });
    if (showD) {
      rows.push([lbl(T.subtotal, n - 1, wSum(0, n - 1)), tc(p(r(money(t.gross), sty('totalValue', { b: false })), { jc: 'right' }), wc[n - 1], { mar: [90, 120, 30, 120] })]);
      rows.push([lbl(T.discountTotal, n - 1, wSum(0, n - 1)), tc(p(r('−' + money(t.discount), 'totalValue'), { jc: 'right' }), wc[n - 1], { mar: [30, 120, 30, 120] })]);
    }
    rows.push([lbl(T.total, 2, wc[0] + wc[1]), tc(p(r(t.units + pcs, 'totalValue'), { jc: 'center' }), wc[2], { mar: [90, 120, 60, 120] })]
      .concat(wc.slice(3, n - 1).map(w => tc('', w, { mar: [90, 120, 60, 120] })), [tc(p(r(money(t.sum), 'totalValue'), { jc: 'right' }), wc[n - 1], { mar: [90, 120, 60, 120] })]));
    rows.push([lbl(txt('vatIncl', { vat: S.vat }), n - 1, wSum(0, n - 1)), tc(p(r(money(t.vat), sty('totalValue', { b: false })), { jc: 'right' }), wc[n - 1], { mar: [60, 120, 60, 120] })]);
    out.push(bgpara(W, 440, NAVYD, 90));
    out.push(tbl(rows, wc, { heights: { 0: 440 }, header: true }));
    const L4 = wSum(0, n - 1);
    out.push(bgpara(W, 640, BLUE, 120, 120));
    out.push(tbl([[tc(p(r(T.grandTotal, 'grandLabel'), { jc: 'right' }), L4, { mar: [0, 120, 0, 160] }),
      tc(p(r(money(t.sum), 'grandSum'), { jc: 'right' }), wc[n - 1], { mar: [0, 120, 0, 120] })]], [L4, wc[n - 1]], { heights: { 0: 640 } }));
    if (BLK.amountInWords)
      out.push(p(r(T.inWordsLabel, 'wordsLabel') + r(txt('inWords', { words: words(t.sum, curCode(S)), vat: S.vat, vatSum: money(t.vat), cur }), 'words'), { before: 140, line: 250 }));
    if (curCode(S) !== 'RUB' && BLK.currencyNote) {
      const C = CURS[curCode(S)], rt = S.cur && +S.cur.rate;
      const eq = rt ? Math.round(t.sum * rt) : 0;
      out.push(p(r(txt('currencyNote', { curName: C.name }) +
        (rt ? txt('currencyRate', { rateDate: S.cur.date ? ' на ' + ruDate(S.cur.date) : '', cur: C.sh, rate: String(rt).replace('.', ','), rub: money(eq) }) : ''), 'note'), { before: 60, line: 250 }));
    }
    return out.join('');
  }

  // ================================================================ УСЛОВИЯ ПРЕДЛОЖЕНИЯ
  function conditionsXml(S, sec) {
    const conds = (S.conditions || []).filter(c => c.value);
    // дополнительные условия и оговорки: каждая строка — отдельный абзац; строки с «-», «•», «*» — пункты списка
    const extra = String(S.condExtra || '').split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    if (!conds.length && !extra.length) return '';
    const w2 = cols([3400, 6947]);
    let x = headingFor(T.conditionsTitle, sec, 480);
    if (conds.length) x += tbl(conds.map((c, i) => {
      const bd = i === conds.length - 1 ? B() : B(null, null, [4, HAIR]);
      return [tc(p(r(c.label, 'condLabel')), w2[0], { bdr: bd, mar: [130, 120, 130, 120] }), tc(p(r(c.value, 'condValue')), w2[1], { bdr: bd, mar: [130, 120, 130, 120] })];
    }), w2);
    if (extra.length) {
      x += p(r(T.condExtraTitle, 'condLabel'), { before: conds.length ? 260 : 60, after: 90, indL: 120 });
      x += extra.map(l => /^[-•*–—]\s*/.test(l) ? p(r('•\u00A0\u00A0' + l.replace(/^[-•*–—]\s*/, ''), 'condValue'), { after: 70, line: 260, indL: 240 })
        : p(r(l, 'condValue'), { after: 70, line: 260, indL: 120 })).join('');
    }
    return x;
  }

  // ================================================================ КОНТАКТНАЯ ИНФОРМАЦИЯ
  function contactsXml(S, sec) {
    const out = [headingFor(T.contactsTitle, sec, 520)];
    const m = S.manager || {};
    const LBL = tx => p(r(tx, 'contactLabel'), { after: 50 });
    const ch = (lab, val, w, first, lastRow) => tc(LBL(lab) + p(val, { line: 240 }), w, { bdr: B([4, LINE]), va: 'top', mar: [200, first ? 0 : 200, lastRow ? 40 : 200, 120] });
    const tw = cols([6400, 3347]);
    const top = tbl([[tc(p(r(m.name, 'managerName'), { after: 60, line: 240 }) + p(r(m.position || '', 'managerPost'), { line: 250 }), tw[0], { va: 'bottom', mar: [0, 0, 220, 0] }),
      tc(p(r(T.closing1, 'closing'), { jc: 'right', line: 250 }) + p(r(T.closing2, 'closing'), { jc: 'right', line: 250 }), tw[1], { va: 'bottom', mar: [0, 0, 220, 0] })]], tw);
    const cw = cols([3149, 3149, 3449]);
    const dash = r('—', 'contactValue');
    const phone = r(m.phone || '', 'contactPhone') + (m.ext ? r(txt('ext', { ext: m.ext }), 'contactExt') : '');
    const grid = tbl([[ch(T.phone, phone, cw[0], true), ch(T.mobile, r(m.mobile || '—', 'contactPhone'), cw[1]),
      ch(T.email, m.email ? hyper('rIdMail', r(m.email, 'contactLink')) : dash, cw[2])],
    [ch(T.site, m.site ? hyper('rIdSite', r(m.site, 'contactLink')) : dash, cw[0], true, true),
      ch(T.hours, r(m.hours || '—', 'contactValue'), cw[1], false, true), ch(T.address, r(m.address || '—', 'contactValue'), cw[2], false, true)]], cw);
    out.push(bgpara(W, 3420, LIGHT, 180));
    out.push(tbl([[tc(top + grid + END, W, { va: 'top', mar: [340, 340, 200, 340] })]], [W], { heights: { 0: 3420 } }));
    return out.join('');
  }

  // заголовок раздела: с новой страницы или после отступа
  function headingFor(title, sec, gap) {
    return sec && sec.newPage ? heading(title, true) : spacer(gap) + heading(title);
  }
  const sectionOn = id => TPL.sections.some(s => s.id === id && s.on);

  // ================================================================ НИЖНИЙ КОЛОНТИТУЛ
  function fld(instr, res, o) {
    const f = esc(TPL.font || 'Arial');
    const rp = `<w:rPr><w:rFonts w:ascii="${f}" w:hAnsi="${f}" w:cs="${f}"/>${o.b ? '<w:b/>' : ''}<w:color w:val="${o.color}"/><w:sz w:val="${o.sz}"/><w:szCs w:val="${o.sz}"/></w:rPr>`;
    return `<w:r>${rp}<w:fldChar w:fldCharType="begin"/></w:r><w:r>${rp}<w:instrText xml:space="preserve"> ${instr} </w:instrText></w:r><w:r>${rp}<w:fldChar w:fldCharType="separate"/></w:r><w:r>${rp}<w:t>${res}</w:t></w:r><w:r>${rp}<w:fldChar w:fldCharType="end"/></w:r>`;
  }
  function footerXml(S, root) {
    if (!BLK.footer) return root + END + '</w:ftr>';
    const TOP = line('top', 4, LINE) + '<w:left w:val="nil"/><w:bottom w:val="nil"/><w:right w:val="nil"/>';
    const left = p(brandRuns('footerBrand') +
      r('   ·   ' + T.footerText + ' ', 'footer') + r(S.client, 'footerClient'));
    const right = p(r((TPL.site ? TPL.site + '   ·   ' : ''), 'footer') + fld('PAGE', '1', sty('footerPage')) + r(' / ', 'footer') + fld('NUMPAGES', '1', sty('footer')), { jc: 'right' });
    const w2 = cols([6847, 3500]);
    return root + tbl([[tc(left, w2[0], { bdr: TOP, mar: [110, 0, 0, 0] }), tc(right, w2[1], { bdr: TOP, mar: [110, 0, 0, 0] })]], w2) + END + '</w:ftr>';
  }

  // ================================================================ ШАПКА СТРАНИЦЫ (из настроек)
  function headerXml(S, root) {
    const H = TPL.header || {}, lg = TPL.headerLogo;
    const lines = String(H.lines || '').split(/\r?\n/).map(x => x.trim()).filter(Boolean);
    const sz = Math.round((+H.textSize || 8) * 2), col = COL(H.textColor || 'GRAY');
    const mk = TPL.design ? 'KPS_headerText' : '';
    const txt = lines.map((l, i) => p(r(l, { sz: i === 0 && H.firstBold ? sz + 4 : sz, color: i === 0 && H.firstColor ? COL(H.firstColor) : col, b: i === 0 && !!H.firstBold, mk }),
      { jc: H.logoSide === 'right' ? 'left' : 'right', line: 250 })).join('') || p('');
    let logo = p('');
    if (lg && lg.rid) {
      const wcm = Math.max(0.5, +H.logoWidthCm || 4), cx = cm(wcm), cy = +H.logoHeightCm > 0 ? cm(H.logoHeightCm) : Math.round(cx * lg.h / lg.w);
      logo = p(img(lg.rid, cx, cy, 'Логотип компании', 'headerLogo'), { jc: H.logoSide === 'right' ? 'right' : 'left' });
    }
    const lw = lg && lg.rid ? Math.min(X(6000), Math.round((+H.logoWidthCm || 4) * 567) + 200) : 0, tw = W - lw;
    const bdr = H.rule !== false ? B(null, null, [6, COL(H.ruleColor || 'LINE')]) : B();
    const cells = lw ? (H.logoSide === 'right'
      ? [tc(txt, tw, { bdr, mar: [0, 0, 120, 0] }), tc(logo, lw, { bdr, mar: [0, 0, 120, 0] })]
      : [tc(logo, lw, { bdr, mar: [0, 0, 120, 0] }), tc(txt, tw, { bdr, mar: [0, 0, 120, 0] })]) : [tc(txt, W, { bdr, mar: [0, 0, 120, 0] })];
    return root + tbl([cells], lw ? (H.logoSide === 'right' ? [tw, lw] : [lw, tw]) : [W]) + spacer(120) + '</w:hdr>';
  }

  function relsXml(S, media) {
    const R = (id, type, target, ext) => `<Relationship Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/${type}" Target="${esc(target)}"${ext ? ' TargetMode="External"' : ''}/>`;
    let x = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">';
    x += (TPL.rels || '') + (TPL.clients ? R(TPL.clients.rid, 'image', 'media/' + TPL.clients.file) : '');
    const m = S.manager || {};
    if (m.email) x += R('rIdMail', 'hyperlink', 'mailto:' + m.email.trim(), true);
    if (m.site) x += R('rIdSite', 'hyperlink', /^https?:/i.test(m.site) ? m.site.trim() : 'http://' + m.site.trim(), true);
    media.forEach(md => { x += R(md.rid, 'image', 'media/' + md.file); });
    return x + '</Relationships>';
  }

  // ================================================================ СБОРКА
  /* S — данные КП; Min — подготовленные изображения:
     { cover:{file,w,h}, thumbs:{[key]:…}, items:{[id]:{tile, logo, gallery:[…], featImgs:{…}, kitImgs:{[id элемента]:…}}} };
     roots — корневые теги document.xml и footer.xml; tpl — настройки шаблона (template.json + base.docx). */
  function build(S, Min, roots, tpl) {
    setTemplate(tpl);
    PID = 9000;
    const media = [], M = { cover: null, items: {} };
    let n = 0;
    const reg = x => { if (!x) return null; const rid = 'rIdImg' + (++n); media.push({ rid, file: x.file }); return Object.assign({ rid }, x); };
    M.cover = reg(Min.cover);
    M.thumbs = {}; for (const k in (Min.thumbs || {})) M.thumbs[k] = reg(Min.thumbs[k]);
    for (const id in (Min.items || {})) M.items[id] = { tile: reg(Min.items[id].tile), logo: reg(Min.items[id].logo), gallery: (Min.items[id].gallery || []).map(reg).filter(Boolean), featImgs: Object.fromEntries(Object.entries(Min.items[id].featImgs || {}).map(([k, v]) => [k, reg(v)])),
      kitImgs: Object.fromEntries(Object.entries(Min.items[id].kitImgs || {}).map(([k, v]) => [k, reg(v)])) };
    const parts = {
      cover: () => coverXml(S, M),
      clients: sec => clientsXml(S, sec),
      equipment: () => S.items.filter(it => hasEquipPage(it, M)).map(it => equipXml(it, M)).join(''),
      offer: sec => offerXml(S, sec),
      conditions: sec => conditionsXml(S, sec),
      contacts: sec => contactsXml(S, sec)
    };
    // свои картинки и надписи шаблона: строкой в начале / конце раздела или свободно на странице (плавающий объект,
    // привязанный к крошечному абзацу на этом месте). floats — плавающие объекты по порядку (для предпросмотра)
    const inline = {}, floating = {}, floats = [];
    const push = (box, place, x) => (box[place] = box[place] || []).push(x);
    for (const x of (TPL.images || [])) { const im = (Min.extra || {})[x.id]; if (!im) continue;
      const rg = reg(im), wcm = Math.max(0.3, +x.widthCm || 5), cx = cm(x.float ? wcm : Math.min(wcm, W / 567));
      const cy = +x.heightCm > 0 ? cm(x.heightCm) : Math.round(cx * im.h / im.w);
      if (x.float) push(floating, x.place, () => { const id = ++PID; floats.push({ kind: 'img', id: 'X_' + x.id, behind: !!x.behind });
        return anchorRun(picXml(id, rg.rid, cx, cy, x.name || 'Изображение'), id, cx, cy, +x.x || 0, +x.y || 0, x.name || 'Изображение', 'KPI_X_' + x.id, x.behind); });
      else push(inline, x.place, () => { RUNSTY = null; return p(img(rg.rid, cx, cy, x.name || 'Изображение', 'X_' + x.id), { jc: x.align || 'center', before: 120, after: 120 }); });
    }
    const vars = { 'клиент': S.client || '', 'номер': S.number || '', 'дата': S.date ? ruDate(S.date) : '', 'менеджер': (S.manager || {}).name || '',
      'телефон': (S.manager || {}).phone || '', 'email': (S.manager || {}).email || '', 'сайт': TPL.site || '' };
    const lblRuns = (l, line) => r(line, { sz: Math.round((+l.size || 10) * 2), color: COL(l.color || 'DARK'), b: !!l.bold, i: !!l.italic, caps: !!l.caps, mk: TPL.design ? 'KPL_' + l.id : '' });
    const lblParas = (l, o) => { RUNSTY = null; return String(fill(l.text || '', vars)).split(/\r?\n/).map(line => p(line ? lblRuns(l, line) : '', Object.assign({ jc: l.align || 'left', line: 260 }, o))).join(''); };
    const escH = v => esc(v).replace(/'/g, '&#39;');
    for (const l of (TPL.labels || [])) {
      if (!l || !String(l.text || '').trim()) continue;
      if (!l.float) { push(inline, l.place, () => lblParas(l, {}).replace(/<w:spacing w:before="0"/, '<w:spacing w:before="120"')); continue; }
      push(floating, l.place, () => {
        const id = ++PID, cx = cm(Math.max(0.5, +l.widthCm || 6)), cy = cm(Math.max(0.3, +l.heightCm || 1.2)), pad = l.bg || l.border ? 72000 : 0;
        const fillX = l.bg ? `<a:solidFill><a:srgbClr val="${COL(l.bg)}"/></a:solidFill>` : '<a:noFill/>';
        const lnX = l.border ? `<a:ln w="9525"><a:solidFill><a:srgbClr val="${COL(l.border)}"/></a:solidFill></a:ln>` : '<a:ln><a:noFill/></a:ln>';
        const g = '<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.microsoft.com/office/word/2010/wordprocessingShape">' +
          `<wps:wsp><wps:cNvSpPr txBox="1"/><wps:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom>${fillX}${lnX}</wps:spPr>` +
          `<wps:txbx><w:txbxContent>${lblParas(l, {})}</w:txbxContent></wps:txbx>` +
          `<wps:bodyPr rot="0" vert="horz" wrap="square" lIns="${pad}" tIns="${pad}" rIns="${pad}" bIns="${pad}" anchor="t" anchorCtr="0"><a:noAutofit/></wps:bodyPr></wps:wsp></a:graphicData></a:graphic>`;
        // то же для предпросмотра (docx-preview надписи Word не рисует)
        const lines = String(fill(l.text || '', vars)).split(/\r?\n/).map(t => esc(t) || '&nbsp;').join('<br>');
        const css = `position:absolute;left:0;top:0;box-sizing:border-box;width:${(+l.widthCm || 6)}cm;height:${(+l.heightCm || 1.2)}cm;overflow:hidden;` +
          `padding:${pad ? '0.2cm' : '0'};font-family:'${escH(String(TPL.font || 'Arial').replace(/'/g, ''))}',Arial,sans-serif;font-size:${+l.size || 10}pt;line-height:1.25;` +
          `color:#${COL(l.color || 'DARK')};font-weight:${l.bold ? 700 : 400};font-style:${l.italic ? 'italic' : 'normal'};text-transform:${l.caps ? 'uppercase' : 'none'};` +
          `text-align:${{ left: 'left', center: 'center', right: 'right', both: 'justify' }[l.align] || 'left'};${l.bg ? 'background:#' + COL(l.bg) + ';' : ''}${l.border ? 'border:1px solid #' + COL(l.border) + ';' : ''}`;
        floats.push({ kind: 'label', id: 'L_' + l.id, html: `<div class="kp-lbl" data-tdl="L_${escH(l.id)}" style="${escH(css)}">${lines}</div>` });
        return anchorRun(g, id, cx, cy, +l.x || 0, +l.y || 0, 'Надпись', '', false);
      });
    }
    // место в разделе: строки — как текст; плавающие — в абзаце привязки (в графическом редакторе он есть всегда)
    const at = place => {
      const fl = (floating[place] || []).map(f => f()).join(''), il = (inline[place] || []).map(f => f()).join('');
      const anc = fl || TPL.design ? `<w:p><w:pPr><w:pStyle w:val="${TPL.design ? 'KPANC_' + place : 'KPFLOAT'}"/><w:spacing w:before="0" w:after="0" w:line="20" w:lineRule="exact"/><w:jc w:val="left"/><w:rPr><w:sz w:val="2"/></w:rPr></w:pPr>${fl}</w:p>` : '';
      return /Top$/.test(place) ? anc + il : il + anc;
    };
    let body = '';
    for (const sec of TPL.sections) if (sec.on && parts[sec.id]) {
      let part = parts[sec.id](sec);
      if (!part) continue;
      // начало раздела: у титула — в самом начале, у остальных — сразу после заголовка раздела
      part = sec.id === 'cover' || part.indexOf(HEADMARK) < 0 ? at(sec.id + 'Top') + part : part.replace(HEADMARK, at(sec.id + 'Top'));
      if (TPL.design) body += `<w:p><w:pPr><w:pStyle w:val="KPSEC_${sec.id}"/><w:spacing w:before="0" w:after="0" w:line="20" w:lineRule="exact"/></w:pPr></w:p>`;
      body += part.split(HEADMARK).join('') + at(sec.id + 'End');
    }
    body += '<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="20" w:lineRule="exact"/><w:rPr><w:sz w:val="2"/><w:szCs w:val="2"/></w:rPr></w:pPr></w:p>';
    return {
      document: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' + roots.document + '<w:body>' + body + (TPL.sect || '') + '</w:body></w:document>',
      footer: footerXml(S, roots.footer),
      rels: relsXml(S, media),
      header: TPL.header && TPL.header.on && roots.header ? headerXml(S, roots.header) : null,
      media, floats
    };
  }

  // features — что скелет умеет выводить сам; без 'discount' программа передаёт цены уже со скидкой,
  // 'header' — шапка из настроек, 'images' — дополнительные картинки, 'design' — пометки графического редактора,
  // 'kit' — сборки: состав изделия приходит как есть (it.kit.parts), а не разложенным в описание
  return { defaults: DEFAULTS, build, features: ['discount', 'header', 'images', 'design', 'kit'] };
}
